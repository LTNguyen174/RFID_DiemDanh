import json
import os
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import PromptTemplate
from sqlalchemy import inspect, text

from ..db import AsyncSessionLocal
from ..models import Student, AttendanceLog, ClassModel
from ..settings import settings


# ─── Sync engine cho Inspector ────────────────────────────────────────────────
_sync_engine = None

def _get_sync_engine():
    global _sync_engine
    if _sync_engine is None:
        sync_url = settings.database_url.replace("+asyncpg", "").replace("+aiosqlite", "")
        from sqlalchemy import create_engine
        _sync_engine = create_engine(sync_url)
    return _sync_engine


def _extract_text_from_content(content) -> str:
    """Chuẩn hoá response content từ Gemini (có thể là list hoặc string)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                parts.append(part.get("text", ""))
            else:
                parts.append(str(part))
        return " ".join(parts)
    return str(content)


# ─── Prompt 1: Hiểu câu hỏi → sinh SQL ───────────────────────────────────────
SQL_PROMPT_TEMPLATE = """Bạn là chuyên gia SQL PostgreSQL. Nhiệm vụ: đọc hiểu câu hỏi, suy luận logic, rồi sinh đúng 1 câu SELECT.

═══ SCHEMA ═══
{schema}

═══ QUAN HỆ BẢNG ═══
attendance_logs.student_id  = students.id           (UUID)
attendance_logs.session_id  = class_sessions.id     (INTEGER)
class_sessions.class_id     = classes.id            (INTEGER)
student_classes.student_id  = students.id           (UUID)      ← mapping SV vào lớp
student_classes.class_id    = classes.id            (INTEGER)   ← mapping SV vào lớp

═══ GIÁ TRỊ THỰC TẾ TRONG DATABASE ═══
students.status        : 'active' | 'inactive'
                         → LUÔN lọc s.status = 'active' khi liệt kê sinh viên
attendance_logs.status : 'on_time' (đúng giờ) | 'late' (đi muộn/trễ)
                         → TUYỆT ĐỐI không dùng 'present' hay 'absent' — không tồn tại trong DB
student_classes.status : 'enrolled'
                         → LUÔN lọc sc.status = 'enrolled'
class_sessions.status  : 'ongoing' | 'cancelled' | 'completed'
                         → Khi hỏi về buổi học thực tế: lọc cs.status != 'cancelled'
classes.class_code     : mã lớp viết hoa, ví dụ 'DEMO4', 'CS101'
class_sessions.date    : kiểu DATE (không phải TIMESTAMP)
first_scan_time        : kiểu TIMESTAMP

═══ NGUYÊN TẮC TƯ DUY ═══

1. Câu hỏi hỏi về TRẠNG THÁI GÌ?
   - "đi muộn/trễ"               → lọc al.status = 'late'
   - "có mặt/đúng giờ/on_time"   → lọc al.status = 'on_time'
   - "đã điểm danh nói chung"     → al.status IN ('on_time', 'late')
   - "vắng/không đến/chưa điểm danh/không có mặt" →
       * Đây là người KHÔNG XUẤT HIỆN trong attendance_logs cho session đó
       * TUYỆT ĐỐI không dùng 'absent' hay 'present' — không tồn tại trong DB
       * Phải dùng: student_classes LEFT JOIN attendance_logs WHERE al.id IS NULL
       * Xem MẪU A và MẪU B bên dưới

2. THỜI GIAN nào?
   - "hôm nay"    → cs.date = CURRENT_DATE
   - "hôm qua"    → cs.date = CURRENT_DATE - INTERVAL '1 day'
   - "tuần này"   → cs.date >= date_trunc('week', CURRENT_DATE + INTERVAL '1 day') - INTERVAL '1 day'
                    AND cs.date <  date_trunc('week', CURRENT_DATE + INTERVAL '1 day') + INTERVAL '6 days'
   - "tháng này"  → date_trunc('month', cs.date) = date_trunc('month', CURRENT_DATE)
   - ngày cụ thể  → cs.date = 'YYYY-MM-DD'::DATE
   - Khi hỏi về lớp CỤ THỂ mà KHÔNG nói ngày → TÌM session gần nhất của lớp đó:
     Dùng: cs.date = (SELECT MAX(cs2.date) FROM class_sessions cs2 JOIN classes c2 ON c2.id = cs2.class_id WHERE c2.class_code ILIKE '%TENLOP%' AND cs2.status != 'cancelled')

3. LỚP nào? → lọc c.class_code ILIKE '%TÊN_LỚP%' hoặc c.name ILIKE '%tên%'

4. CẦN JOIN NHỮNG BẢNG NÀO?
   - Nếu cần tên sinh viên → JOIN students
   - Nếu cần tên lớp/ngày học → JOIN class_sessions, classes
   - Nếu tìm vắng → dùng MẪU A/B, KHÔNG làm cách khác

5. CẦN ĐẾM hay LIỆT KÊ?
   - Đếm → COUNT(DISTINCT ...) để tránh trùng
   - Liệt kê → SELECT các cột cần thiết + LIMIT 100

═══ MẪU SQL BẮT BUỘC PHẢI LÀM THEO ═══

-- [MẪU A] Vắng/chưa điểm danh trong lớp CỤ THỂ (tìm session gần nhất):
SELECT s.student_code, s.full_name
FROM student_classes sc
JOIN students s ON s.id = sc.student_id
JOIN classes c ON c.id = sc.class_id
JOIN class_sessions cs ON cs.class_id = c.id
LEFT JOIN attendance_logs al
    ON al.student_id = s.id
    AND al.session_id = cs.id
WHERE s.status = 'active'
  AND sc.status = 'enrolled'
  AND c.class_code ILIKE '%DEMO4%'
  AND cs.date = (SELECT MAX(cs2.date) FROM class_sessions cs2 JOIN classes c2 ON c2.id = cs2.class_id WHERE c2.class_code ILIKE '%DEMO4%' AND cs2.status != 'cancelled')
  AND cs.status != 'cancelled'
  AND al.id IS NULL
LIMIT 100;

-- [MẪU B] Vắng/chưa điểm danh KHÔNG rõ lớp:
SELECT DISTINCT s.student_code, s.full_name, c.class_code, cs.date
FROM student_classes sc
JOIN students s ON s.id = sc.student_id
JOIN classes c ON c.id = sc.class_id
JOIN class_sessions cs ON cs.class_id = c.id
LEFT JOIN attendance_logs al
    ON al.student_id = s.id
    AND al.session_id = cs.id
WHERE s.status = 'active'
  AND sc.status = 'enrolled'
  AND cs.date = CURRENT_DATE
  AND cs.status != 'cancelled'
  AND al.id IS NULL
LIMIT 100;

-- [MẪU D] Đi muộn trong lớp cụ thể (tìm session gần nhất):
SELECT s.student_code, s.full_name, c.class_code, al.first_scan_time
FROM attendance_logs al
JOIN students s ON al.student_id = s.id
JOIN class_sessions cs ON al.session_id = cs.id
JOIN classes c ON cs.class_id = c.id
WHERE al.status = 'late'
  AND c.class_code ILIKE '%DEMO4%'
  AND cs.date = (SELECT MAX(cs2.date) FROM class_sessions cs2 JOIN classes c2 ON c2.id = cs2.class_id WHERE c2.class_code ILIKE '%DEMO4%' AND cs2.status != 'cancelled')
LIMIT 100;

-- [MẪU F] Tỷ lệ điểm danh theo lớp (tìm session gần nhất của lớp đó):
SELECT
    sv.class_code,
    sv.tong_sinh_vien,
    COALESCE(dd.da_diem_danh, 0) AS da_diem_danh,
    COALESCE(dt.di_tre, 0) AS di_tre,
    sv.tong_sinh_vien - COALESCE(dd.da_diem_danh, 0) AS vang,
    ROUND(COALESCE(dd.da_diem_danh, 0) * 100.0 / NULLIF(sv.tong_sinh_vien, 0), 1) AS ty_le_phan_tram
FROM (
    SELECT c.id AS class_id, c.class_code, COUNT(DISTINCT sc.student_id) AS tong_sinh_vien
    FROM classes c
    JOIN student_classes sc ON sc.class_id = c.id
    JOIN students s ON s.id = sc.student_id
    WHERE sc.status = 'enrolled' AND s.status = 'active' AND c.class_code ILIKE '%DEMO4%'
    GROUP BY c.id, c.class_code
) sv
LEFT JOIN (
    SELECT cs.class_id, COUNT(DISTINCT al.student_id) AS da_diem_danh
    FROM attendance_logs al
    JOIN class_sessions cs ON cs.id = al.session_id
    WHERE al.status IN ('on_time', 'late')
      AND cs.status != 'cancelled'
      AND cs.date = (SELECT MAX(cs2.date) FROM class_sessions cs2 WHERE cs2.class_id = cs.class_id AND cs2.status != 'cancelled')
    GROUP BY cs.class_id
) dd ON dd.class_id = sv.class_id
LEFT JOIN (
    SELECT cs.class_id, COUNT(DISTINCT al.student_id) AS di_tre
    FROM attendance_logs al
    JOIN class_sessions cs ON cs.id = al.session_id
    WHERE al.status = 'late'
      AND cs.status != 'cancelled'
      AND cs.date = (SELECT MAX(cs2.date) FROM class_sessions cs2 WHERE cs2.class_id = cs.class_id AND cs2.status != 'cancelled')
    GROUP BY cs.class_id
) dt ON dt.class_id = sv.class_id
ORDER BY sv.class_code;

═══ QUY TẮC SQL ═══
- CHỈ SINH ĐÚNG MỘT CÂU SQL DUY NHẤT - KHÔNG DÙNG DẤU CHẤM PHẢY (;)
- Chỉ trả về SQL thuần tuý, KHÔNG markdown, KHÔNG giải thích, KHÔNG comment
- Chỉ dùng SELECT. Cấm: DROP, DELETE, UPDATE, INSERT, TRUNCATE, ALTER, CREATE
- Alias: students=s, classes=c, class_sessions=cs, attendance_logs=al, student_classes=sc
- LUÔN lọc s.status = 'active' và sc.status = 'enrolled'
- LUÔN lọc cs.status != 'cancelled'
- Thêm LIMIT 100 nếu không có yêu cầu số lượng cụ thể
- **QUAN TRỌNG**: Khi hỏi về lớp CỤ THỂ (có tên lớp) mà KHÔNG nói ngày:
  KHÔNG ĐƯỢC dùng CURRENT_DATE
  PHẢI dùng subquery: cs.date = (SELECT MAX(cs2.date) FROM class_sessions cs2 WHERE cs2.class_id = c.id AND cs2.status != 'cancelled')
  Hoặc lấy ngày gần nhất từ bảng class_sessions cho lớp đó rồi JOIN với attendance_logs

Câu hỏi: "{question}"
SQL:"""


# ─── Prompt 2: Dữ liệu → trả lời tự nhiên ────────────────────────────────────
ANSWER_PROMPT_TEMPLATE = """Bạn là trợ lý thông minh. Hãy trả lời câu hỏi bằng tiếng Việt dựa trên dữ liệu JSON bên dưới.

Quy tắc trả lời:
- Nếu mảng dữ liệu rỗng [] → trả lời "Không có [đối tượng được hỏi] nào trong [thời gian/lớp đó]."
- Nếu có dữ liệu → tóm tắt ngắn gọn, liệt kê tên cụ thể nếu ít hơn 10 người
- Dịch các giá trị status: 'on_time'=đúng giờ, 'late'=đi muộn
- Trả lời thân thiện, tự nhiên như người thật

Câu hỏi: {question}

Dữ liệu (JSON):
{data_str}

Câu trả lời:"""


# ─── Prompt 3: Trích xuất thông tin từ câu hỏi báo cáo ───────────────────────
REPORT_EXTRACT_PROMPT = """Phân tích câu hỏi và trả về JSON với các trường sau:
- report_type: "class" nếu hỏi về 1 lớp/môn cụ thể, "daily" nếu hỏi về tất cả lớp trong 1 ngày, "unknown" nếu không rõ
- class_code: mã lớp nếu có (ví dụ "DEMO4", "CS101"), null nếu không có
- class_name: tên môn học nếu có, null nếu không có
- date_filter: "today" | "yesterday" | "YYYY-MM-DD" | "this_week" | "this_month"

Chỉ trả về JSON thuần, không giải thích, không markdown.

Câu hỏi: "{question}"
JSON:"""


# ─── SQL Queries cho báo cáo ──────────────────────────────────────────────────

# Lấy thông tin buổi học của 1 lớp
CLASS_SESSION_INFO_SQL = """
SELECT
    c.class_code,
    c.name AS class_name,
    cs.id AS session_id,
    cs.date,
    cs.start_time,
    cs.end_time,
    cs.status AS session_status,
    cs.late_threshold_minutes
FROM classes c
JOIN class_sessions cs ON cs.class_id = c.id
WHERE {class_filter}
  AND {date_filter}
  AND cs.status != 'cancelled'
ORDER BY cs.date DESC, cs.start_time DESC
LIMIT 1
"""

# Lấy danh sách tất cả SV trong lớp + trạng thái điểm danh cho buổi cụ thể
CLASS_DETAIL_REPORT_SQL = """
SELECT
    s.student_code                                          AS "Mã SV",
    s.full_name                                             AS "Họ tên",
    CASE
        WHEN al.status = 'on_time' THEN 'Đúng giờ'
        WHEN al.status = 'late'    THEN 'Đi muộn'
        ELSE                            'Vắng'
    END                                                     AS "Trạng thái",
    TO_CHAR(al.first_scan_time, 'HH24:MI:SS')              AS "Giờ quét"
FROM student_classes sc
JOIN students s         ON s.id  = sc.student_id
JOIN classes c          ON c.id  = sc.class_id
LEFT JOIN class_sessions cs ON cs.class_id = c.id AND cs.date = :target_date
LEFT JOIN attendance_logs al
    ON al.student_id = s.id
    AND al.session_id = cs.id
WHERE s.status   = 'active'
  AND sc.status  = 'enrolled'
  AND c.class_code ILIKE :class_code
ORDER BY s.full_name
"""

# Báo cáo tổng hợp tất cả lớp trong ngày
DAILY_SUMMARY_REPORT_SQL = """
SELECT
    c.class_code                                                       AS class_code,
    c.name                                                             AS class_name,
    TO_CHAR(cs.date, 'DD/MM/YYYY')                                    AS date,
    TO_CHAR(cs.start_time, 'HH24:MI')                                 AS start_time,
    TO_CHAR(cs.end_time, 'HH24:MI')                                   AS end_time,
    sv.tong_sv                                                         AS tong_sv,
    COALESCE(att.so_on_time, 0)                                        AS on_time,
    COALESCE(att.so_muon, 0)                                           AS late,
    sv.tong_sv - COALESCE(att.so_diem_danh, 0)                        AS absent,
    ROUND(
        COALESCE(att.so_diem_danh, 0) * 100.0
        / NULLIF(sv.tong_sv, 0), 1
    )                                                                  AS rate
FROM classes c
JOIN class_sessions cs ON cs.class_id = c.id
JOIN (
    SELECT sc2.class_id, COUNT(DISTINCT sc2.student_id) AS tong_sv
    FROM student_classes sc2
    JOIN students s2 ON s2.id = sc2.student_id
    WHERE sc2.status = 'enrolled' AND s2.status = 'active'
    GROUP BY sc2.class_id
) sv ON sv.class_id = c.id
LEFT JOIN (
    SELECT
        cs2.class_id,
        COUNT(DISTINCT al2.student_id)                                              AS so_diem_danh,
        COUNT(DISTINCT CASE WHEN al2.status = 'on_time' THEN al2.student_id END)   AS so_on_time,
        COUNT(DISTINCT CASE WHEN al2.status = 'late'    THEN al2.student_id END)   AS so_muon
    FROM attendance_logs al2
    JOIN class_sessions cs2 ON cs2.id = al2.session_id
    WHERE cs2.status != 'cancelled'
      AND {date_filter_att}
    GROUP BY cs2.class_id
) att ON att.class_id = c.id
WHERE cs.status != 'cancelled'
  AND {date_filter_cs}
ORDER BY cs.date, cs.start_time, c.class_code
"""

# Danh sách SV vắng trong ngày (tất cả lớp)
DAILY_ABSENT_SQL = """
SELECT DISTINCT
    s.student_code     AS student_code,
    s.full_name        AS full_name,
    c.class_code       AS class_code,
    c.name             AS class_name,
    cs.date            AS date
FROM student_classes sc
JOIN students s         ON s.id  = sc.student_id
JOIN classes c          ON c.id  = sc.class_id
JOIN class_sessions cs  ON cs.class_id = c.id
LEFT JOIN attendance_logs al
    ON al.student_id = s.id
    AND al.session_id = cs.id
WHERE s.status   = 'active'
  AND sc.status  = 'enrolled'
  AND cs.status != 'cancelled'
  AND {date_filter}
  AND al.id IS NULL
ORDER BY c.class_code, s.full_name
LIMIT 200
"""

# Danh sách SV đi muộn trong ngày (tất cả lớp)
DAILY_LATE_SQL = """
SELECT
    s.student_code                                 AS student_code,
    s.full_name                                    AS full_name,
    c.class_code                                   AS class_code,
    c.name                                         AS class_name,
    cs.date                                        AS date,
    TO_CHAR(al.first_scan_time, 'HH24:MI:SS')     AS scan_time
FROM attendance_logs al
JOIN students s         ON s.id  = al.student_id
JOIN class_sessions cs  ON cs.id = al.session_id
JOIN classes c          ON c.id  = cs.class_id
WHERE al.status  = 'late'
  AND cs.status != 'cancelled'
  AND {date_filter}
ORDER BY c.class_code, s.full_name
LIMIT 200
"""


class AIService:
    def __init__(self):
        self.gemini_api_key = settings.gemini_api_key
        if not self.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required in environment variables")

        self.llm = ChatGoogleGenerativeAI(
            model="gemini-3.1-flash-lite-preview",
            google_api_key=self.gemini_api_key,
            temperature=0.0,
            convert_system_message_to_human=True,
        )
        self._setup_templates()

    def _get_dynamic_schema(self) -> str:
        try:
            engine = _get_sync_engine()
            inspector = inspect(engine)
            schema_parts = []
            for table_name in inspector.get_table_names():
                if table_name.startswith("pg_") or table_name in ["alembic_version"]:
                    continue
                columns = inspector.get_columns(table_name)
                col_defs = [f"{col['name']} ({col['type']})" for col in columns]
                schema_parts.append(f"- {table_name} ({', '.join(col_defs)})")
            return "\n".join(schema_parts)
        except Exception as e:
            print(f"[WARNING] Không thể inspect database: {e}")
            return (
                "- students (id UUID, student_code VARCHAR, full_name VARCHAR, status VARCHAR)\n"
                "- classes (id INTEGER, class_code VARCHAR, name VARCHAR, status VARCHAR)\n"
                "- class_sessions (id INTEGER, class_id INTEGER, date DATE, start_time TIME, end_time TIME, late_threshold_minutes INTEGER, status VARCHAR)\n"
                "- attendance_logs (id INTEGER, student_id UUID, session_id INTEGER, status VARCHAR, first_scan_time TIMESTAMP, last_scan_time TIMESTAMP, source VARCHAR)\n"
                "- student_classes (id INTEGER, student_id UUID, class_id INTEGER, status VARCHAR, enrolled_at TIMESTAMP)\n"
                "- rfid_cards (id INTEGER, student_id UUID, card_uid VARCHAR, status VARCHAR)"
            )

    def _setup_templates(self):
        self.sql_prompt = PromptTemplate(
            input_variables=["schema", "question"],
            template=SQL_PROMPT_TEMPLATE,
        )
        self.answer_prompt = PromptTemplate(
            input_variables=["question", "data_str"],
            template=ANSWER_PROMPT_TEMPLATE,
        )
        self.report_extract_prompt = PromptTemplate(
            input_variables=["question"],
            template=REPORT_EXTRACT_PROMPT,
        )

    # ─── Nhận diện câu hỏi báo cáo ───────────────────────────────────────────
    def _is_report_request(self, question: str) -> bool:
        """Kiểm tra xem câu hỏi có phải yêu cầu báo cáo không."""
        keywords = [
            "báo cáo", "bao cao", "report",
            "thống kê", "thong ke",
            "xuất báo cáo", "xuat bao cao", "xuất file", "xuat file",
        ]
        q_lower = question.lower()
        return any(kw in q_lower for kw in keywords)

    async def _extract_report_params(self, question: str) -> Dict[str, Any]:
        """Dùng AI để trích xuất tham số báo cáo từ câu hỏi."""
        try:
            prompt_value = self.report_extract_prompt.invoke({"question": question})
            response = await self.llm.ainvoke(prompt_value)
            content = _extract_text_from_content(response.content).strip()
            # Làm sạch markdown nếu có
            content = re.sub(r"^```json\s*", "", content, flags=re.IGNORECASE)
            content = re.sub(r"^```\s*", "", content)
            content = re.sub(r"\s*```$", "", content)
            return json.loads(content.strip())
        except Exception as e:
            print(f"[WARNING] Không thể trích xuất report params: {e}")
            return {
                "report_type": "daily",
                "class_code": None,
                "class_name": None,
                "date_filter": "today",
            }

    def _build_date_sql(self, date_filter: str, alias: str = "cs") -> str:
        """Tạo điều kiện WHERE cho ngày từ date_filter string."""
        if date_filter == "today" or not date_filter:
            return f"{alias}.date = CURRENT_DATE"
        elif date_filter == "yesterday":
            return f"{alias}.date = CURRENT_DATE - INTERVAL '1 day'"
        elif date_filter == "this_week":
            return (
                f"{alias}.date >= date_trunc('week', CURRENT_DATE + INTERVAL '1 day') - INTERVAL '1 day' "
                f"AND {alias}.date < date_trunc('week', CURRENT_DATE + INTERVAL '1 day') + INTERVAL '6 days'"
            )
        elif date_filter == "this_month":
            return f"date_trunc('month', {alias}.date) = date_trunc('month', CURRENT_DATE)"
        elif re.match(r"\d{4}-\d{2}-\d{2}", date_filter):
            return f"{alias}.date = '{date_filter}'::DATE"
        return f"{alias}.date = CURRENT_DATE"

    @staticmethod
    def _rows_to_dicts(result) -> List[Dict]:
        rows = result.fetchall()
        columns = list(result.keys())
        return [dict(zip(columns, row)) for row in rows]

    @staticmethod
    def _json_serializer(obj):
        import uuid
        from datetime import datetime, date, time
        from decimal import Decimal
        if isinstance(obj, (datetime, date, time)):
            return obj.isoformat()
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, Decimal):
            return float(obj)
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

    # ─── TẠO BÁO CÁO LỚP CỤ THỂ ─────────────────────────────────────────────
    from .report_builder import build_class_report_xlsx
    from .report_builder import build_daily_report_xlsx
    # ─── Chat thông thường ────────────────────────────────────────────────────
    def _clean_sql_output(self, raw_output) -> str:
        cleaned = _extract_text_from_content(raw_output).strip()
        cleaned = re.sub(r"^```sql\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"^```\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        return cleaned.strip()

    def _validate_sql(self, sql: str) -> tuple[bool, str]:
        upper = sql.upper().strip()
        sql_clean = re.sub(r'--.*$', '', sql, flags=re.MULTILINE)
        sql_clean = re.sub(r'/\*.*?\*/', '', sql_clean, flags=re.DOTALL).strip()

        if not (upper.startswith("SELECT") or upper.startswith("(SELECT")):
            return False, "Câu lệnh không bắt đầu bằng SELECT."

        statements = [s.strip() for s in re.split(r';\s*', sql_clean) if s.strip()]
        if len(statements) > 1:
            return False, "Phát hiện nhiều câu lệnh SQL (multi-statement)."

        dangerous = ["DROP", "DELETE", "UPDATE", "INSERT", "TRUNCATE", "ALTER", "CREATE", "EXEC", "EXECUTE"]
        sql_no_strings = re.sub(r"'[^']*'", "''", upper)
        for kw in dangerous:
            if re.search(rf'\b{kw}\b', sql_no_strings):
                return False, f"Từ khoá nguy hiểm: {kw}"
        return True, ""

    async def chat_query(self, question: str) -> Dict[str, Any]:
        """
        Entry point chính. Tự động chọn:
        - Chế độ báo cáo (report) → bảng đầy đủ
        - Chế độ chat thường → trả lời tự nhiên
        """
        try:
            # ── Nếu là yêu cầu báo cáo ──
            if self._is_report_request(question):
                print(f"[DEBUG] Detected report request: {question}")
                params = await self._extract_report_params(question)
                print(f"[DEBUG] Report params: {params}")

                report_type = params.get("report_type", "daily")

                if report_type == "class":
                    return await self._generate_class_report(params)
                else:
                    # "daily" hoặc "unknown" đều dùng daily report
                    return await self._generate_daily_report(params)

            # ── Chat thông thường ──
            prompt_value = self.sql_prompt.invoke({
                "schema": self._get_dynamic_schema(),
                "question": question,
            })
            response = await self.llm.ainvoke(prompt_value)
            content = _extract_text_from_content(response.content)
            sql_query = self._clean_sql_output(content)
            print(f"[DEBUG] Generated SQL: {sql_query}")

            is_valid, err_msg = self._validate_sql(sql_query)
            if not is_valid:
                return {
                    "success": False,
                    "error": err_msg,
                    "answer": f"Xin lỗi, câu lệnh SQL không hợp lệ: {err_msg}",
                }

            async with AsyncSessionLocal() as session:
                result = await session.execute(text(sql_query))
                rows = result.fetchall()
                columns = list(result.keys())
                data = [dict(zip(columns, row)) for row in rows]

            answer = await self._generate_natural_answer(question, data)

            return {
                "success": True,
                "question": question,
                "sql": sql_query,
                "data": data,
                "answer": answer,
                "count": len(data),
            }

        except Exception as e:
            print(f"[ERROR] AI Service chat_query: {e}")
            return {
                "success": False,
                "error": str(e),
                "answer": "Đã có lỗi xảy ra. Vui lòng thử cách hỏi khác.",
            }

    async def _generate_natural_answer(self, question: str, data: List[Dict]) -> str:
        note = ""
        if not data:
            data_str = "[]"
        else:
            if len(data) > 20:
                data = data[:20]
                note = " *(Chỉ hiển thị 20 kết quả đầu tiên)*"
            data_str = json.dumps(data, ensure_ascii=False, indent=2, default=self._json_serializer)

        prompt_value = self.answer_prompt.invoke({
            "question": question,
            "data_str": data_str,
        })
        response = await self.llm.ainvoke(prompt_value)
        content = _extract_text_from_content(response.content)
        return content.strip() + note

    # ─── TẠO BÁO CÁO LỚP CỤ THỂ ─────────────────────────────────────────────
    async def _generate_class_report(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from .report_builder import build_class_report_xlsx
        try:
            class_code = params.get("class_code")
            date_filter = params.get("date_filter") or "today"
            
            # Xử lý date filter
            if date_filter == "today":
                target_date = datetime.now().date()
            elif date_filter == "yesterday":
                target_date = (datetime.now() - timedelta(days=1)).date()
            else:
                try:
                    target_date = datetime.strptime(date_filter, "%Y-%m-%d").date()
                except:
                    target_date = datetime.now().date()
            
            # Lấy thông tin session (thử tìm session hôm nay, nếu không có thì lấy session gần nhất)
            async with AsyncSessionLocal() as session:
                # Thử tìm session hôm nay trước
                session_query = text("""
                    SELECT cs.id, cs.date, cs.start_time, cs.end_time, 
                           c.class_code, c.name as class_name
                    FROM class_sessions cs
                    JOIN classes c ON c.id = cs.class_id
                    WHERE c.class_code ILIKE :class_code 
                      AND cs.date = :target_date
                      AND cs.status != 'cancelled'
                    ORDER BY cs.start_time
                """)
                
                result = await session.execute(session_query, {
                    "class_code": f"%{class_code}%" if class_code else "%",
                    "target_date": target_date
                })
                session_info = result.fetchone()
                
                # Nếu không có session hôm nay, lấy session gần nhất
                if not session_info:
                    fallback_query = text("""
                        SELECT cs.id, cs.date, cs.start_time, cs.end_time, 
                               c.class_code, c.name as class_name
                        FROM class_sessions cs
                        JOIN classes c ON c.id = cs.class_id
                        WHERE c.class_code ILIKE :class_code 
                          AND cs.status != 'cancelled'
                        ORDER BY cs.date DESC, cs.start_time DESC
                        LIMIT 1
                    """)
                    
                    fallback_result = await session.execute(fallback_query, {
                        "class_code": f"%{class_code}%" if class_code else "%"
                    })
                    session_info = fallback_result.fetchone()
                    
                    if session_info:
                        print(f"[DEBUG] Using fallback session: {session_info.date}")
                
                if not session_info:
                    return {
                        "success": False,
                        "error": f"Không tìm thấy buổi học nào của lớp {class_code}",
                        "answer": f"Không tìm thấy buổi học nào của lớp {class_code}"
                    }
                
                # Lấy chi tiết điểm danh - dùng ngày của session thực tế
                actual_session_date = session_info.date
                detail_query = text(CLASS_DETAIL_REPORT_SQL)
                detail_result = await session.execute(detail_query, {
                    "class_code": f"%{class_code}%" if class_code else "%",
                    "target_date": actual_session_date
                })
                detail_rows = [dict(zip(detail_result.keys(), row)) for row in detail_result.fetchall()]
            
            # Tạo file Excel
            session_dict = dict(zip(result.keys(), session_info))
            file_path = build_class_report_xlsx(session_dict, detail_rows)
            
            # Kiểm tra file_path
            if isinstance(file_path, tuple):
                file_path = file_path[0]  # Lấy phần tử đầu tiên nếu là tuple
            
            # Trả về đường dẫn file
            filename = os.path.basename(file_path)
            actual_date_str = str(session_info.date)
            return {
                "success": True,
                "report_type": "class",
                "class_code": class_code,
                "date": actual_date_str,
                "file_url": f"/static/reports/{filename}",
                "filename": filename,
                "answer": f"Đã tạo báo cáo lớp {class_code} ngày {actual_date_str}. File: {filename}"
            }
            
        except Exception as e:
            print(f"[ERROR] _generate_class_report: {e}")
            return {
                "success": False,
                "error": str(e),
                "answer": f"Lỗi khi tạo báo cáo lớp: {str(e)}"
            }

    # ─── TẠO BÁO CÁO CẢ NGÀY ─────────────────────────────────────────────────
    async def _generate_daily_report(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from .report_builder import build_daily_report_xlsx
        try:
            date_filter = params.get("date_filter", "today")
            
            # Xử lý date filter
            if date_filter == "today":
                target_date = datetime.now().date()
                date_label = target_date.strftime("%d/%m/%Y")
            elif date_filter == "yesterday":
                target_date = (datetime.now() - timedelta(days=1)).date()
                date_label = target_date.strftime("%d/%m/%Y")
            elif date_filter == "this_week":
                # Lấy ngày đầu tuần (Thứ Hai)
                today = datetime.now().date()
                days_since_monday = today.weekday()
                target_date = today - timedelta(days=days_since_monday)
                date_label = f"Tuần {target_date.isocalendar()[1]} ({target_date.strftime('%d/%m')} - {(target_date + timedelta(days=6)).strftime('%d/%m')})"
            elif date_filter == "this_month":
                target_date = datetime.now().date().replace(day=1)
                date_label = target_date.strftime("Tháng %m/%Y")
            else:
                try:
                    target_date = datetime.strptime(date_filter, "%Y-%m-%d").date()
                    date_label = target_date.strftime("%d/%m/%Y")
                except:
                    target_date = datetime.now().date()
                    date_label = target_date.strftime("%d/%m/%Y")
            
            async with AsyncSessionLocal() as session:
                
                # Lấy dữ liệu tổng hợp
                if date_filter == "this_week":
                    # Tuần này
                    start_date = target_date
                    end_date = target_date + timedelta(days=6)
                    summary_sql = DAILY_SUMMARY_REPORT_SQL.replace("{date_filter_att}", "cs2.date >= :start_date AND cs2.date <= :end_date").replace("{date_filter_cs}", "cs.date >= :start_date AND cs.date <= :end_date")
                    summary_query = text(summary_sql)
                    summary_result = await session.execute(summary_query, {
                        "start_date": start_date,
                        "end_date": end_date
                    })
                elif date_filter == "this_month":
                    # Tháng này
                    start_date = target_date
                    if target_date.month == 12:
                        end_date = target_date.replace(year=target_date.year + 1, month=1, day=1) - timedelta(days=1)
                    else:
                        end_date = target_date.replace(month=target_date.month + 1, day=1) - timedelta(days=1)
                    summary_sql = DAILY_SUMMARY_REPORT_SQL.replace("{date_filter_att}", "cs2.date >= :start_date AND cs2.date <= :end_date").replace("{date_filter_cs}", "cs.date >= :start_date AND cs.date <= :end_date")
                    summary_query = text(summary_sql)
                    summary_result = await session.execute(summary_query, {
                        "start_date": start_date,
                        "end_date": end_date
                    })
                else:
                    # Ngày cụ thể
                    summary_sql = DAILY_SUMMARY_REPORT_SQL.replace("{date_filter_att}", "cs2.date = :target_date").replace("{date_filter_cs}", "cs.date = :target_date")
                    summary_query = text(summary_sql)
                    summary_result = await session.execute(summary_query, {"target_date": target_date})
                
                summary_rows = [dict(zip(summary_result.keys(), row)) for row in summary_result.fetchall()]
                
                # Lấy danh sách đi trễ
                if date_filter in ["this_week", "this_month"]:
                    late_sql = DAILY_LATE_SQL.replace("{date_filter}", "cs.date >= :start_date AND cs.date <= :end_date")
                    late_query = text(late_sql)
                    late_result = await session.execute(late_query, {
                        "start_date": start_date if date_filter in ["this_week", "this_month"] else target_date,
                        "end_date": end_date if date_filter in ["this_week", "this_month"] else target_date
                    })
                else:
                    late_sql = DAILY_LATE_SQL.replace("{date_filter}", "cs.date = :target_date")
                    late_query = text(late_sql)
                    late_result = await session.execute(late_query, {"target_date": target_date})
                
                late_rows = [dict(zip(late_result.keys(), row)) for row in late_result.fetchall()]
                
                # Lấy danh sách vắng
                if date_filter in ["this_week", "this_month"]:
                    absent_sql = DAILY_ABSENT_SQL.replace("{date_filter}", "cs.date >= :start_date AND cs.date <= :end_date")
                    absent_query = text(absent_sql)
                    absent_result = await session.execute(absent_query, {
                        "start_date": start_date if date_filter in ["this_week", "this_month"] else target_date,
                        "end_date": end_date if date_filter in ["this_week", "this_month"] else target_date
                    })
                else:
                    absent_sql = DAILY_ABSENT_SQL.replace("{date_filter}", "cs.date = :target_date")
                    absent_query = text(absent_sql)
                    absent_result = await session.execute(absent_query, {"target_date": target_date})
                
                absent_rows = [dict(zip(absent_result.keys(), row)) for row in absent_result.fetchall()]
            
            # Tạo file Excel
            file_path = build_daily_report_xlsx(date_label, summary_rows, late_rows, absent_rows)
            
            # Kiểm tra file_path
            if isinstance(file_path, tuple):
                file_path = file_path[0]  # Lấy phần tử đầu tiên nếu là tuple
            
            # Trả về đường dẫn file
            filename = os.path.basename(file_path)
            return {
                "success": True,
                "report_type": "daily",
                "date_filter": date_filter,
                "date_label": date_label,
                "file_url": f"/static/reports/{filename}",
                "filename": filename,
                "answer": f"Đã tạo báo cáo {date_label}. File: {filename}"
            }
            
        except Exception as e:
            print(f"[ERROR] _generate_daily_report: {e}")
            return {
                "success": False,
                "error": str(e),
                "answer": f"Lỗi khi tạo báo cáo ngày: {str(e)}"
            }


# Global instance
ai_service = AIService()
# Hệ thống Điểm danh Sinh viên Real-time (ESP32 RFID + FastAPI + React + PostgreSQL)

Dự án full-stack hiển thị dữ liệu điểm danh từ thiết bị ESP32 quét thẻ RFID gửi lên, và tính **tổng thời gian ở trong lớp** theo các lần quét **`VÀO`**/**`RA`**.

## 1) Cấu trúc thư mục

```
RFID_diemdanh/
  backend/
  frontend/
```

---

## 2) Backend (FastAPI + SQLAlchemy Async)

### Yêu cầu

- Python 3.10+
- PostgreSQL 13+

### Tạo database

Ví dụ tạo DB tên `rfid_attendance`:

```sql
CREATE DATABASE rfid_attendance;
```

### Cấu hình biến môi trường

Tạo file `backend/.env`:

```env
DATABASE_URL=postgresql+psycopg://postgres:your_password@localhost:5432/rfid_attendance
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### Cài dependencies

```bash
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

### Khởi tạo bảng

Backend có script tạo bảng bằng SQLAlchemy:

```bash
python backend/scripts/init_db.py
```

### Chạy API

```bash
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

API base: `http://localhost:8000`

---

## 3) Frontend (React + Tailwind)

### Yêu cầu

- Node.js 18+

### Cài và chạy

```bash
cd frontend
npm install
npm run dev
```

Mặc định: `http://localhost:5173`

Frontend gọi backend tại `http://localhost:8000` (cấu hình trong `frontend/.env`).

Tạo `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

---

## 4) API chính

- `POST /api/logs`
  - ESP32 gửi `{ uid_code, status }` (status chỉ nhận `VÀO` hoặc `RA`)
  - Lưu raw vào bảng `attendance_logs`

- `GET /api/students`
  - Danh sách sinh viên

- `POST /api/students`
  - Tạo sinh viên nhanh để gán `uid_code` (mã thẻ RFID)
  - Body:

```json
{
  "uid_code": "04A1B2C3D4",
  "student_code": "SV001",
  "full_name": "Nguyễn Văn A"
}
```

- `PUT /api/students/{uid_code}`
  - Cập nhật thông tin sinh viên (không đổi `uid_code`)

```json
{
  "student_code": "SV001",
  "full_name": "Nguyễn Văn A (Updated)"
}
```

- `DELETE /api/students/{uid_code}`
  - Xóa sinh viên theo `uid_code`

- `GET /api/attendance/summary?date=YYYY-MM-DD` (tùy chọn)
  - Trả về danh sách:

```json
[
  {
    "student_code": "SV001",
    "full_name": "Nguyễn Văn A",
    "last_status": "VÀO",
    "last_timestamp": "2026-03-06T20:00:00+07:00",
    "total_time_today_minutes": 135,
    "in_class": true,
    "warning": "Missing checkout (RA)"
  }
]
```

---

## 5) Ghi chú logic tính thời gian

- Logs được sắp theo thời gian tăng dần cho từng sinh viên.
- Ghép cặp `VÀO -> RA` liên tiếp.
- Nếu cuối ngày đang ở trạng thái `VÀO` (quên quét `RA`):
  - `in_class=true`
  - mặc định vẫn cộng thêm thời lượng từ lần `VÀO` cuối đến thời điểm hiện tại, và kèm `warning`.

---

## 6) Seed dữ liệu (tùy chọn)

Bạn có thể thêm sinh viên bằng:

- Dùng tab **"Sinh viên"** trên Dashboard (frontend)
- Hoặc gọi API `POST /api/students`
- Hoặc insert trực tiếp vào bảng `students`

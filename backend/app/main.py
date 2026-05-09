from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional

import asyncio
import sys
import uuid

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import and_, func, select, update, or_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import (
    DEFAULT_PASSWORD,
    create_access_token,
    get_current_active_user,
    get_current_user,
    get_current_user_websocket,
    hash_password,
    require_admin,
    require_roles,
    require_teacher_or_admin,
    verify_password,
)
from .db import engine, get_db_session, get_db_session_context
from .models import (
    AttendanceLog,
    AttendanceAppeal,
    AttendanceStatusEnum,
    Base,
    ClassModel,
    ClassSession,
    ClassTeacherAssignment,
    Notification,
    RFIDCard,
    Student,
    StudentClass,
    SystemAuditLog,
    User,
)
from .schemas import (
    AttendanceLogRowOut,
    AttendanceAppealCreate,
    AttendanceAppealOut,
    AttendanceAppealUpdate,
    AttendanceScanIn,
    AttendanceScanResultOut,
    ClassTeacherAssignIn,
    ClassCreate,
    ClassOut,
    ClassUpdate,
    DashboardTodayOut,
    LoginRequest,
    LoginResponse,
    NotificationOut,
    RealtimeAttendanceEvent,
    RFIDCardCreate,
    RFIDCardOut,
    SessionCreate,
    SessionOut,
    SessionUpdate,
    StudentClassAssignIn,
    StudentCreate,
    StudentOut,
    StudentShortOut,
    StudentUpdate,
    StudentTodaySessionOut,
    SystemAuditLogOut,
    UserCreate,
    UserOut,
    UserUpdate,
)
from .settings import settings
from .ai.router import router as ai_router

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


app = FastAPI(title="RFID Attendance")

cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files for reports
import os
from pathlib import Path
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.on_event("startup")
async def on_startup() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# -----------------------------
# WebSocket connection manager
# -----------------------------


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict) -> None:
        payload = jsonable_encoder(message)
        for connection in list(self.active_connections):
            try:
                await connection.send_json(payload)
            except RuntimeError:
                self.disconnect(connection)


ws_manager = ConnectionManager()


@app.websocket("/ws/attendance")
async def websocket_attendance(websocket: WebSocket) -> None:
    await ws_manager.connect(websocket)
    try:
        while True:
            # Client có thể gửi ping/pong hoặc ignore; ở đây chỉ giữ kết nối.
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


@app.websocket("/ws/student-countdown")
async def websocket_student_countdown(websocket: WebSocket, current_user: Optional[User] = Depends(get_current_user_websocket)) -> None:
    """Real-time countdown updates for student sessions"""
    if not current_user or current_user.role != "student":
        await websocket.close(code=1003, reason="Only students allowed")
        return
    
    await ws_manager.connect(websocket)
    try:
        while True:
            # Get current student's schedule with real-time countdown
            async with get_db_session_context() as db:
                student = await db.scalar(
                    select(Student).where(Student.student_code == current_user.username)
                )
                
                if not student:
                    await websocket.send_json({"error": "Student not found"})
                    break
                
                # Get today's sessions
                today = datetime.now(timezone.utc).date()
                result = await db.execute(
                    select(
                        ClassModel.class_code,
                        ClassModel.name,
                        ClassSession.date,
                        ClassSession.start_time,
                        ClassSession.end_time,
                        ClassSession.status
                    )
                    .join(ClassSession, ClassModel.id == ClassSession.class_id)
                    .join(StudentClass, ClassModel.id == StudentClass.class_id)
                    .where(
                        and_(
                            StudentClass.student_id == student.id,
                            ClassSession.date == today
                        )
                    )
                    .order_by(ClassSession.start_time)
                )
                
                countdown_data = []
                now = datetime.now(timezone.utc)
                
                for row in result:
                    class_code, class_name, session_date, start_time, end_time, status = row
                    
                    # Calculate real-time countdown
                    if isinstance(start_time, str):
                        start_time_obj = datetime.strptime(start_time, "%H:%M:%S").time()
                    else:
                        start_time_obj = start_time
                    
                    session_datetime = datetime.combine(session_date, start_time_obj).replace(tzinfo=timezone.utc)
                    
                    if session_datetime > now:
                        time_diff = session_datetime - now
                        hours = int(time_diff.total_seconds() // 3600)
                        minutes = int((time_diff.total_seconds() % 3600) // 60)
                        seconds = int(time_diff.total_seconds() % 60)
                        countdown = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                        session_status = "upcoming"
                    elif session_datetime + timedelta(minutes=10) > now:
                        countdown = "10:00"
                        session_status = "ongoing"
                    else:
                        countdown = "Đã bắt đầu"
                        session_status = "ended"
                    
                    countdown_data.append({
                        "class_code": class_code,
                        "class_name": class_name,
                        "start_time": str(start_time),
                        "countdown": countdown,
                        "status": session_status,
                        "timestamp": now.isoformat()
                    })
                
                await websocket.send_json({
                    "type": "countdown_update",
                    "data": countdown_data
                })
                
                # Wait 1 second before next update
                await asyncio.sleep(1)
                
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        await websocket.send_json({"error": str(e)})
        ws_manager.disconnect(websocket)


async def _write_audit_log(
    db: AsyncSession,
    action: str,
    actor_user_id: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    details: Optional[str] = None,
) -> None:
    parsed_actor_id = None
    if actor_user_id:
        import uuid
        try:
            parsed_actor_id = uuid.UUID(actor_user_id)
        except ValueError:
            parsed_actor_id = None

    db.add(
        SystemAuditLog(
            actor_user_id=parsed_actor_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details,
        )
    )


# -----------------------------
# Helper functions
# -----------------------------


def _combine_session_datetime(
    session: ClassSession,
    tz: timezone = timezone.utc,
) -> tuple[datetime, datetime]:
    start_dt = datetime.combine(session.date, session.start_time).replace(tzinfo=tz)
    end_dt = datetime.combine(session.date, session.end_time).replace(tzinfo=tz)
    return start_dt, end_dt


async def _find_active_session_for_student(
    db: AsyncSession,
    student: Student,
    now_ts: datetime,
) -> Optional[tuple[ClassSession, ClassModel]]:
    today = now_ts.date()
    current_time = now_ts.time()

    stmt = (
        select(ClassSession, ClassModel)
        .join(ClassModel, ClassSession.class_id == ClassModel.id)
        .join(StudentClass, StudentClass.class_id == ClassSession.class_id)
        .where(StudentClass.student_id == student.id)
        .where(StudentClass.status == "enrolled")
        .where(ClassSession.date == today)
        .where(
            and_(
                ClassSession.start_time <= current_time,
                ClassSession.end_time >= current_time,
            )
        )
        .where(ClassSession.status.in_(["scheduled", "ongoing"]))
    )

    row = await db.execute(stmt)
    result = row.first()
    if result is None:
        return None
    session, class_ = result
    return session, class_


def _compute_attendance_status(
    session: ClassSession,
    first_scan_time: datetime,
    tz: timezone = timezone.utc,
) -> AttendanceStatusEnum:
    start_dt, end_dt = _combine_session_datetime(session, tz=tz)
    late_threshold = start_dt + timedelta(minutes=session.late_threshold_minutes)

    if first_scan_time <= late_threshold:
        return AttendanceStatusEnum.ON_TIME
    if first_scan_time <= end_dt:
        return AttendanceStatusEnum.LATE
    return AttendanceStatusEnum.ABSENT


# -----------------------------
# Students CRUD
# -----------------------------


@app.get("/api/students", response_model=List[StudentOut])
async def list_students(
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> List[StudentOut]:
    rows = (await db.execute(select(Student))).scalars().all()
    return [
        StudentOut(
            id=str(s.id),
            uid_code=s.uid_code,
            student_code=s.student_code,
            full_name=s.full_name,
            email=s.email,
            phone=s.phone,
            status=s.status,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in rows
    ]


@app.post("/api/students", response_model=StudentOut)
async def create_student(
    payload: StudentCreate,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> StudentOut:
    existing_uid = await db.scalar(select(Student).where(Student.uid_code == payload.uid_code))
    if existing_uid is not None:
        raise HTTPException(status_code=409, detail="uid_code already exists")

    existing_code = await db.scalar(select(Student).where(Student.student_code == payload.student_code))
    if existing_code is not None:
        raise HTTPException(status_code=409, detail="student_code already exists")

    student = Student(
        uid_code=payload.uid_code,
        student_code=payload.student_code,
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        status=payload.status or "active",
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)

    return StudentOut(
        id=str(student.id),
        uid_code=student.uid_code,
        student_code=student.student_code,
        full_name=student.full_name,
        email=student.email,
        phone=student.phone,
        status=student.status,
        created_at=student.created_at,
        updated_at=student.updated_at,
    )


# -----------------------------
# Student Profile Endpoints
# -----------------------------

@app.get("/api/students/profile", response_model=dict)
async def get_student_profile(
    current_user: User = Depends(get_current_active_user)
):
    """Get current student's profile information"""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can access this endpoint")
    
    async with get_db_session_context() as db:
        # Get student info linked to this user
        student = await db.scalar(
            select(Student).where(Student.student_code == current_user.username)
        )
        
        if not student:
            raise HTTPException(status_code=404, detail="Student profile not found")
        
        return {
            "student_code": student.student_code,
            "full_name": student.full_name,
            "email": getattr(student, 'email', None),
            "phone": getattr(student, 'phone', None),
            "birth_date": getattr(student, 'birth_date', None),
            "department": getattr(student, 'department', None),
            "class_name": getattr(student, 'class_name', None)
        }

@app.put("/api/students/profile", response_model=dict)
async def update_student_profile(
    profile_data: dict,
    current_user: User = Depends(get_current_active_user)
):
    """Update current student's profile information"""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can access this endpoint")
    
    async with get_db_session_context() as db:
        # Get student info linked to this user
        student = await db.scalar(
            select(Student).where(Student.student_code == current_user.username)
        )
        
        if not student:
            raise HTTPException(status_code=404, detail="Student profile not found")
        
        # Update student fields (add new fields if they don't exist)
        if "full_name" in profile_data:
            student.full_name = profile_data["full_name"]
        if "email" in profile_data:
            student.email = profile_data["email"]
        if "phone" in profile_data:
            student.phone = profile_data["phone"]
        if "birth_date" in profile_data:
            student.birth_date = profile_data["birth_date"]
        if "department" in profile_data:
            student.department = profile_data["department"]
        if "class_name" in profile_data:
            student.class_name = profile_data["class_name"]
        
        student.updated_at = datetime.now(timezone.utc)
        await db.commit()
        
        return {"message": "Profile updated successfully"}

@app.post("/api/students/change-password", response_model=dict)
async def change_student_password(
    password_data: dict,
    current_user: User = Depends(get_current_active_user)
):
    """Change current student's password"""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can access this endpoint")
    
    current_password = password_data.get("current_password")
    new_password = password_data.get("new_password")
    
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="Current password and new password are required")
    
    async with get_db_session_context() as db:
        # Get user info
        user = await db.scalar(
            select(User).where(User.username == current_user.username)
        )
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Verify current password
        if not verify_password(current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        
        # Update password
        user.password_hash = hash_password(new_password)
        user.updated_at = datetime.now(timezone.utc)
        await db.commit()
        
        return {"message": "Password changed successfully"}

@app.get("/api/students/weekly-schedule", response_model=List[dict])
async def get_weekly_schedule(
    current_user: User = Depends(get_current_active_user)
):
    """Get weekly schedule for current student"""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can access this endpoint")
    
    async with get_db_session_context() as db:
        # Get student info
        student = await db.scalar(
            select(Student).where(Student.student_code == current_user.username)
        )
        
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        
        # Get current date and calculate week range
        now = datetime.now(timezone.utc)
        start_of_week = now - timedelta(days=now.weekday())
        end_of_week = start_of_week + timedelta(days=6)
        
        # Get student's classes and sessions for the week
        result = await db.execute(
            select(
                ClassModel.class_code,
                ClassModel.name,
                ClassSession.date,
                ClassSession.start_time,
                ClassSession.end_time,
                ClassSession.status
            )
            .join(ClassSession, ClassModel.id == ClassSession.class_id)
            .join(StudentClass, ClassModel.id == StudentClass.class_id)
            .where(
                and_(
                    StudentClass.student_id == student.id,
                    ClassSession.date >= start_of_week.date(),
                    ClassSession.date <= end_of_week.date()
                )
            )
            .order_by(ClassSession.date, ClassSession.start_time)
        )
        
        schedule_data = []
        for row in result:
            class_code, class_name, session_date, start_time, end_time, status = row
            
            # Calculate countdown
            if isinstance(start_time, str):
                start_time_obj = datetime.strptime(start_time, "%H:%M:%S").time()
            else:
                start_time_obj = start_time
            session_datetime = datetime.combine(session_date, start_time_obj).replace(tzinfo=timezone.utc)
            now_dt = now
            
            if session_datetime > now_dt:
                time_diff = session_datetime - now_dt
                hours = int(time_diff.total_seconds() // 3600)
                minutes = int((time_diff.total_seconds() % 3600) // 60)
                seconds = int(time_diff.total_seconds() % 60)
                countdown = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                session_status = "upcoming"
            elif session_datetime + timedelta(minutes=10) > now_dt:
                countdown = "10:00"
                session_status = "ongoing"
            else:
                countdown = "Đã bắt đầu"
                session_status = "ended"
            
            # Get day of week
            day_of_week = session_datetime.strftime("%A")
            
            schedule_data.append({
                "day_of_week": day_of_week,
                "class_code": class_code,
                "class_name": class_name,
                "date": str(session_date),
                "start_time": start_time,
                "end_time": end_time,
                "countdown": countdown,
                "status": session_status
            })
        
        return schedule_data

@app.get("/api/students/attendance-stats", response_model=dict)
async def get_attendance_stats(
    current_user: User = Depends(get_current_active_user)
):
    """Get attendance statistics for current student"""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Only students can access this endpoint")
    
    async with get_db_session_context() as db:
        # Get student info
        student = await db.scalar(
            select(Student).where(Student.student_code == current_user.username)
        )
        
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        
        # Get attendance for the past week
        now = datetime.now(timezone.utc)
        start_of_week = now - timedelta(days=now.weekday())
        
        result = await db.execute(
            select(
                AttendanceLog.status,
                AttendanceLog.first_scan_time,
                ClassModel.class_code,
                ClassModel.name,
                ClassSession.date,
                ClassSession.start_time
            )
            .join(ClassSession, ClassSession.class_id == ClassModel.id)
            .join(StudentClass, ClassModel.id == StudentClass.class_id)
            .outerjoin(AttendanceLog, and_(
                AttendanceLog.session_id == ClassSession.id,
                AttendanceLog.student_id == student.id
            ))
            .where(
                and_(
                    StudentClass.student_id == student.id,
                    ClassSession.date >= start_of_week.date()
                )
            )
            .order_by(ClassSession.date.desc(), ClassSession.start_time.desc())
        )
        
        # Calculate statistics
        on_time_count = 0
        late_count = 0
        absent_count = 0
        weekly_attendance = []
        
        for row in result:
            status, scan_time, class_code, class_name, session_date, start_time = row
            
            # Handle NULL values from outer join
            if status is None:
                # No attendance record - check if session hasn't started yet
                if isinstance(start_time, str):
                    start_time_obj = datetime.strptime(start_time, "%H:%M:%S").time()
                else:
                    start_time_obj = start_time
                
                session_datetime = datetime.combine(session_date, start_time_obj).replace(tzinfo=timezone.utc)
                
                if session_datetime > now:
                    # Session hasn't started yet
                    attendance_status = "not_started"
                    scan_time_str = None
                else:
                    # Session has passed and no attendance - mark as absent
                    absent_count += 1
                    attendance_status = "absent"
                    scan_time_str = None
            else:
                if status == AttendanceStatusEnum.ON_TIME:
                    on_time_count += 1
                elif status == AttendanceStatusEnum.LATE:
                    late_count += 1
                else:
                    absent_count += 1
                attendance_status = status.value if hasattr(status, 'value') else str(status)
                scan_time_str = str(scan_time) if scan_time else None
            
            weekly_attendance.append({
                "date": str(session_date),
                "class_code": class_code,
                "class_name": class_name,
                "status": attendance_status,
                "scan_time": scan_time_str
            })
        
        total_sessions = on_time_count + late_count + absent_count
        attendance_percentage = (on_time_count / total_sessions * 100) if total_sessions > 0 else 0
        
        return {
            "attendance_percentage": round(attendance_percentage, 1),
            "on_time_count": on_time_count,
            "late_count": late_count,
            "absent_count": absent_count,
            "weekly_attendance": weekly_attendance
        }


@app.get("/api/teachers/weekly-schedule", response_model=List[dict])
async def get_teacher_weekly_schedule(
    current_user: User = Depends(get_current_active_user)
):
    """Get weekly schedule for current teacher"""
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="Only teachers can access this endpoint")
    
    async with get_db_session_context() as db:
        # Get classes assigned to this teacher
        teacher_classes = (
            await db.execute(
                select(ClassTeacherAssignment.class_id)
                .where(ClassTeacherAssignment.teacher_user_id == current_user.id)
            )
        ).scalars().all()
        
        if not teacher_classes:
            return []
        
        # Get all sessions for these classes
        sessions = (
            await db.execute(
                select(ClassSession, ClassModel)
                .join(ClassModel, ClassSession.class_id == ClassModel.id)
                .where(
                    ClassSession.class_id.in_(teacher_classes),
                    ClassSession.date >= datetime.now().date() - timedelta(days=7),  # From 7 days ago
                    ClassSession.date <= datetime.now().date() + timedelta(days=7)   # To 7 days ahead
                )
                .order_by(ClassSession.date.asc(), ClassSession.start_time.asc())
            )
        ).all()
        
        # Get all classes assigned to teacher (for classes without sessions)
        all_teacher_classes = (
            await db.execute(
                select(ClassModel)
                .where(ClassModel.id.in_(teacher_classes))
                .order_by(ClassModel.class_code)
            )
        ).scalars().all()
        
        schedule_data = []
        
        # Add classes with sessions first
        for session, class_info in sessions:
            session_date = session.date
            start_time = session.start_time
            end_time = session.end_time
            
            # Calculate countdown and status
            now = datetime.now()
            
            # Handle both string and time objects for start_time
            if isinstance(start_time, str):
                start_time_obj = datetime.strptime(start_time, "%H:%M:%S").time()
            else:
                start_time_obj = start_time
                
            session_datetime = datetime.combine(session_date, start_time_obj)
            
            if now > session_datetime:
                countdown = "Đã kết thúc"
                session_status = "ended"
            else:
                time_diff = session_datetime - now
                days = time_diff.days
                hours, remainder = divmod(time_diff.seconds, 3600)
                minutes, _ = divmod(remainder, 60)
                
                if days > 0:
                    countdown = f"{days} ngày {hours} giờ {minutes} phút"
                elif hours > 0:
                    countdown = f"{hours} giờ {minutes} phút"
                else:
                    countdown = f"{minutes} phút"
                
                session_status = "upcoming"
            
            schedule_data.append({
                "session_id": session.id,
                "class_id": class_info.id,
                "class_code": class_info.class_code,
                "class_name": class_info.name,
                "date": str(session_date),
                "start_time": start_time,
                "end_time": end_time,
                "countdown": countdown,
                "status": session_status
            })
        
        # Add classes without sessions (show as placeholder)
        class_ids_with_sessions = {session.class_id for session, _ in sessions}
        classes_without_sessions = [
            class_info for class_info in all_teacher_classes 
            if class_info.id not in class_ids_with_sessions
        ]
        
        for class_info in classes_without_sessions:
            schedule_data.append({
                "session_id": None,
                "class_id": class_info.id,
                "class_code": class_info.class_code,
                "class_name": class_info.name,
                "date": None,
                "start_time": None,
                "end_time": None,
                "countdown": "Chưa có buổi học",
                "status": "no_sessions"
            })
        
        return schedule_data


@app.get("/api/students/{student_id}", response_model=StudentOut)
async def get_student(
    student_id: str,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> StudentOut:
    student = await db.get(Student, student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    return StudentOut(
        id=str(student.id),
        uid_code=student.uid_code,
        student_code=student.student_code,
        full_name=student.full_name,
        email=student.email,
        phone=student.phone,
        status=student.status,
        created_at=student.created_at,
        updated_at=student.updated_at,
    )


@app.put("/api/students/{student_id}", response_model=StudentOut)
async def update_student(
    student_id: str,
    payload: StudentUpdate,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> StudentOut:
    student = await db.get(Student, student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    if payload.student_code and payload.student_code != student.student_code:
        existing = await db.scalar(select(Student).where(Student.student_code == payload.student_code))
        if existing is not None:
            raise HTTPException(status_code=409, detail="student_code already exists")

    if payload.student_code is not None:
        student.student_code = payload.student_code
    if payload.full_name is not None:
        student.full_name = payload.full_name
    if payload.email is not None:
        student.email = payload.email
    if payload.phone is not None:
        student.phone = payload.phone
    if payload.status is not None:
        student.status = payload.status

    await db.commit()
    await db.refresh(student)

    return StudentOut(
        id=str(student.id),
        uid_code=student.uid_code,
        student_code=student.student_code,
        full_name=student.full_name,
        email=student.email,
        phone=student.phone,
        status=student.status,
        created_at=student.created_at,
        updated_at=student.updated_at,
    )


@app.delete("/api/students/{student_id}")
async def delete_student(
    student_id: str,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    student = await db.get(Student, student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    await db.delete(student)
    await db.commit()
    return {"ok": "true"}


@app.get(
    "/api/students/{student_id}/today-sessions",
    response_model=List[StudentTodaySessionOut],
)
async def get_student_today_sessions(
    student_id: str,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> List[StudentTodaySessionOut]:
    student = await db.get(Student, student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    today = datetime.now().date()

    rows = (
        await db.execute(
            select(ClassSession, ClassModel)
            .join(ClassModel, ClassSession.class_id == ClassModel.id)
            .join(StudentClass, StudentClass.class_id == ClassSession.class_id)
            .where(StudentClass.student_id == student.id)
            .where(StudentClass.status == "enrolled")
            .where(ClassSession.date == today)
        )
    ).all()

    out: list[StudentTodaySessionOut] = []
    for session, class_ in rows:
        out.append(
            StudentTodaySessionOut(
                class_id=class_.id,
                class_code=class_.class_code,
                class_name=class_.name,
                session_id=session.id,
                date=session.date,
                start_time=session.start_time,
                end_time=session.end_time,
                status=session.status,
            )
        )

    return out


# -----------------------------
# Classes CRUD
# -----------------------------


@app.get("/api/classes", response_model=List[ClassOut])
async def list_classes(
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> List[ClassOut]:
    if current_user.role == "teacher":
        rows = (
            await db.execute(
                select(ClassModel)
                .join(ClassTeacherAssignment, ClassTeacherAssignment.class_id == ClassModel.id)
                .where(ClassTeacherAssignment.teacher_user_id == current_user.id)
                .order_by(ClassModel.class_code)
            )
        ).scalars().all()
    else:
        rows = (await db.execute(select(ClassModel).order_by(ClassModel.class_code))).scalars().all()
    return [
        ClassOut(
            id=c.id,
            class_code=c.class_code,
            name=c.name,
            description=c.description,
            status=c.status,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in rows
    ]


@app.post("/api/classes", response_model=ClassOut)
async def create_class(
    payload: ClassCreate,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> ClassOut:
    existing = await db.scalar(select(ClassModel).where(ClassModel.class_code == payload.class_code))
    if existing is not None:
        raise HTTPException(status_code=409, detail="class_code already exists")

    c = ClassModel(
        class_code=payload.class_code,
        name=payload.name,
        description=payload.description,
        status=payload.status or "active",
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)

    # If teacher creates class, automatically assign them to the class
    if current_user.role == "teacher":
        teacher_assignment = ClassTeacherAssignment(
            class_id=c.id,
            teacher_user_id=current_user.id
        )
        db.add(teacher_assignment)
        await db.commit()

    return ClassOut(
        id=c.id,
        class_code=c.class_code,
        name=c.name,
        description=c.description,
        status=c.status,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@app.get("/api/classes/{class_id}", response_model=ClassOut)
async def get_class(
    class_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> ClassOut:
    c = await db.get(ClassModel, class_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Class not found")

    return ClassOut(
        id=c.id,
        class_code=c.class_code,
        name=c.name,
        description=c.description,
        status=c.status,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@app.put("/api/classes/{class_id}", response_model=ClassOut)
async def update_class(
    class_id: int,
    payload: ClassUpdate,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> ClassOut:
    c = await db.get(ClassModel, class_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Class not found")

    if payload.name is not None:
        c.name = payload.name
    if payload.description is not None:
        c.description = payload.description
    if payload.status is not None:
        c.status = payload.status

    await db.commit()
    await db.refresh(c)

    return ClassOut(
        id=c.id,
        class_code=c.class_code,
        name=c.name,
        description=c.description,
        status=c.status,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@app.delete("/api/classes/{class_id}")
async def delete_class(
    class_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    c = await db.get(ClassModel, class_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Class not found")

    # Check if teacher has access to this class
    if current_user.role == "teacher":
        teacher_assignment = await db.scalar(
            select(ClassTeacherAssignment).where(
                ClassTeacherAssignment.class_id == class_id,
                ClassTeacherAssignment.teacher_user_id == current_user.id
            )
        )
        if not teacher_assignment:
            raise HTTPException(status_code=403, detail="Access denied: You are not assigned to this class")

    # Delete related records in correct order to avoid foreign key constraints
    # 1. Delete class teacher assignments
    await db.execute(
        delete(ClassTeacherAssignment).where(ClassTeacherAssignment.class_id == class_id)
    )
    
    # 2. Delete student class assignments
    await db.execute(
        delete(StudentClass).where(StudentClass.class_id == class_id)
    )
    
    # 3. Delete class sessions
    await db.execute(
        delete(ClassSession).where(ClassSession.class_id == class_id)
    )
    
    # 4. Finally delete the class
    await db.delete(c)
    await db.commit()
    return {"ok": "true"}


# -----------------------------
# Sessions CRUD
# -----------------------------


@app.get("/api/classes/{class_id}/sessions", response_model=List[SessionOut])
async def list_sessions_for_class(
    class_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> List[SessionOut]:
    # Check if teacher has access to this class
    if current_user.role == "teacher":
        teacher_assignment = await db.scalar(
            select(ClassTeacherAssignment).where(
                ClassTeacherAssignment.class_id == class_id,
                ClassTeacherAssignment.teacher_user_id == current_user.id
            )
        )
        if not teacher_assignment:
            raise HTTPException(status_code=403, detail="Access denied: You are not assigned to this class")
    
    rows = (
        await db.execute(
            select(ClassSession).where(ClassSession.class_id == class_id).order_by(ClassSession.date, ClassSession.start_time)
        )
    ).scalars().all()
    return [
        SessionOut(
            id=s.id,
            class_id=s.class_id,
            date=s.date,
            start_time=s.start_time,
            end_time=s.end_time,
            late_threshold_minutes=s.late_threshold_minutes,
            status=s.status,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in rows
    ]


@app.post("/api/classes/{class_id}/sessions", response_model=SessionOut)
async def create_session_for_class(
    class_id: int,
    payload: SessionCreate,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> SessionOut:
    c = await db.get(ClassModel, class_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Class not found")

    # Check for time conflicts with existing sessions
    existing_sessions = (
        await db.execute(
            select(ClassSession, ClassModel)
            .join(ClassModel, ClassSession.class_id == ClassModel.id)
            .where(ClassSession.date == payload.date)
            .where(ClassSession.class_id != class_id)  # Check other classes only
        )
    ).all()

    # Parse times for comparison
    if isinstance(payload.start_time, str):
        new_start = datetime.strptime(payload.start_time, "%H:%M").time()
    else:
        new_start = payload.start_time
    
    if isinstance(payload.end_time, str):
        new_end = datetime.strptime(payload.end_time, "%H:%M").time()
    else:
        new_end = payload.end_time

    for session, conflict_class in existing_sessions:
        if isinstance(session.start_time, str):
            existing_start = datetime.strptime(session.start_time, "%H:%M").time()
        else:
            existing_start = session.start_time
            
        if isinstance(session.end_time, str):
            existing_end = datetime.strptime(session.end_time, "%H:%M").time()
        else:
            existing_end = session.end_time

        # Check if time ranges overlap
        # Two time ranges [start1, end1] and [start2, end2] overlap if:
        # start1 < end2 and start2 < end1
        if (new_start < existing_end and existing_start < new_end):
            raise HTTPException(
                status_code=409, 
                detail=f"Trùng thời gian với buổi học lớp {conflict_class.class_code} ({existing_start.strftime('%H:%M')} - {existing_end.strftime('%H:%M')}). Vui lòng chọn khung giờ khác."
            )

    # Convert string times to time objects if needed
    if isinstance(payload.start_time, str):
        start_time_obj = datetime.strptime(payload.start_time, "%H:%M").time()
    else:
        start_time_obj = payload.start_time
    
    if isinstance(payload.end_time, str):
        end_time_obj = datetime.strptime(payload.end_time, "%H:%M").time()
    else:
        end_time_obj = payload.end_time

    s = ClassSession(
        class_id=class_id,
        date=payload.date,
        start_time=start_time_obj,
        end_time=end_time_obj,
        late_threshold_minutes=payload.late_threshold_minutes,
        status=payload.status or "scheduled",
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)

    return SessionOut(
        id=s.id,
        class_id=s.class_id,
        date=s.date,
        start_time=s.start_time,
        end_time=s.end_time,
        late_threshold_minutes=s.late_threshold_minutes,
        status=s.status,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


@app.get("/api/sessions/{session_id}", response_model=SessionOut)
async def get_session(
    session_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> SessionOut:
    s = await db.get(ClassSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return SessionOut(
        id=s.id,
        class_id=s.class_id,
        date=s.date,
        start_time=s.start_time,
        end_time=s.end_time,
        late_threshold_minutes=s.late_threshold_minutes,
        status=s.status,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


@app.put("/api/sessions/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: int,
    payload: SessionUpdate,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> SessionOut:
    s = await db.get(ClassSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check for time conflicts if date or time is being updated
    check_conflicts = False
    check_date = s.date
    check_start = s.start_time
    check_end = s.end_time

    if payload.date is not None:
        check_date = payload.date
        check_conflicts = True
    if payload.start_time is not None:
        check_start = payload.start_time
        check_conflicts = True
    if payload.end_time is not None:
        check_end = payload.end_time
        check_conflicts = True

    if check_conflicts:
        # Check for time conflicts with existing sessions (excluding current session)
        existing_sessions = (
            await db.execute(
                select(ClassSession, ClassModel)
                .join(ClassModel, ClassSession.class_id == ClassModel.id)
                .where(ClassSession.date == check_date)
                .where(ClassSession.id != session_id)  # Exclude current session
            )
        ).all()

        # Parse times for comparison
        if isinstance(check_start, str):
            new_start = datetime.strptime(check_start, "%H:%M").time()
        else:
            new_start = check_start
        
        if isinstance(check_end, str):
            new_end = datetime.strptime(check_end, "%H:%M").time()
        else:
            new_end = check_end

        for session, conflict_class in existing_sessions:
            if isinstance(session.start_time, str):
                existing_start = datetime.strptime(session.start_time, "%H:%M").time()
            else:
                existing_start = session.start_time
                
            if isinstance(session.end_time, str):
                existing_end = datetime.strptime(session.end_time, "%H:%M").time()
            else:
                existing_end = session.end_time

            # Check if time ranges overlap
            if (new_start < existing_end and existing_start < new_end):
                raise HTTPException(
                    status_code=409, 
                    detail=f"Trùng thời gian với buổi học lớp {conflict_class.class_code} ({existing_start.strftime('%H:%M')} - {existing_end.strftime('%H:%M')}). Vui lòng chọn khung giờ khác."
                )

    if payload.date is not None:
        s.date = payload.date
    if payload.start_time is not None:
        s.start_time = payload.start_time
    if payload.end_time is not None:
        s.end_time = payload.end_time
    if payload.late_threshold_minutes is not None:
        s.late_threshold_minutes = payload.late_threshold_minutes
    if payload.status is not None:
        s.status = payload.status

    await db.commit()
    await db.refresh(s)

    return SessionOut(
        id=s.id,
        class_id=s.class_id,
        date=s.date,
        start_time=s.start_time,
        end_time=s.end_time,
        late_threshold_minutes=s.late_threshold_minutes,
        status=s.status,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


@app.delete("/api/sessions/{session_id}")
async def delete_session(
    session_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    s = await db.get(ClassSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(s)
    await db.commit()
    return {"ok": "true"}


# -----------------------------
# Enroll students into classes
# -----------------------------


@app.get("/api/classes/{class_id}/students", response_model=List[StudentShortOut])
async def list_students_in_class(
    class_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> List[StudentShortOut]:
    # Check if teacher has access to this class
    if current_user.role == "teacher":
        teacher_assignment = await db.scalar(
            select(ClassTeacherAssignment).where(
                ClassTeacherAssignment.class_id == class_id,
                ClassTeacherAssignment.teacher_user_id == current_user.id
            )
        )
        if not teacher_assignment:
            raise HTTPException(status_code=403, detail="Access denied: You are not assigned to this class")
    
    rows = (
        await db.execute(
            select(Student)
            .join(StudentClass, StudentClass.student_id == Student.id)
            .where(StudentClass.class_id == class_id)
            .where(StudentClass.status == "enrolled")
            .order_by(Student.student_code)
        )
    ).scalars().all()

    return [
        StudentShortOut(
            id=str(s.id),
            student_code=s.student_code,
            full_name=s.full_name,
        )
        for s in rows
    ]


@app.post("/api/classes/{class_id}/students")
async def add_students_to_class(
    class_id: int,
    payload: StudentClassAssignIn,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    c = await db.get(ClassModel, class_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Class not found")

    for sid in payload.student_ids:
        student = await db.get(Student, sid)
        if student is None:
            continue
        existing = await db.scalar(
            select(StudentClass).where(
                StudentClass.student_id == student.id,
                StudentClass.class_id == class_id,
            )
        )
        if existing is not None:
            if existing.status != "enrolled":
                existing.status = "enrolled"
            continue

        enrollment = StudentClass(student_id=student.id, class_id=class_id, status="enrolled")
        db.add(enrollment)

    await db.commit()
    return {"ok": "true"}


@app.get("/api/classes/{class_id}/students/attendance", response_model=List[dict])
async def list_students_attendance_in_class(
    class_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> List[dict]:
    """Lấy danh sách sinh viên và trạng thái điểm danh cho tất cả các buổi học của lớp"""
    
    # Lấy tất cả sessions của lớp, sắp xếp theo ngày
    sessions = (
        await db.execute(
            select(ClassSession)
            .where(ClassSession.class_id == class_id)
            .where(ClassSession.status != 'cancelled')
            .order_by(ClassSession.date.desc(), ClassSession.start_time.desc())
        )
    ).scalars().all()
    
    if not sessions:
        return []
    
    session_ids = [s.id for s in sessions]
    
    # Lấy danh sách sinh viên đã đăng ký
    enrolled_students = (
        await db.execute(
            select(Student)
            .join(StudentClass, StudentClass.student_id == Student.id)
            .where(StudentClass.class_id == class_id)
            .where(StudentClass.status == "enrolled")
            .where(Student.status == "active")
            .order_by(Student.student_code)
        )
    ).scalars().all()
    
    # Lấy tất cả attendance logs cho các session này
    attendance_logs = (
        await db.execute(
            select(AttendanceLog)
            .where(AttendanceLog.session_id.in_(session_ids))
        )
    ).scalars().all()
    
    # Tạo map để tra cứu nhanh
    session_by_id = {s.id: s for s in sessions}
    attendance_map = {}
    for log in attendance_logs:
        key = (log.student_id, log.session_id)
        attendance_map[key] = log
    
    result = []
    current_time = datetime.now()  # Không dùng timezone để so sánh với session time
    
    for student in enrolled_students:
        student_data = {
            "id": str(student.id),
            "student_code": student.student_code,
            "full_name": student.full_name,
            "sessions": []
        }
        
        # Duyệt qua tất cả sessions để lấy trạng thái điểm danh
        for session in sessions:
            attendance = attendance_map.get((student.id, session.id))
            
            # Xác định trạng thái session
            session_start_time = datetime.combine(session.date, session.start_time)
            session_end_time = datetime.combine(session.date, session.end_time)
            
            if session.status == 'cancelled':
                session_status = 'cancelled'
            elif current_time < session_start_time:
                session_status = 'not_started'
            elif current_time > session_end_time:
                # Lớp đã kết thúc, kiểm tra có điểm danh không
                if attendance:
                    session_status = attendance.status
                else:
                    session_status = 'absent'  # Chưa điểm danh -> vắng
            else:
                # Lớp đang diễn ra
                if attendance:
                    session_status = attendance.status
                else:
                    session_status = 'not_checked_in'  # Chưa điểm danh
            
            student_data["sessions"].append({
                "session_id": session.id,
                "date": session.date.isoformat(),
                "start_time": session.start_time,
                "end_time": session.end_time,
                "session_status": session.status,
                "attendance_status": session_status,
                "scan_time": attendance.first_scan_time.isoformat() if attendance else None
            })
        
        result.append(student_data)
    
    return result


@app.delete("/api/classes/{class_id}/students/{student_id}")
async def remove_student_from_class(
    class_id: int,
    student_id: str,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    student = await db.get(Student, student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    enrollment = await db.scalar(
        select(StudentClass).where(
            StudentClass.student_id == student.id,
            StudentClass.class_id == class_id,
        )
    )
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    enrollment.status = "dropped"
    await db.commit()
    return {"ok": "true"}


# -----------------------------
# Attendance scan from ESP32
# -----------------------------


@app.post("/api/attendance/scan", response_model=AttendanceScanResultOut)
async def attendance_scan(
    payload: AttendanceScanIn,
    db: AsyncSession = Depends(get_db_session),
) -> AttendanceScanResultOut:
    # Sử dụng giờ địa phương để so sánh với start_time/end_time buổi học
    now_ts = payload.timestamp or datetime.now().astimezone()

    # 1) Tìm thẻ RFID
    card = await db.scalar(
        select(RFIDCard).where(
            RFIDCard.uid == payload.uid,
            RFIDCard.is_active.is_(True),
        )
    )

    student: Optional[Student] = None
    if card and card.student_id:
        student = await db.get(Student, card.student_id)

    # Fallback: tìm trực tiếp bằng uid_code cũ
    if student is None:
        student = await db.scalar(select(Student).where(Student.uid_code == payload.uid))

    if student is None:
        raise HTTPException(status_code=404, detail="card_not_registered")

    # 2) Tìm buổi học hiện tại cho sinh viên (theo giờ địa phương)
    active = await _find_active_session_for_student(db, student, now_ts)
    if active is None:
        raise HTTPException(status_code=404, detail="no_active_session")

    session, class_ = active

    # 3) Upsert AttendanceLog cho (student, session)
    existing_log = await db.scalar(
        select(AttendanceLog).where(
            AttendanceLog.student_id == student.id,
            AttendanceLog.session_id == session.id,
        )
    )

    if existing_log is None:
        log = AttendanceLog(
            student_id=student.id,
            session_id=session.id,
            first_scan_time=now_ts,
            last_scan_time=now_ts,
            source="rfid",
        )
    else:
        log = existing_log
        log.last_scan_time = now_ts

    status_enum = _compute_attendance_status(
        session,
        log.first_scan_time,
        tz=now_ts.tzinfo or timezone.utc,
    )
    log.status = status_enum.value

    db.add(log)
    await db.commit()
    await db.refresh(log)

    # 4) Chuẩn bị response + event WebSocket
    result = AttendanceScanResultOut(
        student=StudentShortOut(
            id=str(student.id),
            student_code=student.student_code,
            full_name=student.full_name,
        ),
        class_={
            "id": class_.id,
            "class_code": class_.class_code,
            "name": class_.name,
        },  # type: ignore[arg-type]
        session={
            "id": session.id,
            "date": session.date,
            "start_time": session.start_time,
            "end_time": session.end_time,
        },  # type: ignore[arg-type]
        attendance={
            "status": log.status,
            "scan_time": log.last_scan_time,
        },  # type: ignore[arg-type]
    )

    event = RealtimeAttendanceEvent(data=result)
    await ws_manager.broadcast(event.model_dump())

    return result


# -----------------------------
# Attendance logs + dashboard
# -----------------------------


@app.get("/api/attendance/logs", response_model=dict)
async def get_attendance_logs(
    date_str: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    if date_str:
        try:
            target_date = date.fromisoformat(date_str)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid date format, expected YYYY-MM-DD") from exc
        # Nếu có date cụ thể, lấy logs cho ngày đó
        start_date = target_date
        end_date = target_date
    else:
        # Mặc định: lấy logs cho tuần hiện tại (từ Thứ Hai đến Chủ Nhật)
        today = datetime.now(timezone.utc).date()
        # Tìm Thứ Hai của tuần hiện tại
        days_since_monday = today.weekday()  # Monday = 0, Sunday = 6
        monday = today - timedelta(days=days_since_monday)
        sunday = monday + timedelta(days=6)
        
        start_date = monday
        end_date = sunday

    # Lấy các buổi học trong khoảng thời gian theo vai trò user
    if current_user.role == "student":
        # Student chỉ xem các buổi học của lớp mình đã đăng ký
        sessions = (
            await db.execute(
                select(ClassSession, ClassModel)
                .join(ClassModel, ClassSession.class_id == ClassModel.id)
                .join(StudentClass, ClassModel.id == StudentClass.class_id)
                .where(
                    ClassSession.date >= start_date,
                    ClassSession.date <= end_date,
                    StudentClass.student_id == current_user.id
                )
            )
        ).all()
    elif current_user.role == "teacher":
        # Teacher chỉ xem các buổi học của lớp mình dạy
        sessions = (
            await db.execute(
                select(ClassSession, ClassModel)
                .join(ClassModel, ClassSession.class_id == ClassModel.id)
                .join(ClassTeacherAssignment, ClassModel.id == ClassTeacherAssignment.class_id)
                .where(
                    ClassSession.date >= start_date,
                    ClassSession.date <= end_date,
                    ClassTeacherAssignment.teacher_user_id == current_user.id
                )
            )
        ).all()
    else:
        # Admin xem tất cả
        sessions = (
            await db.execute(
                select(ClassSession, ClassModel)
                .join(ClassModel, ClassSession.class_id == ClassModel.id)
                .where(ClassSession.date >= start_date, ClassSession.date <= end_date)
            )
        ).all()

    if not sessions:
        return {"logs": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}

    session_ids = [s.id for s, _ in sessions]
    class_by_id = {c.id: c for _, c in sessions}

    # Đếm tổng số logs
    count_query = (
        select(func.count())
        .select_from(AttendanceLog)
        .where(AttendanceLog.session_id.in_(session_ids))  # type: ignore[arg-type]
    )
    total_count = await db.scalar(count_query)

    # Lấy logs với phân trang
    offset = (page - 1) * page_size
    logs = (
        await db.execute(
            select(AttendanceLog, Student)
            .join(Student, AttendanceLog.student_id == Student.id)
            .where(AttendanceLog.session_id.in_(session_ids))  # type: ignore[arg-type]
            .order_by(AttendanceLog.last_scan_time.desc())
            .offset(offset)
            .limit(page_size)
        )
    ).all()

    result: list[AttendanceLogRowOut] = []
    for log, student in logs:
        class_obj = class_by_id.get(log.session.class_id)  # type: ignore[union-attr]
        if class_obj is None:
            continue
        result.append(
            AttendanceLogRowOut(
                student_code=student.student_code,
                full_name=student.full_name,
                class_code=class_obj.class_code,
                class_name=class_obj.name,
                status=log.status,
                scan_time=log.last_scan_time,
            )
        )

    total_pages = (total_count + page_size - 1) // page_size if total_count else 0

    return {
        "logs": result,
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "date_range": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "week_info": f"Tuần {start_date.isocalendar()[1]} ({start_date.strftime('%d/%m')} - {end_date.strftime('%d/%m')})"
        }
    }


@app.get("/api/dashboard/today", response_model=DashboardTodayOut)
async def dashboard_today(
    class_id: Optional[int] = Query(default=None),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db_session),
) -> DashboardTodayOut:
    today = datetime.now(timezone.utc).date()

    # Get sessions based on user role
    if current_user.role == "student":
        # Student only sees sessions for classes they're enrolled in
        student_classes = (
            await db.execute(
                select(StudentClass.class_id)
                .where(StudentClass.student_id == current_user.id)
                .where(StudentClass.status == "enrolled")
            )
        ).scalars().all()
        
        if not student_classes:
            return DashboardTodayOut(
                date=today,
                total_students=0,
                present=0,
                late=0,
                absent=0,
            )
        
        # If specific class_id is provided, check if student is enrolled
        if class_id is not None:
            if class_id not in student_classes:
                raise HTTPException(status_code=403, detail="Access denied: You are not enrolled in this class")
            student_classes = [class_id]
        
        # Get sessions for student's classes today
        session_stmt = select(ClassSession).where(
            ClassSession.date == today,
            ClassSession.class_id.in_(student_classes)
        )
    elif current_user.role == "teacher":
        # Get classes assigned to this teacher
        teacher_classes = (
            await db.execute(
                select(ClassTeacherAssignment.class_id)
                .where(ClassTeacherAssignment.teacher_user_id == current_user.id)
            )
        ).scalars().all()
        
        if not teacher_classes:
            return DashboardTodayOut(
                date=today,
                total_students=0,
                present=0,
                late=0,
                absent=0,
            )
        
        # If specific class_id is provided, check if teacher has access
        if class_id is not None:
            if class_id not in teacher_classes:
                raise HTTPException(status_code=403, detail="Access denied: You are not assigned to this class")
            teacher_classes = [class_id]
        
        # Get sessions for teacher's classes today
        session_stmt = select(ClassSession).where(
            ClassSession.date == today,
            ClassSession.class_id.in_(teacher_classes)
        )
    else:
        # Admin can see all classes
        session_stmt = select(ClassSession).where(ClassSession.date == today)
        if class_id is not None:
            session_stmt = session_stmt.where(ClassSession.class_id == class_id)

    sessions = (await db.execute(session_stmt)).scalars().all()
    if not sessions:
        return DashboardTodayOut(
            date=today,
            total_students=0,
            present=0,
            late=0,
            absent=0,
        )

    session_ids = [s.id for s in sessions]
    class_ids = list({s.class_id for s in sessions})

    # Tất cả sinh viên đăng ký các lớp này
    enrollments = (
        await db.execute(
            select(StudentClass.student_id)
            .where(StudentClass.class_id.in_(class_ids))  # type: ignore[arg-type]
            .where(StudentClass.status == "enrolled")
        )
    ).scalars().all()

    enrolled_student_ids = set(enrollments)
    total_students = len(enrolled_student_ids)

    if total_students == 0:
        return DashboardTodayOut(
            date=today,
            total_students=0,
            present=0,
            late=0,
            absent=0,
        )

    # Logs điểm danh cho các buổi hôm nay
    logs = (
        await db.execute(
            select(AttendanceLog)
            .where(AttendanceLog.session_id.in_(session_ids))  # type: ignore[arg-type]
        )
    ).scalars().all()

    present_students: set[object] = set()
    late_students: set[object] = set()

    for log in logs:
        if log.student_id not in enrolled_student_ids:
            continue
        if log.status == AttendanceStatusEnum.ON_TIME.value:
            present_students.add(log.student_id)
        elif log.status == AttendanceStatusEnum.LATE.value:
            present_students.add(log.student_id)
            late_students.add(log.student_id)

    present_count = len(present_students) - len(late_students)  # Chỉ tính đúng giờ
    late_count = len(late_students)
    absent_count = max(total_students - present_count - late_count, 0)  # Tổng - đúng giờ - đi trễ

    return DashboardTodayOut(
        date=today,
        total_students=total_students,
        present=present_count,
        late=late_count,
        absent=absent_count,
    )


# -----------------------------
# Authentication endpoints
# -----------------------------


@app.post("/api/auth/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db_session)
) -> LoginResponse:
    """Login user and return access token"""
    user = await db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash):
        await _write_audit_log(
            db=db,
            action="login_failed",
            target_type="user",
            target_id=payload.username,
            details="Incorrect username or password",
        )
        await db.commit()
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password"
        )
    
    if not user.is_active:
        await _write_audit_log(
            db=db,
            action="login_blocked_inactive",
            actor_user_id=str(user.id),
            target_type="user",
            target_id=str(user.id),
            details="Inactive user attempted login",
        )
        await db.commit()
        raise HTTPException(
            status_code=401,
            detail="User account is inactive"
        )
    
    access_token = create_access_token(data={"sub": str(user.id)})
    await _write_audit_log(
        db=db,
        action="login_success",
        actor_user_id=str(user.id),
        target_type="user",
        target_id=str(user.id),
        details=f"Role: {user.role}",
    )
    await db.commit()
    
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user={
            "id": str(user.id),
            "username": user.username,
            "role": user.role,
            "full_name": user.full_name
        }
    )


@app.get("/api/auth/me", response_model=UserOut)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user)
) -> UserOut:
    """Get current user information"""
    return UserOut(
        id=str(current_user.id),
        username=current_user.username,
        role=current_user.role,
        is_active=current_user.is_active,
        full_name=current_user.full_name,
        email=current_user.email,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at
    )


@app.put("/api/auth/me", response_model=UserOut)
async def update_current_user(
    payload: UserUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db_session)
) -> UserOut:
    """Update current user information"""
    if payload.full_name is not None:
        current_user.full_name = payload.full_name
    if payload.email is not None:
        current_user.email = payload.email
    if payload.password is not None:
        current_user.password_hash = hash_password(payload.password)
    
    await db.commit()
    await db.refresh(current_user)
    
    return UserOut(
        id=str(current_user.id),
        username=current_user.username,
        role=current_user.role,
        is_active=current_user.is_active,
        full_name=current_user.full_name,
        email=current_user.email,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at
    )


# -----------------------------
# User management (Admin only)
# -----------------------------


@app.get("/api/users", response_model=List[UserOut])
async def list_users(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session)
) -> List[UserOut]:
    """List all users (Admin only)"""
    users = await db.execute(select(User).order_by(User.created_at.desc()))
    return [
        UserOut(
            id=str(user.id),
            username=user.username,
            role=user.role,
            is_active=user.is_active,
            full_name=user.full_name,
            email=user.email,
            created_at=user.created_at,
            updated_at=user.updated_at
        )
        for user in users.scalars().all()
    ]


@app.post("/api/users", response_model=UserOut)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session)
) -> UserOut:
    """Create new user (Admin only)"""
    print(f"Creating user: {payload.username}, role: {payload.role}")
    
    # Check if username already exists
    existing = await db.scalar(select(User).where(User.username == payload.username))
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")
    
    # Check if email already exists
    if payload.email:
        existing_email = await db.scalar(select(User).where(User.email == payload.email))
        if existing_email:
            raise HTTPException(status_code=409, detail="Email already exists")
    
    # Validate role
    if payload.role not in ["admin", "teacher", "student"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    # Create user with default password
    user = User(
        username=payload.username,
        password_hash=hash_password(DEFAULT_PASSWORD),
        role=payload.role,
        full_name=payload.full_name,
        email=payload.email
    )
    print(f"User object created: {user.username}, {user.role}")
    db.add(user)
    await _write_audit_log(
        db=db,
        action="user_created",
        actor_user_id=str(current_user.id),
        target_type="user",
        target_id=payload.username,
        details=f"Role: {payload.role}",
    )
    await db.commit()
    await db.refresh(user)
    
    return UserOut(
        id=str(user.id),
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        full_name=user.full_name,
        email=user.email,
        created_at=user.created_at,
        updated_at=user.updated_at
    )


@app.put("/api/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session)
) -> UserOut:
    """Update user (Admin only)"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    old_email = user.email
    old_full_name = user.full_name
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.email is not None:
        user.email = payload.email
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    
    await db.commit()
    await _write_audit_log(
        db=db,
        action="user_updated",
        actor_user_id=str(current_user.id),
        target_type="user",
        target_id=str(user.id),
        details=f"full_name: {old_full_name} -> {user.full_name}; email: {old_email} -> {user.email}",
    )
    await db.commit()
    await db.refresh(user)
    
    return UserOut(
        id=str(user.id),
        username=user.username,
        role=user.role,
        is_active=user.is_active,
        full_name=user.full_name,
        email=user.email,
        created_at=user.created_at,
        updated_at=user.updated_at
    )


@app.delete("/api/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session)
) -> dict:
    """Delete user (Admin only)"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Prevent deleting self
    if str(current_user.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    await db.delete(user)
    await _write_audit_log(
        db=db,
        action="user_deleted",
        actor_user_id=str(current_user.id),
        target_type="user",
        target_id=user_id,
        details=f"username={user.username}",
    )
    await db.commit()
    
    return {"message": "User deleted successfully"}


# -----------------------------
# Account lock/unlock (Admin only)
# -----------------------------


@app.patch("/api/users/{user_id}/active")
async def set_user_active_status(
    user_id: str,
    is_active: bool,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if str(current_user.id) == user_id and not is_active:
        raise HTTPException(status_code=400, detail="Cannot lock your own account")

    user.is_active = is_active
    user.updated_at = datetime.now(timezone.utc)
    await _write_audit_log(
        db=db,
        action="user_active_status_changed",
        actor_user_id=str(current_user.id),
        target_type="user",
        target_id=str(user.id),
        details=f"is_active={is_active}",
    )
    await db.commit()
    return {"message": "User status updated", "is_active": user.is_active}


# -----------------------------
# RFID card management
# -----------------------------


@app.get("/api/rfid-cards", response_model=List[RFIDCardOut])
async def list_rfid_cards(
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> List[RFIDCardOut]:
    cards = (await db.execute(select(RFIDCard).order_by(RFIDCard.id.desc()))).scalars().all()
    return [
        RFIDCardOut(
            id=card.id,
            uid=card.uid,
            is_active=card.is_active,
            assigned_at=card.assigned_at,
            unassigned_at=card.unassigned_at,
            note=card.note,
        )
        for card in cards
    ]


@app.post("/api/rfid-cards", response_model=RFIDCardOut)
async def create_rfid_card(
    payload: RFIDCardCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> RFIDCardOut:
    existing = await db.scalar(select(RFIDCard).where(RFIDCard.uid == payload.uid))
    if existing:
        raise HTTPException(status_code=409, detail="RFID UID already exists")

    card = RFIDCard(
        uid=payload.uid.strip(),
        note=payload.note,
        is_active=True,
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return RFIDCardOut(
        id=card.id,
        uid=card.uid,
        is_active=card.is_active,
        assigned_at=card.assigned_at,
        unassigned_at=card.unassigned_at,
        note=card.note,
    )


@app.put("/api/rfid-cards/{card_id}/assign/{student_id}", response_model=RFIDCardOut)
async def assign_card_to_student(
    card_id: int,
    student_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> RFIDCardOut:
    card = await db.get(RFIDCard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="RFID card not found")

    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    card.student_id = student.id
    card.assigned_at = datetime.now(timezone.utc)
    card.unassigned_at = None
    card.is_active = True
    await db.commit()
    await db.refresh(card)
    return RFIDCardOut(
        id=card.id,
        uid=card.uid,
        is_active=card.is_active,
        assigned_at=card.assigned_at,
        unassigned_at=card.unassigned_at,
        note=card.note,
    )


@app.put("/api/rfid-cards/{card_id}/unassign", response_model=RFIDCardOut)
async def unassign_card(
    card_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> RFIDCardOut:
    card = await db.get(RFIDCard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="RFID card not found")

    card.student_id = None
    card.unassigned_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(card)
    return RFIDCardOut(
        id=card.id,
        uid=card.uid,
        is_active=card.is_active,
        assigned_at=card.assigned_at,
        unassigned_at=card.unassigned_at,
        note=card.note,
    )


@app.patch("/api/rfid-cards/{card_id}/active", response_model=RFIDCardOut)
async def set_rfid_active_status(
    card_id: int,
    is_active: bool,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> RFIDCardOut:
    card = await db.get(RFIDCard, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="RFID card not found")

    card.is_active = is_active
    if not is_active:
        card.unassigned_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(card)
    return RFIDCardOut(
        id=card.id,
        uid=card.uid,
        is_active=card.is_active,
        assigned_at=card.assigned_at,
        unassigned_at=card.unassigned_at,
        note=card.note,
    )


@app.get("/api/students/me/rfid-cards", response_model=List[RFIDCardOut])
async def list_my_rfid_cards(
    current_user: User = Depends(require_roles(["student"])),
    db: AsyncSession = Depends(get_db_session),
) -> List[RFIDCardOut]:
    student = await db.scalar(select(Student).where(Student.student_code == current_user.username))
    if not student:
        return []

    cards = (
        await db.execute(
            select(RFIDCard)
            .where(RFIDCard.student_id == student.id)
            .order_by(RFIDCard.id.desc())
        )
    ).scalars().all()
    return [
        RFIDCardOut(
            id=card.id,
            uid=card.uid,
            is_active=card.is_active,
            assigned_at=card.assigned_at,
            unassigned_at=card.unassigned_at,
            note=card.note,
        )
        for card in cards
    ]


# -----------------------------
# Teacher assignment
# -----------------------------


@app.get("/api/classes/{class_id}/teachers")
async def list_class_teachers(
    class_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> List[dict]:
    rows = (
        await db.execute(
            select(User, ClassTeacherAssignment)
            .join(ClassTeacherAssignment, ClassTeacherAssignment.teacher_user_id == User.id)
            .where(ClassTeacherAssignment.class_id == class_id)
            .where(User.role == "teacher")
            .order_by(User.full_name)
        )
    ).all()
    return [
        {
            "id": str(user.id),
            "username": user.username,
            "full_name": user.full_name,
            "email": user.email,
            "assigned_at": assignment.assigned_at,
        }
        for user, assignment in rows
    ]


@app.put("/api/classes/{class_id}/teachers")
async def assign_teachers_to_class(
    class_id: int,
    payload: ClassTeacherAssignIn,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    class_obj = await db.get(ClassModel, class_id)
    if not class_obj:
        raise HTTPException(status_code=404, detail="Class not found")

    existing_assignments = (
        await db.execute(
            select(ClassTeacherAssignment).where(ClassTeacherAssignment.class_id == class_id)
        )
    ).scalars().all()
    for row in existing_assignments:
        await db.delete(row)
    await db.flush()

    import uuid
    for teacher_id in payload.teacher_user_ids:
        try:
            teacher_uuid = uuid.UUID(teacher_id)
        except ValueError:
            continue
        teacher = await db.get(User, teacher_uuid)
        if not teacher or teacher.role != "teacher":
            continue
        db.add(ClassTeacherAssignment(class_id=class_id, teacher_user_id=teacher.id))

    await _write_audit_log(
        db=db,
        action="class_teachers_updated",
        actor_user_id=str(current_user.id),
        target_type="class",
        target_id=str(class_id),
        details=f"teacher_count={len(payload.teacher_user_ids)}",
    )
    await db.commit()
    return {"message": "Teachers assigned successfully"}


@app.get("/api/teacher/classes", response_model=List[ClassOut])
async def list_my_teaching_classes(
    current_user: User = Depends(require_roles(["teacher"])),
    db: AsyncSession = Depends(get_db_session),
) -> List[ClassOut]:
    rows = (
        await db.execute(
            select(ClassModel)
            .join(ClassTeacherAssignment, ClassTeacherAssignment.class_id == ClassModel.id)
            .where(ClassTeacherAssignment.teacher_user_id == current_user.id)
            .order_by(ClassModel.class_code)
        )
    ).scalars().all()
    return [
        ClassOut(
            id=c.id,
            class_code=c.class_code,
            name=c.name,
            description=c.description,
            status=c.status,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in rows
    ]


# -----------------------------
# Attendance appeals (Student/Teacher/Admin)
# -----------------------------


@app.post("/api/attendance/appeals", response_model=AttendanceAppealOut)
async def create_attendance_appeal(
    payload: AttendanceAppealCreate,
    current_user: User = Depends(require_roles(["student"])),
    db: AsyncSession = Depends(get_db_session),
) -> AttendanceAppealOut:
    student = await db.scalar(select(Student).where(Student.student_code == current_user.username))
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    session = await db.get(ClassSession, payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    appeal = AttendanceAppeal(
        student_id=student.id,
        session_id=payload.session_id,
        reason=payload.reason.strip(),
        status="pending",
    )
    db.add(appeal)
    await _write_audit_log(
        db=db,
        action="attendance_appeal_created",
        actor_user_id=str(current_user.id),
        target_type="appeal",
        target_id=str(payload.session_id),
    )
    await db.commit()
    await db.refresh(appeal)
    return AttendanceAppealOut(
        id=appeal.id,
        student_id=str(appeal.student_id),
        session_id=appeal.session_id,
        reason=appeal.reason,
        status=appeal.status,
        note=appeal.note,
        created_at=appeal.created_at,
        updated_at=appeal.updated_at,
    )


@app.get("/api/attendance/appeals", response_model=List[AttendanceAppealOut])
async def list_attendance_appeals(
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
    status: Optional[str] = Query(None, description="Filter by appeal status (pending, approved, rejected)"),
    start_date: Optional[str] = Query(None, description="Filter appeals from this date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Filter appeals to this date (YYYY-MM-DD)"),
    student_id: Optional[str] = Query(None, description="Filter by student ID"),
    limit: int = Query(1000, le=5000, description="Maximum number of appeals to return"),
) -> List[AttendanceAppealOut]:
    """Get attendance appeals with advanced filtering"""
    query = select(AttendanceAppeal)
    
    # Apply filters
    if status:
        query = query.where(AttendanceAppeal.status == status)
    
    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            query = query.where(AttendanceAppeal.created_at >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")
    
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
            query = query.where(AttendanceAppeal.created_at < end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD")
    
    if student_id:
        try:
            student_uuid = uuid.UUID(student_id)
            query = query.where(AttendanceAppeal.student_id == student_uuid)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid student_id format")
    
    # For teachers, only show appeals for their assigned classes
    if current_user.role == "teacher":
        # Get classes assigned to this teacher
        teacher_classes = (
            await db.execute(
                select(ClassTeacherAssignment.class_id)
                .where(ClassTeacherAssignment.teacher_user_id == current_user.id)
            )
        ).scalars().all()
        
        if teacher_classes:
            # Get appeals from students in these classes
            query = query.join(StudentClass, AttendanceAppeal.student_id == StudentClass.student_id)
            query = query.where(StudentClass.class_id.in_(teacher_classes))
        else:
            # Teacher has no assigned classes, return empty list
            return []
    
    # Order by created_at desc and apply limit
    appeals = (
        await db.execute(
            query.order_by(AttendanceAppeal.created_at.desc()).limit(limit)
        )
    ).scalars().all()
    
    return [
        AttendanceAppealOut(
            id=a.id,
            student_id=str(a.student_id),
            session_id=a.session_id,
            reason=a.reason,
            status=a.status,
            note=a.note,
            created_at=a.created_at,
            updated_at=a.updated_at,
        )
        for a in appeals
    ]


@app.patch("/api/attendance/appeals/{appeal_id}", response_model=AttendanceAppealOut)
async def update_attendance_appeal(
    appeal_id: int,
    payload: AttendanceAppealUpdate,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session),
) -> AttendanceAppealOut:
    appeal = await db.get(AttendanceAppeal, appeal_id)
    if not appeal:
        raise HTTPException(status_code=404, detail="Appeal not found")

    appeal.status = payload.status
    appeal.note = payload.note
    await _write_audit_log(
        db=db,
        action="attendance_appeal_updated",
        actor_user_id=str(current_user.id),
        target_type="appeal",
        target_id=str(appeal_id),
        details=f"status={payload.status}",
    )
    await db.commit()
    await db.refresh(appeal)
    return AttendanceAppealOut(
        id=appeal.id,
        student_id=str(appeal.student_id),
        session_id=appeal.session_id,
        reason=appeal.reason,
        status=appeal.status,
        note=appeal.note,
        created_at=appeal.created_at,
        updated_at=appeal.updated_at,
    )


@app.get("/api/students/me/sessions", response_model=List[dict])
async def list_my_sessions(
    current_user: User = Depends(require_roles(["student"])),
    db: AsyncSession = Depends(get_db_session),
) -> List[dict]:
    """Get list of sessions for current student to use in appeal dropdown"""
    student = await db.scalar(select(Student).where(Student.student_code == current_user.username))
    if not student:
        return []
    
    # Get sessions from the past 30 days and future 7 days
    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=30)
    end_date = now + timedelta(days=7)
    
    result = await db.execute(
        select(
            ClassSession.id,
            ClassSession.date,
            ClassSession.start_time,
            ClassSession.end_time,
            ClassModel.class_code,
            ClassModel.name,
        )
        .join(ClassModel, ClassSession.class_id == ClassModel.id)
        .join(StudentClass, StudentClass.class_id == ClassSession.class_id)
        .where(
            and_(
                StudentClass.student_id == student.id,
                StudentClass.status == "enrolled",
                ClassSession.date >= start_date.date(),
                ClassSession.date <= end_date.date()
            )
        )
        .order_by(ClassSession.date.desc(), ClassSession.start_time.desc())
    )
    
    sessions = []
    for row in result:
        session_id, date, start_time, end_time, class_code, class_name = row
        sessions.append({
            "id": session_id,
            "date": str(date),
            "start_time": str(start_time),
            "end_time": str(end_time),
            "class_code": class_code,
            "class_name": class_name,
            "display_name": f"{class_code} - {class_name} - {date} {start_time}"
        })
    
    return sessions


@app.get("/api/students/me/appeals", response_model=List[AttendanceAppealOut])
async def list_my_attendance_appeals(
    current_user: User = Depends(require_roles(["student"])),
    db: AsyncSession = Depends(get_db_session),
) -> List[AttendanceAppealOut]:
    student = await db.scalar(select(Student).where(Student.student_code == current_user.username))
    if not student:
        return []
    appeals = (
        await db.execute(
            select(AttendanceAppeal)
            .where(AttendanceAppeal.student_id == student.id)
            .order_by(AttendanceAppeal.created_at.desc())
        )
    ).scalars().all()
    return [
        AttendanceAppealOut(
            id=a.id,
            student_id=str(a.student_id),
            session_id=a.session_id,
            reason=a.reason,
            status=a.status,
            note=a.note,
            created_at=a.created_at,
            updated_at=a.updated_at,
        )
        for a in appeals
    ]


@app.get("/api/system/audit-logs", response_model=List[SystemAuditLogOut])
async def list_system_audit_logs(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db_session),
    start_date: Optional[str] = Query(None, description="Filter logs from this date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Filter logs to this date (YYYY-MM-DD)"),
    action: Optional[str] = Query(None, description="Filter by action type"),
    target_type: Optional[str] = Query(None, description="Filter by target type"),
    actor_user_id: Optional[str] = Query(None, description="Filter by actor user ID"),
    limit: int = Query(1000, le=5000, description="Maximum number of logs to return"),
) -> List[SystemAuditLogOut]:
    """Get system audit logs with advanced filtering"""
    query = select(SystemAuditLog)
    
    # Apply filters
    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            query = query.where(SystemAuditLog.created_at >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")
    
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
            query = query.where(SystemAuditLog.created_at < end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD")
    
    if action:
        query = query.where(SystemAuditLog.action.ilike(f"%{action}%"))
    
    if target_type:
        query = query.where(SystemAuditLog.target_type == target_type)
    
    if actor_user_id:
        try:
            actor_uuid = uuid.UUID(actor_user_id)
            query = query.where(SystemAuditLog.actor_user_id == actor_uuid)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid actor_user_id format")
    
    # Order by created_at desc and apply limit
    logs = (
        await db.execute(
            query.order_by(SystemAuditLog.created_at.desc()).limit(limit)
        )
    ).scalars().all()
    
    return [
        SystemAuditLogOut(
            id=log.id,
            actor_user_id=str(log.actor_user_id) if log.actor_user_id else None,
            action=log.action,
            target_type=log.target_type,
            target_id=log.target_id,
            details=log.details,
            created_at=log.created_at,
        )
        for log in logs
    ]


# -----------------------------
# Attendance edit endpoints (Teacher/Admin)
# -----------------------------


@app.put("/api/attendance/{session_id}/{student_id}")
async def edit_attendance(
    session_id: int,
    student_id: str,
    status: str,
    current_user: User = Depends(require_teacher_or_admin),
    db: AsyncSession = Depends(get_db_session)
) -> dict:
    """Edit attendance status for a student in a session (Teacher/Admin only)"""
    if status not in ["on_time", "late", "absent"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    # Check if session exists
    session = await db.get(ClassSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Check if student exists and is enrolled
    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    # Check enrollment
    enrollment = await db.scalar(
        select(StudentClass).where(
            StudentClass.student_id == student_id,
            StudentClass.class_id == session.class_id,
            StudentClass.status == "enrolled"
        )
    )
    if not enrollment:
        raise HTTPException(status_code=404, detail="Student not enrolled in this class")
    
    # Get or create attendance log
    attendance = await db.scalar(
        select(AttendanceLog).where(
            AttendanceLog.student_id == student_id,
            AttendanceLog.session_id == session_id
        )
    )
    
    now = datetime.now(timezone.utc)
    
    if attendance:
        # Update existing
        attendance.status = status
        attendance.updated_at = now
    else:
        # Create new
        attendance = AttendanceLog(
            student_id=student_id,
            session_id=session_id,
            status=status,
            first_scan_time=now,
            last_scan_time=now
        )
        db.add(attendance)
    
    await db.commit()
    await _write_audit_log(
        db=db,
        action="attendance_edited",
        actor_user_id=str(current_user.id),
        target_type="attendance",
        target_id=f"{session_id}:{student_id}",
        details=f"status={status}",
    )
    await db.commit()
    
    return {"message": "Attendance updated successfully"}


# -----------------------------
# Notifications CRUD
# -----------------------------

@app.get("/api/notifications", response_model=List[NotificationOut])
async def list_notifications(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db_session),
    unread_only: bool = Query(False, description="Filter unread notifications only"),
    limit: int = Query(50, le=200, description="Maximum number of notifications to return"),
) -> List[NotificationOut]:
    """Get notifications for current user"""
    query = select(Notification).where(Notification.user_id == current_user.id)
    
    if unread_only:
        query = query.where(Notification.is_read == False)
    
    notifications = (
        await db.execute(
            query.order_by(Notification.created_at.desc()).limit(limit)
        )
    ).scalars().all()
    
    return [
        NotificationOut(
            id=n.id,
            title=n.title,
            message=n.message,
            type=n.type,
            is_read=n.is_read,
            created_at=n.created_at,
            read_at=n.read_at,
        )
        for n in notifications
    ]


@app.patch("/api/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Mark notification as read"""
    notification = await db.get(Notification, notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    if notification.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.now(timezone.utc)
        await db.commit()
    
    return {"message": "Notification marked as read"}


@app.patch("/api/notifications/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Mark all notifications as read for current user"""
    await db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.is_read == False)
        .values(is_read=True, read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    
    return {"message": "All notifications marked as read"}


@app.get("/api/notifications/unread-count")
async def get_unread_notifications_count(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Get count of unread notifications for current user"""
    count = await db.scalar(
        select(func.count(Notification.id))
        .where(Notification.user_id == current_user.id, Notification.is_read == False)
    )
    
    return {"unread_count": count or 0}


# Root endpoint
@app.get("/")
async def root():
    return {
        "message": "RFID Attendance System API",
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc"
    }

# Include AI router
app.include_router(ai_router)

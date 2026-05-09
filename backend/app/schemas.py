from datetime import date, datetime, time
from typing import Optional, Union

from pydantic import BaseModel, Field


# -----------------------------
# Authentication schemas
# -----------------------------


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: "UserInfo"


class UserInfo(BaseModel):
    id: str
    username: str
    role: str
    full_name: Optional[str] = None


class UserCreate(BaseModel):
    username: str
    password: Optional[str] = None
    role: str
    full_name: Optional[str] = None
    email: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None


class UserOut(BaseModel):
    id: str
    username: str
    role: str
    is_active: bool
    full_name: Optional[str] = None
    email: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# -----------------------------
# Student schemas
# -----------------------------


class StudentBase(BaseModel):
    student_code: str = Field(min_length=1, max_length=64)
    full_name: str = Field(min_length=1, max_length=255)
    email: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=32)
    status: Optional[str] = Field(default="active", max_length=20)


class StudentCreate(StudentBase):
    # Giữ uid_code để tương thích với hệ thống cũ
    uid_code: str = Field(min_length=1, max_length=64)


class StudentUpdate(BaseModel):
    student_code: Optional[str] = Field(default=None, max_length=64)
    full_name: Optional[str] = Field(default=None, max_length=255)
    email: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=32)
    status: Optional[str] = Field(default=None, max_length=20)


class StudentOut(BaseModel):
    id: str
    uid_code: str
    student_code: str
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime


class StudentShortOut(BaseModel):
    id: str
    student_code: str
    full_name: str


# -----------------------------
# RFID card schemas
# -----------------------------


class RFIDCardCreate(BaseModel):
    uid: str = Field(min_length=1, max_length=64)
    note: Optional[str] = None


class RFIDCardOut(BaseModel):
    id: int
    uid: str
    is_active: bool
    assigned_at: Optional[datetime]
    unassigned_at: Optional[datetime]
    note: Optional[str]


# -----------------------------
# Class & Session schemas
# -----------------------------


class ClassBase(BaseModel):
    class_code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    status: Optional[str] = Field(default="active", max_length=20)


class ClassCreate(ClassBase):
    pass


class ClassUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    status: Optional[str] = Field(default=None, max_length=20)


class ClassOut(BaseModel):
    id: int
    class_code: str
    name: str
    description: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime


class ClassShortOut(BaseModel):
    id: int
    class_code: str
    name: str


class SessionCreate(BaseModel):
    date: date
    start_time: Union[time, str]
    end_time: Union[time, str]
    late_threshold_minutes: int = 15
    status: Optional[str] = Field(default="scheduled", max_length=20)


class SessionUpdate(BaseModel):
    date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    late_threshold_minutes: Optional[int] = None
    status: Optional[str] = Field(default=None, max_length=20)


class SessionOut(BaseModel):
    id: int
    class_id: int
    date: date
    start_time: time
    end_time: time
    late_threshold_minutes: int
    status: str
    created_at: datetime
    updated_at: datetime


class StudentClassAssignIn(BaseModel):
    student_ids: list[str]


# -----------------------------
# Attendance scan + dashboard
# -----------------------------


class AttendanceScanIn(BaseModel):
    uid: str = Field(min_length=1, max_length=64)
    device_id: Optional[str] = None
    timestamp: Optional[datetime] = None


class AttendanceSessionShortOut(BaseModel):
    id: int
    date: date
    start_time: time
    end_time: time


class AttendanceStatusOut(BaseModel):
    status: str
    scan_time: datetime


class AttendanceScanResultOut(BaseModel):
    student: StudentShortOut
    class_: ClassShortOut
    session: AttendanceSessionShortOut
    attendance: AttendanceStatusOut


class RealtimeAttendanceEvent(BaseModel):
    event: str = "attendance_scanned"
    data: AttendanceScanResultOut


class AttendanceLogRowOut(BaseModel):
    student_code: str
    full_name: str
    class_code: str
    class_name: str
    status: str
    scan_time: datetime


class DashboardTodayOut(BaseModel):
    date: date
    total_students: int
    present: int
    late: int
    absent: int


class StudentTodaySessionOut(BaseModel):
    class_id: int
    class_code: str
    class_name: str
    session_id: int
    date: date
    start_time: time
    end_time: time
    status: str


class ClassTeacherAssignIn(BaseModel):
    teacher_user_ids: list[str]


class AttendanceAppealCreate(BaseModel):
    session_id: int
    reason: str = Field(min_length=3)


class AttendanceAppealUpdate(BaseModel):
    status: str = Field(pattern="^(pending|approved|rejected)$")
    note: Optional[str] = None


class AttendanceAppealOut(BaseModel):
    id: int
    student_id: str
    session_id: int
    reason: str
    status: str
    note: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class SystemAuditLogOut(BaseModel):
    id: int
    actor_user_id: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime


class NotificationOut(BaseModel):
    id: int
    title: str
    message: str
    type: str
    is_read: bool
    created_at: datetime
    read_at: Optional[datetime] = None

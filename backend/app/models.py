import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    """
    Tài khoản người dùng hệ thống.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    username: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True  # admin, teacher, student
    )
    full_name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Student(Base):
    """
    Thông tin sinh viên.

    Về tương thích ngược:
    - Cột uid_code vẫn giữ lại để không làm hỏng dữ liệu/logic cũ (nếu bạn đang dùng).
    - Khi dùng kiến trúc mới, nên ưu tiên bảng RFIDCard để map UID với sinh viên.
    """

    __tablename__ = "students"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # UID chính (tuỳ chọn) – giữ lại cho hệ thống cũ
    uid_code: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )

    student_code: Mapped[str] = mapped_column(
        String(64), index=True, nullable=False, unique=True
    )
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    birth_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    class_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    cards: Mapped[list["RFIDCard"]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )
    enrollments: Mapped[list["StudentClass"]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )
    attendance_logs: Mapped[list["AttendanceLog"]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )


class RFIDCard(Base):
    """
    Bảng quản lý thẻ RFID.
    """

    __tablename__ = "rfid_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uid: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)

    student_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("students.id"), nullable=True, index=True
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    unassigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)

    student: Mapped[Student | None] = relationship(back_populates="cards")


class ClassModel(Base):
    """
    Lớp học / môn học.
    """

    __tablename__ = "classes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    class_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    sessions: Mapped[list["ClassSession"]] = relationship(
        back_populates="class_", cascade="all, delete-orphan"
    )
    enrollments: Mapped[list["StudentClass"]] = relationship(
        back_populates="class_", cascade="all, delete-orphan"
    )


class StudentClass(Base):
    """
    Đăng ký sinh viên vào lớp.
    """

    __tablename__ = "student_classes"
    __table_args__ = (
        UniqueConstraint("student_id", "class_id", name="uq_student_class"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("students.id"), nullable=False, index=True
    )
    class_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("classes.id"), nullable=False, index=True
    )

    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="enrolled"
    )

    student: Mapped[Student] = relationship(back_populates="enrollments")
    class_: Mapped[ClassModel] = relationship(back_populates="enrollments")


class ClassSession(Base):
    """
    Buổi học cụ thể của 1 lớp.
    """

    __tablename__ = "class_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    class_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("classes.id"), nullable=False, index=True
    )

    date: Mapped[Date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[Time] = mapped_column(Time, nullable=False)
    end_time: Mapped[Time] = mapped_column(Time, nullable=False)

    late_threshold_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default="scheduled",  # scheduled | ongoing | finished | cancelled
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    class_: Mapped[ClassModel] = relationship(back_populates="sessions")
    attendance_logs: Mapped[list["AttendanceLog"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class AttendanceStatusEnum(str, Enum):  # type: ignore[misc]
    ON_TIME = "on_time"
    LATE = "late"
    ABSENT = "absent"


class AttendanceLog(Base):
    """
    Log điểm danh cho mỗi sinh viên trong từng buổi học.
    Mỗi (student_id, session_id) tối đa 1 bản ghi.
    """

    __tablename__ = "attendance_logs"
    __table_args__ = (
        UniqueConstraint("student_id", "session_id", name="uq_student_session"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("students.id"), nullable=False, index=True
    )
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("class_sessions.id"), nullable=False, index=True
    )

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=AttendanceStatusEnum.ON_TIME.value
    )

    first_scan_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    last_scan_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    note: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(50))

    student: Mapped[Student] = relationship(back_populates="attendance_logs")
    session: Mapped[ClassSession] = relationship(back_populates="attendance_logs")


class ClassTeacherAssignment(Base):
    """
    Phân công giảng viên phụ trách lớp.
    """

    __tablename__ = "class_teacher_assignments"
    __table_args__ = (
        UniqueConstraint("class_id", "teacher_user_id", name="uq_class_teacher"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    class_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("classes.id"), nullable=False, index=True
    )
    teacher_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AttendanceAppeal(Base):
    """
    Khiếu nại điểm danh của sinh viên.
    """

    __tablename__ = "attendance_appeals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("students.id"), nullable=False, index=True
    )
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("class_sessions.id"), nullable=False, index=True
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending")
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class SystemAuditLog(Base):
    """
    Nhật ký hệ thống cho đăng nhập và thao tác chỉnh sửa dữ liệu.
    """

    __tablename__ = "system_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    target_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    details: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class Notification(Base):
    """
    Thông báo cho người dùng hệ thống.
    """

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, server_default="info")  # info, warning, success, error
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

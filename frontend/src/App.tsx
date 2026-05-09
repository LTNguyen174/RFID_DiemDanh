import { useEffect, useMemo, useState } from "react";
import FloatingChatBox from "./components/FloatingChatBox";
import "./components/FloatingChatBox.css";

// Types
type User = {
  id: string;
  username: string;
  role: string;
  full_name?: string;
  email?: string;
};

type LoginResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

type RealtimeEvent = {
  student: {
    id: string;
    student_code: string;
    full_name: string;
  };
  class_: {
    id: number;
    class_code: string;
    name: string;
  };
  session: {
    id: number;
    date: string;
    start_time: string;
    end_time: string;
  };
  attendance: {
    status: string;
    scan_time: string;
  };
};

type AttendanceLogRow = {
  student_code: string;
  full_name: string;
  class_code: string;
  class_name: string;
  status: string;
  scan_time: string;
};

type DashboardToday = {
  date: string;
  total_students: number;
  present: number;
  late: number;
  absent: number;
};

type Student = {
  id: string;
  uid_code: string;
  student_code: string;
  full_name: string;
  sessions?: any[];
};

type StudentTodaySession = {
  class_id: number;
  class_code: string;
  class_name: string;
  session_id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
};

type ClassItem = {
  id: number;
  class_code: string;
  name: string;
  description?: string | null;
  status?: string;
};

type SessionItem = {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
};

function formatTimestamp(ts: string | null): string {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  
  // Hiển thị đầy đủ giờ:phút:giây
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const seconds = d.getSeconds().toString().padStart(2, '0');
  
  return `${hours}:${minutes}:${seconds}`;
}

export default function App() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const user = localStorage.getItem('current_user');
    if (token && user) {
      setAccessToken(token);
      setCurrentUser(JSON.parse(user));
      setIsAuthenticated(true);
    } else {
      setShowLoginModal(true);
    }
  }, []);

  const [activeTab, setActiveTab] = useState<"attendance" | "students" | "classes" | "users" | "schedule" | "profile" | "rfid" | "appeals" | "audit" | "notifications" | "teacher-schedule">(
    currentUser?.role === "student" ? "schedule" : currentUser?.role === "teacher" ? "teacher-schedule" : "attendance",
  );

  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>(() => {
    // Load từ localStorage khi khởi tạo
    try {
      const saved = localStorage.getItem('realtimeEvents');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");

  // Logs & Dashboard
  const [logs, setLogs] = useState<AttendanceLogRow[]>([]);
  const [logsPagination, setLogsPagination] = useState({
    total: 0,
    page: 1,
    page_size: 50,
    total_pages: 0,
    date_range: {
      start_date: "",
      end_date: "",
      week_info: ""
    }
  });
  const [dashboard, setDashboard] = useState<DashboardToday | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);

  const [uidCode, setUidCode] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [createStudentError, setCreateStudentError] = useState<string | null>(null);
  const [createStudentOk, setCreateStudentOk] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStudentCode, setEditStudentCode] = useState("");
  const [editFullName, setEditFullName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);

  // Classes & sessions
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [newClassCode, setNewClassCode] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [newClassDesc, setNewClassDesc] = useState("");
  const [creatingClass, setCreatingClass] = useState(false);

  const [newClassSessions, setNewClassSessions] = useState<{date: string; start_time: string; end_time: string}[]>([
    { date: '', start_time: '', end_time: '' }
  ]);
  const [newClassStudents, setNewClassStudents] = useState<string[]>([]);
  const [showCreateClassModal, setShowCreateClassModal] = useState(false);

  const [showEditClassModal, setShowEditClassModal] = useState(false);
  const [editingClassData, setEditingClassData] = useState<ClassItem | null>(null);
  const [editClassSessions, setEditClassSessions] = useState<{date: string; start_time: string; end_time: string}[]>([]);
  const [editClassStudents, setEditClassStudents] = useState<string[]>([]);
  const [editingClassId, setEditingClassId] = useState<number | null>(null);
  const [editClassName, setEditClassName] = useState("");
  const [editClassDesc, setEditClassDesc] = useState("");
  const [savingClass, setSavingClass] = useState(false);
  const [deletingClassId, setDeletingClassId] = useState<number | null>(null);

  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [newSessionDate, setNewSessionDate] = useState("");
  const [newSessionStart, setNewSessionStart] = useState("");
  const [newSessionEnd, setNewSessionEnd] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);

  const [enrollStudentIds, setEnrollStudentIds] = useState<string[]>([]);
  const [enrolling, setEnrolling] = useState(false);

  const [showClassDetails, setShowClassDetails] = useState(false);
  const [selectedClassForDetails, setSelectedClassForDetails] = useState<ClassItem | null>(null);
  const [classDetailsLoading, setClassDetailsLoading] = useState(false);
  const [classDetailsError, setClassDetailsError] = useState<string | null>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<Student[]>([]);
  const [classSessions, setClassSessions] = useState<SessionItem[]>([]);
  const [allSessions, setAllSessions] = useState<{ [classId: number]: SessionItem[] }>({});
  const [classStatuses, setClassStatuses] = useState<{ [classId: number]: 'not_started' | 'ongoing' | 'ended' }>({});
  const [errorModal, setErrorModal] = useState<{ show: boolean; title: string; message: string }>({ show: false, title: '', message: '' });

  // User management state
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newUserRole, setNewUserRole] = useState("student");
  const [editUserUsername, setEditUserUsername] = useState("");
  const [editUserRole, setEditUserRole] = useState("");
  const [editUserEmail, setEditUserEmail] = useState("");
  const [editUserFullname, setEditUserFullname] = useState("");
  const [newUserFullname, setNewUserFullname] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [updatingUser, setUpdatingUser] = useState(false);
  const [rfidCards, setRfidCards] = useState<any[]>([]);
  const [rfidUid, setRfidUid] = useState("");
  const [rfidStudentId, setRfidStudentId] = useState("");
  const [rfidLoading, setRfidLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilters, setAuditFilters] = useState({
    start_date: "",
    end_date: "",
    action: "",
    target_type: "",
    actor_user_id: ""
  });
  const [appeals, setAppeals] = useState<any[]>([]);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [appealFilters, setAppealFilters] = useState({
    status: "",
    start_date: "",
    end_date: "",
    student_id: ""
  });
  const [myRfidCards, setMyRfidCards] = useState<any[]>([]);
  const [myAppeals, setMyAppeals] = useState<any[]>([]);
  const [mySessions, setMySessions] = useState<any[]>([]);
  const [newAppealSessionId, setNewAppealSessionId] = useState("");
  const [newAppealReason, setNewAppealReason] = useState("");
  const [classTeachers, setClassTeachers] = useState<any[]>([]);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);

  const [showTodaySessionsModal, setShowTodaySessionsModal] = useState(false);
  const [detailStudentName, setDetailStudentName] = useState<string>("");
  const [todaySessions, setTodaySessions] = useState<StudentTodaySession[]>([]);
  const [todaySessionsLoading, setTodaySessionsLoading] = useState(false);
  const [todaySessionsError, setTodaySessionsError] = useState<string | null>(null);

  // Student-specific states
  const [studentProfile, setStudentProfile] = useState<any>(null);
  const [studentProfileLoading, setStudentProfileLoading] = useState(false);
  const [studentProfileError, setStudentProfileError] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    birth_date: "",
    department: "",
    class_name: ""
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: ""
  });
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [weeklySchedule, setWeeklySchedule] = useState<any[]>([]);
  const [weeklyScheduleLoading, setWeeklyScheduleLoading] = useState(false);
  const [weeklyScheduleError, setWeeklyScheduleError] = useState<string | null>(null);

  const [teacherSchedule, setTeacherSchedule] = useState<any[]>([]);
  const [teacherScheduleLoading, setTeacherScheduleLoading] = useState(false);
  const [teacherScheduleError, setTeacherScheduleError] = useState<string | null>(null);

  const [attendanceStats, setAttendanceStats] = useState<any>(null);
  const [attendanceStatsLoading, setAttendanceStatsLoading] = useState(false);
  const [attendanceStatsError, setAttendanceStatsError] = useState<string | null>(null);

  const [weeklyAttendance, setWeeklyAttendance] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshIntervalMs = useMemo(() => 30000, []);

  function showErrorModal(title: string, message: string) {
    setErrorModal({ show: true, title, message });
  }

  function clearRealtimeEvents() {
    setRealtimeEvents([]);
    try {
      localStorage.removeItem('realtimeEvents');
    } catch {
      // Bỏ qua lỗi
    }
  }

  function hideErrorModal() {
    setErrorModal({ show: false, title: '', message: '' });
  }

  function getAuthHeaders(): Record<string, string> {
    if (!accessToken) return {};
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  // User management functions
  async function fetchUsers() {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/users`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setUsersError(errorMessage);
      showErrorModal("Lỗi khi tải danh sách người dùng", errorMessage);
    } finally {
      setUsersLoading(false);
    }
  }

  async function createUser() {
    if (!newUsername.trim()) return;
    setCreatingUser(true);
    try {
      const payload = {
        username: newUsername.trim(),
        role: newUserRole,
        full_name: newUserFullname.trim() || undefined,
        email: newUserEmail.trim() || undefined,
      };
      console.log("Creating user with payload:", payload);
      
      const res = await fetch(`${apiBaseUrl}/api/users`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to create user");
      }
      setNewUsername("");
      setNewUserRole("student");
      setNewUserFullname("");
      setNewUserEmail("");
      setShowCreateUserModal(false);
      await fetchUsers();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi khi tạo người dùng", errorMessage);
      setCreatingUser(false);
    } finally {
      setCreatingUser(false);
    }
  }

  async function updateUser() {
    if (!selectedUser || !editUserUsername.trim()) return;
    setUpdatingUser(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/users/${selectedUser.id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          username: editUserUsername.trim(),
          role: editUserRole,
          full_name: editUserFullname.trim() || undefined,
          email: editUserEmail.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to update user");
      }
      setShowEditUserModal(false);
      setSelectedUser(null);
      await fetchUsers();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi khi cập nhật người dùng", errorMessage);
    } finally {
      setUpdatingUser(false);
    }
  }

  async function deleteUser(userId: string) {
    if (!confirm("Bạn có chắc chắn muốn xóa người dùng này?")) return;
    setUpdatingUser(true); // Changed from setCreatingUser(true) to setUpdatingUser(true)
    try {
      const res = await fetch(`${apiBaseUrl}/api/users/${userId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to delete user");
      }
      await fetchUsers();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi khi xóa người dùng", errorMessage);
    } finally {
      setUpdatingUser(false); // Changed from setCreatingUser(false) to setUpdatingUser(false)
    }
  }

  function openEditUserModal(user: any) {
    setSelectedUser(user);
    setEditUserUsername(user.username);
    // ... (rest of the code remains the same)
    setEditUserRole(user.role);
    setEditUserFullname(user.full_name || "");
    setEditUserEmail(user.email || "");
    setShowEditUserModal(true);
  }

  async function toggleUserActive(userId: string, isActive: boolean) {
    try {
      const res = await fetch(`${apiBaseUrl}/api/users/${userId}/active?is_active=${!isActive}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to update status");
      }
      await fetchUsers();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi khóa/mở tài khoản", errorMessage);
    }
  }

  async function fetchRfidCards() {
    setRfidLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/rfid-cards`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRfidCards(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi tải danh sách thẻ RFID", errorMessage);
    } finally {
      setRfidLoading(false);
    }
  }

  async function createRfidCard() {
    if (!rfidUid.trim()) return;
    setRfidLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/rfid-cards`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ uid: rfidUid.trim() }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to create RFID card");
      }
      setRfidUid("");
      await fetchRfidCards();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi tạo thẻ RFID", errorMessage);
    } finally {
      setRfidLoading(false);
    }
  }

  async function assignRfidCard(cardId: number) {
    if (!rfidStudentId) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/rfid-cards/${cardId}/assign/${rfidStudentId}`, {
        method: "PUT",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRfidCards();
      setRfidStudentId("");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi gán thẻ RFID", errorMessage);
    }
  }

  async function fetchAppeals() {
    setAppealsLoading(true);
    try {
      const params = new URLSearchParams();
      if (appealFilters.status) params.append("status", appealFilters.status);
      if (appealFilters.start_date) params.append("start_date", appealFilters.start_date);
      if (appealFilters.end_date) params.append("end_date", appealFilters.end_date);
      if (appealFilters.student_id) params.append("student_id", appealFilters.student_id);
      
      const url = `${apiBaseUrl}/api/attendance/appeals?${params.toString()}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAppeals(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi tải khiếu nại", errorMessage);
    } finally {
      setAppealsLoading(false);
    }
  }

  async function updateAppeal(appealId: number, status: "approved" | "rejected") {
    try {
      const res = await fetch(`${apiBaseUrl}/api/attendance/appeals/${appealId}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchAppeals();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi cập nhật khiếu nại", errorMessage);
    }
  }

  async function fetchAuditLogs() {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams();
      if (auditFilters.start_date) params.append("start_date", auditFilters.start_date);
      if (auditFilters.end_date) params.append("end_date", auditFilters.end_date);
      if (auditFilters.action) params.append("action", auditFilters.action);
      if (auditFilters.target_type) params.append("target_type", auditFilters.target_type);
      if (auditFilters.actor_user_id) params.append("actor_user_id", auditFilters.actor_user_id);
      
      const url = `${apiBaseUrl}/api/system/audit-logs?${params.toString()}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAuditLogs(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi tải nhật ký hệ thống", errorMessage);
    } finally {
      setAuditLoading(false);
    }
  }

  async function fetchMyRfidCards() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/me/rfid-cards`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMyRfidCards(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi tải thẻ RFID cá nhân", errorMessage);
    }
  }

  async function fetchMySessions() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/me/sessions`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMySessions(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi tải danh sách buổi học", errorMessage);
    }
  }

  async function fetchMyAppeals() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/me/appeals`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMyAppeals(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi tải khiếu nại của bạn", errorMessage);
    }
  }

  async function fetchNotifications(unreadOnly = false) {
    setNotificationsLoading(true);
    try {
      const url = unreadOnly 
        ? `${apiBaseUrl}/api/notifications?unread_only=true`
        : `${apiBaseUrl}/api/notifications`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNotifications(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi tải thông báo", errorMessage);
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function fetchUnreadCount() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/notifications/unread-count`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUnreadCount(data.unread_count || 0);
    } catch (e) {
      // Silently fail for count
    }
  }

  async function markNotificationRead(notificationId: number) {
    try {
      const res = await fetch(`${apiBaseUrl}/api/notifications/${notificationId}/read`, {
        method: "PATCH",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchNotifications();
      await fetchUnreadCount();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi cập nhật thông báo", errorMessage);
    }
  }

  async function markAllNotificationsRead() {
    try {
      const res = await fetch(`${apiBaseUrl}/api/notifications/read-all`, {
        method: "PATCH",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchNotifications();
      await fetchUnreadCount();
      showErrorModal("Thành công", "Đã đọc tất cả thông báo");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi cập nhật thông báo", errorMessage);
    }
  }

  async function createMyAppeal() {
    if (!newAppealSessionId || !newAppealReason.trim()) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/attendance/appeals`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          session_id: Number(newAppealSessionId),
          reason: newAppealReason.trim(),
        }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to create appeal");
      }
      setNewAppealSessionId("");
      setNewAppealReason("");
      await fetchMyAppeals();
      showErrorModal("Thành công", "Đã gửi khiếu nại điểm danh");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi gửi khiếu nại", errorMessage);
    }
  }

  async function fetchClassTeachers(classId: number) {
    try {
      const [teachersRes, usersRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/classes/${classId}/teachers`, { headers: getAuthHeaders() }),
        fetch(`${apiBaseUrl}/api/users`, { headers: getAuthHeaders() }),
      ]);
      if (!teachersRes.ok) throw new Error(`HTTP ${teachersRes.status}`);
      if (!usersRes.ok) throw new Error(`HTTP ${usersRes.status}`);
      const assigned = await teachersRes.json();
      const usersData = await usersRes.json();
      const teachers = usersData.filter((u: any) => u.role === "teacher");
      setClassTeachers(teachers);
      setSelectedTeacherIds(assigned.map((x: any) => x.id));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi tải giảng viên phụ trách", errorMessage);
    }
  }

  async function saveClassTeachers() {
    if (!selectedClassForDetails) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/classes/${selectedClassForDetails.id}/teachers`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ teacher_user_ids: selectedTeacherIds }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to save teacher assignment");
      }
      showErrorModal("Thành công", "Đã lưu phân công giảng viên");
      await fetchClassTeachers(selectedClassForDetails.id);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi lưu phân công giảng viên", errorMessage);
    }
  }

  // Authentication functions
  async function login(username: string, password: string) {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Login failed");
      }
      const data: LoginResponse = await res.json();
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('current_user', JSON.stringify(data.user));
      setAccessToken(data.access_token);
      setCurrentUser(data.user);
      setIsAuthenticated(true);
      setShowLoginModal(false);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Login failed";
      setLoginError(errorMessage);
    } finally {
      setLoginLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('current_user');
    setAccessToken(null);
    setCurrentUser(null);
    setIsAuthenticated(false);
    setShowLoginModal(true);
  }

  // Student-specific functions
  async function fetchStudentProfile() {
    if (!currentUser || currentUser.role !== "student") return;
    setStudentProfileLoading(true);
    setStudentProfileError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/profile`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStudentProfile(data);
      setProfileForm({
        full_name: data.full_name || "",
        email: data.email || "",
        phone: data.phone || "",
        birth_date: data.birth_date || "",
        department: data.department || "",
        class_name: data.class_name || ""
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setStudentProfileError(errorMessage);
      showErrorModal("Lỗi khi tải thông tin sinh viên", errorMessage);
    } finally {
      setStudentProfileLoading(false);
    }
  }

  async function updateStudentProfile() {
    if (!currentUser || currentUser.role !== "student") return;
    setUpdatingProfile(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/profile`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(profileForm)
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to update profile");
      }
      await fetchStudentProfile();
      setEditingProfile(false);
      showErrorModal("Thành công", "Cập nhật thông tin thành công");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi khi cập nhật thông tin", errorMessage);
    } finally {
      setUpdatingProfile(false);
    }
  }

  async function changePassword() {
    if (!currentUser || currentUser.role !== "student") return;
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      showErrorModal("Lỗi", "Mật khẩu mới và xác nhận không khớp");
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/change-password`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password
        })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to change password");
      }
      setPasswordForm({ current_password: "", new_password: "", confirm_password: "" });
      showErrorModal("Thành công", "Đổi mật khẩu thành công");
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      showErrorModal("Lỗi khi đổi mật khẩu", errorMessage);
    } finally {
      setChangingPassword(false);
    }
  }

  async function fetchWeeklySchedule() {
    if (!currentUser || currentUser.role !== "student") return;
    setWeeklyScheduleLoading(true);
    setWeeklyScheduleError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/weekly-schedule`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWeeklySchedule(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setWeeklyScheduleError(errorMessage);
      showErrorModal("Lỗi khi tải thời khóa biểu", errorMessage);
    } finally {
      setWeeklyScheduleLoading(false);
    }
  }

  async function fetchAttendanceStats() {
    if (!currentUser || currentUser.role !== "student") return;
    setAttendanceStatsLoading(true);
    setAttendanceStatsError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/attendance-stats`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAttendanceStats(data);
      setWeeklyAttendance(data.weekly_attendance || []);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setAttendanceStatsError(errorMessage);
      showErrorModal("Lỗi khi tải thống kê điểm danh", errorMessage);
    } finally {
      setAttendanceStatsLoading(false);
    }
  }

  function getAttendanceWarningLevel(percentage: number) {
    if (percentage < 60) return { text: "Nghỉ quá nhiều", color: "text-red-600" };
    if (percentage < 80) return { text: "Cần cải thiện", color: "text-yellow-600" };
    if (percentage < 100) return { text: "Ổn", color: "text-green-600" };
    return { text: "Tốt", color: "text-blue-600" };
  }

  function getSessionStatus(session: SessionItem): 'not_started' | 'ongoing' | 'ended' {
    const now = new Date();
    const sessionStart = new Date(`${session.date}T${session.start_time}`);
    const sessionEnd = new Date(`${session.date}T${session.end_time}`);
    if (now < sessionStart) return 'not_started';
    if (now >= sessionStart && now <= sessionEnd) return 'ongoing';
    return 'ended';
  }

  function getStatusColor(status: 'not_started' | 'ongoing' | 'ended'): string {
    switch (status) {
      case 'not_started': return 'bg-blue-50 text-blue-700 ring-blue-600/20';
      case 'ongoing': return 'bg-green-50 text-green-700 ring-green-600/20';
      case 'ended': return 'bg-gray-50 text-gray-700 ring-gray-600/20';
      default: return 'bg-gray-50 text-gray-700 ring-gray-600/20';
    }
  }

  function formatSessionStatus(status: 'not_started' | 'ongoing' | 'ended'): string {
    switch (status) {
      case 'not_started': return 'Sắp bắt đầu';
      case 'ongoing': return 'Đang diễn ra';
      case 'ended': return 'Đã kết thúc';
      default: return status;
    }
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('vi-VN', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
  }

  async function fetchTeacherSchedule() {
    if (!currentUser || currentUser.role !== "teacher") return;
    setTeacherScheduleLoading(true);
    setTeacherScheduleError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/teachers/weekly-schedule`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTeacherSchedule(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setTeacherScheduleError(errorMessage);
      showErrorModal("Lỗi khi tải thời khóa biểu", errorMessage);
    } finally {
      setTeacherScheduleLoading(false);
    }
  }

  // New class creation functions
  function removeNewClassSession(index: number) {
    setNewClassSessions(newClassSessions.filter((_, i) => i !== index));
  }

  function updateNewClassSession(index: number, field: 'date' | 'start_time' | 'end_time', value: string) {
    const updated = [...newClassSessions];
    updated[index] = { ...updated[index], [field]: value };
    setNewClassSessions(updated);
  }

  function toggleNewClassStudent(studentId: string) {
    setNewClassStudents(prev =>
      prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId]
    );
  }

  function resetNewClassForm() {
    setNewClassCode('');
    setNewClassName('');
    setNewClassDesc('');
    setNewClassSessions([{ date: '', start_time: '', end_time: '' }]);
    setNewClassStudents([]);
  }

  // Edit class functions
  async function openEditClassModal(c: ClassItem) {
    setEditingClassData(c);
    setShowEditClassModal(true);
    try {
      const [sessionsRes, studentsRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/classes/${c.id}/sessions`, { headers: getAuthHeaders() }),
        fetch(`${apiBaseUrl}/api/classes/${c.id}/students`, { headers: getAuthHeaders() })
      ]);
      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json();
        setEditClassSessions(sessionsData.map((s: any) => ({
          date: s.date,
          start_time: s.start_time,
          end_time: s.end_time
        })));
      } else {
        setEditClassSessions([{ date: '', start_time: '', end_time: '' }]);
      }
      if (studentsRes.ok) {
        const studentsData = await studentsRes.json();
        setEditClassStudents(studentsData.map((s: any) => s.id));
      } else {
        setEditClassStudents([]);
      }
    } catch (e) {
      console.error('Failed to fetch class data:', e);
      setEditClassSessions([{ date: '', start_time: '', end_time: '' }]);
      setEditClassStudents([]);
    }
  }

  function addEditClassSession() {
    setEditClassSessions([...editClassSessions, { date: '', start_time: '', end_time: '' }]);
  }

  function removeEditClassSession(index: number) {
    setEditClassSessions(editClassSessions.filter((_, i) => i !== index));
  }

  function updateEditClassSession(index: number, field: 'date' | 'start_time' | 'end_time', value: string) {
    const updated = [...editClassSessions];
    updated[index] = { ...updated[index], [field]: value };
    setEditClassSessions(updated);
  }

  function toggleEditClassStudent(studentId: string) {
    setEditClassStudents(prev =>
      prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId]
    );
  }

  function resetEditClassForm() {
    setEditingClassData(null);
    setEditClassSessions([]);
    setEditClassStudents([]);
  }

  async function saveEditedClass() {
    if (!editingClassData) return;
    setSavingClass(true);
    setClassesError(null);
    try {
      const classRes = await fetch(`${apiBaseUrl}/api/classes/${editingClassData.id}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: editingClassData.name, description: editingClassData.description }),
      });
      if (!classRes.ok) {
        const text = await classRes.text();
        throw new Error(text || `HTTP ${classRes.status}`);
      }
      const existingSessionsRes = await fetch(`${apiBaseUrl}/api/classes/${editingClassData.id}/sessions`, { headers: getAuthHeaders() });
      if (existingSessionsRes.ok) {
        const existingSessions = await existingSessionsRes.json();
        await Promise.all(existingSessions.map((session: any) =>
          fetch(`${apiBaseUrl}/api/sessions/${session.id}`, { method: "DELETE", headers: getAuthHeaders() })
        ));
      }
      const validSessions = editClassSessions.filter(s => s.date && s.start_time && s.end_time);
      const sessionPromises = validSessions.map(session =>
        fetch(`${apiBaseUrl}/api/classes/${editingClassData.id}/sessions`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            date: session.date,
            start_time: session.start_time,
            end_time: session.end_time,
            late_threshold_minutes: 10,
            status: "scheduled",
          }),
        })
      );
      const existingStudentsRes = await fetch(`${apiBaseUrl}/api/classes/${editingClassData.id}/students`, { headers: getAuthHeaders() });
      if (existingStudentsRes.ok) {
        const existingStudents = await existingStudentsRes.json();
        await Promise.all(existingStudents.map((student: any) =>
          fetch(`${apiBaseUrl}/api/classes/${editingClassData.id}/students/${student.id}`, { method: "DELETE", headers: getAuthHeaders() })
        ));
      }
      const studentPromises = editClassStudents.length > 0 ? [
        fetch(`${apiBaseUrl}/api/classes/${editingClassData.id}/students`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ student_ids: editClassStudents }),
        })
      ] : [];
      const allPromises = [...sessionPromises, ...studentPromises];
      if (allPromises.length > 0) {
        const results = await Promise.allSettled(allPromises);
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) throw new Error(`Một số thao tác thất bại: ${failed.length} lỗi`);
      }
      resetEditClassForm();
      setShowEditClassModal(false);
      await fetchClasses();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setClassesError(errorMessage);
      showErrorModal("Lỗi khi cập nhật lớp học", errorMessage);
    } finally {
      setSavingClass(false);
    }
  }

  async function fetchLogsAndDashboard(page: number = 1) {
    setLoading(true);
    setError(null);
    try {
      const [logsRes, dashRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/attendance/logs?page=${page}&page_size=50`, { headers: getAuthHeaders() }),
        fetch(`${apiBaseUrl}/api/dashboard/today`, { headers: getAuthHeaders() }),
      ]);
      if (!logsRes.ok) throw new Error(`Logs HTTP ${logsRes.status}`);
      if (!dashRes.ok) throw new Error(`Dashboard HTTP ${dashRes.status}`);
      const logsResponse = await logsRes.json();
      const dashData = (await dashRes.json()) as DashboardToday;
      
      // API mới trả về object có pagination info
      setLogs(logsResponse.logs.map((l: any) => ({ ...l, scan_time: l.scan_time })));
      setLogsPagination({
        total: logsResponse.total,
        page: logsResponse.page,
        page_size: logsResponse.page_size,
        total_pages: logsResponse.total_pages,
        date_range: logsResponse.date_range
      });
      setDashboard(dashData);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setError(errorMessage);
      showErrorModal("Lỗi khi tải dữ liệu", errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStudents() {
    setStudentsLoading(true);
    setStudentsError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/students`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any[];
      setStudents(data.map((s) => ({
        id: s.id,
        uid_code: s.uid_code,
        student_code: s.student_code,
        full_name: s.full_name,
      })));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setStudentsError(errorMessage);
      showErrorModal("Lỗi khi tải danh sách sinh viên", errorMessage);
    } finally {
      setStudentsLoading(false);
    }
  }

  async function createStudent() {
    setCreatingStudent(true);
    setCreateStudentError(null);
    setCreateStudentOk(null);
    try {
      // Tạo sinh viên trước
      const res = await fetch(`${apiBaseUrl}/api/students`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          uid_code: uidCode.trim(),
          student_code: studentCode.trim(),
          full_name: fullName.trim(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      // Tự động tạo user với username là MSSV và mật khẩu 123456
      let userCreated = false;
      try {
        const userRes = await fetch(`${apiBaseUrl}/api/users`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            username: studentCode.trim(),
            password: "123456",
            role: "student",
            full_name: fullName.trim(),
          }),
        });
        if (userRes.ok) {
          userCreated = true;
        } else {
          const userErrorText = await userRes.text();
          console.warn("Không thể tạo user tự động:", userErrorText);
          // Không throw error ở đây vì sinh viên đã được tạo thành công
        }
      } catch (userError) {
        console.warn("Lỗi khi tạo user tự động:", userError);
        // Không throw error vì sinh viên đã được tạo thành công
      }

      setUidCode("");
      setStudentCode("");
      setFullName("");
      setCreateStudentOk(
        userCreated 
          ? `Đã tạo sinh viên thành công và tài khoản đăng nhập tự động:\nUsername: ${studentCode.trim()}\nMật khẩu: 123456`
          : "Đã tạo sinh viên thành công"
      );
      await fetchStudents();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setCreateStudentError(errorMessage);
      showErrorModal("Lỗi khi tạo sinh viên", errorMessage);
    } finally {
      setCreatingStudent(false);
    }
  }

  function startEdit(s: Student) {
    setEditingId(s.id);
    setEditStudentCode(s.student_code);
    setEditFullName(s.full_name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditStudentCode("");
    setEditFullName("");
  }

  async function saveEdit() {
    if (!editingId) return;
    setSavingEdit(true);
    setStudentsError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_code: editStudentCode.trim(), full_name: editFullName.trim() }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      await fetchStudents();
      cancelEdit();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setStudentsError(errorMessage);
      showErrorModal("Lỗi khi cập nhật sinh viên", errorMessage);
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteStudent(id: string) {
    const ok = window.confirm("Xóa sinh viên này?");
    if (!ok) return;
    setDeletingId(id);
    setStudentsError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/${encodeURIComponent(id)}`, { method: "DELETE", headers: getAuthHeaders() });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      await fetchStudents();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setStudentsError(errorMessage);
      showErrorModal("Lỗi khi xóa sinh viên", errorMessage);
    } finally {
      setDeletingId(null);
    }
  }

  async function loadStudentTodaySessions(s: Student) {
    setDetailStudentName(`${s.student_code} - ${s.full_name}`);
    setTodaySessions([]);
    setTodaySessionsError(null);
    setTodaySessionsLoading(true);
    setShowTodaySessionsModal(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/students/${encodeURIComponent(s.id)}/today-sessions`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as StudentTodaySession[];
      setTodaySessions(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setTodaySessionsError(errorMessage);
      showErrorModal("Lỗi khi tải buổi học hôm nay", errorMessage);
    } finally {
      setTodaySessionsLoading(false);
    }
  }

  async function fetchClasses() {
    setClassesLoading(true);
    setClassesError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/classes`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any[];
      setClasses(data.map((c) => ({
        id: c.id,
        class_code: c.class_code,
        name: c.name,
        description: c.description,
        status: c.status,
      })));
      const statusPromises = data.map(async (c: any) => {
        const status = await getClassStatus(c.id);
        return { classId: c.id, status };
      });
      const statuses = await Promise.all(statusPromises);
      const statusMap = statuses.reduce((acc, { classId, status }) => {
        acc[classId] = status;
        return acc;
      }, {} as { [classId: number]: 'not_started' | 'ongoing' | 'ended' });
      setClassStatuses(statusMap);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setClassesError(errorMessage);
      showErrorModal("Lỗi khi tải danh sách lớp học", errorMessage);
    } finally {
      setClassesLoading(false);
    }
  }

  function startEditClass(c: ClassItem) {
    setEditingClassId(c.id);
    setEditClassName(c.name);
    setEditClassDesc(c.description ?? "");
  }

  function cancelEditClass() {
    setEditingClassId(null);
    setEditClassName("");
    setEditClassDesc("");
  }

  async function saveClass() {
    if (!editingClassId) return;
    setSavingClass(true);
    setClassesError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/classes/${editingClassId}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: editClassName.trim(), description: editClassDesc.trim() || null }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      await fetchClasses();
      cancelEditClass();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setClassesError(errorMessage);
      showErrorModal("Lỗi khi cập nhật lớp học", errorMessage);
    } finally {
      setSavingClass(false);
    }
  }

  async function deleteClass(id: number) {
    const ok = window.confirm("Xóa lớp này?");
    if (!ok) return;
    setDeletingClassId(id);
    setClassesError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/classes/${id}`, { method: "DELETE", headers: getAuthHeaders() });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      if (selectedClassId === id) {
        setSelectedClassId(null);
        setSessions([]);
      }
      await fetchClasses();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setClassesError(errorMessage);
      showErrorModal("Lỗi khi xóa lớp học", errorMessage);
    } finally {
      setDeletingClassId(null);
    }
  }

  async function createClass() {
    setCreatingClass(true);
    setClassesError(null);
    try {
      const classRes = await fetch(`${apiBaseUrl}/api/classes`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          class_code: newClassCode.trim(),
          name: newClassName.trim(),
          description: newClassDesc.trim() || null,
        }),
      });
      if (!classRes.ok) {
        const text = await classRes.text();
        throw new Error(text || `HTTP ${classRes.status}`);
      }
      const classData = await classRes.json();
      const classId = classData.id;
      const validSessions = newClassSessions.filter(s => s.date && s.start_time && s.end_time);
      const sessionPromises = validSessions.map(session =>
        fetch(`${apiBaseUrl}/api/classes/${classId}/sessions`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            date: session.date,
            start_time: session.start_time,
            end_time: session.end_time,
            late_threshold_minutes: 10,
            status: "scheduled",
          }),
        })
      );
      const studentPromises = newClassStudents.length > 0 ? [
        fetch(`${apiBaseUrl}/api/classes/${classId}/students`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ student_ids: newClassStudents }),
        })
      ] : [];
      const allPromises = [...sessionPromises, ...studentPromises];
      if (allPromises.length > 0) {
        const results = await Promise.allSettled(allPromises);
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) throw new Error(`Một số thao tác thất bại: ${failed.length} lỗi`);
      }
      resetNewClassForm();
      setShowCreateClassModal(false);
      await fetchClasses();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setClassesError(errorMessage);
      showErrorModal("Lỗi khi tạo lớp học", errorMessage);
    } finally {
      setCreatingClass(false);
    }
  }

  async function fetchSessionsForClass(classId: number) {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/classes/${classId}/sessions`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any[];
      setSessions(data.map((s) => ({
        id: s.id,
        date: s.date,
        start_time: s.start_time,
        end_time: s.end_time,
        status: s.status,
      })));
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setSessionsError(errorMessage);
      showErrorModal("Lỗi khi tải danh sách buổi học", errorMessage);
    } finally {
      setSessionsLoading(false);
    }
  }

  async function getClassStatus(classId: number): Promise<'not_started' | 'ongoing' | 'ended'> {
    try {
      const res = await fetch(`${apiBaseUrl}/api/classes/${classId}/sessions`, { headers: getAuthHeaders() });
      if (!res.ok) return 'not_started';
      const sessionsData = (await res.json()) as any[];
      if (sessionsData.length === 0) return 'not_started';
      const now = new Date();
      for (const session of sessionsData) {
        const sessionDate = new Date(session.date);
        const [startHours, startMinutes] = session.start_time.split(':').map(Number);
        const [endHours, endMinutes] = session.end_time.split(':').map(Number);
        const startTime = new Date(sessionDate);
        startTime.setHours(startHours, startMinutes, 0, 0);
        const endTime = new Date(sessionDate);
        endTime.setHours(endHours, endMinutes, 0, 0);
        if (now >= startTime && now <= endTime) return 'ongoing';
        if (now < startTime) return 'not_started';
      }
      return 'ended';
    } catch (e) {
      return 'not_started';
    }
  }

  function onSelectClass(id: number) {
    setSelectedClassId(id);
    fetchSessionsForClass(id);
  }

  async function showClassDetailsModal(c: ClassItem) {
    setSelectedClassForDetails(c);
    setShowClassDetails(true);
    setClassDetailsLoading(true);
    setClassDetailsError(null);
    setEnrolledStudents([]);
    setClassSessions([]);
    setClassTeachers([]);
    setSelectedTeacherIds([]);
    try {
      const [studentsRes, sessionsRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/classes/${c.id}/students/attendance`, { headers: getAuthHeaders() }),
        fetch(`${apiBaseUrl}/api/classes/${c.id}/sessions`, { headers: getAuthHeaders() })
      ]);
      if (!studentsRes.ok) throw new Error(`Students HTTP ${studentsRes.status}`);
      if (!sessionsRes.ok) throw new Error(`Sessions HTTP ${sessionsRes.status}`);
      const studentsData = (await studentsRes.json()) as any[];
      const sessionsData = (await sessionsRes.json()) as any[];
      
      // Lưu lại dữ liệu chi tiết để hiển thị
      setEnrolledStudents(studentsData);
      setClassSessions(sessionsData.map((s) => ({
        id: s.id,
        date: s.date,
        start_time: s.start_time,
        end_time: s.end_time,
        status: s.status,
      })));
      if (currentUser?.role === "admin") {
        await fetchClassTeachers(c.id);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setClassDetailsError(errorMessage);
      showErrorModal("Lỗi khi tải chi tiết lớp học", errorMessage);
    } finally {
      setClassDetailsLoading(false);
    }
  }

  async function createSession() {
    if (!selectedClassId) return;
    setCreatingSession(true);
    setSessionsError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/classes/${selectedClassId}/sessions`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          date: newSessionDate,
          start_time: newSessionStart,
          end_time: newSessionEnd,
          late_threshold_minutes: 10,
          status: "scheduled",
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 409) {
          try {
            const errorData = JSON.parse(text);
            throw new Error(errorData.detail || "Trùng thời gian. Vui lòng chọn khung giờ khác.");
          } catch {
            throw new Error("Trùng thời gian. Vui lòng chọn khung giờ khác.");
          }
        }
        throw new Error(text || `HTTP ${res.status}`);
      }
      setNewSessionDate("");
      setNewSessionStart("");
      setNewSessionEnd("");
      await fetchSessionsForClass(selectedClassId);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setSessionsError(errorMessage);
      showErrorModal("Lỗi khi tạo buổi học", errorMessage);
    } finally {
      setCreatingSession(false);
    }
  }

  function toggleEnrollStudent(id: string) {
    setEnrollStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function enrollStudents() {
    if (!selectedClassId || enrollStudentIds.length === 0) return;
    setEnrolling(true);
    setSessionsError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/classes/${selectedClassId}/students`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ student_ids: enrollStudentIds }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setEnrollStudentIds([]);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setSessionsError(errorMessage);
      showErrorModal("Lỗi khi gán sinh viên", errorMessage);
    } finally {
      setEnrolling(false);
    }
  }

  function exportCsv() {
    if (logs.length === 0) return;
    const header = ["student_code", "full_name", "class_code", "class_name", "status", "scan_time"];
    const rows = logs.map((r) => [r.student_code, r.full_name, r.class_code, r.class_name, r.status, r.scan_time]);
    const csv = [header, ...rows].map((cols) =>
      cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    ).join("\r\n") + "\r\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (accessToken && currentUser) {
      fetchLogsAndDashboard();
      const t = window.setInterval(fetchLogsAndDashboard, refreshIntervalMs);
      return () => window.clearInterval(t);
    }
  }, [refreshIntervalMs, accessToken, currentUser]);

  useEffect(() => {
    if (activeTab === "students" && currentUser?.role === "admin") {
      fetchStudents();
    } else if (activeTab === "classes") {
      fetchClasses();
      fetchStudents();
    } else if (activeTab === "users" && currentUser?.role === 'admin') {
      fetchUsers();
    } else if (activeTab === "rfid" && currentUser?.role === "admin") {
      fetchRfidCards();
      fetchStudents();
    } else if (activeTab === "appeals" && currentUser && currentUser.role !== "student") {
      fetchAppeals();
    } else if (activeTab === "audit" && currentUser?.role === "admin") {
      fetchAuditLogs();
    } else if (activeTab === "schedule" && currentUser?.role === 'student') {
      fetchWeeklySchedule();
    } else if (activeTab === "teacher-schedule" && currentUser?.role === 'teacher') {
      fetchTeacherSchedule();
    } else if (activeTab === "profile" && currentUser?.role === 'student') {
      fetchStudentProfile();
    } else if (activeTab === "attendance" && currentUser?.role === 'student') {
      fetchAttendanceStats();
      fetchMyRfidCards();
      fetchMySessions();
      fetchMyAppeals();
    } else if (activeTab === "notifications" && currentUser) {
      fetchNotifications();
      fetchUnreadCount();
    }
  }, [activeTab, currentUser]);

  useEffect(() => {
    const wsUrl = apiBaseUrl.replace(/^http/, "ws") + "/ws/attendance";
    const ws = new WebSocket(wsUrl);
    setWsStatus("connecting");
    ws.onopen = () => setWsStatus("open");
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "attendance_scanned" && msg.data) {
          const ev = msg.data as RealtimeEvent;
          setRealtimeEvents((prev) => {
            const updated = [ev, ...prev].slice(0, 20); // Chỉ giữ 20 bản ghi gần nhất
            // Lưu vào localStorage
            try {
              localStorage.setItem('realtimeEvents', JSON.stringify(updated));
            } catch {
              // Bỏ qua nếu localStorage đầy
            }
            return updated;
          });
        }
      } catch { }
    };
    ws.onerror = () => setWsStatus("error");
    ws.onclose = () => setWsStatus("closed");
    return () => ws.close();
  }, [apiBaseUrl]);

  useEffect(() => {
    if (currentUser?.role !== 'student') return;
    
    const token = localStorage.getItem('access_token');
    if (!token) {
      console.log('No token found for WebSocket connection');
      return;
    }

    const wsUrl = apiBaseUrl.replace(/^http/, "ws") + `/ws/student-countdown?token=${token}`;
    console.log('Connecting to countdown WebSocket:', wsUrl);
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('Countdown WebSocket connected successfully');
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('Countdown WebSocket message:', msg);
        
        if (msg.type === "countdown_update" && msg.data) {
          setWeeklySchedule((prev) => {
            if (!prev) return prev;
            
            return prev.map(session => {
              const countdownData = msg.data.find((item: any) => 
                item.class_code === session.class_code && 
                item.start_time === session.start_time
              );
              
              if (countdownData) {
                console.log('Updating countdown for session:', session.class_code, countdownData.countdown);
                return {
                  ...session,
                  countdown: countdownData.countdown,
                  status: countdownData.status
                };
              }
              return session;
            });
          });
        } else if (msg.error) {
          console.error('Countdown WebSocket error:', msg.error);
        }
      } catch (error) {
        console.error('Error parsing countdown WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('Countdown WebSocket error:', error);
    };
    
    ws.onclose = (event) => {
      console.log('Countdown WebSocket closed:', event.code, event.reason);
    };
    
    return () => {
      console.log('Closing countdown WebSocket');
      ws.close();
    };
  }, [apiBaseUrl, currentUser]);

  // Fallback: Client-side countdown timer (updates every second)
  useEffect(() => {
    if (currentUser?.role !== 'student') return;
    
    const interval = setInterval(() => {
      setWeeklySchedule((prev) => {
        if (!prev) return prev;
        
        return prev.map(session => {
          // Calculate countdown on client side
          const now = new Date();
          const sessionDate = new Date(session.date);
          const [hours, minutes, seconds] = session.start_time.split(':').map(Number);
          const sessionDateTime = new Date(sessionDate);
          sessionDateTime.setHours(hours, minutes, seconds || 0, 0);
          
          let countdown = "Đã bắt đầu";
          let status = "ended";
          
          if (sessionDateTime > now) {
            const timeDiff = sessionDateTime.getTime() - now.getTime();
            const h = Math.floor(timeDiff / (1000 * 60 * 60));
            const m = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((timeDiff % (1000 * 60)) / 1000);
            countdown = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            status = "upcoming";
          } else if (sessionDateTime.getTime() + 10 * 60 * 1000 > now.getTime()) {
            countdown = "10:00";
            status = "ongoing";
          }
          
          return {
            ...session,
            countdown,
            status
          };
        });
      });
    }, 1000); // Update every second
    
    return () => clearInterval(interval);
  }, [currentUser]);

  const totalScans = logs.length;
  const presentCount = dashboard?.present ?? 0;
  const absentCount = dashboard?.absent ?? 0;
  const lateCount = dashboard?.late ?? 0;

  // Reusable attendance stats cards for student
  const renderStudentAttendanceTab = () => (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Tỷ lệ điểm danh</div>
          <div className="mt-2 text-lg font-semibold">
            {attendanceStats?.attendance_percentage ? `${attendanceStats.attendance_percentage}%` : "N/A"}
          </div>
          {attendanceStats?.attendance_percentage && (
            <div className={`mt-2 text-sm font-medium ${getAttendanceWarningLevel(attendanceStats.attendance_percentage).color}`}>
              {getAttendanceWarningLevel(attendanceStats.attendance_percentage).text}
            </div>
          )}
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Điểm danh đúng giờ</div>
          <div className="mt-2 text-lg font-semibold text-emerald-700">{attendanceStats?.on_time_count || 0}</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Đi trễ</div>
          <div className="mt-2 text-lg font-semibold text-orange-600">{attendanceStats?.late_count || 0}</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Vắng mặt</div>
          <div className="mt-2 text-lg font-semibold text-red-600">{attendanceStats?.absent_count || 0}</div>
        </div>
      </div>
      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Lịch sử điểm danh 1 tuần qua</h2>
          <p className="text-xs text-slate-500">Chi tiết điểm danh theo các môn học</p>
        </div>
        {attendanceStatsLoading ? (
          <div className="px-4 py-3 text-xs text-slate-500">Đang tải...</div>
        ) : attendanceStatsError ? (
          <div className="px-4 py-3 text-sm text-red-700">Lỗi: {attendanceStatsError}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Ngày</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Mã lớp</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Tên lớp</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Trạng thái</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {weeklyAttendance.map((record, index) => (
                  <tr key={index} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-900">{record.date}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{record.class_code}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{record.class_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${
                        record.status === 'on_time' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                        : record.status === 'late' ? 'bg-orange-50 text-orange-700 ring-orange-600/20'
                        : record.status === 'not_started' ? 'bg-blue-50 text-blue-700 ring-blue-600/20'
                        : 'bg-slate-50 text-slate-600 ring-slate-500/20'
                      }`}>
                        {record.status === 'on_time' ? 'Đúng giờ' : record.status === 'late' ? 'Đi trễ' : record.status === 'not_started' ? 'Chưa đến giờ' : 'Vắng'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{record.scan_time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-white">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Thẻ RFID của bạn</h3>
          </div>
          <div className="px-4 py-3">
            {myRfidCards.length === 0 ? (
              <div className="text-xs text-slate-500">Chưa có thẻ RFID nào được gán.</div>
            ) : (
              <ul className="space-y-2">
                {myRfidCards.map((card) => (
                  <li key={card.id} className="rounded border px-3 py-2 text-sm">
                    <div className="font-medium">{card.uid}</div>
                    <div className="text-xs text-slate-600">Trạng thái: {card.is_active ? "Hoạt động" : "Đã khóa"}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="rounded-lg border bg-white">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Khiếu nại điểm danh</h3>
          </div>
          <div className="space-y-3 px-4 py-3">
            <select
              value={newAppealSessionId}
              onChange={(e) => setNewAppealSessionId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              <option value="">-- Chọn buổi học --</option>
              {mySessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.display_name}
                </option>
              ))}
            </select>
            <textarea
              value={newAppealReason}
              onChange={(e) => setNewAppealReason(e.target.value)}
              placeholder="Nhập lý do khiếu nại..."
              className="h-24 w-full rounded-md border px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={createMyAppeal}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Gửi khiếu nại
            </button>
            <div className="pt-2 text-xs font-semibold text-slate-600">Lịch sử khiếu nại</div>
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {myAppeals.map((a) => (
                <div key={a.id} className="rounded border px-2 py-1 text-xs">
                  <div>Session #{a.session_id} - <span className="font-medium">{a.status}</span></div>
                  <div className="text-slate-500">{a.reason}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Reusable realtime + dashboard for admin/teacher
  const renderAdminAttendanceTab = () => (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">WebSocket</div>
          <div className="mt-2 text-lg font-semibold">
            {wsStatus === "open" ? "Online" : wsStatus === "connecting" ? "Đang kết nối..." : "Mất kết nối"}
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Đã quét hôm nay</div>
          <div className="mt-2 text-lg font-semibold">{totalScans}</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Có mặt</div>
          <div className="mt-2 text-lg font-semibold text-emerald-700">{presentCount}</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Đi trễ / Vắng</div>
          <div className="mt-2 text-lg font-semibold">
            <span className="text-orange-600 mr-2">{lateCount} trễ</span>
            <span className="text-slate-700">{absentCount} vắng</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white">
        <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Quét gần đây (Real-time)</h2>
            <p className="text-xs text-slate-500">Cập nhật ngay khi ESP32 gửi lên (tối đa 20 bản ghi mới nhất)</p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
              wsStatus === "open" ? "bg-green-100 text-green-700" :
              wsStatus === "connecting" ? "bg-yellow-100 text-yellow-700" :
              wsStatus === "error" ? "bg-red-100 text-red-700" :
              "bg-slate-100 text-slate-700"
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                wsStatus === "open" ? "bg-green-500" :
                wsStatus === "connecting" ? "bg-yellow-500" :
                wsStatus === "error" ? "bg-red-500" :
                "bg-slate-500"
              }`}></div>
              {wsStatus === "open" ? "Đã kết nối" :
               wsStatus === "connecting" ? "Đang kết nối" :
               wsStatus === "error" ? "Lỗi kết nối" :
               "Chưa kết nối"}
            </div>
            <button
              type="button"
              onClick={clearRealtimeEvents}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              Xóa
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Mã SV</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Họ và Tên</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Lớp</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Trạng thái</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Thời gian</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {realtimeEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    <div className="flex flex-col items-center space-y-2">
                      <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center">
                        📡
                      </div>
                      <div>Chưa có dữ liệu quét nào</div>
                      <div className="text-xs text-slate-400">
                        {wsStatus === "connecting" ? "Đang kết nối..." : 
                         wsStatus === "error" ? "Lỗi kết nối" : 
                         wsStatus === "closed" ? "Đã ngắt kết nối" :
                         "Chờ sinh viên quét thẻ..."}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                realtimeEvents.map((e, idx) => {
                  const badgeClass = e.attendance.status === "on_time"
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                    : e.attendance.status === "late"
                    ? "bg-orange-50 text-orange-700 ring-orange-600/20"
                    : "bg-slate-50 text-slate-600 ring-slate-500/20";
                  return (
                    <tr key={`${e.student.id}-${e.session.id}-${idx}`} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-900">{e.student.student_code}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{e.student.full_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{e.class_.class_code}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${badgeClass}`}>
                          {e.attendance.status === "on_time" ? "Đúng giờ" : e.attendance.status === "late" ? "Đi trễ" : e.attendance.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{formatTimestamp(e.attendance.scan_time)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border bg-white">
        <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Lịch sử điểm danh tuần hiện tại</h2>
            <p className="text-xs text-slate-500">
              {logsPagination.date_range?.week_info || "Từ Thứ Hai đến Chủ Nhật"}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => fetchLogsAndDashboard(1)}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Làm mới
            </button>
            <button type="button" onClick={exportCsv}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500">
              Xuất CSV
            </button>
          </div>
        </div>
        {error ? <div className="px-4 py-3 text-sm text-red-700">Lỗi: {error}</div> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Mã SV</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Họ và Tên</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Lớp</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Trạng thái</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Thời gian quét</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((r, idx) => {
                const badgeClass = r.status === "on_time"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                  : r.status === "late"
                  ? "bg-orange-50 text-orange-700 ring-orange-600/20"
                  : "bg-slate-50 text-slate-600 ring-slate-500/20";
                return (
                  <tr key={`${r.student_code}-${r.scan_time}-${idx}`} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-900">{r.student_code}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{r.full_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{r.class_code}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${badgeClass}`}>
                        {r.status === "on_time" ? "Đúng giờ" : r.status === "late" ? "Đi trễ" : r.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{formatTimestamp(r.scan_time)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {logsPagination.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-xs text-slate-500">
              Hiển thị {logs.length} / {logsPagination.total} bản ghi
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchLogsAndDashboard(logsPagination.page - 1)}
                disabled={logsPagination.page <= 1}
                className="px-2 py-1 text-xs rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Trước
              </button>
              <span className="text-xs text-slate-600">
                Trang {logsPagination.page} / {logsPagination.total_pages}
              </span>
              <button
                onClick={() => fetchLogsAndDashboard(logsPagination.page + 1)}
                disabled={logsPagination.page >= logsPagination.total_pages}
                className="px-2 py-1 text-xs rounded border disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                Sau
              </button>
            </div>
          </div>
        )}
        
        <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
          <div>{loading ? "Đang tải..." : `Tổng số bản ghi: ${logsPagination.total}`}</div>
          <div>Backend: {apiBaseUrl}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Hệ thống Điểm danh Sinh viên Real-time
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Monitoring real-time từ ESP32 RFID + Dashboard thống kê hôm nay
              </p>
            </div>
            {isAuthenticated && currentUser && (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-sm font-medium text-slate-900">
                    {currentUser.full_name || currentUser.username}
                  </div>
                  <div className="text-xs text-slate-600">
                    {currentUser.role === 'admin' ? 'Admin' : currentUser.role === 'teacher' ? 'Giảng viên' : 'Sinh viên'}
                  </div>
                </div>
                <button type="button" onClick={logout}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500">
                  Đăng xuất
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            {currentUser?.role === 'student' ? (
              <>
                <button type="button" onClick={() => setActiveTab("schedule")}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "schedule" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                  Thời khóa biểu
                </button>
                <button type="button" onClick={() => setActiveTab("attendance")}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "attendance" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                  Điểm danh
                </button>
                <button type="button" onClick={() => setActiveTab("notifications")}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "notifications" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                  Thông báo {unreadCount > 0 && <span className="ml-1 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{unreadCount}</span>}
                </button>
                <button type="button" onClick={() => setActiveTab("profile")}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "profile" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                  Thông tin cá nhân
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setActiveTab("attendance")}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "attendance" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                  Real-time & Dashboard
                </button>
                {currentUser?.role === 'admin' && (
                  <button type="button" onClick={() => setActiveTab("students")}
                    className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "students" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                    Sinh viên
                  </button>
                )}
                <button type="button" onClick={() => setActiveTab("classes")}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "classes" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                  Lớp học
                </button>
                {currentUser?.role === 'teacher' && (
                  <button type="button" onClick={() => setActiveTab("teacher-schedule")}
                    className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "teacher-schedule" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                    Thời khóa biểu
                  </button>
                )}
                {currentUser?.role === 'admin' && (
                  <button type="button" onClick={() => setActiveTab("users")}
                    className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "users" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                    Quản lý người dùng
                  </button>
                )}
                {currentUser?.role === 'admin' && (
                  <button type="button" onClick={() => setActiveTab("rfid")}
                    className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "rfid" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                    Thẻ RFID
                  </button>
                )}
                {currentUser?.role !== 'student' && (
                  <button type="button" onClick={() => setActiveTab("appeals")}
                    className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "appeals" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                    Khiếu nại
                  </button>
                )}
                {currentUser?.role === 'admin' && (
                  <button type="button" onClick={() => setActiveTab("audit")}
                    className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === "audit" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                    Nhật ký
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* ── ATTENDANCE TAB ── */}
        {activeTab === "attendance" && (
          currentUser?.role === 'student' ? renderStudentAttendanceTab() : renderAdminAttendanceTab()
        )}

        {/* ── SCHEDULE TAB (student only) ── */}
        {activeTab === "schedule" && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Thời khóa biểu tuần</h2>
                <p className="text-xs text-slate-500">Lịch học trong tuần và thời gian đếm ngược</p>
              </div>
              {weeklyScheduleLoading ? (
                <div className="px-4 py-3 text-xs text-slate-500">Đang tải...</div>
              ) : weeklyScheduleError ? (
                <div className="px-4 py-3 text-sm text-red-700">Lỗi: {weeklyScheduleError}</div>
              ) : weeklySchedule.length === 0 ? (
                <div className="px-4 py-3 text-xs text-slate-500">Không có lịch học trong tuần.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Thứ</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Mã lớp</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Tên lớp</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Thời gian</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Đếm ngược</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {weeklySchedule.map((session, index) => (
                        <tr key={index} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-900">{session.day_of_week}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{session.class_code}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{session.class_name}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{session.start_time} - {session.end_time}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{session.countdown}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm">
                            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${
                              session.status === 'ongoing' ? 'bg-green-50 text-green-700 ring-green-600/20'
                              : session.status === 'upcoming' ? 'bg-blue-50 text-blue-700 ring-blue-600/20'
                              : 'bg-gray-50 text-gray-700 ring-gray-600/20'
                            }`}>
                              {session.status === 'ongoing' ? 'Đang diễn ra' : session.status === 'upcoming' ? 'Sắp bắt đầu' : 'Đã kết thúc'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── NOTIFICATIONS TAB (student only) ── */}
        {activeTab === "notifications" && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Thông báo</h2>
                    <p className="text-xs text-slate-500">Các thông báo và cập nhật hệ thống</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fetchNotifications(true)}
                      className={`rounded-md px-3 py-1 text-xs font-medium ${
                        notificationsLoading ? "bg-gray-100 text-gray-400" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                      disabled={notificationsLoading}
                    >
                      Chưa đọc
                    </button>
                    <button
                      type="button"
                      onClick={() => fetchNotifications(false)}
                      className={`rounded-md px-3 py-1 text-xs font-medium ${
                        notificationsLoading ? "bg-gray-100 text-gray-400" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                      disabled={notificationsLoading}
                    >
                      Tất cả
                    </button>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllNotificationsRead}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Đọc tất cả
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {notificationsLoading ? (
                <div className="px-4 py-3 text-xs text-slate-500">Đang tải...</div>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-3 text-xs text-slate-500">Không có thông báo.</div>
              ) : (
                <div className="divide-y">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`px-4 py-3 hover:bg-slate-50 ${
                        !notification.is_read ? "bg-blue-50 border-l-4 border-l-blue-500" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className={`text-sm font-medium ${
                              !notification.is_read ? "text-slate-900" : "text-slate-700"
                            }`}>
                              {notification.title}
                            </h3>
                            {!notification.is_read && (
                              <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                                Mới
                              </span>
                            )}
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              notification.type === 'error' ? 'bg-red-100 text-red-800' :
                              notification.type === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                              notification.type === 'success' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {notification.type === 'error' ? 'Lỗi' :
                               notification.type === 'warning' ? 'Cảnh báo' :
                               notification.type === 'success' ? 'Thành công' :
                               'Thông tin'}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{notification.message}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            {formatTimestamp(notification.created_at)}
                          </p>
                        </div>
                        {!notification.is_read && (
                          <button
                            type="button"
                            onClick={() => markNotificationRead(notification.id)}
                            className="ml-3 rounded-md bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
                          >
                            Đánh dấu đã đọc
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PROFILE TAB (student only) ── */}
        {activeTab === "profile" && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Thông tin cá nhân</h2>
                <p className="text-xs text-slate-500">Xem và chỉnh sửa thông tin sinh viên</p>
              </div>
              {studentProfileLoading ? (
                <div className="px-4 py-3 text-xs text-slate-500">Đang tải...</div>
              ) : studentProfileError ? (
                <div className="px-4 py-3 text-sm text-red-700">Lỗi: {studentProfileError}</div>
              ) : studentProfile ? (
                <div className="px-4 py-3">
                  {editingProfile ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="text-xs font-medium text-slate-700">Mã sinh viên</label>
                          <input type="text" value={studentProfile.student_code} disabled
                            className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-gray-100 outline-none" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-700">Họ và tên</label>
                          <input type="text" value={profileForm.full_name}
                            onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-700">Email</label>
                          <input type="email" value={profileForm.email}
                            onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-700">Số điện thoại</label>
                          <input type="tel" value={profileForm.phone}
                            onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-700">Ngày sinh</label>
                          <input type="date" value={profileForm.birth_date}
                            onChange={(e) => setProfileForm({ ...profileForm, birth_date: e.target.value })}
                            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-700">Khoa</label>
                          <input type="text" value={profileForm.department}
                            onChange={(e) => setProfileForm({ ...profileForm, department: e.target.value })}
                            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-700">Lớp</label>
                          <input type="text" value={profileForm.class_name}
                            onChange={(e) => setProfileForm({ ...profileForm, class_name: e.target.value })}
                            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                        <button type="button" onClick={() => setEditingProfile(false)}
                          className="rounded-md bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-500">
                          Hủy
                        </button>
                        <button type="button" disabled={updatingProfile} onClick={updateStudentProfile}
                          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                          {updatingProfile ? "Đang lưu..." : "Lưu thay đổi"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <span className="text-xs font-medium text-slate-700">Mã sinh viên</span>
                          <p className="mt-1 text-sm text-slate-900">{studentProfile.student_code}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-slate-700">Họ và tên</span>
                          <p className="mt-1 text-sm text-slate-900">{studentProfile.full_name}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-slate-700">Email</span>
                          <p className="mt-1 text-sm text-slate-900">{studentProfile.email || "Chưa cập nhật"}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-slate-700">Số điện thoại</span>
                          <p className="mt-1 text-sm text-slate-900">{studentProfile.phone || "Chưa cập nhật"}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-slate-700">Ngày sinh</span>
                          <p className="mt-1 text-sm text-slate-900">{studentProfile.birth_date || "Chưa cập nhật"}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-slate-700">Khoa</span>
                          <p className="mt-1 text-sm text-slate-900">{studentProfile.department || "Chưa cập nhật"}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-slate-700">Lớp</span>
                          <p className="mt-1 text-sm text-slate-900">{studentProfile.class_name || "Chưa cập nhật"}</p>
                        </div>
                      </div>
                      <div className="flex justify-end pt-4">
                        <button type="button" onClick={() => setEditingProfile(true)}
                          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                          Chỉnh sửa thông tin
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Password Change Section */}
            <div className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Đổi mật khẩu</h2>
                <p className="text-xs text-slate-500">Thay đổi mật khẩu đăng nhập</p>
              </div>
              <div className="px-4 py-3 space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-700">Mật khẩu hiện tại</label>
                  <input type="password" value={passwordForm.current_password}
                    onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Mật khẩu mới</label>
                  <input type="password" value={passwordForm.new_password}
                    onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Xác nhận mật khẩu mới</label>
                  <input type="password" value={passwordForm.confirm_password}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                </div>
                <div className="flex justify-end">
                  <button type="button"
                    disabled={changingPassword || !passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password}
                    onClick={changePassword}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                    {changingPassword ? "Đang đổi..." : "Đổi mật khẩu"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STUDENTS TAB ── */}
        {activeTab === "students" && currentUser?.role === "admin" && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Thêm sinh viên</h2>
                <p className="text-xs text-slate-500">Đăng ký UID thẻ RFID cho sinh viên</p>
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-4">
                <div>
                  <label className="text-xs font-medium text-slate-700">UID Code</label>
                  <input value={uidCode} onChange={(e) => setUidCode(e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                    placeholder="04A1B2C3D4" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Mã sinh viên</label>
                  <input value={studentCode} onChange={(e) => setStudentCode(e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                    placeholder="SV001" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Họ và tên</label>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                    placeholder="Nguyễn Văn A" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
                <button type="button"
                  disabled={creatingStudent || !uidCode.trim() || !studentCode.trim() || !fullName.trim()}
                  onClick={createStudent}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                  {creatingStudent ? "Đang tạo..." : "Tạo sinh viên"}
                </button>
                {createStudentOk ? <div className="text-sm text-emerald-700">{createStudentOk}</div> : null}
                {createStudentError ? <div className="text-sm text-red-700">Lỗi: {createStudentError}</div> : null}
              </div>
            </div>

            <div className="rounded-lg border bg-white">
              <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Danh sách sinh viên</h2>
                  <p className="text-xs text-slate-500">CRUD: tạo / sửa / xóa</p>
                </div>
                <button type="button" onClick={fetchStudents}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                  Làm mới
                </button>
              </div>
              {studentsError ? <div className="px-4 py-3 text-sm text-red-700">Lỗi: {studentsError}</div> : null}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">UID</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Mã SV</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Họ và tên</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {students.map((s) => {
                      const isEditing = editingId === s.id;
                      return (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{s.uid_code}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-900">
                            {isEditing ? (
                              <input value={editStudentCode} onChange={(e) => setEditStudentCode(e.target.value)}
                                className="w-full rounded-md border px-2 py-1 text-sm outline-none focus:border-slate-900" />
                            ) : s.student_code}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {isEditing ? (
                              <input value={editFullName} onChange={(e) => setEditFullName(e.target.value)}
                                className="w-full rounded-md border px-2 py-1 text-sm outline-none focus:border-slate-900" />
                            ) : s.full_name}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                            {isEditing ? (
                              <div className="flex justify-end gap-2">
                                <button type="button"
                                  disabled={savingEdit || !editStudentCode.trim() || !editFullName.trim()}
                                  onClick={saveEdit}
                                  className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300">
                                  {savingEdit ? "Đang lưu..." : "Lưu"}
                                </button>
                                <button type="button" disabled={savingEdit} onClick={cancelEdit}
                                  className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => loadStudentTodaySessions(s)}
                                  className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                                  Lớp hôm nay
                                </button>
                                <button type="button" onClick={() => startEdit(s)}
                                  className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                                  Sửa
                                </button>
                                <button type="button" disabled={deletingId === s.id} onClick={() => deleteStudent(s.id)}
                                  className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:bg-red-300">
                                  {deletingId === s.id ? "Đang xóa..." : "Xóa"}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
                <div>{studentsLoading ? "Đang tải..." : `Tổng số: ${students.length}`}</div>
                <div>Backend: {apiBaseUrl}</div>
              </div>
            </div>
          </div>
        )}

        {/* ── CLASSES TAB ── */}
        {activeTab === "classes" && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Tạo lớp học</h2>
                <p className="text-xs text-slate-500">Tạo lớp học với lịch học và sinh viên</p>
              </div>
              <div className="p-4">
                <button type="button" onClick={() => setShowCreateClassModal(true)}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                  Tạo lớp học
                </button>
              </div>
            </div>

            <div className="rounded-lg border bg-white">
              <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Danh sách lớp</h2>
                  <p className="text-xs text-slate-500">Quản lý lớp học và xem chi tiết</p>
                </div>
                <button type="button" onClick={fetchClasses}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                  Làm mới
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Mã lớp</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Tên lớp</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Mô tả</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Trạng thái</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {classes.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-900">{c.class_code}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                          {editingClassId === c.id ? (
                            <input value={editClassName} onChange={(e) => setEditClassName(e.target.value)}
                              className="w-full rounded-md border px-2 py-1 text-sm outline-none focus:border-slate-900" />
                          ) : c.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {editingClassId === c.id ? (
                            <input value={editClassDesc} onChange={(e) => setEditClassDesc(e.target.value)}
                              className="w-full rounded-md border px-2 py-1 text-sm outline-none focus:border-slate-900" />
                          ) : (c.description || "-")}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-slate-600">
                          {(() => {
                            const status = classStatuses[c.id] || 'not_started';
                            if (status === 'ongoing') return <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset bg-green-50 text-green-700 ring-green-600/20">Đang diễn ra</span>;
                            if (status === 'ended') return <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset bg-gray-50 text-gray-700 ring-gray-600/20">Đã kết thúc</span>;
                            return <span className="inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset bg-blue-50 text-blue-700 ring-blue-600/20">Chưa bắt đầu</span>;
                          })()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                          {editingClassId === c.id ? (
                            <div className="flex justify-end gap-2">
                              <button type="button" disabled={savingClass || !editClassName.trim()} onClick={saveClass}
                                className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300">
                                {savingClass ? "Đang lưu..." : "Lưu"}
                              </button>
                              <button type="button" disabled={savingClass} onClick={cancelEditClass}
                                className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                                Hủy
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={() => showClassDetailsModal(c)}
                                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">
                                Chi tiết
                              </button>
                              <button type="button" onClick={() => openEditClassModal(c)}
                                className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                                Sửa
                              </button>
                              <button type="button" disabled={deletingClassId === c.id} onClick={() => deleteClass(c.id)}
                                className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:bg-red-300">
                                {deletingClassId === c.id ? "Đang xóa..." : "Xóa"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
                <div>{classesLoading ? "Đang tải..." : `Tổng số lớp: ${classes.length}`}</div>
                <div>Backend: {apiBaseUrl}</div>
              </div>
            </div>

            {selectedClassId && (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="rounded-lg border bg-white">
                  <div className="border-b px-4 py-3">
                    <h2 className="text-sm font-semibold text-slate-900">Tạo buổi học cho lớp đang chọn</h2>
                    <p className="text-xs text-slate-500">Chọn ngày và khung giờ</p>
                  </div>
                  <div className="grid gap-3 p-4">
                    <div>
                      <label className="text-xs font-medium text-slate-700">Ngày học</label>
                      <input type="date" value={newSessionDate} onChange={(e) => setNewSessionDate(e.target.value)}
                        className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700">Giờ bắt đầu</label>
                        <input type="time" value={newSessionStart} onChange={(e) => setNewSessionStart(e.target.value)}
                          className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700">Giờ kết thúc</label>
                        <input type="time" value={newSessionEnd} onChange={(e) => setNewSessionEnd(e.target.value)}
                          className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-t px-4 py-3">
                    <button type="button"
                      disabled={creatingSession || !newSessionDate || !newSessionStart || !newSessionEnd}
                      onClick={createSession}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                      {creatingSession ? "Đang tạo..." : "Tạo buổi học"}
                    </button>
                  </div>
                  <div className="border-t px-4 py-3">
                    <h3 className="text-xs font-semibold text-slate-700">Danh sách buổi học của lớp</h3>
                  </div>
                  <div className="max-h-64 overflow-y-auto px-4 pb-4">
                    {sessionsLoading ? (
                      <div className="text-xs text-slate-500">Đang tải...</div>
                    ) : sessions.length === 0 ? (
                      <div className="text-xs text-slate-500">Chưa có buổi học nào.</div>
                    ) : (
                      <ul className="space-y-2 text-xs text-slate-700">
                        {sessions.map((s) => (
                          <li key={s.id} className="flex items-center justify-between rounded border px-2 py-1">
                            <div>
                              <div><span className="font-semibold">{s.date}</span> {s.start_time} - {s.end_time}</div>
                              <div className="text-[11px] text-slate-500">Trạng thái: {s.status}</div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border bg-white">
                  <div className="border-b px-4 py-3">
                    <h2 className="text-sm font-semibold text-slate-900">Gán sinh viên vào lớp</h2>
                    <p className="text-xs text-slate-500">Chọn các sinh viên bên dưới rồi bấm &quot;Gán vào lớp&quot;</p>
                  </div>
                  <div className="max-h-72 overflow-y-auto px-4 py-3 text-sm">
                    {students.length === 0 ? (
                      <div className="text-xs text-slate-500">Chưa có sinh viên nào.</div>
                    ) : (
                      <ul className="space-y-1">
                        {students.map((s) => (
                          <li key={s.id} className="flex items-center gap-2">
                            <input type="checkbox" checked={enrollStudentIds.includes(s.id)}
                              onChange={() => toggleEnrollStudent(s.id)} />
                            <span><span className="font-medium">{s.student_code}</span> - {s.full_name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex items-center gap-3 border-t px-4 py-3 text-xs">
                    <button type="button" disabled={enrolling || enrollStudentIds.length === 0} onClick={enrollStudents}
                      className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                      {enrolling ? "Đang gán..." : "Gán vào lớp"}
                    </button>
                    <div className="text-slate-500">Đã chọn: {enrollStudentIds.length} sinh viên</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TEACHER SCHEDULE TAB (teacher only) ── */}
        {activeTab === "teacher-schedule" && currentUser?.role === "teacher" && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Thời khóa biểu tuần</h2>
                <p className="text-xs text-slate-500">Lịch dạy trong tuần và thời gian đếm ngược</p>
              </div>
              {teacherScheduleLoading ? (
                <div className="px-4 py-3 text-xs text-slate-500">Đang tải...</div>
              ) : teacherScheduleError ? (
                <div className="px-4 py-3 text-sm text-red-700">Lỗi: {teacherScheduleError}</div>
              ) : teacherSchedule.length === 0 ? (
                <div className="px-4 py-3 text-xs text-slate-500">Không có lịch dạy trong tuần này.</div>
              ) : (
                <div className="divide-y">
                  {teacherSchedule.map((session, index) => (
                    <div key={session.session_id || index} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-slate-900">
                              {session.class_code} - {session.class_name}
                            </span>
                            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                              session.status === 'ended' ? 'bg-gray-50 text-gray-700 ring-gray-600/20' :
                              session.status === 'upcoming' ? 'bg-blue-50 text-blue-700 ring-blue-600/20' :
                              session.status === 'no_sessions' ? 'bg-yellow-50 text-yellow-700 ring-yellow-600/20' :
                              'bg-gray-50 text-gray-700 ring-gray-600/20'
                            }`}>
                              {session.status === 'ended' ? 'Đã kết thúc' : 
                               session.status === 'upcoming' ? 'Sắp diễn ra' : 
                               session.status === 'no_sessions' ? 'Chưa có buổi học' : 'Đang diễn ra'}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-slate-600">
                            {session.status === 'no_sessions' ? 
                              'Chưa tạo buổi học cho lớp này' : 
                              `${formatDate(session.date)} • ${session.start_time} - ${session.end_time}`
                            }
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-medium text-slate-900">Còn lại</div>
                          <div className="text-xs text-slate-600">{session.countdown}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AUDIT LOGS TAB (admin only) ── */}
        {activeTab === "users" && currentUser?.role === 'admin' && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Quản lý người dùng</h2>
                  <p className="text-xs text-slate-500">Tạo tài khoản cho Admin / Giảng viên / Sinh viên</p>
                </div>
                <button type="button" onClick={() => setShowCreateUserModal(true)}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
                  Tạo người dùng
                </button>
              </div>
              {usersError ? <div className="px-4 py-3 text-sm text-red-700">Lỗi: {usersError}</div> : null}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Username</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Họ tên</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Email</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Role</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-900">{u.username}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{u.full_name || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{u.email || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">{u.role}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <div className="flex gap-2">
                            <button type="button" onClick={() => openEditUserModal(u)}
                              className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500">
                              Sửa
                            </button>
                            <button type="button" onClick={() => deleteUser(u.id)}
                              className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500">
                              Xóa
                            </button>
                            <button type="button" onClick={() => toggleUserActive(u.id, !!u.is_active)}
                              className={`rounded-md px-2 py-1 text-xs font-medium text-white ${u.is_active ? "bg-amber-600 hover:bg-amber-500" : "bg-emerald-600 hover:bg-emerald-500"}`}>
                              {u.is_active ? "Khóa" : "Mở"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 text-xs text-slate-500">
                {usersLoading ? "Đang tải..." : `Tổng số: ${users.length}`}
              </div>
            </div>
          </div>
        )}

        {activeTab === "rfid" && currentUser?.role === "admin" && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">Quản lý thẻ RFID</h2>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={rfidUid}
                  onChange={(e) => setRfidUid(e.target.value)}
                  placeholder="Nhập UID thẻ"
                  className="w-64 rounded-md border px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={createRfidCard}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Thêm thẻ
                </button>
              </div>
            </div>

            <div className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3 text-sm font-semibold text-slate-900">Danh sách thẻ</div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">UID</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Trạng thái</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Gán sinh viên</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rfidCards.map((card) => (
                      <tr key={card.id}>
                        <td className="px-4 py-3 text-sm text-slate-900">{card.uid}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">{card.is_active ? "Hoạt động" : "Đã khóa"}</td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex items-center gap-2">
                            <select
                              value={rfidStudentId}
                              onChange={(e) => setRfidStudentId(e.target.value)}
                              className="rounded border px-2 py-1 text-xs"
                            >
                              <option value="">Chọn sinh viên</option>
                              {students.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.student_code} - {s.full_name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => assignRfidCard(card.id)}
                              className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
                            >
                              Gán
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <button
                            type="button"
                            onClick={async () => {
                              await fetch(`${apiBaseUrl}/api/rfid-cards/${card.id}/active?is_active=${!card.is_active}`, {
                                method: "PATCH",
                                headers: getAuthHeaders(),
                              });
                              fetchRfidCards();
                            }}
                            className="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500"
                          >
                            {card.is_active ? "Khóa thẻ" : "Mở thẻ"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 text-xs text-slate-500">{rfidLoading ? "Đang tải..." : `Tổng số thẻ: ${rfidCards.length}`}</div>
            </div>
          </div>
        )}

        {activeTab === "appeals" && currentUser?.role !== "student" && (
          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Khiếu nại điểm danh</h2>
              <p className="text-xs text-slate-500">Xem và xử lý khiếu nại từ sinh viên</p>
            </div>
            <div className="border-b px-4 py-3 bg-slate-50">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                <div>
                  <label className="text-xs font-medium text-slate-700">Trạng thái</label>
                  <select
                    value={appealFilters.status}
                    onChange={(e) => setAppealFilters({ ...appealFilters, status: e.target.value })}
                    className="mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none focus:border-slate-900"
                  >
                    <option value="">Tất cả</option>
                    <option value="pending">Chờ xử lý</option>
                    <option value="approved">Đã duyệt</option>
                    <option value="rejected">Đã từ chối</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Từ ngày</label>
                  <input
                    type="date"
                    value={appealFilters.start_date}
                    onChange={(e) => setAppealFilters({ ...appealFilters, start_date: e.target.value })}
                    className="mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Đến ngày</label>
                  <input
                    type="date"
                    value={appealFilters.end_date}
                    onChange={(e) => setAppealFilters({ ...appealFilters, end_date: e.target.value })}
                    className="mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Student ID</label>
                  <input
                    type="text"
                    value={appealFilters.student_id}
                    onChange={(e) => setAppealFilters({ ...appealFilters, student_id: e.target.value })}
                    placeholder="UUID sinh viên..."
                    className="mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none focus:border-slate-900"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={fetchAppeals}
                    disabled={appealsLoading}
                    className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
                  >
                    {appealsLoading ? "Đang tải..." : "Lọc"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAppealFilters({
                        status: "",
                        start_date: "",
                        end_date: "",
                        student_id: ""
                      });
                    }}
                    className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  >
                    Xóa
                  </button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Sinh viên</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Buổi học</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Lý do</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Trạng thái</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Duyệt</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {appeals.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-3 text-sm">{a.id}</td>
                      <td className="px-4 py-3 text-sm">{a.student_id}</td>
                      <td className="px-4 py-3 text-sm">{a.session_id}</td>
                      <td className="px-4 py-3 text-sm">{a.reason}</td>
                      <td className="px-4 py-3 text-sm">{a.status}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          <button type="button" onClick={() => updateAppeal(a.id, "approved")}
                            className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500">
                            Duyệt
                          </button>
                          <button type="button" onClick={() => updateAppeal(a.id, "rejected")}
                            className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">
                            Từ chối
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 text-xs text-slate-500">{appealsLoading ? "Đang tải..." : `Tổng số khiếu nại: ${appeals.length}`}</div>
          </div>
        )}

        {activeTab === "audit" && currentUser?.role === "admin" && (
          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Nhật ký hệ thống</h2>
              <p className="text-xs text-slate-500">Lọc và xem lịch sử thao tác hệ thống</p>
            </div>
            <div className="border-b px-4 py-3 bg-slate-50">
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
                <div>
                  <label className="text-xs font-medium text-slate-700">Từ ngày</label>
                  <input
                    type="date"
                    value={auditFilters.start_date}
                    onChange={(e) => setAuditFilters({ ...auditFilters, start_date: e.target.value })}
                    className="mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Đến ngày</label>
                  <input
                    type="date"
                    value={auditFilters.end_date}
                    onChange={(e) => setAuditFilters({ ...auditFilters, end_date: e.target.value })}
                    className="mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Hành động</label>
                  <input
                    type="text"
                    value={auditFilters.action}
                    onChange={(e) => setAuditFilters({ ...auditFilters, action: e.target.value })}
                    placeholder="login, create, update..."
                    className="mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Đối tượng</label>
                  <select
                    value={auditFilters.target_type}
                    onChange={(e) => setAuditFilters({ ...auditFilters, target_type: e.target.value })}
                    className="mt-1 w-full rounded-md border px-2 py-1 text-xs outline-none focus:border-slate-900"
                  >
                    <option value="">Tất cả</option>
                    <option value="user">User</option>
                    <option value="student">Student</option>
                    <option value="class">Class</option>
                    <option value="session">Session</option>
                    <option value="attendance">Attendance</option>
                    <option value="rfid_card">RFID Card</option>
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={fetchAuditLogs}
                    disabled={auditLoading}
                    className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
                  >
                    {auditLoading ? "Đang tải..." : "Lọc"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuditFilters({
                        start_date: "",
                        end_date: "",
                        action: "",
                        target_type: "",
                        actor_user_id: ""
                      });
                    }}
                    className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  >
                    Xóa
                  </button>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Thời gian</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Target</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Chi tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-3 text-sm">{formatTimestamp(log.created_at)}</td>
                      <td className="px-4 py-3 text-sm">{log.action}</td>
                      <td className="px-4 py-3 text-sm">{log.target_type || "-"} / {log.target_id || "-"}</td>
                      <td className="px-4 py-3 text-sm">{log.details || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 text-xs text-slate-500">{auditLoading ? "Đang tải..." : `Tổng số log: ${auditLogs.length}`}</div>
          </div>
        )}
      </main>

      {/* ── CLASS DETAILS MODAL ── */}
      {showClassDetails && selectedClassForDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-h-[80vh] w-full max-w-4xl overflow-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 border-b bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Chi tiết lớp học</h2>
                  <p className="text-xs text-slate-500">{selectedClassForDetails.class_code} - {selectedClassForDetails.name}</p>
                </div>
                <button type="button"
                  onClick={() => { setShowClassDetails(false); setSelectedClassForDetails(null); setEnrolledStudents([]); setClassSessions([]); setClassDetailsError(null); }}
                  className="rounded-md bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200">
                  Đóng
                </button>
              </div>
            </div>
            <div className="px-4 py-3">
              {classDetailsLoading ? (
                <div className="text-xs text-slate-500">Đang tải...</div>
              ) : classDetailsError ? (
                <div className="text-sm text-red-700">Lỗi: {classDetailsError}</div>
              ) : (
                <div className="space-y-6">
                  <div className="rounded-lg border bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">Thông tin lớp học</h3>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div><span className="font-medium text-slate-600">Mã lớp:</span><span className="ml-2 text-slate-900">{selectedClassForDetails.class_code}</span></div>
                      <div><span className="font-medium text-slate-600">Tên lớp:</span><span className="ml-2 text-slate-900">{selectedClassForDetails.name}</span></div>
                      <div className="col-span-2"><span className="font-medium text-slate-600">Mô tả:</span><span className="ml-2 text-slate-900">{selectedClassForDetails.description || "Không có mô tả"}</span></div>
                      <div><span className="font-medium text-slate-600">Số sinh viên:</span><span className="ml-2 text-slate-900">{enrolledStudents.length}</span></div>
                    </div>
                  </div>
                  {currentUser?.role === "admin" && (
                    <div className="rounded-lg border bg-white p-4">
                      <div className="mb-3 text-sm font-semibold text-slate-900">Phân công giảng viên phụ trách</div>
                      {classTeachers.length === 0 ? (
                        <div className="text-xs text-slate-500">Chưa có tài khoản giảng viên nào.</div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {classTeachers.map((teacher) => (
                            <label key={teacher.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={selectedTeacherIds.includes(teacher.id)}
                                onChange={() => {
                                  setSelectedTeacherIds((prev) =>
                                    prev.includes(teacher.id)
                                      ? prev.filter((id) => id !== teacher.id)
                                      : [...prev, teacher.id]
                                  );
                                }}
                              />
                              <span>{teacher.full_name || teacher.username}</span>
                            </label>
                          ))}
                        </div>
                      )}
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={saveClassTeachers}
                          className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                        >
                          Lưu phân công
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="rounded-lg border bg-white">
                    <div className="border-b px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">Lịch học</h3>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {classSessions.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-500">Chưa có buổi học nào.</div>
                      ) : (
                        <div className="divide-y">
                          {classSessions.map((session) => {
                            const status = getSessionStatus(session);
                            return (
                              <div key={session.id} className="px-4 py-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-slate-900">{session.date}</span>
                                      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${getStatusColor(status)}`}>
                                        {formatSessionStatus(status)}
                                      </span>
                                    </div>
                                    <div className="text-xs text-slate-600 mt-1">Thời gian: {session.start_time} - {session.end_time}</div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-white">
                    <div className="border-b px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">Sinh viên đã gán ({enrolledStudents.length})</h3>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {enrolledStudents.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-500">Chưa có sinh viên nào được gán vào lớp.</div>
                      ) : (
                        <div className="divide-y">
                          {enrolledStudents.map((student) => (
                            <div key={student.id} className="px-4 py-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-slate-900">{student.student_code}</span>
                                  <span className="ml-2 text-sm text-slate-700">{student.full_name}</span>
                                </div>
                              </div>
                              {student.sessions && student.sessions.length > 0 && (
                                <div className="space-y-1">
                                  {student.sessions.map((session: any) => {
                                    const attendanceStatus = session.attendance_status;
                                    const sessionStatus = session.session_status;
                                    
                                    // Lớp chưa bắt đầu -> không hiển thị gì
                                    if (sessionStatus === 'not_started') {
                                      return null;
                                    }
                                    
                                    // Xác định status text và color
                                    let statusText = '';
                                    let statusColor = '';
                                    let scanTimeDisplay = '-';
                                    
                                    if (attendanceStatus === 'on_time') {
                                      statusText = 'Đã điểm danh';
                                      statusColor = 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
                                      scanTimeDisplay = session.scan_time ? formatTimestamp(session.scan_time) : '-';
                                    } else if (attendanceStatus === 'late') {
                                      statusText = 'Đi trễ';
                                      statusColor = 'bg-orange-50 text-orange-700 ring-orange-600/20';
                                      scanTimeDisplay = session.scan_time ? formatTimestamp(session.scan_time) : '-';
                                    } else if (attendanceStatus === 'absent') {
                                      statusText = 'Vắng';
                                      statusColor = 'bg-red-50 text-red-700 ring-red-600/20';
                                      scanTimeDisplay = '-';
                                    } else if (attendanceStatus === 'not_checked_in') {
                                      statusText = 'Chưa điểm danh';
                                      statusColor = 'bg-slate-50 text-slate-600 ring-slate-500/20';
                                      scanTimeDisplay = '-';
                                    }
                                    
                                    return (
                                      <div key={session.session_id} className="grid grid-cols-2 gap-2 text-xs items-center">
                                        <div></div>
                                        <div className="flex justify-end items-center gap-2">
                                          <span className="font-medium text-slate-700">
                                            {session.date}
                                          </span>
                                          {session.scan_time && (
                                            <span className="text-slate-600">
                                              {formatTimestamp(session.scan_time)}
                                            </span>
                                          )}
                                          <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${statusColor}`}>
                                            {statusText}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TODAY SESSIONS MODAL ── */}
      {showTodaySessionsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-h-[80vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 border-b bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Lớp học hôm nay của sinh viên</h2>
                  <p className="text-xs text-slate-500">{detailStudentName}</p>
                </div>
                <button type="button"
                  onClick={() => { setShowTodaySessionsModal(false); setTodaySessions([]); setTodaySessionsError(null); }}
                  className="rounded-md bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200">
                  Đóng
                </button>
              </div>
            </div>
            <div className="px-4 py-3">
              {todaySessionsLoading ? (
                <div className="text-xs text-slate-500">Đang tải...</div>
              ) : todaySessionsError ? (
                <div className="text-sm text-red-700">Lỗi: {todaySessionsError}</div>
              ) : todaySessions.length === 0 ? (
                <div className="text-xs text-slate-500">Hôm nay không có buổi học nào.</div>
              ) : (
                <>
                  <div className="mb-3 text-xs text-slate-600">Số buổi học hôm nay: {todaySessions.length}</div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Mã lớp</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Tên lớp</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Thời gian</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-600">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {todaySessions.map((ses) => (
                          <tr key={ses.session_id}>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-900">{ses.class_code}</td>
                            <td className="px-3 py-2 text-slate-700">{ses.class_name}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-700">{ses.date} • {ses.start_time} - {ses.end_time}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">{ses.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE CLASS MODAL ── */}
      {showCreateClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="border-b bg-white px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Tạo lớp học mới</h3>
            </div>
            <div className="px-6 py-4 space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 mb-3">Thông tin lớp học</h4>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700">Mã lớp</label>
                    <input value={newClassCode} onChange={(e) => setNewClassCode(e.target.value)}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                      placeholder="INT3306-01" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700">Tên lớp</label>
                    <input value={newClassName} onChange={(e) => setNewClassName(e.target.value)}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                      placeholder="Lập trình Web" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700">Mô tả</label>
                    <input value={newClassDesc} onChange={(e) => setNewClassDesc(e.target.value)}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                      placeholder="Ghi chú (tùy chọn)" />
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 mb-3">Lịch học</h4>
                <div className="space-y-2 mb-3">
                  {newClassSessions.map((session, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <input type="date" value={session.date}
                        onChange={(e) => updateNewClassSession(index, 'date', e.target.value)}
                        className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                      <input type="time" value={session.start_time}
                        onChange={(e) => updateNewClassSession(index, 'start_time', e.target.value)}
                        className="rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                      <span className="text-sm text-slate-600">-</span>
                      <input type="time" value={session.end_time}
                        onChange={(e) => updateNewClassSession(index, 'end_time', e.target.value)}
                        className="rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                      {newClassSessions.length > 1 && (
                        <button type="button" onClick={() => removeNewClassSession(index)}
                          className="rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">
                          Xóa
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button"
                  onClick={() => setNewClassSessions([...newClassSessions, { date: '', start_time: '', end_time: '' }])}
                  className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500">
                  Thêm buổi học
                </button>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 mb-3">Sinh viên ({newClassStudents.length})</h4>
                <div className="max-h-40 overflow-y-auto border rounded-md">
                  {students.length === 0 ? (
                    <div className="p-3 text-sm text-slate-500">Chưa có sinh viên nào</div>
                  ) : (
                    <div className="divide-y">
                      {students.map((student) => (
                        <label key={student.id} className="flex items-center p-2 hover:bg-slate-50 cursor-pointer">
                          <input type="checkbox" checked={newClassStudents.includes(student.id)}
                            onChange={() => toggleNewClassStudent(student.id)} className="mr-2" />
                          <span className="text-sm">{student.student_code} - {student.full_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t bg-gray-50 px-6 py-3 flex justify-end gap-2">
              <button type="button"
                onClick={() => { setShowCreateClassModal(false); resetNewClassForm(); }}
                className="rounded-md bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-500">
                Hủy
              </button>
              <button type="button" disabled={creatingClass || !newClassCode.trim() || !newClassName.trim()} onClick={createClass}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                {creatingClass ? "Đang tạo..." : "Tạo lớp học"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT CLASS MODAL ── */}
      {showEditClassModal && editingClassData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="border-b bg-white px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Sửa lớp học: {editingClassData.class_code}</h3>
            </div>
            <div className="px-6 py-4 space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-slate-900 mb-3">Thông tin lớp học</h4>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700">Mã lớp</label>
                    <input value={editingClassData.class_code} disabled
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none bg-gray-100" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700">Tên lớp</label>
                    <input value={editingClassData.name}
                      onChange={(e) => setEditingClassData({ ...editingClassData, name: e.target.value })}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700">Mô tả</label>
                    <input value={editingClassData.description || ''}
                      onChange={(e) => setEditingClassData({ ...editingClassData, description: e.target.value })}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                      placeholder="Ghi chú (tùy chọn)" />
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 mb-3">Lịch học</h4>
                {editClassSessions.length === 0 ? (
                  <div className="text-sm text-slate-500 mb-3">Chưa có buổi học nào</div>
                ) : (
                  <div className="space-y-2 mb-3">
                    {editClassSessions.map((session, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <input type="date" value={session.date}
                          onChange={(e) => updateEditClassSession(index, 'date', e.target.value)}
                          className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                        <input type="time" value={session.start_time}
                          onChange={(e) => updateEditClassSession(index, 'start_time', e.target.value)}
                          className="rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                        <span className="text-sm text-slate-600">-</span>
                        <input type="time" value={session.end_time}
                          onChange={(e) => updateEditClassSession(index, 'end_time', e.target.value)}
                          className="rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900" />
                        {editClassSessions.length > 1 && (
                          <button type="button" onClick={() => removeEditClassSession(index)}
                            className="rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">
                            Xóa
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={addEditClassSession}
                  className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500">
                  Thêm buổi học
                </button>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 mb-3">Sinh viên ({editClassStudents.length})</h4>
                <div className="max-h-40 overflow-y-auto border rounded-md">
                  {students.length === 0 ? (
                    <div className="p-3 text-sm text-slate-500">Chưa có sinh viên nào</div>
                  ) : (
                    <div className="divide-y">
                      {students.map((student) => (
                        <label key={student.id} className="flex items-center p-2 hover:bg-slate-50 cursor-pointer">
                          <input type="checkbox" checked={editClassStudents.includes(student.id)}
                            onChange={() => toggleEditClassStudent(student.id)} className="mr-2" />
                          <span className="text-sm">{student.student_code} - {student.full_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t bg-gray-50 px-6 py-3 flex justify-end gap-2">
              <button type="button"
                onClick={() => { setShowEditClassModal(false); resetEditClassForm(); }}
                className="rounded-md bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-500">
                Hủy
              </button>
              <button type="button" disabled={savingClass || !editingClassData.name.trim()} onClick={saveEditedClass}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                {savingClass ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE USER MODAL ── */}
      {showCreateUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md w-full rounded-lg bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Tạo người dùng mới</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-700">Username</label>
                <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                  placeholder="username" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Họ tên</label>
                <input value={newUserFullname} onChange={(e) => setNewUserFullname(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                  placeholder="Nguyễn Văn A" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Email</label>
                <input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                  placeholder="email@example.com" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Role</label>
                <select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900">
                  <option value="student">Sinh viên</option>
                  <option value="teacher">Giảng viên</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="border-t bg-gray-50 px-6 py-3 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreateUserModal(false)}
                className="rounded-md bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-500">
                Hủy
              </button>
              <button type="button" disabled={creatingUser || !newUsername.trim()} onClick={createUser}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                {creatingUser ? "Đang tạo..." : "Tạo người dùng"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT USER MODAL ── */}
      {showEditUserModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md w-full rounded-lg bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Sửa người dùng</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-700">Username</label>
                <input value={editUserUsername} onChange={(e) => setEditUserUsername(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                  placeholder="username" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Họ tên</label>
                <input value={editUserFullname} onChange={(e) => setEditUserFullname(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                  placeholder="Nguyễn Văn A" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Email</label>
                <input value={editUserEmail} onChange={(e) => setEditUserEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                  placeholder="email@example.com" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Role</label>
                <select value={editUserRole} onChange={(e) => setEditUserRole(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900">
                  <option value="student">Sinh viên</option>
                  <option value="teacher">Giảng viên</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="border-t bg-gray-50 px-6 py-3 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowEditUserModal(false); setSelectedUser(null); }}
                className="rounded-md bg-gray-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-500">
                Hủy
              </button>
              <button type="button" disabled={updatingUser || !editUserUsername.trim()} onClick={updateUser}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                {updatingUser ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ERROR MODAL ── */}
      {errorModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md w-full rounded-lg bg-white shadow-xl">
            <div className="border-b bg-white px-6 py-4">
              <h3 className="text-lg font-semibold text-red-600">{errorModal.title}</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-slate-700">{errorModal.message}</p>
            </div>
            <div className="border-t bg-gray-50 px-6 py-3 flex justify-end">
              <button type="button" onClick={hideErrorModal}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── LOGIN MODAL ── */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md w-full rounded-lg bg-white shadow-xl">
            <div className="border-b bg-white px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Đăng nhập hệ thống</h3>
            </div>
            <div className="px-6 py-4">
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                login(formData.get('username') as string, formData.get('password') as string);
              }}>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Tên đăng nhập</label>
                    <input name="username" type="text" required
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                      placeholder="admin / teacher / student" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Mật khẩu</label>
                    <input name="password" type="password" required
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-slate-900"
                      placeholder="Mật khẩu mặc định: 123456" />
                  </div>
                  {loginError && (
                    <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{loginError}</div>
                  )}
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button type="submit" disabled={loginLoading}
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300">
                    {loginLoading ? "Đang đăng nhập..." : "Đăng nhập"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <FloatingChatBox />
    </div>
  );
}

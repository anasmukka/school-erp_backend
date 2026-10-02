import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  LogOut,
  Menu,
  School,
  Contact,
  ChevronRight,
  ChevronDown,
  Check,
  Calendar,
  CalendarDays,
  CreditCard,
  FileText,
  ShieldCheck,
  ClipboardCheck,
  Bell,
  X,
  Wifi,
  CalendarCheck2,
  Printer,
  Package,
  BarChart3,
  Layers,
  Award,
  FileSpreadsheet,
  FileSignature,
  User,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  roles: string[];
  requiresClassTeacher?: boolean;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: <LayoutDashboard size={18} />, roles: ["admin", "hod", "teacher", "student", "accountant", "printing", "operations"] },
  { label: "My Profile", href: "/profile", icon: <User size={18} />, roles: ["admin", "hod", "teacher", "student", "accountant", "printing", "operations"] },
  { label: "Profile Change Requests", href: "/admin/profile-requests", icon: <UserCheck size={18} />, roles: ["admin"] },
  { label: "Printing Orders", href: "/printing", icon: <Printer size={18} />, roles: ["operations", "printing"] },
  { label: "Print Requests", href: "/printing/orders", icon: <Printer size={18} />, roles: ["teacher", "hod"] },
  { label: "Library", href: "/library", icon: <BookOpen size={18} />, roles: ["operations", "teacher", "hod"] },
  { label: "Inventory & Uniforms", href: "/inventory", icon: <Package size={18} />, roles: ["operations"] },
  { label: "Operations Staff", href: "/admin/operations", icon: <Package size={18} />, roles: ["admin"] },
  { label: "Reports & Audits", href: "/admin/reports", icon: <BarChart3 size={18} />, roles: ["admin"] },
  { label: "Academic Structure", href: "/admin/academic-structure", icon: <Layers size={18} />, roles: ["admin"] },
  { label: "Results & Report Cards", href: "/admin/results", icon: <Award size={18} />, roles: ["admin", "hod"] },
  { label: "Section Heads", href: "/admin/hods", icon: <ShieldCheck size={18} />, roles: ["admin"] },
  { label: "Teachers", href: "/admin/teachers", icon: <Users size={18} />, roles: ["admin"] },
  { label: "Students", href: "/admin/students", icon: <GraduationCap size={18} />, roles: ["admin"] },
  { label: "Classes", href: "/admin/classes", icon: <School size={18} />, roles: ["admin"] },
  { label: "Subjects", href: "/admin/subjects", icon: <BookOpen size={18} />, roles: ["admin"] },
  { label: "Admissions", href: "/admin/admissions", icon: <FileText size={18} />, roles: ["admin"] },
  { label: "Academic Sessions", href: "/admin/sessions", icon: <CalendarDays size={18} />, roles: ["admin"] },
  { label: "Events & Calendar", href: "/admin/calendar", icon: <CalendarDays size={18} />, roles: ["admin"] },
  { label: "Student Promotion", href: "/admin/promotion", icon: <GraduationCap size={18} />, roles: ["admin"] },
  { label: "Exam Approvals", href: "/admin/exam-approvals", icon: <ClipboardCheck size={18} />, roles: ["admin"] },
  { label: "Hall Tickets", href: "/admin/hall-tickets", icon: <FileText size={18} />, roles: ["admin"] },
  { label: "E-Signatures", href: "/admin/signatures", icon: <FileSignature size={18} />, roles: ["admin"] },
  { label: "Notices", href: "/admin/notices", icon: <Bell size={18} />, roles: ["admin"] },
  { label: "RFID Cards", href: "/admin/rfid-cards", icon: <Wifi size={18} />, roles: ["admin"] },
  { label: "ID Cards", href: "/id-cards", icon: <Contact size={18} />, roles: ["admin", "hod"] },
  { label: "Student Fees", href: "/accounts/student-fees", icon: <CreditCard size={18} />, roles: ["accountant", "admin"] },
  { label: "Fee Structures", href: "/accounts/fees", icon: <Layers size={18} />, roles: ["accountant", "admin"] },
  { label: "Collections", href: "/accounts/collections", icon: <FileText size={18} />, roles: ["accountant", "admin"] },
  { label: "Hall Ticket Bypasses", href: "/accounts/bypasses", icon: <ShieldCheck size={18} />, roles: ["accountant", "admin"] },
  { label: "Pending Students", href: "/hod/pending", icon: <GraduationCap size={18} />, roles: ["hod"] },
  { label: "Class Management", href: "/hod/classes", icon: <School size={18} />, roles: ["hod"] },
  { label: "Timetable", href: "/hod/timetable", icon: <Calendar size={18} />, roles: ["hod"] },
  { label: "Exam Scheduling", href: "/hod/exam-scheduling", icon: <CalendarDays size={18} />, roles: ["hod"] },
  { label: "School Calendar", href: "/hod/calendar", icon: <CalendarDays size={18} />, roles: ["hod"] },
  { label: "Notices", href: "/hod/notices", icon: <Bell size={18} />, roles: ["hod"] },
  { label: "My Signature", href: "/my-signature", icon: <FileSignature size={18} />, roles: ["hod", "class_teacher"] },
  { label: "School Calendar", href: "/teacher/calendar", icon: <CalendarDays size={18} />, roles: ["teacher"] },
  { label: "Marks Entry", href: "/teacher/marks", icon: <FileSpreadsheet size={18} />, roles: ["teacher"] },
  { label: "RFID Attendance", href: "/teacher/rfid-attendance", icon: <Wifi size={18} />, roles: ["teacher"], requiresClassTeacher: true },
  { label: "Manual Attendance", href: "/teacher/manual-attendance", icon: <ClipboardCheck size={18} />, roles: ["teacher"], requiresClassTeacher: true },
  { label: "Attendance Register", href: "/teacher/attendance-register", icon: <CalendarCheck2 size={18} />, roles: ["teacher"], requiresClassTeacher: true },
  { label: "Assignments & Activities", href: "/teacher/assignments", icon: <FileText size={18} />, roles: ["teacher"], requiresClassTeacher: true },
  { label: "School Calendar", href: "/student/calendar", icon: <CalendarDays size={18} />, roles: ["student"] },
  { label: "Library", href: "/student/library", icon: <BookOpen size={18} />, roles: ["student"] },
  { label: "Hall Tickets", href: "/student/hall-tickets", icon: <FileText size={18} />, roles: ["student"] },
  { label: "Report Card", href: "/student/report-card", icon: <Award size={18} />, roles: ["student"] },
  { label: "Exam Timetable", href: "/student/exams", icon: <CalendarDays size={18} />, roles: ["student"] },
  { label: "My Fees", href: "/student/fees", icon: <CreditCard size={18} />, roles: ["student"] },
  { label: "Assignments & Activities", href: "/student/assignments", icon: <FileText size={18} />, roles: ["student"] },
  { label: "Attendance Overview", href: "/student/attendance-overview", icon: <CalendarCheck2 size={18} />, roles: ["student"] },
  { label: "Notices", href: "/student/notices", icon: <Bell size={18} />, roles: ["student"] },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { appUser, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarNotifOpen, setSidebarNotifOpen] = useState(false);
  const [desktopNotifOpen, setDesktopNotifOpen] = useState(false);
  const [mobileNotifOpen, setMobileNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isClassTeacher, setIsClassTeacher] = useState(false);

  useEffect(() => {
    if (!appUser) {
      setIsClassTeacher(false);
      return;
    }
    const loadNotifications = async () => {
      try {
        // For teachers: check notifications sent to their teacher doc
        if (appUser.role === "teacher") {
          let teacherSnap = await getDocs(query(collection(db, "teachers"), where("uid", "==", appUser.id)));
          if (teacherSnap.empty && appUser.email) {
            teacherSnap = await getDocs(query(collection(db, "teachers"), where("email", "==", appUser.email)));
            if (!teacherSnap.empty) {
              updateDoc(doc(db, "teachers", teacherSnap.docs[0].id), { uid: appUser.id }).catch(() => {});
            }
          }
          if (!teacherSnap.empty) {
            const tDocId = teacherSnap.docs[0].id;
            const [notifSnap, classTeacherSnap] = await Promise.all([
              getDocs(query(collection(db, "notifications"), where("recipientTeacherId", "==", tDocId))),
              getDocs(query(collection(db, "sections"), where("classTeacherId", "==", tDocId))),
            ]);
            const notifs = notifSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""));
            setNotifications(notifs);
            setUnreadCount(notifs.filter((n: any) => !n.read).length);
            setIsClassTeacher(!classTeacherSnap.empty);
          } else {
            setIsClassTeacher(false);
          }
        } else if (appUser.role === "admin") {
          const notifSnap = await getDocs(query(collection(db, "notifications")));
          const notifs = notifSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""));
          setNotifications(notifs);
          setUnreadCount(notifs.filter((n: any) => !n.read).length);
          setIsClassTeacher(false);
        } else {
          setIsClassTeacher(false);
        }
      } catch { /* ignore */ }
    };
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [appUser]);

  const markAsRead = async (notifId: string) => {
    try {
      await updateDoc(doc(db, "notifications", notifId), { read: true });
      setNotifications((prev) => prev.map((n) => n.id === notifId ? { ...n, read: true } : n));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    await Promise.all(unread.map((n) => updateDoc(doc(db, "notifications", n.id), { read: true }).catch(() => {})));
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const filtered = navItems.filter((n) => {
    if (!n.roles.includes(appUser?.role ?? "")) {
      return false;
    }

    if (n.requiresClassTeacher && !isClassTeacher) {
      return false;
    }

    return true;
  });

  const roleBadgeColor: Record<string, string> = {
    admin: "bg-indigo-200/30 text-indigo-100",
    hod: "bg-blue-200/30 text-blue-100",
    teacher: "bg-emerald-200/30 text-emerald-100",
    student: "bg-amber-200/30 text-amber-100",
    accountant: "bg-teal-200/30 text-teal-100",
    printing: "bg-cyan-200/30 text-cyan-100",
    operations: "bg-amber-200/30 text-amber-100",
  };

  const NotificationPanel = ({ onClose }: { onClose: () => void }) => (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="relative z-50 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden text-slate-800 animate-in fade-in zoom-in-95 duration-100">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/90">
          <div className="flex items-center gap-2">
            <Bell size={15} className="text-primary shrink-0" />
            <p className="font-semibold text-sm text-slate-900">Notifications</p>
            {unreadCount > 0 && (
              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                {unreadCount} new
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline font-medium" type="button">
                Mark all read
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-colors" type="button">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">No notifications</div>
          ) : (
            notifications.slice(0, 20).map((n: any) => (
              <button
                key={n.id}
                onClick={() => !n.read && markAsRead(n.id)}
                className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${!n.read ? "bg-blue-50/60" : ""}`}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-slate-900 leading-snug">{n.message}</p>
                  {!n.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  From: {n.senderName || "System"} • {n.createdAt ? new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                </p>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );

  const SidebarContent = () => (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,#0f274f_0%,#173f75_38%,#19516f_100%)] text-slate-100">
        <div className="flex items-center gap-3 border-b border-white/15 px-5 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white shadow-xs overflow-hidden p-0.5">
            <img
              src="/prestige_logo.png"
              alt="Prestige International School"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0 flex flex-col justify-center">
            <span className="font-bold text-[12px] uppercase leading-tight tracking-[0.06em] text-white">Prestige</span>
            <span className="font-semibold text-[10.5px] uppercase leading-tight tracking-[0.05em] text-slate-100">International</span>
            <span className="font-medium text-[9px] uppercase leading-tight tracking-[0.14em] text-cyan-200">School</span>
          </div>
        </div>

      <div className="border-b border-white/15 px-4 py-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm">
          <Link
            href="/profile"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5 min-w-0 flex-1 rounded-lg p-1 -m-1 transition-all duration-150 hover:bg-white/15 active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 cursor-pointer group"
            title="View my profile"
            data-testid="sidebar-profile-card"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/18 text-xs font-bold text-white shrink-0 group-hover:scale-105 transition-transform">
              {appUser?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-semibold text-white group-hover:text-cyan-100 transition-colors">{appUser?.name}</p>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${roleBadgeColor[appUser?.role ?? ""] ?? ""}`}>
                {appUser?.role?.toUpperCase()}
              </span>
            </div>
          </Link>

          <div className="relative shrink-0">
            <button
              data-testid="notification-bell"
              onClick={() => setSidebarNotifOpen(!sidebarNotifOpen)}
              className="relative rounded-lg p-2 hover:bg-white/10 transition-colors"
              aria-label="Notifications"
              type="button"
            >
              <Bell size={18} className="text-white/90" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none min-w-[18px] px-1 shadow-xs">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {sidebarNotifOpen && (
              <div
                className="absolute left-full top-0 ml-3 z-50"
                data-testid="notification-panel"
              >
                <NotificationPanel onClose={() => setSidebarNotifOpen(false)} />
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {filtered.map((item) => {
          const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                active
                  ? "border border-white/20 bg-[linear-gradient(135deg,rgba(37,99,235,0.8),rgba(14,165,233,0.6))] text-white shadow-[0_12px_20px_-16px_rgba(14,165,233,1)]"
                  : "border border-transparent text-slate-100 hover:border-white/10 hover:bg-white/10"
              }`}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
                active
                  ? "bg-white/20 text-white"
                  : "bg-white/8 text-slate-200 group-hover:bg-white/15"
              }`}>
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight size={14} className="text-cyan-100" />}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4">
        <Button
          variant="outline"
          className="w-full justify-start gap-3 border-white/20 bg-white/10 text-rose-100 hover:bg-rose-500/20 hover:text-white"
          onClick={logout}
        >
          <LogOut size={18} />
          Sign Out
        </Button>
      </div>
    </div>
  );

  const { sessions, activeSession, workingSession, setWorkingSessionId } = useAcademicSession();
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);

  const SessionDropdown = () => (
    <div className="relative">
      <button
        onClick={() => setSessionMenuOpen(!sessionMenuOpen)}
        className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-xs hover:bg-slate-50 transition-colors"
        title="Change working academic session"
        type="button"
      >
        <CalendarDays size={14} className="text-primary shrink-0" />
        <span className="hidden sm:inline text-slate-500 font-normal">Session:</span>
        <span className="font-bold text-slate-900">{workingSession?.name || "Select"}</span>
        {activeSession && (workingSession?.id === activeSession.id || workingSession?.name === activeSession.name) ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
            Past/Plan
          </span>
        )}
        <ChevronDown size={13} className="text-slate-400 shrink-0" />
      </button>

      {sessionMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSessionMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
            <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Working Academic Session
            </div>
            <div className="space-y-0.5 max-h-56 overflow-y-auto">
              {sessions.map((s) => {
                const isSelected = workingSession?.id === s.id || workingSession?.name === s.name;
                const isLiveActive = activeSession?.id === s.id || activeSession?.name === s.name;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setWorkingSessionId(s.id);
                      setSessionMenuOpen(false);
                    }}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                      isSelected
                        ? "bg-primary/10 text-primary font-bold"
                        : "text-slate-700 hover:bg-slate-100 font-medium"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{s.name}</span>
                      {isLiveActive && (
                        <span className="rounded bg-emerald-100 px-1 py-0.2 text-[9px] font-bold text-emerald-800">
                          Active
                        </span>
                      )}
                      {!isLiveActive && s.status === "archived" && (
                        <span className="rounded bg-slate-100 px-1 py-0.2 text-[9px] text-slate-500">
                          Archived
                        </span>
                      )}
                    </div>
                    {isSelected && <Check size={14} className="text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
            {appUser?.role === "admin" && (
              <div className="mt-1 border-t border-slate-100 pt-1">
                <Link
                  href="/admin/sessions"
                  onClick={() => setSessionMenuOpen(false)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-primary hover:bg-primary/5 font-semibold"
                >
                  <CalendarDays size={13} />
                  <span>Manage Sessions...</span>
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-transparent">
      <aside className="relative z-30 hidden w-64 shrink-0 border-r border-white/20 md:flex">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 z-50 h-full w-64 border-r border-white/15">
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Desktop top header bar */}
        <header className="relative z-40 hidden md:flex items-center justify-between border-b border-slate-200/70 bg-white/75 px-6 py-2.5 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <span className="brand-font text-sm font-semibold tracking-[0.04em] text-slate-800 shrink-0">
              Prestige International School
            </span>
            {workingSession?.id !== activeSession?.id && activeSession && (
              <div className="flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs text-amber-800 truncate">
                <span>Viewing historical context: <strong>{workingSession?.name}</strong></span>
                <button
                  type="button"
                  onClick={() => setWorkingSessionId(activeSession.id)}
                  className="font-bold underline ml-1 hover:text-amber-950 shrink-0"
                >
                  Return to Active ({activeSession.name})
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative">
              <button
                onClick={() => setDesktopNotifOpen(!desktopNotifOpen)}
                className="relative flex items-center justify-center rounded-lg border border-slate-200/80 bg-white/95 p-2 text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs"
                aria-label="Notifications"
                type="button"
                title="Notifications"
              >
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none shadow-xs">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {desktopNotifOpen && (
                <div className="absolute right-0 top-full mt-2 z-50">
                  <NotificationPanel onClose={() => setDesktopNotifOpen(false)} />
                </div>
              )}
            </div>

            {appUser?.role !== "printing" && appUser?.role !== "operations" && <SessionDropdown />}
          </div>
        </header>

        {/* Mobile header */}
        <header className="relative z-40 flex items-center justify-between border-b border-white/30 bg-white/70 px-4 py-2.5 backdrop-blur-md md:hidden">
          <div className="flex items-center gap-1">
            <button onClick={() => setMobileOpen(true)} className="rounded-lg p-1.5 hover:bg-white/65">
              <Menu size={20} />
            </button>
            <div className="relative">
              <button
                onClick={() => setMobileNotifOpen(!mobileNotifOpen)}
                className="rounded-lg p-1.5 hover:bg-white/65 relative"
                aria-label="Notifications"
                type="button"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>

              {mobileNotifOpen && (
                <div className="absolute left-0 top-full mt-2 z-50">
                  <NotificationPanel onClose={() => setMobileNotifOpen(false)} />
                </div>
              )}
            </div>
          </div>

          {appUser?.role !== "printing" && appUser?.role !== "operations" && <SessionDropdown />}
        </header>
        <main className="flex-1 overflow-y-auto p-6 lg:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}

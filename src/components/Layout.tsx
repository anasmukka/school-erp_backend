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
  ChevronRight,
  Calendar,
  CreditCard,
  PenLine,
  FileText,
  ShieldCheck,
  ClipboardCheck,
  FilePen,
  Signature,
  Bell,
  X,
  Wifi,
  CalendarCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  roles: string[];
  requiresClassTeacher?: boolean;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: <LayoutDashboard size={18} />, roles: ["admin", "hod", "teacher", "student", "accountant"] },
  { label: "Section Heads", href: "/admin/hods", icon: <ShieldCheck size={18} />, roles: ["admin"] },
  { label: "Teachers", href: "/admin/teachers", icon: <Users size={18} />, roles: ["admin"] },
  { label: "Students", href: "/admin/students", icon: <GraduationCap size={18} />, roles: ["admin"] },
  { label: "Subjects", href: "/admin/subjects", icon: <BookOpen size={18} />, roles: ["admin"] },
  { label: "Accounts Staff", href: "/admin/accounts", icon: <CreditCard size={18} />, roles: ["admin"] },
  { label: "Admissions", href: "/admin/admissions", icon: <FileText size={18} />, roles: ["admin"] },
  { label: "Signatures", href: "/admin/signatures", icon: <Signature size={18} />, roles: ["admin"] },
  { label: "RFID Cards", href: "/admin/rfid-cards", icon: <Wifi size={18} />, roles: ["admin"] },
  { label: "Report Cards", href: "/admin/report-cards", icon: <ClipboardCheck size={18} />, roles: ["admin"] },
  { label: "Fees", href: "/accounts/fees", icon: <CreditCard size={18} />, roles: ["admin", "accountant"] },
  { label: "Collections", href: "/accounts/collections", icon: <FileText size={18} />, roles: ["admin", "accountant"] },
  { label: "ID Cards", href: "/id-cards", icon: <CreditCard size={18} />, roles: ["admin"] },
  { label: "Pending Students", href: "/hod/pending", icon: <GraduationCap size={18} />, roles: ["hod"] },
  { label: "Class Management", href: "/hod/classes", icon: <School size={18} />, roles: ["hod"] },
  { label: "Timetable", href: "/hod/timetable", icon: <Calendar size={18} />, roles: ["hod"] },
  { label: "Schedule Exams", href: "/hod/exams", icon: <Calendar size={18} />, roles: ["hod"] },
  { label: "Question Papers", href: "/hod/question-papers", icon: <FilePen size={18} />, roles: ["hod"] },
  { label: "Report Cards", href: "/hod/report-cards", icon: <ClipboardCheck size={18} />, roles: ["hod"] },
  { label: "Notices", href: "/hod/notices", icon: <Bell size={18} />, roles: ["hod"] },
  { label: "ID Cards", href: "/id-cards", icon: <CreditCard size={18} />, roles: ["hod"] },
  { label: "Marks Entry", href: "/teacher/marks", icon: <PenLine size={18} />, roles: ["teacher"] },
  { label: "RFID Attendance", href: "/teacher/rfid-attendance", icon: <Wifi size={18} />, roles: ["teacher"], requiresClassTeacher: true },
  { label: "Manual Attendance", href: "/teacher/manual-attendance", icon: <ClipboardCheck size={18} />, roles: ["teacher"], requiresClassTeacher: true },
  { label: "Attendance Register", href: "/teacher/attendance-register", icon: <CalendarCheck2 size={18} />, roles: ["teacher"], requiresClassTeacher: true },
  { label: "Assignments & Activities", href: "/teacher/assignments", icon: <FileText size={18} />, roles: ["teacher"], requiresClassTeacher: true },
  { label: "Report Cards", href: "/teacher/report-cards", icon: <FileText size={18} />, roles: ["teacher"] },
  { label: "Question Papers", href: "/teacher/question-papers", icon: <FilePen size={18} />, roles: ["teacher"] },
  { label: "My Fees", href: "/student/fees", icon: <CreditCard size={18} />, roles: ["student"] },
  { label: "My Report Card", href: "/student/report-card", icon: <FileText size={18} />, roles: ["student"] },
  { label: "Assignments & Activities", href: "/student/assignments", icon: <FileText size={18} />, roles: ["student"] },
  { label: "Attendance Overview", href: "/student/attendance-overview", icon: <CalendarCheck2 size={18} />, roles: ["student"] },
  { label: "Notices", href: "/student/notices", icon: <Bell size={18} />, roles: ["student"] },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { appUser, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
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
  };

  const SidebarContent = () => (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,#0f274f_0%,#173f75_38%,#19516f_100%)] text-slate-100">
        <div className="flex items-center gap-3 border-b border-white/15 px-6 py-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-[0_10px_24px_-12px_rgba(14,165,233,0.95)] ring-1 ring-white/35 overflow-hidden p-1">
            <img src="/prestige_logo.png" alt="Prestige International School" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="brand-font text-[15px] font-semibold leading-tight tracking-[0.04em]">Prestige International</p>
            <p className="brand-font text-[11px] text-slate-200 tracking-[0.18em] uppercase">School</p>
          </div>
        </div>

      <div className="border-b border-white/15 px-4 py-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/18 text-xs font-bold text-white">
              {appUser?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-semibold text-white">{appUser?.name}</p>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${roleBadgeColor[appUser?.role ?? ""] ?? ""}`}>
                {appUser?.role?.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="relative shrink-0">
            <button
              data-testid="notification-bell"
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative rounded-lg p-2 hover:bg-white/10 transition-colors"
              aria-label="Notifications"
              type="button"
            >
              <Bell size={18} className="text-white/90" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none min-w-[18px] px-1">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div
                className="absolute left-full top-0 ml-3 w-80 bg-white rounded-xl shadow-lg border border-border z-50 overflow-hidden"
                data-testid="notification-panel"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-slate-50/80">
                  <p className="font-semibold text-sm text-slate-900">Notifications</p>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-xs text-primary hover:underline" type="button">
                        Mark all read
                      </button>
                    )}
                    <button onClick={() => setNotifOpen(false)} type="button">
                      <X size={14} className="text-muted-foreground" />
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-muted-foreground text-sm">No notifications</div>
                  ) : (
                    notifications.slice(0, 20).map((n: any) => (
                      <button
                        key={n.id}
                        onClick={() => !n.read && markAsRead(n.id)}
                        className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-slate-50 transition-colors ${!n.read ? "bg-blue-50/50" : ""}`}
                        type="button"
                      >
                        <p className="text-xs font-medium text-foreground leading-snug">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          From: {n.senderName} - {n.createdAt ? new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                      </button>
                    ))
                  )}
                </div>
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

  return (
    <div className="flex h-screen overflow-hidden bg-transparent">
      <aside className="hidden w-64 shrink-0 border-r border-white/20 md:flex">
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

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Desktop notification bar (disabled; moved into the sidebar name plate) */}
        <header className="hidden">
          <div className="relative">
            <button
              data-testid="notification-bell-deprecated"
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative rounded-lg p-2 hover:bg-white/65 transition-colors"
            >
              <Bell size={18} className="text-foreground" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none min-w-[18px] px-1">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-xl shadow-lg border border-border z-50 overflow-hidden" data-testid="notification-panel-deprecated">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-slate-50/80">
                  <p className="font-semibold text-sm">Notifications</p>
                  <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
                    )}
                    <button onClick={() => setNotifOpen(false)}><X size={14} className="text-muted-foreground" /></button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-muted-foreground text-sm">No notifications</div>
                  ) : (
                    notifications.slice(0, 20).map((n: any) => (
                      <button
                        key={n.id}
                        onClick={() => !n.read && markAsRead(n.id)}
                        className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-slate-50 transition-colors ${!n.read ? "bg-blue-50/50" : ""}`}
                      >
                        <p className="text-xs font-medium text-foreground leading-snug">{n.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          From: {n.senderName} - {n.createdAt ? new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Mobile header */}
        <header className="flex items-center justify-between border-b border-white/30 bg-white/55 px-4 py-3 backdrop-blur-md md:hidden">
          <div className="flex items-center gap-1">
            <button onClick={() => setMobileOpen(true)} className="rounded-lg p-1.5 hover:bg-white/65">
              <Menu size={20} />
            </button>
            <div className="relative">
              <button onClick={() => setNotifOpen(!notifOpen)} className="rounded-lg p-1.5 hover:bg-white/65 relative" aria-label="Notifications" type="button">
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{unreadCount > 9 ? "9+" : unreadCount}</span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute left-0 top-full mt-1 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-border z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-slate-50/80">
                    <p className="font-semibold text-sm text-slate-900">Notifications</p>
                    <div className="flex items-center gap-2">
                      {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-xs text-primary hover:underline" type="button">
                          Mark all read
                        </button>
                      )}
                      <button onClick={() => setNotifOpen(false)} type="button">
                        <X size={14} className="text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-muted-foreground text-sm">No notifications</div>
                    ) : (
                      notifications.slice(0, 20).map((n: any) => (
                        <button
                          key={n.id}
                          onClick={() => !n.read && markAsRead(n.id)}
                          className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-slate-50 transition-colors ${!n.read ? "bg-blue-50/50" : ""}`}
                          type="button"
                        >
                          <p className="text-xs font-medium text-foreground leading-snug">{n.message}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            From: {n.senderName} - {n.createdAt ? new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <span className="brand-font text-sm font-semibold tracking-[0.08em]">Prestige International School</span>

          {/* spacer to keep title centered */}
          <div className="w-12" />
        </header>
        <main className="flex-1 overflow-y-auto p-6 lg:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}

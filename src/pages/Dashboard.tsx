import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getAcademicSession } from "@/lib/fees";
import { TimetableEntryType } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import {
  GraduationCap, Users, BookOpen, Clock, FileText,
  Bell, CalendarDays, CreditCard, ChevronRight, TrendingUp,
  BarChart3, ArrowUpRight, School, ShieldCheck, Printer, Package,
} from "lucide-react";
import { Link } from "wouter";
import TeacherDashboard from "@/pages/teacher/Dashboard";
import PrintingDashboard from "@/pages/printing/PrintingDashboard";
import OperationsDashboard from "@/pages/operations/OperationsDashboard";
import SchoolTimetableSheet, { SchoolTimetableSheetSlot } from "@/components/timetable/SchoolTimetableSheet";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { Badge } from "@/components/ui/badge";
import UpcomingEventsWidget from "@/components/calendar/UpcomingEventsWidget";
import {
  resolveStudentLibraryIdentifiers,
  getLibraryFineRules,
  calculateStudentLibrarySummary,
} from "@/lib/library";
import { LibraryTransaction } from "@/lib/types";

interface StudentTimetableSlot {
  id: string;
  day: string;
  periodNumber?: number;
  periodLabel: string;
  startTime?: string;
  endTime?: string;
  subjectName: string;
  teacherName?: string;
  entryType?: TimetableEntryType;
}

interface StudentAssignedSubject {
  id: string;
  subjectName: string;
  teacherName?: string;
  category?: string;
}

const WEEKDAY_ORDER: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 7,
};

function formatCurrency(value: number) {
  return `Rs ${Math.round(value).toLocaleString("en-IN")}`;
}

function normalizeDay(value?: string): string {
  return value?.trim() || "Day Not Set";
}

function sortByDayAndPeriod(a: StudentTimetableSlot, b: StudentTimetableSlot) {
  const dayA = WEEKDAY_ORDER[a.day.toLowerCase()] ?? 99;
  const dayB = WEEKDAY_ORDER[b.day.toLowerCase()] ?? 99;
  if (dayA !== dayB) return dayA - dayB;
  const periodA = a.periodNumber ?? (Number(a.periodLabel.replace(/\D/g, "")) || 999);
  const periodB = b.periodNumber ?? (Number(b.periodLabel.replace(/\D/g, "")) || 999);
  if (periodA !== periodB) return periodA - periodB;
  return a.periodLabel.localeCompare(b.periodLabel, undefined, { numeric: true });
}

function formatTimeRange(start?: string, end?: string) {
  if (start && end) return `${start} - ${end}`;
  return start || end || "Time not set";
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function getTodayFormatted() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

export default function Dashboard() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const currentSession = workingSession?.name || getAcademicSession();
  const [stats, setStats] = useState({
    teachers: 0, students: 0, classes: 0, pendingStudents: 0,
    feeStructures: 0, payments: 0, collections: 0,
  });
  const [studentInfo, setStudentInfo] = useState<{ grade: string; sectionId: string | null; sectionName?: string | null; rollNo?: string | null } | null>(null);
  const [upcomingExam, setUpcomingExam] = useState<any | null>(null);
  const [timetableSlots, setTimetableSlots] = useState<StudentTimetableSlot[]>([]);
  const [assignedSubjects, setAssignedSubjects] = useState<StudentAssignedSubject[]>([]);
  const [librarySummary, setLibrarySummary] = useState<{
    borrowedCount: number;
    dueSoonCount: number;
    overdueCount: number;
  } | null>(null);
  const studentTimetableSheetSlots = useMemo(
    () =>
      timetableSlots.map((slot, index) => ({
        id: slot.id || `${slot.day}_${slot.periodNumber ?? index + 1}_${index + 1}`,
        day: slot.day,
        periodNumber: slot.periodNumber,
        periodLabel: slot.periodLabel,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subjectName: slot.subjectName,
        teacherName: slot.teacherName,
        entryType: slot.entryType,
      }) as SchoolTimetableSheetSlot),
    [timetableSlots],
  );

  useEffect(() => {
    if (!appUser) return;
    const load = async () => {
      if (appUser.role === "admin") {
        const [t, s, secSnap, enSnap] = await Promise.all([
          getDocs(collection(db, "teachers")),
          getDocs(collection(db, "students")),
          getDocs(collection(db, "sections")),
          workingSession?.name
            ? getDocs(query(collection(db, "enrollments"), where("academicYear", "==", workingSession.name)))
            : Promise.resolve(null),
        ]);
        const enrolledCount = enSnap && !enSnap.empty ? enSnap.size : s.size;
        setStats((prev) => ({
          ...prev,
          teachers: t.size,
          students: enrolledCount,
          classes: secSnap.size,
        }));
      } else if (appUser.role === "accountant") {
        const [feeStructuresSnap, paymentsSnap, studentsSnap] = await Promise.all([
          getDocs(query(collection(db, "feeStructures"), where("academicSession", "==", currentSession))),
          getDocs(query(collection(db, "feePayments"), where("academicSession", "==", currentSession))),
          getDocs(collection(db, "students")),
        ]);
        const collections = paymentsSnap.docs.reduce(
          (total, record) => total + (Number(record.data().amount) || 0), 0,
        );
        setStats({ teachers: 0, students: studentsSnap.size, pendingStudents: 0, feeStructures: feeStructuresSnap.size, payments: paymentsSnap.size, collections });
      } else if (appUser.role === "hod") {
        const { listPendingEnrollmentsForHod } = await import("@/lib/enrollments");
        const pending = await listPendingEnrollmentsForHod(appUser.id);
        setStats((s) => ({ ...s, pendingStudents: pending.length }));
      } else if (appUser.role === "student") {
        setTimetableSlots([]);
        setAssignedSubjects([]);
        let studentSnap = await getDocs(
          query(collection(db, "students"), where("uid", "==", appUser.id))
        );
        if (studentSnap.empty && appUser.email) {
          studentSnap = await getDocs(
            query(collection(db, "students"), where("email", "==", appUser.email))
          );
        }
        if (!studentSnap.empty) {
          const s = studentSnap.docs[0].data();
          const sId = studentSnap.docs[0].id;

          // Check active enrollment
          const enSnap = await getDocs(
            query(collection(db, "enrollments"), where("studentId", "==", sId), where("status", "==", "active")),
          );
          const activeEn = !enSnap.empty ? enSnap.docs[0].data() : null;
          const grade = (activeEn?.className || s.grade || "") as string;
          const sectionId = (activeEn?.sectionId || s.sectionId || null) as string | null;
          const sectionName = (activeEn?.sectionName || null) as string | null;
          const rollNo = (activeEn?.rollNo || s.rollNo || null) as string | null;

          setStudentInfo({ grade, sectionId, sectionName, rollNo });

          // Fetch approved exam schedules for student's grade
          if (grade) {
            getDocs(
              query(
                collection(db, "examSchedules"),
                where("grade", "==", grade),
                where("status", "==", "approved"),
              ),
            )
              .then((eSnap) => {
                if (!eSnap.empty) {
                  setUpcomingExam(eSnap.docs[0].data());
                } else {
                  setUpcomingExam(null);
                }
              })
              .catch(() => {});
          }

          if (sectionId) {
            const [assignmentSnap, subjectSnap, teacherSnap, timetableSnap] = await Promise.all([
              getDocs(query(collection(db, "subjectAssignments"), where("sectionId", "==", sectionId))),
              getDocs(query(collection(db, "subjects"), where("grade", "==", grade))),
              getDocs(collection(db, "teachers")),
              getDocs(query(collection(db, "timetables"), where("sectionId", "==", sectionId))),
            ]);
            const subjectMap = new Map(subjectSnap.docs.map((doc) => [doc.id, doc.data() as { name?: string; category?: string }]));
            const teacherMap = new Map(teacherSnap.docs.map((doc) => [doc.id, doc.data() as { name?: string }]));
            const mappedSubjects = assignmentSnap.docs.map((doc) => {
              const data = doc.data() as { subjectId?: string; teacherId?: string };
              const subject = data.subjectId ? subjectMap.get(data.subjectId) : null;
              const teacher = data.teacherId ? teacherMap.get(data.teacherId) : null;
              return { id: doc.id, subjectName: subject?.name || "Subject", teacherName: teacher?.name || "Teacher not assigned", category: subject?.category || "scholastic" } as StudentAssignedSubject;
            }).sort((a, b) => a.subjectName.localeCompare(b.subjectName));
            setAssignedSubjects(mappedSubjects);
            const mappedSlots = timetableSnap.docs.map((doc) => {
              const data = doc.data() as {
                day?: string; weekday?: string; periodNumber?: number; periodLabel?: string;
                period?: string; startTime?: string; endTime?: string; subjectId?: string;
                subjectName?: string; teacherId?: string; teacherName?: string; entryType?: TimetableEntryType;
              };
              const subject = data.subjectId ? subjectMap.get(data.subjectId) : null;
              const teacher = data.teacherId ? teacherMap.get(data.teacherId) : null;
              return {
                id: doc.id, day: normalizeDay(data.day || data.weekday),
                periodNumber: Number(data.periodNumber) || undefined,
                periodLabel: data.periodLabel || data.period || "Period",
                startTime: data.startTime || "", endTime: data.endTime || "",
                subjectName: data.subjectName || subject?.name || "Subject",
                teacherName: data.teacherName || teacher?.name || "",
                entryType: data.entryType,
              } as StudentTimetableSlot;
            }).sort(sortByDayAndPeriod);
            setTimetableSlots(mappedSlots);
          }

          // Fetch Library summary for student widget
          try {
            const identity = await resolveStudentLibraryIdentifiers(appUser.id, appUser.email);
            if (identity.allIdentifiers.length > 0) {
              const rules = await getLibraryFineRules();
              const libQ = query(
                collection(db, "libraryTransactions"),
                where("memberId", "in", identity.allIdentifiers.slice(0, 10))
              );
              const libSnap = await getDocs(libQ);
              const txs = libSnap.docs.map((d) => d.data() as LibraryTransaction);
              const summary = calculateStudentLibrarySummary(txs, rules);
              setLibrarySummary({
                borrowedCount: summary.borrowedCount,
                dueSoonCount: summary.dueSoonCount,
                overdueCount: summary.overdueCount,
              });
            }
          } catch (libErr) {
            console.error("Failed to load student library summary for dashboard:", libErr);
          }
        }
      }
    };
    load();
  }, [appUser, currentSession]);

  if (appUser?.role === "operations") {
    return <OperationsDashboard />;
  }

  if (appUser?.role === "printing") {
    return <PrintingDashboard />;
  }

  if (appUser?.role === "teacher") {
    return <TeacherDashboard />;
  }

  if (appUser?.role === "admin") {
    return (
      <div data-testid="admin-dashboard" className="space-y-8">
        <div className="gradient-banner rounded-2xl px-8 py-8 text-white">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-blue-200/80">{getTodayFormatted()}</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">{getGreeting()}, {appUser.name}</h1>
              <p className="mt-1.5 text-sm text-slate-300/90">Here's what's happening at your school today.</p>
            </div>
            {workingSession && (
              <div className="rounded-xl bg-white/10 backdrop-blur-md border border-white/20 p-3.5 text-xs space-y-1">
                <span className="text-blue-200 font-semibold uppercase tracking-wider block text-[10px]">Academic Session</span>
                <span className="text-base font-bold text-white block">{workingSession.name}</span>
                <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${
                  workingSession.id === activeSession?.id ? "bg-emerald-500/30 text-emerald-200" : "bg-amber-500/30 text-amber-200"
                }`}>
                  {workingSession.id === activeSession?.id ? "Active Academic Session" : "Historical View"}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <GlassStatCard icon={<Users size={22} />} label="Teachers" value={stats.teachers} color="blue" />
          <GlassStatCard icon={<GraduationCap size={22} />} label="Students" value={stats.students} color="emerald" />
          <GlassStatCard icon={<School size={22} />} label="Classes" value={stats.classes} color="amber" />
        </div>

        <UpcomingEventsWidget />

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Quick Actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <GlassQuickLink href="/admin/calendar" label="School Calendar" desc="Manage events, assemblies, holidays & exams" icon={<CalendarDays size={20} className="text-blue-500" />} />
            <GlassQuickLink href="/admin/sessions" label="Academic Sessions" desc="Manage school years & active period" icon={<CalendarDays size={20} className="text-emerald-500" />} />
            <GlassQuickLink href="/admin/promotion" label="Student Promotion" desc="Promote students & roll forward sessions" icon={<GraduationCap size={20} className="text-indigo-500" />} />
            <GlassQuickLink href="/admin/operations" label="Operations Staff" desc="Manage printing, library & inventory users" icon={<Package size={20} className="text-blue-500" />} />
            <GlassQuickLink href="/admin/reports" label="Reports & Audits" desc="Institutional intelligence & audit ledger" icon={<BarChart3 size={20} className="text-purple-500" />} />
            <GlassQuickLink href="/admin/teachers" label="Manage Teachers" desc="Add and view teachers" icon={<Users size={20} className="text-blue-500" />} />
            <GlassQuickLink href="/admin/students" label="Manage Students" desc="Add and view students" icon={<GraduationCap size={20} className="text-cyan-500" />} />
            <GlassQuickLink href="/admin/classes" label="Manage Classes" desc="Manage sections, class teachers, and subjects" icon={<School size={20} className="text-amber-500" />} />
            <GlassQuickLink href="/admin/subjects" label="Manage Subjects" desc="Configure school curriculum and subjects" icon={<BookOpen size={20} className="text-violet-500" />} />
            <GlassQuickLink href="/admin/hods" label="Section Heads" desc="View and assign grade section heads" icon={<ShieldCheck size={20} className="text-purple-500" />} />
            <GlassQuickLink href="/admin/admissions" label="Admissions" desc="Manage admissions and new enrollments" icon={<FileText size={20} className="text-rose-500" />} />
          </div>
        </div>
      </div>
    );
  }

  if (appUser?.role === "accountant") {
    return (
      <div data-testid="accountant-dashboard" className="space-y-8">
        <div className="gradient-banner rounded-2xl px-8 py-8 text-white">
          <div className="relative z-10">
            <p className="text-sm font-medium text-blue-200/80">{getTodayFormatted()}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{getGreeting()}, {appUser.name}</h1>
            <p className="mt-1.5 text-sm text-slate-300/90">Manage class-wise fees, due dates, and collections.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          <GlassStatCard icon={<Users size={22} />} label="Students" value={stats.students} color="blue" />
          <GlassStatCard icon={<CreditCard size={22} />} label="Fee Structures" value={stats.feeStructures} color="amber" />
          <GlassStatCard icon={<FileText size={22} />} label="Payments Posted" value={stats.payments} color="violet" />
          <GlassStatCard icon={<BarChart3 size={22} />} label="Collections" value={formatCurrency(stats.collections)} color="emerald" />
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Quick Actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <GlassQuickLink href="/accounts/fees" label="Fee Structures" desc="Define class fees, due dates, and installments" icon={<CreditCard size={20} className="text-amber-500" />} />
            <GlassQuickLink href="/accounts/collections" label="Record Collections" desc="Post payments and review outstanding dues" icon={<FileText size={20} className="text-emerald-500" />} />
          </div>
        </div>
      </div>
    );
  }

  if (appUser?.role === "hod") {
    return (
      <div data-testid="hod-dashboard" className="space-y-8">
        <div className="gradient-banner rounded-2xl px-8 py-8 text-white">
          <div className="relative z-10">
            <p className="text-sm font-medium text-blue-200/80">{getTodayFormatted()}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{getGreeting()}, {appUser.name}</h1>
            <p className="mt-1.5 text-sm text-slate-300/90">Section Head overview and class management.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="glass-card-strong rounded-2xl p-6 border-amber-200/50">
            <div className="flex items-center gap-4">
              <div className="stat-card-icon bg-amber-100">
                <Clock size={22} className="text-amber-600 relative z-10" />
              </div>
              <div>
                <p className="text-3xl font-bold text-amber-700">{stats.pendingStudents}</p>
                <p className="text-sm font-medium text-amber-600">Pending Students</p>
                <p className="text-xs text-muted-foreground mt-0.5">Awaiting section assignment</p>
              </div>
            </div>
          </div>
        </div>

        <UpcomingEventsWidget />

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Quick Actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <GlassQuickLink href="/hod/calendar" label="School Calendar" desc="View school events, assemblies & exams" icon={<CalendarDays size={20} className="text-primary" />} />
            <GlassQuickLink href="/hod/pending" label="Assign Sections" desc="Assign pending students to sections" icon={<Clock size={20} className="text-amber-500" />} />
            <GlassQuickLink href="/hod/classes" label="Class Management" desc="Manage subjects and students by class" icon={<GraduationCap size={20} className="text-blue-500" />} />
            <GlassQuickLink href="/hod/timetable" label="Class Timetable" desc="Create and publish section timetables" icon={<CalendarDays size={20} className="text-emerald-500" />} />
          </div>
        </div>
      </div>
    );
  }

  if (appUser?.role === "student") {
    return (
      <div data-testid="student-dashboard" className="space-y-8">
        <div className="gradient-banner rounded-2xl px-8 py-8 text-white">
          <div className="relative z-10">
            <p className="text-sm font-medium text-blue-200/80">{getTodayFormatted()}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{getGreeting()}, {appUser.name}</h1>
            <p className="mt-1.5 text-sm text-slate-300/90">Your academic portal at a glance.</p>
          </div>
        </div>

        {studentInfo && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="glass-card-strong rounded-2xl p-6">
              <div className="flex items-center gap-4">
                <div className="stat-card-icon bg-blue-100">
                  <GraduationCap size={22} className="text-blue-600 relative z-10" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-700">Grade {studentInfo.grade}</p>
                  <p className="text-sm font-medium text-muted-foreground">
                    {studentInfo.sectionName ? `Section ${studentInfo.sectionName}` : studentInfo.sectionId ? `Section Assigned` : "Section not assigned"}
                    {studentInfo.rollNo && <span className="ml-2 font-mono font-bold text-slate-800">• Roll No: {studentInfo.rollNo}</span>}
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-card-strong rounded-2xl p-6">
              <div className="flex items-center gap-4">
                <div className="stat-card-icon bg-emerald-100">
                  <School size={22} className="text-emerald-600 relative z-10" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-700">Enrolled Student</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Session: {currentSession}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {upcomingExam && (
          <div className="bg-gradient-to-r from-indigo-50 to-primary/5 border border-primary/20 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <CalendarDays size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-base text-slate-900">{upcomingExam.examType}</p>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    Approved by Principal
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Official examination timetable published for Grade {studentInfo?.grade} • {upcomingExam.exams?.length || 0} subjects scheduled
                </p>
              </div>
            </div>
            <Link href="/student/exams">
              <a className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all shrink-0">
                <span>View Timetable</span>
                <ArrowUpRight size={14} />
              </a>
            </Link>
          </div>
        )}

        {/* Library Summary Widget */}
        <div className="glass-card-strong rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
              <BookOpen size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-bold text-base text-slate-900">Institutional Library</p>
                {librarySummary && librarySummary.overdueCount > 0 ? (
                  <span className="bg-rose-100 text-rose-800 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    {librarySummary.overdueCount} Overdue
                  </span>
                ) : librarySummary && librarySummary.dueSoonCount > 0 ? (
                  <span className="bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    {librarySummary.dueSoonCount} Due Soon
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {librarySummary
                  ? librarySummary.borrowedCount === 0
                    ? "📚 You currently have no borrowed books"
                    : `📚 ${librarySummary.borrowedCount} ${librarySummary.borrowedCount === 1 ? "Book" : "Books"} Borrowed` +
                      (librarySummary.overdueCount > 0
                        ? ` • ⚠️ ${librarySummary.overdueCount} overdue`
                        : librarySummary.dueSoonCount > 0
                        ? ` • ⚠️ ${librarySummary.dueSoonCount} due soon`
                        : " • All returns on track")
                  : "Track your borrowed books, upcoming due dates, and reading records"}
              </p>
            </div>
          </div>
          <Link href="/student/library">
            <a className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition-all shrink-0">
              <span>View Library</span>
              <ArrowUpRight size={14} />
            </a>
          </Link>
        </div>

        <UpcomingEventsWidget />

        <div>
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays size={16} className="text-primary" />
            <h2 className="font-semibold text-sm">My Timetable</h2>
            {timetableSlots.length > 0 ? (
              <span className="text-xs bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 font-medium">{timetableSlots.length} periods</span>
            ) : null}
          </div>

          {!studentInfo?.sectionId ? (
            <div className="glass-card-strong rounded-2xl p-8 text-center">
              <p className="font-semibold">Timetable will appear after section assignment</p>
              <p className="mt-1 text-sm text-muted-foreground">Your section is not assigned yet.</p>
            </div>
          ) : timetableSlots.length > 0 ? (
            <div className="glass-card-strong rounded-2xl overflow-hidden">
              <div className="p-5">
                <div className="overflow-x-auto pb-2">
                  <SchoolTimetableSheet
                    slots={studentTimetableSheetSlots}
                    classLabel={studentInfo ? `Grade ${studentInfo.grade}` : "Grade --"}
                    sectionLabel={studentInfo?.sectionId ? `Section ${studentInfo.sectionId}` : "Section --"}
                    schoolName="Prestige International School"
                    sessionLabel={currentSession}
                  />
                </div>
              </div>
            </div>
          ) : assignedSubjects.length > 0 ? (
            <div className="glass-card-strong rounded-2xl p-5">
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
                Detailed timetable is not published yet. Showing assigned subjects.
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {assignedSubjects.map((subject) => (
                  <div key={subject.id} className="rounded-2xl border border-border/60 bg-white/60 p-4 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">{subject.subjectName}</p>
                        <p className="text-sm text-muted-foreground">{subject.teacherName || "Teacher not assigned"}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                        subject.category === "co-scholastic" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                      }`}>{subject.category === "co-scholastic" ? "Co-Scholastic" : "Scholastic"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="glass-card-strong rounded-2xl p-8 text-center">
              <p className="font-semibold">No timetable published yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Ask your school to publish the timetable for your section.</p>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Quick Actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <GlassQuickLink href="/student/calendar" label="School Calendar" desc="View school events, activities & exams" icon={<CalendarDays size={20} className="text-primary" />} />
            <GlassQuickLink href="/student/library" label="School Library" desc="View borrowed books, due dates & history" icon={<BookOpen size={20} className="text-violet-500" />} />
            <GlassQuickLink href="/student/exams" label="Exam Timetable" desc="View approved examination schedule" icon={<CalendarDays size={20} className="text-indigo-500" />} />
            <GlassQuickLink href="/student/fees" label="My Fees" desc="Check fee schedule, dues, and payment history" icon={<CreditCard size={20} className="text-emerald-500" />} />
            <GlassQuickLink href="/student/assignments" label="Assignments" desc="View homework, projects, and activities" icon={<FileText size={20} className="text-blue-500" />} />
            <GlassQuickLink href="/student/notices" label="School Notices" desc="Read announcements and school updates" icon={<Bell size={20} className="text-amber-500" />} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold">Welcome, {appUser?.name}</h2>
        <p className="text-muted-foreground mt-1">Role: {appUser?.role}</p>
      </div>
    </div>
  );
}

interface StatColor { bg: string; iconBg: string; iconText: string; valueText: string; }
const STAT_COLORS: Record<string, StatColor> = {
  blue: { bg: "", iconBg: "bg-blue-100", iconText: "text-blue-600", valueText: "text-foreground" },
  emerald: { bg: "", iconBg: "bg-emerald-100", iconText: "text-emerald-600", valueText: "text-foreground" },
  amber: { bg: "", iconBg: "bg-amber-100", iconText: "text-amber-600", valueText: "text-foreground" },
  violet: { bg: "", iconBg: "bg-violet-100", iconText: "text-violet-600", valueText: "text-foreground" },
  cyan: { bg: "", iconBg: "bg-cyan-100", iconText: "text-cyan-600", valueText: "text-foreground" },
};

function GlassStatCard({ icon, label, value, color }: {
  icon: ReactNode; label: string; value: number | string; color: string;
}) {
  const c = STAT_COLORS[color] || STAT_COLORS.blue;
  return (
    <div data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`} className="glass-card-strong hover-elevate rounded-2xl p-5 cursor-default">
      <div className="flex items-center gap-4">
        <div className={`stat-card-icon ${c.iconBg}`}>
          <span className={`${c.iconText} relative z-10`}>{icon}</span>
        </div>
        <div className="min-w-0">
          <p className={`text-2xl font-bold ${c.valueText}`}>{value}</p>
          <p className="text-sm text-muted-foreground truncate">{label}</p>
        </div>
      </div>
    </div>
  );
}

function GlassQuickLink({ href, label, desc, icon }: {
  href: string; label: string; desc: string; icon: ReactNode;
}) {
  return (
    <Link href={href}>
      <a data-testid={`quick-link-${label.toLowerCase().replace(/\s+/g, '-')}`}>
        <div className="glass-card hover-elevate rounded-2xl p-5 cursor-pointer group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-slate-100/80 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">{icon}</div>
              <div>
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
            <ArrowUpRight size={16} className="text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
          </div>
        </div>
      </a>
    </Link>
  );
}

type ReactNode = import("react").ReactNode;

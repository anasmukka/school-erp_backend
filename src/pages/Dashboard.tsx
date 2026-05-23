import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getAcademicSession } from "@/lib/fees";
import { TimetableEntryType } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import {
  GraduationCap, Users, BookOpen, Clock, FileText, Award,
  Bell, CalendarDays, CreditCard, ChevronRight, TrendingUp,
  BarChart3, ArrowUpRight,
} from "lucide-react";
import { Link } from "wouter";
import TeacherDashboard from "@/pages/teacher/Dashboard";
import SchoolTimetableSheet, { SchoolTimetableSheetSlot } from "@/components/timetable/SchoolTimetableSheet";

interface ExamNotice {
  id: string;
  examType: string;
  grade: string;
  message: string;
  createdAt: string;
  examDates: { subjectName: string; date: string }[];
}

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
  const currentSession = getAcademicSession();
  const [stats, setStats] = useState({
    teachers: 0, students: 0, pendingStudents: 0,
    feeStructures: 0, payments: 0, collections: 0,
  });
  const [studentInfo, setStudentInfo] = useState<{ grade: string; sectionId: string | null; hasReleasedRC: boolean } | null>(null);
  const [examNotices, setExamNotices] = useState<ExamNotice[]>([]);
  const [timetableSlots, setTimetableSlots] = useState<StudentTimetableSlot[]>([]);
  const [assignedSubjects, setAssignedSubjects] = useState<StudentAssignedSubject[]>([]);
  const [expandedNotice, setExpandedNotice] = useState<string | null>(null);
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
        const [t, s, feeStructuresSnap, paymentsSnap] = await Promise.all([
          getDocs(collection(db, "teachers")),
          getDocs(collection(db, "students")),
          getDocs(query(collection(db, "feeStructures"), where("academicSession", "==", currentSession))),
          getDocs(query(collection(db, "feePayments"), where("academicSession", "==", currentSession))),
        ]);
        const collections = paymentsSnap.docs.reduce(
          (total, record) => total + (Number(record.data().amount) || 0), 0,
        );
        setStats({ teachers: t.size, students: s.size, pendingStudents: 0, feeStructures: feeStructuresSnap.size, payments: paymentsSnap.size, collections });
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
          const studentDocId = studentSnap.docs[0].id;
          const grade = s.grade as string;
          const sectionId = (s.sectionId as string | null) ?? null;

          const [rcSnap, noticeSnap] = await Promise.all([
            getDocs(query(
              collection(db, "reportCards"),
              where("studentId", "==", studentDocId),
              where("status", "==", "generated")
            )),
            getDocs(query(
              collection(db, "notices"),
              where("grade", "==", grade),
              where("type", "==", "exam_schedule")
            )),
          ]);

          setStudentInfo({ grade, sectionId, hasReleasedRC: !rcSnap.empty });

          const seen = new Set<string>();
          const notices: ExamNotice[] = [];
          const sortedNoticeDocs = [...noticeSnap.docs].sort(
            (a, b) => (b.data().createdAt ?? "").localeCompare(a.data().createdAt ?? "")
          );
          sortedNoticeDocs.forEach((d) => {
            const data = d.data();
            const key = `${data.examType}`;
            if (!seen.has(key)) { seen.add(key); notices.push({ id: d.id, ...data } as ExamNotice); }
          });
          setExamNotices(notices);

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
        }
      }
    };
    load();
  }, [appUser, currentSession]);

  if (appUser?.role === "teacher") {
    return <TeacherDashboard />;
  }

  if (appUser?.role === "admin") {
    return (
      <div data-testid="admin-dashboard" className="space-y-8">
        <div className="gradient-banner rounded-2xl px-8 py-8 text-white">
          <div className="relative z-10">
            <p className="text-sm font-medium text-blue-200/80">{getTodayFormatted()}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{getGreeting()}, {appUser.name}</h1>
            <p className="mt-1.5 text-sm text-slate-300/90">Here's what's happening at your school today.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          <GlassStatCard icon={<Users size={22} />} label="Teachers" value={stats.teachers} color="blue" />
          <GlassStatCard icon={<GraduationCap size={22} />} label="Students" value={stats.students} color="emerald" />
          <GlassStatCard icon={<CreditCard size={22} />} label="Fee Structures" value={stats.feeStructures} color="amber" />
          <GlassStatCard icon={<TrendingUp size={22} />} label="Collections" value={formatCurrency(stats.collections)} color="violet" />
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Quick Actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <GlassQuickLink href="/admin/teachers" label="Manage Teachers" desc="Add and view teachers" icon={<Users size={20} className="text-blue-500" />} />
            <GlassQuickLink href="/admin/students" label="Manage Students" desc="Add and view students" icon={<GraduationCap size={20} className="text-emerald-500" />} />
            <GlassQuickLink href="/accounts/fees" label="Fees Management" desc="Publish class fee structures" icon={<CreditCard size={20} className="text-amber-500" />} />
            <GlassQuickLink href="/accounts/collections" label="Fee Collections" desc="Record payments and receipts" icon={<FileText size={20} className="text-violet-500" />} />
            <GlassQuickLink href="/admin/admissions" label="Admissions" desc="Manage admissions and new enrollments" icon={<BookOpen size={20} className="text-cyan-500" />} />
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

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Quick Actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    {studentInfo.sectionId ? `Section ${studentInfo.sectionId}` : "Section not assigned"}
                  </p>
                </div>
              </div>
            </div>

            <div className={`glass-card-strong rounded-2xl p-6 ${studentInfo.hasReleasedRC ? 'border-emerald-200/50' : ''}`}>
              <div className="flex items-center gap-4">
                <div className={`stat-card-icon ${studentInfo.hasReleasedRC ? "bg-emerald-100" : "bg-slate-100"}`}>
                  <Award size={22} className={`relative z-10 ${studentInfo.hasReleasedRC ? "text-emerald-600" : "text-slate-400"}`} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${studentInfo.hasReleasedRC ? "text-emerald-700" : "text-muted-foreground"}`}>
                    {studentInfo.hasReleasedRC ? "Report Card Available" : "Result Not Released"}
                  </p>
                  <p className={`text-xs mt-0.5 ${studentInfo.hasReleasedRC ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {studentInfo.hasReleasedRC ? "Your Final Exam results are ready" : "Check back later"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {examNotices.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Bell size={16} className="text-primary" />
              <h2 className="font-semibold text-sm">Exam Notices</h2>
              <span className="text-xs bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 font-medium">{examNotices.length}</span>
            </div>
            <div className="space-y-3">
              {examNotices.map((notice) => {
                const isExpanded = expandedNotice === notice.id;
                return (
                  <div key={notice.id} className="glass-card-strong rounded-2xl overflow-hidden">
                    <button className="w-full text-left px-5 py-4" onClick={() => setExpandedNotice(isExpanded ? null : notice.id)}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                            <CalendarDays size={18} className="text-blue-500" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{notice.examType}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{notice.message}</p>
                          </div>
                        </div>
                        <span className="text-xs text-primary font-medium shrink-0">{isExpanded ? "Hide" : "View dates"}</span>
                      </div>
                    </button>
                    {isExpanded && notice.examDates && notice.examDates.length > 0 && (
                      <div className="px-5 pb-4 border-t border-border/40 pt-3 space-y-2">
                        {[...notice.examDates].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((ed) => (
                          <div key={ed.subjectName} className="flex items-center justify-between text-sm">
                            <span className="font-medium">{ed.subjectName}</span>
                            <span className="text-muted-foreground">{new Date(ed.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <GlassQuickLink href="/student/fees" label="My Fees" desc="Check fee schedule, dues, and payment history" icon={<CreditCard size={20} className="text-emerald-500" />} />
            <GlassQuickLink href="/student/report-card" label="My Report Card" desc="View your Final Exam results" icon={<FileText size={20} className="text-blue-500" />} />
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

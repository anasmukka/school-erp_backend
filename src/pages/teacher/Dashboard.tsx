import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  School, BookOpen, FileText,
  Calendar, CalendarDays, ChevronRight, GraduationCap, ArrowUpRight, Wifi, ClipboardCheck, FileSpreadsheet,
} from "lucide-react";
import { Link } from "wouter";
import UpcomingEventsWidget from "@/components/calendar/UpcomingEventsWidget";

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

export default function TeacherDashboard() {
  const { appUser } = useAuth();
  const [isClassTeacher, setIsClassTeacher] = useState(false);
  const [assignedSections, setAssignedSections] = useState(0);
  const [assignedSubjects, setAssignedSubjects] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appUser) return;
    const load = async () => {
      try {
        let teacherSnap = await getDocs(
          query(collection(db, "teachers"), where("uid", "==", appUser.id))
        );
        if (teacherSnap.empty && appUser.email) {
          teacherSnap = await getDocs(
            query(collection(db, "teachers"), where("email", "==", appUser.email))
          );
          if (!teacherSnap.empty) {
            const { doc: fDoc, updateDoc } = await import("firebase/firestore");
            updateDoc(fDoc(db, "teachers", teacherSnap.docs[0].id), { uid: appUser.id }).catch(() => {});
          }
        }
        if (teacherSnap.empty) { setLoading(false); return; }
        const teacherDocId = teacherSnap.docs[0].id;

        const [assignmentSnap, sectionSnap] = await Promise.all([
          getDocs(query(collection(db, "subjectAssignments"), where("teacherId", "==", teacherDocId))),
          getDocs(query(collection(db, "sections"), where("classTeacherId", "==", teacherDocId))),
        ]);

        const assignments = assignmentSnap.docs.map((d) => d.data() as { subjectId: string; sectionId: string });
        const uniqueSections = new Set(assignments.map((a) => a.sectionId));
        const uniqueSubjects = new Set(assignments.map((a) => a.subjectId));
        setAssignedSections(uniqueSections.size);
        setAssignedSubjects(uniqueSubjects.size);

        const classTeacher = !sectionSnap.empty;
        setIsClassTeacher(classTeacher);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [appUser]);

  return (
    <div data-testid="teacher-dashboard" className="space-y-8">
      <div className="gradient-banner rounded-2xl px-8 py-8 text-white">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <p className="text-sm font-medium text-blue-200/80">{getTodayFormatted()}</p>
            {!loading && (
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${
                isClassTeacher
                  ? "bg-blue-500/20 text-blue-100 border-blue-400/30"
                  : "bg-emerald-500/20 text-emerald-100 border-emerald-400/30"
              }`}>
                {isClassTeacher ? "Class Teacher" : "Subject Teacher"}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{getGreeting()}, {appUser?.name}</h1>
          <p className="mt-1.5 text-sm text-slate-300/90">Your teaching overview and quick actions.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="glass-card-strong hover-elevate rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="stat-card-icon bg-blue-100">
              <School size={22} className="text-blue-600 relative z-10" />
            </div>
            <div>
              <p className="text-2xl font-bold">{loading ? "..." : String(assignedSections)}</p>
              <p className="text-sm text-muted-foreground">Assigned Sections</p>
            </div>
          </div>
        </div>
        <div className="glass-card-strong hover-elevate rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="stat-card-icon bg-violet-100">
              <BookOpen size={22} className="text-violet-600 relative z-10" />
            </div>
            <div>
              <p className="text-2xl font-bold">{loading ? "..." : String(assignedSubjects)}</p>
              <p className="text-sm text-muted-foreground">Assigned Subjects</p>
            </div>
          </div>
        </div>
      </div>

      <UpcomingEventsWidget />

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">Quick Actions</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassQuickLink
            href="/teacher/calendar"
            label="School Calendar"
            desc="View school events, assemblies, holidays & exams"
            icon={<CalendarDays size={20} className="text-primary" />}
          />
          <GlassQuickLink
            href="/teacher/marks"
            label="Marks Entry"
            desc="Enter student assessment marks aligned with Academic Structure"
            icon={<FileSpreadsheet size={20} className="text-emerald-500" />}
          />
          <GlassQuickLink
            href="/teacher/assignments"
            label="Assignments & Activities"
            desc="Manage assignments, homework, and class activities"
            icon={<FileText size={20} className="text-blue-500" />}
          />
          {isClassTeacher && (
            <>
              <GlassQuickLink
                href="/teacher/attendance-register"
                label="Attendance Register"
                desc="Monthly register view with day-wise status"
                icon={<Calendar size={20} className="text-amber-500" />}
              />
              <GlassQuickLink
                href="/teacher/manual-attendance"
                label="Manual Attendance"
                desc="Mark P/A/L for today's class list"
                icon={<ClipboardCheck size={20} className="text-emerald-500" />}
              />
              <GlassQuickLink
                href="/teacher/rfid-attendance"
                label="RFID Attendance"
                desc="Live view of today's scans for your section"
                icon={<Wifi size={20} className="text-indigo-500" />}
              />
            </>
          )}
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

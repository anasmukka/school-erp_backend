import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Section, Student } from "@/lib/types";
import { getCurrentAcademicYear, loadStudentsForSection, sortStudentsByRoll } from "@/lib/enrollments";
import { CalendarDays, Loader2, Lock, RefreshCcw, Wifi } from "lucide-react";

interface AttendanceDoc {
  id: string;
  studentId: string;
  sectionId?: string;
  date: string;
  status?: string;
  source?: string;
  time?: string;
  inTime?: string;
  outTime?: string;
}

function getLocalIsoDate(date = new Date()) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function formatTime(value?: string) {
  if (!value) return "—";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value.slice(0, 5);
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }
  return value;
}

function studentRollLabel(student: Student, index: number) {
  return student.rollNo?.trim() || String(index + 1).padStart(2, "0");
}

export default function TeacherRfidAttendance() {
  const { appUser, loading } = useAuth();
  const { toast } = useToast();
  const [initializing, setInitializing] = useState(true);
  const [teacherDocId, setTeacherDocId] = useState<string | null>(null);
  const [assignedSection, setAssignedSection] = useState<Section | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceByStudent, setAttendanceByStudent] = useState<Record<string, AttendanceDoc>>({});
  const [academicYear, setAcademicYear] = useState("");

  const today = useMemo(() => getLocalIsoDate(), []);

  useEffect(() => {
    void getCurrentAcademicYear().then(setAcademicYear);
  }, []);

  const loadTeacherSection = async () => {
    if (!appUser) return;
    setInitializing(true);
    try {
      let teacherSnap = await getDocs(query(collection(db, "teachers"), where("uid", "==", appUser.id)));
      if (teacherSnap.empty && appUser.email) {
        teacherSnap = await getDocs(query(collection(db, "teachers"), where("email", "==", appUser.email)));
        if (!teacherSnap.empty) {
          const { doc: firestoreDoc, updateDoc } = await import("firebase/firestore");
          updateDoc(firestoreDoc(db, "teachers", teacherSnap.docs[0].id), { uid: appUser.id }).catch(() => {});
        }
      }

      if (teacherSnap.empty) {
        setTeacherDocId(null);
        setAssignedSection(null);
        return;
      }

      const tDocId = teacherSnap.docs[0].id;
      setTeacherDocId(tDocId);

      const sectionSnap = await getDocs(query(collection(db, "sections"), where("classTeacherId", "==", tDocId)));
      const secs = sectionSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
      secs.sort((a, b) => {
        if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true });
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      setAssignedSection(secs[0] ?? null);
    } catch (error: any) {
      toast({
        title: "Unable to load attendance",
        description: error?.message || "Please try again in a moment.",
        variant: "destructive",
      });
      setTeacherDocId(null);
      setAssignedSection(null);
    } finally {
      setInitializing(false);
    }
  };

  useEffect(() => {
    if (!appUser) return;
    loadTeacherSection();
  }, [appUser]);

  useEffect(() => {
    if (!assignedSection?.id) {
      setStudents([]);
      setAttendanceByStudent({});
      return () => {};
    }

    const attendanceQuery = query(
      collection(db, "attendance"),
      where("sectionId", "==", assignedSection.id),
      where("date", "==", today),
    );

    const enrollmentQuery = academicYear
      ? query(
          collection(db, "enrollments"),
          where("sectionId", "==", assignedSection.id),
          where("status", "==", "active"),
          where("academicYear", "==", academicYear),
        )
      : null;

    const unsubscribeStudents = enrollmentQuery
      ? onSnapshot(
          enrollmentQuery,
          async () => {
            const nextStudents = await loadStudentsForSection(assignedSection.id, academicYear);
            setStudents(sortStudentsByRoll(nextStudents) as Student[]);
          },
          () => {
            /* ignore */
          },
        )
      : () => {};

    const unsubscribeAttendance = onSnapshot(
      attendanceQuery,
      (snap) => {
        const nextMap: Record<string, AttendanceDoc> = {};
        snap.docs.forEach((docSnap) => {
          const payload = { id: docSnap.id, ...docSnap.data() } as AttendanceDoc;
          if (!payload.studentId) return;
          nextMap[payload.studentId] = payload;
        });
        setAttendanceByStudent(nextMap);
      },
      () => {
        /* ignore */
      },
    );

    return () => {
      unsubscribeStudents();
      unsubscribeAttendance();
    };
  }, [assignedSection?.id, academicYear, today]);

  return (
    <div className="space-y-6" data-testid="teacher-rfid-attendance-page">
      <section className="overflow-hidden rounded-[26px] border border-[#e4ddcf] bg-[linear-gradient(145deg,rgba(255,252,245,0.98),rgba(248,243,232,0.94))] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.6)]">
        <div className="px-6 py-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8ccb8] bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#5d6782]">
                <Wifi size={14} />
                Live RFID
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">RFID Attendance</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Today's scans update instantly for your assigned class section.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="gap-2 border-[#d8ccb8] bg-white/80"
                onClick={loadTeacherSection}
                disabled={loading || initializing}
              >
                {initializing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
                Refresh
              </Button>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#f2ebdc] px-3 py-1 text-xs font-medium text-slate-600">
                <CalendarDays size={14} />
                {today}
              </span>
            </div>
          </div>
        </div>
      </section>

      {(loading || initializing) ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
      ) : !appUser || !teacherDocId || !assignedSection ? (
        <Card className="border-slate-200/80 bg-white/80 shadow-[0_18px_42px_-30px_rgba(15,23,42,0.4)]">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Lock size={36} className="mx-auto mb-3 opacity-35" />
            <p className="font-medium text-foreground">Class teachers only</p>
            <p className="mt-1 text-sm">
              You need an assigned section to view RFID attendance.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-[#ddd2bf] bg-[linear-gradient(180deg,rgba(255,252,246,0.98),rgba(251,247,238,0.95))] shadow-[0_22px_48px_-34px_rgba(15,23,42,0.45)]">
          <CardContent className="p-0">
            <div className="flex flex-col gap-2 border-b border-[#ddd2bf] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Grade {assignedSection.grade} - {assignedSection.name}
                </p>
                <p className="text-xs text-slate-500">
                  {students.length} students • {Object.keys(attendanceByStudent).length} marked today
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <StatPill label="Present" value={String(students.filter((s) => attendanceByStudent[s.id] && (attendanceByStudent[s.id].status || "present") !== "late").length)} tone="present" />
                <StatPill label="Late" value={String(students.filter((s) => attendanceByStudent[s.id]?.status === "late").length)} tone="late" />
                <StatPill label="Absent" value={String(students.filter((s) => !attendanceByStudent[s.id]).length)} tone="absent" />
              </div>
            </div>

            {students.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">
                No students are assigned to this section yet.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full border-collapse font-serif text-[13px]">
                  <thead>
                    <tr className="bg-[#f3ebdc] text-slate-700">
                      <th className="sticky left-0 z-30 w-[92px] min-w-[92px] border border-[#d9cfbb] bg-[#f3ebdc] px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em]">
                        Roll No
                      </th>
                      <th className="sticky left-[92px] z-30 w-[260px] min-w-[260px] border border-[#d9cfbb] bg-[#f3ebdc] px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em]">
                        Student Name
                      </th>
                      <th className="min-w-[130px] border border-[#d9cfbb] px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em]">
                        In Time
                      </th>
                      <th className="min-w-[130px] border border-[#d9cfbb] px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em]">
                        Out Time
                      </th>
                      <th className="min-w-[160px] border border-[#d9cfbb] px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em]">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student, index) => {
                      const rowBase = index % 2 === 0 ? "bg-[#fffdf8]" : "bg-[#fbf7ef]";
                      const record = attendanceByStudent[student.id];
                      const status = record?.status === "late" ? "Late" : record ? "Present" : "Absent";
                      const inTime = formatTime(record?.inTime || record?.time);
                      const outTime = formatTime(record?.outTime);
                      const source = record?.source || "";

                      return (
                        <tr key={student.id} className={rowBase}>
                          <td className={`sticky left-0 z-20 border border-[#d9cfbb] px-3 py-3 text-sm font-semibold text-slate-700 ${rowBase}`}>
                            {studentRollLabel(student, index)}
                          </td>
                          <td className={`sticky left-[92px] z-20 border border-[#d9cfbb] px-4 py-3 text-sm font-medium text-slate-900 ${rowBase}`}>
                            {student.name}
                          </td>
                          <td className="border border-[#d9cfbb] px-4 py-3 text-sm text-slate-700">{record ? inTime : "—"}</td>
                          <td className="border border-[#d9cfbb] px-4 py-3 text-sm text-slate-700">{record ? outTime : "—"}</td>
                          <td className="border border-[#d9cfbb] px-4 py-3">
                            <StatusPill status={status} source={source} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusPill({ status, source }: { status: "Present" | "Late" | "Absent"; source: string }) {
  const styles =
    status === "Present"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "Late"
        ? "border-amber-200 bg-amber-100 text-amber-800"
        : "border-slate-200 bg-slate-100 text-slate-600";

  const sourceLabel = source === "manual" ? "Manual" : source === "rfid" ? "RFID" : "";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${styles}`}>
      <span>{status}</span>
      {sourceLabel && <span className="text-[10px] font-semibold opacity-75">{sourceLabel}</span>}
    </span>
  );
}

function StatPill({ label, value, tone }: { label: string; value: string; tone: "present" | "late" | "absent" }) {
  const styles =
    tone === "present"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "late"
        ? "border-amber-200 bg-amber-100 text-amber-800"
        : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 ${styles}`}>
      <span className="text-xs font-semibold">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-75">{label}</span>
    </span>
  );
}

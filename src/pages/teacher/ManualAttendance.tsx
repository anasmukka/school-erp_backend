import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Section, Student } from "@/lib/types";
import { CalendarDays, Loader2, Lock, RefreshCcw, Save } from "lucide-react";

type AttendanceCode = "P" | "A" | "L";

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

function getLocalTime() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
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

function codeFromRecord(record: AttendanceDoc | undefined): AttendanceCode {
  if (!record) return "A";
  return record.status === "late" ? "L" : "P";
}

export default function ManualAttendance() {
  const { appUser, loading } = useAuth();
  const { toast } = useToast();
  const [initializing, setInitializing] = useState(true);
  const [teacherDocId, setTeacherDocId] = useState<string | null>(null);
  const [assignedSection, setAssignedSection] = useState<Section | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceByStudent, setAttendanceByStudent] = useState<Record<string, AttendanceDoc>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const today = useMemo(() => getLocalIsoDate(), []);

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
        title: "Unable to load section",
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

    const studentQuery = query(collection(db, "students"), where("sectionId", "==", assignedSection.id));
    const attendanceQuery = query(
      collection(db, "attendance"),
      where("sectionId", "==", assignedSection.id),
      where("date", "==", today),
    );

    const unsubscribeStudents = onSnapshot(
      studentQuery,
      (snap) => {
        const nextStudents = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Student));
        nextStudents.sort((a, b) => {
          const ar = a.rollNo?.trim() ?? "";
          const br = b.rollNo?.trim() ?? "";
          return ar.localeCompare(br, undefined, { numeric: true, sensitivity: "base" }) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        });
        setStudents(nextStudents);
      },
      () => {
        /* ignore */
      },
    );

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
  }, [assignedSection?.id, today]);

  const setStudentAttendance = async (student: Student, nextCode: AttendanceCode) => {
    if (!assignedSection || !teacherDocId) return;

    const existing = attendanceByStudent[student.id];
    const docId = existing?.id || `${student.id}_${today}`;
    const docRef = doc(db, "attendance", docId);
    const pendingKey = `${student.id}_${today}`;

    setPending((current) => ({ ...current, [pendingKey]: true }));
    try {
      if (nextCode === "A") {
        if (!existing) {
          return;
        }
        if ((existing.source || "") === "rfid") {
          toast({
            title: "RFID scan already recorded",
            description: "This entry was marked via RFID. Manual removal is disabled here.",
            variant: "destructive",
          });
          return;
        }
        await deleteDoc(docRef);
        return;
      }

      const status = nextCode === "L" ? "late" : "present";
      const baseTime = existing?.inTime || existing?.time || "";
      const source = (existing?.source || "") === "rfid" ? "rfid" : "manual";

      await setDoc(
        docRef,
        {
          studentId: student.id,
          sectionId: assignedSection.id,
          date: today,
          status,
          source,
          time: baseTime || getLocalTime(),
          updatedAt: new Date().toISOString(),
          updatedBy: teacherDocId,
        },
        { merge: true },
      );
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error?.message || "Attendance could not be saved.",
        variant: "destructive",
      });
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[pendingKey];
        return next;
      });
    }
  };

  return (
    <div className="space-y-6" data-testid="manual-attendance-page">
      <section className="overflow-hidden rounded-[26px] border border-[#e4ddcf] bg-[linear-gradient(145deg,rgba(255,252,245,0.98),rgba(248,243,232,0.94))] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.6)]">
        <div className="px-6 py-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8ccb8] bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#5d6782]">
                <Save size={14} />
                Manual Entry
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">Manual Attendance</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Mark P, A, or L for today's roster. Saved records appear in the register instantly.
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
              You need an assigned section to mark manual attendance.
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
                  {students.length} students • {Object.keys(attendanceByStudent).length} marked
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
                      <th className="min-w-[210px] border border-[#d9cfbb] px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em]">
                        Mark
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student, index) => {
                      const rowBase = index % 2 === 0 ? "bg-[#fffdf8]" : "bg-[#fbf7ef]";
                      const record = attendanceByStudent[student.id];
                      const code = codeFromRecord(record);
                      const pendingKey = `${student.id}_${today}`;
                      const isPending = Boolean(pending[pendingKey]);

                      return (
                        <tr key={student.id} className={rowBase}>
                          <td className={`sticky left-0 z-20 border border-[#d9cfbb] px-3 py-3 text-sm font-semibold text-slate-700 ${rowBase}`}>
                            {studentRollLabel(student, index)}
                          </td>
                          <td className={`sticky left-[92px] z-20 border border-[#d9cfbb] px-4 py-3 text-sm font-medium text-slate-900 ${rowBase}`}>
                            {student.name}
                          </td>
                          <td className="border border-[#d9cfbb] px-4 py-3">
                            <AttendanceToggle
                              value={code}
                              pending={isPending}
                              onChange={(next) => setStudentAttendance(student, next)}
                            />
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

function AttendanceToggle({
  value,
  pending,
  onChange,
}: {
  value: AttendanceCode;
  pending: boolean;
  onChange: (next: AttendanceCode) => void;
}) {
  const base =
    "w-10 h-10 rounded-lg border text-xs font-bold transition-colors disabled:opacity-60 disabled:cursor-wait";

  const getButtonStyles = (code: AttendanceCode) => {
    if (value === code) {
      if (code === "P") return `${base} border-emerald-300 bg-emerald-100 text-emerald-800`;
      if (code === "L") return `${base} border-amber-300 bg-amber-200 text-amber-900`;
      return `${base} border-slate-300 bg-slate-200 text-slate-700`;
    }
    if (code === "P") return `${base} border-emerald-200 bg-white hover:bg-emerald-50 text-emerald-700`;
    if (code === "L") return `${base} border-amber-200 bg-white hover:bg-amber-50 text-amber-700`;
    return `${base} border-slate-200 bg-white hover:bg-slate-50 text-slate-600`;
  };

  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={pending} onClick={() => onChange("P")} className={getButtonStyles("P")}>P</button>
      <button type="button" disabled={pending} onClick={() => onChange("A")} className={getButtonStyles("A")}>A</button>
      <button type="button" disabled={pending} onClick={() => onChange("L")} className={getButtonStyles("L")}>L</button>
      {pending && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
    </div>
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

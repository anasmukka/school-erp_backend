import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Section, Student } from "@/lib/types";
import {
  getCurrentAcademicYear,
  loadStudentsForSection,
  sortStudentsByRoll,
} from "@/lib/enrollments";
import {
  CalendarDays,
  CheckCheck,
  ClipboardCheck,
  FileSpreadsheet,
  Loader2,
  Lock,
  RefreshCcw,
  Save,
  UserX,
} from "lucide-react";
import { Link } from "wouter";

type AttendanceCode = "P" | "A" | "L";

interface AttendanceDoc {
  id: string;
  studentId: string;
  studentUid?: string;
  studentName?: string;
  sectionId?: string;
  grade?: string;
  date: string;
  status: "present" | "absent" | "late";
  source?: string;
  time?: string;
  updatedAt?: string;
  updatedBy?: string;
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

function studentRollLabel(student: Student, index: number) {
  return student.rollNo?.trim() || String(index + 1).padStart(2, "0");
}

function codeFromRecord(record: AttendanceDoc | undefined): AttendanceCode {
  if (!record) return "A";
  if (record.status === "present") return "P";
  if (record.status === "late") return "L";
  return "A";
}

export default function ManualAttendance() {
  const { appUser, loading } = useAuth();
  const { toast } = useToast();
  const [initializing, setInitializing] = useState(true);
  const [teacherDocId, setTeacherDocId] = useState<string | null>(null);
  const [assignedSections, setAssignedSections] = useState<Section[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(getLocalIsoDate());
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceByStudent, setAttendanceByStudent] = useState<Record<string, AttendanceDoc>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [savingBatch, setSavingBatch] = useState(false);
  const [academicYear, setAcademicYear] = useState("");

  const today = useMemo(() => getLocalIsoDate(), []);

  useEffect(() => {
    void getCurrentAcademicYear().then(setAcademicYear);
  }, []);

  const assignedSection = useMemo(
    () => assignedSections.find((s) => s.id === selectedSectionId) || assignedSections[0] || null,
    [assignedSections, selectedSectionId]
  );

  const loadTeacherSections = async () => {
    if (!appUser) return;
    setInitializing(true);
    try {
      let teacherSnap = await getDocs(
        query(collection(db, "teachers"), where("uid", "==", appUser.id))
      );
      if (teacherSnap.empty && appUser.email) {
        teacherSnap = await getDocs(
          query(collection(db, "teachers"), where("email", "==", appUser.email))
        );
        if (!teacherSnap.empty) {
          const { doc: firestoreDoc, updateDoc } = await import("firebase/firestore");
          updateDoc(firestoreDoc(db, "teachers", teacherSnap.docs[0].id), { uid: appUser.id }).catch(() => {});
        }
      }

      let secs: Section[] = [];
      let tDocId = teacherSnap.docs[0]?.id || appUser.id;
      setTeacherDocId(tDocId);

      // If admin, load all sections
      if (appUser.role === "admin") {
        const secSnap = await getDocs(collection(db, "sections"));
        secs = secSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
      } else {
        // Teacher / Class teacher: load sections where classTeacherId matches
        const sectionSnap = await getDocs(
          query(collection(db, "sections"), where("classTeacherId", "==", tDocId))
        );
        secs = sectionSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Section));

        // Fallback: check if teacher is assigned to subjects in any section
        if (secs.length === 0) {
          const subAssignSnap = await getDocs(
            query(collection(db, "subjectAssignments"), where("teacherId", "==", tDocId))
          );
          const secIds = Array.from(new Set(subAssignSnap.docs.map((d) => d.data().sectionId).filter(Boolean)));
          if (secIds.length > 0) {
            const secDocs = await Promise.all(secIds.map((sid) => getDoc(doc(db, "sections", sid))));
            secs = secDocs.filter((d) => d.exists()).map((d) => ({ id: d.id, ...d.data() } as Section));
          }
        }
      }

      secs.sort((a, b) => {
        if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true });
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      setAssignedSections(secs);
      if (secs.length > 0 && !selectedSectionId) {
        setSelectedSectionId(secs[0].id);
      }
    } catch (error: any) {
      toast({
        title: "Unable to load section",
        description: error?.message || "Please try again in a moment.",
        variant: "destructive",
      });
      setAssignedSections([]);
    } finally {
      setInitializing(false);
    }
  };

  useEffect(() => {
    if (!appUser) return;
    loadTeacherSections();
  }, [appUser]);

  // Load students and attendance for selected section and date
  useEffect(() => {
    if (!assignedSection?.id) {
      setStudents([]);
      setAttendanceByStudent({});
      return () => {};
    }

    const attendanceQuery = query(
      collection(db, "attendance"),
      where("sectionId", "==", assignedSection.id),
      where("date", "==", selectedDate)
    );

    const enrollmentQuery = academicYear
      ? query(
          collection(db, "enrollments"),
          where("sectionId", "==", assignedSection.id),
          where("status", "==", "active"),
          where("academicYear", "==", academicYear)
        )
      : null;

    const unsubscribeStudents = enrollmentQuery
      ? onSnapshot(
          enrollmentQuery,
          async () => {
            const nextStudents = await loadStudentsForSection(assignedSection.id, academicYear);
            setStudents(sortStudentsByRoll(nextStudents) as Student[]);
          },
          () => {}
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
      () => {}
    );

    return () => {
      unsubscribeStudents();
      unsubscribeAttendance();
    };
  }, [assignedSection?.id, academicYear, selectedDate]);

  // Set single student attendance status
  const setStudentAttendance = async (student: Student, nextCode: AttendanceCode) => {
    if (!assignedSection || !teacherDocId) return;

    const existing = attendanceByStudent[student.id];
    const docId = `${student.id}_${selectedDate}`;
    const docRef = doc(db, "attendance", docId);
    const pendingKey = `${student.id}_${selectedDate}`;

    setPending((current) => ({ ...current, [pendingKey]: true }));
    try {
      const status: "present" | "absent" | "late" =
        nextCode === "P" ? "present" : nextCode === "L" ? "late" : "absent";
      const now = new Date().toISOString();

      await setDoc(
        docRef,
        {
          studentId: student.id,
          studentUid: student.studentUid || student.id,
          studentName: student.name,
          sectionId: assignedSection.id,
          grade: assignedSection.grade,
          date: selectedDate,
          status,
          source: "manual",
          time: getLocalTime(),
          updatedAt: now,
          updatedBy: teacherDocId || appUser?.id || "teacher",
        },
        { merge: true }
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

  // Bulk mark all students to a specific status
  const handleBulkMark = async (code: AttendanceCode) => {
    if (!assignedSection || students.length === 0) return;
    setSavingBatch(true);
    try {
      const batch = writeBatch(db);
      const status: "present" | "absent" | "late" =
        code === "P" ? "present" : code === "L" ? "late" : "absent";
      const now = new Date().toISOString();
      const localTime = getLocalTime();

      students.forEach((student) => {
        const docId = `${student.id}_${selectedDate}`;
        const docRef = doc(db, "attendance", docId);
        batch.set(
          docRef,
          {
            studentId: student.id,
            studentUid: student.studentUid || student.id,
            studentName: student.name,
            sectionId: assignedSection.id,
            grade: assignedSection.grade,
            date: selectedDate,
            status,
            source: "manual",
            time: localTime,
            updatedAt: now,
            updatedBy: teacherDocId || appUser?.id || "teacher",
          },
          { merge: true }
        );
      });

      await batch.commit();
      toast({
        title: "Attendance Updated",
        description: `Marked all ${students.length} students as ${
          code === "P" ? "Present" : code === "A" ? "Absent" : "Late"
        } for ${selectedDate}.`,
      });
    } catch (err: any) {
      toast({
        title: "Bulk Save Failed",
        description: err.message || "Failed to update all records.",
        variant: "destructive",
      });
    } finally {
      setSavingBatch(false);
    }
  };

  const presentCount = students.filter(
    (s) => attendanceByStudent[s.id]?.status === "present"
  ).length;
  const lateCount = students.filter(
    (s) => attendanceByStudent[s.id]?.status === "late"
  ).length;
  const absentCount = students.filter(
    (s) => !attendanceByStudent[s.id] || attendanceByStudent[s.id]?.status === "absent"
  ).length;

  return (
    <div className="space-y-6" data-testid="manual-attendance-page">
      <section className="overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <ClipboardCheck size={14} />
              Manual Class Attendance
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Class Attendance Register
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Mark Present (P), Absent (A), or Late (L) for your assigned section. Changes persist authoritatively.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/teacher/attendance-register">
              <Button variant="outline" size="sm" className="gap-2">
                <FileSpreadsheet size={15} />
                Monthly Register
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={loadTeacherSections}
              disabled={loading || initializing}
            >
              {initializing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
              Refresh
            </Button>
          </div>
        </div>

        {/* Section & Date Selection Bar */}
        <div className="mt-6 pt-5 border-t border-border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
          {assignedSections.length > 1 ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Assigned Section</Label>
              <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
                <SelectContent>
                  {assignedSections.map((sec) => (
                    <SelectItem key={sec.id} value={sec.id}>
                      Grade {sec.grade} - {sec.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : assignedSection ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Assigned Section</Label>
              <div className="h-10 px-3.5 flex items-center rounded-md border border-input bg-muted/40 font-semibold text-sm">
                Grade {assignedSection.grade} - {assignedSection.name}
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Attendance Date</Label>
            <div className="relative">
              <Input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="font-medium"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pb-0.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleBulkMark("P")}
              disabled={savingBatch || students.length === 0}
              className="text-xs flex-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200"
            >
              <CheckCheck size={14} className="mr-1" />
              All Present
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleBulkMark("A")}
              disabled={savingBatch || students.length === 0}
              className="text-xs flex-1 bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200"
            >
              <UserX size={14} className="mr-1" />
              All Absent
            </Button>
          </div>
        </div>
      </section>

      {loading || initializing ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-muted-foreground" size={32} />
        </div>
      ) : !appUser || assignedSections.length === 0 ? (
        <Card className="border-border bg-card">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Lock size={36} className="mx-auto mb-3 opacity-35" />
            <p className="font-semibold text-foreground text-lg">Class Teachers Only</p>
            <p className="mt-1 text-sm max-w-md mx-auto">
              You are not currently assigned as a Class Teacher to any active class section. Please contact the administrator.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border bg-card shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between bg-muted/20">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Grade {assignedSection?.grade} - {assignedSection?.name} Roster
                </p>
                <p className="text-xs text-muted-foreground">
                  {students.length} students enrolled • Date: {selectedDate}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatPill label="Present" value={String(presentCount)} tone="present" />
                <StatPill label="Late" value={String(lateCount)} tone="late" />
                <StatPill label="Absent" value={String(absentCount)} tone="absent" />
              </div>
            </div>

            {students.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">
                No active students found in this section for the current academic session.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-muted-foreground text-xs uppercase font-semibold">
                      <th className="w-16 px-4 py-3 text-left">Roll No</th>
                      <th className="px-4 py-3 text-left">Student Name</th>
                      <th className="w-44 px-4 py-3 text-left">Permanent UID</th>
                      <th className="w-48 px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {students.map((student, index) => {
                      const record = attendanceByStudent[student.id];
                      const code = codeFromRecord(record);
                      const pendingKey = `${student.id}_${selectedDate}`;
                      const isPending = Boolean(pending[pendingKey]) || savingBatch;

                      return (
                        <tr key={student.id} className="hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-3 font-semibold text-muted-foreground">
                            {studentRollLabel(student, index)}
                          </td>
                          <td className="px-4 py-3 font-medium text-foreground">
                            {student.name}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                            {student.studentUid || student.id}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center">
                              <AttendanceToggle
                                value={code}
                                pending={isPending}
                                onChange={(next) => setStudentAttendance(student, next)}
                              />
                            </div>
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
    "w-9 h-9 rounded-lg border text-xs font-bold transition-all disabled:opacity-60 disabled:cursor-wait";

  const getButtonStyles = (code: AttendanceCode) => {
    if (value === code) {
      if (code === "P") return `${base} border-emerald-500 bg-emerald-600 text-white shadow-sm`;
      if (code === "L") return `${base} border-amber-500 bg-amber-500 text-white shadow-sm`;
      return `${base} border-slate-500 bg-slate-600 text-white shadow-sm`;
    }
    if (code === "P") return `${base} border-emerald-200 bg-white hover:bg-emerald-50 text-emerald-700`;
    if (code === "L") return `${base} border-amber-200 bg-white hover:bg-amber-50 text-amber-700`;
    return `${base} border-slate-200 bg-white hover:bg-slate-50 text-slate-600`;
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        title="Present"
        disabled={pending}
        onClick={() => onChange("P")}
        className={getButtonStyles("P")}
      >
        P
      </button>
      <button
        type="button"
        title="Absent"
        disabled={pending}
        onClick={() => onChange("A")}
        className={getButtonStyles("A")}
      >
        A
      </button>
      <button
        type="button"
        title="Late"
        disabled={pending}
        onClick={() => onChange("L")}
        className={getButtonStyles("L")}
      >
        L
      </button>
      {pending && <Loader2 size={14} className="animate-spin text-muted-foreground ml-1" />}
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "present" | "late" | "absent";
}) {
  const styles =
    tone === "present"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "late"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${styles}`}>
      <span className="text-xs font-bold">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</span>
    </span>
  );
}

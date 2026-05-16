import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  type DocumentData,
  type QueryDocumentSnapshot,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { generateAttendanceRegisterPdf, type AttendanceRegisterCode } from "@/lib/generateAttendanceRegisterPdf";
import { Section, Student } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen,
  CalendarDays,
  Download,
  Loader2,
  Lock,
  RefreshCcw,
} from "lucide-react";

interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName?: string;
  sectionId?: string;
  date: string;
  status?: string;
  inTime?: string;
  outTime?: string;
  time?: string;
  updatedAt?: string;
  source?: string;
  extraDocIds?: string[];
}

type AttendanceDocSnap = QueryDocumentSnapshot<DocumentData>;

const DAY_COLUMNS = Array.from({ length: 31 }, (_, index) => index + 1);
const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function toIsoDate(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getDaysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function isMissingIndexError(error: any) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  const normalizedMessage = message.toLowerCase();
  return (
    code.includes("failed-precondition")
    || normalizedMessage.includes("requires an index")
    || normalizedMessage.includes("create it here")
  );
}

function getAttendanceKey(studentId: string, date: string) {
  return `${studentId}__${date}`;
}

function getCellCode(record: AttendanceRecord | undefined, validDay: boolean): AttendanceRegisterCode {
  if (!validDay) {
    return "-";
  }
  if (!record) {
    return "A";
  }
  return record.status === "late" ? "L" : "P";
}

function getNextCellCode(current: Exclude<AttendanceRegisterCode, "-">): Exclude<AttendanceRegisterCode, "-"> {
  if (current === "P") {
    return "A";
  }
  if (current === "A") {
    return "L";
  }
  return "P";
}

function getRecordRank(record: AttendanceRecord) {
  return [
    record.status === "late" ? "2" : "1",
    record.outTime ?? "",
    record.inTime ?? record.time ?? "",
    record.updatedAt ?? "",
    record.id,
  ].join("|");
}

function pickPreferredRecord(current: AttendanceRecord, incoming: AttendanceRecord) {
  return getRecordRank(incoming) > getRecordRank(current) ? incoming : current;
}

function sortStudents(students: Student[]) {
  return [...students].sort((left, right) => {
    const leftRoll = left.rollNo?.trim() ?? "";
    const rightRoll = right.rollNo?.trim() ?? "";
    const leftNumber = Number(leftRoll);
    const rightNumber = Number(rightRoll);

    if (leftRoll && rightRoll && Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    if (leftRoll && rightRoll && leftRoll !== rightRoll) {
      return leftRoll.localeCompare(rightRoll, undefined, { numeric: true, sensitivity: "base" });
    }

    if (leftRoll && !rightRoll) {
      return -1;
    }

    if (!leftRoll && rightRoll) {
      return 1;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function getStudentRollNo(student: Student, index: number) {
  return student.rollNo?.trim() || String(index + 1).padStart(2, "0");
}

function formatTimeLabel(value?: string) {
  if (!value) {
    return "Not recorded";
  }

  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    return value.slice(0, 5);
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }

  return value;
}

function buildCellTitle(record: AttendanceRecord | undefined, validDay: boolean) {
  if (!validDay) {
    return "This day is not part of the selected month.";
  }

  if (!record) {
    return "Absent. Click to change status.";
  }

  const label = record.status === "late" ? "Late" : "Present";
  return `${label}\nIn Time: ${formatTimeLabel(record.inTime || record.time)}\nOut Time: ${formatTimeLabel(record.outTime)}`;
}

function getCellStyles(code: AttendanceRegisterCode, pending: boolean) {
  const base =
    "flex h-10 w-10 items-center justify-center border border-[#d9cfbb] text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#31557b]/20";

  if (pending) {
    return `${base} cursor-wait bg-[#edf2f7] text-slate-500`;
  }

  if (code === "P") {
    return `${base} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`;
  }

  if (code === "L") {
    return `${base} bg-amber-100 text-amber-800 hover:bg-amber-200`;
  }

  if (code === "A") {
    return `${base} bg-rose-50 text-rose-700 hover:bg-rose-100`;
  }

  return `${base} cursor-default bg-slate-100 text-slate-400`;
}

export default function AttendanceRegister() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const today = new Date();
  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [teacherDocId, setTeacherDocId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceRecord>>({});
  const [pendingCells, setPendingCells] = useState<Record<string, boolean>>({});
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth());
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());

  const selectedSection = sections.find((section) => section.id === selectedSectionId) ?? null;
  const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
  const yearOptions = Array.from({ length: 6 }, (_, index) => today.getFullYear() - 2 + index);

  useEffect(() => {
    if (!appUser) {
      return;
    }

    const loadTeacherSections = async () => {
      setLoading(true);

      try {
        let teacherSnap = await getDocs(
          query(collection(db, "teachers"), where("uid", "==", appUser.id)),
        );

        if (teacherSnap.empty && appUser.email) {
          teacherSnap = await getDocs(
            query(collection(db, "teachers"), where("email", "==", appUser.email)),
          );

          if (!teacherSnap.empty) {
            const { doc: firestoreDoc, updateDoc } = await import("firebase/firestore");
            updateDoc(firestoreDoc(db, "teachers", teacherSnap.docs[0].id), { uid: appUser.id }).catch(() => {});
          }
        }

        if (teacherSnap.empty) {
          setTeacherDocId(null);
          setSections([]);
          setSelectedSectionId("");
          return;
        }

        const teacherId = teacherSnap.docs[0].id;
        setTeacherDocId(teacherId);

        const sectionSnap = await getDocs(
          query(collection(db, "sections"), where("classTeacherId", "==", teacherId)),
        );

        const nextSections = sectionSnap.docs
          .map((sectionDoc) => ({ id: sectionDoc.id, ...sectionDoc.data() } as Section))
          .sort((left, right) => {
            if (left.grade !== right.grade) {
              return left.grade.localeCompare(right.grade, undefined, { numeric: true, sensitivity: "base" });
            }
            return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
          });

        setSections(nextSections);
        setSelectedSectionId((current) => {
          if (current && nextSections.some((section) => section.id === current)) {
            return current;
          }
          return nextSections[0]?.id ?? "";
        });
      } catch (error: any) {
        toast({
          title: "Unable to load register",
          description: error?.message || "The attendance register could not be opened right now.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    loadTeacherSections();
  }, [appUser, toast]);

  useEffect(() => {
    if (!selectedSectionId) {
      setStudents([]);
      setAttendanceMap({});
      return;
    }

    const loadRegisterData = async () => {
      setLoadingData(true);

      try {
        const studentSnap = await getDocs(
          query(collection(db, "students"), where("sectionId", "==", selectedSectionId)),
        );

        const nextStudents = sortStudents(
          studentSnap.docs.map((studentDoc) => ({ id: studentDoc.id, ...studentDoc.data() } as Student)),
        );
        setStudents(nextStudents);

        if (nextStudents.length === 0) {
          setAttendanceMap({});
          return;
        }

        const firstDay = toIsoDate(selectedYear, selectedMonth, 1);
        const lastDay = toIsoDate(selectedYear, selectedMonth, daysInMonth);
        let usedFallbackQuery = false;
        let attendanceDocs: AttendanceDocSnap[] = [];
        try {
          const attendanceSnap = await getDocs(
            query(
              collection(db, "attendance"),
              where("sectionId", "==", selectedSectionId),
              where("date", ">=", firstDay),
              where("date", "<=", lastDay),
            ),
          );
          attendanceDocs = attendanceSnap.docs;
        } catch (error: any) {
          if (!isMissingIndexError(error)) {
            throw error;
          }

          // Fallback for projects missing the `attendance(sectionId, date)` composite index.
          // This reads more documents than needed, but keeps the register usable until
          // the index is deployed.
          usedFallbackQuery = true;
          const fallbackSnap = await getDocs(
            query(
              collection(db, "attendance"),
              where("sectionId", "==", selectedSectionId),
            ),
          );
          attendanceDocs = fallbackSnap.docs;
          toast({
            title: "Attendance index missing",
            description: "Using a slower fallback query. Deploy the Firestore index for attendance (sectionId + date) to speed this up.",
          });
        }

        const studentIds = new Set(nextStudents.map((student) => student.id));
        const nextMap: Record<string, AttendanceRecord> = {};

        attendanceDocs.forEach((attendanceDoc) => {
          const record = { id: attendanceDoc.id, ...attendanceDoc.data() } as AttendanceRecord;
          if (usedFallbackQuery) {
            const date = String(record.date ?? "");
            if (!date || date < firstDay || date > lastDay) {
              return;
            }
          }
          if (!record.studentId || !studentIds.has(record.studentId)) {
            return;
          }

          const key = getAttendanceKey(record.studentId, record.date);
          const existing = nextMap[key];

          if (!existing) {
            nextMap[key] = { ...record, extraDocIds: [] };
            return;
          }

          const preferred = pickPreferredRecord(existing, record);
          const duplicateIds = Array.from(
            new Set([existing.id, ...(existing.extraDocIds ?? []), record.id, ...(record.extraDocIds ?? [])]),
          );

          nextMap[key] = {
            ...preferred,
            extraDocIds: duplicateIds.filter((docId) => docId !== preferred.id),
          };
        });

        setAttendanceMap(nextMap);
      } catch (error: any) {
        setStudents([]);
        setAttendanceMap({});
        toast({
          title: "Unable to load attendance",
          description: error?.message || "Monthly attendance could not be loaded right now.",
          variant: "destructive",
        });
      } finally {
        setLoadingData(false);
      }
    };

    loadRegisterData();
  }, [daysInMonth, selectedMonth, selectedSectionId, selectedYear, toast]);

  const refreshRegister = async () => {
    if (!selectedSectionId) {
      return;
    }

    setLoadingData(true);

    try {
      const studentSnap = await getDocs(
        query(collection(db, "students"), where("sectionId", "==", selectedSectionId)),
      );

      const nextStudents = sortStudents(
        studentSnap.docs.map((studentDoc) => ({ id: studentDoc.id, ...studentDoc.data() } as Student)),
      );
      setStudents(nextStudents);

      const firstDay = toIsoDate(selectedYear, selectedMonth, 1);
      const lastDay = toIsoDate(selectedYear, selectedMonth, daysInMonth);
      let usedFallbackQuery = false;
      let attendanceDocs: AttendanceDocSnap[] = [];
      try {
        const attendanceSnap = await getDocs(
          query(
            collection(db, "attendance"),
            where("sectionId", "==", selectedSectionId),
            where("date", ">=", firstDay),
            where("date", "<=", lastDay),
          ),
        );
        attendanceDocs = attendanceSnap.docs;
      } catch (error: any) {
        if (!isMissingIndexError(error)) {
          throw error;
        }

        usedFallbackQuery = true;
        const fallbackSnap = await getDocs(
          query(
            collection(db, "attendance"),
            where("sectionId", "==", selectedSectionId),
          ),
        );
        attendanceDocs = fallbackSnap.docs;
        toast({
          title: "Attendance index missing",
          description: "Using a slower fallback query. Deploy the Firestore index for attendance (sectionId + date) to speed this up.",
        });
      }

      const studentIds = new Set(nextStudents.map((student) => student.id));
      const nextMap: Record<string, AttendanceRecord> = {};

      attendanceDocs.forEach((attendanceDoc) => {
        const record = { id: attendanceDoc.id, ...attendanceDoc.data() } as AttendanceRecord;
        if (usedFallbackQuery) {
          const date = String(record.date ?? "");
          if (!date || date < firstDay || date > lastDay) {
            return;
          }
        }
        if (!record.studentId || !studentIds.has(record.studentId)) {
          return;
        }

        const key = getAttendanceKey(record.studentId, record.date);
        const existing = nextMap[key];

        if (!existing) {
          nextMap[key] = { ...record, extraDocIds: [] };
          return;
        }

        const preferred = pickPreferredRecord(existing, record);
        const duplicateIds = Array.from(
          new Set([existing.id, ...(existing.extraDocIds ?? []), record.id, ...(record.extraDocIds ?? [])]),
        );

        nextMap[key] = {
          ...preferred,
          extraDocIds: duplicateIds.filter((docId) => docId !== preferred.id),
        };
      });

      setAttendanceMap(nextMap);
    } catch (error: any) {
      toast({
        title: "Unable to refresh register",
        description: error?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setLoadingData(false);
    }
  };

  const updateCell = async (student: Student, day: number) => {
    if (!teacherDocId || !selectedSection || day > daysInMonth) {
      return;
    }

    const date = toIsoDate(selectedYear, selectedMonth, day);
    const key = getAttendanceKey(student.id, date);
    const currentRecord = attendanceMap[key];
    const currentCode = getCellCode(currentRecord, true);
    if (currentCode === "-") {
      return;
    }
    const nextCode = getNextCellCode(currentCode);

    setPendingCells((current) => ({ ...current, [key]: true }));

    if (nextCode === "A") {
      setAttendanceMap((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } else {
      setAttendanceMap((current) => ({
        ...current,
        [key]: {
          id: `${student.id}_${date}`,
          studentId: student.id,
          studentName: student.name,
          sectionId: selectedSection.id,
          date,
          status: nextCode === "L" ? "late" : "present",
          inTime: currentRecord?.inTime ?? currentRecord?.time,
          outTime: currentRecord?.outTime,
          time: currentRecord?.time,
          source: currentRecord?.source ?? "manual",
          extraDocIds: [],
        },
      }));
    }

    try {
      const duplicateIds = Array.from(new Set([currentRecord?.id, ...(currentRecord?.extraDocIds ?? [])].filter(Boolean))) as string[];

      if (nextCode === "A") {
        if (duplicateIds.length === 0) {
          setPendingCells((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
          return;
        }

        await Promise.all(duplicateIds.map((docId) => deleteDoc(doc(db, "attendance", docId))));
      } else {
        const targetId = `${student.id}_${date}`;
        const batch = writeBatch(db);
        const payload: Record<string, unknown> = {
          studentId: student.id,
          studentName: student.name,
          sectionId: selectedSection.id,
          date,
          status: nextCode === "L" ? "late" : "present",
          source: currentRecord?.source ?? "manual",
          updatedAt: new Date().toISOString(),
          updatedBy: teacherDocId,
        };

        if (currentRecord?.inTime || currentRecord?.time) {
          payload.inTime = currentRecord.inTime || currentRecord.time;
          payload.time = currentRecord.time || currentRecord.inTime;
        }

        if (currentRecord?.outTime) {
          payload.outTime = currentRecord.outTime;
        }

        batch.set(doc(db, "attendance", targetId), payload);
        duplicateIds
          .filter((docId) => docId !== targetId)
          .forEach((docId) => batch.delete(doc(db, "attendance", docId)));
        await batch.commit();

        setAttendanceMap((current) => ({
          ...current,
          [key]: {
            id: targetId,
            studentId: student.id,
            studentName: student.name,
            sectionId: selectedSection.id,
            date,
            status: nextCode === "L" ? "late" : "present",
            inTime: currentRecord?.inTime ?? currentRecord?.time,
            outTime: currentRecord?.outTime,
            time: currentRecord?.time ?? currentRecord?.inTime,
            source: currentRecord?.source ?? "manual",
            updatedAt: payload.updatedAt as string,
            extraDocIds: [],
          },
        }));
      }
    } catch (error: any) {
      setAttendanceMap((current) => {
        const next = { ...current };

        if (currentRecord) {
          next[key] = currentRecord;
        } else {
          delete next[key];
        }

        return next;
      });

      toast({
        title: "Attendance update failed",
        description: error?.message || "The register entry could not be saved.",
        variant: "destructive",
      });
    } finally {
      setPendingCells((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const downloadRegisterPdf = async () => {
    if (!selectedSection || students.length === 0) {
      return;
    }

    setExporting(true);

    try {
      await generateAttendanceRegisterPdf({
        className: `Grade ${selectedSection.grade}`,
        sectionName: selectedSection.name,
        monthLabel: MONTH_OPTIONS[selectedMonth],
        year: selectedYear,
        rows: students.map((student, index) => ({
          rollNo: getStudentRollNo(student, index),
          studentName: student.name,
          statuses: DAY_COLUMNS.map((day) => {
            const validDay = day <= daysInMonth;
            const date = toIsoDate(selectedYear, selectedMonth, day);
            return getCellCode(attendanceMap[getAttendanceKey(student.id, date)], validDay);
          }),
        })),
      });
    } catch (error: any) {
      toast({
        title: "PDF export failed",
        description: error?.message || "The register PDF could not be generated.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={32} />
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Attendance Register</h1>
          <p className="text-sm text-muted-foreground">
            Monthly register view for class teachers.
          </p>
        </div>

        <Card className="border-slate-200/80 bg-white/80 shadow-[0_18px_42px_-30px_rgba(15,23,42,0.4)]">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Lock size={36} className="mx-auto mb-3 opacity-35" />
            <p className="font-medium text-foreground">Class teachers only</p>
            <p className="mt-1 text-sm">
              You need an assigned class section to view and edit the attendance register.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="attendance-register-page">
      <section className="overflow-hidden rounded-[28px] border border-[#e4ddcf] bg-[linear-gradient(145deg,rgba(255,252,245,0.98),rgba(248,243,232,0.94))] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.6)]">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.25fr,0.95fr] lg:px-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d8ccb8] bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#5d6782]">
              <BookOpen size={14} />
              Digital Register
            </div>

            <div>
              <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">
                Attendance Register
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                A clean monthly register view that mirrors the paper format teachers already know.
                Click any valid day cell to cycle between present, absent, and late.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <RegisterMeta label="Class" value={`Grade ${selectedSection?.grade ?? "-"}`} />
              <RegisterMeta label="Section" value={selectedSection?.name ?? "-"} />
              <RegisterMeta label="Month" value={MONTH_OPTIONS[selectedMonth]} />
              <RegisterMeta label="Year" value={String(selectedYear)} />
            </div>
          </div>

          <Card className="border-[#ddd2bf] bg-white/78 shadow-none backdrop-blur-sm">
            <CardContent className="space-y-4 pt-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label className="text-xs uppercase tracking-[0.16em] text-slate-500">Section</Label>
                  <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Select section" />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          Grade {section.grade} - {section.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-[0.16em] text-slate-500">Month</Label>
                  <Select value={String(selectedMonth)} onValueChange={(value) => setSelectedMonth(Number(value))}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Select month" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_OPTIONS.map((month, index) => (
                        <SelectItem key={month} value={String(index)}>
                          {month}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs uppercase tracking-[0.16em] text-slate-500">Year</Label>
                  <Select value={String(selectedYear)} onValueChange={(value) => setSelectedYear(Number(value))}>
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                      {yearOptions.map((year) => (
                        <SelectItem key={year} value={String(year)}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={downloadRegisterPdf}
                  disabled={exporting || students.length === 0}
                  className="gap-2"
                >
                  {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  Download Register PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={refreshRegister}
                  disabled={loadingData}
                  className="gap-2 border-[#d8ccb8] bg-white/80"
                >
                  {loadingData ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
                  Refresh
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <LegendPill code="P" label="Present" />
                <LegendPill code="A" label="Absent" />
                <LegendPill code="L" label="Late" />
                <LegendPill code="-" label="Not in month" />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card className="overflow-hidden border-[#ddd2bf] bg-[linear-gradient(180deg,rgba(255,252,246,0.98),rgba(251,247,238,0.95))] shadow-[0_22px_48px_-34px_rgba(15,23,42,0.45)]">
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-[#ddd2bf] px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Grade {selectedSection?.grade} - {selectedSection?.name}
              </p>
              <p className="text-xs text-slate-500">
                {students.length} students • {MONTH_OPTIONS[selectedMonth]} {selectedYear}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f2ebdc] px-3 py-1 text-xs font-medium text-slate-600">
              <CalendarDays size={14} />
              Hover a marked cell to view in and out time
            </div>
          </div>

          {loadingData ? (
            <div className="flex h-72 items-center justify-center">
              <Loader2 className="animate-spin text-muted-foreground" size={30} />
            </div>
          ) : students.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              No students are assigned to this section yet.
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full border-collapse font-serif text-[13px]">
                <thead>
                  <tr className="bg-[#f3ebdc] text-slate-700">
                    <th className="sticky left-0 z-30 w-[88px] min-w-[88px] border border-[#d9cfbb] bg-[#f3ebdc] px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em]">
                      Roll No
                    </th>
                    <th className="sticky left-[88px] z-30 w-[240px] min-w-[240px] border border-[#d9cfbb] bg-[#f3ebdc] px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em]">
                      Student Name
                    </th>
                    {DAY_COLUMNS.map((day) => (
                      <th
                        key={day}
                        className="w-10 min-w-10 border border-[#d9cfbb] px-0 py-3 text-center text-xs font-semibold"
                      >
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, studentIndex) => {
                    const rowBase = studentIndex % 2 === 0 ? "bg-[#fffdf8]" : "bg-[#fbf7ef]";
                    return (
                      <tr key={student.id} className={rowBase}>
                        <td className={`sticky left-0 z-20 border border-[#d9cfbb] px-3 py-3 text-sm font-semibold text-slate-700 ${rowBase}`}>
                          {getStudentRollNo(student, studentIndex)}
                        </td>
                        <td className={`sticky left-[88px] z-20 border border-[#d9cfbb] px-4 py-3 text-sm font-medium text-slate-900 ${rowBase}`}>
                          {student.name}
                        </td>
                        {DAY_COLUMNS.map((day) => {
                          const validDay = day <= daysInMonth;
                          const date = toIsoDate(selectedYear, selectedMonth, day);
                          const key = getAttendanceKey(student.id, date);
                          const record = attendanceMap[key];
                          const code = getCellCode(record, validDay);
                          const pending = Boolean(pendingCells[key]);

                          return (
                            <td key={`${student.id}-${day}`} className="border border-[#d9cfbb] p-0">
                              <button
                                type="button"
                                title={buildCellTitle(record, validDay)}
                                disabled={!validDay || pending}
                                onClick={() => updateCell(student, day)}
                                className={getCellStyles(code, pending)}
                              >
                                {pending ? <Loader2 size={14} className="animate-spin" /> : code}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RegisterMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#ddd2bf] bg-white/78 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function LegendPill({ code, label }: { code: AttendanceRegisterCode; label: string }) {
  const styles: Record<AttendanceRegisterCode, string> = {
    P: "bg-emerald-50 text-emerald-700 border-emerald-200",
    A: "bg-rose-50 text-rose-700 border-rose-200",
    L: "bg-amber-100 text-amber-800 border-amber-200",
    "-": "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 ${styles[code]}`}>
      <span className="font-semibold">{code}</span>
      <span>{label}</span>
    </span>
  );
}

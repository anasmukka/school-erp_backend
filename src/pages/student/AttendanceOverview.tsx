import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Student } from "@/lib/types";
import { CalendarDays, Loader2, RefreshCcw } from "lucide-react";

type AttendanceCode = "P" | "L" | "A" | "-";

interface AttendanceDoc {
  id: string;
  studentId: string;
  sectionId?: string;
  date: string; // YYYY-MM-DD
  status?: string; // present|late
  inTime?: string;
  outTime?: string;
}

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

function getCalendarStartOffset(year: number, monthIndex: number) {
  // 0=Sun, 1=Mon, ...
  return new Date(year, monthIndex, 1).getDay();
}

function getCodeForRecord(record: AttendanceDoc | undefined, validDay: boolean): AttendanceCode {
  if (!validDay) return "-";
  if (!record) return "A";
  return record.status === "late" ? "L" : "P";
}

function isMissingIndexError(error: any) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return code.includes("failed-precondition") || message.includes("requires an index") || message.includes("create it here");
}

export default function StudentAttendanceOverview() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const today = new Date();
  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [student, setStudent] = useState<Student | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth());
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceDoc>>({});

  const yearOptions = Array.from({ length: 6 }, (_, index) => today.getFullYear() - 2 + index);
  const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
  const startOffset = getCalendarStartOffset(selectedYear, selectedMonth);

  const loadStudent = async () => {
    if (!appUser) return;
    setLoading(true);
    try {
      let studentSnap = await getDocs(query(collection(db, "students"), where("uid", "==", appUser.id)));
      if (studentSnap.empty && appUser.email) {
        studentSnap = await getDocs(query(collection(db, "students"), where("email", "==", appUser.email)));
      }
      if (studentSnap.empty) {
        setStudent(null);
        return;
      }
      setStudent({ id: studentSnap.docs[0].id, ...studentSnap.docs[0].data() } as Student);
    } catch (error: any) {
      toast({ title: "Unable to load student", description: error?.message || "Try again.", variant: "destructive" });
      setStudent(null);
    } finally {
      setLoading(false);
    }
  };

  const loadAttendance = async (studentId: string) => {
    setLoadingData(true);
    try {
      const firstDay = toIsoDate(selectedYear, selectedMonth, 1);
      const lastDay = toIsoDate(selectedYear, selectedMonth, daysInMonth);

      let docs: AttendanceDoc[] = [];
      try {
        const snap = await getDocs(
          query(
            collection(db, "attendance"),
            where("studentId", "==", studentId),
            where("date", ">=", firstDay),
            where("date", "<=", lastDay),
          ),
        );
        docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceDoc));
      } catch (error: any) {
        if (!isMissingIndexError(error)) {
          throw error;
        }

        const fallbackSnap = await getDocs(query(collection(db, "attendance"), where("studentId", "==", studentId)));
        docs = fallbackSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as AttendanceDoc))
          .filter((r) => r.date && r.date >= firstDay && r.date <= lastDay);

        toast({
          title: "Attendance index missing",
          description: "Using a slower fallback query. Deploy the Firestore index for attendance (studentId + date) to speed this up.",
        });
      }

      const nextMap: Record<string, AttendanceDoc> = {};
      docs.forEach((r) => {
        if (!r.date) return;
        const existing = nextMap[r.date];
        if (!existing) {
          nextMap[r.date] = r;
          return;
        }
        // Prefer a record that has outTime/inTime
        const rank = (x: AttendanceDoc) => [x.outTime ?? "", x.inTime ?? "", x.id].join("|");
        nextMap[r.date] = rank(r) > rank(existing) ? r : existing;
      });
      setAttendanceMap(nextMap);
    } catch (error: any) {
      setAttendanceMap({});
      toast({ title: "Unable to load attendance", description: error?.message || "Try again.", variant: "destructive" });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadStudent();
  }, [appUser]);

  useEffect(() => {
    if (!student?.id) {
      setAttendanceMap({});
      return;
    }
    loadAttendance(student.id);
  }, [student?.id, selectedMonth, selectedYear, daysInMonth]);

  const summary = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = toIsoDate(selectedYear, selectedMonth, day);
      const record = attendanceMap[date];
      const code = getCodeForRecord(record, true);
      if (code === "P") present += 1;
      else if (code === "L") late += 1;
      else absent += 1;
    }
    return { present, late, absent };
  }, [attendanceMap, daysInMonth, selectedMonth, selectedYear]);

  return (
    <div className="space-y-6" data-testid="student-attendance-overview-page">
      <section className="overflow-hidden rounded-[26px] border border-[#e4ddcf] bg-[linear-gradient(145deg,rgba(255,252,245,0.98),rgba(248,243,232,0.94))] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.6)]">
        <div className="px-6 py-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8ccb8] bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#5d6782]">
                <CalendarDays size={14} />
                Attendance Overview
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">Your monthly attendance</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Present (P), Late (L), or Absent (A).
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="gap-2 border-[#d8ccb8] bg-white/80" onClick={loadStudent}>
                <RefreshCcw size={15} />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex h-72 items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" size={30} />
        </div>
      ) : !student ? (
        <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Student profile not found.
          </CardContent>
        </Card>
      ) : !student.sectionId ? (
        <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Your section is not assigned yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SummaryPill label="Present" value={String(summary.present)} tone="present" />
            <SummaryPill label="Late" value={String(summary.late)} tone="late" />
            <SummaryPill label="Absent" value={String(summary.absent)} tone="absent" />
          </div>

          <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
            <CardContent className="pt-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-lg font-semibold">Calendar</p>
                  <p className="text-sm text-muted-foreground">
                    {student.name} · Grade {student.grade}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  <div className="w-44">
                    <Label className="text-xs">Month</Label>
                    <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTH_OPTIONS.map((m, idx) => (
                          <SelectItem key={m} value={String(idx)}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-36">
                    <Label className="text-xs">Year</Label>
                    <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {yearOptions.map((y) => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {loadingData ? (
                <div className="flex h-56 items-center justify-center">
                  <Loader2 className="animate-spin text-muted-foreground" size={26} />
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-2">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div key={d} className="text-[11px] font-semibold text-slate-500 text-center">{d}</div>
                  ))}

                  {Array.from({ length: startOffset }, (_, i) => (
                    <div key={`pad-${i}`} />
                  ))}

                  {Array.from({ length: daysInMonth }, (_, index) => {
                    const day = index + 1;
                    const date = toIsoDate(selectedYear, selectedMonth, day);
                    const record = attendanceMap[date];
                    const code = getCodeForRecord(record, true);
                    const styles =
                      code === "P"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : code === "L"
                          ? "border-amber-200 bg-amber-100 text-amber-800"
                          : "border-slate-200 bg-slate-100 text-slate-600";
                    const title = record
                      ? `${date}\n${code === "L" ? "Late" : "Present"}\nIn: ${record.inTime ?? "-"}\nOut: ${record.outTime ?? "-"}`
                      : `${date}\nAbsent`;

                    return (
                      <div
                        key={date}
                        title={title}
                        className={`rounded-xl border px-2 py-2 text-center ${styles}`}
                      >
                        <p className="text-[11px] font-semibold">{day}</p>
                        <p className="mt-1 text-sm font-bold">{code}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: string; tone: "present" | "late" | "absent" }) {
  const styles =
    tone === "present"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "late"
        ? "border-amber-200 bg-amber-100 text-amber-800"
        : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <div className={`rounded-2xl border px-4 py-3 ${styles}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-75">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}


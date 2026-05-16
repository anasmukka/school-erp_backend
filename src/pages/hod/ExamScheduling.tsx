import { useEffect, useState, useCallback } from "react";
import {
  collection, query, where, getDocs, addDoc, deleteDoc, doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Subject } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronRight, Calendar, CheckCircle, FileText, Bell, ArrowLeft,
  ClipboardList, Plus, Loader2, ChevronDown, ChevronUp, CalendarClock,
  RefreshCw, Pencil, CalendarX,
} from "lucide-react";

const EXAM_TYPES = [
  { key: "Unit Test 1",  color: "bg-blue-50 border-blue-200 text-blue-700",       dot: "bg-blue-500"   },
  { key: "Term 1",      color: "bg-violet-50 border-violet-200 text-violet-700",  dot: "bg-violet-500" },
  { key: "Unit Test 2", color: "bg-orange-50 border-orange-200 text-orange-700",  dot: "bg-orange-500" },
  { key: "Final Exam",  color: "bg-red-50 border-red-200 text-red-700",           dot: "bg-red-500"    },
];

const EXAM_TYPE_COLOR: Record<string, string> = {
  "Unit Test 1": "bg-blue-100 text-blue-700 border-blue-200",
  "Term 1": "bg-violet-100 text-violet-700 border-violet-200",
  "Unit Test 2": "bg-orange-100 text-orange-700 border-orange-200",
  "Final Exam": "bg-red-100 text-red-700 border-red-200",
};

type Tab = "upcoming" | "list" | "new";

type WizardStep =
  | { kind: "exam-type" }
  | { kind: "grades"; examType: string }
  | { kind: "schedule"; examType: string; grade: string; existingIds: string[] }
  | { kind: "done"; examType: string; grade: string; exams: SavedExam[] };

interface SavedExam {
  subjectId: string;
  subjectName: string;
  date: string;
}

interface ScheduleGroup {
  examType: string;
  grade: string;
  exams: SavedExam[];
  docIds: string[];
}

export default function ExamScheduling() {
  const { appUser } = useAuth();

  const [tab, setTab] = useState<Tab>("upcoming");
  const [wizardStep, setWizardStep] = useState<WizardStep>({ kind: "exam-type" });

  const [hodGrades, setHodGrades] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const [existingSchedules, setExistingSchedules] = useState<ScheduleGroup[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const [postponeTarget, setPostponeTarget] = useState<ScheduleGroup | null>(null);
  const [postponeDates, setPostponeDates] = useState<Record<string, string>>({});
  const [postponeSaving, setPostponeSaving] = useState(false);

  const loadExistingSchedules = useCallback(async () => {
    if (!appUser?.id) return;
    setLoadingSchedules(true);
    try {
      const snap = await getDocs(
        query(collection(db, "exams"), where("hodId", "==", appUser.id))
      );
      const grouped: Record<string, ScheduleGroup> = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        const key = `${data.examType}__${data.grade}`;
        if (!grouped[key]) {
          grouped[key] = { examType: data.examType, grade: data.grade, exams: [], docIds: [] };
        }
        grouped[key].exams.push({ subjectId: data.subjectId, subjectName: data.subjectName, date: data.date });
        grouped[key].docIds.push(d.id);
      });
      const order = EXAM_TYPES.map((e) => e.key);
      const sorted = Object.values(grouped).sort((a, b) => {
        const ei = order.indexOf(a.examType) - order.indexOf(b.examType);
        return ei !== 0 ? ei : Number(a.grade) - Number(b.grade);
      });
      setExistingSchedules(sorted);
      return sorted;
    } finally {
      setLoadingSchedules(false);
    }
  }, [appUser?.id]);

  useEffect(() => {
    if (!appUser) return;
    const grades = (appUser.assignedGrades as string[] | undefined) ?? [];
    setHodGrades(grades.sort((a, b) => Number(a) - Number(b)));
    loadExistingSchedules();
  }, [appUser, loadExistingSchedules]);

  const loadSubjects = async (grade: string) => {
    const snap = await getDocs(query(collection(db, "subjects"), where("grade", "==", grade)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Subject));
  };

  const goToSchedule = async (examType: string, grade: string) => {
    const subs = await loadSubjects(grade);
    setSubjects(subs);
    setErrors([]);

    let schedules = existingSchedules;
    if (loadingSchedules) {
      const fetched = await loadExistingSchedules();
      schedules = fetched ?? [];
    }

    const existing = schedules.find((g) => g.examType === examType && g.grade === grade);
    if (existing) {
      const prefilled: Record<string, string> = {};
      existing.exams.forEach((e) => { prefilled[e.subjectId] = e.date; });
      setDates(prefilled);
    } else {
      setDates({});
    }
    setWizardStep({ kind: "schedule", examType, grade, existingIds: existing?.docIds ?? [] });
  };

  const validate = (): boolean => {
    if (wizardStep.kind !== "schedule") return false;
    const missing = subjects.filter((s) => !dates[s.id]);
    if (missing.length > 0) {
      setErrors(missing.map((s) => s.name));
      return false;
    }
    setErrors([]);
    return true;
  };

  const saveExams = async () => {
    if (wizardStep.kind !== "schedule") return;
    if (!validate() || !appUser) return;
    setSaving(true);
    try {
      if (wizardStep.existingIds.length > 0) {
        await Promise.all(wizardStep.existingIds.map((id) => deleteDoc(doc(db, "exams", id))));
      }
      const savedExams: SavedExam[] = [];
      for (const sub of subjects) {
        await addDoc(collection(db, "exams"), {
          examType: wizardStep.examType,
          grade: wizardStep.grade,
          subjectId: sub.id,
          subjectName: sub.name,
          date: dates[sub.id],
          hodId: appUser.id,
        });
        savedExams.push({ subjectId: sub.id, subjectName: sub.name, date: dates[sub.id] });
      }
      await saveNotice(wizardStep.grade, wizardStep.examType, savedExams);
      await loadExistingSchedules();
      setWizardStep({ kind: "done", examType: wizardStep.examType, grade: wizardStep.grade, exams: savedExams });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveNotice = async (grade: string, examType: string, exams: SavedExam[]) => {
    if (!appUser) return;
    await addDoc(collection(db, "notices"), {
      type: "exam_schedule",
      grade,
      examType,
      hodId: appUser.id,
      examDates: exams.map((e) => ({ subjectName: e.subjectName, date: e.date })),
      message: `${examType} has been scheduled for Grade ${grade}.`,
      createdAt: new Date().toISOString(),
    });
  };

  const handlePostpone = (group: ScheduleGroup) => {
    const prefilled: Record<string, string> = {};
    group.exams.forEach((e) => { prefilled[e.subjectId] = e.date; });
    setPostponeDates(prefilled);
    setPostponeTarget(group);
  };

  const savePostpone = async () => {
    if (!postponeTarget || !appUser) return;
    setPostponeSaving(true);
    try {
      await Promise.all(postponeTarget.docIds.map((id) => deleteDoc(doc(db, "exams", id))));
      const savedExams: SavedExam[] = [];
      for (const exam of postponeTarget.exams) {
        await addDoc(collection(db, "exams"), {
          examType: postponeTarget.examType,
          grade: postponeTarget.grade,
          subjectId: exam.subjectId,
          subjectName: exam.subjectName,
          date: postponeDates[exam.subjectId] || exam.date,
          hodId: appUser.id,
        });
        savedExams.push({
          subjectId: exam.subjectId,
          subjectName: exam.subjectName,
          date: postponeDates[exam.subjectId] || exam.date,
        });
      }
      await saveNotice(postponeTarget.grade, postponeTarget.examType, savedExams);
      await loadExistingSchedules();
      setPostponeTarget(null);
      setPostponeDates({});
    } catch (err: any) {
      alert(err.message);
    } finally {
      setPostponeSaving(false);
    }
  };

  const generatePDF = (examType: string, grade: string, exams: SavedExam[]) => {
    import("jspdf").then(({ jsPDF }) => {
      const pdf = new jsPDF();
      const W = pdf.internal.pageSize.getWidth();
      pdf.setFillColor(79, 70, 229); pdf.rect(0, 0, W, 40, "F");
      pdf.setTextColor(255, 255, 255); pdf.setFontSize(20); pdf.setFont("helvetica", "bold");
      pdf.text("PRESTIGE INTERNATIONAL SCHOOL", W / 2, 16, { align: "center" });
      pdf.setFontSize(11); pdf.setFont("helvetica", "normal");
      pdf.text("Examination Timetable", W / 2, 25, { align: "center" });
      pdf.setFontSize(9); pdf.text(`${examType} - Grade ${grade}`, W / 2, 34, { align: "center" });
      pdf.setTextColor(100); pdf.setFontSize(9); pdf.setFont("helvetica", "normal");
      pdf.text(`Generated: ${new Date().toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" })}`, W / 2, 50, { align: "center" });
      pdf.setFillColor(245, 244, 255); pdf.rect(14, 56, W - 28, 10, "F");
      pdf.setDrawColor(200, 196, 255); pdf.setLineWidth(0.3); pdf.rect(14, 56, W - 28, 10, "D");
      pdf.setTextColor(60, 50, 160); pdf.setFontSize(9.5); pdf.setFont("helvetica", "bold");
      pdf.text("Subject", 20, 63); pdf.text("Exam Date", 120, 63); pdf.text("Day", 170, 63);
      const sorted = [...exams].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      let y = 75;
      sorted.forEach((exam, i) => {
        if (i % 2 === 0) { pdf.setFillColor(252, 252, 255); pdf.rect(14, y - 6, W - 28, 10, "F"); }
        pdf.setDrawColor(230); pdf.setLineWidth(0.2); pdf.line(14, y + 4, W - 14, y + 4);
        const d = new Date(exam.date);
        pdf.setFont("helvetica", "normal"); pdf.setTextColor(30); pdf.setFontSize(9);
        pdf.text(exam.subjectName, 20, y);
        pdf.text(d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), 120, y);
        pdf.text(d.toLocaleDateString("en-US", { weekday: "long" }), 170, y);
        y += 10; if (y > 270) { pdf.addPage(); y = 20; }
      });
      pdf.setFillColor(79, 70, 229); pdf.rect(0, 285, W, 12, "F");
      pdf.setTextColor(255, 255, 255); pdf.setFontSize(7);
      pdf.text("This is an official document generated by Prestige International School.", W / 2, 292, { align: "center" });
      pdf.save(`Exam_Timetable_${examType.replace(/\s+/g, "_")}_Grade_${grade}.pdf`);
    });
  };

  const today = new Date().toISOString().split("T")[0];
  const upcomingExams = existingSchedules
    .flatMap((g) =>
      g.exams
        .filter((e) => e.date >= today)
        .map((e) => ({ ...e, examType: g.examType, grade: g.grade }))
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const ScheduleCard = ({ group }: { group: ScheduleGroup }) => {
    const key = `${group.examType}__${group.grade}`;
    const expanded = expandedGroups.has(key);
    const isPostponing = postponeTarget?.examType === group.examType && postponeTarget?.grade === group.grade;
    const colorClass = EXAM_TYPE_COLOR[group.examType] ?? "bg-muted text-muted-foreground border-border";

    return (
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${colorClass}`}>
                {group.examType}
              </span>
              <span className="font-semibold">Grade {group.grade}</span>
              <span className="text-xs text-muted-foreground">{group.exams.length} subject(s)</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1 text-xs"
                onClick={() => { setTab("new"); goToSchedule(group.examType, group.grade); }}>
                <Pencil size={12} /> Edit
              </Button>
              <Button size="sm" variant="outline" className="gap-1 text-xs text-orange-600 border-orange-200 hover:bg-orange-50"
                onClick={() => isPostponing ? setPostponeTarget(null) : handlePostpone(group)}>
                <CalendarClock size={12} /> {isPostponing ? "Cancel" : "Postpone"}
              </Button>
              <button onClick={() => {
                setExpandedGroups((prev) => {
                  const next = new Set(prev);
                  next.has(key) ? next.delete(key) : next.add(key);
                  return next;
                });
              }} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                {expanded || isPostponing ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
          </div>

          {isPostponing && (
            <div className="mt-4 pt-4 border-t border-orange-200 space-y-3">
              <p className="text-sm font-semibold text-orange-700">Postpone — update dates for each subject:</p>
              {group.exams.map((exam) => (
                <div key={exam.subjectId} className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium w-32 shrink-0">{exam.subjectName}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-muted-foreground shrink-0">
                      was: {new Date(exam.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <Input
                      type="date"
                      className="flex-1 h-8 text-sm"
                      value={postponeDates[exam.subjectId] ?? exam.date}
                      onChange={(e) => setPostponeDates((d) => ({ ...d, [exam.subjectId]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="gap-1" onClick={savePostpone} disabled={postponeSaving}>
                  {postponeSaving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                  {postponeSaving ? "Saving..." : "Save New Dates"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPostponeTarget(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {expanded && !isPostponing && (
            <div className="mt-3 pt-3 border-t border-border space-y-1">
              {[...group.exams]
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map((exam) => (
                  <div key={exam.subjectId} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                    <span className="font-medium">{exam.subjectName}</span>
                    <span className="text-muted-foreground">
                      {new Date(exam.date).toLocaleDateString("en-US", {
                        weekday: "short", month: "short", day: "numeric", year: "numeric",
                      })}
                    </span>
                  </div>
                ))}
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" className="gap-1 text-xs"
                  onClick={() => generatePDF(group.examType, group.grade, group.exams)}>
                  <FileText size={12} /> PDF
                </Button>
                <Button size="sm" variant="outline" className="gap-1 text-xs"
                  onClick={async () => {
                    await saveNotice(group.grade, group.examType, group.exams);
                    alert(`Notice sent to Grade ${group.grade} students on their dashboard.`);
                  }}>
                  <Bell size={12} /> Send Notice
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold">Exam Scheduling</h1>
          <p className="text-muted-foreground text-sm">Manage and schedule exams for your grades</p>
        </div>
        <Button
          size="sm" variant="outline" className="gap-1.5"
          onClick={loadExistingSchedules} disabled={loadingSchedules}
        >
          <RefreshCw size={14} className={loadingSchedules ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      {tab !== "new" && (
        <div className="flex gap-1 mb-6 bg-muted rounded-lg p-1">
          <button
            onClick={() => setTab("upcoming")}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${tab === "upcoming" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Upcoming Exams {upcomingExams.length > 0 && !loadingSchedules && (
              <span className="ml-1.5 text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">{upcomingExams.length}</span>
            )}
          </button>
          <button
            onClick={() => setTab("list")}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${tab === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            All Schedules
          </button>
          <Button
            size="sm" className="gap-1 ml-1"
            onClick={() => { setTab("new"); setWizardStep({ kind: "exam-type" }); }}
          >
            <Plus size={14} /> New
          </Button>
        </div>
      )}

      {/* Upcoming Exams Tab */}
      {tab === "upcoming" && (
        <div className="space-y-3">
          {loadingSchedules ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="animate-spin text-muted-foreground" size={28} />
            </div>
          ) : upcomingExams.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <CalendarX size={40} className="mx-auto mb-4 opacity-30" />
                <p className="font-semibold text-lg">No upcoming exams</p>
                <p className="text-sm mt-1">All scheduled exams are in the past, or none have been scheduled yet.</p>
                <Button className="mt-4 gap-2" onClick={() => { setTab("new"); setWizardStep({ kind: "exam-type" }); }}>
                  <Plus size={15} /> Schedule an Exam
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {(() => {
                let lastDate = "";
                return upcomingExams.map((exam, idx) => {
                  const dateHeader = exam.date !== lastDate;
                  lastDate = exam.date;
                  const d = new Date(exam.date);
                  const isToday = exam.date === today;
                  return (
                    <div key={idx}>
                      {dateHeader && (
                        <div className="flex items-center gap-2 mt-4 mb-2 first:mt-0">
                          <div className={`text-xs font-bold px-2 py-1 rounded ${isToday ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                            {isToday ? "TODAY" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                          </div>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      <Card className={isToday ? "border-primary/30 bg-primary/5" : ""}>
                        <CardContent className="py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                <ClipboardList size={14} className="text-muted-foreground" />
                              </div>
                              <div>
                                <p className="font-semibold text-sm">{exam.subjectName}</p>
                                <p className="text-xs text-muted-foreground">Grade {exam.grade}</p>
                              </div>
                            </div>
                            <span className={`text-xs px-2 py-1 rounded-full border font-semibold ${EXAM_TYPE_COLOR[exam.examType] ?? "bg-muted text-muted-foreground"}`}>
                              {exam.examType}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  );
                });
              })()}
            </>
          )}
        </div>
      )}

      {/* All Schedules Tab */}
      {tab === "list" && (
        <div className="space-y-3">
          {loadingSchedules ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="animate-spin text-muted-foreground" size={28} />
            </div>
          ) : existingSchedules.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Calendar size={40} className="mx-auto mb-4 opacity-30" />
                <p className="font-semibold text-lg">No exams scheduled yet</p>
                <p className="text-sm mt-1">Click "New" to create your first exam timetable.</p>
                <Button className="mt-4 gap-2" onClick={() => { setTab("new"); setWizardStep({ kind: "exam-type" }); }}>
                  <Plus size={15} /> Schedule an Exam
                </Button>
              </CardContent>
            </Card>
          ) : (
            existingSchedules.map((group) => (
              <ScheduleCard key={`${group.examType}__${group.grade}`} group={group} />
            ))
          )}
        </div>
      )}

      {/* New Schedule Wizard */}
      {tab === "new" && (
        <div>
          <div className="flex items-center gap-2 mb-5">
            <button
              onClick={() => { setTab("upcoming"); setWizardStep({ kind: "exam-type" }); }}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft size={14} /> Back to Schedules
            </button>
          </div>

          {/* Wizard Step 1 — Exam Type */}
          {wizardStep.kind === "exam-type" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-muted-foreground mb-4">STEP 1 — SELECT EXAM TYPE</p>
              {EXAM_TYPES.map((et) => {
                const scheduledGrades = existingSchedules
                  .filter((g) => g.examType === et.key)
                  .map((g) => `G${g.grade}`)
                  .join(", ");
                return (
                  <button
                    key={et.key}
                    onClick={() => setWizardStep({ kind: "grades", examType: et.key })}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 text-left transition-all hover:shadow-sm ${et.color}`}
                  >
                    <span className={`w-3 h-3 rounded-full shrink-0 ${et.dot}`} />
                    <div className="flex-1">
                      <p className="font-semibold">{et.key}</p>
                      {scheduledGrades ? (
                        <p className="text-xs opacity-70 mt-0.5 flex items-center gap-1">
                          <CheckCircle size={10} /> Scheduled: {scheduledGrades}
                        </p>
                      ) : (
                        <p className="text-xs opacity-50 mt-0.5">Not yet scheduled</p>
                      )}
                    </div>
                    <ChevronRight size={16} className="opacity-50" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Wizard Step 2 — Grade Picker */}
          {wizardStep.kind === "grades" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-muted-foreground">
                  SELECT GRADE &nbsp;<span className="text-primary">({wizardStep.examType})</span>
                </p>
                <Button variant="ghost" size="sm" onClick={() => setWizardStep({ kind: "exam-type" })} className="gap-1 text-muted-foreground">
                  <ArrowLeft size={14} /> Back
                </Button>
              </div>
              {loadingSchedules ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="animate-spin text-muted-foreground" size={24} />
                </div>
              ) : hodGrades.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    No grades assigned. Contact admin to assign grades.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {hodGrades.map((grade) => {
                    const alreadyScheduled = existingSchedules.some(
                      (g) => g.examType === wizardStep.examType && g.grade === grade
                    );
                    return (
                      <Card
                        key={grade}
                        className="cursor-pointer hover:shadow-md hover:border-primary transition-all"
                        onClick={() => goToSchedule(wizardStep.examType, grade)}
                      >
                        <CardContent className="pt-6 pb-5 text-center">
                          <Calendar size={22} className="mx-auto text-primary mb-2" />
                          <p className="text-2xl font-bold text-primary">{grade}</p>
                          <p className="text-xs text-muted-foreground">Grade</p>
                          {alreadyScheduled && (
                            <span className="mt-2 inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                              <CheckCircle size={10} /> Scheduled
                            </span>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Wizard Step 3 — Set Dates */}
          {wizardStep.kind === "schedule" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-muted-foreground">
                  SET DATES &nbsp;
                  <span className="text-primary">{wizardStep.examType}</span>
                  <span className="text-muted-foreground"> / Grade {wizardStep.grade}</span>
                </p>
                <Button variant="ghost" size="sm"
                  onClick={() => setWizardStep({ kind: "grades", examType: wizardStep.examType })}
                  className="gap-1 text-muted-foreground">
                  <ArrowLeft size={14} /> Back
                </Button>
              </div>

              {wizardStep.existingIds.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
                  <CheckCircle size={14} className="shrink-0" />
                  Existing schedule loaded — edit dates below and save to update.
                </div>
              )}

              {subjects.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No subjects for Grade {wizardStep.grade}. Add subjects in the Admin panel first.
                  </CardContent>
                </Card>
              ) : (
                <>
                  {errors.length > 0 && (
                    <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                      Please set dates for: <strong>{errors.join(", ")}</strong>
                    </div>
                  )}
                  <div className="space-y-3">
                    {subjects.map((sub) => (
                      <Card key={sub.id} className={errors.includes(sub.name) ? "border-destructive" : ""}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <ClipboardList size={16} className="text-primary shrink-0" />
                              <span className="font-medium">{sub.name}</span>
                            </div>
                            <Input
                              type="date"
                              className="w-44"
                              value={dates[sub.id] ?? ""}
                              onChange={(e) => setDates((d) => ({ ...d, [sub.id]: e.target.value }))}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <Button className="w-full gap-2" onClick={saveExams} disabled={saving}>
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    {saving ? "Saving..." : wizardStep.existingIds.length > 0 ? "Update Exam Schedule" : "Save Exam Schedule"}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Wizard Step 4 — Done */}
          {wizardStep.kind === "done" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <CheckCircle size={20} className="text-green-600 shrink-0" />
                <div>
                  <p className="font-semibold text-green-800">Exam schedule saved!</p>
                  <p className="text-xs text-green-600">
                    {wizardStep.examType} — Grade {wizardStep.grade} — {wizardStep.exams.length} subjects · Notice posted to student dashboards
                  </p>
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span>{wizardStep.examType}</span>
                    <span className="text-muted-foreground font-normal">/ Grade {wizardStep.grade}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {[...wizardStep.exams]
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map((exam) => (
                      <div key={exam.subjectId} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                        <span className="font-medium text-sm">{exam.subjectName}</span>
                        <span className="text-sm text-muted-foreground">
                          {new Date(exam.date).toLocaleDateString("en-US", {
                            weekday: "short", month: "short", day: "numeric", year: "numeric",
                          })}
                        </span>
                      </div>
                    ))}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button variant="outline" className="gap-2"
                  onClick={() => generatePDF(wizardStep.examType, wizardStep.grade, wizardStep.exams)}>
                  <FileText size={16} /> Download PDF
                </Button>
                <Button variant="outline" className="gap-2"
                  onClick={async () => {
                    await saveNotice(wizardStep.grade, wizardStep.examType, wizardStep.exams);
                    alert(`Notice re-sent to Grade ${wizardStep.grade} students.`);
                  }}>
                  <Bell size={16} /> Send Notice Again
                </Button>
              </div>

              <Button variant="ghost" className="w-full"
                onClick={() => { setTab("list"); setWizardStep({ kind: "exam-type" }); }}>
                Back to All Schedules
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

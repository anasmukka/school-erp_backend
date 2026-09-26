import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
} from "firebase/firestore";
import type { Subject, ExamSchedule, ExamSubjectEntry, ExamScheduleStatus } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Eye,
  FileText,
  Loader2,
  Plus,
  Send,
  Trash2,
  AlertCircle,
  XCircle,
  HelpCircle,
} from "lucide-react";
import jsPDF from "jspdf";
import {
  getActiveStructureForGrade,
  AcademicStructure,
  AcademicStructureVersion,
  DefinedExam,
} from "@/lib/academicStructure";
import { AlertTriangle } from "lucide-react";

export default function HodExamScheduling() {
  const { appUser } = useAuth();
  const { workingSession, activeSession, sessions } = useAcademicSession();
  const { toast } = useToast();

  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedSessionName, setSelectedSessionName] = useState<string>("");
  const [selectedExamType, setSelectedExamType] = useState<string>("");
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [selectedTermId, setSelectedTermId] = useState<string>("term_1");
  const [selectedGrade, setSelectedGrade] = useState<string>("");
  const [termFilter, setTermFilter] = useState<string>("all");
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [examEntries, setExamEntries] = useState<Record<string, ExamSubjectEntry>>({});
  const [formError, setFormError] = useState<string>("");

  // Academic Structure State
  const [applicableStructure, setApplicableStructure] = useState<{
    structure: AcademicStructure;
    version: AcademicStructureVersion;
  } | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [definedExams, setDefinedExams] = useState<DefinedExam[]>([]);

  const availableTerms = useMemo(() => {
    if (applicableStructure?.version.terms && applicableStructure.version.terms.length > 0) {
      return applicableStructure.version.terms;
    }
    return [
      { id: "term_1", name: "Term 1", sequence: 1, workflowStatus: "active" as const },
      { id: "term_2", name: "Term 2", sequence: 2, workflowStatus: "active" as const },
    ];
  }, [applicableStructure]);

  const termFilteredExams = useMemo(() => {
    return definedExams.filter((e) => {
      if (e.termId) return e.termId === selectedTermId;
      if (selectedTermId === "term_1") return e.term === "term1";
      if (selectedTermId === "term_2") return e.term === "term2";
      return true;
    });
  }, [definedExams, selectedTermId]);

  useEffect(() => {
    if (termFilteredExams.length > 0) {
      const match = termFilteredExams.find((e) => e.id === selectedExamId);
      if (!match) {
        setSelectedExamId(termFilteredExams[0].id);
        setSelectedExamType(termFilteredExams[0].name);
      }
    }
  }, [termFilteredExams, selectedExamId]);

  // Details Modal
  const [viewSchedule, setViewSchedule] = useState<ExamSchedule | null>(null);

  const assignedGrades = useMemo(() => {
    return (appUser?.assignedGrades ?? []).map(String).filter(Boolean);
  }, [appUser]);

  // Current session name default
  const effectiveSessionName =
    selectedSessionName || workingSession?.name || activeSession?.name || "2026-27";

  // Real-time listener for schedules assigned to HOD
  useEffect(() => {
    if (!appUser) return;
    setLoading(true);

    const q = query(
      collection(db, "examSchedules"),
      where("hodId", "==", appUser.id),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() } as ExamSchedule),
        );
        list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setSchedules(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading exam schedules:", err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [appUser?.id]);

  // Load active academic structure & subjects whenever selected grade changes in form
  useEffect(() => {
    if (!selectedGrade) {
      setSubjects([]);
      setApplicableStructure(null);
      setDefinedExams([]);
      return;
    }
    let isMounted = true;
    setSubjectsLoading(true);
    setStructureLoading(true);

    const sessId = workingSession?.id || activeSession?.id;

    Promise.all([
      getDocs(query(collection(db, "subjects"), where("grade", "==", selectedGrade))),
      getActiveStructureForGrade(selectedGrade, sessId),
    ])
      .then(([subjSnap, structRes]) => {
        if (!isMounted) return;
        const list = subjSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Subject))
          .filter((s) => s.category !== "co-scholastic"); // only scholastic subjects get formal exams
        list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
        setSubjects(list);

        setApplicableStructure(structRes);
        if (structRes && structRes.version.exams.length > 0) {
          setDefinedExams(structRes.version.exams);
          if (!editingId) {
            setSelectedExamId(structRes.version.exams[0].id);
            setSelectedExamType(structRes.version.exams[0].name);
          }
        } else {
          setDefinedExams([]);
        }

        // Pre-fill exam entries if not editing
        if (!editingId) {
          const map: Record<string, ExamSubjectEntry> = {};
          list.forEach((sub) => {
            map[sub.id] = {
              subjectId: sub.id,
              subjectName: sub.name,
              date: "",
              startTime: "09:30",
              endTime: "12:30",
              maxMarks: 100,
              passingMarks: 35,
            };
          });
          setExamEntries(map);
        }
      })
      .catch((err) => {
        console.error("Error loading subjects or structure:", err);
        toast({ title: "Failed to load grade configuration", variant: "destructive" });
      })
      .finally(() => {
        if (isMounted) {
          setSubjectsLoading(false);
          setStructureLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedGrade, editingId, workingSession?.id, activeSession?.id]);

  const handleOpenCreate = () => {
    setEditingId(null);
    setSelectedSessionName(workingSession?.name || activeSession?.name || "2026-27");
    const initialGrade = assignedGrades[0] || "1";
    setSelectedGrade(initialGrade);
    setSelectedTermId("term_1");
    setFormError("");
    setDialogOpen(true);
  };

  const handleOpenEdit = (sched: ExamSchedule) => {
    setEditingId(sched.id);
    setSelectedSessionName(sched.academicYear || sched.sessionId);
    setSelectedTermId(
      sched.termId ||
      (sched.examType.toLowerCase().includes("term 2") || sched.examType.toLowerCase().includes("annual") ? "term_2" : "term_1")
    );
    setSelectedExamType(sched.examType);
    setSelectedExamId(sched.definedExamId || "");
    setSelectedGrade(sched.grade);
    const map: Record<string, ExamSubjectEntry> = {};
    sched.exams.forEach((ex) => {
      map[ex.subjectId] = ex;
    });
    setExamEntries(map);
    setFormError("");
    setDialogOpen(true);
  };

  const handleSaveSchedule = async (submitForApproval: boolean) => {
    setFormError("");
    if (!applicableStructure) {
      setFormError(`No active Academic Structure is configured for Grade ${selectedGrade}. Exam scheduling is prohibited until an Academic Structure is activated.`);
      return;
    }
    const matchedExam = definedExams.find(
      (e) => e.name === selectedExamType || e.id === selectedExamId
    );
    if (!matchedExam) {
      setFormError(`Selected exam is not defined in Academic Structure "${applicableStructure.structure.name}".`);
      return;
    }
    const examTypeName = matchedExam.name;
    if (!selectedGrade) {
      setFormError("Please select a Grade.");
      return;
    }
    if (subjects.length === 0) {
      setFormError("No subjects configured for this grade. Please add subjects first.");
      return;
    }

    // Validate that each subject has a date
    const examsList: ExamSubjectEntry[] = [];
    for (const sub of subjects) {
      const entry = examEntries[sub.id];
      if (!entry?.date) {
        setFormError(`Please set an exam date for "${sub.name}".`);
        return;
      }
      examsList.push({
        subjectId: sub.id,
        subjectName: sub.name,
        date: entry.date,
        startTime: entry.startTime || "09:30",
        endTime: entry.endTime || "12:30",
        maxMarks: Number(entry.maxMarks) || 100,
        passingMarks: Number(entry.passingMarks) || 35,
        venue: entry.venue?.trim() || "",
      });
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const status: ExamScheduleStatus = submitForApproval ? "pending_approval" : "draft";

      const matchedSession = sessions.find((s) => s.name === selectedSessionName || s.id === selectedSessionName);
      const sessId = matchedSession?.id || selectedSessionName;

      const termObj = availableTerms.find((t) => t.id === selectedTermId);
      const termName = termObj?.name || (selectedTermId === "term_2" ? "Term 2" : "Term 1");

      const scheduleData: Omit<ExamSchedule, "id"> = {
        sessionId: sessId,
        academicYear: selectedSessionName,
        examType: examTypeName,
        definedExamId: matchedExam.id,
        termId: selectedTermId,
        termName: termName,
        structureId: applicableStructure.structure.id,
        structureVersion: applicableStructure.version.versionNumber,
        grade: selectedGrade,
        hodId: appUser?.id || "",
        hodName: appUser?.name || "HOD",
        exams: examsList,
        status,
        submittedAt: submitForApproval ? now : undefined,
        createdAt: now,
        updatedAt: now,
      };

      if (editingId) {
        await updateDoc(doc(db, "examSchedules", editingId), {
          sessionId: sessId,
          academicYear: selectedSessionName,
          examType: examTypeName,
          definedExamId: matchedExam.id,
          termId: selectedTermId,
          termName: termName,
          structureId: applicableStructure.structure.id,
          structureVersion: applicableStructure.version.versionNumber,
          grade: selectedGrade,
          exams: examsList,
          status,
          submittedAt: submitForApproval ? now : undefined,
          updatedAt: now,
        });
        toast({
          title: submitForApproval ? "Submitted to Principal" : "Schedule Updated",
          description: submitForApproval
            ? "Your exam schedule was successfully submitted to the Principal for approval."
            : "Exam schedule draft updated.",
        });
      } else {
        await addDoc(collection(db, "examSchedules"), scheduleData);
        toast({
          title: submitForApproval ? "Submitted to Principal" : "Draft Saved",
          description: submitForApproval
            ? "Your exam schedule has been submitted for Principal review."
            : "Exam schedule draft saved.",
        });
      }

      setDialogOpen(false);
    } catch (err: any) {
      console.error("Failed to save schedule:", err);
      setFormError(err?.message || "Failed to save exam schedule.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (schedId: string) => {
    if (!confirm("Are you sure you want to delete this exam schedule?")) return;
    try {
      await deleteDoc(doc(db, "examSchedules", schedId));
      toast({ title: "Exam schedule deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    }
  };

  const handleDirectSubmit = async (sched: ExamSchedule) => {
    try {
      await updateDoc(doc(db, "examSchedules", sched.id), {
        status: "pending_approval",
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      toast({
        title: "Submitted for Approval",
        description: "Schedule submitted to Principal for review.",
      });
    } catch (err: any) {
      toast({ title: "Submit failed", description: err.message, variant: "destructive" });
    }
  };

  // Generate PDF Timetable
  const handleDownloadPDF = (sched: ExamSchedule) => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const sorted = [...sched.exams].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Title & Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(30, 41, 59);
    doc.text("EXAMINATION TIMETABLE", 105, 22, { align: "center" });

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(`Academic Session: ${sched.academicYear || sched.sessionId}`, 105, 29, { align: "center" });

    // Meta Box
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, 36, 180, 24, 3, 3, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    doc.text(`Exam: ${sched.examType}`, 22, 43);
    doc.text(`Term: ${sched.termName || (sched.termId === "term_2" ? "Term 2" : "Term 1")}`, 22, 49);
    doc.text(`Grade: Grade ${sched.grade}`, 22, 55);

    doc.text(`Section Head: ${sched.hodName || "HOD"}`, 120, 45);
    doc.text(`Status: ${sched.status.toUpperCase().replace("_", " ")}`, 120, 52);

    // Table Header
    let y = 68;
    doc.setFillColor(79, 70, 229);
    doc.rect(15, y, 180, 10, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text("DATE", 20, y + 6.5);
    doc.text("DAY", 52, y + 6.5);
    doc.text("TIME", 80, y + 6.5);
    doc.text("SUBJECT", 120, y + 6.5);
    doc.text("MAX MARKS", 168, y + 6.5);

    // Table Rows
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    sorted.forEach((item, index) => {
      const d = new Date(item.date);
      const dateStr = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const dayStr = d.toLocaleDateString("en-IN", { weekday: "short" });
      const timeStr = item.startTime && item.endTime ? `${item.startTime} - ${item.endTime}` : "—";

      if (index % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(15, y, 180, 9, "F");
      }
      doc.setDrawColor(241, 245, 249);
      doc.line(15, y + 9, 195, y + 9);

      doc.setTextColor(30, 41, 59);
      doc.text(dateStr, 20, y + 6);
      doc.text(dayStr, 52, y + 6);
      doc.text(timeStr, 80, y + 6);
      doc.setFont("helvetica", "bold");
      doc.text(item.subjectName, 120, y + 6);
      doc.setFont("helvetica", "normal");
      doc.text(String(item.maxMarks || 100), 175, y + 6);

      y += 9;
    });

    // Important Instructions
    y += 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("Important Instructions for Students:", 15, y);

    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text("1. Students must occupy their examination seats 15 minutes prior to start time.", 15, y);
    doc.text("2. Identity cards are mandatory for entry to the examination hall.", 15, y + 5);
    doc.text("3. Electronic devices, smartwatches, or study materials are strictly prohibited.", 15, y + 10);

    // Signatures
    y += 35;
    doc.setDrawColor(148, 163, 184);
    doc.line(25, y, 75, y);
    doc.line(135, y, 185, y);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text("Section Head (HOD)", 50, y + 6, { align: "center" });
    doc.text("Principal / Controller of Exams", 160, y + 6, { align: "center" });

    doc.save(`${sched.examType}_Grade_${sched.grade}_Timetable.pdf`);
    toast({ title: "Timetable Downloaded", description: "PDF schedule downloaded successfully." });
  };

  const getStatusBadge = (status: ExamScheduleStatus) => {
    switch (status) {
      case "approved":
        return (
          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 font-medium">
            <CheckCircle2 size={12} /> Approved by Principal
          </Badge>
        );
      case "pending_approval":
        return (
          <Badge className="bg-amber-500 hover:bg-amber-600 text-white gap-1 font-medium">
            <Clock size={12} /> Pending Principal Approval
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-rose-600 hover:bg-rose-700 text-white gap-1 font-medium">
            <XCircle size={12} /> Changes Requested
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700 gap-1 font-medium">
            Draft
          </Badge>
        );
    }
  };

  const displayedSchedules = useMemo(() => {
    return schedules.filter((s) => {
      if (termFilter === "all") return true;
      if (termFilter === "term_1") return !s.termId || s.termId === "term_1";
      if (termFilter === "term_2") return s.termId === "term_2";
      return s.termId === termFilter;
    });
  }, [schedules, termFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            Exam Scheduling
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Schedule subject timetables for your assigned grades and submit to Principal for approval.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-2 shrink-0">
          <Plus size={16} /> Schedule Exam
        </Button>
      </div>

      {/* Session notice */}
      <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-primary shrink-0" />
          <span>
            Active Academic Session:{" "}
            <strong className="text-slate-800">{activeSession?.name || "2026-27"}</strong>
            {workingSession && workingSession.name !== activeSession?.name && (
              <span className="ml-2 text-primary">
                (Viewing context: {workingSession.name})
              </span>
            )}
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          Assigned Grades: {assignedGrades.join(", ") || "None"}
        </span>
      </div>

      {/* Term Filter Bar */}
      <div className="flex items-center gap-2 bg-white p-2.5 rounded-lg border border-slate-200">
        <span className="text-xs font-semibold text-slate-600 mr-1">Filter by Academic Term:</span>
        <Button
          variant={termFilter === "all" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => setTermFilter("all")}
        >
          All Terms
        </Button>
        <Button
          variant={termFilter === "term_1" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => setTermFilter("term_1")}
        >
          Term 1
        </Button>
        <Button
          variant={termFilter === "term_2" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => setTermFilter("term_2")}
        >
          Term 2
        </Button>
      </div>

      {/* Schedules List */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      ) : displayedSchedules.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-16 text-center space-y-3">
            <CalendarDays className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="text-base font-semibold text-slate-800">No Exam Schedules Found</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              {termFilter !== "all"
                ? `No exam schedules found for ${termFilter === "term_1" ? "Term 1" : "Term 2"}.`
                : "You haven't scheduled any exams for your assigned grades yet. Click below to create your first exam schedule."}
            </p>
            <Button onClick={handleOpenCreate} size="sm" className="gap-2 mt-2">
              <Plus size={15} /> Schedule New Exam
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {displayedSchedules.map((sched) => {
            const sortedExams = [...sched.exams].sort(
              (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
            );
            const firstDate = sortedExams[0]?.date;
            const lastDate = sortedExams[sortedExams.length - 1]?.date;

            return (
              <Card
                key={sched.id}
                className="flex flex-col justify-between hover:shadow-md transition-shadow border-slate-200"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Badge variant="outline" className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 border-indigo-200">
                          {sched.termName || (sched.termId === "term_2" ? "Term 2" : "Term 1")}
                        </Badge>
                      </div>
                      <CardTitle className="text-lg font-bold text-slate-900">
                        {sched.examType}
                      </CardTitle>
                      <CardDescription className="text-xs font-medium text-slate-500 mt-0.5">
                        Grade {sched.grade} • Session {sched.academicYear || sched.sessionId}
                      </CardDescription>
                    </div>
                    <div>{getStatusBadge(sched.status)}</div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 text-xs flex-1">
                  <div className="bg-slate-50 p-2.5 rounded-lg space-y-1.5 text-slate-600">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Subjects:</span>
                      <span className="font-semibold text-slate-800">{sched.exams.length} subjects</span>
                    </div>
                    {firstDate && lastDate && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Date Range:</span>
                        <span className="font-medium text-slate-700">
                          {new Date(firstDate).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}{" "}
                          –{" "}
                          {new Date(lastDate).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Remarks if rejected or reviewed */}
                  {sched.reviewRemarks && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs ${
                        sched.status === "rejected"
                          ? "bg-rose-50 border-rose-200 text-rose-800"
                          : "bg-blue-50 border-blue-200 text-blue-800"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold mb-1">
                        <AlertCircle size={13} />
                        Principal Remarks:
                      </div>
                      <p className="leading-relaxed">{sched.reviewRemarks}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs h-8 flex-1"
                      onClick={() => setViewSchedule(sched)}
                    >
                      <Eye size={13} /> View Timetable
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs h-8 text-slate-600"
                      onClick={() => handleDownloadPDF(sched)}
                      title="Download PDF"
                    >
                      <Download size={13} /> PDF
                    </Button>

                    {(sched.status === "draft" || sched.status === "rejected") && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleOpenEdit(sched)}
                          title="Edit Schedule"
                        >
                          <Edit3 size={13} />
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1 text-xs h-8 bg-amber-600 hover:bg-amber-700 text-white"
                          onClick={() => handleDirectSubmit(sched)}
                          title="Submit to Principal"
                        >
                          <Send size={12} /> Submit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600"
                          onClick={() => handleDelete(sched.id)}
                          title="Delete Draft"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Schedule Form Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b border-slate-100">
            <DialogTitle className="text-xl font-bold text-slate-900">
              {editingId ? "Edit Exam Schedule" : "Schedule New Examination"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Link subjects, set timetable dates, and submit to the Principal for formal approval.
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            {formError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg text-xs font-medium flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                {formError}
              </div>
            )}

            {/* Top selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs font-medium text-slate-700">Academic Session</Label>
                <Select value={selectedSessionName} onValueChange={setSelectedSessionName}>
                  <SelectTrigger className="mt-1 h-9 text-xs">
                    <SelectValue placeholder="Select Session" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.name} className="text-xs">
                        {s.name} {s.isCurrent ? "(Active)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">Grade</Label>
                <Select value={selectedGrade} onValueChange={setSelectedGrade}>
                  <SelectTrigger className="mt-1 h-9 text-xs">
                    <SelectValue placeholder="Select Grade" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignedGrades.length > 0 ? (
                      assignedGrades.map((g) => (
                        <SelectItem key={g} value={g} className="text-xs">
                          Grade {g}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled className="text-xs">
                        No assigned grades
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">Academic Term</Label>
                <Select
                  value={selectedTermId}
                  onValueChange={(val) => {
                    setSelectedTermId(val);
                  }}
                >
                  <SelectTrigger className="mt-1 h-9 text-xs">
                    <SelectValue placeholder="Select Term" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTerms.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-slate-700">Defined Exam</Label>
                  {applicableStructure && (
                    <span className="text-[10px] text-primary font-medium truncate max-w-[110px]">
                      v{applicableStructure.version.versionNumber}
                    </span>
                  )}
                </div>
                {structureLoading ? (
                  <div className="mt-1 h-9 flex items-center px-3 border rounded text-xs text-muted-foreground">
                    <Loader2 className="animate-spin h-3.5 w-3.5 mr-2 text-primary" /> Loading...
                  </div>
                ) : !applicableStructure ? (
                  <div className="mt-1 h-9 flex items-center px-3 border border-amber-300 bg-amber-50 rounded text-xs text-amber-800">
                    No structure active
                  </div>
                ) : termFilteredExams.length === 0 ? (
                  <div className="mt-1 h-9 flex items-center px-3 border border-amber-300 bg-amber-50 rounded text-xs text-amber-800">
                    No exams for this term
                  </div>
                ) : (
                  <Select
                    value={selectedExamId || selectedExamType}
                    onValueChange={(val) => {
                      const ex = termFilteredExams.find((e) => e.id === val || e.name === val);
                      if (ex) {
                        setSelectedExamId(ex.id);
                        setSelectedExamType(ex.name);
                      }
                    }}
                  >
                    <SelectTrigger className="mt-1 h-9 text-xs">
                      <SelectValue placeholder="Select Defined Exam" />
                    </SelectTrigger>
                    <SelectContent>
                      {termFilteredExams.map((ex) => (
                        <SelectItem key={ex.id} value={ex.id} className="text-xs">
                          {ex.name} ({ex.weightagePercentage}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {/* Structure Warning Alert if not active */}
            {!structureLoading && !applicableStructure && selectedGrade && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-xs font-medium flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-semibold">No Active Academic Structure for Grade {selectedGrade}</p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    HOD exam scheduling is restricted: only exams defined in an active Academic Structure can be scheduled. Please request the Principal or Administrator to configure and activate the Academic Structure for Grade {selectedGrade}.
                  </p>
                </div>
              </div>
            )}

            {/* Subjects scheduling list */}
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                  Subject Dates & Timings (Grade {selectedGrade})
                </Label>
                <span className="text-[11px] text-slate-400">
                  {subjects.length} scholastic subjects linked
                </span>
              </div>

              {subjectsLoading ? (
                <div className="py-8 text-center text-slate-400">
                  <Loader2 className="animate-spin h-6 w-6 mx-auto mb-2 text-primary" />
                  <span className="text-xs">Loading subjects for Grade {selectedGrade}...</span>
                </div>
              ) : subjects.length === 0 ? (
                <div className="p-6 text-center border border-dashed rounded-lg text-slate-400 text-xs">
                  No scholastic subjects found for Grade {selectedGrade}. Please configure subjects in the Admin Subjects panel.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {subjects.map((sub) => {
                    const entry = examEntries[sub.id] || {
                      subjectId: sub.id,
                      subjectName: sub.name,
                      date: "",
                      startTime: "09:30",
                      endTime: "12:30",
                      maxMarks: 100,
                      passingMarks: 35,
                    };

                    return (
                      <div
                        key={sub.id}
                        className="p-3 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center"
                      >
                        <div className="sm:col-span-4 font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                          <FileText size={14} className="text-primary shrink-0" />
                          <span>{sub.name}</span>
                        </div>

                        <div className="sm:col-span-3">
                          <Input
                            type="date"
                            className="h-8 text-xs"
                            value={entry.date}
                            onChange={(e) =>
                              setExamEntries((prev) => ({
                                ...prev,
                                [sub.id]: { ...entry, date: e.target.value },
                              }))
                            }
                          />
                        </div>

                        <div className="sm:col-span-3 flex items-center gap-1">
                          <Input
                            type="time"
                            className="h-8 text-xs w-20 px-1"
                            value={entry.startTime || "09:30"}
                            onChange={(e) =>
                              setExamEntries((prev) => ({
                                ...prev,
                                [sub.id]: { ...entry, startTime: e.target.value },
                              }))
                            }
                          />
                          <span className="text-slate-400 text-xs">-</span>
                          <Input
                            type="time"
                            className="h-8 text-xs w-20 px-1"
                            value={entry.endTime || "12:30"}
                            onChange={(e) =>
                              setExamEntries((prev) => ({
                                ...prev,
                                [sub.id]: { ...entry, endTime: e.target.value },
                              }))
                            }
                          />
                        </div>

                        <div className="sm:col-span-2 flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 uppercase">Max</span>
                          <Input
                            type="number"
                            className="h-8 text-xs w-16 px-1"
                            value={entry.maxMarks ?? 100}
                            onChange={(e) =>
                              setExamEntries((prev) => ({
                                ...prev,
                                [sub.id]: { ...entry, maxMarks: Number(e.target.value) },
                              }))
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleSaveSchedule(false)}
              disabled={saving || !applicableStructure || definedExams.length === 0}
              className="gap-1.5"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
              Save Draft
            </Button>
            <Button
              size="sm"
              onClick={() => handleSaveSchedule(true)}
              disabled={saving || !applicableStructure || definedExams.length === 0}
              className="gap-1.5 bg-primary hover:bg-primary/90 text-white"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Submit to Principal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Timetable Modal */}
      {viewSchedule && (
        <Dialog open={!!viewSchedule} onOpenChange={() => setViewSchedule(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
            <DialogHeader className="p-6 pb-4 border-b border-slate-100">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <DialogTitle className="text-xl font-bold text-slate-900">
                    {viewSchedule.examType}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500 mt-0.5">
                    Grade {viewSchedule.grade} • Session {viewSchedule.academicYear || viewSchedule.sessionId}
                  </DialogDescription>
                </div>
                <div>{getStatusBadge(viewSchedule.status)}</div>
              </div>
            </DialogHeader>

            <div className="p-6 space-y-4 flex-1 overflow-y-auto text-xs">
              {viewSchedule.reviewRemarks && (
                <div
                  className={`p-3 rounded-lg border ${
                    viewSchedule.status === "rejected"
                      ? "bg-rose-50 border-rose-200 text-rose-800"
                      : "bg-blue-50 border-blue-200 text-blue-800"
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5 mb-1">
                    <AlertCircle size={14} />
                    Principal Feedback / Remarks
                  </div>
                  <p className="leading-relaxed">{viewSchedule.reviewRemarks}</p>
                </div>
              )}

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Day</th>
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3 text-right">Max Marks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...viewSchedule.exams]
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                      .map((ex) => {
                        const d = new Date(ex.date);
                        return (
                          <tr key={ex.subjectId} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 font-medium text-slate-800">
                              {d.toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500">
                              {d.toLocaleDateString("en-IN", { weekday: "short" })}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {ex.startTime && ex.endTime ? `${ex.startTime} – ${ex.endTime}` : "—"}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-900">
                              {ex.subjectName}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700">
                              {ex.maxMarks || 100}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleDownloadPDF(viewSchedule)}
              >
                <Download size={14} /> Download PDF Timetable
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setViewSchedule(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

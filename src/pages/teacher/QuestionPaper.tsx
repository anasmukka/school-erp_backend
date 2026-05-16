import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection, query, where, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Image as ImageIcon, Save, Send, FileText, ChevronLeft,
  AlertCircle, Eye, Loader2, CheckCircle, Clock, Printer, Download, GripVertical,
  List, AlignLeft,
} from "lucide-react";
import { Section, Subject, SubjectAssignment } from "@/lib/types";
import { generateQPPdf } from "@/lib/generateQPPdf";

/* ─────────── Constants ─────────── */
const EXAM_TYPES = ["Unit Test 1", "Term 1", "Unit Test 2", "Final Exam"];
const SECTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];
const SEC_ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X"];
const MCQ_OPTS = ["a", "b", "c", "d"] as const;

/* Maps question type → display label for Roman numeral sub-grouping within a section */
const Q_TYPE_LABELS: Record<string, string> = {
  mcq:   "Multiple Choice Questions",
  short: "Short Answer Questions",
  long: "Long Answer Questions",
  question: "Questions",
};

/* Group consecutive questions of the same type into sub-groups */
type QGroup = { type: string; label: string; qs: QPQuestion[] };
function groupByType(questions: QPQuestion[]): QGroup[] {
  const groups: QGroup[] = [];
  for (const q of questions) {
    const last = groups[groups.length - 1];
    if (last && last.type === q.type) { last.qs.push(q); }
    else groups.push({ type: q.type, label: Q_TYPE_LABELS[q.type] ?? "Questions", qs: [q] });
  }
  return groups;
}

/* ─────────── Types ─────────── */
export type QType = "short" | "mcq" | "long" | "question";

export interface QPQuestion {
  id: string;
  type: QType;
  text: string;
  marks: number;
  imageData?: string;
  options?: [string, string, string, string];
  correctOption?: number;
}

export interface QPSection {
  id: string;
  title: string;
  instructions: string;
  questions: QPQuestion[];
}

interface QuestionPaperDoc {
  id: string;
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  examType: string;
  grade: string;
  sectionId: string;
  sections?: QPSection[];
  questions: QPQuestion[];
  totalMarks: number;
  status: "draft" | "submitted" | "hod_approved" | "sent_to_printing";
  instructions: string;
  createdAt: string;
  submittedAt?: string;
  hodNote?: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-600 border-gray-200" },
  submitted: { label: "Submitted to HOD", color: "bg-blue-100 text-blue-700 border-blue-200" },
  hod_approved: { label: "HOD Approved", color: "bg-green-100 text-green-700 border-green-200" },
  sent_to_printing: { label: "Sent to Printing", color: "bg-violet-100 text-violet-700 border-violet-200" },
};

/* ─────────── Helpers ─────────── */
function genId() { return Math.random().toString(36).slice(2, 10); }

function qMarks(q: QPQuestion): number {
  return q.marks || 0;
}

function sectionMarks(s: QPSection): number {
  return s.questions.reduce((t, q) => t + qMarks(q), 0);
}

function totalMarksOf(sections: QPSection[]): number {
  return sections.reduce((t, s) => t + sectionMarks(s), 0);
}

function normalizeQuestionType(type: unknown): QType {
  return type === "mcq" || type === "short" || type === "long" || type === "question"
    ? type
    : "short";
}

function getQuestionTypeLabel(type: QType): string {
  if (type === "mcq") return "MCQ";
  if (type === "long") return "Long Answer";
  if (type === "question") return "Question";
  return "Short Answer";
}

function migrateToSections(paper: QuestionPaperDoc): QPSection[] {
  if (paper.sections?.length) return paper.sections;
  return [{
    id: genId(), title: "Section A", instructions: "",
    questions: (paper.questions ?? []).map((q) => ({
      id: q.id, type: normalizeQuestionType(q.type),
      text: q.text, marks: q.marks, imageData: q.imageData,
    })),
  }];
}

function defaultMCQOptions(): [string, string, string, string] { return ["", "", "", ""]; }

/* ─────────── Shared render helpers ─────────── */
function renderQuestion(q: QPQuestion, n: number) {
  const marks = qMarks(q);
  return (
    <div key={q.id} className="pb-3 border-b border-dashed border-border last:border-0">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium leading-relaxed flex-1">
          <span className="font-bold">{n}.</span> {q.text}
        </p>
        <span className="text-xs text-muted-foreground shrink-0 mt-0.5">[{marks} mark{marks !== 1 ? "s" : ""}]</span>
      </div>
      {q.imageData && <img src={q.imageData} alt="figure" className="mt-2 max-h-40 rounded border object-contain" />}
      {q.type === "mcq" && q.options && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3 pl-4">
          {MCQ_OPTS.map((opt, i) => (
            <p key={opt} className="text-sm">
              <span className="font-semibold">({opt})</span> {q.options![i] ?? ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* Section preview: "Section A" header → Roman-numeral type sub-groups → local Q numbers */
function renderPreviewSection(sec: QPSection, sectionIdx: number) {
  const letter = SECTION_LETTERS[sectionIdx] ?? String.fromCharCode(65 + sectionIdx);
  const groups = groupByType(sec.questions);
  const multipleGroups = groups.length > 1;

  return (
    <div key={sec.id} className="mb-8">
      {/* Section header: "Section A" */}
      <div className="flex items-center justify-between bg-slate-200 rounded px-4 py-2.5 mb-3 border-l-4 border-slate-500">
        <p className="font-bold text-sm tracking-wide">Section {letter}</p>
        <p className="text-xs text-muted-foreground font-medium">[{sectionMarks(sec)} Marks]</p>
      </div>
      {sec.instructions && (
        <p className="text-xs italic text-muted-foreground mb-3 px-1">{sec.instructions}</p>
      )}

      {/* Roman-numeral type sub-groups */}
      <div className="space-y-5">
        {groups.map((grp, gIdx) => {
          const grpMarks = grp.qs.reduce((t, q) => t + qMarks(q), 0);
          return (
            <div key={gIdx}>
              {multipleGroups && (
                <div className="flex items-center justify-between bg-slate-100 rounded px-3 py-1.5 mb-3 ml-2">
                  <p className="font-semibold text-xs tracking-wide">{SEC_ROMAN[gIdx]}. {grp.label}</p>
                  <p className="text-xs text-muted-foreground">[{grpMarks} Marks]</p>
                </div>
              )}
              <div className="space-y-4">
                {grp.qs.map((q, qi) => renderQuestion(q, qi + 1))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
export default function QuestionPaper() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  /* ── Firestore data ── */
  const [teacherDocId, setTeacherDocId] = useState<string | null>(null);
  const [classSections, setClassSections] = useState<Section[]>([]);
  const [subjectsMap, setSubjectsMap] = useState<Record<string, Subject>>({});
  const [assignments, setAssignments] = useState<SubjectAssignment[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [myPapers, setMyPapers] = useState<QuestionPaperDoc[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(false);

  /* ── UI state ── */
  const [view, setView] = useState<"list" | "create" | "preview">("list");
  const [editingPaper, setEditingPaper] = useState<QuestionPaperDoc | null>(null);

  /* ── Paper editor state ── */
  const [selectedClass, setSelectedClass] = useState<Section | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [selectedExam, setSelectedExam] = useState("");
  const [overallInstructions, setOverallInstructions] = useState("All questions are compulsory. Write clearly.");
  const [paperSections, setPaperSections] = useState<QPSection[]>([
    { id: genId(), title: "Section A", instructions: "", questions: [] },
  ]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitPreviewUrl, setSubmitPreviewUrl] = useState<string | null>(null);
  const [preparingSubmitPreview, setPreparingSubmitPreview] = useState(false);

  /* ─────────── Init ─────────── */
  useEffect(() => {
    if (!appUser) return;
    const init = async () => {
      try {
        let tSnap = await getDocs(query(collection(db, "teachers"), where("uid", "==", appUser.id)));
        if (tSnap.empty && appUser.email)
          tSnap = await getDocs(query(collection(db, "teachers"), where("email", "==", appUser.email)));
        if (tSnap.empty) return;
        const tDocId = tSnap.docs[0].id;
        setTeacherDocId(tDocId);

        const aSnap = await getDocs(query(collection(db, "subjectAssignments"), where("teacherId", "==", tDocId)));
        const allAssign = aSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SubjectAssignment));
        setAssignments(allAssign);

        const secIds = [...new Set(allAssign.map((a) => a.sectionId))];
        const subIds = [...new Set(allAssign.map((a) => a.subjectId))];

        const [secDocs, subDocs] = await Promise.all([
          Promise.all(secIds.map((id) => getDoc(doc(db, "sections", id)))),
          Promise.all(subIds.map((id) => getDoc(doc(db, "subjects", id)))),
        ]);

        setClassSections(
          secDocs.filter((d) => d.exists())
            .map((d) => ({ id: d.id, ...d.data() } as Section))
            .sort((a, b) => `${a.grade}${a.name}`.localeCompare(`${b.grade}${b.name}`))
        );
        const sm: Record<string, Subject> = {};
        subDocs.filter((d) => d.exists()).forEach((d) => { sm[d.id] = { id: d.id, ...d.data() } as Subject; });
        setSubjectsMap(sm);
      } finally {
        setLoadingInit(false);
      }
    };
    init();
  }, [appUser]);

  const loadMyPapers = useCallback(async () => {
    if (!teacherDocId) return;
    setLoadingPapers(true);
    try {
      const snap = await getDocs(query(collection(db, "questionPapers"), where("teacherId", "==", teacherDocId)));
      setMyPapers(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as QuestionPaperDoc))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
    } finally { setLoadingPapers(false); }
  }, [teacherDocId]);

  useEffect(() => { if (teacherDocId) loadMyPapers(); }, [teacherDocId, loadMyPapers]);

  /* ─────────── Section / Question Mutators ─────────── */
  const addSection = () => {
    const nextLetter = SECTION_LETTERS[paperSections.length] ?? String.fromCharCode(65 + paperSections.length);
    setPaperSections((prev) => [...prev, {
      id: genId(), title: `Section ${nextLetter}`, instructions: "",
      questions: [],
    }]);
  };

  const removeSection = (sid: string) =>
    setPaperSections((prev) => prev.filter((s) => s.id !== sid));

  const updateSection = (sid: string, patch: Partial<Omit<QPSection, "id" | "questions">>) =>
    setPaperSections((prev) => prev.map((s) => s.id === sid ? { ...s, ...patch } : s));

  const addQuestion = (sid: string, type: QType) =>
    setPaperSections((prev) => {
      return prev.map((s) => s.id !== sid ? s : {
        ...s, questions: [...s.questions, {
          id: genId(), type, text: "", marks: 1,
          ...(type === "mcq" ? { options: defaultMCQOptions(), correctOption: 0 } : {}),
        }],
      });
    });

  const removeQuestion = (sid: string, qid: string) =>
    setPaperSections((prev) => prev.map((s) => s.id !== sid ? s : {
      ...s, questions: s.questions.filter((q) => q.id !== qid),
    }));

  const updateQuestion = (sid: string, qid: string, patch: Partial<QPQuestion>) =>
    setPaperSections((prev) => prev.map((s) => s.id !== sid ? s : {
      ...s, questions: s.questions.map((q) => q.id !== qid ? q : { ...q, ...patch }),
    }));

  const updateOption = (sid: string, qid: string, optIdx: number, val: string) =>
    setPaperSections((prev) => prev.map((s) => s.id !== sid ? s : {
      ...s, questions: s.questions.map((q) => {
        if (q.id !== qid || !q.options) return q;
        const opts = [...q.options] as [string, string, string, string];
        opts[optIdx] = val;
        return { ...q, options: opts };
      }),
    }));

  // Roman Numerals question type was removed from the teacher paper builder.

  /* ─────────── Image upload ─────────── */
  const uploadImage = (file: File, onLoad: (data: string) => void) => {
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Max 2 MB.", variant: "destructive" }); return;
    }
    const reader = new FileReader();
    reader.onload = (e) => { if (e.target?.result) onLoad(e.target.result as string); };
    reader.readAsDataURL(file);
  };

  /* ─────────── Subjects for class section ─────────── */
  const subjectsForClass = (secId: string): Subject[] => {
    const ids = assignments.filter((a) => a.sectionId === secId).map((a) => a.subjectId);
    return ids.map((id) => subjectsMap[id]).filter(Boolean);
  };

  /* ─────────── Validate ─────────── */
  const validate = (): boolean => {
    if (!selectedExam) { toast({ title: "Select exam type", variant: "destructive" }); return false; }
    if (!selectedClass) { toast({ title: "Select a class section", variant: "destructive" }); return false; }
    if (!selectedSubject) { toast({ title: "Select a subject", variant: "destructive" }); return false; }
    if (paperSections.length === 0) { toast({ title: "Add at least one section", variant: "destructive" }); return false; }
    for (const sec of paperSections) {
      if (sec.questions.length === 0) {
        toast({ title: `${sec.title} has no questions`, variant: "destructive" }); return false;
      }
      for (const q of sec.questions) {
        if (!q.text.trim()) {
          toast({ title: "Empty question", description: `A question in ${sec.title} is empty.`, variant: "destructive" }); return false;
        }
        if (q.type === "mcq" && q.options?.some((o) => !o.trim())) {
          toast({ title: "Incomplete MCQ", description: `All 4 options must be filled in ${sec.title}.`, variant: "destructive" }); return false;
        }
      }
    }
    const total = totalMarksOf(paperSections);
    if (total === 0) { toast({ title: "Total marks is 0", variant: "destructive" }); return false; }
    return true;
  };

  /* ─────────── Start create / edit ─────────── */
  const startCreate = (paper?: QuestionPaperDoc) => {
    if (paper) {
      setEditingPaper(paper);
      const cls = classSections.find((s) => s.id === paper.sectionId) ?? null;
      setSelectedClass(cls);
      setSelectedSubject(subjectsMap[paper.subjectId] ?? null);
      setSelectedExam(paper.examType);
      setOverallInstructions(paper.instructions ?? "");
      setPaperSections(migrateToSections(paper));
    } else {
      setEditingPaper(null);
      setSelectedClass(null);
      setSelectedSubject(null);
      setSelectedExam("");
      setOverallInstructions("All questions are compulsory. Write clearly.");
      setPaperSections([{
        id: genId(), title: "Section A", instructions: "",
        questions: [],
      }]);
    }
    setView("create");
  };

  /* ─────────── Build payload ─────────── */
  const buildPayload = (status: QuestionPaperDoc["status"]) => ({
    teacherId: teacherDocId!,
    teacherName: appUser?.name ?? "",
    subjectId: selectedSubject!.id,
    subjectName: selectedSubject!.name,
    examType: selectedExam,
    grade: selectedClass!.grade,
    sectionId: selectedClass!.id,
    sections: paperSections,
    questions: paperSections.flatMap((s) => s.questions), // flat for backward compat
    totalMarks: totalMarksOf(paperSections),
    instructions: overallInstructions,
    status,
    createdAt: editingPaper?.createdAt ?? new Date().toISOString(),
    ...(status === "submitted" ? { submittedAt: new Date().toISOString() } : {}),
  });

  const buildPaperInfo = () => ({
    examType: selectedExam,
    grade: selectedClass?.grade ?? "",
    subjectName: selectedSubject?.name ?? "",
    teacherName: appUser?.name ?? "",
    totalMarks: totalMarksOf(paperSections),
    instructions: overallInstructions,
    sections: paperSections,
  });

  /* ─────────── Save draft ─────────── */
  const saveDraft = async () => {
    if (!validate() || !teacherDocId) return;
    setSaving(true);
    try {
      const payload = buildPayload("draft");
      if (editingPaper) await updateDoc(doc(db, "questionPapers", editingPaper.id), payload);
      else await addDoc(collection(db, "questionPapers"), payload);
      toast({ title: "Draft saved" });
      await loadMyPapers(); setView("list");
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  /* ─────────── Submit to HOD ─────────── */
  const submitToHod = async () => {
    if (!validate() || !teacherDocId) return;
    setSubmitting(true);
    try {
      const dupSnap = await getDocs(query(
        collection(db, "questionPapers"),
        where("teacherId", "==", teacherDocId),
        where("subjectId", "==", selectedSubject!.id),
        where("examType", "==", selectedExam),
        where("sectionId", "==", selectedClass!.id),
      ));
      const existing = dupSnap.docs.filter((d) => d.data().status !== "draft" && d.id !== editingPaper?.id);
      if (existing.length > 0) {
        toast({
          title: "Already submitted",
          description: `A question paper for ${selectedSubject!.name} (${selectedExam}) is already submitted. Edit that paper instead.`,
          variant: "destructive",
        });
        return;
      }
      const payload = buildPayload("submitted");
      if (editingPaper) await updateDoc(doc(db, "questionPapers", editingPaper.id), payload);
      else await addDoc(collection(db, "questionPapers"), payload);
      toast({ title: "Submitted to HOD", description: "Paper sent for approval." });
      await loadMyPapers(); setView("list");
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
    finally { setSubmitting(false); }
  };

  const openSubmitConfirmation = async () => {
    if (!validate() || !teacherDocId) return;
    setPreparingSubmitPreview(true);
    try {
      const previewUrl = await generateQPPdf(buildPaperInfo(), { mode: "preview" });
      if (submitPreviewUrl) URL.revokeObjectURL(submitPreviewUrl);
      setSubmitPreviewUrl(previewUrl ?? null);
      setSubmitConfirmOpen(true);
    } catch {
      toast({ title: "PDF error", description: "Failed to prepare PDF preview.", variant: "destructive" });
    } finally {
      setPreparingSubmitPreview(false);
    }
  };

  const confirmSendToHod = async () => {
    setSubmitConfirmOpen(false);
    await submitToHod();
  };

  /* ─────────── PDF ─────────── */
  const handleDownloadPdf = async (paper: QuestionPaperDoc) => {
    try {
      await generateQPPdf({
        examType: paper.examType, grade: paper.grade,
        subjectName: paper.subjectName, teacherName: paper.teacherName,
        totalMarks: paper.totalMarks, instructions: paper.instructions,
        sections: migrateToSections(paper),
      });
    } catch { toast({ title: "PDF error", description: "Failed to generate PDF.", variant: "destructive" }); }
  };

  /* ─────────── Delete ─────────── */
  const deletePaper = async (id: string) => {
    if (!confirm("Delete this question paper?")) return;
    try {
      await deleteDoc(doc(db, "questionPapers", id));
      toast({ title: "Deleted" });
      await loadMyPapers();
    } catch (err: any) { toast({ title: "Error", description: err.message, variant: "destructive" }); }
  };

  /* ─────────── Guards ─────────── */
  if (loadingInit) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!teacherDocId) {
    return (
      <div className="flex items-center justify-center h-64">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle size={40} className="text-orange-400 mx-auto mb-3" />
            <p className="font-semibold">No teacher profile found</p>
            <p className="text-sm text-muted-foreground mt-1">Contact the admin to link your account.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ═══════════════ PREVIEW VIEW ═══════════════ */
  if (view === "preview" && editingPaper) {
    const secs = migrateToSections(editingPaper);
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => setView("list")}>
            <ChevronLeft size={16} /> Back
          </Button>
          <h1 className="text-xl font-bold flex-1">Question Paper Preview</h1>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleDownloadPdf(editingPaper)}>
            <Download size={15} /> Download PDF
          </Button>
        </div>
        <Card className="max-w-3xl mx-auto">
          <CardContent className="pt-6 pb-8">
            {/* Paper header */}
            <div className="text-center mb-6 border-b pb-5">
              <p className="font-bold text-xl">PRESTIGE INTERNATIONAL SCHOOL</p>
              <p className="text-sm font-medium mt-1">{editingPaper.examType} — Grade {editingPaper.grade}</p>
              <p className="text-sm text-muted-foreground">{editingPaper.subjectName}</p>
              <div className="flex justify-center gap-6 text-xs text-muted-foreground mt-2">
                <span>Total Marks: <strong>{editingPaper.totalMarks}</strong></span>
                <span>Time: ________</span>
                <span>Date: ________</span>
              </div>
            </div>
            {/* Overall instructions */}
            {editingPaper.instructions && (
              <div className="mb-5 bg-muted/50 rounded-lg px-4 py-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">General Instructions</p>
                <p className="text-sm">{editingPaper.instructions}</p>
              </div>
            )}
            {/* Sections */}
            {secs.map((sec, secIdx) => renderPreviewSection(sec, secIdx))}
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ═══════════════ CREATE / EDIT VIEW ═══════════════ */
  if (view === "create") {
    const classSubjects = selectedClass ? subjectsForClass(selectedClass.id) : [];
    const grandTotal = totalMarksOf(paperSections);

    return (
      <div>
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setView("list")}>
              <ChevronLeft size={16} /> Back
            </Button>
            <h1 className="text-xl font-bold">
              {editingPaper ? "Edit Question Paper" : "New Question Paper"}
            </h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={saveDraft} disabled={saving || submitting}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Saving…" : "Save Draft"}
            </Button>
            <Button className="gap-2" onClick={openSubmitConfirmation} disabled={saving || submitting || preparingSubmitPreview}>
              {submitting || preparingSubmitPreview ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {preparingSubmitPreview ? "Preparing PDF…" : submitting ? "Submitting…" : "Submit to HOD"}
            </Button>
          </div>
        </div>

        <div className="space-y-5 max-w-3xl">
          {/* Paper details card */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Paper Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Exam type */}
                <div className="space-y-1.5">
                  <Label>Exam Type</Label>
                  <select
                    className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                    value={selectedExam}
                    onChange={(e) => setSelectedExam(e.target.value)}
                    disabled={!!editingPaper && editingPaper.status !== "draft"}
                  >
                    <option value="">Select exam</option>
                    {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {/* Class section */}
                <div className="space-y-1.5">
                  <Label>Class Section</Label>
                  <select
                    className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                    value={selectedClass?.id ?? ""}
                    onChange={(e) => {
                      const s = classSections.find((s) => s.id === e.target.value) ?? null;
                      setSelectedClass(s); setSelectedSubject(null);
                    }}
                    disabled={!!editingPaper && editingPaper.status !== "draft"}
                  >
                    <option value="">Select section</option>
                    {classSections.map((s) => <option key={s.id} value={s.id}>Grade {s.grade} – Sec {s.name}</option>)}
                  </select>
                </div>
                {/* Subject */}
                <div className="space-y-1.5">
                  <Label>Subject</Label>
                  <select
                    className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                    value={selectedSubject?.id ?? ""}
                    onChange={(e) => setSelectedSubject(classSubjects.find((s) => s.id === e.target.value) ?? null)}
                    disabled={!selectedClass || (!!editingPaper && editingPaper.status !== "draft")}
                  >
                    <option value="">Select subject</option>
                    {classSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>General Instructions for Students</Label>
                <Input
                  value={overallInstructions}
                  onChange={(e) => setOverallInstructions(e.target.value)}
                  placeholder="e.g. All questions are compulsory."
                />
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold text-primary">Total Marks: {grandTotal}</span>
              </div>
            </CardContent>
          </Card>

          {/* Sections */}
          {paperSections.map((sec, sIdx) => {
            const secLetter = SECTION_LETTERS[sIdx] ?? String.fromCharCode(65 + sIdx);
            return (
              <Card key={sec.id} className="border-2 border-slate-200">
                {/* Section header */}
                <CardHeader className="pb-2 bg-slate-50 rounded-t-lg">
                  <div className="flex items-center gap-3">
                    <GripVertical size={16} className="text-muted-foreground" />
                    <span className="font-bold text-base text-slate-700 shrink-0">Section {secLetter}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        className="h-8 text-sm flex-1"
                        placeholder={`Section ${secLetter} title (optional)…`}
                        value={sec.title === `Section ${secLetter}` ? "" : sec.title}
                        onChange={(e) => updateSection(sec.id, { title: e.target.value || `Section ${secLetter}` })}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">[{sectionMarks(sec)} marks]</span>
                    </div>
                    {paperSections.length > 1 && (
                      <button onClick={() => removeSection(sec.id)} className="text-destructive hover:text-destructive/80 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  <Input
                    className="mt-2 text-xs h-8"
                    placeholder="Section instructions (optional)…"
                    value={sec.instructions}
                    onChange={(e) => updateSection(sec.id, { instructions: e.target.value })}
                  />
                </CardHeader>

                <CardContent className="pt-4 pb-4 space-y-3">
                  {/* Questions */}
                  {sec.questions.map((q, qIdx) => {
                    const marks = qMarks(q);
                    return (
                      <div key={q.id} className="border rounded-lg p-3 space-y-3 bg-background">
                        {/* Question header */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded">{qIdx + 1}.</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                              q.type === "mcq" ? "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-gray-50 text-gray-600 border-gray-200"
                            }`}>
                              {getQuestionTypeLabel(q.type)}
                            </span>
                            <span className="text-xs text-muted-foreground">[{marks} mark{marks !== 1 ? "s" : ""}]</span>
                          </div>
                          <button onClick={() => removeQuestion(sec.id, q.id)} className="text-destructive hover:text-destructive/80 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* Question text */}
                        <textarea
                          rows={2}
                          className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="Enter question text…"
                          value={q.text}
                          onChange={(e) => updateQuestion(sec.id, q.id, { text: e.target.value })}
                        />

                        {/* MCQ: options + correct answer + marks */}
                        {q.type === "mcq" && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              {MCQ_OPTS.map((opt, i) => (
                                <div key={opt} className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name={`correct-${q.id}`}
                                    checked={q.correctOption === i}
                                    onChange={() => updateQuestion(sec.id, q.id, { correctOption: i })}
                                    className="accent-green-600 shrink-0"
                                    title="Mark as correct"
                                  />
                                  <span className="text-xs font-semibold text-muted-foreground">({opt})</span>
                                  <Input
                                    className="h-8 text-sm flex-1"
                                    placeholder={`Option ${opt.toUpperCase()}`}
                                    value={q.options?.[i] ?? ""}
                                    onChange={(e) => updateOption(sec.id, q.id, i, e.target.value)}
                                  />
                                </div>
                              ))}
                            </div>
                            <p className="text-xs text-muted-foreground">● marks the correct answer (for your reference; not shown in PDF)</p>
                            <div className="flex items-center gap-2">
                              <Label className="text-xs shrink-0">Marks:</Label>
                              <Input type="number" min={0.5} step={0.5} className="w-20 h-8 text-sm"
                                value={q.marks}
                                onChange={(e) => updateQuestion(sec.id, q.id, { marks: parseFloat(e.target.value) || 0 })} />
                            </div>
                          </div>
                        )}

                        {/* Non-MCQ question: marks + image */}
                        {q.type !== "mcq" && (
                          <div className="flex items-center gap-4 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Label className="text-xs shrink-0">Marks:</Label>
                              <Input type="number" min={0.5} step={0.5} className="w-20 h-8 text-sm"
                                value={q.marks}
                                onChange={(e) => updateQuestion(sec.id, q.id, { marks: parseFloat(e.target.value) || 0 })} />
                            </div>
                            <ImageUploadBtn
                              hasImage={!!q.imageData}
                              onFile={(f) => uploadImage(f, (d) => updateQuestion(sec.id, q.id, { imageData: d }))}
                              onRemove={() => updateQuestion(sec.id, q.id, { imageData: undefined })}
                            />
                          </div>
                        )}

                        {/* MCQ image */}
                        {q.type === "mcq" && (
                          <ImageUploadBtn
                            hasImage={!!q.imageData}
                            onFile={(f) => uploadImage(f, (d) => updateQuestion(sec.id, q.id, { imageData: d }))}
                            onRemove={() => updateQuestion(sec.id, q.id, { imageData: undefined })}
                          />
                        )}

                        {q.imageData && (
                          <img src={q.imageData} alt="figure" className="max-h-40 rounded border object-contain" />
                        )}

                      </div>
                    );
                  })}

                  {/* Add question dropdown */}
                  <AddQuestionBar onAdd={(type) => addQuestion(sec.id, type)} />
                </CardContent>
              </Card>
            );
          })}

          {/* Add section */}
          <Button variant="outline" className="w-full gap-2" onClick={addSection}>
            <Plus size={15} /> Add Section
          </Button>

          {/* Bottom action bar */}
          <div className="flex gap-3 pb-6">
            <Button variant="outline" className="flex-1 gap-2" onClick={saveDraft} disabled={saving || submitting}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Saving…" : "Save Draft"}
            </Button>
            <Button className="flex-1 gap-2" onClick={openSubmitConfirmation} disabled={saving || submitting || preparingSubmitPreview}>
              {submitting || preparingSubmitPreview ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {preparingSubmitPreview ? "Preparing PDF…" : submitting ? "Submitting…" : "Submit to HOD"}
            </Button>
          </div>

          <Dialog
            open={submitConfirmOpen}
            onOpenChange={(next) => {
              setSubmitConfirmOpen(next);
              if (!next && submitPreviewUrl) {
                URL.revokeObjectURL(submitPreviewUrl);
                setSubmitPreviewUrl(null);
              }
            }}
          >
            <DialogContent className="max-w-5xl w-[95vw]">
              <DialogHeader>
                <DialogTitle>Confirm PDF before sending to HOD</DialogTitle>
              </DialogHeader>
              <div className="h-[65vh] rounded border bg-muted/30 overflow-hidden">
                {submitPreviewUrl ? (
                  <iframe title="Question paper PDF preview" src={submitPreviewUrl} className="w-full h-full" />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    PDF preview unavailable.
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSubmitConfirmOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  className="gap-2"
                  onClick={confirmSendToHod}
                  disabled={submitting}
                >
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {submitting ? "Submitting…" : "Confirm Send to HOD"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    );
  }

  /* ═══════════════ LIST VIEW ═══════════════ */
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Question Papers</h1>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => loadMyPapers()} disabled={loadingPapers}>
            {loadingPapers ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
          </Button>
          <Button className="gap-2" onClick={() => startCreate()}>
            <Plus size={15} /> New Paper
          </Button>
        </div>
      </div>

      {loadingPapers ? (
        <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-muted-foreground" /></div>
      ) : myPapers.length === 0 ? (
        <Card>
          <CardContent className="pt-10 pb-10 text-center">
            <FileText size={40} className="text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No question papers yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">Create your first CBSE-style question paper</p>
            <Button onClick={() => startCreate()} className="gap-2"><Plus size={14} /> New Paper</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {myPapers.map((paper) => {
            const st = STATUS_LABELS[paper.status];
            const canEdit = paper.status === "draft";
            const secs = paper.sections ?? [];
            const qCount = secs.length > 0
              ? secs.reduce((t, s) => t + s.questions.length, 0)
              : paper.questions.length;
            return (
              <Card key={paper.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <FileText size={18} className="text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">
                          {paper.subjectName} <span className="text-muted-foreground font-normal text-sm">Grade {paper.grade}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {paper.examType} · {qCount} question{qCount !== 1 ? "s" : ""}
                          {secs.length > 0 ? ` (${secs.length} sections)` : ""}
                          · {paper.totalMarks} marks
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-1 rounded-full border font-medium ${st.color}`}>
                        {paper.status === "draft" && <Clock size={10} className="inline mr-1" />}
                        {paper.status === "submitted" && <Send size={10} className="inline mr-1" />}
                        {paper.status === "hod_approved" && <CheckCircle size={10} className="inline mr-1" />}
                        {paper.status === "sent_to_printing" && <Printer size={10} className="inline mr-1" />}
                        {st.label}
                      </span>
                      <Button size="sm" variant="ghost" className="gap-1 text-xs h-7"
                        onClick={() => { setEditingPaper(paper); setView("preview"); }}>
                        <Eye size={12} /> Preview
                      </Button>
                      <Button size="sm" variant="ghost" className="gap-1 text-xs h-7"
                        onClick={() => handleDownloadPdf(paper)}>
                        <Download size={12} /> PDF
                      </Button>
                      {canEdit && (
                        <>
                          <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={() => startCreate(paper)}>
                            Edit
                          </Button>
                          <button onClick={() => deletePaper(paper.id)}
                            className="text-destructive hover:text-destructive/80 p-1 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────── Small reusable sub-components ─────────── */
function ImageUploadBtn({ hasImage, onFile, onRemove }: {
  hasImage: boolean;
  onFile: (f: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
        <ImageIcon size={13} />
        {hasImage ? "Change Image" : "Add Image"}
        <input type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </label>
      {hasImage && (
        <button onClick={onRemove} className="text-xs text-destructive hover:underline">Remove</button>
      )}
    </div>
  );
}

function AddQuestionBar({ onAdd }: { onAdd: (type: QType) => void }) {
  const [selectedType, setSelectedType] = useState<QType>("short");
  const addOptions = [
    { type: "question" as QType, label: "Question", icon: <AlignLeft size={13} /> },
    { type: "short" as QType, label: "Short Answer", icon: <AlignLeft size={13} /> },
    { type: "long" as QType, label: "Long Answer", icon: <AlignLeft size={13} /> },
    { type: "mcq" as QType, label: "MCQ", icon: <List size={13} /> },
  ] as const;

  return (
    <div className="flex items-center gap-2">
      <select
        className="h-8 min-w-40 border border-input rounded-md px-2 text-xs bg-background"
        value={selectedType}
        onChange={(e) => {
          const next = e.target.value as QType;
          setSelectedType(next);
        }}
      >
        {addOptions.map(({ type, label }) => (
          <option key={type} value={type}>{label}</option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        className="gap-1 text-xs"
        onClick={() => {
          onAdd(selectedType);
        }}
      >
        <Plus size={13} /> Add Question
      </Button>
    </div>
  );
}

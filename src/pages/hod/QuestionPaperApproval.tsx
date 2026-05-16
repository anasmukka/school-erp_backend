import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection, query, where, getDocs, doc, updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Eye, CheckCircle, Printer, ChevronLeft, Loader2,
  Clock, Send, AlertCircle, RefreshCw, Download,
} from "lucide-react";
import { generateQPPdf } from "@/lib/generateQPPdf";
import type { QPSection, QPQuestion } from "@/pages/teacher/QuestionPaper";

const ROMAN = ["i","ii","iii","iv","v","vi","vii","viii","ix","x"];
const SEC_ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X"];
const SECTION_LETTERS = ["A","B","C","D","E","F","G"];
const MCQ_OPTS = ["a","b","c","d"] as const;

const Q_TYPE_LABELS: Record<string, string> = {
  mcq: "Multiple Choice Questions",
  short: "Short Answer Questions",
  roman: "Long Answer Questions",
};

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
  approvedAt?: string;
  sentToPrintingAt?: string;
}

function genId() { return Math.random().toString(36).slice(2, 10); }

function migrateToSections(paper: QuestionPaperDoc): QPSection[] {
  if (paper.sections?.length) return paper.sections;
  return [{
    id: genId(), title: "Section A", instructions: "",
    questions: (paper.questions ?? []).map((q) => ({
      id: q.id, type: (q.type ?? "short") as "short" | "mcq" | "roman",
      text: q.text, marks: q.marks, imageData: q.imageData,
    })),
  }];
}

function qMarks(q: QPQuestion): number {
  if (q.type === "roman" && q.subQuestions?.length)
    return q.subQuestions.reduce((s, sq) => s + sq.marks, 0);
  return q.marks ?? 0;
}

function sectionTotal(sec: QPSection): number {
  return sec.questions.reduce((t, q) => t + qMarks(q), 0);
}

function PreviewSection({ sec, secIdx }: { sec: QPSection; secIdx: number }) {
  const letter = SECTION_LETTERS[secIdx] ?? String.fromCharCode(65 + secIdx);
  const groups = groupByType(sec.questions);
  const multipleGroups = groups.length > 1;

  return (
    <div className="mb-8">
      {/* Section A header */}
      <div className="flex items-center justify-between bg-slate-200 rounded px-3 py-2.5 mb-3 border-l-4 border-slate-500">
        <p className="font-bold text-sm tracking-wide">Section {letter}</p>
        <p className="text-xs text-muted-foreground">[{sectionTotal(sec)} Marks]</p>
      </div>
      {sec.instructions && (
        <p className="text-xs italic text-muted-foreground mb-3 px-1">{sec.instructions}</p>
      )}
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
                {grp.qs.map((q, qi) => {
                  const marks = qMarks(q);
                  return (
                    <div key={q.id} className="pb-3 border-b border-dashed border-border last:border-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium leading-relaxed flex-1">
                          <span className="font-bold">{qi + 1}.</span> {q.text}
                        </p>
                        <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
                          [{marks} mark{marks !== 1 ? "s" : ""}]
                        </span>
                      </div>
                      {q.imageData && (
                        <img src={q.imageData} alt="figure" className="mt-2 max-h-40 rounded border object-contain" />
                      )}
                      {q.type === "mcq" && q.options && (
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3 pl-4">
                          {MCQ_OPTS.map((opt, i) => (
                            <p key={opt} className="text-sm">
                              <span className="font-semibold">({opt})</span> {q.options![i] ?? ""}
                            </p>
                          ))}
                        </div>
                      )}
                      {q.type === "roman" && q.subQuestions && (
                        <div className="mt-2 pl-6 space-y-2">
                          {q.subQuestions.map((sq, si) => (
                            <div key={sq.id}>
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-sm leading-relaxed flex-1">
                                  <span className="font-semibold">({ROMAN[si] ?? si + 1})</span> {sq.text}
                                </p>
                                <span className="text-xs text-muted-foreground shrink-0">[{sq.marks}]</span>
                              </div>
                              {sq.imageData && (
                                <img src={sq.imageData} alt="figure" className="mt-1 max-h-32 rounded border object-contain" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-600 border-gray-200" },
  submitted: { label: "Pending Approval", color: "bg-blue-100 text-blue-700 border-blue-200" },
  hod_approved: { label: "Approved", color: "bg-green-100 text-green-700 border-green-200" },
  sent_to_printing: { label: "Sent to Printing", color: "bg-violet-100 text-violet-700 border-violet-200" },
};

const TABS = [
  { key: "submitted", label: "Pending Approval" },
  { key: "hod_approved", label: "Approved" },
  { key: "sent_to_printing", label: "Sent to Printing" },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function QuestionPaperApproval() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [papers, setPapers] = useState<QuestionPaperDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("submitted");
  const [previewPaper, setPreviewPaper] = useState<QuestionPaperDoc | null>(null);
  const [hodNote, setHodNote] = useState("");
  const [actioning, setActioning] = useState<string | null>(null);

  const loadPapers = useCallback(async () => {
    if (!appUser) return;
    setLoading(true);
    try {
      const hodGrades = (appUser.assignedGrades as string[] | undefined) ?? [];
      if (hodGrades.length === 0) { setPapers([]); return; }

      const chunks: QuestionPaperDoc[] = [];
      for (let i = 0; i < hodGrades.length; i += 10) {
        const gradeChunk = hodGrades.slice(i, i + 10);
        const snap = await getDocs(
          query(collection(db, "questionPapers"), where("grade", "in", gradeChunk))
        );
        snap.docs.forEach((d) => chunks.push({ id: d.id, ...d.data() } as QuestionPaperDoc));
      }
      /* Deduplicate: keep only the most-recently-submitted paper per
         (teacherId + subjectId + examType + grade) combination */
      const sorted = chunks
        .filter((p) => p.status !== "draft")
        .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt));

      const seen = new Set<string>();
      const deduped = sorted.filter((p) => {
        const key = `${p.teacherId}|${p.subjectId}|${p.examType}|${p.grade}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setPapers(deduped);
    } finally {
      setLoading(false);
    }
  }, [appUser]);

  useEffect(() => {
    loadPapers();
  }, [loadPapers]);

  const approve = async (paperId: string) => {
    setActioning(paperId);
    try {
      await updateDoc(doc(db, "questionPapers", paperId), {
        status: "hod_approved",
        hodNote: hodNote.trim() || null,
        approvedAt: new Date().toISOString(),
      });
      toast({ title: "Paper approved", description: "The teacher has been notified." });
      setHodNote("");
      setPreviewPaper(null);
      await loadPapers();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setActioning(null);
    }
  };

  const sendToPrinting = async (paperId: string) => {
    setActioning(paperId);
    try {
      await updateDoc(doc(db, "questionPapers", paperId), {
        status: "sent_to_printing",
        sentToPrintingAt: new Date().toISOString(),
      });
      toast({ title: "Sent to printing department", description: "The question paper has been forwarded." });
      setPreviewPaper(null);
      await loadPapers();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setActioning(null);
    }
  };

  const tabPapers = papers.filter((p) => p.status === activeTab);
  const pendingCount = papers.filter((p) => p.status === "submitted").length;

  /* ── Preview ── */
  if (previewPaper) {
    const isSubmitted = previewPaper.status === "submitted";
    const isApproved = previewPaper.status === "hod_approved";

    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setPreviewPaper(null); setHodNote(""); }}>
            <ChevronLeft size={16} /> Back
          </Button>
          <h1 className="text-xl font-bold flex-1">Question Paper Review</h1>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
            try {
              await generateQPPdf({
                examType: previewPaper.examType,
                grade: previewPaper.grade,
                subjectName: previewPaper.subjectName,
                teacherName: previewPaper.teacherName,
                totalMarks: previewPaper.totalMarks,
                instructions: previewPaper.instructions,
                sections: migrateToSections(previewPaper),
              });
            } catch {
              toast({ title: "PDF error", description: "Failed to generate PDF.", variant: "destructive" });
            }
          }}>
            <Download size={15} /> Download PDF
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Paper */}
          <div className="lg:col-span-2">
            <Card>
              <CardContent className="pt-6 pb-8">
                <div className="text-center mb-6 border-b pb-5">
                  <p className="font-bold text-xl">PRESTIGE INTERNATIONAL SCHOOL</p>
                  <p className="text-sm font-medium mt-1">{previewPaper.examType} — Grade {previewPaper.grade}</p>
                  <p className="text-sm text-muted-foreground">{previewPaper.subjectName}</p>
                  <div className="flex justify-center gap-5 text-xs text-muted-foreground mt-2">
                    <span>Total Marks: <strong>{previewPaper.totalMarks}</strong></span>
                    <span>Teacher: {previewPaper.teacherName}</span>
                  </div>
                </div>
                {previewPaper.instructions && (
                  <div className="mb-5 bg-muted/50 rounded-lg px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">General Instructions</p>
                    <p className="text-sm">{previewPaper.instructions}</p>
                  </div>
                )}
                {/* Sections rendering — handles both old (flat) and new (sections) format */}
                {(() => {
                  const secs = migrateToSections(previewPaper);
                  return secs.map((sec, secIdx) => (
                    <PreviewSection key={sec.id} sec={sec} secIdx={secIdx} />
                  ));
                })()}
              </CardContent>
            </Card>
          </div>

          {/* Actions Panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Paper Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Teacher</span><span className="font-medium">{previewPaper.teacherName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Grade</span><span className="font-medium">{previewPaper.grade}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Subject</span><span className="font-medium">{previewPaper.subjectName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Exam</span><span className="font-medium">{previewPaper.examType}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Sections</span><span className="font-medium">{migrateToSections(previewPaper).length}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Questions</span><span className="font-medium">{migrateToSections(previewPaper).reduce((t, s) => t + s.questions.length, 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total Marks</span><span className="font-medium">{previewPaper.totalMarks}</span></div>
                {previewPaper.submittedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Submitted</span>
                    <span className="font-medium text-xs">
                      {new Date(previewPaper.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                )}
                <div className="pt-1">
                  <span className={`text-xs px-2 py-1 rounded-full border font-medium ${STATUS_LABELS[previewPaper.status]?.color}`}>
                    {STATUS_LABELS[previewPaper.status]?.label}
                  </span>
                </div>
              </CardContent>
            </Card>

            {isSubmitted && (
              <Card className="border-blue-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-blue-700">Approve Paper</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Note to teacher (optional)</label>
                    <Input
                      placeholder="Add a review note..."
                      value={hodNote}
                      onChange={(e) => setHodNote(e.target.value)}
                    />
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => approve(previewPaper.id)}
                    disabled={actioning === previewPaper.id}
                  >
                    {actioning === previewPaper.id ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                    {actioning === previewPaper.id ? "Approving..." : "Approve Paper"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {isApproved && (
              <Card className="border-violet-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-violet-700">Send to Printing</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">
                    This will mark the paper as forwarded to the printing department.
                  </p>
                  <Button
                    className="w-full gap-2 bg-violet-600 hover:bg-violet-700"
                    onClick={() => sendToPrinting(previewPaper.id)}
                    disabled={actioning === previewPaper.id}
                  >
                    {actioning === previewPaper.id ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                    {actioning === previewPaper.id ? "Sending..." : "Send to Printing"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {previewPaper.hodNote && (
              <Card className="border-muted">
                <CardContent className="pt-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">HOD Note</p>
                  <p className="text-sm italic">"{previewPaper.hodNote}"</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── List View ── */
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold">Question Paper Approvals</h1>
          <p className="text-muted-foreground text-sm">Review and approve question papers from teachers</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={loadPapers} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-muted rounded-lg p-1">
        {TABS.map((t) => {
          const count = papers.filter((p) => p.status === t.key).length;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                activeTab === t.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                  activeTab === t.key
                    ? t.key === "submitted" ? "bg-blue-100 text-blue-700" : t.key === "hod_approved" ? "bg-green-100 text-green-700" : "bg-violet-100 text-violet-700"
                    : "bg-muted-foreground/20 text-muted-foreground"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : (appUser?.assignedGrades as string[] | undefined)?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle size={36} className="mx-auto mb-3 opacity-40" />
            <p className="font-semibold">No grades assigned</p>
            <p className="text-sm mt-1">Contact admin to assign grades to your account.</p>
          </CardContent>
        </Card>
      ) : tabPapers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText size={36} className="mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No papers here</p>
            <p className="text-sm mt-1">
              {activeTab === "submitted"
                ? "No question papers pending approval from teachers."
                : activeTab === "hod_approved"
                ? "No approved papers waiting to be sent to printing."
                : "No papers have been sent to printing yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tabPapers.map((paper) => {
            const st = STATUS_LABELS[paper.status];
            return (
              <Card key={paper.id} className={paper.status === "submitted" ? "border-blue-200" : ""}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        paper.status === "submitted" ? "bg-blue-100" : paper.status === "hod_approved" ? "bg-green-100" : "bg-violet-100"
                      }`}>
                        <FileText size={18} className={
                          paper.status === "submitted" ? "text-blue-500" : paper.status === "hod_approved" ? "text-green-500" : "text-violet-500"
                        } />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{paper.subjectName} — {paper.examType}</p>
                        <p className="text-xs text-muted-foreground">
                          Grade {paper.grade} · by {paper.teacherName} · {paper.questions.length} questions · {paper.totalMarks} marks
                        </p>
                        {paper.submittedAt && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Submitted {new Date(paper.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full border font-medium ${st.color}`}>
                        {st.label}
                      </span>
                      <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setPreviewPaper(paper)}>
                        <Eye size={13} />
                        {paper.status === "submitted" ? "Review" : paper.status === "hod_approved" ? "Send to Printing" : "View"}
                      </Button>
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

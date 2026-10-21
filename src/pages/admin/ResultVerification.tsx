import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import type { Section, Subject, ExamSchedule, Student, Enrollment } from "@/lib/types";
import {
  getActiveStructureForGrade,
  AcademicStructure,
  AcademicStructureVersion,
} from "@/lib/academicStructure";
import {
  fetchMarksEntriesForSection,
  transitionMarksWorkflow,
  publishExamResults,
  checkExamResultsCompleteness,
  MarksEntryRecord,
} from "@/lib/resultEngine";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  Lock,
  Send,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  FileSpreadsheet,
  Users,
  Award,
  RefreshCw,
} from "lucide-react";
import { PageSkeleton, TableSkeleton } from "@/components/common/Skeletons";

export default function ResultVerification() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "";

  // Academic contexts
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [approvedExams, setApprovedExams] = useState<ExamSchedule[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [structureInfo, setStructureInfo] = useState<{
    structure: AcademicStructure;
    version: AcademicStructureVersion;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [verifyingSubject, setVerifyingSubject] = useState<string | null>(null);

  // Status mapping per subject
  const [subjectStatuses, setSubjectStatuses] = useState<
    Record<string, { status: string; count: number; teacherName?: string }>
  >({});

  // Student list and their marks for the selected exam
  const [students, setStudents] = useState<any[]>([]);
  const [marksMap, setMarksMap] = useState<Record<string, Record<string, MarksEntryRecord>>>({});
  const [publicationRecord, setPublicationRecord] = useState<any | null>(null);

  // Load sections
  useEffect(() => {
    const loadSections = async () => {
      try {
        setLoading(true);
        const snap = await getDocs(collection(db, "sections"));
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
        list.sort((a, b) => (a.grade || "").localeCompare(b.grade || "") || a.name.localeCompare(b.name));
        setSections(list);
        if (list.length > 0) {
          setSelectedSectionId(list[0].id);
        }
      } catch (err) {
        console.error("Error loading sections:", err);
      } finally {
        setLoading(false);
      }
    };
    loadSections();
  }, []);

  const selectedSection = useMemo(() => {
    return sections.find((s) => s.id === selectedSectionId) || null;
  }, [sections, selectedSectionId]);

  // When selectedSection changes, load subjects, approved exams, and active academic structure
  useEffect(() => {
    if (!selectedSection) return;
    const loadCurriculum = async () => {
      try {
        const [subjSnap, examSnap, structRes] = await Promise.all([
          getDocs(query(collection(db, "subjects"), where("grade", "==", selectedSection.grade))),
          getDocs(
            query(
              collection(db, "examSchedules"),
              where("grade", "==", selectedSection.grade),
              where("status", "==", "approved")
            )
          ),
          getActiveStructureForGrade(selectedSection.grade, effectiveSessionId),
        ]);

        const subjs = subjSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Subject))
          .filter((s) => s.category !== "co-scholastic");
        setSubjects(subjs);

        const exams = examSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamSchedule));
        setApprovedExams(exams);
        setStructureInfo(structRes);

        if (exams.length > 0) {
          setSelectedExamId(exams[0].id);
        } else {
          setSelectedExamId("");
        }
      } catch (err) {
        console.error("Error loading curriculum:", err);
      }
    };
    loadCurriculum();
  }, [selectedSection, effectiveSessionId]);

  // Reload marks, enrollments, and check completeness whenever section or exam changes
  const reloadData = async () => {
    if (!selectedSectionId || !selectedExamId || subjects.length === 0) return;

    try {
      setLoading(true);

      // 1. Fetch publication record if already published
      const pubId = `${effectiveSessionId}_${selectedSectionId}_${selectedExamId}`;
      const pubDoc = await getDoc(doc(db, "examResultPublications", pubId));
      if (pubDoc.exists()) {
        setPublicationRecord(pubDoc.data());
      } else {
        setPublicationRecord(null);
      }

      // 2. Fetch marks for each subject in this exam
      const statusMap: Record<string, { status: string; count: number; teacherName?: string }> = {};
      const newMarksMap: Record<string, Record<string, MarksEntryRecord>> = {};

      for (const sub of subjects) {
        const entries = await fetchMarksEntriesForSection({
          sessionId: effectiveSessionId,
          sectionId: selectedSectionId,
          subjectId: sub.id,
          examId: selectedExamId,
        });

        const count = Object.keys(entries).length;
        const sample = Object.values(entries)[0];
        const st = sample ? sample.workflowStatus : "not_started";
        statusMap[sub.id] = { status: st, count };
        newMarksMap[sub.id] = entries;
      }

      setSubjectStatuses(statusMap);
      setMarksMap(newMarksMap);

      // 3. Load enrolled students
      const enrollSnap = await getDocs(
        query(
          collection(db, "enrollments"),
          where("sectionId", "==", selectedSectionId),
          where("status", "==", "active")
        )
      );

      const stuList: any[] = [];
      await Promise.all(
        enrollSnap.docs.map(async (enrDoc) => {
          const enr = enrDoc.data() as Enrollment;
          const stuDoc = await getDoc(doc(db, "students", enr.studentId));
          if (stuDoc.exists()) {
            stuList.push({
              enrollment: enr,
              student: { id: stuDoc.id, ...stuDoc.data() },
            });
          }
        })
      );
      stuList.sort((a, b) => (a.student.name || "").localeCompare(b.student.name || ""));
      setStudents(stuList);
    } catch (err) {
      console.error("Error checking exam status:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadData();
  }, [selectedSectionId, selectedExamId, subjects, effectiveSessionId]);

  // Current selected exam object
  const currentExam = useMemo(() => {
    return approvedExams.find((e) => e.id === selectedExamId) || null;
  }, [approvedExams, selectedExamId]);

  // Completeness check
  const completeness = useMemo(() => {
    if (subjects.length === 0 || students.length === 0) {
      return { ready: false, missingSubjects: [], isPublished: false };
    }

    const missing: string[] = [];
    let allPublished = true;

    for (const sub of subjects) {
      const st = subjectStatuses[sub.id]?.status || "not_started";
      const cnt = subjectStatuses[sub.id]?.count || 0;

      if (st === "not_started" || cnt === 0) {
        missing.push(`${sub.name} (Not started)`);
        allPublished = false;
      } else if (st === "draft") {
        missing.push(`${sub.name} (Draft - Pending submission by teacher)`);
        allPublished = false;
      } else if (st === "submitted") {
        allPublished = false;
      } else if (st !== "published" && st !== "locked") {
        allPublished = false;
      }
    }

    const isPublished = publicationRecord?.workflowStatus === "published" || allPublished;
    const ready = missing.length === 0;

    return { ready, missingSubjects: missing, isPublished };
  }, [subjects, students, subjectStatuses, publicationRecord]);

  // Action: Verify marks for a single subject
  const handleVerifySubject = async (subjectId: string) => {
    if (!appUser || !selectedSectionId || !selectedExamId) return;
    try {
      setVerifyingSubject(subjectId);
      const res = await transitionMarksWorkflow({
        sessionId: effectiveSessionId,
        sectionId: selectedSectionId,
        subjectId,
        examId: selectedExamId,
        targetStatus: "verified",
        user: { uid: appUser.id, name: appUser.name, role: appUser.role },
      });
      toast({
        title: "Subject Marks Verified",
        description: `Verified marks for ${res.count} student records.`,
      });
      setSubjectStatuses((prev) => ({
        ...prev,
        [subjectId]: { ...(prev[subjectId] || { count: 0 }), status: "verified" },
      }));
    } catch (err: any) {
      toast({ title: "Verification Failed", description: err.message, variant: "destructive" });
    } finally {
      setVerifyingSubject(null);
    }
  };

  // Action: HOD publishes the entire exam results for this section
  const handlePublishExamResults = async () => {
    if (!appUser || !selectedSection || !selectedExamId || !currentExam) return;
    if (!completeness.ready) {
      toast({
        title: "Cannot Publish Results",
        description: `Missing required marks: ${completeness.missingSubjects.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    try {
      setPublishing(true);
      const res = await publishExamResults({
        sessionId: effectiveSessionId,
        grade: selectedSection.grade,
        sectionId: selectedSection.id,
        examId: selectedExamId,
        examName: currentExam.examType || currentExam.id,
        user: { uid: appUser.id, name: appUser.name, role: appUser.role },
      });

      toast({
        title: "Exam Results Published",
        description: `Successfully published ${res.count} student results. They are now visible to authorized students & parents.`,
      });

      await reloadData();
    } catch (err: any) {
      toast({
        title: "Publication Failed",
        description: err.message || "An error occurred during result publication.",
        variant: "destructive",
      });
    } finally {
      setPublishing(false);
    }
  };

  if (loading && sections.length === 0) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/40">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-primary" />
            Exam Results & HOD Verification
          </h1>
          <p className="text-sm text-muted-foreground">
            Authoritative examination results review and publication workflow for Section Heads and Administrators.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={reloadData}
            disabled={loading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Selectors Card */}
      <Card className="border shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Section Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Class & Section</label>
              <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select section..." />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((sec) => (
                    <SelectItem key={sec.id} value={sec.id}>
                      Grade {sec.grade} - {sec.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Exam Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Scheduled Examination</label>
              <Select value={selectedExamId} onValueChange={setSelectedExamId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select exam..." />
                </SelectTrigger>
                <SelectContent>
                  {approvedExams.map((ex) => (
                    <SelectItem key={ex.id} value={ex.id}>
                      {ex.examType} ({ex.termId ? ex.termId.replace("_", " ").toUpperCase() : "Exam"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Context Stats */}
            <div className="space-y-1.5 flex flex-col justify-end">
              <div className="text-xs text-muted-foreground flex items-center justify-between bg-muted/30 p-2.5 rounded-lg border">
                <span>Enrolled Students: <strong>{students.length}</strong></span>
                <span>Subjects: <strong>{subjects.length}</strong></span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Completeness / Publication Status Banner */}
      <Card className={`border shadow-sm ${completeness.isPublished ? "bg-emerald-50/50 border-emerald-200" : completeness.ready ? "bg-blue-50/50 border-blue-200" : "bg-amber-50/50 border-amber-200"}`}>
        <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {completeness.isPublished ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span className="font-bold text-emerald-900 text-sm sm:text-base">Results Published</span>
                  <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">Published to Students</Badge>
                </>
              ) : completeness.ready ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-blue-600" />
                  <span className="font-bold text-blue-900 text-sm sm:text-base">All Subject Marks Entered & Ready</span>
                  <Badge className="bg-blue-600 text-white">Eligible for Publication</Badge>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  <span className="font-bold text-amber-900 text-sm sm:text-base">Incomplete Examination Marks</span>
                  <Badge variant="outline" className="text-amber-700 border-amber-300">Pending Teachers</Badge>
                </>
              )}
            </div>

            <p className="text-xs text-slate-600">
              {completeness.isPublished
                ? `Results for ${currentExam?.examType || "this exam"} were published on ${publicationRecord?.publishedAt ? new Date(publicationRecord.publishedAt).toLocaleDateString("en-IN") : "recently"} by ${publicationRecord?.publishedByName || "HOD"}.`
                : completeness.ready
                ? "All required teacher marks have been entered and verified. Head of Department can now publish the results."
                : `Missing required marks in: ${completeness.missingSubjects.join(", ")}`}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {completeness.isPublished ? (
              <Badge variant="secondary" className="px-3 py-1.5 flex items-center gap-1.5 text-xs bg-emerald-100 text-emerald-800">
                <Lock className="h-3.5 w-3.5" />
                Live in Student Results
              </Badge>
            ) : (
              <Button
                onClick={handlePublishExamResults}
                disabled={!completeness.ready || publishing}
                className="bg-primary hover:bg-primary/90 text-white font-semibold flex items-center gap-2"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish Exam Results
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Subject Status Grid */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3 border-b border-border/40 bg-muted/10">
          <CardTitle className="text-base font-bold flex items-center justify-between">
            <span>Subject Marks Submission Status</span>
            <span className="text-xs font-normal text-muted-foreground">
              {subjects.filter((s) => subjectStatuses[s.id]?.status === "verified" || subjectStatuses[s.id]?.status === "published").length} of {subjects.length} Verified
            </span>
          </CardTitle>
          <CardDescription className="text-xs">
            Review submission status per subject. Section Heads can verify marks individually before final publication.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="p-3 font-semibold text-slate-700">Subject</th>
                <th className="p-3 font-semibold text-slate-700">Max Marks</th>
                <th className="p-3 font-semibold text-slate-700">Entries</th>
                <th className="p-3 font-semibold text-slate-700">Workflow Status</th>
                <th className="p-3 font-semibold text-slate-700 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {subjects.map((sub) => {
                const info = subjectStatuses[sub.id] || { status: "not_started", count: 0 };
                const definedExams = structureInfo?.version.exams || structureInfo?.version.definedExams || [];
                const defExam = definedExams.find(
                  (e: any) => e.id === (currentExam as any)?.definedExamId || e.id === currentExam?.id
                );
                const subEntries = marksMap[sub.id] ? Object.values(marksMap[sub.id]) : [];
                const effectiveMax = subEntries[0]?.totalMaxMarks ?? defExam?.maxMarks ?? sub.maxMarks ?? 100;
                return (
                  <tr key={sub.id} className="hover:bg-muted/10 transition-colors">
                    <td className="p-3 font-medium text-slate-900">{sub.name}</td>
                    <td className="p-3 text-slate-600">{effectiveMax}</td>
                    <td className="p-3 text-slate-600">
                      <span className={info.count < students.length ? "text-amber-600 font-bold" : "text-emerald-700 font-bold"}>
                        {info.count} / {students.length} students
                      </span>
                    </td>
                    <td className="p-3">
                      {info.status === "published" ? (
                        <Badge className="bg-emerald-600 text-white">Published</Badge>
                      ) : info.status === "verified" ? (
                        <Badge className="bg-blue-600 text-white">Verified</Badge>
                      ) : info.status === "submitted" ? (
                        <Badge className="bg-amber-600 text-white">Submitted by Teacher</Badge>
                      ) : info.status === "draft" ? (
                        <Badge variant="outline" className="text-orange-600 border-orange-300">Draft (Unsubmitted)</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-slate-500">Not Started</Badge>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {info.status === "submitted" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleVerifySubject(sub.id)}
                          disabled={verifyingSubject === sub.id}
                          className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                        >
                          {verifyingSubject === sub.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                          Verify
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Student Marks Summary Table */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3 border-b border-border/40 bg-muted/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Student Marks Roster — {currentExam?.examType || "Selected Exam"}
            </CardTitle>
            <CardDescription className="text-xs">
              Complete student breakdown for Grade {selectedSection?.grade} - {selectedSection?.name}.
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit text-xs">
            {students.length} Students Enrolled
          </Badge>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {students.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No active student enrollments found for this section.
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="p-3 font-semibold text-slate-700 sticky left-0 bg-background/95 backdrop-blur-xs">Student</th>
                  <th className="p-3 font-semibold text-slate-700">Roll No</th>
                  {subjects.map((sub) => (
                    <th key={sub.id} className="p-3 font-semibold text-slate-700 text-center">
                      {sub.name}
                    </th>
                  ))}
                  <th className="p-3 font-semibold text-slate-700 text-center">Total</th>
                  <th className="p-3 font-semibold text-slate-700 text-center">%</th>
                  <th className="p-3 font-semibold text-slate-700 text-center">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {students.map((item) => {
                  const stu = item.student as Student;
                  const stuUid = stu.studentUid || stu.admissionNo || stu.id;

                  let totalEarned = 0;
                  let totalMax = 0;
                  let hasAnyMarks = false;

                  return (
                    <tr key={stu.id} className="hover:bg-muted/10 transition-colors">
                      <td className="p-3 font-medium text-slate-900 sticky left-0 bg-background/95 backdrop-blur-xs">
                        <div className="flex flex-col">
                          <span>{stu.name}</span>
                          <span className="text-[10px] text-muted-foreground">{stu.admissionNo || stu.id}</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-600">{stu.rollNo || "—"}</td>
                      {subjects.map((sub) => {
                        const rec = marksMap[sub.id]?.[stuUid] || marksMap[sub.id]?.[stu.id];
                        if (rec) {
                          hasAnyMarks = true;
                          const score = rec.scaledTotalMarks ?? rec.totalRawMarks;
                          const isExemptOptional = Boolean((sub.isOptional || rec.isOptional) && rec.isExempt);
                          if (!isExemptOptional) {
                            totalEarned += score;
                            totalMax += rec.totalMaxMarks;
                          }
                          return (
                            <td key={sub.id} className="p-3 text-center">
                              {rec.isAbsent ? (
                                <Badge variant="outline" className="text-rose-600 border-rose-300 text-[10px] px-1 py-0">AB</Badge>
                              ) : rec.isExempt ? (
                                <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px] px-1 py-0">EX</Badge>
                              ) : (
                                <span className="font-semibold text-slate-800">{Math.round(score)}</span>
                              )}
                            </td>
                          );
                        }
                        return (
                          <td key={sub.id} className="p-3 text-center text-slate-400">
                            —
                          </td>
                        );
                      })}
                      <td className="p-3 text-center font-bold text-slate-900">
                        {hasAnyMarks ? (totalMax > 0 ? Math.round(totalEarned) : "EX") : "—"}
                      </td>
                      <td className="p-3 text-center font-semibold text-slate-800">
                        {hasAnyMarks ? (totalMax > 0 ? `${((totalEarned / totalMax) * 100).toFixed(1)}%` : "EX") : "—"}
                      </td>
                      <td className="p-3 text-center">
                        {hasAnyMarks ? (
                          totalMax > 0 ? (
                            <Badge variant="outline" className="text-primary font-bold">
                              {totalEarned / totalMax >= 0.8 ? "A" : totalEarned / totalMax >= 0.6 ? "B" : totalEarned / totalMax >= 0.4 ? "C" : "D"}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 font-bold">
                              EX
                            </Badge>
                          )
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

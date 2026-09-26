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
  setDoc,
  writeBatch,
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
  evaluateInstitutionalResult,
  PublishedReportCardSnapshot,
  CalculatedSubjectResult,
} from "@/lib/resultEngine";
import { generateReportCardPdf } from "@/lib/generateReportCardPdf";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  Download,
  Eye,
  FileSpreadsheet,
  AlertTriangle,
  Loader2,
  Printer,
  ShieldCheck,
} from "lucide-react";

export default function ResultVerification() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "";
  const effectiveSessionName = workingSession?.name || activeSession?.name || "2026-27";

  const [selectedPeriod, setSelectedPeriod] = useState<"term_1" | "term_2" | "annual">("term_1");
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
  const [subjectStatuses, setSubjectStatuses] = useState<
    Record<string, { status: string; count: number; teacherName?: string }>
  >({});

  const [students, setStudents] = useState<any[]>([]);

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

  // When selectedSection changes, load subjects, approved exams, and active structure
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
      } catch (err) {
        console.error("Error loading curriculum:", err);
      }
    };
    loadCurriculum();
  }, [selectedSection, effectiveSessionId]);

  const filteredApprovedExams = useMemo(() => {
    return approvedExams.filter((ex) => {
      if (selectedPeriod === "annual") return true;
      if (ex.termId) return ex.termId === selectedPeriod;
      if (selectedPeriod === "term_1") {
        return !ex.examType.toLowerCase().includes("term 2") && !ex.examType.toLowerCase().includes("annual");
      }
      if (selectedPeriod === "term_2") {
        return ex.examType.toLowerCase().includes("term 2") || ex.examType.toLowerCase().includes("annual");
      }
      return true;
    });
  }, [approvedExams, selectedPeriod]);

  useEffect(() => {
    if (filteredApprovedExams.length > 0) {
      const exists = filteredApprovedExams.some((ex) => ex.id === selectedExamId);
      if (!exists) {
        setSelectedExamId(filteredApprovedExams[0].id);
      }
    } else {
      setSelectedExamId("");
    }
  }, [filteredApprovedExams, selectedExamId]);

  // Load subject status map and enrollments
  useEffect(() => {
    if (!selectedSectionId || (!selectedExamId && selectedPeriod !== "annual") || subjects.length === 0) return;

    const checkStatuses = async () => {
      try {
        const statusMap: Record<string, { status: string; count: number }> = {};

        for (const sub of subjects) {
          const entries = await fetchMarksEntriesForSection({
            sessionId: effectiveSessionId,
            sectionId: selectedSectionId,
            subjectId: sub.id,
            termId: selectedPeriod !== "annual" ? selectedPeriod : undefined,
            examId: selectedExamId || undefined,
          });

          const count = Object.keys(entries).length;
          const sample = Object.values(entries)[0];
          const st = sample ? sample.workflowStatus : "not_started";
          statusMap[sub.id] = { status: st, count };
        }

        setSubjectStatuses(statusMap);

        // Load students in section
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
        console.error("Error checking subject statuses:", err);
      }
    };

    checkStatuses();
  }, [selectedSectionId, selectedPeriod, selectedExamId, subjects, effectiveSessionId]);

  // Action: Verify marks for a single subject
  const handleVerifySubject = async (subjectId: string) => {
    if (!appUser || !selectedSectionId || !selectedExamId) return;
    try {
      const res = await transitionMarksWorkflow({
        sessionId: effectiveSessionId,
        sectionId: selectedSectionId,
        subjectId,
        termId: selectedPeriod !== "annual" ? selectedPeriod : undefined,
        examId: selectedExamId,
        targetStatus: "verified",
        user: { uid: appUser.id, name: appUser.name, role: appUser.role },
      });
      toast({
        title: "Marks Verified",
        description: `Successfully verified marks for ${res.count} student records.`,
      });
      setSubjectStatuses((prev) => ({
        ...prev,
        [subjectId]: { ...(prev[subjectId] || { count: 0 }), status: "verified" },
      }));
    } catch (err: any) {
      toast({ title: "Verification Failed", description: err.message, variant: "destructive" });
    }
  };

  // Action: Publish all results & generate immutable publishedReportCards snapshots
  const handlePublishResults = async () => {
    if (!appUser || !selectedSection || !structureInfo) return;
    try {
      setPublishing(true);

      const batch = writeBatch(db);
      const now = new Date().toISOString();
      const calcCfg = structureInfo.version.calculationConfig || {
        roundingRule: "round_nearest",
        decimalPlaces: 1,
        termAggregation: "weighted_average",
        termWeights: { term_1: 50, term_2: 50 },
        institutionalPassingRules: { minScholasticPercentage: 33, minAttendancePercentage: 75, compartmentAllowed: true, maxCompartmentSubjects: 2 },
      };

      // Precompute ranks across section students
      const studentTotals = students.map((item) => {
        const stu = item.student as Student;
        const canonicalUid = stu.studentUid || stu.admissionNo || stu.id;
        const row = verificationRows.find((r) => r.studentId === stu.id || r.studentUid === canonicalUid);
        return {
          id: stu.id,
          canonicalUid,
          grandTotal: row?.grandTotal || 0,
        };
      });
      studentTotals.sort((a, b) => b.grandTotal - a.grandTotal);
      const rankMap = new Map<string, number>();
      studentTotals.forEach((s, idx) => {
        rankMap.set(s.canonicalUid, idx + 1);
        rankMap.set(s.id, idx + 1);
      });

      for (const item of students) {
        const stu = item.student as Student;
        const enr = item.enrollment as Enrollment;
        const canonicalUid = stu.studentUid || stu.admissionNo || stu.id;

        // Fetch scholastic results for all subjects for this student
        const scholasticResults: CalculatedSubjectResult[] = [];

        for (const sub of subjects) {
          if (selectedPeriod === "term_1" || selectedPeriod === "term_2") {
            // Term 1 or Term 2 calculation
            let entryId = `${effectiveSessionId}_${selectedSection.grade}_${selectedSection.id}_${sub.id}_${selectedPeriod}_${selectedExamId}_${canonicalUid}`;
            let mDoc = await getDoc(doc(db, "marksEntries", entryId));
            if (!mDoc.exists()) {
              entryId = `${effectiveSessionId}_${selectedSection.grade}_${selectedSection.id}_${sub.id}_${selectedExamId}_${canonicalUid}`;
              mDoc = await getDoc(doc(db, "marksEntries", entryId));
            }
            const mData = mDoc.data();

            const total = mData?.scaledTotalMarks ?? mData?.totalRawMarks ?? 0;
            const max = mData?.totalMaxMarks || 100;
            const pct = max > 0 ? Math.round((total / max) * 100) : 0;
            const grd = mData?.calculatedGrade || "A1";

            const comps: Record<string, number> = {};
            if (mData?.componentMarks) {
              for (const [k, v] of Object.entries(mData.componentMarks as Record<string, any>)) {
                if (v && v.marks != null) comps[k] = v.marks;
              }
            }

            scholasticResults.push({
              subjectId: sub.id,
              subjectName: sub.name,
              category: "scholastic",
              overallTotal: total,
              overallMax: max,
              overallPercentage: pct,
              overallGrade: grd,
              components: comps,
              [selectedPeriod === "term_1" ? "term1" : "term2"]: {
                scaledTotal: total,
                maxMarks: max,
                percentage: pct,
                grade: grd,
                components: comps,
              },
            });
          } else {
            // Annual aggregation: query both Term 1 and Term 2 marks
            const t1Snap = await getDocs(
              query(
                collection(db, "marksEntries"),
                where("sessionId", "==", effectiveSessionId),
                where("sectionId", "==", selectedSection.id),
                where("subjectId", "==", sub.id),
                where("studentUid", "==", canonicalUid),
                where("termId", "==", "term_1")
              )
            );
            const t2Snap = await getDocs(
              query(
                collection(db, "marksEntries"),
                where("sessionId", "==", effectiveSessionId),
                where("sectionId", "==", selectedSection.id),
                where("subjectId", "==", sub.id),
                where("studentUid", "==", canonicalUid),
                where("termId", "==", "term_2")
              )
            );

            let t1Total = 0;
            let t1Max = 100;
            let t1Grd = "—";
            let t1Comps: Record<string, number> = {};

            if (!t1Snap.empty) {
              const d = t1Snap.docs[0].data();
              t1Total = d.scaledTotalMarks ?? d.totalRawMarks ?? 0;
              t1Max = d.totalMaxMarks || 100;
              t1Grd = d.calculatedGrade || "A1";
              if (d.componentMarks) {
                for (const [k, v] of Object.entries(d.componentMarks as Record<string, any>)) {
                  if (v && v.marks != null) t1Comps[k] = v.marks;
                }
              }
            }

            let t2Total = 0;
            let t2Max = 100;
            let t2Grd = "—";
            let t2Comps: Record<string, number> = {};

            if (!t2Snap.empty) {
              const d = t2Snap.docs[0].data();
              t2Total = d.scaledTotalMarks ?? d.totalRawMarks ?? 0;
              t2Max = d.totalMaxMarks || 100;
              t2Grd = d.calculatedGrade || "A1";
              if (d.componentMarks) {
                for (const [k, v] of Object.entries(d.componentMarks as Record<string, any>)) {
                  if (v && v.marks != null) t2Comps[k] = v.marks;
                }
              }
            }

            const w1 = calcCfg.termWeights?.term_1 ?? 50;
            const w2 = calcCfg.termWeights?.term_2 ?? 50;
            const overallEarned = Math.round((t1Total * w1 + t2Total * w2) / 100);
            const overallPct = overallEarned;
            const overallGrd = overallPct >= 91 ? "A1" : overallPct >= 81 ? "A2" : overallPct >= 71 ? "B1" : overallPct >= 61 ? "B2" : overallPct >= 51 ? "C1" : overallPct >= 41 ? "C2" : overallPct >= 33 ? "D" : "E";

            scholasticResults.push({
              subjectId: sub.id,
              subjectName: sub.name,
              category: "scholastic",
              overallTotal: overallEarned,
              overallMax: 100,
              overallPercentage: overallPct,
              overallGrade: overallGrd,
              term1: {
                scaledTotal: t1Total,
                maxMarks: t1Max,
                percentage: t1Max > 0 ? Math.round((t1Total / t1Max) * 100) : 0,
                grade: t1Grd,
                components: t1Comps,
              },
              term2: {
                scaledTotal: t2Total,
                maxMarks: t2Max,
                percentage: t2Max > 0 ? Math.round((t2Total / t2Max) * 100) : 0,
                grade: t2Grd,
                components: t2Comps,
              },
            });
          }
        }

        const passScale = structureInfo.version.gradingScale;
        const instResult = evaluateInstitutionalResult({
          scholasticResults: scholasticResults.map((r) => ({
            overallTotal: r.overallTotal,
            overallMax: r.overallMax,
            overallPercentage: r.overallPercentage,
            isPassed: r.overallPercentage >= (structureInfo.version.calculationConfig?.institutionalPassingRules?.minScholasticPercentage ?? passScale.passingPercentage),
          })),
          calculationConfig: calcCfg,
          gradingScale: passScale,
        });

        const periodPrefix = selectedPeriod === "annual" ? "annual" : selectedPeriod;
        const snapshotDocId = `${effectiveSessionId}_${periodPrefix}_${canonicalUid}`;
        const stuRank = rankMap.get(canonicalUid) || rankMap.get(stu.id) || 1;

        // Build co-scholastic grades based on active structure's coScholasticConfig if present
        const coScholasticMap: Record<string, { term1?: string; term2?: string }> = {};
        if (structureInfo.version.coScholasticConfig?.areas) {
          structureInfo.version.coScholasticConfig.areas.forEach((a) => {
            coScholasticMap[a.id] = { term1: "A", term2: "A" };
            coScholasticMap[a.name] = { term1: "A", term2: "A" };
          });
        }

        const snapshot: PublishedReportCardSnapshot = {
          id: snapshotDocId,
          sessionId: effectiveSessionId,
          academicYear: effectiveSessionName,
          reportPeriod: selectedPeriod,
          periodTotal: instResult.grandTotal,
          periodMax: instResult.grandMax,
          periodPercentage: instResult.grandPercentage,
          periodGrade: instResult.grandGrade,
          studentUid: canonicalUid,
          studentDocId: stu.id,
          studentId: canonicalUid,
          studentName: stu.name,
          admissionNo: stu.admissionNo || "",
          rollNo: enr.rollNo || stu.rollNo || "01",
          grade: selectedSection.grade,
          sectionId: selectedSection.id,
          sectionName: selectedSection.name,
          fatherName: stu.fatherName || "",
          motherName: stu.motherName || "",
          dob: stu.DOB || "",
          address: stu.address || "",
          structureId: structureInfo.structure.id,
          structureVersionNumber: structureInfo.version.versionNumber,
          structureName: structureInfo.structure.name,
          layoutConfig: structureInfo.version.reportCardLayout,
          scholasticTableConfig: structureInfo.version.scholasticTableConfig,
          coScholasticConfig: structureInfo.version.coScholasticConfig,
          rank: stuRank,
          scholasticResults: scholasticResults.map((r) => ({ ...r, rank: stuRank })),
          coScholasticGrades: Object.keys(coScholasticMap).length > 0 ? coScholasticMap : {
            "Work Education": { term1: "A", term2: "A" },
            "Art Education": { term1: "A", term2: "A" },
            "Health & Physical Education": { term1: "A", term2: "A" },
          },
          disciplineGrades: {
            Discipline: { term1: "A", term2: "A" },
          },
          grandTotal: instResult.grandTotal,
          grandMax: instResult.grandMax,
          grandPercentage: instResult.grandPercentage,
          grandGrade: instResult.grandGrade,
          resultStatus: instResult.resultStatus,
          promotedToGrade: selectedPeriod === "annual" && instResult.resultStatus === "PASSED" ? `Grade ${Number(selectedSection.grade) + 1}` : undefined,
          teacherRemarks: selectedPeriod === "annual"
            ? "Outstanding academic performance and good conduct throughout the session."
            : `Commendable performance in ${selectedPeriod === "term_1" ? "Term 1" : "Term 2"} evaluations.`,
          publishedAt: now,
          publishedBy: appUser.id,
          signatures: {
            classTeacher: { name: appUser.name, signedAt: now },
            principal: { name: "Principal", signedAt: now },
          },
        };

        batch.set(doc(db, "publishedReportCards", snapshotDocId), snapshot);
        if (selectedPeriod === "annual") {
          // Backward-compatibility document id without period suffix
          batch.set(doc(db, "publishedReportCards", `${effectiveSessionId}_${canonicalUid}`), snapshot);
        }
      }

      await batch.commit();

      // Transition marks workflow to published if an exam is selected
      if (selectedExamId) {
        for (const sub of subjects) {
          await transitionMarksWorkflow({
            sessionId: effectiveSessionId,
            sectionId: selectedSection.id,
            subjectId: sub.id,
            termId: selectedPeriod !== "annual" ? selectedPeriod : undefined,
            examId: selectedExamId,
            targetStatus: "published",
            user: { uid: appUser.id, name: appUser.name, role: appUser.role },
          });
        }
      }

      toast({
        title: `${selectedPeriod === "annual" ? "Annual" : selectedPeriod === "term_1" ? "Term 1" : "Term 2"} Results Published`,
        description: `Published results and generated official report cards for ${students.length} students.`,
      });
    } catch (err: any) {
      console.error("Publish results failed:", err);
      toast({ title: "Publish Failed", description: err.message, variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  // Action: Print / Download PDF Report Card for single student
  const handleDownloadPdf = async (stu: Student, enr: Enrollment) => {
    if (!selectedSection || !structureInfo) return;
    try {
      const canonicalUid = stu.studentUid || stu.admissionNo || stu.id;
      const periodPrefix = selectedPeriod === "annual" ? "annual" : selectedPeriod;
      let snapDoc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_${periodPrefix}_${canonicalUid}`));
      if (!snapDoc.exists() && selectedPeriod === "annual") {
        snapDoc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_${canonicalUid}`));
      }
      let snapshotData: PublishedReportCardSnapshot;

      if (snapDoc.exists()) {
        snapshotData = snapDoc.data() as PublishedReportCardSnapshot;
      } else {
        // Build ad-hoc snapshot for preview
        snapshotData = {
          id: `${effectiveSessionId}_${periodPrefix}_${canonicalUid}`,
          sessionId: effectiveSessionId,
          academicYear: effectiveSessionName,
          reportPeriod: selectedPeriod,
          studentUid: canonicalUid,
          studentDocId: stu.id,
          studentId: canonicalUid,
          studentName: stu.name,
          admissionNo: stu.admissionNo || "PIS/2026/001",
          rollNo: enr.rollNo || stu.rollNo || "01",
          grade: selectedSection.grade,
          sectionId: selectedSection.id,
          sectionName: selectedSection.name,
          fatherName: stu.fatherName || "",
          motherName: stu.motherName || "",
          dob: stu.DOB || "",
          address: stu.address || "",
          structureId: structureInfo.structure.id,
          structureVersionNumber: structureInfo.version.versionNumber,
          structureName: structureInfo.structure.name,
          layoutConfig: structureInfo.version.reportCardLayout,
          scholasticResults: [],
          coScholasticGrades: {},
          disciplineGrades: {},
          grandTotal: 440,
          grandMax: 500,
          grandPercentage: 88,
          grandGrade: "A2",
          resultStatus: "PASSED",
          publishedAt: new Date().toISOString(),
          publishedBy: appUser?.id || "admin",
          signatures: {},
        };
      }

      await generateReportCardPdf(snapshotData, structureInfo.version.gradingScale);
      toast({
        title: "PDF Generated",
        description: `Downloaded ${selectedPeriod === "annual" ? "Annual" : selectedPeriod === "term_2" ? "Term 2" : "Term 1"} report card for ${stu.name}.`,
      });
    } catch (err: any) {
      console.error("PDF generation failed:", err);
      toast({ title: "PDF Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div data-testid="result-verification" className="space-y-6">
      {/* Banner */}
      <div className="gradient-banner rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-blue-500/20 text-blue-200 border border-blue-400/30">
            Session: {effectiveSessionName}
          </span>
          {structureInfo && (
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
              Governed by: {structureInfo.structure.name} (v{structureInfo.version.versionNumber})
            </span>
          )}
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Academic Results & Verification</h1>
        <p className="mt-1 text-sm text-slate-300">
          Verify teacher marks submissions, publish section results, and generate formal A4 printable report cards.
        </p>
      </div>

      {/* Selectors */}
      <div className="glass-card-strong rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/40">
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evaluation Period</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Select single term or annual consolidated report</p>
          </div>
          <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-xl border">
            <Button
              type="button"
              size="sm"
              variant={selectedPeriod === "term_1" ? "default" : "ghost"}
              onClick={() => setSelectedPeriod("term_1")}
              className="h-7 text-xs font-medium px-3"
            >
              Term 1
            </Button>
            <Button
              type="button"
              size="sm"
              variant={selectedPeriod === "term_2" ? "default" : "ghost"}
              onClick={() => setSelectedPeriod("term_2")}
              className="h-7 text-xs font-medium px-3"
            >
              Term 2
            </Button>
            <Button
              type="button"
              size="sm"
              variant={selectedPeriod === "annual" ? "default" : "ghost"}
              onClick={() => setSelectedPeriod("annual")}
              className="h-7 text-xs font-medium px-3"
            >
              Annual Overall
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-semibold">Class & Section</Label>
            <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
              <SelectTrigger className="mt-1 bg-background text-xs">
                <SelectValue placeholder="Select section..." />
              </SelectTrigger>
              <SelectContent>
                {sections.map((sec) => (
                  <SelectItem key={sec.id} value={sec.id} className="text-xs">
                    Grade {sec.grade} - {sec.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-semibold">Scheduled Examination</Label>
            <Select value={selectedExamId} onValueChange={setSelectedExamId}>
              <SelectTrigger className="mt-1 bg-background text-xs">
                <SelectValue placeholder="Select exam..." />
              </SelectTrigger>
              <SelectContent>
                {filteredApprovedExams.map((ex) => (
                  <SelectItem key={ex.id} value={ex.id} className="text-xs">
                    {ex.examType} {ex.termName ? `(${ex.termName})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Subjects Submission Matrix */}
      <Card className="rounded-2xl border shadow-sm">
        <CardHeader className="pb-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">
              Subject Marks Submission Status ({selectedPeriod === "annual" ? "Annual" : selectedPeriod === "term_1" ? "Term 1" : "Term 2"})
            </CardTitle>
            <CardDescription className="text-xs">
              Review teacher submission status across subjects before publishing official report cards.
            </CardDescription>
          </div>
          <Button
            onClick={handlePublishResults}
            disabled={publishing || students.length === 0}
            className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {publishing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Publish {selectedPeriod === "annual" ? "Annual" : selectedPeriod === "term_1" ? "Term 1" : "Term 2"} Results & Cards
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b text-muted-foreground font-semibold">
                <th className="py-3 px-4">Subject</th>
                <th className="py-3 px-4">Student Records</th>
                <th className="py-3 px-4">Workflow Status</th>
                <th className="py-3 px-4 text-right">Verification Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subjects.map((sub) => {
                const info = subjectStatuses[sub.id] || { status: "not_started", count: 0 };
                return (
                  <tr key={sub.id} className="hover:bg-muted/10 transition-colors">
                    <td className="py-3 px-4 font-medium">{sub.name}</td>
                    <td className="py-3 px-4 text-muted-foreground">{info.count} recorded</td>
                    <td className="py-3 px-4">
                      <Badge
                        variant={
                          info.status === "published"
                            ? "default"
                            : info.status === "verified"
                            ? "secondary"
                            : "outline"
                        }
                        className="text-[10px] uppercase font-bold py-0.5 px-2"
                      >
                        {info.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {info.status === "submitted" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleVerifySubject(sub.id)}
                          className="h-7 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                        >
                          <CheckCircle2 size={13} /> Verify Marks
                        </Button>
                      )}
                      {info.status === "verified" && (
                        <span className="text-[11px] text-emerald-600 font-medium">Ready to Publish</span>
                      )}
                      {info.status === "published" && (
                        <span className="text-[11px] text-muted-foreground font-mono">Published</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Student List & Report Cards */}
      <Card className="rounded-2xl border shadow-sm">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base font-semibold">Student Official Report Cards</CardTitle>
          <CardDescription className="text-xs">
            Generate and print individual CBSE formal A4 report cards.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b text-muted-foreground font-semibold">
                <th className="py-3 px-3 w-12 text-center">Roll</th>
                <th className="py-3 px-4">Student Name</th>
                <th className="py-3 px-4">Admission No</th>
                <th className="py-3 px-4 text-right">Print Report Card</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {students.map((item, idx) => (
                <tr key={item.student.id} className="hover:bg-muted/10 transition-colors">
                  <td className="py-2.5 px-3 text-center font-mono text-muted-foreground">
                    {item.enrollment?.rollNo || idx + 1}
                  </td>
                  <td className="py-2.5 px-4 font-medium">{item.student.name}</td>
                  <td className="py-2.5 px-4 text-muted-foreground">{item.student.admissionNo || "—"}</td>
                  <td className="py-2.5 px-4 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadPdf(item.student, item.enrollment)}
                      className="h-7 text-xs gap-1.5"
                    >
                      <Download size={13} /> Download {selectedPeriod === "annual" ? "Annual" : selectedPeriod === "term_1" ? "Term 1" : "Term 2"} PDF
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

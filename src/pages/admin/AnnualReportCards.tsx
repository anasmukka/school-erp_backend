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
} from "firebase/firestore";
import type { Section, Subject, ExamSchedule, Student, Enrollment, DisciplineGrade } from "@/lib/types";
import {
  getActiveStructureForGrade,
  AcademicStructure,
  AcademicStructureVersion,
  DEFAULT_SCHOLASTIC_TABLE_CONFIG,
  DEFAULT_CO_SCHOLASTIC_CONFIG,
} from "@/lib/academicStructure";
import {
  fetchMarksEntriesForSection,
  saveClassTeacherPendingDetails,
  signReportCardSequential,
  PublishedReportCardSnapshot,
  CalculatedSubjectResult,
  evaluateInstitutionalResult,
  calculateSubjectTermAndOverall,
  VALID_DISCIPLINE_GRADES,
} from "@/lib/resultEngine";
import { generateReportCardPdf } from "@/lib/generateReportCardPdf";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Award,
  CheckCircle2,
  Lock,
  Download,
  AlertTriangle,
  Loader2,
  FileSignature,
  FileSpreadsheet,
  Users,
  Edit,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { PageSkeleton, TableSkeleton } from "@/components/common/Skeletons";

export default function AnnualReportCards() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "";

  // Academic Context
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [structureInfo, setStructureInfo] = useState<{
    structure: AcademicStructure;
    version: AcademicStructureVersion;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [signingStudent, setSigningStudent] = useState<string | null>(null);

  // Student list and data
  const [students, setStudents] = useState<any[]>([]);
  const [snapshotsMap, setSnapshotsMap] = useState<Record<string, PublishedReportCardSnapshot>>({});
  const [pendingDetailsMap, setPendingDetailsMap] = useState<Record<string, any>>({});

  // Class Teacher Pending Details Dialogue Modal State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeStudent, setActiveStudent] = useState<any | null>(null);
  const [formDisciplineT1, setFormDisciplineT1] = useState<DisciplineGrade>("A");
  const [formDisciplineT2, setFormDisciplineT2] = useState<DisciplineGrade>("A");
  const [formWorkEd, setFormWorkEd] = useState("A");
  const [formArtEd, setFormArtEd] = useState("A");
  const [formHealthPE, setFormHealthPE] = useState("A");
  const [formTeacherRemarks, setFormTeacherRemarks] = useState("");
  const [formPromotedTo, setFormPromotedTo] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);

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

  // Load curriculum and academic structure when section changes
  useEffect(() => {
    if (!selectedSection) return;
    const loadCurriculum = async () => {
      try {
        const [subjSnap, structRes] = await Promise.all([
          getDocs(query(collection(db, "subjects"), where("grade", "==", selectedSection.grade))),
          getActiveStructureForGrade(selectedSection.grade, effectiveSessionId),
        ]);

        const subjs = subjSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Subject))
          .filter((s) => s.category !== "co-scholastic");
        setSubjects(subjs);
        setStructureInfo(structRes);
      } catch (err) {
        console.error("Error loading curriculum:", err);
      }
    };
    loadCurriculum();
  }, [selectedSection, effectiveSessionId]);

  // Load students, report card snapshots, and pending details
  const reloadData = async () => {
    if (!selectedSectionId) return;

    try {
      setLoading(true);

      // 1. Fetch active enrollments
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

      // 2. Fetch published or draft report card snapshots
      const snapMap: Record<string, PublishedReportCardSnapshot> = {};
      const pendMap: Record<string, any> = {};

      await Promise.all(
        stuList.map(async (item) => {
          const stu = item.student as Student;
          const stuUid = stu.studentUid || stu.admissionNo || stu.id;

          // Fetch card snapshot
          const cardDoc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_annual_${stuUid}`));
          if (cardDoc.exists()) {
            snapMap[stuUid] = { id: cardDoc.id, ...cardDoc.data() } as PublishedReportCardSnapshot;
          }

          // Fetch pending details
          const detailDoc = await getDoc(doc(db, "reportCardPendingDetails", `${effectiveSessionId}_${selectedSectionId}_${stuUid}`));
          if (detailDoc.exists()) {
            pendMap[stuUid] = detailDoc.data();
          }
        })
      );

      setSnapshotsMap(snapMap);
      setPendingDetailsMap(pendMap);
    } catch (err) {
      console.error("Error loading report cards data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadData();
  }, [selectedSectionId, effectiveSessionId]);

  // Open Pending Details Dialog
  const handleOpenPendingDetails = (item: any) => {
    const stu = item.student as Student;
    const stuUid = stu.studentUid || stu.admissionNo || stu.id;
    setActiveStudent(item);

    const pending = pendingDetailsMap[stuUid] || {};
    const existingSnap = snapshotsMap[stuUid];

    // Read existing discipline
    const disc = pending.disciplineGrades || existingSnap?.disciplineGrades || {};
    const d1 = (disc as any).term_1 || (disc as any).term1 || "A";
    const d2 = (disc as any).term_2 || (disc as any).term2 || "A";
    setFormDisciplineT1(VALID_DISCIPLINE_GRADES.includes(d1 as any) ? d1 : "A");
    setFormDisciplineT2(VALID_DISCIPLINE_GRADES.includes(d2 as any) ? d2 : "A");

    // Read co-scholastic
    const co = pending.coScholasticGrades || existingSnap?.coScholasticGrades || {};
    setFormWorkEd((co as any)?.workEd || "A");
    setFormArtEd((co as any)?.artEd || "A");
    setFormHealthPE((co as any)?.healthPE || "A");

    // Remarks and Promoted
    setFormTeacherRemarks(pending.teacherRemarks || existingSnap?.teacherRemarks || "Consistent academic performance, commendable discipline, and active classroom participation.");
    setFormPromotedTo(pending.promotedToGrade || existingSnap?.promotedToGrade || (selectedSection ? `Grade ${Number(selectedSection.grade) + 1}` : ""));

    setDialogOpen(true);
  };

  // Save Pending Details
  const handleSavePendingDetails = async () => {
    if (!appUser || !activeStudent || !selectedSection) return;
    const stu = activeStudent.student as Student;
    const stuUid = stu.studentUid || stu.admissionNo || stu.id;

    try {
      setSavingDetails(true);

      await saveClassTeacherPendingDetails({
        sessionId: effectiveSessionId,
        sectionId: selectedSection.id,
        studentUid: stuUid,
        disciplineGrades: {
          term_1: formDisciplineT1,
          term_2: formDisciplineT2,
        },
        coScholasticGrades: {
          workEd: formWorkEd,
          artEd: formArtEd,
          healthPE: formHealthPE,
          "Work Education": { term_1: formWorkEd, term_2: formWorkEd },
          "Art Education": { term_1: formArtEd, term_2: formArtEd },
          "Health & Physical Education": { term_1: formHealthPE, term_2: formHealthPE },
        },
        teacherRemarks: formTeacherRemarks,
        promotedToGrade: formPromotedTo,
        user: { uid: appUser.id, name: appUser.name, role: appUser.role },
      });

      toast({
        title: "Details Saved",
        description: `Successfully saved discipline and co-scholastic details for ${stu.name}.`,
      });

      setDialogOpen(false);
      await reloadData();
    } catch (err: any) {
      toast({
        title: "Failed to Save",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSavingDetails(false);
    }
  };

  // Sequential E-Sign Action
  const handleSign = async (item: any, stage: "class_teacher" | "hod" | "principal") => {
    if (!appUser || !selectedSection) return;
    const stu = item.student as Student;
    const stuUid = stu.studentUid || stu.admissionNo || stu.id;

    // Check that pending details exist before Class Teacher signs
    const pending = pendingDetailsMap[stuUid];
    if (stage === "class_teacher" && !pending) {
      toast({
        title: "Pending Details Incomplete",
        description: "Please complete the Term-wise Discipline (A-D) and Co-scholastic details before signing.",
        variant: "destructive",
      });
      handleOpenPendingDetails(item);
      return;
    }

    try {
      setSigningStudent(stuUid);
      const res = await signReportCardSequential({
        sessionId: effectiveSessionId,
        sectionId: selectedSection.id,
        studentUid: stuUid,
        stage,
        user: { uid: appUser.id, name: appUser.name, role: appUser.role },
      });

      toast({
        title: "Signature Applied",
        description: `Successfully signed as ${stage.replace("_", " ").toUpperCase()}. New status: ${res.newStatus.toUpperCase()}`,
      });

      await reloadData();
    } catch (err: any) {
      toast({
        title: "Signing Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSigningStudent(null);
    }
  };

  // Download PDF
  const handleDownloadPdf = async (item: any) => {
    const stu = item.student as Student;
    const stuUid = stu.studentUid || stu.admissionNo || stu.id;
    const snap = snapshotsMap[stuUid];

    if (!snap) {
      toast({
        title: "Report Card Not Finalized",
        description: "This report card has not been generated or published yet.",
        variant: "destructive",
      });
      return;
    }

    try {
      await generateReportCardPdf(snap, { mode: "download" });
      toast({ title: "Report Card Downloaded", description: `Downloaded PDF for ${stu.name}.` });
    } catch (err: any) {
      toast({ title: "PDF Generation Failed", description: err.message, variant: "destructive" });
    }
  };

  if (loading && sections.length === 0) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/40">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Award className="h-6 w-6 text-primary" />
            Annual Report Cards & E-Signature Pipeline
          </h1>
          <p className="text-sm text-muted-foreground">
            Full-year report cards, Class Teacher pending details (Discipline A-D), and sequential 3-stage signing.
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

      {/* Section Selector */}
      <Card className="border shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

            <div className="space-y-1.5 flex flex-col justify-end">
              <div className="text-xs text-muted-foreground flex items-center justify-between bg-muted/30 p-2.5 rounded-lg border">
                <span>Enrolled: <strong>{students.length}</strong></span>
                <span>Active Structure: <strong>{structureInfo?.structure.name || "CBSE Primary/Middle"}</strong></span>
              </div>
            </div>

            <div className="space-y-1.5 flex flex-col justify-end">
              <div className="text-xs text-muted-foreground flex items-center gap-2 bg-muted/30 p-2.5 rounded-lg border">
                <FileSignature className="h-4 w-4 text-primary shrink-0" />
                <span>Workflow: <strong>Class Teacher → HOD → Principal → Published</strong></span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Roster & Signatures Table */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-3 border-b border-border/40 bg-muted/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Annual Report Cards Roster — Grade {selectedSection?.grade} {selectedSection?.name}
            </CardTitle>
            <CardDescription className="text-xs">
              Manage term-wise discipline grades, sequential signatures, and publication status.
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit text-xs">
            {students.length} Students
          </Badge>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          {students.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No active students enrolled in this section.
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse min-w-[850px]">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="p-3 font-semibold text-slate-700">Student</th>
                  <th className="p-3 font-semibold text-slate-700">Roll No</th>
                  <th className="p-3 font-semibold text-slate-700">Discipline (T1 / T2)</th>
                  <th className="p-3 font-semibold text-slate-700">Workflow Status</th>
                  <th className="p-3 font-semibold text-slate-700">Signatures Applied</th>
                  <th className="p-3 font-semibold text-slate-700 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {students.map((item) => {
                  const stu = item.student as Student;
                  const stuUid = stu.studentUid || stu.admissionNo || stu.id;
                  const snap = snapshotsMap[stuUid];
                  const pending = pendingDetailsMap[stuUid];

                  const status = snap?.workflowStatus || (pending ? "draft" : "incomplete");
                  const disc = pending?.disciplineGrades || snap?.disciplineGrades || {};
                  const dt1 = (disc as any)?.term_1 || (disc as any)?.term1 || "—";
                  const dt2 = (disc as any)?.term_2 || (disc as any)?.term2 || "—";

                  const sigs = snap?.signatures || {};
                  const hasCT = Boolean(sigs.classTeacher);
                  const hasHOD = Boolean(sigs.hod);
                  const hasPrincipal = Boolean(sigs.principal);

                  return (
                    <tr key={stu.id} className="hover:bg-muted/10 transition-colors">
                      <td className="p-3 font-medium text-slate-900">
                        <div className="flex flex-col">
                          <span>{stu.name}</span>
                          <span className="text-[10px] text-muted-foreground">{stu.admissionNo || stu.id}</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-600">{stu.rollNo || "—"}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className={`font-bold ${dt1 !== "—" ? "text-primary border-primary/30" : "text-slate-400"}`}>
                            T1: {dt1}
                          </Badge>
                          <Badge variant="outline" className={`font-bold ${dt2 !== "—" ? "text-primary border-primary/30" : "text-slate-400"}`}>
                            T2: {dt2}
                          </Badge>
                        </div>
                      </td>
                      <td className="p-3">
                        {status === "published" ? (
                          <Badge className="bg-emerald-600 text-white flex items-center gap-1 w-fit">
                            <Lock className="h-3 w-3" /> Published & Locked
                          </Badge>
                        ) : status === "hod_signed" ? (
                          <Badge className="bg-blue-600 text-white w-fit">Awaiting Principal Sign</Badge>
                        ) : status === "teacher_signed" ? (
                          <Badge className="bg-indigo-600 text-white w-fit">Awaiting HOD Sign</Badge>
                        ) : status === "draft" ? (
                          <Badge variant="outline" className="text-orange-600 border-orange-300 w-fit">Draft — Ready for CT Sign</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-slate-500 w-fit">Incomplete Details</Badge>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <span title="Class Teacher Signature" className={`h-2.5 w-2.5 rounded-full ${hasCT ? "bg-emerald-500" : "bg-slate-300"}`} />
                          <span className="text-[10px] text-muted-foreground mr-1.5">CT</span>
                          <span title="HOD Signature" className={`h-2.5 w-2.5 rounded-full ${hasHOD ? "bg-emerald-500" : "bg-slate-300"}`} />
                          <span className="text-[10px] text-muted-foreground mr-1.5">HOD</span>
                          <span title="Principal Signature" className={`h-2.5 w-2.5 rounded-full ${hasPrincipal ? "bg-emerald-500" : "bg-slate-300"}`} />
                          <span className="text-[10px] text-muted-foreground">Principal</span>
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Pending Details Button */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenPendingDetails(item)}
                            className="h-7 text-xs"
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            {pending ? "Edit Details" : "Pending Details"}
                          </Button>

                          {/* Stage 1: Class Teacher Sign */}
                          {(!hasCT || status === "draft") && status !== "published" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSign(item, "class_teacher")}
                              disabled={signingStudent === stuUid}
                              className="h-7 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                            >
                              {signingStudent === stuUid ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FileSignature className="h-3 w-3 mr-1" />}
                              Sign CT
                            </Button>
                          )}

                          {/* Stage 2: HOD Sign */}
                          {hasCT && !hasHOD && status !== "published" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSign(item, "hod")}
                              disabled={signingStudent === stuUid}
                              className="h-7 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                            >
                              {signingStudent === stuUid ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                              Sign HOD
                            </Button>
                          )}

                          {/* Stage 3: Principal Sign & Publish */}
                          {hasHOD && !hasPrincipal && status !== "published" && (
                            <Button
                              size="sm"
                              onClick={() => handleSign(item, "principal")}
                              disabled={signingStudent === stuUid}
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                            >
                              {signingStudent === stuUid ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Lock className="h-3 w-3 mr-1" />}
                              Sign & Publish
                            </Button>
                          )}

                          {/* Download PDF button */}
                          {status === "published" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownloadPdf(item)}
                              className="h-7 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                            >
                              <Download className="h-3 w-3 mr-1" />
                              PDF
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Class Teacher Pending Details Dialogue Modal */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Edit className="h-5 w-5 text-primary" />
              Class Teacher Report Card Details
            </DialogTitle>
            <DialogDescription className="text-xs">
              Complete term-wise discipline grades, co-scholastic activities, and promotion recommendation for{" "}
              <strong>{activeStudent?.student?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Dedicated Term-Wise Discipline Section */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-xs uppercase tracking-wide">
                  Term-Wise Discipline Grading
                </span>
                <Badge variant="outline" className="text-[10px] bg-background">
                  Strictly 4-Point Scale: A, B, C, D
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Term 1 Discipline Grade</label>
                  <Select
                    value={formDisciplineT1}
                    onValueChange={(val: DisciplineGrade) => setFormDisciplineT1(val)}
                  >
                    <SelectTrigger className="w-full h-8 text-xs bg-background">
                      <SelectValue placeholder="Select Grade" />
                    </SelectTrigger>
                    <SelectContent>
                      {VALID_DISCIPLINE_GRADES.map((g) => (
                        <SelectItem key={g} value={g}>
                          Grade {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Term 2 Discipline Grade</label>
                  <Select
                    value={formDisciplineT2}
                    onValueChange={(val: DisciplineGrade) => setFormDisciplineT2(val)}
                  >
                    <SelectTrigger className="w-full h-8 text-xs bg-background">
                      <SelectValue placeholder="Select Grade" />
                    </SelectTrigger>
                    <SelectContent>
                      {VALID_DISCIPLINE_GRADES.map((g) => (
                        <SelectItem key={g} value={g}>
                          Grade {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Co-Scholastic Section */}
            <div className="rounded-lg border p-3.5 space-y-3 bg-muted/20">
              <span className="font-bold text-slate-900 text-xs uppercase tracking-wide block">
                Co-Scholastic Assessment (3-Point Scale: A, B, C)
              </span>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="font-medium text-slate-700">Work Education</label>
                  <Select value={formWorkEd} onValueChange={setFormWorkEd}>
                    <SelectTrigger className="h-8 text-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A</SelectItem>
                      <SelectItem value="B">B</SelectItem>
                      <SelectItem value="C">C</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-slate-700">Art Education</label>
                  <Select value={formArtEd} onValueChange={setFormArtEd}>
                    <SelectTrigger className="h-8 text-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A</SelectItem>
                      <SelectItem value="B">B</SelectItem>
                      <SelectItem value="C">C</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-slate-700">Health & Physical</label>
                  <Select value={formHealthPE} onValueChange={setFormHealthPE}>
                    <SelectTrigger className="h-8 text-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A</SelectItem>
                      <SelectItem value="B">B</SelectItem>
                      <SelectItem value="C">C</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Class Teacher Remarks & Promotion */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Class Teacher Remarks</label>
                <Textarea
                  value={formTeacherRemarks}
                  onChange={(e) => setFormTeacherRemarks(e.target.value)}
                  placeholder="Enter remarks regarding student conduct, academic focus, and participation..."
                  className="text-xs min-h-[60px]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Promoted to Grade / Status</label>
                <Input
                  value={formPromotedTo}
                  onChange={(e) => setFormPromotedTo(e.target.value)}
                  placeholder="e.g. Grade 6"
                  className="text-xs h-8"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={savingDetails}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSavePendingDetails}
              disabled={savingDetails}
              className="bg-primary text-white"
            >
              {savingDetails ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save Details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

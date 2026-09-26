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
  updateDoc,
} from "firebase/firestore";
import type { Section, Subject, ExamSchedule, Student, Enrollment } from "@/lib/types";
import {
  getActiveStructureForGrade,
  AcademicStructure,
  AcademicStructureVersion,
  AssessmentComponent,
  GradingScale,
  getEffectiveComponentsForSubject,
} from "@/lib/academicStructure";
import {
  fetchMarksEntriesForSection,
  saveMarksEntriesBatch,
  calculateStudentExamMarks,
  MarksEntryRecord,
  ComponentScoreInput,
  StudentAssessmentStatus,
} from "@/lib/resultEngine";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  FileSpreadsheet,
  Save,
  Send,
  Loader2,
  Lock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Clock,
  Layers,
  Award,
} from "lucide-react";

interface StudentRow {
  studentUid: string;
  studentDocId: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  admissionNo: string;
}

export default function TeacherMarksEntry() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "";
  const effectiveSessionName = workingSession?.name || activeSession?.name || "2026-27";

  // Teacher Identity & Permissions
  const [teacherDocId, setTeacherDocId] = useState<string>("");
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [allGradeExams, setAllGradeExams] = useState<ExamSchedule[]>([]);
  const [approvingSchedule, setApprovingSchedule] = useState(false);

  // Selection state
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [selectedTermId, setSelectedTermId] = useState<string>("term_1");
  const [selectedExamId, setSelectedExamId] = useState<string>("");

  // Academic Structure resolved
  const [structureInfo, setStructureInfo] = useState<{
    structure: AcademicStructure;
    version: AcademicStructureVersion;
  } | null>(null);

  const availableTerms = useMemo(() => {
    if (structureInfo?.version.terms && structureInfo.version.terms.length > 0) {
      return structureInfo.version.terms;
    }
    return [
      { id: "term_1", name: "Term 1", sequence: 1, workflowStatus: "active" as const },
      { id: "term_2", name: "Term 2", sequence: 2, workflowStatus: "active" as const },
    ];
  }, [structureInfo]);

  const termApprovedExams = useMemo(() => {
    // If admin, show both approved and pending
    const source = appUser?.role === "admin"
      ? allGradeExams
      : allGradeExams.filter((ex) => ex.status === "approved");

    return source.filter((ex) => {
      if (ex.termId) return ex.termId === selectedTermId;
      if (selectedTermId === "term_1") {
        return !ex.examType.toLowerCase().includes("term 2") && !ex.examType.toLowerCase().includes("annual");
      }
      if (selectedTermId === "term_2") {
        return ex.examType.toLowerCase().includes("term 2") || ex.examType.toLowerCase().includes("annual");
      }
      return true;
    });
  }, [allGradeExams, selectedTermId, appUser?.role]);

  const pendingTermExams = useMemo(() => {
    return allGradeExams
      .filter((ex) => ex.status === "pending_approval" || ex.status === "draft")
      .filter((ex) => {
        if (ex.termId) return ex.termId === selectedTermId;
        if (selectedTermId === "term_1") {
          return !ex.examType.toLowerCase().includes("term 2") && !ex.examType.toLowerCase().includes("annual");
        }
        if (selectedTermId === "term_2") {
          return ex.examType.toLowerCase().includes("term 2") || ex.examType.toLowerCase().includes("annual");
        }
        return true;
      });
  }, [allGradeExams, selectedTermId]);

  const selectedExamObj = useMemo(() => {
    return allGradeExams.find((ex) => ex.id === selectedExamId) || null;
  }, [allGradeExams, selectedExamId]);

  const handleQuickApproveExam = async (examScheduleId: string) => {
    if (!appUser) return;
    try {
      setApprovingSchedule(true);
      const now = new Date().toISOString();
      await updateDoc(doc(db, "examSchedules", examScheduleId), {
        status: "approved",
        reviewedBy: appUser.id,
        reviewedByName: appUser.name || "Principal",
        reviewedAt: now,
        updatedAt: now,
      });

      setAllGradeExams((prev) =>
        prev.map((s) => (s.id === examScheduleId ? { ...s, status: "approved" as const } : s))
      );

      toast({
        title: "Exam Schedule Approved",
        description: "Schedule approved successfully. Marks entry is now active.",
      });
    } catch (err: any) {
      toast({
        title: "Failed to approve schedule",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setApprovingSchedule(false);
    }
  };

  useEffect(() => {
    if (termApprovedExams.length > 0) {
      const exists = termApprovedExams.some((ex) => ex.id === selectedExamId);
      if (!exists) {
        setSelectedExamId(termApprovedExams[0].id);
      }
    } else {
      setSelectedExamId("");
    }
  }, [termApprovedExams, selectedExamId]);

  // Student list and marks matrix
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [marksState, setMarksState] = useState<
    Record<string, Record<string, ComponentScoreInput>>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);

  // Read-only / Workflow status of the loaded marks
  const [currentWorkflowStatus, setCurrentWorkflowStatus] = useState<string>("draft");

  // Resolve logged-in teacher and their assigned sections/subjects
  useEffect(() => {
    if (!appUser) return;
    const initTeacher = async () => {
      try {
        setLoading(true);

        if (appUser.role === "admin") {
          setTeacherDocId(appUser.id);
          const secDocs = await getDocs(collection(db, "sections"));
          const allSecs = secDocs.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
          allSecs.sort((a, b) => (a.grade || "").localeCompare(b.grade || "") || a.name.localeCompare(b.name));
          setSections(allSecs);
          if (allSecs.length > 0) {
            setSelectedSectionId(allSecs[0].id);
          }
        } else if (appUser.role === "hod") {
          setTeacherDocId(appUser.id);
          const userDoc = await getDoc(doc(db, "users", appUser.id));
          const assignedGrades: string[] = userDoc.data()?.assignedGrades || [];
          const secDocs = await getDocs(collection(db, "sections"));
          let hodSecs = secDocs.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
          if (assignedGrades.length > 0) {
            hodSecs = hodSecs.filter((s) => assignedGrades.map(String).includes(String(s.grade)));
          }
          hodSecs.sort((a, b) => (a.grade || "").localeCompare(b.grade || "") || a.name.localeCompare(b.name));
          setSections(hodSecs);
          if (hodSecs.length > 0) {
            setSelectedSectionId(hodSecs[0].id);
          }
        } else {
          let tDocId = appUser.id;
          const tSnap = await getDocs(
            query(collection(db, "teachers"), where("uid", "==", appUser.id))
          );
          if (!tSnap.empty) {
            tDocId = tSnap.docs[0].id;
          }
          setTeacherDocId(tDocId);

          // Fetch subject assignments for this teacher
          const [assignSnap, classTeacherSecSnap] = await Promise.all([
            getDocs(
              query(collection(db, "subjectAssignments"), where("teacherId", "==", tDocId))
            ),
            getDocs(
              query(collection(db, "sections"), where("classTeacherId", "==", tDocId))
            ),
          ]);

          const assignedSectionIds = new Set<string>();
          assignSnap.docs.forEach((d) => assignedSectionIds.add(d.data().sectionId));
          classTeacherSecSnap.docs.forEach((d) => assignedSectionIds.add(d.id));

          if (assignedSectionIds.size > 0) {
            const secDocs = await getDocs(collection(db, "sections"));
            const validSecs: Section[] = [];
            secDocs.docs.forEach((d) => {
              if (assignedSectionIds.has(d.id)) {
                validSecs.push({ id: d.id, ...d.data() } as Section);
              }
            });
            validSecs.sort((a, b) => (a.grade || "").localeCompare(b.grade || "") || a.name.localeCompare(b.name));
            setSections(validSecs);
            if (validSecs.length > 0) {
              setSelectedSectionId(validSecs[0].id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load teacher assignments:", err);
      } finally {
        setLoading(false);
      }
    };

    initTeacher();
  }, [appUser]);

  const selectedSection = useMemo(() => {
    return sections.find((s) => s.id === selectedSectionId) || null;
  }, [sections, selectedSectionId]);

  // When selectedSection changes, load assigned subjects for this section & approved exams for this grade
  useEffect(() => {
    if (!selectedSection || !teacherDocId) return;
    const loadSubjectsAndExams = async () => {
      try {
        const subjDocs = await getDocs(
          query(collection(db, "subjects"), where("grade", "==", selectedSection.grade))
        );
        let secSubjs = subjDocs.docs.map((d) => ({ id: d.id, ...d.data() } as Subject));

        if (appUser?.role !== "admin" && appUser?.role !== "hod") {
          // Find assigned subjects for this teacher in this section
          const assignSnap = await getDocs(
            query(
              collection(db, "subjectAssignments"),
              where("teacherId", "==", teacherDocId),
              where("sectionId", "==", selectedSection.id)
            )
          );
          const assignedSubjIds = assignSnap.docs.map((d) => d.data().subjectId);
          secSubjs = secSubjs.filter((s) => assignedSubjIds.includes(s.id) || selectedSection.classTeacherId === teacherDocId);
        }

        setSubjects(secSubjs);
        if (secSubjs.length > 0) {
          setSelectedSubjectId(secSubjs[0].id);
        } else {
          setSelectedSubjectId("");
        }

        // Fetch all exam schedules for this grade (robust matching for string and numeric grade)
        const gradeStr = String(selectedSection.grade);
        const [schedSnapStr, schedSnapNum] = await Promise.all([
          getDocs(query(collection(db, "examSchedules"), where("grade", "==", gradeStr))),
          !isNaN(Number(gradeStr))
            ? getDocs(query(collection(db, "examSchedules"), where("grade", "==", Number(gradeStr))))
            : Promise.resolve({ docs: [] }),
        ]);

        const schedMap = new Map<string, ExamSchedule>();
        [...schedSnapStr.docs, ...schedSnapNum.docs].forEach((d) => {
          schedMap.set(d.id, { id: d.id, ...d.data() } as ExamSchedule);
        });
        const scheds = Array.from(schedMap.values());
        setAllGradeExams(scheds);

        const validInitial = appUser?.role === "admin"
          ? scheds
          : scheds.filter((s) => s.status === "approved");

        if (validInitial.length > 0) {
          setSelectedExamId(validInitial[0].id);
        } else {
          setSelectedExamId("");
        }

        // Resolve active Academic Structure for this grade
        const struct = await getActiveStructureForGrade(selectedSection.grade, effectiveSessionId);
        setStructureInfo(struct);
      } catch (err) {
        console.error("Error loading section curriculum:", err);
      }
    };

    loadSubjectsAndExams();
  }, [selectedSection, teacherDocId, effectiveSessionId]);

  // Load students in section & existing marks entries
  useEffect(() => {
    if (!selectedSectionId || !selectedSubjectId || !selectedExamId || !structureInfo) {
      setStudents([]);
      setMarksState({});
      return;
    }

    const loadStudentsAndMarks = async () => {
      setLoadingStudents(true);
      try {
        // 1. Load active enrollments for this section in current session
        const enrollQ = query(
          collection(db, "enrollments"),
          where("sectionId", "==", selectedSectionId),
          where("status", "==", "active")
        );
        const enrollSnap = await getDocs(enrollQ);
        const enrollments = enrollSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));

        // 2. Fetch student profiles
        const studentRows: StudentRow[] = [];
        await Promise.all(
          enrollments.map(async (enr) => {
            const stuDoc = await getDoc(doc(db, "students", enr.studentId));
            if (stuDoc.exists()) {
              const data = stuDoc.data() as Student;
              const canonicalUid = data.studentUid || data.admissionNo || data.id || stuDoc.id;
              studentRows.push({
                studentUid: canonicalUid,
                studentDocId: stuDoc.id,
                studentId: canonicalUid,
                studentName: data.name,
                rollNo: enr.rollNo || data.rollNo || "",
                admissionNo: data.admissionNo || "",
              });
            }
          })
        );

        // Sort alphabetically by student name
        studentRows.sort((a, b) => a.studentName.localeCompare(b.studentName));
        setStudents(studentRows);

        // 3. Load existing marks entries
        const existingEntries = await fetchMarksEntriesForSection({
          sessionId: effectiveSessionId,
          sectionId: selectedSectionId,
          subjectId: selectedSubjectId,
          termId: selectedTermId,
          examId: selectedExamId,
        });

        const newMarksState: Record<string, Record<string, ComponentScoreInput>> = {};
        let detectedStatus = "draft";

        studentRows.forEach((stu) => {
          const rec = existingEntries[stu.studentUid] || existingEntries[stu.studentDocId] || existingEntries[stu.studentId];
          if (rec) {
            newMarksState[stu.studentId] = rec.componentMarks || {};
            if (rec.workflowStatus) detectedStatus = rec.workflowStatus;
          } else {
            newMarksState[stu.studentId] = {};
            const comps = getEffectiveComponentsForSubject(
              structureInfo.version,
              selectedTermId,
              selectedSubjectId
            );
            comps.forEach((c) => {
              newMarksState[stu.studentId][c.id] = { marks: null, status: "present" };
            });
          }
        });

        setMarksState(newMarksState);
        setCurrentWorkflowStatus(detectedStatus);
      } catch (err) {
        console.error("Failed to load students and marks:", err);
      } finally {
        setLoadingStudents(false);
      }
    };

    loadStudentsAndMarks();
  }, [selectedSectionId, selectedSubjectId, selectedTermId, selectedExamId, structureInfo, effectiveSessionId]);

  // Components defined in active Academic Structure (supporting term & subject overrides)
  const activeComponents = useMemo(() => {
    if (!structureInfo?.version) return [];
    return getEffectiveComponentsForSubject(
      structureInfo.version,
      selectedTermId,
      selectedSubjectId
    );
  }, [structureInfo, selectedTermId, selectedSubjectId]);

  // Grading scale defined in active Academic Structure
  const activeScale = useMemo(() => {
    return structureInfo?.version?.gradingScale || { id: "default", name: "Default", tiers: [], passingPercentage: 33 };
  }, [structureInfo]);

  // Cell change handler
  const handleScoreChange = (
    studentId: string,
    componentId: string,
    marksVal: string
  ) => {
    setMarksState((prev) => {
      const studentMap = { ...(prev[studentId] || {}) };
      const numVal = marksVal === "" ? null : Number(marksVal);
      studentMap[componentId] = {
        marks: numVal,
        status: "present",
      };
      return { ...prev, [studentId]: studentMap };
    });
  };

  // Toggle Absent status
  const handleToggleAbsent = (studentId: string) => {
    setMarksState((prev) => {
      const studentMap = { ...(prev[studentId] || {}) };
      const isCurrentlyAbsent = Object.values(studentMap).some((c) => c.status === "absent");
      activeComponents.forEach((c) => {
        studentMap[c.id] = {
          marks: null,
          status: isCurrentlyAbsent ? "present" : "absent",
        };
      });
      return { ...prev, [studentId]: studentMap };
    });
  };

  // Toggle Exempt status
  const handleToggleExempt = (studentId: string) => {
    setMarksState((prev) => {
      const studentMap = { ...(prev[studentId] || {}) };
      const isCurrentlyExempt = Object.values(studentMap).some((c) => c.status === "exempt");
      activeComponents.forEach((c) => {
        studentMap[c.id] = {
          marks: null,
          status: isCurrentlyExempt ? "present" : "exempt",
        };
      });
      return { ...prev, [studentId]: studentMap };
    });
  };

  // Save / Submit Handler
  const handleSave = async (targetStatus: "draft" | "submitted") => {
    if (!selectedSection || !structureInfo || !appUser) return;
    try {
      setSaving(true);
      const studentsPayload = students.map((stu) => ({
        studentUid: stu.studentUid,
        studentDocId: stu.studentDocId,
        studentId: stu.studentUid,
        studentName: stu.studentName,
        rollNo: stu.rollNo,
        admissionNo: stu.admissionNo,
        componentInputs: marksState[stu.studentId] || {},
      }));

      const termObj = availableTerms.find((t) => t.id === selectedTermId);
      const termName = termObj?.name || (selectedTermId === "term_2" ? "Term 2" : "Term 1");

      const res = await saveMarksEntriesBatch({
        sessionId: effectiveSessionId,
        academicYear: effectiveSessionName,
        structureId: structureInfo.structure.id,
        structureVersion: structureInfo.version.versionNumber,
        grade: selectedSection.grade,
        sectionId: selectedSection.id,
        subjectId: selectedSubjectId,
        termId: selectedTermId,
        termName: termName,
        examId: selectedExamId,
        components: activeComponents,
        scale: activeScale,
        calculationConfig: structureInfo.version.calculationConfig,
        studentsMarks: studentsPayload,
        targetStatus,
        user: { uid: appUser.id, name: appUser.name, role: appUser.role },
      });

      if (res.errors.length > 0) {
        toast({
          title: "Some marks had validation warnings",
          description: res.errors.slice(0, 3).join("; "),
          variant: "destructive",
        });
      } else {
        toast({
          title: targetStatus === "submitted" ? "Marks Submitted to HOD" : "Draft Saved",
          description: `Successfully saved marks for ${res.savedCount} students.`,
        });
        setCurrentWorkflowStatus(targetStatus);
      }
    } catch (err: any) {
      console.error("Save marks failed:", err);
      toast({ title: "Failed to Save", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isLocked =
    currentWorkflowStatus === "verified" ||
    currentWorkflowStatus === "published" ||
    currentWorkflowStatus === "locked";

  return (
    <div data-testid="teacher-marks-entry" className="space-y-6">
      {/* Banner */}
      <div className="gradient-banner rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-blue-500/20 text-blue-200 border border-blue-400/30">
            Session: {effectiveSessionName}
          </span>
          {structureInfo && (
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
              Structure: {structureInfo.structure.name} (v{structureInfo.version.versionNumber})
            </span>
          )}
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Teacher Marks Entry</h1>
        <p className="mt-1 text-sm text-slate-300">
          Enter component-wise scores defined strictly by your school's Academic Structure.
        </p>
      </div>

      {/* Class, Subject, Term & Exam Selection Controls */}
      <div className="glass-card-strong rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs font-semibold">1. Assigned Section</Label>
          <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
            <SelectTrigger className="mt-1 bg-background text-xs">
              <SelectValue placeholder="Select class/section..." />
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
          <Label className="text-xs font-semibold">2. Assigned Subject</Label>
          <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
            <SelectTrigger className="mt-1 bg-background text-xs">
              <SelectValue placeholder="Select subject..." />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((sub) => (
                <SelectItem key={sub.id} value={sub.id} className="text-xs">
                  {sub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs font-semibold">3. Academic Term</Label>
          <Select value={selectedTermId} onValueChange={setSelectedTermId}>
            <SelectTrigger className="mt-1 bg-background text-xs">
              <SelectValue placeholder="Select term..." />
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
          <Label className="text-xs font-semibold">4. Scheduled Exam</Label>
          <Select value={selectedExamId} onValueChange={setSelectedExamId}>
            <SelectTrigger className="mt-1 bg-background text-xs">
              <SelectValue
                placeholder={
                  termApprovedExams.length === 0
                    ? pendingTermExams.length > 0
                      ? `${pendingTermExams.length} exam awaiting Principal approval`
                      : "No exams for term"
                    : "Select scheduled exam..."
                }
              />
            </SelectTrigger>
            <SelectContent>
              {termApprovedExams.map((ex) => (
                <SelectItem key={ex.id} value={ex.id} className="text-xs">
                  {ex.examType}
                  {ex.status === "pending_approval" && " (Pending Approval)"}
                  {ex.status === "draft" && " (Draft)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Banner if selected exam is pending approval */}
      {selectedExamObj && selectedExamObj.status !== "approved" && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-medium">
          <div className="flex items-center gap-2">
            <Clock className="text-amber-600 shrink-0" size={16} />
            <span>
              Exam <strong>"{selectedExamObj.examType}"</strong> is currently{" "}
              <Badge variant="outline" className="border-amber-400 text-amber-800 uppercase mx-1">
                {selectedExamObj.status === "pending_approval" ? "Pending Principal Approval" : "Draft"}
              </Badge>
              {appUser?.role === "admin"
                ? "As an Administrator, you can approve it to open marks entry for all staff."
                : "It must be approved by the Principal/Admin under Admin > Exam Approvals before marks can be submitted."}
            </span>
          </div>
          {appUser?.role === "admin" && (
            <Button
              size="sm"
              variant="outline"
              className="bg-amber-600 hover:bg-amber-700 text-white border-0 text-xs shrink-0"
              onClick={() => handleQuickApproveExam(selectedExamObj.id)}
              disabled={approvingSchedule}
            >
              {approvingSchedule ? <Loader2 className="animate-spin mr-1 h-3.5 w-3.5" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
              Approve Schedule Now
            </Button>
          )}
        </div>
      )}

      {/* Banner if NO approved exams but pending exams exist for teachers */}
      {appUser?.role !== "admin" && termApprovedExams.length === 0 && pendingTermExams.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-xl p-3.5 flex items-center gap-2 text-xs font-medium">
          <Clock className="text-blue-600 shrink-0" size={16} />
          <span>
            <strong>{pendingTermExams.map((e) => e.examType).join(", ")}</strong> has been scheduled for this grade, but is currently <strong>awaiting approval from the Principal</strong> under <em>Admin &gt; Exam Approvals</em>. Marks entry will unlock automatically once approved.
          </span>
        </div>
      )}

      {/* Workflow Lock Status Banner */}
      {isLocked && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3.5 flex items-center justify-between text-xs font-medium">
          <div className="flex items-center gap-2">
            <Lock className="text-amber-600 shrink-0" size={16} />
            <span>
              These marks have been <strong>{currentWorkflowStatus.toUpperCase()}</strong> by the Academic Office and are currently read-only. Contact the HOD or Principal to request an edit unlock.
            </span>
          </div>
          <Badge variant="outline" className="border-amber-400 text-amber-800 uppercase">
            {currentWorkflowStatus}
          </Badge>
        </div>
      )}

      {/* Marks Matrix Table */}
      <Card className="rounded-2xl border shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileSpreadsheet size={18} className="text-primary" />
              Student Marks Register
              {selectedSection && (
                <span className="text-xs font-normal text-muted-foreground">
                  (Grade {selectedSection.grade} {selectedSection.name} • {students.length} Students)
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              Component values are validated against the maximum marks defined in the Academic Structure.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {!isLocked && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSave("draft")}
                  disabled={saving || loadingStudents || students.length === 0}
                  className="gap-1.5 text-xs"
                >
                  <Save size={14} /> Save Draft
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleSave("submitted")}
                  disabled={saving || loadingStudents || students.length === 0}
                  className="gap-1.5 text-xs bg-primary text-white"
                >
                  <Send size={14} /> Submit to HOD
                </Button>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          {loadingStudents ? (
            <div className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center">
              <Loader2 className="animate-spin h-6 w-6 text-primary mb-2" />
              <p className="text-xs">Loading students & academic components...</p>
            </div>
          ) : students.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <p className="text-sm font-medium">No students enrolled or no selection made</p>
              <p className="text-xs mt-1">Please select an assigned section, subject, and approved exam above.</p>
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-muted/50 border-b text-muted-foreground font-semibold">
                  <th className="py-3 px-3 w-12 text-center">Roll</th>
                  <th className="py-3 px-4 min-w-[160px]">Student Name</th>
                  {activeComponents.map((comp) => (
                    <th key={comp.id} className="py-3 px-2 text-center min-w-[100px]">
                      <div>{comp.name}</div>
                      <div className="text-[10px] font-normal text-muted-foreground font-mono">
                        {comp.code} (/{comp.testedMaxMarks ?? comp.maxMarks})
                        {comp.calculationMethod === "scale_to_target" && (
                          <span className="block text-[8px] text-amber-600">
                            → {comp.scalingTargetMarks}M
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="py-3 px-3 text-center min-w-[80px]">Total</th>
                  <th className="py-3 px-3 text-center min-w-[60px]">Grade</th>
                  <th className="py-3 px-3 text-center min-w-[110px]">Status / Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {students.map((stu, idx) => {
                  const studentScores = marksState[stu.studentId] || {};
                  const isAbsent = Object.values(studentScores).some((s) => s.status === "absent");
                  const isExempt = Object.values(studentScores).some((s) => s.status === "exempt");

                  const calc = calculateStudentExamMarks({
                    components: activeComponents,
                    componentInputs: studentScores,
                    scale: activeScale,
                    calculationConfig: structureInfo?.version?.calculationConfig,
                  });

                  return (
                    <tr
                      key={stu.studentId}
                      className={`hover:bg-muted/10 transition-colors ${
                        isAbsent ? "bg-rose-50/40" : isExempt ? "bg-amber-50/40" : ""
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center font-mono text-muted-foreground">
                        {stu.rollNo || idx + 1}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-foreground">
                        {stu.studentName}
                        {stu.admissionNo && (
                          <span className="block text-[10px] text-muted-foreground font-normal">
                            Adm: {stu.admissionNo}
                          </span>
                        )}
                      </td>

                      {activeComponents.map((comp) => {
                        const cellVal = studentScores[comp.id]?.marks ?? "";
                        const cellStatus = studentScores[comp.id]?.status || "present";
                        const entryMax = comp.testedMaxMarks ?? comp.maxMarks;

                        return (
                          <td key={comp.id} className="py-2 px-2 text-center">
                            {cellStatus === "absent" ? (
                              <Badge variant="outline" className="bg-rose-100 text-rose-700 text-[10px] py-0.5">
                                AB
                              </Badge>
                            ) : cellStatus === "exempt" ? (
                              <Badge variant="outline" className="bg-amber-100 text-amber-700 text-[10px] py-0.5">
                                EX
                              </Badge>
                            ) : (
                              <Input
                                type="number"
                                min={0}
                                max={entryMax}
                                disabled={isLocked}
                                value={cellVal}
                                onChange={(e) =>
                                  handleScoreChange(stu.studentId, comp.id, e.target.value)
                                }
                                className={`h-8 text-center text-xs font-semibold mx-auto w-20 ${
                                  Number(cellVal) > entryMax
                                    ? "border-red-500 bg-red-50 text-red-700"
                                    : ""
                                }`}
                              />
                            )}
                          </td>
                        );
                      })}

                      {/* Calculated Total */}
                      <td className="py-2.5 px-3 text-center font-bold">
                        {isAbsent ? (
                          <span className="text-rose-600 font-bold">AB</span>
                        ) : isExempt ? (
                          <span className="text-amber-600 font-bold">EX</span>
                        ) : (
                          <span>
                            {calc.totalRawMarks}
                            <span className="text-[10px] font-normal text-muted-foreground">
                              /{calc.totalMaxMarks}
                            </span>
                          </span>
                        )}
                      </td>

                      {/* Calculated Grade */}
                      <td className="py-2.5 px-3 text-center">
                        <Badge
                          variant="secondary"
                          className="font-bold text-xs py-0.5 px-2 bg-blue-50 text-blue-700 border border-blue-200"
                        >
                          {calc.calculatedGrade}
                        </Badge>
                      </td>

                      {/* Actions: Absent / Exempt toggles */}
                      <td className="py-2.5 px-3 text-center space-x-1">
                        {!isLocked && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleToggleAbsent(stu.studentId)}
                              className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                                isAbsent
                                  ? "bg-rose-600 text-white border-rose-600"
                                  : "text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              AB
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleExempt(stu.studentId)}
                              className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                                isExempt
                                  ? "bg-amber-600 text-white border-amber-600"
                                  : "text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              EX
                            </button>
                          </>
                        )}
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

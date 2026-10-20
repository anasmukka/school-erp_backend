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
  DefinedExam,
  GradingScale,
  getEffectiveComponentsForSubject,
} from "@/lib/academicStructure";
import {
  fetchMarksEntriesForSection,
  saveMarksEntriesBatch,
  calculateStudentExamMarks,
  validateExamScheduleEligibility,
  ExamEligibilityResult,
  MarksEntryRecord,
  ComponentScoreInput,
  StudentAssessmentStatus,
} from "@/lib/resultEngine";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Edit3,
  Calendar,
  AlertTriangle,
  BookOpen,
  UserCheck,
  Check,
  X,
} from "lucide-react";
import { CardGridSkeleton, TableSkeleton } from "@/components/common/Skeletons";

interface StudentRow {
  studentUid: string;
  studentDocId: string;
  studentId: string;
  studentName: string;
  rollNo: string;
  admissionNo: string;
}

interface AssignedClassSubjectOption {
  section: Section;
  subject: Subject;
  eligibility: ExamEligibilityResult;
}

interface DynamicConfiguredExam {
  id: string; // definedExamId
  name: string;
  code?: string;
  termId: string;
  termName: string;
  academicYear: string;
  maxMarks: number;
  passingMarks?: number;
  applicableComponentIds: string[];
  applicableGrades: string[];
  structureId: string;
  structureVersionNumber: number;
  overallStatus: "available" | "submitted" | "locked" | "not_conducted" | "awaiting_approval" | "not_scheduled";
  overallStatusLabel: string;
}

export default function TeacherMarksEntry() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "";
  const effectiveSessionName = workingSession?.name || activeSession?.name || "2026-27";

  // Teacher Identity & Permissions
  const [teacherDocId, setTeacherDocId] = useState<string>("");
  const [assignedSections, setAssignedSections] = useState<Section[]>([]);
  const [assignedSubjectsBySection, setAssignedSubjectsBySection] = useState<Record<string, Subject[]>>({});
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Active Academic Structures mapped by Grade
  const [gradeStructureMap, setGradeStructureMap] = useState<
    Record<string, { structure: AcademicStructure; version: AcademicStructureVersion }>
  >({});

  // All grade exam schedules loaded from DB
  const [allGradeSchedules, setAllGradeSchedules] = useState<ExamSchedule[]>([]);

  // Selection Workflow State
  // Step 1: Selected Exam (DefinedExam ID)
  const [selectedExamId, setSelectedExamId] = useState<string>("");

  // Step 2: Selected Section & Subject
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");

  // Step 3: Student Roster & Marks
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [marksState, setMarksState] = useState<
    Record<string, Record<string, ComponentScoreInput>>
  >({});
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);

  // Workflow status of the loaded marks for the selected class/subject
  const [currentWorkflowStatus, setCurrentWorkflowStatus] = useState<string>("draft");
  const [isEditingSubmitted, setIsEditingSubmitted] = useState<boolean>(false);

  // 1. RESOLVE TEACHER & ASSIGNMENTS AUTHORITATIVELY
  useEffect(() => {
    if (!appUser) return;
    const initTeacherAssignments = async () => {
      try {
        setLoadingInitial(true);

        let tDocId = appUser.id;
        let validSecs: Section[] = [];
        const subjMap: Record<string, Subject[]> = {};

        if (appUser.role === "admin") {
          setTeacherDocId(appUser.id);
          const [secDocs, subjDocs] = await Promise.all([
            getDocs(collection(db, "sections")),
            getDocs(collection(db, "subjects")),
          ]);
          validSecs = secDocs.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
          validSecs.sort((a, b) => (a.grade || "").localeCompare(b.grade || "") || a.name.localeCompare(b.name));

          const allSubjs = subjDocs.docs.map((d) => ({ id: d.id, ...d.data() } as Subject));
          validSecs.forEach((sec) => {
            subjMap[sec.id] = allSubjs.filter((s) => String(s.grade) === String(sec.grade));
          });
        } else if (appUser.role === "hod") {
          setTeacherDocId(appUser.id);
          const userDoc = await getDoc(doc(db, "users", appUser.id));
          const assignedGrades: string[] = userDoc.data()?.assignedGrades || [];
          const [secDocs, subjDocs] = await Promise.all([
            getDocs(collection(db, "sections")),
            getDocs(collection(db, "subjects")),
          ]);
          let hodSecs = secDocs.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
          if (assignedGrades.length > 0) {
            hodSecs = hodSecs.filter((s) => assignedGrades.map(String).includes(String(s.grade)));
          }
          hodSecs.sort((a, b) => (a.grade || "").localeCompare(b.grade || "") || a.name.localeCompare(b.name));
          validSecs = hodSecs;

          const allSubjs = subjDocs.docs.map((d) => ({ id: d.id, ...d.data() } as Subject));
          validSecs.forEach((sec) => {
            subjMap[sec.id] = allSubjs.filter((s) => String(s.grade) === String(sec.grade));
          });
        } else {
          // Regular Teacher
          const tSnap = await getDocs(
            query(collection(db, "teachers"), where("uid", "==", appUser.id))
          );
          if (!tSnap.empty) {
            tDocId = tSnap.docs[0].id;
          }
          setTeacherDocId(tDocId);

          const [assignSnap, classTeacherSecSnap, secDocs, subjDocs] = await Promise.all([
            getDocs(
              query(collection(db, "subjectAssignments"), where("teacherId", "==", tDocId))
            ),
            getDocs(
              query(collection(db, "sections"), where("classTeacherId", "==", tDocId))
            ),
            getDocs(collection(db, "sections")),
            getDocs(collection(db, "subjects")),
          ]);

          const assignedSectionIds = new Set<string>();
          const assignedSubjIdBySec: Record<string, Set<string>> = {};

          assignSnap.docs.forEach((d) => {
            const data = d.data();
            assignedSectionIds.add(data.sectionId);
            if (!assignedSubjIdBySec[data.sectionId]) assignedSubjIdBySec[data.sectionId] = new Set();
            assignedSubjIdBySec[data.sectionId].add(data.subjectId);
          });

          classTeacherSecSnap.docs.forEach((d) => {
            assignedSectionIds.add(d.id);
          });

          const allSecsMap = new Map<string, Section>();
          secDocs.docs.forEach((d) => {
            if (assignedSectionIds.has(d.id)) {
              allSecsMap.set(d.id, { id: d.id, ...d.data() } as Section);
            }
          });
          validSecs = Array.from(allSecsMap.values());
          validSecs.sort((a, b) => (a.grade || "").localeCompare(b.grade || "") || a.name.localeCompare(b.name));

          const allSubjs = subjDocs.docs.map((d) => ({ id: d.id, ...d.data() } as Subject));

          validSecs.forEach((sec) => {
            const isClassTeacher = sec.classTeacherId === tDocId;
            const mySubjIds = assignedSubjIdBySec[sec.id] || new Set();

            if (isClassTeacher) {
              // Class teacher can view all scholastic subjects for their section
              subjMap[sec.id] = allSubjs.filter((s) => String(s.grade) === String(sec.grade));
            } else {
              // Subject teacher sees ONLY subjects assigned to them in this section
              subjMap[sec.id] = allSubjs.filter(
                (s) => String(s.grade) === String(sec.grade) && mySubjIds.has(s.id)
              );
            }
          });
        }

        setAssignedSections(validSecs);
        setAssignedSubjectsBySection(subjMap);

        // 2. Load Active Academic Structures for all distinct assigned grades
        const distinctGrades = Array.from(new Set(validSecs.map((s) => String(s.grade))));
        const structMap: Record<string, { structure: AcademicStructure; version: AcademicStructureVersion }> = {};

        await Promise.all(
          distinctGrades.map(async (grade) => {
            const res = await getActiveStructureForGrade(grade, effectiveSessionId);
            if (res) structMap[grade] = res;
          })
        );
        setGradeStructureMap(structMap);

        // 3. Load all exam schedules for these grades
        const schedMap = new Map<string, ExamSchedule>();
        await Promise.all(
          distinctGrades.map(async (grade) => {
            const [snapStr, snapNum] = await Promise.all([
              getDocs(query(collection(db, "examSchedules"), where("grade", "==", grade))),
              !isNaN(Number(grade))
                ? getDocs(query(collection(db, "examSchedules"), where("grade", "==", Number(grade))))
                : Promise.resolve({ docs: [] as any[] }),
            ]);
            [...snapStr.docs, ...snapNum.docs].forEach((d) => {
              schedMap.set(d.id, { id: d.id, ...d.data() } as ExamSchedule);
            });
          })
        );
        setAllGradeSchedules(Array.from(schedMap.values()));
      } catch (err) {
        console.error("Failed to initialize teacher assignments:", err);
      } finally {
        setLoadingInitial(false);
      }
    };

    initTeacherAssignments();
  }, [appUser, effectiveSessionId]);

  // 2. DYNAMICALLY GENERATE EXAM LIST FROM AUTHORITATIVE ACADEMIC STRUCTURE PLANNER
  const dynamicConfiguredExams = useMemo(() => {
    const list: DynamicConfiguredExam[] = [];
    const seenExamKeys = new Set<string>();

    Object.entries(gradeStructureMap).forEach(([grade, { structure, version }]) => {
      const exams = version.exams || [];
      const terms = version.terms || [];

      exams.forEach((defExam) => {
        const key = `${structure.id}_${defExam.id}`;
        const termObj = terms.find((t) => t.id === defExam.termId);
        const termName = termObj?.name || defExam.termId;

        // Calculate maximum marks: explicit defExam.maxMarks, or sum of applicable components
        let maxMarks = defExam.maxMarks ?? 0;
        if (!maxMarks && defExam.applicableComponentIds && version.assessmentComponents) {
          const comps = version.assessmentComponents.filter((c) =>
            defExam.applicableComponentIds.includes(c.id)
          );
          maxMarks = comps.reduce((acc, c) => acc + (c.testedMaxMarks ?? c.maxMarks ?? 0), 0);
        }
        if (!maxMarks) maxMarks = 100;

        let passingMarks = defExam.passingMarks;
        if (passingMarks === undefined && version.gradingScale?.passingPercentage) {
          passingMarks = Math.round((maxMarks * version.gradingScale.passingPercentage) / 100);
        }

        if (seenExamKeys.has(key)) {
          // Add grade to existing
          const existing = list.find((e) => e.id === defExam.id && e.structureId === structure.id);
          if (existing && !existing.applicableGrades.includes(grade)) {
            existing.applicableGrades.push(grade);
          }
          return;
        }

        seenExamKeys.add(key);

        // Evaluate overall availability status across teacher's assigned classes
        let status: DynamicConfiguredExam["overallStatus"] = "not_scheduled";
        let statusLabel = "Awaiting Exam Schedule";

        // Check if scheduled in any of teacher's grades
        const matchingScheds = allGradeSchedules.filter(
          (s) =>
            s.id === defExam.id ||
            s.definedExamId === defExam.id ||
            s.examType.toLowerCase() === defExam.name.toLowerCase()
        );

        if (matchingScheds.length === 0) {
          status = "not_scheduled";
          statusLabel = "Awaiting Exam Schedule";
        } else {
          const hasApproved = matchingScheds.some((s) => s.status === "approved");
          if (!hasApproved) {
            status = "awaiting_approval";
            statusLabel = "Awaiting Schedule Approval";
          } else {
            // Check if any scheduled date has concluded
            const now = new Date();
            let hasConcluded = false;

            matchingScheds.forEach((s) => {
              if (s.status === "approved" && s.exams) {
                s.exams.forEach((ex) => {
                  const dateStr = ex.date;
                  if (dateStr) {
                    const todayStr = now.toISOString().slice(0, 10);
                    if (todayStr > dateStr.slice(0, 10)) {
                      hasConcluded = true;
                    }
                  }
                });
              }
            });

            if (hasConcluded) {
              status = "available";
              statusLabel = "Available for Marks Entry";
            } else {
              status = "not_conducted";
              statusLabel = "Exam Not Yet Conducted";
            }
          }
        }

        list.push({
          id: defExam.id,
          name: defExam.name,
          code: defExam.code,
          termId: defExam.termId,
          termName,
          academicYear: effectiveSessionName,
          maxMarks,
          passingMarks,
          applicableComponentIds: defExam.applicableComponentIds || [],
          applicableGrades: [grade],
          structureId: structure.id,
          structureVersionNumber: version.versionNumber,
          overallStatus: status,
          overallStatusLabel: statusLabel,
        });
      });
    });

    list.sort((a, b) => a.termName.localeCompare(b.termName) || a.name.localeCompare(b.name));
    return list;
  }, [gradeStructureMap, allGradeSchedules, effectiveSessionName]);

  // Selected Exam Object
  const selectedExam = useMemo(() => {
    return dynamicConfiguredExams.find((e) => e.id === selectedExamId) || null;
  }, [dynamicConfiguredExams, selectedExamId]);

  // 3. RESOLVE ONLY TEACHER'S ASSIGNED CLASSES & ELIGIBILITY FOR THE SELECTED EXAM
  const [assignedClassSubjectOptions, setAssignedClassSubjectOptions] = useState<AssignedClassSubjectOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    if (!selectedExam) {
      setAssignedClassSubjectOptions([]);
      return;
    }

    const checkEligibility = async () => {
      setLoadingOptions(true);
      const results: AssignedClassSubjectOption[] = [];

      for (const sec of assignedSections) {
        const subjs = assignedSubjectsBySection[sec.id] || [];
        for (const sub of subjs) {
          const el = await validateExamScheduleEligibility({
            sessionId: effectiveSessionId,
            grade: sec.grade,
            sectionId: sec.id,
            subjectId: sub.id,
            examId: selectedExam.id,
            termId: selectedExam.termId,
          });

          results.push({
            section: sec,
            subject: sub,
            eligibility: el,
          });
        }
      }

      setAssignedClassSubjectOptions(results);

      // Auto-select first eligible combination if none selected or current invalid
      const firstEligible = results.find((r) => r.eligibility.eligible);
      if (firstEligible) {
        setSelectedSectionId(firstEligible.section.id);
        setSelectedSubjectId(firstEligible.subject.id);
      } else if (results.length > 0) {
        setSelectedSectionId(results[0].section.id);
        setSelectedSubjectId(results[0].subject.id);
      }
      setLoadingOptions(false);
    };

    checkEligibility();
  }, [selectedExam, assignedSections, assignedSubjectsBySection, effectiveSessionId]);

  // Selected Option Object & Eligibility
  const selectedOption = useMemo(() => {
    return (
      assignedClassSubjectOptions.find(
        (o) => o.section.id === selectedSectionId && o.subject.id === selectedSubjectId
      ) || null
    );
  }, [assignedClassSubjectOptions, selectedSectionId, selectedSubjectId]);

  const selectedSection = useMemo(() => {
    return assignedSections.find((s) => s.id === selectedSectionId) || null;
  }, [assignedSections, selectedSectionId]);

  const selectedSubject = useMemo(() => {
    const subjs = assignedSubjectsBySection[selectedSectionId] || [];
    return subjs.find((s) => s.id === selectedSubjectId) || null;
  }, [assignedSubjectsBySection, selectedSectionId, selectedSubjectId]);

  // Resolved Academic Structure for the selected grade
  const currentGradeStructure = useMemo(() => {
    if (!selectedSection) return null;
    return gradeStructureMap[selectedSection.grade] || null;
  }, [gradeStructureMap, selectedSection]);

  // Active Assessment Components for this subject & exam
  const activeComponents = useMemo(() => {
    if (!currentGradeStructure?.version || !selectedExam || !selectedSubjectId) return [];
    const effRes = getEffectiveComponentsForSubject(
      currentGradeStructure.version,
      selectedExam.termId,
      selectedSubjectId
    );
    const allEffective = Array.isArray(effRes) ? effRes : (effRes?.components || []);

    // If DefinedExam specifies applicableComponentIds, filter strictly to those
    if (selectedExam.applicableComponentIds && selectedExam.applicableComponentIds.length > 0) {
      const filtered = allEffective.filter((c) => selectedExam.applicableComponentIds.includes(c.id));
      if (filtered.length > 0) return filtered;
    }

    return allEffective;
  }, [currentGradeStructure, selectedExam, selectedSubjectId]);

  // Active Grading Scale
  const activeScale = useMemo(() => {
    return (
      currentGradeStructure?.version?.gradingScale || {
        id: "default",
        name: "Default",
        tiers: [],
        passingPercentage: 33,
      }
    );
  }, [currentGradeStructure]);

  // 4. LOAD DESIGNATED STUDENT ROSTER & MARKS
  useEffect(() => {
    if (
      !selectedExam ||
      !selectedSectionId ||
      !selectedSubjectId ||
      !selectedOption?.eligibility.eligible ||
      !currentGradeStructure
    ) {
      setStudents([]);
      setMarksState({});
      setCurrentWorkflowStatus("draft");
      setIsEditingSubmitted(false);
      return;
    }

    const loadRosterAndMarks = async () => {
      setLoadingStudents(true);
      try {
        // 1. Authoritative active enrollments for this section
        const enrollQ = query(
          collection(db, "enrollments"),
          where("sectionId", "==", selectedSectionId),
          where("status", "==", "active")
        );
        const enrollSnap = await getDocs(enrollQ);
        const enrollments = enrollSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));

        // 2. Fetch student profiles (permanent Student UID)
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

        studentRows.sort((a, b) => a.studentName.localeCompare(b.studentName));
        setStudents(studentRows);

        // 3. Load existing marks entries
        const existingEntries = await fetchMarksEntriesForSection({
          sessionId: effectiveSessionId,
          sectionId: selectedSectionId,
          subjectId: selectedSubjectId,
          examId: selectedExam.id,
          termId: selectedExam.termId,
        });

        const newMarksState: Record<string, Record<string, ComponentScoreInput>> = {};
        let detectedStatus = "draft";

        studentRows.forEach((stu) => {
          const rec =
            existingEntries[stu.studentUid] ||
            existingEntries[stu.studentDocId] ||
            existingEntries[stu.studentId];

          if (rec) {
            newMarksState[stu.studentId] = rec.componentMarks || {};
            if (rec.workflowStatus) detectedStatus = rec.workflowStatus;
          } else {
            newMarksState[stu.studentId] = {};
            activeComponents.forEach((c) => {
              newMarksState[stu.studentId][c.id] = { marks: null, status: "present" };
            });
          }
        });

        setMarksState(newMarksState);
        setCurrentWorkflowStatus(detectedStatus);
        setIsEditingSubmitted(false);
      } catch (err) {
        console.error("Failed to load students and marks:", err);
      } finally {
        setLoadingStudents(false);
      }
    };

    loadRosterAndMarks();
  }, [
    selectedExam,
    selectedSectionId,
    selectedSubjectId,
    selectedOption?.eligibility.eligible,
    currentGradeStructure,
    activeComponents,
    effectiveSessionId,
  ]);

  // Score Input Change Handler
  const handleScoreChange = (studentId: string, componentId: string, marksVal: string) => {
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

  // Toggle Absent Status
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

  // Toggle Exempt Status
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

  // SAVE & SUBMIT HANDLER
  const handleSaveMarks = async (targetStatus: "draft" | "submitted") => {
    if (
      !selectedExam ||
      !selectedSection ||
      !selectedSubject ||
      !currentGradeStructure ||
      !appUser
    ) {
      return;
    }

    try {
      setSaving(true);

      // Validate numeric bounds & completeness
      for (const stu of students) {
        const scores = marksState[stu.studentId] || {};
        for (const comp of activeComponents) {
          const entry = scores[comp.id];
          if (
            entry &&
            entry.status === "present" &&
            entry.marks !== null &&
            entry.marks !== undefined &&
            (entry.marks as any) !== ""
          ) {
            const num = Number(entry.marks);
            const entryMax = comp.testedMaxMarks ?? comp.maxMarks;
            if (isNaN(num)) {
              toast({
                title: "Invalid Marks Value",
                description: `${stu.studentName}: Value for ${comp.name} must be a number.`,
                variant: "destructive",
              });
              setSaving(false);
              return;
            }
            if (num < 0) {
              toast({
                title: "Negative Marks Rejected",
                description: `${stu.studentName}: ${comp.name} cannot have negative marks (${num}).`,
                variant: "destructive",
              });
              setSaving(false);
              return;
            }
            if (num > entryMax) {
              toast({
                title: "Marks Exceed Configured Maximum",
                description: `${stu.studentName}: ${comp.name} marks (${num}) exceed configured maximum of ${entryMax}.`,
                variant: "destructive",
              });
              setSaving(false);
              return;
            }
          } else if (targetStatus === "submitted" && (!entry || (entry.status === "present" && (entry.marks === null || entry.marks === undefined)))) {
            // Require all scores or explicit AB/EX on final submission
            toast({
              title: "Incomplete Marks Submission",
              description: `Please enter marks or mark AB/EX for ${stu.studentName} (${comp.name}) before submitting.`,
              variant: "destructive",
            });
            setSaving(false);
            return;
          }
        }
      }

      const studentsPayload = students.map((stu) => ({
        studentUid: stu.studentUid,
        studentDocId: stu.studentDocId,
        studentId: stu.studentUid,
        studentName: stu.studentName,
        rollNo: stu.rollNo,
        admissionNo: stu.admissionNo,
        componentInputs: marksState[stu.studentId] || {},
      }));

      const res = await saveMarksEntriesBatch({
        sessionId: effectiveSessionId,
        academicYear: effectiveSessionName,
        structureId: currentGradeStructure.structure.id,
        structureVersion: currentGradeStructure.version.versionNumber,
        grade: selectedSection.grade,
        sectionId: selectedSection.id,
        subjectId: selectedSubject.id,
        termId: selectedExam.termId,
        termName: selectedExam.termName,
        examId: selectedExam.id,
        components: activeComponents,
        scale: activeScale,
        calculationConfig: currentGradeStructure.version.calculationConfig,
        studentsMarks: studentsPayload,
        targetStatus,
        user: { uid: appUser.id, name: appUser.name, role: appUser.role },
        isEditResubmission: isEditingSubmitted,
      });

      if (res.errors.length > 0) {
        toast({
          title: "Marks Validation Warning",
          description: res.errors.slice(0, 3).join("; "),
          variant: "destructive",
        });
      } else {
        toast({
          title: targetStatus === "submitted" ? "Marks Submitted to HOD" : "Draft Saved",
          description: `Successfully saved marks for ${res.savedCount} students.`,
        });
        setCurrentWorkflowStatus(targetStatus);
        setIsEditingSubmitted(false);
      }
    } catch (err: any) {
      console.error("Save marks failed:", err);
      toast({
        title: "Submission Blocked",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Determine read-only / locking state
  const isLocked =
    currentWorkflowStatus === "verified" ||
    currentWorkflowStatus === "published" ||
    currentWorkflowStatus === "locked";

  const isEditable = !isLocked && (currentWorkflowStatus === "draft" || isEditingSubmitted);

  return (
    <div data-testid="teacher-marks-entry" className="space-y-6">
      {/* 1. Header Banner */}
      <div className="gradient-banner rounded-2xl p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-blue-500/20 text-blue-200 border border-blue-400/30">
            Session: {effectiveSessionName}
          </span>
          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
            CBSE Academic Structure Planner Active
          </span>
          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-purple-500/20 text-purple-200 border border-purple-400/30">
            Teacher: {appUser?.name || "Faculty"}
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Teacher Marks Entry</h1>
        <p className="mt-1 text-sm text-slate-300">
          Authoritative marks entry powered dynamically by your school's Academic Structure Planner.
        </p>
      </div>

      {loadingInitial ? (
        <div className="space-y-6">
          <CardGridSkeleton count={4} columns={4} />
          <TableSkeleton rows={6} columns={6} />
        </div>
      ) : (
        <>
          {/* STEP 1: CONFIGURED EXAMINATIONS (DYNAMICALLY LOADED FROM ACADEMIC STRUCTURE) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white text-[11px] font-bold">
                    1
                  </span>
                  Configured Examinations (Academic Structure Planner)
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select an examination defined in your school's active Academic Structure.
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-normal">
                {dynamicConfiguredExams.length} Configured Assessments
              </Badge>
            </div>

            {dynamicConfiguredExams.length === 0 ? (
              <Card className="rounded-2xl border-dashed p-8 text-center text-muted-foreground">
                <AlertCircle className="mx-auto h-8 w-8 text-amber-500 mb-2" />
                <p className="text-sm font-medium">No active Academic Structure configured for your assigned grades.</p>
                <p className="text-xs mt-1 text-muted-foreground">
                  Please ask the School Administrator to publish an Academic Structure under Academic Structure Planner.
                </p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {dynamicConfiguredExams.map((exam) => {
                  const isSelected = selectedExamId === exam.id;

                  // Status styling
                  const statusConfig = {
                    available: {
                      border: "border-emerald-200 bg-emerald-50/50 text-emerald-800",
                      badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
                    },
                    submitted: {
                      border: "border-purple-200 bg-purple-50/50 text-purple-800",
                      badge: "bg-purple-100 text-purple-800 border-purple-300",
                    },
                    locked: {
                      border: "border-slate-200 bg-slate-50/70 text-slate-700",
                      badge: "bg-slate-200 text-slate-800 border-slate-300",
                    },
                    not_conducted: {
                      border: "border-blue-200 bg-blue-50/50 text-blue-800",
                      badge: "bg-blue-100 text-blue-800 border-blue-300",
                    },
                    awaiting_approval: {
                      border: "border-amber-200 bg-amber-50/50 text-amber-800",
                      badge: "bg-amber-100 text-amber-800 border-amber-300",
                    },
                    not_scheduled: {
                      border: "border-slate-200 bg-slate-50/30 text-slate-600",
                      badge: "bg-slate-100 text-slate-700 border-slate-200",
                    },
                  }[exam.overallStatus];

                  return (
                    <div
                      key={exam.id}
                      onClick={() => {
                        setSelectedExamId(exam.id);
                      }}
                      className={`relative rounded-xl border p-4 cursor-pointer transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-2 ring-primary/30 shadow-md"
                          : "border-border hover:border-primary/50 hover:bg-muted/30 bg-card"
                      }`}
                    >
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-1 mb-2">
                        <Badge variant="outline" className="text-[10px] uppercase font-semibold py-0 px-1.5">
                          {exam.termName}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] font-medium py-0 px-1.5 border ${statusConfig.badge}`}>
                          {exam.overallStatusLabel}
                        </Badge>
                      </div>

                      {/* Exam Title */}
                      <h3 className="text-sm font-bold text-foreground leading-snug line-clamp-2">
                        {exam.name}
                      </h3>

                      {/* Configured Metrics */}
                      <div className="mt-2.5 pt-2 border-t border-border/60 flex items-center justify-between text-xs font-mono">
                        <span className="text-foreground font-semibold">
                          Max: <strong className="text-primary">{exam.maxMarks}M</strong>
                        </span>
                        {exam.passingMarks !== undefined && (
                          <span className="text-muted-foreground text-[11px]">
                            Pass: {exam.passingMarks}M
                          </span>
                        )}
                      </div>

                      {/* Applicable Grades */}
                      <div className="mt-2 text-[10px] text-muted-foreground flex items-center justify-between">
                        <span>Grades: {exam.applicableGrades.join(", ")}</span>
                        {isSelected && (
                          <span className="text-primary font-bold flex items-center gap-0.5">
                            <Check size={12} /> Selected
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* STEP 2: ASSIGNED CLASSES & SECTIONS SELECTION */}
          {selectedExam && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white text-[11px] font-bold">
                      2
                    </span>
                    Select Assigned Class & Subject
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Showing only classes and subjects assigned to your account. Schedule eligibility is verified automatically.
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {assignedClassSubjectOptions.length} Assigned Combinations
                </Badge>
              </div>

              {loadingOptions ? (
                <div className="py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="animate-spin h-4 w-4 text-primary" /> Validating schedules and permissions...
                </div>
              ) : assignedClassSubjectOptions.length === 0 ? (
                <Card className="rounded-xl border p-6 text-center text-muted-foreground">
                  <AlertCircle className="mx-auto h-6 w-6 text-amber-500 mb-1" />
                  <p className="text-sm font-medium">No assigned classes found for this examination.</p>
                  <p className="text-xs mt-1 text-muted-foreground">
                    You do not have active teaching assignments for the grades applicable to {selectedExam.name}.
                  </p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {assignedClassSubjectOptions.map((opt) => {
                    const isSelected =
                      selectedSectionId === opt.section.id && selectedSubjectId === opt.subject.id;
                    const { eligible, status, reason, scheduledDate, scheduledEndTime } = opt.eligibility;

                    return (
                      <div
                        key={`${opt.section.id}_${opt.subject.id}`}
                        onClick={() => {
                          setSelectedSectionId(opt.section.id);
                          setSelectedSubjectId(opt.subject.id);
                        }}
                        className={`rounded-xl border p-3.5 cursor-pointer transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5 ring-2 ring-primary/30 shadow-sm"
                            : eligible
                            ? "border-border hover:border-primary/40 bg-card hover:bg-muted/20"
                            : "border-border/60 bg-muted/10 hover:border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div>
                            <span className="text-xs font-bold text-foreground">
                              Grade {opt.section.grade} - {opt.section.name}
                            </span>
                            <span className="text-xs block text-primary font-medium">
                              {opt.subject.name}
                            </span>
                          </div>
                          <Badge
                            variant="outline"
                            className={`text-[10px] py-0 px-1.5 font-medium shrink-0 ${
                              eligible
                                ? status === "submitted"
                                  ? "bg-purple-100 text-purple-800 border-purple-300"
                                  : "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : status === "locked"
                                ? "bg-slate-200 text-slate-800 border-slate-300"
                                : "bg-amber-100 text-amber-800 border-amber-300"
                            }`}
                          >
                            {status === "available"
                              ? "Eligible for Entry"
                              : status === "submitted"
                              ? "Marks Submitted"
                              : status === "locked"
                              ? "Locked / Published"
                              : status === "not_conducted"
                              ? "Exam Upcoming"
                              : status === "awaiting_approval"
                              ? "Awaiting Approval"
                              : "Not Scheduled"}
                          </Badge>
                        </div>

                        {/* Schedule Metadata */}
                        <div className="text-[11px] text-muted-foreground mt-2 border-t pt-1.5 flex flex-col gap-0.5">
                          {scheduledDate ? (
                            <span className="flex items-center gap-1">
                              <Calendar size={11} className="text-muted-foreground shrink-0" />
                              Scheduled: {scheduledDate} {scheduledEndTime ? `(${scheduledEndTime})` : ""}
                            </span>
                          ) : (
                            <span className="text-amber-600 text-[10px]">{reason}</span>
                          )}
                          {!eligible && scheduledDate && (
                            <span className="text-amber-700 text-[10px] mt-0.5 leading-snug font-medium">
                              {reason}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: STUDENT ROSTER & MARKS REGISTER */}
          {selectedExam && selectedOption && (
            <div className="space-y-4 pt-3">
              {/* If ineligible, show why marks entry is blocked */}
              {!selectedOption.eligibility.eligible && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
                  <div>
                    <h3 className="text-sm font-semibold">Marks Entry Unavailable</h3>
                    <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                      {selectedOption.eligibility.reason}
                    </p>
                    {selectedOption.eligibility.status === "awaiting_approval" && (
                      <p className="text-xs text-amber-700 mt-1.5 font-medium">
                        The examination timetable has been submitted by the HOD and is awaiting formal approval from the Principal under <em>Admin &gt; Exam Approvals</em>.
                      </p>
                    )}
                    {selectedOption.eligibility.status === "not_conducted" && (
                      <p className="text-xs text-blue-700 mt-1.5 font-medium">
                        Per academic rules, marks entry unlocks after the exam date has passed in the school's time zone.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Workflow Status Banners */}
              {selectedOption.eligibility.eligible && (
                <>
                  {currentWorkflowStatus === "submitted" && !isEditingSubmitted && (
                    <div className="bg-purple-50 border border-purple-200 text-purple-900 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-medium">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="text-purple-600 shrink-0" size={16} />
                        <span>
                          Marks for this class have been <strong>SUBMITTED TO HOD</strong> for verification. You can review the submitted marks below or click <strong>Edit Marks</strong> to make changes before verification.
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsEditingSubmitted(true)}
                        className="bg-purple-600 hover:bg-purple-700 text-white border-0 text-xs shrink-0 gap-1.5"
                      >
                        <Edit3 size={13} /> Edit Marks
                      </Button>
                    </div>
                  )}

                  {isEditingSubmitted && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-medium">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="text-amber-600 shrink-0" size={16} />
                        <span>
                          <strong>Editing Submitted Marks:</strong> Any score adjustments are audited and will require resubmission to the HOD.
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setIsEditingSubmitted(false)}
                          className="text-xs text-amber-900 hover:bg-amber-100"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSaveMarks("submitted")}
                          disabled={saving}
                          className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5"
                        >
                          <Send size={13} /> Resubmit to HOD
                        </Button>
                      </div>
                    </div>
                  )}

                  {isLocked && (
                    <div className="bg-slate-100 border border-slate-300 text-slate-800 rounded-xl p-3.5 flex items-center justify-between text-xs font-medium">
                      <div className="flex items-center gap-2">
                        <Lock className="text-slate-600 shrink-0" size={16} />
                        <span>
                          These marks have been <strong>{currentWorkflowStatus.toUpperCase()}</strong> by the Academic Office and are currently locked in read-only mode.
                        </span>
                      </div>
                      <Badge variant="outline" className="border-slate-400 text-slate-800 uppercase">
                        {currentWorkflowStatus}
                      </Badge>
                    </div>
                  )}
                </>
              )}

              {/* Roster & Marks Table */}
              {selectedOption.eligibility.eligible && (
                <Card className="rounded-2xl border shadow-sm overflow-hidden">
                  <CardHeader className="pb-3 border-b bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <FileSpreadsheet size={18} className="text-primary" />
                        Student Marks Register
                        <span className="text-xs font-normal text-muted-foreground">
                          (Grade {selectedSection?.grade} {selectedSection?.name} • {selectedSubject?.name} • {students.length} Students)
                        </span>
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Assessment components defined in {currentGradeStructure?.structure.name} (Max: {selectedExam.maxMarks}M
                        {selectedExam.passingMarks !== undefined ? ` • Pass: ${selectedExam.passingMarks}M` : ""}).
                      </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditable && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSaveMarks("draft")}
                            disabled={saving || loadingStudents || students.length === 0}
                            className="gap-1.5 text-xs"
                          >
                            <Save size={14} /> Save Draft
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSaveMarks("submitted")}
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
                        <p className="text-xs">Loading student roster and persisted marks...</p>
                      </div>
                    ) : students.length === 0 ? (
                      <div className="py-16 text-center text-muted-foreground">
                        <p className="text-sm font-medium">No students enrolled in this section.</p>
                        <p className="text-xs mt-1">Check active student enrollments for Grade {selectedSection?.grade} Section {selectedSection?.name}.</p>
                      </div>
                    ) : (
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-muted/50 border-b text-muted-foreground font-semibold">
                            <th className="py-3 px-3 w-12 text-center">Roll</th>
                            <th className="py-3 px-4 min-w-[180px]">Student Details</th>
                            {activeComponents.map((comp) => (
                              <th key={comp.id} className="py-3 px-2 text-center min-w-[110px]">
                                <div>{comp.name}</div>
                                <div className="text-[10px] font-normal text-muted-foreground font-mono">
                                  {comp.code} (Max: {comp.testedMaxMarks ?? comp.maxMarks})
                                  {comp.calculationMethod === "scale_to_target" && (
                                    <span className="block text-[8px] text-amber-600 font-semibold">
                                      → {comp.scalingTargetMarks}M target
                                    </span>
                                  )}
                                </div>
                              </th>
                            ))}
                            <th className="py-3 px-3 text-center min-w-[80px]">Total</th>
                            <th className="py-3 px-3 text-center min-w-[70px]">Grade</th>
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
                              calculationConfig: currentGradeStructure?.version?.calculationConfig,
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
                                  <div className="text-[10px] text-muted-foreground font-mono">
                                    {stu.admissionNo ? `Adm: ${stu.admissionNo} • ` : ""}UID: {stu.studentUid.slice(0, 12)}...
                                  </div>
                                </td>

                                {activeComponents.map((comp) => {
                                  const cellVal = studentScores[comp.id]?.marks ?? "";
                                  const cellStatus = studentScores[comp.id]?.status || "present";
                                  const entryMax = comp.testedMaxMarks ?? comp.maxMarks;
                                  const isInvalid =
                                    cellVal !== "" && (Number(cellVal) > entryMax || Number(cellVal) < 0);

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
                                        <div className="relative inline-block">
                                          <Input
                                            type="number"
                                            min={0}
                                            max={entryMax}
                                            disabled={!isEditable}
                                            value={cellVal}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              if (val !== "" && Number(val) < 0) return;
                                              handleScoreChange(stu.studentId, comp.id, val);
                                            }}
                                            className={`h-8 text-center text-xs font-semibold mx-auto w-20 ${
                                              isInvalid
                                                ? "border-red-500 bg-red-50 text-red-700 ring-1 ring-red-400"
                                                : ""
                                            }`}
                                          />
                                          {isInvalid && (
                                            <span className="block text-[9px] text-red-600 font-medium mt-0.5">
                                              Max {entryMax}
                                            </span>
                                          )}
                                        </div>
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

                                {/* Action: AB / EX quick toggles */}
                                <td className="py-2.5 px-3 text-center space-x-1">
                                  {isEditable && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleAbsent(stu.studentId)}
                                        className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                                          isAbsent
                                            ? "bg-rose-600 text-white border-rose-600"
                                            : "text-muted-foreground hover:bg-muted"
                                        }`}
                                        title="Toggle Absent"
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
                                        title="Toggle Exempt"
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
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

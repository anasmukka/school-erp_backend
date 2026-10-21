import { useEffect, useState } from "react";
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
import type { Subject, ExamSchedule, Student, Enrollment } from "@/lib/types";
import {
  getActiveStructureForGrade,
  AcademicStructure,
  AcademicStructureVersion,
} from "@/lib/academicStructure";
import {
  resolveUserAcademicIdentity,
  MarksEntryRecord,
} from "@/lib/resultEngine";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileSpreadsheet,
  Award,
  Calendar,
  CheckCircle2,
  Clock,
  School,
  Lock,
  AlertCircle,
} from "lucide-react";
import { PageSkeleton } from "@/components/common/Skeletons";

export default function StudentResults() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "";

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [structureInfo, setStructureInfo] = useState<{
    structure: AcademicStructure;
    version: AcademicStructureVersion;
  } | null>(null);

  const [approvedExams, setApprovedExams] = useState<ExamSchedule[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [subjects, setSubjects] = useState<Subject[]>([]);

  // Publications map: examId -> isPublished
  const [publicationsMap, setPublicationsMap] = useState<Record<string, any>>({});
  // Published marks for the selected exam: subjectId -> MarksEntryRecord
  const [publishedMarks, setPublishedMarks] = useState<Record<string, MarksEntryRecord>>({});

  useEffect(() => {
    if (!appUser) return;

    const loadStudentData = async () => {
      try {
        setLoading(true);

        // 1. Resolve canonical identity
        const identity = await resolveUserAcademicIdentity(appUser.id);
        const stuUid = identity.studentUid || identity.studentDocId || appUser.id;

        let stuData: Student | null = null;
        let stuDocId = identity.studentDocId;

        if (stuDocId) {
          const sDoc = await getDoc(doc(db, "students", stuDocId));
          if (sDoc.exists()) stuData = { id: sDoc.id, ...sDoc.data() } as Student;
        }

        if (!stuData) {
          const q = query(collection(db, "students"), where("studentUid", "==", stuUid));
          const snap = await getDocs(q);
          if (!snap.empty) {
            stuData = { id: snap.docs[0].id, ...snap.docs[0].data() } as Student;
            stuDocId = snap.docs[0].id;
          }
        }

        if (!stuData) {
          setLoading(false);
          return;
        }

        setStudent(stuData);

        // 2. Fetch active enrollment
        const enrSnap = await getDocs(
          query(
            collection(db, "enrollments"),
            where("studentId", "==", stuDocId),
            where("status", "==", "active")
          )
        );

        let enrData: Enrollment | null = null;
        if (!enrSnap.empty) {
          enrData = enrSnap.docs[0].data() as Enrollment;
          setEnrollment(enrData);
        }

        const grade = enrData?.className || (enrData as any)?.grade || stuData.grade || "";
        const sectionId = enrData?.sectionId || stuData.sectionId || "";

        // 3. Fetch academic structure, subjects, and exams for this grade
        const [structRes, subjSnap, examSnap] = await Promise.all([
          getActiveStructureForGrade(grade, effectiveSessionId),
          getDocs(query(collection(db, "subjects"), where("grade", "==", grade))),
          getDocs(
            query(
              collection(db, "examSchedules"),
              where("grade", "==", grade),
              where("status", "==", "approved")
            )
          ),
        ]);

        setStructureInfo(structRes);
        const subjs = subjSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Subject))
          .filter((s) => s.category !== "co-scholastic");
        setSubjects(subjs);

        const exams = examSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamSchedule));
        setApprovedExams(exams);

        // 4. Check which exams have been published for this section
        const pubMap: Record<string, any> = {};
        if (sectionId) {
          await Promise.all(
            exams.map(async (ex) => {
              const pubDoc = await getDoc(
                doc(db, "examResultPublications", `${effectiveSessionId}_${sectionId}_${ex.id}`)
              );
              if (pubDoc.exists() && pubDoc.data().workflowStatus === "published") {
                pubMap[ex.id] = pubDoc.data();
              }
            })
          );
        }
        setPublicationsMap(pubMap);

        // Auto-select first published exam, or first exam
        const firstPublished = exams.find((e) => pubMap[e.id]);
        if (firstPublished) {
          setSelectedExamId(firstPublished.id);
        } else if (exams.length > 0) {
          setSelectedExamId(exams[0].id);
        }
      } catch (err) {
        console.error("Error loading student results:", err);
      } finally {
        setLoading(false);
      }
    };

    loadStudentData();
  }, [appUser, effectiveSessionId]);

  // Load published marks whenever selected exam changes
  useEffect(() => {
    if (!student || !selectedExamId || !enrollment) return;

    const loadExamMarks = async () => {
      try {
        const stuUid = student.studentUid || student.admissionNo || student.id;
        const isExamPublished = Boolean(publicationsMap[selectedExamId]);

        // If exam is not published by HOD, do not show draft marks!
        if (!isExamPublished) {
          setPublishedMarks({});
          return;
        }

        const q = query(
          collection(db, "marksEntries"),
          where("sessionId", "==", effectiveSessionId),
          where("sectionId", "==", enrollment.sectionId),
          where("examId", "==", selectedExamId),
          where("workflowStatus", "==", "published")
        );

        const snap = await getDocs(q);
        const marks: Record<string, MarksEntryRecord> = {};

        snap.forEach((d) => {
          const data = d.data() as MarksEntryRecord;
          const stuKey = data.studentUid || data.studentId;
          if (stuKey === stuUid || stuKey === student.id) {
            marks[data.subjectId] = data;
          }
        });

        setPublishedMarks(marks);
      } catch (err) {
        console.error("Error loading published marks:", err);
      }
    };

    loadExamMarks();
  }, [student, selectedExamId, enrollment, publicationsMap, effectiveSessionId]);

  if (loading) {
    return <PageSkeleton />;
  }

  const selectedExam = approvedExams.find((e) => e.id === selectedExamId);
  const isPublished = Boolean(selectedExam && publicationsMap[selectedExam.id]);

  let totalEarned = 0;
  let totalMax = 0;
  let hasAnyMarks = false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/40">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-primary" />
            Examination Results
          </h1>
          <p className="text-sm text-muted-foreground">
            Official published results for individual unit, periodic, and term examinations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="px-3 py-1 text-xs">
            Academic Session: {workingSession?.name || "2026-27"}
          </Badge>
        </div>
      </div>

      {/* Student Profile Card */}
      <Card className="border shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Student Profile</span>
              <h2 className="text-lg font-bold text-slate-900">{student?.name}</h2>
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                <span>Admission No: <strong>{student?.admissionNo || "—"}</strong></span>
                <span>•</span>
                <span>Roll No: <strong>{student?.rollNo || "—"}</strong></span>
                <span>•</span>
                <span>Class: <strong>Grade {student?.grade || enrollment?.className || "—"} - {enrollment?.sectionName || (student as any)?.sectionName || "A"}</strong></span>
              </div>
            </div>

            {/* Exam Selector */}
            <div className="w-full sm:w-64 space-y-1">
              <label className="text-xs font-semibold text-slate-700">Select Examination</label>
              <Select value={selectedExamId} onValueChange={setSelectedExamId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose exam..." />
                </SelectTrigger>
                <SelectContent>
                  {approvedExams.map((ex) => (
                    <SelectItem key={ex.id} value={ex.id}>
                      {ex.examType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results View or Pending Notice */}
      {!isPublished ? (
        <Card className="border border-amber-200 bg-amber-50/40 shadow-sm p-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-amber-100 text-amber-600 mx-auto flex items-center justify-center">
            <Clock className="h-6 w-6" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-base font-bold text-amber-900">
              Results Pending Publication
            </h3>
            <p className="text-xs text-amber-800">
              Examination results for <strong>{selectedExam?.examType || "this examination"}</strong> have not yet been published by the Section Head / HOD. Official marks will appear here once verified and finalized.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 border-b border-border/40 bg-muted/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Award className="h-4 w-4 text-emerald-600" />
                Published Scorecard — {selectedExam?.examType}
              </CardTitle>
              <CardDescription className="text-xs">
                Verified official performance records published on{" "}
                {publicationsMap[selectedExam!.id]?.publishedAt
                  ? new Date(publicationsMap[selectedExam!.id].publishedAt).toLocaleDateString("en-IN")
                  : "recently"}.
              </CardDescription>
            </div>
            <Badge className="bg-emerald-600 text-white w-fit">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Published
            </Badge>
          </CardHeader>

          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[500px]">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="p-3 font-semibold text-slate-700">Subject</th>
                  <th className="p-3 font-semibold text-slate-700 text-center">Max Marks</th>
                  <th className="p-3 font-semibold text-slate-700 text-center">Marks Obtained</th>
                  <th className="p-3 font-semibold text-slate-700 text-center">Percentage</th>
                  <th className="p-3 font-semibold text-slate-700 text-center">Grade</th>
                  <th className="p-3 font-semibold text-slate-700 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {subjects.map((sub) => {
                  const rec = publishedMarks[sub.id];
                  if (rec) {
                    hasAnyMarks = true;
                    const score = rec.scaledTotalMarks ?? rec.totalRawMarks;
                    const isExemptOptional = Boolean((sub.isOptional || rec.isOptional) && rec.isExempt);
                    if (!isExemptOptional) {
                      totalEarned += score;
                      totalMax += rec.totalMaxMarks;
                    }

                    return (
                      <tr key={sub.id} className="hover:bg-muted/10 transition-colors">
                        <td className="p-3 font-medium text-slate-900">{sub.name}</td>
                        <td className="p-3 text-center text-slate-600">{rec.totalMaxMarks}</td>
                        <td className="p-3 text-center font-bold text-slate-900">
                          {rec.isAbsent ? "—" : Math.round(score)}
                        </td>
                        <td className="p-3 text-center font-semibold text-slate-700">
                          {rec.isAbsent ? "—" : `${rec.calculatedPercentage.toFixed(1)}%`}
                        </td>
                        <td className="p-3 text-center">
                          <Badge variant="outline" className="font-bold text-primary">
                            {rec.calculatedGrade || "A"}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          {rec.isAbsent ? (
                            <Badge variant="outline" className="text-rose-600 border-rose-300">Absent</Badge>
                          ) : rec.isExempt ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-300">Exempt</Badge>
                          ) : (
                            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Present</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  }

                  const definedExams = structureInfo?.version.exams || structureInfo?.version.definedExams || [];
                  const configuredExam = definedExams.find(
                    (e: any) => e.id === (selectedExam as any)?.definedExamId || e.id === selectedExam?.id
                  );
                  const dynamicMax = configuredExam?.maxMarks || sub.maxMarks || 100;

                  return (
                    <tr key={sub.id} className="hover:bg-muted/10 transition-colors">
                      <td className="p-3 font-medium text-slate-900">{sub.name}</td>
                      <td className="p-3 text-center text-slate-400">{dynamicMax}</td>
                      <td className="p-3 text-center text-slate-400">—</td>
                      <td className="p-3 text-center text-slate-400">—</td>
                      <td className="p-3 text-center text-slate-400">—</td>
                      <td className="p-3 text-center text-slate-400">Not Evaluated</td>
                    </tr>
                  );
                })}
              </tbody>

              {hasAnyMarks && (
                <tfoot>
                  <tr className="border-t-2 border-border/80 bg-muted/40 font-bold">
                    <td className="p-3 text-slate-900">Total Marks & Aggregate</td>
                    <td className="p-3 text-center text-slate-900">{totalMax > 0 ? totalMax : "—"}</td>
                    <td className="p-3 text-center text-slate-900">{totalMax > 0 ? Math.round(totalEarned) : "—"}</td>
                    <td className="p-3 text-center text-slate-900">
                      {totalMax > 0 ? `${((totalEarned / totalMax) * 100).toFixed(1)}%` : "Exempt / N/A"}
                    </td>
                    <td className="p-3 text-center">
                      <Badge className="bg-primary text-white font-bold">
                        {totalMax > 0
                          ? (totalEarned / totalMax >= 0.8 ? "A" : totalEarned / totalMax >= 0.6 ? "B" : totalEarned / totalMax >= 0.4 ? "C" : "D")
                          : "EX"}
                      </Badge>
                    </td>
                    <td className="p-3 text-center text-emerald-700">
                      {totalMax > 0 ? "PASSED" : "EXEMPT"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

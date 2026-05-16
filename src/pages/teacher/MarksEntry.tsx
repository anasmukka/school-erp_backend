import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection, query, where, getDocs, doc, setDoc, getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, Save, ChevronRight, AlertCircle, Lock, CalendarX, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Section, Subject, Student, SubjectAssignment } from "@/lib/types";

const EXAM_TYPES = ["Unit Test 1", "Term 1", "Unit Test 2", "Final Exam"];

function cbseGrade(marks: number | string): string {
  const n = Number(marks);
  if (isNaN(n) || marks === "") return "—";
  if (n >= 91) return "A1";
  if (n >= 81) return "A2";
  if (n >= 71) return "B1";
  if (n >= 61) return "B2";
  if (n >= 51) return "C1";
  if (n >= 41) return "C2";
  if (n >= 33) return "D";
  return "E";
}

const GRADE_COLOR: Record<string, string> = {
  A1: "text-green-700 bg-green-100", A2: "text-green-600 bg-green-50",
  B1: "text-blue-700 bg-blue-100",  B2: "text-blue-600 bg-blue-50",
  C1: "text-yellow-700 bg-yellow-100", C2: "text-yellow-600 bg-yellow-50",
  D:  "text-orange-700 bg-orange-100",
  E:  "text-red-700 bg-red-100",
};

function isLowerGrade(grade: string): boolean {
  const n = parseInt(grade, 10);
  return !isNaN(n) && n >= 1 && n <= 5;
}

function calcTotal(fields: MarkFields, lower: boolean): number {
  const pt = parseFloat(fields.perTest) || 0;
  const nb = parseFloat(fields.notebook) || 0;
  const se = parseFloat(fields.enrichment) || 0;
  const ex = parseFloat(fields.examMarks) || 0;
  return lower ? pt + nb + se + ex : pt + ex;
}

function calcGrade(fields: MarkFields, lower: boolean): string {
  const total = calcTotal(fields, lower);
  const normalized = lower ? total : Math.round((total / 90) * 100);
  return cbseGrade(normalized);
}

interface MarkFields {
  perTest: string;
  notebook: string;
  enrichment: string;
  examMarks: string;
}

function makeMarkId(studentId: string, examType: string, subjectId: string) {
  return `${studentId}_${examType.replace(/\s+/g, "_")}_${subjectId}`;
}

const UNIT_TEST_TYPES = ["Unit Test 1", "Unit Test 2"];
const TERM_EXAM_TYPES = ["Term 1", "Final Exam"];
function isUnitTest(et: string) { return UNIT_TEST_TYPES.includes(et); }
function isTermExam(et: string) { return TERM_EXAM_TYPES.includes(et); }

const PAIRED_UT: Record<string, string> = {
  "Term 1": "Unit Test 1",
  "Final Exam": "Unit Test 2",
};

export default function MarksEntry() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [teacherDocId, setTeacherDocId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<SubjectAssignment[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjectsMap, setSubjectsMap] = useState<Record<string, Subject>>({});
  const [loadingInit, setLoadingInit] = useState(true);

  const [selectedExam, setSelectedExam] = useState("");
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [marksInput, setMarksInput] = useState<Record<string, MarkFields>>({});
  const [blockedStudentIds, setBlockedStudentIds] = useState<Set<string>>(new Set());
  const [utPerTestMap, setUtPerTestMap] = useState<Record<string, number>>({});
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [tableVisible, setTableVisible] = useState(false);
  const [examScheduled, setExamScheduled] = useState<boolean | null>(null);
  const [checkingSchedule, setCheckingSchedule] = useState(false);

  useEffect(() => {
    if (!appUser) return;
    const init = async () => {
      try {
        let teacherSnap = await getDocs(
          query(collection(db, "teachers"), where("uid", "==", appUser.id))
        );
        if (teacherSnap.empty && appUser.email) {
          teacherSnap = await getDocs(
            query(collection(db, "teachers"), where("email", "==", appUser.email))
          );
          if (!teacherSnap.empty) {
            import("firebase/firestore").then(({ doc: fDoc, updateDoc }) => {
              updateDoc(fDoc(db, "teachers", teacherSnap.docs[0].id), { uid: appUser.id }).catch(() => {});
            });
          }
        }
        if (teacherSnap.empty) { setLoadingInit(false); return; }
        const tDocId = teacherSnap.docs[0].id;
        setTeacherDocId(tDocId);

        const assignSnap = await getDocs(
          query(collection(db, "subjectAssignments"), where("teacherId", "==", tDocId))
        );
        const allAssignments = assignSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SubjectAssignment));
        setAssignments(allAssignments);

        const uniqueSectionIds = [...new Set(allAssignments.map((a) => a.sectionId))];
        const uniqueSubjectIds = [...new Set(allAssignments.map((a) => a.subjectId))];

        const [sectionDocs, subjectDocs] = await Promise.all([
          Promise.all(uniqueSectionIds.map((id) => getDoc(doc(db, "sections", id)))),
          Promise.all(uniqueSubjectIds.map((id) => getDoc(doc(db, "subjects", id)))),
        ]);

        const fetchedSections: Section[] = sectionDocs
          .filter((d) => d.exists())
          .map((d) => ({ id: d.id, ...d.data() } as Section))
          .sort((a, b) => `${a.grade}${a.name}`.localeCompare(`${b.grade}${b.name}`));

        const fetchedSubjectsMap: Record<string, Subject> = {};
        subjectDocs.filter((d) => d.exists()).forEach((d) => {
          fetchedSubjectsMap[d.id] = { id: d.id, ...d.data() } as Subject;
        });

        setSections(fetchedSections);
        setSubjectsMap(fetchedSubjectsMap);
      } finally {
        setLoadingInit(false);
      }
    };
    init();
  }, [appUser]);

  useEffect(() => {
    if (!selectedExam || !selectedSection) {
      setExamScheduled(null);
      return;
    }
    let cancelled = false;
    const check = async () => {
      setCheckingSchedule(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, "exams"),
            where("grade", "==", selectedSection.grade),
            where("examType", "==", selectedExam)
          )
        );
        if (!cancelled) setExamScheduled(!snap.empty);
      } finally {
        if (!cancelled) setCheckingSchedule(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [selectedExam, selectedSection]);

  const subjectsForSection = useCallback((sectionId: string): Subject[] => {
    const subjectIds = assignments
      .filter((a) => a.sectionId === sectionId)
      .map((a) => a.subjectId);
    return subjectIds.map((id) => subjectsMap[id]).filter(Boolean);
  }, [assignments, subjectsMap]);

  const loadStudentsAndMarks = useCallback(async (
    section: Section,
    subject: Subject,
    examType: string,
    tDocId: string
  ) => {
    setLoadingStudents(true);
    setStudents([]);
    setMarksInput({});
    setSavedIds(new Set());
    setBlockedStudentIds(new Set());
    setUtPerTestMap({});
    setTableVisible(true);
    try {
      const pairedUT = isTermExam(examType) ? PAIRED_UT[examType] : null;

      const queries: Promise<any>[] = [
        getDocs(query(collection(db, "students"), where("sectionId", "==", section.id))),
        getDocs(query(
          collection(db, "marks"),
          where("sectionId", "==", section.id),
          where("subjectId", "==", subject.id),
          where("examType", "==", examType),
          where("teacherId", "==", tDocId)
        )),
        getDocs(query(
          collection(db, "marks"),
          where("sectionId", "==", section.id),
          where("subjectId", "==", subject.id),
          where("examType", "==", examType)
        )),
      ];

      if (pairedUT) {
        queries.push(getDocs(query(
          collection(db, "marks"),
          where("sectionId", "==", section.id),
          where("subjectId", "==", subject.id),
          where("examType", "==", pairedUT)
        )));
      }

      const results = await Promise.all(queries);
      const [studentSnap, myMarksSnap, allMarksSnap, utSnap] = results;

      const fetchedStudents = studentSnap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Student));
      const existingMarks: Record<string, MarkFields> = {};
      const existingSaved = new Set<string>();
      const otherTeacherBlocked = new Set<string>();
      const utPerTest: Record<string, number> = {};

      myMarksSnap.docs.forEach((d: any) => {
        const m = d.data();
        existingMarks[m.studentId] = {
          perTest: m.perTest !== undefined ? String(m.perTest) : "",
          notebook: m.notebook !== undefined ? String(m.notebook) : "",
          enrichment: m.enrichment !== undefined ? String(m.enrichment) : "",
          examMarks: m.examMarks !== undefined ? String(m.examMarks) : (m.marks !== undefined ? String(m.marks) : ""),
        };
        existingSaved.add(m.studentId);
      });

      allMarksSnap.docs.forEach((d: any) => {
        const m = d.data();
        if (m.teacherId !== tDocId) {
          otherTeacherBlocked.add(m.studentId);
        }
      });

      if (utSnap) {
        utSnap.docs.forEach((d: any) => {
          const m = d.data();
          if (m.studentId && m.perTest !== undefined) {
            utPerTest[m.studentId] = Number(m.perTest) || 0;
          }
        });
      }

      setStudents(fetchedStudents);
      setMarksInput(existingMarks);
      setSavedIds(existingSaved);
      setBlockedStudentIds(otherTeacherBlocked);
      setUtPerTestMap(utPerTest);
    } finally {
      setLoadingStudents(false);
    }
  }, []);

  const handleLoadStudents = () => {
    if (!selectedExam || !selectedSection || !selectedSubject || !teacherDocId) return;
    loadStudentsAndMarks(selectedSection, selectedSubject, selectedExam, teacherDocId);
  };

  const handleSave = async () => {
    if (!selectedSection || !selectedSubject || !selectedExam || !teacherDocId) return;
    const lower = isLowerGrade(selectedSection.grade);
    const ut = isUnitTest(selectedExam);
    const te = isTermExam(selectedExam);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const gradeNum = parseInt(selectedSection.grade, 10) || 0;

      const studentsToSave = students.filter((s) => {
        if (blockedStudentIds.has(s.id)) return false;
        const f = marksInput[s.id];
        if (!f) return false;
        if (ut) return f.perTest !== "" && !isNaN(parseFloat(f.perTest));
        if (te) return f.examMarks !== "" && !isNaN(parseFloat(f.examMarks));
        const hasExam = f.examMarks !== "" && !isNaN(parseFloat(f.examMarks));
        const hasPt = f.perTest !== "" && !isNaN(parseFloat(f.perTest));
        return hasPt || hasExam;
      });

      if (studentsToSave.length === 0) {
        toast({ title: "No marks to save", description: "Enter marks for at least one student." });
        return;
      }

      const existingDocs = await Promise.all(
        studentsToSave.map((s) => getDoc(doc(db, "marks", makeMarkId(s.id, selectedExam, selectedSubject.id))))
      );

      const conflicting: string[] = [];
      const writeQueue: Promise<void>[] = [];
      const newlySaved = new Set<string>(savedIds);
      const newBlocked = new Set<string>(blockedStudentIds);

      studentsToSave.forEach((student, idx) => {
        const existing = existingDocs[idx];
        if (existing.exists() && existing.data().teacherId !== teacherDocId) {
          conflicting.push(student.name);
          newBlocked.add(student.id);
          return;
        }
        const f = marksInput[student.id];

        let perTest = 0;
        let notebook: number | undefined;
        let enrichment: number | undefined;
        let examMarks = 0;
        let total = 0;

        if (ut) {
          perTest = parseFloat(f.perTest) || 0;
          examMarks = 0;
          total = perTest;
        } else if (te) {
          perTest = utPerTestMap[student.id] ?? 0;
          examMarks = parseFloat(f.examMarks) || 0;
          notebook = lower ? (parseFloat(f.notebook) || 0) : undefined;
          enrichment = lower ? (parseFloat(f.enrichment) || 0) : undefined;
          total = lower
            ? perTest + (notebook ?? 0) + (enrichment ?? 0) + examMarks
            : perTest + examMarks;
        } else {
          perTest = parseFloat(f.perTest) || 0;
          examMarks = parseFloat(f.examMarks) || 0;
          notebook = lower ? (parseFloat(f.notebook) || 0) : undefined;
          enrichment = lower ? (parseFloat(f.enrichment) || 0) : undefined;
          total = lower
            ? perTest + (notebook ?? 0) + (enrichment ?? 0) + examMarks
            : perTest + examMarks;
        }

        const normalized = lower ? total : Math.round((total / 90) * 100);
        const grade = cbseGrade(normalized);

        const docId = makeMarkId(student.id, selectedExam, selectedSubject.id);
        const markData: Record<string, unknown> = {
          studentId: student.id,
          studentName: student.name,
          examType: selectedExam,
          subjectId: selectedSubject.id,
          sectionId: selectedSection.id,
          gradeLevel: gradeNum,
          perTest,
          examMarks,
          total,
          grade,
          marks: total,
          teacherId: teacherDocId,
          updatedAt: now,
        };
        if (lower) {
          markData.notebook = notebook ?? 0;
          markData.enrichment = enrichment ?? 0;
        }
        writeQueue.push(setDoc(doc(db, "marks", docId), markData));
        newlySaved.add(student.id);
      });

      if (writeQueue.length > 0) {
        await Promise.all(writeQueue);
        setSavedIds(newlySaved);
        setBlockedStudentIds(newBlocked);
        toast({ title: "Marks saved", description: `Saved marks for ${writeQueue.length} student(s).` });
      }

      if (conflicting.length > 0) {
        toast({
          title: "Some marks blocked",
          description: `Marks for ${conflicting.join(", ")} were entered by another teacher and cannot be overwritten.`,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({ title: "Error saving marks", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const resetSelection = () => {
    setSelectedExam("");
    setSelectedSection(null);
    setSelectedSubject(null);
    setStudents([]);
    setMarksInput({});
    setSavedIds(new Set());
    setBlockedStudentIds(new Set());
    setUtPerTestMap({});
    setTableVisible(false);
  };

  if (loadingInit) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
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
            <p className="text-sm text-muted-foreground mt-1">
              Your account is not linked to a teacher record. Contact the admin.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sectionSubjects = selectedSection ? subjectsForSection(selectedSection.id) : [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Marks Entry</h1>
        <p className="text-muted-foreground text-sm">Enter student marks by exam, section, and subject</p>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Select Exam, Section & Subject</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="space-y-1.5">
              <Label>Exam Type</Label>
              <select
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={selectedExam}
                onChange={(e) => {
                  setSelectedExam(e.target.value);
                  setExamScheduled(null);
                  setTableVisible(false);
                  setStudents([]);
                  setMarksInput({});
                  setSavedIds(new Set());
                }}
              >
                <option value="">Select exam</option>
                {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Section</Label>
              <select
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={selectedSection?.id ?? ""}
                onChange={(e) => {
                  const sec = sections.find((s) => s.id === e.target.value) ?? null;
                  setSelectedSection(sec);
                  setSelectedSubject(null);
                  setExamScheduled(null);
                  setTableVisible(false);
                  setStudents([]);
                  setMarksInput({});
                  setSavedIds(new Set());
                }}
                disabled={sections.length === 0}
              >
                <option value="">Select section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>Grade {s.grade} – Sec {s.name}</option>
                ))}
              </select>
              {sections.length === 0 && (
                <p className="text-xs text-orange-500">No sections assigned to you yet.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Subject</Label>
              <select
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={selectedSubject?.id ?? ""}
                onChange={(e) => {
                  const sub = sectionSubjects.find((s) => s.id === e.target.value) ?? null;
                  setSelectedSubject(sub);
                  setTableVisible(false);
                  setStudents([]);
                  setMarksInput({});
                  setSavedIds(new Set());
                }}
                disabled={!selectedSection || sectionSubjects.length === 0}
              >
                <option value="">Select subject</option>
                {sectionSubjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {checkingSchedule && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
              <Loader2 size={14} className="animate-spin" /> Checking exam schedule...
            </div>
          )}

          {examScheduled === false && !checkingSchedule && (
            <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 mb-3">
              <CalendarX size={18} className="text-orange-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-orange-700">Exam not scheduled</p>
                <p className="text-xs text-orange-600 mt-0.5">
                  The HOD has not yet scheduled <strong>{selectedExam}</strong> for Grade{" "}
                  <strong>{selectedSection?.grade}</strong>. Marks entry is locked until the exam is scheduled.
                </p>
              </div>
            </div>
          )}

          <Button
            onClick={handleLoadStudents}
            disabled={!selectedExam || !selectedSection || !selectedSubject || examScheduled === false || checkingSchedule}
            className="gap-2"
          >
            Load Students <ChevronRight size={16} />
          </Button>
        </CardContent>
      </Card>

      {tableVisible && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="text-base">
                  {selectedExam} — Grade {selectedSection?.grade} Sec {selectedSection?.name} — {selectedSubject?.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Enter marks out of 100 for each student</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={resetSelection}>
                  Change Selection
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving || students.length === 0} className="gap-2">
                  <Save size={15} />
                  {saving ? "Saving..." : "Save Marks"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingStudents ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : students.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                No students found in this section.
              </div>
            ) : (() => {
              const lower = isLowerGrade(selectedSection?.grade ?? "");
              const ut = isUnitTest(selectedExam);
              const te = isTermExam(selectedExam);
              const maxOut = lower ? 100 : 90;
              const pairedUTName = te ? PAIRED_UT[selectedExam] : null;
              const hasUtData = te && Object.keys(utPerTestMap).length > 0;

              const numInput = (
                sid: string,
                field: keyof MarkFields,
                max: number,
                placeholder: string
              ) => (
                <Input
                  type="number" min={0} max={max} step={0.5}
                  className="w-20 h-7 text-xs text-center"
                  placeholder={placeholder}
                  value={marksInput[sid]?.[field] ?? ""}
                  onChange={(e) =>
                    setMarksInput((prev) => ({
                      ...prev,
                      [sid]: { ...(prev[sid] ?? { perTest: "", notebook: "", enrichment: "", examMarks: "" }), [field]: e.target.value },
                    }))
                  }
                />
              );

              const lockedCell = (label = "N/A") => (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 bg-muted/50 rounded px-2 py-1 select-none">
                  <Lock size={10} />{label}
                </span>
              );

              return (
              <>
                {/* Scheme banner */}
                <div className="mb-3 text-xs bg-muted/40 rounded-lg px-3 py-2 space-y-0.5">
                  <p className="text-muted-foreground">
                    {lower
                      ? "Grade 1–5 scheme: Per Test (40) + Notebook (10) + Enrichment (10) + Exam (40) = 100"
                      : "Grade 6+ scheme: Per Test (10) + Exam (80) = 90 → normalised ×100/90 for CBSE grade"}
                  </p>
                  {ut && (
                    <p className="font-medium text-blue-700">
                      Unit Test — only <strong>Per Test</strong> marks will be saved. Exam, Notebook and Enrichment are not applicable here.
                    </p>
                  )}
                  {te && (
                    <p className="font-medium text-purple-700">
                      Term Exam — enter <strong>Exam{lower ? ", Notebook, and Enrichment" : ""}</strong> marks.
                      Per Test is auto-filled from {pairedUTName ?? "the paired Unit Test"}.
                      {!hasUtData && pairedUTName && (
                        <span className="text-orange-600"> (No {pairedUTName} marks found — Per Test will be 0.)</span>
                      )}
                    </p>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b-2 border-border bg-muted/30">
                        <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs w-8">#</th>
                        <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs">Student Name</th>
                        <th className={`text-center py-2 px-1 font-semibold text-xs w-22 ${te ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                          Per Test<br /><span className="font-normal opacity-60">{lower ? "/40" : "/10"}</span>
                        </th>
                        {lower && <>
                          <th className={`text-center py-2 px-1 font-semibold text-xs w-20 ${ut ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                            Notebook<br /><span className="font-normal opacity-60">/10</span>
                          </th>
                          <th className={`text-center py-2 px-1 font-semibold text-xs w-24 ${ut ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                            Enrichment<br /><span className="font-normal opacity-60">/10</span>
                          </th>
                        </>}
                        <th className={`text-center py-2 px-1 font-semibold text-xs w-22 ${ut ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
                          Exam<br /><span className="font-normal opacity-60">{lower ? "/40" : "/80"}</span>
                        </th>
                        <th className="text-center py-2 px-1 font-semibold text-muted-foreground text-xs w-16">
                          Total<br /><span className="font-normal opacity-60">/{maxOut}</span>
                        </th>
                        <th className="text-center py-2 px-1 font-semibold text-muted-foreground text-xs w-14">Grade</th>
                        <th className="text-left py-2 px-2 font-semibold text-muted-foreground text-xs w-24">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((student, idx) => {
                        const isSaved = savedIds.has(student.id);
                        const isBlocked = blockedStudentIds.has(student.id);
                        const f = marksInput[student.id] ?? { perTest: "", notebook: "", enrichment: "", examMarks: "" };

                        const utPt = utPerTestMap[student.id] ?? 0;

                        let displayTotal = 0;
                        let hasAnyInput = false;
                        if (ut) {
                          hasAnyInput = f.perTest !== "";
                          const pt = parseFloat(f.perTest) || 0;
                          displayTotal = pt;
                        } else if (te) {
                          hasAnyInput = f.examMarks !== "";
                          const ex = parseFloat(f.examMarks) || 0;
                          const nb = lower ? (parseFloat(f.notebook) || 0) : 0;
                          const se = lower ? (parseFloat(f.enrichment) || 0) : 0;
                          displayTotal = lower ? utPt + nb + se + ex : utPt + ex;
                          if (utPt > 0) hasAnyInput = true;
                        } else {
                          const pt = parseFloat(f.perTest) || 0;
                          const ex = parseFloat(f.examMarks) || 0;
                          const nb = lower ? (parseFloat(f.notebook) || 0) : 0;
                          const se = lower ? (parseFloat(f.enrichment) || 0) : 0;
                          displayTotal = lower ? pt + nb + se + ex : pt + ex;
                          hasAnyInput = f.perTest !== "" || f.examMarks !== "";
                        }

                        const normalized = lower ? displayTotal : Math.round((displayTotal / 90) * 100);
                        const grade = hasAnyInput ? cbseGrade(normalized) : "—";
                        const gradeColor = GRADE_COLOR[grade] ?? "text-muted-foreground";

                        return (
                          <tr
                            key={student.id}
                            className={`border-b border-border last:border-0 transition-colors ${isBlocked ? "bg-red-50" : "hover:bg-muted/20"}`}
                          >
                            <td className="py-2.5 px-2 text-muted-foreground text-xs">{idx + 1}</td>
                            <td className="py-2.5 px-2 font-medium">{student.name}</td>

                            {/* Per Test */}
                            <td className="py-2.5 px-1 text-center">
                              {isBlocked
                                ? <span className="text-xs text-red-500">—</span>
                                : te
                                  ? <span className="inline-block text-xs font-semibold bg-blue-50 text-blue-700 rounded px-2 py-1 w-20 text-center">
                                      {utPt > 0 ? utPt : "—"}
                                    </span>
                                  : numInput(student.id, "perTest", lower ? 40 : 10, "0")}
                            </td>

                            {/* Notebook + Enrichment (grades 1-5 only) */}
                            {lower && <>
                              <td className="py-2.5 px-1 text-center">
                                {isBlocked
                                  ? <span className="text-xs text-red-500">—</span>
                                  : ut
                                    ? lockedCell()
                                    : numInput(student.id, "notebook", 10, "0")}
                              </td>
                              <td className="py-2.5 px-1 text-center">
                                {isBlocked
                                  ? <span className="text-xs text-red-500">—</span>
                                  : ut
                                    ? lockedCell()
                                    : numInput(student.id, "enrichment", 10, "0")}
                              </td>
                            </>}

                            {/* Exam */}
                            <td className="py-2.5 px-1 text-center">
                              {isBlocked
                                ? <span className="text-xs text-red-500">—</span>
                                : ut
                                  ? lockedCell()
                                  : numInput(student.id, "examMarks", lower ? 40 : 80, "0")}
                            </td>

                            {/* Total (read-only) */}
                            <td className="py-2.5 px-1 text-center">
                              <span className={`text-sm font-bold ${hasAnyInput ? "" : "text-muted-foreground"}`}>
                                {hasAnyInput ? displayTotal : "—"}
                              </span>
                            </td>

                            {/* Grade (read-only) */}
                            <td className="py-2.5 px-1 text-center">
                              {grade !== "—" ? (
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${gradeColor}`}>{grade}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>

                            {/* Status */}
                            <td className="py-2.5 px-2">
                              {isBlocked ? (
                                <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                                  <Lock size={12} /> Blocked
                                </span>
                              ) : isSaved ? (
                                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                                  <CheckCircle size={12} /> Saved
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">Unsaved</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 pt-4 border-t border-border flex justify-end">
                  <Button onClick={handleSave} disabled={saving} className="gap-2">
                    <Save size={15} />
                    {saving ? "Saving..." : `Save All Marks (${students.length} students)`}
                  </Button>
                </div>
              </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {!tableVisible && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-3 flex items-center justify-center">
              <Save size={22} className="text-muted-foreground/60" />
            </div>
            <p className="font-medium">Ready to enter marks</p>
            <p className="text-sm mt-1">
              Select an exam type, section, and subject above, then click "Load Students".
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

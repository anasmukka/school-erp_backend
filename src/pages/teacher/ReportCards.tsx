import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection, query, where, getDocs, doc, setDoc, getDoc, DocumentData, updateDoc, addDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Section, Student, Subject, ReportCard } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FileText, AlertTriangle, ChevronLeft, Loader2, Lock, CalendarX, Download, BookOpen, PenLine, Clock, CheckCircle, Bell, Send, Save } from "lucide-react";
import { generateReportCardPdf } from "@/lib/generateReportCardPdf";

const FINAL_EXAM = "Final Exam";

function cbseGrade(marks: number): string {
  const scale: [number, string][] = [
    [91, "A1"], [81, "A2"], [71, "B1"], [61, "B2"],
    [51, "C1"], [41, "C2"], [33, "D"],
  ];
  for (const [min, g] of scale) if (marks >= min) return g;
  return "E";
}

function getOverallGrade(pct: number) {
  if (pct >= 90) return "A+"; if (pct >= 80) return "A"; if (pct >= 70) return "B+";
  if (pct >= 60) return "B";  if (pct >= 50) return "C"; if (pct >= 40) return "D";
  return "F";
}

function makeRCDocId(studentId: string, examType: string) {
  return `${studentId}_${examType.replace(/\s+/g, "_")}`;
}

function stripUndefined(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(stripUndefined);
  if (val !== null && typeof val === "object") {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)])
    );
  }
  return val;
}

const ABC = ["A", "B", "C"];
const CO_ACTIVITY_SUBJECTS = {
  gk: "general knowledge",
  valueEd: "value education",
  computer: "computer",
};

interface CoScholForm {
  rollNo: string; admissionNo: string; fatherName: string; motherName: string;
  dob: string; address: string; place: string; reportDate: string; academicSession: string;
  attendance1: string; attendance2: string;
  gk1: string; valueEd1: string; computer1: string;
  gk2: string; valueEd2: string; computer2: string;
  workEd1: string; artEd1: string; healthPE1: string;
  workEd2: string; artEd2: string; healthPE2: string;
  discipline1: string; discipline2: string;
  classTeacherRemarks: string; promotedTo: string;
}

function defaultCoScholForm(): CoScholForm {
  return {
    rollNo: "", admissionNo: "", fatherName: "", motherName: "",
    dob: "", address: "", place: "", reportDate: new Date().toISOString().slice(0, 10),
    academicSession: "2024-25", attendance1: "", attendance2: "",
    gk1: "A", valueEd1: "A", computer1: "A", gk2: "A", valueEd2: "A", computer2: "A",
    workEd1: "A", artEd1: "A", healthPE1: "A", workEd2: "A", artEd2: "A", healthPE2: "A",
    discipline1: "A", discipline2: "A", classTeacherRemarks: "", promotedTo: "",
  };
}

function GradeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs w-32 shrink-0">{label}</Label>
      <div className="flex gap-1">
        {ABC.map((g) => (
          <button key={g} type="button" onClick={() => onChange(g)}
            className={`w-8 h-8 rounded-full text-xs font-bold border transition-colors ${
              value === g ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
            }`}
          >{g}</button>
        ))}
      </div>
    </div>
  );
}

export default function TeacherReportCards() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [teacherDocId, setTeacherDocId] = useState<string | null>(null);
  const [teacherName, setTeacherName] = useState<string>("");
  const [sections, setSections] = useState<Section[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);
  const [marksDueDate, setMarksDueDate] = useState<string | null>(null);

  const [isExamScheduled, setIsExamScheduled] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [subjectsMap, setSubjectsMap] = useState<Record<string, Subject>>({});
  const [term1Map, setTerm1Map] = useState<Record<string, Record<string, number>>>({});
  const [examMarksMap, setExamMarksMap] = useState<Record<string, Record<string, number>>>({});
  type MarkDetail = { total: number; perTest: number; notebook?: number; enrichment?: number; examMarks: number; grade: string; };
  const [examMarksDetailMap, setExamMarksDetailMap] = useState<Record<string, Record<string, MarkDetail>>>({});
  const [term1DetailMap, setTerm1DetailMap] = useState<Record<string, Record<string, MarkDetail>>>({});
  const [reportCards, setReportCards] = useState<Record<string, ReportCard>>({});
  const [subjectTeacherMap, setSubjectTeacherMap] = useState<Record<string, { teacherId: string; teacherName: string }>>({});
  const [loadingSection, setLoadingSection] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [signingRC, setSigningRC] = useState<string | null>(null);
  const [notifying, setNotifying] = useState<string | null>(null);

  const [dialogStudent, setDialogStudent] = useState<Student | null>(null);
  const [coScholForm, setCoScholForm] = useState<CoScholForm>(defaultCoScholForm());

  useEffect(() => {
    if (!appUser) return;
    const init = async () => {
      try {
        let teacherSnap = await getDocs(query(collection(db, "teachers"), where("uid", "==", appUser.id)));
        if (teacherSnap.empty && appUser.email)
          teacherSnap = await getDocs(query(collection(db, "teachers"), where("email", "==", appUser.email)));
        if (teacherSnap.empty) return;
        const tDocId = teacherSnap.docs[0].id;
        const tData = teacherSnap.docs[0].data();
        setTeacherDocId(tDocId);
        setTeacherName(tData.name || appUser.name || "Class Teacher");
        const secSnap = await getDocs(query(collection(db, "sections"), where("classTeacherId", "==", tDocId)));
        setSections(secSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Section)));
      } finally {
        setLoadingInit(false);
      }
    };
    init();
  }, [appUser]);

  const loadSectionData = async (section: Section) => {
    setLoadingSection(true);
    setIsExamScheduled(false);
    setStudents([]); setSubjectIds([]); setSubjectsMap({});
    setTerm1Map({}); setExamMarksMap({}); setExamMarksDetailMap({});
    setTerm1DetailMap({}); setReportCards({}); setMarksDueDate(null);
    setSubjectTeacherMap({});

    try {
      const [studentSnap, assignSnap, rcSnap, examSnap, secDoc] = await Promise.all([
        getDocs(query(collection(db, "students"), where("sectionId", "==", section.id))),
        getDocs(query(collection(db, "subjectAssignments"), where("sectionId", "==", section.id))),
        getDocs(query(collection(db, "reportCards"), where("sectionId", "==", section.id), where("examType", "==", FINAL_EXAM))),
        getDocs(query(collection(db, "exams"), where("grade", "==", section.grade), where("examType", "==", FINAL_EXAM))),
        getDoc(doc(db, "sections", section.id)),
      ]);

      const secData = secDoc.data() as Section | undefined;
      setMarksDueDate(secData?.marksDueDate ?? null);

      const allSubjectIds = [...new Set(assignSnap.docs.map((d) => d.data().subjectId as string))];
      const subjectDocs = await Promise.all(allSubjectIds.map((id) => getDoc(doc(db, "subjects", id))));
      const sMap: Record<string, Subject> = {};
      subjectDocs.filter((d) => d.exists()).forEach((d) => { sMap[d.id] = { id: d.id, ...d.data() } as Subject; });

      // Build subject → teacher map
      const teacherIds = [...new Set(assignSnap.docs.map((d) => d.data().teacherId as string).filter(Boolean))];
      const teacherDocs = teacherIds.length > 0
        ? await Promise.all(teacherIds.map((id) => getDoc(doc(db, "teachers", id))))
        : [];
      const tNameMap: Record<string, string> = {};
      teacherDocs.filter((d) => d.exists()).forEach((d) => { tNameMap[d.id] = (d.data() as any).name || "Unknown"; });
      const stMap: Record<string, { teacherId: string; teacherName: string }> = {};
      assignSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.subjectId && data.teacherId) {
          stMap[data.subjectId] = { teacherId: data.teacherId, teacherName: tNameMap[data.teacherId] || "Unknown Teacher" };
        }
      });
      setSubjectTeacherMap(stMap);

      const exMarksSnap = await getDocs(query(collection(db, "marks"), where("sectionId", "==", section.id), where("examType", "==", FINAL_EXAM)));
      const exMarks: Record<string, Record<string, number>> = {};
      const exDetail: Record<string, Record<string, MarkDetail>> = {};
      exMarksSnap.docs.forEach((d) => {
        const m = d.data();
        if (!exMarks[m.studentId]) exMarks[m.studentId] = {};
        if (!exDetail[m.studentId]) exDetail[m.studentId] = {};
        exMarks[m.studentId][m.subjectId] = m.total ?? m.marks;
        exDetail[m.studentId][m.subjectId] = { total: m.total ?? m.marks, perTest: m.perTest ?? 0, notebook: m.notebook, enrichment: m.enrichment, examMarks: m.examMarks ?? m.marks, grade: m.grade ?? "" };
      });

      const t1Snap = await getDocs(query(collection(db, "marks"), where("sectionId", "==", section.id), where("examType", "==", "Term 1")));
      const t1: Record<string, Record<string, number>> = {};
      const t1Detail: Record<string, Record<string, MarkDetail>> = {};
      t1Snap.docs.forEach((d) => {
        const m = d.data();
        if (!t1[m.studentId]) t1[m.studentId] = {};
        if (!t1Detail[m.studentId]) t1Detail[m.studentId] = {};
        t1[m.studentId][m.subjectId] = m.total ?? m.marks;
        t1Detail[m.studentId][m.subjectId] = { total: m.total ?? m.marks, perTest: m.perTest ?? 0, notebook: m.notebook, enrichment: m.enrichment, examMarks: m.examMarks ?? m.marks, grade: m.grade ?? "" };
      });

      const rcMap: Record<string, ReportCard> = {};
      rcSnap.docs.forEach((d) => { const rc = { id: d.id, ...d.data() } as ReportCard; rcMap[rc.studentId] = rc; });

      setIsExamScheduled(!examSnap.empty);
      setStudents(studentSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Student)));
      setSubjectIds(allSubjectIds);
      setSubjectsMap(sMap);
      setTerm1Map(t1);
      setExamMarksMap(exMarks);
      setExamMarksDetailMap(exDetail);
      setTerm1DetailMap(t1Detail);
      setReportCards(rcMap);
    } finally {
      setLoadingSection(false);
    }
  };

  const handleSectionSelect = (sec: Section) => { setSelectedSection(sec); loadSectionData(sec); };

  const openDialog = async (student: Student) => {
    const sData = student as any;
    const pre = defaultCoScholForm();
    pre.dob = sData.DOB || sData.dob || "";
    pre.fatherName = sData.fatherName || ""; pre.motherName = sData.motherName || "";
    pre.address = sData.address || ""; pre.admissionNo = sData.admissionNo || "";
    pre.rollNo = sData.rollNo || "";
    try {
      const csSnap = await getDoc(doc(db, "coScholasticData", student.id));
      if (csSnap.exists()) {
        const cs = csSnap.data() as DocumentData;
        const keys: (keyof CoScholForm)[] = ["gk1","valueEd1","computer1","gk2","valueEd2","computer2","workEd1","artEd1","healthPE1","workEd2","artEd2","healthPE2","discipline1","discipline2","classTeacherRemarks","promotedTo"];
        keys.forEach((k) => { if (cs[k]) (pre as any)[k] = cs[k]; });
      }
    } catch { /* ignore */ }

    const deriveGrade = (subjectName: string, term: 1 | 2) => {
      const target = Object.entries(subjectsMap).find(([, s]) => s.name?.toLowerCase() === subjectName);
      if (!target) return "";
      const [subjectId] = target;
      const detailMap = term === 1 ? term1DetailMap : examMarksDetailMap;
      const detail = detailMap[student.id]?.[subjectId];
      const total = term === 1 ? (term1Map[student.id]?.[subjectId] ?? detail?.total) : (examMarksMap[student.id]?.[subjectId] ?? detail?.total);
      const grade = detail?.grade || (typeof total === "number" ? cbseGrade(total) : "");
      return grade || "";
    };

    const gk1 = deriveGrade(CO_ACTIVITY_SUBJECTS.gk, 1) || pre.gk1;
    const gk2 = deriveGrade(CO_ACTIVITY_SUBJECTS.gk, 2) || pre.gk2;
    const ve1 = deriveGrade(CO_ACTIVITY_SUBJECTS.valueEd, 1) || pre.valueEd1;
    const ve2 = deriveGrade(CO_ACTIVITY_SUBJECTS.valueEd, 2) || pre.valueEd2;
    const comp1 = deriveGrade(CO_ACTIVITY_SUBJECTS.computer, 1) || pre.computer1;
    const comp2 = deriveGrade(CO_ACTIVITY_SUBJECTS.computer, 2) || pre.computer2;

    pre.gk1 = gk1; pre.gk2 = gk2;
    pre.valueEd1 = ve1; pre.valueEd2 = ve2;
    pre.computer1 = comp1; pre.computer2 = comp2;

    setCoScholForm(pre);
    setDialogStudent(student);
  };

  const isLowerGrade = (grade: string) => { const n = parseInt(grade, 10); return !isNaN(n) && n >= 1 && n <= 5; };

  const submitForm = async () => {
    if (!teacherDocId || !selectedSection || !dialogStudent) return;

    const marks = examMarksMap[dialogStudent.id] ?? {};
    const missingSubjects = subjectIds.filter((id) => marks[id] === undefined);
    if (missingSubjects.length > 0) {
      const names = missingSubjects.map((id) => subjectsMap[id]?.name ?? id).join(", ");
      toast({ title: "Marks incomplete", description: `Missing marks for: ${names}`, variant: "destructive" });
      return;
    }

    setGenerating(dialogStudent.id);
    try {
      const lower = isLowerGrade(dialogStudent.grade);
      const maxPerSubject = lower ? 100 : 90;
      const examMks = examMarksMap[dialogStudent.id] ?? {};
      const examDetail = examMarksDetailMap[dialogStudent.id] ?? {};
      const t1Detail = term1DetailMap[dialogStudent.id] ?? {};

      type MD = { total: number; perTest: number; notebook?: number; enrichment?: number; examMarks: number; grade: string; };
      const buildSM = (id: string, det: MD | undefined, fallbackTotal: number) => ({
        subjectId: id, subjectName: subjectsMap[id]?.name ?? id,
        marks: det?.total ?? fallbackTotal, perTest: det?.perTest, notebook: det?.notebook,
        enrichment: det?.enrichment, examMarks: det?.examMarks, grade: det?.grade || undefined,
        gradeLevel: parseInt(dialogStudent.grade, 10) || 0,
      });

      const subjectMarksList = subjectIds.map((id) => buildSM(id, examDetail[id], examMks[id] ?? 0));
      const term1List = subjectIds.map((id) => buildSM(id, t1Detail[id], (term1Map[dialogStudent.id] ?? {})[id] ?? 0));

      const total = subjectMarksList.reduce((s, m) => s + m.marks, 0);
      const outOf = subjectIds.length * maxPerSubject;
      const percentage = outOf > 0 ? Math.round((total / outOf) * 1000) / 10 : 0;
      const gradeLetter = getOverallGrade(percentage);
      const docId = makeRCDocId(dialogStudent.id, FINAL_EXAM);
      const now = new Date().toISOString();

      const rcData = {
        studentId: dialogStudent.id, studentName: dialogStudent.name,
        grade: dialogStudent.grade, sectionId: selectedSection.id, sectionName: selectedSection.name,
        examType: FINAL_EXAM, subjectMarks: subjectMarksList, term1Marks: term1List, term2Marks: subjectMarksList,
        total, outOf, percentage, gradeLetter,
        status: "draft" as const,
        generatedBy: teacherDocId, generatedAt: now,
        rollNo: coScholForm.rollNo, admissionNo: coScholForm.admissionNo,
        fatherName: coScholForm.fatherName, motherName: coScholForm.motherName,
        dob: coScholForm.dob, address: coScholForm.address, place: coScholForm.place,
        reportDate: coScholForm.reportDate, academicSession: coScholForm.academicSession,
        attendance1: coScholForm.attendance1, attendance2: coScholForm.attendance2,
        coActivities1: { generalKnowledge: coScholForm.gk1, valueEd: coScholForm.valueEd1, computer: coScholForm.computer1 },
        coActivities2: { generalKnowledge: coScholForm.gk2, valueEd: coScholForm.valueEd2, computer: coScholForm.computer2 },
        coScholastic1: { workEd: coScholForm.workEd1, artEd: coScholForm.artEd1, healthPE: coScholForm.healthPE1 },
        coScholastic2: { workEd: coScholForm.workEd2, artEd: coScholForm.artEd2, healthPE: coScholForm.healthPE2 },
        discipline1: coScholForm.discipline1, discipline2: coScholForm.discipline2,
        classTeacherRemarks: coScholForm.classTeacherRemarks, promotedTo: coScholForm.promotedTo,
      };

      await setDoc(doc(db, "reportCards", docId), stripUndefined(rcData) as Record<string, unknown>);
      setReportCards((prev) => ({ ...prev, [dialogStudent.id]: { id: docId, ...rcData, status: "draft" } }));
      toast({ title: "Report card saved as draft", description: `${dialogStudent.name}'s report card is ready. Sign it to forward to HOD.` });
      setDialogStudent(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(null);
    }
  };

  const signReportCard = async (rc: ReportCard) => {
    if (!teacherDocId || !appUser) return;
    setSigningRC(rc.id);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "reportCards", rc.id), {
        status: "teacher_signed",
        classTeacherSign: { userId: appUser.id, name: teacherName || appUser.name || "Class Teacher", signedAt: now },
      });
      setReportCards((prev) => ({
        ...prev,
        [rc.studentId]: { ...rc, status: "teacher_signed" as const, classTeacherSign: { userId: appUser.id, name: teacherName || appUser.name || "Class Teacher", signedAt: now } },
      }));
      toast({ title: "Report card signed", description: `${rc.studentName}'s report card forwarded to HOD for review.` });
    } catch (err: any) {
      toast({ title: "Error signing", description: err.message, variant: "destructive" });
    } finally {
      setSigningRC(null);
    }
  };

  const notifyTeacherForMissing = async (studentId: string, studentName: string, missingSubjectIds: string[]) => {
    setNotifying(studentId);
    try {
      const now = new Date().toISOString();
      const notified: string[] = [];
      for (const subjId of missingSubjectIds) {
        const teacher = subjectTeacherMap[subjId];
        if (!teacher) continue;
        const subName = subjectsMap[subjId]?.name || "Unknown Subject";
        await addDoc(collection(db, "notifications"), {
          type: "missing_marks",
          recipientTeacherId: teacher.teacherId,
          recipientName: teacher.teacherName,
          senderName: teacherName || appUser?.name || "Class Teacher",
          senderId: teacherDocId,
          studentName,
          studentId,
          subjectName: subName,
          subjectId: subjId,
          sectionId: selectedSection?.id || "",
          grade: selectedSection?.grade || "",
          examType: FINAL_EXAM,
          message: `Please enter Final Exam marks for ${subName} — student ${studentName} (Grade ${selectedSection?.grade}, ${selectedSection?.name}).`,
          read: false,
          createdAt: now,
        });
        if (!notified.includes(teacher.teacherName)) notified.push(teacher.teacherName);
      }
      toast({
        title: "Notifications sent",
        description: `Notified ${notified.join(", ")} about missing marks for ${studentName}.`,
      });
    } catch (err: any) {
      toast({ title: "Error notifying", description: err.message, variant: "destructive" });
    } finally {
      setNotifying(null);
    }
  };

  /* ── Inline Marks Entry for own subjects ── */
  type InlineMarkFields = { perTest: string; notebook: string; enrichment: string; examMarks: string; };
  const [inlineMarks, setInlineMarks] = useState<Record<string, InlineMarkFields>>({});
  const [savingInline, setSavingInline] = useState<string | null>(null);

  const getInlineKey = (studentId: string, subjectId: string) => `${studentId}_${subjectId}`;

  const updateInlineMark = (studentId: string, subjectId: string, field: keyof InlineMarkFields, value: string) => {
    const key = getInlineKey(studentId, subjectId);
    setInlineMarks((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { perTest: "", notebook: "", enrichment: "", examMarks: "" }), [field]: value },
    }));
  };

  // Removed duplicate isLowerGrade function - already declared above

  const saveInlineMarks = async (studentId: string, studentName: string, subjectId: string) => {
    const key = getInlineKey(studentId, subjectId);
    const fields = inlineMarks[key];
    if (!fields) return;

    const lower = isLowerGrade(selectedSection?.grade || "");
    const perTest = parseFloat(fields.perTest) || 0;
    const examMarks = parseFloat(fields.examMarks) || 0;
    const notebook = lower ? (parseFloat(fields.notebook) || 0) : 0;
    const enrichment = lower ? (parseFloat(fields.enrichment) || 0) : 0;
    const total = lower ? perTest + notebook + enrichment + examMarks : perTest + examMarks;

    if (total === 0) {
      toast({ title: "Enter marks", description: "Please enter at least some marks.", variant: "destructive" });
      return;
    }

    const normalized = lower ? total : Math.round((total / 90) * 100);
    const grade = cbseGrade(normalized);
    const docId = `${studentId}_Final_Exam_${subjectId}`;
    const now = new Date().toISOString();

    setSavingInline(key);
    try {
      const markData: Record<string, unknown> = {
        studentId, studentName, examType: FINAL_EXAM, subjectId,
        sectionId: selectedSection?.id || "", gradeLevel: parseInt(selectedSection?.grade || "0", 10),
        perTest, examMarks, total, grade, marks: total,
        teacherId: teacherDocId, updatedAt: now,
      };
      if (lower) { markData.notebook = notebook; markData.enrichment = enrichment; }

      await setDoc(doc(db, "marks", docId), markData);

      // Update local state so status recalculates
      setExamMarksMap((prev) => ({
        ...prev,
        [studentId]: { ...(prev[studentId] || {}), [subjectId]: total },
      }));
      setExamMarksDetailMap((prev) => ({
        ...prev,
        [studentId]: {
          ...(prev[studentId] || {}),
          [subjectId]: { total, perTest, notebook, enrichment, examMarks, grade },
        },
      }));

      // Clear the inline form
      setInlineMarks((prev) => { const next = { ...prev }; delete next[key]; return next; });
      toast({ title: "Marks saved", description: `${subjectsMap[subjectId]?.name || "Subject"} marks saved for ${studentName}.` });
    } catch (err: any) {
      toast({ title: "Error saving marks", description: err.message, variant: "destructive" });
    } finally {
      setSavingInline(null);
    }
  };

  const downloadPdf = async (rc: ReportCard) => {
    setDownloading(rc.id);
    try { await generateReportCardPdf(rc); }
    catch (err: any) { toast({ title: "PDF Error", description: err.message, variant: "destructive" }); }
    finally { setDownloading(null); }
  };

  const getStudentStatus = (student: Student) => {
    const existingRC = reportCards[student.id];
    if (existingRC) return { type: existingRC.status as string, rc: existingRC };
    if (subjectIds.length === 0) return { type: "no-subjects" as const };
    const marks = examMarksMap[student.id] ?? {};
    const missingIds = subjectIds.filter((id) => marks[id] === undefined);
    if (missingIds.length === 0) return { type: "ready" as const };
    return {
      type: "incomplete" as const,
      missing: missingIds.length,
      missingSubjects: missingIds.map((id) => ({
        subjectId: id,
        subjectName: subjectsMap[id]?.name || "Unknown",
        teacherName: subjectTeacherMap[id]?.teacherName || "Unassigned",
        teacherId: subjectTeacherMap[id]?.teacherId || "",
        isOwnSubject: subjectTeacherMap[id]?.teacherId === teacherDocId,
      })),
    };
  };

  const fld = <K extends keyof CoScholForm>(key: K, val: string) => setCoScholForm((f) => ({ ...f, [key]: val }));

  /* Due date helpers */
  const dueDateLabel = marksDueDate
    ? new Date(marksDueDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const dueDatePast = marksDueDate ? new Date(marksDueDate + "T23:59:59") < new Date() : false;

  if (loadingInit) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-muted-foreground" size={32} /></div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Generate Report Cards</h1>
        <p className="text-muted-foreground text-sm">Class teachers only · Annual report card (Final Exam)</p>
      </div>

      {!selectedSection ? (
        sections.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            <Lock size={36} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">Not a class teacher</p>
            <p className="text-sm mt-1">You are not assigned as class teacher of any section.</p>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {sections.map((sec) => (
              <Card key={sec.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => handleSectionSelect(sec)}>
                <CardContent className="pt-6 pb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"><FileText size={22} className="text-primary" /></div>
                    <div>
                      <p className="font-bold text-lg">Grade {sec.grade} – {sec.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Class Teacher</p>
                      {sec.marksDueDate && (
                        <p className="text-xs text-orange-600 mt-0.5 font-medium">
                          Due: {new Date(sec.marksDueDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="flex items-center gap-2 mb-5">
            <button onClick={() => setSelectedSection(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeft size={16} /> Sections
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-medium">Grade {selectedSection.grade} – {selectedSection.name}</span>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-full">
              <BookOpen size={12} /> Annual Report Card · Final Exam
            </span>
            {dueDateLabel && (
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border ${
                dueDatePast ? "bg-red-50 text-red-700 border-red-200" : "bg-orange-50 text-orange-700 border-orange-200"
              }`}>
                <Clock size={12} /> {dueDatePast ? "Due date passed:" : "Marks due by:"} {dueDateLabel}
              </span>
            )}
          </div>

          {loadingSection ? (
            <div className="flex items-center justify-center h-48"><Loader2 className="animate-spin text-muted-foreground" size={28} /></div>
          ) : !isExamScheduled ? (
            <Card><CardContent className="py-16 text-center text-muted-foreground">
              <CalendarX size={40} className="mx-auto mb-4 text-orange-400" />
              <p className="font-semibold text-lg text-foreground">Final Exam not scheduled</p>
              <p className="text-sm mt-1">Ask the HOD to schedule the Final Exam for Grade {selectedSection.grade} first.</p>
            </CardContent></Card>
          ) : students.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No students in this section.</CardContent></Card>
          ) : subjectIds.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <AlertTriangle size={28} className="mx-auto mb-2 text-yellow-500" /> No subjects assigned.
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {students.map((student) => {
                const status = getStudentStatus(student);
                return (
                  <Card key={student.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div>
                          <p className="font-semibold">{student.name}</p>
                          <p className="text-xs text-muted-foreground">Grade {student.grade} · Section {selectedSection.name}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {(status.type === "draft" || status.type === "teacher_signed" || status.type === "hod_signed" || status.type === "principal_signed" || status.type === "published") && (
                            <>
                              {status.type === "draft" && (
                                <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-yellow-50 text-yellow-700 border-yellow-200">
                                  Draft
                                </span>
                              )}
                              {status.type === "teacher_signed" && (
                                <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-blue-50 text-blue-700 border-blue-200">
                                  <CheckCircle size={11} /> Signed — Pending HOD
                                </span>
                              )}
                              {status.type === "hod_signed" && (
                                <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-indigo-50 text-indigo-700 border-indigo-200">
                                  <CheckCircle size={11} /> HOD Signed — Pending Principal
                                </span>
                              )}
                              {status.type === "principal_signed" && (
                                <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-purple-50 text-purple-700 border-purple-200">
                                  <CheckCircle size={11} /> Principal Signed — Pending Publish
                                </span>
                              )}
                              {status.type === "published" && (
                                <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium bg-green-50 text-green-700 border-green-200">
                                  <CheckCircle size={11} /> Published
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground">{"rc" in status ? (status as any).rc.percentage + "%" : ""}</span>
                              {"rc" in status && (
                                <Button size="sm" variant="outline" onClick={() => downloadPdf((status as any).rc)} disabled={downloading === (status as any).rc.id} className="gap-1.5">
                                  {downloading === (status as any).rc.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
                                </Button>
                              )}
                              {status.type === "draft" && "rc" in status && (
                                <>
                                  <Button size="sm" onClick={() => signReportCard((status as any).rc)} disabled={signingRC === (status as any).rc.id} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                                    {signingRC === (status as any).rc.id ? <Loader2 size={13} className="animate-spin" /> : <PenLine size={13} />} Sign Report Card
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => openDialog(student)} className="gap-1.5 text-muted-foreground">
                                    Edit
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                          {status.type === "ready" && (
                            <Button size="sm" onClick={() => openDialog(student)} className="gap-1.5">
                              <PenLine size={14} /> Generate Report Card
                            </Button>
                          )}
                          {status.type === "incomplete" && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="flex items-center gap-1.5 text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2.5 py-1 rounded-full">
                                <AlertTriangle size={12} /> Missing marks ({status.missing})
                              </span>
                              {"missingSubjects" in status && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                                  disabled={notifying === student.id}
                                  onClick={() => notifyTeacherForMissing(
                                    student.id,
                                    student.name,
                                    (status as any).missingSubjects.filter((ms: any) => !ms.isOwnSubject).map((ms: any) => ms.subjectId),
                                  )}
                                >
                                  {notifying === student.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                  Notify Teachers
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Missing subjects detail with inline entry */}
                      {status.type === "incomplete" && "missingSubjects" in status && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-xs font-medium text-muted-foreground mb-2">Missing Final Exam marks:</p>
                          <div className="space-y-2">
                            {(status as any).missingSubjects.map((ms: any) => {
                              const iKey = getInlineKey(student.id, ms.subjectId);
                              const inlineFields = inlineMarks[iKey];
                              const lower = isLowerGrade(selectedSection?.grade || "");
                              return (
                                <div key={ms.subjectId} className="border border-orange-100 rounded-xl overflow-hidden">
                                  <div className="flex items-center justify-between text-xs bg-orange-50/60 px-3 py-2">
                                    <div>
                                      <span className="font-medium text-foreground">{ms.subjectName}</span>
                                      <span className="text-muted-foreground ml-2">— {ms.teacherName}</span>
                                      {ms.isOwnSubject && <span className="ml-1.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Your Subject</span>}
                                    </div>
                                    {ms.isOwnSubject && !inlineFields && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 text-[11px] text-blue-600 hover:bg-blue-50 px-2"
                                        onClick={() => updateInlineMark(student.id, ms.subjectId, "perTest", "")}
                                      >
                                        <PenLine size={11} className="mr-1" /> Enter Marks
                                      </Button>
                                    )}
                                  </div>

                                  {ms.isOwnSubject && inlineFields !== undefined && (
                                    <div className="px-3 py-3 bg-white border-t border-orange-100" data-testid={`inline-marks-${ms.subjectId}`}>
                                      <div className={`grid gap-2 ${lower ? "grid-cols-4" : "grid-cols-2"}`}>
                                        <div>
                                          <Label className="text-[10px] text-muted-foreground">Per. Test (10)</Label>
                                          <Input
                                            className="h-7 text-xs mt-0.5"
                                            type="number"
                                            min="0"
                                            max="10"
                                            placeholder="0"
                                            value={inlineFields.perTest}
                                            onChange={(e) => updateInlineMark(student.id, ms.subjectId, "perTest", e.target.value)}
                                          />
                                        </div>
                                        {lower && (
                                          <>
                                            <div>
                                              <Label className="text-[10px] text-muted-foreground">Notebook (5)</Label>
                                              <Input
                                                className="h-7 text-xs mt-0.5"
                                                type="number"
                                                min="0"
                                                max="5"
                                                placeholder="0"
                                                value={inlineFields.notebook}
                                                onChange={(e) => updateInlineMark(student.id, ms.subjectId, "notebook", e.target.value)}
                                              />
                                            </div>
                                            <div>
                                              <Label className="text-[10px] text-muted-foreground">Enrichment (5)</Label>
                                              <Input
                                                className="h-7 text-xs mt-0.5"
                                                type="number"
                                                min="0"
                                                max="5"
                                                placeholder="0"
                                                value={inlineFields.enrichment}
                                                onChange={(e) => updateInlineMark(student.id, ms.subjectId, "enrichment", e.target.value)}
                                              />
                                            </div>
                                          </>
                                        )}
                                        <div>
                                          <Label className="text-[10px] text-muted-foreground">Exam ({lower ? "80" : "80"})</Label>
                                          <Input
                                            className="h-7 text-xs mt-0.5"
                                            type="number"
                                            min="0"
                                            max="80"
                                            placeholder="0"
                                            value={inlineFields.examMarks}
                                            onChange={(e) => updateInlineMark(student.id, ms.subjectId, "examMarks", e.target.value)}
                                          />
                                        </div>
                                      </div>
                                      <div className="flex items-center justify-between mt-2.5">
                                        <span className="text-[11px] text-muted-foreground">
                                          Total: <strong>{
                                            lower
                                              ? (parseFloat(inlineFields.perTest || "0") + parseFloat(inlineFields.notebook || "0") + parseFloat(inlineFields.enrichment || "0") + parseFloat(inlineFields.examMarks || "0"))
                                              : (parseFloat(inlineFields.perTest || "0") + parseFloat(inlineFields.examMarks || "0"))
                                          }</strong>
                                        </span>
                                        <div className="flex gap-1.5">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 text-[11px] px-2"
                                            onClick={() => setInlineMarks((prev) => { const n = { ...prev }; delete n[iKey]; return n; })}
                                          >
                                            Cancel
                                          </Button>
                                          <Button
                                            size="sm"
                                            className="h-6 text-[11px] px-2.5 gap-1"
                                            disabled={savingInline === iKey}
                                            onClick={() => saveInlineMarks(student.id, student.name, ms.subjectId)}
                                          >
                                            {savingInline === iKey ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                                            Save
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {(status.type === "draft" || status.type === "teacher_signed" || status.type === "hod_signed" || status.type === "principal_signed" || status.type === "published") && "rc" in status && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <div className="flex flex-wrap gap-2">
                            {((status as any).rc.term2Marks ?? (status as any).rc.subjectMarks).map((sm: any) => {
                              const dispGrade = sm.grade ?? cbseGrade(sm.marks);
                              return (
                                <div key={sm.subjectId} className="text-xs bg-muted rounded px-2.5 py-1.5">
                                  <span className="text-muted-foreground">{sm.subjectName}:</span>{" "}
                                  <span className="font-semibold">{sm.marks}</span>
                                  <span className="text-[10px] text-muted-foreground"> ({dispGrade})</span>
                                </div>
                              );
                            })}
                          </div>
                          {(status as any).rc.classTeacherSign && (
                            <p className="mt-2 text-[11px] text-green-700">
                              Signed by {(status as any).rc.classTeacherSign.name} · {new Date((status as any).rc.classTeacherSign.signedAt).toLocaleDateString("en-IN")}
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Generate & Sign Dialog ── */}
      <Dialog open={!!dialogStudent} onOpenChange={(o) => !o && setDialogStudent(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Annual Report Card — {dialogStudent?.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 text-sm">
            <section>
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3">Student Details</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ["Roll No.", "rollNo"], ["Admission No.", "admissionNo"],
                  ["Father's Name", "fatherName"], ["Mother's Name", "motherName"],
                  ["Date of Birth", "dob"], ["Address", "address"],
                  ["Academic Session", "academicSession"], ["Place", "place"],
                ] as [string, keyof CoScholForm][]).map(([label, key]) => (
                  <div key={key}>
                    <Label className="text-xs">{label}</Label>
                    <Input className="mt-1 h-8 text-sm" value={coScholForm[key] as string} onChange={(e) => fld(key, e.target.value)} />
                  </div>
                ))}
                <div>
                  <Label className="text-xs">Report Date</Label>
                  <Input type="date" className="mt-1 h-8 text-sm" value={coScholForm.reportDate} onChange={(e) => fld("reportDate", e.target.value)} />
                </div>
              </div>
            </section>

            <section>
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3">Attendance</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Term-1 (e.g. 99/102)</Label><Input className="mt-1 h-8 text-sm" placeholder="99/102" value={coScholForm.attendance1} onChange={(e) => fld("attendance1", e.target.value)} /></div>
                <div><Label className="text-xs">Term-2 (e.g. 120/122)</Label><Input className="mt-1 h-8 text-sm" placeholder="120/122" value={coScholForm.attendance2} onChange={(e) => fld("attendance2", e.target.value)} /></div>
              </div>
            </section>

            <section>
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3">Co-Curricular Grades (from subject teachers)</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <div className="space-y-2"><p className="text-xs text-muted-foreground font-medium">Term-1</p>
                  {[
                    ["General Knowledge", "gk1"],
                    ["Value Education", "valueEd1"],
                    ["Computer", "computer1"],
                  ].map(([label, key]) => (
                    <div key={key} className="flex items-center gap-2">
                      <Label className="text-xs w-36">{label}</Label>
                      <span className="text-sm font-semibold px-2 py-1 rounded-md border bg-muted">{(coScholForm as any)[key] || "—"}</span>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground">These are derived from subject marks; update by entering marks for the subject.</p>
                </div>
                <div className="space-y-2"><p className="text-xs text-muted-foreground font-medium">Term-2</p>
                  {[
                    ["General Knowledge", "gk2"],
                    ["Value Education", "valueEd2"],
                    ["Computer", "computer2"],
                  ].map(([label, key]) => (
                    <div key={key} className="flex items-center gap-2">
                      <Label className="text-xs w-36">{label}</Label>
                      <span className="text-sm font-semibold px-2 py-1 rounded-md border bg-muted">{(coScholForm as any)[key] || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section>
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3">Co-Scholastic Areas (A–C)</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <div className="space-y-2"><p className="text-xs text-muted-foreground font-medium">Term-1</p>
                  <GradeSelect label="Work Education" value={coScholForm.workEd1} onChange={(v) => fld("workEd1", v)} />
                  <GradeSelect label="Art Education" value={coScholForm.artEd1} onChange={(v) => fld("artEd1", v)} />
                  <GradeSelect label="Health & PE" value={coScholForm.healthPE1} onChange={(v) => fld("healthPE1", v)} />
                </div>
                <div className="space-y-2"><p className="text-xs text-muted-foreground font-medium">Term-2</p>
                  <GradeSelect label="Work Education" value={coScholForm.workEd2} onChange={(v) => fld("workEd2", v)} />
                  <GradeSelect label="Art Education" value={coScholForm.artEd2} onChange={(v) => fld("artEd2", v)} />
                  <GradeSelect label="Health & PE" value={coScholForm.healthPE2} onChange={(v) => fld("healthPE2", v)} />
                </div>
              </div>
            </section>

            <section>
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3">Discipline (A–C)</p>
              <div className="grid grid-cols-2 gap-x-6">
                <div><p className="text-xs text-muted-foreground font-medium mb-2">Term-1</p><GradeSelect label="Discipline" value={coScholForm.discipline1} onChange={(v) => fld("discipline1", v)} /></div>
                <div><p className="text-xs text-muted-foreground font-medium mb-2">Term-2</p><GradeSelect label="Discipline" value={coScholForm.discipline2} onChange={(v) => fld("discipline2", v)} /></div>
              </div>
            </section>

            <section>
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3">Remarks & Promotion</p>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Class Teacher's Remarks</Label>
                  <textarea className="w-full mt-1 border border-input rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" rows={2} value={coScholForm.classTeacherRemarks} onChange={(e) => fld("classTeacherRemarks", e.target.value)} placeholder="e.g. Has shown excellent progress..." />
                </div>
                <div>
                  <Label className="text-xs">Promoted to Class</Label>
                  <Input className="mt-1 h-8 text-sm" placeholder="e.g. Grade 6" value={coScholForm.promotedTo} onChange={(e) => fld("promotedTo", e.target.value)} />
                </div>
              </div>
            </section>

            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-700">
              <p className="font-semibold flex items-center gap-1.5"><PenLine size={12} /> Sign & Print</p>
              <p className="mt-1">Class Teacher generates and prints. HOD and Principal will sign manually on the printed copy.</p>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDialogStudent(null)}>Cancel</Button>
            <Button onClick={submitForm} disabled={!!generating} className="gap-1.5">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <PenLine size={14} />}
              Generate & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

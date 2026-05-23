import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection, query, where, getDocs, doc, setDoc, getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Section, Student } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock, Loader2, Save, ChevronLeft, GraduationCap } from "lucide-react";

const GRADES = ["A", "B", "C"];

interface CoScholRow {
  studentId: string;
  studentName: string;
  workEd1: string; artEd1: string; healthPE1: string;
  workEd2: string; artEd2: string; healthPE2: string;
  gk1: string; valueEd1: string; computer1: string;
  gk2: string; valueEd2: string; computer2: string;
  discipline1: string; discipline2: string;
  classTeacherRemarks: string;
  promotedTo: string;
}

function defaultRow(studentId: string, studentName: string): CoScholRow {
  return {
    studentId, studentName,
    workEd1: "", artEd1: "", healthPE1: "",
    workEd2: "", artEd2: "", healthPE2: "",
    gk1: "", valueEd1: "", computer1: "",
    gk2: "", valueEd2: "", computer2: "",
    discipline1: "", discipline2: "",
    classTeacherRemarks: "", promotedTo: "",
  };
}

function GradeToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-0.5">
      {GRADES.map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onChange(value === g ? "" : g)}
          className={`w-7 h-7 rounded text-xs font-bold border transition-colors ${
            value === g
              ? "bg-primary text-primary-foreground border-primary"
              : value === ""
                ? "border-orange-300 bg-orange-50 hover:bg-muted text-muted-foreground"
                : "border-border hover:bg-muted text-muted-foreground"
          }`}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

export default function CoScholasticEntry() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [teacherDocId, setTeacherDocId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);
  const [rows, setRows] = useState<CoScholRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingSection, setLoadingSection] = useState(false);

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
        }
        if (teacherSnap.empty) { setLoading(false); return; }
        const tDocId = teacherSnap.docs[0].id;
        setTeacherDocId(tDocId);

        const secSnap = await getDocs(
          query(collection(db, "sections"), where("classTeacherId", "==", tDocId))
        );
        const secs = secSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
        setSections(secs);
        if (secs.length === 1) loadSection(secs[0]);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [appUser]);

  const loadSection = async (section: Section) => {
    setSelectedSection(section);
    setLoadingSection(true);
    try {
      const { loadStudentsForSection } = await import("@/lib/enrollments");
      const students = (await loadStudentsForSection(section.id)).sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      const populated: CoScholRow[] = await Promise.all(
        students.map(async (s) => {
          const docRef = doc(db, "coScholasticData", `${s.id}`);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            return { ...defaultRow(s.id, s.name), ...snap.data() } as CoScholRow;
          }
          return defaultRow(s.id, s.name);
        })
      );
      setRows(populated);
    } finally {
      setLoadingSection(false);
    }
  };

  const updateRow = <K extends keyof CoScholRow>(studentId: string, key: K, value: CoScholRow[K]) => {
    setRows((prev) => prev.map((r) => r.studentId === studentId ? { ...r, [key]: value } : r));
  };

  const saveAll = async () => {
    if (!selectedSection || !teacherDocId) return;
    setSaving(true);
    try {
      await Promise.all(
        rows.map((row) =>
          setDoc(doc(db, "coScholasticData", row.studentId), {
            ...row,
            sectionId: selectedSection.id,
            sectionName: selectedSection.name,
            grade: selectedSection.grade,
            updatedBy: teacherDocId,
            updatedAt: new Date().toISOString(),
          })
        )
      );
      toast({ title: "Saved", description: "Co-scholastic data saved for all students." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-muted-foreground" size={32} />
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Co-Scholastic Data Entry</h1>
        </div>
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Lock size={36} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">Class teachers only</p>
            <p className="text-sm mt-1">You must be assigned as a class teacher to enter co-scholastic data.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Co-Scholastic Data Entry</h1>
        <p className="text-muted-foreground text-sm">
          Enter grades (A–C) for co-scholastic areas, discipline, remarks and promotion for your class
        </p>
      </div>

      {/* Section selector if multiple sections */}
      {sections.length > 1 && !selectedSection && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {sections.map((sec) => (
            <Card key={sec.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => loadSection(sec)}>
              <CardContent className="pt-6 pb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <GraduationCap size={20} className="text-primary" />
                  </div>
                  <div>
                    <p className="font-bold">Grade {sec.grade} – {sec.name}</p>
                    <p className="text-xs text-muted-foreground">Class Teacher</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedSection && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {sections.length > 1 && (
                <button
                  onClick={() => setSelectedSection(null)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft size={16} /> Sections
                </button>
              )}
              <span className="text-sm font-semibold">Grade {selectedSection.grade} – {selectedSection.name}</span>
            </div>
            <Button onClick={saveAll} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save All
            </Button>
          </div>

          {loadingSection ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="animate-spin text-muted-foreground" size={28} />
            </div>
          ) : rows.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No students in this section.</CardContent></Card>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => {
                const gradeFields = [
                  row.gk1, row.valueEd1, row.computer1, row.workEd1, row.artEd1, row.healthPE1, row.discipline1,
                  row.gk2, row.valueEd2, row.computer2, row.workEd2, row.artEd2, row.healthPE2, row.discipline2,
                ];
                const filled = gradeFields.filter((v) => v !== "").length;
                const total = gradeFields.length;
                const complete = filled === total;
                return (
                <Card key={row.studentId} className={complete ? "" : "border-orange-200"}>
                  <CardContent className="pt-4 pb-5">
                    <div className="flex items-center justify-between mb-4">
                      <p className="font-semibold">{row.studentName}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                        complete
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-orange-50 text-orange-700 border-orange-200"
                      }`}>
                        {complete ? "Complete" : `${filled}/${total} filled`}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                      {/* Term-1 */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 pb-1 border-b">
                          Term-1 (A–C grading scale)
                        </p>
                        <div className="space-y-3">
                          <GradeRow label="General Knowledge" value={row.gk1} onChange={(v) => updateRow(row.studentId, "gk1", v)} />
                          <GradeRow label="Value Education" value={row.valueEd1} onChange={(v) => updateRow(row.studentId, "valueEd1", v)} />
                          <GradeRow label="Computer" value={row.computer1} onChange={(v) => updateRow(row.studentId, "computer1", v)} />
                          <div className="border-t pt-3">
                            <p className="text-xs text-muted-foreground font-medium mb-2">Co-Scholastic Areas</p>
                            <div className="space-y-2">
                              <GradeRow label="Work Education" value={row.workEd1} onChange={(v) => updateRow(row.studentId, "workEd1", v)} />
                              <GradeRow label="Art Education" value={row.artEd1} onChange={(v) => updateRow(row.studentId, "artEd1", v)} />
                              <GradeRow label="Health & PE" value={row.healthPE1} onChange={(v) => updateRow(row.studentId, "healthPE1", v)} />
                            </div>
                          </div>
                          <div className="border-t pt-3">
                            <GradeRow label="Discipline" value={row.discipline1} onChange={(v) => updateRow(row.studentId, "discipline1", v)} />
                          </div>
                        </div>
                      </div>

                      {/* Term-2 */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 pb-1 border-b">
                          Term-2 (A–C grading scale)
                        </p>
                        <div className="space-y-3">
                          <GradeRow label="General Knowledge" value={row.gk2} onChange={(v) => updateRow(row.studentId, "gk2", v)} />
                          <GradeRow label="Value Education" value={row.valueEd2} onChange={(v) => updateRow(row.studentId, "valueEd2", v)} />
                          <GradeRow label="Computer" value={row.computer2} onChange={(v) => updateRow(row.studentId, "computer2", v)} />
                          <div className="border-t pt-3">
                            <p className="text-xs text-muted-foreground font-medium mb-2">Co-Scholastic Areas</p>
                            <div className="space-y-2">
                              <GradeRow label="Work Education" value={row.workEd2} onChange={(v) => updateRow(row.studentId, "workEd2", v)} />
                              <GradeRow label="Art Education" value={row.artEd2} onChange={(v) => updateRow(row.studentId, "artEd2", v)} />
                              <GradeRow label="Health & PE" value={row.healthPE2} onChange={(v) => updateRow(row.studentId, "healthPE2", v)} />
                            </div>
                          </div>
                          <div className="border-t pt-3">
                            <GradeRow label="Discipline" value={row.discipline2} onChange={(v) => updateRow(row.studentId, "discipline2", v)} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Remarks & Promotion */}
                    <div className="mt-5 pt-4 border-t grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Class Teacher's Remarks</Label>
                        <Input
                          className="mt-1 h-9 text-sm"
                          placeholder="e.g. Excellent progress..."
                          value={row.classTeacherRemarks}
                          onChange={(e) => updateRow(row.studentId, "classTeacherRemarks", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Promoted to Class</Label>
                        <Input
                          className="mt-1 h-9 text-sm"
                          placeholder="e.g. Grade 7"
                          value={row.promotedTo}
                          onChange={(e) => updateRow(row.studentId, "promotedTo", e.target.value)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                );
              })}

              <div className="flex justify-end pt-2">
                <Button onClick={saveAll} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save All Students
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GradeRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-foreground/80 min-w-0">{label}</span>
      <GradeToggle value={value} onChange={onChange} />
    </div>
  );
}

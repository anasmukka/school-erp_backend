import { useEffect, useState } from "react";
import {
  collection, query, where, getDocs, doc, updateDoc, addDoc, deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Student, Subject, Teacher, SubjectAssignment, Section } from "@/lib/types";
import { getActiveEnrollment, loadStudentsForSection } from "@/lib/enrollments";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronRight, BookOpen, GraduationCap, User as UserIcon,
  Trash2, Plus, AlertTriangle, UserCog, CheckCircle,
} from "lucide-react";

type View =
  | { kind: "grades" }
  | { kind: "section-picker"; grade: string }
  | { kind: "section-options"; grade: string; section: Section }
  | { kind: "subjects"; grade: string; section: Section }
  | { kind: "students"; grade: string; section: Section }
  | { kind: "class-teacher"; grade: string; section: Section };

export default function ClassManagement() {
  const { appUser } = useAuth();
  const [view, setView] = useState<View>({ kind: "grades" });
  const [hodGrades, setHodGrades] = useState<string[]>([]);

  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [assignments, setAssignments] = useState<SubjectAssignment[]>([]);
  const [sectionStudents, setSectionStudents] = useState<Student[]>([]);

  const [assignModal, setAssignModal] = useState<Subject | null>(null);
  const [saving, setSaving] = useState(false);

  const [addSectionInput, setAddSectionInput] = useState("");
  const [addSectionError, setAddSectionError] = useState("");
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<Section | null>(null);

  useEffect(() => {
    if (!appUser) return;
    const grades = (appUser.assignedGrades as string[] | undefined) ?? [];
    setHodGrades(grades.sort((a, b) => Number(a) - Number(b)));
  }, [appUser]);

  const loadSections = async (grade: string) => {
    if (!appUser) return;
    const q = query(
      collection(db, "sections"),
      where("grade", "==", grade),
      where("hodId", "==", appUser.id)
    );
    const snap = await getDocs(q);
    setSections(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Section)));
  };

  const loadTeachers = async () => {
    if (!appUser) return;
    const snap = await getDocs(query(collection(db, "teachers"), where("hodIds", "array-contains", appUser.id)));
    setTeachers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Teacher)));
  };

  const loadSubjectsData = async (grade: string, section: Section) => {
    if (!appUser) return;
    const [subSnap, assignSnap] = await Promise.all([
      getDocs(query(collection(db, "subjects"), where("grade", "==", grade))),
      getDocs(query(collection(db, "subjectAssignments"), where("sectionId", "==", section.id))),
    ]);
    setSubjects(subSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Subject)));
    setAssignments(assignSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SubjectAssignment)));
  };

  const loadStudentsData = async (section: Section) => {
    if (!appUser) return;
    const list = await loadStudentsForSection(section.id);
    setSectionStudents(list);
  };

  useEffect(() => {
    if (view.kind === "section-picker") loadSections(view.grade);
    if (view.kind === "subjects") { loadSubjectsData(view.grade, view.section); loadTeachers(); }
    if (view.kind === "students") loadStudentsData(view.section);
    if (view.kind === "class-teacher") loadTeachers();
  }, [view]);

  const addSection = async (grade: string) => {
    if (!appUser) return;
    const name = addSectionInput.trim().toUpperCase();
    if (!name) { setAddSectionError("Enter a section name."); return; }
    if (sections.some((s) => s.name === name)) { setAddSectionError(`Section ${name} already exists.`); return; }
    setAddSectionError("");
    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, "sections"), { grade, name, hodId: appUser.id });
      setSections((prev) => [...prev, { id: docRef.id, grade, name, hodId: appUser.id }]);
      setAddSectionInput("");
    } finally {
      setSaving(false);
    }
  };

  const deleteSection = async (section: Section) => {
    await deleteDoc(doc(db, "sections", section.id));
    setSections((prev) => prev.filter((s) => s.id !== section.id));
    setConfirmDeleteSection(null);
  };

  const assignTeacher = async (subject: Subject, teacherId: string) => {
    if (view.kind !== "subjects") return;
    setSaving(true);
    const existing = assignments.find((a) => a.subjectId === subject.id && a.sectionId === view.section.id);
    try {
      if (existing) {
        await updateDoc(doc(db, "subjectAssignments", existing.id), { teacherId });
        setAssignments((prev) => prev.map((a) => a.id === existing.id ? { ...a, teacherId } : a));
      } else {
        const ref = await addDoc(collection(db, "subjectAssignments"), {
          subjectId: subject.id, sectionId: view.section.id, teacherId,
        });
        setAssignments((prev) => [...prev, { id: ref.id, subjectId: subject.id, sectionId: view.section.id, teacherId }]);
      }
      setAssignModal(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const assignClassTeacher = async (teacherId: string) => {
    if (view.kind !== "class-teacher") return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "sections", view.section.id), { classTeacherId: teacherId });
      const updatedSection = { ...view.section, classTeacherId: teacherId };
      setSections((prev) => prev.map((s) => s.id === view.section.id ? updatedSection : s));
      setView({ kind: "section-options", grade: view.grade, section: updatedSection });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeStudent = async (student: Student) => {
    if (!confirm(`Remove ${student.name} from this section?`)) return;
    const en = await getActiveEnrollment(student.id);
    if (en) {
      await updateDoc(doc(db, "enrollments", en.id), { sectionId: null, sectionName: null });
    }
    setSectionStudents((prev) => prev.filter((s) => s.id !== student.id));
  };

  const getAssignedTeacher = (subjectId: string, sectionId: string) => {
    const a = assignments.find((x) => x.subjectId === subjectId && x.sectionId === sectionId);
    if (!a) return null;
    return teachers.find((t) => t.id === a.teacherId) ?? null;
  };

  const getClassTeacher = (section: Section) => {
    return teachers.find((t) => t.id === section.classTeacherId) ?? null;
  };

  const breadcrumb = () => {
    if (view.kind === "grades") return null;
    const parts: { label: string; onClick: () => void }[] = [
      { label: "Grades", onClick: () => setView({ kind: "grades" }) },
    ];
    if ("grade" in view) {
      parts.push({ label: `Grade ${view.grade}`, onClick: () => setView({ kind: "section-picker", grade: view.grade }) });
    }
    if ("section" in view) {
      parts.push({ label: `Section ${view.section.name}`, onClick: () => setView({ kind: "section-options", grade: view.grade, section: view.section }) });
    }
    const lastLabels: Record<string, string> = {
      subjects: "Subjects",
      students: "Students",
      "class-teacher": "Class Teacher",
    };
    if (view.kind in lastLabels) {
      parts.push({ label: lastLabels[view.kind], onClick: () => {} });
    }
    return (
      <div className="flex items-center gap-1 text-sm text-muted-foreground mb-4 flex-wrap">
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} />}
            <button
              onClick={p.onClick}
              className={i === parts.length - 1 ? "text-foreground font-medium" : "hover:text-foreground transition-colors"}
            >
              {p.label}
            </button>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Class Management</h1>
        <p className="text-muted-foreground text-sm">Manage sections, subjects, and students</p>
      </div>

      {breadcrumb()}

      {/* Grades */}
      {view.kind === "grades" && (
        hodGrades.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No grades assigned. Contact admin to assign grades.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {hodGrades.map((grade) => (
              <Card
                key={grade}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setView({ kind: "section-picker", grade })}
              >
                <CardContent className="pt-6 pb-6 text-center">
                  <p className="text-3xl font-bold text-primary mb-1">{grade}</p>
                  <p className="text-sm text-muted-foreground">Grade</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {/* Section Picker */}
      {view.kind === "section-picker" && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-muted-foreground">GRADE {view.grade} — SECTIONS</p>
          <div className="flex flex-wrap gap-3">
            {sections.map((sec) => (
              <div key={sec.id} className="flex items-center gap-1 group">
                <Card
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => { loadTeachers(); setView({ kind: "section-options", grade: view.grade, section: sec }); }}
                >
                  <CardContent className="pt-4 pb-4 px-6 text-center">
                    <p className="text-2xl font-bold text-primary">{sec.name}</p>
                    {sec.classTeacherId && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {teachers.find(t => t.id === sec.classTeacherId)?.name ?? "Class Teacher set"}
                      </p>
                    )}
                  </CardContent>
                </Card>
                <button
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                  onClick={() => setConfirmDeleteSection(sec)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                className="w-24 text-center font-bold"
                value={addSectionInput}
                onChange={(e) => { setAddSectionInput(e.target.value.toUpperCase()); setAddSectionError(""); }}
                placeholder="A"
                maxLength={3}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSection(view.grade))}
              />
              <Button size="sm" variant="outline" onClick={() => addSection(view.grade)} disabled={saving} className="gap-1">
                <Plus size={14} /> Add
              </Button>
            </div>
          </div>
          {addSectionError && <p className="text-sm text-destructive">{addSectionError}</p>}
          {sections.length === 0 && !addSectionError && (
            <p className="text-sm text-muted-foreground">No sections yet. Add one above.</p>
          )}
        </div>
      )}

      {/* Section Options */}
      {view.kind === "section-options" && (() => {
        const ct = teachers.find(t => t.id === view.section.classTeacherId);
        return (
          <div>
            <p className="text-sm font-semibold text-muted-foreground mb-3">
              GRADE {view.grade} — SECTION {view.section.name}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setView({ kind: "subjects", grade: view.grade, section: view.section })}>
                <CardContent className="pt-6 pb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
                      <BookOpen size={20} className="text-violet-500" />
                    </div>
                    <div>
                      <p className="font-semibold">Manage Subjects</p>
                      <p className="text-xs text-muted-foreground">Assign teachers to subjects</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setView({ kind: "students", grade: view.grade, section: view.section })}>
                <CardContent className="pt-6 pb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                      <GraduationCap size={20} className="text-green-500" />
                    </div>
                    <div>
                      <p className="font-semibold">Manage Students</p>
                      <p className="text-xs text-muted-foreground">View enrolled students</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setView({ kind: "class-teacher", grade: view.grade, section: view.section })}>
                <CardContent className="pt-6 pb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                      <UserCog size={20} className="text-orange-500" />
                    </div>
                    <div>
                      <p className="font-semibold">Class Teacher</p>
                      <p className="text-xs text-muted-foreground">
                        {ct ? ct.name : "Not assigned"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {ct && (
              <div className="mt-4 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
                <CheckCircle size={15} className="shrink-0" />
                <span>Class Teacher: <strong>{ct.name}</strong> ({ct.subject})</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Subjects */}
      {view.kind === "subjects" && (
        <div>
          <p className="text-sm font-semibold text-muted-foreground mb-3">
            SUBJECTS — GRADE {view.grade} / SECTION {view.section.name}
          </p>
          {subjects.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No subjects for Grade {view.grade}. Add subjects in the Admin panel.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {subjects.map((sub) => {
                const teacher = getAssignedTeacher(sub.id, view.section.id);
                return (
                  <Card key={sub.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                            <BookOpen size={15} className="text-violet-500" />
                          </div>
                          <div>
                            <p className="font-medium">{sub.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {teacher ? `Assigned: ${teacher.name}` : "No teacher assigned"}
                            </p>
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setAssignModal(sub)}>
                          {teacher ? "Reassign" : "Assign Teacher"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Students */}
      {view.kind === "students" && (
        <div>
          <p className="text-sm font-semibold text-muted-foreground mb-3">
            STUDENTS — GRADE {view.grade} / SECTION {view.section.name}
          </p>
          {sectionStudents.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No students in this section yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {sectionStudents.map((s) => (
                <Card key={s.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {s.photo ? (
                          <img src={s.photo} alt={s.name} className="w-9 h-9 rounded-full object-cover" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
                            <UserIcon size={16} className="text-green-500" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium">{s.name}</p>
                          <p className="text-xs text-muted-foreground">Grade {s.grade} — Section {view.section.name}</p>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => removeStudent(s)}>
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Class Teacher Assignment */}
      {view.kind === "class-teacher" && (
        <div>
          <p className="text-sm font-semibold text-muted-foreground mb-1">
            ASSIGN CLASS TEACHER — GRADE {view.grade} / SECTION {view.section.name}
          </p>
          <p className="text-xs text-muted-foreground mb-4">Select one teacher to be the class teacher for this section.</p>

          {view.section.classTeacherId && (
            <div className="mb-4 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
              <CheckCircle size={15} className="shrink-0" />
              <span>
                Current class teacher: <strong>
                  {teachers.find(t => t.id === view.section.classTeacherId)?.name ?? "Loading..."}
                </strong>
              </span>
            </div>
          )}

          {teachers.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No teachers under your HOD account. Ask admin to assign teachers to you.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {teachers.map((t) => {
                const isCurrent = t.id === view.section.classTeacherId;
                return (
                  <Card
                    key={t.id}
                    className={`cursor-pointer transition-all ${isCurrent ? "border-primary bg-primary/5" : "hover:shadow-md"}`}
                    onClick={() => !saving && assignClassTeacher(t.id)}
                  >
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {t.photo ? (
                            <img src={t.photo} alt={t.name} className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                              <UserIcon size={18} className="text-blue-500" />
                            </div>
                          )}
                          <div>
                            <p className="font-semibold">{t.name}</p>
                            <p className="text-xs text-muted-foreground">{t.subject}</p>
                          </div>
                        </div>
                        {isCurrent && (
                          <span className="flex items-center gap-1 text-xs text-primary font-semibold">
                            <CheckCircle size={14} /> Current
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Assign Subject Teacher Modal */}
      <Dialog open={!!assignModal} onOpenChange={(v) => !v && setAssignModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Teacher — {assignModal?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {teachers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teachers under your HOD account.</p>
            ) : (
              teachers.map((t) => (
                <button
                  key={t.id}
                  disabled={saving}
                  onClick={() => assignModal && assignTeacher(assignModal, t.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-muted text-left transition-colors disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <UserIcon size={14} className="text-blue-500" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.subject}</p>
                  </div>
                </button>
              ))
            )}
          </div>
          <Button variant="outline" className="w-full mt-2" onClick={() => setAssignModal(null)}>Cancel</Button>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Section */}
      <Dialog open={!!confirmDeleteSection} onOpenChange={(v) => !v && setConfirmDeleteSection(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-destructive" />
              Delete Section {confirmDeleteSection?.name}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove Section {confirmDeleteSection?.name} from Grade {confirmDeleteSection?.grade}.
            Students assigned here will become pending again.
          </p>
          <div className="flex gap-3 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDeleteSection(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1"
              onClick={() => confirmDeleteSection && deleteSection(confirmDeleteSection)}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, deleteDoc, updateDoc, doc, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Student, User, Enrollment } from "@/lib/types";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { User as UserIcon, Trash2, Loader2, CalendarDays, ArrowDownAZ } from "lucide-react";
import { syncAlphabeticalRollNumbersForSection } from "@/lib/enrollments";

const GRADES = ["1","2","3","4","5","6","7","8","9","10","11","12"];

function getGradeSortValue(grade: string): number {
  const match = grade.match(/\d+/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(match[0]);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function getGradeLabel(grade: string): string {
  if (!grade) return "Unassigned Grade";
  return /^grade\s+/i.test(grade) ? grade : `Grade ${grade}`;
}

export default function Students() {
  const { workingSession, activeSession } = useAcademicSession();
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollmentsMap, setEnrollmentsMap] = useState<Record<string, Enrollment>>({});
  const [hods, setHods] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", email: "", password: "", DOB: "", parentContact: "",
    grade: "", hodId: "", photo: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "students"));
      const mapStudents = new Map<string, Student>();
      snap.docs.forEach((d) => {
        mapStudents.set(d.id, { id: d.id, ...d.data() } as Student);
      });

      // Fallback: check admissions for students
      const admSnap = await getDocs(query(collection(db, "admissions"), where("type", "==", "student")));
      admSnap.docs.forEach((d) => {
        const data = d.data();
        const uid = data.linkedUid || d.id;
        if (!mapStudents.has(uid)) {
          mapStudents.set(uid, {
            id: uid,
            name: data.name || "Student",
            email: data.email || "",
            DOB: data.dob || "",
            parentContact: data.parentContact || "",
            grade: data.grade || "",
            hodId: data.hodId || "",
            photo: data.photoData || "",
            address: data.address || "",
            admissionNo: data.admissionNo || "",
          });
        }
      });

      setStudents(Array.from(mapStudents.values()));

      const hodSnap = await getDocs(query(collection(db, "users"), where("role", "==", "hod")));
      setHods(hodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as User)));

      const currentYear = workingSession?.name;
      if (currentYear) {
        const [enSnapYear, enSnapSession] = await Promise.all([
          getDocs(query(collection(db, "enrollments"), where("academicYear", "==", currentYear))),
          workingSession.id
            ? getDocs(query(collection(db, "enrollments"), where("sessionId", "==", workingSession.id)))
            : Promise.resolve(null),
        ]);

        const map: Record<string, Enrollment> = {};
        enSnapYear.docs.forEach((d) => {
          const data = { id: d.id, ...d.data() } as Enrollment;
          map[data.studentId] = data;
        });
        enSnapSession?.docs.forEach((d) => {
          const data = { id: d.id, ...d.data() } as Enrollment;
          map[data.studentId] = data;
        });
        setEnrollmentsMap(map);
      } else {
        setEnrollmentsMap({});
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workingSession?.name, workingSession?.id]);

  const handleQuickEnroll = async (s: Student) => {
    if (!workingSession) return;
    setLoading(true);
    try {
      const activeYear = workingSession.name;
      const grade = s.grade || "1";
      const matchingSectionSnap = await getDocs(
        query(collection(db, "sections"), where("grade", "==", grade)),
      );
      const matchingSection = matchingSectionSnap.docs[0]?.data();
      const matchingSectionId = matchingSectionSnap.docs[0]?.id;

      await addDoc(collection(db, "enrollments"), {
        studentId: s.id,
        academicYear: activeYear,
        sessionId: workingSession.id,
        className: grade,
        sectionName: matchingSection?.name || null,
        sectionId: matchingSectionId || null,
        hodId: s.hodId || matchingSection?.hodId || "",
        status: "active",
        createdAt: new Date().toISOString(),
      });

      if (matchingSectionId) {
        await syncAlphabeticalRollNumbersForSection(matchingSectionId, activeYear);
      }
      await load();
    } catch (err: any) {
      alert("Failed to enroll student in session: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoAssignAllRollNumbers = async () => {
    if (!workingSession) return;
    setLoading(true);
    try {
      const activeYear = workingSession.name;
      const secSnap = await getDocs(collection(db, "sections"));
      let totalUpdated = 0;
      for (const sDoc of secSnap.docs) {
        const { updatedCount } = await syncAlphabeticalRollNumbersForSection(sDoc.id, activeYear);
        totalUpdated += updatedCount;
      }
      await load();
      alert(`Alphabetical roll numbers assigned successfully! (${totalUpdated} student record(s) updated)`);
    } catch (err: any) {
      alert("Failed to auto-assign roll numbers: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (!editingId) {
        setActionError("Editing only. New admissions are added via Admissions module.");
        setLoading(false);
        return;
      }
      await updateDoc(doc(db, "students", editingId), {
        name: form.name,
        email: form.email,
        DOB: form.DOB,
        parentContact: form.parentContact,
        grade: form.grade,
        hodId: form.hodId,
        photo: form.photo,
      });

      // If student is enrolled in a section, re-sort alphabetical roll numbers
      const currentEnrollment = enrollmentsMap[editingId];
      if (currentEnrollment?.sectionId) {
        await syncAlphabeticalRollNumbersForSection(
          currentEnrollment.sectionId,
          workingSession?.name,
        );
      }

      setOpen(false);
      setEditingId(null);
      setForm({ name: "", email: "", password: "", DOB: "", parentContact: "", grade: "", hodId: "", photo: "" });
      setActionError("");
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStudent = async () => {
    if (!deleteTarget) return;
    setActionError("");
    setDeletingId(deleteTarget.id);
    try {
      await Promise.all([
        deleteDoc(doc(db, "students", deleteTarget.id)),
        ...(deleteTarget.uid ? [deleteDoc(doc(db, "users", deleteTarget.uid))] : []),
      ]);
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to delete student.");
    } finally {
      setDeletingId(null);
    }
  };

  const openEdit = (s: Student) => {
    setForm({
      name: s.name || "",
      email: s.email || "",
      password: "",
      DOB: s.DOB || "",
      parentContact: s.parentContact || "",
      grade: s.grade || "",
      hodId: s.hodId || "",
      photo: s.photo || "",
    });
    setEditingId(s.id);
    setOpen(true);
  };

  const groupedByGrade = useMemo(() => {
    const grouped = new Map<string, { student: Student; enrollment?: Enrollment }[]>();

    students.forEach((student) => {
      const en = enrollmentsMap[student.id];
      const key = en?.className?.trim() || student.grade?.trim() || "unassigned";
      const list = grouped.get(key) ?? [];
      list.push({ student, enrollment: en });
      grouped.set(key, list);
    });

    return Array.from(grouped.entries())
      .map(([grade, items]) => ({
        key: grade,
        label: grade === "unassigned" ? "Unassigned Grade" : getGradeLabel(grade),
        items: [...items].sort((a, b) => {
          const ar = a.enrollment?.rollNo || a.student.rollNo || "";
          const br = b.enrollment?.rollNo || b.student.rollNo || "";
          if (ar && br) return ar.localeCompare(br, undefined, { numeric: true });
          return (a.student.name || "").localeCompare(b.student.name || "");
        }),
      }))
      .sort((a, b) => {
        if (a.key === "unassigned") return 1;
        if (b.key === "unassigned") return -1;
        const gradeDiff = getGradeSortValue(a.key) - getGradeSortValue(b.key);
        if (gradeDiff !== 0) return gradeDiff;
        return a.label.localeCompare(b.label);
      });
  }, [students, enrollmentsMap]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Students</h1>
            <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5 text-primary text-xs">
              <CalendarDays size={12} />
              Session: {workingSession?.name || "All"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            Showing student enrollments and records for academic session <strong>{workingSession?.name}</strong>.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleAutoAssignAllRollNumbers}
          disabled={loading}
          className="gap-1.5 text-xs self-start sm:self-auto shadow-xs border-slate-300"
          title="Recalculate and assign alphabetical roll numbers (01, 02, 03...) for all sections"
        >
          <ArrowDownAZ size={14} className="text-primary" />
          <span>Auto-assign Alphabetical Roll Nos</span>
        </Button>
      </div>

      {actionError && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {students.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No students found.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedByGrade.map((group) => (
            <div key={group.key} className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{group.label}</p>
                  <p className="text-xs text-muted-foreground">{group.items.length} student(s)</p>
                </div>
                <Badge variant="outline" className="text-xs">
                  {workingSession?.name}
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.items.map(({ student: s, enrollment: en }) => (
                  <Card key={s.id}>
                    <CardContent className="pt-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {s.photo ? (
                            <img src={s.photo} alt={s.name} className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                              <UserIcon size={18} className="text-green-500" />
                            </div>
                          )}
                          <div>
                            <p className="font-semibold">{s.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {getGradeLabel(en?.className || s.grade || "")}
                            </p>
                          </div>
                        </div>

                        {en ? (
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${
                              en.status === "active"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                : en.status === "promoted"
                                  ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                                  : "border-slate-300 bg-slate-100 text-slate-700"
                            }`}
                          >
                            {en.status}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-800">
                            No Enrollment
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Roll No</span>
                          <span className="font-mono font-medium">{en?.rollNo || s.rollNo || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Section</span>
                          <span className={en?.sectionName || s.sectionId ? "font-medium text-green-600" : "text-orange-500"}>
                            {en?.sectionName ? `Section ${en.sectionName}` : s.sectionId ?? "Pending"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Parent Contact</span>
                          <span>{s.parentContact || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">DOB</span>
                          <span>{s.DOB || "—"}</span>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                        {!en && workingSession ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="text-xs h-8 text-primary font-medium"
                            onClick={() => handleQuickEnroll(s)}
                          >
                            Enroll in {workingSession.name}
                          </Button>
                        ) : <div />}
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(s)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(s)}
                          >
                            <Trash2 size={15} />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Student</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label>Date of Birth</Label>
                <Input type="date" value={form.DOB} onChange={(e) => setForm((f) => ({ ...f, DOB: e.target.value }))} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" value={form.password} disabled placeholder="Not editable here" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Grade</Label>
              <select
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={form.grade}
                onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                required
              >
                <option value="">Select grade</option>
                {GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Parent Contact</Label>
              <Input value={form.parentContact} onChange={(e) => setForm((f) => ({ ...f, parentContact: e.target.value }))} required />
            </div>
          </div>
            <div className="space-y-1.5">
              <Label>Photo (JPG/JPEG)</Label>
              <Input
                type="file"
                accept=".jpg,.jpeg"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    setForm((f) => ({ ...f, photo: typeof reader.result === "string" ? reader.result : "" }));
                  };
                  reader.readAsDataURL(file);
                }}
              />
              {form.photo ? (
                <div className="flex items-center gap-3 rounded-lg border border-border p-2">
                  <img src={form.photo} alt="Preview" className="h-10 w-10 rounded-full object-cover" />
                  <p className="text-xs text-muted-foreground">Preview saved in record</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Accepted: JPG/JPEG. Stored with the student record.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Assign HOD</Label>
              <select
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={form.hodId}
                onChange={(e) => setForm((f) => ({ ...f, hodId: e.target.value }))}
                required
              >
                <option value="">Select HOD</option>
                {hods.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save Changes"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Student?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} will be removed from the student list and login metadata used by this app.
              Historical academic or finance records are not automatically deleted in this flow.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId === deleteTarget?.id}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingId === deleteTarget?.id}
              onClick={handleDeleteStudent}
            >
              {deletingId === deleteTarget?.id ? <Loader2 className="animate-spin" /> : <Trash2 size={15} />}
              Delete Student
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, deleteDoc, updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Teacher, User } from "@/lib/types";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { User as UserIcon, CheckSquare, Square, Trash2, Loader2 } from "lucide-react";

export default function Teachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [hods, setHods] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    DOB: "",
    photo: "",
    subject: "",
    selectedHodIds: [] as string[],
  });

  const load = async () => {
    const [tSnap, hodSnap] = await Promise.all([
      getDocs(collection(db, "teachers")),
      getDocs(query(collection(db, "users"), where("role", "==", "hod"))),
    ]);
    setTeachers(tSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Teacher)));
    setHods(hodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as User)));
  };

  useEffect(() => { load(); }, []);

  const toggleHod = (hodId: string) => {
    setForm((f) => ({
      ...f,
      selectedHodIds: f.selectedHodIds.includes(hodId)
        ? f.selectedHodIds.filter((x) => x !== hodId)
        : [...f.selectedHodIds, hodId],
    }));
  };

  const getHodGrades = (hodId: string): string[] => {
    const hod = hods.find((h) => h.id === hodId);
    return (hod?.assignedGrades as string[] | undefined) ?? [];
  };

  const resetForm = () => {
    setForm({ name: "", email: "", password: "", DOB: "", photo: "", subject: "", selectedHodIds: [] });
    setError("");
  };

  const openEdit = (teacher: Teacher) => {
    setForm({
      name: teacher.name || "",
      email: teacher.email || "",
      password: "",
      DOB: teacher.DOB || "",
      photo: teacher.photo || "",
      subject: teacher.subject || "",
      selectedHodIds: teacher.hodIds || [],
    });
    setEditingTeacher(teacher);
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (form.selectedHodIds.length === 0) {
      setError("Please assign at least one HOD.");
      return;
    }
    setLoading(true);
    try {
      const hodAssignments = form.selectedHodIds.map((hodId) => ({
        hodId,
        grades: getHodGrades(hodId),
      }));

      if (!editingTeacher) {
        setError("Editing only. New admissions are added via Admissions module.");
        setLoading(false);
        return;
      }

      await updateDoc(doc(db, "teachers", editingTeacher.id), {
        name: form.name,
        email: form.email,
        subject: form.subject,
        DOB: form.DOB,
        photo: form.photo,
        hodIds: form.selectedHodIds,
        hodAssignments,
      });
      setOpen(false);
      setEditingTeacher(null);
      resetForm();
      setActionError("");
      load();
    } catch (err: any) {
      setError(err.message ?? "Failed to update teacher.");
    } finally {
      setLoading(false);
    }
  };

  const getTeacherHodNames = (t: Teacher) => {
    return t.hodIds?.map((id) => hods.find((h) => h.id === id)?.name ?? id).join(", ");
  };

  const getTeacherGrades = (t: Teacher) => {
    const grades = new Set<string>();
    t.hodAssignments?.forEach((a) => a.grades?.forEach((g) => grades.add(g)));
    return Array.from(grades).sort((a, b) => Number(a) - Number(b));
  };

  const groupedByHod = useMemo(() => {
    const groups = hods
      .map((hod) => ({
        id: hod.id,
        name: hod.name || "Unnamed HOD",
        teachers: teachers
          .filter((teacher) => teacher.hodIds?.includes(hod.id))
          .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
      }))
      .filter((group) => group.teachers.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const unassignedTeachers = teachers
      .filter((teacher) => !teacher.hodIds || teacher.hodIds.length === 0)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (unassignedTeachers.length > 0) {
      groups.push({
        id: "unassigned",
        name: "Unassigned Teachers",
        teachers: unassignedTeachers,
      });
    }

    return groups;
  }, [hods, teachers]);

  const handleDeleteTeacher = async () => {
    if (!deleteTarget) return;
    setActionError("");
    setDeletingId(deleteTarget.id);
    try {
      const [assignmentSnap, sectionSnap] = await Promise.all([
        getDocs(query(collection(db, "subjectAssignments"), where("teacherId", "==", deleteTarget.id))),
        getDocs(query(collection(db, "sections"), where("classTeacherId", "==", deleteTarget.id))),
      ]);

      await Promise.all([
        ...assignmentSnap.docs.map((record) => deleteDoc(doc(db, "subjectAssignments", record.id))),
        ...sectionSnap.docs.map((record) => updateDoc(doc(db, "sections", record.id), { classTeacherId: null })),
        deleteDoc(doc(db, "teachers", deleteTarget.id)),
        ...(deleteTarget.uid ? [deleteDoc(doc(db, "users", deleteTarget.uid))] : []),
      ]);

      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to delete teacher.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Teachers</h1>
          <p className="text-muted-foreground text-sm">Edit teaching staff (new admissions via Admissions module)</p>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {teachers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No teachers added yet. Add records via Admissions module.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedByHod.map((group) => (
            <div key={group.id} className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-2.5">
                <p className="text-sm font-semibold">
                  {group.id === "unassigned" ? group.name : `HOD: ${group.name}`}
                </p>
                <p className="text-xs text-muted-foreground">{group.teachers.length} teacher(s)</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.teachers.map((t) => {
                  const grades = getTeacherGrades(t);
                  return (
                    <Card key={t.id}>
                      <CardContent className="pt-5">
                        <div className="flex items-center gap-3 mb-3">
                          {t.photo ? (
                            <img src={t.photo} alt={t.name} className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                              <UserIcon size={18} className="text-blue-500" />
                            </div>
                          )}
                          <div>
                            <p className="font-semibold">{t.name}</p>
                            <p className="text-xs text-muted-foreground">{t.email}</p>
                          </div>
                        </div>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Subject</span>
                            <span className="font-medium">{t.subject}</span>
                          </div>
                          {t.DOB && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">DOB</span>
                              <span>{t.DOB}</span>
                            </div>
                          )}
                          {getTeacherHodNames(t) && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">HOD(s)</span>
                              <span className="text-right max-w-[140px] truncate">{getTeacherHodNames(t)}</span>
                            </div>
                          )}
                          {grades.length > 0 && (
                            <div className="pt-1 flex flex-wrap gap-1">
                              {grades.map((g) => (
                                <span key={g} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                                  G{g}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(t)}>Edit</Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteTarget(t)}
                          >
                            <Trash2 size={15} />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Teacher</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Full Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date of Birth</Label>
                <Input
                  type="date"
                  value={form.DOB}
                  onChange={(e) => setForm((f) => ({ ...f, DOB: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={form.password}
                  disabled
                  placeholder="Not editable here"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Subject *</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                required
                placeholder="e.g. Mathematics"
              />
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
                <p className="text-xs text-muted-foreground">Accepted: JPG/JPEG. Stored with the teacher record.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Assign HOD(s) *</Label>
              <p className="text-xs text-muted-foreground">
                Select one or more HODs. Grades are inherited automatically.
              </p>
              {hods.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No HODs available. Create HODs first.</p>
              ) : (
                <div className="space-y-2">
                  {hods.map((hod) => {
                    const selected = form.selectedHodIds.includes(hod.id);
                    const grades = getHodGrades(hod.id);
                    return (
                      <button
                        key={hod.id}
                        type="button"
                        onClick={() => toggleHod(hod.id)}
                        className={`w-full flex items-start gap-3 px-4 py-3 rounded-lg border-2 text-left transition-colors ${
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        <div className="mt-0.5 text-primary shrink-0">
                          {selected ? <CheckSquare size={16} /> : <Square size={16} className="text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{hod.name}</p>
                          {grades.length > 0 ? (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Grades: {grades.join(", ")}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground mt-0.5">No grades assigned</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {form.selectedHodIds.length > 0 && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                <p className="text-xs font-semibold text-blue-700 mb-2">Inherited Grade Coverage:</p>
                {form.selectedHodIds.map((hodId) => {
                  const hod = hods.find((h) => h.id === hodId);
                  const grades = getHodGrades(hodId);
                  return (
                    <div key={hodId} className="text-xs text-blue-700 flex items-center gap-2 mb-1">
                      <span className="font-medium">{hod?.name}:</span>
                      <span>{grades.length > 0 ? `Grades ${grades.join(", ")}` : "No grades"}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Teacher?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} will be removed from the admin teacher list, linked subject assignments, and class-teacher mapping.
              The Firebase authentication account is not removed in this client-only flow.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId === deleteTarget?.id}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingId === deleteTarget?.id}
              onClick={handleDeleteTeacher}
            >
              {deletingId === deleteTarget?.id ? <Loader2 className="animate-spin" /> : <Trash2 size={15} />}
              Delete Teacher
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

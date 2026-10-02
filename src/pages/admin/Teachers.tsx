import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
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
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { User as UserIcon, CheckSquare, Square, Trash2, Loader2, Plus, Users, Search, GraduationCap } from "lucide-react";
import { SearchInput } from "@/components/ui/SearchInput";

const GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

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

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [hodFilter, setHodFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");

  const [form, setForm] = useState({
    name: "",
    email: "",
    DOB: "",
    photo: "",
    subject: "",
    selectedHodIds: [] as string[],
  });

  const load = async () => {
    setLoading(true);
    try {
      const [tSnap, hodSnap] = await Promise.all([
        getDocs(collection(db, "teachers")),
        getDocs(query(collection(db, "users"), where("role", "==", "hod"))),
      ]);
      setTeachers(tSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Teacher)));
      setHods(hodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as User)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

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
    setForm({ name: "", email: "", DOB: "", photo: "", subject: "", selectedHodIds: [] });
    setError("");
  };

  const openEdit = (teacher: Teacher) => {
    setForm({
      name: teacher.name || "",
      email: teacher.email || "",
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

  // Filter teachers by search, HOD, and grade
  const filteredTeachers = useMemo(() => {
    return teachers.filter((t) => {
      // HOD filter
      if (hodFilter !== "all") {
        if (hodFilter === "unassigned") {
          if (t.hodIds && t.hodIds.length > 0) return false;
        } else {
          if (!t.hodIds || !t.hodIds.includes(hodFilter)) return false;
        }
      }

      // Grade filter
      if (gradeFilter !== "all") {
        const grades = getTeacherGrades(t);
        if (!grades.includes(gradeFilter)) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (t.name || "").toLowerCase().includes(q);
        const matchEmail = (t.email || "").toLowerCase().includes(q);
        const matchSubject = (t.subject || "").toLowerCase().includes(q);
        const matchId = (t.id || "").toLowerCase().includes(q) || (t.uid || "").toLowerCase().includes(q);

        if (!matchName && !matchEmail && !matchSubject && !matchId) return false;
      }

      return true;
    });
  }, [teachers, hodFilter, gradeFilter, searchQuery]);

  const groupedByHod = useMemo(() => {
    const groups = hods
      .map((hod) => ({
        id: hod.id,
        name: hod.name || "Unnamed HOD",
        teachers: filteredTeachers
          .filter((teacher) => teacher.hodIds?.includes(hod.id))
          .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
      }))
      .filter((group) => group.teachers.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const unassignedTeachers = filteredTeachers
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
  }, [hods, filteredTeachers]);

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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Faculty & Teachers</h1>
            <Badge variant="outline" className="text-xs">
              {teachers.length} Total
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Institutional faculty, departmental allocations, and subject specializations.
          </p>
        </div>

        <Link href="/admin/admissions">
          <Button size="sm" className="gap-1.5 text-xs shadow-xs">
            <Plus size={14} />
            <span>Add Teacher</span>
          </Button>
        </Link>
      </div>

      {actionError && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Search & Filter Bar */}
      <Card className="glass-card shadow-xs mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search by Teacher Name, Email, Subject specialization, Staff ID..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-10 rounded-xl border border-white/80 bg-white/80 px-3 text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={hodFilter}
                onChange={(e) => setHodFilter(e.target.value)}
              >
                <option value="all">All HOD Departments</option>
                {hods.map((h) => (
                  <option key={h.id} value={h.id}>
                    HOD: {h.name}
                  </option>
                ))}
                <option value="unassigned">Unassigned HOD</option>
              </select>

              <select
                className="h-10 rounded-xl border border-white/80 bg-white/80 px-3 text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
              >
                <option value="all">All Grades</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </select>

              {(searchQuery || hodFilter !== "all" || gradeFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setHodFilter("all");
                    setGradeFilter("all");
                  }}
                  className="text-xs text-muted-foreground hover:text-slate-900"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Empty State: Zero Teachers in Database */}
      {teachers.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="py-16 text-center flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <GraduationCap className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">No Teachers Added Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1 mb-5">
              The faculty directory is currently empty. Register and onboard teachers through the Admissions module.
            </p>
            <Link href="/admin/admissions">
              <Button className="gap-2">
                <Plus size={16} /> Register First Teacher
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : filteredTeachers.length === 0 ? (
        /* Empty State: Search filter returned 0 */
        <Card className="border-dashed border-slate-200">
          <CardContent className="py-12 text-center flex flex-col items-center justify-center">
            <Search className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-700">No teachers match your search criteria</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-4">
              Try adjusting your query or resetting filters.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setHodFilter("all");
                setGradeFilter("all");
              }}
            >
              Clear Search & Filters
            </Button>
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
                    <Card key={t.id} className="overflow-hidden hover:shadow-sm transition-shadow">
                      <CardContent className="pt-5">
                        <div className="flex items-center gap-3 mb-3">
                          {t.photo ? (
                            <img src={t.photo} alt={t.name} className="w-10 h-10 rounded-full object-cover border" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                              <UserIcon size={18} className="text-blue-500" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate">{t.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{t.email}</p>
                          </div>
                        </div>

                        <div className="space-y-1.5 text-sm bg-slate-50/60 p-3 rounded-xl border border-slate-100">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">Subject</span>
                            <span className="font-medium text-xs text-slate-800">{t.subject}</span>
                          </div>
                          {t.DOB && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground text-xs">DOB</span>
                              <span className="text-xs">{t.DOB}</span>
                            </div>
                          )}
                          {getTeacherHodNames(t) && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground text-xs">HOD(s)</span>
                              <span className="text-right text-xs max-w-[140px] truncate text-slate-700">
                                {getTeacherHodNames(t)}
                              </span>
                            </div>
                          )}
                          {grades.length > 0 && (
                            <div className="pt-1 flex flex-wrap gap-1">
                              {grades.map((g) => (
                                <span
                                  key={g}
                                  className="text-[10px] bg-slate-200/70 text-slate-700 px-1.5 py-0.5 rounded font-medium"
                                >
                                  Gr {g}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 justify-end mt-4 border-t pt-3">
                          <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => openEdit(t)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 text-xs h-8 px-2"
                            onClick={() => setDeleteTarget(t)}
                          >
                            <Trash2 size={13} />
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

      {/* Edit Teacher Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Teacher</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
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
            <div className="space-y-2">
              <Label>Assign to HODs</Label>
              <div className="space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                {hods.map((h) => {
                  const selected = form.selectedHodIds.includes(h.id);
                  const grades = getHodGrades(h.id);
                  return (
                    <div
                      key={h.id}
                      onClick={() => toggleHod(h.id)}
                      className="flex items-center gap-2 p-1.5 hover:bg-muted rounded cursor-pointer text-sm"
                    >
                      {selected ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}
                      <div>
                        <p className="font-medium text-xs">{h.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Grades: {grades.join(", ") || "None"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Teacher?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name} will be removed from the teachers directory and unlinked from classes.
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

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
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
import { User as UserIcon, Trash2, Loader2, CalendarDays, ArrowDownAZ, Search, Plus, Filter, Users, X } from "lucide-react";
import { syncAlphabeticalRollNumbersForSection } from "@/lib/enrollments";
import { SearchInput } from "@/components/ui/SearchInput";

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
  const { workingSession } = useAcademicSession();
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollmentsMap, setEnrollmentsMap] = useState<Record<string, Enrollment>>({});
  const [hods, setHods] = useState<User[]>([]);
  const [availableSections, setAvailableSections] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");

  const [form, setForm] = useState({
    name: "", email: "", DOB: "", parentContact: "",
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

      const [hodSnap, secSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "==", "hod"))),
        getDocs(collection(db, "sections")),
      ]);

      setHods(hodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as User)));

      const distinctSecs = Array.from(
        new Set(secSnap.docs.map((d) => d.data().name || d.data().sectionName).filter(Boolean))
      ).sort() as string[];
      setAvailableSections(distinctSecs);

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

      const currentEnrollment = enrollmentsMap[editingId];
      if (currentEnrollment?.sectionId) {
        await syncAlphabeticalRollNumbersForSection(
          currentEnrollment.sectionId,
          workingSession?.name,
        );
      }

      setOpen(false);
      setEditingId(null);
      setForm({ name: "", email: "", DOB: "", parentContact: "", grade: "", hodId: "", photo: "" });
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
      DOB: s.DOB || "",
      parentContact: s.parentContact || "",
      grade: s.grade || "",
      hodId: s.hodId || "",
      photo: s.photo || "",
    });
    setEditingId(s.id);
    setOpen(true);
  };

  // Filtered Students
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const en = enrollmentsMap[s.id];
      const grade = en?.className?.trim() || s.grade?.trim() || "unassigned";
      const section = en?.sectionName || "";

      // Grade Filter
      if (gradeFilter !== "all") {
        if (gradeFilter === "unassigned" && grade !== "unassigned") return false;
        if (gradeFilter !== "unassigned" && grade !== gradeFilter) return false;
      }

      // Section Filter
      if (sectionFilter !== "all" && section !== sectionFilter) {
        return false;
      }

      // Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (s.name || "").toLowerCase().includes(q);
        const matchRoll = (en?.rollNo || s.rollNo || "").toLowerCase().includes(q);
        const matchAdm = (s.admissionNo || "").toLowerCase().includes(q);
        const matchId = (s.id || "").toLowerCase().includes(q) || (s.uid || "").toLowerCase().includes(q);
        const matchPhone = (s.parentContact || "").toLowerCase().includes(q);
        const matchEmail = (s.email || "").toLowerCase().includes(q);

        if (!matchName && !matchRoll && !matchAdm && !matchId && !matchPhone && !matchEmail) {
          return false;
        }
      }

      return true;
    });
  }, [students, enrollmentsMap, gradeFilter, sectionFilter, searchQuery]);

  const groupedByGrade = useMemo(() => {
    const grouped = new Map<string, { student: Student; enrollment?: Enrollment }[]>();

    filteredStudents.forEach((student) => {
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
  }, [filteredStudents, enrollmentsMap]);

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
            <Badge variant="outline" className="text-xs">
              {students.length} Total
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">
            Showing student enrollments and records for academic session <strong>{workingSession?.name}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/admin/admissions">
            <Button size="sm" className="gap-1.5 text-xs shadow-xs">
              <Plus size={14} />
              <span>Enroll Student</span>
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoAssignAllRollNumbers}
            disabled={loading || students.length === 0}
            className="gap-1.5 text-xs self-start sm:self-auto shadow-xs border-slate-300"
            title="Recalculate and assign alphabetical roll numbers (01, 02, 03...) for all sections"
          >
            <ArrowDownAZ size={14} className="text-primary" />
            <span className="hidden sm:inline">Auto-assign Roll Nos</span>
          </Button>
        </div>
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
                placeholder="Search by Name, Roll No, Admission No, Student ID, Parent Contact..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
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
                <option value="unassigned">Unassigned Grade</option>
              </select>

              <select
                className="h-10 rounded-xl border border-white/80 bg-white/80 px-3 text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
              >
                <option value="all">All Sections</option>
                {availableSections.map((sec) => (
                  <option key={sec} value={sec}>
                    Section {sec}
                  </option>
                ))}
              </select>

              {(searchQuery || gradeFilter !== "all" || sectionFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setGradeFilter("all");
                    setSectionFilter("all");
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

      {/* Empty State: Zero Students in Database */}
      {students.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="py-16 text-center flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <Users className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">No Students Enrolled Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1 mb-5">
              The student directory is currently clean. Register and enroll new students through the Admissions module.
            </p>
            <Link href="/admin/admissions">
              <Button className="gap-2">
                <Plus size={16} /> Enroll First Student
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : filteredStudents.length === 0 ? (
        /* Empty State: Search / Filter yielded 0 */
        <Card className="border-dashed border-slate-200">
          <CardContent className="py-12 text-center flex flex-col items-center justify-center">
            <Search className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-700">No students match your search criteria</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-4">
              Try adjusting your query or resetting filters.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setGradeFilter("all");
                setSectionFilter("all");
              }}
            >
              Clear Search & Filters
            </Button>
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
                  <Card key={s.id} className="overflow-hidden hover:shadow-sm transition-shadow">
                    <CardContent className="pt-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {s.photo ? (
                            <img src={s.photo} alt={s.name} className="w-10 h-10 rounded-full object-cover border" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                              <UserIcon size={18} className="text-emerald-600" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate">{s.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {getGradeLabel(en?.className || s.grade || "")}
                            </p>
                          </div>
                        </div>

                        {en ? (
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize shrink-0 ${
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
                          <Badge variant="outline" className="text-[10px] shrink-0 border-amber-300 bg-amber-50 text-amber-800">
                            No Enrollment
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-1 text-sm bg-slate-50/60 p-3 rounded-xl border border-slate-100">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground text-xs">Roll No</span>
                          <span className="font-mono font-medium text-xs">{en?.rollNo || s.rollNo || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground text-xs">Admission No</span>
                          <span className="font-mono text-xs">{s.admissionNo || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground text-xs">Section</span>
                          <span className={`text-xs ${en?.sectionName || s.sectionId ? "font-medium text-emerald-700" : "text-amber-600"}`}>
                            {en?.sectionName ? `Section ${en.sectionName}` : s.sectionId ?? "Pending"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground text-xs">Parent Contact</span>
                          <span className="font-mono text-xs">{s.parentContact || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground text-xs">DOB</span>
                          <span className="text-xs">{s.DOB || "—"}</span>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                        {!en && workingSession ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => handleQuickEnroll(s)}
                            disabled={loading}
                          >
                            Enroll in {workingSession.name}
                          </Button>
                        ) : (
                          <div />
                        )}

                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="text-xs h-8" onClick={() => openEdit(s)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 text-xs h-8 px-2"
                            onClick={() => setDeleteTarget(s)}
                          >
                            <Trash2 size={13} />
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

      {/* Edit Student Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Student Record</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <Label>Date of Birth</Label>
              <Input
                type="date"
                value={form.DOB}
                onChange={(e) => setForm((f) => ({ ...f, DOB: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Parent Contact</Label>
              <Input
                value={form.parentContact}
                onChange={(e) => setForm((f) => ({ ...f, parentContact: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Grade</Label>
              <select
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={form.grade}
                onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                required
              >
                <option value="">Select Grade</option>
                {GRADES.map((g) => <option key={g} value={g}>Grade {g}</option>)}
              </select>
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

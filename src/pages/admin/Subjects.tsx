import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, addDoc, updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Subject } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, BookOpen, ArrowUp, ArrowDown, Search } from "lucide-react";
import { SearchInput } from "@/components/ui/SearchInput";

const GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

export default function Subjects() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", grade: "", category: "scholastic" as Subject["category"] });

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const load = async () => {
    const snap = await getDocs(collection(db, "subjects"));
    const counter: Record<string, number> = {};
    const mapped = snap.docs.map((d) => {
      const data = d.data() as Subject;
      const grade = data.grade ?? "";
      const current = counter[grade] ?? 0;
      const order = typeof data.order === "number" ? data.order : current;
      counter[grade] = Math.max(current + 1, order + 1);
      return {
        id: d.id,
        name: data.name,
        grade,
        category: (data as any).category ?? "scholastic",
        order,
      } as Subject;
    });
    setSubjects(mapped);
  };

  useEffect(() => { void load(); }, []);

  const moveSubject = async (subject: Subject, direction: "up" | "down") => {
    const list = grouped[subject.grade] ?? [];
    const idx = list.findIndex((s) => s.id === subject.id);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    const target = list[targetIdx];
    if (!target) return;
    const currentOrder = subject.order ?? idx;
    const targetOrder = target.order ?? targetIdx;
    await Promise.all([
      updateDoc(doc(db, "subjects", subject.id), { order: targetOrder }),
      updateDoc(doc(db, "subjects", target.id), { order: currentOrder }),
    ]);
    await load();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const gradeList = grouped[form.grade] ?? [];
      const maxOrder = gradeList.reduce((max, s) => Math.max(max, s.order ?? 0), -1);
      await addDoc(collection(db, "subjects"), {
        name: form.name.trim(),
        grade: form.grade,
        category: form.category ?? "scholastic",
        order: maxOrder + 1,
      });
      setOpen(false);
      setForm({ name: "", grade: "", category: "scholastic" });
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Filtered Subjects
  const filteredSubjects = useMemo(() => {
    return subjects.filter((s) => {
      if (gradeFilter !== "all" && s.grade !== gradeFilter) return false;
      if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = s.name.toLowerCase().includes(q);
        const matchCat = (s.category || "").toLowerCase().includes(q);
        const matchGrade = `grade ${s.grade}`.toLowerCase().includes(q);
        if (!matchName && !matchCat && !matchGrade) return false;
      }
      return true;
    });
  }, [subjects, gradeFilter, categoryFilter, searchQuery]);

  const grouped = useMemo(() => {
    const acc = filteredSubjects.reduce<Record<string, Subject[]>>((map, s) => {
      if (!map[s.grade]) map[s.grade] = [];
      map[s.grade].push(s);
      return map;
    }, {});
    Object.keys(acc).forEach((grade) => {
      acc[grade] = acc[grade].sort((a, b) => {
        const orderDiff = (a.order ?? 0) - (b.order ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name);
      });
    });
    return acc;
  }, [filteredSubjects]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Curriculum Subjects</h1>
            <Badge variant="outline" className="text-xs">
              {subjects.length} Total
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Institutional course subjects, order of appearance, and academic categorization.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2 shadow-xs">
          <Plus size={16} /> Add Subject
        </Button>
      </div>

      {/* Search & Filter Bar */}
      <Card className="glass-card shadow-xs mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search subjects by name, category, or grade..."
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
              </select>

              <select
                className="h-10 rounded-xl border border-white/80 bg-white/80 px-3 text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="all">All Categories</option>
                <option value="scholastic">Scholastic</option>
                <option value="co-scholastic">Co-Scholastic</option>
              </select>

              {(searchQuery || gradeFilter !== "all" || categoryFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setGradeFilter("all");
                    setCategoryFilter("all");
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

      {subjects.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="py-16 text-center flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <BookOpen className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">No Subjects Configured Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1 mb-5">
              Get started by adding subjects to define the curriculum for each grade.
            </p>
            <Button onClick={() => setOpen(true)} className="gap-2">
              <Plus size={16} /> Add First Subject
            </Button>
          </CardContent>
        </Card>
      ) : filteredSubjects.length === 0 ? (
        <Card className="border-dashed border-slate-200">
          <CardContent className="py-12 text-center flex flex-col items-center justify-center">
            <Search className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-700">No subjects match your search</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-4">
              Try adjusting your query or resetting filters.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setGradeFilter("all");
                setCategoryFilter("all");
              }}
            >
              Clear Search & Filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {GRADES.filter((g) => grouped[g]).map((grade) => (
            <div key={grade} className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">GRADE {grade}</h3>
                <Badge variant="outline" className="text-xs">
                  {grouped[grade].length} Subject(s)
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {grouped[grade].map((s, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === grouped[grade].length - 1;
                  return (
                    <Card key={s.id} className="shadow-xs hover:shadow-sm transition-shadow">
                      <CardContent className="pt-4 pb-3 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <BookOpen size={16} className="text-violet-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{s.name}</p>
                              <p className="text-[11px] text-muted-foreground">Order #{(s.order ?? idx) + 1}</p>
                            </div>
                          </div>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${
                              s.category === "co-scholastic"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {s.category === "co-scholastic" ? "Co-scholastic" : "Scholastic"}
                          </span>
                        </div>
                        <div className="flex justify-end gap-2 border-t pt-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={isFirst}
                            onClick={() => moveSubject(s, "up")}
                            title="Move up"
                            className="h-7 w-7"
                          >
                            <ArrowUp size={12} />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={isLast}
                            onClick={() => moveSubject(s, "down")}
                            title="Move down"
                            className="h-7 w-7"
                          >
                            <ArrowDown size={12} />
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

      {/* Add Subject Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Subject</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Subject Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Mathematics"
                required
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
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <select
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Subject["category"] }))}
              >
                <option value="scholastic">Scholastic (Academic)</option>
                <option value="co-scholastic">Co-Scholastic (Skill/Activity)</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Adding..." : "Add Subject"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

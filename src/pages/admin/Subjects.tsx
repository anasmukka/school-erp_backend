import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, addDoc, updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Subject } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, BookOpen, ArrowUp, ArrowDown } from "lucide-react";

const GRADES = ["1","2","3","4","5","6","7","8","9","10","11","12"];

export default function Subjects() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", grade: "", category: "scholastic" as Subject["category"] });

  const load = async () => {
    const snap = await getDocs(collection(db, "subjects"));
    // normalize order per grade for existing records
    const counter: Record<string, number> = {};
    const mapped = snap.docs.map((d, idx) => {
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

  useEffect(() => { load(); }, []);

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

  const grouped = useMemo(() => {
    const acc = subjects.reduce<Record<string, Subject[]>>((map, s) => {
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
  }, [subjects]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Subjects</h1>
          <p className="text-muted-foreground text-sm">Manage subjects by grade</p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus size={16} /> Add Subject
        </Button>
      </div>

      {subjects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No subjects added yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {GRADES.filter((g) => grouped[g]).map((grade) => (
            <div key={grade}>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">GRADE {grade}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {grouped[grade].map((s, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === grouped[grade].length - 1;
                  return (
                    <Card key={s.id} className="shadow-sm">
                      <CardContent className="pt-4 pb-3 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <BookOpen size={16} className="text-violet-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{s.name}</p>
                              <p className="text-[11px] text-muted-foreground">Order #{(s.order ?? idx) + 1}</p>
                            </div>
                          </div>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                            s.category === "co-scholastic"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-700"
                          }`}>
                            {s.category === "co-scholastic" ? "Co-scholastic" : "Scholastic"}
                          </span>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={isFirst}
                            onClick={() => moveSubject(s, "up")}
                            title="Move up"
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={isLast}
                            onClick={() => moveSubject(s, "down")}
                            title="Move down"
                          >
                            <ArrowDown size={14} />
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Subject</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Subject Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="e.g. Mathematics" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <select
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Subject["category"] }))}
              >
                <option value="scholastic">Scholastic (marks / exams)</option>
                <option value="co-scholastic">Co-scholastic (grade-only)</option>
              </select>
            </div>
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? "Adding..." : "Add Subject"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

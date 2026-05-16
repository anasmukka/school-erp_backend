import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, updateDoc, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, CheckCircle, Plus, ShieldCheck, Timer } from "lucide-react";

type AcademicYear = {
  id: string;
  name: string; // e.g., 2026-27
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isCurrent?: boolean;
  notes?: string;
  createdAt?: string;
};

export default function AcademicYears() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    startDate: "",
    endDate: "",
    notes: "",
  });

  const load = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, "academicYears"));
    setYears(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as AcademicYear))
        .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? "")),
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const currentYear = useMemo(() => years.find((y) => y.isCurrent), [years]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.startDate || !form.endDate) {
      setError("Name, start date, and end date are required.");
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "academicYears"), {
        name: form.name.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        notes: form.notes.trim(),
        isCurrent: false,
        createdAt: new Date().toISOString(),
      });
      setDialogOpen(false);
      setForm({ name: "", startDate: "", endDate: "", notes: "" });
      setMessage("Academic year saved.");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save academic year.");
    } finally {
      setSaving(false);
    }
  };

  const setCurrent = async (id: string) => {
    setSaving(true);
    setMessage("");
    try {
      const currentSnap = await getDocs(query(collection(db, "academicYears"), where("isCurrent", "==", true)));
      await Promise.all([
        ...currentSnap.docs.map((d) => updateDoc(doc(db, "academicYears", d.id), { isCurrent: false })),
        updateDoc(doc(db, "academicYears", id), { isCurrent: true }),
      ]);
      setMessage("Current academic year updated.");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to set current academic year.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Academic Years</h1>
          <p className="text-sm text-muted-foreground">
            Plan academic sessions, set the active year, and keep promotion paused while we design the workflow.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setDialogOpen(true)}>
          <Plus size={16} /> Add Academic Year
        </Button>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Loading academic years...</CardContent>
        </Card>
      ) : years.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No academic years added yet. Create one to start planning.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {years.map((y) => (
            <Card key={y.id} className="shadow-sm">
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{y.name}</h3>
                      {y.isCurrent && (
                        <Badge variant="outline" className="gap-1 text-emerald-700 border-emerald-200">
                          <ShieldCheck size={14} /> Current
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar size={12} /> {y.startDate} → {y.endDate}
                    </p>
                    {y.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{y.notes}</p>}
                  </div>
                  {!y.isCurrent && (
                    <Button size="sm" variant="outline" onClick={() => setCurrent(y.id)} disabled={saving}>
                      <CheckCircle size={14} /> Set Current
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Academic Year</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSave}>
            <div className="space-y-1.5">
              <Label>Session Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. 2026-27"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Promotion, fee plan, or exam cycle notes"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

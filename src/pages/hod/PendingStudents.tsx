import { useEffect, useState } from "react";
import { collection, query, where, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { Student, Section } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GraduationCap, User as UserIcon, AlertTriangle } from "lucide-react";

export default function PendingStudents() {
  const { appUser } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [availableSections, setAvailableSections] = useState<Section[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!appUser) return;
    setLoading(true);
    const q = query(
      collection(db, "students"),
      where("hodId", "==", appUser.id),
      where("sectionId", "==", null)
    );
    const snap = await getDocs(q);
    setStudents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Student)));
    setLoading(false);
  };

  useEffect(() => { load(); }, [appUser]);

  const openAssignModal = async (student: Student) => {
    if (!appUser) return;
    setSelected(student);
    const q = query(
      collection(db, "sections"),
      where("grade", "==", student.grade),
      where("hodId", "==", appUser.id)
    );
    const snap = await getDocs(q);
    setAvailableSections(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Section)));
  };

  const assignSection = async (section: Section) => {
    if (!selected) return;
    setAssigning(true);
    try {
      await updateDoc(doc(db, "students", selected.id), { sectionId: section.id });
      setStudents((prev) => prev.filter((s) => s.id !== selected.id));
      setSelected(null);
      setAvailableSections([]);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Pending Students</h1>
        <p className="text-muted-foreground text-sm">Students awaiting section assignment</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : students.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap size={40} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">No pending students</p>
            <p className="text-sm text-muted-foreground">All students have been assigned to sections.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {students.map((s) => (
            <Card key={s.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
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
                      <p className="text-sm text-muted-foreground">Grade {s.grade}</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => openAssignModal(s)}>
                    Assign Section
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setAvailableSections([]); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {selected?.name} — Grade {selected?.grade}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Select a section to assign this student:</p>

            {availableSections.length === 0 ? (
              <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-3 text-sm text-orange-700">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>
                  No sections available for Grade {selected?.grade}. Go to <strong>Class Management</strong> to create sections first.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {availableSections.map((sec) => (
                  <button
                    key={sec.id}
                    disabled={assigning}
                    onClick={() => assignSection(sec)}
                    className="h-14 rounded-xl text-lg font-bold border-2 border-primary/20 bg-primary/5 hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
                  >
                    {sec.name}
                  </button>
                ))}
              </div>
            )}

            <Button variant="outline" className="w-full" onClick={() => { setSelected(null); setAvailableSections([]); }}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

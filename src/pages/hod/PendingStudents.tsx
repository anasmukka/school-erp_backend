import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Student, Section } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GraduationCap, User as UserIcon } from "lucide-react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  assignSectionToEnrollment,
  createActiveEnrollment,
  getCurrentAcademicYear,
  listPendingEnrollmentsForHod,
} from "@/lib/enrollments";

export default function PendingStudents() {
  const { appUser } = useAuth();
  const [pending, setPending] = useState<{ student: Student; enrollmentId: string; className: string }[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState("");
  const [availableSections, setAvailableSections] = useState<Section[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!appUser) return;
    setLoading(true);
    const rows = await listPendingEnrollmentsForHod(appUser.id);
    setPending(
      rows.map((r) => ({
        student: r.student,
        enrollmentId: r.enrollment.id,
        className: r.enrollment.className || r.student.grade || "",
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [appUser]);

  const openAssignModal = async (student: Student, enrollmentId: string, className: string) => {
    if (!appUser) return;
    setSelected(student);
    setSelectedEnrollmentId(enrollmentId);
    const q = query(
      collection(db, "sections"),
      where("grade", "==", className),
      where("hodId", "==", appUser.id),
    );
    const snap = await getDocs(q);
    setAvailableSections(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Section)));
  };

  const assignSection = async (section: Section) => {
    if (!selected) return;
    setAssigning(true);
    try {
      let enrollmentId = selectedEnrollmentId;
      if (!enrollmentId) {
        const year = await getCurrentAcademicYear();
        enrollmentId = await createActiveEnrollment({
          studentId: selected.id,
          academicYear: year,
          className: section.grade,
          sectionName: null,
          sectionId: null,
          hodId: selected.hodId,
          rollNo: selected.rollNo,
        });
      }
      await assignSectionToEnrollment(enrollmentId, section, selected.rollNo);
      setPending((prev) => prev.filter((p) => p.student.id !== selected.id));
      setSelected(null);
      setSelectedEnrollmentId("");
      setAvailableSections([]);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Pending Students</h1>
        <p className="text-muted-foreground text-sm">Students awaiting section assignment (active enrollment)</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : pending.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap size={40} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">No pending students</p>
            <p className="text-sm text-muted-foreground">All students have been assigned to sections.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.map(({ student, enrollmentId, className }) => (
            <Card key={student.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {student.photo ? (
                      <img src={student.photo} alt={student.name} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                        <UserIcon size={18} className="text-green-500" />
                      </div>
                    )}
                    <div>
                      <p className="font-semibold">{student.name}</p>
                      <p className="text-sm text-muted-foreground">Grade {className}</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => openAssignModal(student, enrollmentId, className)}>
                    Assign Section
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Section — {selected?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {availableSections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sections available for this grade.</p>
            ) : (
              availableSections.map((sec) => (
                <Button
                  key={sec.id}
                  variant="outline"
                  className="w-full justify-start"
                  disabled={assigning}
                  onClick={() => assignSection(sec)}
                >
                  Section {sec.name}
                </Button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

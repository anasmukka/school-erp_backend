import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Student, User } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { getAcademicSession } from "@/lib/fees";

const GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

function nextGradeLabel(grade: string) {
  const num = Number(grade);
  if (Number.isNaN(num) || num >= 12) return "Graduated";
  return String(num + 1);
}

export default function Promotion() {
  const [students, setStudents] = useState<Student[]>([]);
  const [hods, setHods] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [promotingGrade, setPromotingGrade] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [confirmGrade, setConfirmGrade] = useState<string | null>(null);

  const currentSession = useMemo(() => getAcademicSession(), []);

  useEffect(() => {
    const load = async () => {
      const [studentSnap, hodSnap] = await Promise.all([
        getDocs(collection(db, "students")),
        getDocs(collection(db, "users")),
      ]);
      setStudents(studentSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Student)));
      setHods(
        hodSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as User))
          .filter((u) => u.role === "hod")
      );
      setLoading(false);
    };
    void load();
  }, []);

  const countsByGrade = useMemo(() => {
    const counts: Record<string, Student[]> = {};
    GRADES.forEach((g) => (counts[g] = []));
    students.forEach((s) => {
      if (!counts[s.grade]) counts[s.grade] = [];
      counts[s.grade].push(s);
    });
    return counts;
  }, [students]);

  const handlePromote = async (grade: string) => {
    const bucket = countsByGrade[grade] ?? [];
    if (bucket.length === 0) {
      setConfirmGrade(null);
      return;
    }
    setPromotingGrade(grade);
    setProgress(0);
    setMessage("");
    const targetGrade = nextGradeLabel(grade);
    try {
      for (let i = 0; i < bucket.length; i++) {
        const student = bucket[i];
        const targetHod =
          hods.find((h) => (h.assignedGrades as string[] | undefined)?.includes(targetGrade)) || null;
        await setDoc(
          doc(db, "students", student.id),
          {
            grade: targetGrade,
            sectionId: null,
            promotedFrom: grade,
            promotedAt: new Date().toISOString(),
            hodId: targetHod?.id ?? student.hodId ?? null,
          },
          { merge: true },
        );
        setProgress(Math.round(((i + 1) / bucket.length) * 100));
      }
      setStudents((prev) =>
        prev.map((s) =>
          s.grade === grade ? { ...s, grade: targetGrade, sectionId: null } : s,
        ),
      );
      setMessage(
        `Moved ${bucket.length} student${bucket.length === 1 ? "" : "s"} from Grade ${grade} to ${targetGrade}.`,
      );
    } catch (error) {
      console.error(error);
      setMessage("Unable to complete promotion right now.");
    } finally {
      setPromotingGrade(null);
      setConfirmGrade(null);
      setProgress(0);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Promotion</h1>
        <p className="text-sm text-muted-foreground">
          Move students to the next grade for the new session. Sections are cleared so HODs can reassign.
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">Current session: {currentSession}</Badge>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      {loading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">Loading students...</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {GRADES.map((grade) => {
            const bucket = countsByGrade[grade] ?? [];
            const target = nextGradeLabel(grade);
            const hasStudents = bucket.length > 0;
            return (
              <Card key={grade} className="border-border shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="pt-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground font-semibold">Grade</p>
                      <p className="text-xl font-bold">Grade {grade}</p>
                    </div>
                    <Badge variant={hasStudents ? "secondary" : "outline"}>
                      {bucket.length} student{bucket.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3 text-sm">
                    <p className="text-muted-foreground">Next</p>
                    <p className="font-semibold">
                      {target === "Graduated" ? "Mark as Graduated" : `Promote to Grade ${target}`}
                    </p>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!hasStudents || promotingGrade !== null}
                    variant={hasStudents ? "default" : "outline"}
                    onClick={() => hasStudents && setConfirmGrade(grade)}
                  >
                    {hasStudents
                      ? target === "Graduated"
                        ? "Mark Graduated"
                        : "Promote Grade"
                      : "No students to promote"}
                  </Button>
                  {promotingGrade === grade ? (
                    <div className="space-y-2">
                      <Progress value={progress} />
                      <p className="text-xs text-muted-foreground text-right">{progress}%</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={confirmGrade !== null} onOpenChange={(open) => !open && setConfirmGrade(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm promotion</AlertDialogTitle>
            <p className="text-sm text-muted-foreground">
              {confirmGrade
                ? `Move all Grade ${confirmGrade} students to ${nextGradeLabel(confirmGrade) === "Graduated" ? "Graduated" : `Grade ${nextGradeLabel(confirmGrade)}`}? Sections will be cleared.`
                : null}
            </p>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmGrade(null)}>Cancel</Button>
            <Button onClick={() => confirmGrade && void handlePromote(confirmGrade)} disabled={promotingGrade !== null}>
              Confirm
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

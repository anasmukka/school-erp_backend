import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Section } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, ArrowRight, Database, GraduationCap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getActiveEnrollmentsForSection,
  getCurrentAcademicYear,
  listAcademicYears,
  migrateLegacyStudentsToEnrollments,
  promoteEnrollment,
  sortStudentsByRoll,
  type StudentWithEnrollment,
} from "@/lib/enrollments";
import { getDoc, doc } from "firebase/firestore";

type Row = StudentWithEnrollment & { selected: boolean };

export default function StudentPromotion() {
  const { toast } = useToast();
  const [academicYears, setAcademicYears] = useState<{ id: string; name: string; isCurrent?: boolean }[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [fromSectionId, setFromSectionId] = useState("");
  const [toSectionId, setToSectionId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState(0);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [years, secSnap] = await Promise.all([
          listAcademicYears(),
          getDocs(collection(db, "sections")),
        ]);
        setAcademicYears(years);
        setSections(
          secSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Section))
            .sort((a, b) => {
              if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true });
              return a.name.localeCompare(b.name);
            }),
        );
        const current = await getCurrentAcademicYear();
        setFromYear(years.find((y) => y.isCurrent)?.name ?? current);
        const nextNum = Number(current.split("-")[0]);
        const nextYear = Number.isNaN(nextNum)
          ? ""
          : `${nextNum + 1}-${String(nextNum + 2).slice(2)}`;
        setToYear(years.find((y) => y.name === nextYear)?.name ?? nextYear);
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, []);

  const fromSection = sections.find((s) => s.id === fromSectionId) ?? null;
  const toSection = sections.find((s) => s.id === toSectionId) ?? null;

  const loadStudents = useCallback(async () => {
    if (!fromSectionId || !fromYear) {
      setRows([]);
      return;
    }
    setLoadingStudents(true);
    try {
      const enrollments = await getActiveEnrollmentsForSection(fromSectionId, fromYear);
      const merged: StudentWithEnrollment[] = [];
      for (const en of enrollments) {
        const sSnap = await getDoc(doc(db, "students", en.studentId));
        if (!sSnap.exists()) continue;
        merged.push({
          id: sSnap.id,
          ...(sSnap.data() as Omit<StudentWithEnrollment, "id">),
          enrollmentId: en.id,
          academicYear: en.academicYear,
          className: en.className,
          sectionName: en.sectionName,
          activeSectionId: en.sectionId,
          activeGrade: en.className,
          rollNo: en.rollNo ?? null,
          name: (sSnap.data() as { name?: string }).name ?? "",
        } as StudentWithEnrollment);
      }
      setRows(
        sortStudentsByRoll(merged).map((s) => ({
          ...s,
          selected: true,
        })),
      );
    } catch (e: unknown) {
      toast({
        title: "Could not load students",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
      setRows([]);
    } finally {
      setLoadingStudents(false);
    }
  }, [fromSectionId, fromYear, toast]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const selectedRows = useMemo(() => rows.filter((r) => r.selected), [rows]);
  const promoteToLabel = toSection
    ? `Grade ${toSection.grade} – Sec ${toSection.name}`
    : "—";

  const runMigration = async () => {
    setMigrating(true);
    setMigrateProgress(0);
    try {
      const result = await migrateLegacyStudentsToEnrollments((done, total) => {
        setMigrateProgress(total ? Math.round((done / total) * 100) : 0);
      });
      toast({
        title: "Migration complete",
        description: `Created ${result.created} enrollments, skipped ${result.skipped}.`,
      });
      await loadStudents();
    } catch (e: unknown) {
      toast({
        title: "Migration failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setMigrating(false);
      setMigrateProgress(0);
    }
  };

  const handlePromote = async () => {
    if (!toSection || !toYear || selectedRows.length === 0) return;
    setPromoting(true);
    setProgress(0);
    try {
      for (let i = 0; i < selectedRows.length; i++) {
        const row = selectedRows[i];
        if (!row.enrollmentId) {
          throw new Error(`Student ${row.name} has no active enrollment. Run migration first.`);
        }
        await promoteEnrollment({
          studentId: row.id,
          enrollmentId: row.enrollmentId,
          targetAcademicYear: toYear,
          targetClassName: toSection.grade,
          targetSectionName: toSection.name,
          targetSectionId: toSection.id,
          rollNo: row.rollNo ?? undefined,
          action: "promote",
        });
        setProgress(Math.round(((i + 1) / selectedRows.length) * 100));
      }
      toast({
        title: "Promotion complete",
        description: `${selectedRows.length} student(s) moved to ${toYear}, ${promoteToLabel}.`,
      });
      await loadStudents();
    } catch (e: unknown) {
      toast({
        title: "Promotion failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPromoting(false);
      setProgress(0);
      setConfirmOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-muted-foreground" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GraduationCap size={24} /> Student Promotion
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Promote students by academic year. Previous enrollments are kept for attendance and report card history.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">One-time data migration</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground flex-1 min-w-[200px]">
            Create active enrollments from existing student class/section fields without deleting data.
          </p>
          <Button variant="outline" className="gap-2" onClick={() => void runMigration()} disabled={migrating}>
            {migrating ? <Loader2 size={15} className="animate-spin" /> : <Database size={15} />}
            {migrating ? "Migrating…" : "Migrate existing students"}
          </Button>
          {migrating ? <Progress value={migrateProgress} className="w-full max-w-xs" /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Promotion settings</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
            <p className="text-xs font-semibold uppercase text-muted-foreground">From (current)</p>
            <div className="space-y-1.5">
              <Label>Academic year</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={fromYear}
                onChange={(e) => setFromYear(e.target.value)}
              >
                {academicYears.map((y) => (
                  <option key={y.id} value={y.name}>{y.name}</option>
                ))}
                {!academicYears.some((y) => y.name === fromYear) && fromYear ? (
                  <option value={fromYear}>{fromYear}</option>
                ) : null}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Class section</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={fromSectionId}
                onChange={(e) => setFromSectionId(e.target.value)}
              >
                <option value="">Select section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    Grade {s.grade} – Section {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
            <p className="text-xs font-semibold uppercase text-muted-foreground">To (target)</p>
            <div className="space-y-1.5">
              <Label>Academic year</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={toYear}
                onChange={(e) => setToYear(e.target.value)}
              >
                {academicYears.map((y) => (
                  <option key={y.id} value={y.name}>{y.name}</option>
                ))}
                {!academicYears.some((y) => y.name === toYear) && toYear ? (
                  <option value={toYear}>{toYear}</option>
                ) : null}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Class section</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={toSectionId}
                onChange={(e) => setToSectionId(e.target.value)}
              >
                <option value="">Select section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    Grade {s.grade} – Section {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Students to promote</CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRows((prev) => prev.map((r) => ({ ...r, selected: true })))}
              disabled={rows.length === 0}
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRows((prev) => prev.map((r) => ({ ...r, selected: false })))}
              disabled={rows.length === 0}
            >
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingStudents ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : !fromSectionId ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Select a source section to list students.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No active enrollments in this section/year. Run migration if students exist in the old model.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-2 w-10" />
                    <th className="py-2 pr-3">Roll No</th>
                    <th className="py-2 pr-3">Student Name</th>
                    <th className="py-2 pr-3">Current Class</th>
                    <th className="py-2">Promote To</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="py-2 pr-2">
                        <Checkbox
                          checked={row.selected}
                          onCheckedChange={(v) =>
                            setRows((prev) =>
                              prev.map((r) => (r.id === row.id ? { ...r, selected: !!v } : r)),
                            )
                          }
                        />
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{row.rollNo || "—"}</td>
                      <td className="py-2 pr-3 font-medium">{row.name}</td>
                      <td className="py-2 pr-3">
                        Grade {row.className}
                        {row.sectionName ? ` – ${row.sectionName}` : ""}
                      </td>
                      <td className="py-2 text-muted-foreground">{promoteToLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Badge variant="secondary">{selectedRows.length} selected</Badge>
            {fromSection && toSection ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                Grade {fromSection.grade}{fromSection.name} ({fromYear})
                <ArrowRight size={12} />
                Grade {toSection.grade}{toSection.name} ({toYear})
              </span>
            ) : null}
            <Button
              className="ml-auto gap-2"
              disabled={selectedRows.length === 0 || !toSectionId || !toYear || promoting}
              onClick={() => setConfirmOpen(true)}
            >
              {promoting ? <Loader2 size={15} className="animate-spin" /> : null}
              Promote selected
            </Button>
          </div>
          {promoting ? <Progress value={progress} className="mt-3" /> : null}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm promotion</AlertDialogTitle>
            <p className="text-sm text-muted-foreground">
              Promote {selectedRows.length} student(s) to {toYear}, {promoteToLabel}? Previous enrollments will be marked promoted.
            </p>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={promoting}>
              Cancel
            </Button>
            <Button onClick={() => void handlePromote()} disabled={promoting}>
              Confirm
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

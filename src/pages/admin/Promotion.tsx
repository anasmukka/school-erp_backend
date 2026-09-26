import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Section } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  ArrowRight,
  GraduationCap,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  LogOut,
  UserCheck,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import {
  getActiveEnrollmentsForSection,
  getEnrollmentForStudentInSession,
  promoteEnrollment,
  sortStudentsByRoll,
  syncAlphabeticalRollNumbersForSection,
  type StudentWithEnrollment,
} from "@/lib/enrollments";

export type PromotionAction = "promote" | "repeat" | "graduate" | "transfer";

type PromotionRow = StudentWithEnrollment & {
  selected: boolean;
  action: PromotionAction;
  customTargetSectionId: string;
  alreadyEnrolledInTarget: boolean;
  targetEnrollmentDetails?: string;
};

export default function StudentPromotion() {
  const { toast } = useToast();
  const { sessions, activeSession, workingSession } = useAcademicSession();

  const [sections, setSections] = useState<Section[]>([]);
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [fromSectionId, setFromSectionId] = useState("");
  const [toSectionId, setToSectionId] = useState("");
  const [rows, setRows] = useState<PromotionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Initialize sessions and sections
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const secSnap = await getDocs(collection(db, "sections"));
        const loadedSections = secSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Section))
          .sort((a, b) => {
            if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true });
            return a.name.localeCompare(b.name);
          });
        setSections(loadedSections);

        // Default fromYear to workingSession or activeSession
        const initialFrom = workingSession?.name ?? activeSession?.name ?? "";
        setFromYear(initialFrom);

        // Suggest default toYear (next session in list, or calculated)
        const sortedSessions = [...sessions].sort((a, b) => a.name.localeCompare(b.name));
        const currentIdx = sortedSessions.findIndex((s) => s.name === initialFrom);
        if (currentIdx >= 0 && currentIdx + 1 < sortedSessions.length) {
          setToYear(sortedSessions[currentIdx + 1].name);
        } else {
          const match = initialFrom.match(/^(\d{4})-(\d{2,4})$/);
          if (match) {
            const start = parseInt(match[1], 10);
            setToYear(`${start + 1}-${(start + 2).toString().slice(-2)}`);
          }
        }
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, [sessions, activeSession, workingSession]);

  const fromSection = useMemo(() => sections.find((s) => s.id === fromSectionId) ?? null, [sections, fromSectionId]);
  const toSection = useMemo(() => sections.find((s) => s.id === toSectionId) ?? null, [sections, toSectionId]);

  // Auto-suggest next grade's section when fromSection changes
  useEffect(() => {
    if (!fromSection || sections.length === 0) return;
    const match = fromSection.grade.match(/\d+/);
    if (match) {
      const nextGradeNum = parseInt(match[0], 10) + 1;
      const nextGradeStr = String(nextGradeNum);
      // Look for same section name in next grade (e.g. Grade 1 A -> Grade 2 A)
      const targetMatch = sections.find(
        (s) => s.grade.includes(nextGradeStr) && s.name.toLowerCase() === fromSection.name.toLowerCase(),
      );
      if (targetMatch) {
        setToSectionId(targetMatch.id);
        return;
      }
      // Fallback: any section in next grade
      const anyNext = sections.find((s) => s.grade.includes(nextGradeStr));
      if (anyNext) {
        setToSectionId(anyNext.id);
      }
    }
  }, [fromSection, sections]);

  // Load students for fromSection and fromYear, checking duplicate enrollment in toYear
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
        const sData = sSnap.data();
        merged.push({
          id: sSnap.id,
          ...sData,
          enrollmentId: en.id,
          academicYear: en.academicYear,
          className: en.className,
          sectionName: en.sectionName,
          activeSectionId: en.sectionId,
          activeGrade: en.className,
          rollNo: en.rollNo ?? null,
          name: sData.name ?? "",
          enrollmentStatus: en.status,
        } as StudentWithEnrollment);
      }

      // Check each student for existing enrollment in target year
      const sorted = sortStudentsByRoll(merged);
      const rowList: PromotionRow[] = await Promise.all(
        sorted.map(async (st) => {
          let alreadyEnrolledInTarget = false;
          let targetEnrollmentDetails: string | undefined;

          if (toYear && toYear !== fromYear) {
            const existing = await getEnrollmentForStudentInSession(st.id, toYear);
            if (existing) {
              alreadyEnrolledInTarget = true;
              targetEnrollmentDetails = `${existing.className} ${existing.sectionName ?? ""}`.trim();
            }
          }

          return {
            ...st,
            selected: !alreadyEnrolledInTarget,
            action: "promote" as PromotionAction,
            customTargetSectionId: toSectionId,
            alreadyEnrolledInTarget,
            targetEnrollmentDetails,
          };
        }),
      );

      setRows(rowList);
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
  }, [fromSectionId, fromYear, toYear, toSectionId, toast]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  // Bulk selection helpers
  const selectableRows = useMemo(() => rows.filter((r) => !r.alreadyEnrolledInTarget), [rows]);
  const selectedRows = useMemo(() => rows.filter((r) => r.selected && !r.alreadyEnrolledInTarget), [rows]);

  const allSelectableChecked = selectableRows.length > 0 && selectedRows.length === selectableRows.length;
  const someSelectableChecked = selectedRows.length > 0 && selectedRows.length < selectableRows.length;

  const toggleSelectAll = (checked: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.alreadyEnrolledInTarget ? r : { ...r, selected: checked })),
    );
  };

  const toggleSelectRow = (studentId: string, checked: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.id === studentId ? { ...r, selected: checked } : r)),
    );
  };

  const updateRowAction = (studentId: string, action: PromotionAction) => {
    setRows((prev) =>
      prev.map((r) => (r.id === studentId ? { ...r, action } : r)),
    );
  };

  const updateRowCustomSection = (studentId: string, sectionId: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === studentId ? { ...r, customTargetSectionId: sectionId } : r)),
    );
  };

  // Metrics for preview dialog
  const summaryMetrics = useMemo(() => {
    let promoteCount = 0;
    let repeatCount = 0;
    let graduateCount = 0;
    let transferCount = 0;

    for (const r of selectedRows) {
      if (r.action === "promote") promoteCount++;
      else if (r.action === "repeat") repeatCount++;
      else if (r.action === "graduate") graduateCount++;
      else if (r.action === "transfer") transferCount++;
    }

    return {
      total: selectedRows.length,
      promoteCount,
      repeatCount,
      graduateCount,
      transferCount,
    };
  }, [selectedRows]);

  const handleOpenPreview = () => {
    if (!toYear) {
      toast({ title: "Target Session required", description: "Select a target academic session.", variant: "destructive" });
      return;
    }
    if (fromYear === toYear) {
      toast({ title: "Invalid Session Selection", description: "Source and target sessions must be different.", variant: "destructive" });
      return;
    }
    if (selectedRows.length === 0) {
      toast({ title: "No students selected", description: "Select at least one student to promote.", variant: "destructive" });
      return;
    }
    const hasPromoteWithoutTarget = selectedRows.some(
      (r) => r.action === "promote" && !r.customTargetSectionId && !toSectionId,
    );
    if (hasPromoteWithoutTarget) {
      toast({
        title: "Target Class/Section required",
        description: "Please select a target class and section for promoted students.",
        variant: "destructive",
      });
      return;
    }
    setPreviewOpen(true);
  };

  const handleExecutePromotion = async () => {
    setPromoting(true);
    setProgress(0);

    let successCount = 0;
    const errors: string[] = [];

    try {
      const targetSessionObj = sessions.find((s) => s.name === toYear);

      for (let i = 0; i < selectedRows.length; i++) {
        const row = selectedRows[i];
        if (!row.enrollmentId) {
          errors.push(`${row.name}: Missing enrollment record.`);
          continue;
        }

        try {
          let resolvedTargetSec = toSection;
          if (row.action === "repeat") {
            // Repeat keeps same section as source or custom
            resolvedTargetSec = sections.find((s) => s.id === row.customTargetSectionId) ?? fromSection;
          } else if (row.action === "promote") {
            resolvedTargetSec =
              sections.find((s) => s.id === (row.customTargetSectionId || toSectionId)) ?? toSection;
          }

          await promoteEnrollment({
            studentId: row.id,
            enrollmentId: row.enrollmentId,
            targetAcademicYear: toYear,
            targetSessionId: targetSessionObj?.id,
            targetClassName: resolvedTargetSec?.grade,
            targetSectionName: resolvedTargetSec?.name,
            targetSectionId: resolvedTargetSec?.id,
            rollNo: row.rollNo ?? undefined,
            action: row.action,
          });

          successCount++;
        } catch (itemErr: unknown) {
          errors.push(`${row.name}: ${itemErr instanceof Error ? itemErr.message : "Error"}`);
        }

        setProgress(Math.round(((i + 1) / selectedRows.length) * 100));
      }

      // Re-sequence alphabetical roll numbers for all target sections
      const targetSectionIds = new Set<string>();
      selectedRows.forEach((r) => {
        const sid = r.customTargetSectionId || toSectionId;
        if (sid) targetSectionIds.add(sid);
      });
      for (const secId of targetSectionIds) {
        await syncAlphabeticalRollNumbersForSection(secId, toYear).catch(() => {});
      }

      if (errors.length > 0) {
        toast({
          title: `Promotion partially completed (${successCount}/${selectedRows.length})`,
          description: `${errors.length} student(s) could not be processed: ${errors.slice(0, 2).join("; ")}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Promotion completed successfully!",
          description: `Processed ${successCount} student(s) into session ${toYear} with alphabetical roll numbers assigned.`,
        });
      }

      await loadStudents();
    } catch (e: unknown) {
      toast({
        title: "Promotion process encountered an error",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPromoting(false);
      setProgress(0);
      setPreviewOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Student Promotion</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Safely roll forward students from one academic session to the next with bulk actions, individual overrides, and duplicate protection. Historical records are preserved permanently.
        </p>
      </div>

      {/* Control Card: Sessions and Sections */}
      <Card className="border-slate-200 shadow-sm bg-white">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-slate-800">
            Promotion Source & Target Configuration
          </CardTitle>
          <CardDescription className="text-xs">
            Select the source academic session & section to load, then select the target session & default destination class.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Source Academic Session */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Source Session *</Label>
              <Select value={fromYear} onValueChange={setFromYear}>
                <SelectTrigger className="text-xs bg-slate-50">
                  <SelectValue placeholder="Select Source Session" />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.name} className="text-xs">
                      {s.name} {s.isCurrent || s.status === "active" ? "(Active)" : `(${s.status})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Source Class & Section */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Source Class & Section *</Label>
              <Select value={fromSectionId} onValueChange={setFromSectionId}>
                <SelectTrigger className="text-xs bg-slate-50">
                  <SelectValue placeholder="Select Class/Section" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      Grade {s.grade} – Section {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target Academic Session */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Target Session *</Label>
              <Select value={toYear} onValueChange={setToYear}>
                <SelectTrigger className="text-xs bg-slate-50">
                  <SelectValue placeholder="Select Target Session" />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.name} className="text-xs">
                      {s.name} {s.isCurrent || s.status === "active" ? "(Active)" : `(${s.status})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target Default Class & Section */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Target Default Class/Section *</Label>
              <Select value={toSectionId} onValueChange={setToSectionId}>
                <SelectTrigger className="text-xs bg-slate-50">
                  <SelectValue placeholder="Select Target Class" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      Grade {s.grade} – Section {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Validation Warnings */}
          {fromYear && toYear && fromYear === toYear && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle size={15} />
              <span>Target session cannot be the same as source session. Please select a different target session.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Students Table Card */}
      <Card className="border-slate-200 shadow-sm bg-white">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-semibold text-slate-900">
              Students Roster: {fromSection ? `Grade ${fromSection.grade} - Sec ${fromSection.name}` : "None selected"}
            </CardTitle>
            <CardDescription className="text-xs">
              {rows.length} student{rows.length === 1 ? "" : "s"} enrolled in session {fromYear || "—"}. Customize actions per student below.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              onClick={handleOpenPreview}
              disabled={selectedRows.length === 0 || fromYear === toYear || loadingStudents || promoting}
              className="gap-2 text-xs"
            >
              <ArrowRight size={14} />
              <span>Review & Confirm Promotion ({selectedRows.length})</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loadingStudents ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-slate-500">Loading student enrollments & checking target session...</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500 text-sm">
              <UserCheck className="h-10 w-10 text-slate-300 mb-2" />
              <p className="font-medium">No students enrolled in this section for session {fromYear}.</p>
              <p className="text-xs text-slate-400 mt-1">Select a valid source session and class above to load students.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="p-3 w-10 text-center">
                      <Checkbox
                        checked={allSelectableChecked ? true : someSelectableChecked ? "indeterminate" : false}
                        onCheckedChange={(c) => toggleSelectAll(!!c)}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="p-3 w-16">Roll</th>
                    <th className="p-3">Student Name</th>
                    <th className="p-3 w-32">Source Status</th>
                    <th className="p-3 w-48">Promotion Action</th>
                    <th className="p-3 w-56">Target Placement</th>
                    <th className="p-3 w-40">Target Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const isAlreadyEnrolled = row.alreadyEnrolledInTarget;
                    const selectedSec =
                      sections.find((s) => s.id === (row.customTargetSectionId || toSectionId)) ?? toSection;

                    return (
                      <tr
                        key={row.id}
                        className={`transition-colors ${
                          isAlreadyEnrolled
                            ? "bg-slate-50/70 text-slate-400"
                            : row.selected
                              ? "bg-primary/5 hover:bg-primary/10"
                              : "hover:bg-slate-50/80"
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="p-3 text-center">
                          <Checkbox
                            checked={row.selected}
                            disabled={isAlreadyEnrolled}
                            onCheckedChange={(c) => toggleSelectRow(row.id, !!c)}
                            aria-label={`Select ${row.name}`}
                          />
                        </td>

                        {/* Roll */}
                        <td className="p-3 font-mono font-medium text-slate-600">
                          {row.rollNo || "—"}
                        </td>

                        {/* Name & Admission */}
                        <td className="p-3">
                          <div className="font-semibold text-slate-900">{row.name}</div>
                          <div className="text-[10px] text-slate-400">{row.admissionNo || row.email}</div>
                        </td>

                        {/* Source Status */}
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${
                              row.enrollmentStatus === "promoted"
                                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                : row.enrollmentStatus === "graduated"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-100 text-slate-700"
                            }`}
                          >
                            {row.enrollmentStatus || "Active"}
                          </Badge>
                        </td>

                        {/* Action Selector */}
                        <td className="p-3">
                          {isAlreadyEnrolled ? (
                            <span className="text-slate-400 italic">No action</span>
                          ) : (
                            <Select
                              value={row.action}
                              onValueChange={(val: PromotionAction) => updateRowAction(row.id, val)}
                              disabled={!row.selected}
                            >
                              <SelectTrigger className="h-8 text-xs bg-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="promote" className="text-xs">
                                  Promote to Next Class
                                </SelectItem>
                                <SelectItem value="repeat" className="text-xs">
                                  Repeat / Retain Grade
                                </SelectItem>
                                <SelectItem value="graduate" className="text-xs">
                                  Graduate
                                </SelectItem>
                                <SelectItem value="transfer" className="text-xs">
                                  Transfer / Left School
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </td>

                        {/* Target Placement */}
                        <td className="p-3">
                          {isAlreadyEnrolled ? (
                            <span className="text-slate-500 font-medium">
                              Enrolled in {row.targetEnrollmentDetails}
                            </span>
                          ) : row.action === "graduate" ? (
                            <Badge className="bg-emerald-600 text-white text-[10px]">Alumni / Graduated</Badge>
                          ) : row.action === "transfer" ? (
                            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px]">
                              Transferred Out
                            </Badge>
                          ) : row.action === "repeat" ? (
                            <div className="space-y-1">
                              <span className="text-slate-600 font-medium block">
                                Retain in Grade {fromSection?.grade}
                              </span>
                              <Select
                                value={row.customTargetSectionId || fromSectionId}
                                onValueChange={(val) => updateRowCustomSection(row.id, val)}
                                disabled={!row.selected}
                              >
                                <SelectTrigger className="h-7 text-[11px] bg-white">
                                  <SelectValue placeholder="Select Section" />
                                </SelectTrigger>
                                <SelectContent>
                                  {sections
                                    .filter((s) => s.grade === fromSection?.grade)
                                    .map((s) => (
                                      <SelectItem key={s.id} value={s.id} className="text-xs">
                                        Section {s.name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <Select
                              value={row.customTargetSectionId || toSectionId}
                              onValueChange={(val) => updateRowCustomSection(row.id, val)}
                              disabled={!row.selected}
                            >
                              <SelectTrigger className="h-8 text-xs bg-white">
                                <SelectValue placeholder="Select Target Section" />
                              </SelectTrigger>
                              <SelectContent>
                                {sections.map((s) => (
                                  <SelectItem key={s.id} value={s.id} className="text-xs">
                                    Grade {s.grade} – Sec {s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>

                        {/* Target Status / Duplicate Check */}
                        <td className="p-3">
                          {isAlreadyEnrolled ? (
                            <Badge className="border-amber-300 bg-amber-100 text-amber-900 gap-1 text-[10px] font-semibold">
                              <AlertTriangle size={11} />
                              Already in {toYear}
                            </Badge>
                          ) : (
                            <span className="text-emerald-700 flex items-center gap-1 font-medium text-[11px]">
                              <CheckCircle2 size={13} />
                              Eligible for {toYear}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation & Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-[650px] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary font-bold">
              <ShieldCheck size={22} />
              <DialogTitle className="text-lg">Confirm Student Session Promotion</DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Review the promotion plan from session <strong>{fromYear}</strong> to session <strong>{toYear}</strong>.
            </DialogDescription>
          </DialogHeader>

          {/* Breakdown summary cards */}
          <div className="grid grid-cols-4 gap-2 my-3 text-center">
            <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-2.5">
              <span className="text-[11px] font-medium text-indigo-700 block">Promote</span>
              <span className="text-lg font-bold text-indigo-950">{summaryMetrics.promoteCount}</span>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5">
              <span className="text-[11px] font-medium text-amber-700 block">Repeat</span>
              <span className="text-lg font-bold text-amber-950">{summaryMetrics.repeatCount}</span>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5">
              <span className="text-[11px] font-medium text-emerald-700 block">Graduate</span>
              <span className="text-lg font-bold text-emerald-950">{summaryMetrics.graduateCount}</span>
            </div>
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5">
              <span className="text-[11px] font-medium text-rose-700 block">Transfer</span>
              <span className="text-lg font-bold text-rose-950">{summaryMetrics.transferCount}</span>
            </div>
          </div>

          {/* Safety Notice */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-emerald-600" />
              Historical Integrity Guarantee
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Enrolled records in session <strong>{fromYear}</strong> will remain preserved for transcripts, attendance audits, and past session viewing. A new enrollment record will be created in session <strong>{toYear}</strong>.
            </p>
          </div>

          {/* Detailed list in scroll area */}
          <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg max-h-56 mt-2">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold text-[11px]">
                <tr>
                  <th className="p-2">Student</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Source Placement</th>
                  <th className="p-2">Target Placement ({toYear})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selectedRows.map((r) => {
                  const targetSec =
                    sections.find((s) => s.id === (r.customTargetSectionId || toSectionId)) ?? toSection;
                  return (
                    <tr key={r.id}>
                      <td className="p-2 font-medium text-slate-900">{r.name}</td>
                      <td className="p-2 capitalize font-semibold text-primary">{r.action}</td>
                      <td className="p-2 text-slate-500">
                        Grade {fromSection?.grade} {fromSection?.name}
                      </td>
                      <td className="p-2 font-medium">
                        {r.action === "graduate"
                          ? "Graduated"
                          : r.action === "transfer"
                            ? "Transferred"
                            : r.action === "repeat"
                              ? `Grade ${fromSection?.grade} ${targetSec?.name ?? fromSection?.name}`
                              : `Grade ${targetSec?.grade} ${targetSec?.name}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {promoting && (
            <div className="space-y-1 mt-3">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Processing enrollments...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          <DialogFooter className="pt-3 gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)} disabled={promoting}>
              Cancel
            </Button>
            <Button onClick={handleExecutePromotion} disabled={promoting} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              {promoting && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>Confirm & Process Promotion ({selectedRows.length} Students)</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

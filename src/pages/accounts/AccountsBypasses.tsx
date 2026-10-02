import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import type {
  ExamSchedule,
  FeePayment,
  FeeStructure,
  StudentFeeAssignment,
  HallTicketBypass,
  HallTicketGlobalSettings,
  HallTicketRule,
  HallTicketStudentEligibility,
  Student,
  Enrollment,
} from "@/lib/types";
import {
  getHallTicketGlobalSettings,
  listHallTicketRules,
  listHallTicketBypasses,
  requestHallTicketBypass,
  evaluateStudentExamEligibility,
} from "@/lib/hallTicketEngine";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { SearchInput } from "@/components/ui/SearchInput";
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Plus,
  Loader2,
  CalendarDays,
  CreditCard,
  UserCheck,
} from "lucide-react";

export default function AccountsBypasses() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "2026-27";
  const effectiveSessionName = workingSession?.name || activeSession?.name || "2026-27";

  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");
  const [loadingSchedules, setLoadingSchedules] = useState(true);

  const [bypasses, setBypasses] = useState<HallTicketBypass[]>([]);
  const [loadingBypasses, setLoadingBypasses] = useState(true);

  // Data for selected exam
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [studentAssignments, setStudentAssignments] = useState<StudentFeeAssignment[]>([]);
  const [feePayments, setFeePayments] = useState<FeePayment[]>([]);
  const [globalSettings, setGlobalSettings] = useState<HallTicketGlobalSettings | null>(null);
  const [rules, setRules] = useState<HallTicketRule[]>([]);
  const [evaluating, setEvaluating] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  // Request Bypass Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetStudent, setTargetStudent] = useState<HallTicketStudentEligibility | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 1. Load approved schedules
  useEffect(() => {
    setLoadingSchedules(true);
    const q = query(collection(db, "examSchedules"), where("status", "==", "approved"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ExamSchedule));
        list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setSchedules(list);
        setLoadingSchedules(false);
        if (!selectedScheduleId && list.length > 0) {
          setSelectedScheduleId(list[0].id);
        }
      },
      (err) => {
        console.error(err);
        setLoadingSchedules(false);
      }
    );
    return unsubscribe;
  }, []);

  const currentSchedule = useMemo(() => {
    return schedules.find((s) => s.id === selectedScheduleId) || schedules[0] || null;
  }, [schedules, selectedScheduleId]);

  // 2. Load all bypasses
  const loadBypasses = async () => {
    setLoadingBypasses(true);
    try {
      const list = await listHallTicketBypasses({ sessionId: effectiveSessionId });
      setBypasses(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingBypasses(false);
    }
  };

  useEffect(() => {
    void loadBypasses();
  }, [effectiveSessionId]);

  // 3. Load students & payments for selected exam
  const loadExamFeeData = async () => {
    if (!currentSchedule) return;
    setEvaluating(true);
    try {
      const schedGrade = currentSchedule.grade;
      const targetSession = currentSchedule.sessionId || effectiveSessionId;

      const [
        studentsSnap,
        enrollmentsSnap,
        structuresSnap,
        assignmentsSnap,
        paymentsSnap,
        settings,
        rulesList,
      ] = await Promise.all([
        getDocs(query(collection(db, "students"), where("grade", "==", schedGrade))),
        getDocs(
          query(
            collection(db, "enrollments"),
            where("className", "==", schedGrade),
            where("status", "==", "active")
          )
        ),
        getDocs(query(collection(db, "feeStructures"), where("grade", "==", schedGrade))),
        getDocs(
          query(
            collection(db, "studentFeeAssignments"),
            where("grade", "==", schedGrade),
            where("sessionId", "==", targetSession),
            where("status", "==", "active")
          )
        ),
        getDocs(query(collection(db, "feePayments"), where("grade", "==", schedGrade))),
        getHallTicketGlobalSettings(),
        listHallTicketRules(targetSession),
      ]);

      setStudents(studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Student)));
      setEnrollments(enrollmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment)));
      setFeeStructures(structuresSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeStructure)));
      setStudentAssignments(assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentFeeAssignment)));
      setFeePayments(paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeePayment)));
      setGlobalSettings(settings);
      setRules(rulesList);
    } catch (e) {
      console.error(e);
    } finally {
      setEvaluating(false);
    }
  };

  useEffect(() => {
    void loadExamFeeData();
  }, [currentSchedule?.id, effectiveSessionId]);

  // Current exam rule & structure
  const currentExamRule = useMemo(() => {
    if (!currentSchedule) return null;
    return rules.find((r) => r.definedExamId === currentSchedule.definedExamId) || null;
  }, [rules, currentSchedule]);

  const matchedFeeStructure = useMemo(() => {
    if (!currentSchedule) return null;
    return feeStructures.find((s) => s.grade === currentSchedule.grade) || feeStructures[0] || null;
  }, [feeStructures, currentSchedule]);

  // Evaluated blocked students list
  const blockedStudents: HallTicketStudentEligibility[] = useMemo(() => {
    if (!currentSchedule || !globalSettings) return [];

    const evals = students.map((stu) => {
      const en = enrollments.find((e) => e.studentId === stu.id) || null;
      const payments = feePayments.filter(
        (p) => p.studentId === stu.id || (stu.uid && p.studentId === stu.uid)
      );
      const studentAssignment = studentAssignments.find(
        (a) => a.studentId === stu.id || a.studentUid === stu.id || (stu.uid && (a.studentUid === stu.uid || a.studentId === stu.uid || (a as any).authUid === stu.uid))
      ) || null;

      const approvedBypass =
        bypasses.find(
          (b) =>
            b.studentId === stu.id &&
            b.definedExamId === currentSchedule.definedExamId &&
            b.status === "approved"
        ) || null;

      return evaluateStudentExamEligibility({
        student: stu,
        enrollment: en,
        schedule: currentSchedule,
        feeStructure: matchedFeeStructure,
        studentFeeAssignment: studentAssignment,
        studentPayments: payments,
        globalSettings,
        examRule: currentExamRule,
        approvedBypass,
      });
    });

    return evals.filter((item) => item.status === "blocked");
  }, [students, enrollments, feePayments, studentAssignments, bypasses, currentSchedule, globalSettings, currentExamRule, matchedFeeStructure]);

  // Filtered bypass list
  const filteredBypasses = useMemo(() => {
    return bypasses.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          b.studentName.toLowerCase().includes(q) ||
          (b.admissionNo || "").toLowerCase().includes(q) ||
          b.examName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [bypasses, statusFilter, searchQuery]);

  // Actions
  const handleOpenRequest = (stu: HallTicketStudentEligibility) => {
    setTargetStudent(stu);
    setReason("");
    setDialogOpen(true);
  };

  const handleSubmitRequest = async () => {
    if (!targetStudent || !currentSchedule || !appUser) return;
    if (!reason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please specify the business or administrative justification for this exception.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      await requestHallTicketBypass(
        {
          studentId: targetStudent.studentId,
          studentUid: targetStudent.studentUid,
          studentName: targetStudent.studentName,
          admissionNo: targetStudent.admissionNo,
          rollNo: targetStudent.rollNo,
          grade: targetStudent.grade,
          sectionId: targetStudent.sectionId,
          sectionName: targetStudent.sectionName,
          sessionId: currentSchedule.sessionId,
          academicYear: currentSchedule.academicYear,
          definedExamId: currentSchedule.definedExamId,
          examName: currentSchedule.examType,
          scheduleId: currentSchedule.id,
          reason: reason.trim(),
          feeShortfallAmount: targetStudent.feeDetails.outstanding,
          feeStatusSummary: targetStudent.reason,
        },
        { uid: appUser.id, name: appUser.name, role: appUser.role }
      );

      toast({
        title: "Bypass Requested",
        description: `Bypass request for ${targetStudent.studentName} has been submitted for Principal review.`,
      });
      setDialogOpen(false);
      setTargetStudent(null);
      await loadBypasses();
    } catch (e: any) {
      toast({
        title: "Request Failed",
        description: e.message || "Failed to submit bypass request.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Hall Ticket Fee Bypasses
          </h1>
          <Badge variant="outline" className="border-amber-300 text-amber-800 bg-amber-50 font-semibold">
            Accounts & Clearance Workflow
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Identify students blocked from receiving examination hall tickets due to installment shortfalls and request administrative bypasses.
        </p>
      </div>

      {/* 2. Top Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="border-border/60 shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Clock size={20} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Pending Approvals</p>
              <p className="text-xl font-bold text-slate-900">
                {bypasses.filter((b) => b.status === "pending").length}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Approved Bypasses</p>
              <p className="text-xl font-bold text-emerald-800">
                {bypasses.filter((b) => b.status === "approved").length}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <XCircle size={20} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Rejected Requests</p>
              <p className="text-xl font-bold text-rose-800">
                {bypasses.filter((b) => b.status === "rejected").length}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <CreditCard size={20} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Fee-Blocked in Class</p>
              <p className="text-xl font-bold text-blue-900">{blockedStudents.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. Section 1: Blocked Students for Selected Examination */}
      <Card className="border-border/60 shadow-xs">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <ShieldAlert size={16} className="text-rose-600" />
                <span>Currently Blocked Students</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Students below the configured fee threshold for the selected examination. Accounts can submit a bypass request.
              </CardDescription>
            </div>

            <div className="w-full sm:w-80">
              <Select
                value={selectedScheduleId}
                onValueChange={setSelectedScheduleId}
                disabled={loadingSchedules || schedules.length === 0}
              >
                <SelectTrigger className="h-8 text-xs bg-white font-medium">
                  <SelectValue placeholder="Select Examination" />
                </SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      Grade {s.grade} · {s.examType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/80">
              <TableRow>
                <TableHead className="text-xs">Student</TableHead>
                <TableHead className="text-xs">Class / Section</TableHead>
                <TableHead className="text-xs">Fee Ledger Summary</TableHead>
                <TableHead className="text-xs">Block Reason</TableHead>
                <TableHead className="text-right text-xs">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evaluating ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-xs text-muted-foreground">
                    <Loader2 className="animate-spin mx-auto text-primary" size={20} />
                    <span className="mt-1 block">Checking fee ledger...</span>
                  </TableCell>
                </TableRow>
              ) : blockedStudents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-xs text-muted-foreground">
                    No students currently blocked for this examination. All students are eligible or have bypasses.
                  </TableCell>
                </TableRow>
              ) : (
                blockedStudents.map((item) => (
                  <TableRow key={item.studentId} className="hover:bg-slate-50/60">
                    <TableCell>
                      <div className="font-semibold text-xs text-slate-900">{item.studentName}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        Adm: {item.admissionNo || "N/A"} · Roll: {item.rollNo || "N/A"}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      Grade {item.grade}
                      {item.sectionName ? ` - ${item.sectionName}` : ""}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-semibold text-slate-800">
                        Paid: ₹{item.feeDetails.totalPaid.toLocaleString("en-IN")}
                      </div>
                      <div className="text-[10px] text-rose-700 font-medium">
                        Shortfall / Balance: ₹{item.feeDetails.outstanding.toLocaleString("en-IN")}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-rose-800">
                      {item.reason}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        className="h-7 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white gap-1"
                        onClick={() => handleOpenRequest(item)}
                      >
                        <ShieldCheck size={13} />
                        <span>Request Bypass</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 4. Section 2: Bypass Request Pipeline */}
      <Card className="border-border/60 shadow-xs">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Clock size={16} className="text-primary" />
                <span>Bypass Request Pipeline & Approval Ledger</span>
              </CardTitle>
              <CardDescription className="text-xs">
                History of all bypass requests submitted to Administration.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Button
                  variant={statusFilter === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter("all")}
                  className="h-7 text-xs"
                >
                  All ({bypasses.length})
                </Button>
                <Button
                  variant={statusFilter === "pending" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter("pending")}
                  className="h-7 text-xs"
                >
                  Pending
                </Button>
                <Button
                  variant={statusFilter === "approved" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter("approved")}
                  className="h-7 text-xs"
                >
                  Approved
                </Button>
              </div>

              <div className="w-48">
                <SearchInput
                  placeholder="Search student..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                  className="h-8 text-xs bg-white"
                  showShortcutHint={false}
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/80">
              <TableRow>
                <TableHead className="text-xs">Student</TableHead>
                <TableHead className="text-xs">Class</TableHead>
                <TableHead className="text-xs">Exam</TableHead>
                <TableHead className="text-xs">Shortfall</TableHead>
                <TableHead className="text-xs">Reason Stated</TableHead>
                <TableHead className="text-xs">Requested Date</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-right text-xs">Review Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingBypasses ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-xs text-muted-foreground">
                    <Loader2 className="animate-spin mx-auto text-primary" size={20} />
                    <span className="mt-1 block">Loading bypass records...</span>
                  </TableCell>
                </TableRow>
              ) : filteredBypasses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-20 text-center text-xs text-muted-foreground">
                    No bypass records found matching filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredBypasses.map((bp) => (
                  <TableRow key={bp.id} className="hover:bg-slate-50/60">
                    <TableCell>
                      <div className="font-semibold text-xs text-slate-900">{bp.studentName}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">Adm: {bp.admissionNo || "N/A"}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      Grade {bp.grade}
                      {bp.sectionName ? ` - ${bp.sectionName}` : ""}
                    </TableCell>
                    <TableCell className="text-xs font-medium">{bp.examName}</TableCell>
                    <TableCell className="text-xs font-semibold text-rose-700">
                      ₹{(bp.feeShortfallAmount || 0).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-slate-700">
                      {bp.reason}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(bp.requestedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {bp.status === "approved" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                          Approved
                        </span>
                      ) : bp.status === "pending" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                          Pending Review
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">
                          Rejected
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {bp.reviewNotes || (bp.reviewedBy?.name ? `Reviewed by ${bp.reviewedBy.name}` : "-")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 5. MODAL: Request Bypass Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Request Hall Ticket Bypass</DialogTitle>
            <DialogDescription className="text-xs">
              Submit an administrative request for Principal approval allowing this blocked student to take their exam.
            </DialogDescription>
          </DialogHeader>

          {targetStudent && (
            <div className="space-y-3 py-2 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Student Name</span>
                  <span className="font-bold text-slate-900">{targetStudent.studentName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Class & Exam</span>
                  <span className="font-semibold text-slate-800">
                    Grade {targetStudent.grade} · {currentSchedule?.examType}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fee Balance</span>
                  <span className="text-rose-700 font-bold">
                    ₹{targetStudent.feeDetails.outstanding.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="border-t border-slate-200 pt-1.5">
                  <span className="text-muted-foreground block text-[10px]">Current Fee Block Reason:</span>
                  <p className="text-rose-800 font-medium mt-0.5">{targetStudent.reason}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Justification / Reason for Bypass *</Label>
                <Textarea
                  placeholder="e.g. Parent submitted post-dated cheque for Oct 5th, signed management undertaking, financial hardship concession..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="text-xs min-h-[90px]"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitRequest}
              disabled={submitting}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {submitting ? <Loader2 className="animate-spin mr-1" size={14} /> : null}
              Submit Bypass Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

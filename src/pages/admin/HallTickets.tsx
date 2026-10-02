import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import type {
  ExamSchedule,
  FeePayment,
  FeeStructure,
  HallTicket,
  HallTicketBypass,
  HallTicketGlobalSettings,
  HallTicketRule,
  HallTicketStudentEligibility,
  Student,
  Enrollment,
  StudentFeeAssignment,
} from "@/lib/types";
import {
  getHallTicketGlobalSettings,
  updateHallTicketGlobalSettings,
  listHallTicketRules,
  saveHallTicketRule,
  deleteHallTicketRule,
  listHallTicketBypasses,
  requestHallTicketBypass,
  grantDirectHallTicketBypass,
  reviewHallTicketBypass,
  evaluateStudentExamEligibility,
  generateHallTicketForStudent,
  bulkGenerateHallTickets,
  revokeHallTicket,
} from "@/lib/hallTicketEngine";
import { downloadHallTicketPdf, downloadBulkHallTicketsPdf } from "@/lib/generateHallTicketPdf";
import { SearchInput } from "@/components/ui/SearchInput";
import {
  getActiveStructureForGrade,
  AcademicStructure,
  AcademicStructureVersion,
  DefinedExam,
} from "@/lib/academicStructure";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import {
  CalendarDays,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Download,
  Filter,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  FileText,
  UserCheck,
  Users,
  Settings2,
  Trash2,
  Eye,
  Sliders,
  Sparkles,
} from "lucide-react";

export default function HallTickets() {
  const { appUser } = useAuth();
  const { workingSession, activeSession, sessions } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "2026-27";
  const effectiveSessionName = workingSession?.name || activeSession?.name || "2026-27";

  const [activeTab, setActiveTab] = useState<"students" | "bypasses" | "rules">("students");

  // Global Settings
  const [globalSettings, setGlobalSettings] = useState<HallTicketGlobalSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);

  // Exam Schedules
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");
  const [selectedGrade, setSelectedGrade] = useState<string>("all");

  // Data for selected schedule
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [feeAssignments, setFeeAssignments] = useState<StudentFeeAssignment[]>([]);
  const [feePayments, setFeePayments] = useState<FeePayment[]>([]);
  const [bypasses, setBypasses] = useState<HallTicketBypass[]>([]);
  const [rules, setRules] = useState<HallTicketRule[]>([]);
  const [generatedTickets, setGeneratedTickets] = useState<HallTicket[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Active Structure for Rules tab
  const [applicableStructure, setApplicableStructure] = useState<{
    structure: AcademicStructure;
    version: AcademicStructureVersion;
  } | null>(null);

  // Student filter & search
  const [statusFilter, setStatusFilter] = useState<"all" | "eligible" | "pending_bypass" | "blocked" | "bypass_approved" | "generated">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<HallTicketRule> | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  // Administrative Override Modal State
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideStudent, setOverrideStudent] = useState<HallTicketStudentEligibility | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewingBypass, setReviewingBypass] = useState<HallTicketBypass | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [processingReview, setProcessingReview] = useState(false);

  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [singleGeneratingId, setSingleGeneratingId] = useState<string | null>(null);
  const [downloadingBulk, setDownloadingBulk] = useState(false);
  const [downloadingSingleId, setDownloadingSingleId] = useState<string | null>(null);

  // 1. Load Global Settings
  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const s = await getHallTicketGlobalSettings();
      setGlobalSettings(s);
    } catch (e) {
      console.error(e);
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  // 2. Real-time Approved Exam Schedules Listener
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
        console.error("Error loading approved exam schedules:", err);
        setLoadingSchedules(false);
      }
    );
    return unsubscribe;
  }, [effectiveSessionId]);

  // Selected Exam Schedule
  const currentSchedule = useMemo(() => {
    return schedules.find((s) => s.id === selectedScheduleId) || schedules[0] || null;
  }, [schedules, selectedScheduleId]);

  // Available grades from approved schedules
  const availableGrades = useMemo(() => {
    const set = new Set(schedules.map((s) => s.grade).filter(Boolean));
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [schedules]);

  // Filtered schedules dropdown
  const filteredSchedules = useMemo(() => {
    if (selectedGrade === "all") return schedules;
    return schedules.filter((s) => s.grade === selectedGrade);
  }, [schedules, selectedGrade]);

  // Auto-switch selected schedule if grade filter excludes it
  useEffect(() => {
    if (filteredSchedules.length > 0 && !filteredSchedules.some((s) => s.id === selectedScheduleId)) {
      setSelectedScheduleId(filteredSchedules[0].id);
    }
  }, [filteredSchedules, selectedScheduleId]);

  // 3. Load Data for Selected Schedule (Students, Enrollments, Fee Structure, Payments, Bypasses, Rules, Generated Tickets)
  const loadScheduleData = async () => {
    if (!currentSchedule) return;
    setDataLoading(true);

    try {
      const schedGrade = currentSchedule.grade;
      const targetSession = currentSchedule.sessionId || effectiveSessionId;

      // Parallel data fetching
      const [
        studentsSnap,
        enrollmentsSnap,
        feeStructuresSnap,
        feePaymentsSnap,
        assignmentsSnap,
        bypassesList,
        rulesList,
        ticketsSnap,
        structRes,
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
        getDocs(query(collection(db, "feePayments"), where("grade", "==", schedGrade))),
        getDocs(query(collection(db, "studentFeeAssignments"), where("grade", "==", schedGrade), where("status", "==", "active"))),
        listHallTicketBypasses({ sessionId: targetSession, definedExamId: currentSchedule.definedExamId }),
        listHallTicketRules(targetSession),
        getDocs(query(collection(db, "hallTickets"), where("scheduleId", "==", currentSchedule.id))),
        getActiveStructureForGrade(schedGrade, targetSession),
      ]);

      const stuList = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Student));
      const enList = enrollmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
      const structList = feeStructuresSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeStructure));
      const payList = feePaymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeePayment));
      const assignList = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as StudentFeeAssignment));
      const tickList = ticketsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as HallTicket));

      setStudents(stuList);
      setEnrollments(enList);
      setFeeStructures(structList);
      setFeeAssignments(assignList);
      setFeePayments(payList);
      setBypasses(bypassesList);
      setRules(rulesList);
      setGeneratedTickets(tickList);
      setApplicableStructure(structRes);
    } catch (err) {
      console.error("Error loading schedule data:", err);
      toast({
        title: "Error",
        description: "Failed to load examination and fee eligibility data.",
        variant: "destructive",
      });
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    void loadScheduleData();
  }, [currentSchedule?.id, effectiveSessionId]);

  // Match rule for current schedule's defined exam
  const currentExamRule = useMemo(() => {
    if (!currentSchedule) return null;
    return (
      rules.find(
        (r) =>
          r.definedExamId === currentSchedule.definedExamId &&
          (r.sessionId === currentSchedule.sessionId || r.sessionId === effectiveSessionId)
      ) || null
    );
  }, [rules, currentSchedule, effectiveSessionId]);

  // Matched fee structure for this grade & session
  const matchedFeeStructure = useMemo(() => {
    if (!currentSchedule) return null;
    return (
      feeStructures.find(
        (s) =>
          s.grade === currentSchedule.grade &&
          (s.academicSession === currentSchedule.academicYear ||
            s.academicSession === effectiveSessionName ||
            s.academicSession === currentSchedule.sessionId)
      ) ||
      feeStructures[0] ||
      null
    );
  }, [feeStructures, currentSchedule, effectiveSessionName]);

  // 4. Compute Eligibility for Each Student
  const studentEvaluations: HallTicketStudentEligibility[] = useMemo(() => {
    if (!currentSchedule || !globalSettings) return [];

    return students.map((stu) => {
      // Find active enrollment
      const en = enrollments.find((e) => e.studentId === stu.id) || null;
      // Filter payments for student
      const payments = feePayments.filter(
        (p) => p.studentId === stu.id || (stu.uid && p.studentId === stu.uid)
      );
      // Find bypasses for student & this exam
      const studentBypasses = bypasses.filter(
        (b) =>
          (b.studentId === stu.id || (stu.uid && b.studentUid === stu.uid)) &&
          b.definedExamId === currentSchedule.definedExamId
      );
      studentBypasses.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      const approvedBypass = studentBypasses.find((b) => b.status === "approved") || null;
      const pendingBypass = studentBypasses.find((b) => b.status === "pending") || null;

      // Find generated ticket
      const existingTicket =
        generatedTickets.find((t) => t.studentId === stu.id && t.status !== "revoked") || null;

      // Find individualized fee assignment (SEC-08)
      const studentAssignment = feeAssignments.find(
        (a) => a.studentId === stu.id || a.studentUid === stu.id || (stu.uid && (a.studentUid === stu.uid || a.studentId === stu.uid))
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
        pendingBypass,
        existingHallTicket: existingTicket,
      });
    });
  }, [
    students,
    enrollments,
    feeAssignments,
    feePayments,
    bypasses,
    generatedTickets,
    currentSchedule,
    globalSettings,
    currentExamRule,
    matchedFeeStructure,
  ]);

  // Summary counts
  const stats = useMemo(() => {
    const total = studentEvaluations.length;
    const eligible = studentEvaluations.filter((s) => s.status === "eligible").length;
    const blocked = studentEvaluations.filter((s) => s.status === "blocked" && !s.pendingBypass).length;
    const bypassPending = studentEvaluations.filter((s) => !!s.pendingBypass).length;
    const bypassApproved = studentEvaluations.filter((s) => s.status === "bypass_approved").length;
    const generated = studentEvaluations.filter((s) => s.existingHallTicket).length;
    return { total, eligible, blocked, bypassPending, bypassApproved, generated };
  }, [studentEvaluations]);

  // Filtered student list for table
  const filteredStudents = useMemo(() => {
    return studentEvaluations.filter((item) => {
      // Status filter
      if (statusFilter === "eligible" && item.status !== "eligible") return false;
      if (statusFilter === "pending_bypass" && !item.pendingBypass) return false;
      if (statusFilter === "blocked" && (item.status !== "blocked" || item.pendingBypass)) return false;
      if (statusFilter === "bypass_approved" && item.status !== "bypass_approved") return false;
      if (statusFilter === "generated" && !item.existingHallTicket) return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.studentName.toLowerCase().includes(q);
        const matchRoll = (item.rollNo || "").toLowerCase().includes(q);
        const matchAdm = (item.admissionNo || "").toLowerCase().includes(q);
        const matchSec = (item.sectionName || "").toLowerCase().includes(q);
        if (!matchName && !matchRoll && !matchAdm && !matchSec) return false;
      }

      return true;
    });
  }, [studentEvaluations, statusFilter, searchQuery]);

  // Actions
  const handleToggleGlobalFeeGate = async (enabled: boolean) => {
    if (!appUser) return;
    try {
      await updateHallTicketGlobalSettings({ feeGateEnabled: enabled }, {
        uid: appUser.id,
        name: appUser.name,
        role: appUser.role,
      });
      setGlobalSettings((prev) => (prev ? { ...prev, feeGateEnabled: enabled } : null));
      toast({
        title: enabled ? "Fee Gate Enabled" : "Fee Gate Disabled",
        description: enabled
          ? "Hall ticket generation now enforces fee eligibility rules."
          : "Fee restriction disabled. All enrolled students are eligible for hall tickets.",
      });
    } catch (e: any) {
      toast({
        title: "Update Failed",
        description: e.message || "Failed to update master setting.",
        variant: "destructive",
      });
    }
  };

  const handleGenerateSingle = async (item: HallTicketStudentEligibility) => {
    if (!currentSchedule || !appUser) return;
    setSingleGeneratingId(item.studentId);
    try {
      await generateHallTicketForStudent(
        item,
        currentSchedule,
        globalSettings?.defaultInstructions,
        { uid: appUser.id, name: appUser.name, role: appUser.role }
      );
      toast({
        title: "Hall Ticket Generated",
        description: `Hall ticket generated successfully for ${item.studentName}.`,
      });
      await loadScheduleData();
    } catch (e: any) {
      toast({
        title: "Generation Failed",
        description: e.message || "Could not generate hall ticket.",
        variant: "destructive",
      });
    } finally {
      setSingleGeneratingId(null);
    }
  };

  const handleBulkGenerate = async () => {
    if (!currentSchedule || !appUser) return;
    setBulkGenerating(true);
    try {
      const eligibleList = studentEvaluations.filter((s) => s.eligible);
      const res = await bulkGenerateHallTickets(
        eligibleList,
        currentSchedule,
        globalSettings?.defaultInstructions,
        { uid: appUser.id, name: appUser.name, role: appUser.role }
      );

      toast({
        title: "Bulk Generation Complete",
        description: `Generated: ${res.generatedCount} | Skipped: ${res.skippedCount} (Blocked students are protected).`,
      });
      await loadScheduleData();
    } catch (e: any) {
      toast({
        title: "Bulk Generation Failed",
        description: e.message || "Could not complete bulk generation.",
        variant: "destructive",
      });
    } finally {
      setBulkGenerating(false);
    }
  };

  const handleDownloadBulk = async () => {
    if (!currentSchedule) return;
    const tickets = studentEvaluations
      .map((s) => s.existingHallTicket)
      .filter((t): t is HallTicket => !!t && t.status !== "revoked");

    if (tickets.length === 0) {
      toast({
        title: "No Hall Tickets Generated",
        description: "Please generate hall tickets for eligible students before downloading.",
        variant: "destructive",
      });
      return;
    }

    setDownloadingBulk(true);
    try {
      await downloadBulkHallTicketsPdf(tickets, currentSchedule.examType, currentSchedule.grade);
      toast({
        title: "Downloading Hall Tickets",
        description: `Downloaded ${tickets.length} hall tickets in a single print-ready PDF document.`,
      });
    } catch (e: any) {
      toast({
        title: "Download Failed",
        description: e.message || "Failed to generate bulk PDF.",
        variant: "destructive",
      });
    } finally {
      setDownloadingBulk(false);
    }
  };

  const handleDownloadSingle = async (ticket: HallTicket) => {
    setDownloadingSingleId(ticket.id);
    try {
      await downloadHallTicketPdf(ticket);
    } catch (e: any) {
      toast({
        title: "Download Failed",
        description: e.message || "Failed to generate PDF.",
        variant: "destructive",
      });
    } finally {
      setDownloadingSingleId(null);
    }
  };

  const handleRevoke = async (ticket: HallTicket) => {
    if (!appUser) return;
    const reason = window.prompt("Enter reason for revoking this Hall Ticket (e.g. Student transferred, exam scheduled cancelled):");
    if (!reason?.trim()) return;

    try {
      await revokeHallTicket(ticket.id, reason, { uid: appUser.id, name: appUser.name, role: appUser.role });
      toast({
        title: "Hall Ticket Revoked",
        description: `Hall ticket for ${ticket.studentName} has been revoked.`,
      });
      await loadScheduleData();
    } catch (e: any) {
      toast({
        title: "Revocation Failed",
        description: e.message,
        variant: "destructive",
      });
    }
  };

  const handleOpenDirectOverride = (item: HallTicketStudentEligibility) => {
    setOverrideStudent(item);
    setOverrideReason("");
    setOverrideModalOpen(true);
  };

  const handleSaveDirectOverride = async () => {
    if (!overrideStudent || !currentSchedule || !appUser) return;
    if (!overrideReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please specify an administrative justification for the override.",
        variant: "destructive",
      });
      return;
    }

    setSavingOverride(true);
    try {
      await grantDirectHallTicketBypass(
        {
          studentId: overrideStudent.studentId,
          studentUid: overrideStudent.studentUid,
          studentName: overrideStudent.studentName,
          admissionNo: overrideStudent.admissionNo,
          rollNo: overrideStudent.rollNo,
          grade: overrideStudent.grade,
          sectionId: overrideStudent.sectionId,
          sectionName: overrideStudent.sectionName,
          sessionId: currentSchedule.sessionId,
          academicYear: currentSchedule.academicYear,
          definedExamId: currentSchedule.definedExamId || currentSchedule.id || "",
          examName: currentSchedule.examType,
          scheduleId: currentSchedule.id,
          reason: overrideReason.trim(),
          feeShortfallAmount: overrideStudent.feeDetails.outstanding,
          feeStatusSummary: overrideStudent.reason,
        },
        { uid: appUser.id, name: appUser.name, role: appUser.role }
      );

      toast({
        title: "Administrative Override Granted",
        description: `Bypass authorized for ${overrideStudent.studentName}. Hall ticket is now eligible for generation.`,
      });
      setOverrideModalOpen(false);
      setOverrideStudent(null);
      await loadScheduleData();
    } catch (e: any) {
      toast({
        title: "Override Failed",
        description: e.message || "Failed to grant override.",
        variant: "destructive",
      });
    } finally {
      setSavingOverride(false);
    }
  };

  const handleOpenReview = (bp: HallTicketBypass) => {
    setReviewingBypass(bp);
    setReviewNotes("");
    setReviewModalOpen(true);
  };

  const handleProcessReview = async (decision: "approved" | "rejected") => {
    if (!reviewingBypass || !appUser) return;
    setProcessingReview(true);
    try {
      await reviewHallTicketBypass(reviewingBypass.id, decision, reviewNotes, {
        uid: appUser.id,
        name: appUser.name,
        role: appUser.role,
      });

      toast({
        title: decision === "approved" ? "Bypass Approved" : "Bypass Rejected",
        description: `Bypass for ${reviewingBypass.studentName} has been ${decision}.`,
      });
      setReviewModalOpen(false);
      setReviewingBypass(null);
      await loadScheduleData();
    } catch (e: any) {
      toast({
        title: "Review Failed",
        description: e.message || "Failed to process review.",
        variant: "destructive",
      });
    } finally {
      setProcessingReview(false);
    }
  };

  const handleOpenRuleEditor = (definedExam: DefinedExam) => {
    const existing = rules.find((r) => r.definedExamId === definedExam.id);
    const instList = matchedFeeStructure?.installments || [];
    setEditingRule(
      existing || {
        sessionId: effectiveSessionId,
        academicYear: effectiveSessionName,
        definedExamId: definedExam.id,
        examName: definedExam.name,
        termId: definedExam.termId,
        feeGateEnabled: true,
        requirementType: "installment_percentage",
        installmentId: instList[0]?.id || "inst-1",
        installmentLabel: instList[0]?.label || "Installment 1",
        minimumPaymentPercentage: 50,
        minimumPaymentAmount: 10000,
        notes: "",
      }
    );
    setRuleModalOpen(true);
  };

  const handleSaveRule = async () => {
    if (!editingRule || !editingRule.definedExamId || !appUser) return;
    setSavingRule(true);
    try {
      await saveHallTicketRule(
        {
          sessionId: editingRule.sessionId || effectiveSessionId,
          academicYear: editingRule.academicYear || effectiveSessionName,
          definedExamId: editingRule.definedExamId,
          examName: editingRule.examName || "Exam",
          termId: editingRule.termId,
          termName: editingRule.termName,
          feeGateEnabled: editingRule.feeGateEnabled ?? true,
          requirementType: editingRule.requirementType || "installment_percentage",
          installmentId: editingRule.installmentId,
          installmentLabel: editingRule.installmentLabel,
          minimumPaymentPercentage: Number(editingRule.minimumPaymentPercentage) || 50,
          minimumPaymentAmount: Number(editingRule.minimumPaymentAmount) || 0,
          notes: editingRule.notes || "",
          updatedBy: appUser.name || appUser.id,
        },
        { uid: appUser.id, name: appUser.name, role: appUser.role }
      );

      toast({
        title: "Rule Saved",
        description: `Fee eligibility rule updated for ${editingRule.examName}.`,
      });
      setRuleModalOpen(false);
      setEditingRule(null);
      await loadScheduleData();
    } catch (e: any) {
      toast({
        title: "Save Failed",
        description: e.message || "Failed to save rule.",
        variant: "destructive",
      });
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!appUser) return;
    if (!window.confirm("Are you sure you want to remove this fee eligibility rule?")) return;
    try {
      await deleteHallTicketRule(ruleId, { uid: appUser.id, name: appUser.name, role: appUser.role });
      toast({ title: "Rule Deleted", description: "Fee eligibility rule removed." });
      await loadScheduleData();
    } catch (e: any) {
      toast({ title: "Delete Failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Header Banner */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Exam Hall Tickets & Fee Eligibility
            </h1>
            <Badge variant="outline" className="border-primary/30 text-primary font-semibold">
              Source of Truth: Academic Structure
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate and verify official hall tickets for approved examinations linked with student fee installments and authorized bypasses.
          </p>
        </div>

        {/* Master Fee Gate Toggle Card */}
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-2.5 shadow-xs">
          <div className="flex items-center gap-2">
            <Sliders size={18} className="text-primary" />
            <div>
              <p className="text-xs font-bold text-slate-900 leading-tight">Master Fee Gate</p>
              <p className="text-[10px] text-muted-foreground">Enforce fee eligibility</p>
            </div>
          </div>
          <Switch
            checked={globalSettings?.feeGateEnabled ?? true}
            onCheckedChange={handleToggleGlobalFeeGate}
            disabled={settingsLoading}
          />
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              globalSettings?.feeGateEnabled
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {globalSettings?.feeGateEnabled ? "ACTIVE" : "BYPASSED"}
          </span>
        </div>
      </div>

      {/* 2. Exam Schedule & Grade Selection Bar */}
      <Card className="border-border/60 shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <div>
              <Label className="text-xs font-semibold text-slate-600">Filter by Grade</Label>
              <Select value={selectedGrade} onValueChange={setSelectedGrade}>
                <SelectTrigger className="mt-1.5 h-9 bg-white">
                  <SelectValue placeholder="All Grades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Grades with Approved Exams</SelectItem>
                  {availableGrades.map((g) => (
                    <SelectItem key={g} value={g}>
                      Grade {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="sm:col-span-2">
              <Label className="text-xs font-semibold text-slate-600">
                Approved Examination Schedule
              </Label>
              <Select
                value={selectedScheduleId}
                onValueChange={setSelectedScheduleId}
                disabled={loadingSchedules || filteredSchedules.length === 0}
              >
                <SelectTrigger className="mt-1.5 h-9 bg-white font-medium">
                  <SelectValue
                    placeholder={
                      loadingSchedules
                        ? "Loading approved schedules..."
                        : filteredSchedules.length === 0
                        ? "No approved schedules found"
                        : "Choose Examination"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {filteredSchedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="font-bold">{s.examType}</span> · Grade {s.grade} (
                      {s.exams?.length || 0} subjects) · {s.academicYear || s.sessionId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 w-full text-xs font-semibold"
                onClick={loadScheduleData}
                disabled={dataLoading || !currentSchedule}
              >
                <RefreshCw size={14} className={dataLoading ? "animate-spin" : ""} />
                <span>Refresh Status</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Stat Cards */}
      {currentSchedule && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-2xl border border-border/60 bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold">
              <Users size={15} className="text-blue-500" />
              <span>Enrolled</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900">{stats.total}</p>
            <p className="text-[11px] text-muted-foreground">Grade {currentSchedule.grade}</p>
          </div>

          <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/40 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
              <CheckCircle2 size={15} />
              <span>Fee Eligible</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-800">{stats.eligible}</p>
            <p className="text-[11px] text-emerald-600">Requirement satisfied</p>
          </div>

          <div className="rounded-2xl border border-rose-200/60 bg-rose-50/40 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-rose-700 text-xs font-semibold">
              <XCircle size={15} />
              <span>Fee Blocked</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-rose-800">{stats.blocked}</p>
            <p className="text-[11px] text-rose-600">Installment dues pending</p>
          </div>

          <div className={`rounded-2xl border p-4 shadow-xs ${
            stats.bypassPending > 0
              ? "border-amber-300 bg-amber-50/80 ring-1 ring-amber-300"
              : "border-amber-200/60 bg-amber-50/40"
          }`}>
            <div className="flex items-center gap-2 text-amber-800 text-xs font-semibold">
              <Clock size={15} className="text-amber-600" />
              <span>Pending Requests</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-amber-950">{stats.bypassPending}</p>
            <p className="text-[11px] text-amber-700">Awaiting your approval</p>
          </div>

          <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/40 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
              <ShieldCheck size={15} />
              <span>Bypass Approved</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-800">{stats.bypassApproved}</p>
            <p className="text-[11px] text-emerald-600">Principal authorized</p>
          </div>

          <div className="rounded-2xl border border-indigo-200/60 bg-indigo-50/40 p-4 shadow-xs">
            <div className="flex items-center gap-2 text-indigo-700 text-xs font-semibold">
              <Sparkles size={15} />
              <span>Tickets Ready</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-indigo-800">{stats.generated}</p>
            <p className="text-[11px] text-indigo-600">Published & printable</p>
          </div>
        </div>
      )}

      {/* 4. Tab Navigation */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2">
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === "students" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("students")}
            className="text-xs font-semibold h-8"
          >
            <Users size={14} className="mr-1.5" />
            Students & Eligibility ({studentEvaluations.length})
          </Button>
          <Button
            variant={activeTab === "bypasses" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("bypasses")}
            className="text-xs font-semibold h-8"
          >
            <ShieldCheck size={14} className="mr-1.5" />
            Bypasses & Exceptions ({bypasses.length})
            {stats.bypassPending > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 text-white px-1.5 py-0.2 text-[10px] font-bold">
                {stats.bypassPending} pending
              </span>
            )}
          </Button>
          <Button
            variant={activeTab === "rules" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("rules")}
            className="text-xs font-semibold h-8"
          >
            <Settings2 size={14} className="mr-1.5" />
            Fee Eligibility Rule Builder
          </Button>
        </div>

        {activeTab === "students" && currentSchedule && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs font-semibold"
              onClick={handleDownloadBulk}
              disabled={downloadingBulk || stats.generated === 0}
            >
              {downloadingBulk ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>Download Generated Batch ({stats.generated})</span>
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleBulkGenerate}
              disabled={bulkGenerating || (stats.eligible + stats.bypassApproved === 0)}
            >
              {bulkGenerating ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
              <span>Generate All Eligible ({stats.eligible + stats.bypassApproved})</span>
            </Button>
          </div>
        )}
      </div>

      {/* 5. TAB 1: Students & Eligibility */}
      {activeTab === "students" && (
        <div className="space-y-4">
          {/* Active Rule Indicator */}
          {currentSchedule && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Sliders size={16} />
                </div>
                <div>
                  <p className="font-bold text-slate-900">
                    Active Rule for {currentSchedule.examType}:
                  </p>
                  <p className="text-slate-600 mt-0.5">
                    {!globalSettings?.feeGateEnabled
                      ? "Fee Gate is currently disabled globally. All students are eligible."
                      : currentExamRule?.feeGateEnabled
                      ? currentExamRule.requirementType === "installment_percentage"
                        ? `${currentExamRule.installmentLabel || "Installment 1"} must be paid ≥ ${currentExamRule.minimumPaymentPercentage ?? 50}%`
                        : currentExamRule.requirementType === "installment_full"
                        ? `${currentExamRule.installmentLabel || "Installment 1"} must be 100% cleared`
                        : currentExamRule.requirementType === "all_due_cleared"
                        ? "All academic year fee installments and dues must be fully cleared (100%)"
                        : `Minimum payment of ₹${(currentExamRule.minimumPaymentAmount ?? 0).toLocaleString("en-IN")} required`
                      : "No fee gate configured for this exam (all enrolled students eligible)."}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs font-semibold shrink-0"
                onClick={() => setActiveTab("rules")}
              >
                Change Rule
              </Button>
            </div>
          )}

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant={statusFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("all")}
                className="h-7 text-xs"
              >
                All ({stats.total})
              </Button>
              <Button
                variant={statusFilter === "eligible" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("eligible")}
                className="h-7 text-xs border-emerald-300 text-emerald-700 bg-emerald-50/50"
              >
                Eligible ({stats.eligible})
              </Button>
              <Button
                variant={statusFilter === "pending_bypass" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("pending_bypass")}
                className={`h-7 text-xs ${
                  stats.bypassPending > 0
                    ? "border-amber-400 bg-amber-100 text-amber-900 font-bold"
                    : "border-amber-300 text-amber-700 bg-amber-50/50"
                }`}
              >
                Pending Requests ({stats.bypassPending})
              </Button>
              <Button
                variant={statusFilter === "blocked" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("blocked")}
                className="h-7 text-xs border-rose-300 text-rose-700 bg-rose-50/50"
              >
                Blocked ({stats.blocked})
              </Button>
              <Button
                variant={statusFilter === "bypass_approved" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("bypass_approved")}
                className="h-7 text-xs border-emerald-300 text-emerald-700 bg-emerald-50/50"
              >
                Bypass Approved ({stats.bypassApproved})
              </Button>
              <Button
                variant={statusFilter === "generated" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("generated")}
                className="h-7 text-xs border-indigo-300 text-indigo-700 bg-indigo-50/50"
              >
                Generated ({stats.generated})
              </Button>
            </div>

            <div className="w-full sm:w-64">
              <SearchInput
                placeholder="Search student or roll no..."
                value={searchQuery}
                onChange={setSearchQuery}
                className="h-8 text-xs bg-white"
                showShortcutHint={false}
              />
            </div>
          </div>

          {/* Student Table */}
          <Card className="border-border/60 shadow-xs overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow>
                  <TableHead className="w-12 text-xs">#</TableHead>
                  <TableHead className="text-xs">Student Particulars</TableHead>
                  <TableHead className="text-xs">Class / Section</TableHead>
                  <TableHead className="text-xs">Fee Ledger Status</TableHead>
                  <TableHead className="text-xs">Eligibility Status</TableHead>
                  <TableHead className="text-xs">Evaluation Details</TableHead>
                  <TableHead className="text-xs">Hall Ticket</TableHead>
                  <TableHead className="text-right text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <Loader2 className="animate-spin mx-auto text-primary" size={24} />
                      <p className="text-xs text-muted-foreground mt-2">Evaluating fee eligibility...</p>
                    </TableCell>
                  </TableRow>
                ) : filteredStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-28 text-center text-muted-foreground text-xs">
                      No students found matching current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredStudents.map((item, idx) => (
                    <TableRow key={item.studentId} className="hover:bg-slate-50/60">
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {idx + 1}
                      </TableCell>
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
                        <div className="text-[10px] text-muted-foreground">
                          Total: ₹{item.feeDetails.totalFee.toLocaleString("en-IN")} · Bal: ₹
                          {item.feeDetails.outstanding.toLocaleString("en-IN")}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.status === "eligible" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                            <CheckCircle2 size={12} />
                            Eligible
                          </span>
                        ) : item.status === "bypass_approved" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                            <ShieldCheck size={12} className="text-emerald-700" />
                            Bypass Approved
                          </span>
                        ) : item.pendingBypass ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-300">
                            <Clock size={12} />
                            Request Received
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                            <XCircle size={12} />
                            Blocked
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="text-xs text-slate-700 leading-snug line-clamp-2" title={item.reason}>
                          {item.reason}
                        </p>
                      </TableCell>
                      <TableCell>
                        {item.existingHallTicket ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                              Generated
                            </span>
                            <p className="text-[10px] font-mono text-muted-foreground truncate w-24">
                              {item.existingHallTicket.ticketNumber}
                            </p>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">Not generated</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.existingHallTicket ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => handleDownloadSingle(item.existingHallTicket!)}
                                disabled={downloadingSingleId === item.existingHallTicket.id}
                                title="Download Admit Card PDF"
                              >
                                {downloadingSingleId === item.existingHallTicket.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Download size={13} />
                                )}
                                <span>PDF</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                onClick={() => handleRevoke(item.existingHallTicket!)}
                                title="Revoke Hall Ticket"
                              >
                                <Trash2 size={13} />
                              </Button>
                            </>
                          ) : item.eligible ? (
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => handleGenerateSingle(item)}
                              disabled={singleGeneratingId === item.studentId}
                            >
                              {singleGeneratingId === item.studentId ? (
                                <Loader2 className="animate-spin" size={12} />
                              ) : (
                                <Sparkles size={12} className="mr-1" />
                              )}
                              <span>Generate</span>
                            </Button>
                          ) : item.pendingBypass ? (
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                              onClick={() => handleOpenReview(item.pendingBypass!)}
                              title="Review student's bypass request for approval"
                            >
                              <ShieldAlert size={13} className="mr-1" />
                              <span>Review Request</span>
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-muted-foreground italic">No request</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[11px] text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                                onClick={() => handleOpenDirectOverride(item)}
                                title="Grant direct administrative bypass override"
                              >
                                <ShieldCheck size={12} className="mr-1 text-slate-400" />
                                <span>Override</span>
                              </Button>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* 6. TAB 2: Bypasses & Exceptions */}
      {activeTab === "bypasses" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Hall Ticket Fee Bypasses</h3>
              <p className="text-xs text-muted-foreground">
                Authorizations and exceptions permitting fee-blocked students to sit for examinations.
              </p>
            </div>
          </div>

          <Card className="border-border/60 shadow-xs overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow>
                  <TableHead className="text-xs">Student</TableHead>
                  <TableHead className="text-xs">Class & Section</TableHead>
                  <TableHead className="text-xs">Examination</TableHead>
                  <TableHead className="text-xs">Fee Shortfall</TableHead>
                  <TableHead className="text-xs">Exception Reason</TableHead>
                  <TableHead className="text-xs">Requested By</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-right text-xs">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bypasses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-28 text-center text-muted-foreground text-xs">
                      No bypass requests recorded for this examination session.
                    </TableCell>
                  </TableRow>
                ) : (
                  bypasses.map((bp) => (
                    <TableRow key={bp.id}>
                      <TableCell>
                        <div className="font-semibold text-xs text-slate-900">{bp.studentName}</div>
                        <div className="text-[11px] text-muted-foreground">Adm: {bp.admissionNo || "N/A"}</div>
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
                        {bp.reviewNotes && (
                          <p className="text-[10px] text-slate-500 italic mt-0.5">
                            Note: {bp.reviewNotes}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {bp.requestedBy.name} ({bp.requestedBy.role})
                        <div className="text-[10px]">{new Date(bp.requestedAt).toLocaleDateString()}</div>
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
                        ) : bp.status === "rejected" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">
                            Rejected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                            Revoked
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {bp.status === "pending" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs font-semibold text-primary border-primary/30"
                            onClick={() => handleOpenReview(bp)}
                          >
                            Review
                          </Button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {bp.reviewedBy?.name ? `By ${bp.reviewedBy.name}` : "-"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* 7. TAB 3: Fee Eligibility Rule Builder */}
      {activeTab === "rules" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Exam Fee Eligibility Rules Configuration
              </h3>
              <p className="text-xs text-muted-foreground">
                Configure exam-specific fee gates for defined exams from the Academic Structure Planner.
              </p>
            </div>
          </div>

          <Card className="border-border/60 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Layers className="text-primary" size={16} />
                <span>
                  Defined Exams from Academic Structure (Grade {currentSchedule?.grade || "Selected"})
                </span>
              </CardTitle>
              <CardDescription className="text-xs">
                The Academic Structure is the single source of truth. Each defined exam can have a custom fee requirement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {applicableStructure?.version.exams && applicableStructure.version.exams.length > 0 ? (
                <div className="divide-y divide-border/60">
                  {applicableStructure.version.exams.map((definedExam) => {
                    const rule = rules.find((r) => r.definedExamId === definedExam.id);
                    return (
                      <div
                        key={definedExam.id}
                        className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-sm text-slate-900">{definedExam.name}</p>
                            <Badge variant="outline" className="text-[10px]">
                              {definedExam.termId === "term_2" ? "Term 2" : "Term 1"}
                            </Badge>
                            {rule?.feeGateEnabled ? (
                              <Badge className="bg-emerald-100 text-emerald-800 text-[10px] border-emerald-300">
                                Fee Gate Active
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">
                                No Restriction
                              </Badge>
                            )}
                          </div>

                          <p className="text-xs text-slate-600">
                            {rule?.feeGateEnabled
                              ? rule.requirementType === "installment_percentage"
                                ? `Requirement: ${rule.installmentLabel || "Installment 1"} paid ≥ ${rule.minimumPaymentPercentage ?? 50}%`
                                : rule.requirementType === "installment_full"
                                ? `Requirement: ${rule.installmentLabel || "Installment 1"} 100% paid`
                                : rule.requirementType === "all_due_cleared"
                                ? "Requirement: All fee installments and dues must be fully cleared (100%)"
                                : `Requirement: Minimum ₹${(rule.minimumPaymentAmount ?? 0).toLocaleString("en-IN")} total payment`
                              : "Students can receive hall tickets regardless of fee dues."}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs font-semibold gap-1.5"
                            onClick={() => handleOpenRuleEditor(definedExam)}
                          >
                            <Settings2 size={13} />
                            <span>{rule ? "Edit Rule" : "Configure Rule"}</span>
                          </Button>
                          {rule && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                              onClick={() => handleDeleteRule(rule.id)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No active Academic Structure found for Grade {currentSchedule?.grade || "--"}. Please configure an Academic Structure first.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 8. MODAL: Configure Rule Dialog */}
      <Dialog open={ruleModalOpen} onOpenChange={setRuleModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Fee Requirement: {editingRule?.examName}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure conditions that students must satisfy before an official hall ticket can be generated.
            </DialogDescription>
          </DialogHeader>

          {editingRule && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div>
                  <Label className="text-xs font-bold text-slate-800">Fee Restriction Gate</Label>
                  <p className="text-[11px] text-muted-foreground">Enable fee check for this exam</p>
                </div>
                <Switch
                  checked={editingRule.feeGateEnabled ?? true}
                  onCheckedChange={(val) => setEditingRule({ ...editingRule, feeGateEnabled: val })}
                />
              </div>

              {editingRule.feeGateEnabled && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Requirement Condition Type</Label>
                    <Select
                      value={editingRule.requirementType || "installment_percentage"}
                      onValueChange={(val: any) =>
                        setEditingRule({ ...editingRule, requirementType: val })
                      }
                    >
                      <SelectTrigger className="h-9 text-xs bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="installment_percentage">
                          Minimum Percentage of Installment Paid (e.g. ≥ 50%)
                        </SelectItem>
                        <SelectItem value="installment_full">
                          Full Installment Cleared (100% Paid)
                        </SelectItem>
                        <SelectItem value="all_due_cleared">
                          All Fee Dues Cleared (0 Outstanding Balance)
                        </SelectItem>
                        <SelectItem value="specific_amount">
                          Minimum Specific Amount Paid (₹)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {(editingRule.requirementType === "installment_percentage" ||
                    editingRule.requirementType === "installment_full") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Target Fee Installment</Label>
                      <Select
                        value={editingRule.installmentLabel || "Installment 1"}
                        onValueChange={(val) => {
                          const matched = matchedFeeStructure?.installments.find(
                            (i) => i.label === val
                          );
                          setEditingRule({
                            ...editingRule,
                            installmentLabel: val,
                            installmentId: matched?.id || editingRule.installmentId,
                          });
                        }}
                      >
                        <SelectTrigger className="h-9 text-xs bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {matchedFeeStructure?.installments &&
                          matchedFeeStructure.installments.length > 0 ? (
                            matchedFeeStructure.installments.map((inst) => (
                              <SelectItem key={inst.id} value={inst.label}>
                                {inst.label} (Due: ₹{inst.amount.toLocaleString("en-IN")})
                              </SelectItem>
                            ))
                          ) : (
                            <>
                              <SelectItem value="Installment 1">Installment 1</SelectItem>
                              <SelectItem value="Installment 2">Installment 2</SelectItem>
                              <SelectItem value="Installment 3">Installment 3</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {editingRule.requirementType === "installment_percentage" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        Minimum Percentage Required (%)
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          max="100"
                          value={editingRule.minimumPaymentPercentage ?? 50}
                          onChange={(e) =>
                            setEditingRule({
                              ...editingRule,
                              minimumPaymentPercentage: Number(e.target.value),
                            })
                          }
                          className="h-9 text-xs bg-white"
                        />
                        <span className="text-xs font-bold text-slate-500">%</span>
                      </div>
                    </div>
                  )}

                  {editingRule.requirementType === "specific_amount" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">
                        Minimum Total Fee Paid (₹)
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        value={editingRule.minimumPaymentAmount ?? 0}
                        onChange={(e) =>
                          setEditingRule({
                            ...editingRule,
                            minimumPaymentAmount: Number(e.target.value),
                          })
                        }
                        className="h-9 text-xs bg-white"
                      />
                    </div>
                  )}

                  <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-800">
                    <p className="font-semibold">Rule Preview:</p>
                    <p className="mt-0.5 text-blue-700">
                      {editingRule.requirementType === "installment_percentage"
                        ? `Students must have paid at least ${editingRule.minimumPaymentPercentage ?? 50}% of ${editingRule.installmentLabel || "Installment 1"} to receive their Hall Ticket.`
                        : editingRule.requirementType === "installment_full"
                        ? `Students must have fully cleared (100%) ${editingRule.installmentLabel || "Installment 1"} to receive their Hall Ticket.`
                        : editingRule.requirementType === "all_due_cleared"
                        ? "Students must have zero outstanding fee balance to receive their Hall Ticket."
                        : `Students must have paid at least ₹${(editingRule.minimumPaymentAmount ?? 0).toLocaleString("en-IN")} total fees to receive their Hall Ticket.`}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRuleModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveRule}
              disabled={savingRule}
              className="bg-primary hover:bg-primary/90"
            >
              {savingRule ? <Loader2 className="animate-spin mr-1" size={14} /> : null}
              Save Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 9. MODAL: Grant Administrative Override Dialog */}
      <Dialog open={overrideModalOpen} onOpenChange={setOverrideModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Grant Administrative Override
            </DialogTitle>
            <DialogDescription className="text-xs">
              Directly authorize examination clearance for this student as an administrator without waiting for a student request.
            </DialogDescription>
          </DialogHeader>

          {overrideStudent && (
            <div className="space-y-3 py-2 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Candidate</span>
                  <span className="font-bold text-slate-900">{overrideStudent.studentName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Class & Exam</span>
                  <span className="font-semibold text-slate-800">
                    Grade {overrideStudent.grade} · {currentSchedule?.examType}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Outstanding Dues</span>
                  <span className="text-rose-700 font-semibold">₹{(overrideStudent.feeDetails.outstanding || 0).toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Reason</span>
                  <span className="text-rose-700 font-medium">{overrideStudent.reason}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Administrative Reason / Justification *</Label>
                <Textarea
                  placeholder="e.g. Approved per Principal order, fee installment plan agreed with guardian, medical hardship exemption..."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="text-xs min-h-[90px]"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOverrideModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveDirectOverride}
              disabled={savingOverride}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {savingOverride ? <Loader2 className="animate-spin mr-1" size={14} /> : null}
              Authorize & Clear Student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 10. MODAL: Review Bypass Dialog */}
      <Dialog open={reviewModalOpen} onOpenChange={setReviewModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Review Bypass Request</DialogTitle>
            <DialogDescription className="text-xs">
              Approve or reject the authorized examination exception.
            </DialogDescription>
          </DialogHeader>

          {reviewingBypass && (
            <div className="space-y-3 py-2 text-xs">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Candidate</span>
                  <span className="font-bold text-slate-900">{reviewingBypass.studentName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Class & Exam</span>
                  <span className="font-medium text-slate-800">
                    Grade {reviewingBypass.grade} · {reviewingBypass.examName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shortfall Amount</span>
                  <span className="font-bold text-rose-700">
                    ₹{(reviewingBypass.feeShortfallAmount || 0).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="border-t border-slate-200 pt-1.5">
                  <span className="text-muted-foreground block text-[10px]">Stated Reason:</span>
                  <p className="font-medium text-slate-900 mt-0.5">{reviewingBypass.reason}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Reviewer Notes (Optional)</Label>
                <Input
                  placeholder="e.g. Approved per Principal order #4521..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleProcessReview("rejected")}
              disabled={processingReview}
              className="text-rose-600 border-rose-300 hover:bg-rose-50"
            >
              Reject Bypass
            </Button>
            <Button
              size="sm"
              onClick={() => handleProcessReview("approved")}
              disabled={processingReview}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {processingReview ? <Loader2 className="animate-spin mr-1" size={14} /> : null}
              Approve Bypass
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useState, useCallback } from "react";
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
  HallTicket,
  HallTicketBypass,
  HallTicketGlobalSettings,
  HallTicketRule,
  Student,
  Enrollment,
  StudentFeeAssignment,
} from "@/lib/types";
import {
  getHallTicketGlobalSettings,
  listHallTicketRules,
  listHallTicketBypasses,
  requestHallTicketBypass,
  evaluateStudentExamEligibility,
  getStudentHallTickets,
} from "@/lib/hallTicketEngine";
import { getStudentFeeAssignment } from "@/lib/feeAssignments";
import { downloadHallTicketPdf } from "@/lib/generateHallTicketPdf";
import { usePaymentCapability } from "@/lib/payments";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  GraduationCap,
  Loader2,
  Lock,
  MapPin,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  CreditCard,
  ArrowRight,
  AlertTriangle,
  XCircle,
  Send,
} from "lucide-react";

export default function StudentHallTickets() {
  const { appUser } = useAuth();
  const paymentCap = usePaymentCapability();
  const { workingSession, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "2026-27";
  const effectiveSessionName = workingSession?.name || activeSession?.name || "2026-27";

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [feeStructure, setFeeStructure] = useState<FeeStructure | null>(null);
  const [studentFeeAssignment, setStudentFeeAssignment] = useState<StudentFeeAssignment | null>(null);
  const [feePayments, setFeePayments] = useState<FeePayment[]>([]);
  const [bypasses, setBypasses] = useState<HallTicketBypass[]>([]);
  const [rules, setRules] = useState<HallTicketRule[]>([]);
  const [globalSettings, setGlobalSettings] = useState<HallTicketGlobalSettings | null>(null);
  const [hallTickets, setHallTickets] = useState<HallTicket[]>([]);

  // Student Bypass Request Modal State
  const [bypassModalOpen, setBypassModalOpen] = useState(false);
  const [selectedExamForBypass, setSelectedExamForBypass] = useState<{
    schedule: ExamSchedule;
    evalResult: any;
  } | null>(null);
  const [bypassReason, setBypassReason] = useState("");
  const [submittingBypass, setSubmittingBypass] = useState(false);
  const [downloadingTicketId, setDownloadingTicketId] = useState<string | null>(null);

  const handleDownloadTicket = async (ticket: HallTicket) => {
    setDownloadingTicketId(ticket.id);
    try {
      await downloadHallTicketPdf(ticket);
    } catch (e: any) {
      toast({
        title: "Download Failed",
        description: e.message || "Could not generate or download hall ticket PDF.",
        variant: "destructive",
      });
    } finally {
      setDownloadingTicketId(null);
    }
  };

  // 1. Fetch Student profile & active enrollment
  const loadData = useCallback(async () => {
    if (!appUser) return;
    try {
      let studentSnap = await getDocs(
        query(collection(db, "students"), where("uid", "==", appUser.id))
      );
      if (studentSnap.empty && appUser.email) {
        studentSnap = await getDocs(
          query(collection(db, "students"), where("email", "==", appUser.email))
        );
      }

      if (studentSnap.empty) {
        setLoading(false);
        return;
      }

      const sDoc = studentSnap.docs[0];
      const sData = { id: sDoc.id, ...sDoc.data() } as Student;
      setStudent(sData);

      // Fetch enrollment
      const [enSnapYear, enSnapActive] = await Promise.all([
        effectiveSessionName
          ? getDocs(
              query(
                collection(db, "enrollments"),
                where("studentId", "==", sData.id),
                where("academicYear", "==", effectiveSessionName)
              )
            )
          : Promise.resolve(null),
        getDocs(
          query(
            collection(db, "enrollments"),
            where("studentId", "==", sData.id),
            where("status", "==", "active")
          )
        ),
      ]);

      const validEn =
        (enSnapYear && !enSnapYear.empty
          ? (enSnapYear.docs[0].data() as Enrollment)
          : null) ||
        (!enSnapActive.empty ? (enSnapActive.docs[0].data() as Enrollment) : null);

      setEnrollment(validEn);

      const targetGrade = validEn?.className || sData.grade;

      // Fetch approved schedules, fee structure, fee payments, bypasses, rules, generated hall tickets
      const [
        schedulesSnap,
        structuresSnap,
        paymentsSnap,
        studentAssignment,
        bypassesByUid,
        bypassesById,
        rulesList,
        settings,
        ticketsList,
      ] = await Promise.all([
        getDocs(
          query(
            collection(db, "examSchedules"),
            where("grade", "==", targetGrade),
            where("status", "==", "approved")
          )
        ),
        getDocs(
          query(collection(db, "feeStructures"), where("grade", "==", targetGrade))
        ),
        getDocs(
          query(collection(db, "feePayments"), where("studentId", "==", sData.id))
        ),
        getStudentFeeAssignment(sData.id, effectiveSessionId, appUser.id),
        listHallTicketBypasses({ studentUid: appUser.id, sessionId: effectiveSessionId }),
        sData.id !== appUser.id
          ? listHallTicketBypasses({ studentId: sData.id, sessionId: effectiveSessionId })
          : Promise.resolve([]),
        listHallTicketRules(effectiveSessionId),
        getHallTicketGlobalSettings(),
        getStudentHallTickets(sData.id, sData.uid),
      ]);

      const bypassMap = new Map<string, HallTicketBypass>();
      [...bypassesByUid, ...bypassesById].forEach((b) => bypassMap.set(b.id, b));
      const mergedBypasses = Array.from(bypassMap.values());

      setSchedules(schedulesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamSchedule)));
      setFeeStructure(
        structuresSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeStructure))[0] || null
      );
      setStudentFeeAssignment(studentAssignment);
      setFeePayments(paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeePayment)));
      setBypasses(mergedBypasses);
      setRules(rulesList);
      setGlobalSettings(settings);
      setHallTickets(ticketsList);
    } catch (err) {
      console.error("Error loading student hall tickets:", err);
    } finally {
      setLoading(false);
    }
  }, [appUser, effectiveSessionId, effectiveSessionName]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Open bypass request modal
  const handleOpenBypassModal = (schedule: ExamSchedule, evalResult: any) => {
    setSelectedExamForBypass({ schedule, evalResult });
    setBypassReason("");
    setBypassModalOpen(true);
  };

  // Submit bypass request
  const handleSubmitBypassRequest = async () => {
    if (!selectedExamForBypass || !student || !appUser) return;
    if (!bypassReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please state the reason or circumstance for your bypass request.",
        variant: "destructive",
      });
      return;
    }

    setSubmittingBypass(true);
    try {
      const { schedule, evalResult } = selectedExamForBypass;
      await requestHallTicketBypass(
        {
          studentId: student.id,
          studentUid: student.uid || appUser.id,
          studentName: student.name,
          admissionNo: student.admissionNo,
          rollNo: enrollment?.rollNo || student.rollNo,
          grade: enrollment?.className || student.grade || schedule.grade,
          sectionId: enrollment?.sectionId || student.sectionId,
          sectionName: enrollment?.sectionName || null,
          sessionId: schedule.sessionId || effectiveSessionId,
          academicYear: schedule.academicYear || effectiveSessionName,
          definedExamId: schedule.definedExamId || schedule.id || "",
          examName: schedule.examType,
          scheduleId: schedule.id,
          reason: bypassReason.trim(),
          feeShortfallAmount: evalResult.feeDetails?.outstanding || 0,
          feeStatusSummary: evalResult.reason || "",
        },
        {
          uid: appUser.id,
          name: student.name || appUser.name || "Student",
          role: "student",
        }
      );

      toast({
        title: "Bypass Request Submitted",
        description: `Your bypass request for ${schedule.examType} has been submitted to the administration for review and approval.`,
      });

      setBypassModalOpen(false);
      setSelectedExamForBypass(null);
      setBypassReason("");

      await loadData();
    } catch (err: any) {
      toast({
        title: "Request Failed",
        description: err.message || "Failed to submit bypass request.",
        variant: "destructive",
      });
    } finally {
      setSubmittingBypass(false);
    }
  };

  // Evaluate eligibility for each approved schedule
  const examCards = useMemo(() => {
    if (!student || !globalSettings) return [];

    return schedules.map((schedule) => {
      const examRule = rules.find((r) => r.definedExamId === schedule.definedExamId) || null;
      
      const examBypasses = bypasses.filter((b) => b.definedExamId === schedule.definedExamId);
      examBypasses.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      const latestBypass = examBypasses[0] || null;

      const approvedBypass = examBypasses.find((b) => b.status === "approved") || null;
      const pendingBypass = examBypasses.find((b) => b.status === "pending") || null;
      const rejectedBypass = (!approvedBypass && !pendingBypass) ? (examBypasses.find((b) => b.status === "rejected") || null) : null;

      const existingTicket =
        hallTickets.find((t) => t.scheduleId === schedule.id && t.status !== "revoked") || null;

      const evalResult = evaluateStudentExamEligibility({
        student,
        enrollment,
        schedule,
        feeStructure,
        studentFeeAssignment,
        studentPayments: feePayments,
        globalSettings,
        examRule,
        approvedBypass,
        pendingBypass,
        existingHallTicket: existingTicket,
      });

      return {
        schedule,
        evalResult,
        ticket: existingTicket,
        latestBypass,
        approvedBypass,
        pendingBypass,
        rejectedBypass,
      };
    });
  }, [student, enrollment, schedules, feeStructure, studentFeeAssignment, feePayments, bypasses, rules, globalSettings, hallTickets]);

  if (loading) {
    return (
      <div className="flex min-h-[380px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin text-primary mx-auto mb-3" size={32} />
          <p className="text-sm text-muted-foreground">Checking examination hall tickets & fee eligibility...</p>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          No student profile found for this login.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Examination Hall Tickets
            </h1>
            <Badge variant="outline" className="border-primary/30 text-primary font-semibold">
              Grade {enrollment?.className || student.grade}
              {enrollment?.sectionName ? ` - ${enrollment.sectionName}` : ""}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Official admit cards for upcoming examinations. Download your verified hall ticket or review fee requirements.
          </p>
        </div>

        <Link href="/student/fees">
          <Button variant="outline" size="sm" className="h-9 gap-2 text-xs font-semibold self-start sm:self-auto">
            <CreditCard size={15} className="text-primary" />
            <span>My Fee Status</span>
            <ArrowRight size={14} className="text-muted-foreground" />
          </Button>
        </Link>
      </div>

      {/* 2. Scheduled Exam Cards */}
      {examCards.length === 0 ? (
        <Card className="border-border/60 shadow-xs">
          <CardContent className="py-16 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <CalendarDays size={24} />
            </div>
            <div>
              <p className="font-bold text-slate-800">No Approved Examinations Yet</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                Examination schedules published and approved by the Principal will appear here along with your hall ticket.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {examCards.map(({ schedule, evalResult, ticket, pendingBypass, rejectedBypass }) => {
            const isTicketReady = !!ticket && ticket.status === "generated";
            const isBlocked = evalResult.status === "blocked";

            return (
              <Card
                key={schedule.id}
                className={`border overflow-hidden shadow-xs transition-all ${
                  isTicketReady
                    ? "border-emerald-200 bg-white"
                    : pendingBypass
                    ? "border-amber-200 bg-amber-50/20"
                    : isBlocked
                    ? "border-rose-200 bg-rose-50/20"
                    : "border-slate-200 bg-white"
                }`}
              >
                {/* Header Banner */}
                <div
                  className={`px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isTicketReady
                      ? "bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border-b border-emerald-100"
                      : pendingBypass
                      ? "bg-amber-50 border-b border-amber-200"
                      : isBlocked
                      ? "bg-rose-50 border-b border-rose-200"
                      : "bg-slate-50 border-b border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${
                        isTicketReady
                          ? "bg-emerald-600 text-white"
                          : pendingBypass
                          ? "bg-amber-500 text-white"
                          : isBlocked
                          ? "bg-rose-600 text-white"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {isTicketReady ? (
                        <CheckCircle2 size={22} />
                      ) : pendingBypass ? (
                        <Clock size={20} />
                      ) : isBlocked ? (
                        <Lock size={20} />
                      ) : (
                        <Clock size={20} />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-slate-900">{schedule.examType}</h2>
                        <Badge variant="outline" className="text-[10px] font-semibold">
                          {schedule.termName || "Term 1"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Academic Year: {schedule.academicYear || effectiveSessionName} · {schedule.exams?.length || 0} scheduled subjects
                      </p>
                    </div>
                  </div>

                  {/* Top Status Badge */}
                  <div>
                    {isTicketReady ? (
                      <Badge className="bg-emerald-600 text-white font-bold text-xs gap-1.5 px-3 py-1">
                        <Sparkles size={13} />
                        Hall Ticket Ready
                      </Badge>
                    ) : evalResult.status === "bypass_approved" ? (
                      <Badge className="bg-emerald-100 text-emerald-900 border-emerald-300 font-bold text-xs gap-1 px-2.5 py-1">
                        <ShieldCheck size={14} className="text-emerald-700" />
                        Bypass Approved (Generating...)
                      </Badge>
                    ) : pendingBypass ? (
                      <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-xs gap-1.5 px-2.5 py-1">
                        <Clock size={13} className="text-amber-700" />
                        Bypass Pending Approval
                      </Badge>
                    ) : rejectedBypass ? (
                      <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-bold text-xs gap-1 px-2.5 py-1">
                        <XCircle size={13} />
                        Fee Clearance Required (Bypass Declined)
                      </Badge>
                    ) : isBlocked ? (
                      <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-bold text-xs gap-1 px-2.5 py-1">
                        <Lock size={13} />
                        Fee Clearance Required
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="font-semibold text-xs">
                        Eligible · Awaiting Issue
                      </Badge>
                    )}
                  </div>
                </div>

                <CardContent className="p-6 space-y-6">
                  {/* Status Banner when Bypass is Pending */}
                  {!isTicketReady && pendingBypass && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
                          <Clock size={18} />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-amber-950">
                              Bypass Request Submitted · Awaiting School Approval
                            </p>
                            <span className="inline-flex items-center rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                              Pending Review
                            </span>
                          </div>
                          <p className="text-xs text-amber-800 leading-relaxed">
                            Your hall ticket bypass request has been sent to the school administration / Principal for review and approval. Once approved, your hall ticket will become available for generation and download.
                          </p>
                          <div className="mt-2 rounded-lg bg-white/70 border border-amber-200/60 p-2.5 text-xs text-slate-800 space-y-1">
                            <div className="font-medium text-slate-900">
                              <span className="text-muted-foreground font-normal">Reason Submitted: </span>
                              "{pendingBypass.reason}"
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              Requested on {new Date(pendingBypass.requestedAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-amber-200/80 pt-3">
                        <div className="text-xs text-slate-700">
                          <span>Outstanding Balance: </span>
                          <span className="font-bold text-amber-950">
                            ₹{evalResult.feeDetails.outstanding.toLocaleString("en-IN")}
                          </span>
                        </div>

                        <Link href="/student/fees">
                          <Button variant="outline" size="sm" className="h-8 text-xs font-semibold gap-1.5 border-amber-300 text-amber-900 hover:bg-amber-100">
                            <CreditCard size={14} />
                            <span>Pay Dues Online Now</span>
                          </Button>
                        </Link>
                      </div>
                    </div>
                  )}

                  {/* Status Banner when Bypass was Rejected */}
                  {!isTicketReady && !pendingBypass && rejectedBypass && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-lg bg-rose-100 flex items-center justify-center text-rose-700 shrink-0 mt-0.5">
                          <XCircle size={18} />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-rose-950">
                              Bypass Request Declined
                            </p>
                            <span className="inline-flex items-center rounded-full bg-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-900">
                              Rejected
                            </span>
                          </div>
                          <p className="text-xs text-rose-800 leading-relaxed">
                            {rejectedBypass.reviewNotes || "Your bypass request could not be approved by the administration. Please clear the pending fee requirement to obtain your hall ticket."}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-rose-200/80 pt-3">
                        <div className="text-xs text-slate-700">
                          <span>Outstanding Balance: </span>
                          <span className="font-bold text-rose-900">
                            ₹{evalResult.feeDetails.outstanding.toLocaleString("en-IN")}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs font-semibold border-amber-300 text-amber-800 hover:bg-amber-50 gap-1.5"
                            onClick={() => handleOpenBypassModal(schedule, evalResult)}
                          >
                            <ShieldCheck size={14} />
                            <span>Request Bypass Again</span>
                          </Button>
                          <Link href="/student/fees">
                            <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white h-8 text-xs font-semibold gap-1.5">
                              <CreditCard size={14} />
                              <span>{paymentCap.isOnlinePaymentActive ? "Pay Dues Online Now" : "Pay Dues at Counter (Online Coming Soon)"}</span>
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Standard Status Banner when Blocked without previous request */}
                  {!isTicketReady && !pendingBypass && !rejectedBypass && isBlocked && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="text-rose-600 shrink-0 mt-0.5" size={20} />
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-rose-900">
                            Hall Ticket Locked: Fee Requirement Pending
                          </p>
                          <p className="text-xs text-rose-800 leading-relaxed">
                            {evalResult.reason}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-rose-200/80 pt-3">
                        <div className="text-xs text-slate-700">
                          <span>Outstanding Balance: </span>
                          <span className="font-bold text-rose-900">
                            ₹{evalResult.feeDetails.outstanding.toLocaleString("en-IN")}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs font-semibold border-amber-300 text-amber-800 hover:bg-amber-50 gap-1.5"
                            onClick={() => handleOpenBypassModal(schedule, evalResult)}
                          >
                            <ShieldCheck size={14} />
                            <span>Request Bypass</span>
                          </Button>
                          <Link href="/student/fees">
                            <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white h-8 text-xs font-semibold gap-1.5">
                              <CreditCard size={14} />
                              <span>{paymentCap.isOnlinePaymentActive ? "Pay Dues Online Now" : "Pay Dues at Counter (Online Coming Soon)"}</span>
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Hall Ticket Details Preview */}
                  {isTicketReady && ticket ? (
                    <div className="space-y-6">
                      {/* Ticket Meta & Quick Actions */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Admit Card No:</span>
                            <span className="font-mono font-bold text-slate-900">{ticket.ticketNumber}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Issued Date:</span>
                            <span className="font-medium text-slate-800">
                              {new Date(ticket.generatedAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-2 h-9 px-4 shadow-xs"
                          onClick={() => handleDownloadTicket(ticket)}
                          disabled={downloadingTicketId === ticket.id}
                        >
                          {downloadingTicketId === ticket.id ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Download size={15} />
                          )}
                          <span>Download Official Hall Ticket (PDF)</span>
                        </Button>
                      </div>

                      {/* Timetable Table */}
                      <div className="space-y-2">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                          Examination Timetable & Seating
                        </h3>
                        <div className="rounded-xl border border-border/80 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-100/80 text-slate-700 border-b border-border/60">
                              <tr>
                                <th className="py-2.5 px-3 text-left font-semibold">Date</th>
                                <th className="py-2.5 px-3 text-left font-semibold">Day</th>
                                <th className="py-2.5 px-3 text-left font-semibold">Subject</th>
                                <th className="py-2.5 px-3 text-left font-semibold">Time</th>
                                <th className="py-2.5 px-3 text-left font-semibold">Venue / Room</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {ticket.scheduledSubjects.map((s, idx) => (
                                <tr key={idx} className="hover:bg-slate-50/60">
                                  <td className="py-2.5 px-3 font-medium text-slate-900">{s.date}</td>
                                  <td className="py-2.5 px-3 text-slate-600">{s.dayName || "-"}</td>
                                  <td className="py-2.5 px-3 font-bold text-slate-900">{s.subjectName}</td>
                                  <td className="py-2.5 px-3 font-mono text-slate-700">
                                    {s.startTime} - {s.endTime}
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600">
                                    <div className="flex items-center gap-1">
                                      <MapPin size={12} className="text-muted-foreground" />
                                      <span>{s.venue || "Examination Hall"}</span>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Candidate Code of Conduct & Rules */}
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 space-y-2">
                        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                          Important Candidate Rules
                        </h4>
                        <ul className="list-disc list-inside space-y-1 text-xs text-slate-600">
                          {ticket.instructions.slice(0, 4).map((rule, idx) => (
                            <li key={idx} className="leading-relaxed">
                              {rule}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : !isBlocked && !pendingBypass ? (
                    <div className="py-6 text-center text-xs text-muted-foreground space-y-1">
                      <p className="font-semibold text-slate-700">Your fee eligibility is satisfied!</p>
                      <p>The school administration is finalizing hall ticket generation for this examination.</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 3. MODAL: Student Request Bypass Dialog */}
      <Dialog open={bypassModalOpen} onOpenChange={setBypassModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
              <ShieldCheck className="text-amber-600" size={18} />
              Request Hall Ticket Bypass
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Submit an official exception request to the school administration / Principal for examination access.
            </DialogDescription>
          </DialogHeader>

          {selectedExamForBypass && (
            <div className="space-y-4 py-2 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Examination:</span>
                  <span className="font-bold text-slate-900">{selectedExamForBypass.schedule.examType}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Class & Term:</span>
                  <span className="font-semibold text-slate-800">
                    Grade {student.grade} · {selectedExamForBypass.schedule.termName || "Term 1"}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-200/80 pt-1.5 mt-1.5">
                  <span className="text-muted-foreground">Outstanding Dues:</span>
                  <span className="font-bold text-rose-700">
                    ₹{selectedExamForBypass.evalResult.feeDetails.outstanding.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bypass-reason" className="text-xs font-semibold text-slate-900">
                  Reason / Circumstance for Bypass Request *
                </Label>
                <Textarea
                  id="bypass-reason"
                  placeholder="Explain why you require a fee bypass for this exam (e.g., temporary financial difficulty, fee concession pending, payment committed by specific date)..."
                  rows={4}
                  className="text-xs resize-none"
                  value={bypassReason}
                  onChange={(e) => setBypassReason(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Your request and reason will be reviewed by the school administration and Principal.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBypassModalOpen(false)}
              disabled={submittingBypass}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitBypassRequest}
              disabled={submittingBypass}
              className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
            >
              {submittingBypass ? <Loader2 className="animate-spin" size={14} /> : <Send size={13} />}
              <span>Submit Request</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

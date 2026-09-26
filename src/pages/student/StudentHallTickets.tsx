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
  HallTicket,
  HallTicketBypass,
  HallTicketGlobalSettings,
  HallTicketRule,
  Student,
  Enrollment,
} from "@/lib/types";
import {
  getHallTicketGlobalSettings,
  listHallTicketRules,
  listHallTicketBypasses,
  evaluateStudentExamEligibility,
  getStudentHallTickets,
} from "@/lib/hallTicketEngine";
import { downloadHallTicketPdf } from "@/lib/generateHallTicketPdf";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";

export default function StudentHallTickets() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "2026-27";
  const effectiveSessionName = workingSession?.name || activeSession?.name || "2026-27";

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [feeStructure, setFeeStructure] = useState<FeeStructure | null>(null);
  const [feePayments, setFeePayments] = useState<FeePayment[]>([]);
  const [bypasses, setBypasses] = useState<HallTicketBypass[]>([]);
  const [rules, setRules] = useState<HallTicketRule[]>([]);
  const [globalSettings, setGlobalSettings] = useState<HallTicketGlobalSettings | null>(null);
  const [hallTickets, setHallTickets] = useState<HallTicket[]>([]);

  // 1. Fetch Student profile & active enrollment
  useEffect(() => {
    if (!appUser) return;
    let isMounted = true;
    setLoading(true);

    const loadData = async () => {
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
        if (isMounted) setStudent(sData);

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

        if (isMounted) setEnrollment(validEn);

        const targetGrade = validEn?.className || sData.grade;

        // Fetch approved schedules, fee structure, fee payments, bypasses, rules, generated hall tickets
        const [
          schedulesSnap,
          structuresSnap,
          paymentsSnap,
          bypassesList,
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
          listHallTicketBypasses({ studentId: sData.id, sessionId: effectiveSessionId }),
          listHallTicketRules(effectiveSessionId),
          getHallTicketGlobalSettings(),
          getStudentHallTickets(sData.id, sData.uid),
        ]);

        if (isMounted) {
          setSchedules(schedulesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamSchedule)));
          setFeeStructure(
            structuresSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeStructure))[0] || null
          );
          setFeePayments(paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeePayment)));
          setBypasses(bypassesList);
          setRules(rulesList);
          setGlobalSettings(settings);
          setHallTickets(ticketsList);
        }
      } catch (err) {
        console.error("Error loading student hall tickets:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void loadData();
    return () => {
      isMounted = false;
    };
  }, [appUser, effectiveSessionId, effectiveSessionName]);

  // Evaluate eligibility for each approved schedule
  const examCards = useMemo(() => {
    if (!student || !globalSettings) return [];

    return schedules.map((schedule) => {
      const examRule = rules.find((r) => r.definedExamId === schedule.definedExamId) || null;
      const approvedBypass =
        bypasses.find(
          (b) => b.definedExamId === schedule.definedExamId && b.status === "approved"
        ) || null;
      const existingTicket =
        hallTickets.find((t) => t.scheduleId === schedule.id && t.status !== "revoked") || null;

      const evalResult = evaluateStudentExamEligibility({
        student,
        enrollment,
        schedule,
        feeStructure,
        studentPayments: feePayments,
        globalSettings,
        examRule,
        approvedBypass,
        existingHallTicket: existingTicket,
      });

      return {
        schedule,
        evalResult,
        ticket: existingTicket,
      };
    });
  }, [student, enrollment, schedules, feeStructure, feePayments, bypasses, rules, globalSettings, hallTickets]);

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
          {examCards.map(({ schedule, evalResult, ticket }) => {
            const isTicketReady = !!ticket && ticket.status === "generated";
            const isBlocked = evalResult.status === "blocked";

            return (
              <Card
                key={schedule.id}
                className={`border overflow-hidden shadow-xs transition-all ${
                  isTicketReady
                    ? "border-emerald-200 bg-white"
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
                          : isBlocked
                          ? "bg-rose-600 text-white"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {isTicketReady ? (
                        <CheckCircle2 size={22} />
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
                      <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold text-xs gap-1 px-2.5 py-1">
                        <ShieldCheck size={14} className="text-amber-700" />
                        Bypass Approved (Generating...)
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
                  {/* Status Banner when Blocked */}
                  {isBlocked && (
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
                            Rs {evalResult.feeDetails.outstanding.toLocaleString("en-IN")}
                          </span>
                        </div>

                        <Link href="/student/fees">
                          <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white h-8 text-xs font-semibold gap-1.5">
                            <CreditCard size={14} />
                            <span>Pay Dues Online Now</span>
                          </Button>
                        </Link>
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
                          onClick={() => downloadHallTicketPdf(ticket)}
                        >
                          <Download size={15} />
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
                  ) : !isBlocked ? (
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
    </div>
  );
}

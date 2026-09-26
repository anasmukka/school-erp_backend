import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  addDoc,
} from "firebase/firestore";
import type { ExamSchedule, ExamScheduleStatus } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  Loader2,
  XCircle,
  AlertCircle,
  Filter,
  Check,
  X,
  ShieldCheck,
} from "lucide-react";
import jsPDF from "jspdf";

export default function ExamApprovals() {
  const { appUser } = useAuth();
  const { sessions, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Filters
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");

  // Review modal state
  const [reviewSchedule, setReviewSchedule] = useState<ExamSchedule | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [autoPostNotice, setAutoPostNotice] = useState(true);
  const [reviewError, setReviewError] = useState("");

  // Load schedules in real-time
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, "examSchedules"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamSchedule));
        list.sort((a, b) => (b.submittedAt || b.createdAt || "").localeCompare(a.submittedAt || a.createdAt || ""));
        setSchedules(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading exam schedules:", err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  // Filtered schedules
  const filteredSchedules = useMemo(() => {
    return schedules.filter((s) => {
      if (sessionFilter !== "all" && s.academicYear !== sessionFilter && s.sessionId !== sessionFilter) {
        return false;
      }
      if (statusFilter !== "all" && s.status !== statusFilter) {
        return false;
      }
      if (gradeFilter !== "all" && s.grade !== gradeFilter) {
        return false;
      }
      return true;
    });
  }, [schedules, sessionFilter, statusFilter, gradeFilter]);

  // Metric counts
  const metrics = useMemo(() => {
    const total = schedules.length;
    const pending = schedules.filter((s) => s.status === "pending_approval").length;
    const approved = schedules.filter((s) => s.status === "approved").length;
    const rejected = schedules.filter((s) => s.status === "rejected").length;
    return { total, pending, approved, rejected };
  }, [schedules]);

  const handleOpenReview = (sched: ExamSchedule) => {
    setReviewSchedule(sched);
    setReviewRemarks(sched.reviewRemarks || "");
    setAutoPostNotice(true);
    setReviewError("");
  };

  const handleApprove = async () => {
    if (!reviewSchedule) return;
    setReviewError("");
    setActionLoading(true);

    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "examSchedules", reviewSchedule.id), {
        status: "approved",
        reviewedBy: appUser?.id || "admin",
        reviewedByName: appUser?.name || "Principal",
        reviewedAt: now,
        reviewRemarks: reviewRemarks.trim() || "Approved by Principal",
        updatedAt: now,
      });

      // Optionally post an announcement notice to the grade
      if (autoPostNotice) {
        const sorted = [...reviewSchedule.exams].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
        const datesText = sorted
          .map((e) => `• ${e.subjectName}: ${new Date(e.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} (${e.startTime || "09:30"} - ${e.endTime || "12:30"})`)
          .join("\n");

        await addDoc(collection(db, "notices"), {
          type: "exam_schedule",
          title: `Examination Timetable: ${reviewSchedule.examType} (Grade ${reviewSchedule.grade})`,
          message: `The official examination schedule for ${reviewSchedule.examType} has been approved by the Principal.\n\nTimetable:\n${datesText}\n\nPlease prepare accordingly and check the full schedule in your exam section.`,
          grade: reviewSchedule.grade,
          targetAudience: "all",
          priority: "important",
          authorId: appUser?.id || "admin",
          authorName: appUser?.name || "Principal",
          authorRole: "admin",
          createdAt: now,
          academicSession: reviewSchedule.academicYear || reviewSchedule.sessionId,
        });
      }

      toast({
        title: "Exam Schedule Approved",
        description: `Grade ${reviewSchedule.grade} ${reviewSchedule.examType} schedule has been formally approved.`,
      });
      setReviewSchedule(null);
    } catch (err: any) {
      console.error("Failed to approve schedule:", err);
      setReviewError(err?.message || "Failed to approve schedule.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!reviewSchedule) return;
    if (!reviewRemarks.trim()) {
      setReviewError("Please provide remarks explaining what changes the HOD must make.");
      return;
    }

    setReviewError("");
    setActionLoading(true);

    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "examSchedules", reviewSchedule.id), {
        status: "rejected",
        reviewedBy: appUser?.id || "admin",
        reviewedByName: appUser?.name || "Principal",
        reviewedAt: now,
        reviewRemarks: reviewRemarks.trim(),
        updatedAt: now,
      });

      toast({
        title: "Changes Requested",
        description: "Schedule rejected with feedback sent back to the Section Head.",
      });
      setReviewSchedule(null);
    } catch (err: any) {
      console.error("Failed to reject schedule:", err);
      setReviewError(err?.message || "Failed to reject schedule.");
    } finally {
      setActionLoading(false);
    }
  };

  // PDF Download
  const handleDownloadPDF = (sched: ExamSchedule) => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const sorted = [...sched.exams].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Header
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(20);
    pdf.setTextColor(30, 41, 59);
    pdf.text("OFFICIAL EXAMINATION TIMETABLE", 105, 22, { align: "center" });

    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Academic Session: ${sched.academicYear || sched.sessionId}`, 105, 29, { align: "center" });

    // Meta Box
    pdf.setDrawColor(226, 232, 240);
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(15, 36, 180, 22, 3, 3, "FD");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(51, 65, 85);
    pdf.text(`Exam Name: ${sched.examType}`, 22, 44);
    pdf.text(`Grade / Class: Grade ${sched.grade}`, 22, 52);

    pdf.text(`Section Head: ${sched.hodName || "HOD"}`, 115, 44);
    pdf.text(`Approval Status: ${sched.status.toUpperCase().replace("_", " ")}`, 115, 52);

    // Table Header
    let y = 68;
    pdf.setFillColor(79, 70, 229);
    pdf.rect(15, y, 180, 10, "F");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(255, 255, 255);
    pdf.text("DATE", 20, y + 6.5);
    pdf.text("DAY", 52, y + 6.5);
    pdf.text("TIME", 80, y + 6.5);
    pdf.text("SUBJECT", 120, y + 6.5);
    pdf.text("MAX MARKS", 168, y + 6.5);

    // Table Rows
    y += 10;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);

    sorted.forEach((item, index) => {
      const d = new Date(item.date);
      const dateStr = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const dayStr = d.toLocaleDateString("en-IN", { weekday: "short" });
      const timeStr = item.startTime && item.endTime ? `${item.startTime} - ${item.endTime}` : "—";

      if (index % 2 === 0) {
        pdf.setFillColor(248, 250, 252);
        pdf.rect(15, y, 180, 9, "F");
      }
      pdf.setDrawColor(241, 245, 249);
      pdf.line(15, y + 9, 195, y + 9);

      pdf.setTextColor(30, 41, 59);
      pdf.text(dateStr, 20, y + 6);
      pdf.text(dayStr, 52, y + 6);
      pdf.text(timeStr, 80, y + 6);
      pdf.setFont("helvetica", "bold");
      pdf.text(item.subjectName, 120, y + 6);
      pdf.setFont("helvetica", "normal");
      pdf.text(String(item.maxMarks || 100), 175, y + 6);

      y += 9;
    });

    // Instructions
    y += 15;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(30, 41, 59);
    pdf.text("Important Examination Guidelines:", 15, y);

    y += 6;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text("1. Students must occupy their examination seats 15 minutes prior to start time.", 15, y);
    pdf.text("2. Students without valid School ID cards will not be permitted in the examination hall.", 15, y + 5);
    pdf.text("3. Electronic devices, smartwatches, or cheat sheets are strictly forbidden.", 15, y + 10);

    // Signatures
    y += 35;
    pdf.setDrawColor(148, 163, 184);
    pdf.line(25, y, 75, y);
    pdf.line(135, y, 185, y);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(51, 65, 85);
    pdf.text("Section Head (HOD)", 50, y + 6, { align: "center" });
    pdf.text("Principal / Controller of Exams", 160, y + 6, { align: "center" });

    pdf.save(`${sched.examType}_Grade_${sched.grade}_Approved_Timetable.pdf`);
    toast({ title: "Timetable Downloaded", description: "PDF schedule downloaded successfully." });
  };

  const getStatusBadge = (status: ExamScheduleStatus) => {
    switch (status) {
      case "approved":
        return (
          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 font-medium">
            <CheckCircle2 size={12} /> Approved
          </Badge>
        );
      case "pending_approval":
        return (
          <Badge className="bg-amber-500 hover:bg-amber-600 text-white gap-1 font-medium animate-pulse">
            <Clock size={12} /> Awaiting Approval
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-rose-600 hover:bg-rose-700 text-white gap-1 font-medium">
            <XCircle size={12} /> Changes Requested
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700 gap-1 font-medium">
            Draft
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Exam Approvals
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Principal & Administration portal to review, approve, or request changes to exam timetables submitted by Section Heads.
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500">Pending Review</p>
              <p className="text-2xl font-bold text-amber-600 mt-0.5">{metrics.pending}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
              <Clock size={20} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500">Approved</p>
              <p className="text-2xl font-bold text-emerald-600 mt-0.5">{metrics.approved}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
              <CheckCircle2 size={20} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500">Changes Requested</p>
              <p className="text-2xl font-bold text-rose-600 mt-0.5">{metrics.rejected}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
              <XCircle size={20} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500">Total Schedules</p>
              <p className="text-2xl font-bold text-slate-800 mt-0.5">{metrics.total}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
              <CalendarDays size={20} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="border-slate-200 shadow-xs">
        <CardContent className="p-3.5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mr-2">
            <Filter size={14} /> Filters:
          </div>

          <div className="w-40">
            <Select value={sessionFilter} onValueChange={setSessionFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Session" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Sessions</SelectItem>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={s.name} className="text-xs">{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-44">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
                <SelectItem value="pending_approval" className="text-xs">Pending Approval</SelectItem>
                <SelectItem value="approved" className="text-xs">Approved</SelectItem>
                <SelectItem value="rejected" className="text-xs">Changes Requested</SelectItem>
                <SelectItem value="draft" className="text-xs">Draft</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-32">
            <Select value={gradeFilter} onValueChange={setGradeFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Grade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Grades</SelectItem>
                {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((g) => (
                  <SelectItem key={g} value={g} className="text-xs">Grade {g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(sessionFilter !== "all" || statusFilter !== "all" || gradeFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-slate-500 hover:text-slate-800"
              onClick={() => {
                setSessionFilter("all");
                setStatusFilter("all");
                setGradeFilter("all");
              }}
            >
              Reset Filters
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Schedules List */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      ) : filteredSchedules.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-16 text-center space-y-2">
            <CalendarDays className="mx-auto h-10 w-10 text-slate-300" />
            <h3 className="text-base font-semibold text-slate-800">No Exam Schedules Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No exam schedules match the selected filters. Check back when Section Heads submit timetables.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSchedules.map((sched) => {
            const sortedExams = [...sched.exams].sort(
              (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
            );
            const firstDate = sortedExams[0]?.date;
            const lastDate = sortedExams[sortedExams.length - 1]?.date;
            const isPending = sched.status === "pending_approval";

            return (
              <Card
                key={sched.id}
                className={`flex flex-col justify-between transition-all duration-200 border ${
                  isPending
                    ? "border-amber-300 ring-1 ring-amber-200 bg-amber-50/20 shadow-sm"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg font-bold text-slate-900">
                        {sched.examType}
                      </CardTitle>
                      <CardDescription className="text-xs font-medium text-slate-500 mt-0.5">
                        Grade {sched.grade} • Session {sched.academicYear || sched.sessionId}
                      </CardDescription>
                    </div>
                    <div>{getStatusBadge(sched.status)}</div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 text-xs flex-1">
                  <div className="bg-slate-50 p-2.5 rounded-lg space-y-1.5 text-slate-600">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Section Head:</span>
                      <span className="font-semibold text-slate-800">{sched.hodName || "HOD"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Subjects:</span>
                      <span className="font-semibold text-slate-800">{sched.exams.length} subjects</span>
                    </div>
                    {firstDate && lastDate && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Dates:</span>
                        <span className="font-medium text-slate-700">
                          {new Date(firstDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} –{" "}
                          {new Date(lastDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </div>
                    )}
                  </div>

                  {sched.reviewRemarks && (
                    <div
                      className={`p-2.5 rounded-lg border text-xs ${
                        sched.status === "rejected"
                          ? "bg-rose-50 border-rose-200 text-rose-800"
                          : "bg-blue-50 border-blue-200 text-blue-800"
                      }`}
                    >
                      <div className="font-semibold mb-0.5">Feedback / Remarks:</div>
                      <p className="leading-relaxed">{sched.reviewRemarks}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                    <Button
                      size="sm"
                      className={`flex-1 gap-1.5 text-xs h-8 ${
                        isPending
                          ? "bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs"
                          : "bg-slate-900 hover:bg-slate-800 text-white"
                      }`}
                      onClick={() => handleOpenReview(sched)}
                    >
                      <Eye size={13} /> {isPending ? "Review & Decide" : "View Timetable"}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs h-8 text-slate-600"
                      onClick={() => handleDownloadPDF(sched)}
                      title="Download Official Timetable PDF"
                    >
                      <Download size={13} /> PDF
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Review & Decision Modal */}
      {reviewSchedule && (
        <Dialog open={!!reviewSchedule} onOpenChange={() => setReviewSchedule(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
            <DialogHeader className="p-6 pb-4 border-b border-slate-100">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <DialogTitle className="text-xl font-bold text-slate-900">
                    Principal Review: {reviewSchedule.examType}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500 mt-0.5">
                    Grade {reviewSchedule.grade} • Submitted by {reviewSchedule.hodName || "HOD"} • Session {reviewSchedule.academicYear || reviewSchedule.sessionId}
                  </DialogDescription>
                </div>
                <div>{getStatusBadge(reviewSchedule.status)}</div>
              </div>
            </DialogHeader>

            <div className="p-6 space-y-4 flex-1 overflow-y-auto text-xs">
              {reviewError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg font-medium flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0" />
                  {reviewError}
                </div>
              )}

              {/* Timetable Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-100/70 px-3 py-2 border-b border-slate-200 font-semibold text-slate-800">
                  Proposed Examination Timetable ({reviewSchedule.exams.length} Subjects)
                </div>
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Day</th>
                      <th className="py-2.5 px-3">Timing</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3 text-right">Max Marks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...reviewSchedule.exams]
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                      .map((ex) => {
                        const d = new Date(ex.date);
                        return (
                          <tr key={ex.subjectId} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 font-medium text-slate-800">
                              {d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500">
                              {d.toLocaleDateString("en-IN", { weekday: "short" })}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {ex.startTime && ex.endTime ? `${ex.startTime} – ${ex.endTime}` : "—"}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-900">
                              {ex.subjectName}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700">
                              {ex.maxMarks || 100}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {/* Review Remarks Field */}
              <div className="space-y-1.5 pt-1">
                <Label className="font-semibold text-slate-800">
                  Principal Review Remarks / Feedback
                </Label>
                <Textarea
                  placeholder="Enter approval comments or specify requested changes for the Section Head..."
                  className="text-xs resize-none h-20"
                  value={reviewRemarks}
                  onChange={(e) => setReviewRemarks(e.target.value)}
                />
                <p className="text-[11px] text-slate-400">
                  Remarks are required if requesting changes so the Section Head understands what adjustments are needed.
                </p>
              </div>

              {/* Auto publish notice checkbox */}
              <div className="flex items-center space-x-2 pt-1 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <Checkbox
                  id="auto-notice"
                  checked={autoPostNotice}
                  onCheckedChange={(c) => setAutoPostNotice(Boolean(c))}
                />
                <label
                  htmlFor="auto-notice"
                  className="text-xs font-medium text-slate-700 leading-none cursor-pointer"
                >
                  Automatically broadcast timetable notice to Grade {reviewSchedule.grade} students and teachers upon approval
                </label>
              </div>
            </div>

            <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-2 justify-between items-center">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleDownloadPDF(reviewSchedule)}
              >
                <Download size={14} /> Download PDF
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReviewSchedule(null)}
                  disabled={actionLoading}
                >
                  Cancel
                </Button>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleReject}
                  disabled={actionLoading}
                  className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
                >
                  {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  Request Changes
                </Button>

                <Button
                  size="sm"
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Approve Schedule
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, onSnapshot } from "firebase/firestore";
import type { Student, ExamSchedule, Enrollment } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  GraduationCap,
  AlertCircle,
  HelpCircle,
  MapPin,
} from "lucide-react";
import jsPDF from "jspdf";

export default function StudentExams() {
  const { appUser } = useAuth();
  const { activeSession, workingSession } = useAcademicSession();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [activeEnrollment, setActiveEnrollment] = useState<Enrollment | null>(null);
  const [schedules, setSchedules] = useState<ExamSchedule[]>([]);

  // 1. Fetch Student profile & active enrollment
  useEffect(() => {
    if (!appUser) return;
    let isMounted = true;
    setLoading(true);

    const fetchStudent = async () => {
      try {
        let studentSnap = await getDocs(
          query(collection(db, "students"), where("uid", "==", appUser.id)),
        );
        if (studentSnap.empty && appUser.email) {
          studentSnap = await getDocs(
            query(collection(db, "students"), where("email", "==", appUser.email)),
          );
        }

        if (!studentSnap.empty) {
          const sDoc = studentSnap.docs[0];
          const sData = { id: sDoc.id, ...sDoc.data() } as Student;
          if (isMounted) setStudent(sData);

          // Get active enrollment
          const currentYear = workingSession?.name || activeSession?.name;
          const [enSnapYear, enSnapUid] = await Promise.all([
            currentYear
              ? getDocs(
                  query(
                    collection(db, "enrollments"),
                    where("studentId", "==", sData.id),
                    where("academicYear", "==", currentYear),
                  ),
                )
              : Promise.resolve(null),
            getDocs(
              query(
                collection(db, "enrollments"),
                where("studentId", "==", sData.id),
                where("status", "==", "active"),
              ),
            ),
          ]);

          const validEn =
            enSnapYear && !enSnapYear.empty
              ? (enSnapYear.docs[0].data() as Enrollment)
              : enSnapUid && !enSnapUid.empty
                ? (enSnapUid.docs[0].data() as Enrollment)
                : null;

          if (isMounted) setActiveEnrollment(validEn);
        }
      } catch (err) {
        console.error("Error fetching student profile:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void fetchStudent();
    return () => {
      isMounted = false;
    };
  }, [appUser, workingSession?.name, activeSession?.name]);

  // 2. Fetch Approved Exam Schedules for student's grade
  const resolvedGrade = activeEnrollment?.className || student?.grade || "";

  useEffect(() => {
    if (!resolvedGrade) return;

    const q = query(
      collection(db, "examSchedules"),
      where("grade", "==", resolvedGrade),
      where("status", "==", "approved"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamSchedule));
        list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setSchedules(list);
      },
      (err) => {
        console.error("Error loading approved exam schedules:", err);
      },
    );

    return unsubscribe;
  }, [resolvedGrade]);

  // Download PDF Timetable
  const handleDownloadPDF = (sched: ExamSchedule) => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const sorted = [...sched.exams].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Title
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(20);
    pdf.setTextColor(30, 41, 59);
    pdf.text("EXAMINATION TIMETABLE", 105, 22, { align: "center" });

    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(100, 116, 139);
    pdf.text(
      `Academic Session: ${sched.academicYear || sched.sessionId}`,
      105,
      29,
      { align: "center" },
    );

    // Student Info Box
    pdf.setDrawColor(226, 232, 240);
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(15, 36, 180, 24, 3, 3, "FD");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(51, 65, 85);
    pdf.text(`Student: ${student?.name || appUser?.name || "Student"}`, 22, 44);
    pdf.text(
      `Grade: Grade ${sched.grade}${activeEnrollment?.sectionName ? ` – Section ${activeEnrollment.sectionName}` : ""}`,
      22,
      52,
    );

    pdf.text(
      `Roll No: ${activeEnrollment?.rollNo || student?.rollNo || "—"}`,
      120,
      44,
    );
    pdf.text(
      `Exam: ${sched.examType}${sched.termName ? ` (${sched.termName})` : ""}`,
      120,
      52,
    );

    // Table Header
    let y = 70;
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
      const timeStr =
        item.startTime && item.endTime ? `${item.startTime} - ${item.endTime}` : "—";

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

    // Important Guidelines
    y += 14;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(30, 41, 59);
    pdf.text("Examination Guidelines for Students:", 15, y);

    y += 6;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(
      "1. Reporting Time: Arrive at the examination hall at least 15 minutes before exam start time.",
      15,
      y,
    );
    pdf.text(
      "2. Identity Card: Students must carry their School ID Card into the examination room.",
      15,
      y + 5,
    );
    pdf.text(
      "3. Prohibited Items: Mobile phones, digital watches, calculators, or unauthorized papers are prohibited.",
      15,
      y + 10,
    );

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

    pdf.save(`${sched.examType}_Timetable.pdf`);
    toast({
      title: "Timetable Downloaded",
      description: "Official PDF timetable downloaded successfully.",
    });
  };

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            Examination Timetable
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Official examination schedules and timetables approved by the Principal.
          </p>
        </div>

        {/* Student metadata pill */}
        <div className="flex items-center gap-2 self-start sm:self-auto bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg text-xs">
          <GraduationCap size={15} className="text-primary shrink-0" />
          <span className="font-semibold text-slate-800">
            Grade {resolvedGrade || "—"}
            {activeEnrollment?.sectionName && ` (${activeEnrollment.sectionName})`}
          </span>
          <span className="text-slate-300">•</span>
          <span className="text-slate-600">
            Roll No:{" "}
            <strong className="text-slate-900">
              {activeEnrollment?.rollNo || student?.rollNo || "—"}
            </strong>
          </span>
        </div>
      </div>

      {/* Examination Schedules */}
      {schedules.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-16 text-center space-y-3">
            <CalendarDays className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="text-base font-semibold text-slate-800">No Approved Examinations Yet</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              There are no examinations scheduled and approved for Grade {resolvedGrade || "your class"} at the moment.
              Once your timetable is approved by the Principal, it will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {schedules.map((sched) => {
            const sortedExams = [...sched.exams].sort(
              (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
            );
            const firstDate = sortedExams[0]?.date;
            const lastDate = sortedExams[sortedExams.length - 1]?.date;

            return (
              <Card
                key={sched.id}
                className="border-slate-200 shadow-sm overflow-hidden bg-white"
              >
                <CardHeader className="bg-gradient-to-r from-slate-50 to-indigo-50/30 border-b border-slate-100 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-xl font-bold text-slate-900">
                          {sched.examType}
                        </CardTitle>
                        {sched.termName && (
                          <Badge variant="outline" className="border-indigo-200 text-indigo-700 bg-indigo-50/50">
                            {sched.termName}
                          </Badge>
                        )}
                        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs font-semibold shadow-xs">
                          <CheckCircle2 size={12} /> Approved by Principal
                        </Badge>
                      </div>
                      <CardDescription className="text-xs text-slate-500 mt-1">
                        Academic Session: <strong>{sched.academicYear || sched.sessionId}</strong>
                        {firstDate && lastDate && (
                          <span className="ml-2">
                            • Schedule:{" "}
                            {new Date(firstDate).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}{" "}
                            –{" "}
                            {new Date(lastDate).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        )}
                      </CardDescription>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs shadow-xs border-slate-300 self-start sm:self-auto bg-white hover:bg-slate-50"
                      onClick={() => handleDownloadPDF(sched)}
                    >
                      <Download size={14} className="text-primary" />
                      <span>Download Official PDF</span>
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50/80 text-slate-700 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-4">Day</th>
                          <th className="py-3 px-4">Timing</th>
                          <th className="py-3 px-4">Subject</th>
                          <th className="py-3 px-4 text-center">Max Marks</th>
                          <th className="py-3 px-4 text-center">Pass Marks</th>
                          <th className="py-3 px-4">Room / Venue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedExams.map((ex, index) => {
                          const d = new Date(ex.date);
                          const isToday =
                            d.toDateString() === new Date().toDateString();

                          return (
                            <tr
                              key={ex.subjectId}
                              className={`transition-colors ${
                                isToday
                                  ? "bg-amber-50/60 font-medium"
                                  : index % 2 === 0
                                    ? "bg-white"
                                    : "bg-slate-50/30"
                              } hover:bg-slate-50`}
                            >
                              <td className="py-3 px-4 font-semibold text-slate-800 whitespace-nowrap">
                                {d.toLocaleDateString("en-IN", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                                {isToday && (
                                  <Badge className="ml-2 bg-amber-500 text-white text-[10px] py-0 px-1.5">
                                    Today
                                  </Badge>
                                )}
                              </td>
                              <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                                {d.toLocaleDateString("en-IN", { weekday: "long" })}
                              </td>
                              <td className="py-3 px-4 text-slate-700 whitespace-nowrap font-medium">
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={12} className="text-slate-400" />
                                  {ex.startTime && ex.endTime
                                    ? `${ex.startTime} – ${ex.endTime}`
                                    : "09:30 – 12:30"}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-bold text-slate-900 text-sm">
                                {ex.subjectName}
                              </td>
                              <td className="py-3 px-4 text-center text-slate-700 font-semibold">
                                {ex.maxMarks || 100}
                              </td>
                              <td className="py-3 px-4 text-center text-slate-500">
                                {ex.passingMarks || 35}
                              </td>
                              <td className="py-3 px-4 text-slate-600">
                                {ex.venue ? (
                                  <span className="inline-flex items-center gap-1 text-slate-700">
                                    <MapPin size={12} className="text-slate-400" />
                                    {ex.venue}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 italic">Exam Hall</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Guidelines Box */}
      <Card className="bg-slate-50/70 border-slate-200">
        <CardContent className="p-4 space-y-2 text-xs">
          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
            <AlertCircle size={15} className="text-primary" />
            General Student Examination Instructions
          </div>
          <ul className="list-disc list-inside space-y-1 text-slate-600 pl-1">
            <li>Ensure you carry your student ID card to every examination.</li>
            <li>Be seated in the examination hall at least 15 minutes before the scheduled start time.</li>
            <li>Write your name, grade, and alphabetical roll number accurately on answer scripts.</li>
            <li>Electronic gadgets, smart watches, and mobile phones are strictly prohibited.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

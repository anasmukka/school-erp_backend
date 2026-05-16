import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ReportCard, Student } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, Award, Download, Clock } from "lucide-react";
import { generateReportCardPdf } from "@/lib/generateReportCardPdf";
import { useToast } from "@/hooks/use-toast";

function gradeBg(letter: string) {
  if (letter === "A+" || letter === "A") return "bg-green-100 text-green-700";
  if (letter === "B+" || letter === "B") return "bg-blue-100 text-blue-700";
  if (letter === "C") return "bg-yellow-100 text-yellow-700";
  if (letter === "D") return "bg-orange-100 text-orange-700";
  return "bg-red-100 text-red-700";
}

function cbseGrade(marks: number): string {
  if (marks >= 91) return "A1"; if (marks >= 81) return "A2";
  if (marks >= 71) return "B1"; if (marks >= 61) return "B2";
  if (marks >= 51) return "C1"; if (marks >= 41) return "C2";
  if (marks >= 33) return "D";  return "E";
}

const SUBJECT_GRADE_COLOR: Record<string, string> = {
  A1: "text-green-700 bg-green-100", A2: "text-green-600 bg-green-50",
  B1: "text-blue-700 bg-blue-100",   B2: "text-blue-600 bg-blue-50",
  C1: "text-yellow-700 bg-yellow-100", C2: "text-yellow-600 bg-yellow-50",
  D: "text-orange-700 bg-orange-100", E: "text-red-700 bg-red-100",
};

export default function StudentReportCard() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [reportCards, setReportCards] = useState<ReportCard[]>([]);
  const [student, setStudent] = useState<Student | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const downloadPdf = async (rc: ReportCard) => {
    setDownloading(rc.id);
    try { await generateReportCardPdf(rc); }
    catch (err: any) { toast({ title: "PDF Error", description: err.message, variant: "destructive" }); }
    finally { setDownloading(null); }
  };

  useEffect(() => {
    if (!appUser) return;
    const load = async () => {
      try {
        let studentSnap = await getDocs(query(collection(db, "students"), where("uid", "==", appUser.id)));
        if (studentSnap.empty && appUser.email)
          studentSnap = await getDocs(query(collection(db, "students"), where("email", "==", appUser.email)));
        if (studentSnap.empty) return;
        const studentDoc = { id: studentSnap.docs[0].id, ...studentSnap.docs[0].data() } as Student;
        setStudent(studentDoc);
        const rcSnap = await getDocs(query(
          collection(db, "reportCards"),
          where("studentId", "==", studentDoc.id),
          where("status", "==", "published"),
        ));
        const cards = rcSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ReportCard));
        cards.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
        setReportCards(cards);
      } finally { setLoading(false); }
    };
    load();
  }, [appUser]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-muted-foreground" size={32} /></div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">My Report Card</h1>
        <p className="text-muted-foreground text-sm">{student ? `Grade ${student.grade}` : "Annual report card"} · Final Exam</p>
      </div>

      {reportCards.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center text-muted-foreground">
            <Clock size={40} className="mx-auto mb-4 opacity-30" />
            <p className="font-semibold text-lg">Results not yet published</p>
            <p className="text-sm mt-1">Your report card will appear here once the HOD publishes the results.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {reportCards.map((rc) => (
            <Card key={rc.id} className="overflow-hidden">
              <div className="bg-primary px-6 py-4">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <p className="text-primary-foreground font-bold text-lg">{rc.studentName}</p>
                    <p className="text-primary-foreground/80 text-sm">Grade {rc.grade} · Section {rc.sectionName} · {rc.examType}</p>
                  </div>
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-2xl ${gradeBg(rc.gradeLetter)} bg-opacity-90`}>
                    <Award size={20} /> {rc.gradeLetter}
                  </div>
                </div>
              </div>

              <CardContent className="pt-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-5">
                  {rc.subjectMarks.map((sm) => {
                    const lower = sm.gradeLevel !== undefined ? sm.gradeLevel >= 1 && sm.gradeLevel <= 5 : (parseInt(rc.grade, 10) >= 1 && parseInt(rc.grade, 10) <= 5);
                    const maxOut = lower ? 100 : 90;
                    const displayGrade = sm.grade ?? cbseGrade(lower ? sm.marks : Math.round((sm.marks / 90) * 100));
                    const gColor = SUBJECT_GRADE_COLOR[displayGrade] ?? "text-muted-foreground bg-muted";
                    const hasBreakdown = sm.perTest !== undefined || sm.examMarks !== undefined;
                    return (
                      <div key={sm.subjectId} className="bg-muted rounded-xl px-3 py-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1 truncate font-medium">{sm.subjectName}</p>
                        <p className="text-2xl font-bold">{sm.marks}</p>
                        <p className="text-xs text-muted-foreground mb-1.5">/ {maxOut}</p>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${gColor}`}>{displayGrade}</span>
                        {hasBreakdown && (
                          <div className="mt-2 text-left space-y-0.5">
                            {sm.perTest !== undefined && <p className="text-[10px] text-muted-foreground flex justify-between"><span>Per Test</span><span className="font-medium">{sm.perTest}/{lower ? 40 : 10}</span></p>}
                            {lower && sm.notebook !== undefined && <p className="text-[10px] text-muted-foreground flex justify-between"><span>Notebook</span><span className="font-medium">{sm.notebook}/10</span></p>}
                            {lower && sm.enrichment !== undefined && <p className="text-[10px] text-muted-foreground flex justify-between"><span>Enrichment</span><span className="font-medium">{sm.enrichment}/10</span></p>}
                            {sm.examMarks !== undefined && <p className="text-[10px] text-muted-foreground flex justify-between"><span>Exam</span><span className="font-medium">{sm.examMarks}/{lower ? 40 : 80}</span></p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-border pt-4">
                  <div className="flex flex-wrap gap-6">
                    <div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{rc.total}<span className="text-sm font-normal text-muted-foreground">/{rc.outOf}</span></p></div>
                    <div><p className="text-xs text-muted-foreground">Percentage</p><p className="text-xl font-bold">{rc.percentage}%</p></div>
                    <div><p className="text-xs text-muted-foreground">Grade</p><p className={`text-xl font-bold px-2 rounded ${gradeBg(rc.gradeLetter)}`}>{rc.gradeLetter}</p></div>
                    <div className="ml-auto text-right">
                      <p className="text-xs text-muted-foreground">Published on</p>
                      <p className="text-sm font-medium">{rc.releasedAt ? new Date(rc.releasedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—"}</p>
                    </div>
                  </div>
                </div>

                {/* Signatures */}
                {(rc.classTeacherSign || rc.hodSign || rc.adminSign) && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-xs text-muted-foreground font-medium mb-2">Verified by</p>
                    <div className="flex flex-wrap gap-4">
                      {rc.classTeacherSign && (
                        <div className="text-xs"><p className="font-semibold text-green-700">✓ Class Teacher</p><p className="text-muted-foreground">{rc.classTeacherSign.name}</p></div>
                      )}
                      {rc.hodSign && (
                        <div className="text-xs"><p className="font-semibold text-green-700">✓ HOD</p><p className="text-muted-foreground">{rc.hodSign.name}</p></div>
                      )}
                      {rc.adminSign && (
                        <div className="text-xs"><p className="font-semibold text-green-700">✓ Principal</p><p className="text-muted-foreground">{rc.adminSign.name}</p></div>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => downloadPdf(rc)} disabled={downloading === rc.id} className="gap-1.5">
                    {downloading === rc.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    Download PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

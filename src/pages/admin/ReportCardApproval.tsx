import { useEffect, useState } from "react";
import { collection, query, where, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ReportCard } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Loader2, FileText, Download, ChevronDown, ChevronUp, ShieldCheck, Clock } from "lucide-react";
import { generateReportCardPdf } from "@/lib/generateReportCardPdf";
import { useAuth } from "@/contexts/AuthContext";

export default function AdminReportCardApproval() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [reportCards, setReportCards] = useState<ReportCard[]>([]);
  const [signing, setSigning] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const rcSnap = await getDocs(
          query(collection(db, "reportCards"), where("status", "==", "hod_signed"))
        );
        const cards = rcSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ReportCard));
        cards.sort((a, b) => a.studentName.localeCompare(b.studentName));
        setReportCards(cards);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const signCard = async (rc: ReportCard) => {
    if (!appUser) return;
    setSigning(rc.id);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "reportCards", rc.id), {
        status: "principal_signed",
        adminSign: { userId: appUser.id, name: appUser.name, signedAt: now },
        adminApprovedAt: now,
      });
      setReportCards((prev) => prev.filter((c) => c.id !== rc.id));
      toast({ title: "Signed", description: `${rc.studentName}'s card signed. HOD can now publish results.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSigning(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-muted-foreground" size={32} /></div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Principal Sign-off</h1>
        <p className="text-muted-foreground text-sm">
          Sign report cards that have been approved by the HOD. After signing, the HOD can publish results for students.
        </p>
      </div>

      {reportCards.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <CheckCircle size={36} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nothing pending your signature</p>
            <p className="text-sm mt-1">Report cards forwarded by the HOD will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground font-medium">
            {reportCards.length} report card{reportCards.length !== 1 ? "s" : ""} awaiting your signature
          </p>
          {reportCards.map((rc) => (
            <AdminRCRow
              key={rc.id}
              rc={rc}
              onSign={() => signCard(rc)}
              loading={signing === rc.id}
              toast={toast}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AdminRCRow({ rc, onSign, loading, toast }: {
  rc: ReportCard; onSign: () => void; loading: boolean; toast: any;
}) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const downloadPdf = async () => {
    setDownloading(true);
    try { await generateReportCardPdf(rc); }
    catch (err: any) { toast({ title: "PDF Error", description: err.message, variant: "destructive" }); }
    finally { setDownloading(false); }
  };

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold">{rc.studentName}</p>
              <p className="text-xs text-muted-foreground">Grade {rc.grade} · Section {rc.sectionName} · {rc.examType}</p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                  <Clock size={11} /> HOD Signed
                </span>
                <span className="text-xs font-semibold text-primary">{rc.percentage}% — {rc.gradeLetter}</span>
              </div>
              <div className="flex flex-col gap-0.5 mt-1">
                {rc.classTeacherSign && (
                  <p className="text-[11px] text-green-700">✓ Class Teacher: {rc.classTeacherSign.name} · {new Date(rc.classTeacherSign.signedAt).toLocaleDateString("en-IN")}</p>
                )}
                {rc.hodSign && (
                  <p className="text-[11px] text-green-700">✓ HOD: {rc.hodSign.name} · {new Date(rc.hodSign.signedAt).toLocaleDateString("en-IN")}</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setExpanded((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              {expanded ? "Hide" : "View marks"}
            </button>
            <Button size="sm" variant="outline" onClick={downloadPdf} disabled={downloading} className="gap-1.5">
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
            </Button>
            <Button size="sm" onClick={onSign} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Sign & Approve
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {(rc.term2Marks ?? rc.subjectMarks).map((sm) => (
                <div key={sm.subjectId} className="bg-muted rounded-lg px-3 py-2">
                  <p className="text-xs text-muted-foreground truncate">{sm.subjectName}</p>
                  <p className="font-bold text-base">{sm.marks}<span className="text-xs font-normal text-muted-foreground">/100</span></p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">Total:</span><span className="font-bold">{rc.total}/{rc.outOf}</span>
              <span className="text-muted-foreground">Percentage:</span><span className="font-bold">{rc.percentage}%</span>
              <span className="text-muted-foreground">Grade:</span><span className="font-bold text-primary">{rc.gradeLetter}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

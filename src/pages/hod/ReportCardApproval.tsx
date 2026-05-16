import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection, query, where, getDocs, doc, updateDoc, writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ReportCard, Section } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle, Loader2, FileText, Download, ChevronDown, ChevronUp,
  CalendarClock, PenLine, Send, Clock, ShieldCheck,
} from "lucide-react";
import { generateReportCardPdf } from "@/lib/generateReportCardPdf";

export default function HODReportCardApproval() {
  const { appUser } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<"duedates" | "review" | "publish">("duedates");
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionIds, setSectionIds] = useState<string[]>([]);

  /* Due dates state */
  const [dueDates, setDueDates] = useState<Record<string, string>>({});
  const [savingDue, setSavingDue] = useState<string | null>(null);

  /* Review & Sign state */
  const [pendingCards, setPendingCards] = useState<ReportCard[]>([]);
  const [signing, setSigning] = useState<string | null>(null);

  /* Publish state */
  const [approvedCards, setApprovedCards] = useState<ReportCard[]>([]);
  const [publishing, setPublishing] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser) return;
    const init = async () => {
      try {
        const secSnap = await getDocs(query(collection(db, "sections"), where("hodId", "==", appUser.id)));
        const fetchedSections = secSnap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Section))
          .sort((a, b) => `${a.grade}${a.name}`.localeCompare(`${b.grade}${b.name}`));
        const ids = fetchedSections.map((s) => s.id);
        setSections(fetchedSections);
        setSectionIds(ids);

        /* Pre-fill due dates from section docs */
        const dd: Record<string, string> = {};
        fetchedSections.forEach((s) => { if (s.marksDueDate) dd[s.id] = s.marksDueDate; });
        setDueDates(dd);

        await loadCards(ids);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [appUser]);

  const loadCards = async (ids: string[]) => {
    if (ids.length === 0) { setPendingCards([]); setApprovedCards([]); return; }
    const CHUNK = 30;
    const pending: ReportCard[] = [];
    const approved: ReportCard[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const [pendSnap, appSnap] = await Promise.all([
        getDocs(query(collection(db, "reportCards"), where("status", "==", "teacher_signed"), where("sectionId", "in", chunk))),
        getDocs(query(collection(db, "reportCards"), where("status", "==", "principal_signed"), where("sectionId", "in", chunk))),
      ]);
      pendSnap.docs.forEach((d) => pending.push({ id: d.id, ...d.data() } as ReportCard));
      appSnap.docs.forEach((d) => approved.push({ id: d.id, ...d.data() } as ReportCard));
    }
    pending.sort((a, b) => a.studentName.localeCompare(b.studentName));
    approved.sort((a, b) => a.studentName.localeCompare(b.studentName));
    setPendingCards(pending);
    setApprovedCards(approved);
  };

  const saveDueDate = async (sectionId: string) => {
    const date = dueDates[sectionId];
    if (!date) return;
    setSavingDue(sectionId);
    try {
      await updateDoc(doc(db, "sections", sectionId), { marksDueDate: date });
      setSections((prev) => prev.map((s) => s.id === sectionId ? { ...s, marksDueDate: date } : s));
      toast({ title: "Due date saved", description: `Marks deadline set for ${date}` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingDue(null);
    }
  };

  const signAndForward = async (rc: ReportCard) => {
    if (!appUser) return;
    setSigning(rc.id);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, "reportCards", rc.id), {
        status: "hod_signed",
        hodSign: { userId: appUser.id, name: appUser.name, signedAt: now },
        hodApprovedAt: now,
      });
      setPendingCards((prev) => prev.filter((c) => c.id !== rc.id));
      toast({ title: "Signed & forwarded", description: `${rc.studentName}'s report card sent to Principal.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSigning(null);
    }
  };

  /* Group approved cards by section for batch publishing */
  const approvedBySectionId: Record<string, ReportCard[]> = {};
  approvedCards.forEach((rc) => {
    if (!approvedBySectionId[rc.sectionId]) approvedBySectionId[rc.sectionId] = [];
    approvedBySectionId[rc.sectionId].push(rc);
  });

  const publishSection = async (sectionId: string, cards: ReportCard[]) => {
    setPublishing(sectionId);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      cards.forEach((rc) => batch.update(doc(db, "reportCards", rc.id), { status: "published", releasedAt: now }));
      await batch.commit();
      setApprovedCards((prev) => prev.filter((c) => c.sectionId !== sectionId));
      const sec = sections.find((s) => s.id === sectionId);
      toast({ title: "Results published!", description: `${cards.length} student(s) in Grade ${sec?.grade} – ${sec?.name} can now view their results.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setPublishing(null);
    }
  };

  const tabs = [
    { key: "duedates" as const, label: "Set Due Dates",   icon: <CalendarClock size={14} />, count: 0 },
    { key: "review"   as const, label: "Review & Sign",   icon: <PenLine size={14} />,       count: pendingCards.length },
    { key: "publish"  as const, label: "Publish Results", icon: <Send size={14} />,           count: Object.keys(approvedBySectionId).length },
  ];

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-muted-foreground" size={32} /></div>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Report Cards</h1>
        <p className="text-muted-foreground text-sm">Set deadlines → Review & sign → Principal signs → Publish for students</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl mb-6 w-fit flex-wrap">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              tab === t.key ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
            {t.count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${tab === t.key ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20"}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Set Due Dates ── */}
      {tab === "duedates" && (
        sections.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            <CalendarClock size={36} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No sections assigned</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="font-medium text-sm">Marks entry deadline per section</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Class teachers will see this date as a reminder to complete all marks before generating report cards.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {sections.map((sec) => (
                <Card key={sec.id}>
                  <CardContent className="pt-4 pb-4">
                    <p className="font-semibold">Grade {sec.grade} – Section {sec.name}</p>
                    <p className="text-xs text-muted-foreground mb-3 mt-0.5">Class teacher deadline</p>
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        className="h-8 text-sm flex-1"
                        value={dueDates[sec.id] ?? ""}
                        onChange={(e) => setDueDates((d) => ({ ...d, [sec.id]: e.target.value }))}
                      />
                      <Button
                        size="sm" className="h-8 px-3 text-xs"
                        disabled={!dueDates[sec.id] || savingDue === sec.id}
                        onClick={() => saveDueDate(sec.id)}
                      >
                        {savingDue === sec.id ? <Loader2 size={12} className="animate-spin" /> : "Save"}
                      </Button>
                    </div>
                    {sec.marksDueDate && (
                      <p className="text-xs text-green-700 mt-2 font-medium">
                        ✓ Currently set: {new Date(sec.marksDueDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )
      )}

      {/* ── Tab: Review & Sign ── */}
      {tab === "review" && (
        pendingCards.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            <CheckCircle size={36} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nothing to review</p>
            <p className="text-sm mt-1">Report cards signed by class teachers will appear here for your signature.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground font-medium">
              {pendingCards.length} report card{pendingCards.length !== 1 ? "s" : ""} awaiting your signature
            </p>
            {pendingCards.map((rc) => (
              <RCRow key={rc.id} rc={rc}
                actionLabel="Sign & Forward to Principal"
                actionIcon={<PenLine size={14} />}
                onAction={() => signAndForward(rc)}
                loading={signing === rc.id}
                statusBadge={<span className="flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2.5 py-1 rounded-full"><Clock size={11} /> Class Teacher Signed</span>}
                toast={toast}
              />
            ))}
          </div>
        )
      )}

      {/* ── Tab: Publish Results ── */}
      {tab === "publish" && (
        Object.keys(approvedBySectionId).length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            <Send size={36} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nothing ready to publish</p>
            <p className="text-sm mt-1">Report cards signed by the Principal will appear here for you to publish.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground font-medium">
              {Object.keys(approvedBySectionId).length} section{Object.keys(approvedBySectionId).length !== 1 ? "s" : ""} ready to publish
            </p>
            {Object.entries(approvedBySectionId).map(([sectionId, cards]) => {
              const sec = sections.find((s) => s.id === sectionId);
              return (
                <PublishGroup
                  key={sectionId}
                  sectionId={sectionId}
                  sectionLabel={sec ? `Grade ${sec.grade} – Section ${sec.name}` : sectionId}
                  cards={cards}
                  onPublish={() => publishSection(sectionId, cards)}
                  loading={publishing === sectionId}
                  toast={toast}
                />
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

/* ── Publish Group Card ── */
function PublishGroup({ sectionId, sectionLabel, cards, onPublish, loading, toast }: {
  sectionId: string; sectionLabel: string; cards: ReportCard[];
  onPublish: () => void; loading: boolean; toast: any;
}) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const downloadPdf = async (rc: ReportCard) => {
    setDownloading(rc.id);
    try { await generateReportCardPdf(rc); }
    catch (err: any) { toast({ title: "PDF Error", description: err.message, variant: "destructive" }); }
    finally { setDownloading(null); }
  };

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0"><Send size={18} className="text-green-600" /></div>
            <div>
              <p className="font-semibold">{sectionLabel}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{cards.length} student{cards.length !== 1 ? "s" : ""} · Principal has signed all cards</p>
              <span className="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium text-indigo-700 bg-indigo-50 border-indigo-200">
                <ShieldCheck size={11} /> Principal Signed
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setExpanded((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {expanded ? "Hide" : "View students"}
            </button>
            <Button onClick={onPublish} disabled={loading} className="gap-1.5 bg-green-600 hover:bg-green-700">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Publish Results
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-border space-y-2">
            {cards.map((rc) => (
              <div key={rc.id} className="flex items-center justify-between text-sm py-1">
                <div>
                  <span className="font-medium">{rc.studentName}</span>
                  <span className="text-xs text-muted-foreground ml-2">{rc.percentage}% · {rc.gradeLetter}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => downloadPdf(rc)} disabled={downloading === rc.id} className="gap-1.5 h-7 text-xs">
                  {downloading === rc.id ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} PDF
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Shared RC Row ── */
function RCRow({ rc, actionLabel, actionIcon, onAction, loading, statusBadge, toast }: {
  rc: ReportCard; actionLabel: string; actionIcon: ReactNode;
  onAction: () => void; loading: boolean; statusBadge: ReactNode; toast: any;
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
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><FileText size={18} className="text-primary" /></div>
            <div>
              <p className="font-semibold">{rc.studentName}</p>
              <p className="text-xs text-muted-foreground">Grade {rc.grade} · Section {rc.sectionName} · {rc.examType}</p>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {statusBadge}
                <span className="text-xs font-semibold text-primary">{rc.percentage}% — {rc.gradeLetter}</span>
              </div>
              {rc.classTeacherSign && (
                <p className="text-[11px] text-green-700 mt-1">✓ Class Teacher: {rc.classTeacherSign.name} · {new Date(rc.classTeacherSign.signedAt).toLocaleDateString("en-IN")}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setExpanded((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              {expanded ? "Hide" : "View marks"}
            </button>
            <Button size="sm" variant="outline" onClick={downloadPdf} disabled={downloading} className="gap-1.5">
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
            </Button>
            <Button size="sm" onClick={onAction} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 size={14} className="animate-spin" /> : actionIcon} {actionLabel}
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* Keep exported for backward compat */
export function ReportCardRow(props: {
  rc: ReportCard; actionLabel: string; actionIcon: ReactNode;
  onAction: () => void; loading: boolean; statusBadge: ReactNode;
}) {
  const { toast } = useToast();
  return <RCRow {...props} toast={toast} />;
}

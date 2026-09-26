import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { PublishedReportCardSnapshot, resolveUserAcademicIdentity } from "@/lib/resultEngine";
import { generateReportCardPdf } from "@/lib/generateReportCardPdf";
import {
  DEFAULT_SCHOLASTIC_TABLE_CONFIG,
  deriveTermMaxMarks,
  normalizeScholasticTableConfig,
  normalizeCoScholasticConfig,
} from "@/lib/academicStructure";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Download,
  Award,
  Calendar,
  CheckCircle2,
  Clock,
  Printer,
  School,
  Loader2,
} from "lucide-react";

type ReportPeriod = "term_1" | "term_2" | "annual";

export default function StudentReportCard() {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const { toast } = useToast();

  const effectiveSessionId = workingSession?.id || activeSession?.id || "";
  const effectiveSessionName = workingSession?.name || activeSession?.name || "2026-27";

  const [selectedPeriod, setSelectedPeriod] = useState<ReportPeriod>("term_1");
  const [snapshots, setSnapshots] = useState<Record<ReportPeriod, PublishedReportCardSnapshot | null>>({
    term_1: null,
    term_2: null,
    annual: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appUser) return;
    const loadPublishedReportCards = async () => {
      try {
        setLoading(true);
        // Resolve student canonical identity
        const identity = await resolveUserAcademicIdentity(appUser.id);
        const stuUid = identity.studentUid || identity.studentDocId || appUser.id;
        const fallbackId = identity.studentDocId;

        const results: Record<ReportPeriod, PublishedReportCardSnapshot | null> = {
          term_1: null,
          term_2: null,
          annual: null,
        };

        // 1. Fetch Term 1
        let t1Doc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_term_1_${stuUid}`));
        if (!t1Doc.exists() && fallbackId && fallbackId !== stuUid) {
          t1Doc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_term_1_${fallbackId}`));
        }
        if (t1Doc.exists()) {
          results.term_1 = { id: t1Doc.id, ...t1Doc.data() } as PublishedReportCardSnapshot;
        }

        // 2. Fetch Term 2
        let t2Doc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_term_2_${stuUid}`));
        if (!t2Doc.exists() && fallbackId && fallbackId !== stuUid) {
          t2Doc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_term_2_${fallbackId}`));
        }
        if (t2Doc.exists()) {
          results.term_2 = { id: t2Doc.id, ...t2Doc.data() } as PublishedReportCardSnapshot;
        }

        // 3. Fetch Annual
        let annDoc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_annual_${stuUid}`));
        if (!annDoc.exists()) {
          annDoc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_${stuUid}`));
        }
        if (!annDoc.exists() && fallbackId && fallbackId !== stuUid) {
          annDoc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_annual_${fallbackId}`));
          if (!annDoc.exists()) {
            annDoc = await getDoc(doc(db, "publishedReportCards", `${effectiveSessionId}_${fallbackId}`));
          }
        }
        if (annDoc.exists()) {
          results.annual = { id: annDoc.id, ...annDoc.data() } as PublishedReportCardSnapshot;
        }

        setSnapshots(results);

        // Auto-select latest published period if default has no data
        if (results.annual) {
          setSelectedPeriod("annual");
        } else if (results.term_2) {
          setSelectedPeriod("term_2");
        } else if (results.term_1) {
          setSelectedPeriod("term_1");
        }
      } catch (err) {
        console.error("Error loading student report card:", err);
      } finally {
        setLoading(false);
      }
    };

    loadPublishedReportCards();
  }, [appUser, effectiveSessionId]);

  const currentSnapshot = snapshots[selectedPeriod];

  const handleDownload = async () => {
    if (!currentSnapshot) return;
    try {
      await generateReportCardPdf(currentSnapshot);
      toast({
        title: "Report Card Downloaded",
        description: `Downloaded official PDF report card for ${
          selectedPeriod === "annual" ? "Annual" : selectedPeriod === "term_1" ? "Term 1" : "Term 2"
        }.`,
      });
    } catch (err: any) {
      toast({ title: "Download Error", description: err.message, variant: "destructive" });
    }
  };

  const periodDisplayName =
    selectedPeriod === "annual"
      ? "Annual Consolidated"
      : selectedPeriod === "term_1"
      ? "Term 1"
      : "Term 2";

  return (
    <div data-testid="student-report-card" className="space-y-6">
      {/* Banner */}
      <div className="gradient-banner rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-blue-500/20 text-blue-200 border border-blue-400/30">
              Academic Session: {effectiveSessionName}
            </span>
            {currentSnapshot && (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                {periodDisplayName} Report Card Published
              </span>
            )}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Academic Progress Report</h1>
          <p className="mt-1 text-sm text-slate-300">
            View your formal continuous assessment results, grades, and teacher remarks.
          </p>
        </div>

        {currentSnapshot && (
          <Button
            onClick={handleDownload}
            className="bg-white text-slate-900 hover:bg-slate-100 gap-2 shrink-0 shadow-sm font-semibold"
          >
            <Download size={16} /> Download {periodDisplayName} PDF
          </Button>
        )}
      </div>

      {/* Period Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-2 rounded-2xl border">
        <div className="flex items-center gap-2">
          {(["term_1", "term_2", "annual"] as ReportPeriod[]).map((period) => {
            const hasData = !!snapshots[period];
            const label =
              period === "term_1"
                ? "Term 1"
                : period === "term_2"
                ? "Term 2"
                : "Annual Consolidated";

            return (
              <Button
                key={period}
                type="button"
                size="sm"
                variant={selectedPeriod === period ? "default" : "ghost"}
                onClick={() => setSelectedPeriod(period)}
                className="gap-2 h-9 text-xs font-semibold px-4"
              >
                <span>{label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold uppercase tracking-wider ${
                    hasData
                      ? selectedPeriod === period
                        ? "bg-white/30 text-white"
                        : "bg-emerald-500/20 text-emerald-700"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {hasData ? "Released" : "Pending"}
                </span>
              </Button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-muted-foreground">
          <Loader2 className="animate-spin h-8 w-8 text-primary mb-2" />
          <p className="text-xs">Loading academic records...</p>
        </div>
      ) : !currentSnapshot ? (
        <Card className="rounded-2xl border-dashed border-2 p-12 text-center text-muted-foreground">
          <FileText size={48} className="mx-auto text-primary/30 mb-3" />
          <h3 className="text-lg font-bold text-foreground">{periodDisplayName} Report Card Not Published Yet</h3>
          <p className="text-sm mt-1 max-w-md mx-auto">
            Your official report card for {periodDisplayName} (Session {effectiveSessionName}) is currently undergoing verification or marks entry. It will appear here once officially released by the examination office.
          </p>
        </Card>
      ) : (
        <div className="max-w-4xl mx-auto bg-white text-black p-8 rounded-2xl border shadow-xl font-serif text-xs leading-normal">
          {/* Double outer border */}
          <div className="border-2 border-black p-5 space-y-5">
            {/* School Header */}
            <div className="border-b border-black pb-3 text-center relative">
              <div className="flex items-center justify-between mb-2">
                <div className="w-16 h-16 flex items-center justify-center overflow-hidden">
                  <img src="/prestige_logo.png" alt="Prestige International School" className="h-full w-full object-contain" />
                </div>
                <div className="flex-1 px-3">
                  <h2 className="text-xl font-bold uppercase tracking-wide">
                    {currentSnapshot.layoutConfig?.schoolName || "PRESTIGE INTERNATIONAL SCHOOL & PRE-UNIVERSITY COLLEGE"}
                  </h2>
                  <p className="text-xs font-sans text-gray-700 italic">
                    {currentSnapshot.layoutConfig?.tagline || "SCALING NEW HEIGHTS"}
                  </p>
                  <p className="text-[11px] font-sans text-gray-600">
                    {currentSnapshot.layoutConfig?.affiliationNo || "Affiliated to CBSE, New Delhi"}
                  </p>
                </div>
                <div className="w-14 h-14 border border-gray-300 rounded flex items-center justify-center text-[10px] font-sans font-bold text-gray-700 bg-gray-50">
                  CBSE
                </div>
              </div>
              <div className="bg-black text-white text-xs font-sans font-bold py-1 tracking-wider uppercase mt-1">
                CONTINUOUS COMPREHENSIVE REPORT — {periodDisplayName.toUpperCase()} — SESSION {currentSnapshot.academicYear}
              </div>
            </div>

            {/* Student Biographical Profile */}
            <div className="border border-black p-3 font-sans text-xs grid grid-cols-2 gap-x-4 gap-y-1 bg-gray-50/50">
              <div><span className="font-semibold">Student Name:</span> {currentSnapshot.studentName}</div>
              <div><span className="font-semibold">Roll No:</span> {currentSnapshot.rollNo || "—"}</div>
              <div><span className="font-semibold">Admission No:</span> {currentSnapshot.admissionNo || "—"}</div>
              <div><span className="font-semibold">Class & Section:</span> Grade {currentSnapshot.grade} - {currentSnapshot.sectionName}</div>
              <div><span className="font-semibold">Father's Name:</span> {currentSnapshot.fatherName || "—"}</div>
              <div><span className="font-semibold">DOB:</span> {currentSnapshot.dob || "—"}</div>
            </div>

            {/* Scholastic Assessment Table */}
            <div>
              <div className="bg-black text-white text-xs font-sans font-bold px-2 py-1 uppercase tracking-wide">
                Part 1: Scholastic Areas ({periodDisplayName})
              </div>

              {selectedPeriod === "annual" ? (
                /* Annual Consolidated Dynamic 3-Row Header Table */
                (() => {
                  const cfg = normalizeScholasticTableConfig(currentSnapshot.scholasticTableConfig);
                  const t1Cfg = cfg.terms.find((t) => t.termId === "term_1") || cfg.terms[0];
                  const t2Cfg = cfg.terms.find((t) => t.termId === "term_2") || cfg.terms[1];
                  const t1Comps = (t1Cfg?.assessmentComponents || []).filter((c) => c.displayOnReportCard !== false);
                  const t2Comps = (t2Cfg?.assessmentComponents || []).filter((c) => c.displayOnReportCard !== false);
                  const t1Max = deriveTermMaxMarks(t1Cfg);
                  const t2Max = deriveTermMaxMarks(t2Cfg);
                  const overallCfg = cfg.overallConfig || cfg.overall;

                  let ovColCount = 0;
                  if (overallCfg?.showOverallTotal) ovColCount++;
                  if (overallCfg?.showGrade) ovColCount++;
                  if (overallCfg?.showRank) ovColCount++;

                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse border border-black text-xs font-sans mt-1 text-center">
                        <thead>
                          {/* Row 1: Term Group Headers */}
                          <tr className="bg-gray-100 font-bold border-b border-black">
                            <th rowSpan={2} className="border border-black p-2 text-left min-w-[120px]">
                              Subjects
                            </th>
                            <th colSpan={t1Comps.length + 1} className="border border-black p-1 uppercase bg-gray-50">
                              {t1Cfg.termName}
                              <span className="block text-[10px] font-normal text-gray-700">{t1Max} Marks</span>
                            </th>
                            <th colSpan={t2Comps.length + 1} className="border border-black p-1 uppercase bg-gray-50">
                              {t2Cfg.termName}
                              <span className="block text-[10px] font-normal text-gray-700">{t2Max} Marks</span>
                            </th>
                            {ovColCount > 0 && (
                              <th colSpan={ovColCount} className="border border-black p-1 uppercase bg-gray-50">
                                {overallCfg.title || "OVERALL"}
                                <span className="block text-[10px] font-normal text-gray-700">
                                  {overallCfg.subtitle || "Term 1 + Term 2"}
                                </span>
                              </th>
                            )}
                          </tr>

                          {/* Row 2: Sub-headers */}
                          <tr className="bg-gray-100 font-bold border-b border-black text-[11px]">
                            {t1Comps.map((c) => (
                              <th key={c.id} className="border border-black p-1">
                                {c.code}
                              </th>
                            ))}
                            <th className="border border-black p-1 font-bold">Total</th>

                            {t2Comps.map((c) => (
                              <th key={c.id} className="border border-black p-1">
                                {c.code}
                              </th>
                            ))}
                            <th className="border border-black p-1 font-bold">Total</th>

                            {overallCfg.showOverallTotal && <th className="border border-black p-1 font-bold">Total</th>}
                            {overallCfg.showGrade && <th className="border border-black p-1 font-bold">Grade</th>}
                            {overallCfg.showRank && <th className="border border-black p-1 font-bold text-primary">Rank</th>}
                          </tr>

                          {/* Row 3: Dedicated Max Marks Row */}
                          <tr className="bg-gray-50/90 font-bold border-b border-black text-[10px] text-gray-700">
                            <td className="border border-black p-1 text-left text-gray-400 font-normal"></td>
                            {t1Comps.map((c) => (
                              <td key={c.id} className="border border-black p-1">
                                {c.scalingTargetMarks ?? c.maxMarks}
                              </td>
                            ))}
                            <td className="border border-black p-1 font-bold">{t1Max}</td>

                            {t2Comps.map((c) => (
                              <td key={c.id} className="border border-black p-1">
                                {c.scalingTargetMarks ?? c.maxMarks}
                              </td>
                            ))}
                            <td className="border border-black p-1 font-bold">{t2Max}</td>

                            {overallCfg.showOverallTotal && (
                              <td className="border border-black p-1 font-bold">
                                {Math.round(
                                  (t1Max * (overallCfg.term1Weight || 50) + t2Max * (overallCfg.term2Weight || 50)) / 100
                                )}
                              </td>
                            )}
                            {overallCfg.showGrade && <td className="border border-black p-1">-</td>}
                            {overallCfg.showRank && <td className="border border-black p-1">-</td>}
                          </tr>
                        </thead>

                        <tbody>
                          {currentSnapshot.scholasticResults.map((sub) => {
                            return (
                              <tr key={sub.subjectId} className="border-b border-gray-300">
                                <td className="border border-black p-1.5 text-left font-medium">{sub.subjectName}</td>

                                {t1Comps.map((c) => {
                                  const mark = sub.term1?.components?.[c.code] ?? sub.term1?.components?.[c.id] ?? "—";
                                  return (
                                    <td key={c.id} className="border border-black p-1">
                                      {mark}
                                    </td>
                                  );
                                })}
                                <td className="border border-black p-1 font-semibold bg-gray-50/40">
                                  {sub.term1?.scaledTotal ?? "—"}
                                </td>

                                {t2Comps.map((c) => {
                                  const mark = sub.term2?.components?.[c.code] ?? sub.term2?.components?.[c.id] ?? "—";
                                  return (
                                    <td key={c.id} className="border border-black p-1">
                                      {mark}
                                    </td>
                                  );
                                })}
                                <td className="border border-black p-1 font-semibold bg-gray-50/40">
                                  {sub.term2?.scaledTotal ?? "—"}
                                </td>

                                {overallCfg.showOverallTotal && (
                                  <td className="border border-black p-1 font-bold bg-gray-50/60">{sub.overallTotal}</td>
                                )}
                                {overallCfg.showGrade && (
                                  <td className="border border-black p-1 font-bold text-blue-700">{sub.overallGrade}</td>
                                )}
                                {overallCfg.showRank && (
                                  <td className="border border-black p-1 font-bold text-primary">
                                    {sub.rank ?? currentSnapshot.rank ?? "—"}
                                  </td>
                                )}
                              </tr>
                            );
                          })}

                          <tr className="bg-gray-100 font-bold border-t-2 border-black">
                            <td className="border border-black p-2 text-left">GRAND TOTAL</td>
                            <td className="border border-black p-2" colSpan={t1Comps.length + t2Comps.length + 2}>
                              Consolidated Term Performance
                            </td>
                            {overallCfg.showOverallTotal && (
                              <td className="border border-black p-2 font-bold text-blue-800">
                                {currentSnapshot.grandTotal} / {currentSnapshot.grandMax} ({currentSnapshot.grandPercentage}%)
                              </td>
                            )}
                            {overallCfg.showGrade && (
                              <td className="border border-black p-2 font-bold text-blue-800">
                                {currentSnapshot.grandGrade}
                              </td>
                            )}
                            {overallCfg.showRank && (
                              <td className="border border-black p-2 font-bold text-primary">
                                {currentSnapshot.rank ? `#${currentSnapshot.rank}` : "—"}
                              </td>
                            )}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })()
              ) : (
                /* Single Term Table */
                <table className="w-full border-collapse border border-black text-xs font-sans mt-1 text-center">
                  <thead>
                    <tr className="bg-gray-100 font-bold border-b border-black">
                      <th className="border border-black p-2 text-left">Subject</th>
                      <th className="border border-black p-2 w-24">Term Marks</th>
                      <th className="border border-black p-2 w-24">Max Marks</th>
                      <th className="border border-black p-2 w-20">Percentage</th>
                      <th className="border border-black p-2 w-20">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentSnapshot.scholasticResults.map((sub) => (
                      <tr key={sub.subjectId} className="border-b border-gray-300">
                        <td className="border border-black p-2 text-left font-medium">{sub.subjectName}</td>
                        <td className="border border-black p-2 font-bold">{sub.overallTotal}</td>
                        <td className="border border-black p-2">{sub.overallMax}</td>
                        <td className="border border-black p-2">{sub.overallPercentage}%</td>
                        <td className="border border-black p-2 font-bold text-blue-700">{sub.overallGrade}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-100 font-bold border-t-2 border-black">
                      <td className="border border-black p-2 text-left">GRAND TOTAL</td>
                      <td className="border border-black p-2">{currentSnapshot.grandTotal}</td>
                      <td className="border border-black p-2">{currentSnapshot.grandMax}</td>
                      <td className="border border-black p-2">{currentSnapshot.grandPercentage}%</td>
                      <td className="border border-black p-2 text-blue-800">{currentSnapshot.grandGrade}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* Part 2: Co-Scholastic Areas */}
            {currentSnapshot.coScholasticConfig && (() => {
              const coCfg = normalizeCoScholasticConfig(currentSnapshot.coScholasticConfig);
              return (
                <div>
                  <div className="bg-black text-white text-xs font-sans font-bold px-2 py-1 uppercase tracking-wide">
                    {coCfg.title || "PART 2: CO-SCHOLASTIC AREAS"}
                  </div>
                  {coCfg.subtitle && (
                    <div className="text-[11px] font-sans text-gray-700 italic px-2 py-0.5 bg-gray-50 border-x border-b border-black">
                      {coCfg.subtitle}
                    </div>
                  )}
                  <table className="w-full border-collapse border border-black text-xs font-sans mt-1 text-center">
                    <thead>
                      <tr className="bg-gray-100 font-bold border-b border-black">
                        <th className="border border-black p-2 text-left">Activity</th>
                        {coCfg.termColumns.map((col) => (
                          <th key={col.termId} className="border border-black p-2 w-20">
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {coCfg.areas
                        .filter((a) => a.displayOnReportCard !== false)
                        .map((area, idx) => {
                          const rawGrade =
                            currentSnapshot.coScholasticGrades?.[area.id] ||
                            currentSnapshot.coScholasticGrades?.[area.name];
                          return (
                            <tr key={area.id} className="border-b border-gray-300">
                              <td className="border border-black p-2 text-left font-medium">
                                {idx + 1}. {area.name}
                              </td>
                              {coCfg.termColumns.map((col) => {
                                let cellGrade = "—";
                                if (typeof rawGrade === "object" && rawGrade !== null) {
                                  cellGrade =
                                    col.termId === "term_1" ? rawGrade.term1 || "—" : rawGrade.term2 || "—";
                                } else if (typeof rawGrade === "string") {
                                  cellGrade = rawGrade;
                                }
                                return (
                                  <td key={col.termId} className="border border-black p-2 font-bold">
                                    {cellGrade}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Attendance & Remarks */}
            <div className="border border-black p-3 font-sans text-xs space-y-2">
              <div className="flex justify-between">
                <span><span className="font-semibold">Attendance:</span> [Continuous Monitoring]</span>
                <span><span className="font-semibold">Result Status:</span> <span className="font-bold text-emerald-700">{currentSnapshot.resultStatus}</span></span>
              </div>
              <div>
                <span className="font-semibold">Class Teacher Remarks:</span> {currentSnapshot.teacherRemarks || "Consistent academic performance throughout the year."}
              </div>
              {selectedPeriod === "annual" && currentSnapshot.promotedToGrade && (
                <div>
                  <span className="font-semibold">Promoted To:</span> {currentSnapshot.promotedToGrade}
                </div>
              )}
            </div>

            {/* Official Signatures */}
            <div className="pt-8 flex justify-between items-end text-center font-sans text-xs text-gray-800">
              <div className="space-y-1">
                <div className="w-28 border-b border-black mx-auto"></div>
                <p className="font-semibold">Class Teacher</p>
              </div>
              <div className="space-y-1">
                <div className="w-28 border-b border-black mx-auto"></div>
                <p className="font-semibold">Section Head / HOD</p>
              </div>
              <div className="space-y-1">
                <div className="w-28 border-b border-black mx-auto"></div>
                <p className="font-semibold">Principal</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

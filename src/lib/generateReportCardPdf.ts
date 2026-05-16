import type { ReportCard } from "./types";
import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";

/* ─── Signature fetching ───────────────────────────────────────── */
interface SigData { userId: string; role?: string; name: string; imageUrl: string; }
async function fetchSignaturesByUserId(): Promise<Record<string, SigData>> {
  try {
    const snap = await getDocs(collection(db, "signatures"));
    const map: Record<string, SigData> = {};
    snap.docs.forEach((d) => {
      const data = d.data() as any;
      const userId = String(data.userId || d.id || "").trim();
      const imageUrl = String(data.imageUrl || "").trim();
      if (!userId || !imageUrl) return;
      map[userId] = { userId, role: data.role, name: data.name || "", imageUrl };
    });
    return map;
  } catch {
    return {};
  }
}

function normalizePdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/\u2014/g, "-") // em dash
    .replace(/\u2013/g, "-") // en dash
    .replace(/\u2192/g, "->") // arrow
    .replace(/\u00B7/g, "-"); // middle dot
}

function inferDataUrlImageFormat(dataUrl: string): "PNG" | "JPEG" {
  const match = /^data:image\/(png|jpe?g);/i.exec(dataUrl.trim());
  if (!match) return "PNG";
  return match[1].toLowerCase() === "png" ? "PNG" : "JPEG";
}

function findSignatureByName(
  signatures: Record<string, SigData>,
  name: string,
  expectedRole?: string,
): SigData | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;

  return Object.values(signatures).find((sig) => {
    if ((sig.name || "").trim().toLowerCase() !== needle) return false;
    if (expectedRole && sig.role && sig.role !== expectedRole) return false;
    return true;
  });
}

/* ─── CBSE grading ─────────────────────────────────────────────── */
const CBSE_GRADE: [number, string][] = [
  [91,"A1"],[81,"A2"],[71,"B1"],[61,"B2"],[51,"C1"],[41,"C2"],[33,"D"],
];
function cbseGrade(marks: number): string {
  for (const [min, g] of CBSE_GRADE) if (marks >= min) return g;
  return "E";
}
function overallGrade(pct: number) {
  if (pct >= 90) return "A+"; if (pct >= 80) return "A"; if (pct >= 70) return "B+";
  if (pct >= 60) return "B";  if (pct >= 50) return "C"; if (pct >= 40) return "D";
  return "F";
}

/* ─── Types ────────────────────────────────────────────────────── */
type Align = "left" | "center" | "right";
type Style = "normal" | "bold" | "italic" | "bolditalic";

interface CellOpts {
  align?:  Align;
  style?:  Style;
  size?:   number;
  border?: boolean;
  pad?:    number;
  shade?:  boolean;  // light grey fill
  dark?:   boolean;  // dark fill + white text (section headers)
  altRow?: boolean;  // very light alternating fill
}

/* ─── drawCell ─────────────────────────────────────────────────── */
function drawCell(
  doc: any,
  x: number, y: number, w: number, h: number,
  text: string,
  opts: CellOpts = {}
) {
  const {
    align  = "center",
    style  = "normal",
    size   = 7,
    border = true,
    pad    = 1.5,
    shade  = false,
    dark   = false,
    altRow = false,
  } = opts;

  // Fill
  if (dark) {
    doc.setFillColor(30, 30, 30);
    doc.rect(x, y, w, h, "F");
  } else if (shade) {
    doc.setFillColor(220, 220, 220);
    doc.rect(x, y, w, h, "F");
  } else if (altRow) {
    doc.setFillColor(245, 245, 245);
    doc.rect(x, y, w, h, "F");
  }

  // Border
  if (border) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.15);
    doc.rect(x, y, w, h, "S");
  }

  // Text
  doc.setFont("times", style);
  doc.setFontSize(size);
  doc.setTextColor(dark ? 255 : 0, dark ? 255 : 0, dark ? 255 : 0);

  if (text !== "") {
    const maxW  = w - pad * 2;
    const safeText = normalizePdfText(text);
    const lines: string[] = doc.splitTextToSize(safeText, maxW);
    const lineH = size * 0.3528 * 1.35;
    const totalH = lines.length * lineH;
    const startY = y + (h - totalH) / 2 + lineH * 0.75;
    const tx =
      align === "center" ? x + w / 2 :
      align === "right"  ? x + w - pad :
                           x + pad;
    lines.forEach((line: string, i: number) =>
      doc.text(line, tx, startY + i * lineH, { align })
    );
  }

  // Always reset text color
  doc.setTextColor(0, 0, 0);
}

/* ─── Section header helper ────────────────────────────────────── */
const SEC_H = 7.5;   // section header bar height
function secHdr(doc: any, x: number, y: number, w: number, text: string) {
  drawCell(doc, x, y, w, SEC_H, text, { dark: true, style: "bold", size: 7.5, align: "left", pad: 3 });
}

/* ─── Format date string ───────────────────────────────────────── */
function fmtDate(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;
}

/* ═══════════════════════════════════════════════════════════════ */
/*  FRONT PAGE                                                     */
/* ═══════════════════════════════════════════════════════════════ */
function drawFrontPage(doc: any, rc: ReportCard, signatures: Record<string, SigData>) {
  const ML = 12, W = 210;
  const TW = W - 2 * ML;   // 186 mm
  let y = 12;

  /* ── Standard row heights ── */
  const RH  = 6.5;   // regular data row
  const DRH = 5.5;   // compact data row (marks table)
  const RH1 = 7.5, RH2 = 6;  // scholastic double-header rows
  const GAP = 5;     // gap between sections

  /* ── Outer border ── */
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(ML - 2, y - 2, TW + 4, 279);

  /* ════════════════════════════════════════
     HEADER — Logo spaces + School name
  ════════════════════════════════════════ */
  const LOGO_W = 24, LOGO_H = 24;   // logo placeholder dimensions
  const logoY  = y + 2;
  const centerX = ML + LOGO_W;       // start of center text area
  const centerW = TW - LOGO_W * 2;   // width of center text zone

  // Left logo placeholder (school logo)
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.rect(ML, logoY, LOGO_W, LOGO_H, "S");
  doc.setFont("times", "italic");
  doc.setFontSize(6);
  doc.setTextColor(160, 160, 160);
  doc.text("School", ML + LOGO_W / 2, logoY + LOGO_H / 2 - 2,  { align: "center" });
  doc.text("Logo",   ML + LOGO_W / 2, logoY + LOGO_H / 2 + 2,  { align: "center" });

  // Right logo placeholder (board/CBSE logo)
  doc.rect(ML + TW - LOGO_W, logoY, LOGO_W, LOGO_H, "S");
  doc.text("Board",  ML + TW - LOGO_W / 2, logoY + LOGO_H / 2 - 2, { align: "center" });
  doc.text("Logo",   ML + TW - LOGO_W / 2, logoY + LOGO_H / 2 + 2, { align: "center" });

  // Reset dash
  doc.setLineDashPattern([], 0);
  doc.setTextColor(0, 0, 0);

  // School name — centered between logo boxes
  doc.setFont("times", "bold");
  doc.setFontSize(20);
  doc.text("PRESTIGE INTERNATIONAL SCHOOL", centerX + centerW / 2, logoY + 8, { align: "center" });

  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  doc.text("Excellence in Education", centerX + centerW / 2, logoY + 14.5, { align: "center" });
  doc.text("Affiliated to CBSE  |  Affiliation No. XXXXXXX", centerX + centerW / 2, logoY + 20, { align: "center" });

  // Thin rule below logo row
  y += LOGO_H + 4;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  doc.line(ML, y, W - ML, y);
  y += 2;

  // Dark title band
  doc.setFillColor(30, 30, 30);
  doc.rect(ML, y, TW, 9, "F");
  doc.setFont("times", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text("REPORT CARD  —  ANNUAL EXAMINATION", W / 2, y + 6, { align: "center" });
  doc.setTextColor(0, 0, 0);
  y += 9 + 2;

  // Info row: Session | Class | Section
  const infoW = TW / 3;
  drawCell(doc, ML,           y, infoW, RH, `Academic Session: ${rc.academicSession || "2024-25"}`, { shade: true, style: "bold", size: 7.5, align: "center" });
  drawCell(doc, ML + infoW,   y, infoW, RH, `Class: ${rc.grade}`,                                   { shade: true, style: "bold", size: 7.5, align: "center" });
  drawCell(doc, ML + infoW*2, y, infoW, RH, `Section: ${rc.sectionName}`,                           { shade: true, style: "bold", size: 7.5, align: "center" });
  y += RH + GAP;

  /* ════════════════════════════════════════
     STUDENT DETAILS
  ════════════════════════════════════════ */
  secHdr(doc, ML, y, TW, "STUDENT DETAILS");
  y += SEC_H;

  const LW = 34, VW = TW / 2 - LW;   // label 34mm, value fills rest
  const c2 = ML + TW / 2;             // start of right column

  const details: [[string, string], [string, string]][] = [
    [["Student's Name",  rc.studentName || "—"],  ["Admission No.", rc.admissionNo || "—"]],
    [["Class / Section", `Grade ${rc.grade} – ${rc.sectionName}`], ["Roll No.", rc.rollNo || "—"]],
    [["Date of Birth",   rc.dob || "—"],          ["Father's Name", rc.fatherName || "—"]],
    [["Mother's Name",   rc.motherName || "—"],   ["Address",       rc.address || "—"]],
  ];
  details.forEach(([[l1, v1], [l2, v2]]) => {
    drawCell(doc, ML,      y, LW,  RH, l1 + ":", { shade: true, style: "bold", size: 6.5, align: "left", pad: 2 });
    drawCell(doc, ML + LW, y, VW,  RH, v1,       { size: 7,   align: "left", pad: 2 });
    drawCell(doc, c2,      y, LW,  RH, l2 + ":", { shade: true, style: "bold", size: 6.5, align: "left", pad: 2 });
    drawCell(doc, c2 + LW, y, VW,  RH, v2,       { size: 7,   align: "left", pad: 2 });
    y += RH;
  });
  y += GAP;

  /* ════════════════════════════════════════
     SCHOLASTIC AREAS
  ════════════════════════════════════════ */
  secHdr(doc, ML, y, TW, "SCHOLASTIC AREAS");
  y += SEC_H;

  const gradeNum = parseInt(rc.grade, 10) || 0;
  const lower    = gradeNum >= 1 && gradeNum <= 5;

  /* Build subject maps */
  const t1Map: Record<string, any> = {};
  const t2Map: Record<string, any> = {};
  (rc.term1Marks || []).forEach((sm) => { t1Map[sm.subjectId] = sm; });
  (rc.term2Marks || rc.subjectMarks || []).forEach((sm) => { t2Map[sm.subjectId] = sm; });
  const allSubjects = rc.subjectMarks || rc.term2Marks || [];

  const getSMGrade = (sm: any, isLower: boolean) => {
    if (!sm) return "—";
    return sm.grade || cbseGrade(isLower ? sm.marks : Math.round((sm.marks / 90) * 100));
  };

  /* ── Grades 1–5 ── PT(40)+NB(10)+SE(10)+Exam(40)=100 */
  if (lower) {
    // Each term width = (TW - SUB_W) / 2
    const SUB_W = 38;
    const available = TW - SUB_W; // 148
    const TERM_W = available / 2; // 74
    // Column widths inside each term (must sum to TERM_W=74)
    const PT=12, NB=9, SE=9, EX=12, TOT=14, GR=18; // 12+9+9+12+14+18=74 ✓
    const t1c = ML + SUB_W;
    const t2c = t1c + TERM_W;

    // Header row 1
    drawCell(doc, ML,  y, SUB_W, RH1+RH2, "Subject",               { style:"bold", size:7, shade:true });
    drawCell(doc, t1c, y, TERM_W, RH1,    "TERM  I  —  100 Marks", { style:"bold", size:7, shade:true });
    drawCell(doc, t2c, y, TERM_W, RH1,    "TERM  II  —  100 Marks",{ style:"bold", size:7, shade:true });
    y += RH1;

    // Header row 2
    const h = (x: number, w: number, lbl: string) =>
      drawCell(doc, x, y, w, RH2, lbl, { style:"bold", size:6, shade:true });
    [t1c, t2c].forEach((base) => {
      h(base,                    PT,  "PT\n/40");
      h(base+PT,                 NB,  "NB\n/10");
      h(base+PT+NB,              SE,  "SE\n/10");
      h(base+PT+NB+SE,           EX,  "Exam\n/40");
      h(base+PT+NB+SE+EX,        TOT, "Total\n/100");
      h(base+PT+NB+SE+EX+TOT,    GR,  "Grade");
    });
    y += RH2;

    allSubjects.forEach((sm, idx) => {
      const alt = idx % 2 === 1;
      const t1  = t1Map[sm.subjectId];
      const t2  = t2Map[sm.subjectId] ?? sm;
      drawCell(doc, ML, y, SUB_W, DRH, sm.subjectName, { align:"left", size:7, pad:2, altRow: alt });

      const drawTerm = (base: number, d: any) => {
        const pt  = d?.perTest    !== undefined ? String(d.perTest)    : "—";
        const nb  = d?.notebook   !== undefined ? String(d.notebook)   : "—";
        const se  = d?.enrichment !== undefined ? String(d.enrichment) : "—";
        const ex  = d?.examMarks  !== undefined ? String(d.examMarks)  : "—";
        const tot = d ? String(d.marks) : "—";
        const gr  = getSMGrade(d, true);
        drawCell(doc, base,                 y, PT,  DRH, pt,  { size:7, altRow:alt });
        drawCell(doc, base+PT,              y, NB,  DRH, nb,  { size:7, altRow:alt });
        drawCell(doc, base+PT+NB,           y, SE,  DRH, se,  { size:7, altRow:alt });
        drawCell(doc, base+PT+NB+SE,        y, EX,  DRH, ex,  { size:7, altRow:alt });
        drawCell(doc, base+PT+NB+SE+EX,     y, TOT, DRH, tot, { size:7, style:"bold", altRow:alt });
        drawCell(doc, base+PT+NB+SE+EX+TOT, y, GR,  DRH, gr,  { size:7, style:"bold", altRow:alt });
      };
      drawTerm(t1c, t1);
      drawTerm(t2c, t2);
      y += DRH;
    });

    // Summary row
    const t1Tot = allSubjects.reduce((s, sm) => s + (t1Map[sm.subjectId]?.marks ?? 0), 0);
    const t2Tot = allSubjects.reduce((s, sm) => s + (t2Map[sm.subjectId]?.marks ?? sm.marks ?? 0), 0);
    const outOf = allSubjects.length * 100;
    const t1Pct = outOf > 0 ? +(t1Tot / outOf * 100).toFixed(1) : 0;
    const t2Pct = outOf > 0 ? +(t2Tot / outOf * 100).toFixed(1) : 0;
    const grade = overallGrade(t2Pct);
    drawCell(doc, ML,  y, SUB_W, DRH, "TOTAL / RESULT", { shade:true, style:"bold", size:6.5, align:"left", pad:2 });
    drawCell(doc, t1c, y, TERM_W, DRH, `${t1Tot} / ${outOf}   (${t1Pct}%)`, { shade:true, style:"bold", size:7 });
    drawCell(doc, t2c, y, TERM_W-GR, DRH, `${t2Tot} / ${outOf}   (${t2Pct}%)`, { shade:true, style:"bold", size:7 });
    drawCell(doc, t2c+TERM_W-GR, y, GR, DRH, grade, { shade:true, style:"bold", size:8 });
    y += DRH;

  /* ── Grades 6+ ── PT(10)+Exam(80)=90 */
  } else {
    const SUB_W  = 40;
    const available = TW - SUB_W; // 146
    const TERM_W = available / 2; // 73
    // PT+EX+TOT+GR = 73: use 12+30+17+14=73 ✓
    const PT=12, EX=30, TOT=17, GR=14;
    const t1c = ML + SUB_W;
    const t2c = t1c + TERM_W;

    drawCell(doc, ML,  y, SUB_W, RH1+RH2, "Subject",              { style:"bold", size:7, shade:true });
    drawCell(doc, t1c, y, TERM_W, RH1,    "TERM  I  —  90 Marks", { style:"bold", size:7, shade:true });
    drawCell(doc, t2c, y, TERM_W, RH1,    "TERM  II  —  90 Marks",{ style:"bold", size:7, shade:true });
    y += RH1;

    const h = (x: number, w: number, lbl: string) =>
      drawCell(doc, x, y, w, RH2, lbl, { style:"bold", size:6.5, shade:true });
    [t1c, t2c].forEach((base) => {
      h(base,          PT,  "Per Test\n/10");
      h(base+PT,       EX,  "Exam\n/80");
      h(base+PT+EX,    TOT, "Total\n/90");
      h(base+PT+EX+TOT,GR,  "Grade");
    });
    y += RH2;

    allSubjects.forEach((sm, idx) => {
      const alt = idx % 2 === 1;
      const t1  = t1Map[sm.subjectId];
      const t2  = t2Map[sm.subjectId] ?? sm;
      drawCell(doc, ML, y, SUB_W, DRH, sm.subjectName, { align:"left", size:7, pad:2, altRow:alt });

      const drawTerm = (base: number, d: any) => {
        const pt  = d?.perTest   !== undefined ? String(d.perTest)   : "—";
        const ex  = d?.examMarks !== undefined ? String(d.examMarks) : "—";
        const tot = d ? String(d.marks) : "—";
        const gr  = getSMGrade(d, false);
        drawCell(doc, base,          y, PT,  DRH, pt,  { size:7, altRow:alt });
        drawCell(doc, base+PT,       y, EX,  DRH, ex,  { size:7, altRow:alt });
        drawCell(doc, base+PT+EX,    y, TOT, DRH, tot, { size:7, style:"bold", altRow:alt });
        drawCell(doc, base+PT+EX+TOT,y, GR,  DRH, gr,  { size:7, style:"bold", altRow:alt });
      };
      drawTerm(t1c, t1);
      drawTerm(t2c, t2);
      y += DRH;
    });

    // Summary row
    const t1Tot = allSubjects.reduce((s, sm) => s + (t1Map[sm.subjectId]?.marks ?? 0), 0);
    const t2Tot = allSubjects.reduce((s, sm) => s + (t2Map[sm.subjectId]?.marks ?? sm.marks ?? 0), 0);
    const outOf = allSubjects.length * 90;
    const t1Pct = outOf > 0 ? +(t1Tot / outOf * 100).toFixed(1) : 0;
    const t2Pct = outOf > 0 ? +(t2Tot / outOf * 100).toFixed(1) : 0;
    const grade = overallGrade(t2Pct);
    drawCell(doc, ML,  y, SUB_W, DRH, "TOTAL / RESULT", { shade:true, style:"bold", size:6.5, align:"left", pad:2 });
    drawCell(doc, t1c, y, TERM_W, DRH, `${t1Tot} / ${outOf}   (${t1Pct}%)`, { shade:true, style:"bold", size:7 });
    drawCell(doc, t2c, y, TERM_W-GR, DRH, `${t2Tot} / ${outOf}   (${t2Pct}%)`, { shade:true, style:"bold", size:7 });
    drawCell(doc, t2c+TERM_W-GR, y, GR, DRH, grade, { shade:true, style:"bold", size:8 });
    y += DRH;
  }

  y += GAP;

  /* ════════════════════════════════════════
     ATTENDANCE
  ════════════════════════════════════════ */
  secHdr(doc, ML, y, TW, "ATTENDANCE");
  y += SEC_H;
  const QW = TW / 4; // 46.5mm
  drawCell(doc, ML,       y, QW, RH, "Term-I  (Days Present / Total):", { shade:true, style:"bold", size:6.5, align:"left", pad:2 });
  drawCell(doc, ML+QW,    y, QW, RH, rc.attendance1 || "—",              { size:7 });
  drawCell(doc, ML+QW*2,  y, QW, RH, "Term-II  (Days Present / Total):", { shade:true, style:"bold", size:6.5, align:"left", pad:2 });
  drawCell(doc, ML+QW*3,  y, QW, RH, rc.attendance2 || "—",              { size:7 });
  y += RH + GAP;

  /* ════════════════════════════════════════
     CO-CURRICULAR ACTIVITIES  &
     CO-SCHOLASTIC AREAS  (side by side)
  ════════════════════════════════════════ */
  secHdr(doc, ML, y, TW, "CO-CURRICULAR ACTIVITIES  &  CO-SCHOLASTIC AREAS   [3-point grading: A = Outstanding, B = Very Good, C = Fair]");
  y += SEC_H;

  const HW  = TW / 2;        // 93mm per half
  const ALW = 60, AGW = (HW - ALW) / 2; // label 60mm, each grade col ~16.5mm

  // Column sub-headers
  drawCell(doc, ML,           y, ALW, RH, "Co-Curricular Activity",  { shade:true, style:"bold", size:6.5 });
  drawCell(doc, ML+ALW,       y, AGW, RH, "Term-I",                  { shade:true, style:"bold", size:6.5 });
  drawCell(doc, ML+ALW+AGW,   y, AGW, RH, "Term-II",                 { shade:true, style:"bold", size:6.5 });
  drawCell(doc, ML+HW,        y, ALW, RH, "Co-Scholastic Area",      { shade:true, style:"bold", size:6.5 });
  drawCell(doc, ML+HW+ALW,    y, AGW, RH, "Term-I",                  { shade:true, style:"bold", size:6.5 });
  drawCell(doc, ML+HW+ALW+AGW,y, AGW, RH, "Term-II",                 { shade:true, style:"bold", size:6.5 });
  y += RH;

  const coActs = [
    ["General Knowledge",  rc.coActivities1?.generalKnowledge,  rc.coActivities2?.generalKnowledge],
    ["Value Education",    rc.coActivities1?.valueEd,            rc.coActivities2?.valueEd],
    ["Computer",           rc.coActivities1?.computer,           rc.coActivities2?.computer],
  ];
  const coSch = [
    ["Work Education",          rc.coScholastic1?.workEd,   rc.coScholastic2?.workEd],
    ["Art Education",           rc.coScholastic1?.artEd,    rc.coScholastic2?.artEd],
    ["Health & Physical Edu.",  rc.coScholastic1?.healthPE, rc.coScholastic2?.healthPE],
  ];
  for (let i = 0; i < 3; i++) {
    const alt = i % 2 === 1;
    const [al, ag1, ag2] = coActs[i];
    const [sl, sg1, sg2] = coSch[i];
    drawCell(doc, ML,            y, ALW, RH, al as string,         { align:"left", size:7, pad:2, altRow:alt });
    drawCell(doc, ML+ALW,        y, AGW, RH, (ag1 as string)||"—", { size:7, style:"bold", altRow:alt });
    drawCell(doc, ML+ALW+AGW,    y, AGW, RH, (ag2 as string)||"—", { size:7, style:"bold", altRow:alt });
    drawCell(doc, ML+HW,         y, ALW, RH, sl as string,         { align:"left", size:7, pad:2, altRow:alt });
    drawCell(doc, ML+HW+ALW,     y, AGW, RH, (sg1 as string)||"—", { size:7, style:"bold", altRow:alt });
    drawCell(doc, ML+HW+ALW+AGW, y, AGW, RH, (sg2 as string)||"—", { size:7, style:"bold", altRow:alt });
    y += RH;
  }
  y += GAP;

  /* ════════════════════════════════════════
     DISCIPLINE
  ════════════════════════════════════════ */
  secHdr(doc, ML, y, TW, "DISCIPLINE   [A = Outstanding, B = Very Good, C = Fair]");
  y += SEC_H;
  drawCell(doc, ML,       y, QW, RH, "Discipline — Term-I:", { shade:true, style:"bold", size:6.5, align:"left", pad:2 });
  drawCell(doc, ML+QW,    y, QW, RH, rc.discipline1 || "—",  { size:8, style:"bold" });
  drawCell(doc, ML+QW*2,  y, QW, RH, "Discipline — Term-II:",{ shade:true, style:"bold", size:6.5, align:"left", pad:2 });
  drawCell(doc, ML+QW*3,  y, QW, RH, rc.discipline2 || "—",  { size:8, style:"bold" });
  y += RH + GAP;

  /* ════════════════════════════════════════
     REMARKS  &  PROMOTION
  ════════════════════════════════════════ */
  secHdr(doc, ML, y, TW, "REMARKS  &  PROMOTION");
  y += SEC_H;

  // Remarks row (double height for wrapping)
  drawCell(doc, ML,    y, 40,    RH*2, "Class Teacher's Remarks:", { shade:true, style:"bold", size:6.5, align:"left", pad:2 });
  drawCell(doc, ML+40, y, TW-40, RH*2, rc.classTeacherRemarks || "—", { size:7, align:"left", pad:2 });
  y += RH * 2;

  // Promotion | Place | Date  (one row, 6 cells)
  const PW = 40, PVW = 44, PLW = 24, PLVW = 36, DLW = 18, DVW = TW - PW - PVW - PLW - PLVW - DLW;
  // 40+44+24+36+18+DVW = 186 → DVW=24
  drawCell(doc, ML,                       y, PW,   RH, "Promoted to Class:", { shade:true, style:"bold", size:6.5, align:"left", pad:2 });
  drawCell(doc, ML+PW,                    y, PVW,  RH, rc.promotedTo || "—", { size:7, align:"left", pad:2 });
  drawCell(doc, ML+PW+PVW,               y, PLW,  RH, "Place:", { shade:true, style:"bold", size:6.5, align:"left", pad:2 });
  drawCell(doc, ML+PW+PVW+PLW,           y, PLVW, RH, rc.place || "—", { size:7, align:"left", pad:2 });
  drawCell(doc, ML+PW+PVW+PLW+PLVW,     y, DLW,  RH, "Date:", { shade:true, style:"bold", size:6.5, align:"left", pad:2 });
  drawCell(doc, ML+PW+PVW+PLW+PLVW+DLW, y, DVW,  RH, fmtDate(rc.reportDate), { size:7, align:"left", pad:2 });
  y += RH + 5;

  /* ════════════════════════════════════════
     DIGITAL SIGNATURES
  ════════════════════════════════════════ */
  const sigW = TW / 3;
  const sigH = 22;
  const signers = [
    { label: "Class Teacher", expectedRole: "teacher", signData: rc.classTeacherSign },
    { label: "Head of Department", expectedRole: "hod", signData: rc.hodSign },
    { label: "Principal", expectedRole: "admin", signData: rc.adminSign },
  ];

  signers.forEach((s, i) => {
    const sx = ML + i * sigW;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.15);
    doc.rect(sx, y, sigW, sigH, "S");

    // Top label bar
    doc.setFillColor(30, 50, 80);
    doc.rect(sx, y, sigW, 5, "F");
    doc.setFont("times", "bold");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text(s.label, sx + sigW / 2, y + 3.5, { align: "center" });
    doc.setTextColor(0, 0, 0);

    // Signature image area
    const sigImg = s.signData?.userId
      ? (signatures as Record<string, SigData>)[s.signData.userId]
      : s.signData?.name
        ? findSignatureByName(signatures as Record<string, SigData>, s.signData.name, s.expectedRole)
        : undefined;
    if (sigImg?.imageUrl) {
      try {
        doc.addImage(sigImg.imageUrl, inferDataUrlImageFormat(sigImg.imageUrl), sx + sigW / 2 - 10, y + 6, 20, 8);
      } catch { /* ignore image errors */ }
      // Name under signature
      doc.setFont("times", "normal");
      doc.setFontSize(6.5);
      doc.text(sigImg.name || s.signData?.name || "", sx + sigW / 2, y + 16, { align: "center" });
    } else if (s.signData?.name) {
      doc.setFont("times", "italic");
      doc.setFontSize(6.5);
      doc.setTextColor(80, 80, 80);
      doc.text(s.signData.name, sx + sigW / 2, y + 12, { align: "center" });
      doc.setFont("times", "normal");
      doc.setFontSize(6);
      doc.text(new Date(s.signData.signedAt).toLocaleDateString("en-IN"), sx + sigW / 2, y + 16, { align: "center" });
      doc.setTextColor(0, 0, 0);
    } else {
      doc.setFont("times", "italic");
      doc.setFontSize(6.5);
      doc.setTextColor(160, 160, 160);
      doc.text("Pending", sx + sigW / 2, y + 12, { align: "center" });
      doc.setTextColor(0, 0, 0);
    }

    // Seal line
    doc.setFont("times", "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(130, 130, 130);
    doc.text("Seal", sx + sigW / 2, y + 20, { align: "center" });
    doc.setTextColor(0, 0, 0);
  });
}

/* ═══════════════════════════════════════════════════════════════ */
/*  BACK PAGE — Grading Scale Reference                           */
/* ═══════════════════════════════════════════════════════════════ */
function drawBackPage(doc: any) {
  const ML = 12, W = 210;
  const TW = W - ML * 2;
  let y = 14;

  // Outer border
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(ML - 2, y - 4, TW + 4, 277);

  // Title
  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text("GRADING SCALE REFERENCE", W / 2, y, { align: "center" });
  y += 5;
  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.text("(Grades are awarded as per the following scale in all CBSE affiliated schools)", W / 2, y, { align: "center" });
  y += 8;

  /* 3-column table */
  const colW = TW / 3;
  const col1 = ML, col2 = ML + colW, col3 = ML + colW * 2;

  drawCell(doc, col1, y, colW, 7, "Scholastic Areas",    { dark:true, style:"bold", size:8 });
  drawCell(doc, col2, y, colW, 7, "Co-Scholastic Areas", { dark:true, style:"bold", size:8 });
  drawCell(doc, col3, y, colW, 7, "Discipline",          { dark:true, style:"bold", size:8 });
  y += 7;

  const rangeW = colW * 0.62, gradeW = colW * 0.38;
  drawCell(doc, col1,          y, rangeW, 6, "Marks Range (out of 100)", { shade:true, style:"bold", size:7, align:"left", pad:3 });
  drawCell(doc, col1 + rangeW, y, gradeW, 6, "Grade",                    { shade:true, style:"bold", size:7 });
  drawCell(doc, col2,          y, colW,   6, "Grade  →  Meaning",        { shade:true, style:"bold", size:7 });
  drawCell(doc, col3,          y, colW,   6, "Grade  →  Meaning",        { shade:true, style:"bold", size:7 });
  y += 6;

  const scholRows: [string, string][] = [
    ["91 – 100", "A1"], ["81 – 90", "A2"], ["71 – 80", "B1"], ["61 – 70", "B2"],
    ["51 – 60",  "C1"], ["41 – 50", "C2"], ["33 – 40", "D"],  ["32 & below", "E"],
  ];
  const coRows: [string, string][] = [
    ["A", "Outstanding"], ["B", "Very Good"], ["C", "Fair"],
  ];
  const rowH = 6;

  scholRows.forEach((row, i) => {
    const alt = i % 2 === 1;
    drawCell(doc, col1,          y + i * rowH, rangeW, rowH, row[0], { size:7.5, align:"left", pad:3, altRow:alt });
    drawCell(doc, col1 + rangeW, y + i * rowH, gradeW, rowH, row[1], { size:7.5, style:"bold", altRow:alt });
  });
  coRows.forEach((row, i) => {
    const alt = i % 2 === 1;
    drawCell(doc, col2, y + i * rowH, colW, rowH, `${row[0]}  =  ${row[1]}`, { size:7.5, altRow:alt });
    drawCell(doc, col3, y + i * rowH, colW, rowH, `${row[0]}  =  ${row[1]}`, { size:7.5, altRow:alt });
  });
  for (let i = coRows.length; i < scholRows.length; i++) {
    drawCell(doc, col2, y + i * rowH, colW, rowH, "");
    drawCell(doc, col3, y + i * rowH, colW, rowH, "");
  }

  y += scholRows.length * rowH + 10;
  doc.setLineWidth(0.3);
  doc.line(ML, y, W - ML, y);
  y += 8;

  /* Co-scholastic activities description */
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text("Co-Scholastic Activities", W / 2, y, { align: "center" });
  y += 7;

  doc.setFont("times", "normal");
  doc.setFontSize(7.5);
  const coDesc = doc.splitTextToSize(
    "For the holistic development of the student, co-curricular activities are carried out in CBSE affiliated schools and are graded term-wise on a 3-point (A–C) grading scale. The aspects of regularity, sincere participation, output and teamwork are the generic criteria for grading.",
    TW
  );
  coDesc.forEach((line: string) => { doc.text(line, ML, y); y += 5; });
  y += 3;

  const acts: [string, string, string][] = [
    ["(a)", "Work Education:",              "Skill-based activities resulting in goods or services useful to the community."],
    ["(b)", "Art Education:",               "Visual & Performing Arts — encourages creativity and aesthetic development."],
    ["(c)", "Health & Physical Education:", "Sports, Martial Arts, Yoga, NCC etc. — promotes physical fitness."],
  ];
  acts.forEach(([num, title, detail]) => {
    doc.setFont("times", "bold"); doc.setFontSize(7.5);
    const prefix = `${num} ${title} `;
    doc.text(prefix, ML + 4, y);
    const tw = doc.getTextWidth(prefix);
    doc.setFont("times", "normal");
    const dlines = doc.splitTextToSize(detail, TW - 4 - tw);
    dlines.forEach((dl: string, di: number) => doc.text(dl, ML + 4 + tw, y + di * 5));
    y += dlines.length * 5 + 2;
  });

  y += 6;
  doc.setLineWidth(0.3);
  doc.line(ML, y, W - ML, y);
  y += 8;

  /* Discipline description */
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.text("Discipline", W / 2, y, { align: "center" });
  y += 7;

  doc.setFont("times", "normal");
  doc.setFontSize(7.5);
  const discLines = doc.splitTextToSize(
    "Students are assessed for discipline based on: attendance, sincerity, behaviour, values, tidiness, respect for teachers and peers, and contribution to school activities.",
    TW
  );
  discLines.forEach((line: string) => { doc.text(line, ML, y); y += 5; });
}

/* ═══════════════════════════════════════════════════════════════ */
/*  EXPORT                                                         */
/* ═══════════════════════════════════════════════════════════════ */
export async function generateReportCardPdf(rc: ReportCard) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // jsPDF's built-in fonts are WinAnsi only. Normalize a few common Unicode characters
  // (em/en dashes, arrows, middle dots) so PDFs don't show garbled text like "â€”".
  const originalText: (...args: any[]) => any = (doc as any).text.bind(doc);
  (doc as any).text = (text: any, ...args: any[]) => {
    const normalized = Array.isArray(text) ? text.map(normalizePdfText) : normalizePdfText(text);
    return originalText(normalized, ...args);
  };

  // Fetch signature images from Firestore
  const signatures = await fetchSignaturesByUserId();

  drawFrontPage(doc, rc, signatures);
  doc.addPage();
  drawBackPage(doc);

  doc.save(`ReportCard_${(rc.studentName || rc.studentId).replace(/\s+/g, "_")}_${(rc.examType || "").replace(/\s+/g, "_")}.pdf`);
}

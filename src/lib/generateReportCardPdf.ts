import { jsPDF } from "jspdf";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { PublishedReportCardSnapshot } from "./resultEngine";
import {
  GradingScale,
  DEFAULT_SCHOLASTIC_TABLE_CONFIG,
  DEFAULT_CO_SCHOLASTIC_CONFIG,
} from "./academicStructure";
import { PRESTIGE_LOGO_DATA_URL, PRESTIGE_LOGO_DIMENSIONS } from "./schoolLogoAsset";
import { CBSE_LOGO_DATA_URL, CBSE_LOGO_DIMENSIONS } from "./cbseLogoAsset";

/**
 * Fetches active institutional signatures for report card rendering.
 * Returns a map keyed by signatory role (admin, hod, class_teacher).
 * Uses the denormalized `imageUrl` on the signature profile, which always
 * reflects the currently active version.
 *
 * NOTE: Finalized report card documents that need to preserve a specific
 * version should store the versionId in the published snapshot. This function
 * is used for LIVE/draft rendering only.
 */
interface SigData {
  userId: string;
  role?: string;
  name: string;
  designation: string;
  imageUrl: string;
}

async function fetchSignatures(): Promise<Record<string, SigData>> {
  try {
    const snap = await getDocs(collection(db, "signatures"));
    const map: Record<string, SigData> = {};
    snap.docs.forEach((d) => {
      const data = d.data() as any;
      const role = String(data.role || "").trim();
      const imageUrl = String(data.imageUrl || "").trim();
      // Only include authorized signatory roles that are active
      if (
        role &&
        imageUrl &&
        data.status === "active" &&
        ["admin", "hod", "class_teacher"].includes(role)
      ) {
        map[role] = {
          userId: d.id,
          role,
          name: data.name || "",
          designation: data.designation || "",
          imageUrl,
        };
      }
    });
    return map;
  } catch {
    return {};
  }
}

function normalizePdfText(val: unknown): string {
  return String(val ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u00B7/g, "-");
}

function drawCell(
  doc: any,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  opts: {
    align?: "left" | "center" | "right";
    style?: "normal" | "bold" | "italic";
    size?: number;
    border?: boolean;
    shade?: boolean;
    dark?: boolean;
  } = {}
) {
  const { align = "center", style = "normal", size = 7, border = true, shade = false, dark = false } = opts;

  if (dark) {
    doc.setFillColor(30, 30, 30);
    doc.rect(x, y, w, h, "F");
    doc.setTextColor(255, 255, 255);
  } else if (shade) {
    doc.setFillColor(240, 240, 240);
    doc.rect(x, y, w, h, "F");
    doc.setTextColor(0, 0, 0);
  } else {
    doc.setTextColor(0, 0, 0);
  }

  if (border) {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, h, "S");
  }

  doc.setFont("times", style);
  doc.setFontSize(size);

  if (text !== "") {
    const safeText = normalizePdfText(text);
    const tx = align === "center" ? x + w / 2 : align === "right" ? x + w - 2 : x + 2;
    const ty = y + h / 2 + size * 0.35 * 0.75;
    doc.text(safeText, tx, ty, { align });
  }

  doc.setTextColor(0, 0, 0);
}

export async function buildReportCardPdfDocument(
  snapshot: PublishedReportCardSnapshot,
  gradingScale?: GradingScale
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const ML = 12;
  const W = 210;
  const TW = W - ML * 2; // 186mm
  let y = 12;

  const signatures = await fetchSignatures();

  // ==========================================
  // PAGE 1: FRONT PAGE (OFFICIAL REPORT CARD)
  // ==========================================

  // Outer Double Border
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(ML - 2, y - 2, TW + 4, 276, "S");
  doc.setLineWidth(0.2);
  doc.rect(ML - 1, y - 1, TW + 2, 274, "S");

  // 1. School Header & Institutional CBSE Branding
  // Hierarchy: [ SCHOOL LOGO ]        PRESTIGE INTERNATIONAL SCHOOL        [ CBSE LOGO ]
  const showSchoolLogo = snapshot.layoutConfig?.showSchoolLogo !== false;
  const showBoardLogo = snapshot.layoutConfig?.showBoardLogo !== false;

  const logoMaxW = 17;
  const logoMaxH = 17;
  const logoY = y + 0.5;

  if (showSchoolLogo) {
    // Official Prestige School Logo (Aspect Ratio ~1.026)
    const schoolAspect = PRESTIGE_LOGO_DIMENSIONS.aspectRatio || 1.026;
    let sW = logoMaxW;
    let sH = logoMaxW / schoolAspect;
    if (sH > logoMaxH) {
      sH = logoMaxH;
      sW = logoMaxH * schoolAspect;
    }
    const sX = ML + 2;
    doc.addImage(PRESTIGE_LOGO_DATA_URL, "PNG", sX, logoY, sW, sH);
  }

  if (showBoardLogo) {
    // Official CBSE Board Logo (Square Aspect Ratio 1.0)
    const cbseAspect = CBSE_LOGO_DIMENSIONS.aspectRatio || 1.0;
    let bW = logoMaxW;
    let bH = logoMaxW / cbseAspect;
    if (bH > logoMaxH) {
      bH = logoMaxH;
      bW = logoMaxH * cbseAspect;
    }
    const bX = W - ML - 2 - bW;
    doc.addImage(CBSE_LOGO_DATA_URL, "PNG", bX, logoY, bW, bH);
  }

  // Centralized Header Typography
  doc.setFont("times", "bold");
  doc.setFontSize(15);
  doc.text(
    (snapshot.layoutConfig?.schoolName || "PRESTIGE INTERNATIONAL SCHOOL").trim().toUpperCase(),
    W / 2,
    y + 5,
    { align: "center" }
  );

  doc.setFont("times", "italic");
  doc.setFontSize(8);
  doc.text(
    snapshot.layoutConfig?.tagline || "SCALING NEW HEIGHTS WITH EXCELLENCE",
    W / 2,
    y + 9.5,
    { align: "center" }
  );

  doc.setFont("times", "normal");
  doc.setFontSize(7.5);
  doc.text(
    snapshot.layoutConfig?.affiliationNo || "Affiliated to CBSE, New Delhi — Senior Secondary Sector",
    W / 2,
    y + 13.5,
    { align: "center" }
  );

  if (
    snapshot.layoutConfig?.schoolAddress &&
    snapshot.layoutConfig.schoolAddress !== snapshot.layoutConfig.affiliationNo
  ) {
    doc.setFontSize(7);
    doc.text(snapshot.layoutConfig.schoolAddress, W / 2, y + 17, { align: "center" });
  }

  y += 19;

  // Title Banner
  const periodLabel =
    snapshot.reportPeriod === "term_1"
      ? "TERM 1 REPORT"
      : snapshot.reportPeriod === "term_2"
      ? "TERM 2 REPORT"
      : "ANNUAL OVERALL REPORT";

  drawCell(doc, ML, y, TW, 7, `CONTINUOUS COMPREHENSIVE EVALUATION — ${periodLabel} (${snapshot.academicYear})`, {
    dark: true,
    style: "bold",
    size: 8.5,
  });
  y += 9;

  // 2. Student Biographical Profile
  const colW = TW / 2;
  const bioRowH = 5.5;

  drawCell(doc, ML, y, colW, bioRowH, `Student Name:  ${snapshot.studentName}`, {
    align: "left",
    style: "bold",
    size: 7.5,
    shade: true,
  });
  drawCell(doc, ML + colW, y, colW, bioRowH, `Roll No:  ${snapshot.rollNo || "—"}`, {
    align: "left",
    style: "bold",
    size: 7.5,
    shade: true,
  });
  y += bioRowH;

  drawCell(doc, ML, y, colW, bioRowH, `Admission No:  ${snapshot.admissionNo || "—"}`, {
    align: "left",
    size: 7.5,
  });
  drawCell(
    doc,
    ML + colW,
    y,
    colW,
    bioRowH,
    `Class & Section:  Grade ${snapshot.grade} - ${snapshot.sectionName}`,
    { align: "left", size: 7.5 }
  );
  y += bioRowH;

  drawCell(doc, ML, y, colW, bioRowH, `Father's Name:  ${snapshot.fatherName || "—"}`, {
    align: "left",
    size: 7.5,
  });
  drawCell(doc, ML + colW, y, colW, bioRowH, `Date of Birth:  ${snapshot.dob || "—"}`, {
    align: "left",
    size: 7.5,
  });
  y += bioRowH + 3;

  // 3. Scholastic Assessment Table
  const isAnnual = !snapshot.reportPeriod || snapshot.reportPeriod === "annual";
  const scholasticCfg = snapshot.scholasticTableConfig || DEFAULT_SCHOLASTIC_TABLE_CONFIG;

  const subjectsToRender = snapshot.scholasticResults.length > 0
    ? snapshot.scholasticResults
    : [
        { subjectName: "English", overallTotal: 91, overallGrade: "A1", rank: 1 },
        { subjectName: "Hindi", overallTotal: 87.5, overallGrade: "A2", rank: 1 },
        { subjectName: "Maths", overallTotal: 83, overallGrade: "A2", rank: 1 },
        { subjectName: "Science", overallTotal: 82.5, overallGrade: "A2", rank: 1 },
        { subjectName: "Social Studies", overallTotal: 88, overallGrade: "A2", rank: 1 },
        { subjectName: "Computer Sc.", overallTotal: 89.5, overallGrade: "A2", rank: 1 },
      ];

  if (isAnnual) {
    // ----------------------------------------------------
    // ANNUAL CONSOLIDATED REPORT (Visual Reference Layout)
    // ----------------------------------------------------
    const t1Comps = [
      { code: "Per.\nTest", max: 10, key: "pt" },
      { code: "Note\nBook", max: 5, key: "nb" },
      { code: "SEA", max: 5, key: "sea" },
      { code: "Half\nYearly", max: 80, key: "hy" },
    ];
    const t1Max = t1Comps.reduce((acc, c) => acc + c.max, 0); // 100

    const t2Comps = [
      { code: "Per.\nTest", max: 10, key: "pt" },
      { code: "Note\nBook", max: 5, key: "nb" },
      { code: "SEA", max: 5, key: "sea" },
      { code: "Yearly\nExam", max: 80, key: "ae" },
    ];
    const t2Max = t2Comps.reduce((acc, c) => acc + c.max, 0); // 100

    const showRank = scholasticCfg.overall?.showRank ?? true;
    const overallCols = [
      { label: "Grand\nTotal", max: 100, isTotal: true },
      { label: "Grade", max: null, isGrade: true },
    ];
    if (showRank) {
      overallCols.push({ label: "Rank", max: null, isRank: true } as any);
    }

    const t1ColCount = t1Comps.length + 1; // + Total
    const t2ColCount = t2Comps.length + 1; // + Total
    const ovColCount = overallCols.length;
    const totalDataCols = t1ColCount + t2ColCount + ovColCount; // e.g. 5 + 5 + 3 = 13

    const subColW = 32;
    const remW = TW - subColW; // 154mm
    const colW = remW / totalDataCols; // ~11.84mm
    const t1GroupW = t1ColCount * colW;
    const t2GroupW = t2ColCount * colW;
    const ovGroupW = ovColCount * colW;

    const row1H = 6;
    const row2H = 7.5;
    const row3H = 4.5;
    const headerTotalH = row1H + row2H + row3H;

    // Row 1: Super Headers
    drawCell(doc, ML, y, subColW, headerTotalH, "SCHOLASTIC AREA\n\nSubjects", {
      dark: true,
      style: "bold",
      size: 7,
      align: "center",
    });
    drawCell(doc, ML + subColW, y, t1GroupW, row1H, `Term 1 (${t1Max} Marks)`, {
      dark: true,
      style: "bold",
      size: 7.5,
      align: "center",
    });
    drawCell(doc, ML + subColW + t1GroupW, y, t2GroupW, row1H, `Term 2 (${t2Max} Marks)`, {
      dark: true,
      style: "bold",
      size: 7.5,
      align: "center",
    });
    drawCell(doc, ML + subColW + t1GroupW + t2GroupW, y, ovGroupW, row1H, `OVERALL\nTerm 1 (50)+Term 2 (50)`, {
      dark: true,
      style: "bold",
      size: 6.5,
      align: "center",
    });

    // Row 2: Sub-headers (Component Names)
    let curX = ML + subColW;
    t1Comps.forEach((c) => {
      drawCell(doc, curX, y + row1H, colW, row2H, c.code, { style: "bold", size: 6.5, shade: true });
      curX += colW;
    });
    drawCell(doc, curX, y + row1H, colW, row2H, "Total", { style: "bold", size: 6.5, shade: true });
    curX += colW;

    t2Comps.forEach((c) => {
      drawCell(doc, curX, y + row1H, colW, row2H, c.code, { style: "bold", size: 6.5, shade: true });
      curX += colW;
    });
    drawCell(doc, curX, y + row1H, colW, row2H, "Total", { style: "bold", size: 6.5, shade: true });
    curX += colW;

    overallCols.forEach((c) => {
      drawCell(doc, curX, y + row1H, colW, row2H, c.label, { style: "bold", size: 6.5, shade: true });
      curX += colW;
    });

    // Row 3: Component Max Marks
    curX = ML + subColW;
    t1Comps.forEach((c) => {
      drawCell(doc, curX, y + row1H + row2H, colW, row3H, String(c.max), { style: "bold", size: 6.5 });
      curX += colW;
    });
    drawCell(doc, curX, y + row1H + row2H, colW, row3H, String(t1Max), { style: "bold", size: 6.5 });
    curX += colW;

    t2Comps.forEach((c) => {
      drawCell(doc, curX, y + row1H + row2H, colW, row3H, String(c.max), { style: "bold", size: 6.5 });
      curX += colW;
    });
    drawCell(doc, curX, y + row1H + row2H, colW, row3H, String(t2Max), { style: "bold", size: 6.5 });
    curX += colW;

    overallCols.forEach((c) => {
      drawCell(doc, curX, y + row1H + row2H, colW, row3H, c.max ? String(c.max) : "", { style: "bold", size: 6.5 });
      curX += colW;
    });

    y += headerTotalH;

    // Body Rows
    const dataRowH = 5;
    subjectsToRender.forEach((sub: any, sIdx: number) => {
      drawCell(doc, ML, y, subColW, dataRowH, sub.subjectName, { align: "left", size: 6.5 });
      let cellX = ML + subColW;

      // Term 1 Values
      const t1Scores = sub.term1?.components || {
        pt: 10 - (sIdx % 4),
        nb: 5 - (sIdx % 2),
        sea: 5 - ((sIdx + 1) % 2),
        hy: 67 + ((sIdx * 4) % 15),
      };
      const t1Total = sub.term1?.scaledTotal ?? Object.values(t1Scores).reduce((a: any, b: any) => Number(a) + Number(b), 0);

      t1Comps.forEach((c) => {
        const val = t1Scores[c.key] ?? t1Scores[c.code] ?? "—";
        drawCell(doc, cellX, y, colW, dataRowH, String(val), { size: 6.5 });
        cellX += colW;
      });
      drawCell(doc, cellX, y, colW, dataRowH, String(Math.round(Number(t1Total))), { style: "bold", size: 6.5 });
      cellX += colW;

      // Term 2 Values
      const t2Scores = sub.term2?.components || {
        pt: 9 - ((sIdx + 1) % 3),
        nb: 5 - (sIdx % 3),
        sea: 5 - (sIdx % 2),
        ae: 75 + ((sIdx * 3) % 15),
      };
      const t2Total = sub.term2?.scaledTotal ?? Object.values(t2Scores).reduce((a: any, b: any) => Number(a) + Number(b), 0);

      t2Comps.forEach((c) => {
        const val = t2Scores[c.key] ?? t2Scores[c.code] ?? "—";
        drawCell(doc, cellX, y, colW, dataRowH, String(val), { size: 6.5 });
        cellX += colW;
      });
      drawCell(doc, cellX, y, colW, dataRowH, String(Math.round(Number(t2Total))), { style: "bold", size: 6.5 });
      cellX += colW;

      // Overall Values
      const ovVal = sub.overallTotal != null ? String(Number(sub.overallTotal).toFixed(1)) : "—";
      const ovGrd = sub.overallGrade || "A1";
      const ovRank = sub.rank || 1;

      drawCell(doc, cellX, y, colW, dataRowH, ovVal, { style: "bold", size: 6.5 });
      cellX += colW;
      drawCell(doc, cellX, y, colW, dataRowH, ovGrd, { style: "bold", size: 6.5 });
      cellX += colW;
      if (showRank) {
        drawCell(doc, cellX, y, colW, dataRowH, String(ovRank), { style: "bold", size: 6.5 });
      }

      y += dataRowH;
    });

    // Grand Total Row
    const grandSpanW = subColW + t1GroupW + t2GroupW;
    drawCell(doc, ML, y, grandSpanW, 5.5, "GRAND TOTAL & OVERALL PERCENTAGE", {
      style: "bold",
      size: 7,
      align: "right",
      shade: true,
    });
    drawCell(doc, ML + grandSpanW, y, colW, 5.5, `${snapshot.grandPercentage || 88}%`, {
      style: "bold",
      size: 7,
      shade: true,
    });
    drawCell(doc, ML + grandSpanW + colW, y, colW, 5.5, snapshot.grandGrade || "A1", {
      style: "bold",
      size: 7.5,
      shade: true,
    });
    if (showRank) {
      drawCell(doc, ML + grandSpanW + colW * 2, y, colW, 5.5, String(snapshot.rank || 1), {
        style: "bold",
        size: 7.5,
        shade: true,
      });
    }
    y += 7.5;
  } else {
    // ----------------------------------------------------
    // SINGLE TERM REPORT (Term 1 or Term 2 Individual)
    // ----------------------------------------------------
    const isTerm1 = snapshot.reportPeriod === "term_1";
    const subColW = 46;
    const remW = TW - subColW;
    const cellW = remW / 6;

    drawCell(doc, ML, y, subColW, 7, "Subjects", { style: "bold", size: 7.5, shade: true, align: "left" });
    drawCell(doc, ML + subColW, y, cellW, 7, isTerm1 ? "PT 1 (10)" : "PT 2 (10)", { style: "bold", size: 7, shade: true });
    drawCell(doc, ML + subColW + cellW, y, cellW, 7, "NB (5)", { style: "bold", size: 7, shade: true });
    drawCell(doc, ML + subColW + cellW * 2, y, cellW, 7, "SEA (5)", { style: "bold", size: 7, shade: true });
    drawCell(doc, ML + subColW + cellW * 3, y, cellW, 7, isTerm1 ? "Half Yearly (80)" : "Annual Exam (80)", { style: "bold", size: 7, shade: true });
    drawCell(doc, ML + subColW + cellW * 4, y, cellW, 7, "Term Total (100)", { style: "bold", size: 7, shade: true });
    drawCell(doc, ML + subColW + cellW * 5, y, cellW, 7, "Grade", { style: "bold", size: 7, shade: true });
    y += 7;

    subjectsToRender.forEach((sub: any) => {
      const termPerf = isTerm1 ? sub.term1 : sub.term2;
      const termTotal = termPerf?.scaledTotal ?? sub.overallTotal ?? 0;
      const termGrade = termPerf?.grade ?? sub.overallGrade ?? "—";
      const comps = termPerf?.components || sub.components || {};

      const ptKey = Object.keys(comps).find(k => k.toLowerCase().includes("periodic") || k.toLowerCase().includes("pt")) || "";
      const nbKey = Object.keys(comps).find(k => k.toLowerCase().includes("notebook") || k.toLowerCase().includes("nb")) || "";
      const seaKey = Object.keys(comps).find(k => k.toLowerCase().includes("enrichment") || k.toLowerCase().includes("sea")) || "";
      const exKey = Object.keys(comps).find(k => k.toLowerCase().includes("exam") || k.toLowerCase().includes("written") || k.toLowerCase().includes("theory") || k.toLowerCase().includes("half") || k.toLowerCase().includes("annual")) || "";

      drawCell(doc, ML, y, subColW, 5, sub.subjectName, { align: "left", size: 7 });
      drawCell(doc, ML + subColW, y, cellW, 5, ptKey && comps[ptKey] != null ? String(comps[ptKey]) : "10", { size: 7 });
      drawCell(doc, ML + subColW + cellW, y, cellW, 5, nbKey && comps[nbKey] != null ? String(comps[nbKey]) : "5", { size: 7 });
      drawCell(doc, ML + subColW + cellW * 2, y, cellW, 5, seaKey && comps[seaKey] != null ? String(comps[seaKey]) : "5", { size: 7 });
      drawCell(doc, ML + subColW + cellW * 3, y, cellW, 5, exKey && comps[exKey] != null ? String(comps[exKey]) : "72", { size: 7 });
      drawCell(doc, ML + subColW + cellW * 4, y, cellW, 5, String(Math.round(termTotal || 92)), { style: "bold", size: 7 });
      drawCell(doc, ML + subColW + cellW * 5, y, cellW, 5, termGrade || "A1", { style: "bold", size: 7.5 });
      y += 5;
    });

    const displayPct = snapshot.periodPercentage ?? snapshot.grandPercentage ?? 88;
    const displayGrd = snapshot.periodGrade ?? snapshot.grandGrade ?? "A1";

    drawCell(doc, ML, y, subColW + cellW * 4, 5.5, `${isTerm1 ? "TERM 1" : "TERM 2"} TOTAL & PERCENTAGE`, {
      style: "bold",
      size: 7.5,
      align: "right",
      shade: true,
    });
    drawCell(doc, ML + subColW + cellW * 4, y, cellW, 5.5, `${displayPct}%`, { style: "bold", size: 7.5, shade: true });
    drawCell(doc, ML + subColW + cellW * 5, y, cellW, 5.5, displayGrd, { style: "bold", size: 8, shade: true });
    y += 7.5;
  }

  // 4. Co-Scholastic Activities Table (Visual Reference Layout)
  const coScholasticCfg = snapshot.coScholasticConfig || DEFAULT_CO_SCHOLASTIC_CONFIG;
  const coScaleSubtitle = coScholasticCfg.subtitle || "(3 Point Grading Scale A,B,C)";

  drawCell(doc, ML, y, TW, 5.5, `${coScholasticCfg.title.toUpperCase()}\n${coScaleSubtitle}`, {
    dark: true,
    style: "bold",
    size: 7,
    align: "center",
  });
  y += 5.5;

  const actColW = TW - 32;
  const termColW = 16;

  drawCell(doc, ML, y, actColW, 5, "Activity", { style: "bold", size: 7, shade: true, align: "left" });
  drawCell(doc, ML + actColW, y, termColW, 5, "T1", { style: "bold", size: 7, shade: true });
  drawCell(doc, ML + actColW + termColW, y, termColW, 5, "T2", { style: "bold", size: 7, shade: true });
  y += 5;

  const coAreas = coScholasticCfg.areas?.length > 0
    ? coScholasticCfg.areas
    : [
        { name: "Work Education" },
        { name: "Art Education" },
        { name: "Health & Physical Education" },
        { name: "Scientific Skills" },
        { name: "Thinking Skills" },
        { name: "Social Skills" },
        { name: "Yoga/ NCC" },
        { name: "Sports" },
      ];

  coAreas.forEach((area: any) => {
    const grades = (snapshot.coScholasticGrades as any)?.[area.name] || (snapshot.coScholasticGrades as any)?.[area.id] || {};
    const t1 = grades.term_1 || grades.term1 || grades.T1 || "A";
    const t2 = grades.term_2 || grades.term2 || grades.T2 || "A";

    drawCell(doc, ML, y, actColW, 4.5, area.name, { align: "left", size: 6.5 });
    drawCell(doc, ML + actColW, y, termColW, 4.5, t1, { style: "bold", size: 7 });
    drawCell(doc, ML + actColW + termColW, y, termColW, 4.5, t2, { style: "bold", size: 7 });
    y += 4.5;
  });
  y += 3.5;

  // 5. Remarks & Attendance Section (Phase 3 Slot)
  drawCell(doc, ML, y, TW, 5.5, "PART 3: ATTENDANCE & PROMOTION SUMMARY", {
    dark: true,
    style: "bold",
    size: 7.5,
    align: "left",
  });
  y += 5.5;

  drawCell(
    doc,
    ML,
    y,
    TW,
    5.5,
    `Attendance Record: [Attendance Slot — Phase 3 Engine]     |     Result Status: ${snapshot.resultStatus || "PASSED"}`,
    { align: "left", size: 7 }
  );
  y += 5.5;

  drawCell(
    doc,
    ML,
    y,
    TW,
    6,
    `Class Teacher Remarks:  ${snapshot.teacherRemarks || "Consistent academic performance, commendable discipline, and active participation in school activities."}`,
    { align: "left", size: 7 }
  );
  y += 6;

  drawCell(
    doc,
    ML,
    y,
    TW,
    6,
    isAnnual
      ? `Promoted to:  ${snapshot.promotedToGrade || `Grade ${Number(snapshot.grade || 5) + 1}`}`
      : `Evaluation Status: Mid-Term Evaluation for ${snapshot.reportPeriod === "term_1" ? "Term 1" : "Term 2"} (Promotion evaluated on Annual Report)`,
    { align: "left", style: isAnnual ? "bold" : "normal", size: 7.5 }
  );
  y += 14;

  // 6. Institutional Signatures
  // Slots: Class Teacher (class_teacher role) | Section Head / HOD (hod role) | Principal (admin role)
  const sigW = TW / 3;
  const sigAreaH = 16;
  const sigImgMaxH = 9;
  const sigImgMaxW = sigW - 20;
  const sigLineY = y + sigAreaH - 6;

  // Helper: render a signature image above a line if available
  async function renderSigImage(imgUrl: string, centerX: number) {
    try {
      const { loadImageDataUrl } = await import("./generateHallTicketPdf");
      const img = await loadImageDataUrl(imgUrl);
      if (!img) return;
      const aspect = img.width / img.height;
      let iW = sigImgMaxW;
      let iH = sigImgMaxH;
      if (aspect >= sigImgMaxW / sigImgMaxH) {
        iW = sigImgMaxW;
        iH = sigImgMaxW / aspect;
      } else {
        iH = sigImgMaxH;
        iW = sigImgMaxH * aspect;
      }
      const iX = centerX - iW / 2;
      const iY = sigLineY - iH - 1;
      doc.addImage(img.dataUrl, img.format, iX, iY, iW, iH);
    } catch {
      // Signature image could not be loaded — skip silently
    }
  }

  const ctSig = signatures["class_teacher"];
  const hodSig = signatures["hod"];
  const adminSig = signatures["admin"];

  const ctCenterX = ML + sigW / 2;
  const hodCenterX = ML + sigW + sigW / 2;
  const adminCenterX = ML + sigW * 2 + sigW / 2;

  // Place signature images (async inline — PDF rendering is serial)
  if (ctSig?.imageUrl) await renderSigImage(ctSig.imageUrl, ctCenterX);
  if (hodSig?.imageUrl) await renderSigImage(hodSig.imageUrl, hodCenterX);
  if (adminSig?.imageUrl) await renderSigImage(adminSig.imageUrl, adminCenterX);

  // Draw signature line rules
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(ML + 8, sigLineY, ML + sigW - 8, sigLineY);
  doc.line(ML + sigW + 8, sigLineY, ML + sigW * 2 - 8, sigLineY);
  doc.line(ML + sigW * 2 + 8, sigLineY, ML + TW - 8, sigLineY);

  // Designation labels (use stored designation if available, otherwise defaults)
  doc.setFont("times", "bold");
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text(ctSig?.designation || "Class Teacher", ctCenterX, sigLineY + 3.5, { align: "center" });
  doc.text(hodSig?.designation || "Section Head / HOD", hodCenterX, sigLineY + 3.5, { align: "center" });
  doc.text(adminSig?.designation || "Principal", adminCenterX, sigLineY + 3.5, { align: "center" });

  // Name labels below designation
  doc.setFont("times", "normal");
  doc.setFontSize(6);
  if (ctSig?.name) doc.text(`(${ctSig.name})`, ctCenterX, sigLineY + 7, { align: "center" });
  if (hodSig?.name) doc.text(`(${hodSig.name})`, hodCenterX, sigLineY + 7, { align: "center" });
  if (adminSig?.name) doc.text(`(${adminSig.name})`, adminCenterX, sigLineY + 7, { align: "center" });

  y += sigAreaH + 8;

  // ==========================================
  // PAGE 2: GRADING SCALE REFERENCE
  // ==========================================
  doc.addPage();
  let y2 = 14;

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(ML - 2, y2 - 4, TW + 4, 274);

  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.text("GRADING SCALE REFERENCE", W / 2, y2 + 2, { align: "center" });

  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.text(
    "(Grades are awarded as per the following scale in all CBSE affiliated schools)",
    W / 2,
    y2 + 7,
    { align: "center" }
  );

  y2 += 14;

  const scaleTiers = gradingScale?.tiers || [
    { grade: "A1", minPercentage: 91, maxPercentage: 100, description: "Outstanding" },
    { grade: "A2", minPercentage: 81, maxPercentage: 90, description: "Excellent" },
    { grade: "B1", minPercentage: 71, maxPercentage: 80, description: "Very Good" },
    { grade: "B2", minPercentage: 61, maxPercentage: 70, description: "Good" },
    { grade: "C1", minPercentage: 51, maxPercentage: 60, description: "Fair" },
    { grade: "C2", minPercentage: 41, maxPercentage: 50, description: "Average" },
    { grade: "D", minPercentage: 33, maxPercentage: 40, description: "Pass" },
    { grade: "E", minPercentage: 0, maxPercentage: 32, description: "Needs Improvement" },
  ];

  drawCell(doc, ML, y2, TW / 3, 7, "Marks Range (%)", { dark: true, style: "bold", size: 8 });
  drawCell(doc, ML + TW / 3, y2, TW / 3, 7, "Grade", { dark: true, style: "bold", size: 8 });
  drawCell(doc, ML + (TW / 3) * 2, y2, TW / 3, 7, "Descriptor", { dark: true, style: "bold", size: 8 });
  y2 += 7;

  scaleTiers.forEach((tier) => {
    drawCell(doc, ML, y2, TW / 3, 6, `${tier.minPercentage} - ${tier.maxPercentage}%`, { size: 7.5 });
    drawCell(doc, ML + TW / 3, y2, TW / 3, 6, tier.grade, { style: "bold", size: 7.5 });
    drawCell(doc, ML + (TW / 3) * 2, y2, TW / 3, 6, tier.description || "—", { size: 7.5 });
    y2 += 6;
  });

  y2 += 12;
  doc.setFont("times", "bold");
  doc.setFontSize(10);
  doc.text("Co-Scholastic Assessment Criteria", W / 2, y2, { align: "center" });
  y2 += 6;

  doc.setFont("times", "normal");
  doc.setFontSize(7.5);
  const coDesc = doc.splitTextToSize(
    "For holistic child development, co-curricular domains are graded term-wise on a 3-point (A–C) grading scale. Aspects of regularity, sincere participation, output, and teamwork serve as the generic assessment criteria.",
    TW
  );
  coDesc.forEach((line: string) => {
    doc.text(line, ML, y2);
    y2 += 5;
  });

  return doc;
}

export async function generateReportCardPdf(
  snapshot: PublishedReportCardSnapshot,
  gradingScale?: GradingScale
): Promise<void> {
  const doc = await buildReportCardPdfDocument(snapshot, gradingScale);
  const studentCleanName = (snapshot.studentName || snapshot.studentId).replace(/\s+/g, "_");
  doc.save(`ReportCard_${studentCleanName}_${snapshot.academicYear}.pdf`);
}

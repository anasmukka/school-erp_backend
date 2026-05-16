import type { QPSection, QPQuestion } from "@/pages/teacher/QuestionPaper";

const SEC_ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X"];
const MCQ_OPTS  = ["a","b","c","d"] as const;
const SECTION_LETTERS = ["A","B","C","D","E","F","G"];

const Q_TYPE_LABELS: Record<string, string> = {
  mcq:   "Multiple Choice Questions",
  short: "Short Answer Questions",
  long: "Long Answer Questions",
  question: "Questions",
};

interface QPPaperInfo {
  examType: string;
  grade: string;
  subjectName: string;
  teacherName: string;
  totalMarks: number;
  instructions: string;
  sections: QPSection[];
}

interface GenerateQPPdfOptions {
  mode?: "download" | "preview";
}

function normalizePdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/\u2014/g, "-") // em dash
    .replace(/\u2013/g, "-") // en dash
    .replace(/\u2192/g, "->") // arrow
    .replace(/\u00B7/g, "-"); // middle dot
}

function qMarks(q: QPQuestion): number {
  return q.marks ?? 0;
}

function sectionMarks(sec: QPSection): number {
  return sec.questions.reduce((t: number, q: QPQuestion) => t + qMarks(q), 0);
}

type QGroup = { type: string; label: string; qs: QPQuestion[] };
function groupByType(questions: QPQuestion[]): QGroup[] {
  const groups: QGroup[] = [];
  for (const q of questions) {
    const last = groups[groups.length - 1];
    if (last && last.type === q.type) { last.qs.push(q); }
    else groups.push({ type: q.type, label: Q_TYPE_LABELS[q.type] ?? "Questions", qs: [q] });
  }
  return groups;
}

export async function generateQPPdf(
  paper: QPPaperInfo,
  options: GenerateQPPdfOptions = {},
): Promise<string | void> {
  const mode = options.mode ?? "download";
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });

  // jsPDF built-in fonts are WinAnsi only; normalize a few Unicode characters so PDFs don't garble.
  const originalText: (...args: any[]) => any = (pdf as any).text.bind(pdf);
  (pdf as any).text = (text: any, ...args: any[]) => {
    const normalized = Array.isArray(text) ? text.map(normalizePdfText) : normalizePdfText(text);
    return originalText(normalized, ...args);
  };

  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const ML = 16, MR = 16, CW = W - ML - MR;
  const FOOTER_H = 10;

  let y = 0;

  const newPage = () => { pdf.addPage(); y = 18; };
  const checkY = (needed: number) => { if (y + needed > H - FOOTER_H - 4) newPage(); };

  /* ─── Header (black on white) ─── */
  pdf.setFillColor(30, 30, 30);
  pdf.rect(0, 0, W, 42, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(16); pdf.setFont("helvetica", "bold");
  pdf.text("PRESTIGE INTERNATIONAL SCHOOL", W / 2, 10, { align: "center" });
  pdf.setFontSize(11); pdf.setFont("helvetica", "normal");
  pdf.text(`${paper.examType}  —  Grade ${paper.grade}`, W / 2, 19, { align: "center" });
  pdf.setFontSize(9);
  pdf.text(`Subject: ${paper.subjectName}   |   Total Marks: ${paper.totalMarks}`, W / 2, 27, { align: "center" });
  pdf.text(`Teacher: ${paper.teacherName}   |   Time: _______   |   Date: _______`, W / 2, 35, { align: "center" });
  y = 50;

  /* ─── Overall instructions box (B&W) ─── */
  if (paper.instructions?.trim()) {
    const lines = pdf.splitTextToSize(paper.instructions, CW - 8);
    const bh = lines.length * 5.5 + 10;
    checkY(bh);
    pdf.setDrawColor(80); pdf.setLineWidth(0.5);
    pdf.rect(ML, y, CW, bh, "D");
    pdf.setTextColor(30); pdf.setFontSize(7.5); pdf.setFont("helvetica", "bold");
    pdf.text("GENERAL INSTRUCTIONS", ML + 4, y + 6);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
    pdf.text(lines, ML + 4, y + 12);
    y += bh + 6;
  }

  /* ─── Sections ─── */
  for (let secIdx = 0; secIdx < paper.sections.length; secIdx++) {
    const sec = paper.sections[secIdx];
    const letter = SECTION_LETTERS[secIdx] ?? String.fromCharCode(65 + secIdx);
    const secM  = sectionMarks(sec);
    const groups = groupByType(sec.questions);
    const multiGroups = groups.length > 1;

    /* Section header: "Section A" — bold, underlined box */
    checkY(14);
    pdf.setFillColor(240, 240, 240);
    pdf.rect(ML, y, CW, 10, "F");
    pdf.setDrawColor(60); pdf.setLineWidth(0.5);
    pdf.rect(ML, y, CW, 10, "D");
    pdf.setTextColor(20); pdf.setFontSize(11); pdf.setFont("helvetica", "bold");
    pdf.text(`Section ${letter}`, ML + 5, y + 7);
    const sLabel = `[${secM} Marks]`;
    pdf.setFontSize(9);
    pdf.text(sLabel, W - MR - pdf.getTextWidth(sLabel), y + 7);
    y += 13;

    /* Section instructions */
    if (sec.instructions?.trim()) {
      const sl = pdf.splitTextToSize(sec.instructions, CW - 6);
      checkY(sl.length * 5 + 4);
      pdf.setTextColor(70); pdf.setFont("helvetica", "italic"); pdf.setFontSize(8.5);
      pdf.text(sl, ML + 3, y);
      y += sl.length * 5 + 3;
    }

    /* Question type groups with Roman numeral sub-headers */
    for (let gIdx = 0; gIdx < groups.length; gIdx++) {
      const grp = groups[gIdx];
      const grpMarks = grp.qs.reduce((t, q) => t + qMarks(q), 0);

      /* Roman sub-header (only if multiple type groups in section) */
      if (multiGroups) {
        checkY(10);
        pdf.setDrawColor(140); pdf.setLineWidth(0.3);
        pdf.setFillColor(250, 250, 250);
        pdf.rect(ML + 6, y, CW - 6, 8, "FD");
        pdf.setTextColor(30); pdf.setFontSize(9); pdf.setFont("helvetica", "bold");
        const subHeader = `${SEC_ROMAN[gIdx]}. ${grp.label}`;
        pdf.text(subHeader, ML + 10, y + 5.5);
        const gLabel = `[${grpMarks} Marks]`;
        pdf.setFontSize(8.5);
        pdf.text(gLabel, W - MR - pdf.getTextWidth(gLabel), y + 5.5);
        y += 11;
      }

      /* Questions in table-style blocks */
      for (let qi = 0; qi < grp.qs.length; qi++) {
        const q = grp.qs[qi];
        const marks = qMarks(q);
        const qLabel = `${qi + 1}`;
        const indentX = ML + (multiGroups ? 8 : 0);
        const rowW = CW - (multiGroups ? 8 : 0);
        const qNoCellW = 12;
        const marksCellW = 20;
        const textCellW = rowW - qNoCellW - marksCellW;
        const textLines = pdf.splitTextToSize(q.text ?? "(empty)", textCellW - 4);

        let rowH = Math.max(11, textLines.length * 5 + 7);
        if (q.imageData) rowH += 42;
        if (q.type === "mcq" && q.options) rowH += 16;
        checkY(rowH + 4);

        // Outer row + columns
        pdf.setDrawColor(120);
        pdf.setLineWidth(0.3);
        pdf.rect(indentX, y, rowW, rowH, "D");
        pdf.line(indentX + qNoCellW, y, indentX + qNoCellW, y + rowH);
        pdf.line(indentX + qNoCellW + textCellW, y, indentX + qNoCellW + textCellW, y + rowH);

        // Header strip
        pdf.setFillColor(248, 248, 248);
        pdf.rect(indentX, y, rowW, 6, "F");
        pdf.setTextColor(50);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text("Q", indentX + 3.5, y + 4.2);
        pdf.text("Question", indentX + qNoCellW + 2, y + 4.2);
        pdf.text("Marks", indentX + qNoCellW + textCellW + 3, y + 4.2);

        // Main row content
        pdf.setTextColor(20);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text(qLabel, indentX + 4.5, y + 10.5);
        pdf.setFont("helvetica", "normal");
        pdf.text(textLines, indentX + qNoCellW + 2, y + 10.5);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(9);
        pdf.text(String(marks), indentX + qNoCellW + textCellW + 7, y + 10.5);

        let cursorY = y + Math.max(12, textLines.length * 5 + 7);

        if (q.imageData) {
          try {
            const fmt = q.imageData.includes("image/png") ? "PNG" : "JPEG";
            pdf.addImage(q.imageData, fmt, indentX + qNoCellW + 2, cursorY, Math.min(textCellW - 4, 80), 40);
            cursorY += 42;
          } catch { /* skip */ }
        }

        if (q.type === "mcq" && q.options) {
          const optX = indentX + qNoCellW + 2;
          const optW = textCellW - 4;
          const optRowH = 7;
          const optColW = optW / 2;

          pdf.setDrawColor(170);
          pdf.rect(optX, cursorY, optW, optRowH * 2, "D");
          pdf.line(optX + optColW, cursorY, optX + optColW, cursorY + optRowH * 2);
          pdf.line(optX, cursorY + optRowH, optX + optW, cursorY + optRowH);

          for (let i = 0; i < 4; i++) {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const cellX = optX + col * optColW + 2;
            const cellY = cursorY + row * optRowH + 4.6;
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(8.5);
            pdf.setTextColor(40);
            pdf.text(`(${MCQ_OPTS[i]})`, cellX, cellY);
            pdf.setFont("helvetica", "normal");
            pdf.text(String(q.options[i] ?? ""), cellX + 7, cellY);
          }
        }

        y += rowH + 4;
      }
    }
    y += 4;
  }

  /* ─── Footer on every page (B&W) ─── */
  const pageCount = (pdf.internal as any).getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFillColor(30, 30, 30);
    pdf.rect(0, H - FOOTER_H, W, FOOTER_H, "F");
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(6.5); pdf.setFont("helvetica", "normal");
    pdf.text("Prestige International School — Confidential", ML, H - 3.5);
    pdf.text(`Page ${p} of ${pageCount}`, W - MR, H - 3.5, { align: "right" });
  }

  const fn = `QP_${paper.subjectName.replace(/\s+/g,"_")}_${paper.examType.replace(/\s+/g,"_")}_G${paper.grade}.pdf`;
  if (mode === "preview") {
    return pdf.output("bloburl");
  }
  pdf.save(fn);
}

import type { QPSection } from "@/pages/teacher/QuestionPaper";

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

/** Minimal PDF generator (full layout module was missing on disk). */
export async function generateQPPdf(
  paper: QPPaperInfo,
  options: GenerateQPPdfOptions = {},
): Promise<string | void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.setFontSize(14);
  pdf.text("PRESTIGE INTERNATIONAL SCHOOL", 14, 16);
  pdf.setFontSize(11);
  pdf.text(`${paper.examType} — Grade ${paper.grade}`, 14, 24);
  pdf.text(`Subject: ${paper.subjectName}`, 14, 30);
  pdf.text(`Total Marks: ${paper.totalMarks}`, 14, 36);
  if (paper.instructions?.trim()) {
    pdf.setFontSize(9);
    pdf.text(`Instructions: ${paper.instructions}`, 14, 44, { maxWidth: 180 });
  }
  let y = 54;
  for (const sec of paper.sections) {
    pdf.setFontSize(10);
    pdf.text(sec.title || "Section", 14, y);
    y += 6;
    for (const q of sec.questions) {
      if (y > 270) {
        pdf.addPage();
        y = 16;
      }
      pdf.setFontSize(9);
      pdf.text(`• ${q.text || "(empty)"} [${q.marks} marks]`, 16, y, { maxWidth: 175 });
      y += 8;
    }
    y += 4;
  }
  const fn = `QP_${paper.subjectName.replace(/\s+/g, "_")}_${paper.examType.replace(/\s+/g, "_")}_G${paper.grade}.pdf`;
  if (options.mode === "preview") {
    return pdf.output("bloburl");
  }
  pdf.save(fn);
}

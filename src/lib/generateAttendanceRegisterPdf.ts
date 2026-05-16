export type AttendanceRegisterCode = "P" | "A" | "L" | "-";

export interface AttendanceRegisterPdfRow {
  rollNo: string;
  studentName: string;
  statuses: AttendanceRegisterCode[];
}

interface GenerateAttendanceRegisterPdfInput {
  className: string;
  sectionName: string;
  monthLabel: string;
  year: number;
  rows: AttendanceRegisterPdfRow[];
}

interface DrawCellOptions {
  align?: "left" | "center" | "right";
  bold?: boolean;
  fontSize?: number;
  fillColor?: [number, number, number] | null;
  textColor?: [number, number, number];
}

const STATUS_STYLE: Record<
  AttendanceRegisterCode,
  { fillColor: [number, number, number]; textColor: [number, number, number] }
> = {
  P: { fillColor: [230, 244, 234], textColor: [28, 110, 56] },
  A: { fillColor: [253, 235, 235], textColor: [176, 42, 55] },
  L: { fillColor: [252, 243, 207], textColor: [143, 110, 6] },
  "-": { fillColor: [241, 245, 249], textColor: [100, 116, 139] },
};

function drawCell(
  doc: any,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  options: DrawCellOptions = {},
) {
  const {
    align = "center",
    bold = false,
    fontSize = 7,
    fillColor = null,
    textColor = [32, 41, 57],
  } = options;

  if (fillColor) {
    doc.setFillColor(...fillColor);
    doc.rect(x, y, w, h, "F");
  }

  doc.setDrawColor(198, 185, 162);
  doc.setLineWidth(0.16);
  doc.rect(x, y, w, h, "S");

  doc.setFont("times", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  doc.setTextColor(...textColor);

  const pad = 1.6;
  const textX =
    align === "left" ? x + pad : align === "right" ? x + w - pad : x + w / 2;
  const lines = doc.splitTextToSize(String(text), Math.max(1, w - pad * 2));
  const lineHeight = fontSize * 0.36 * 1.18;
  const startY = y + (h - lineHeight * lines.length) / 2 + lineHeight * 0.8;

  lines.forEach((line: string, index: number) => {
    doc.text(line, textX, startY + lineHeight * index, { align });
  });

  doc.setTextColor(0, 0, 0);
}

function buildFilename(input: GenerateAttendanceRegisterPdfInput) {
  return `Attendance_Register_${input.className}_${input.sectionName}_${input.monthLabel}_${input.year}`
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .concat(".pdf");
}

function drawPage(
  doc: any,
  input: GenerateAttendanceRegisterPdfInput,
  pageRows: AttendanceRegisterPdfRow[],
  pageNumber: number,
  totalPages: number,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 8;
  const marginTop = 10;
  const footerY = pageHeight - 6;
  const rollWidth = 18;
  const nameWidth = 58;
  const dayWidth = (pageWidth - marginX * 2 - rollWidth - nameWidth) / 31;
  const headerHeight = 8;
  const rowHeight = 6.6;
  let y = marginTop;

  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.text("Attendance Register", pageWidth / 2, y, { align: "center" });
  y += 6;

  doc.setFont("times", "normal");
  doc.setFontSize(9);
  doc.text(
    `Class: ${input.className}    Section: ${input.sectionName}    Month: ${input.monthLabel} ${input.year}`,
    pageWidth / 2,
    y,
    { align: "center" },
  );
  y += 5;

  doc.setFontSize(8);
  doc.text("P = Present    A = Absent    L = Late    - = Not in month", pageWidth / 2, y, {
    align: "center",
  });
  y += 7;

  const headerFill: [number, number, number] = [242, 234, 216];
  let x = marginX;
  drawCell(doc, x, y, rollWidth, headerHeight, "Roll No", {
    bold: true,
    fillColor: headerFill,
    fontSize: 7.2,
  });
  x += rollWidth;
  drawCell(doc, x, y, nameWidth, headerHeight, "Student Name", {
    bold: true,
    fillColor: headerFill,
    fontSize: 7.2,
    align: "left",
  });
  x += nameWidth;

  for (let day = 1; day <= 31; day += 1) {
    drawCell(doc, x, y, dayWidth, headerHeight, String(day), {
      bold: true,
      fillColor: headerFill,
      fontSize: 6.7,
    });
    x += dayWidth;
  }

  y += headerHeight;

  pageRows.forEach((row, rowIndex) => {
    const rowFill: [number, number, number] = rowIndex % 2 === 0 ? [255, 252, 244] : [250, 246, 237];
    let rowX = marginX;

    drawCell(doc, rowX, y, rollWidth, rowHeight, row.rollNo || "-", {
      fillColor: rowFill,
      fontSize: 6.8,
    });
    rowX += rollWidth;

    drawCell(doc, rowX, y, nameWidth, rowHeight, row.studentName, {
      fillColor: rowFill,
      fontSize: 6.7,
      align: "left",
    });
    rowX += nameWidth;

    for (let index = 0; index < 31; index += 1) {
      const code = row.statuses[index] ?? "-";
      const style = STATUS_STYLE[code];
      drawCell(doc, rowX, y, dayWidth, rowHeight, code, {
        bold: code !== "-",
        fillColor: style.fillColor,
        textColor: style.textColor,
        fontSize: 6.9,
      });
      rowX += dayWidth;
    }

    y += rowHeight;
  });

  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - marginX, footerY, {
    align: "right",
  });
}

export async function generateAttendanceRegisterPdf(input: GenerateAttendanceRegisterPdfInput) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginTop = 10;
  const headerSpace = 26;
  const footerSpace = 10;
  const rowHeight = 6.6;
  const rowsPerPage = Math.max(12, Math.floor((pageHeight - marginTop - headerSpace - footerSpace) / rowHeight));
  const totalPages = Math.max(1, Math.ceil(input.rows.length / rowsPerPage));

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (pageIndex > 0) {
      doc.addPage();
    }

    const start = pageIndex * rowsPerPage;
    const end = start + rowsPerPage;
    drawPage(doc, input, input.rows.slice(start, end), pageIndex + 1, totalPages);
  }

  doc.save(buildFilename(input));
}

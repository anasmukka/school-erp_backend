import { jsPDF } from "jspdf";
import type { HallTicket } from "./types";

function normalizePdfText(val: unknown): string {
  return String(val ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u00B7/g, "-");
}

function drawCell(
  doc: jsPDF,
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
    fillColor?: [number, number, number];
    textColor?: [number, number, number];
  } = {}
) {
  const {
    align = "center",
    style = "normal",
    size = 8,
    border = true,
    fillColor,
    textColor = [0, 0, 0],
  } = opts;

  if (fillColor) {
    doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
    doc.rect(x, y, w, h, "F");
  }

  if (border) {
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, h, "S");
  }

  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  let textX = x + w / 2;
  if (align === "left") textX = x + 2.5;
  if (align === "right") textX = x + w - 2.5;

  const textY = y + h / 2 + size * 0.35 * 0.3527; // approximate vertical centering
  doc.text(normalizePdfText(text), textX, textY, { align });
}

export function buildHallTicketPage(doc: jsPDF, ticket: HallTicket, isSubsequentPage = false) {
  if (isSubsequentPage) {
    doc.addPage();
  }

  const pageWidth = 210; // A4 mm
  const pageHeight = 297;
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;

  // Outer border with subtle shadow outline
  doc.setDrawColor(30, 41, 59); // Slate-800
  doc.setLineWidth(0.6);
  doc.rect(margin - 2, margin - 2, contentWidth + 4, pageHeight - margin * 2 + 4, "S");

  doc.setDrawColor(203, 213, 225); // Slate-300
  doc.setLineWidth(0.2);
  doc.rect(margin - 1, margin - 1, contentWidth + 2, pageHeight - margin * 2 + 2, "S");

  let cursorY = margin + 3;

  // 1. School Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text("PRESTIGE INTERNATIONAL SCHOOL", pageWidth / 2, cursorY, { align: "center" });

  cursorY += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text("Affiliated to CBSE, New Delhi (Affiliation No. 1930452 | School Code: 45210)", pageWidth / 2, cursorY, { align: "center" });

  cursorY += 4;
  doc.setFontSize(8);
  doc.text("Campus Drive, Knowledge Park, Bengaluru, Karnataka - 560001 · Tel: +91 80 2345 6789", pageWidth / 2, cursorY, { align: "center" });

  cursorY += 4.5;
  // Decorative rule
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(margin + 5, cursorY, pageWidth - margin - 5, cursorY);

  cursorY += 3;

  // 2. Document Title Banner
  const bannerHeight = 8.5;
  doc.setFillColor(30, 41, 59); // Slate-800
  doc.roundedRect(margin, cursorY, contentWidth, bannerHeight, 1.5, 1.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text("OFFICIAL EXAMINATION HALL TICKET / ADMIT CARD", pageWidth / 2, cursorY + 5.5, { align: "center" });

  cursorY += bannerHeight + 3.5;

  // Sub-banner info: Exam & Session
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`EXAMINATION: ${ticket.examName?.toUpperCase()} (${ticket.academicYear})`, margin + 2, cursorY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`TICKET NO: ${ticket.ticketNumber}`, pageWidth - margin - 2, cursorY, { align: "right" });

  cursorY += 4.5;

  // 3. Student Particulars & Photo Box
  const particularsBoxHeight = 36;
  const photoBoxWidth = 28;
  const photoBoxHeight = 34;
  const infoWidth = contentWidth - photoBoxWidth - 4;

  // Particulars container box
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, cursorY, contentWidth, particularsBoxHeight, "FD");

  // Candidate Details inside infoWidth
  const leftColX = margin + 3;
  const rightColX = margin + infoWidth / 2 + 2;
  let detailY = cursorY + 5.5;
  const rowSpacing = 5.5;

  const drawField = (x: number, y: number, label: string, value: string, boldValue = true) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${label}:`, x, y);

    doc.setFont("helvetica", boldValue ? "bold" : "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(normalizePdfText(value || "-"), x + 24, y);
  };

  drawField(leftColX, detailY, "Candidate Name", ticket.studentName);
  drawField(rightColX, detailY, "Roll Number", ticket.rollNo || "N/A");

  detailY += rowSpacing;
  drawField(leftColX, detailY, "Admission No", ticket.admissionNo || "N/A");
  drawField(rightColX, detailY, "Class & Section", `Grade ${ticket.grade}${ticket.sectionName ? ` - Section ${ticket.sectionName}` : ""}`);

  detailY += rowSpacing;
  drawField(leftColX, detailY, "Academic Term", ticket.termName || "Term 1", false);
  drawField(rightColX, detailY, "Student UID", ticket.studentUid ? ticket.studentUid.slice(0, 12) : "N/A", false);

  detailY += rowSpacing;
  drawField(leftColX, detailY, "Date of Birth", ticket.dob || "On Record", false);
  drawField(rightColX, detailY, "Center / School", "Prestige Intl School", false);

  detailY += rowSpacing;
  drawField(leftColX, detailY, "Status", "ELIGIBLE & REGISTERED", true);
  if (ticket.eligibilitySnapshot.bypassId) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(217, 119, 6); // amber-600
    doc.text("[Principal Bypass Exception]", rightColX, detailY);
  }

  // Photo Box (Right side)
  const photoX = margin + infoWidth + 2;
  const photoY = cursorY + 1;
  doc.setDrawColor(148, 163, 184);
  doc.setFillColor(241, 245, 249);
  doc.rect(photoX, photoY, photoBoxWidth, photoBoxHeight, "FD");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text("AFFIX RECENT", photoX + photoBoxWidth / 2, photoY + photoBoxHeight / 2 - 2, { align: "center" });
  doc.text("PASSPORT PHOTO", photoX + photoBoxWidth / 2, photoY + photoBoxHeight / 2 + 1.5, { align: "center" });
  doc.text("IF NOT PRINTED", photoX + photoBoxWidth / 2, photoY + photoBoxHeight / 2 + 5, { align: "center" });

  cursorY += particularsBoxHeight + 5;

  // 4. Examination Schedule Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text("EXAMINATION TIMETABLE & SEATING", margin, cursorY);

  cursorY += 2.5;

  const colWidths = [10, 24, 20, 52, 28, 26, 26];
  const colHeaders = ["#", "Date", "Day", "Subject", "Time", "Venue", "Invigilator"];
  const tableX = margin;
  const rowHeight = 7;

  // Table Header Row
  let colX = tableX;
  colHeaders.forEach((header, i) => {
    drawCell(doc, colX, cursorY, colWidths[i], rowHeight, header, {
      style: "bold",
      size: 7.5,
      fillColor: [241, 245, 249],
      textColor: [30, 41, 59],
      align: i === 3 ? "left" : "center",
    });
    colX += colWidths[i];
  });

  cursorY += rowHeight;

  // Table Body Rows
  const subjects = ticket.scheduledSubjects || [];
  if (subjects.length === 0) {
    drawCell(doc, tableX, cursorY, contentWidth, rowHeight + 2, "No examination subjects scheduled yet.", {
      align: "center",
      style: "italic",
      size: 8,
    });
    cursorY += rowHeight + 2;
  } else {
    subjects.forEach((subj, idx) => {
      let curX = tableX;
      const isEven = idx % 2 === 0;
      const fill: [number, number, number] | undefined = isEven ? undefined : [250, 250, 252];

      // #
      drawCell(doc, curX, cursorY, colWidths[0], rowHeight, String(idx + 1), { size: 7.5, fillColor: fill });
      curX += colWidths[0];

      // Date
      drawCell(doc, curX, cursorY, colWidths[1], rowHeight, subj.date || "-", { size: 7.5, fillColor: fill });
      curX += colWidths[1];

      // Day
      drawCell(doc, curX, cursorY, colWidths[2], rowHeight, subj.dayName || "-", { size: 7.5, fillColor: fill });
      curX += colWidths[2];

      // Subject
      drawCell(doc, curX, cursorY, colWidths[3], rowHeight, subj.subjectName || "-", {
        align: "left",
        style: "bold",
        size: 7.5,
        fillColor: fill,
      });
      curX += colWidths[3];

      // Time
      const timeStr = subj.startTime && subj.endTime ? `${subj.startTime} - ${subj.endTime}` : subj.startTime || "-";
      drawCell(doc, curX, cursorY, colWidths[4], rowHeight, timeStr, { size: 7.5, fillColor: fill });
      curX += colWidths[4];

      // Venue
      drawCell(doc, curX, cursorY, colWidths[5], rowHeight, subj.venue || "Hall A", { size: 7, fillColor: fill });
      curX += colWidths[5];

      // Invigilator Signature Box
      drawCell(doc, curX, cursorY, colWidths[6], rowHeight, "", { fillColor: fill });

      cursorY += rowHeight;
    });
  }

  cursorY += 4.5;

  // 5. Candidate Instructions Box
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text("IMPORTANT INSTRUCTIONS FOR CANDIDATES", margin, cursorY);

  cursorY += 2.5;

  const instructions = (ticket.instructions && ticket.instructions.length > 0)
    ? ticket.instructions
    : [
        "Candidates must bring this original Hall Ticket and School ID card to every exam session.",
        "Report to the examination hall at least 15 minutes before the scheduled time.",
        "Mobile phones, smartwatches, and unauthorized papers are strictly prohibited.",
        "Write your Roll Number and Admission Number clearly on the answer script.",
        "Leaving the hall before half-time or without invigilator approval is not allowed.",
      ];

  const instructionBoxHeight = instructions.length * 4.2 + 3;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, cursorY, contentWidth, instructionBoxHeight, "FD");

  let instY = cursorY + 3.5;
  instructions.forEach((inst, i) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(51, 65, 85);
    doc.text(`${i + 1}.  ${normalizePdfText(inst)}`, margin + 3, instY);
    instY += 4.2;
  });

  cursorY += instructionBoxHeight + 8;

  // 6. Signature Area
  const sigBoxWidth = contentWidth / 3 - 4;
  const sigLineY = cursorY + 12;

  // Candidate Signature
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.3);
  doc.line(margin + 4, sigLineY, margin + sigBoxWidth - 4, sigLineY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text("Candidate's Signature", margin + sigBoxWidth / 2, sigLineY + 4, { align: "center" });

  // Class Teacher Signature
  const teacherX = margin + sigBoxWidth + 6;
  doc.line(teacherX + 4, sigLineY, teacherX + sigBoxWidth - 4, sigLineY);
  doc.text("Class Teacher / Verifier", teacherX + sigBoxWidth / 2, sigLineY + 4, { align: "center" });

  // Principal / Controller Seal
  const principalX = margin + (sigBoxWidth + 6) * 2;
  doc.line(principalX + 4, sigLineY, principalX + sigBoxWidth - 4, sigLineY);
  doc.setFont("helvetica", "bold");
  doc.text("Principal / Controller of Exam", principalX + sigBoxWidth / 2, sigLineY + 4, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("(Official Seal & Signature)", principalX + sigBoxWidth / 2, sigLineY + 7.5, { align: "center" });

  // 7. Security & Verification Barcode/QR String at bottom
  const footerY = pageHeight - margin - 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Security Code: ${ticket.qrCodeData} · Generated on ${new Date(ticket.generatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    margin,
    footerY
  );
  doc.text("Prestige International School ERP · Confidential", pageWidth - margin, footerY, { align: "right" });
}

export function generateHallTicketPdf(ticket: HallTicket): jsPDF {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  buildHallTicketPage(doc, ticket, false);
  return doc;
}

export function downloadHallTicketPdf(ticket: HallTicket) {
  const doc = generateHallTicketPdf(ticket);
  const cleanName = ticket.studentName.replace(/[^a-zA-Z0-9]/g, "_");
  const cleanExam = ticket.examName.replace(/[^a-zA-Z0-9]/g, "_");
  doc.save(`HallTicket_${cleanExam}_${cleanName}.pdf`);
}

export function downloadBulkHallTicketsPdf(tickets: HallTicket[], examName: string, grade: string) {
  if (tickets.length === 0) return;
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  tickets.forEach((ticket, i) => {
    buildHallTicketPage(doc, ticket, i > 0);
  });

  const cleanExam = examName.replace(/[^a-zA-Z0-9]/g, "_");
  doc.save(`HallTickets_${cleanExam}_Grade${grade}.pdf`);
}

import { jsPDF } from "jspdf";
import { PRESTIGE_LOGO_DATA_URL, PRESTIGE_LOGO_DIMENSIONS } from "./schoolLogoAsset";
import { CBSE_LOGO_DATA_URL, CBSE_LOGO_DIMENSIONS } from "./cbseLogoAsset";
import { amountInWordsINR } from "./numberToWords";

export interface FeeReceiptData {
  // Receipt Metadata
  receiptNo: string;
  receiptDate?: string; // DD/MM/YYYY or YYYY-MM-DD
  academicSession: string;
  paymentMode: string; // "cash" | "upi" | "online" | "cheque" | "card"
  reference?: string;
  orderId?: string;
  notes?: string;
  verificationStatus?: string;
  verifiedAt?: string;

  // Student Details
  studentName: string;
  studentUid?: string;
  studentId?: string;
  admissionNo?: string;
  grade?: string;
  sectionName?: string;
  rollNo?: string;
  fatherName?: string;
  parentContact?: string;

  // Fee Structure / Installment Details
  structureTitle?: string;
  termId?: string;
  termName?: string;
  installmentLabel: string;
  dueDate?: string;
  feeHeads?: Array<{ name: string; amount: number }>;

  // Financial Breakdown
  amount: number; // Current payment amount
  scheduledAmount?: number; // Total installment scheduled amount
  totalStructureAmount?: number; // Total for annual fee heads
  previouslyPaid?: number; // Previous payments for this installment
  remainingBalance?: number; // Balance on this installment after this payment
  totalOutstanding?: number; // Total student outstanding balance across all terms

  // School Institutional Details (from configuration, no fake data)
  schoolDetails?: {
    name?: string;
    tagline?: string;
    affiliationNo?: string;
    schoolCode?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
}

function formatINR(val: number | undefined | null): string {
  const num = Number(val) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

function formatDate(dateStr?: string): string {
  if (!dateStr) {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  if (dateStr.includes("T")) {
    const d = new Date(dateStr);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  if (dateStr.includes("-")) {
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }
  }
  return dateStr;
}

function normalizePdfText(val: unknown): string {
  return String(val ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u00B7/g, "-")
    .replace(/₹/g, "Rs. ");
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
    shade?: boolean;
    dark?: boolean;
    fillColor?: [number, number, number];
    textColor?: [number, number, number];
  } = {}
) {
  const {
    align = "center",
    style = "normal",
    size = 8,
    border = true,
    shade = false,
    dark = false,
    fillColor,
    textColor,
  } = opts;

  if (fillColor) {
    doc.setFillColor(...fillColor);
    doc.rect(x, y, w, h, "F");
    doc.setTextColor(...(textColor || [0, 0, 0]));
  } else if (dark) {
    doc.setFillColor(30, 41, 59); // Slate-800
    doc.rect(x, y, w, h, "F");
    doc.setTextColor(255, 255, 255);
  } else if (shade) {
    doc.setFillColor(248, 250, 252); // Slate-50
    doc.rect(x, y, w, h, "F");
    doc.setTextColor(30, 41, 59);
  } else {
    doc.setTextColor(30, 41, 59);
  }

  if (border) {
    doc.setDrawColor(203, 213, 225); // Slate-300
    doc.setLineWidth(0.2);
    doc.rect(x, y, w, h, "S");
  }

  doc.setFont("times", style);
  doc.setFontSize(size);

  if (text !== "") {
    const safeText = normalizePdfText(text);
    const tx = align === "center" ? x + w / 2 : align === "right" ? x + w - 2.5 : x + 2.5;
    const ty = y + h / 2 + size * 0.35 * 0.75;
    doc.text(safeText, tx, ty, { align });
  }

  doc.setTextColor(0, 0, 0);
}

/**
 * Builds the official jsPDF instance for a Fee Receipt.
 */
export function buildFeeReceiptPdfDocument(data: FeeReceiptData): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const ML = 14;
  const W = 210;
  const TW = W - ML * 2; // 182mm
  let y = 14;

  // 1. Double Outer Frame
  doc.setDrawColor(30, 41, 59); // Slate-800
  doc.setLineWidth(0.6);
  doc.rect(ML - 2, y - 2, TW + 4, 270, "S");

  doc.setDrawColor(203, 213, 225); // Slate-300
  doc.setLineWidth(0.2);
  doc.rect(ML - 1, y - 1, TW + 2, 268, "S");

  // 2. School Header with Logos & Branding
  const logoSize = 18;
  const schoolAspect = PRESTIGE_LOGO_DIMENSIONS.aspectRatio || 1.026;
  const cbseAspect = CBSE_LOGO_DIMENSIONS.aspectRatio || 1.0;

  // School Logo (Left)
  try {
    let sW = logoSize;
    let sH = logoSize / schoolAspect;
    doc.addImage(PRESTIGE_LOGO_DATA_URL, "PNG", ML + 2, y + 2, sW, sH);
  } catch (e) {
    console.warn("Could not render school logo:", e);
  }

  // CBSE Logo (Right)
  try {
    let bW = logoSize;
    let bH = logoSize / cbseAspect;
    doc.addImage(CBSE_LOGO_DATA_URL, "PNG", W - ML - 2 - bW, y + 2, bW, bH);
  } catch (e) {
    console.warn("Could not render CBSE logo:", e);
  }

  // School Center Typography
  const schoolName = (data.schoolDetails?.name || "PRESTIGE INTERNATIONAL SCHOOL").trim().toUpperCase();
  const tagline = data.schoolDetails?.tagline || "SCALING NEW HEIGHTS WITH EXCELLENCE";
  const affiliationNo = data.schoolDetails?.affiliationNo || "Affiliated to CBSE, New Delhi — Senior Secondary Sector";
  const schoolAddress = data.schoolDetails?.address;

  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42); // Slate-900
  doc.text(schoolName, W / 2, y + 6, { align: "center" });

  doc.setFont("times", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105); // Slate-600
  doc.text(tagline, W / 2, y + 11, { align: "center" });

  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.text(affiliationNo, W / 2, y + 15.5, { align: "center" });

  if (schoolAddress && schoolAddress !== affiliationNo) {
    doc.setFontSize(7.5);
    doc.text(schoolAddress, W / 2, y + 19.5, { align: "center" });
    y += 24;
  } else {
    y += 21;
  }

  // 3. Document Title Banner
  drawCell(doc, ML, y, TW, 7.5, "OFFICIAL FEE PAYMENT RECEIPT", {
    dark: true,
    style: "bold",
    size: 10,
  });
  y += 9.5;

  // 4. Two-Column Metadata Cards: Student Profile (Left) & Receipt Metadata (Right)
  const cardW = (TW - 4) / 2; // 89mm
  const cardH = 34;

  // --- Left Card: Student Information ---
  doc.setFillColor(241, 245, 249); // Slate-100
  doc.rect(ML, y, cardW, 6.5, "F");
  doc.setDrawColor(148, 163, 184); // Slate-400
  doc.setLineWidth(0.3);
  doc.rect(ML, y, cardW, cardH, "S");

  doc.setFont("times", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("STUDENT PROFILE", ML + 3, y + 4.5);

  const stuRows = [
    { label: "Student Name", value: data.studentName },
    { label: "Student UID", value: data.studentUid || data.studentId || "—" },
    { label: "Admission No", value: data.admissionNo || "—" },
    {
      label: "Class / Section",
      value: `Grade ${data.grade || "—"}${data.sectionName ? ` - ${data.sectionName}` : ""}`,
    },
    { label: "Roll No", value: data.rollNo || "—" },
  ];

  let stuRowY = y + 10.5;
  doc.setFontSize(7.5);
  stuRows.forEach((r) => {
    doc.setFont("times", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text(`${r.label}:`, ML + 3, stuRowY);
    doc.setFont("times", "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(normalizePdfText(r.value), ML + 28, stuRowY);
    stuRowY += 4.6;
  });

  // --- Right Card: Receipt & Transaction Details ---
  const rx = ML + cardW + 4;
  doc.setFillColor(241, 245, 249);
  doc.rect(rx, y, cardW, 6.5, "F");
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.rect(rx, y, cardW, cardH, "S");

  doc.setFont("times", "bold");
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text("RECEIPT METADATA", rx + 3, y + 4.5);

  const formattedDate = formatDate(data.receiptDate || data.verifiedAt);
  const statusLabel = (data.verificationStatus || "PAID").toUpperCase();
  const paymentModeLabel = (data.paymentMode || "CASH").toUpperCase();

  const recRows = [
    { label: "Receipt No", value: data.receiptNo, bold: true },
    { label: "Issue Date", value: formattedDate },
    { label: "Academic Session", value: data.academicSession || "2026-27" },
    { label: "Payment Mode", value: paymentModeLabel },
    { label: "Payment Status", value: statusLabel, bold: true },
  ];

  let recRowY = y + 10.5;
  recRows.forEach((r) => {
    doc.setFont("times", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text(`${r.label}:`, rx + 3, recRowY);
    doc.setFont("times", r.bold ? "bold" : "normal");
    doc.setTextColor(15, 23, 42);
    doc.text(normalizePdfText(r.value), rx + 30, recRowY);
    recRowY += 4.6;
  });

  y += cardH + 4.5;

  // 5. Fee Breakdown & Installment Hierarchy Table
  // Hierarchy: Structure -> Term -> Installment
  const termDisplay = data.termName || "Academic Session Fee";
  const installmentDisplay = data.installmentLabel || "Scheduled Installment";

  drawCell(doc, ML, y, TW, 6, `FEE SCHEDULE BREAKDOWN — ${termDisplay.toUpperCase()}`, {
    fillColor: [226, 232, 240], // Slate-200
    style: "bold",
    size: 8,
    align: "left",
  });
  y += 6;

  // Table Columns
  // 1: Term & Installment (55mm)
  // 2: Due Date (25mm)
  // 3: Scheduled (25mm)
  // 4: Prev. Paid (25mm)
  // 5: This Payment (26mm)
  // 6: Balance (26mm)
  const colW1 = 55;
  const colW2 = 25;
  const colW3 = 25;
  const colW4 = 25;
  const colW5 = 26;
  const colW6 = 26;

  drawCell(doc, ML, y, colW1, 6.5, "Term / Installment", { dark: true, style: "bold", size: 7.5 });
  drawCell(doc, ML + colW1, y, colW2, 6.5, "Due Date", { dark: true, style: "bold", size: 7.5 });
  drawCell(doc, ML + colW1 + colW2, y, colW3, 6.5, "Scheduled (Rs.)", { dark: true, style: "bold", size: 7.5 });
  drawCell(doc, ML + colW1 + colW2 + colW3, y, colW4, 6.5, "Prev. Paid (Rs.)", { dark: true, style: "bold", size: 7.5 });
  drawCell(doc, ML + colW1 + colW2 + colW3 + colW4, y, colW5, 6.5, "Paid Now (Rs.)", { dark: true, style: "bold", size: 7.5 });
  drawCell(doc, ML + colW1 + colW2 + colW3 + colW4 + colW5, y, colW6, 6.5, "Balance (Rs.)", { dark: true, style: "bold", size: 7.5 });
  y += 6.5;

  const scheduledVal = data.scheduledAmount ?? data.amount;
  const prevPaidVal = data.previouslyPaid ?? 0;
  const paidNowVal = data.amount;
  const remainingVal = data.remainingBalance ?? Math.max(0, scheduledVal - prevPaidVal - paidNowVal);

  // Main row: Installment
  const rowH = 7.5;
  drawCell(
    doc,
    ML,
    y,
    colW1,
    rowH,
    `${termDisplay} - ${installmentDisplay}`,
    { align: "left", style: "bold", size: 7.5 }
  );
  drawCell(doc, ML + colW1, y, colW2, rowH, formatDate(data.dueDate) || "—", { size: 7.5 });
  drawCell(doc, ML + colW1 + colW2, y, colW3, rowH, formatINR(scheduledVal), { align: "right", size: 7.5 });
  drawCell(doc, ML + colW1 + colW2 + colW3, y, colW4, rowH, formatINR(prevPaidVal), { align: "right", size: 7.5 });
  drawCell(
    doc,
    ML + colW1 + colW2 + colW3 + colW4,
    y,
    colW5,
    rowH,
    formatINR(paidNowVal),
    { align: "right", style: "bold", size: 8, shade: true }
  );
  drawCell(
    doc,
    ML + colW1 + colW2 + colW3 + colW4 + colW5,
    y,
    colW6,
    rowH,
    formatINR(remainingVal),
    { align: "right", style: "bold", size: 7.5 }
  );
  y += rowH;

  // Optional Fee Heads Sub-table (if provided)
  if (data.feeHeads && data.feeHeads.length > 0) {
    drawCell(doc, ML, y, TW, 5.5, "Associated Annual Fee Heads Allocation:", {
      fillColor: [248, 250, 252],
      style: "italic",
      size: 7,
      align: "left",
    });
    y += 5.5;

    const headW = TW / Math.min(data.feeHeads.length, 4);
    data.feeHeads.slice(0, 4).forEach((h, idx) => {
      drawCell(
        doc,
        ML + idx * headW,
        y,
        headW,
        5.5,
        `${h.name}: ${formatINR(h.amount)}`,
        { size: 6.5, align: "center", border: true }
      );
    });
    y += 5.5;
  }

  y += 2.5;

  // 6. Highlighted Amount In Words Box
  const wordsText = amountInWordsINR(paidNowVal);
  doc.setFillColor(238, 242, 255); // Indigo-50
  doc.setDrawColor(199, 210, 254); // Indigo-200
  doc.setLineWidth(0.3);
  doc.rect(ML, y, TW, 9, "FD");

  doc.setFont("times", "bold");
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text("Amount Received (in words):", ML + 3, y + 5.5);

  doc.setFont("times", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(normalizePdfText(wordsText), ML + 44, y + 5.5);

  y += 12;

  // 7. Payment Mode & Transaction Specifications Box
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.rect(ML, y, TW, 18, "S");

  doc.setFont("times", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text("PAYMENT TRANSACTION DETAILS:", ML + 3, y + 4.5);

  doc.setFont("times", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);

  let txnDetailStr = "";
  const mode = (data.paymentMode || "").toLowerCase();
  if (mode === "cash") {
    txnDetailStr = "Payment settled in cash at Accounts Department collection counter.";
    if (data.reference) txnDetailStr += ` Cash Register Ref: ${data.reference}`;
  } else if (mode === "upi") {
    txnDetailStr = `UPI Electronic Transfer. Reference / UTR Number: ${data.reference || "Verified"}`;
  } else if (mode === "online") {
    txnDetailStr = `Online Payment Gateway. Transaction ID: ${data.reference || data.orderId || "Verified"}`;
    if (data.orderId) txnDetailStr += ` | Order: ${data.orderId}`;
  } else if (mode === "cheque") {
    txnDetailStr = `Cheque / Demand Draft. Instrument No: ${data.reference || "—"}`;
  } else {
    txnDetailStr = `Payment Mode: ${paymentModeLabel}. Reference: ${data.reference || "Verified"}`;
  }

  doc.text(normalizePdfText(txnDetailStr), ML + 3, y + 9);

  if (data.notes) {
    doc.setFont("times", "italic");
    doc.setTextColor(71, 85, 105);
    doc.text(`Notes: ${normalizePdfText(data.notes)}`, ML + 3, y + 13.5);
  } else {
    doc.setFont("times", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(
      "Financial Verification: Payment confirmed and posted directly to student institutional fee ledger.",
      ML + 3,
      y + 13.5
    );
  }

  y += 21;

  // 8. Financial Summary Dashboard (4 Horizontal Metric Blocks)
  const metricW = TW / 4;
  const metricH = 13;

  // Box 1: Annual Total
  doc.setFillColor(248, 250, 252);
  doc.rect(ML, y, metricW, metricH, "F");
  doc.setDrawColor(203, 213, 225);
  doc.rect(ML, y, metricW, metricH, "S");
  doc.setFont("times", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(71, 85, 105);
  doc.text("TOTAL ANNUAL FEE", ML + metricW / 2, y + 4.5, { align: "center" });
  doc.setFont("times", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(formatINR(data.totalStructureAmount || scheduledVal), ML + metricW / 2, y + 9.5, { align: "center" });

  // Box 2: Previous Collections
  doc.setFillColor(248, 250, 252);
  doc.rect(ML + metricW, y, metricW, metricH, "F");
  doc.rect(ML + metricW, y, metricW, metricH, "S");
  doc.setFont("times", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(71, 85, 105);
  doc.text("PREVIOUS PAYMENTS", ML + metricW * 1.5, y + 4.5, { align: "center" });
  doc.setFont("times", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(formatINR(prevPaidVal), ML + metricW * 1.5, y + 9.5, { align: "center" });

  // Box 3: Current Payment (Highlighted Green)
  doc.setFillColor(240, 253, 244); // Green-50
  doc.rect(ML + metricW * 2, y, metricW, metricH, "F");
  doc.setDrawColor(187, 247, 208); // Green-200
  doc.rect(ML + metricW * 2, y, metricW, metricH, "S");
  doc.setFont("times", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(22, 101, 52); // Green-800
  doc.text("PAID THIS RECEIPT", ML + metricW * 2.5, y + 4.5, { align: "center" });
  doc.setFontSize(9.5);
  doc.text(formatINR(paidNowVal), ML + metricW * 2.5, y + 9.5, { align: "center" });

  // Box 4: Remaining Balance
  doc.setFillColor(248, 250, 252);
  doc.rect(ML + metricW * 3, y, metricW, metricH, "F");
  doc.setDrawColor(203, 213, 225);
  doc.rect(ML + metricW * 3, y, metricW, metricH, "S");
  doc.setFont("times", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(71, 85, 105);
  doc.text("INSTALLMENT BALANCE", ML + metricW * 3.5, y + 4.5, { align: "center" });
  doc.setFont("times", "bold");
  doc.setFontSize(8.5);
  if (remainingVal > 0) {
    doc.setTextColor(225, 29, 72);
  } else {
    doc.setTextColor(15, 23, 42);
  }
  doc.text(formatINR(remainingVal), ML + metricW * 3.5, y + 9.5, { align: "center" });

  y += metricH + 5;

  // 9. Institutional Terms & Important Guidelines
  doc.setDrawColor(226, 232, 240);
  doc.line(ML, y, ML + TW, y);
  y += 4;

  doc.setFont("times", "bold");
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text("TERMS AND CONDITIONS:", ML, y);
  y += 3.5;

  const terms = [
    "1. This document is a valid official receipt issued by Prestige International School upon receipt of fee payment.",
    "2. Please retain this receipt securely for future administrative reference, fee clearance, and Income Tax exemption (80C).",
    "3. Fees once paid are non-refundable and non-transferable under all standard institutional regulations.",
    "4. Installment payment eligibility automatically updates examination hall ticket generation clearance in the ERP portal.",
  ];

  doc.setFont("times", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  terms.forEach((t) => {
    doc.text(t, ML, y);
    y += 3.2;
  });

  y += 5;

  // 10. Institutional Footer & Authorized Signatory Area
  const sigAreaY = y + 14;

  // Depositor / Student Signatory
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(ML + 5, sigAreaY, ML + 50, sigAreaY);
  doc.setFont("times", "normal");
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text("Depositor / Student Signature", ML + 27.5, sigAreaY + 4, { align: "center" });

  // Center: Issued By Note
  doc.setFont("times", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text("Issued By: Accounts & Fee Administration Department", W / 2, sigAreaY + 1, {
    align: "center",
  });
  doc.setFont("times", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text("Prestige International School - Mangalore", W / 2, sigAreaY + 4.5, { align: "center" });

  // Right: Authorized Official Signatory
  doc.line(W - ML - 50, sigAreaY, W - ML - 5, sigAreaY);
  doc.setFont("times", "bold");
  doc.setFontSize(7);
  doc.setTextColor(15, 23, 42);
  doc.text("Authorized Signatory / Accounts Officer", W - ML - 27.5, sigAreaY + 4, {
    align: "center",
  });

  // Computer-generated disclaimer at the bottom border
  doc.setFont("times", "normal");
  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `This is a computer-generated receipt — Prestige International School ERP Document ID: ${data.receiptNo}`,
    W / 2,
    280,
    { align: "center" }
  );

  return doc;
}

/**
 * Downloads the Fee Receipt as a PDF file.
 */
export async function downloadFeeReceiptPdf(data: FeeReceiptData): Promise<void> {
  const doc = buildFeeReceiptPdfDocument(data);
  const cleanReceiptNo = (data.receiptNo || "Receipt").replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `FeeReceipt_${cleanReceiptNo}.pdf`;
  doc.save(fileName);
}

/**
 * Opens a print dialog for the Fee Receipt with high fidelity.
 */
export async function printFeeReceiptPdf(data: FeeReceiptData): Promise<void> {
  const doc = buildFeeReceiptPdfDocument(data);
  const blob = doc.output("blob");
  const blobUrl = URL.createObjectURL(blob);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-10000px";
  iframe.style.left = "-10000px";
  iframe.src = blobUrl;

  document.body.appendChild(iframe);

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        // Fallback: open in new tab
        window.open(blobUrl, "_blank");
      }
    }, 300);
  };
}

/**
 * Resolves full FeeReceiptData from a payment record and available context.
 * Performs graceful lookups for any missing student, section, or fee structure fields.
 */
export async function resolveFeeReceiptData(
  payment: any,
  student?: any,
  structure?: any,
  assignment?: any
): Promise<FeeReceiptData> {
  // 1. Resolve student info
  let admissionNo = student?.admissionNo;
  let studentUid = student?.studentUid || student?.uid || payment.studentUid || payment.studentId;
  let grade = student?.grade || payment.grade;
  let rollNo = student?.rollNo;
  let sectionName = "";
  let fatherName = student?.fatherName || student?.parentName;

  if ((!admissionNo || !rollNo || !sectionName) && payment.studentId) {
    try {
      const { doc, getDoc } = await import("firebase/firestore");
      const { db } = await import("./firebase");
      const sDoc = await getDoc(doc(db, "students", payment.studentId));
      if (sDoc.exists()) {
        const sData = sDoc.data() as any;
        if (!admissionNo) admissionNo = sData.admissionNo;
        if (!studentUid) studentUid = sData.studentUid || sData.uid;
        if (!rollNo) rollNo = sData.rollNo;
        if (!grade) grade = sData.grade;
        if (!fatherName) fatherName = sData.fatherName || sData.parentName;

        if (sData.sectionId) {
          const secDoc = await getDoc(doc(db, "sections", sData.sectionId));
          if (secDoc.exists()) {
            sectionName = (secDoc.data() as any).name || "";
          }
        }
      }
    } catch (e) {
      console.warn("Could not fetch extended student profile for receipt:", e);
    }
  }

  // 2. Resolve Structure / Term / Installment details
  let termName = payment.termName;
  let dueDate = "";
  let scheduledAmount: number | undefined = undefined;
  let totalStructureAmount: number | undefined = undefined;
  let previouslyPaid: number | undefined = undefined;
  let remainingBalance: number | undefined = undefined;
  let feeHeads: Array<{ name: string; amount: number }> = [];

  if (structure) {
    totalStructureAmount = structure.feeHeads?.reduce(
      (acc: number, h: any) => acc + (Number(h.amount) || 0),
      0
    );
    feeHeads =
      structure.feeHeads?.map((h: any) => ({
        name: h.name,
        amount: Number(h.amount) || 0,
      })) || [];

    const inst = structure.installments?.find((i: any) => i.id === payment.installmentId);
    if (inst) {
      if (!termName && inst.termName) termName = inst.termName;
      if (inst.dueDate) dueDate = inst.dueDate;
      scheduledAmount = Number(inst.amount) || undefined;
    }
  }

  if (!totalStructureAmount && payment.structureId) {
    try {
      const { doc, getDoc } = await import("firebase/firestore");
      const { db } = await import("./firebase");
      const stDoc = await getDoc(doc(db, "feeStructures", payment.structureId));
      if (stDoc.exists()) {
        const stData = stDoc.data() as any;
        totalStructureAmount = stData.feeHeads?.reduce(
          (acc: number, h: any) => acc + (Number(h.amount) || 0),
          0
        );
        feeHeads =
          stData.feeHeads?.map((h: any) => ({
            name: h.name,
            amount: Number(h.amount) || 0,
          })) || [];
        const inst = stData.installments?.find((i: any) => i.id === payment.installmentId);
        if (inst) {
          if (!termName && inst.termName) termName = inst.termName;
          if (inst.dueDate) dueDate = inst.dueDate;
          scheduledAmount = Number(inst.amount) || undefined;
        }
      }
    } catch (e) {
      console.warn("Could not fetch structure for receipt:", e);
    }
  }

  // 3. Resolve school institutional branding
  let schoolDetails = {
    name: "PRESTIGE INTERNATIONAL SCHOOL",
    tagline: "SCALING NEW HEIGHTS WITH EXCELLENCE",
    affiliationNo: "CBSE AFFILIATION NO. 930123",
    address: "Affiliated to CBSE, New Delhi — Senior Secondary Sector",
  };

  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const { db } = await import("./firebase");
    const structVerDoc = await getDoc(doc(db, "academicStructureVersions", "struct-secondary_v1"));
    if (structVerDoc.exists()) {
      const layout = (structVerDoc.data() as any).reportCardLayout;
      if (layout) {
        if (layout.schoolName) schoolDetails.name = layout.schoolName;
        if (layout.affiliationNo) schoolDetails.affiliationNo = layout.affiliationNo;
        if (layout.schoolAddress) schoolDetails.address = layout.schoolAddress;
        if (layout.tagline) schoolDetails.tagline = layout.tagline;
      }
    }
  } catch {
    // Fall back to clean defaults
  }

  return {
    receiptNo: payment.receiptNo || `RC-${(payment.id || "0000").slice(-8).toUpperCase()}`,
    receiptDate: payment.paidAt,
    academicSession: payment.academicSession || "2026-27",
    paymentMode: payment.paymentMode || "cash",
    reference: payment.reference || "",
    orderId: payment.orderId,
    notes: payment.notes,
    verificationStatus: payment.verificationStatus || "verified",
    verifiedAt: payment.verifiedAt,

    studentName: payment.studentName || student?.name || "Student",
    studentUid,
    studentId: payment.studentId,
    admissionNo,
    grade,
    sectionName,
    rollNo,
    fatherName,
    parentContact: student?.parentContact,

    structureTitle: structure?.title,
    termId: payment.termId,
    termName: termName || "Academic Term",
    installmentLabel: payment.installmentLabel || "Installment",
    dueDate,
    feeHeads,

    amount: Number(payment.amount) || 0,
    scheduledAmount,
    totalStructureAmount,
    previouslyPaid,
    remainingBalance,

    schoolDetails,
  };
}

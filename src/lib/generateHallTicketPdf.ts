import { jsPDF } from "jspdf";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import type { HallTicket } from "./types";
import {
  PRESTIGE_LOGO_DATA_URL,
  PRESTIGE_LOGO_WIDTH,
  PRESTIGE_LOGO_HEIGHT,
} from "./schoolLogoAsset";

/**
 * Fetches the active Admin (Principal) signature URL from Firestore.
 * Only the 'admin' role is authorized to sign hall tickets.
 * Falls back to ticket.principalSignatureUrl if Firestore is unavailable.
 */
async function fetchPrincipalSignatureUrl(fallback?: string): Promise<string | undefined> {
  try {
    const q = query(
      collection(db, "signatures"),
      where("role", "==", "admin"),
      where("status", "==", "active")
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const data = snap.docs[0].data() as any;
      if (data.imageUrl) return data.imageUrl as string;
    }
  } catch {
    // Firestore unavailable — fall back silently
  }
  return fallback;
}

export interface LoadedImageInfo {
  dataUrl: string;
  width: number;
  height: number;
  format: "PNG" | "JPEG";
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

export async function loadImageDataUrl(url?: string | null): Promise<LoadedImageInfo | null> {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const trimmed = url.trim();

  // 1. Direct match for default school logo
  if (
    trimmed === "/prestige_logo.png" ||
    trimmed === "prestige_logo.png" ||
    trimmed.includes("prestige_logo.png")
  ) {
    return {
      dataUrl: PRESTIGE_LOGO_DATA_URL,
      width: PRESTIGE_LOGO_WIDTH,
      height: PRESTIGE_LOGO_HEIGHT,
      format: "PNG",
    };
  }

  // 2. Direct data URI (PNG / JPEG)
  if (trimmed.startsWith("data:image/png;base64,") || trimmed.startsWith("data:image/jpeg;base64,")) {
    const isJpeg = trimmed.startsWith("data:image/jpeg");
    if (typeof window !== "undefined" && typeof Image !== "undefined") {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            dataUrl: trimmed,
            width: img.naturalWidth || 300,
            height: img.naturalHeight || 300,
            format: isJpeg ? "JPEG" : "PNG",
          });
        };
        img.onerror = () => {
          resolve({
            dataUrl: trimmed,
            width: 300,
            height: 300,
            format: isJpeg ? "JPEG" : "PNG",
          });
        };
        img.src = trimmed;
      });
    }
    return {
      dataUrl: trimmed,
      width: 300,
      height: 300,
      format: isJpeg ? "JPEG" : "PNG",
    };
  }

  // 3. Browser environment: Image loading + Canvas rasterization (handles SVGs, remote URLs, Storage URLs)
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    try {
      const fromCanvas = await new Promise<LoadedImageInfo | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            const w = img.naturalWidth || 300;
            const h = img.naturalHeight || 300;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(null);
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL("image/png");
            resolve({ dataUrl, width: w, height: h, format: "PNG" });
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = trimmed;
      });

      if (fromCanvas) return fromCanvas;
    } catch {
      // Continue to fetch fallback
    }

    // Fallback: Fetch as Blob -> FileReader -> DataURL
    try {
      const res = await fetch(trimmed);
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const isJpeg = blob.type.includes("jpeg") || blob.type.includes("jpg");
        return {
          dataUrl,
          width: 300,
          height: 300,
          format: isJpeg ? "JPEG" : "PNG",
        };
      }
    } catch {
      return null;
    }
  }

  // 4. Node.js environment (for automated testing / CLI verification):
  if (typeof process !== "undefined" && typeof fetch !== "undefined") {
    try {
      const res = await fetch(trimmed);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = res.headers.get("content-type") || "";
        const isJpeg = contentType.includes("jpeg") || contentType.includes("jpg");
        const format = isJpeg ? "JPEG" : "PNG";
        const dataUrl = `data:${isJpeg ? "image/jpeg" : "image/png"};base64,${buffer.toString("base64")}`;
        return {
          dataUrl,
          width: 300,
          height: 300,
          format,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

export interface PreloadedHallTicketAssets {
  logo?: LoadedImageInfo | null;
  photo?: LoadedImageInfo | null;
  signature?: LoadedImageInfo | null;
}

export async function buildHallTicketPage(
  doc: jsPDF,
  ticket: HallTicket,
  preloaded?: PreloadedHallTicketAssets,
  isSubsequentPage = false
): Promise<void> {
  if (isSubsequentPage) {
    doc.addPage();
  }

  // Preload images if not already preloaded
  const logoPromise =
    preloaded?.logo !== undefined
      ? Promise.resolve(preloaded.logo)
      : loadImageDataUrl(ticket.schoolDetails?.logoUrl || "/prestige_logo.png");

  const photoPromise =
    preloaded?.photo !== undefined
      ? Promise.resolve(preloaded.photo)
      : loadImageDataUrl(ticket.studentPhotoUrl);

  const sigPromise =
    preloaded?.signature !== undefined
      ? Promise.resolve(preloaded.signature)
      : loadImageDataUrl(ticket.principalSignatureUrl);

  const [logoImg, photoImg, sigImg] = await Promise.all([logoPromise, photoPromise, sigPromise]);

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

  let cursorY = margin + 2.5;

  // 1. School Logo (drawn at top-left of header)
  const logoMaxSize = 18;
  const logoX = margin + 2;
  const logoY = cursorY - 1;

  if (logoImg) {
    const aspect = logoImg.width / logoImg.height;
    let drawW = logoMaxSize;
    let drawH = logoMaxSize;
    if (aspect >= 1) {
      drawW = logoMaxSize;
      drawH = logoMaxSize / aspect;
    } else {
      drawH = logoMaxSize;
      drawW = logoMaxSize * aspect;
    }
    const drawX = logoX + (logoMaxSize - drawW) / 2;
    const drawY = logoY + (logoMaxSize - drawH) / 2;
    doc.addImage(logoImg.dataUrl, logoImg.format, drawX, drawY, drawW, drawH);
  }

  // 2. School Name
  const schoolName = (ticket.schoolDetails?.name || "PRESTIGE INTERNATIONAL SCHOOL").trim().toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14.5);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text(schoolName, pageWidth / 2, cursorY + 2.5, { align: "center" });

  cursorY += 7;

  // 3. Affiliation & School Code (ONLY IF CONFIGURED)
  const affilTokens: string[] = [];
  if (ticket.schoolDetails?.affiliationNo?.trim()) {
    affilTokens.push(ticket.schoolDetails.affiliationNo.trim());
  }
  if (ticket.schoolDetails?.schoolCode?.trim()) {
    affilTokens.push(`School Code: ${ticket.schoolDetails.schoolCode.trim()}`);
  }
  if (affilTokens.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(affilTokens.join("  |  "), pageWidth / 2, cursorY, { align: "center" });
    cursorY += 4;
  }

  // 4. Address & Contact Info (ONLY IF CONFIGURED)
  const contactTokens: string[] = [];
  if (ticket.schoolDetails?.address?.trim()) {
    contactTokens.push(ticket.schoolDetails.address.trim());
  }
  if (ticket.schoolDetails?.phone?.trim()) {
    contactTokens.push(`Tel: ${ticket.schoolDetails.phone.trim()}`);
  }
  if (ticket.schoolDetails?.email?.trim()) {
    contactTokens.push(ticket.schoolDetails.email.trim());
  }
  if (ticket.schoolDetails?.website?.trim()) {
    contactTokens.push(ticket.schoolDetails.website.trim());
  }
  if (contactTokens.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(contactTokens.join("  ·  "), pageWidth / 2, cursorY, { align: "center" });
    cursorY += 4;
  }

  // 5. Tagline (ONLY IF CONFIGURED)
  if (ticket.schoolDetails?.tagline?.trim()) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(ticket.schoolDetails.tagline.trim(), pageWidth / 2, cursorY, { align: "center" });
    cursorY += 4;
  }

  // Ensure header clears the logo
  const minHeaderBottom = logoY + logoMaxSize + 2;
  if (cursorY < minHeaderBottom) {
    cursorY = minHeaderBottom;
  }

  // Decorative dividing rule
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(margin + 5, cursorY, pageWidth - margin - 5, cursorY);

  cursorY += 3.5;

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
  doc.text(
    `EXAMINATION: ${(ticket.examName || "EXAMINATION").toUpperCase()} (${ticket.academicYear})`,
    margin + 2,
    cursorY
  );

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
  const photoX = margin + infoWidth + 2;
  const photoY = cursorY + 1;

  // Particulars container box
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.setFillColor(248, 250, 252);
  doc.rect(margin, cursorY, contentWidth, particularsBoxHeight, "FD");

  // Candidate Details inside infoWidth
  const leftColX = margin + 3;
  const rightColX = margin + infoWidth / 2 + 2;
  const leftColMaxW = rightColX - leftColX - 25;
  const rightColMaxW = photoX - rightColX - 25;
  let detailY = cursorY + 5.5;
  const rowSpacing = 5.5;

  const drawField = (
    x: number,
    y: number,
    label: string,
    value: string,
    boldValue = true,
    maxValWidth?: number
  ) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${label}:`, x, y);

    const valX = x + 23;
    const availW = maxValWidth ?? (photoX - 3 - valX);
    let valSize = boldValue ? 8.5 : 8;
    doc.setFont("helvetica", boldValue ? "bold" : "normal");
    doc.setFontSize(valSize);
    doc.setTextColor(15, 23, 42);

    let displayVal = normalizePdfText(value || "-");
    let textW = doc.getTextWidth(displayVal);
    if (textW > availW && valSize > 6.5) {
      valSize = 7.2;
      doc.setFontSize(valSize);
      textW = doc.getTextWidth(displayVal);
    }
    if (textW > availW) {
      while (displayVal.length > 3 && doc.getTextWidth(displayVal + "...") > availW) {
        displayVal = displayVal.slice(0, -1);
      }
      displayVal += "...";
    }

    doc.text(displayVal, valX, y);
  };

  drawField(leftColX, detailY, "Candidate Name", ticket.studentName, true, leftColMaxW);
  drawField(rightColX, detailY, "Roll Number", ticket.rollNo || "N/A", true, rightColMaxW);

  detailY += rowSpacing;
  drawField(leftColX, detailY, "Admission No", ticket.admissionNo || "N/A", true, leftColMaxW);
  drawField(
    rightColX,
    detailY,
    "Class & Section",
    `Grade ${ticket.grade}${ticket.sectionName ? ` - Section ${ticket.sectionName}` : ""}`,
    true,
    rightColMaxW
  );

  detailY += rowSpacing;
  drawField(leftColX, detailY, "Academic Term", ticket.termName || "Term 1", false, leftColMaxW);
  drawField(rightColX, detailY, "Student UID", ticket.studentUid || "N/A", false, rightColMaxW);

  detailY += rowSpacing;
  drawField(leftColX, detailY, "Date of Birth", ticket.dob || "On Record", false, leftColMaxW);
  drawField(rightColX, detailY, "Center / School", ticket.schoolDetails?.name || "Prestige International School", false, rightColMaxW);

  detailY += rowSpacing;
  drawField(leftColX, detailY, "Status", "ELIGIBLE & REGISTERED", true, leftColMaxW);
  if (ticket.eligibilitySnapshot?.bypassId) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(217, 119, 6); // amber-600
    doc.text("[Principal Bypass Exception]", rightColX, detailY);
  }

  // Photo Box (Right side)
  doc.setDrawColor(148, 163, 184);
  doc.setFillColor(241, 245, 249);
  doc.rect(photoX, photoY, photoBoxWidth, photoBoxHeight, "FD");

  if (photoImg) {
    const pad = 0.5;
    const boxW = photoBoxWidth - pad * 2;
    const boxH = photoBoxHeight - pad * 2;
    const boxAspect = boxW / boxH;
    const imgAspect = photoImg.width / photoImg.height;

    let drawW = boxW;
    let drawH = boxH;
    let drawX = photoX + pad;
    let drawY = photoY + pad;

    if (imgAspect > boxAspect) {
      drawW = boxW;
      drawH = boxW / imgAspect;
      drawY = photoY + pad + (boxH - drawH) / 2;
    } else {
      drawH = boxH;
      drawW = boxH * imgAspect;
      drawX = photoX + pad + (boxW - drawW) / 2;
    }

    doc.addImage(photoImg.dataUrl, photoImg.format, drawX, drawY, drawW, drawH);

    // Clean passport photo outer border
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.3);
    doc.rect(photoX, photoY, photoBoxWidth, photoBoxHeight, "S");
  } else {
    // Intentional clean state when student photo is not on record
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text("PHOTO NOT", photoX + photoBoxWidth / 2, photoY + photoBoxHeight / 2 - 1.5, { align: "center" });
    doc.text("AVAILABLE", photoX + photoBoxWidth / 2, photoY + photoBoxHeight / 2 + 2.5, { align: "center" });
  }

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

      // Venue (no fake hardcoded values)
      drawCell(doc, curX, cursorY, colWidths[5], rowHeight, subj.venue || "-", { size: 7, fillColor: fill });
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

  const instructions =
    ticket.instructions && ticket.instructions.length > 0
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

  // 6. Signature Area — Authorized Admin (Principal) ONLY
  const sigBoxWidth = 56;
  const sigLineY = cursorY + 12;
  const principalX = margin + contentWidth - sigBoxWidth - 4;
  const principalCenter = principalX + sigBoxWidth / 2;

  // Render digital signature if available
  if (sigImg) {
    const maxSigW = 38;
    const maxSigH = 12;
    const sigAspect = sigImg.width / sigImg.height;
    let sW = maxSigW;
    let sH = maxSigH;
    if (sigAspect >= maxSigW / maxSigH) {
      sW = maxSigW;
      sH = maxSigW / sigAspect;
    } else {
      sH = maxSigH;
      sW = maxSigH * sigAspect;
    }
    const sX = principalCenter - sW / 2;
    const sY = sigLineY - sH - 0.5;
    doc.addImage(sigImg.dataUrl, sigImg.format, sX, sY, sW, sH);
  }

  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.3);
  doc.line(principalX + 4, sigLineY, principalX + sigBoxWidth - 4, sigLineY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  doc.text("Principal / Controller of Exam", principalCenter, sigLineY + 4, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text("(Official Seal & Authorized Signature)", principalCenter, sigLineY + 7.5, { align: "center" });

  // 7. Security & Verification Barcode/QR String at bottom
  const footerY = pageHeight - margin - 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Security Code: ${ticket.qrCodeData} · Generated on ${new Date(ticket.generatedAt).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
    margin,
    footerY
  );
  doc.text(
    `${ticket.schoolDetails?.name || "Prestige International School"} ERP · Confidential`,
    pageWidth - margin,
    footerY,
    { align: "right" }
  );
}

export async function generateHallTicketPdf(ticket: HallTicket): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  // Auto-fetch admin/principal signature from Firestore (only admin authorized for hall tickets)
  const sigUrl = await fetchPrincipalSignatureUrl(ticket.principalSignatureUrl);
  const signature = sigUrl ? await loadImageDataUrl(sigUrl) : null;
  const logo = await loadImageDataUrl(ticket.schoolDetails?.logoUrl || "/prestige_logo.png");
  const photo = ticket.studentPhotoUrl ? await loadImageDataUrl(ticket.studentPhotoUrl) : null;

  await buildHallTicketPage(doc, ticket, { logo, photo, signature }, false);
  return doc;
}

export async function downloadHallTicketPdf(ticket: HallTicket): Promise<void> {
  const doc = await generateHallTicketPdf(ticket);
  const cleanName = ticket.studentName.replace(/[^a-zA-Z0-9]/g, "_");
  const cleanExam = ticket.examName.replace(/[^a-zA-Z0-9]/g, "_");
  doc.save(`HallTicket_${cleanExam}_${cleanName}.pdf`);
}

export async function downloadBulkHallTicketsPdf(
  tickets: HallTicket[],
  examName: string,
  grade: string
): Promise<void> {
  if (tickets.length === 0) return;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  // Preload common school logo once for batch efficiency
  const logo = await loadImageDataUrl(tickets[0]?.schoolDetails?.logoUrl || "/prestige_logo.png");

  // Preload student photos in parallel
  const photos = await Promise.all(
    tickets.map((t) => (t.studentPhotoUrl ? loadImageDataUrl(t.studentPhotoUrl) : Promise.resolve(null)))
  );

  // Preload principal/admin signature from Firestore (admin role is the ONLY authorized hall ticket signer)
  // Falls back to ticket.principalSignatureUrl if Firestore is unavailable
  const fallbackSigUrl = tickets.find((t) => t.principalSignatureUrl)?.principalSignatureUrl;
  const sigUrl = await fetchPrincipalSignatureUrl(fallbackSigUrl);
  const signature = sigUrl ? await loadImageDataUrl(sigUrl) : null;

  for (let i = 0; i < tickets.length; i++) {
    await buildHallTicketPage(
      doc,
      tickets[i],
      {
        logo,
        photo: photos[i],
        signature,
      },
      i > 0
    );
  }

  const cleanExam = examName.replace(/[^a-zA-Z0-9]/g, "_");
  doc.save(`HallTickets_${cleanExam}_Grade${grade}.pdf`);
}

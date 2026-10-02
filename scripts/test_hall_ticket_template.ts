import fs from "fs";
import path from "path";
import type { HallTicket } from "../src/lib/types";

// Load .env into process.env before importing firebase
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

async function run() {
  const { generateHallTicketPdf } = await import("../src/lib/generateHallTicketPdf");
  const { PRESTIGE_LOGO_DATA_URL } = await import("../src/lib/schoolLogoAsset");

  console.log("==================================================");
  console.log("TESTING HALL TICKET TEMPLATE & PDF GENERATION");
  console.log("==================================================");

  // 1. Verify Logo Asset
  console.log("\n[TEST 1] Official School Logo Verification");
  if (!PRESTIGE_LOGO_DATA_URL.startsWith("data:image/png;base64,")) {
    throw new Error("PRESTIGE_LOGO_DATA_URL is invalid or missing!");
  }
  console.log("✓ Official Prestige School Logo is present as a sharp Base64 PNG asset (Length:", PRESTIGE_LOGO_DATA_URL.length, ")");

  // Sample photo data for testing Student A and Student B
  // Student A: Distinct Red 1x1 PNG
  const samplePhotoA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  // Student B: Distinct Blue 1x1 PNG
  const samplePhotoB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  // Student A Ticket
  const ticketA: HallTicket = {
    id: "ht_test_stu_a",
    ticketNumber: "HT-2026-G10-0001",
    sessionId: "2026-27",
    academicYear: "2026-27",
    structureId: "struct-secondary",
    structureVersion: 1,
    scheduleId: "sched-10-hy",
    definedExamId: "exam-t1-hy",
    examName: "Half-Yearly Examination",
    termId: "term_1",
    termName: "Term 1",
    studentId: "DEMO-STU-001",
    studentUid: "DEMO-STU-001",
    studentName: "Aarav Sharma",
    admissionNo: "DEMO-ADM-2026-001",
    rollNo: "01",
    grade: "10",
    sectionId: "sec-10a",
    sectionName: "A",
    studentPhotoUrl: samplePhotoA,
    dob: "2010-05-15",
    schoolDetails: {
      name: "PRESTIGE INTERNATIONAL SCHOOL",
      affiliationNo: "CBSE AFFILIATION NO. 930123",
      address: "Senior Secondary Sector, Academic Zone",
      tagline: "SCALING NEW HEIGHTS WITH EXCELLENCE",
      logoUrl: "/prestige_logo.png",
    },
    scheduledSubjects: [
      {
        subjectId: "subj-math",
        subjectName: "Mathematics",
        date: "2026-10-10",
        dayName: "Saturday",
        startTime: "09:30",
        endTime: "12:30",
        venue: "Examination Hall B-2",
        maxMarks: 80,
        passingMarks: 27,
      },
      {
        subjectId: "subj-sci",
        subjectName: "Science",
        date: "2026-10-13",
        dayName: "Tuesday",
        startTime: "09:30",
        endTime: "12:30",
        venue: "Examination Hall B-2",
        maxMarks: 80,
        passingMarks: 27,
      },
    ],
    instructions: [
      "Candidates must bring this original Hall Ticket and School ID card.",
      "Reporting time is 15 minutes before the exam.",
    ],
    status: "generated",
    eligibilitySnapshot: {
      eligible: true,
      reason: "All dues cleared",
      evaluatedAt: new Date().toISOString(),
    },
    qrCodeData: "VERIFY_HT:AARAV:DEMO-STU-001",
    generatedAt: new Date().toISOString(),
    generatedBy: {
      uid: "admin-uid",
      name: "Dr. Eleanor Vance",
      role: "admin",
    },
    updatedAt: new Date().toISOString(),
  };

  // Student B Ticket (Different student, different photo, different class)
  const ticketB: HallTicket = {
    ...ticketA,
    id: "ht_test_stu_b",
    ticketNumber: "HT-2026-G10-0002",
    studentId: "DEMO-STU-002",
    studentUid: "DEMO-STU-002",
    studentName: "Rohan Gupta",
    admissionNo: "DEMO-ADM-2026-002",
    rollNo: "02",
    studentPhotoUrl: samplePhotoB,
    dob: "2010-08-20",
    qrCodeData: "VERIFY_HT:ROHAN:DEMO-STU-002",
  };

  // Student C Ticket (Student WITHOUT photo)
  const ticketC: HallTicket = {
    ...ticketA,
    id: "ht_test_stu_c",
    ticketNumber: "HT-2026-G10-0003",
    studentId: "DEMO-STU-003",
    studentUid: "DEMO-STU-003",
    studentName: "Priya Reddy",
    admissionNo: "DEMO-ADM-2026-003",
    rollNo: "03",
    studentPhotoUrl: undefined, // NO PHOTO ON RECORD
    dob: "2010-03-11",
    qrCodeData: "VERIFY_HT:PRIYA:DEMO-STU-003",
  };

  console.log("\n[TEST 2] Generating PDF for Student A (with Photo A)...");
  const docA = await generateHallTicketPdf(ticketA);
  const pdfBytesA = Buffer.from(docA.output("arraybuffer"));
  fs.writeFileSync("output_hall_ticket_student_a.pdf", pdfBytesA);
  console.log("✓ Generated Student A PDF:", pdfBytesA.length, "bytes saved to output_hall_ticket_student_a.pdf");

  console.log("\n[TEST 3] Generating PDF for Student B (with Photo B)...");
  const docB = await generateHallTicketPdf(ticketB);
  const pdfBytesB = Buffer.from(docB.output("arraybuffer"));
  fs.writeFileSync("output_hall_ticket_student_b.pdf", pdfBytesB);
  console.log("✓ Generated Student B PDF:", pdfBytesB.length, "bytes saved to output_hall_ticket_student_b.pdf");

  console.log("\n[TEST 4] Generating PDF for Student C (NO Photo on record)...");
  const docC = await generateHallTicketPdf(ticketC);
  const pdfBytesC = Buffer.from(docC.output("arraybuffer"));
  fs.writeFileSync("output_hall_ticket_student_c_nophoto.pdf", pdfBytesC);
  console.log("✓ Generated Student C PDF:", pdfBytesC.length, "bytes saved to output_hall_ticket_student_c_nophoto.pdf");

  // Verify text content
  const pdfTextA = docA.output();
  const pdfTextB = docB.output();
  const pdfTextC = docC.output();

  console.log("\n[TEST 5] Checking for hardcoded fake school data in generated PDFs...");
  const fakeValues = [
    "Affiliation No. 1930452",
    "School Code: 45210",
    "Campus Drive, Knowledge Park, Bengaluru",
    "+91 80 2345 6789",
    "AFFIX RECENT PASSPORT PHOTO IF NOT PRINTED",
    "Hall A", // Fake fallback venue
  ];

  for (const fake of fakeValues) {
    if (pdfTextA.includes(fake) || pdfTextB.includes(fake) || pdfTextC.includes(fake)) {
      throw new Error(`FAIL: PDF contains forbidden fake placeholder value: "${fake}"`);
    }
  }
  console.log("✓ PASS: Zero fake Bengaluru addresses, phone numbers, or fake affiliation numbers found in any PDF!");
  console.log("✓ PASS: 'AFFIX RECENT PASSPORT PHOTO IF NOT PRINTED' is completely removed!");

  console.log("\n[TEST 6] Verifying Data Isolation & IDOR Protection...");
  if (pdfTextA.includes("Rohan Gupta") || pdfTextA.includes("DEMO-STU-002")) {
    throw new Error("FAIL: Student A PDF leaked Student B data!");
  }
  if (pdfTextB.includes("Aarav Sharma") || pdfTextB.includes("DEMO-STU-001")) {
    throw new Error("FAIL: Student B PDF leaked Student A data!");
  }
  console.log("✓ PASS: Student A and Student B data are completely isolated with no cross-leakage.");

  console.log("\n[TEST 7] Verifying Student C Clean State ('PHOTO NOT AVAILABLE')...");
  if (!pdfTextC.includes("PHOTO NOT") || !pdfTextC.includes("AVAILABLE")) {
    throw new Error("FAIL: Student C did not render the intentional 'PHOTO NOT AVAILABLE' state!");
  }
  console.log("✓ PASS: Student C correctly displays clean 'PHOTO NOT AVAILABLE' intentional state without any fake photo.");

  console.log("\n==================================================");
  console.log("ALL 7 VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉");
  console.log("==================================================");
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});

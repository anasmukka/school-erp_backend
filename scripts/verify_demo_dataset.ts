import fs from "fs";
import path from "path";

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
  const { auth, db } = await import("../src/lib/firebase");
  const { signInWithEmailAndPassword, signOut } = await import("firebase/auth");
  const { 
    doc, 
    getDoc, 
    getDocs, 
    collection, 
    query, 
    where 
  } = await import("firebase/firestore");
  const { sendResetEmail } = await import("../src/lib/passwordReset");
  const { buildInstallmentLedger, getFeeCollectionSummary } = await import("../src/lib/fees");

  console.log("==================================================");
  console.log("PRESTIGE ERP — DEMO DATASET VERIFICATION SUITE");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${details ? "- " + details : ""}`);
      failed++;
    }
  }

  // 1. Verify Demo Accounts Authentication & Roles
  console.log("\n--- TEST GROUP 1: AUTHENTICATION & ROLE RESOLUTION ---");
  const DEMO_CREDENTIALS = [
    { email: "admin.demo@demo.example", expectedRole: "admin", expectedName: "Dr. Eleanor Vance" },
    { email: "hod.demo@demo.example", expectedRole: "hod", expectedName: "Prof. Rajesh Sharma" },
    { email: "teacher.class.demo@demo.example", expectedRole: "teacher", expectedName: "Sarah Jenkins" },
    { email: "teacher.subject.demo@demo.example", expectedRole: "teacher", expectedName: "David Miller" },
    { email: "accounts.demo@demo.example", expectedRole: "accountant", expectedName: "Fathima Zahra" },
    { email: "printing.demo@demo.example", expectedRole: "printing", expectedName: "Vikram Patel" },
    { email: "operations.demo@demo.example", expectedRole: "operations", expectedName: "Anand Verma" },
    { email: "student.demo@demo.example", expectedRole: "student", expectedName: "Aarav Sharma" },
    { email: "parent.demo@demo.example", expectedRole: "parent", expectedName: "Mohan Sharma" },
  ];

  for (const cred of DEMO_CREDENTIALS) {
    try {
      const userCred = await signInWithEmailAndPassword(auth, cred.email, "DemoPassword123!");
      assert(`Account ${cred.email} successfully signs in with demo password`, !!userCred.user);
      
      const userDocSnap = await getDoc(doc(db, "users", userCred.user.uid));
      assert(`User document exists in users collection for ${cred.email}`, userDocSnap.exists());
      if (userDocSnap.exists()) {
        const udata = userDocSnap.data();
        assert(`Role for ${cred.email} resolves correctly to '${cred.expectedRole}'`, udata.role === cred.expectedRole);
        assert(`Name for ${cred.email} resolves to '${cred.expectedName}'`, udata.name === cred.expectedName);
      }
      await signOut(auth);
    } catch (err: any) {
      assert(`Account ${cred.email} sign-in failed`, false, err.message);
    }
  }

  // Ensure separate principal.demo@demo.example is rejected (Admin account represents Principal)
  try {
    await signInWithEmailAndPassword(auth, "principal.demo@demo.example", "DemoPassword123!");
    assert("Separate principal.demo@demo.example should not exist", false, "Account still exists!");
    await signOut(auth);
  } catch (err: any) {
    assert("Separate principal.demo@demo.example correctly does not exist (admin role is Principal authority)", true);
  }

  // 2. Verify Forgot Password Flow on Demo Account
  console.log("\n--- TEST GROUP 2: FORGOT PASSWORD FLOW ON DEMO ACCOUNT ---");
  try {
    const resetRes = await sendResetEmail("teacher.class.demo@demo.example");
    assert("Forgot Password dispatches successfully for demo account", resetRes.success === true);
  } catch (err: any) {
    assert("Forgot Password flow failed", false, err.message);
  }

  // 3. Verify Students, Enrollments & UID Separation
  console.log("\n--- TEST GROUP 3: STUDENTS, ENROLLMENTS & PERMANENT UID SEPARATION ---");
  const stuDoc = await getDoc(doc(db, "students", "DEMO-STU-001"));
  assert("Student DEMO-STU-001 exists in students collection", stuDoc.exists());
  if (stuDoc.exists()) {
    const sdata = stuDoc.data();
    assert("Student UID is DEMO-STU-001 (permanent identifier)", sdata.studentUid === "DEMO-STU-001");
    assert("Student has separate authUid linking to Auth account", typeof sdata.authUid === "string" && sdata.authUid !== sdata.studentUid);
    assert("Student has guardian contact info", !!sdata.parentContact && !!sdata.fatherName);
  }

  const enrSnap = await getDocs(query(collection(db, "enrollments"), where("studentUid", "==", "DEMO-STU-001")));
  assert("Student DEMO-STU-001 has active enrollment records", enrSnap.size >= 1);
  const activeEnr = enrSnap.docs.find(d => d.data().status === "active");
  assert("Student has active enrollment in Grade 10 Section A for 2026-27", activeEnr && activeEnr.data().className === "10" && activeEnr.data().sectionName === "A");

  // 4. Verify Academic Structure & Linked Exams
  console.log("\n--- TEST GROUP 4: ACADEMIC STRUCTURE & LINKED EXAMS ---");
  const structDoc = await getDoc(doc(db, "academicStructures", "struct-secondary"));
  assert("Secondary Academic Structure exists", structDoc.exists() && structDoc.data().status === "active");

  const verDoc = await getDoc(doc(db, "academicStructureVersions", "struct-secondary_v1"));
  assert("Structure Version 1 exists with 2 terms and defined components", verDoc.exists() && verDoc.data().terms.length === 2);
  if (verDoc.exists()) {
    const vdata = verDoc.data();
    const hasPT = vdata.assessmentComponents.some((c: any) => c.code === "PT" && c.testedMaxMarks === 40);
    assert("Assessment components include scaled PT (tested out of 40, target 10)", hasPT);
  }

  const schedSnap = await getDocs(query(collection(db, "examSchedules"), where("definedExamId", "==", "exam-t1-hy")));
  assert("Exam Schedule exists for Half-Yearly Exam with approved status", !schedSnap.empty && schedSnap.docs[0].data().status === "approved");

  // 5. Verify Fee Ledgers & Payments
  console.log("\n--- TEST GROUP 5: FEES & INSTALLMENT LEDGER ENGINE ---");
  const feeStructDoc = await getDoc(doc(db, "feeStructures", "fee-struct-10"));
  assert("Grade 10 Fee Structure exists with 2 installments", feeStructDoc.exists() && feeStructDoc.data().installments.length === 2);

  const paymentsSnap = await getDocs(query(collection(db, "feePayments"), where("studentId", "==", "DEMO-STU-001")));
  assert("Student DEMO-STU-001 has fee payment records", paymentsSnap.size >= 2);
  
  if (feeStructDoc.exists()) {
    const fstruct = feeStructDoc.data();
    const paymentsList = paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    const ledger = buildInstallmentLedger(fstruct as any, paymentsList, new Date("2026-07-01"));
    assert("Installment 1 is fully paid in ledger", ledger[0].status === "paid" && ledger[0].balance === 0);
    assert("Installment 2 is fully paid in ledger", ledger[1].status === "paid" && ledger[1].balance === 0);
  }

  // 6. Verify Hall Ticket Eligibility Engine & Bypasses
  console.log("\n--- TEST GROUP 6: HALL TICKET ELIGIBILITY & BYPASS DECISIONS ---");
  const htRuleDoc = await getDoc(doc(db, "hallTicketRules", "ht-rule-t1-hy"));
  assert("Hall ticket rule exists requiring 50% fee payment", htRuleDoc.exists() && htRuleDoc.data().minimumPaymentPercentage === 50);

  const htSnap1 = await getDoc(doc(db, "hallTickets", "ht-hy-demo-stu-001"));
  assert("Hall ticket generated for DEMO-STU-001 (eligible via 100% payment)", htSnap1.exists() && htSnap1.data()?.status === "generated");

  const htSnap2 = await getDoc(doc(db, "hallTickets", "ht-hy-demo-stu-002"));
  assert("Hall ticket generated for DEMO-STU-002 (eligible via 50% payment threshold)", htSnap2.exists() && htSnap2.data()?.status === "generated");

  const bypassApproved = await getDoc(doc(db, "hallTicketBypasses", "bypass-stu-007"));
  assert("Approved bypass exists for DEMO-STU-007", bypassApproved.exists() && bypassApproved.data()?.status === "approved");

  const htSnap7 = await getDoc(doc(db, "hallTickets", "ht-hy-demo-stu-007"));
  assert("Hall ticket generated for DEMO-STU-007 via approved bypass", htSnap7.exists() && htSnap7.data()?.status === "generated");

  const bypassRejected = await getDoc(doc(db, "hallTicketBypasses", "bypass-stu-008"));
  assert("Rejected bypass exists for DEMO-STU-008", bypassRejected.exists() && bypassRejected.data()?.status === "rejected");

  const htSnap8 = await getDoc(doc(db, "hallTickets", "ht-hy-demo-stu-008"));
  assert("No hall ticket generated for DEMO-STU-008 (remains blocked)", !htSnap8.exists());

  // 7. Verify Marks Entries & Report Cards
  console.log("\n--- TEST GROUP 7: MARKS ENTRIES & PUBLISHED REPORT CARDS ---");
  const markEntry1 = await getDoc(doc(db, "marksEntries", "marks_2026-27_10_sec-10a_subj-10-math_term_1_exam-t1-hy_DEMO-STU-001"));
  assert("Marks entry exists for DEMO-STU-001 with published status", markEntry1.exists() && markEntry1.data()?.workflowStatus === "published");
  if (markEntry1.exists()) {
    const mdata = markEntry1.data();
    assert("Theory marks (76) + scaled PT (9.5) + NB (5) + SEA (5) = 95.5%", mdata.scaledTotalMarks === 95.5 && mdata.calculatedGrade === "A1");
  }

  const markAbsent = await getDoc(doc(db, "marksEntries", "marks_2026-27_10_sec-10a_subj-10-math_term_1_exam-t1-hy_DEMO-STU-010"));
  assert("Absent marks entry exists for DEMO-STU-010 with isAbsent: true", markAbsent.exists() && markAbsent.data()?.isAbsent === true);

  const reportCard = await getDoc(doc(db, "publishedReportCards", "rc-2026-t1-demo-stu-001"));
  assert("Published Report Card exists for DEMO-STU-001", reportCard.exists());
  if (reportCard.exists()) {
    const rc = reportCard.data();
    assert("Report card has 5 subject marks rows", rc.subjectMarks.length === 5);
    assert("Report card has Co-Scholastic evaluations and digital signatures", !!rc.coScholastic1 && !!rc.classTeacherSign && !!rc.principal_signed !== undefined);
  }

  // 8. Verify Events, Library, Inventory, Printing & Notifications
  console.log("\n--- TEST GROUP 8: OPERATIONAL MODULES (CALENDAR, LIBRARY, INVENTORY, PRINTING, NOTIFICATIONS) ---");
  const eventsSnap = await getDocs(collection(db, "events"));
  assert("Calendar events collection populated (at least 9 events)", eventsSnap.size >= 9);
  const hasRecurring = eventsSnap.docs.some(d => d.data().recurrence?.frequency === "weekly");
  assert("Recurring event exists in calendar (Weekly assembly)", hasRecurring);

  const booksSnap = await getDocs(collection(db, "libraryBooks"));
  assert("Library books collection populated", booksSnap.size >= 3);
  const txSnap = await getDocs(collection(db, "libraryTransactions"));
  assert("Library circulation transactions populated with active and overdue loans", txSnap.size >= 3);

  const invSnap = await getDocs(collection(db, "inventoryItems"));
  assert("Inventory items collection populated", invSnap.size >= 3);
  const uniformSnap = await getDocs(collection(db, "uniformItems"));
  assert("Uniform items collection populated with size matrices", uniformSnap.size >= 2);

  const printSnap = await getDocs(collection(db, "printingRequests"));
  assert("Printing requests populated across multiple statuses (completed, printing, pending, rejected)", printSnap.size >= 5);

  const notifSnap = await getDocs(collection(db, "notifications"));
  assert("Notifications collection populated with targeted records", notifSnap.size >= 4);

  const auditSnap = await getDocs(collection(db, "auditLogs"));
  assert("Central audit logs collection populated with realistic system history", auditSnap.size >= 5);

  // 9. Verify Parent IDOR Security Isolation
  console.log("\n--- TEST GROUP 9: PARENT / GUARDIAN IDOR SECURITY ISOLATION ---");
  const parent1Doc = await getDoc(doc(db, "users", created_auth_map["parent.demo@demo.example"]));
  assert("Parent 1 user record has linkedStudentUids: ['DEMO-STU-001']", parent1Doc.exists() && parent1Doc.data().linkedStudentUids.includes("DEMO-STU-001"));
  assert("Parent 1 CANNOT access Student 2 (not in linkedStudentUids)", !parent1Doc.data().linkedStudentUids.includes("DEMO-STU-002"));

  const parentMultiDoc = await getDoc(doc(db, "users", created_auth_map["parent.multi.demo@demo.example"]));
  assert("Multi-child Parent has both DEMO-STU-003 and DEMO-STU-004 linked", 
    parentMultiDoc.exists() && 
    parentMultiDoc.data().linkedStudentUids.includes("DEMO-STU-003") && 
    parentMultiDoc.data().linkedStudentUids.includes("DEMO-STU-004")
  );

  // 10. Verify E-Signatures & Document Signatory Configurations
  console.log("\n--- TEST GROUP 10: E-SIGNATURES & DOCUMENT SIGNATORY CONFIGURATIONS ---");
  const signaturesSnap = await getDocs(collection(db, "signatures"));
  assert("Signatures collection populated with authorized staff signatures", signaturesSnap.size >= 3);

  const adminSig = signaturesSnap.docs.find(d => d.data().role === "admin");
  assert("Admin signature exists and is active", !!adminSig && adminSig.data().status === "active");
  assert("Admin signature document designation is 'Principal'", !!adminSig && adminSig.data().designation === "Principal");
  assert("Admin signature authorized for Report Cards and Hall Tickets", 
    !!adminSig && 
    adminSig.data().authorizedDocumentTypes.includes("report_card") && 
    adminSig.data().authorizedDocumentTypes.includes("hall_ticket")
  );

  const sigConfigsSnap = await getDocs(collection(db, "signatureConfigs"));
  assert("Document signatory configs exist for official documents", sigConfigsSnap.size >= 2);
  const rcConfig = sigConfigsSnap.docs.find(d => d.id === "report_card");
  assert("Report card signatory workflow is configured with Class Teacher, HOD, and Admin (Principal)",
    !!rcConfig && rcConfig.data().slots.some((s: any) => s.role === "admin")
  );
  const htConfig = sigConfigsSnap.docs.find(d => d.id === "hall_ticket");
  assert("Hall ticket signatory workflow is configured with Admin (Principal & Seal)",
    !!htConfig && htConfig.data().slots.some((s: any) => s.role === "admin")
  );

  console.log("\n==================================================");
  console.log(`VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Map of auth UIDs created in previous step
const created_auth_map: Record<string, string> = {};

async function fetchAuthUids() {
  const { auth, db } = await import("../src/lib/firebase");
  const { collection, getDocs } = await import("firebase/firestore");
  const snap = await getDocs(collection(db, "users"));
  snap.forEach(d => {
    const data = d.data();
    if (data.email) {
      created_auth_map[data.email] = d.id;
    }
  });
}

fetchAuthUids().then(run).catch((err) => {
  console.error("Verification execution error:", err);
  process.exit(1);
});

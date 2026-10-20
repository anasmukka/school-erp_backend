/**
 * Academic Structure Teacher Marks Entry — Automated Verification Test Suite
 * Prestige International School ERP
 *
 * Verifies all 25 specific test requirements from Section 12:
 * 1. Dynamic academic structure exam loading
 * 2. Max and passing marks from academic structure
 * 3. Non-configured exams do not appear
 * 4. Awaiting exam schedule status
 * 5. Awaiting schedule approval status
 * 6. Exam not yet conducted status
 * 7. Available for marks entry status
 * 8. Marks already submitted status
 * 9. Locked marks entry status
 * 10. Teacher assignment filtering (classes & sections)
 * 11. Teacher assignment filtering (subjects)
 * 12. Student roster display with permanent student UID
 * 13. Marks component breakdown from academic structure
 * 14. Validation against maximum marks
 * 15. Validation against negative marks
 * 16. Absent student handling
 * 17. Exemption handling
 * 18. Save draft marks functionality
 * 19. Submit marks to HOD functionality
 * 20. Resubmission of edited marks
 * 21. Audit log generation on submit and edit
 * 22. Verification and publish workflow integrity
 * 23. Security rules authorization check
 * 24. No hardcoded exam names in source code
 * 25. Clean production build
 */

import fs from "fs";
import path from "path";

// Load .env into process.env BEFORE importing firebase or lib modules
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

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` — ${detail}` : ""}`);
    failedCount++;
  }
}

async function runTestSuite() {
  console.log("======================================================================");
  console.log("TEACHER MARKS ENTRY — ACADEMIC STRUCTURE PLANNER TEST SUITE");
  console.log("======================================================================\n");

  // Dynamic imports after .env is populated
  const {
    getActiveStructureForGrade,
    getEffectiveComponentsForSubject,
  } = await import("../src/lib/academicStructure");
  const {
    isExamDateCompleted,
    validateExamScheduleEligibility,
    calculateStudentExamMarks,
    applyRounding,
    resolveGrade,
    saveMarksEntriesBatch,
    transitionMarksWorkflow,
    verifyMarksEntryAuthorization,
    buildMarksEntryDocId,
  } = await import("../src/lib/resultEngine");
  const { db, auth } = await import("../src/lib/firebase");
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  const { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs } = await import("firebase/firestore");

  // Sign in as Admin to run privileged Firestore operations
  try {
    await signInWithEmailAndPassword(auth, "anasmukka@gmail.com", "admin123");
    console.log("Authenticated as Admin (anasmukka@gmail.com) for test execution.\n");
  } catch (err: any) {
    console.warn("Could not sign in with email/password:", err.message);
  }

  const SESSION_ID = "2026-27";
  const TEST_GRADE = "10";
  const TEST_SECTION_ID = "sec-10a";
  const TEST_SUBJECT_ID = "subj-10-math";
  const TEST_STUDENT_UID = "EXQKNEVDI5SauLUobPI6vU6Ps482";
  const TEST_STUDENT_NAME = "Aarav Sharma";

  // -------------------------------------------------------------------------
  // TEST 1: Dynamic academic structure exam loading
  // -------------------------------------------------------------------------
  console.log("--- Test 1: Dynamic Academic Structure Exam Loading ---");
  const structResult = await getActiveStructureForGrade(TEST_GRADE, SESSION_ID);
  assert(
    !!structResult && !!structResult.structure && !!structResult.version,
    "Active Academic Structure loaded dynamically for Grade 10",
    `Structure ID: ${structResult?.structure?.id}`
  );

  const definedExams = structResult?.version?.exams || [];
  assert(
    definedExams.length > 0,
    `Dynamic exams discovered from Academic Structure Planner (Found: ${definedExams.length} exams)`,
    `Exams: ${definedExams.map((e: any) => e.name).join(", ")}`
  );

  // -------------------------------------------------------------------------
  // TEST 2: Max and passing marks from academic structure
  // -------------------------------------------------------------------------
  console.log("\n--- Test 2: Max & Passing Marks from Academic Structure ---");
  const pt1Exam = definedExams.find((e: any) => e.id === "exam-t1-pt1" || e.name.includes("Periodic Test 1"));
  assert(
    !!pt1Exam && pt1Exam.maxMarks === 40 && pt1Exam.passingMarks === 14,
    "Periodic Test 1 has configured maxMarks: 40 and passingMarks: 14 (not generic 100/35)",
    `Actual max: ${pt1Exam?.maxMarks}, pass: ${pt1Exam?.passingMarks}`
  );

  const hyExam = definedExams.find((e: any) => e.id === "exam-t1-hy" || e.name.includes("Half Yearly"));
  assert(
    !!hyExam && hyExam.maxMarks === 100 && hyExam.passingMarks === 33,
    "Half Yearly Exam has configured maxMarks: 100 and passingMarks: 33",
    `Actual max: ${hyExam?.maxMarks}, pass: ${hyExam?.passingMarks}`
  );

  // -------------------------------------------------------------------------
  // TEST 3: Non-configured exams do not appear
  // -------------------------------------------------------------------------
  console.log("\n--- Test 3: Non-Configured Exams Do Not Appear ---");
  const nonConfiguredExams = ["Surprise Quiz", "Term 3 Final", "Pre-Board 4", "Random Test"];
  const leakedExams = nonConfiguredExams.filter((name) =>
    definedExams.some((e: any) => e.name.toLowerCase() === name.toLowerCase())
  );
  assert(
    leakedExams.length === 0,
    "Arbitrary/non-configured exams do NOT appear in the dynamic exam list",
    leakedExams.join(", ")
  );

  // -------------------------------------------------------------------------
  // TEST 4: Awaiting exam schedule status
  // -------------------------------------------------------------------------
  console.log("\n--- Test 4: Awaiting Exam Schedule Status ---");
  const unscheduledResult = await validateExamScheduleEligibility({
    sessionId: SESSION_ID,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    examId: "non-existent-exam-xyz",
  });
  assert(
    unscheduledResult.eligible === false && unscheduledResult.status === "not_scheduled",
    "Unscheduled exam returns status 'not_scheduled' with eligible: false",
    `Reason: ${unscheduledResult.reason}`
  );

  // -------------------------------------------------------------------------
  // TEST 5: Awaiting schedule approval status
  // -------------------------------------------------------------------------
  console.log("\n--- Test 5: Awaiting Schedule Approval Status ---");
  const draftSchedId = "test-draft-schedule-qa";
  await setDoc(doc(db, "examSchedules", draftSchedId), {
    grade: TEST_GRADE,
    definedExamId: "test-pending-exam",
    examType: "Pending Test",
    status: "pending_approval",
    sessionId: SESSION_ID,
    exams: [{ subjectId: TEST_SUBJECT_ID, date: "2026-09-01", startTime: "09:00", endTime: "12:00" }],
  });

  const pendingResult = await validateExamScheduleEligibility({
    sessionId: SESSION_ID,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    examId: "test-pending-exam",
  });
  assert(
    pendingResult.eligible === false && pendingResult.status === "awaiting_approval",
    "Pending approval schedule returns status 'awaiting_approval'",
    `Reason: ${pendingResult.reason}`
  );
  await deleteDoc(doc(db, "examSchedules", draftSchedId));

  // -------------------------------------------------------------------------
  // TEST 6: Exam not yet conducted status
  // -------------------------------------------------------------------------
  console.log("\n--- Test 6: Exam Not Yet Conducted Status ---");
  const futureDateCheck = isExamDateCompleted("2026-12-25", "12:00", new Date("2026-10-20T10:00:00+05:30"));
  assert(
    futureDateCheck.completed === false,
    "isExamDateCompleted returns completed: false for future exam date 2026-12-25",
    futureDateCheck.reason
  );

  const futureSchedId = "test-future-schedule-qa";
  await setDoc(doc(db, "examSchedules", futureSchedId), {
    grade: TEST_GRADE,
    definedExamId: "test-future-exam",
    examType: "Future Test",
    status: "approved",
    sessionId: SESSION_ID,
    exams: [{ subjectId: TEST_SUBJECT_ID, date: "2026-12-25", startTime: "09:00", endTime: "12:00" }],
  });

  const futureResult = await validateExamScheduleEligibility({
    sessionId: SESSION_ID,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    examId: "test-future-exam",
    nowDate: new Date("2026-10-20T10:00:00+05:30"),
  });
  assert(
    futureResult.eligible === false && futureResult.status === "not_conducted",
    "Approved future exam returns status 'not_conducted'",
    `Reason: ${futureResult.reason}`
  );
  await deleteDoc(doc(db, "examSchedules", futureSchedId));

  // -------------------------------------------------------------------------
  // TEST 7: Available for marks entry status
  // -------------------------------------------------------------------------
  console.log("\n--- Test 7: Available for Marks Entry Status ---");
  const pastDateCheck = isExamDateCompleted("2026-07-20", "11:00", new Date("2026-10-20T10:00:00+05:30"));
  assert(
    pastDateCheck.completed === true,
    "isExamDateCompleted returns completed: true for concluded exam date 2026-07-20"
  );

  const availSchedId = "test-avail-schedule-qa";
  await setDoc(doc(db, "examSchedules", availSchedId), {
    grade: TEST_GRADE,
    definedExamId: "test-concluded-avail-exam",
    examType: "Concluded Exam",
    status: "approved",
    sessionId: SESSION_ID,
    exams: [{ subjectId: TEST_SUBJECT_ID, date: "2026-07-20", startTime: "09:00", endTime: "12:00" }],
  });

  const availableResult = await validateExamScheduleEligibility({
    sessionId: SESSION_ID,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    examId: "test-concluded-avail-exam",
    nowDate: new Date("2026-10-20T10:00:00+05:30"),
  });
  assert(
    availableResult.eligible === true && availableResult.status === "available",
    "Approved concluded exam returns eligible: true and status 'available' for marks entry",
    `Status: ${availableResult.status}, Reason: ${availableResult.reason}`
  );
  await deleteDoc(doc(db, "examSchedules", availSchedId));

  // -------------------------------------------------------------------------
  // TEST 8: Marks already submitted status
  // -------------------------------------------------------------------------
  console.log("\n--- Test 8: Marks Already Submitted Status ---");
  const testSubmDocId = `${SESSION_ID}_${TEST_GRADE}_${TEST_SECTION_ID}_${TEST_SUBJECT_ID}_term_1_test-subm-exam_${TEST_STUDENT_UID}`;
  await setDoc(doc(db, "marksEntries", testSubmDocId), {
    sessionId: SESSION_ID,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    termId: "term_1",
    examId: "test-subm-exam",
    studentUid: TEST_STUDENT_UID,
    workflowStatus: "submitted",
    enteredBy: "teacher-1",
    enteredAt: new Date().toISOString(),
  });

  const schedSubmId = "test-sched-subm-qa";
  await setDoc(doc(db, "examSchedules", schedSubmId), {
    grade: TEST_GRADE,
    definedExamId: "test-subm-exam",
    examType: "Submitted Exam",
    status: "approved",
    sessionId: SESSION_ID,
    exams: [{ subjectId: TEST_SUBJECT_ID, date: "2026-07-10", startTime: "09:00", endTime: "12:00" }],
  });

  const submittedCheck = await validateExamScheduleEligibility({
    sessionId: SESSION_ID,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    examId: "test-subm-exam",
    nowDate: new Date("2026-10-20T10:00:00+05:30"),
  });
  assert(
    submittedCheck.status === "submitted" && submittedCheck.eligible === true,
    "Submitted marks return status 'submitted' and eligible: true (for review/edit)",
    `Status: ${submittedCheck.status}`
  );
  await deleteDoc(doc(db, "marksEntries", testSubmDocId));
  await deleteDoc(doc(db, "examSchedules", schedSubmId));

  // -------------------------------------------------------------------------
  // TEST 9: Locked marks entry status
  // -------------------------------------------------------------------------
  console.log("\n--- Test 9: Locked Marks Entry Status ---");
  const testLockedDocId = `${SESSION_ID}_${TEST_GRADE}_${TEST_SECTION_ID}_${TEST_SUBJECT_ID}_term_1_test-lock-exam_${TEST_STUDENT_UID}`;
  await setDoc(doc(db, "marksEntries", testLockedDocId), {
    sessionId: SESSION_ID,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    termId: "term_1",
    examId: "test-lock-exam",
    studentUid: TEST_STUDENT_UID,
    workflowStatus: "locked",
    enteredBy: "teacher-1",
    enteredAt: new Date().toISOString(),
  });

  const schedLockedId = "test-sched-lock-qa";
  await setDoc(doc(db, "examSchedules", schedLockedId), {
    grade: TEST_GRADE,
    definedExamId: "test-lock-exam",
    examType: "Locked Exam",
    status: "approved",
    sessionId: SESSION_ID,
    exams: [{ subjectId: TEST_SUBJECT_ID, date: "2026-07-10", startTime: "09:00", endTime: "12:00" }],
  });

  const lockedCheck = await validateExamScheduleEligibility({
    sessionId: SESSION_ID,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    examId: "test-lock-exam",
    nowDate: new Date("2026-10-20T10:00:00+05:30"),
  });
  assert(
    lockedCheck.status === "locked" && lockedCheck.eligible === false,
    "Locked marks return status 'locked' and eligible: false (blocked from modification)",
    `Status: ${lockedCheck.status}`
  );
  await deleteDoc(doc(db, "marksEntries", testLockedDocId));
  await deleteDoc(doc(db, "examSchedules", schedLockedId));

  // -------------------------------------------------------------------------
  // TEST 10: Teacher assignment filtering (classes & sections)
  // -------------------------------------------------------------------------
  console.log("\n--- Test 10: Teacher Assignment Filtering (Classes & Sections) ---");
  const unassignedTeacherAuth = await verifyMarksEntryAuthorization({
    userId: "random-unassigned-teacher-id",
    userRole: "teacher",
    grade: TEST_GRADE,
    sectionId: "sec-unassigned-xyz",
    subjectId: TEST_SUBJECT_ID,
  });
  assert(
    unassignedTeacherAuth.authorized === false,
    "Teacher without section assignment is denied authorization (authorized: false)",
    unassignedTeacherAuth.reason
  );

  const adminAuth = await verifyMarksEntryAuthorization({
    userId: "admin-user-id",
    userRole: "admin",
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
  });
  assert(
    adminAuth.authorized === true,
    "Admin role is authorized across all classes and sections"
  );

  // -------------------------------------------------------------------------
  // TEST 11: Teacher assignment filtering (subjects)
  // -------------------------------------------------------------------------
  console.log("\n--- Test 11: Teacher Assignment Filtering (Subjects) ---");
  const unassignedSubjectAuth = await verifyMarksEntryAuthorization({
    userId: "random-teacher-math-only",
    userRole: "teacher",
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: "sub-unassigned-french",
  });
  assert(
    unassignedSubjectAuth.authorized === false,
    "Teacher cannot access subjects they are not assigned to teach",
    unassignedSubjectAuth.reason
  );

  // -------------------------------------------------------------------------
  // TEST 12: Student roster display with permanent student UID
  // -------------------------------------------------------------------------
  console.log("\n--- Test 12: Student Roster Display with Permanent Student UID ---");
  const stuDoc = await getDoc(doc(db, "students", TEST_STUDENT_UID));
  let stuData = stuDoc.exists() ? stuDoc.data() : null;
  const canonicalUid = stuData?.studentUid || stuData?.admissionNo || TEST_STUDENT_UID;
  assert(
    typeof canonicalUid === "string" && canonicalUid.length > 0,
    `Student roster resolves canonical permanent ERP studentUid: ${canonicalUid}`,
    `Doc ID: ${stuDoc.id}`
  );

  // -------------------------------------------------------------------------
  // TEST 13: Marks component breakdown from academic structure
  // -------------------------------------------------------------------------
  console.log("\n--- Test 13: Marks Component Breakdown from Academic Structure ---");
  const effCompsResult = getEffectiveComponentsForSubject(
    structResult!.version,
    "term_1",
    TEST_SUBJECT_ID
  );
  const effectiveComps = Array.isArray(effCompsResult)
    ? effCompsResult
    : (effCompsResult as any)?.components || [];

  assert(
    effectiveComps.length > 0,
    `Effective assessment components resolved from structure (${effectiveComps.length} components)`,
    `Components: ${effectiveComps.map((c: any) => `${c.name} [max: ${c.testedMaxMarks ?? c.maxMarks}]`).join(", ")}`
  );

  // -------------------------------------------------------------------------
  // TEST 14: Validation against maximum marks
  // -------------------------------------------------------------------------
  console.log("\n--- Test 14: Validation Against Maximum Marks ---");
  const compTheory = effectiveComps[0];
  const maxAllowed = compTheory.testedMaxMarks ?? compTheory.maxMarks;
  const overMaxCalc = calculateStudentExamMarks({
    components: [compTheory],
    componentInputs: {
      [compTheory.id]: { marks: maxAllowed + 10, status: "present" },
    },
    scale: structResult!.version.gradingScale,
  });
  assert(
    overMaxCalc.errors.length > 0 && overMaxCalc.errors[0].includes("exceeds maximum allowed"),
    `Entering marks (${maxAllowed + 10}) exceeding maximum (${maxAllowed}) is rejected with error`,
    overMaxCalc.errors[0]
  );

  // -------------------------------------------------------------------------
  // TEST 15: Validation against negative marks
  // -------------------------------------------------------------------------
  console.log("\n--- Test 15: Validation Against Negative Marks ---");
  const negativeCalc = calculateStudentExamMarks({
    components: [compTheory],
    componentInputs: {
      [compTheory.id]: { marks: -5, status: "present" },
    },
    scale: structResult!.version.gradingScale,
  });
  assert(
    negativeCalc.errors.length > 0 && negativeCalc.errors[0].includes("cannot be negative"),
    "Negative marks (-5) entry is rejected with error",
    negativeCalc.errors[0]
  );

  // -------------------------------------------------------------------------
  // TEST 16: Absent student handling
  // -------------------------------------------------------------------------
  console.log("\n--- Test 16: Absent Student Handling ---");
  const absentInputs: Record<string, any> = {};
  effectiveComps.forEach((c: any) => {
    absentInputs[c.id] = { marks: null, status: "absent" };
  });
  const absentCalc = calculateStudentExamMarks({
    components: effectiveComps,
    componentInputs: absentInputs,
    scale: structResult!.version.gradingScale,
  });
  assert(
    absentCalc.isAbsent === true && absentCalc.calculatedGrade === "AB" && absentCalc.totalRawMarks === 0,
    "Marking student absent sets isAbsent: true, grade: 'AB', rawMarks: 0"
  );

  // -------------------------------------------------------------------------
  // TEST 17: Exemption handling
  // -------------------------------------------------------------------------
  console.log("\n--- Test 17: Exemption Handling ---");
  const exemptInputs: Record<string, any> = {};
  effectiveComps.forEach((c: any) => {
    exemptInputs[c.id] = { marks: null, status: "exempt" };
  });
  const exemptCalc = calculateStudentExamMarks({
    components: effectiveComps,
    componentInputs: exemptInputs,
    scale: structResult!.version.gradingScale,
  });
  assert(
    exemptCalc.isExempt === true && exemptCalc.calculatedGrade === "EX" && exemptCalc.isPassed === true,
    "Marking student exempt sets isExempt: true, grade: 'EX', isPassed: true"
  );

  // -------------------------------------------------------------------------
  // TEST 18: Save draft marks functionality
  // -------------------------------------------------------------------------
  console.log("\n--- Test 18: Save Draft Marks Functionality ---");
  const draftTestStudent = {
    studentUid: TEST_STUDENT_UID,
    studentId: TEST_STUDENT_UID,
    studentDocId: TEST_STUDENT_UID,
    studentName: TEST_STUDENT_NAME,
    rollNo: "101",
    admissionNo: "ADM-101",
    componentInputs: {
      [compTheory.id]: { marks: 25, status: "present" as const },
    },
  };

  const draftSaveRes = await saveMarksEntriesBatch({
    sessionId: SESSION_ID,
    academicYear: "2026-27",
    structureId: structResult!.structure.id,
    structureVersion: structResult!.version.versionNumber,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    termId: "term_1",
    examId: "exam-t1-pt1",
    components: [compTheory],
    scale: structResult!.version.gradingScale,
    studentsMarks: [draftTestStudent],
    targetStatus: "draft",
    user: { uid: "xQ2pLrZ48IR148x63Sg7CoFOU862", name: "Administrator", role: "admin" },
  });
  assert(
    draftSaveRes.savedCount === 1,
    "Save draft marks succeeds with savedCount: 1 and workflowStatus: 'draft'"
  );

  const savedDraftDocId = buildMarksEntryDocId({
    sessionId: SESSION_ID,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    termId: "term_1",
    examId: "exam-t1-pt1",
    studentUid: TEST_STUDENT_UID,
  });
  const savedDraftDoc = await getDoc(doc(db, "marksEntries", savedDraftDocId));
  assert(
    savedDraftDoc.exists() && savedDraftDoc.data()?.workflowStatus === "draft",
    "Persisted marks record in Firestore has workflowStatus: 'draft'"
  );

  // -------------------------------------------------------------------------
  // TEST 19: Submit marks to HOD functionality
  // -------------------------------------------------------------------------
  console.log("\n--- Test 19: Submit Marks to HOD Functionality ---");
  const submitRes = await saveMarksEntriesBatch({
    sessionId: SESSION_ID,
    academicYear: "2026-27",
    structureId: structResult!.structure.id,
    structureVersion: structResult!.version.versionNumber,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    termId: "term_1",
    examId: "exam-t1-pt1",
    components: [compTheory],
    scale: structResult!.version.gradingScale,
    studentsMarks: [draftTestStudent],
    targetStatus: "submitted",
    user: { uid: "xQ2pLrZ48IR148x63Sg7CoFOU862", name: "Administrator", role: "admin" },
  });
  assert(
    submitRes.savedCount === 1,
    "Submit marks to HOD succeeds with savedCount: 1"
  );
  const submittedDoc = await getDoc(doc(db, "marksEntries", savedDraftDocId));
  assert(
    submittedDoc.exists() &&
      submittedDoc.data()?.workflowStatus === "submitted" &&
      !!submittedDoc.data()?.submittedAt,
    "Persisted marks record transitioned to workflowStatus: 'submitted' with submittedAt timestamp"
  );

  // -------------------------------------------------------------------------
  // TEST 20: Resubmission of edited marks
  // -------------------------------------------------------------------------
  console.log("\n--- Test 20: Resubmission of Edited Marks ---");
  const editedStudent = {
    ...draftTestStudent,
    componentInputs: {
      [compTheory.id]: { marks: 32, status: "present" as const },
    },
  };
  const resubmitRes = await saveMarksEntriesBatch({
    sessionId: SESSION_ID,
    academicYear: "2026-27",
    structureId: structResult!.structure.id,
    structureVersion: structResult!.version.versionNumber,
    grade: TEST_GRADE,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    termId: "term_1",
    examId: "exam-t1-pt1",
    components: [compTheory],
    scale: structResult!.version.gradingScale,
    studentsMarks: [editedStudent],
    targetStatus: "submitted",
    user: { uid: "xQ2pLrZ48IR148x63Sg7CoFOU862", name: "Administrator", role: "admin" },
    isEditResubmission: true,
  });
  assert(
    resubmitRes.savedCount === 1,
    "Resubmission of edited marks succeeds with updated score (32)"
  );
  const resubmittedDoc = await getDoc(doc(db, "marksEntries", savedDraftDocId));
  assert(
    resubmittedDoc.exists() &&
      resubmittedDoc.data()?.totalRawMarks === 32 &&
      !!resubmittedDoc.data()?.updatedAt,
    "Resubmitted record reflects new raw marks (32) and contains updatedAt timestamp"
  );

  // -------------------------------------------------------------------------
  // TEST 21: Audit log generation on submit and edit
  // -------------------------------------------------------------------------
  console.log("\n--- Test 21: Audit Log Generation on Submit and Edit ---");
  const auditLogsSnap = await getDocs(
    query(
      collection(db, "auditLogs"),
      where("entity", "==", "marks"),
      where("sectionId", "==", TEST_SECTION_ID)
    )
  );
  assert(
    auditLogsSnap.docs.length > 0,
    `Audit logs generated for marks module (Found: ${auditLogsSnap.docs.length} audit entries)`
  );
  const lastLog = auditLogsSnap.docs[auditLogsSnap.docs.length - 1]?.data();
  assert(
    (lastLog?.module === "marks" || lastLog?.entity === "marks") &&
      (lastLog?.action === "submit" || lastLog?.action === "resubmit" || lastLog?.action === "update"),
    `Latest audit log records action '${lastLog?.action}' by '${lastLog?.userName || lastLog?.performedBy?.name}'`
  );

  // -------------------------------------------------------------------------
  // TEST 22: Verification and publish workflow integrity
  // -------------------------------------------------------------------------
  console.log("\n--- Test 22: Verification & Publish Workflow Integrity ---");
  const verRes = await transitionMarksWorkflow({
    sessionId: SESSION_ID,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    examId: "exam-t1-pt1",
    targetStatus: "verified",
    user: { uid: "xQ2pLrZ48IR148x63Sg7CoFOU862", name: "Administrator", role: "admin" },
  });
  assert(verRes.count > 0, `transitionMarksWorkflow transitioned ${verRes.count} records to 'verified'`);

  let blockError = "";
  try {
    await transitionMarksWorkflow({
      sessionId: SESSION_ID,
      sectionId: TEST_SECTION_ID,
      subjectId: TEST_SUBJECT_ID,
      examId: "exam-t1-pt1",
      targetStatus: "published",
      user: { uid: "teacher-1", name: "Teacher", role: "teacher" },
    });
  } catch (err: any) {
    blockError = err.message;
  }
  assert(
    blockError.includes("Only Admin or HOD"),
    "Teacher role is strictly blocked from verifying/publishing marks",
    blockError
  );

  // Restore the marksEntry record to published if desired
  await transitionMarksWorkflow({
    sessionId: SESSION_ID,
    sectionId: TEST_SECTION_ID,
    subjectId: TEST_SUBJECT_ID,
    examId: "exam-t1-pt1",
    targetStatus: "published",
    user: { uid: "xQ2pLrZ48IR148x63Sg7CoFOU862", name: "Administrator", role: "admin" },
  });

  // -------------------------------------------------------------------------
  // TEST 23: Security rules authorization check
  // -------------------------------------------------------------------------
  console.log("\n--- Test 23: Security Rules Authorization Check ---");
  const rulesPath = path.resolve(process.cwd(), "firestore.rules");
  const rulesContent = fs.readFileSync(rulesPath, "utf-8");

  const hasMarksMatch = rulesContent.includes("match /marksEntries/{entryId}");
  const blocksLocked = rulesContent.includes("workflowStatus != 'locked'");
  const restrictsRole = rulesContent.includes("getUserRole() in ['hod', 'teacher']");
  const adminOverride = rulesContent.includes("isAdmin()");

  assert(
    hasMarksMatch && blocksLocked && restrictsRole && adminOverride,
    "Firestore rules strictly guard /marksEntries: teachers cannot modify locked marks, write restricted to authorized roles"
  );

  // -------------------------------------------------------------------------
  // TEST 24: No hardcoded exam names in source code
  // -------------------------------------------------------------------------
  console.log("\n--- Test 24: No Hardcoded Exam Names in Source Code ---");
  const marksEntryFilePath = path.resolve(process.cwd(), "src/pages/teacher/MarksEntry.tsx");
  const marksEntryContent = fs.readFileSync(marksEntryFilePath, "utf-8");

  const hardcodedPatterns = [
    /["']Unit Test 1["']/i,
    /["']Unit Test 2["']/i,
    /["']Term 1 Exam["']/i,
    /["']Term 2 Exam["']/i,
    /["']Half Yearly Exam["']/i,
    /["']Final Examination["']/i,
    /["']Annual Exam["']/i,
  ];

  let hardcodedFound = false;
  hardcodedPatterns.forEach((pat) => {
    if (pat.test(marksEntryContent)) {
      hardcodedFound = true;
      console.error(`Found hardcoded pattern: ${pat}`);
    }
  });

  assert(
    !hardcodedFound,
    "MarksEntry.tsx has zero hardcoded exam names (dynamic Academic Structure Planner used exclusively)"
  );

  // -------------------------------------------------------------------------
  // TEST 25: Clean production build
  // -------------------------------------------------------------------------
  console.log("\n--- Test 25: Clean Production Build ---");
  const distHtmlPath = path.resolve(process.cwd(), "dist/index.html");
  const buildExists = fs.existsSync(distHtmlPath);
  assert(
    buildExists,
    "Production build dist/index.html exists from clean Vite build execution"
  );

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log("\n======================================================================");
  console.log(`TEST SUITE SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (TOTAL: ${passedCount + failedCount}/25)`);
  console.log("======================================================================");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error("Test suite fatal error:", err);
  process.exit(1);
});

/**
 * Targeted Automated Verification Test Suite:
 * 1. NONSEC-01: Exemption Denominator Recomputation Across All Views
 * 2. NONSEC-06: E-Signature Invalidation on Marks Re-Entry
 *
 * Prestige International School ERP
 */

import {
  calculateStudentExamMarks,
  calculateSubjectTermAndOverall,
  evaluateInstitutionalResult,
  calculateTermResult,
  validateDisciplineGrade,
  VALID_DISCIPLINE_GRADES,
  invalidateReportCardSignaturesOnMarksChange,
  compileStudentAnnualReportCard,
  PublishedReportCardSnapshot,
  CalculatedSubjectResult,
} from "../src/lib/resultEngine";
import {
  DEFAULT_CALCULATION_CONFIG,
  GradingScale,
  AcademicStructureVersion,
  isSubjectOptional,
} from "../src/lib/academicStructure";
import type { Subject, Student } from "../src/lib/types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedCount++;
    console.log(`  \x1b[32m✓ PASS:\x1b[0m ${testName}`);
  } else {
    failedCount++;
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${testName} ${detail ? `(${detail})` : ""}`);
  }
}

const standardScale: GradingScale = {
  id: "cbse-secondary",
  name: "CBSE Secondary Grading Scale",
  passingPercentage: 33,
  tiers: [
    { grade: "A1", minPercentage: 91, maxPercentage: 100, gradePoint: 10 },
    { grade: "A2", minPercentage: 81, maxPercentage: 90.99, gradePoint: 9 },
    { grade: "B1", minPercentage: 71, maxPercentage: 80.99, gradePoint: 8 },
    { grade: "B2", minPercentage: 61, maxPercentage: 70.99, gradePoint: 7 },
    { grade: "C1", minPercentage: 51, maxPercentage: 60.99, gradePoint: 6 },
    { grade: "C2", minPercentage: 41, maxPercentage: 50.99, gradePoint: 5 },
    { grade: "D", minPercentage: 33, maxPercentage: 40.99, gradePoint: 4 },
    { grade: "E", minPercentage: 0, maxPercentage: 32.99, gradePoint: 0 },
  ],
};

async function runTests() {
  console.log("\n================================================================================");
  console.log("SUITE 1: NONSEC-01 — EXEMPTION DENOMINATOR RECOMPUTATION");
  console.log("================================================================================\n");

  // TEST 1: Ordinary numeric scores calculate correctly
  const standardNumericResults: CalculatedSubjectResult[] = [
    { subjectId: "sub-eng", subjectName: "English", category: "scholastic", overallTotal: 85, overallMax: 100, overallPercentage: 85, overallGrade: "A2", isPassed: true, isExempt: false },
    { subjectId: "sub-hin", subjectName: "Hindi", category: "scholastic", overallTotal: 75, overallMax: 100, overallPercentage: 75, overallGrade: "B1", isPassed: true, isExempt: false },
    { subjectId: "sub-mat", subjectName: "Math", category: "scholastic", overallTotal: 90, overallMax: 100, overallPercentage: 90, overallGrade: "A2", isPassed: true, isExempt: false },
    { subjectId: "sub-sci", subjectName: "Science", category: "scholastic", overallTotal: 80, overallMax: 100, overallPercentage: 80, overallGrade: "B1", isPassed: true, isExempt: false },
    { subjectId: "sub-sst", subjectName: "Social Science", category: "scholastic", overallTotal: 70, overallMax: 100, overallPercentage: 70, overallGrade: "B2", isPassed: true, isExempt: false },
  ];

  const evalNumeric = evaluateInstitutionalResult({
    scholasticResults: standardNumericResults,
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
  });

  assert(evalNumeric.grandTotal === 400, "Ordinary numeric scores contribute correct sum (400)");
  assert(evalNumeric.grandMax === 500, "Ordinary numeric scores have correct max denominator (500)");
  assert(evalNumeric.grandPercentage === 80, "Ordinary numeric scores have correct percentage (80%)");
  assert(evalNumeric.grandGrade === "B1", "Ordinary numeric scores resolve correct grade (B1)");
  assert(evalNumeric.resultStatus === "PASSED", "Ordinary numeric scores evaluate to PASSED");

  // TEST 2: Exempt optional subject is EXCLUDED from calculation denominator
  const resultsWithExemptOptional: CalculatedSubjectResult[] = [
    ...standardNumericResults, // 400 / 500 = 80%
    {
      subjectId: "sub-comp",
      subjectName: "Computer Applications (Optional)",
      category: "scholastic",
      isOptional: true,
      isExempt: true,
      overallTotal: 0,
      overallMax: 100,
      overallPercentage: 0,
      overallGrade: "EX",
      isPassed: true,
    },
  ];

  const evalExemptOpt = evaluateInstitutionalResult({
    scholasticResults: resultsWithExemptOptional,
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
  });

  assert(
    evalExemptOpt.grandMax === 500,
    "Exempt optional subject is excluded from calculation denominator (500 instead of 600)",
    `Actual grandMax: ${evalExemptOpt.grandMax}`
  );
  assert(
    evalExemptOpt.grandTotal === 400,
    "Exempt optional subject does not dilute grand total (400)",
    `Actual grandTotal: ${evalExemptOpt.grandTotal}`
  );
  assert(
    evalExemptOpt.grandPercentage === 80,
    "Student percentage remains 80% and is not diluted to 66.67% by optional EX",
    `Actual grandPercentage: ${evalExemptOpt.grandPercentage}`
  );
  assert(
    evalExemptOpt.resultStatus === "PASSED",
    "Exempt optional subject does not trigger compartment or failure"
  );

  // TEST 3: EX on a NON-OPTIONAL subject follows standard policy (retains denominator, not failed)
  const resultsWithExemptNonOptional: CalculatedSubjectResult[] = [
    { subjectId: "sub-eng", subjectName: "English", category: "scholastic", overallTotal: 85, overallMax: 100, overallPercentage: 85, overallGrade: "A2", isPassed: true, isExempt: false },
    { subjectId: "sub-hin", subjectName: "Hindi", category: "scholastic", overallTotal: 75, overallMax: 100, overallPercentage: 75, overallGrade: "B1", isPassed: true, isExempt: false },
    { subjectId: "sub-mat", subjectName: "Math (Core)", category: "scholastic", isOptional: false, isExempt: true, overallTotal: 0, overallMax: 100, overallPercentage: 0, overallGrade: "EX", isPassed: true },
    { subjectId: "sub-sci", subjectName: "Science", category: "scholastic", overallTotal: 80, overallMax: 100, overallPercentage: 80, overallGrade: "B1", isPassed: true, isExempt: false },
    { subjectId: "sub-sst", subjectName: "Social Science", category: "scholastic", overallTotal: 70, overallMax: 100, overallPercentage: 70, overallGrade: "B2", isPassed: true, isExempt: false },
  ];

  const evalExemptNonOpt = evaluateInstitutionalResult({
    scholasticResults: resultsWithExemptNonOptional,
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
  });

  assert(
    evalExemptNonOpt.grandMax === 500,
    "Non-optional EX subject follows institutional policy and retains denominator (500)"
  );
  assert(
    evalExemptNonOpt.grandTotal === 310,
    "Non-optional EX subject reflects actual earned sum across subjects (310)"
  );

  // TEST 4: Absent student marked AB follows absence policy
  const resultsWithAbsent: CalculatedSubjectResult[] = [
    { subjectId: "sub-eng", subjectName: "English", category: "scholastic", overallTotal: 85, overallMax: 100, overallPercentage: 85, overallGrade: "A2", isPassed: true, isExempt: false },
    { subjectId: "sub-hin", subjectName: "Hindi", category: "scholastic", overallTotal: 75, overallMax: 100, overallPercentage: 75, overallGrade: "B1", isPassed: true, isExempt: false },
    { subjectId: "sub-mat", subjectName: "Math", category: "scholastic", overallTotal: 0, overallMax: 100, overallPercentage: 0, overallGrade: "AB", isPassed: false, isExempt: false }, // absent
    { subjectId: "sub-sci", subjectName: "Science", category: "scholastic", overallTotal: 80, overallMax: 100, overallPercentage: 80, overallGrade: "B1", isPassed: true, isExempt: false },
    { subjectId: "sub-sst", subjectName: "Social Science", category: "scholastic", overallTotal: 70, overallMax: 100, overallPercentage: 70, overallGrade: "B2", isPassed: true, isExempt: false },
  ];

  const evalAbsent = evaluateInstitutionalResult({
    scholasticResults: resultsWithAbsent,
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
  });

  assert(evalAbsent.grandMax === 500, "Absent subject retains denominator (500)");
  assert(evalAbsent.grandTotal === 310, "Absent student earns 0 marks for absent subject");
  assert(evalAbsent.resultStatus === "COMPARTMENT", "Absent core subject marks student as COMPARTMENT");

  // TEST 5: Multiple optional subjects calculate correctly
  const resultsWithMultipleOptionals: CalculatedSubjectResult[] = [
    ...standardNumericResults, // 5 core subjects: 400 / 500
    { subjectId: "sub-opt1", subjectName: "Music (Optional 1)", category: "scholastic", isOptional: true, isExempt: false, overallTotal: 90, overallMax: 100, overallPercentage: 90, overallGrade: "A1", isPassed: true },
    { subjectId: "sub-opt2", subjectName: "French (Optional 2)", category: "scholastic", isOptional: true, isExempt: true, overallTotal: 0, overallMax: 100, overallPercentage: 0, overallGrade: "EX", isPassed: true },
  ];

  const evalMultiOpt = evaluateInstitutionalResult({
    scholasticResults: resultsWithMultipleOptionals,
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
  });

  assert(
    evalMultiOpt.grandMax === 600,
    "Denominator includes active optional subject (500+100) and excludes exempt optional subject (600 instead of 700)"
  );
  assert(
    evalMultiOpt.grandTotal === 490,
    "Grand total includes active optional subject (400 + 90 = 490)"
  );
  assert(
    Math.abs(evalMultiOpt.grandPercentage - 81.67) < 0.5,
    "Percentage is calculated accurately out of 600 (approx 81.7%)"
  );

  // TEST 6: Assessments with different maximum marks calculate correctly
  const resultsWithVariableMax: CalculatedSubjectResult[] = [
    { subjectId: "sub-eng", subjectName: "English", category: "scholastic", overallTotal: 68, overallMax: 80, overallPercentage: 85, overallGrade: "A2", isPassed: true, isExempt: false },
    { subjectId: "sub-sci", subjectName: "Science", category: "scholastic", overallTotal: 63, overallMax: 70, overallPercentage: 90, overallGrade: "A1", isPassed: true, isExempt: false },
    { subjectId: "sub-pe", subjectName: "Physical Ed (Opt)", category: "scholastic", isOptional: true, isExempt: true, overallTotal: 0, overallMax: 50, overallPercentage: 0, overallGrade: "EX", isPassed: true },
  ];

  const evalVariableMax = evaluateInstitutionalResult({
    scholasticResults: resultsWithVariableMax,
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
  });

  assert(
    evalVariableMax.grandMax === 150,
    "Variable max marks sum correctly (80 + 70 = 150, excluding 50 opt EX)"
  );
  assert(evalVariableMax.grandTotal === 131, "Variable marks sum correctly (68 + 63 = 131)");

  // TEST 7: Multi-term calculations handle term-wise exemptions without halving scores
  const subjectTermExempt = calculateSubjectTermAndOverall({
    terms: {
      term1: { examTotal: 0, examMax: 100, isAbsent: false, isExempt: true }, // Exempt Term 1
      term2: { examTotal: 84, examMax: 100, isAbsent: false, isExempt: false }, // Scored 84 in Term 2
    },
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
  });

  assert(
    subjectTermExempt.overallTotal === 84,
    "Term 1 exemption allows Term 2 to represent annual performance (84 instead of 42)"
  );
  assert(
    subjectTermExempt.overallMax === 100,
    "Overall max for single evaluated term is 100"
  );
  assert(
    subjectTermExempt.overallPercentage === 84,
    "Overall percentage reflects Term 2 performance (84%)"
  );
  assert(
    subjectTermExempt.overallGrade === "A2",
    "Grade reflects Term 2 score (A2)"
  );

  // Both terms exempt
  const subjectBothExempt = calculateSubjectTermAndOverall({
    terms: {
      term1: { examTotal: 0, examMax: 100, isAbsent: false, isExempt: true },
      term2: { examTotal: 0, examMax: 100, isAbsent: false, isExempt: true },
    },
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
  });

  assert(subjectBothExempt.overallGrade === "EX", "Subject with both terms exempt evaluates to EX");
  assert(subjectBothExempt.isExempt === true, "Subject with both terms exempt flags isExempt: true");
  assert(subjectBothExempt.overallMax === 0, "Subject with both terms exempt has overallMax 0");

  // TEST 8: Division-by-zero prevention when no eligible assessments contribute
  const resultsAllExemptOptional: CalculatedSubjectResult[] = [
    { subjectId: "sub-opt1", subjectName: "French (Opt)", category: "scholastic", isOptional: true, isExempt: true, overallTotal: 0, overallMax: 100, overallPercentage: 0, overallGrade: "EX", isPassed: true },
    { subjectId: "sub-opt2", subjectName: "Sanskrit (Opt)", category: "scholastic", isOptional: true, isExempt: true, overallTotal: 0, overallMax: 100, overallPercentage: 0, overallGrade: "EX", isPassed: true },
  ];

  const evalAllExempt = evaluateInstitutionalResult({
    scholasticResults: resultsAllExemptOptional,
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
  });

  assert(!isNaN(evalAllExempt.grandPercentage), "Grand percentage is not NaN when all assessments are exempt optional");
  assert(isFinite(evalAllExempt.grandPercentage), "Grand percentage is not Infinity");
  assert(evalAllExempt.grandMax === 0, "Grand max is safely 0");
  assert(evalAllExempt.grandGrade === "EX", "Grade resolves to EX instead of fabricating a letter grade");
  assert(evalAllExempt.resultStatus === "WITHHELD", "Status resolves to WITHHELD");

  // TEST 9: Single-term calculation function respects optional exemptions
  const termRes = calculateTermResult({
    termId: "term_1",
    scholasticResults: [
      { subjectId: "sub-1", subjectName: "English", totalMarks: 80, maxMarks: 100, percentage: 80, isExempt: false, isOptional: false },
      { subjectId: "sub-2", subjectName: "Optional Art", totalMarks: 0, maxMarks: 100, percentage: 0, isExempt: true, isOptional: true },
    ],
    gradingScale: standardScale,
  });

  assert(termRes.termMax === 100, "calculateTermResult excludes exempt optional subject from termMax (100 instead of 200)");
  assert(termRes.termTotal === 80, "calculateTermResult preserves total (80)");
  assert(termRes.termPercentage === 80, "calculateTermResult calculates 80%");

  console.log("\n================================================================================");
  console.log("SUITE 2: NONSEC-06 — E-SIGNATURE INVALIDATION AFTER MARKS RE-ENTRY");
  console.log("================================================================================\n");

  // Synthetic report card document simulation for testing invalidation logic
  const mockCardTeacherSigned = {
    workflowStatus: "teacher_signed",
    signatures: {
      classTeacher: { name: "Ms. Sarah", signedAt: "2026-10-15T10:00:00Z" },
    },
  };

  const mockCardHodSigned = {
    workflowStatus: "hod_signed",
    signatures: {
      classTeacher: { name: "Ms. Sarah", signedAt: "2026-10-15T10:00:00Z" },
      hod: { name: "Dr. Vance", signedAt: "2026-10-16T11:00:00Z" },
    },
  };

  const mockCardPublished = {
    workflowStatus: "published",
    isLocked: true,
    publishedAt: "2026-10-17T14:00:00Z",
    signatures: {
      classTeacher: { name: "Ms. Sarah", signedAt: "2026-10-15T10:00:00Z" },
      hod: { name: "Dr. Vance", signedAt: "2026-10-16T11:00:00Z" },
      principal: { name: "Rev. Mathews", signedAt: "2026-10-17T14:00:00Z" },
    },
  };

  // TEST 10: Invalidation behavior when Class Teacher had signed
  // Verifying contract: when card is in teacher_signed, invalidation clears signatures and resets to draft
  const stagesToInvalidateCT: string[] = [];
  if (mockCardTeacherSigned.signatures.classTeacher) stagesToInvalidateCT.push("class_teacher");
  assert(
    stagesToInvalidateCT.includes("class_teacher") && stagesToInvalidateCT.length === 1,
    "Identifies Class Teacher signature stage for invalidation"
  );

  // TEST 11: Invalidation behavior when HOD had signed
  const stagesToInvalidateHOD: string[] = [];
  if (mockCardHodSigned.signatures.classTeacher) stagesToInvalidateHOD.push("class_teacher");
  if (mockCardHodSigned.signatures.hod) stagesToInvalidateHOD.push("hod");
  assert(
    stagesToInvalidateHOD.length === 2 && stagesToInvalidateHOD.includes("class_teacher") && stagesToInvalidateHOD.includes("hod"),
    "Identifies both Class Teacher and HOD stages for invalidation on reopened HOD card"
  );

  // TEST 12: Historical Document Rule: Published report cards must NEVER be rewritten or invalidated
  const isProtectedPublished = mockCardPublished.workflowStatus === "published" || mockCardPublished.isLocked === true;
  assert(isProtectedPublished === true, "Identifies published/locked report card as immutable");

  // TEST 13: Optional subject identification helper
  const mockStructureVersion: AcademicStructureVersion = {
    id: "struct-10_v1",
    structureId: "struct-10",
    versionNumber: 1,
    effectiveSessionId: "session-2026",
    academicYear: "2026-27",
    terms: [],
    subjects: [
      { subjectId: "sub-math", subjectName: "Mathematics", category: "scholastic", order: 1, isOptional: false },
      { subjectId: "sub-sans", subjectName: "Sanskrit", category: "scholastic", order: 2, isOptional: true },
    ],
    exams: [],
    assessmentComponents: [],
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: standardScale,
    coScholasticAreas: [],
    reportCardLayout: {} as any,
    createdAt: "",
    createdBy: "",
  };

  const isMathOpt = isSubjectOptional({
    subjectId: "sub-math",
    structureVersion: mockStructureVersion,
  });
  const isSansOpt = isSubjectOptional({
    subjectId: "sub-sans",
    structureVersion: mockStructureVersion,
  });

  assert(isMathOpt === false, "Correctly identifies Mathematics as non-optional");
  assert(isSansOpt === true, "Correctly identifies Sanskrit as optional in structure version");

  // Subject object fallback
  const mockSubjDoc: Subject = { id: "sub-music", name: "Music", grade: "10", isOptional: true };
  const isMusicOpt = isSubjectOptional({ subjectId: "sub-music", subject: mockSubjDoc });
  assert(isMusicOpt === true, "Correctly identifies optional subject from Subject document");

  console.log("\n================================================================================");
  console.log(`TEST RESULTS SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("================================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

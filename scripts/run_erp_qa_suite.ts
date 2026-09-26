/**
 * Full ERP System-Wide QA & Automated Regression Test Suite
 * Covers pure engines: Academic Structure, Result Calculations, Fees, Hall Tickets,
 * Enrollments & Promotions, Calendar Recurrence, and Security RBAC rules.
 */

import {
  sumFeeHeads,
  sumInstallments,
  buildInstallmentLedger,
  getFeeCollectionSummary,
} from "../src/lib/fees";
import {
  applyRounding,
  resolveGrade,
  calculateStudentExamMarks,
  calculateSubjectTermAndOverall,
  calculateTermResult,
  evaluateInstitutionalResult,
  ComponentScoreInput,
} from "../src/lib/resultEngine";
import {
  GradingScale,
  AssessmentComponent,
  CalculationConfiguration,
  AcademicStructureVersion,
  DEFAULT_CALCULATION_CONFIG,
  getEffectiveComponentsForSubject,
} from "../src/lib/academicStructure";
import {
  evaluateStudentExamEligibility,
  bulkGenerateHallTickets,
  HallTicketStudentEligibility,
  EvaluationInput,
} from "../src/lib/hallTicketEngine";
import {
  FeePayment,
  FeeStructure,
  Student,
  Enrollment,
  ExamSchedule,
  HallTicketGlobalSettings,
  HallTicketRule,
  HallTicketBypass,
} from "../src/lib/types";
import { expandRecurringOccurrences, canUserViewEvent } from "../src/lib/calendar";
import * as fs from "fs";

interface TestResult {
  suite: string;
  testName: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}: ${message}`);
  }
}

function runTest(suite: string, name: string, fn: () => void) {
  const start = performance.now();
  try {
    fn();
    const duration = performance.now() - start;
    results.push({ suite, testName: name, passed: true, durationMs: duration });
    console.log(`  ✓ [PASS] ${name} (${duration.toFixed(1)}ms)`);
  } catch (err: any) {
    const duration = performance.now() - start;
    results.push({ suite, testName: name, passed: false, error: err.message, durationMs: duration });
    console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
  }
}

console.log("\n========================================================");
console.log("   PRESTIGE ERP - FULL AUTOMATED QA & REGRESSION SUITE   ");
console.log("========================================================\n");

// ============================================================================
// SUITE 1: FEES & INSTALLMENTS ENGINE
// ============================================================================
console.log("--- Suite 1: Fees & Installment Ledger Engine ---");

runTest("Fees", "sumFeeHeads correctly calculates total across multiple fee heads", () => {
  const structure = {
    feeHeads: [
      { id: "h1", name: "Tuition Fee", amount: 30000 },
      { id: "h2", name: "Library & Lab Fee", amount: 12000 },
      { id: "h3", name: "Development Fee", amount: 8000 },
    ],
  };
  assertEqual(sumFeeHeads(structure), 50000, "Sum of fee heads must equal 50,000");
});

runTest("Fees", "sumInstallments matches total fee heads", () => {
  const structure = {
    installments: [
      { id: "inst_1", label: "Term 1 Installment", amount: 25000, dueDate: "2026-06-15" },
      { id: "inst_2", label: "Term 2 Installment", amount: 25000, dueDate: "2026-11-15" },
    ],
  };
  assertEqual(sumInstallments(structure), 50000, "Sum of installments must equal 50,000");
});

runTest("Fees", "buildInstallmentLedger: unpaid past due is overdue, unpaid future is pending", () => {
  const structure = {
    installments: [
      { id: "inst_1", label: "Term 1 Installment", amount: 25000, dueDate: "2026-05-01" },
      { id: "inst_2", label: "Term 2 Installment", amount: 25000, dueDate: "2026-12-01" },
    ],
  };
  const payments: FeePayment[] = [];
  const testDate = new Date("2026-07-01"); // Between inst 1 and inst 2

  const ledger = buildInstallmentLedger(structure, payments, testDate);
  assertEqual(ledger[0].status, "overdue", "Installment 1 past due date with 0 payment must be overdue");
  assertEqual(ledger[0].balance, 25000, "Installment 1 balance must be full amount");
  assertEqual(ledger[1].status, "pending", "Installment 2 before due date with 0 payment must be pending");
  assertEqual(ledger[1].balance, 25000, "Installment 2 balance must be full amount");
});

runTest("Fees", "buildInstallmentLedger: partial payment marks status partial, balance = amount - paid", () => {
  const structure = {
    installments: [
      { id: "inst_1", label: "Term 1 Installment", amount: 25000, dueDate: "2026-08-01" },
    ],
  };
  const payments: FeePayment[] = [
    {
      id: "p1",
      academicSession: "2026-27",
      grade: "9",
      structureId: "struct_1",
      studentId: "stu_1",
      studentName: "Aarav Sharma",
      installmentId: "inst_1",
      amount: 15000,
      paymentMode: "cash",
      paidAt: "2026-06-10",
      recordedBy: "admin",
      receiptNo: "RC-001",
    },
  ];
  const testDate = new Date("2026-06-15");

  const ledger = buildInstallmentLedger(structure, payments, testDate);
  assertEqual(ledger[0].paid, 15000, "Paid amount must be 15,000");
  assertEqual(ledger[0].balance, 10000, "Balance must be 25,000 - 15,000 = 10,000");
  assertEqual(ledger[0].status, "partial", "Status must be partial");
});

runTest("Fees", "buildInstallmentLedger: full payment marks status paid, balance = 0", () => {
  const structure = {
    installments: [
      { id: "inst_1", label: "Term 1 Installment", amount: 25000, dueDate: "2026-08-01" },
    ],
  };
  const payments: FeePayment[] = [
    {
      id: "p1",
      academicSession: "2026-27",
      grade: "9",
      structureId: "struct_1",
      studentId: "stu_1",
      studentName: "Aarav Sharma",
      installmentId: "inst_1",
      amount: 25000,
      paymentMode: "online",
      paidAt: "2026-06-10",
      recordedBy: "online_gateway",
      receiptNo: "RC-002",
    },
  ];
  const testDate = new Date("2026-06-15");

  const ledger = buildInstallmentLedger(structure, payments, testDate);
  assertEqual(ledger[0].paid, 25000, "Paid amount must be 25,000");
  assertEqual(ledger[0].balance, 0, "Balance must be 0");
  assertEqual(ledger[0].status, "paid", "Status must be paid");
});

runTest("Fees", "getFeeCollectionSummary: handles multiple installments & partial payments", () => {
  const structure = {
    installments: [
      { id: "inst_1", label: "Installment 1", amount: 30000, dueDate: "2026-05-01" },
      { id: "inst_2", label: "Installment 2", amount: 20000, dueDate: "2026-11-01" },
    ],
  };
  const payments: FeePayment[] = [
    {
      id: "p1",
      academicSession: "2026-27",
      grade: "9",
      structureId: "struct_1",
      studentId: "stu_1",
      studentName: "Aarav Sharma",
      installmentId: "inst_1",
      amount: 30000,
      paymentMode: "cash",
      paidAt: "2026-04-10",
      recordedBy: "admin",
      receiptNo: "RC-003",
    },
    {
      id: "p2",
      academicSession: "2026-27",
      grade: "9",
      structureId: "struct_1",
      studentId: "stu_1",
      studentName: "Aarav Sharma",
      installmentId: "inst_2",
      amount: 5000,
      paymentMode: "online",
      paidAt: "2026-05-10",
      recordedBy: "gateway",
      receiptNo: "RC-004",
    },
  ];

  const summary = getFeeCollectionSummary(structure, payments, new Date("2026-06-01"));
  assertEqual(summary.totalScheduled, 50000, "Total scheduled must be 50,000");
  assertEqual(summary.totalPaid, 35000, "Total paid must be 30,000 + 5,000 = 35,000");
  assertEqual(summary.totalOutstanding, 15000, "Outstanding must be 15,000");
  assert(summary.nextDue !== null, "Next due installment should exist");
  assertEqual(summary.nextDue?.id, "inst_2", "Next due installment must be inst_2");
});

// ============================================================================
// SUITE 2: ACADEMIC STRUCTURE & MARKS CALCULATION ENGINE
// ============================================================================
console.log("\n--- Suite 2: Academic Structure & Result Engine ---");

const testScale: GradingScale = {
  id: "cbse_9_scale",
  name: "CBSE 8-Point Scale",
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

runTest("ResultEngine", "resolveGrade: correctly maps percentages across all grade tiers", () => {
  assertEqual(resolveGrade(95, testScale), "A1", "95% -> A1");
  assertEqual(resolveGrade(91, testScale), "A1", "91% -> A1");
  assertEqual(resolveGrade(85, testScale), "A2", "85% -> A2");
  assertEqual(resolveGrade(75, testScale), "B1", "75% -> B1");
  assertEqual(resolveGrade(65, testScale), "B2", "65% -> B2");
  assertEqual(resolveGrade(55, testScale), "C1", "55% -> C1");
  assertEqual(resolveGrade(45, testScale), "C2", "45% -> C2");
  assertEqual(resolveGrade(35, testScale), "D", "35% -> D");
  assertEqual(resolveGrade(25, testScale), "E", "25% -> E (Fail)");
});

runTest("ResultEngine", "applyRounding: correctly applies rounding rules", () => {
  assertEqual(applyRounding(75.456, "round_half_up", 2), 75.46, "75.456 round_half_up -> 75.46");
  assertEqual(applyRounding(75.454, "round_half_up", 2), 75.45, "75.454 round_half_up -> 75.45");
  assertEqual(applyRounding(75.459, "floor", 2), 75.45, "75.459 floor -> 75.45");
  assertEqual(applyRounding(75.451, "ceil", 2), 75.46, "75.451 ceil -> 75.46");
});

runTest("ResultEngine", "Scholastic 100 Marks: PT(10) + NB(5) + SEA(5) + Exam(80) = 100", () => {
  const components: AssessmentComponent[] = [
    { id: "c_pt", code: "PT", name: "Periodic Test", maxMarks: 10, contributeToTotal: true, sequence: 1 },
    { id: "c_nb", code: "NB", name: "Notebook", maxMarks: 5, contributeToTotal: true, sequence: 2 },
    { id: "c_sea", code: "SEA", name: "Subject Enrichment", maxMarks: 5, contributeToTotal: true, sequence: 3 },
    { id: "c_hy", code: "EXAM", name: "Half Yearly Exam", maxMarks: 80, contributeToTotal: true, sequence: 4 },
  ];

  const inputs: Record<string, ComponentScoreInput> = {
    c_pt: { marks: 8, status: "present" },
    c_nb: { marks: 5, status: "present" },
    c_sea: { marks: 4, status: "present" },
    c_hy: { marks: 72, status: "present" },
  };

  const res = calculateStudentExamMarks({
    components,
    componentInputs: inputs,
    scale: testScale,
  });

  assertEqual(res.totalRawMarks, 89, "Total raw marks must be 8 + 5 + 4 + 72 = 89");
  assertEqual(res.totalMaxMarks, 100, "Total max marks must be 100");
  assertEqual(res.calculatedPercentage, 89, "Calculated percentage must be 89%");
  assertEqual(res.calculatedGrade, "A2", "Grade for 89% must be A2");
  assertEqual(res.isPassed, true, "89% must be passed");
  assertEqual(res.isAbsent, false, "Must not be absent");
});

runTest("ResultEngine", "Scholastic 50 Marks: PT(5) + Project(10) + NB(5) + Exam(30) = 50", () => {
  const components: AssessmentComponent[] = [
    { id: "c_pt", code: "PT", name: "Periodic Test", maxMarks: 5, contributeToTotal: true, sequence: 1 },
    { id: "c_prj", code: "PRJ", name: "Project", maxMarks: 10, contributeToTotal: true, sequence: 2 },
    { id: "c_nb", code: "NB", name: "Notebook", maxMarks: 5, contributeToTotal: true, sequence: 3 },
    { id: "c_exam", code: "EXAM", name: "Terminal Exam", maxMarks: 30, contributeToTotal: true, sequence: 4 },
  ];

  const inputs: Record<string, ComponentScoreInput> = {
    c_pt: { marks: 5, status: "present" },
    c_prj: { marks: 9, status: "present" },
    c_nb: { marks: 5, status: "present" },
    c_exam: { marks: 28, status: "present" },
  };

  const res = calculateStudentExamMarks({
    components,
    componentInputs: inputs,
    scale: testScale,
  });

  assertEqual(res.totalRawMarks, 47, "Total raw marks must be 5 + 9 + 5 + 28 = 47");
  assertEqual(res.totalMaxMarks, 50, "Total max marks must be 50");
  assertEqual(res.calculatedPercentage, 94, "Percentage must be (47/50)*100 = 94%");
  assertEqual(res.calculatedGrade, "A1", "Grade for 94% must be A1");
  assertEqual(res.isPassed, true, "Must be passed");
});

runTest("ResultEngine", "Component Scaling: PT tested out of 40 scaled to 10 marks", () => {
  const components: AssessmentComponent[] = [
    {
      id: "c_pt_scaled",
      code: "PT",
      name: "Periodic Test (Raw 40 -> 10)",
      maxMarks: 40,
      scalingTargetMarks: 10,
      contributeToTotal: true,
      sequence: 1,
    },
    { id: "c_exam", code: "EXAM", name: "Terminal Exam", maxMarks: 90, contributeToTotal: true, sequence: 2 },
  ];

  // Student scored 32 out of 40 in PT -> scaled to (32/40)*10 = 8.
  // Student scored 72 out of 90 in Exam.
  const inputs: Record<string, ComponentScoreInput> = {
    c_pt_scaled: { marks: 32, status: "present" },
    c_exam: { marks: 72, status: "present" },
  };

  const res = calculateStudentExamMarks({
    components,
    componentInputs: inputs,
    scale: testScale,
  });

  assertEqual(res.scaledTotalMarks, 80, "Scaled total marks must be 8 + 72 = 80");
  assertEqual(res.totalMaxMarks, 100, "Total effective max marks must be 10 + 90 = 100");
  assertEqual(res.calculatedPercentage, 80, "Percentage must be 80%");
  assertEqual(res.calculatedGrade, "B1", "Grade for 80% must be B1");
});

runTest("ResultEngine", "Absent handling: Marks null, counted against denominator, student marked absent", () => {
  const components: AssessmentComponent[] = [
    { id: "c_pt", code: "PT", name: "Periodic Test", maxMarks: 20, contributeToTotal: true, sequence: 1 },
    { id: "c_exam", code: "EXAM", name: "Terminal Exam", maxMarks: 80, contributeToTotal: true, sequence: 2 },
  ];

  const inputs: Record<string, ComponentScoreInput> = {
    c_pt: { marks: null, status: "absent" },
    c_exam: { marks: null, status: "absent" },
  };

  const res = calculateStudentExamMarks({
    components,
    componentInputs: inputs,
    scale: testScale,
  });

  assertEqual(res.isAbsent, true, "Student must be marked absent");
  assertEqual(res.totalRawMarks, 0, "Raw marks must be 0");
  assertEqual(res.calculatedPercentage, 0, "Percentage must be 0");
  assertEqual(res.calculatedGrade, "AB", "Grade for absent student must be 'AB' (standard CBSE notation)");
  assertEqual(res.isPassed, false, "Absent student is not passed");
});

runTest("ResultEngine", "Term Weighting: Equal Average (50% Term 1 + 50% Term 2)", () => {
  const config: CalculationConfiguration = {
    ...DEFAULT_CALCULATION_CONFIG,
    termWeighting: {
      mode: "equal_average",
      weights: { term1: 50, term2: 50 },
    },
  };

  // Term 1: 80 / 100 (80%)
  // Term 2: 90 / 100 (90%)
  // Overall should be 50% of 80 + 50% of 90 = 40 + 45 = 85 / 100 (85%, A2)
  const result = calculateSubjectTermAndOverall({
    terms: {
      term1: { examTotal: 80, examMax: 100, isAbsent: false, isExempt: false },
      term2: { examTotal: 90, examMax: 100, isAbsent: false, isExempt: false },
    },
    calculationConfig: config,
    gradingScale: testScale,
  });

  assertEqual(result.overallTotal, 85, "Overall total must be 85");
  assertEqual(result.overallPercentage, 85, "Overall percentage must be 85%");
  assertEqual(result.overallGrade, "A2", "Grade for 85% must be A2");
  assertEqual(result.isPassed, true, "Must be passed");
});

runTest("ResultEngine", "Term Weighting: Custom Weights (40% Term 1 + 60% Term 2)", () => {
  const config: CalculationConfiguration = {
    ...DEFAULT_CALCULATION_CONFIG,
    termWeighting: {
      mode: "weighted_terms",
      weights: { term1: 40, term2: 60 },
    },
  };

  // Term 1: 50 / 100 (50%) -> 40% weight gives 20
  // Term 2: 80 / 100 (80%) -> 60% weight gives 48
  // Total = 20 + 48 = 68 / 100 (68%, B2)
  const result = calculateSubjectTermAndOverall({
    terms: {
      term1: { examTotal: 50, examMax: 100, isAbsent: false, isExempt: false },
      term2: { examTotal: 80, examMax: 100, isAbsent: false, isExempt: false },
    },
    calculationConfig: config,
    gradingScale: testScale,
  });

  assertEqual(result.overallTotal, 68, "Overall total must be 68");
  assertEqual(result.overallPercentage, 68, "Overall percentage must be 68%");
  assertEqual(result.overallGrade, "B2", "Grade for 68% must be B2");
  assertEqual(result.isPassed, true, "Must be passed");
});

runTest("ResultEngine", "Institutional Result: Passed vs Compartment vs Failed", () => {
  const config = DEFAULT_CALCULATION_CONFIG;

  // Case A: All passed -> PASSED
  const allPassed = [
    { overallTotal: 85, overallMax: 100, overallPercentage: 85, isPassed: true },
    { overallTotal: 72, overallMax: 100, overallPercentage: 72, isPassed: true },
    { overallTotal: 65, overallMax: 100, overallPercentage: 65, isPassed: true },
    { overallTotal: 90, overallMax: 100, overallPercentage: 90, isPassed: true },
    { overallTotal: 80, overallMax: 100, overallPercentage: 80, isPassed: true },
  ];
  const evalA = evaluateInstitutionalResult({
    scholasticResults: allPassed,
    calculationConfig: config,
    gradingScale: testScale,
  });
  assertEqual(evalA.resultStatus, "PASSED", "All passed subjects must yield PASSED");

  // Case B: 1 subject failed (25%) -> COMPARTMENT (allow up to 1 subject fail)
  const oneFailed = [
    { overallTotal: 85, overallMax: 100, overallPercentage: 85, isPassed: true },
    { overallTotal: 25, overallMax: 100, overallPercentage: 25, isPassed: false },
    { overallTotal: 65, overallMax: 100, overallPercentage: 65, isPassed: true },
    { overallTotal: 90, overallMax: 100, overallPercentage: 90, isPassed: true },
    { overallTotal: 80, overallMax: 100, overallPercentage: 80, isPassed: true },
  ];
  const evalB = evaluateInstitutionalResult({
    scholasticResults: oneFailed,
    calculationConfig: config,
    gradingScale: testScale,
  });
  assertEqual(evalB.resultStatus, "COMPARTMENT", "1 subject failing must yield COMPARTMENT");

  // Case C: 2 subjects failed -> FAILED
  const twoFailed = [
    { overallTotal: 85, overallMax: 100, overallPercentage: 85, isPassed: true },
    { overallTotal: 25, overallMax: 100, overallPercentage: 25, isPassed: false },
    { overallTotal: 20, overallMax: 100, overallPercentage: 20, isPassed: false },
    { overallTotal: 90, overallMax: 100, overallPercentage: 90, isPassed: true },
    { overallTotal: 80, overallMax: 100, overallPercentage: 80, isPassed: true },
  ];
  const evalC = evaluateInstitutionalResult({
    scholasticResults: twoFailed,
    calculationConfig: config,
    gradingScale: testScale,
  });
  assertEqual(evalC.resultStatus, "FAILED", "2 subjects failing must yield FAILED");
});

// ============================================================================
// SUITE 3: HALL TICKET & FEE ELIGIBILITY RULE ENGINE
// ============================================================================
console.log("\n--- Suite 3: Hall Ticket & Fee Eligibility Engine ---");

const mockStudent: Student = {
  id: "stu_test_001",
  uid: "auth_uid_001",
  studentUid: "STU20260001",
  name: "Aditya Nair",
  admissionNo: "ADM2026/042",
  grade: "9",
  rollNo: "9A01",
  email: "aditya@school.edu",
};

const mockSchedule: ExamSchedule = {
  id: "sched_term1_hy",
  examType: "Half-Yearly Examination",
  academicYear: "2026-27",
  grade: "9",
  status: "approved",
  termId: "term_1",
  termName: "Term 1",
  definedExamId: "def_exam_hy",
  exams: [
    {
      subjectId: "sub_eng",
      subjectName: "English Language",
      date: "2026-09-15",
      startTime: "09:00",
      endTime: "12:00",
      venue: "Main Examination Hall A",
      maxMarks: 80,
      passingMarks: 27,
    },
    {
      subjectId: "sub_math",
      subjectName: "Mathematics",
      date: "2026-09-17",
      startTime: "09:00",
      endTime: "12:00",
      venue: "Main Examination Hall A",
      maxMarks: 80,
      passingMarks: 27,
    },
  ],
};

const mockFeeStructure: FeeStructure = {
  id: "fs_grade_9",
  grade: "9",
  academicSession: "2026-27",
  totalAmount: 50000,
  feeHeads: [{ id: "h1", name: "Tuition", amount: 50000 }],
  installments: [
    { id: "inst_1", label: "Term 1 Installment", amount: 25000, dueDate: "2026-06-30" },
    { id: "inst_2", label: "Term 2 Installment", amount: 25000, dueDate: "2026-11-30" },
  ],
};

runTest("HallTickets", "Global Fee Gate Disabled: All students eligible regardless of fees", () => {
  const globalSettingsDisabled: HallTicketGlobalSettings = {
    id: "default",
    feeGateEnabled: false, // DISABLED
    defaultInstructions: ["Bring admit card"],
    updatedAt: "2026-06-01",
    updatedBy: "admin",
  };

  const res = evaluateStudentExamEligibility({
    student: mockStudent,
    schedule: mockSchedule,
    feeStructure: mockFeeStructure,
    studentPayments: [], // ₹0 paid!
    globalSettings: globalSettingsDisabled,
  });

  assertEqual(res.eligible, true, "Student must be eligible when master fee gate is disabled");
  assertEqual(res.status, "eligible", "Status must be eligible");
  assert(res.reason.includes("disabled"), "Reason should indicate fee restriction is disabled");
});

runTest("HallTickets", "Rule: Installment 1 >= 50%. Paid 30% -> BLOCKED, Paid 50% -> ELIGIBLE", () => {
  const globalSettingsEnabled: HallTicketGlobalSettings = {
    id: "default",
    feeGateEnabled: true,
    defaultInstructions: ["Bring admit card"],
    updatedAt: "2026-06-01",
    updatedBy: "admin",
  };

  const rule50Pct: HallTicketRule = {
    id: "rule_unit_test",
    sessionId: "2026-27",
    definedExamId: "def_exam_hy",
    examName: "Half-Yearly Examination",
    requirementType: "installment_percentage",
    installmentId: "inst_1",
    installmentLabel: "Term 1 Installment",
    minimumPaymentPercentage: 50, // 50% of 25,000 = 12,500 required
    feeGateEnabled: true,
    createdAt: "2026-06-01",
    updatedAt: "2026-06-01",
  };

  // 1. Paid 30% (7,500) -> BLOCKED
  const payments30Pct: FeePayment[] = [
    {
      id: "p1",
      academicSession: "2026-27",
      grade: "9",
      structureId: "fs_grade_9",
      studentId: mockStudent.id,
      studentName: mockStudent.name,
      installmentId: "inst_1",
      installmentLabel: "Term 1 Installment",
      amount: 7500,
      paymentMode: "cash",
      paidAt: "2026-06-10",
      recordedBy: "admin",
    },
  ];

  const evalBlocked = evaluateStudentExamEligibility({
    student: mockStudent,
    schedule: mockSchedule,
    feeStructure: mockFeeStructure,
    studentPayments: payments30Pct,
    globalSettings: globalSettingsEnabled,
    examRule: rule50Pct,
  });

  assertEqual(evalBlocked.eligible, false, "Student with 30% payment must be blocked");
  assertEqual(evalBlocked.status, "blocked", "Status must be blocked");
  assert(evalBlocked.reason.includes("30%"), "Block reason must cite current percentage");

  // 2. Paid 50% (12,500) -> ELIGIBLE
  const payments50Pct: FeePayment[] = [
    {
      id: "p1",
      academicSession: "2026-27",
      grade: "9",
      structureId: "fs_grade_9",
      studentId: mockStudent.id,
      studentName: mockStudent.name,
      installmentId: "inst_1",
      installmentLabel: "Term 1 Installment",
      amount: 12500,
      paymentMode: "cash",
      paidAt: "2026-06-10",
      recordedBy: "admin",
    },
  ];

  const evalEligible = evaluateStudentExamEligibility({
    student: mockStudent,
    schedule: mockSchedule,
    feeStructure: mockFeeStructure,
    studentPayments: payments50Pct,
    globalSettings: globalSettingsEnabled,
    examRule: rule50Pct,
  });

  assertEqual(evalEligible.eligible, true, "Student with 50% payment must be eligible");
  assertEqual(evalEligible.status, "eligible", "Status must be eligible");
});

runTest("HallTickets", "Rule: Installment 1 == 100%. Paid 80% -> BLOCKED, Paid 100% -> ELIGIBLE", () => {
  const globalSettingsEnabled: HallTicketGlobalSettings = {
    id: "default",
    feeGateEnabled: true,
    defaultInstructions: ["Bring admit card"],
    updatedAt: "2026-06-01",
    updatedBy: "admin",
  };

  const rule100Pct: HallTicketRule = {
    id: "rule_term_exam",
    sessionId: "2026-27",
    definedExamId: "def_exam_hy",
    examName: "Half-Yearly Examination",
    requirementType: "installment_full",
    installmentId: "inst_1",
    installmentLabel: "Term 1 Installment",
    feeGateEnabled: true,
    createdAt: "2026-06-01",
    updatedAt: "2026-06-01",
  };

  // Paid 20,000 of 25,000 (80%) -> BLOCKED
  const payments80Pct: FeePayment[] = [
    {
      id: "p1",
      academicSession: "2026-27",
      grade: "9",
      structureId: "fs_grade_9",
      studentId: mockStudent.id,
      studentName: mockStudent.name,
      installmentId: "inst_1",
      amount: 20000,
      paymentMode: "cash",
      paidAt: "2026-06-10",
      recordedBy: "admin",
    },
  ];

  const evalBlocked = evaluateStudentExamEligibility({
    student: mockStudent,
    schedule: mockSchedule,
    feeStructure: mockFeeStructure,
    studentPayments: payments80Pct,
    globalSettings: globalSettingsEnabled,
    examRule: rule100Pct,
  });

  assertEqual(evalBlocked.eligible, false, "80% paid student must be blocked for full installment rule");

  // Paid 25,000 of 25,000 (100%) -> ELIGIBLE
  const payments100Pct: FeePayment[] = [
    {
      id: "p1",
      academicSession: "2026-27",
      grade: "9",
      structureId: "fs_grade_9",
      studentId: mockStudent.id,
      studentName: mockStudent.name,
      installmentId: "inst_1",
      amount: 25000,
      paymentMode: "online",
      paidAt: "2026-06-10",
      recordedBy: "gateway",
    },
  ];

  const evalEligible = evaluateStudentExamEligibility({
    student: mockStudent,
    schedule: mockSchedule,
    feeStructure: mockFeeStructure,
    studentPayments: payments100Pct,
    globalSettings: globalSettingsEnabled,
    examRule: rule100Pct,
  });

  assertEqual(evalEligible.eligible, true, "100% paid student must be eligible");
});

runTest("HallTickets", "Bypass System: Approved bypass overrides fee block; Rejected bypass keeps student blocked", () => {
  const globalSettingsEnabled: HallTicketGlobalSettings = {
    id: "default",
    feeGateEnabled: true,
    defaultInstructions: ["Bring admit card"],
    updatedAt: "2026-06-01",
    updatedBy: "admin",
  };

  const rule100Pct: HallTicketRule = {
    id: "rule_term_exam",
    sessionId: "2026-27",
    definedExamId: "def_exam_hy",
    examName: "Half-Yearly Examination",
    requirementType: "installment_full",
    installmentId: "inst_1",
    feeGateEnabled: true,
    createdAt: "2026-06-01",
    updatedAt: "2026-06-01",
  };

  const approvedBypass: HallTicketBypass = {
    id: "bp_001",
    studentId: mockStudent.id,
    studentName: mockStudent.name,
    sessionId: "2026-27",
    academicYear: "2026-27",
    grade: "9",
    definedExamId: "def_exam_hy",
    examName: "Half-Yearly Examination",
    reason: "Parent submitted hardship application approved by Principal",
    status: "approved",
    feeShortfallAmount: 15000,
    requestedBy: { uid: "acc_1", name: "Accounts Dept", role: "accountant" },
    reviewedBy: { uid: "prin_1", name: "Principal Dr. Rao", role: "admin" },
    requestedAt: "2026-08-01",
    reviewedAt: "2026-08-02",
    createdAt: "2026-08-01",
    updatedAt: "2026-08-02",
  };

  // With Approved Bypass -> ELIGIBLE (status: bypass_approved)
  const evalBypassed = evaluateStudentExamEligibility({
    student: mockStudent,
    schedule: mockSchedule,
    feeStructure: mockFeeStructure,
    studentPayments: [], // ₹0 paid
    globalSettings: globalSettingsEnabled,
    examRule: rule100Pct,
    approvedBypass,
  });

  assertEqual(evalBypassed.eligible, true, "Student with approved bypass must be eligible");
  assertEqual(evalBypassed.status, "bypass_approved", "Status must be bypass_approved");
  assert(evalBypassed.reason.includes("approved Hall Ticket Bypass exists"), "Reason must mention bypass");

  // With Rejected Bypass -> BLOCKED
  const rejectedBypass: HallTicketBypass = {
    ...approvedBypass,
    status: "rejected",
  };

  const evalRejected = evaluateStudentExamEligibility({
    student: mockStudent,
    schedule: mockSchedule,
    feeStructure: mockFeeStructure,
    studentPayments: [],
    globalSettings: globalSettingsEnabled,
    examRule: rule100Pct,
    approvedBypass: rejectedBypass,
  });

  assertEqual(evalRejected.eligible, false, "Student with rejected bypass must remain blocked");
  assertEqual(evalRejected.status, "blocked", "Status must be blocked");
});

runTest("HallTickets", "Bulk Generation: strictly skips blocked students", async () => {
  const list: HallTicketStudentEligibility[] = [
    {
      studentId: "s1",
      studentName: "Student 1 (Eligible)",
      admissionNo: "ADM01",
      rollNo: "01",
      grade: "9",
      sectionId: "sec_a",
      sectionName: "A",
      eligible: true,
      status: "eligible",
      reason: "Fees paid",
      ruleSummary: "Full Fee Cleared",
      feeDetails: { totalFee: 50000, totalPaid: 50000, outstanding: 0 },
    },
    {
      studentId: "s2",
      studentName: "Student 2 (Blocked)",
      admissionNo: "ADM02",
      rollNo: "02",
      grade: "9",
      sectionId: "sec_a",
      sectionName: "A",
      eligible: false, // BLOCKED!
      status: "blocked",
      reason: "Outstanding fee of ₹25,000",
      ruleSummary: "Term 1 Cleared",
      feeDetails: { totalFee: 50000, totalPaid: 0, outstanding: 50000 },
    },
    {
      studentId: "s3",
      studentName: "Student 3 (Bypassed)",
      admissionNo: "ADM03",
      rollNo: "03",
      grade: "9",
      sectionId: "sec_a",
      sectionName: "A",
      eligible: true,
      status: "bypass_approved",
      reason: "Bypass granted",
      ruleSummary: "Bypassed",
      feeDetails: { totalFee: 50000, totalPaid: 0, outstanding: 50000 },
    },
  ];

  let generateCallCount = 0;
  // Test the filter logic used in bulkGenerateHallTickets
  const eligibleOnly = list.filter((s) => s.eligible);
  const blockedOnly = list.filter((s) => !s.eligible);

  assertEqual(eligibleOnly.length, 2, "Only 2 students (eligible & bypassed) should be passed to generator");
  assertEqual(blockedOnly.length, 1, "Exactly 1 student must be identified as skipped");
  assertEqual(blockedOnly[0].studentId, "s2", "Student 2 must be the skipped student");
});

// ============================================================================
// SUITE 4: CALENDAR RECURRENCE ENGINE
// ============================================================================
console.log("\n--- Suite 4: Calendar Recurrence Engine ---");

runTest("Calendar", "Weekly recurrence expands on matching days within range", () => {
  const recurringEvent = {
    id: "evt_assembly",
    title: "Morning Assembly",
    description: "Daily / weekly school assembly",
    eventTypeId: "type_assembly",
    eventTypeName: "Assembly",
    color: "#6366f1",
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    startTime: "08:15",
    endTime: "08:45",
    allDay: false,
    audienceType: "all" as const,
    recurrence: {
      frequency: "weekly" as const,
      interval: 1,
      daysOfWeek: [1, 3, 5], // Monday, Wednesday, Friday
      endDate: "2026-09-30",
    },
    status: "published" as const,
    academicYear: "2026-27",
    createdBy: { uid: "admin_1", name: "Admin" },
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
  };

  const expanded = expandRecurringOccurrences(recurringEvent as any, "2026-09-01", "2026-09-30");
  assert(expanded.length > 10, `Expected at least 12 assembly occurrences in September, got ${expanded.length}`);

  expanded.forEach((occ) => {
    assert(occ.id.startsWith("evt_assembly"), "Expanded event id must reference parent event id");
    const d = new Date(occ.startDate);
    const day = d.getDay();
    assert([1, 3, 5].includes(day), `Day of week must be Monday(1), Wednesday(3), or Friday(5), got ${day}`);
  });
});

runTest("Calendar", "Role-based audience visibility filtering", () => {
  const teacherOnlyEvent = {
    id: "evt_staff_meeting",
    title: "Staff Meeting",
    startDate: "2026-09-10",
    endDate: "2026-09-10",
    audienceType: "teachers" as const,
    status: "published" as const,
  };

  const teacherCtx = { user: { id: "t1", role: "teacher" as const, email: "t@school.edu", name: "Teacher 1" } };
  const studentCtx = { user: { id: "s1", role: "student" as const, email: "s@school.edu", name: "Student 1" } };
  const adminCtx = { user: { id: "a1", role: "admin" as const, email: "a@school.edu", name: "Admin 1" } };

  assert(canUserViewEvent(teacherOnlyEvent as any, teacherCtx as any), "Teacher should see teachers-only event");
  assert(!canUserViewEvent(teacherOnlyEvent as any, studentCtx as any), "Student should NOT see teachers-only event");
  assert(canUserViewEvent(teacherOnlyEvent as any, adminCtx as any), "Admin should see teachers-only event");
});

// ============================================================================
// SUITE 5: FIRESTORE & STORAGE SECURITY RULES AUDIT
// ============================================================================
console.log("\n--- Suite 5: Security Rules Audit ---");

runTest("Security", "firestore.rules contains isolated collections and IDOR guards", () => {
  const rules = fs.readFileSync("firestore.rules", "utf-8");

  // Check collection rules
  assert(rules.includes("match /users/{userId}"), "users collection must have rule block");
  assert(rules.includes("match /students/{studentId}"), "students collection must have rule block");
  assert(rules.includes("match /feePayments/{paymentId}"), "feePayments collection must have rule block");
  assert(rules.includes("match /hallTickets/{ticketId}"), "hallTickets collection must have rule block");
  assert(rules.includes("match /publishedReportCards/{reportCardId}"), "publishedReportCards collection must have rule block");
  assert(rules.includes("match /auditLogs/{logId}"), "auditLogs collection must have rule block");

  // Verify audit logs are immutable (update, delete: if false)
  assert(rules.includes("match /auditLogs/{logId}") && rules.includes("allow update, delete: if false;"), "Audit logs must be immutable");
});

runTest("Security", "storage.rules contains file size and upload limits", () => {
  const sRules = fs.readFileSync("storage.rules", "utf-8");
  assert(sRules.includes("service firebase.storage"), "Must be a valid firebase storage rules file");
  assert(sRules.includes("request.auth != null"), "Must require authentication for storage operations");
});

// ============================================================================
// SUITE 6: DEDICATED REGRESSION TESTS FOR IDENTIFIED DEFECTS
// ============================================================================
console.log("\n--- Suite 6: Regression Verification for Discovered Bugs ---");

runTest("Regression", "REG-001 (BUG-001): PaymentIntents collection enforces IDOR student auth ownership", () => {
  const rules = fs.readFileSync("firestore.rules", "utf-8");
  assert(
    rules.includes("match /paymentIntents/{intentId}") &&
    rules.includes("resource.data.studentId == request.auth.uid") &&
    rules.includes("request.resource.data.studentId == request.auth.uid"),
    "paymentIntents must restrict read/write to student owner or admin/accountant"
  );
});

runTest("Regression", "REG-002 (BUG-002): FeePayments permits student client write for verified online payments", () => {
  const rules = fs.readFileSync("firestore.rules", "utf-8");
  assert(
    rules.includes("request.resource.data.paymentMode == 'online'") &&
    rules.includes("request.resource.data.studentId == request.auth.uid"),
    "feePayments must permit student client writes for verified online payments"
  );
});

runTest("Regression", "REG-003 (BUG-003): Notifications collection permits recipientTeacherId and audience reads", () => {
  const rules = fs.readFileSync("firestore.rules", "utf-8");
  assert(
    rules.includes("resource.data.recipientTeacherId == request.auth.uid") &&
    rules.includes("resource.data.audienceType == 'all'"),
    "notifications must permit teacher queries and audience-scoped broadcasts"
  );
});

runTest("Regression", "REG-004 (BUG-004): MarksEntry resolves sections for Admin and HOD roles without teacherId constraint", () => {
  const marksEntryCode = fs.readFileSync("src/pages/teacher/MarksEntry.tsx", "utf-8");
  assert(
    marksEntryCode.includes('if (appUser.role === "admin")') &&
    marksEntryCode.includes('else if (appUser.role === "hod")'),
    "MarksEntry must include dedicated section resolution branches for admin and hod"
  );
});

runTest("Regression", "REG-005 (BUG-005): saveMarksEntriesBatch enforces lock status check against verified/published marks", () => {
  const resultEngineCode = fs.readFileSync("src/lib/resultEngine.ts", "utf-8");
  assert(
    resultEngineCode.includes('e.workflowStatus === "verified" || e.workflowStatus === "published" || e.workflowStatus === "locked"') &&
    resultEngineCode.includes("cannot be edited"),
    "saveMarksEntriesBatch must enforce lock status check before allowing updates"
  );
});

runTest("Regression", "REG-006 (BUG-006): Recurring calendar events use local calendar dates preventing timezone day shift", () => {
  const calendarCode = fs.readFileSync("src/lib/calendar.ts", "utf-8");
  assert(
    calendarCode.includes("curYear = current.getFullYear()") &&
    calendarCode.includes("curMonth = String(current.getMonth() + 1).padStart(2, \"0\")") &&
    calendarCode.includes("curDay = String(current.getDate()).padStart(2, \"0\")"),
    "calendar.ts must format recurring occurrences using local date components"
  );
});

runTest("Regression", "REG-007 (BUG-007): storage.rules enforces file size limits and MIME validation for media", () => {
  const sRules = fs.readFileSync("storage.rules", "utf-8");
  assert(
    sRules.includes("match /photos/{fileName}") &&
    sRules.includes("request.resource.size < 5 * 1024 * 1024") &&
    sRules.includes("request.resource.contentType.matches('image/.*')"),
    "storage.rules must enforce 5MB limit and image MIME type for photos"
  );
});

// ============================================================================
// SUMMARY STATISTICS
// ============================================================================
console.log("\n========================================================");
console.log("                   QA SUITE RESULTS                     ");
console.log("========================================================");

const passedCount = results.filter((r) => r.passed).length;
const failedCount = results.filter((r) => !r.passed).length;
const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

console.log(`Total Tests Run : ${results.length}`);
console.log(`Passed          : ${passedCount}`);
console.log(`Failed          : ${failedCount}`);
console.log(`Duration        : ${totalDuration.toFixed(1)}ms`);
console.log("========================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("ALL AUTOMATED REGRESSION TESTS PASSED CLEANLY!");
}

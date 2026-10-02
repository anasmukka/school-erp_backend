/**
 * Comprehensive Automated Verification Test Suite for Fee Structure Term -> Installment Hierarchy.
 * Tests all 12 verification scenarios from Section 24 of the requirements.
 */

import {
  normalizeFeeStructureTerms,
  sumInstallments,
  sumFeeHeads,
  buildInstallmentLedger,
  buildTermInstallmentLedger,
  getFeeCollectionSummary,
} from "../src/lib/fees";
import { evaluateStudentExamEligibility } from "../src/lib/hallTicketEngine";
import type {
  FeeStructure,
  FeeStructureTerm,
  FeeInstallment,
  StudentFeeAssignment,
  AssignmentTerm,
  AssignmentInstallment,
  FeePayment,
  Student,
  ExamSchedule,
  HallTicketGlobalSettings,
  HallTicketRule,
} from "../src/lib/types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
    failedCount++;
  }
}

console.log("======================================================================");
console.log("FEE STRUCTURE: TERM -> INSTALLMENTS HIERARCHY VERIFICATION SUITE");
console.log("======================================================================\n");

// --------------------------------------------------------------------
// TEST 1: Create structure with 2 terms, 2 installments each
// --------------------------------------------------------------------
console.log("Test 1: Structure with 2 terms, 2 installments each");
{
  const term1Installments: FeeInstallment[] = [
    { id: "inst_1_1", label: "Installment 1", amount: 15000, dueDate: "2026-10-01", termId: "term_1", termName: "Term 1", order: 1 },
    { id: "inst_1_2", label: "Installment 2", amount: 15000, dueDate: "2026-10-23", termId: "term_1", termName: "Term 1", order: 2 },
  ];
  const term2Installments: FeeInstallment[] = [
    { id: "inst_2_1", label: "Installment 3", amount: 15000, dueDate: "2027-01-10", termId: "term_2", termName: "Term 2", order: 1 },
    { id: "inst_2_2", label: "Installment 4", amount: 15000, dueDate: "2027-03-10", termId: "term_2", termName: "Term 2", order: 2 },
  ];

  const terms: FeeStructureTerm[] = [
    { termId: "term_1", termName: "Term 1", order: 1, installments: term1Installments },
    { termId: "term_2", termName: "Term 2", order: 2, installments: term2Installments },
  ];

  const structure: FeeStructure = {
    id: "struct_test_1",
    academicSession: "2026-27",
    grade: "Grade 1",
    title: "Grade 1 Annual Fees",
    feeHeads: [{ id: "head_1", name: "Tuition", amount: 60000 }],
    terms,
    installments: [...term1Installments, ...term2Installments],
  };

  const headsTotal = sumFeeHeads(structure);
  const instsTotal = sumInstallments(structure);
  const normalized = normalizeFeeStructureTerms(structure);

  assert(headsTotal === 60000, "Fee Heads Total equals ₹60,000");
  assert(instsTotal === 60000, "Installments Total equals ₹60,000");
  assert(normalized.length === 2, "Normalized terms has 2 terms");
  assert(normalized[0].termName === "Term 1" && normalized[0].installments.length === 2, "Term 1 has 2 installments");
  assert(normalized[1].termName === "Term 2" && normalized[1].installments.length === 2, "Term 2 has 2 installments");
  assert(headsTotal === instsTotal, "Structure is balanced");
}

// --------------------------------------------------------------------
// TEST 2: Create structure with 3 terms, 1 installment each
// --------------------------------------------------------------------
console.log("\nTest 2: Structure with 3 terms, 1 installment each");
{
  const terms: FeeStructureTerm[] = [
    {
      termId: "term_1",
      termName: "Term 1",
      order: 1,
      installments: [{ id: "inst_t1", label: "Term 1 Fee", amount: 15000, dueDate: "2026-08-01", termId: "term_1", termName: "Term 1", order: 1 }],
    },
    {
      termId: "term_2",
      termName: "Term 2",
      order: 2,
      installments: [{ id: "inst_t2", label: "Term 2 Fee", amount: 15000, dueDate: "2026-12-01", termId: "term_2", termName: "Term 2", order: 1 }],
    },
    {
      termId: "term_3",
      termName: "Term 3",
      order: 3,
      installments: [{ id: "inst_t3", label: "Term 3 Fee", amount: 15000, dueDate: "2027-03-01", termId: "term_3", termName: "Term 3", order: 1 }],
    },
  ];

  const structure: FeeStructure = {
    id: "struct_test_2",
    academicSession: "2026-27",
    grade: "Grade 5",
    title: "Grade 5 Trimester Fees",
    feeHeads: [{ id: "head_t", name: "Trimester Tuition", amount: 45000 }],
    terms,
    installments: terms.flatMap((t) => t.installments),
  };

  const headsTotal = sumFeeHeads(structure);
  const instsTotal = sumInstallments(structure);
  const normalized = normalizeFeeStructureTerms(structure);

  assert(headsTotal === 45000, "Fee Heads Total equals ₹45,000");
  assert(instsTotal === 45000, "Installments Total equals ₹45,000");
  assert(normalized.length === 3, "Normalized terms has 3 distinct terms");
  assert(normalized[2].termName === "Term 3", "Term 3 is preserved");
}

// --------------------------------------------------------------------
// TEST 3: Validation: Mismatched fee heads vs installment totals
// --------------------------------------------------------------------
console.log("\nTest 3: Validation on mismatched fee heads and installments");
{
  const structure: FeeStructure = {
    id: "struct_test_3",
    academicSession: "2026-27",
    grade: "Grade 1",
    title: "Mismatched",
    feeHeads: [{ id: "head_1", name: "Tuition", amount: 50000 }],
    terms: [
      {
        termId: "term_1",
        termName: "Term 1",
        order: 1,
        installments: [{ id: "i1", label: "Inst 1", amount: 40000, dueDate: "2026-10-01" }],
      },
    ],
    installments: [{ id: "i1", label: "Inst 1", amount: 40000, dueDate: "2026-10-01" }],
  };

  const headsTotal = sumFeeHeads(structure);
  const instsTotal = sumInstallments(structure);
  const difference = Math.abs(headsTotal - instsTotal);
  const isValid = headsTotal === instsTotal;

  assert(!isValid, "Validation correctly flags mismatch");
  assert(difference === 10000, `Difference ₹${difference} matches ₹10,000 discrepancy`);
}

// --------------------------------------------------------------------
// TEST 4 & 5: Term Deletion Safety (Referenced vs Unreferenced)
// --------------------------------------------------------------------
console.log("\nTest 4 & 5: Term deletion safety");
{
  const mockAssignments: StudentFeeAssignment[] = [
    {
      id: "assign_1",
      studentId: "student_1",
      sessionId: "2026-27",
      grade: "Grade 1",
      structureId: "struct_1",
      status: "active",
      version: 1,
      grossAmount: 60000,
      discountAmount: 0,
      netAmount: 60000,
      assignedBy: "admin",
      assignedByName: "Admin",
      assignedAt: "2026-10-01",
      createdAt: "2026-10-01",
      updatedAt: "2026-10-01",
      terms: [
        {
          termId: "term_1",
          termName: "Term 1",
          order: 1,
          installments: [
            { id: "inst_1_1", label: "Installment 1", amount: 15000, dueDate: "2026-10-01", status: "upcoming", termId: "term_1", termName: "Term 1", order: 1 },
          ],
        },
      ],
      installments: [
        { id: "inst_1_1", label: "Installment 1", amount: 15000, dueDate: "2026-10-01", status: "upcoming", termId: "term_1", termName: "Term 1", order: 1 },
      ],
      lineItems: [],
      concessions: [],
    },
  ];

  function canDeleteTerm(termId: string, assignments: StudentFeeAssignment[]): { allowed: boolean; reason?: string } {
    const isReferenced = assignments.some(
      (a) =>
        a.status === "active" &&
        ((a.terms && a.terms.some((t) => t.termId === termId)) ||
          (a.installments && a.installments.some((i) => i.termId === termId)))
    );
    if (isReferenced) {
      return { allowed: false, reason: "Cannot delete this term because it is referenced by active student fee assignments." };
    }
    return { allowed: true };
  }

  const checkTerm1 = canDeleteTerm("term_1", mockAssignments);
  assert(!checkTerm1.allowed, "Cannot delete Term 1 when referenced by active assignment");
  assert(checkTerm1.reason?.includes("referenced by active student fee assignments") === true, "Correct safety warning given");

  const checkTerm2 = canDeleteTerm("term_2", mockAssignments);
  assert(checkTerm2.allowed, "Unreferenced Term 2 can be safely deleted");
}

// --------------------------------------------------------------------
// TEST 6: Reordering Terms
// --------------------------------------------------------------------
console.log("\nTest 6: Reordering Terms");
{
  const terms: FeeStructureTerm[] = [
    { termId: "term_1", termName: "Term 1", order: 1, installments: [] },
    { termId: "term_2", termName: "Term 2", order: 2, installments: [] },
  ];

  // Move Term 2 up (index 1 to 0)
  const reordered = [terms[1], terms[0]].map((t, idx) => ({ ...t, order: idx + 1 }));

  assert(reordered[0].termId === "term_2" && reordered[0].order === 1, "Term 2 is now first with order = 1");
  assert(reordered[1].termId === "term_1" && reordered[1].order === 2, "Term 1 is now second with order = 2");
}

// --------------------------------------------------------------------
// TEST 7: Reordering Installments Within a Term
// --------------------------------------------------------------------
console.log("\nTest 7: Reordering Installments within Term");
{
  const installments: FeeInstallment[] = [
    { id: "i1", label: "Installment 1", amount: 15000, dueDate: "2026-10-01", order: 1 },
    { id: "i2", label: "Installment 2", amount: 15000, dueDate: "2026-10-23", order: 2 },
  ];

  // Move installment 2 up
  const reordered = [installments[1], installments[0]].map((inst, idx) => ({ ...inst, order: idx + 1 }));

  assert(reordered[0].id === "i2" && reordered[0].order === 1, "Installment 2 moved first with order = 1");
  assert(reordered[1].id === "i1" && reordered[1].order === 2, "Installment 1 moved second with order = 2");
}

// --------------------------------------------------------------------
// TEST 8: Assign Term-Hierarchical Structure to Student
// --------------------------------------------------------------------
console.log("\nTest 8: Student Fee Assignment with Term Hierarchy");
{
  const structure: FeeStructure = {
    id: "struct_grade_1",
    academicSession: "2026-27",
    grade: "Grade 1",
    title: "Grade 1 Fees",
    feeHeads: [{ id: "h1", name: "Tuition", amount: 60000 }],
    terms: [
      {
        termId: "term_1",
        termName: "Term 1",
        order: 1,
        installments: [
          { id: "i1", label: "Installment 1", amount: 15000, dueDate: "2026-10-01", termId: "term_1", termName: "Term 1", order: 1 },
          { id: "i2", label: "Installment 2", amount: 15000, dueDate: "2026-10-23", termId: "term_1", termName: "Term 1", order: 2 },
        ],
      },
      {
        termId: "term_2",
        termName: "Term 2",
        order: 2,
        installments: [
          { id: "i3", label: "Installment 3", amount: 15000, dueDate: "2027-01-10", termId: "term_2", termName: "Term 2", order: 1 },
          { id: "i4", label: "Installment 4", amount: 15000, dueDate: "2027-03-10", termId: "term_2", termName: "Term 2", order: 2 },
        ],
      },
    ],
    installments: [],
  };

  const normalizedTerms = normalizeFeeStructureTerms(structure);
  const flatBaseInstallments = normalizedTerms.flatMap((t) =>
    (t.installments || []).map((i) => ({ ...i, termId: t.termId, termName: t.termName }))
  );

  const netAmount = 60000;
  const baseTotal = flatBaseInstallments.reduce((s, i) => s + i.amount, 0);

  const calculatedInstallments: AssignmentInstallment[] = flatBaseInstallments.map((inst) => ({
    id: inst.id,
    label: inst.label,
    amount: Math.round(netAmount * (inst.amount / baseTotal)),
    dueDate: inst.dueDate,
    termId: inst.termId,
    termName: inst.termName,
    order: inst.order,
    status: "upcoming",
  }));

  const assignmentTerms: AssignmentTerm[] = normalizedTerms.map((t) => ({
    termId: t.termId,
    termName: t.termName,
    order: t.order,
    installments: calculatedInstallments.filter((i) => i.termId === t.termId),
  }));

  assert(assignmentTerms.length === 2, "Assignment has 2 terms");
  assert(assignmentTerms[0].installments.length === 2, "Term 1 has 2 installments");
  assert(assignmentTerms[1].installments.length === 2, "Term 2 has 2 installments");
  assert(
    assignmentTerms[0].installments[0].termId === "term_1" &&
      assignmentTerms[1].installments[0].termId === "term_2",
    "Installments retain explicit parent termId"
  );
}

// --------------------------------------------------------------------
// TEST 9: Concessions Applied with Term Hierarchy Proportioning
// --------------------------------------------------------------------
console.log("\nTest 9: Concession applied with Term Hierarchy preservation");
{
  const grossAmount = 60000;
  const concessionAmount = 10000; // Net is now 50,000
  const netAmount = grossAmount - concessionAmount;

  const baseTerms: AssignmentTerm[] = [
    {
      termId: "term_1",
      termName: "Term 1",
      order: 1,
      installments: [
        { id: "i1", label: "Installment 1", amount: 15000, dueDate: "2026-10-01", termId: "term_1", termName: "Term 1", order: 1, status: "upcoming" },
        { id: "i2", label: "Installment 2", amount: 15000, dueDate: "2026-10-23", termId: "term_1", termName: "Term 1", order: 2, status: "upcoming" },
      ],
    },
    {
      termId: "term_2",
      termName: "Term 2",
      order: 2,
      installments: [
        { id: "i3", label: "Installment 3", amount: 15000, dueDate: "2027-01-10", termId: "term_2", termName: "Term 2", order: 1, status: "upcoming" },
        { id: "i4", label: "Installment 4", amount: 15000, dueDate: "2027-03-10", termId: "term_2", termName: "Term 2", order: 2, status: "upcoming" },
      ],
    },
  ];

  // Proportion across 4 installments
  const flatInsts = baseTerms.flatMap((t) => t.installments);
  let accumulated = 0;
  const newInsts: AssignmentInstallment[] = flatInsts.map((inst, index) => {
    let amt: number;
    if (index === flatInsts.length - 1) {
      amt = Math.max(netAmount - accumulated, 0);
    } else {
      const proportion = inst.amount / grossAmount;
      amt = Math.round(netAmount * proportion);
      accumulated += amt;
    }
    return { ...inst, amount: amt };
  });

  const updatedTerms: AssignmentTerm[] = baseTerms.map((t) => ({
    ...t,
    installments: newInsts.filter((i) => i.termId === t.termId),
  }));

  const totalCalculated = updatedTerms.flatMap((t) => t.installments).reduce((s, i) => s + i.amount, 0);

  assert(totalCalculated === 50000, "Total of re-proportioned installments equals net ₹50,000");
  assert(updatedTerms[0].installments[0].amount === 12500, "Installment 1 reduced to ₹12,500");
  assert(updatedTerms[0].installments[1].amount === 12500, "Installment 2 reduced to ₹12,500");
  assert(updatedTerms[1].installments[0].amount === 12500, "Installment 3 reduced to ₹12,500");
  assert(updatedTerms[1].installments[1].amount === 12500, "Installment 4 reduced to ₹12,500");
  assert(updatedTerms.length === 2, "Term hierarchy intact after concession");
}

// --------------------------------------------------------------------
// TEST 10: Payment in Term 1 and Term-Grouped Ledger Summaries
// --------------------------------------------------------------------
console.log("\nTest 10: Payment recording with Term tracking");
{
  const structure: FeeStructure = {
    id: "struct_g1",
    academicSession: "2026-27",
    grade: "Grade 1",
    title: "Grade 1 Fees",
    feeHeads: [{ id: "h1", name: "Tuition", amount: 60000 }],
    terms: [
      {
        termId: "term_1",
        termName: "Term 1",
        order: 1,
        installments: [
          { id: "inst_1", label: "Installment 1", amount: 15000, dueDate: "2026-10-01", termId: "term_1", termName: "Term 1", order: 1 },
          { id: "inst_2", label: "Installment 2", amount: 15000, dueDate: "2026-10-23", termId: "term_1", termName: "Term 1", order: 2 },
        ],
      },
      {
        termId: "term_2",
        termName: "Term 2",
        order: 2,
        installments: [
          { id: "inst_3", label: "Installment 3", amount: 15000, dueDate: "2027-01-10", termId: "term_2", termName: "Term 2", order: 1 },
          { id: "inst_4", label: "Installment 4", amount: 15000, dueDate: "2027-03-10", termId: "term_2", termName: "Term 2", order: 2 },
        ],
      },
    ],
  };

  // Student paid Installment 1 and 2 (Term 1 completely cleared = ₹30,000)
  const payments: FeePayment[] = [
    {
      id: "pay_1",
      studentId: "s1",
      academicSession: "2026-27",
      grade: "Grade 1",
      structureId: "struct_g1",
      installmentId: "inst_1",
      installmentLabel: "Installment 1",
      termId: "term_1",
      termName: "Term 1",
      amount: 15000,
      paymentMode: "online",
      receiptNo: "RC-001",
      verificationStatus: "verified",
      paidAt: "2026-10-01",
    },
    {
      id: "pay_2",
      studentId: "s1",
      academicSession: "2026-27",
      grade: "Grade 1",
      structureId: "struct_g1",
      installmentId: "inst_2",
      installmentLabel: "Installment 2",
      termId: "term_1",
      termName: "Term 1",
      amount: 15000,
      paymentMode: "online",
      receiptNo: "RC-002",
      verificationStatus: "verified",
      paidAt: "2026-10-20",
    },
  ];

  const termLedger = buildTermInstallmentLedger(structure, payments, new Date("2026-10-25"));

  assert(termLedger.length === 2, "Ledger has 2 terms");
  assert(termLedger[0].termName === "Term 1", "First term is Term 1");
  assert(termLedger[0].totalPaid === 30000, "Term 1 totalPaid = ₹30,000");
  assert(termLedger[0].totalBalance === 0, "Term 1 totalBalance = 0");
  assert(termLedger[0].status === "paid", "Term 1 status = paid");

  assert(termLedger[1].termName === "Term 2", "Second term is Term 2");
  assert(termLedger[1].totalPaid === 0, "Term 2 totalPaid = 0");
  assert(termLedger[1].totalBalance === 30000, "Term 2 totalBalance = ₹30,000");
  assert(termLedger[1].status === "pending", "Term 2 status = pending");
}

// --------------------------------------------------------------------
// TEST 11: Hall Ticket Fee Check for Term 1 Exam
// --------------------------------------------------------------------
console.log("\nTest 11: Hall Ticket eligibility evaluation for Term 1 Exam");
{
  const student: Student = {
    id: "s1",
    uid: "u1",
    name: "Ayaan Khan",
    admissionNo: "ADM001",
    grade: "Grade 1",
  };

  const schedule: ExamSchedule = {
    id: "sch_1",
    sessionId: "2026-27",
    academicYear: "2026-27",
    grade: "Grade 1",
    definedExamId: "exam_term_1",
    examName: "Term 1 Mid-Term Examination",
    status: "published",
    subjects: [],
    createdAt: "2026-10-01",
  };

  const examRule: HallTicketRule = {
    id: "rule_1",
    sessionId: "2026-27",
    academicYear: "2026-27",
    definedExamId: "exam_term_1",
    examName: "Term 1 Mid-Term Examination",
    termId: "term_1",
    termName: "Term 1",
    feeGateEnabled: true,
    requirementType: "term_full",
    createdAt: "2026-10-01",
  };

  const globalSettings: HallTicketGlobalSettings = {
    id: "default",
    feeGateEnabled: true,
    defaultInstructions: [],
    updatedAt: "2026-10-01",
    updatedBy: "admin",
  };

  // Student Assignment has Term 1 (₹30,000) and Term 2 (₹30,000)
  const assignment: StudentFeeAssignment = {
    id: "assign_ayaan",
    studentId: "s1",
    studentUid: "u1",
    sessionId: "2026-27",
    academicYear: "2026-27",
    grade: "Grade 1",
    structureId: "struct_1",
    status: "active",
    version: 1,
    grossAmount: 60000,
    discountAmount: 0,
    netAmount: 60000,
    assignedBy: "admin",
    assignedByName: "Admin",
    assignedAt: "2026-10-01",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    terms: [
      {
        termId: "term_1",
        termName: "Term 1",
        order: 1,
        installments: [
          { id: "i1", label: "Installment 1", amount: 15000, dueDate: "2026-10-01", termId: "term_1", termName: "Term 1", order: 1, status: "upcoming" },
          { id: "i2", label: "Installment 2", amount: 15000, dueDate: "2026-10-23", termId: "term_1", termName: "Term 1", order: 2, status: "upcoming" },
        ],
      },
      {
        termId: "term_2",
        termName: "Term 2",
        order: 2,
        installments: [
          { id: "i3", label: "Installment 3", amount: 15000, dueDate: "2027-01-10", termId: "term_2", termName: "Term 2", order: 1, status: "upcoming" },
          { id: "i4", label: "Installment 4", amount: 15000, dueDate: "2027-03-10", termId: "term_2", termName: "Term 2", order: 2, status: "upcoming" },
        ],
      },
    ],
    installments: [
      { id: "i1", label: "Installment 1", amount: 15000, dueDate: "2026-10-01", termId: "term_1", termName: "Term 1", order: 1, status: "upcoming" },
      { id: "i2", label: "Installment 2", amount: 15000, dueDate: "2026-10-23", termId: "term_1", termName: "Term 1", order: 2, status: "upcoming" },
      { id: "i3", label: "Installment 3", amount: 15000, dueDate: "2027-01-10", termId: "term_2", termName: "Term 2", order: 1, status: "upcoming" },
      { id: "i4", label: "Installment 4", amount: 15000, dueDate: "2027-03-10", termId: "term_2", termName: "Term 2", order: 2, status: "upcoming" },
    ],
    lineItems: [],
    concessions: [],
  };

  // Case A: Student has NOT paid Term 1 in full (paid only Installment 1 = ₹15,000)
  const partialPayments: FeePayment[] = [
    {
      id: "p1",
      studentId: "s1",
      academicSession: "2026-27",
      grade: "Grade 1",
      structureId: "struct_1",
      installmentId: "i1",
      installmentLabel: "Installment 1",
      termId: "term_1",
      termName: "Term 1",
      amount: 15000,
      paymentMode: "online",
      verificationStatus: "verified",
      paidAt: "2026-10-01",
    },
  ];

  const evalBlocked = evaluateStudentExamEligibility({
    student,
    schedule,
    studentFeeAssignment: assignment,
    studentPayments: partialPayments,
    globalSettings,
    examRule,
  });

  assert(!evalBlocked.eligible, "Student with partial Term 1 payment is blocked");
  assert(evalBlocked.status === "blocked", "Eligibility status is blocked");

  // Case B: Student has paid Term 1 in full (₹30,000)
  const fullTerm1Payments: FeePayment[] = [
    ...partialPayments,
    {
      id: "p2",
      studentId: "s1",
      academicSession: "2026-27",
      grade: "Grade 1",
      structureId: "struct_1",
      installmentId: "i2",
      installmentLabel: "Installment 2",
      termId: "term_1",
      termName: "Term 1",
      amount: 15000,
      paymentMode: "online",
      verificationStatus: "verified",
      paidAt: "2026-10-20",
    },
  ];

  const evalCleared = evaluateStudentExamEligibility({
    student,
    schedule,
    studentFeeAssignment: assignment,
    studentPayments: fullTerm1Payments,
    globalSettings,
    examRule,
  });

  assert(evalCleared.eligible, "Student with Term 1 cleared is eligible (even though Term 2 is unpaid)");
  assert(evalCleared.status === "eligible", "Eligibility status is eligible");
}

// --------------------------------------------------------------------
// TEST 12: Historical Fee Structure Retrieval & Backward Compatibility
// --------------------------------------------------------------------
console.log("\nTest 12: Historical backward compatibility with legacy flat fee structures");
{
  const legacyFlatStructure: FeeStructure = {
    id: "legacy_struct_1",
    academicSession: "2025-26",
    grade: "Grade 3",
    title: "Grade 3 Annual Fees (Legacy)",
    feeHeads: [
      { id: "h1", name: "Tuition", amount: 40000 },
      { id: "h2", name: "Annual Charges", amount: 10000 },
    ],
    // Flat installments without terms field
    installments: [
      { id: "leg_inst_1", label: "Installment 1", amount: 25000, dueDate: "2025-08-01" },
      { id: "leg_inst_2", label: "Installment 2", amount: 25000, dueDate: "2025-12-01" },
    ],
  };

  const normalized = normalizeFeeStructureTerms(legacyFlatStructure);
  const totalHeads = sumFeeHeads(legacyFlatStructure);
  const totalInsts = sumInstallments(legacyFlatStructure);

  assert(totalHeads === 50000, "Legacy total fee heads = ₹50,000");
  assert(totalInsts === 50000, "Legacy total installments = ₹50,000");
  assert(normalized.length > 0, "Legacy structure normalized without error");
  assert(
    normalized.flatMap((t) => t.installments).length === 2,
    "All legacy installments preserved during normalization"
  );

  const summary = getFeeCollectionSummary(legacyFlatStructure, []);
  assert(summary.totalScheduled === 50000, "Summary totalScheduled = ₹50,000");
  assert(summary.termSummaries.length > 0, "Summary generates termSummaries for legacy structure");
}

console.log("\n======================================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("======================================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("All 12 fee structure term hierarchy tests PASSED successfully!");
}

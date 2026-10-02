import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  FeePayment,
  FeeStructure,
  StudentFeeAssignment,
  Student,
  Enrollment,
  ExamSchedule,
  HallTicket,
  HallTicketBypass,
  HallTicketGlobalSettings,
  HallTicketRule,
  HallTicketStudentEligibility,
  HallTicketSubjectSchedule,
} from "./types";
import { getAcademicSession } from "./fees";
import { logAcademicAudit, logAuditEvent } from "./audit";

/**
 * Strips undefined values recursively so Firestore setDoc/updateDoc does not throw
 */
function stripUndefinedDeep<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (typeof obj === "object" && !(obj instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = stripUndefinedDeep(value);
      }
    }
    return cleaned as T;
  }
  return obj;
}

const DEFAULT_INSTRUCTIONS: string[] = [
  "Candidates must bring this original Hall Ticket / Admit Card and their School ID card to each examination session.",
  "Candidates should report to the examination hall at least 15 minutes before the scheduled commencement time.",
  "No electronic gadgets, smart watches, mobile phones, or unauthorized papers are permitted inside the examination room.",
  "Candidates must write their Roll Number and Admission Number clearly on the answer booklet.",
  "Leaving the examination room before the designated half-time or without invigilator permission is strictly prohibited.",
  "Any form of malpractice or communication between candidates during the exam will lead to immediate cancellation of candidature.",
];

// ==========================================
// 1. GLOBAL SETTINGS SERVICE
// ==========================================

export async function getHallTicketGlobalSettings(): Promise<HallTicketGlobalSettings> {
  try {
    const ref = doc(db, "hallTicketSettings", "default");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return { id: "default", ...snap.data() } as HallTicketGlobalSettings;
    }
  } catch (err) {
    console.warn("Error fetching hall ticket settings:", err);
  }

  // Return default with fee gate enabled by default
  return {
    id: "default",
    feeGateEnabled: true,
    defaultInstructions: DEFAULT_INSTRUCTIONS,
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  };
}

export async function updateHallTicketGlobalSettings(
  settings: Partial<HallTicketGlobalSettings>,
  adminUser: { uid: string; name: string; role: string }
): Promise<void> {
  const ref = doc(db, "hallTicketSettings", "default");
  const payload = stripUndefinedDeep({
    id: "default",
    feeGateEnabled: settings.feeGateEnabled ?? true,
    defaultInstructions: settings.defaultInstructions || DEFAULT_INSTRUCTIONS,
    updatedAt: new Date().toISOString(),
    updatedBy: adminUser.name || adminUser.uid,
  });

  await setDoc(ref, payload, { merge: true });

  await logAuditEvent({
    userId: adminUser.uid,
    userName: adminUser.name,
    role: adminUser.role as any,
    action: "update",
    entity: "printing",
    entityId: "hallTicketSettings",
    details: `Updated Hall Ticket master settings: feeGateEnabled=${payload.feeGateEnabled}`,
    metadata: { feeGateEnabled: payload.feeGateEnabled },
  });
}

// ==========================================
// 2. EXAM FEE ELIGIBILITY RULES
// ==========================================

export async function listHallTicketRules(sessionId?: string): Promise<HallTicketRule[]> {
  try {
    const colRef = collection(db, "hallTicketRules");
    const q = sessionId
      ? query(colRef, where("sessionId", "==", sessionId))
      : query(colRef);
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HallTicketRule));
    list.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return list;
  } catch (err) {
    console.error("Error loading hall ticket rules:", err);
    return [];
  }
}

export async function getRuleForExam(
  sessionId: string,
  definedExamId: string
): Promise<HallTicketRule | null> {
  try {
    const q = query(
      collection(db, "hallTicketRules"),
      where("sessionId", "==", sessionId),
      where("definedExamId", "==", definedExamId)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return { id: snap.docs[0].id, ...snap.docs[0].data() } as HallTicketRule;
    }
  } catch (err) {
    console.warn(`Error getting rule for exam ${definedExamId}:`, err);
  }
  return null;
}

export async function saveHallTicketRule(
  rule: Omit<HallTicketRule, "id" | "createdAt" | "updatedAt"> & { id?: string },
  adminUser: { uid: string; name: string; role: string }
): Promise<string> {
  const now = new Date().toISOString();
  const ruleId = rule.id || `htrule_${rule.sessionId}_${rule.definedExamId}`;
  const ref = doc(db, "hallTicketRules", ruleId);

  const payload: HallTicketRule = stripUndefinedDeep({
    id: ruleId,
    sessionId: rule.sessionId,
    academicYear: rule.academicYear,
    definedExamId: rule.definedExamId,
    examName: rule.examName,
    termId: rule.termId,
    termName: rule.termName,
    feeGateEnabled: rule.feeGateEnabled ?? true,
    requirementType: rule.requirementType,
    installmentId: rule.installmentId,
    installmentLabel: rule.installmentLabel,
    minimumPaymentPercentage: rule.minimumPaymentPercentage,
    minimumPaymentAmount: rule.minimumPaymentAmount,
    notes: rule.notes || "",
    createdAt: now,
    updatedAt: now,
    updatedBy: adminUser.name || adminUser.uid,
  });

  await setDoc(ref, payload, { merge: true });

  await logAcademicAudit({
    action: "hall_ticket_rule_save",
    module: "exam_schedule",
    targetId: ruleId,
    targetName: rule.examName,
    sessionId: rule.sessionId,
    academicYear: rule.academicYear,
    details: {
      requirementType: rule.requirementType,
      feeGateEnabled: rule.feeGateEnabled,
      minimumPaymentPercentage: rule.minimumPaymentPercentage,
      installmentLabel: rule.installmentLabel,
    },
    performedBy: adminUser,
  });

  return ruleId;
}

export async function deleteHallTicketRule(
  ruleId: string,
  adminUser: { uid: string; name: string; role: string }
): Promise<void> {
  await deleteDoc(doc(db, "hallTicketRules", ruleId));
  await logAcademicAudit({
    action: "hall_ticket_rule_delete",
    module: "exam_schedule",
    targetId: ruleId,
    targetName: "Deleted Hall Ticket Rule",
    performedBy: adminUser,
  });
}

// ==========================================
// 3. HALL TICKET BYPASS SERVICE
// ==========================================

export async function listHallTicketBypasses(params?: {
  sessionId?: string;
  definedExamId?: string;
  studentId?: string;
  studentUid?: string;
  status?: string;
}): Promise<HallTicketBypass[]> {
  try {
    let q = query(collection(db, "hallTicketBypasses"));
    if (params?.sessionId) {
      q = query(q, where("sessionId", "==", params.sessionId));
    }
    if (params?.definedExamId) {
      q = query(q, where("definedExamId", "==", params.definedExamId));
    }
    if (params?.studentUid) {
      q = query(q, where("studentUid", "==", params.studentUid));
    } else if (params?.studentId) {
      q = query(q, where("studentId", "==", params.studentId));
    }
    if (params?.status && params.status !== "all") {
      q = query(q, where("status", "==", params.status));
    }

    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HallTicketBypass));
    list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return list;
  } catch (err) {
    console.error("Error loading bypasses:", err);
    return [];
  }
}

export async function requestHallTicketBypass(
  input: {
    studentId: string;
    studentUid?: string;
    studentName: string;
    admissionNo?: string;
    rollNo?: string;
    grade: string;
    sectionId?: string | null;
    sectionName?: string | null;
    sessionId: string;
    academicYear: string;
    definedExamId: string;
    examName: string;
    scheduleId?: string;
    reason: string;
    feeShortfallAmount?: number;
    feeStatusSummary?: string;
  },
  requesterUser: { uid: string; name: string; role: string }
): Promise<string> {
  const now = new Date().toISOString();
  const bypassDoc: Omit<HallTicketBypass, "id"> = stripUndefinedDeep({
    studentId: input.studentId,
    studentUid: input.studentUid || "",
    studentName: input.studentName,
    admissionNo: input.admissionNo || "",
    rollNo: input.rollNo || "",
    grade: input.grade,
    sectionId: input.sectionId || null,
    sectionName: input.sectionName || null,
    sessionId: input.sessionId,
    academicYear: input.academicYear,
    definedExamId: input.definedExamId,
    examName: input.examName,
    scheduleId: input.scheduleId || "",
    reason: input.reason.trim(),
    feeShortfallAmount: input.feeShortfallAmount || 0,
    feeStatusSummary: input.feeStatusSummary || "",
    status: "pending",
    requestedBy: {
      uid: requesterUser.uid,
      name: requesterUser.name,
      role: requesterUser.role,
    },
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const docRef = await addDoc(collection(db, "hallTicketBypasses"), bypassDoc);

  await logAcademicAudit({
    action: "hall_ticket_bypass_requested",
    module: "exam_schedule",
    targetId: docRef.id,
    targetName: `${input.studentName} - ${input.examName}`,
    sessionId: input.sessionId,
    academicYear: input.academicYear,
    grade: input.grade,
    details: {
      reason: input.reason,
      feeShortfallAmount: input.feeShortfallAmount,
      requestedBy: requesterUser.name,
    },
    performedBy: requesterUser,
  });

  return docRef.id;
}

export async function reviewHallTicketBypass(
  bypassId: string,
  decision: "approved" | "rejected" | "revoked",
  reviewNotes: string,
  reviewerUser: { uid: string; name: string; role: string }
): Promise<void> {
  const now = new Date().toISOString();
  const ref = doc(db, "hallTicketBypasses", bypassId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error("Bypass record not found");
  }

  const existing = snap.data() as HallTicketBypass;

  await updateDoc(ref, {
    status: decision,
    reviewedBy: {
      uid: reviewerUser.uid,
      name: reviewerUser.name,
      role: reviewerUser.role,
    },
    reviewedAt: now,
    reviewNotes: reviewNotes.trim(),
    updatedAt: now,
  });

  await logAcademicAudit({
    action: `hall_ticket_bypass_${decision}`,
    module: "exam_schedule",
    targetId: bypassId,
    targetName: `${existing.studentName} - ${existing.examName}`,
    sessionId: existing.sessionId,
    academicYear: existing.academicYear,
    grade: existing.grade,
    details: {
      decision,
      reviewNotes,
      reviewerName: reviewerUser.name,
    },
    performedBy: reviewerUser,
  });
}

export async function grantDirectHallTicketBypass(
  input: {
    studentId: string;
    studentUid?: string;
    studentName: string;
    admissionNo?: string;
    rollNo?: string;
    grade: string;
    sectionId?: string | null;
    sectionName?: string | null;
    sessionId: string;
    academicYear: string;
    definedExamId: string;
    examName: string;
    scheduleId?: string;
    reason: string;
    feeShortfallAmount?: number;
    feeStatusSummary?: string;
  },
  adminUser: { uid: string; name: string; role: string }
): Promise<string> {
  const now = new Date().toISOString();
  const bypassDoc: Omit<HallTicketBypass, "id"> = stripUndefinedDeep({
    studentId: input.studentId,
    studentUid: input.studentUid || "",
    studentName: input.studentName,
    admissionNo: input.admissionNo || "",
    rollNo: input.rollNo || "",
    grade: input.grade,
    sectionId: input.sectionId || null,
    sectionName: input.sectionName || null,
    sessionId: input.sessionId,
    academicYear: input.academicYear,
    definedExamId: input.definedExamId,
    examName: input.examName,
    scheduleId: input.scheduleId || "",
    reason: input.reason.trim(),
    feeShortfallAmount: input.feeShortfallAmount || 0,
    feeStatusSummary: input.feeStatusSummary || "",
    status: "approved",
    requestedBy: {
      uid: adminUser.uid,
      name: adminUser.name,
      role: adminUser.role,
    },
    requestedAt: now,
    reviewedBy: {
      uid: adminUser.uid,
      name: adminUser.name,
      role: adminUser.role,
    },
    reviewedAt: now,
    reviewNotes: "Direct administrative override granted by administrator.",
    createdAt: now,
    updatedAt: now,
  });

  const docRef = await addDoc(collection(db, "hallTicketBypasses"), bypassDoc);

  await logAcademicAudit({
    action: "hall_ticket_bypass_approved",
    module: "exam_schedule",
    targetId: docRef.id,
    targetName: `${input.studentName} - ${input.examName}`,
    sessionId: input.sessionId,
    academicYear: input.academicYear,
    grade: input.grade,
    details: {
      reason: input.reason,
      directGrant: true,
      grantedBy: adminUser.name,
    },
    performedBy: adminUser,
  });

  return docRef.id;
}

// ==========================================
// 4. ELIGIBILITY ENGINE
// ==========================================

export interface EvaluationInput {
  student: Student;
  enrollment?: Enrollment | null;
  schedule: ExamSchedule;
  feeStructure?: FeeStructure | null;
  studentFeeAssignment?: StudentFeeAssignment | null;
  studentPayments: FeePayment[];
  globalSettings: HallTicketGlobalSettings;
  examRule?: HallTicketRule | null;
  approvedBypass?: HallTicketBypass | null;
  pendingBypass?: HallTicketBypass | null;
  existingHallTicket?: HallTicket | null;
}

/**
 * Authoritatively determines whether a payment record is verified for fee clearance (SEC-04).
 * Unverified, pending, failed, or voided payment records are rejected.
 * Legacy offline payments created by school staff before verificationStatus was introduced
 * are recognized if their payment mode is a valid counter payment mode.
 */
export function isPaymentVerified(p: FeePayment): boolean {
  if (!p) return false;
  if ((p as any).isVoided || (p as any).voidedAt) return false;
  if (p.verificationStatus === "verified") return true;
  if (p.verificationStatus === "failed" || p.verificationStatus === "voided" || p.verificationStatus === "pending") return false;
  
  // Legacy offline payments created before verificationStatus:
  const mode = p.paymentMode?.toLowerCase();
  return mode === "cash" || mode === "cheque" || mode === "bank_transfer" || mode === "pos" || mode === "counter";
}

export function evaluateStudentExamEligibility(input: EvaluationInput): HallTicketStudentEligibility {
  const {
    student,
    enrollment,
    schedule,
    feeStructure: _feeStructure,
    studentFeeAssignment,
    studentPayments,
    globalSettings,
    examRule,
    approvedBypass,
    pendingBypass,
    existingHallTicket,
  } = input;

  const studentName = student.name;
  const grade = enrollment?.className || student.grade || schedule.grade;
  const sectionId = enrollment?.sectionId || student.sectionId || null;
  const sectionName = enrollment?.sectionName || null;
  const rollNo = enrollment?.rollNo || student.rollNo || "";
  const admissionNo = student.admissionNo || "";

  const baseStudentInfo = {
    studentId: student.id,
    studentUid: enrollment?.studentUid || student.studentUid || student.uid || student.id,
    studentName,
    admissionNo,
    rollNo,
    grade,
    sectionId,
    sectionName,
    studentPhotoUrl: student.photo || (student as any).photoUrl || undefined,
    dob: student.DOB || undefined,
    fatherName: student.fatherName || undefined,
    motherName: student.motherName || undefined,
  };

  // 1. Calculate fee totals exclusively from studentFeeAssignment (Single Source of Truth - SEC-08 & SEC-15)
  // Authoritative fee eligibility must strictly derive from the student's individualized assignment.
  // There is NO fallback to generic grade feeStructure templates for exam clearance.
  let totalFee = 0;
  let effectiveInstallments: Array<{ id: string; label: string; amount: number; dueDate?: string }> = [];
  let hasValidPlan = false;

  if (studentFeeAssignment && studentFeeAssignment.status === "active") {
    totalFee = Number(studentFeeAssignment.netAmount) || 0;
    effectiveInstallments = studentFeeAssignment.installments || [];
    hasValidPlan = effectiveInstallments.length > 0;
  } else {
    totalFee = 0;
    effectiveInstallments = [];
    hasValidPlan = false;
  }

  // Filter ONLY verified payments (SEC-04)
  const verifiedPayments = (studentPayments || []).filter(isPaymentVerified);

  const totalPaid = verifiedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const outstanding = Math.max(totalFee - totalPaid, 0);

  // 2. Check Global Fee Gate
  if (!globalSettings.feeGateEnabled) {
    return {
      ...baseStudentInfo,
      eligible: true,
      status: "eligible",
      reason: "Fee restriction disabled (School policy allows all enrolled students to sit for exams).",
      ruleSummary: "Fee Gate: Disabled",
      feeDetails: {
        totalFee,
        totalPaid,
        outstanding,
      },
      pendingBypass,
      bypass: approvedBypass,
      existingHallTicket,
    };
  }

  // 3. Check Exam-Specific Rule
  if (!examRule || !examRule.feeGateEnabled) {
    return {
      ...baseStudentInfo,
      eligible: true,
      status: "eligible",
      reason: "No fee requirement configured for this exam.",
      ruleSummary: "No Fee Restriction",
      feeDetails: {
        totalFee,
        totalPaid,
        outstanding,
      },
      pendingBypass,
      bypass: approvedBypass,
      existingHallTicket,
    };
  }

  // 4. Fail-Closed Check: If fee gate is enabled and no fee assignment or plan exists
  if (!hasValidPlan || effectiveInstallments.length === 0) {
    if (approvedBypass && approvedBypass.status === "approved") {
      return {
        ...baseStudentInfo,
        eligible: true,
        status: "bypass_approved",
        reason: `Fee assignment missing, but approved Hall Ticket Bypass exists: "${approvedBypass.reason}" (Approved by ${approvedBypass.reviewedBy?.name || "Administration"}).`,
        ruleSummary: "Fee Plan Missing [Bypassed]",
        feeDetails: {
          totalFee,
          totalPaid,
          outstanding,
        },
        pendingBypass,
        bypass: approvedBypass,
        existingHallTicket,
      };
    }

    return {
      ...baseStudentInfo,
      eligible: false,
      status: "blocked",
      reason: "Fee gate active: No fee assignment or fee plan found for this student. Fee clearance is required before hall ticket issuance.",
      ruleSummary: "Fee Assignment Missing [Blocked]",
      feeDetails: {
        totalFee,
        totalPaid,
        outstanding,
      },
      pendingBypass,
      bypass: approvedBypass,
      existingHallTicket,
    };
  }

  // 5. Evaluate the configured rule against student's assigned installments
  let isMet = false;
  let ruleDesc = "";
  let installmentLabel: string | undefined = undefined;
  let installmentRequiredAmount: number | undefined = undefined;
  let installmentPaidAmount: number | undefined = undefined;
  let paidPercentage: number | undefined = undefined;
  let requiredPercentage: number | undefined = undefined;

  switch (examRule.requirementType) {
    case "installment_percentage": {
      // Find matching installment from effective installments
      const targetInst =
        effectiveInstallments.find((i) => i.id === examRule.installmentId) ||
        effectiveInstallments.find((i) => i.label?.toLowerCase() === examRule.installmentLabel?.toLowerCase()) ||
        effectiveInstallments[0];

      installmentLabel = targetInst?.label || "Installment 1";
      const instAmount = Number(targetInst?.amount) || 0;
      requiredPercentage = examRule.minimumPaymentPercentage ?? 50;
      installmentRequiredAmount = (instAmount * requiredPercentage) / 100;

      // Filter verified payments made for this installment (SEC-04)
      const instPayments = verifiedPayments.filter(
        (p) => p.installmentId === targetInst?.id || p.installmentLabel === targetInst?.label
      );
      installmentPaidAmount = instPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      paidPercentage = instAmount > 0 ? Math.round((installmentPaidAmount / instAmount) * 100) : 100;

      isMet = installmentPaidAmount >= installmentRequiredAmount;
      ruleDesc = `${installmentLabel} must be paid ≥ ${requiredPercentage}% (Req: ₹${installmentRequiredAmount.toLocaleString("en-IN")})`;
      break;
    }

    case "installment_full": {
      const targetInst =
        effectiveInstallments.find((i) => i.id === examRule.installmentId) ||
        effectiveInstallments.find((i) => i.label?.toLowerCase() === examRule.installmentLabel?.toLowerCase()) ||
        effectiveInstallments[0];

      installmentLabel = targetInst?.label || "Installment 1";
      const instAmount = Number(targetInst?.amount) || 0;
      requiredPercentage = 100;
      installmentRequiredAmount = instAmount;

      const instPayments = verifiedPayments.filter(
        (p) => p.installmentId === targetInst?.id || p.installmentLabel === targetInst?.label
      );
      installmentPaidAmount = instPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      paidPercentage = instAmount > 0 ? Math.round((installmentPaidAmount / instAmount) * 100) : 100;

      isMet = installmentPaidAmount >= installmentRequiredAmount;
      ruleDesc = `${installmentLabel} must be 100% cleared (Req: ₹${installmentRequiredAmount.toLocaleString("en-IN")})`;
      break;
    }

    case "term_full": {
      const termName = examRule.termName || "Academic Term";
      // Filter installments belonging to examRule.termId
      const termInsts = effectiveInstallments.filter(
        (i) => (examRule.termId && i.termId === examRule.termId) ||
               (examRule.termName && i.termName?.toLowerCase() === examRule.termName.toLowerCase())
      );
      const targetInsts = termInsts.length > 0 ? termInsts : effectiveInstallments;
      const termTotal = targetInsts.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
      const termPaid = targetInsts.reduce((sum, i) => {
        const p = verifiedPayments
          .filter((pay) => pay.installmentId === i.id || pay.installmentLabel === i.label)
          .reduce((s, pay) => s + (Number(pay.amount) || 0), 0);
        return sum + Math.min(p, Number(i.amount) || 0);
      }, 0);

      installmentLabel = termName;
      installmentRequiredAmount = termTotal;
      installmentPaidAmount = termPaid;
      paidPercentage = termTotal > 0 ? Math.round((termPaid / termTotal) * 100) : 100;
      requiredPercentage = 100;

      isMet = termPaid >= termTotal && termTotal > 0;
      ruleDesc = `All installments for ${termName} must be 100% cleared (Req: ₹${termTotal.toLocaleString("en-IN")}, Paid: ₹${termPaid.toLocaleString("en-IN")})`;
      break;
    }

    case "all_due_cleared": {
      ruleDesc = "All fee installments and dues must be fully cleared (100%)";
      isMet = outstanding <= 0 && totalFee > 0 && totalPaid >= totalFee;
      break;
    }

    case "specific_amount": {
      const reqAmt = examRule.minimumPaymentAmount ?? 0;
      ruleDesc = `Total fee payment must be at least ₹${reqAmt.toLocaleString("en-IN")}`;
      isMet = totalPaid >= reqAmt;
      break;
    }

    default:
      isMet = true;
      ruleDesc = "General eligibility";
  }

  // 6. If satisfied
  if (isMet) {
    return {
      ...baseStudentInfo,
      eligible: true,
      status: "eligible",
      reason: `Fee requirement satisfied: ${ruleDesc} (Current payment: ${
        installmentPaidAmount !== undefined
          ? `₹${installmentPaidAmount.toLocaleString("en-IN")} / ${paidPercentage}%`
          : `₹${totalPaid.toLocaleString("en-IN")}`
      }).`,
      ruleSummary: ruleDesc,
      feeDetails: {
        totalFee,
        totalPaid,
        outstanding,
        installmentLabel,
        installmentRequiredAmount,
        installmentPaidAmount,
        paidPercentage,
        requiredPercentage,
      },
      pendingBypass,
      bypass: approvedBypass,
      existingHallTicket,
    };
  }

  // 7. Not satisfied — Check if an approved bypass exists
  if (approvedBypass && approvedBypass.status === "approved") {
    return {
      ...baseStudentInfo,
      eligible: true,
      status: "bypass_approved",
      reason: `Fee requirement not met (${
        installmentPaidAmount !== undefined
          ? `Paid: ${paidPercentage}%, Required: ≥${requiredPercentage}%`
          : `Outstanding: ₹${outstanding.toLocaleString("en-IN")}`
      }), but approved Hall Ticket Bypass exists: "${approvedBypass.reason}" (Approved by ${
        approvedBypass.reviewedBy?.name || "Administration"
      }).`,
      ruleSummary: `${ruleDesc} [Bypassed]`,
      feeDetails: {
        totalFee,
        totalPaid,
        outstanding,
        installmentLabel,
        installmentRequiredAmount,
        installmentPaidAmount,
        paidPercentage,
        requiredPercentage,
      },
      pendingBypass,
      bypass: approvedBypass,
      existingHallTicket,
    };
  }

  // 8. Blocked
  const blockExplanation =
    examRule.requirementType === "installment_percentage"
      ? `${installmentLabel} payment is ${paidPercentage}%; minimum required is ${requiredPercentage}%.`
      : examRule.requirementType === "installment_full"
      ? `${installmentLabel} is not fully paid (₹${(installmentPaidAmount || 0).toLocaleString("en-IN")} of ₹${(installmentRequiredAmount || 0).toLocaleString("en-IN")}).`
      : examRule.requirementType === "all_due_cleared"
      ? `Student has ₹${outstanding.toLocaleString("en-IN")} in outstanding fee dues; all dues must be cleared.`
      : `Payment of ₹${totalPaid.toLocaleString("en-IN")} is below the required ₹${(examRule.minimumPaymentAmount ?? 0).toLocaleString("en-IN")}.`;

  return {
    ...baseStudentInfo,
    eligible: false,
    status: "blocked",
    reason: blockExplanation,
    ruleSummary: ruleDesc,
    feeDetails: {
      totalFee,
      totalPaid,
      outstanding,
      installmentLabel,
      installmentRequiredAmount,
      installmentPaidAmount,
      paidPercentage,
      requiredPercentage,
    },
    pendingBypass,
    bypass: approvedBypass,
    existingHallTicket,
  };
}

// ==========================================
// 5. HALL TICKET GENERATION & STORAGE
// ==========================================

export async function generateHallTicketForStudent(
  eligibility: HallTicketStudentEligibility,
  schedule: ExamSchedule,
  instructions: string[] = DEFAULT_INSTRUCTIONS,
  adminUser: { uid: string; name: string; role: string }
): Promise<string> {
  if (!eligibility.eligible) {
    throw new Error(
      `Cannot generate Hall Ticket for blocked student ${eligibility.studentName}: ${eligibility.reason}`
    );
  }

  const now = new Date().toISOString();
  const ticketId = `ht_${schedule.id}_${eligibility.studentId}`;
  const ticketRef = doc(db, "hallTickets", ticketId);

  // 1. Fetch canonical Student record to guarantee authentic biodata and photo
  let canonicalPhotoUrl = eligibility.studentPhotoUrl || "";
  let canonicalDob = eligibility.dob || "";
  let canonicalFather = eligibility.fatherName || "";
  let canonicalMother = eligibility.motherName || "";
  let canonicalAdmissionNo = eligibility.admissionNo || "";
  let canonicalRollNo = eligibility.rollNo || "";
  let canonicalStudentUid = eligibility.studentUid || eligibility.studentId;

  try {
    const studentSnap = await getDoc(doc(db, "students", eligibility.studentId));
    if (studentSnap.exists()) {
      const sData = studentSnap.data() as Student;
      canonicalStudentUid = sData.studentUid || sData.uid || canonicalStudentUid;
      canonicalPhotoUrl = sData.photo || (sData as any).photoUrl || canonicalPhotoUrl;
      canonicalDob = sData.DOB || canonicalDob;
      canonicalFather = sData.fatherName || canonicalFather;
      canonicalMother = sData.motherName || canonicalMother;
      canonicalAdmissionNo = sData.admissionNo || canonicalAdmissionNo;
      canonicalRollNo = sData.rollNo || canonicalRollNo;
    }
  } catch (e) {
    console.warn("Could not fetch student record:", e);
  }

  // 2. Fetch canonical Enrollment record
  try {
    const enrollQuery = query(
      collection(db, "enrollments"),
      where("studentId", "==", eligibility.studentId),
      where("className", "==", schedule.grade)
    );
    const enrollSnap = await getDocs(enrollQuery);
    if (!enrollSnap.empty) {
      const eData = enrollSnap.docs[0].data() as Enrollment;
      if (eData.studentUid) canonicalStudentUid = eData.studentUid;
      if (eData.rollNo) canonicalRollNo = eData.rollNo;
    }
  } catch (e) {
    console.warn("Could not fetch enrollment record:", e);
  }

  // 3. Resolve School Details from academic structure / hallTicketSettings without any fake placeholder data
  let schoolName = "PRESTIGE INTERNATIONAL SCHOOL";
  let affiliationNo: string | undefined = undefined;
  let schoolCode: string | undefined = undefined;
  let schoolAddress: string | undefined = undefined;
  let tagline: string | undefined = undefined;
  let phone: string | undefined = undefined;
  let email: string | undefined = undefined;
  let website: string | undefined = undefined;
  let logoUrl = "/prestige_logo.png";

  try {
    // Check academic structure version
    if (schedule.structureId && schedule.structureVersion) {
      const structVerDoc = await getDoc(
        doc(db, "academicStructureVersions", `${schedule.structureId}_v${schedule.structureVersion}`)
      );
      if (structVerDoc.exists()) {
        const layout = (structVerDoc.data() as any).reportCardLayout;
        if (layout) {
          if (layout.schoolName) schoolName = layout.schoolName;
          if (layout.affiliationNo) affiliationNo = layout.affiliationNo;
          if (layout.schoolAddress) schoolAddress = layout.schoolAddress;
          if (layout.tagline) tagline = layout.tagline;
        }
      }
    }
  } catch (e) {
    console.warn("Could not fetch academic structure layout:", e);
  }

  try {
    // Check hallTicketSettings/default
    const settingsSnap = await getDoc(doc(db, "hallTicketSettings", "default"));
    if (settingsSnap.exists()) {
      const sData = settingsSnap.data() as HallTicketGlobalSettings;
      if (sData.schoolDetails) {
        if (sData.schoolDetails.name) schoolName = sData.schoolDetails.name;
        if (sData.schoolDetails.affiliationNo) affiliationNo = sData.schoolDetails.affiliationNo;
        if (sData.schoolDetails.schoolCode) schoolCode = sData.schoolDetails.schoolCode;
        if (sData.schoolDetails.address) schoolAddress = sData.schoolDetails.address;
        if (sData.schoolDetails.tagline) tagline = sData.schoolDetails.tagline;
        if (sData.schoolDetails.phone) phone = sData.schoolDetails.phone;
        if (sData.schoolDetails.email) email = sData.schoolDetails.email;
        if (sData.schoolDetails.website) website = sData.schoolDetails.website;
        if (sData.schoolDetails.logoUrl) logoUrl = sData.schoolDetails.logoUrl;
      }
    }
  } catch (e) {
    console.warn("Could not fetch hallTicketSettings:", e);
  }

  // 4. Resolve Active Authorized Principal Signature
  let principalSignatureUrl: string | undefined = undefined;
  let principalName: string | undefined = undefined;
  try {
    const sigSnap = await getDocs(
      query(collection(db, "signatures"), where("role", "==", "admin"), where("status", "==", "active"))
    );
    for (const d of sigSnap.docs) {
      const sig = d.data() as any;
      if (
        (sig.role === "admin" || sig.designation?.toLowerCase().includes("principal")) &&
        Array.isArray(sig.authorizedDocumentTypes) &&
        sig.authorizedDocumentTypes.includes("hall_ticket")
      ) {
        principalSignatureUrl = sig.imageUrl;
        principalName = sig.name;
        break;
      }
    }
  } catch (e) {
    console.warn("Could not fetch principal signature:", e);
  }

  // BLOCK FINALIZATION if Principal signature is missing
  if (!principalSignatureUrl) {
    throw new Error(
      "Principal signature is required before this Hall Ticket can be finalized."
    );
  }

  // 5. Map scheduled exam subjects
  const scheduledSubjects: HallTicketSubjectSchedule[] = (schedule.exams || []).map((exam) => {
    let dayName = "";
    if (exam.date) {
      try {
        const d = new Date(exam.date);
        dayName = d.toLocaleDateString("en-US", { weekday: "short" });
      } catch {
        dayName = "";
      }
    }
    return {
      subjectId: exam.subjectId,
      subjectName: exam.subjectName,
      date: exam.date,
      dayName,
      startTime: exam.startTime || "",
      endTime: exam.endTime || "",
      venue: exam.venue || "Examination Hall",
      maxMarks: exam.maxMarks,
      passingMarks: exam.passingMarks,
    };
  });

  // Sort subjects by date and time
  scheduledSubjects.sort((a, b) => {
    const dComp = (a.date || "").localeCompare(b.date || "");
    if (dComp !== 0) return dComp;
    return (a.startTime || "").localeCompare(b.startTime || "");
  });

  const sessionShort = (schedule.academicYear || "2026-27").replace(/\s+/g, "");
  const ticketNumber = `HT-${sessionShort}-G${schedule.grade}-${canonicalRollNo || canonicalAdmissionNo || eligibility.studentId.slice(-4)}`;

  const hallTicketData: HallTicket = stripUndefinedDeep({
    id: ticketId,
    ticketNumber,
    sessionId: schedule.sessionId || "default",
    academicYear: schedule.academicYear || "2026-27",
    structureId: schedule.structureId || "",
    structureVersion: schedule.structureVersion || 1,
    scheduleId: schedule.id,
    definedExamId: schedule.definedExamId || "",
    examName: schedule.examType || "Examination",
    termId: schedule.termId || "term_1",
    termName: schedule.termName || "Term 1",
    studentId: eligibility.studentId,
    studentUid: canonicalStudentUid,
    studentName: eligibility.studentName,
    admissionNo: canonicalAdmissionNo,
    rollNo: canonicalRollNo,
    grade: eligibility.grade,
    sectionId: eligibility.sectionId || null,
    sectionName: eligibility.sectionName || null,
    studentPhotoUrl: canonicalPhotoUrl || undefined,
    dob: canonicalDob || undefined,
    fatherName: canonicalFather || undefined,
    motherName: canonicalMother || undefined,
    schoolDetails: {
      name: schoolName,
      affiliationNo: affiliationNo || undefined,
      schoolCode: schoolCode || undefined,
      address: schoolAddress || undefined,
      tagline: tagline || undefined,
      phone: phone || undefined,
      email: email || undefined,
      website: website || undefined,
      logoUrl: logoUrl || "/prestige_logo.png",
    },
    scheduledSubjects,
    instructions: instructions.length > 0 ? instructions : DEFAULT_INSTRUCTIONS,
    status: "generated",
    eligibilitySnapshot: {
      eligible: true,
      reason: eligibility.reason,
      ruleSummary: eligibility.ruleSummary,
      bypassId: eligibility.bypass?.id,
      bypassReason: eligibility.bypass?.reason,
      totalFee: eligibility.feeDetails.totalFee,
      totalPaid: eligibility.feeDetails.totalPaid,
      outstanding: eligibility.feeDetails.outstanding,
      evaluatedAt: now,
    },
    principalSignatureUrl: principalSignatureUrl || undefined,
    principalName: principalName || undefined,
    qrCodeData: `PRESTIGE-HT|${ticketNumber}|${canonicalAdmissionNo}|${schedule.examType}|${schedule.academicYear}`,
    generatedAt: now,
    generatedBy: {
      uid: adminUser.uid,
      name: adminUser.name,
      role: adminUser.role,
    },
    updatedAt: now,
  });

  await setDoc(ticketRef, hallTicketData, { merge: true });

  await logAcademicAudit({
    action: "hall_ticket_generated",
    module: "exam_schedule",
    targetId: ticketId,
    targetName: `${eligibility.studentName} - ${schedule.examType}`,
    sessionId: schedule.sessionId,
    academicYear: schedule.academicYear,
    grade: eligibility.grade,
    details: {
      ticketNumber,
      eligibilityStatus: eligibility.status,
      bypassUsed: !!eligibility.bypass,
    },
    performedBy: adminUser,
  });

  return ticketId;
}

export async function bulkGenerateHallTickets(
  eligibleList: HallTicketStudentEligibility[],
  schedule: ExamSchedule,
  instructions: string[] = DEFAULT_INSTRUCTIONS,
  adminUser: { uid: string; name: string; role: string }
): Promise<{ generatedCount: number; skippedCount: number; errors: string[] }> {
  // Pre-validate that an active Principal signature exists before beginning batch processing
  const sigSnap = await getDocs(
    query(collection(db, "signatures"), where("role", "==", "admin"), where("status", "==", "active"))
  );
  const hasActivePrincipalSig = sigSnap.docs.some((d) => {
    const sig = d.data() as any;
    return (
      (sig.role === "admin" || sig.designation?.toLowerCase().includes("principal")) &&
      Array.isArray(sig.authorizedDocumentTypes) &&
      sig.authorizedDocumentTypes.includes("hall_ticket") &&
      Boolean(sig.imageUrl)
    );
  });

  if (!hasActivePrincipalSig) {
    throw new Error("Principal signature is required before this Hall Ticket can be finalized.");
  }

  let generatedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (const item of eligibleList) {
    if (!item.eligible) {
      skippedCount++;
      continue;
    }
    try {
      await generateHallTicketForStudent(item, schedule, instructions, adminUser);
      generatedCount++;
    } catch (err: any) {
      errors.push(`${item.studentName}: ${err.message || "Failed to generate"}`);
    }
  }

  return { generatedCount, skippedCount, errors };
}

export async function revokeHallTicket(
  ticketId: string,
  revocationReason: string,
  adminUser: { uid: string; name: string; role: string }
): Promise<void> {
  const ref = doc(db, "hallTickets", ticketId);
  const now = new Date().toISOString();

  await updateDoc(ref, {
    status: "revoked",
    revocationReason: revocationReason.trim(),
    updatedAt: now,
  });

  await logAcademicAudit({
    action: "hall_ticket_revoked",
    module: "exam_schedule",
    targetId: ticketId,
    targetName: "Hall Ticket Revocation",
    details: { revocationReason },
    performedBy: adminUser,
  });
}

export async function getStudentHallTickets(
  studentDocId: string,
  studentUid?: string
): Promise<HallTicket[]> {
  try {
    const list: HallTicket[] = [];
    const seen = new Set<string>();

    const q1 = query(collection(db, "hallTickets"), where("studentId", "==", studentDocId));
    const snap1 = await getDocs(q1);
    snap1.docs.forEach((d) => {
      seen.add(d.id);
      list.push({ id: d.id, ...d.data() } as HallTicket);
    });

    if (studentUid && studentUid !== studentDocId) {
      const q2 = query(collection(db, "hallTickets"), where("studentUid", "==", studentUid));
      const snap2 = await getDocs(q2);
      snap2.docs.forEach((d) => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          list.push({ id: d.id, ...d.data() } as HallTicket);
        }
      });
    }

    list.sort((a, b) => (b.generatedAt || "").localeCompare(a.generatedAt || ""));
    return list;
  } catch (err) {
    console.error("Error fetching student hall tickets:", err);
    return [];
  }
}

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  AcademicStructureVersion,
  AssessmentComponent,
  GradingScale,
  ReportCardLayoutConfig,
  CalculationConfiguration,
  DEFAULT_CALCULATION_CONFIG,
  ScholasticTableConfig,
  CoScholasticSectionConfig,
  DiscreteGradingScale,
  getEffectiveComponentsForSubject,
} from "./academicStructure";
import { logAcademicAudit } from "./audit";
import type { ExamSchedule, ExamSubjectEntry, Enrollment, DisciplineGrade } from "./types";
import { verifyStudentReportCardSigner } from "./signatures";

// ==========================================
// 1. DATA INTERFACES
// ==========================================

export type StudentAssessmentStatus = "present" | "absent" | "exempt" | "not_applicable";
export type MarksWorkflowStatus = "draft" | "submitted" | "verified" | "published" | "locked";

export interface ComponentScoreInput {
  marks: number | null;
  status: StudentAssessmentStatus;
  remarks?: string;
}

export interface MarksEntryRecord {
  id: string; // ${sessionId}_${grade}_${sectionId}_${subjectId}_${termId}_${examId}_${studentUid}
  sessionId: string;
  academicYear: string;
  structureId: string;
  structureVersion: number;
  grade: string;
  sectionId: string;
  subjectId: string;
  termId: string;           // "term_1" | "term_2"
  termName?: string;        // "Term 1" | "Term 2"
  examId: string;
  studentUid: string;       // Permanent ERP identity (e.g. STU-2026-00042)
  studentDocId?: string;     // Firebase Firestore document ID in students collection
  studentId: string;        // Backward-compatible alias for studentUid
  studentName: string;
  rollNo?: string;
  admissionNo?: string;
  componentMarks: Record<string, ComponentScoreInput>; // keyed by componentId
  totalRawMarks: number;
  totalMaxMarks: number;
  scaledTotalMarks?: number;
  calculatedPercentage: number;
  calculatedGrade: string;
  isAbsent: boolean;
  isExempt: boolean;
  isPassed: boolean;
  workflowStatus: MarksWorkflowStatus;
  enteredBy: string;
  enteredAt: string;
  updatedBy?: string;
  updatedAt?: string;
  submittedAt?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  publishedAt?: string;
  lockedAt?: string;
}

export interface TermSubjectPerformance {
  termId: string;
  termName?: string;
  examId?: string;
  examName?: string;
  componentScores: Record<string, { marks: number | null; maxMarks: number; code: string; name?: string }>;
  totalMarks: number;
  maxMarks: number;
  percentage: number;
  grade: string;
  isAbsent: boolean;
  isExempt: boolean;
  isPassed: boolean;
}

export interface CalculatedSubjectResult {
  subjectId: string;
  subjectName: string;
  category: "scholastic" | "co-scholastic";
  term1?: TermSubjectPerformance;
  term2?: TermSubjectPerformance;
  terms?: Record<string, TermSubjectPerformance>; // keyed by termId (e.g. "term_1", "term_2")
  overallTotal: number;
  overallMax: number;
  overallPercentage: number;
  overallGrade: string;
  rank?: number;
  isPassed: boolean;
}

export interface PublishedReportCardSnapshot {
  id: string; // ${sessionId}_${reportPeriod}_${studentUid}
  sessionId: string;
  academicYear: string;
  reportPeriod: "term_1" | "term_2" | "annual";
  termId?: string;
  termName?: string;
  workflowStatus?: "draft" | "teacher_signed" | "hod_signed" | "published" | string;
  studentUid: string;       // Canonical permanent ERP identity
  studentDocId?: string;     // Firestore document ID
  studentId: string;        // Backward compatibility
  studentName: string;
  admissionNo: string;
  rollNo: string;
  grade: string;
  sectionId: string;
  sectionName: string;
  fatherName?: string;
  motherName?: string;
  dob?: string;
  address?: string;
  structureId: string;
  structureVersionNumber: number;
  structureName: string;
  layoutConfig: ReportCardLayoutConfig;
  scholasticTableConfig?: ScholasticTableConfig;
  coScholasticConfig?: CoScholasticSectionConfig;
  scholasticResults: CalculatedSubjectResult[];
  coScholasticGrades: Record<string, Record<string, string> | { term1?: string; term2?: string }>;
  disciplineGrades: Record<string, Record<string, string> | { term1?: string; term2?: string }>;
  attendance?: { term1?: string; term2?: string; notes?: string }; // Unpopulated for Phase 3
  periodTotal?: number;
  periodMax?: number;
  periodPercentage?: number;
  periodGrade?: string;
  grandTotal: number;
  grandMax: number;
  grandPercentage: number;
  grandGrade: string;
  rank?: number; // Section-wide rank
  resultStatus: "PASSED" | "FAILED" | "COMPARTMENT" | "WITHHELD";
  promotedToGrade?: string;
  teacherRemarks?: string;
  principalRemarks?: string;
  publishedAt: string;
  publishedBy: string;
  signatures: {
    classTeacher?: { name: string; signedAt: string; imageUrl?: string };
    hod?: { name: string; signedAt: string; imageUrl?: string };
    principal?: { name: string; signedAt: string; imageUrl?: string };
  };
  r2ObjectMetadata?: {
    objectKey: string;
    contentType: string;
    generatedAt: string;
    generatedBy: string;
    version: number;
    status: string;
  };
}

// ==========================================
// 2. USER IDENTITY RESOLUTION (STUDENT UID VS AUTH UID)
// ==========================================

export interface UserAcademicIdentity {
  authUid: string;
  role: string;
  email: string;
  name: string;
  studentUid?: string;          // Canonical ERP identity (e.g. STU-2026-00042)
  studentDocId?: string;        // Firestore doc ID in students collection
  linkedStudentUids?: string[]; // If parent
  staffDocId?: string;          // If teacher / HOD
  assignedGrades?: string[];    // If HOD
}

/**
 * Resolves an authenticated Firebase user's identity to their ERP identity.
 * Strictly separates authUid from permanent studentUid and prevents IDOR vulnerabilities.
 */
export async function resolveUserAcademicIdentity(authUid: string): Promise<UserAcademicIdentity> {
  const userDoc = await getDoc(doc(db, "users", authUid));
  const userData = userDoc.exists() ? userDoc.data() : null;
  const role = userData?.role || "student";
  const email = userData?.email || "";
  const name = userData?.name || "";

  const identity: UserAcademicIdentity = {
    authUid,
    role,
    email,
    name,
    assignedGrades: userData?.assignedGrades || [],
  };

  if (role === "student") {
    // Check direct link on user doc
    if (userData?.studentUid) {
      identity.studentUid = userData.studentUid;
      identity.studentDocId = userData.studentDocId || userData.studentUid;
      return identity;
    }

    // Query students collection by authUid or uid or email
    const stuQ = query(collection(db, "students"), where("uid", "==", authUid));
    const stuSnap = await getDocs(stuQ);
    if (!stuSnap.empty) {
      const d = stuSnap.docs[0];
      const data = d.data();
      identity.studentDocId = d.id;
      identity.studentUid = data.studentUid || data.admissionNo || d.id;
      return identity;
    }

    // Check direct doc ID in students
    const directDoc = await getDoc(doc(db, "students", authUid));
    if (directDoc.exists()) {
      const data = directDoc.data();
      identity.studentDocId = directDoc.id;
      identity.studentUid = data.studentUid || data.admissionNo || directDoc.id;
      return identity;
    }

    // Lookup by email
    if (email) {
      const emailQ = query(collection(db, "students"), where("email", "==", email));
      const emailSnap = await getDocs(emailQ);
      if (!emailSnap.empty) {
        const d = emailSnap.docs[0];
        const data = d.data();
        identity.studentDocId = d.id;
        identity.studentUid = data.studentUid || data.admissionNo || d.id;
        return identity;
      }
    }

    // Fallback to authUid if unlinked
    identity.studentDocId = authUid;
    identity.studentUid = authUid;
  } else if (role === "teacher") {
    const teachQ = query(collection(db, "teachers"), where("uid", "==", authUid));
    const teachSnap = await getDocs(teachQ);
    if (!teachSnap.empty) {
      identity.staffDocId = teachSnap.docs[0].id;
    } else {
      const direct = await getDoc(doc(db, "teachers", authUid));
      identity.staffDocId = direct.exists() ? direct.id : authUid;
    }
  } else if (role === "parent") {
    identity.linkedStudentUids = userData?.linkedStudentUids || userData?.studentUids || [];
  }

  return identity;
}

// ==========================================
// 3. DETERMINISTIC CALCULATION ALGORITHMS
// ==========================================

/**
 * Applies rounding rule specified in structure calculationConfig.
 */
export function applyRounding(
  value: number,
  rule: string = "round_half_up",
  decimalPlaces: number = 2
): number {
  if (isNaN(value)) return 0;
  const factor = 10 ** decimalPlaces;
  if (rule === "floor") {
    return Math.floor(value * factor) / factor;
  }
  if (rule === "ceil") {
    return Math.ceil(value * factor) / factor;
  }
  if (rule === "exact_decimal") {
    return value;
  }
  // Default: round_half_up
  return Math.round(value * factor) / factor;
}

/**
 * Resolves a percentage to its corresponding letter grade based on the structure's GradingScale.
 */
export function resolveGrade(percentage: number, scale: GradingScale): string {
  if (isNaN(percentage)) return "—";
  const rounded = Math.round(percentage * 100) / 100;
  for (const tier of scale.tiers) {
    if (rounded >= tier.minPercentage && rounded <= tier.maxPercentage) {
      return tier.grade;
    }
  }
  return scale.tiers[scale.tiers.length - 1]?.grade || "E";
}

/**
 * Deterministically computes marks for a single student in an exam.
 * Stage 1: Component Scaling (e.g. PT tested out of 40 scaled to 10).
 * Stage 2: Exam Aggregation (raw_sum, weighted_components, best_of_pts).
 * Stage 3: Rounding according to CalculationConfiguration.
 */
export function calculateStudentExamMarks(params: {
  components: AssessmentComponent[];
  componentInputs: Record<string, ComponentScoreInput>;
  scale: GradingScale;
  calculationConfig?: CalculationConfiguration;
}): {
  totalRawMarks: number;
  totalMaxMarks: number;
  scaledTotalMarks: number;
  calculatedPercentage: number;
  calculatedGrade: string;
  isAbsent: boolean;
  isExempt: boolean;
  isPassed: boolean;
  errors: string[];
} {
  const { components, componentInputs, scale } = params;
  const config = params.calculationConfig || DEFAULT_CALCULATION_CONFIG;
  const errors: string[] = [];

  let totalRawMarks = 0;
  let totalMaxMarks = 0;
  let hasAnyInput = false;
  let allAbsent = true;
  let allExempt = true;

  // Track component scores for scaling & aggregation
  const componentResults: {
    comp: AssessmentComponent;
    rawMarks: number;
    effectiveMarks: number;
    effectiveMax: number;
    isAbsent: boolean;
    isExempt: boolean;
  }[] = [];

  for (const comp of components) {
    const input = componentInputs[comp.id] || { marks: null, status: "present" };

    if (input.status === "absent") {
      hasAnyInput = true;
      allExempt = false;
      const targetMax = (comp.scalingTargetMarks && comp.scalingTargetMarks > 0)
        ? comp.scalingTargetMarks
        : comp.maxMarks;

      if (comp.contributeToTotal) {
        totalMaxMarks += targetMax;
      }
      componentResults.push({
        comp,
        rawMarks: 0,
        effectiveMarks: 0,
        effectiveMax: targetMax,
        isAbsent: true,
        isExempt: false,
      });
      continue;
    }

    if (input.status === "exempt" || input.status === "not_applicable") {
      hasAnyInput = true;
      allAbsent = false;
      componentResults.push({
        comp,
        rawMarks: 0,
        effectiveMarks: 0,
        effectiveMax: 0,
        isAbsent: false,
        isExempt: true,
      });
      continue;
    }

    allAbsent = false;
    allExempt = false;

    let raw = 0;
    const testedMax = comp.testedMaxMarks ?? comp.maxMarks;
    if (input.marks !== null && input.marks !== undefined) {
      hasAnyInput = true;
      const num = Number(input.marks);
      if (isNaN(num) || num < 0) {
        errors.push(`${comp.name} (${comp.code}) marks cannot be negative.`);
      } else if (num > testedMax) {
        errors.push(
          `${comp.name} (${comp.code}) marks (${num}) exceeds maximum allowed (${testedMax}).`
        );
      } else {
        raw = num;
      }
    }

    // Component Scaling
    let effectiveMarks = raw;
    let effectiveMax = comp.maxMarks;
    if (comp.scalingTargetMarks && comp.scalingTargetMarks > 0 && testedMax > 0) {
      effectiveMarks = (raw / testedMax) * comp.scalingTargetMarks;
      effectiveMax = comp.scalingTargetMarks;
    }

    if (comp.contributeToTotal) {
      totalRawMarks += raw;
      totalMaxMarks += effectiveMax;
    }

    componentResults.push({
      comp,
      rawMarks: raw,
      effectiveMarks,
      effectiveMax,
      isAbsent: false,
      isExempt: false,
    });
  }

  // Handle all absent or all exempt edge cases
  if (allAbsent && hasAnyInput) {
    return {
      totalRawMarks: 0,
      totalMaxMarks,
      scaledTotalMarks: 0,
      calculatedPercentage: 0,
      calculatedGrade: "AB",
      isAbsent: true,
      isExempt: false,
      isPassed: false,
      errors,
    };
  }

  if (allExempt && hasAnyInput) {
    return {
      totalRawMarks: 0,
      totalMaxMarks: 0,
      scaledTotalMarks: 0,
      calculatedPercentage: 100,
      calculatedGrade: "EX",
      isAbsent: false,
      isExempt: true,
      isPassed: true,
      errors,
    };
  }

  // Aggregation Rule
  let aggregatedTotal = 0;
  let aggregatedMax = 0;

  if (config.examAggregationRule === "weighted_components") {
    let totalWeight = 0;
    let weightedEarned = 0;
    componentResults.forEach((cr) => {
      if (cr.comp.contributeToTotal && !cr.isExempt && cr.effectiveMax > 0) {
        const weight = cr.comp.weightage || cr.effectiveMax;
        totalWeight += weight;
        weightedEarned += (cr.effectiveMarks / cr.effectiveMax) * weight;
      }
    });
    aggregatedTotal = weightedEarned;
    aggregatedMax = totalWeight;
  } else if (config.examAggregationRule === "best_of_pts") {
    // Separate PT components from other components
    const ptResults = componentResults.filter((cr) =>
      cr.comp.code.toUpperCase().includes("PT") && cr.comp.contributeToTotal && !cr.isExempt
    );
    const nonPtResults = componentResults.filter((cr) =>
      !cr.comp.code.toUpperCase().includes("PT") && cr.comp.contributeToTotal && !cr.isExempt
    );

    // Sum non-PT components
    nonPtResults.forEach((cr) => {
      aggregatedTotal += cr.effectiveMarks;
      aggregatedMax += cr.effectiveMax;
    });

    // Best of PTs: take highest percentage or highest mark
    if (ptResults.length > 0) {
      ptResults.sort((a, b) => {
        const pctA = a.effectiveMax > 0 ? a.effectiveMarks / a.effectiveMax : 0;
        const pctB = b.effectiveMax > 0 ? b.effectiveMarks / b.effectiveMax : 0;
        return pctB - pctA;
      });
      const best = ptResults[0];
      aggregatedTotal += best.effectiveMarks;
      aggregatedMax += best.effectiveMax;
    }
  } else {
    // Default: "raw_sum"
    componentResults.forEach((cr) => {
      if (cr.comp.contributeToTotal && !cr.isExempt) {
        aggregatedTotal += cr.effectiveMarks;
        aggregatedMax += cr.effectiveMax;
      }
    });
  }

  // Apply rounding
  aggregatedTotal = applyRounding(aggregatedTotal, config.roundingRule, config.decimalPlaces);
  const rawPct = aggregatedMax > 0 ? (aggregatedTotal / aggregatedMax) * 100 : 0;
  const calculatedPercentage = applyRounding(rawPct, config.roundingRule, config.decimalPlaces);
  const calculatedGrade = hasAnyInput ? resolveGrade(calculatedPercentage, scale) : "—";
  const minPassPct = config.institutionalPassCriteria?.minSubjectPercentage ?? scale.passingPercentage;
  const isPassed = calculatedPercentage >= minPassPct;

  return {
    totalRawMarks,
    totalMaxMarks: aggregatedMax,
    scaledTotalMarks: aggregatedTotal,
    calculatedPercentage,
    calculatedGrade,
    isAbsent: false,
    isExempt: false,
    isPassed,
    errors,
  };
}

/**
 * Computes overall subject performance across terms based on CalculationConfiguration.
 */
export function calculateSubjectTermAndOverall(params: {
  terms: {
    term1?: { examTotal: number; examMax: number; isAbsent: boolean; isExempt: boolean };
    term2?: { examTotal: number; examMax: number; isAbsent: boolean; isExempt: boolean };
  };
  calculationConfig: CalculationConfiguration;
  gradingScale: GradingScale;
}): {
  overallTotal: number;
  overallMax: number;
  overallPercentage: number;
  overallGrade: string;
  isPassed: boolean;
} {
  const { terms, calculationConfig, gradingScale } = params;
  const { term1, term2 } = terms;

  let overallTotal = 0;
  let overallMax = 0;

  if (term1 && !term2) {
    overallTotal = term1.examTotal;
    overallMax = term1.examMax;
  } else if (!term1 && term2) {
    overallTotal = term2.examTotal;
    overallMax = term2.examMax;
  } else if (term1 && term2) {
    const mode = calculationConfig.termWeighting?.mode || "equal_average";

    if (mode === "direct_total") {
      overallTotal = term1.examTotal + term2.examTotal;
      overallMax = term1.examMax + term2.examMax;
    } else if (mode === "weighted_terms") {
      const weights = calculationConfig.termWeighting?.weights || { term1: 50, term2: 50 };
      const w1 = weights.term1 ?? 50;
      const w2 = weights.term2 ?? 50;
      const totalWeight = w1 + w2;

      const t1Earned = term1.examMax > 0 ? (term1.examTotal / term1.examMax) * w1 : 0;
      const t2Earned = term2.examMax > 0 ? (term2.examTotal / term2.examMax) * w2 : 0;

      overallTotal = t1Earned + t2Earned;
      overallMax = totalWeight;
    } else {
      // Default: "equal_average" (50% Term 1, 50% Term 2)
      const t1Earned = term1.examMax > 0 ? (term1.examTotal / term1.examMax) * 50 : 0;
      const t2Earned = term2.examMax > 0 ? (term2.examTotal / term2.examMax) * 50 : 0;

      overallTotal = t1Earned + t2Earned;
      overallMax = 100;
    }
  }

  overallTotal = applyRounding(overallTotal, calculationConfig.roundingRule, calculationConfig.decimalPlaces);
  const rawPct = overallMax > 0 ? (overallTotal / overallMax) * 100 : 0;
  const overallPercentage = applyRounding(rawPct, calculationConfig.roundingRule, calculationConfig.decimalPlaces);
  const overallGrade = resolveGrade(overallPercentage, gradingScale);
  const minPass = calculationConfig.institutionalPassCriteria?.minSubjectPercentage ?? gradingScale.passingPercentage;
  const isPassed = overallPercentage >= minPass;

  return {
    overallTotal,
    overallMax,
    overallPercentage,
    overallGrade,
    isPassed,
  };
}

export const calculateAnnualSubjectResult = calculateSubjectTermAndOverall;

/**
 * Evaluates institutional pass/fail status and grand totals across all scholastic subjects.
 */
export function evaluateInstitutionalResult(params: {
  scholasticResults: { overallTotal: number; overallMax: number; overallPercentage: number; isPassed: boolean }[];
  calculationConfig: CalculationConfiguration;
  gradingScale: GradingScale;
}): {
  grandTotal: number;
  grandMax: number;
  grandPercentage: number;
  grandGrade: string;
  resultStatus: "PASSED" | "FAILED" | "COMPARTMENT" | "WITHHELD";
} {
  const { scholasticResults, calculationConfig, gradingScale } = params;

  let grandTotal = 0;
  let grandMax = 0;
  let failedSubjectsCount = 0;

  const minSubjectPct = calculationConfig.institutionalPassCriteria?.minSubjectPercentage ?? gradingScale.passingPercentage;
  const minOverallPct = calculationConfig.institutionalPassCriteria?.minOverallPercentage ?? gradingScale.passingPercentage;
  const maxCompartment = calculationConfig.institutionalPassCriteria?.maxFailingSubjectsForCompartment ?? 1;

  for (const res of scholasticResults) {
    grandTotal += res.overallTotal;
    grandMax += res.overallMax;
    if (res.overallPercentage < minSubjectPct) {
      failedSubjectsCount += 1;
    }
  }

  grandTotal = applyRounding(grandTotal, calculationConfig.roundingRule, calculationConfig.decimalPlaces);
  const rawGrandPct = grandMax > 0 ? (grandTotal / grandMax) * 100 : 0;
  const grandPercentage = applyRounding(rawGrandPct, calculationConfig.roundingRule, calculationConfig.decimalPlaces);
  const grandGrade = resolveGrade(grandPercentage, gradingScale);

  let resultStatus: "PASSED" | "FAILED" | "COMPARTMENT" | "WITHHELD" = "PASSED";

  if (scholasticResults.length === 0) {
    resultStatus = "WITHHELD";
  } else if (failedSubjectsCount === 0 && grandPercentage >= minOverallPct) {
    resultStatus = "PASSED";
  } else if (failedSubjectsCount <= maxCompartment) {
    resultStatus = "COMPARTMENT";
  } else {
    resultStatus = "FAILED";
  }

  return {
    grandTotal,
    grandMax,
    grandPercentage,
    grandGrade,
    resultStatus,
  };
}

/**
 * Computes scholastic totals, overall percentage, letter grade, and pass status for a single term.
 */
export function calculateTermResult(params: {
  termId: "term_1" | "term_2" | string;
  scholasticResults: {
    subjectId: string;
    subjectName: string;
    category?: "scholastic" | "co-scholastic";
    totalMarks: number;
    maxMarks: number;
    percentage: number;
  }[];
  gradingScale: GradingScale;
  calculationConfig?: CalculationConfiguration;
}): {
  termTotal: number;
  termMax: number;
  termPercentage: number;
  termGrade: string;
  isPassed: boolean;
} {
  const { scholasticResults, gradingScale, calculationConfig } = params;
  let termTotal = 0;
  let termMax = 0;
  let failedCount = 0;

  const minSubPct = calculationConfig?.institutionalPassCriteria?.minSubjectPercentage ?? gradingScale.passingPercentage;
  const minOverallPct = calculationConfig?.institutionalPassCriteria?.minOverallPercentage ?? gradingScale.passingPercentage;

  for (const s of scholasticResults) {
    termTotal += s.totalMarks;
    termMax += s.maxMarks;
    if (s.percentage < minSubPct) {
      failedCount += 1;
    }
  }

  const rawPct = termMax > 0 ? (termTotal / termMax) * 100 : 0;
  const termPercentage = applyRounding(rawPct, calculationConfig?.roundingRule || "round_half_up", calculationConfig?.decimalPlaces ?? 2);
  const termGrade = resolveGrade(termPercentage, gradingScale);
  const isPassed = failedCount === 0 && termPercentage >= minOverallPct;

  return {
    termTotal: applyRounding(termTotal, calculationConfig?.roundingRule || "round_half_up", calculationConfig?.decimalPlaces ?? 2),
    termMax,
    termPercentage,
    termGrade,
    isPassed,
  };
}

// ==========================================
// 4. SECURITY & IDOR AUTHORIZATION CHECKS
// ==========================================

export async function verifyMarksEntryAuthorization(params: {
  userId: string;
  userRole: string;
  grade: string;
  sectionId: string;
  subjectId: string;
}): Promise<{ authorized: boolean; reason?: string }> {
  const { userId, userRole, grade, sectionId, subjectId } = params;

  if (userRole === "admin") return { authorized: true };

  if (userRole === "hod") {
    const userDoc = await getDoc(doc(db, "users", userId));
    const assignedGrades: string[] = userDoc.data()?.assignedGrades || [];
    if (assignedGrades.map(String).includes(String(grade))) {
      return { authorized: true };
    }
    return { authorized: false, reason: `HOD is not assigned to Grade ${grade}.` };
  }

  if (userRole === "teacher") {
    let teacherDocId = userId;
    const teacherSnap = await getDocs(
      query(collection(db, "teachers"), where("uid", "==", userId))
    );
    if (!teacherSnap.empty) {
      teacherDocId = teacherSnap.docs[0].id;
    }

    const assignSnap = await getDocs(
      query(
        collection(db, "subjectAssignments"),
        where("teacherId", "==", teacherDocId),
        where("sectionId", "==", sectionId),
        where("subjectId", "==", subjectId)
      )
    );

    if (!assignSnap.empty) {
      return { authorized: true };
    }

    // Check class teacher override
    const secDoc = await getDoc(doc(db, "sections", sectionId));
    if (secDoc.exists() && secDoc.data()?.classTeacherId === teacherDocId) {
      return { authorized: true };
    }

    return {
      authorized: false,
      reason: "You are not assigned as the teacher for this subject in this section.",
    };
  }

  return { authorized: false, reason: "Unauthorized role for marks entry." };
}

// ==========================================
// 5. MARKS ENTRY WORKFLOW ENGINE
// ==========================================

/**
 * Checks whether an exam date/time has concluded in the school's configured time zone (Asia/Kolkata).
 * Requirements:
 * - If schedule contains date and no specific end time: treated as conducted only after the calendar date has passed.
 *   If the scheduled date is today, marks entry remains unavailable until that date has passed.
 * - If schedule contains specific end time or end date: respects the configured examination period.
 */
export function isExamDateCompleted(
  dateStr: string,
  endTimeStr?: string,
  nowDate: Date = new Date()
): { completed: boolean; reason?: string; scheduledDateStr: string; nowISTStr: string } {
  if (!dateStr) {
    return {
      completed: false,
      reason: "No examination date specified in schedule.",
      scheduledDateStr: "",
      nowISTStr: "",
    };
  }

  // Format current time in Asia/Kolkata
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(nowDate);
  const partMap: Record<string, string> = {};
  parts.forEach((p) => (partMap[p.type] = p.value));
  const year = partMap.year;
  const month = partMap.month;
  const day = partMap.day;
  const hour = partMap.hour === "24" ? "00" : partMap.hour;
  const minute = partMap.minute;
  const nowISTDateStr = `${year}-${month}-${day}`;
  const nowISTTimeStr = `${hour}:${minute}`;

  const schedDateStr = dateStr.trim().slice(0, 10);

  // If specific end time is provided (e.g. "11:00", "12:30", "13:00")
  if (endTimeStr && endTimeStr.trim()) {
    const cleanEndTime = endTimeStr.trim();
    // Compare full date-time in IST (+05:30)
    const schedDateTimeStr = `${schedDateStr}T${cleanEndTime.length === 5 ? cleanEndTime + ":00" : cleanEndTime}+05:30`;
    const schedTimestamp = new Date(schedDateTimeStr).getTime();
    if (!isNaN(schedTimestamp)) {
      if (nowDate.getTime() >= schedTimestamp) {
        return {
          completed: true,
          scheduledDateStr: schedDateStr,
          nowISTStr: `${nowISTDateStr} ${nowISTTimeStr}`,
        };
      } else {
        return {
          completed: false,
          reason: `Exam is scheduled for ${schedDateStr} (until ${cleanEndTime} IST). Marks entry will become available after the examination period concludes.`,
          scheduledDateStr: schedDateStr,
          nowISTStr: `${nowISTDateStr} ${nowISTTimeStr}`,
        };
      }
    }
  }

  // If NO specific end time is provided:
  // "treat the exam as having been conducted only after its scheduled calendar date has passed in the school's configured time zone.
  // If the scheduled date is today, marks entry must remain unavailable until that date has passed."
  if (nowISTDateStr > schedDateStr) {
    return {
      completed: true,
      scheduledDateStr: schedDateStr,
      nowISTStr: `${nowISTDateStr} ${nowISTTimeStr}`,
    };
  } else if (nowISTDateStr === schedDateStr) {
    return {
      completed: false,
      reason: `Exam is scheduled for today (${schedDateStr}). Marks entry will become available tomorrow after the exam date has passed.`,
      scheduledDateStr: schedDateStr,
      nowISTStr: `${nowISTDateStr} ${nowISTTimeStr}`,
    };
  } else {
    return {
      completed: false,
      reason: `Exam is scheduled for ${schedDateStr}. Marks entry will become available after the examination date.`,
      scheduledDateStr: schedDateStr,
      nowISTStr: `${nowISTDateStr} ${nowISTTimeStr}`,
    };
  }
}

export interface ExamEligibilityResult {
  eligible: boolean;
  status: "available" | "submitted" | "locked" | "not_scheduled" | "awaiting_approval" | "not_conducted";
  reason: string;
  schedule?: ExamSchedule;
  subjectSchedule?: ExamSubjectEntry;
  workflowStatus?: MarksWorkflowStatus;
  scheduledDate?: string;
  scheduledEndTime?: string;
}

/**
 * Authoritatively validates whether an exam is scheduled, approved, and completed for a specific grade, section & subject.
 */
export async function validateExamScheduleEligibility(params: {
  sessionId?: string;
  grade: string;
  sectionId: string;
  subjectId: string;
  examId: string; // definedExamId, scheduleId, or examType
  termId?: string;
  nowDate?: Date;
}): Promise<ExamEligibilityResult> {
  const gradeStr = String(params.grade);

  // Fetch exam schedules for this grade
  const [schedSnapStr, schedSnapNum] = await Promise.all([
    getDocs(query(collection(db, "examSchedules"), where("grade", "==", gradeStr))),
    !isNaN(Number(gradeStr))
      ? getDocs(query(collection(db, "examSchedules"), where("grade", "==", Number(gradeStr))))
      : Promise.resolve({ docs: [] as any[] }),
  ]);

  const allScheds: ExamSchedule[] = [];
  const seenIds = new Set<string>();
  [...schedSnapStr.docs, ...schedSnapNum.docs].forEach((d) => {
    if (!seenIds.has(d.id)) {
      seenIds.add(d.id);
      allScheds.push({ id: d.id, ...d.data() } as ExamSchedule);
    }
  });

  const normTarget = params.examId.trim().toLowerCase();
  const schedule = allScheds.find((s) => {
    if (s.id === params.examId) return true;
    if (s.definedExamId && s.definedExamId === params.examId) return true;
    if (s.examType && s.examType.toLowerCase() === normTarget) return true;
    return false;
  });

  if (!schedule) {
    return {
      eligible: false,
      status: "not_scheduled",
      reason: "This exam has not been scheduled for your assigned class.",
    };
  }

  // Check schedule approval
  if (schedule.status !== "approved") {
    const reason =
      schedule.status === "pending_approval"
        ? "The examination schedule is awaiting approval."
        : "Exam schedule is currently in draft and awaiting review.";
    return {
      eligible: false,
      status: "awaiting_approval",
      reason,
      schedule,
    };
  }

  // Find subject entry in schedule.exams
  const subjectEntry = schedule.exams?.find((e) => e.subjectId === params.subjectId);
  if (!subjectEntry) {
    return {
      eligible: false,
      status: "not_scheduled",
      reason: "This subject is not included in the approved examination schedule.",
      schedule,
    };
  }

  // Check date completion
  const dateCheck = isExamDateCompleted(subjectEntry.date, subjectEntry.endTime, params.nowDate);
  if (!dateCheck.completed) {
    return {
      eligible: false,
      status: "not_conducted",
      reason: dateCheck.reason || "Exam not yet conducted.",
      schedule,
      subjectSchedule: subjectEntry,
      scheduledDate: subjectEntry.date,
      scheduledEndTime: subjectEntry.endTime,
    };
  }

  // Check existing marks workflow status
  const existingEntries = await fetchMarksEntriesForSection({
    sessionId: params.sessionId || schedule.sessionId || "",
    sectionId: params.sectionId,
    subjectId: params.subjectId,
    examId: schedule.definedExamId || schedule.id,
    termId: params.termId || schedule.termId,
  });

  const existingList = Object.values(existingEntries);
  const lockedEntry = existingList.find(
    (e) => e.workflowStatus === "verified" || e.workflowStatus === "published" || e.workflowStatus === "locked"
  );
  if (lockedEntry) {
    return {
      eligible: false,
      status: "locked",
      reason: `This assessment is ${lockedEntry.workflowStatus.toUpperCase()} and cannot be edited.`,
      schedule,
      subjectSchedule: subjectEntry,
      workflowStatus: lockedEntry.workflowStatus,
      scheduledDate: subjectEntry.date,
      scheduledEndTime: subjectEntry.endTime,
    };
  }

  const submittedEntry = existingList.find((e) => e.workflowStatus === "submitted");
  if (submittedEntry) {
    return {
      eligible: true,
      status: "submitted",
      reason: "Marks have already been submitted for this assessment.",
      schedule,
      subjectSchedule: subjectEntry,
      workflowStatus: "submitted",
      scheduledDate: subjectEntry.date,
      scheduledEndTime: subjectEntry.endTime,
    };
  }

  return {
    eligible: true,
    status: "available",
    reason: "Available for Marks Entry",
    schedule,
    subjectSchedule: subjectEntry,
    workflowStatus: existingList[0]?.workflowStatus || "draft",
    scheduledDate: subjectEntry.date,
    scheduledEndTime: subjectEntry.endTime,
  };
}

export function buildMarksEntryDocId(params: {
  sessionId: string;
  grade: string;
  sectionId: string;
  subjectId: string;
  termId?: string;
  examId: string;
  studentUid: string;
}): string {
  const t = params.termId ? `${params.termId}_` : "";
  return `${params.sessionId}_${params.grade}_${params.sectionId}_${params.subjectId}_${t}${params.examId}_${params.studentUid}`;
}

export async function fetchMarksEntriesForSection(params: {
  sessionId: string;
  sectionId: string;
  subjectId: string;
  examId: string;
  termId?: string;
}): Promise<Record<string, MarksEntryRecord>> {
  try {
    const constraints: any[] = [
      where("sessionId", "==", params.sessionId),
      where("sectionId", "==", params.sectionId),
      where("subjectId", "==", params.subjectId),
    ];
    if (params.termId) {
      constraints.push(where("termId", "==", params.termId));
    }
    const q = query(collection(db, "marksEntries"), ...constraints);
    const snap = await getDocs(q);
    const map: Record<string, MarksEntryRecord> = {};
    const normTarget = params.examId.trim().toLowerCase();

    snap.forEach((d) => {
      const data = d.data() as MarksEntryRecord;
      const recExamId = (data.examId || "").trim().toLowerCase();
      // Match if examId matches directly, or includes/is included by normTarget
      if (recExamId === normTarget || recExamId.includes(normTarget) || normTarget.includes(recExamId)) {
        const rec = { ...data, id: d.id };
        if (data.studentUid) map[data.studentUid] = rec;
        if (data.studentId) map[data.studentId] = rec;
        if (data.studentDocId) map[data.studentDocId] = rec;
      }
    });
    return map;
  } catch (err) {
    console.error("Failed to fetch section marks entries:", err);
    return {};
  }
}

/**
 * Saves or updates student marks in bulk with authoritative validation, deterministic calculations and audit logging.
 */
export async function saveMarksEntriesBatch(params: {
  sessionId: string;
  academicYear: string;
  structureId: string;
  structureVersion: number;
  grade: string;
  sectionId: string;
  subjectId: string;
  termId?: string;
  termName?: string;
  examId: string;
  components: AssessmentComponent[];
  scale: GradingScale;
  calculationConfig?: CalculationConfiguration;
  studentsMarks: {
    studentUid?: string;
    studentId: string;
    studentDocId?: string;
    studentName: string;
    rollNo?: string;
    admissionNo?: string;
    componentInputs: Record<string, ComponentScoreInput>;
  }[];
  targetStatus: MarksWorkflowStatus; // "draft" or "submitted"
  user: { uid: string; name: string; role: string };
  isEditResubmission?: boolean;
}): Promise<{ savedCount: number; errors: string[] }> {
  // 1. Authoritative Teacher / HOD Authorization check
  const authCheck = await verifyMarksEntryAuthorization({
    userId: params.user.uid,
    userRole: params.user.role,
    grade: params.grade,
    sectionId: params.sectionId,
    subjectId: params.subjectId,
  });

  if (!authCheck.authorized) {
    throw new Error(authCheck.reason || "Unauthorized to enter marks for this section/subject.");
  }

  const effectiveTermId = params.termId || "term_1";

  // 2. Authoritative Exam Schedule & Date Completion Validation (unless admin override)
  if (params.user.role !== "admin") {
    const schedCheck = await validateExamScheduleEligibility({
      sessionId: params.sessionId,
      grade: params.grade,
      sectionId: params.sectionId,
      subjectId: params.subjectId,
      examId: params.examId,
      termId: effectiveTermId,
    });
    // If not eligible and status is not 'submitted' (submitted marks can be edited)
    if (!schedCheck.eligible && schedCheck.status !== "submitted") {
      throw new Error(schedCheck.reason || "This assessment is not currently eligible for marks entry.");
    }
  }

  // 3. Workflow Locking Check: Teachers cannot modify verified, published, or locked marks
  const existingEntries = await fetchMarksEntriesForSection({
    sessionId: params.sessionId,
    sectionId: params.sectionId,
    subjectId: params.subjectId,
    examId: params.examId,
    termId: effectiveTermId,
  });
  const existingList = Object.values(existingEntries);
  const lockedEntry = existingList.find(
    (e) => e.workflowStatus === "verified" || e.workflowStatus === "published" || e.workflowStatus === "locked"
  );
  if (lockedEntry && params.user.role !== "admin") {
    throw new Error(
      `Marks for this examination are currently ${lockedEntry.workflowStatus.toUpperCase()} and cannot be edited.`
    );
  }

  // 4. Validate Student Roster Enrollment (every student must be actively enrolled in this section)
  const enrollSnap = await getDocs(
    query(
      collection(db, "enrollments"),
      where("sectionId", "==", params.sectionId),
      where("status", "==", "active")
    )
  );
  const validStudentUids = new Set<string>();
  enrollSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.studentId) validStudentUids.add(data.studentId);
    if (data.studentUid) validStudentUids.add(data.studentUid);
  });

  for (const s of params.studentsMarks) {
    const uidToCheck = s.studentDocId || s.studentUid || s.studentId;
    if (validStudentUids.size > 0 && !validStudentUids.has(uidToCheck) && !validStudentUids.has(s.studentId)) {
      throw new Error(`Student ${s.studentName} (${uidToCheck}) is not actively enrolled in section ${params.sectionId}.`);
    }
  }

  // 5. Component Marks numeric and bounds validation
  for (const s of params.studentsMarks) {
    for (const comp of params.components) {
      const input = s.componentInputs[comp.id];
      if (input && input.status === "present" && input.marks !== null && input.marks !== undefined && (input.marks as any) !== "") {
        const num = Number(input.marks);
        if (isNaN(num)) {
          throw new Error(`${s.studentName}: Value for ${comp.name} must be a valid number.`);
        }
        if (num < 0) {
          throw new Error(`${s.studentName}: ${comp.name} marks cannot be negative (${num}).`);
        }
        const max = comp.testedMaxMarks ?? comp.maxMarks;
        if (num > max) {
          throw new Error(`${s.studentName}: ${comp.name} marks (${num}) exceed configured maximum of ${max}.`);
        }
      }
    }
  }

  const allErrors: string[] = [];
  const now = new Date().toISOString();
  const batch = writeBatch(db);

  let savedCount = 0;
  const previousStatus = existingList[0]?.workflowStatus || "none";
  const isResubmission = existingList.some((e) => e.workflowStatus === "submitted");

  for (const s of params.studentsMarks) {
    const calc = calculateStudentExamMarks({
      components: params.components,
      componentInputs: s.componentInputs,
      scale: params.scale,
      calculationConfig: params.calculationConfig,
    });

    if (calc.errors.length > 0) {
      allErrors.push(`${s.studentName}: ${calc.errors.join("; ")}`);
      continue;
    }

    const canonicalUid = s.studentUid || s.admissionNo || s.studentId;
    const docId = buildMarksEntryDocId({
      sessionId: params.sessionId,
      grade: params.grade,
      sectionId: params.sectionId,
      subjectId: params.subjectId,
      termId: effectiveTermId,
      examId: params.examId,
      studentUid: canonicalUid,
    });

    const existingRec = existingEntries[canonicalUid];

    const record: MarksEntryRecord = {
      id: docId,
      sessionId: params.sessionId,
      academicYear: params.academicYear,
      structureId: params.structureId,
      structureVersion: params.structureVersion,
      grade: params.grade,
      sectionId: params.sectionId,
      subjectId: params.subjectId,
      termId: effectiveTermId,
      termName: params.termName || (effectiveTermId === "term_2" ? "Term 2" : "Term 1"),
      examId: params.examId,
      studentUid: canonicalUid,
      studentDocId: s.studentDocId || s.studentId,
      studentId: canonicalUid,
      studentName: s.studentName,
      rollNo: s.rollNo || "",
      admissionNo: s.admissionNo || "",
      componentMarks: s.componentInputs,
      totalRawMarks: calc.totalRawMarks,
      totalMaxMarks: calc.totalMaxMarks,
      scaledTotalMarks: calc.scaledTotalMarks,
      calculatedPercentage: calc.calculatedPercentage,
      calculatedGrade: calc.calculatedGrade,
      isAbsent: calc.isAbsent,
      isExempt: calc.isExempt,
      isPassed: calc.isPassed,
      workflowStatus: params.targetStatus,
      enteredBy: existingRec?.enteredBy || params.user.uid,
      enteredAt: existingRec?.enteredAt || now,
      updatedBy: params.user.uid,
      updatedAt: now,
      ...(params.targetStatus === "submitted" ? { submittedAt: now } : {}),
    };

    batch.set(doc(db, "marksEntries", docId), record);
    savedCount += 1;
  }

  if (savedCount > 0) {
    await batch.commit();

    await logAcademicAudit({
      action: params.targetStatus === "submitted" ? (isResubmission ? "resubmit" as any : "submit") : "update",
      module: "marks",
      targetId: `${params.sectionId}_${params.subjectId}_${params.examId}`,
      targetName: `Marks for Section ${params.sectionId} - ${params.subjectId}`,
      sessionId: params.sessionId,
      academicYear: params.academicYear,
      grade: params.grade,
      sectionId: params.sectionId,
      subjectId: params.subjectId,
      details: {
        studentCount: savedCount,
        status: params.targetStatus,
        previousStatus,
        isResubmission,
        structureVersion: params.structureVersion,
      },
      performedBy: {
        uid: params.user.uid,
        name: params.user.name,
        role: params.user.role as any,
      },
    });
  }

  return { savedCount, errors: allErrors };
}

/**
 * Transitions submitted marks to verified, published, or locked.
 */
export async function transitionMarksWorkflow(params: {
  sessionId: string;
  sectionId: string;
  subjectId: string;
  examId: string;
  targetStatus: "verified" | "published" | "locked";
  user: { uid: string; name: string; role: string };
}): Promise<{ count: number }> {
  if (params.user.role !== "admin" && params.user.role !== "hod") {
    throw new Error("Only Admin or HOD can verify, publish, or lock marks.");
  }

  const q = query(
    collection(db, "marksEntries"),
    where("sessionId", "==", params.sessionId),
    where("sectionId", "==", params.sectionId),
    where("subjectId", "==", params.subjectId),
    where("examId", "==", params.examId)
  );

  const snap = await getDocs(q);
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  let count = 0;

  snap.forEach((d) => {
    const updateData: Partial<MarksEntryRecord> = {
      workflowStatus: params.targetStatus,
    };
    if (params.targetStatus === "verified") {
      updateData.verifiedBy = params.user.uid;
      updateData.verifiedAt = now;
    } else if (params.targetStatus === "published") {
      updateData.publishedAt = now;
    } else if (params.targetStatus === "locked") {
      updateData.lockedAt = now;
    }
    batch.update(d.ref, updateData as any);
    count += 1;
  });

  if (count > 0) {
    await batch.commit();

    await logAcademicAudit({
      action: params.targetStatus === "published" ? "publish" : "update",
      module: "marks",
      targetId: `${params.sectionId}_${params.subjectId}_${params.examId}`,
      targetName: `Marks transition to ${params.targetStatus}`,
      sessionId: params.sessionId,
      sectionId: params.sectionId,
      subjectId: params.subjectId,
      details: {
        newStatus: params.targetStatus,
        affectedCount: count,
      },
      performedBy: {
        uid: params.user.uid,
        name: params.user.name,
        role: params.user.role as any,
      },
    });
  }

  return { count };
}

// ==========================================
// 8. DISCIPLINE & RESULT WORKFLOW VALIDATION
// ==========================================

export const VALID_DISCIPLINE_GRADES: readonly DisciplineGrade[] = ["A", "B", "C", "D"] as const;

/**
 * Validates that a discipline grade is strictly A, B, C, or D.
 * Never converts to numeric marks. Rejects invalid grades.
 */
export function validateDisciplineGrade(grade: unknown): DisciplineGrade {
  if (typeof grade !== "string") {
    throw new Error(`Invalid discipline grade: Expected string but received ${typeof grade}`);
  }
  const normalized = grade.trim().toUpperCase();
  if (normalized === "A" || normalized === "B" || normalized === "C" || normalized === "D") {
    return normalized as DisciplineGrade;
  }
  throw new Error(`Invalid discipline grade '${grade}'. Allowed values are strictly 'A', 'B', 'C', or 'D'.`);
}

/**
 * Checks completeness of entered marks for a specific exam across all expected subjects and students in a section.
 */
export async function checkExamResultsCompleteness(params: {
  sessionId: string;
  sectionId: string;
  examId: string;
  expectedSubjectIds: string[];
  enrolledStudentUids: string[];
}): Promise<{
  ready: boolean;
  totalExpectedEntries: number;
  enteredEntriesCount: number;
  missingEntriesCount: number;
  missingSubjectIds: string[];
  missingStudentUids: string[];
}> {
  const { sessionId, sectionId, examId, expectedSubjectIds, enrolledStudentUids } = params;

  const totalExpectedEntries = expectedSubjectIds.length * enrolledStudentUids.length;
  if (totalExpectedEntries === 0) {
    return {
      ready: false,
      totalExpectedEntries: 0,
      enteredEntriesCount: 0,
      missingEntriesCount: 0,
      missingSubjectIds: [],
      missingStudentUids: [],
    };
  }

  const q = query(
    collection(db, "marksEntries"),
    where("sessionId", "==", sessionId),
    where("sectionId", "==", sectionId),
    where("examId", "==", examId)
  );

  const snap = await getDocs(q);
  const enteredKeySet = new Set<string>();

  snap.forEach((d) => {
    const data = d.data() as MarksEntryRecord;
    const stuKey = data.studentUid || data.studentId;
    if (stuKey && data.subjectId) {
      enteredKeySet.add(`${data.subjectId}_${stuKey}`);
    }
  });

  const missingSubjectSet = new Set<string>();
  const missingStudentSet = new Set<string>();
  let missingCount = 0;

  for (const subId of expectedSubjectIds) {
    for (const stuUid of enrolledStudentUids) {
      if (!enteredKeySet.has(`${subId}_${stuUid}`)) {
        missingSubjectSet.add(subId);
        missingStudentSet.add(stuUid);
        missingCount++;
      }
    }
  }

  return {
    ready: missingCount === 0 && snap.size >= totalExpectedEntries,
    totalExpectedEntries,
    enteredEntriesCount: snap.size,
    missingEntriesCount: missingCount,
    missingSubjectIds: Array.from(missingSubjectSet),
    missingStudentUids: Array.from(missingStudentSet),
  };
}

export interface PublishExamResultsParams {
  sessionId: string;
  grade: string;
  sectionId: string;
  examId: string;
  examName?: string;
  academicYear?: string;
  user: { uid: string; name: string; role: string };
}

/**
 * Publishes individual examination results for a section.
 * Validates that user is Admin or assigned HOD for this section.
 * Updates workflowStatus of all marksEntries for this exam to 'published'.
 * Creates an authoritative record in 'examResultPublications'.
 */
export async function publishExamResults(params: {
  sessionId: string;
  grade: string;
  sectionId: string;
  examId: string;
  examName?: string;
  academicYear?: string;
  user: { uid: string; name: string; role: string };
}): Promise<{ success: boolean; count: number; publicationId: string }> {
  const { sessionId, grade, sectionId, examId, user } = params;

  // 1. Authorization check
  if (user.role !== "admin") {
    if (user.role !== "hod") {
      throw new Error("Unauthorized: Only Admin or the assigned Head of Department (HOD) can publish exam results.");
    }
    // Verify HOD section assignment
    const secDoc = await getDoc(doc(db, "sections", sectionId));
    if (secDoc.exists()) {
      const secData = secDoc.data();
      const isDirectHod = secData.hodId === user.uid;
      let isTeacherHod = false;
      if (!isDirectHod && secData.classTeacherId) {
        try {
          const tDoc = await getDoc(doc(db, "teachers", secData.classTeacherId));
          if (tDoc.exists() && Array.isArray(tDoc.data().hodIds) && tDoc.data().hodIds.includes(user.uid)) {
            isTeacherHod = true;
          }
        } catch {
          // ignore
        }
      }
      if (!isDirectHod && !isTeacherHod) {
        throw new Error(`Unauthorized: You are not assigned as Head of Department for section '${secData.name || sectionId}'.`);
      }
    }
  }

  // 2. Fetch marks entries
  const q = query(
    collection(db, "marksEntries"),
    where("sessionId", "==", sessionId),
    where("sectionId", "==", sectionId),
    where("examId", "==", examId)
  );

  const snap = await getDocs(q);
  if (snap.empty) {
    throw new Error("No marks entries found for this examination in the selected section.");
  }

  const now = new Date().toISOString();
  const batch = writeBatch(db);
  let count = 0;

  snap.forEach((d) => {
    batch.update(d.ref, {
      workflowStatus: "published",
      publishedAt: now,
      verifiedBy: user.uid,
      verifiedAt: now,
    });
    count++;
  });

  // 3. Write publication record
  const pubId = `${sessionId}_${sectionId}_${examId}`;
  const pubRef = doc(db, "examResultPublications", pubId);
  batch.set(
    pubRef,
    {
      id: pubId,
      sessionId,
      academicYear: params.academicYear || "2026-27",
      grade,
      sectionId,
      examId,
      examName: params.examName || examId,
      workflowStatus: "published",
      publishedAt: now,
      publishedBy: user.uid,
      publishedByName: user.name,
      totalEntries: count,
    },
    { merge: true }
  );

  await batch.commit();

  // 4. Academic audit log
  await logAcademicAudit({
    action: "publish",
    module: "exam_results",
    targetId: pubId,
    targetName: `Exam Result Publication for ${params.examName || examId} (Grade ${grade} - Sec ${sectionId})`,
    sessionId,
    sectionId,
    details: {
      examId,
      examName: params.examName || examId,
      grade,
      totalEntries: count,
      publishedByUid: user.uid,
    },
    performedBy: {
      uid: user.uid,
      name: user.name,
      role: user.role as any,
    },
  });

  return { success: true, count, publicationId: pubId };
}

/**
 * Saves Class Teacher Pending Details (Discipline, Co-Scholastic, Remarks).
 * Validates that every discipline grade is strictly A, B, C, or D.
 */
export async function saveClassTeacherPendingDetails(params: {
  sessionId: string;
  sectionId: string;
  studentUid: string;
  disciplineGrades: Record<string, string>; // e.g. { term_1: "A", term_2: "B" }
  coScholasticGrades?: Record<string, any>;
  teacherRemarks?: string;
  promotedToGrade?: string;
  user: { uid: string; name: string; role: string };
}): Promise<{ success: boolean; id: string }> {
  const { sessionId, sectionId, studentUid, disciplineGrades, user } = params;

  // 1. Authorization check
  if (user.role !== "admin") {
    // Check if user is the assigned Class Teacher
    const secDoc = await getDoc(doc(db, "sections", sectionId));
    if (secDoc.exists()) {
      const secData = secDoc.data();
      let isAssigned = secData.classTeacherId === user.uid;
      if (!isAssigned && secData.classTeacherId) {
        try {
          const tDoc = await getDoc(doc(db, "teachers", secData.classTeacherId));
          if (tDoc.exists() && (tDoc.data().uid === user.uid || tDoc.id === user.uid)) {
            isAssigned = true;
          }
        } catch {
          // ignore
        }
      }
      if (!isAssigned) {
        throw new Error(`Unauthorized: Only the assigned Class Teacher for section '${secData.name || sectionId}' or an Admin can enter report card details.`);
      }
    }
  }

  // 2. Validate all discipline grades strictly to A, B, C, or D
  const validatedDiscipline: Record<string, DisciplineGrade> = {};
  for (const [termKey, val] of Object.entries(disciplineGrades)) {
    if (val) {
      validatedDiscipline[termKey] = validateDisciplineGrade(val);
    }
  }

  if (Object.keys(validatedDiscipline).length === 0) {
    throw new Error("At least one term discipline grade (A, B, C, or D) must be provided.");
  }

  const detailId = `${sessionId}_${sectionId}_${studentUid}`;
  const now = new Date().toISOString();

  const dataToSave = {
    id: detailId,
    sessionId,
    sectionId,
    studentUid,
    disciplineGrades: validatedDiscipline,
    coScholasticGrades: params.coScholasticGrades || {},
    teacherRemarks: params.teacherRemarks || "",
    promotedToGrade: params.promotedToGrade || "",
    updatedAt: now,
    updatedBy: user.uid,
    updatedByName: user.name,
  };

  await setDoc(doc(db, "reportCardPendingDetails", detailId), dataToSave, { merge: true });

  // If a report card snapshot exists in draft status, update its fields too
  const cardSnapRef = doc(db, "publishedReportCards", `${sessionId}_annual_${studentUid}`);
  const cardSnap = await getDoc(cardSnapRef);
  if (cardSnap.exists()) {
    const cData = cardSnap.data();
    if (cData.workflowStatus === "draft" || !cData.workflowStatus) {
      await updateDoc(cardSnapRef, {
        disciplineGrades: validatedDiscipline,
        coScholasticGrades: params.coScholasticGrades || cData.coScholasticGrades || {},
        teacherRemarks: params.teacherRemarks || cData.teacherRemarks || "",
        promotedToGrade: params.promotedToGrade || cData.promotedToGrade || "",
        updatedAt: now,
      });
    }
  }

  await logAcademicAudit({
    action: "update",
    module: "report_card_details",
    targetId: detailId,
    targetName: `Class Teacher pending details updated for student ${studentUid}`,
    sessionId,
    sectionId,
    details: {
      studentUid,
      disciplineGrades: validatedDiscipline,
      updatedBy: user.uid,
    },
    performedBy: {
      uid: user.uid,
      name: user.name,
      role: user.role as any,
    },
  });

  return { success: true, id: detailId };
}

/**
 * Sequential E-Signing workflow for an Annual Report Card.
 * Stages:
 * 1. "class_teacher" -> advances to "teacher_signed"
 * 2. "hod" -> advances to "hod_signed"
 * 3. "principal" -> advances to "published" and locks document
 */
export async function signReportCardSequential(params: {
  sessionId: string;
  sectionId: string;
  studentUid: string;
  stage: "class_teacher" | "hod" | "principal";
  user: { uid: string; name: string; role: string };
}): Promise<{
  success: boolean;
  newStatus: "teacher_signed" | "hod_signed" | "published";
  snapshot: any;
}> {
  const { sessionId, sectionId, studentUid, stage, user } = params;

  // 1. Verify eligibility using existing authoritative signature verification
  const sigRole = stage === "class_teacher" ? "class_teacher" : stage === "hod" ? "hod" : "admin";
  const check = await verifyStudentReportCardSigner({
    signerUid: user.uid,
    signatoryRole: sigRole,
    sectionId,
    studentUid,
    sessionId,
  });

  if (!check.authorized || !check.snapshot) {
    throw new Error(`Signing authorization failed: ${check.reason || "Signer is not eligible or not assigned."}`);
  }

  // 2. Fetch or initialize report card document
  const cardDocId = `${sessionId}_annual_${studentUid}`;
  const cardRef = doc(db, "publishedReportCards", cardDocId);
  const cardDoc = await getDoc(cardRef);

  if (!cardDoc.exists()) {
    throw new Error(
      `Report card for student '${studentUid}' in session '${sessionId}' has not been generated yet. Please generate the report card before applying sequential signatures.`
    );
  }

  const existingData = cardDoc.data() as any;
  if (!existingData.scholasticResults || existingData.scholasticResults.length === 0) {
    throw new Error(
      `Report card for student '${studentUid}' has no calculated scholastic results. Please calculate report card results before signing.`
    );
  }

  let currentStatus = existingData.workflowStatus || "draft";

  // 3. Sequential Stage Validation
  let nextStatus: "teacher_signed" | "hod_signed" | "published";

  if (stage === "class_teacher") {
    if (currentStatus !== "draft" && currentStatus !== "incomplete") {
      throw new Error(`Invalid stage transition: Class Teacher can only sign when status is draft. Current status: '${currentStatus}'`);
    }
    nextStatus = "teacher_signed";
  } else if (stage === "hod") {
    if (currentStatus !== "teacher_signed") {
      throw new Error(`Invalid stage transition: Head of Department can only sign after Class Teacher has signed. Current status: '${currentStatus}'`);
    }
    nextStatus = "hod_signed";
  } else if (stage === "principal") {
    if (currentStatus !== "hod_signed") {
      throw new Error(`Invalid stage transition: Principal / Admin can only sign after Head of Department has signed. Current status: '${currentStatus}'`);
    }
    nextStatus = "published";
  } else {
    throw new Error(`Unknown signing stage: ${stage}`);
  }

  // 4. Update signatures snapshot and workflowStatus
  const now = new Date().toISOString();
  const signatures = existingData.signatures || {};

  if (stage === "class_teacher") {
    signatures.classTeacher = {
      name: check.snapshot.displayName,
      signatoryUid: check.snapshot.signatoryUid,
      designation: check.snapshot.designation,
      imageUrl: check.snapshot.imageUrl,
      signedAt: check.snapshot.signedAt,
    };
  } else if (stage === "hod") {
    signatures.hod = {
      name: check.snapshot.displayName,
      signatoryUid: check.snapshot.signatoryUid,
      designation: check.snapshot.designation,
      imageUrl: check.snapshot.imageUrl,
      signedAt: check.snapshot.signedAt,
    };
  } else if (stage === "principal") {
    signatures.principal = {
      name: check.snapshot.displayName,
      signatoryUid: check.snapshot.signatoryUid,
      designation: "Principal",
      imageUrl: check.snapshot.imageUrl,
      signedAt: check.snapshot.signedAt,
    };
  }

  const updatePayload: any = {
    workflowStatus: nextStatus,
    signatures,
    updatedAt: now,
  };

  if (nextStatus === "published") {
    updatePayload.publishedAt = now;
    updatePayload.publishedBy = user.uid;
    updatePayload.publishedByName = user.name;
    updatePayload.isLocked = true;
    updatePayload.lockedAt = now;
  }

  await setDoc(cardRef, updatePayload, { merge: true });

  // 5. Audit Logging
  await logAcademicAudit({
    action: nextStatus === "published" ? "publish" : "signature_applied",
    module: "report_card_signatures",
    targetId: cardDocId,
    targetName: `Report card e-signed (${stage}) for ${studentUid}`,
    sessionId,
    sectionId,
    details: {
      studentUid,
      stage,
      newStatus: nextStatus,
      signerUid: user.uid,
      signerName: check.snapshot.displayName,
    },
    performedBy: {
      uid: user.uid,
      name: user.name,
      role: user.role as any,
    },
  });

  return {
    success: true,
    newStatus: nextStatus,
    snapshot: check.snapshot,
  };
}


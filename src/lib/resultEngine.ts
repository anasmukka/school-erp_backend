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
    if (input.marks !== null && input.marks !== undefined) {
      hasAnyInput = true;
      const num = Number(input.marks);
      if (isNaN(num) || num < 0) {
        errors.push(`${comp.name} (${comp.code}) marks cannot be negative.`);
      } else if (num > comp.maxMarks) {
        errors.push(
          `${comp.name} (${comp.code}) marks (${num}) exceeds maximum allowed (${comp.maxMarks}).`
        );
      } else {
        raw = num;
      }
    }

    // Component Scaling
    let effectiveMarks = raw;
    let effectiveMax = comp.maxMarks;
    if (comp.scalingTargetMarks && comp.scalingTargetMarks > 0 && comp.maxMarks > 0) {
      effectiveMarks = (raw / comp.maxMarks) * comp.scalingTargetMarks;
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
      where("examId", "==", params.examId),
    ];
    if (params.termId) {
      constraints.push(where("termId", "==", params.termId));
    }
    const q = query(collection(db, "marksEntries"), ...constraints);
    const snap = await getDocs(q);
    const map: Record<string, MarksEntryRecord> = {};
    snap.forEach((d) => {
      const data = d.data() as MarksEntryRecord;
      const rec = { id: d.id, ...data };
      if (data.studentUid) map[data.studentUid] = rec;
      if (data.studentId) map[data.studentId] = rec;
      if (data.studentDocId) map[data.studentDocId] = rec;
    });
    return map;
  } catch (err) {
    console.error("Failed to fetch section marks entries:", err);
    return {};
  }
}

/**
 * Saves or updates student marks in bulk with deterministic calculations and audit logging.
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
}): Promise<{ savedCount: number; errors: string[] }> {
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

  // Enforce workflow locking: Teachers cannot modify verified, published, or locked marks
  if (params.user.role === "teacher") {
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
    if (lockedEntry) {
      throw new Error(
        `Marks for this examination are currently ${lockedEntry.workflowStatus.toUpperCase()} and cannot be edited.`
      );
    }
  }

  const allErrors: string[] = [];
  const now = new Date().toISOString();
  const batch = writeBatch(db);

  let savedCount = 0;

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
      enteredBy: params.user.uid,
      enteredAt: now,
      ...(params.targetStatus === "submitted" ? { submittedAt: now } : {}),
    };

    batch.set(doc(db, "marksEntries", docId), record);
    savedCount += 1;
  }

  if (savedCount > 0) {
    await batch.commit();

    await logAcademicAudit({
      action: params.targetStatus === "submitted" ? "submit" : "update",
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

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
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { logAcademicAudit } from "./audit";

// ==========================================
// 1. ACADEMIC STRUCTURE DATA CONTRACTS
// ==========================================

export type StructureStatus = "draft" | "active" | "archived";
export type TermWorkflowStatus = "not_started" | "open" | "marks_entry" | "verification" | "published" | "locked";
export type CalculationMethod = "raw" | "scaled" | "best_of" | "average";

export interface AssessmentComponent {
  id: string;
  name: string; // e.g. "Theory", "Periodic Test", "Notebook", "Subject Enrichment (SEA)", "Practical"
  code: string; // e.g. "TH", "PT", "NB", "SEA", "PR", "HY", "AE"
  maxMarks: number; // e.g. 80, 10, 5, 5
  testedMaxMarks?: number; // e.g. PT tested out of 40, scaled to 10
  scalingTargetMarks?: number; // e.g. 10
  weightage: number; // weightage points or percentage contribution
  calculationMethod?: CalculationMethod;
  contributeToTotal: boolean;
  displayOnReportCard: boolean;
  order: number;
  applicableTermId?: string; // "term_1" | "term_2" | "all"
  applicableExamId?: string; // Associated DefinedExam ID if tied to an exam
  applicableSubjects?: string[]; // Empty/undefined = all subjects; or specific subjectIds
}

export interface AcademicTermConfig {
  id: "term_1" | "term_2" | string;
  name: string; // e.g. "Term 1", "Term 2"
  code: string; // e.g. "T1", "T2"
  order: number; // 1, 2
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: TermWorkflowStatus;
  examIds: string[]; // Exams belonging to this term
  assessmentComponentIds: string[]; // Components applicable to this term
  maxMarks?: number; // Derived or configured term maximum (e.g. 100, 50, 40)
  assessmentComponents?: AssessmentComponent[]; // Optional direct term components
}

export interface DefinedExam {
  id: string;
  termId: string; // "term_1" | "term_2"
  name: string; // e.g. "Periodic Test 1", "Half-Yearly Examination", "Annual Examination"
  code?: string; // e.g. "PT1", "HY", "PT2", "ANN"
  term?: "term1" | "term2" | "full_year"; // legacy fallback
  order: number;
  weightagePercentage?: number; // legacy fallback
  applicableComponentIds: string[]; // Component IDs that belong to this exam
}

export interface SubjectTermOverride {
  components: AssessmentComponent[];
  maxMarks?: number;
}

export interface SubjectAssessmentOverride {
  subjectId: string;
  termOverrides: Record<string, SubjectTermOverride>; // Keyed by termId (e.g. "term_1", "term_2")
}

export interface ScholasticOverallConfig {
  title?: string;
  subtitle?: string;
  term1Weight?: number;
  term2Weight?: number;
  showOverallTotal?: boolean;
  showGrade?: boolean;
  showRank?: boolean;
  // Legacy / backwards compatibility fields:
  showTerm1Total?: boolean; // Show T1 Total under Overall
  showTerm2Total?: boolean; // Show T2 Total under Overall
  showGrandTotal?: boolean; // Show Grand Total (default: true)
  grandTotalLabel?: string; // e.g. "Grand Total" or "Total"
  showPercentage?: boolean; // Show Percentage column
  showGradePoint?: boolean; // Show Grade Point (GP)
  showResultStatus?: boolean; // Show Pass/Compartment status
  showRemarks?: boolean; // Show Subject teacher remarks
  customSubHeaderText?: string; // e.g. "Term 1 (50)+Term 2 (50)" or generated from weights
}

export interface ScholasticTermConfig {
  termId: "term_1" | "term_2" | string;
  termName: string;
  maxMarks?: number;
  enabled?: boolean;
  headerLabelOverride?: string;
  assessmentComponents: AssessmentComponent[];
}

export interface ScholasticTableConfig {
  title: string; // e.g. "SCHOLASTIC AREA"
  showMaxMarksRow: boolean; // Sub-header row showing component max marks (10, 5, 5, 80...)
  showTotalColumnPerTerm: boolean; // Show "Total" column under each term (default: true)
  terms: ScholasticTermConfig[];
  overallConfig: ScholasticOverallConfig;
  overall: ScholasticOverallConfig;
}

export interface DiscreteGradingScaleTier {
  grade: string; // e.g. "A", "B", "C" or "Excellent", "Good", "Needs Improvement"
  description?: string; // e.g. "Outstanding", "Very Good", "Fair"
  descriptor?: string; // Alias for description for preview rendering
  order: number;
}

export interface DiscreteGradingScale {
  id: string; // e.g. "scale-3-point"
  name: string; // e.g. "3 Point Grading Scale (A,B,C)"
  tiers: DiscreteGradingScaleTier[];
}

export interface CoScholasticAreaEntry {
  id: string;
  name: string; // e.g. "Work Education", "Scientific Skills", "Yoga/ NCC"
  code?: string;
  category: "co-scholastic" | "discipline" | "life-skills";
  order: number;
  enabled: boolean;
  displayOnReportCard?: boolean;
  applicableTermIds: string[]; // ["term_1", "term_2"] - uses same terms!
}

export interface CoScholasticSectionConfig {
  id: string;
  title: string; // e.g. "Co-Scholastic Areas"
  subtitle?: string; // e.g. "(3 Point Grading Scale A,B,C)"
  enabled: boolean;
  scaleId: string; // Points to DiscreteGradingScale
  terms: string[]; // ["term_1", "term_2"]
  termColumns: { termId: string; label: string }[];
  areas: CoScholasticAreaEntry[];
}

export type ComponentScalingMode = "raw" | "scaled_to_target" | "percentage";
export type ExamAggregationMode = "raw_sum" | "weighted_components" | "best_of_pts";
export type TermAggregationMode = "raw_sum" | "equal_average" | "weighted_terms" | "term2_only";
export type RoundingMethod = "round_half_up" | "round_floor" | "round_ceil" | "exact_decimal";

export interface CalculationConfiguration {
  componentRules: Record<
    string,
    {
      scalingMode: ComponentScalingMode;
      targetScaleMarks?: number;
      mandatoryForPass: boolean;
      minPassingPercentage?: number;
    }
  >;
  examAggregation: {
    mode: ExamAggregationMode;
    componentWeights?: Record<string, number>;
    ptBestOfCount?: number;
  };
  termAggregation: {
    mode: TermAggregationMode;
    termWeights: {
      term1: number;
      term2: number;
    };
  };
  rounding: {
    method: RoundingMethod;
    decimalPlaces: number;
  };
  passingCriteria: {
    overallPassingPercentage: number;
    requirePassInAllSubjects: boolean;
    compartmentThresholdCount: number;
  };
}

export const DEFAULT_CALCULATION_CONFIG: CalculationConfiguration = {
  componentRules: {
    "comp-pt": { scalingMode: "raw", targetScaleMarks: 10, mandatoryForPass: false },
    "comp-nb": { scalingMode: "raw", targetScaleMarks: 5, mandatoryForPass: false },
    "comp-sea": { scalingMode: "raw", targetScaleMarks: 5, mandatoryForPass: false },
    "comp-th": { scalingMode: "raw", targetScaleMarks: 80, mandatoryForPass: true, minPassingPercentage: 33 },
  },
  examAggregation: {
    mode: "raw_sum",
    componentWeights: {
      "comp-pt": 10,
      "comp-nb": 5,
      "comp-sea": 5,
      "comp-th": 80,
    },
    ptBestOfCount: 1,
  },
  termAggregation: {
    mode: "equal_average",
    termWeights: {
      term1: 50,
      term2: 50,
    },
  },
  rounding: {
    method: "round_half_up",
    decimalPlaces: 0,
  },
  passingCriteria: {
    overallPassingPercentage: 33,
    requirePassInAllSubjects: true,
    compartmentThresholdCount: 2,
  },
};

export interface GradingScaleTier {
  grade: string; // e.g. "A1", "A2", "B1", "B2", "C1", "C2", "D", "E"
  minPercentage: number;
  maxPercentage: number;
  gradePoint?: number;
  description?: string; // e.g. "Outstanding", "Excellent", "Needs Improvement"
}

export interface GradingScale {
  id: string;
  name: string; // e.g. "CBSE 8-Point Scale"
  tiers: GradingScaleTier[];
  passingPercentage: number; // e.g. 33
}

export interface CoScholasticArea {
  id: string;
  name: string; // e.g. "Work Education", "Art Education", "Health & Physical Education", "Discipline"
  category: "co-scholastic" | "discipline" | "life-skills";
  scale: "3-point" | "5-point";
  order: number;
}

export type ReportCardSectionType =
  | "header"
  | "student_info"
  | "scholastic_table"
  | "co_scholastic"
  | "discipline"
  | "attendance_placeholder"
  | "remarks"
  | "signatures"
  | "grading_reference";

export interface ReportCardSectionConfig {
  id: string;
  type: ReportCardSectionType;
  title: string;
  enabled: boolean;
  order: number;
  config?: Record<string, any>;
}

export interface ReportCardLayoutConfig {
  schoolName: string;
  affiliationNo: string;
  schoolAddress: string;
  tagline: string;
  showSchoolLogo: boolean;
  showBoardLogo: boolean;
  sections: ReportCardSectionConfig[];
  signatureSlots: {
    role: "class_teacher" | "hod" | "principal";
    label: string;
    required: boolean;
  }[];
  gradingScalePlacement: "bottom_page1" | "back_page" | "none";
}

export interface StructureSubjectEntry {
  subjectId: string;
  subjectName: string;
  subjectCode?: string;
  category: "scholastic" | "co-scholastic";
  order: number;
  grade?: string;
  enabledOnReportCard?: boolean;
}

export interface AcademicStructureVersion {
  id: string; // ${structureId}_v${versionNumber}
  structureId: string;
  versionNumber: number;
  effectiveSessionId: string;
  academicYear: string;
  terms: AcademicTermConfig[];
  subjects: StructureSubjectEntry[];
  exams: DefinedExam[];
  assessmentComponents: AssessmentComponent[];
  subjectOverrides?: Record<string, SubjectAssessmentOverride>;
  scholasticTableConfig?: ScholasticTableConfig;
  calculationConfig: CalculationConfiguration;
  gradingScale: GradingScale;
  discreteGradingScales?: DiscreteGradingScale[];
  coScholasticConfig?: CoScholasticSectionConfig;
  disciplineConfig?: CoScholasticSectionConfig;
  coScholasticAreas: CoScholasticArea[]; // legacy fallback
  reportCardLayout: ReportCardLayoutConfig;
  createdAt: string;
  createdBy: string;
  notes?: string;
}

export interface AcademicStructure {
  id: string;
  name: string; // e.g. "Primary Wing", "Middle School", "Secondary CBSE"
  description: string;
  sessionId: string; // Links to AcademicSession
  academicYear: string; // e.g. "2026-27"
  applicableGrades: string[]; // e.g. ["1", "2", "3", "4", "5"]
  status: StructureStatus;
  currentVersion: number;
  activeVersionId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// ==========================================
// 2. CANONICAL CBSE DEFAULT PRESETS
// ==========================================

export const DEFAULT_TERMS: AcademicTermConfig[] = [
  {
    id: "term_1",
    name: "Term 1",
    code: "T1",
    order: 1,
    startDate: "2026-04-01",
    endDate: "2026-09-30",
    status: "open",
    examIds: ["exam-term1-pt1", "exam-term1-half-yearly"],
    assessmentComponentIds: ["comp-pt", "comp-nb", "comp-sea", "comp-th"],
  },
  {
    id: "term_2",
    name: "Term 2",
    code: "T2",
    order: 2,
    startDate: "2026-10-01",
    endDate: "2027-03-31",
    status: "not_started",
    examIds: ["exam-term2-pt2", "exam-term2-annual"],
    assessmentComponentIds: ["comp-pt", "comp-nb", "comp-sea", "comp-th"],
  },
];

export const DEFAULT_CBSE_GRADING_SCALE: GradingScale = {
  id: "cbse-8-point",
  name: "CBSE 8-Point Scale",
  passingPercentage: 33,
  tiers: [
    { grade: "A1", minPercentage: 91, maxPercentage: 100, gradePoint: 10, description: "Outstanding" },
    { grade: "A2", minPercentage: 81, maxPercentage: 90.99, gradePoint: 9, description: "Excellent" },
    { grade: "B1", minPercentage: 71, maxPercentage: 80.99, gradePoint: 8, description: "Very Good" },
    { grade: "B2", minPercentage: 61, maxPercentage: 70.99, gradePoint: 7, description: "Good" },
    { grade: "C1", minPercentage: 51, maxPercentage: 60.99, gradePoint: 6, description: "Fair" },
    { grade: "C2", minPercentage: 41, maxPercentage: 50.99, gradePoint: 5, description: "Average" },
    { grade: "D",  minPercentage: 33, maxPercentage: 40.99, gradePoint: 4, description: "Pass" },
    { grade: "E",  minPercentage: 0,  maxPercentage: 32.99, gradePoint: 0, description: "Needs Improvement" },
  ],
};

export const DEFAULT_PRIMARY_COMPONENTS: AssessmentComponent[] = [
  { id: "comp-pt", name: "Periodic Test", code: "PT", maxMarks: 10, weightage: 10, contributeToTotal: true, displayOnReportCard: true, order: 1 },
  { id: "comp-nb", name: "Notebook Submission", code: "NB", maxMarks: 5, weightage: 5, contributeToTotal: true, displayOnReportCard: true, order: 2 },
  { id: "comp-sea", name: "Subject Enrichment (SEA)", code: "SEA", maxMarks: 5, weightage: 5, contributeToTotal: true, displayOnReportCard: true, order: 3 },
  { id: "comp-th", name: "Term Examination", code: "EXAM", maxMarks: 80, weightage: 80, contributeToTotal: true, displayOnReportCard: true, order: 4 },
];

export const DEFAULT_PRIMARY_EXAMS: DefinedExam[] = [
  {
    id: "exam-term1-pt1",
    termId: "term_1",
    name: "Periodic Test 1",
    code: "PT1",
    term: "term1",
    order: 1,
    weightagePercentage: 20,
    applicableComponentIds: ["comp-pt"],
  },
  {
    id: "exam-term1-half-yearly",
    termId: "term_1",
    name: "Half-Yearly Examination",
    code: "HY",
    term: "term1",
    order: 2,
    weightagePercentage: 80,
    applicableComponentIds: ["comp-pt", "comp-nb", "comp-sea", "comp-th"],
  },
  {
    id: "exam-term2-pt2",
    termId: "term_2",
    name: "Periodic Test 2",
    code: "PT2",
    term: "term2",
    order: 1,
    weightagePercentage: 20,
    applicableComponentIds: ["comp-pt"],
  },
  {
    id: "exam-term2-annual",
    termId: "term_2",
    name: "Annual Examination",
    code: "ANN",
    term: "term2",
    order: 2,
    weightagePercentage: 80,
    applicableComponentIds: ["comp-pt", "comp-nb", "comp-sea", "comp-th"],
  },
];

export const DEFAULT_CO_SCHOLASTIC: CoScholasticArea[] = [
  { id: "cosch-work-ed", name: "Work Education", category: "co-scholastic", scale: "3-point", order: 1 },
  { id: "cosch-art-ed", name: "Art Education", category: "co-scholastic", scale: "3-point", order: 2 },
  { id: "cosch-health-pe", name: "Health & Physical Education", category: "co-scholastic", scale: "3-point", order: 3 },
  { id: "cosch-discipline", name: "Discipline", category: "discipline", scale: "3-point", order: 4 },
];

export const DEFAULT_REPORT_CARD_LAYOUT: ReportCardLayoutConfig = {
  schoolName: "PRESTIGE INTERNATIONAL SCHOOL & PRE-UNIVERSITY COLLEGE",
  affiliationNo: "CBSE AFFILIATION NO. 930123",
  schoolAddress: "Affiliated to CBSE, New Delhi — Senior Secondary Sector",
  tagline: "SCALING NEW HEIGHTS",
  showSchoolLogo: true,
  showBoardLogo: true,
  gradingScalePlacement: "back_page",
  signatureSlots: [
    { role: "class_teacher", label: "Class Teacher", required: true },
    { role: "hod", label: "Section Head / HOD", required: true },
    { role: "principal", label: "Principal", required: true },
  ],
  sections: [
    { id: "sec-header", type: "header", title: "School Header & Affiliation", enabled: true, order: 1 },
    { id: "sec-student-info", type: "student_info", title: "Student Biographical Profile", enabled: true, order: 2 },
    { id: "sec-scholastic", type: "scholastic_table", title: "Scholastic Assessment", enabled: true, order: 3 },
    { id: "sec-co-scholastic", type: "co_scholastic", title: "Co-Scholastic Activities", enabled: true, order: 4 },
    { id: "sec-discipline", type: "discipline", title: "Discipline Assessment", enabled: true, order: 5 },
    { id: "sec-attendance", type: "attendance_placeholder", title: "Attendance Record (Phase 3)", enabled: true, order: 6 },
    { id: "sec-remarks", type: "remarks", title: "Class Teacher Remarks & Promotion", enabled: true, order: 7 },
    { id: "sec-signatures", type: "signatures", title: "Institutional Signatures", enabled: true, order: 8 },
    { id: "sec-grading-ref", type: "grading_reference", title: "CBSE Grading Scale Reference", enabled: true, order: 9 },
  ],
};

export const DEFAULT_DISCRETE_GRADING_SCALES: DiscreteGradingScale[] = [
  {
    id: "scale-3-point",
    name: "3 Point Grading Scale (A,B,C)",
    tiers: [
      { grade: "A", description: "Outstanding", descriptor: "Outstanding", order: 1 },
      { grade: "B", description: "Very Good", descriptor: "Very Good", order: 2 },
      { grade: "C", description: "Fair", descriptor: "Fair", order: 3 },
    ],
  },
  {
    id: "scale-5-point",
    name: "5 Point Grading Scale (A-E)",
    tiers: [
      { grade: "A", description: "Excellent", descriptor: "Excellent", order: 1 },
      { grade: "B", description: "Very Good", descriptor: "Very Good", order: 2 },
      { grade: "C", description: "Good", descriptor: "Good", order: 3 },
      { grade: "D", description: "Fair", descriptor: "Fair", order: 4 },
      { grade: "E", description: "Needs Improvement", descriptor: "Needs Improvement", order: 5 },
    ],
  },
];

export const DEFAULT_SCHOLASTIC_TABLE_CONFIG: ScholasticTableConfig = {
  title: "SCHOLASTIC AREA",
  showMaxMarksRow: true,
  showTotalColumnPerTerm: true,
  terms: [
    {
      termId: "term_1",
      termName: "TERM 1",
      maxMarks: 100,
      enabled: true,
      assessmentComponents: [
        {
          id: "t1_pt",
          name: "Periodic Test",
          code: "PT",
          maxMarks: 10,
          testedMaxMarks: 40,
          scalingTargetMarks: 10,
          calculationMethod: "scale_to_target",
          contributeToTotal: true,
          displayOnReportCard: true,
          applicableTermId: "term_1",
          order: 1,
        },
        {
          id: "t1_nb",
          name: "Notebook",
          code: "NB",
          maxMarks: 5,
          testedMaxMarks: 5,
          scalingTargetMarks: 5,
          calculationMethod: "raw",
          contributeToTotal: true,
          displayOnReportCard: true,
          applicableTermId: "term_1",
          order: 2,
        },
        {
          id: "t1_sea",
          name: "Subject Enrichment",
          code: "SEA",
          maxMarks: 5,
          testedMaxMarks: 5,
          scalingTargetMarks: 5,
          calculationMethod: "raw",
          contributeToTotal: true,
          displayOnReportCard: true,
          applicableTermId: "term_1",
          order: 3,
        },
        {
          id: "t1_hy",
          name: "Half Yearly",
          code: "HY",
          maxMarks: 80,
          testedMaxMarks: 80,
          scalingTargetMarks: 80,
          calculationMethod: "raw",
          contributeToTotal: true,
          displayOnReportCard: true,
          applicableTermId: "term_1",
          order: 4,
        },
      ],
    },
    {
      termId: "term_2",
      termName: "TERM 2",
      maxMarks: 100,
      enabled: true,
      assessmentComponents: [
        {
          id: "t2_pt",
          name: "Periodic Test",
          code: "PT",
          maxMarks: 10,
          testedMaxMarks: 40,
          scalingTargetMarks: 10,
          calculationMethod: "scale_to_target",
          contributeToTotal: true,
          displayOnReportCard: true,
          applicableTermId: "term_2",
          order: 1,
        },
        {
          id: "t2_nb",
          name: "Notebook",
          code: "NB",
          maxMarks: 5,
          testedMaxMarks: 5,
          scalingTargetMarks: 5,
          calculationMethod: "raw",
          contributeToTotal: true,
          displayOnReportCard: true,
          applicableTermId: "term_2",
          order: 2,
        },
        {
          id: "t2_sea",
          name: "Subject Enrichment",
          code: "SEA",
          maxMarks: 5,
          testedMaxMarks: 5,
          scalingTargetMarks: 5,
          calculationMethod: "raw",
          contributeToTotal: true,
          displayOnReportCard: true,
          applicableTermId: "term_2",
          order: 3,
        },
        {
          id: "t2_ae",
          name: "Annual Exam",
          code: "AE",
          maxMarks: 80,
          testedMaxMarks: 80,
          scalingTargetMarks: 80,
          calculationMethod: "raw",
          contributeToTotal: true,
          displayOnReportCard: true,
          applicableTermId: "term_2",
          order: 4,
        },
      ],
    },
  ],
  overallConfig: {
    title: "OVERALL",
    subtitle: "Term 1 + Term 2",
    term1Weight: 50,
    term2Weight: 50,
    showOverallTotal: true,
    showGrade: true,
    showRank: true,
    showGrandTotal: true,
    grandTotalLabel: "Grand Total",
  },
  overall: {
    showTerm1Total: false,
    showTerm2Total: false,
    showGrandTotal: true,
    grandTotalLabel: "Grand Total",
    showPercentage: false,
    showGrade: true,
    showGradePoint: false,
    showRank: true,
    showResultStatus: false,
    showRemarks: false,
    customSubHeaderText: "Term 1 (50)+Term 2 (50)",
  },
};

export const DEFAULT_CO_SCHOLASTIC_CONFIG: CoScholasticSectionConfig = {
  id: "cosch-main",
  title: "Co-Scholastic Areas",
  subtitle: "(3 Point Grading Scale A,B,C)",
  enabled: true,
  scaleId: "scale-3-point",
  terms: ["term_1", "term_2"],
  termColumns: [
    { termId: "term_1", label: "T1" },
    { termId: "term_2", label: "T2" },
  ],
  areas: [
    { id: "cosch-work-ed", name: "Work Education", code: "WE", category: "co-scholastic", order: 1, enabled: true, displayOnReportCard: true, applicableTermIds: ["term_1", "term_2"] },
    { id: "cosch-art-ed", name: "Art Education", code: "AE", category: "co-scholastic", order: 2, enabled: true, displayOnReportCard: true, applicableTermIds: ["term_1", "term_2"] },
    { id: "cosch-health-pe", name: "Health & Physical Education", code: "HPE", category: "co-scholastic", order: 3, enabled: true, displayOnReportCard: true, applicableTermIds: ["term_1", "term_2"] },
    { id: "cosch-sci-skills", name: "Scientific Skills", code: "SS", category: "co-scholastic", order: 4, enabled: true, displayOnReportCard: true, applicableTermIds: ["term_1", "term_2"] },
    { id: "cosch-thinking-skills", name: "Thinking Skills", code: "TS", category: "co-scholastic", order: 5, enabled: true, displayOnReportCard: true, applicableTermIds: ["term_1", "term_2"] },
    { id: "cosch-social-skills", name: "Social Skills", code: "SOC", category: "co-scholastic", order: 6, enabled: true, displayOnReportCard: true, applicableTermIds: ["term_1", "term_2"] },
    { id: "cosch-yoga-ncc", name: "Yoga/ NCC", code: "YN", category: "co-scholastic", order: 7, enabled: true, displayOnReportCard: true, applicableTermIds: ["term_1", "term_2"] },
    { id: "cosch-sports", name: "Sports", code: "SP", category: "co-scholastic", order: 8, enabled: true, displayOnReportCard: true, applicableTermIds: ["term_1", "term_2"] },
  ],
};

/**
 * Normalizes a scholasticTableConfig object from Firestore or user input, guaranteeing
 * resilient defaults for terms, assessmentComponents, and overallConfig.
 */
export function normalizeScholasticTableConfig(config?: any): ScholasticTableConfig {
  if (!config || typeof config !== "object") {
    return JSON.parse(JSON.stringify(DEFAULT_SCHOLASTIC_TABLE_CONFIG));
  }

  const rawTerms = Array.isArray(config.terms) && config.terms.length > 0
    ? config.terms
    : DEFAULT_SCHOLASTIC_TABLE_CONFIG.terms;

  const normalizedTerms: ScholasticTermConfig[] = ["term_1", "term_2"].map((termId) => {
    const existing = rawTerms.find((t: any) => t.termId === termId) || {};
    const defaultTerm = DEFAULT_SCHOLASTIC_TABLE_CONFIG.terms.find((t) => t.termId === termId)!;

    const comps: AssessmentComponent[] = Array.isArray(existing.assessmentComponents) && existing.assessmentComponents.length > 0
      ? existing.assessmentComponents.map((c: any, idx: number) => ({
          id: c.id || `${termId}_comp_${idx + 1}`,
          name: c.name || "Assessment",
          code: c.code || "AS",
          maxMarks: Number(c.maxMarks) || 10,
          testedMaxMarks: Number(c.testedMaxMarks) || Number(c.maxMarks) || 10,
          scalingTargetMarks: c.scalingTargetMarks !== undefined ? Number(c.scalingTargetMarks) : Number(c.maxMarks) || 10,
          calculationMethod: c.calculationMethod || "raw",
          contributeToTotal: c.contributeToTotal !== false,
          displayOnReportCard: c.displayOnReportCard !== false,
          applicableTermId: termId as "term_1" | "term_2",
          ...(c.applicableExamId ? { applicableExamId: c.applicableExamId } : {}),
          order: Number(c.order) || idx + 1,
        }))
      : defaultTerm.assessmentComponents.map((c) => ({ ...c }));

    const derivedMax = comps
      .filter((c) => c.contributeToTotal !== false && c.displayOnReportCard !== false)
      .reduce((sum, c) => sum + (c.scalingTargetMarks ?? c.maxMarks ?? 0), 0);

    return {
      termId,
      termName: existing.termName || defaultTerm.termName,
      maxMarks: derivedMax || existing.maxMarks || defaultTerm.maxMarks || 100,
      enabled: existing.enabled !== false,
      ...(existing.headerLabelOverride ? { headerLabelOverride: existing.headerLabelOverride } : {}),
      assessmentComponents: comps,
    };
  });

  const overallSrc = config.overallConfig || config.overall || {};
  const normalizedOverall: ScholasticOverallConfig = {
    title: overallSrc.title || "OVERALL",
    subtitle: overallSrc.subtitle || overallSrc.customSubHeaderText || "Term 1 + Term 2",
    term1Weight: Number(overallSrc.term1Weight) || 50,
    term2Weight: Number(overallSrc.term2Weight) || 50,
    showOverallTotal: overallSrc.showOverallTotal ?? overallSrc.showGrandTotal ?? true,
    showGrade: overallSrc.showGrade ?? true,
    showRank: overallSrc.showRank ?? true,
    showTerm1Total: overallSrc.showTerm1Total ?? false,
    showTerm2Total: overallSrc.showTerm2Total ?? false,
    showGrandTotal: overallSrc.showGrandTotal ?? overallSrc.showOverallTotal ?? true,
    grandTotalLabel: overallSrc.grandTotalLabel || "Grand Total",
    showPercentage: overallSrc.showPercentage ?? false,
    showGradePoint: overallSrc.showGradePoint ?? false,
    showResultStatus: overallSrc.showResultStatus ?? false,
    showRemarks: overallSrc.showRemarks ?? false,
  };

  return {
    title: config.title || DEFAULT_SCHOLASTIC_TABLE_CONFIG.title,
    showMaxMarksRow: config.showMaxMarksRow !== false,
    showTotalColumnPerTerm: config.showTotalColumnPerTerm !== false,
    terms: normalizedTerms,
    overallConfig: normalizedOverall,
    overall: normalizedOverall,
  };
}

/**
 * Normalizes a coScholasticConfig object from Firestore or user input, guaranteeing
 * resilient defaults for termColumns, areas, and discrete scales.
 */
export function normalizeCoScholasticConfig(config?: any): CoScholasticSectionConfig {
  if (!config || typeof config !== "object") {
    return JSON.parse(JSON.stringify(DEFAULT_CO_SCHOLASTIC_CONFIG));
  }

  const termColumns = Array.isArray(config.termColumns) && config.termColumns.length > 0
    ? config.termColumns
    : [
        { termId: "term_1", label: "T1" },
        { termId: "term_2", label: "T2" },
      ];

  const rawAreas = Array.isArray(config.areas) && config.areas.length > 0
    ? config.areas
    : DEFAULT_CO_SCHOLASTIC_CONFIG.areas;

  const normalizedAreas: CoScholasticAreaEntry[] = rawAreas.map((a: any, idx: number) => ({
    id: a.id || `area_${idx + 1}`,
    name: a.name || `Activity ${idx + 1}`,
    code: a.code || `A${idx + 1}`,
    category: a.category || "co-scholastic",
    order: Number(a.order) || idx + 1,
    enabled: a.enabled !== false,
    displayOnReportCard: a.displayOnReportCard !== false,
    applicableTermIds: Array.isArray(a.applicableTermIds) && a.applicableTermIds.length > 0
      ? a.applicableTermIds
      : ["term_1", "term_2"],
  }));

  return {
    id: config.id || DEFAULT_CO_SCHOLASTIC_CONFIG.id,
    title: config.title || DEFAULT_CO_SCHOLASTIC_CONFIG.title,
    subtitle: config.subtitle !== undefined ? config.subtitle : DEFAULT_CO_SCHOLASTIC_CONFIG.subtitle,
    enabled: config.enabled !== false,
    scaleId: config.scaleId || DEFAULT_CO_SCHOLASTIC_CONFIG.scaleId,
    terms: Array.isArray(config.terms) && config.terms.length > 0 ? config.terms : ["term_1", "term_2"],
    termColumns,
    areas: normalizedAreas,
  };
}

/**
 * Resolves effective assessment components and derived term maximum marks for a specific subject and term.
 * Respects subject-specific overrides if configured, falling back to structure-level term components.
 */
export function getEffectiveComponentsForSubject(
  version: AcademicStructureVersion,
  termId: string,
  subjectId?: string
): { components: AssessmentComponent[]; termMaxMarks: number } {
  if (subjectId && version.subjectOverrides?.[subjectId]?.termOverrides?.[termId]) {
    const override = version.subjectOverrides[subjectId].termOverrides[termId];
    if (override && override.components && override.components.length > 0) {
      const active = override.components
        .filter((c) => c.displayOnReportCard)
        .sort((a, b) => a.order - b.order);
      const max =
        override.maxMarks ??
        active.filter((c) => c.contributeToTotal).reduce((sum, c) => sum + (c.scalingTargetMarks || c.maxMarks), 0);
      return { components: active, termMaxMarks: max };
    }
  }

  // Structure-level components
  const term = version.terms?.find((t) => t.id === termId);
  const sourceComps = term?.assessmentComponents || version.assessmentComponents || [];
  const termComps = sourceComps
    .filter((c) => {
      if (!c.displayOnReportCard) return false;
      const termMatch = !c.applicableTermId || c.applicableTermId === "all" || c.applicableTermId === termId;
      const subjectMatch =
        !subjectId ||
        !c.applicableSubjects ||
        c.applicableSubjects.length === 0 ||
        c.applicableSubjects.includes(subjectId);
      return termMatch && subjectMatch;
    })
    .sort((a, b) => a.order - b.order);

  const derivedMax =
    term?.maxMarks ??
    termComps.filter((c) => c.contributeToTotal).reduce((sum, c) => sum + (c.scalingTargetMarks || c.maxMarks), 0);

  return { components: termComps, termMaxMarks: derivedMax };
}

/**
 * Derives the maximum marks for a term safely, supporting both:
 * 1. deriveTermMaxMarks(termConfigObject)
 * 2. deriveTermMaxMarks(structureVersion, termId)
 */
export function deriveTermMaxMarks(termOrVersion: any, termId?: string): number {
  if (!termOrVersion) return 100;

  // Case 1: Called with a direct term configuration object: deriveTermMaxMarks(termObj)
  if (!termId || typeof termId !== "string") {
    if (Array.isArray(termOrVersion.assessmentComponents) && termOrVersion.assessmentComponents.length > 0) {
      const active = termOrVersion.assessmentComponents.filter(
        (c: AssessmentComponent) => c.displayOnReportCard !== false && c.contributeToTotal !== false
      );
      if (active.length > 0) {
        return active.reduce(
          (sum: number, c: AssessmentComponent) => sum + (c.scalingTargetMarks ?? c.maxMarks ?? 0),
          0
        );
      }
    }
    if (typeof termOrVersion.maxMarks === "number" && termOrVersion.maxMarks > 0) {
      return termOrVersion.maxMarks;
    }
    return 100;
  }

  // Case 2: Called with (version, termId)
  const version = termOrVersion as AcademicStructureVersion;
  if (version.scholasticTableConfig?.terms) {
    const sTerm = version.scholasticTableConfig.terms.find((t: any) => t.termId === termId);
    if (sTerm?.assessmentComponents && Array.isArray(sTerm.assessmentComponents) && sTerm.assessmentComponents.length > 0) {
      const active = sTerm.assessmentComponents.filter(
        (c: any) => c.displayOnReportCard !== false && c.contributeToTotal !== false
      );
      if (active.length > 0) {
        return active.reduce((sum: number, c: any) => sum + (c.scalingTargetMarks ?? c.maxMarks ?? 0), 0);
      }
    }
    if (sTerm?.maxMarks && sTerm.maxMarks > 0) return sTerm.maxMarks;
  }

  const term = version.terms?.find((t) => t.id === termId);
  if (term?.maxMarks && term.maxMarks > 0) return term.maxMarks;

  try {
    const { termMaxMarks } = getEffectiveComponentsForSubject(version, termId);
    if (termMaxMarks > 0) return termMaxMarks;
  } catch {
    // fallback
  }

  return 100;
}

// ==========================================
// 3. FIRESTORE CRUD & VERSIONING ENGINE
// ==========================================

export async function listAcademicStructures(sessionId?: string): Promise<AcademicStructure[]> {
  try {
    let q = query(collection(db, "academicStructures"));
    if (sessionId) {
      q = query(collection(db, "academicStructures"), where("sessionId", "==", sessionId));
    }
    const snap = await getDocs(q);
    const structures: AcademicStructure[] = [];
    snap.forEach((d) => {
      structures.push({ id: d.id, ...d.data() } as AcademicStructure);
    });
    structures.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return structures;
  } catch (err) {
    console.error("Failed to list academic structures:", err);
    return [];
  }
}

export async function getAcademicStructure(id: string): Promise<AcademicStructure | null> {
  try {
    const snap = await getDoc(doc(db, "academicStructures", id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as AcademicStructure;
  } catch (err) {
    console.error(`Failed to fetch academic structure ${id}:`, err);
    return null;
  }
}

export async function getStructureVersion(
  structureId: string,
  versionNumber: number
): Promise<AcademicStructureVersion | null> {
  try {
    const versionId = `${structureId}_v${versionNumber}`;
    const snap = await getDoc(doc(db, "academicStructureVersions", versionId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as AcademicStructureVersion;
  } catch (err) {
    console.error(`Failed to fetch structure version ${structureId} v${versionNumber}:`, err);
    return null;
  }
}

export async function getActiveStructureForGrade(
  grade: string,
  sessionId?: string
): Promise<{ structure: AcademicStructure; version: AcademicStructureVersion } | null> {
  try {
    const structures = await listAcademicStructures(sessionId);
    const active = structures.find(
      (s) => s.status === "active" && s.applicableGrades.includes(String(grade))
    );
    if (!active) return null;

    const versionNumber = active.currentVersion || 1;
    const version = await getStructureVersion(active.id, versionNumber);
    if (!version) return null;

    return { structure: active, version };
  } catch (err) {
    console.error(`Failed to resolve active structure for grade ${grade}:`, err);
    return null;
  }
}

/**
 * Recursively strips keys with undefined values from objects and arrays so Firestore doesn't reject them.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (typeof value === "object" && !(value instanceof Date) && !(value instanceof RegExp)) {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        res[k] = stripUndefinedDeep(v);
      }
    }
    return res as T;
  }
  return value;
}

/**
 * Creates a brand new Academic Structure along with its initial version (v1).
 */
export async function createAcademicStructure(params: {
  name: string;
  description: string;
  sessionId: string;
  academicYear: string;
  applicableGrades: string[];
  status: StructureStatus;
  terms?: AcademicTermConfig[];
  subjects: StructureSubjectEntry[];
  exams: DefinedExam[];
  assessmentComponents: AssessmentComponent[];
  subjectOverrides?: Record<string, SubjectAssessmentOverride>;
  scholasticTableConfig?: ScholasticTableConfig;
  calculationConfig?: CalculationConfiguration;
  gradingScale?: GradingScale;
  discreteGradingScales?: DiscreteGradingScale[];
  coScholasticConfig?: CoScholasticSectionConfig;
  disciplineConfig?: CoScholasticSectionConfig;
  coScholasticAreas?: CoScholasticArea[];
  reportCardLayout?: ReportCardLayoutConfig;
  user: { uid: string; name: string; email: string };
}): Promise<{ structureId: string; versionId: string }> {
  const structureRef = doc(collection(db, "academicStructures"));
  const structureId = structureRef.id;

  const versionNumber = 1;
  const versionId = `${structureId}_v${versionNumber}`;
  const versionRef = doc(db, "academicStructureVersions", versionId);

  const now = new Date().toISOString();

  const structureData: AcademicStructure = {
    id: structureId,
    name: params.name.trim(),
    description: params.description.trim(),
    sessionId: params.sessionId,
    academicYear: params.academicYear,
    applicableGrades: params.applicableGrades.map(String),
    status: params.status || "draft",
    currentVersion: versionNumber,
    activeVersionId: versionId,
    createdAt: now,
    updatedAt: now,
    createdBy: params.user.uid,
  };

  const versionData: AcademicStructureVersion = {
    id: versionId,
    structureId,
    versionNumber,
    effectiveSessionId: params.sessionId,
    academicYear: params.academicYear,
    terms: params.terms || DEFAULT_TERMS,
    subjects: params.subjects,
    exams: params.exams,
    assessmentComponents: params.assessmentComponents,
    subjectOverrides: params.subjectOverrides || {},
    scholasticTableConfig: params.scholasticTableConfig || DEFAULT_SCHOLASTIC_TABLE_CONFIG,
    calculationConfig: params.calculationConfig || DEFAULT_CALCULATION_CONFIG,
    gradingScale: params.gradingScale || DEFAULT_CBSE_GRADING_SCALE,
    discreteGradingScales: params.discreteGradingScales || DEFAULT_DISCRETE_GRADING_SCALES,
    coScholasticConfig: params.coScholasticConfig || DEFAULT_CO_SCHOLASTIC_CONFIG,
    disciplineConfig: params.disciplineConfig,
    coScholasticAreas: params.coScholasticAreas || DEFAULT_CO_SCHOLASTIC,
    reportCardLayout: params.reportCardLayout || DEFAULT_REPORT_CARD_LAYOUT,
    createdAt: now,
    createdBy: params.user.uid,
    notes: "Initial structure configuration",
  };

  const batch = writeBatch(db);
  batch.set(structureRef, stripUndefinedDeep(structureData));
  batch.set(versionRef, stripUndefinedDeep(versionData));
  await batch.commit();

  await logAcademicAudit({
    action: "create",
    module: "academic_structure",
    targetId: structureId,
    targetName: structureData.name,
    sessionId: params.sessionId,
    academicYear: params.academicYear,
    details: {
      grades: structureData.applicableGrades,
      examsCount: versionData.exams.length,
      componentsCount: versionData.assessmentComponents.length,
      version: versionNumber,
    },
    performedBy: {
      uid: params.user.uid,
      name: params.user.name,
      role: "admin",
    },
  });

  return { structureId, versionId };
}

/**
 * Updates an existing Academic Structure.
 * If bumpVersion is true (e.g. exams, components, or grading scales changed),
 * creates a new immutable version record (v2, v3, etc.) to preserve historical integrity.
 */
export async function updateAcademicStructure(params: {
  structureId: string;
  name?: string;
  description?: string;
  applicableGrades?: string[];
  status?: StructureStatus;
  terms?: AcademicTermConfig[];
  subjects?: StructureSubjectEntry[];
  exams?: DefinedExam[];
  assessmentComponents?: AssessmentComponent[];
  subjectOverrides?: Record<string, SubjectAssessmentOverride>;
  scholasticTableConfig?: ScholasticTableConfig;
  calculationConfig?: CalculationConfiguration;
  gradingScale?: GradingScale;
  discreteGradingScales?: DiscreteGradingScale[];
  coScholasticConfig?: CoScholasticSectionConfig;
  disciplineConfig?: CoScholasticSectionConfig;
  coScholasticAreas?: CoScholasticArea[];
  reportCardLayout?: ReportCardLayoutConfig;
  bumpVersion?: boolean;
  versionNotes?: string;
  user: { uid: string; name: string; email: string };
}): Promise<{ structureId: string; versionId: string; versionNumber: number }> {
  const current = await getAcademicStructure(params.structureId);
  if (!current) throw new Error("Academic structure not found");

  const now = new Date().toISOString();
  let versionNumber = current.currentVersion || 1;

  const currentVersionDoc = await getStructureVersion(current.id, versionNumber);
  const baseVersion: AcademicStructureVersion = currentVersionDoc || {
    id: `${current.id}_v${versionNumber}`,
    structureId: current.id,
    versionNumber,
    effectiveSessionId: current.sessionId,
    academicYear: current.academicYear,
    terms: DEFAULT_TERMS,
    subjects: [],
    exams: DEFAULT_PRIMARY_EXAMS,
    assessmentComponents: DEFAULT_PRIMARY_COMPONENTS,
    subjectOverrides: {},
    scholasticTableConfig: DEFAULT_SCHOLASTIC_TABLE_CONFIG,
    calculationConfig: DEFAULT_CALCULATION_CONFIG,
    gradingScale: DEFAULT_CBSE_GRADING_SCALE,
    discreteGradingScales: DEFAULT_DISCRETE_GRADING_SCALES,
    coScholasticConfig: DEFAULT_CO_SCHOLASTIC_CONFIG,
    coScholasticAreas: DEFAULT_CO_SCHOLASTIC,
    reportCardLayout: DEFAULT_REPORT_CARD_LAYOUT,
    createdAt: now,
    createdBy: params.user.uid,
  };

  const batch = writeBatch(db);

  if (params.bumpVersion) {
    versionNumber += 1;
    const newVersionId = `${current.id}_v${versionNumber}`;
    const newVersionRef = doc(db, "academicStructureVersions", newVersionId);

    const newVersionData: AcademicStructureVersion = {
      id: newVersionId,
      structureId: current.id,
      versionNumber,
      effectiveSessionId: current.sessionId,
      academicYear: current.academicYear,
      terms: params.terms ?? baseVersion.terms ?? DEFAULT_TERMS,
      subjects: params.subjects ?? baseVersion.subjects,
      exams: params.exams ?? baseVersion.exams,
      assessmentComponents: params.assessmentComponents ?? baseVersion.assessmentComponents,
      subjectOverrides: params.subjectOverrides ?? baseVersion.subjectOverrides ?? {},
      scholasticTableConfig: params.scholasticTableConfig ?? baseVersion.scholasticTableConfig ?? DEFAULT_SCHOLASTIC_TABLE_CONFIG,
      calculationConfig: params.calculationConfig ?? baseVersion.calculationConfig ?? DEFAULT_CALCULATION_CONFIG,
      gradingScale: params.gradingScale ?? baseVersion.gradingScale,
      discreteGradingScales: params.discreteGradingScales ?? baseVersion.discreteGradingScales ?? DEFAULT_DISCRETE_GRADING_SCALES,
      coScholasticConfig: params.coScholasticConfig ?? baseVersion.coScholasticConfig ?? DEFAULT_CO_SCHOLASTIC_CONFIG,
      disciplineConfig: params.disciplineConfig ?? baseVersion.disciplineConfig,
      coScholasticAreas: params.coScholasticAreas ?? baseVersion.coScholasticAreas,
      reportCardLayout: params.reportCardLayout ?? baseVersion.reportCardLayout,
      createdAt: now,
      createdBy: params.user.uid,
      notes: params.versionNotes || `Updated to version ${versionNumber}`,
    };

    batch.set(newVersionRef, stripUndefinedDeep(newVersionData));

    const structureUpdates: Partial<AcademicStructure> = {
      name: params.name !== undefined ? params.name.trim() : current.name,
      description: params.description !== undefined ? params.description.trim() : current.description,
      applicableGrades: params.applicableGrades !== undefined ? params.applicableGrades.map(String) : current.applicableGrades,
      status: params.status !== undefined ? params.status : current.status,
      currentVersion: versionNumber,
      activeVersionId: newVersionId,
      updatedAt: now,
    };
    batch.update(doc(db, "academicStructures", current.id), stripUndefinedDeep(structureUpdates) as any);
    await batch.commit();

    await logAcademicAudit({
      action: "update",
      module: "academic_structure",
      targetId: current.id,
      targetName: structureUpdates.name || current.name,
      sessionId: current.sessionId,
      academicYear: current.academicYear,
      details: {
        action: "version_bump",
        newVersion: versionNumber,
        notes: params.versionNotes,
      },
      performedBy: { uid: params.user.uid, name: params.user.name, role: "admin" },
    });

    return { structureId: current.id, versionId: newVersionId, versionNumber };
  } else {
    // In-place update for current version (e.g. drafting or minor name edits)
    const versionId = `${current.id}_v${versionNumber}`;
    const versionRef = doc(db, "academicStructureVersions", versionId);

    const updatedVersionData: Partial<AcademicStructureVersion> = {};
    if (params.terms !== undefined) updatedVersionData.terms = params.terms;
    if (params.subjects !== undefined) updatedVersionData.subjects = params.subjects;
    if (params.exams !== undefined) updatedVersionData.exams = params.exams;
    if (params.assessmentComponents !== undefined) updatedVersionData.assessmentComponents = params.assessmentComponents;
    if (params.subjectOverrides !== undefined) updatedVersionData.subjectOverrides = params.subjectOverrides;
    if (params.scholasticTableConfig !== undefined) updatedVersionData.scholasticTableConfig = params.scholasticTableConfig;
    if (params.calculationConfig !== undefined) updatedVersionData.calculationConfig = params.calculationConfig;
    if (params.gradingScale !== undefined) updatedVersionData.gradingScale = params.gradingScale;
    if (params.discreteGradingScales !== undefined) updatedVersionData.discreteGradingScales = params.discreteGradingScales;
    if (params.coScholasticConfig !== undefined) updatedVersionData.coScholasticConfig = params.coScholasticConfig;
    if (params.disciplineConfig !== undefined) updatedVersionData.disciplineConfig = params.disciplineConfig;
    if (params.coScholasticAreas !== undefined) updatedVersionData.coScholasticAreas = params.coScholasticAreas;
    if (params.reportCardLayout !== undefined) updatedVersionData.reportCardLayout = params.reportCardLayout;

    const cleanedVersionUpdates = stripUndefinedDeep(updatedVersionData);
    if (Object.keys(cleanedVersionUpdates).length > 0) {
      batch.update(versionRef, cleanedVersionUpdates as any);
    }

    const structureUpdates: Partial<AcademicStructure> = {
      name: params.name !== undefined ? params.name.trim() : current.name,
      description: params.description !== undefined ? params.description.trim() : current.description,
      applicableGrades: params.applicableGrades !== undefined ? params.applicableGrades.map(String) : current.applicableGrades,
      status: params.status !== undefined ? params.status : current.status,
      updatedAt: now,
    };
    batch.update(doc(db, "academicStructures", current.id), stripUndefinedDeep(structureUpdates) as any);
    await batch.commit();

    return { structureId: current.id, versionId, versionNumber };
  }
}

/**
 * Activates an Academic Structure.
 * Validates that there is no grade collision with any other active structure in the same session.
 */
export async function activateAcademicStructure(
  structureId: string,
  user: { uid: string; name: string }
): Promise<{ success: boolean; message?: string }> {
  const target = await getAcademicStructure(structureId);
  if (!target) return { success: false, message: "Structure not found" };

  if (!target.applicableGrades || target.applicableGrades.length === 0) {
    return { success: false, message: "Cannot activate: At least one applicable grade must be selected." };
  }

  const allStructures = await listAcademicStructures(target.sessionId);
  for (const s of allStructures) {
    if (s.id !== target.id && s.status === "active") {
      const collision = s.applicableGrades.find((g) => target.applicableGrades.includes(g));
      if (collision) {
        return {
          success: false,
          message: `Grade ${collision} is already governed by active structure "${s.name}". Please deactivate or reassign it first.`,
        };
      }
    }
  }

  await updateDoc(doc(db, "academicStructures", structureId), {
    status: "active",
    updatedAt: new Date().toISOString(),
  });

  await logAcademicAudit({
    action: "activate",
    module: "academic_structure",
    targetId: target.id,
    targetName: target.name,
    sessionId: target.sessionId,
    academicYear: target.academicYear,
    details: { grades: target.applicableGrades },
    performedBy: { uid: user.uid, name: user.name, role: "admin" },
  });

  return { success: true };
}

/**
 * Archives an Academic Structure so it can no longer be used for new exam scheduling.
 */
export async function archiveAcademicStructure(
  structureId: string,
  user: { uid: string; name: string }
): Promise<void> {
  const target = await getAcademicStructure(structureId);
  if (!target) return;

  await updateDoc(doc(db, "academicStructures", structureId), {
    status: "archived",
    updatedAt: new Date().toISOString(),
  });

  await logAcademicAudit({
    action: "archive",
    module: "academic_structure",
    targetId: target.id,
    targetName: target.name,
    sessionId: target.sessionId,
    academicYear: target.academicYear,
    performedBy: { uid: user.uid, name: user.name, role: "admin" },
  });
}

/**
 * Duplicates a structure into a fresh draft structure for rapid setup or next-year rollover.
 */
export async function duplicateAcademicStructure(
  structureId: string,
  newName: string,
  targetSessionId: string,
  targetAcademicYear: string,
  user: { uid: string; name: string; email: string }
): Promise<string> {
  const source = await getAcademicStructure(structureId);
  if (!source) throw new Error("Source structure not found");

  const sourceVersion = await getStructureVersion(source.id, source.currentVersion);
  if (!sourceVersion) throw new Error("Source structure version not found");

  const result = await createAcademicStructure({
    name: newName.trim(),
    description: `Duplicated from ${source.name}`,
    sessionId: targetSessionId,
    academicYear: targetAcademicYear,
    applicableGrades: source.applicableGrades,
    status: "draft",
    terms: sourceVersion.terms || DEFAULT_TERMS,
    subjects: sourceVersion.subjects,
    exams: sourceVersion.exams,
    assessmentComponents: sourceVersion.assessmentComponents,
    subjectOverrides: sourceVersion.subjectOverrides,
    scholasticTableConfig: sourceVersion.scholasticTableConfig,
    calculationConfig: sourceVersion.calculationConfig,
    gradingScale: sourceVersion.gradingScale,
    discreteGradingScales: sourceVersion.discreteGradingScales,
    coScholasticConfig: sourceVersion.coScholasticConfig,
    disciplineConfig: sourceVersion.disciplineConfig,
    coScholasticAreas: sourceVersion.coScholasticAreas,
    reportCardLayout: sourceVersion.reportCardLayout,
    user,
  });

  return result.structureId;
}

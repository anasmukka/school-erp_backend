export type Role = "admin" | "hod" | "teacher" | "student" | "accountant";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  hodId?: string;
  assignedGrades?: string[];
  subject?: string;
  DOB?: string;
  photo?: string;
}

export interface Teacher {
  id: string;
  uid?: string;
  name: string;
  email: string;
  subject: string;
  DOB?: string;
  photo?: string;
  hodIds: string[];
  hodAssignments: { hodId: string; grades: string[] }[];
}

export interface Student {
  id: string;
  uid?: string;
  name: string;
  email?: string;
  photo?: string;
  DOB: string;
  parentContact: string;
  /** @deprecated Use active enrollment className */
  grade?: string;
  hodId: string;
  /** @deprecated Use active enrollment sectionId */
  sectionId?: string | null;
  admissionNo?: string;
  /** @deprecated Prefer enrollment.rollNo */
  rollNo?: string;
  rfidUid?: string;
  fatherName?: string;
  motherName?: string;
  address?: string;
  gender?: string;
  createdAt?: string;
}

export type EnrollmentStatus = "active" | "promoted" | "graduated" | "transferred" | "detained";

export interface Enrollment {
  id: string;
  studentId: string;
  academicYear: string;
  className: string;
  sectionName: string | null;
  sectionId: string | null;
  rollNo?: string;
  hodId?: string;
  status: EnrollmentStatus;
  createdAt: string;
  promotedFromEnrollmentId?: string;
}

export interface FeeHead {
  id: string;
  name: string;
  amount: number;
}

export interface FeeInstallment {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
}

export interface FeeStructure {
  id: string;
  academicSession: string;
  grade: string;
  title: string;
  term?: "term1" | "term2" | "full_year";
  feeHeads: FeeHead[];
  installments: FeeInstallment[];
  notes?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

export type FeePaymentMode = "cash" | "cheque" | "online" | "upi";

export interface FeePayment {
  id: string;
  academicSession: string;
  grade: string;
  structureId: string;
  studentId: string;
  studentName: string;
  installmentId: string;
  installmentLabel: string;
  amount: number;
  paymentMode: FeePaymentMode;
  reference?: string;
  notes?: string;
  paidAt: string;
  recordedBy: string;
  receiptNo?: string;
}

export type SubjectCategory = "scholastic" | "co-scholastic";

export interface Subject {
  id: string;
  name: string;
  grade: string;
  category?: SubjectCategory;
  order?: number;
}

export interface SubjectAssignment {
  id: string;
  subjectId: string;
  sectionId: string;
  teacherId: string;
  /** Academic year this assignment applies to (defaults to current year in UI). */
  academicYear?: string;
}

export interface Section {
  id: string;
  grade: string;
  name: string;
  className?: string;
  sectionName?: string;
  hodId: string;
  classTeacherId?: string;
  marksDueDate?: string; // ISO date string set by HOD, e.g. "2025-03-31"
  timetableConfig?: {
    days: string[];
    periodCount: number;
    classStartTime: string;
    disperseTime: string;
    dayEndTimes?: Record<string, string>;
    periodDurationMinutes?: number;
    updatedAt?: string;
  };
}

export type TimetableEntryType =
  | "subject"
  | "free"
  | "short_break"
  | "lunch_break"
  | "assembly";

export interface TimetableEntry {
  id: string;
  sectionId: string;
  grade: string;
  hodId: string;
  day: string;
  periodNumber: number;
  periodLabel: string;
  startTime: string;
  endTime: string;
  durationMinutes?: number;
  entryType?: TimetableEntryType;
  subjectId?: string;
  subjectName?: string;
  teacherId?: string;
  teacherName?: string;
}

export interface Exam {
  id: string;
  examType: string;
  grade: string;
  subjectId: string;
  subjectName?: string;
  date: string;
  hodId: string;
}

export interface Mark {
  id: string;
  studentId: string;
  studentName: string;
  examType: string;
  subjectId: string;
  sectionId: string;
  marks: number;
  perTest: number;
  notebook?: number;
  enrichment?: number;
  examMarks: number;
  total: number;
  grade: string;
  gradeLevel: number;
  teacherId: string;
  updatedAt: string;
}

export interface SubjectMark {
  subjectId: string;
  subjectName: string;
  marks: number;
  perTest?: number;
  notebook?: number;
  enrichment?: number;
  examMarks?: number;
  grade?: string;
  gradeLevel?: number;
}

export interface CoScholasticGrades {
  workEd: string;
  artEd: string;
  healthPE: string;
}

export interface CoActivitiesGrades {
  generalKnowledge: string;
  valueEd: string;
  computer: string;
}

export interface DigitalSignature {
  userId?: string;
  name: string;
  signedAt: string; // ISO timestamp
}

export type ReportCardStatus = "draft" | "teacher_signed" | "hod_signed" | "principal_signed" | "published";

export interface ReportCard {
  id: string;
  studentId: string;
  studentName: string;
  grade: string;
  sectionId: string;
  sectionName: string;
  examType: string;
  subjectMarks: SubjectMark[];
  term1Marks?: SubjectMark[];
  term2Marks?: SubjectMark[];
  total: number;
  outOf: number;
  percentage: number;
  gradeLetter: string;
  status: ReportCardStatus;
  generatedBy: string;
  generatedAt: string;
  classTeacherSign?: DigitalSignature;
  hodSign?: DigitalSignature;
  adminSign?: DigitalSignature;
  hodApprovedAt?: string;
  adminApprovedAt?: string;
  releasedAt?: string;
  rollNo?: string;
  admissionNo?: string;
  fatherName?: string;
  motherName?: string;
  dob?: string;
  address?: string;
  place?: string;
  reportDate?: string;
  academicSession?: string;
  attendance1?: string;
  attendance2?: string;
  coActivities1?: CoActivitiesGrades;
  coActivities2?: CoActivitiesGrades;
  coScholastic1?: CoScholasticGrades;
  coScholastic2?: CoScholasticGrades;
  discipline1?: string;
  discipline2?: string;
  classTeacherRemarks?: string;
  promotedTo?: string;
}

export interface SignatureRecord {
  id: string;
  role: "class_teacher" | "hod" | "principal";
  name: string;
  imageUrl: string;
  updatedAt: string;
}

export type AssignmentActivityKind = "assignment" | "activity";

export interface AssignmentActivity {
  id: string;
  kind: AssignmentActivityKind;
  sectionId: string;
  grade?: string;
  title: string;
  description?: string;
  dueDate: string; // YYYY-MM-DD
  images?: { name: string; dataUrl: string }[];
  createdAt: string;
  createdBy: string; // teacher document id (or other role id)
  createdByName?: string;
  whatsappStatus?: "pending" | "sent" | "failed";
  whatsappError?: string;
}

export interface HodNotice {
  id: string;
  type: "exam_schedule" | "general";
  grade: string;
  hodId: string;
  title?: string;
  message: string;
  images?: { name: string; dataUrl: string }[];
  createdAt: string;
}

export type Role = "admin" | "hod" | "teacher" | "student" | "accountant" | "printing" | "operations";

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
  studentUid?: string;
  linkedStudentUids?: string[];
  staffDocId?: string;
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
  authUid?: string;
  studentUid?: string;
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

export type AcademicSessionStatus = "active" | "archived" | "planned";

export interface AcademicSession {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: AcademicSessionStatus;
  isCurrent?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export type EnrollmentStatus = "active" | "promoted" | "repeating" | "graduated" | "transferred" | "detained";

export interface Enrollment {
  id: string;
  studentId: string;
  studentUid?: string;
  sessionId?: string;
  academicYear: string;
  className: string;
  sectionName: string | null;
  sectionId: string | null;
  rollNo?: string;
  hodId?: string;
  status: EnrollmentStatus;
  createdAt: string;
  updatedAt?: string;
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

export type NoticeTargetAudience = "all" | "teachers" | "students" | "hods";
export type NoticePriority = "normal" | "important" | "urgent";

export interface Notice {
  id: string;
  type: "general" | "exam_schedule" | "announcement";
  title?: string;
  message: string;
  grade?: string; // specific grade or "all"
  targetAudience?: NoticeTargetAudience;
  priority?: NoticePriority;
  authorId?: string;
  authorName?: string;
  authorRole?: Role;
  hodId?: string; // backwards compatibility with HodNotice
  images?: { name: string; dataUrl: string }[];
  createdAt: string;
  academicSession?: string;
}

export type HodNotice = Notice;

export type ExamScheduleStatus = "draft" | "pending_approval" | "approved" | "rejected";

export interface ExamSubjectEntry {
  subjectId: string;
  subjectName: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // e.g. "09:30"
  endTime?: string; // e.g. "12:30"
  maxMarks?: number; // e.g. 100 or 50
  passingMarks?: number; // e.g. 35
  venue?: string;
}

export interface ExamSchedule {
  id: string;
  sessionId: string;
  academicYear: string;
  examType: string; // e.g. "Unit Test 1", "Term 1", "Mid Term", "Final Exam"
  termId?: string; // e.g. "term_1" | "term_2"
  termName?: string; // e.g. "Term 1" | "Term 2"
  definedExamId?: string;
  structureId?: string;
  structureVersion?: number;
  grade: string;
  hodId: string;
  hodName?: string;
  exams: ExamSubjectEntry[];
  status: ExamScheduleStatus;
  submittedAt?: string;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewRemarks?: string;
  createdAt: string;
  updatedAt?: string;
}

export type ResultReleaseKey = "term1" | "final_exam" | "report_card";

export interface ResultRelease {
  id: string;
  sectionId: string;
  academicYear: string;
  key: ResultReleaseKey;
  releasedAt: string;
  releasedBy: string; // user uid (users/{uid})
  releasedByName?: string;
}

export type ProfileChangeRequestStatus = "pending" | "reviewed" | "approved" | "rejected";

export interface ProfileChangeRequest {
  id: string;
  userId: string;
  role: Role;
  createdAt: string;
  status: ProfileChangeRequestStatus;
  currentData: Record<string, unknown>;
  requestedData: Record<string, unknown>;
  note?: string;
}

// ==========================================
// 1. PRINTING DEPARTMENT MODULE TYPES
// ==========================================
export type PrintOrderStatus = "pending" | "accepted" | "printing" | "completed" | "rejected" | "cancelled";
export type PrintPriority = "normal" | "high" | "urgent";
export type PrintColorMode = "bw" | "color";
export type PrintSides = "single" | "double";
export type PrintPaperSize = "A4" | "A3" | "Legal" | "Letter";
export type PrintBinding = "none" | "stapled" | "spiral" | "laminated" | "booklet";
export type PrintDocumentType = "question_paper" | "worksheet" | "syllabus" | "circular" | "administrative" | "other";

export interface PrintOrder {
  id: string;
  orderNo: string;
  title: string;
  documentType: PrintDocumentType;
  requesterId: string;
  requesterName: string;
  requesterRole: Role;
  department?: string;
  grade?: string;
  section?: string;
  copies: number;
  pageCount: number;
  paperSize: PrintPaperSize;
  colorMode: PrintColorMode;
  sides: PrintSides;
  binding: PrintBinding;
  priority: PrintPriority;
  requiredDate: string; // YYYY-MM-DD
  instructions?: string;
  fileUrl?: string;
  fileName?: string;
  fileStoragePath?: string;
  fileSize?: number;
  status: PrintOrderStatus;
  rejectionReason?: string;
  printedAt?: string;
  printedBy?: string;
  printedByName?: string;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// 2. LIBRARY MANAGEMENT MODULE TYPES
// ==========================================
export type LibraryBookCategory =
  | "fiction"
  | "science"
  | "mathematics"
  | "social_studies"
  | "reference"
  | "languages"
  | "general"
  | "other";

export interface LibraryBook {
  id: string;
  title: string;
  isbn?: string;
  author: string;
  publisher?: string;
  edition?: string;
  category: LibraryBookCategory;
  subject?: string;
  grade?: string;
  language?: string;
  shelfLocation?: string;
  description?: string;
  coverImageUrl?: string;
  totalCopies: number;
  availableCopies: number;
  createdAt: string;
  updatedAt: string;
}

export type LibraryCopyStatus = "available" | "issued" | "reserved" | "lost" | "damaged" | "under_repair" | "archived";
export type LibraryCopyCondition = "new" | "good" | "fair" | "damaged";

export interface LibraryCopy {
  id: string;
  bookId: string;
  bookTitle: string;
  accessionNumber: string; // Unique accession number / barcode code
  barcode?: string;
  condition: LibraryCopyCondition;
  status: LibraryCopyStatus;
  shelfLocation?: string;
  acquisitionDate?: string;
  price?: number;
  currentIssueId?: string;
  currentBorrowerName?: string;
  currentBorrowerType?: "student" | "staff";
  currentBorrowerId?: string;
  createdAt: string;
  updatedAt: string;
}

export type LibraryMemberType = "student" | "staff";
export type LibraryTransactionStatus = "issued" | "returned" | "overdue" | "lost";
export type LibraryFinePaidStatus = "none" | "unpaid" | "paid" | "waived";

export interface LibraryTransaction {
  id: string;
  copyId: string;
  bookId: string;
  bookTitle: string;
  accessionNumber: string;
  memberId: string; // Existing student UID or teacher/user UID
  memberType: LibraryMemberType;
  memberName: string;
  memberIdentifier: string; // Roll No, Admission No, or Staff Email
  memberGrade?: string;
  memberSection?: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD
  status: LibraryTransactionStatus;
  renewalCount: number;
  fineAmount: number;
  finePaidStatus: LibraryFinePaidStatus;
  fineWaivedReason?: string;
  conditionOnReturn?: LibraryCopyCondition;
  issuedBy: string;
  issuedByName?: string;
  returnedTo?: string;
  returnedToName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryFineRule {
  id?: string;
  finePerDay: number;
  gracePeriodDays: number;
  maxFineCap: number;
  lostBookMultiplier: number;
  standardDurationDaysStudent: number;
  standardDurationDaysStaff: number;
  maxBorrowLimitStudent: number;
  maxBorrowLimitStaff: number;
  updatedAt?: string;
}

// ==========================================
// 3. INVENTORY MANAGEMENT MODULE TYPES
// ==========================================
export type InventoryCategory =
  | "stationery"
  | "paper"
  | "consumables"
  | "uniforms"
  | "textbooks"
  | "sports"
  | "lab"
  | "other";

export type StockMovementType =
  | "in"
  | "purchase"
  | "issue"
  | "return"
  | "adjustment"
  | "damage"
  | "loss"
  | "correction";

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  unit: string; // pcs, reams, boxes, sets, etc.
  currentQuantity: number;
  minStock: number; // Low stock alert threshold
  unitCost?: number;
  location?: string; // Room / Rack / Cupboard
  supplierInfo?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  itemName: string;
  category: InventoryCategory;
  movementType: StockMovementType;
  quantity: number; // Positive quantity moved
  previousQuantity: number;
  newQuantity: number;
  reason: string;
  reference?: string; // PO#, Invoice#, or Issue Requisition #
  recipientName?: string;
  recipientRole?: string;
  performedBy: string;
  performedByName: string;
  timestamp: string;
}

// ==========================================
// 4. UNIFORMS (SIZE MATRIX & STUDENT ISSUANCE)
// ==========================================
export interface UniformItem {
  id: string;
  name: string;
  gender: "boys" | "girls" | "unisex";
  category: "regular" | "sports" | "winter" | "accessories";
  sizes: Record<string, number>; // e.g. { "26": 20, "28": 35, "30": 40 }
  minStockPerSize?: Record<string, number>;
  unitPrice?: number;
  location?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UniformIssue {
  id: string;
  uniformItemId: string;
  uniformName: string;
  size: string;
  quantity: number;
  studentId: string; // Existing Student UID
  studentName: string;
  admissionNo?: string;
  grade: string;
  section?: string;
  academicSession: string;
  issueDate: string; // YYYY-MM-DD
  issuedBy: string;
  issuedByName?: string;
  notes?: string;
  createdAt: string;
}

// ==========================================
// 5. BOOK DISTRIBUTION (TEXTBOOKS)
// ==========================================
export interface TextbookItem {
  id: string;
  title: string;
  grade: string;
  subject: string;
  publisher?: string;
  academicSession?: string;
  totalStock: number;
  distributedCount: number;
  createdAt: string;
  updatedAt: string;
}

export type BookDistributionReturnStatus = "pending" | "returned" | "lost" | "damaged" | "not_required";

export interface BookDistribution {
  id: string;
  textbookId: string;
  bookTitle: string;
  studentId: string; // Existing Student UID
  studentName: string;
  admissionNo?: string;
  grade: string;
  section?: string;
  quantity: number;
  academicYear: string;
  issueDate: string; // YYYY-MM-DD
  issuedBy: string;
  issuedByName?: string;
  returnRequired: boolean;
  returnStatus: BookDistributionReturnStatus;
  returnedAt?: string;
  notes?: string;
  createdAt: string;
}

// ==========================================
// 6. CENTRAL AUDIT LOGS
// ==========================================
export type AuditActionType =
  | "create"
  | "update"
  | "delete"
  | "status_change"
  | "issue"
  | "return"
  | "renew"
  | "stock_movement"
  | "fine_waiver";

export type AuditEntityType =
  | "printing"
  | "library_book"
  | "library_copy"
  | "library_loan"
  | "inventory_item"
  | "stock_movement"
  | "uniform"
  | "textbook";

export interface AuditLogRecord {
  id: string;
  userId: string;
  userName: string;
  role: Role;
  action: AuditActionType;
  entity: AuditEntityType;
  entityId: string;
  details: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// ==========================================
// 7. EVENTS & SCHOOL CALENDAR
// ==========================================
export type EventPriority = "low" | "normal" | "high" | "urgent";
export type EventStatus = "draft" | "published" | "cancelled" | "archived";
export type EventAudienceType =
  | "entire_school"
  | "students"
  | "teachers"
  | "hods"
  | "admin"
  | "specific_grades"
  | "specific_sections"
  | "specific_roles";

export interface EventRecurrence {
  frequency: "none" | "daily" | "weekly" | "monthly";
  interval?: number;
  daysOfWeek?: number[]; // [0=Sun, 1=Mon, ..., 6=Sat]
  endDate?: string; // YYYY-MM-DD
}

export interface EventAttachment {
  name: string;
  url: string;
  size?: number;
  type?: string;
}

export interface EventType {
  id: string;
  name: string;
  color: string;
  description?: string;
  isDefault?: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolEvent {
  id: string;
  schoolId?: string;
  sessionId: string;
  academicYear: string;
  title: string;
  description: string;
  eventTypeId: string;
  eventTypeName?: string;
  eventTypeColor?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  allDay: boolean;
  location?: string;
  organizer?: string;
  priority: EventPriority;
  status: EventStatus;
  audienceType: EventAudienceType;
  audienceIds: string[]; // Grades e.g. ["1", "9"], section IDs, or roles
  attachments?: EventAttachment[];
  notes?: string;
  recurrence?: EventRecurrence;
  assemblyDetails?: {
    theme?: string;
    conductedBy?: string;
    specialNotes?: string;
  };
  notifyAudience?: boolean;
  notificationSentAt?: string;
  createdBy: {
    uid: string;
    name: string;
    role: string;
  };
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export type UnifiedCalendarItemSource = "event" | "exam_schedule";

export interface UnifiedCalendarItem {
  id: string;
  source: UnifiedCalendarItemSource;
  title: string;
  description?: string;
  typeId?: string;
  typeName: string;
  color: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
  allDay: boolean;
  location?: string;
  organizer?: string;
  priority?: EventPriority;
  status: EventStatus | "approved";
  audienceType?: EventAudienceType;
  audienceIds?: string[];
  notes?: string;
  isRecurringOccurrence?: boolean;
  parentEventId?: string;
  originalEvent?: SchoolEvent;
  originalExamSchedule?: any;
  examDetails?: {
    subjectId: string;
    subjectName: string;
    maxMarks: number;
    passingMarks: number;
    grade: string;
    examType: string;
  };
}

// ==========================================
// 8. HALL TICKETS & FEE-BASED EXAM ELIGIBILITY
// ==========================================
export type HallTicketFeeRequirementType =
  | "installment_percentage"
  | "installment_full"
  | "all_due_cleared"
  | "specific_amount";

export interface HallTicketRule {
  id: string;
  sessionId: string; // e.g. "session-2026-27"
  academicYear: string; // e.g. "2026-27"
  definedExamId: string; // Links to DefinedExam.id in AcademicStructure
  examName: string; // e.g. "Unit Test 1", "Half-Yearly Examination"
  termId?: string; // "term_1" | "term_2"
  termName?: string;
  feeGateEnabled: boolean;
  requirementType: HallTicketFeeRequirementType;
  installmentId?: string; // Specific installment ID from FeeStructure
  installmentLabel?: string; // e.g. "Installment 1"
  minimumPaymentPercentage?: number; // e.g. 50 (for 50%), 100 (for 100%)
  minimumPaymentAmount?: number; // e.g. 15000
  notes?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type HallTicketBypassStatus = "pending" | "approved" | "rejected" | "revoked";

export interface HallTicketBypass {
  id: string;
  studentId: string; // Student document ID
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
  status: HallTicketBypassStatus;
  requestedBy: {
    uid: string;
    name: string;
    role: string;
  };
  requestedAt: string;
  reviewedBy?: {
    uid: string;
    name: string;
    role: string;
  };
  reviewedAt?: string;
  reviewNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type HallTicketStatus = "generated" | "revoked" | "cancelled";

export interface HallTicketSubjectSchedule {
  subjectId: string;
  subjectName: string;
  date: string; // YYYY-MM-DD
  dayName?: string; // e.g. "Monday"
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  venue: string; // Room / Hall
  maxMarks?: number;
  passingMarks?: number;
}

export interface HallTicket {
  id: string;
  ticketNumber: string; // e.g. "HT-2026-09-0012"
  sessionId: string;
  academicYear: string;
  structureId: string;
  structureVersion: number;
  scheduleId: string;
  definedExamId: string;
  examName: string;
  termId: string;
  termName: string;
  studentId: string;
  studentUid?: string;
  studentName: string;
  admissionNo?: string;
  rollNo?: string;
  grade: string;
  sectionId?: string | null;
  sectionName?: string | null;
  studentPhotoUrl?: string;
  dob?: string;
  fatherName?: string;
  motherName?: string;
  schoolDetails: {
    name: string;
    affiliationNo?: string;
    address?: string;
    tagline?: string;
    logoUrl?: string;
  };
  scheduledSubjects: HallTicketSubjectSchedule[];
  instructions: string[];
  status: HallTicketStatus;
  revocationReason?: string;
  eligibilitySnapshot: {
    eligible: boolean;
    reason: string;
    ruleSummary?: string;
    bypassId?: string;
    bypassReason?: string;
    totalFee?: number;
    totalPaid?: number;
    outstanding?: number;
    evaluatedAt: string;
  };
  qrCodeData: string;
  generatedAt: string;
  generatedBy: {
    uid: string;
    name: string;
    role: string;
  };
  updatedAt: string;
}

export interface HallTicketGlobalSettings {
  id: "default";
  feeGateEnabled: boolean; // Master switch: whether Hall Ticket generation evaluates fee rules
  defaultInstructions: string[];
  updatedAt: string;
  updatedBy: string;
}

export interface HallTicketStudentEligibility {
  studentId: string;
  studentUid?: string;
  studentName: string;
  admissionNo?: string;
  rollNo?: string;
  grade: string;
  sectionId?: string | null;
  sectionName?: string | null;
  eligible: boolean;
  status: "eligible" | "blocked" | "bypass_approved";
  reason: string;
  ruleSummary: string;
  feeDetails: {
    totalFee: number;
    totalPaid: number;
    outstanding: number;
    installmentLabel?: string;
    installmentRequiredAmount?: number;
    installmentPaidAmount?: number;
    paidPercentage?: number;
    requiredPercentage?: number;
  };
  bypass?: HallTicketBypass | null;
  existingHallTicket?: HallTicket | null;
}


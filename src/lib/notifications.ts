/**
 * Centralized Notification System — Core Module
 * Prestige International School ERP
 *
 * Implements:
 * 1. Notification Event Types & Data Structures
 * 2. Channel Definitions (Email, WhatsApp, Push)
 * 3. Lifecycle Statuses & Idempotency Key Generation
 * 4. System Default Notification Templates & Supported Variables
 * 5. Template Rendering & Strict Variable Validation
 * 6. User Preferences & School Channel Settings
 * 7. Firestore Operations & Queue Interfaces
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// ============================================================================
// 1. TYPES & ENUMS
// ============================================================================

export type NotificationChannel = "email" | "whatsapp" | "push";

export type NotificationEventType =
  | "school_notice"
  | "fee_reminder"
  | "payment_confirmation"
  | "receipt_available"
  | "exam_schedule"
  | "exam_schedule_change"
  | "report_card_published"
  | "hall_ticket_available"
  | "student_attendance_absent"
  | "student_attendance_late"
  | "employee_attendance_alert"
  | "employee_leave_update";

export type NotificationJobStatus =
  | "QUEUED"
  | "PROCESSING"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "RETRY_SCHEDULED"
  | "CANCELLED"
  | "PERMANENT_FAILURE";

export type ErrorClassification =
  | "TRANSIENT_NETWORK"
  | "RATE_LIMIT"
  | "PROVIDER_UNCONFIGURED"
  | "RECIPIENT_INVALID"
  | "RECIPIENT_OPTED_OUT"
  | "TEMPLATE_INVALID"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_FAILURE"
  | "PERMANENT_FAILURE";

export interface RecipientInfo {
  uid?: string;
  name: string;
  email?: string;
  phone?: string;
  role: "student" | "parent" | "teacher" | "hod" | "staff" | "admin";
  studentId?: string;
  studentName?: string;
  grade?: string;
  sectionId?: string;
  deviceTokens?: string[];
}

export interface NotificationJob {
  id: string;
  schoolId: string;
  eventType: NotificationEventType;
  sourceEventId: string;
  sourceRecordRef?: string;
  recipientId: string;
  recipientType: "student" | "parent" | "teacher" | "hod" | "staff" | "admin";
  recipientDetails: RecipientInfo;
  channel: NotificationChannel;
  templateId: string;
  templateData: Record<string, any>;
  renderedPayload?: {
    subject?: string;
    bodyText?: string;
    bodyHtml?: string;
    fcmData?: Record<string, string>;
  };
  status: NotificationJobStatus;
  idempotencyKey: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  providerMessageId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  errorClassification?: ErrorClassification | null;
  deliveredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationLog {
  id: string;
  jobId: string;
  schoolId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  recipientReference: string;
  actorUid?: string;
  action:
    | "created"
    | "queued"
    | "dispatch_attempted"
    | "provider_accepted"
    | "provider_rejected"
    | "delivered"
    | "retry_scheduled"
    | "cancelled"
    | "manual_retry_requested"
    | "template_modified"
    | "channel_config_changed";
  status: NotificationJobStatus;
  providerMessageId?: string | null;
  attemptNumber?: number;
  details?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  timestamp: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  subject?: string;
  body: string;
  supportedVariables: string[];
  isActive: boolean;
  metaApprovalStatus?: "approved_by_meta" | "pending_meta_review" | "draft" | "erp_internal";
  metaTemplateName?: string;
  metaLanguageCode?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CategoryChannelConfig {
  email: boolean;
  whatsapp: boolean;
  push: boolean;
}

export interface NotificationSettings {
  id: string;
  schoolId: string;
  categories: Record<NotificationEventType, CategoryChannelConfig>;
  feeReminderScheduleDays: number[]; // e.g. [-7, -3, 0, 3, 7]
  maxRetryAttempts: number;
  backoffInitialMinutes: number;
  emailConfig: {
    enabled: boolean;
    senderName: string;
    senderEmail: string;
    configuredOnServer: boolean;
  };
  whatsappConfig: {
    enabled: boolean;
    senderPhoneNumberId: string;
    wabaId: string;
    configuredOnServer: boolean;
  };
  fcmConfig: {
    enabled: boolean;
    configuredOnServer: boolean;
  };
  updatedAt: string;
  updatedBy: string;
}

export interface UserNotificationPreferences {
  userId: string;
  emailOptIn: boolean;
  whatsappOptIn: boolean;
  pushOptIn: boolean;
  categoryPreferences?: Partial<Record<NotificationEventType, { email?: boolean; whatsapp?: boolean; push?: boolean }>>;
  whatsappOptOutTimestamp?: string | null;
  updatedAt: string;
}

export interface DeviceTokenRecord {
  id?: string;
  token: string;
  userId: string;
  role: string;
  platform: "web" | "android" | "ios";
  userAgent?: string;
  valid: boolean;
  lastSeenAt: string;
  createdAt: string;
}

// ============================================================================
// 2. SUPPORTED TEMPLATE VARIABLES & SYSTEM DEFAULTS
// ============================================================================

export const COMMON_SUPPORTED_VARIABLES = [
  "schoolName",
  "recipientName",
  "studentName",
  "grade",
  "section",
  "portalUrl",
];

export const EVENT_SPECIFIC_VARIABLES: Record<NotificationEventType, string[]> = {
  school_notice: ["title", "message", "priority", "authorName", "noticeUrl"],
  fee_reminder: [
    "installmentLabel",
    "amountDue",
    "dueDate",
    "daysOverdue",
    "daysUntilDue",
    "payUrl",
    "totalOutstanding",
  ],
  payment_confirmation: [
    "receiptNo",
    "amountPaid",
    "paymentDate",
    "paymentMode",
    "installmentLabel",
    "receiptUrl",
  ],
  receipt_available: [
    "receiptNo",
    "amountPaid",
    "receiptUrl",
  ],
  exam_schedule: [
    "examName",
    "academicYear",
    "scheduleUrl",
    "startDate",
    "endDate",
  ],
  exam_schedule_change: [
    "examName",
    "subjectName",
    "originalDate",
    "newDate",
    "changeReason",
  ],
  report_card_published: [
    "examName",
    "termName",
    "academicYear",
    "reportCardUrl",
  ],
  hall_ticket_available: [
    "examName",
    "hallTicketNo",
    "hallTicketUrl",
    "rollNo",
  ],
  student_attendance_absent: [
    "date",
    "attendanceStatus",
    "markedBy",
  ],
  student_attendance_late: [
    "date",
    "time",
    "attendanceStatus",
  ],
  employee_attendance_alert: [
    "employeeName",
    "date",
    "alertMessage",
  ],
  employee_leave_update: [
    "employeeName",
    "leaveType",
    "status",
    "dates",
    "reviewedBy",
  ],
};

export function getAllowedVariablesForEvent(eventType: NotificationEventType): string[] {
  const specific = EVENT_SPECIFIC_VARIABLES[eventType] || [];
  return Array.from(new Set([...COMMON_SUPPORTED_VARIABLES, ...specific]));
}

// System Default Templates across Channels
export const SYSTEM_DEFAULT_TEMPLATES: NotificationTemplate[] = [
  // --- SCHOOL NOTICES ---
  {
    id: "tpl_notice_email",
    name: "School Notice (Email)",
    eventType: "school_notice",
    channel: "email",
    subject: "[{schoolName}] Notice: {title}",
    body: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
  <div style="background: #1e293b; color: #fff; padding: 20px 24px;">
    <h2 style="margin: 0; font-size: 18px;">{schoolName}</h2>
    <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">Official School Announcement</p>
  </div>
  <div style="padding: 24px; background: #ffffff;">
    <h3 style="margin: 0 0 12px; color: #0f172a; font-size: 16px;">{title}</h3>
    <p style="margin: 0 0 16px; color: #334155; line-height: 1.6; white-space: pre-wrap;">{message}</p>
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #64748b;">
      <p style="margin: 0;">Issued by: {authorName} &middot; Grade: {grade}</p>
    </div>
  </div>
</div>`,
    supportedVariables: getAllowedVariablesForEvent("school_notice"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_notice_whatsapp",
    name: "School Notice (WhatsApp)",
    eventType: "school_notice",
    channel: "whatsapp",
    body: `📢 *{schoolName} — Official Notice*\n\n*Title:* {title}\n*Audience:* Grade {grade}\n\n{message}\n\n_Issued by: {authorName}_`,
    supportedVariables: getAllowedVariablesForEvent("school_notice"),
    isActive: true,
    metaApprovalStatus: "approved_by_meta",
    metaTemplateName: "school_notice_v1",
    metaLanguageCode: "en",
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_notice_push",
    name: "School Notice (Push)",
    eventType: "school_notice",
    channel: "push",
    body: "New Notice: {title}",
    supportedVariables: getAllowedVariablesForEvent("school_notice"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },

  // --- FEE REMINDERS ---
  {
    id: "tpl_fee_reminder_email",
    name: "Fee Reminder (Email)",
    eventType: "fee_reminder",
    channel: "email",
    subject: "[{schoolName}] Fee Reminder: {installmentLabel} for {studentName}",
    body: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
  <div style="background: #1e293b; color: #fff; padding: 20px 24px;">
    <h2 style="margin: 0; font-size: 18px;">{schoolName}</h2>
    <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">Accounts & Fees Department</p>
  </div>
  <div style="padding: 24px; background: #ffffff;">
    <p style="margin: 0 0 16px; color: #334155;">Dear Parent / Guardian of <strong>{studentName}</strong> (Grade {grade}),</p>
    <p style="margin: 0 0 16px; color: #475569; line-height: 1.6;">
      This is a polite reminder regarding the outstanding fee installment for your ward:
    </p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 4px 0; color: #1e293b;"><strong>Installment:</strong> {installmentLabel}</p>
      <p style="margin: 4px 0; color: #1e293b;"><strong>Amount Due:</strong> ₹{amountDue}</p>
      <p style="margin: 4px 0; color: #dc2626;"><strong>Due Date:</strong> {dueDate}</p>
    </div>
    <p style="margin: 0 0 16px; color: #475569; line-height: 1.6;">
      Please clear this installment on or before the due date to ensure smooth academic processing and hall ticket eligibility.
    </p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="{portalUrl}" style="background: #2563eb; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Pay via Student Portal</a>
    </div>
    <p style="margin: 16px 0 0; font-size: 12px; color: #94a3b8;">
      If you have already paid this amount within the last 24 hours, kindly disregard this notice.
    </p>
  </div>
</div>`,
    supportedVariables: getAllowedVariablesForEvent("fee_reminder"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_fee_reminder_whatsapp",
    name: "Fee Reminder (WhatsApp)",
    eventType: "fee_reminder",
    channel: "whatsapp",
    body: `💳 *{schoolName} — Fee Reminder*\n\nDear Parent, this is a reminder that *{installmentLabel}* of *₹{amountDue}* for *{studentName}* (Grade {grade}) is due on *{dueDate}*.\n\nPlease log in to the School ERP portal to review and clear the dues:\n{portalUrl}`,
    supportedVariables: getAllowedVariablesForEvent("fee_reminder"),
    isActive: true,
    metaApprovalStatus: "approved_by_meta",
    metaTemplateName: "fee_due_reminder_v1",
    metaLanguageCode: "en",
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_fee_reminder_push",
    name: "Fee Reminder (Push)",
    eventType: "fee_reminder",
    channel: "push",
    body: "Fee Reminder: {installmentLabel} is due on {dueDate}. Please check Student Fees portal.",
    supportedVariables: getAllowedVariablesForEvent("fee_reminder"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },

  // --- PAYMENT CONFIRMATION ---
  {
    id: "tpl_payment_confirmation_email",
    name: "Payment Confirmation (Email)",
    eventType: "payment_confirmation",
    channel: "email",
    subject: "[{schoolName}] Payment Received: Receipt {receiptNo}",
    body: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
  <div style="background: #166534; color: #fff; padding: 20px 24px;">
    <h2 style="margin: 0; font-size: 18px;">{schoolName}</h2>
    <p style="margin: 4px 0 0; font-size: 13px; color: #bbf7d0;">Official Payment Confirmation</p>
  </div>
  <div style="padding: 24px; background: #ffffff;">
    <p style="margin: 0 0 16px; color: #334155;">Dear Parent / Guardian of <strong>{studentName}</strong>,</p>
    <p style="margin: 0 0 16px; color: #475569; line-height: 1.6;">
      Thank you for your payment. The transaction has been successfully verified and posted to the official school fee ledger.
    </p>
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 4px 0; color: #166534;"><strong>Receipt Number:</strong> {receiptNo}</p>
      <p style="margin: 4px 0; color: #166534;"><strong>Amount Paid:</strong> ₹{amountPaid}</p>
      <p style="margin: 4px 0; color: #166534;"><strong>Installment:</strong> {installmentLabel}</p>
      <p style="margin: 4px 0; color: #166534;"><strong>Date:</strong> {paymentDate} ({paymentMode})</p>
    </div>
    <p style="margin: 0 0 16px; color: #475569; font-size: 13px;">
      You can download your official fee receipt at any time from the Student Fees section in the ERP.
    </p>
  </div>
</div>`,
    supportedVariables: getAllowedVariablesForEvent("payment_confirmation"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_payment_confirmation_whatsapp",
    name: "Payment Confirmation (WhatsApp)",
    eventType: "payment_confirmation",
    channel: "whatsapp",
    body: `✅ *{schoolName} — Payment Confirmation*\n\nWe have received payment of *₹{amountPaid}* for *{studentName}* ({installmentLabel}).\n\n*Receipt No:* {receiptNo}\n*Date:* {paymentDate}\n\nYour official receipt is available in the ERP Student Portal.`,
    supportedVariables: getAllowedVariablesForEvent("payment_confirmation"),
    isActive: true,
    metaApprovalStatus: "approved_by_meta",
    metaTemplateName: "fee_payment_receipt_v1",
    metaLanguageCode: "en",
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_payment_confirmation_push",
    name: "Payment Confirmation (Push)",
    eventType: "payment_confirmation",
    channel: "push",
    body: "Payment received: ₹{amountPaid} credited for {installmentLabel} (Receipt: {receiptNo}).",
    supportedVariables: getAllowedVariablesForEvent("payment_confirmation"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },

  // --- EXAM SCHEDULE PUBLISHED ---
  {
    id: "tpl_exam_schedule_push",
    name: "Exam Schedule Published (Push)",
    eventType: "exam_schedule",
    channel: "push",
    body: "Exam Timetable Published: {examName} schedule is now available.",
    supportedVariables: getAllowedVariablesForEvent("exam_schedule"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_exam_schedule_whatsapp",
    name: "Exam Schedule Published (WhatsApp)",
    eventType: "exam_schedule",
    channel: "whatsapp",
    body: `📝 *{schoolName} — Exam Schedule Published*\n\nThe timetable for *{examName}* ({academicYear}) has been approved and published.\n\nPlease log in to view the schedule:\n{portalUrl}`,
    supportedVariables: getAllowedVariablesForEvent("exam_schedule"),
    isActive: true,
    metaApprovalStatus: "approved_by_meta",
    metaTemplateName: "exam_schedule_publish_v1",
    metaLanguageCode: "en",
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },

  // --- REPORT CARD PUBLISHED ---
  {
    id: "tpl_report_card_push",
    name: "Report Card Published (Push)",
    eventType: "report_card_published",
    channel: "push",
    body: "Report Card Published: Your academic report card is now available in Prestige ERP.",
    supportedVariables: getAllowedVariablesForEvent("report_card_published"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_report_card_email",
    name: "Report Card Published (Email)",
    eventType: "report_card_published",
    channel: "email",
    subject: "[{schoolName}] Report Card Published for {studentName}",
    body: `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
  <div style="background: #1e293b; color: #fff; padding: 20px 24px;">
    <h2 style="margin: 0; font-size: 18px;">{schoolName}</h2>
    <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">Academic Examination Office</p>
  </div>
  <div style="padding: 24px; background: #ffffff;">
    <p style="margin: 0 0 16px; color: #334155;">Dear Parent / Guardian of <strong>{studentName}</strong> (Grade {grade}),</p>
    <p style="margin: 0 0 16px; color: #475569; line-height: 1.6;">
      The official Report Card for <strong>{examName}</strong> ({academicYear}) has been finalized and published.
    </p>
    <p style="margin: 0 0 20px; color: #475569; line-height: 1.6;">
      To protect student privacy, please sign in to the authorized Student Portal to view and download the official report card.
    </p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="{portalUrl}" style="background: #2563eb; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Open Student Portal</a>
    </div>
  </div>
</div>`,
    supportedVariables: getAllowedVariablesForEvent("report_card_published"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },

  // --- HALL TICKET AVAILABLE ---
  {
    id: "tpl_hall_ticket_push",
    name: "Hall Ticket Available (Push)",
    eventType: "hall_ticket_available",
    channel: "push",
    body: "Hall Ticket Available: Your exam hall ticket for {examName} is now ready for download.",
    supportedVariables: getAllowedVariablesForEvent("hall_ticket_available"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_hall_ticket_whatsapp",
    name: "Hall Ticket Available (WhatsApp)",
    eventType: "hall_ticket_available",
    channel: "whatsapp",
    body: `🎫 *{schoolName} — Hall Ticket Available*\n\nDear Parent, the exam hall ticket for *{studentName}* ({examName}) is now generated and ready for download in the ERP Student Portal:\n{portalUrl}`,
    supportedVariables: getAllowedVariablesForEvent("hall_ticket_available"),
    isActive: true,
    metaApprovalStatus: "approved_by_meta",
    metaTemplateName: "hall_ticket_ready_v1",
    metaLanguageCode: "en",
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },

  // --- STUDENT ATTENDANCE ---
  {
    id: "tpl_student_absent_whatsapp",
    name: "Student Absent Alert (WhatsApp)",
    eventType: "student_attendance_absent",
    channel: "whatsapp",
    body: `⚠️ *{schoolName} — Attendance Notice*\n\nDear Parent, student *{studentName}* (Grade {grade}) has been marked *ABSENT* on *{date}*.\n\nIf this was unexpected, please contact the school office.`,
    supportedVariables: getAllowedVariablesForEvent("student_attendance_absent"),
    isActive: true,
    metaApprovalStatus: "approved_by_meta",
    metaTemplateName: "student_absent_alert_v1",
    metaLanguageCode: "en",
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
  {
    id: "tpl_student_absent_push",
    name: "Student Absent Alert (Push)",
    eventType: "student_attendance_absent",
    channel: "push",
    body: "Attendance Update: {studentName} has been marked absent today ({date}).",
    supportedVariables: getAllowedVariablesForEvent("student_attendance_absent"),
    isActive: true,
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "System",
  },
];

// ============================================================================
// 3. TEMPLATE VALIDATION & RENDERING
// ============================================================================

export function extractTemplateVariables(templateString: string): string[] {
  const matches = templateString.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1, -1))));
}

export function validateTemplateVariables(
  templateBody: string,
  allowedVariables: string[],
  subject?: string
): { valid: boolean; invalidVars: string[] } {
  const combined = `${subject || ""} ${templateBody}`;
  const usedVars = extractTemplateVariables(combined);
  const invalidVars = usedVars.filter((v) => !allowedVariables.includes(v));
  return {
    valid: invalidVars.length === 0,
    invalidVars,
  };
}

export function renderTemplate(
  templateString: string,
  data: Record<string, any>
): string {
  return templateString.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (key in data && data[key] !== undefined && data[key] !== null) {
      return String(data[key]);
    }
    return match; // Leave untouched if not supplied
  });
}

// Sample Data Generator for Template Live Previews
export function getSampleTemplateData(eventType: NotificationEventType): Record<string, string> {
  const base: Record<string, string> = {
    schoolName: "Prestige International School",
    recipientName: "Mrs. Sharma",
    studentName: "Aarav Sharma",
    grade: "10",
    section: "A",
    portalUrl: "https://prestige-erp.web.app",
    authorName: "School Administration",
  };

  switch (eventType) {
    case "school_notice":
      return {
        ...base,
        title: "Annual Sports Meet 2026-27",
        message: "The Annual Sports Meet will be held on 15th November at the Main Ground. Attendance is mandatory for all students.",
        priority: "high",
      };
    case "fee_reminder":
      return {
        ...base,
        installmentLabel: "Term 2 Tuition Fee",
        amountDue: "14,500",
        dueDate: "30-Oct-2026",
        daysOverdue: "0",
        daysUntilDue: "10",
        totalOutstanding: "14,500",
      };
    case "payment_confirmation":
      return {
        ...base,
        receiptNo: "RC-ONL-2026-004821",
        amountPaid: "14,500",
        installmentLabel: "Term 2 Tuition Fee",
        paymentDate: "20-Oct-2026",
        paymentMode: "Online (Razorpay)",
      };
    case "exam_schedule":
    case "exam_schedule_change":
      return {
        ...base,
        examName: "Half Yearly Examination",
        academicYear: "2026-27",
        startDate: "05-Nov-2026",
        endDate: "18-Nov-2026",
        subjectName: "Mathematics",
        originalDate: "08-Nov-2026",
        newDate: "10-Nov-2026",
        changeReason: "Administrative revision",
      };
    case "report_card_published":
      return {
        ...base,
        examName: "Half Yearly Examination",
        termName: "Term 1",
        academicYear: "2026-27",
      };
    case "hall_ticket_available":
      return {
        ...base,
        examName: "Half Yearly Examination",
        hallTicketNo: "HT-10A-042",
        rollNo: "10142",
      };
    case "student_attendance_absent":
    case "student_attendance_late":
      return {
        ...base,
        date: "20-Oct-2026",
        time: "08:45 AM",
        attendanceStatus: "Absent",
        markedBy: "Class Teacher",
      };
    default:
      return base;
  }
}

// ============================================================================
// 4. IDEMPOTENCY KEY GENERATION
// ============================================================================

export function generateIdempotencyKey(
  eventType: NotificationEventType,
  sourceEventId: string,
  recipientId: string,
  channel: NotificationChannel,
  stage?: string
): string {
  const parts = [eventType, sourceEventId, recipientId, channel];
  if (stage) parts.push(stage);
  return parts.join("_").replace(/[^a-zA-Z0-9_]/g, "_");
}

// ============================================================================
// 5. FIRESTORE DATABASE REPOSITORIES
// ============================================================================

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  id: "global",
  schoolId: "default",
  categories: {
    school_notice: { email: true, whatsapp: true, push: true },
    fee_reminder: { email: true, whatsapp: true, push: true },
    payment_confirmation: { email: true, whatsapp: true, push: true },
    receipt_available: { email: true, whatsapp: true, push: true },
    exam_schedule: { email: true, whatsapp: true, push: true },
    exam_schedule_change: { email: true, whatsapp: true, push: true },
    report_card_published: { email: true, whatsapp: true, push: true },
    hall_ticket_available: { email: true, whatsapp: true, push: true },
    student_attendance_absent: { email: true, whatsapp: true, push: true },
    student_attendance_late: { email: false, whatsapp: true, push: true },
    employee_attendance_alert: { email: true, whatsapp: false, push: true },
    employee_leave_update: { email: true, whatsapp: true, push: true },
  },
  feeReminderScheduleDays: [-7, -3, 0, 3, 7],
  maxRetryAttempts: 3,
  backoffInitialMinutes: 5,
  emailConfig: {
    enabled: true,
    senderName: "Prestige International School",
    senderEmail: "notifications@prestige-school.edu",
    configuredOnServer: true,
  },
  whatsappConfig: {
    enabled: false,
    senderPhoneNumberId: "",
    wabaId: "",
    configuredOnServer: false,
  },
  fcmConfig: {
    enabled: true,
    configuredOnServer: true,
  },
  updatedAt: new Date().toISOString(),
  updatedBy: "system",
};

export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const snap = await getDoc(doc(db, "notificationSettings", "global"));
    if (snap.exists()) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...(snap.data() as NotificationSettings) };
    }
  } catch (err) {
    console.warn("Could not fetch notificationSettings, using defaults:", err);
  }
  return DEFAULT_NOTIFICATION_SETTINGS;
}

export async function saveNotificationSettings(
  settings: Partial<NotificationSettings>,
  actorUid: string
): Promise<void> {
  const current = await getNotificationSettings();
  const updated: NotificationSettings = {
    ...current,
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy: actorUid,
  };
  await setDoc(doc(db, "notificationSettings", "global"), updated, { merge: true });
}

export async function getNotificationTemplates(): Promise<NotificationTemplate[]> {
  try {
    const snap = await getDocs(collection(db, "notificationTemplates"));
    if (!snap.empty) {
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    }
  } catch (err) {
    console.warn("Could not fetch templates from Firestore, returning defaults:", err);
  }
  return SYSTEM_DEFAULT_TEMPLATES;
}

export async function saveNotificationTemplate(
  template: NotificationTemplate,
  actorUid: string
): Promise<void> {
  const allowed = getAllowedVariablesForEvent(template.eventType);
  const validation = validateTemplateVariables(template.body, allowed, template.subject);
  if (!validation.valid) {
    throw new Error(`Template contains unsupported variables: ${validation.invalidVars.join(", ")}`);
  }

  const payload = {
    ...template,
    updatedAt: new Date().toISOString(),
    updatedBy: actorUid,
  };
  await setDoc(doc(db, "notificationTemplates", template.id), payload, { merge: true });
}

export async function deleteNotificationTemplate(templateId: string): Promise<void> {
  await deleteDoc(doc(db, "notificationTemplates", templateId));
}

export async function getNotificationJobs(filters?: {
  status?: string;
  channel?: string;
  eventType?: string;
  limitCount?: number;
}): Promise<NotificationJob[]> {
  try {
    let q = query(collection(db, "notificationJobs"), orderBy("createdAt", "desc"), limit(filters?.limitCount || 100));
    const snap = await getDocs(q);
    let jobs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as NotificationJob[];

    if (filters?.status && filters.status !== "all") {
      jobs = jobs.filter((j) => j.status === filters.status);
    }
    if (filters?.channel && filters.channel !== "all") {
      jobs = jobs.filter((j) => j.channel === filters.channel);
    }
    if (filters?.eventType && filters.eventType !== "all") {
      jobs = jobs.filter((j) => j.eventType === filters.eventType);
    }
    return jobs;
  } catch (err) {
    console.warn("Could not fetch notificationJobs:", err);
    return [];
  }
}

export async function getNotificationLogs(limitCount = 100): Promise<NotificationLog[]> {
  try {
    const q = query(collection(db, "notificationLogs"), orderBy("timestamp", "desc"), limit(limitCount));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as NotificationLog[];
  } catch (err) {
    console.warn("Could not fetch notificationLogs:", err);
    return [];
  }
}

export async function getUserPreferences(userId: string): Promise<UserNotificationPreferences> {
  try {
    const snap = await getDoc(doc(db, "notificationPreferences", userId));
    if (snap.exists()) {
      return snap.data() as UserNotificationPreferences;
    }
  } catch {
    // fallback
  }
  return {
    userId,
    emailOptIn: true,
    whatsappOptIn: true,
    pushOptIn: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveUserPreferences(
  prefs: Partial<UserNotificationPreferences> & { userId: string }
): Promise<void> {
  const current = await getUserPreferences(prefs.userId);
  const updated: UserNotificationPreferences = {
    ...current,
    ...prefs,
    updatedAt: new Date().toISOString(),
  };
  await setDoc(doc(db, "notificationPreferences", prefs.userId), updated, { merge: true });
}

/**
 * Backend Notification Templates & Variable Validation
 * Prestige International School ERP
 */

const { EVENT_TYPES, CHANNELS } = require("./types");

const COMMON_SUPPORTED_VARIABLES = [
  "schoolName",
  "recipientName",
  "studentName",
  "grade",
  "section",
  "portalUrl",
];

const EVENT_SPECIFIC_VARIABLES = {
  [EVENT_TYPES.SCHOOL_NOTICE]: ["title", "message", "priority", "authorName", "noticeUrl"],
  [EVENT_TYPES.FEE_REMINDER]: [
    "installmentLabel",
    "amountDue",
    "dueDate",
    "daysOverdue",
    "daysUntilDue",
    "payUrl",
    "totalOutstanding",
  ],
  [EVENT_TYPES.PAYMENT_CONFIRMATION]: [
    "receiptNo",
    "amountPaid",
    "paymentDate",
    "paymentMode",
    "installmentLabel",
    "receiptUrl",
  ],
  [EVENT_TYPES.RECEIPT_AVAILABLE]: [
    "receiptNo",
    "amountPaid",
    "receiptUrl",
  ],
  [EVENT_TYPES.EXAM_SCHEDULE]: [
    "examName",
    "academicYear",
    "scheduleUrl",
    "startDate",
    "endDate",
  ],
  [EVENT_TYPES.EXAM_SCHEDULE_CHANGE]: [
    "examName",
    "subjectName",
    "originalDate",
    "newDate",
    "changeReason",
  ],
  [EVENT_TYPES.REPORT_CARD_PUBLISHED]: [
    "examName",
    "termName",
    "academicYear",
    "reportCardUrl",
  ],
  [EVENT_TYPES.HALL_TICKET_AVAILABLE]: [
    "examName",
    "hallTicketNo",
    "hallTicketUrl",
    "rollNo",
  ],
  [EVENT_TYPES.STUDENT_ATTENDANCE_ABSENT]: [
    "date",
    "attendanceStatus",
    "markedBy",
  ],
  [EVENT_TYPES.STUDENT_ATTENDANCE_LATE]: [
    "date",
    "time",
    "attendanceStatus",
  ],
  [EVENT_TYPES.EMPLOYEE_ATTENDANCE_ALERT]: [
    "employeeName",
    "date",
    "alertMessage",
  ],
  [EVENT_TYPES.EMPLOYEE_LEAVE_UPDATE]: [
    "employeeName",
    "leaveType",
    "status",
    "dates",
    "reviewedBy",
  ],
};

function getAllowedVariablesForEvent(eventType) {
  const specific = EVENT_SPECIFIC_VARIABLES[eventType] || [];
  return Array.from(new Set([...COMMON_SUPPORTED_VARIABLES, ...specific]));
}

function extractTemplateVariables(templateString) {
  const matches = (templateString || "").match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1, -1))));
}

function validateTemplateVariables(templateBody, allowedVariables, subject = "") {
  const combined = `${subject} ${templateBody}`;
  const usedVars = extractTemplateVariables(combined);
  const invalidVars = usedVars.filter((v) => !allowedVariables.includes(v));
  return {
    valid: invalidVars.length === 0,
    invalidVars,
  };
}

function renderTemplate(templateString, data = {}) {
  return (templateString || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (key in data && data[key] !== undefined && data[key] !== null) {
      return String(data[key]);
    }
    return match;
  });
}

// Fallback message bodies if template is not found in DB
const DEFAULT_TEXT_TEMPLATES = {
  [EVENT_TYPES.SCHOOL_NOTICE]: {
    subject: "[{schoolName}] Notice: {title}",
    body: "Prestige International School — Notice\n\nTitle: {title}\nGrade: {grade}\n\n{message}\n\nIssued by: {authorName}",
  },
  [EVENT_TYPES.FEE_REMINDER]: {
    subject: "[{schoolName}] Fee Reminder: {installmentLabel} for {studentName}",
    body: "Prestige International School — Fee Reminder\n\nDear Parent, {installmentLabel} of ₹{amountDue} for {studentName} (Grade {grade}) is due on {dueDate}.\nPlease clear the dues via the ERP portal.",
  },
  [EVENT_TYPES.PAYMENT_CONFIRMATION]: {
    subject: "[{schoolName}] Payment Received: Receipt {receiptNo}",
    body: "Prestige International School — Payment Confirmation\n\nPayment of ₹{amountPaid} for {studentName} ({installmentLabel}) has been verified.\nReceipt No: {receiptNo}\nDate: {paymentDate}",
  },
  [EVENT_TYPES.EXAM_SCHEDULE]: {
    subject: "[{schoolName}] Exam Timetable Published: {examName}",
    body: "Prestige International School — Exam Timetable\n\nThe schedule for {examName} ({academicYear}) has been approved and published. Please log in to view the dates.",
  },
  [EVENT_TYPES.REPORT_CARD_PUBLISHED]: {
    subject: "[{schoolName}] Report Card Published for {studentName}",
    body: "Prestige International School — Report Card\n\nThe report card for {examName} ({academicYear}) has been published. Log in to the Student Portal to review your marks.",
  },
  [EVENT_TYPES.HALL_TICKET_AVAILABLE]: {
    subject: "[{schoolName}] Exam Hall Ticket Ready: {examName}",
    body: "Prestige International School — Hall Ticket\n\nThe hall ticket for {studentName} ({examName}) is now generated and ready for download.",
  },
  [EVENT_TYPES.STUDENT_ATTENDANCE_ABSENT]: {
    subject: "[{schoolName}] Attendance Alert: {studentName} marked Absent",
    body: "Prestige International School — Attendance Alert\n\nStudent {studentName} (Grade {grade}) has been marked ABSENT on {date}.",
  },
};

module.exports = {
  getAllowedVariablesForEvent,
  extractTemplateVariables,
  validateTemplateVariables,
  renderTemplate,
  DEFAULT_TEXT_TEMPLATES,
};

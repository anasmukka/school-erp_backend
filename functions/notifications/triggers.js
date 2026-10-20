/**
 * ERP Event Listeners & Notification Producers
 * Prestige International School ERP
 *
 * Hooks into authoritative success paths:
 * 1. notices (Official notices & circulars)
 * 2. feePayments (Verified payments)
 * 3. publishedReportCards (Report card publication)
 * 4. examSchedules (Exam timetable approvals)
 * 5. hallTickets (Hall ticket generation)
 * 6. attendance (Student absenteeism & tardiness)
 */

const { EVENT_TYPES, CHANNELS } = require("./types");
const { resolveNoticeRecipients, resolveParentForStudent } = require("./resolver");
const { enqueueNotificationJob, processNotificationJob } = require("./queue");

/**
 * Handles newly published notices in `notices` collection.
 */
async function handleNoticePublished(db, noticeId, noticeData) {
  if (!noticeData || !noticeData.title) return;

  const recipients = await resolveNoticeRecipients(db, noticeData);
  const portalUrl = "https://prestige-erp.web.app/student/notices";

  for (const r of recipients) {
    const templateData = {
      schoolName: "Prestige International School",
      recipientName: r.name,
      studentName: r.studentName || r.name,
      grade: r.grade || noticeData.grade || "All",
      section: r.section || "",
      title: noticeData.title,
      message: noticeData.message,
      priority: noticeData.priority || "normal",
      authorName: noticeData.authorName || "School Administration",
      portalUrl,
    };

    const channels = [CHANNELS.EMAIL, CHANNELS.WHATSAPP, CHANNELS.PUSH];
    for (const channel of channels) {
      const idempotencyKey = `notif_notice_${noticeId}_${r.recipientId}_${channel}`.replace(/[^a-zA-Z0-9_]/g, "_");

      const res = await enqueueNotificationJob(db, {
        schoolId: "default",
        eventType: EVENT_TYPES.SCHOOL_NOTICE,
        sourceEventId: noticeId,
        sourceRecordRef: `notices/${noticeId}`,
        recipientId: r.recipientId,
        recipientType: r.recipientType,
        recipientDetails: r,
        channel,
        templateId: `tpl_notice_${channel}`,
        templateData,
        idempotencyKey,
      });

      if (!res.isDuplicate) {
        processNotificationJob(db, res.jobId).catch((err) => {
          console.warn(`Error processing notice job ${res.jobId}:`, err);
        });
      }
    }
  }
}

/**
 * Handles verified fee payment records in `feePayments` collection.
 */
async function handleFeePaymentVerified(db, paymentId, paymentData) {
  if (!paymentData || paymentData.verificationStatus !== "verified") return;

  const studentId = paymentData.studentId;
  if (!studentId) return;

  const parentRecipient = await resolveParentForStudent(db, studentId);
  if (!parentRecipient) return;

  const templateData = {
    schoolName: "Prestige International School",
    recipientName: parentRecipient.name,
    studentName: paymentData.studentName || parentRecipient.studentName || "Student",
    grade: paymentData.grade || parentRecipient.grade || "",
    receiptNo: paymentData.receiptNo || `RC-${paymentId.slice(-6)}`,
    amountPaid: Number(paymentData.amount || 0).toLocaleString("en-IN"),
    installmentLabel: paymentData.installmentLabel || "Tuition Fee",
    paymentDate: paymentData.paidAt || new Date().toISOString().slice(0, 10),
    paymentMode: paymentData.paymentMode || "Online",
    portalUrl: "https://prestige-erp.web.app/student/fees",
  };

  const channels = [CHANNELS.EMAIL, CHANNELS.WHATSAPP, CHANNELS.PUSH];
  for (const channel of channels) {
    const idempotencyKey = `notif_pay_${paymentId}_${parentRecipient.recipientId}_${channel}`.replace(/[^a-zA-Z0-9_]/g, "_");

    const res = await enqueueNotificationJob(db, {
      schoolId: "default",
      eventType: EVENT_TYPES.PAYMENT_CONFIRMATION,
      sourceEventId: paymentId,
      sourceRecordRef: `feePayments/${paymentId}`,
      recipientId: parentRecipient.recipientId,
      recipientType: "parent",
      recipientDetails: parentRecipient,
      channel,
      templateId: `tpl_payment_confirmation_${channel}`,
      templateData,
      idempotencyKey,
    });

    if (!res.isDuplicate) {
      processNotificationJob(db, res.jobId).catch((err) => {
        console.warn(`Error processing payment notification job ${res.jobId}:`, err);
      });
    }
  }
}

/**
 * Handles published report card snapshots in `publishedReportCards`.
 */
async function handleReportCardPublished(db, cardId, cardData) {
  if (!cardData) return;

  const studentId = cardData.studentId || cardData.studentUid;
  if (!studentId) return;

  const parentRecipient = await resolveParentForStudent(db, studentId);
  if (!parentRecipient) return;

  const templateData = {
    schoolName: "Prestige International School",
    recipientName: parentRecipient.name,
    studentName: cardData.studentName || parentRecipient.studentName || "Student",
    grade: cardData.grade || parentRecipient.grade || "",
    examName: cardData.reportPeriod || cardData.termName || "Academic Term",
    academicYear: cardData.academicYear || "2026-27",
    portalUrl: "https://prestige-erp.web.app/student/report-card",
  };

  const channels = [CHANNELS.EMAIL, CHANNELS.PUSH];
  for (const channel of channels) {
    const idempotencyKey = `notif_rc_${cardId}_${parentRecipient.recipientId}_${channel}`.replace(/[^a-zA-Z0-9_]/g, "_");

    const res = await enqueueNotificationJob(db, {
      schoolId: "default",
      eventType: EVENT_TYPES.REPORT_CARD_PUBLISHED,
      sourceEventId: cardId,
      sourceRecordRef: `publishedReportCards/${cardId}`,
      recipientId: parentRecipient.recipientId,
      recipientType: "parent",
      recipientDetails: parentRecipient,
      channel,
      templateId: `tpl_report_card_${channel}`,
      templateData,
      idempotencyKey,
    });

    if (!res.isDuplicate) {
      processNotificationJob(db, res.jobId).catch((err) => {
        console.warn(`Error processing report card job ${res.jobId}:`, err);
      });
    }
  }
}

/**
 * Handles exam schedule approval in `examSchedules`.
 */
async function handleExamScheduleApproved(db, scheduleId, scheduleData) {
  if (!scheduleData || scheduleData.status !== "approved") return;

  const targetGrade = scheduleData.grade;
  let q = db.collection("students");
  if (targetGrade && targetGrade !== "all") {
    q = q.where("grade", "==", targetGrade);
  }

  const studentSnap = await q.get();
  for (const stuDoc of studentSnap.docs) {
    const s = stuDoc.data();
    const parentRecipient = await resolveParentForStudent(db, stuDoc.id);
    if (!parentRecipient) continue;

    const templateData = {
      schoolName: "Prestige International School",
      recipientName: parentRecipient.name,
      studentName: s.studentName || "Student",
      grade: s.grade || targetGrade || "",
      examName: scheduleData.examType || "Examination",
      academicYear: scheduleData.academicYear || "2026-27",
      portalUrl: "https://prestige-erp.web.app/student/exams",
    };

    const channels = [CHANNELS.WHATSAPP, CHANNELS.PUSH];
    for (const channel of channels) {
      const idempotencyKey = `notif_exam_${scheduleId}_${parentRecipient.recipientId}_${channel}`.replace(/[^a-zA-Z0-9_]/g, "_");

      const res = await enqueueNotificationJob(db, {
        schoolId: "default",
        eventType: EVENT_TYPES.EXAM_SCHEDULE,
        sourceEventId: scheduleId,
        sourceRecordRef: `examSchedules/${scheduleId}`,
        recipientId: parentRecipient.recipientId,
        recipientType: "parent",
        recipientDetails: parentRecipient,
        channel,
        templateId: `tpl_exam_schedule_${channel}`,
        templateData,
        idempotencyKey,
      });

      if (!res.isDuplicate) {
        processNotificationJob(db, res.jobId).catch((err) => {
          console.warn(`Error processing exam schedule job ${res.jobId}:`, err);
        });
      }
    }
  }
}

/**
 * Handles newly generated hall ticket in `hallTickets`.
 */
async function handleHallTicketCreated(db, ticketId, ticketData) {
  if (!ticketData) return;

  const studentId = ticketData.studentId;
  if (!studentId) return;

  const parentRecipient = await resolveParentForStudent(db, studentId);
  if (!parentRecipient) return;

  const templateData = {
    schoolName: "Prestige International School",
    recipientName: parentRecipient.name,
    studentName: ticketData.studentName || parentRecipient.studentName || "Student",
    grade: ticketData.grade || parentRecipient.grade || "",
    examName: ticketData.examName || "Examination",
    hallTicketNo: ticketData.hallTicketNumber || ticketId,
    rollNo: ticketData.rollNo || "",
    portalUrl: "https://prestige-erp.web.app/student/hall-tickets",
  };

  const channels = [CHANNELS.WHATSAPP, CHANNELS.PUSH];
  for (const channel of channels) {
    const idempotencyKey = `notif_ht_${ticketId}_${parentRecipient.recipientId}_${channel}`.replace(/[^a-zA-Z0-9_]/g, "_");

    const res = await enqueueNotificationJob(db, {
      schoolId: "default",
      eventType: EVENT_TYPES.HALL_TICKET_AVAILABLE,
      sourceEventId: ticketId,
      sourceRecordRef: `hallTickets/${ticketId}`,
      recipientId: parentRecipient.recipientId,
      recipientType: "parent",
      recipientDetails: parentRecipient,
      channel,
      templateId: `tpl_hall_ticket_${channel}`,
      templateData,
      idempotencyKey,
    });

    if (!res.isDuplicate) {
      processNotificationJob(db, res.jobId).catch((err) => {
        console.warn(`Error processing hall ticket job ${res.jobId}:`, err);
      });
    }
  }
}

/**
 * Handles attendance doc creation/update in `attendance`.
 */
async function handleAttendanceRecorded(db, attId, attData) {
  if (!attData) return;
  const status = String(attData.status || "").toLowerCase();
  if (status !== "absent" && status !== "late") return;

  const studentId = attData.studentId;
  if (!studentId) return;

  const parentRecipient = await resolveParentForStudent(db, studentId);
  if (!parentRecipient) return;

  const eventType = status === "absent" ? EVENT_TYPES.STUDENT_ATTENDANCE_ABSENT : EVENT_TYPES.STUDENT_ATTENDANCE_LATE;

  const templateData = {
    schoolName: "Prestige International School",
    recipientName: parentRecipient.name,
    studentName: attData.studentName || parentRecipient.studentName || "Student",
    grade: attData.grade || parentRecipient.grade || "",
    date: attData.date || new Date().toISOString().slice(0, 10),
    time: attData.time || "Morning Assembly",
    attendanceStatus: status === "absent" ? "Absent" : "Late",
    portalUrl: "https://prestige-erp.web.app/student/attendance-overview",
  };

  const channels = [CHANNELS.WHATSAPP, CHANNELS.PUSH];
  for (const channel of channels) {
    const idempotencyKey = `notif_att_${attId}_${status}_${parentRecipient.recipientId}_${channel}`.replace(/[^a-zA-Z0-9_]/g, "_");

    const res = await enqueueNotificationJob(db, {
      schoolId: "default",
      eventType,
      sourceEventId: attId,
      sourceRecordRef: `attendance/${attId}`,
      recipientId: parentRecipient.recipientId,
      recipientType: "parent",
      recipientDetails: parentRecipient,
      channel,
      templateId: status === "absent" ? `tpl_student_absent_${channel}` : `tpl_student_late_${channel}`,
      templateData,
      idempotencyKey,
    });

    if (!res.isDuplicate) {
      processNotificationJob(db, res.jobId).catch((err) => {
        console.warn(`Error processing attendance job ${res.jobId}:`, err);
      });
    }
  }
}

module.exports = {
  handleNoticePublished,
  handleFeePaymentVerified,
  handleReportCardPublished,
  handleExamScheduleApproved,
  handleHallTicketCreated,
  handleAttendanceRecorded,
};

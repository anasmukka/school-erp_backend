/**
 * Scheduled Fee Reminder Engine
 * Prestige International School ERP
 *
 * Requirements:
 * 1. Identifies active fee assignments and unpaid installments.
 * 2. Checks configured reminder stages (e.g. -7, -3, 0, 3, 7 days).
 * 3. Authoritatively revalidates current ledger balances & verified payments immediately before sending:
 *    - Never sends a reminder if an installment is already paid.
 *    - Never calculates balances independently from authoritative fee ledger records.
 * 4. Resolves parent/guardian contacts authoritatively.
 * 5. Uses stable idempotency keys to prevent duplicate reminders across repeated cron runs.
 */

const { EVENT_TYPES, CHANNELS } = require("./types");
const { resolveParentForStudent } = require("./resolver");
const { enqueueNotificationJob, processNotificationJob } = require("./queue");

/**
 * Normalizes date string to YYYY-MM-DD
 */
function normalizeDateOnly(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Calculates day difference (targetDate - todayDate) in calendar days
 */
function getDayDifference(targetDateStr, todayDateStr) {
  const d1 = new Date(targetDateStr);
  const d2 = new Date(todayDateStr);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((d1.getTime() - d2.getTime()) / msPerDay);
}

/**
 * Resolves current stage tag from day difference
 */
function getStageTag(diffDays) {
  if (diffDays === 7) return "7d_before";
  if (diffDays === 3) return "3d_before";
  if (diffDays === 0) return "due_date";
  if (diffDays === -3) return "3d_overdue";
  if (diffDays === -7) return "7d_overdue";
  return null;
}

/**
 * Executes a fee reminder pass across all active student fee assignments.
 * Can be run by Cloud Scheduler daily or manually triggered by Admin.
 */
async function runFeeReminderPass(db, todayStrOverride = null) {
  const todayStr = todayStrOverride || new Date().toISOString().slice(0, 10);
  const stats = {
    evaluatedAssignments: 0,
    evaluatedInstallments: 0,
    skippedPaidOrZero: 0,
    skippedNoStageMatch: 0,
    skippedMissingContact: 0,
    queuedJobs: 0,
    errors: [],
  };

  try {
    // 1. Fetch active settings for configured reminder days
    let reminderDays = [-7, -3, 0, 3, 7]; // default stages
    try {
      const settingsDoc = await db.collection("notificationSettings").doc("global").get();
      if (settingsDoc.exists) {
        const s = settingsDoc.data();
        if (Array.isArray(s.feeReminderScheduleDays) && s.feeReminderScheduleDays.length > 0) {
          reminderDays = s.feeReminderScheduleDays;
        }
      }
    } catch {
      // fallback to defaults
    }

    // 2. Fetch all student fee assignments
    const assignmentsSnap = await db.collection("studentFeeAssignments").get();
    stats.evaluatedAssignments = assignmentsSnap.size;

    for (const assignDoc of assignmentsSnap.docs) {
      const assignment = assignDoc.data();
      const assignmentId = assignDoc.id;
      const studentId = assignment.studentId;

      if (!studentId) continue;

      // Extract installments list
      let installments = assignment.installments || [];
      if ((!installments || installments.length === 0) && Array.isArray(assignment.terms)) {
        installments = assignment.terms.flatMap((t) => t.installments || []);
      }

      if (!installments || installments.length === 0) continue;

      // Fetch authoritative verified payments for this student
      const paymentsSnap = await db
        .collection("feePayments")
        .where("studentId", "==", studentId)
        .where("verificationStatus", "==", "verified")
        .get();

      const verifiedPayments = paymentsSnap.docs.map((d) => d.data());

      for (const inst of installments) {
        stats.evaluatedInstallments++;

        // Status check from assignment
        if (inst.status === "paid") {
          stats.skippedPaidOrZero++;
          continue;
        }

        const instAmount = Number(inst.amount) || 0;
        if (instAmount <= 0) {
          stats.skippedPaidOrZero++;
          continue;
        }

        // Authoritative verification against verified fee payments
        const paidForInst = verifiedPayments
          .filter((p) => p.installmentId === inst.id || p.installmentLabel === inst.label)
          .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        const currentOutstanding = Math.max(0, instAmount - paidForInst);

        if (currentOutstanding <= 0) {
          stats.skippedPaidOrZero++;
          continue; // Fully cleared, no reminder
        }

        // Due date calculation
        const dueDateNorm = normalizeDateOnly(inst.dueDate);
        if (!dueDateNorm) {
          continue;
        }

        const diffDays = getDayDifference(dueDateNorm, todayStr);
        // diffDays: positive = days until due, negative = days overdue

        // Check if diffDays matches any configured reminder stage
        // Note: positive diffDays (e.g. 7 days before) vs negative reminderDays (-7)
        // We match if diffDays === Math.abs(d) for upcoming or diffDays === d for overdue
        const matchesStage = reminderDays.some((targetDay) => {
          if (targetDay < 0) {
            // Days before due date
            return diffDays === Math.abs(targetDay);
          } else if (targetDay === 0) {
            return diffDays === 0;
          } else {
            // Days overdue
            return diffDays === -targetDay;
          }
        });

        if (!matchesStage) {
          stats.skippedNoStageMatch++;
          continue;
        }

        const stageTag = getStageTag(diffDays) || `day_${diffDays}`;

        // 3. Resolve parent recipient from authoritative records
        const parentRecipient = await resolveParentForStudent(db, studentId);
        if (!parentRecipient || (!parentRecipient.phone && !parentRecipient.email && !parentRecipient.uid)) {
          stats.skippedMissingContact++;
          continue;
        }

        const templateData = {
          schoolName: "Prestige International School",
          recipientName: parentRecipient.name || "Parent",
          studentName: parentRecipient.studentName || "Student",
          grade: parentRecipient.grade || "",
          section: parentRecipient.section || "",
          installmentLabel: inst.label || "Tuition Fee",
          amountDue: currentOutstanding.toLocaleString("en-IN"),
          dueDate: inst.dueDate,
          daysUntilDue: diffDays > 0 ? String(diffDays) : "0",
          daysOverdue: diffDays < 0 ? String(Math.abs(diffDays)) : "0",
          portalUrl: "https://prestige-erp.web.app/student/fees",
          totalOutstanding: currentOutstanding.toLocaleString("en-IN"),
        };

        // 4. Enqueue idempotent jobs across channels (Email, WhatsApp, Push)
        const channelsToEnqueue = [CHANNELS.EMAIL, CHANNELS.WHATSAPP, CHANNELS.PUSH];

        for (const channel of channelsToEnqueue) {
          const idempotencyKey = `fee_rem_${assignmentId}_${inst.id || inst.label}_${stageTag}_${parentRecipient.recipientId}_${channel}`.replace(/[^a-zA-Z0-9_]/g, "_");

          const enqueueResult = await enqueueNotificationJob(db, {
            schoolId: "default",
            eventType: EVENT_TYPES.FEE_REMINDER,
            sourceEventId: `${assignmentId}_${inst.id || inst.label}`,
            sourceRecordRef: `studentFeeAssignments/${assignmentId}`,
            recipientId: parentRecipient.recipientId,
            recipientType: "parent",
            recipientDetails: parentRecipient,
            channel,
            templateId: `tpl_fee_reminder_${channel}`,
            templateData,
            idempotencyKey,
          });

          if (!enqueueResult.isDuplicate) {
            stats.queuedJobs++;
            // Process immediately
            processNotificationJob(db, enqueueResult.jobId).catch((err) => {
              console.warn(`Error processing job ${enqueueResult.jobId}:`, err);
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("Error in runFeeReminderPass:", err);
    stats.errors.push(err.message || String(err));
  }

  return stats;
}

module.exports = {
  runFeeReminderPass,
  getStageTag,
  normalizeDateOnly,
  getDayDifference,
};

/**
 * Centralized Notification Queue Engine
 * Prestige International School ERP
 *
 * Implements:
 * 1. Durable Firestore Queue (`notificationJobs`)
 * 2. Stable Idempotency Key Enforcement (prevents duplicate dispatch)
 * 3. Concurrency Protection & Transactional Status Locking
 * 4. Channel Enablement & Consent Validation Before Dispatch
 * 5. Automatic Retries with Exponential Backoff
 * 6. Audit Logging (`notificationLogs`)
 */

const { CHANNELS, JOB_STATUSES, ERROR_CODES } = require("./types");
const { renderTemplate, DEFAULT_TEXT_TEMPLATES } = require("./templates");
const { isChannelEnabledForEvent, isUserOptedIn, isWhatsAppOptedOut } = require("./preferences");
const { sendEmail } = require("./providers/email");
const { sendWhatsAppMessage } = require("./providers/whatsapp");
const { sendFcmPushNotification } = require("./providers/fcm");
const { resolveDeviceTokensForUser } = require("./resolver");

/**
 * Enqueues a notification job idempotently.
 * If a job with the same idempotencyKey already exists, returns the existing job without creating a duplicate.
 */
async function enqueueNotificationJob(db, jobData) {
  const {
    schoolId = "default",
    eventType,
    sourceEventId,
    sourceRecordRef,
    recipientId,
    recipientType = "student",
    recipientDetails = {},
    channel,
    templateId,
    templateData = {},
    idempotencyKey,
    maxAttempts = 3,
  } = jobData;

  if (!eventType || !sourceEventId || !recipientId || !channel) {
    throw new Error("Missing required parameters to enqueue notification job.");
  }

  const effectiveIdempotencyKey =
    idempotencyKey || `${eventType}_${sourceEventId}_${recipientId}_${channel}`.replace(/[^a-zA-Z0-9_]/g, "_");

  const jobRef = db.collection("notificationJobs").doc(effectiveIdempotencyKey);

  const result = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(jobRef);
    if (existing.exists) {
      return {
        isDuplicate: true,
        jobId: existing.id,
        status: existing.data().status,
      };
    }

    const now = new Date().toISOString();
    const newJob = {
      id: effectiveIdempotencyKey,
      schoolId,
      eventType,
      sourceEventId,
      sourceRecordRef: sourceRecordRef || null,
      recipientId,
      recipientType,
      recipientDetails,
      channel,
      templateId: templateId || null,
      templateData,
      status: JOB_STATUSES.QUEUED,
      idempotencyKey: effectiveIdempotencyKey,
      attemptCount: 0,
      maxAttempts,
      nextAttemptAt: now,
      lastAttemptAt: null,
      providerMessageId: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    transaction.set(jobRef, newJob);
    return {
      isDuplicate: false,
      jobId: effectiveIdempotencyKey,
      job: newJob,
    };
  });

  // Write audit log if newly created
  if (!result.isDuplicate) {
    try {
      await db.collection("notificationLogs").add({
        jobId: result.jobId,
        schoolId,
        eventType,
        channel,
        recipientReference: recipientDetails.name || recipientId,
        action: "queued",
        status: JOB_STATUSES.QUEUED,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("Could not write notification log:", e);
    }
  }

  return result;
}

/**
 * Processes a single notification job with concurrency lock and validation.
 */
async function processNotificationJob(db, jobId) {
  const jobRef = db.collection("notificationJobs").doc(jobId);
  const now = new Date();

  // 1. Transactional Lock: Transition QUEUED / RETRY_SCHEDULED -> PROCESSING
  const jobData = await db.runTransaction(async (transaction) => {
    const docSnap = await transaction.get(jobRef);
    if (!docSnap.exists) return null;

    const data = docSnap.data();
    if (data.status !== JOB_STATUSES.QUEUED && data.status !== JOB_STATUSES.RETRY_SCHEDULED) {
      return null; // Already being processed or already reached a terminal state
    }

    // Check scheduled retry time if applicable
    if (data.nextAttemptAt && new Date(data.nextAttemptAt) > now) {
      return null; // Not ready for retry yet
    }

    const updated = {
      status: JOB_STATUSES.PROCESSING,
      attemptCount: (data.attemptCount || 0) + 1,
      lastAttemptAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    transaction.update(jobRef, updated);
    return { ...data, ...updated };
  });

  if (!jobData) return null;

  const {
    eventType,
    channel,
    recipientId,
    recipientDetails = {},
    templateData = {},
    attemptCount,
    maxAttempts = 3,
  } = jobData;

  const logEntry = {
    jobId,
    schoolId: jobData.schoolId || "default",
    eventType,
    channel,
    recipientReference: recipientDetails.name || recipientId,
    attemptNumber: attemptCount,
    timestamp: now.toISOString(),
  };

  try {
    // 2. School-level Channel Check
    const channelEnabled = await isChannelEnabledForEvent(db, eventType, channel);
    if (!channelEnabled) {
      await jobRef.update({
        status: JOB_STATUSES.CANCELLED,
        lastErrorCode: "CHANNEL_DISABLED_BY_SCHOOL",
        lastErrorMessage: `Channel '${channel}' is disabled for event type '${eventType}' in school settings.`,
        updatedAt: new Date().toISOString(),
      });
      await db.collection("notificationLogs").add({
        ...logEntry,
        action: "cancelled",
        status: JOB_STATUSES.CANCELLED,
        details: "Channel disabled in school settings",
      });
      return { success: false, status: JOB_STATUSES.CANCELLED };
    }

    // 3. User-level Opt-in Check
    const optedIn = await isUserOptedIn(db, recipientDetails.uid || recipientId, channel, eventType);
    if (!optedIn) {
      await jobRef.update({
        status: JOB_STATUSES.CANCELLED,
        lastErrorCode: ERROR_CODES.RECIPIENT_OPTED_OUT,
        lastErrorMessage: `Recipient has opted out of ${channel} notifications.`,
        updatedAt: new Date().toISOString(),
      });
      await db.collection("notificationLogs").add({
        ...logEntry,
        action: "cancelled",
        status: JOB_STATUSES.CANCELLED,
        details: "User opted out",
      });
      return { success: false, status: JOB_STATUSES.CANCELLED };
    }

    // 4. WhatsApp Specific Opt-Out Check (Meta compliance)
    if (channel === CHANNELS.WHATSAPP) {
      const optedOut = await isWhatsAppOptedOut(db, recipientDetails.phone, recipientDetails.uid || recipientId);
      if (optedOut) {
        await jobRef.update({
          status: JOB_STATUSES.CANCELLED,
          lastErrorCode: ERROR_CODES.RECIPIENT_OPTED_OUT,
          lastErrorMessage: "Recipient has opted out of WhatsApp messages.",
          updatedAt: new Date().toISOString(),
        });
        await db.collection("notificationLogs").add({
          ...logEntry,
          action: "cancelled",
          status: JOB_STATUSES.CANCELLED,
          details: "WhatsApp opt-out active",
        });
        return { success: false, status: JOB_STATUSES.CANCELLED };
      }
    }

    // 5. Render Message from DB Template or Fallback
    let templateSubject = "";
    let templateBody = "";

    try {
      if (jobData.templateId) {
        const tplDoc = await db.collection("notificationTemplates").doc(jobData.templateId).get();
        if (tplDoc.exists) {
          const tpl = tplDoc.data();
          templateSubject = tpl.subject || "";
          templateBody = tpl.body || "";
        }
      }
    } catch {
      // ignore
    }

    if (!templateBody) {
      const fallback = DEFAULT_TEXT_TEMPLATES[eventType] || {};
      templateSubject = fallback.subject || `Notification from Prestige International School`;
      templateBody = fallback.body || `{message}`;
    }

    const renderedSubject = renderTemplate(templateSubject, templateData);
    const renderedBody = renderTemplate(templateBody, templateData);

    // 6. Channel Dispatch
    let dispatchResult;

    if (channel === CHANNELS.EMAIL) {
      dispatchResult = await sendEmail({
        to: recipientDetails.email,
        subject: renderedSubject,
        html: renderedBody.includes("<") ? renderedBody : undefined,
        text: renderedBody,
      });
    } else if (channel === CHANNELS.WHATSAPP) {
      dispatchResult = await sendWhatsAppMessage({
        to: recipientDetails.phone,
        text: renderedBody,
      });
    } else if (channel === CHANNELS.PUSH) {
      // Resolve device tokens dynamically if not already provided
      let tokens = recipientDetails.deviceTokens;
      if (!tokens || tokens.length === 0) {
        tokens = await resolveDeviceTokensForUser(db, recipientDetails.uid || recipientId);
      }

      dispatchResult = await sendFcmPushNotification(db, {
        tokens,
        title: renderedSubject || "Prestige ERP Update",
        body: renderedBody,
        data: {
          eventType,
          sourceEventId: jobData.sourceEventId || "",
          route: templateData.portalUrl || "/student/notices",
        },
      });
    } else {
      dispatchResult = {
        success: false,
        status: JOB_STATUSES.PERMANENT_FAILURE,
        code: "UNSUPPORTED_CHANNEL",
        error: `Channel '${channel}' is not supported.`,
      };
    }

    // 7. Update Job Status & Delivery Logs
    const isSuccess = dispatchResult.success;
    const finalStatus = dispatchResult.status;

    let nextAttemptAt = null;
    let computedStatus = finalStatus;

    if (!isSuccess) {
      // Check if error is retryable
      const isRetryable =
        dispatchResult.code === ERROR_CODES.TRANSIENT_NETWORK ||
        dispatchResult.code === ERROR_CODES.RATE_LIMIT;

      if (isRetryable && attemptCount < maxAttempts) {
        computedStatus = JOB_STATUSES.RETRY_SCHEDULED;
        // Exponential backoff: 5m, 10m, 20m...
        const backoffMinutes = 5 * Math.pow(2, attemptCount - 1);
        nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
      } else {
        computedStatus = attemptCount >= maxAttempts ? JOB_STATUSES.PERMANENT_FAILURE : JOB_STATUSES.FAILED;
      }
    }

    await jobRef.update({
      status: computedStatus,
      providerMessageId: dispatchResult.providerMessageId || null,
      lastErrorCode: dispatchResult.code || null,
      lastErrorMessage: dispatchResult.error || null,
      nextAttemptAt,
      deliveredAt: isSuccess ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    });

    await db.collection("notificationLogs").add({
      ...logEntry,
      action: isSuccess ? "dispatch_attempted" : "provider_rejected",
      status: computedStatus,
      providerMessageId: dispatchResult.providerMessageId || null,
      errorCode: dispatchResult.code || null,
      errorMessage: dispatchResult.error || null,
      details: isSuccess ? "Accepted by provider" : dispatchResult.error,
    });

    return {
      success: isSuccess,
      status: computedStatus,
      providerMessageId: dispatchResult.providerMessageId,
      error: dispatchResult.error,
    };
  } catch (err) {
    console.error(`Unexpected error processing job ${jobId}:`, err);
    const fatal = attemptCount >= maxAttempts;
    const computedStatus = fatal ? JOB_STATUSES.PERMANENT_FAILURE : JOB_STATUSES.RETRY_SCHEDULED;
    const nextAttemptAt = fatal ? null : new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await jobRef.update({
      status: computedStatus,
      lastErrorCode: ERROR_CODES.TRANSIENT_NETWORK,
      lastErrorMessage: err.message || "Unknown error",
      nextAttemptAt,
      updatedAt: new Date().toISOString(),
    });

    await db.collection("notificationLogs").add({
      ...logEntry,
      action: "provider_rejected",
      status: computedStatus,
      errorCode: ERROR_CODES.TRANSIENT_NETWORK,
      errorMessage: err.message,
    });

    return { success: false, status: computedStatus, error: err.message };
  }
}

/**
 * Allows an authorized admin to manually retry a failed notification job.
 * Revalidates recipient and business context before retrying.
 */
async function retryNotificationJob(db, jobId, actorUid) {
  const jobRef = db.collection("notificationJobs").doc(jobId);
  const snap = await jobRef.get();

  if (!snap.exists) {
    throw new Error(`Notification job '${jobId}' does not exist.`);
  }

  const job = snap.data();

  // Reset job to QUEUED state with clean error fields
  await jobRef.update({
    status: JOB_STATUSES.QUEUED,
    nextAttemptAt: new Date().toISOString(),
    lastErrorCode: null,
    lastErrorMessage: null,
    updatedAt: new Date().toISOString(),
  });

  await db.collection("notificationLogs").add({
    jobId,
    schoolId: job.schoolId || "default",
    eventType: job.eventType,
    channel: job.channel,
    recipientReference: job.recipientDetails?.name || job.recipientId,
    actorUid,
    action: "manual_retry_requested",
    status: JOB_STATUSES.QUEUED,
    timestamp: new Date().toISOString(),
  });

  // Immediately process job
  return processNotificationJob(db, jobId);
}

module.exports = {
  enqueueNotificationJob,
  processNotificationJob,
  retryNotificationJob,
};

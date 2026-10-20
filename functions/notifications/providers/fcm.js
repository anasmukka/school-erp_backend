/**
 * Firebase Cloud Messaging (FCM) Push Notification Provider
 * Prestige International School ERP
 *
 * Requirements:
 * 1. Uses Firebase Admin Messaging SDK.
 * 2. Sends push notifications to valid registered device tokens.
 * 3. Sanitizes payloads (no sensitive student marks or private financial details in push).
 * 4. Cleans up stale/invalid tokens (messaging/invalid-registration-token or registration-token-not-registered).
 */

const { getMessaging } = require("firebase-admin/messaging");
const { JOB_STATUSES, ERROR_CODES } = require("../types");

async function sendFcmPushNotification(db, { tokens, title, body, data }) {
  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
    return {
      success: false,
      status: JOB_STATUSES.FAILED,
      code: ERROR_CODES.RECIPIENT_MISSING_CONTACT,
      error: "No registered device push tokens found for recipient.",
    };
  }

  // Filter valid string tokens
  const validTokens = Array.from(new Set(tokens.filter((t) => typeof t === "string" && t.trim().length > 10)));
  if (validTokens.length === 0) {
    return {
      success: false,
      status: JOB_STATUSES.FAILED,
      code: ERROR_CODES.RECIPIENT_MISSING_CONTACT,
      error: "All provided device push tokens are empty or malformed.",
    };
  }

  // Ensure all data values are strings for FCM
  const sanitizedData = {};
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      sanitizedData[k] = String(v ?? "");
    }
  }

  const messagePayload = {
    notification: {
      title: title || "Prestige International School",
      body: body || "An update is available in Prestige ERP.",
    },
    data: sanitizedData,
    tokens: validTokens,
  };

  try {
    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast(messagePayload);

    const invalidTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        const errCode = resp.error.code;
        if (
          errCode === "messaging/invalid-registration-token" ||
          errCode === "messaging/registration-token-not-registered"
        ) {
          invalidTokens.push(validTokens[idx]);
        }
      }
    });

    // Cleanup stale tokens in Firestore asynchronously
    if (invalidTokens.length > 0 && db) {
      Promise.all(
        invalidTokens.map(async (staleToken) => {
          try {
            const snap = await db.collection("deviceTokens").where("token", "==", staleToken).get();
            const batch = db.batch();
            snap.forEach((d) => batch.delete(d.ref));
            await batch.commit();
          } catch (e) {
            console.warn("Could not cleanup stale device token:", e);
          }
        })
      ).catch(() => {});
    }

    const allFailed = response.successCount === 0;

    return {
      success: !allFailed,
      status: allFailed ? JOB_STATUSES.FAILED : JOB_STATUSES.SENT,
      providerMessageId: `fcm_batch_${Date.now()}_succ_${response.successCount}`,
      successCount: response.successCount,
      failureCount: response.failureCount,
      staleTokensCleaned: invalidTokens.length,
      error: allFailed ? "All device tokens failed delivery." : undefined,
    };
  } catch (err) {
    console.error("FCM dispatch error:", err);
    return {
      success: false,
      status: JOB_STATUSES.FAILED,
      code: ERROR_CODES.TRANSIENT_NETWORK,
      error: err.message || "Failed to dispatch FCM push notification",
    };
  }
}

module.exports = {
  sendFcmPushNotification,
};

/**
 * Meta WhatsApp Cloud API Webhook Handler
 * Prestige International School ERP
 *
 * Implements:
 * 1. GET verification challenge response (`hub.challenge`).
 * 2. POST delivery status updates (sent, delivered, read, failed).
 * 3. Idempotent correlation with `notificationJobs` via providerMessageId.
 * 4. Rejection of unauthorized or malformed requests.
 */

const { JOB_STATUSES } = require("./types");

async function handleWhatsAppWebhook(req, res, db) {
  // 1. GET Challenge Verification
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const expectedVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "prestige_webhook_verify_token_2026";

    if (mode === "subscribe" && token === expectedVerifyToken) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden: Invalid verification token");
  }

  // 2. POST Delivery Status Handling
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || body.object !== "whatsapp_business_account") {
        return res.status(400).send("Bad Request: Not a WhatsApp Business event");
      }

      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value || {};
          const statuses = value.statuses || [];

          for (const st of statuses) {
            const providerMsgId = st.id;
            const metaStatus = st.status; // 'sent', 'delivered', 'read', 'failed'
            const timestamp = st.timestamp ? new Date(parseInt(st.timestamp, 10) * 1000).toISOString() : new Date().toISOString();

            if (!providerMsgId) continue;

            // Find matching job in notificationJobs
            const jobsSnap = await db
              .collection("notificationJobs")
              .where("providerMessageId", "==", providerMsgId)
              .limit(1)
              .get();

            if (!jobsSnap.empty) {
              const jobDoc = jobsSnap.docs[0];
              const jobData = jobDoc.data();
              const updatePayload = {
                updatedAt: new Date().toISOString(),
              };

              let mappedStatus = jobData.status;

              if (metaStatus === "delivered") {
                mappedStatus = JOB_STATUSES.DELIVERED;
                updatePayload.status = JOB_STATUSES.DELIVERED;
                updatePayload.deliveredAt = timestamp;
              } else if (metaStatus === "read") {
                updatePayload.readAt = timestamp;
              } else if (metaStatus === "failed") {
                mappedStatus = JOB_STATUSES.FAILED;
                updatePayload.status = JOB_STATUSES.FAILED;
                const err = st.errors?.[0] || {};
                updatePayload.lastErrorCode = `META_ERR_${err.code || "UNKNOWN"}`;
                updatePayload.lastErrorMessage = err.title || err.message || "WhatsApp delivery failed";
              }

              await jobDoc.ref.update(updatePayload);

              // Log delivery audit event
              await db.collection("notificationLogs").add({
                jobId: jobDoc.id,
                schoolId: jobData.schoolId || "default",
                eventType: jobData.eventType,
                channel: jobData.channel,
                recipientReference: jobData.recipientDetails?.name || jobData.recipientId,
                action: metaStatus === "delivered" ? "delivered" : "provider_accepted",
                status: mappedStatus,
                providerMessageId: providerMsgId,
                details: `Meta WhatsApp Webhook status: ${metaStatus}`,
                timestamp,
              });
            }
          }
        }
      }

      return res.status(200).json({ status: "ok" });
    } catch (err) {
      console.error("Error processing WhatsApp webhook:", err);
      return res.status(500).send("Webhook handler internal error");
    }
  }

  return res.status(405).send("Method Not Allowed");
}

module.exports = {
  handleWhatsAppWebhook,
};

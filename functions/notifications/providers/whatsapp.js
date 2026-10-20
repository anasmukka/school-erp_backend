/**
 * Official WhatsApp Business Platform (Cloud API) Provider Integration
 * Prestige International School ERP
 *
 * Requirements:
 * 1. Checks server credentials (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID).
 * 2. If unconfigured, reports clearly as unconfigured (never pretend messages were sent).
 * 3. Supports Meta-approved templates as well as validated text messages.
 * 4. Extracts message ID, handles rate limits and API error classifications.
 */

const { JOB_STATUSES, ERROR_CODES } = require("../types");
const { normalizePhone } = require("../resolver");

function isWhatsAppConfigured() {
  const token = process.env.WHATSAPP_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  return Boolean(token && phoneNumberId);
}

async function sendWhatsAppMessage({ to, text, templateName, languageCode, components }) {
  const token = process.env.WHATSAPP_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const apiVersion = process.env.WHATSAPP_API_VERSION || "v20.0";

  if (!token || !phoneNumberId) {
    return {
      success: false,
      status: JOB_STATUSES.FAILED,
      code: ERROR_CODES.WHATSAPP_NOT_CONFIGURED,
      error: "WhatsApp Business API is not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID secrets in Firebase Functions.",
    };
  }

  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) {
    return {
      success: false,
      status: JOB_STATUSES.PERMANENT_FAILURE,
      code: ERROR_CODES.RECIPIENT_MISSING_CONTACT,
      error: `Invalid recipient phone number: '${to}'. Must contain 10-15 valid digits with country code.`,
    };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  let payload;
  if (templateName) {
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode || "en" },
        components: components || [],
      },
    };
  } else {
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "text",
      text: { body: text || "" },
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errObj = json.error || {};
      const errCode = errObj.code;
      const errMsg = errObj.message || res.statusText || "WhatsApp Cloud API error";

      // Classify WhatsApp API error codes
      let classification = ERROR_CODES.PERMANENT_FAILURE;
      if (errCode === 130429 || errCode === 131056 || errCode === 80007) {
        classification = ERROR_CODES.RATE_LIMIT;
      } else if (errCode === 190) {
        classification = ERROR_CODES.AUTHENTICATION_ERROR;
      } else if (errCode === 132000 || errCode === 132001) {
        classification = ERROR_CODES.TEMPLATE_INVALID;
      } else if (res.status >= 500) {
        classification = ERROR_CODES.TRANSIENT_NETWORK;
      }

      return {
        success: false,
        status: classification === ERROR_CODES.RATE_LIMIT || classification === ERROR_CODES.TRANSIENT_NETWORK
          ? JOB_STATUSES.RETRY_SCHEDULED
          : JOB_STATUSES.FAILED,
        code: classification,
        error: `Meta WhatsApp Error (${errCode || res.status}): ${errMsg}`,
        rawResponse: json,
      };
    }

    const messageId = json.messages?.[0]?.id || null;

    return {
      success: true,
      status: JOB_STATUSES.SENT,
      providerMessageId: messageId,
      rawResponse: json,
    };
  } catch (err) {
    return {
      success: false,
      status: JOB_STATUSES.RETRY_SCHEDULED,
      code: ERROR_CODES.TRANSIENT_NETWORK,
      error: err.message || "Network error communicating with WhatsApp Cloud API",
    };
  }
}

module.exports = {
  isWhatsAppConfigured,
  sendWhatsAppMessage,
};

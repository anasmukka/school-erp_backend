/**
 * Transactional Email Provider Integration
 * Prestige International School ERP
 *
 * Implements:
 * 1. Secure server-side credential discovery (EMAIL_USER, EMAIL_PASS, EMAIL_HOST).
 * 2. Unconfigured channel detection (safe failure reporting, no silent failures).
 * 3. HTML and plain-text multipart sending via nodemailer.
 * 4. Provider messageId extraction and accepted/rejected status reporting.
 */

const nodemailer = require("nodemailer");
const { JOB_STATUSES, ERROR_CODES } = require("../types");

let cachedTransporter = null;

function getEmailTransporter() {
  const emailUser = process.env.EMAIL_USER || "";
  const emailPass = process.env.EMAIL_PASS || "";
  const emailHost = process.env.EMAIL_HOST || "";
  const emailPort = process.env.EMAIL_PORT ? parseInt(process.env.EMAIL_PORT, 10) : 587;
  const emailSecure = process.env.EMAIL_SECURE === "true";

  if (!emailUser || !emailPass) {
    return { transporter: null, configured: false };
  }

  if (cachedTransporter) {
    return { transporter: cachedTransporter, configured: true };
  }

  let options;
  if (emailHost) {
    options = {
      host: emailHost,
      port: emailPort,
      secure: emailSecure,
      auth: { user: emailUser, pass: emailPass },
    };
  } else {
    // Default to Gmail service
    options = {
      service: "gmail",
      auth: { user: emailUser, pass: emailPass },
    };
  }

  cachedTransporter = nodemailer.createTransport(options);
  return { transporter: cachedTransporter, configured: true };
}

async function sendEmail({ to, subject, html, text }) {
  const { transporter, configured } = getEmailTransporter();

  if (!configured || !transporter) {
    return {
      success: false,
      status: JOB_STATUSES.FAILED,
      code: ERROR_CODES.EMAIL_NOT_CONFIGURED,
      error: "Email provider is not configured. Set EMAIL_USER and EMAIL_PASS secrets in Firebase Functions.",
    };
  }

  if (!to) {
    return {
      success: false,
      status: JOB_STATUSES.PERMANENT_FAILURE,
      code: ERROR_CODES.RECIPIENT_MISSING_CONTACT,
      error: "Missing recipient email address.",
    };
  }

  const senderName = "Prestige International School";
  const senderEmail = process.env.EMAIL_USER;

  try {
    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to,
      subject: subject || "Notification from Prestige International School",
      text: text || (html ? html.replace(/<[^>]+>/g, " ") : ""),
      html: html || undefined,
    });

    const isAccepted = Array.isArray(info.accepted) && info.accepted.includes(to);

    return {
      success: isAccepted,
      status: isAccepted ? JOB_STATUSES.SENT : JOB_STATUSES.FAILED,
      providerMessageId: info.messageId || null,
      rawResponse: info.response || null,
    };
  } catch (err) {
    const msg = err.message || "Failed to send email";
    const isAuthError = msg.includes("Invalid login") || msg.includes("Username and Password not accepted") || err.code === "EAUTH";

    return {
      success: false,
      status: isAuthError ? JOB_STATUSES.FAILED : JOB_STATUSES.FAILED,
      code: isAuthError ? ERROR_CODES.AUTHENTICATION_ERROR : ERROR_CODES.TRANSIENT_NETWORK,
      error: msg,
    };
  }
}

function isEmailConfigured() {
  const { configured } = getEmailTransporter();
  return configured;
}

module.exports = {
  sendEmail,
  isEmailConfigured,
};

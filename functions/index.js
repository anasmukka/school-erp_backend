/**
 * Firebase Cloud Function: Email Notification on Missing Marks
 *
 * Triggers when a new document is created in the `notifications` collection.
 * Sends an email to the teacher about missing marks.
 *
 * SETUP INSTRUCTIONS:
 * 1. Install Firebase CLI: npm install -g firebase-tools
 * 2. Login: firebase login
 * 3. Init functions: firebase init functions (select your project)
 * 4. Copy this file to functions/index.js
 * 5. Set email config:
 *    firebase functions:config:set email.user="your-email@gmail.com" email.pass="your-app-password"
 *    (Use a Gmail App Password — NOT your regular Gmail password)
 * 6. Deploy: firebase deploy --only functions
 *
 * For Gmail App Passwords:
 * - Go to https://myaccount.google.com/apppasswords
 * - Generate a new app password for "Mail"
 * - Use that 16-character password in the config above
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

// Email transporter — configured via environment/secret
function getTransporter() {
  const emailUser = process.env.EMAIL_USER || "";
  const emailPass = process.env.EMAIL_PASS || "";

  if (!emailUser || !emailPass) {
    console.warn("Email credentials not configured. Set EMAIL_USER and EMAIL_PASS secrets.");
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: emailUser, pass: emailPass },
  });
}

/**
 * Trigger: New notification document created
 * Action: Look up teacher's email and send notification email
 */
exports.sendNotificationEmail = onDocumentCreated(
  { document: "notifications/{notificationId}", region: "us-central1" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    // Only process missing_marks notifications
    if (data.type !== "missing_marks") return;

    const { recipientTeacherId, recipientName, senderName, studentName, subjectName, grade, message } = data;

    if (!recipientTeacherId) {
      console.log("No recipientTeacherId, skipping email.");
      return;
    }

    try {
      // Look up teacher's email from teachers collection
      const teacherDoc = await db.collection("teachers").doc(recipientTeacherId).get();
      if (!teacherDoc.exists) {
        console.log(`Teacher ${recipientTeacherId} not found.`);
        return;
      }

      const teacherData = teacherDoc.data();
      const teacherEmail = teacherData?.email;

      if (!teacherEmail) {
        console.log(`No email for teacher ${recipientTeacherId}.`);
        return;
      }

      const transporter = getTransporter();
      if (!transporter) {
        console.log("Email not configured, skipping.");
        return;
      }

      const subject = `[Prestige International School] Missing Marks — ${subjectName}`;
      const html = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #1e293b, #334155); padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <h2 style="color: #fff; margin: 0; font-size: 18px;">Prestige International School</h2>
            <p style="color: #94a3b8; margin: 4px 0 0; font-size: 13px;">Missing Marks Notification</p>
          </div>
          <div style="background: #fff; padding: 24px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="margin: 0 0 16px; color: #334155;">Dear <strong>${recipientName || "Teacher"}</strong>,</p>
            <p style="margin: 0 0 16px; color: #475569; line-height: 1.6;">
              ${message || `Please enter the Final Exam marks for <strong>${subjectName}</strong> — student <strong>${studentName}</strong> (Grade ${grade}).`}
            </p>
            <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
              <p style="margin: 0; color: #92400e; font-size: 13px;">
                <strong>Action Required:</strong> Log in to the School ERP and enter the missing marks so the class teacher can generate the student's report card.
              </p>
            </div>
            <p style="margin: 16px 0 0; color: #64748b; font-size: 12px;">
              Sent by: ${senderName || "Class Teacher"} · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>
      `;

      await transporter.sendMail({
        from: `"Prestige International School" <${process.env.EMAIL_USER}>`,
        to: teacherEmail,
        subject,
        html,
      });

      // Mark the notification as email_sent
      await event.data.ref.update({ emailSent: true, emailSentAt: new Date().toISOString() });
      console.log(`Email sent to ${teacherEmail} for notification ${event.params.notificationId}`);
    } catch (error) {
      console.error("Failed to send email:", error);
      await event.data.ref.update({ emailError: error.message || "Unknown error" });
    }
  }
);

/**
 * Firebase Cloud Function: WhatsApp notification for assignments/activities
 *
 * Triggers when a new document is created in `assignmentsActivities`.
 * Sends a WhatsApp text message to each student's `parentContact` in that section.
 *
 * Required secrets/env:
 * - WHATSAPP_TOKEN (Meta WhatsApp Cloud API access token)
 * - WHATSAPP_PHONE_NUMBER_ID (Meta phone number id)
 * - WHATSAPP_API_VERSION (optional, default "v20.0")
 */

function normalizeWhatsAppNumber(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  // keep digits only
  let digits = raw.replace(/[^\d]/g, "");

  // Common India formats:
  // - 10 digits => prefix 91
  // - 11 digits starting with 0 => drop 0 and prefix 91
  // - already 12+ digits with country code => keep
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    digits = `91${digits}`;
  }

  if (digits.length < 11) return null;
  return digits;
}

async function sendWhatsAppText({ to, body }) {
  const token = process.env.WHATSAPP_TOKEN || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const apiVersion = process.env.WHATSAPP_API_VERSION || "v20.0";

  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp credentials not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID).");
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WhatsApp API error (${res.status}): ${text || res.statusText}`);
  }

  return res.json().catch(() => ({}));
}

function buildWorkMessage({ kind, title, dueDate, description, grade }) {
  const kindLabel = kind === "activity" ? "Activity" : "Assignment";
  const lines = [
    `Prestige International School`,
    `${kindLabel} for Grade ${grade || ""}`.trim(),
    `Title: ${title || "-"}`,
    `Due: ${dueDate || "-"}`,
  ];
  const cleaned = String(description || "").trim();
  if (cleaned) {
    lines.push("");
    lines.push(cleaned.length > 600 ? `${cleaned.slice(0, 600)}...` : cleaned);
  }
  return lines.join("\n");
}

exports.sendAssignmentWhatsApp = onDocumentCreated(
  { document: "assignmentsActivities/{docId}", region: "us-central1" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const sectionId = String(data.sectionId || "").trim();
    if (!sectionId) return;

    const kind = String(data.kind || "assignment");
    const title = String(data.title || "");
    const dueDate = String(data.dueDate || "");
    const description = String(data.description || "");
    const grade = String(data.grade || "");

    const messageBody = buildWorkMessage({ kind, title, dueDate, description, grade });

    try {
      const studentsSnap = await db.collection("students").where("sectionId", "==", sectionId).get();
      const recipients = [];
      studentsSnap.forEach((docSnap) => {
        const s = docSnap.data() || {};
        const to = normalizeWhatsAppNumber(s.parentContact);
        if (!to) return;
        recipients.push({ to, studentId: docSnap.id });
      });

      if (recipients.length === 0) {
        await event.data.ref.update({
          whatsappStatus: "failed",
          whatsappError: "No valid parentContact numbers found for students in this section.",
          whatsappAttemptedAt: new Date().toISOString(),
        });
        return;
      }

      let sent = 0;
      const errors = [];

      // Simple sequential send: typical section sizes are small; avoids hitting API limits.
      for (const r of recipients) {
        try {
          await sendWhatsAppText({ to: r.to, body: messageBody });
          sent += 1;
        } catch (err) {
          errors.push(String(err?.message || err));
        }
      }

      await event.data.ref.update({
        whatsappStatus: errors.length === 0 ? "sent" : "failed",
        whatsappSentCount: sent,
        whatsappError: errors.slice(0, 3).join(" | "),
        whatsappAttemptedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to send WhatsApp messages:", error);
      await event.data.ref.update({
        whatsappStatus: "failed",
        whatsappError: error.message || "Unknown error",
        whatsappAttemptedAt: new Date().toISOString(),
      });
    }
  }
);

// IMPORTANT: RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must be set as Firebase
// function secrets — never hardcoded. Deploy with:
//   firebase functions:secrets:set RAZORPAY_KEY_SECRET
//   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
//
// Verify they are set: firebase functions:secrets:access RAZORPAY_KEY_SECRET

function getGatewaySecret() {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw new Error(
      "RAZORPAY_KEY_SECRET is not configured. " +
        "Set it via: firebase functions:secrets:set RAZORPAY_KEY_SECRET"
    );
  }
  return secret;
}

function getWebhookSecret() {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "RAZORPAY_WEBHOOK_SECRET is not configured. " +
        "Set it via: firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET"
    );
  }
  return secret;
}

/**
 * Authoritative Payment Gateway Capability Discovery
 * Never exposes secrets. Returns active vs not_configured vs temporarily_unavailable.
 */
exports.getPaymentGatewayConfig = onCall(
  { region: "us-central1" },
  async (_request) => {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!keySecret || !webhookSecret) {
      return {
        onlinePaymentsEnabled: false,
        provider: "none",
        status: "not_configured",
        keyId: null,
        message: "Online fee payments are currently unavailable. Please use the school counter for payment.",
      };
    }

    try {
      const settingsDoc = await db.collection("paymentSettings").doc("global").get();
      if (settingsDoc.exists) {
        const settings = settingsDoc.data() || {};
        if (settings.maintenanceMode === true || settings.onlinePaymentsEnabled === false) {
          return {
            onlinePaymentsEnabled: false,
            provider: "razorpay",
            status: "temporarily_unavailable",
            keyId: null,
            message: settings.maintenanceNotice || "Online payments are currently under maintenance. Please try again later or visit the school counter.",
          };
        }
      }
    } catch {
      // Non-blocking fallback
    }

    return {
      onlinePaymentsEnabled: true,
      provider: "razorpay",
      status: "active",
      keyId: process.env.RAZORPAY_KEY_ID || null,
      message: "Online payment is active.",
    };
  }
);

/**
 * Creates an authorized payment order with a cryptographic server HMAC signature token.
 */
exports.createFeePaymentOrder = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required to initiate payment.");
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      throw new HttpsError(
        "failed-precondition",
        "Online fee payments are currently unavailable. Please use the school counter for payment."
      );
    }

    const {
      studentId,
      studentUid,
      studentName,
      grade,
      structureId,
      assignmentId,
      academicSession,
      installmentIds,
      installmentLabels,
      amount,
    } = request.data || {};

    const numAmount = Number(amount);
    if (!studentId || !numAmount || numAmount <= 0) {
      throw new HttpsError("invalid-argument", "Valid student ID and positive amount required.");
    }

    // Role verification: Student can only create order for themselves
    const callerUid = request.auth.uid;
    const userDoc = await db.collection("users").doc(callerUid).get();
    const userData = userDoc.data() || {};
    const callerRole = userData.role || "student";

    if (callerRole === "student") {
      const isSelf = callerUid === studentUid || callerUid === studentId;
      if (!isSelf) {
        // Double check against students collection
        const studentDoc = await db.collection("students").doc(studentId).get();
        const studentData = studentDoc.data() || {};
        if (studentData.uid !== callerUid && studentData.studentUid !== callerUid) {
          throw new HttpsError("permission-denied", "Students can only initiate payments for their own account.");
        }
      }
    } else if (callerRole === "parent") {
      const linkedUids = userData.linkedStudentUids || [];
      if (!linkedUids.includes(studentId) && !linkedUids.includes(studentUid)) {
        throw new HttpsError("permission-denied", "Parents can only initiate payments for linked children.");
      }
    }

    const now = new Date();
    const orderId = `order_onl_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // Cryptographic server HMAC signature
    const signatureToken = crypto
      .createHmac("sha256", getGatewaySecret())
      .update(`${orderId}:${numAmount}:${studentId}`)
      .digest("hex");

    // Persist Payment Intent
    await db.collection("paymentIntents").doc(orderId).set({
      orderId,
      studentId,
      studentUid: studentUid || callerUid,
      studentName: studentName || "",
      grade: grade || "",
      structureId: structureId || "",
      assignmentId: assignmentId || null,
      academicSession: academicSession || "",
      installmentIds: installmentIds || [],
      installmentLabels: installmentLabels || [],
      amount: numAmount,
      currency: "INR",
      status: "pending",
      signatureToken,
      createdBy: callerUid,
      createdAt: now.toISOString(),
    });

    return {
      orderId,
      amount: numAmount,
      currency: "INR",
      signatureToken,
      createdAt: now.toISOString(),
    };
  }
);

/**
 * Cryptographically verifies payment transaction and idempotently records feePayment and feeLedgerEntry.
 */
exports.verifyAndRecordOnlineFeePayment = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const {
      orderId,
      paymentId,
      signatureToken,
      razorpaySignature,
      studentId,
      studentUid,
      studentName,
      grade,
      structureId,
      assignmentId,
      academicSession,
      termId,
      termName,
      installmentId,
      installmentLabel,
      amount,
      paymentMode,
      payerEmail,
    } = request.data || {};

    if (!orderId || !paymentId || !studentId) {
      throw new HttpsError("invalid-argument", "Missing required payment verification parameters.");
    }

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      throw new HttpsError("invalid-argument", "Invalid payment amount.");
    }

    // Cryptographic Verification: Gateway HMAC-SHA256 (SEC-03)
    if (!razorpaySignature || typeof razorpaySignature !== "string") {
      throw new HttpsError("invalid-argument", "Cryptographic gateway signature (razorpaySignature) is required.");
    }

    const expectedRazorpay = crypto
      .createHmac("sha256", getGatewaySecret())
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const expectedBuf = Buffer.from(expectedRazorpay, "utf-8");
    const receivedBuf = Buffer.from(razorpaySignature, "utf-8");

    let verified = false;
    if (expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      verified = true;
    }

    if (!verified) {
      throw new HttpsError("invalid-argument", "Cryptographic payment verification failed: Invalid gateway signature.");
    }

    // Deterministic Payment Document Reference for database-level idempotency
    const paymentRef = db.collection("feePayments").doc(paymentId);
    const ledgerRef = db.collection("feeLedgerEntries").doc(`LEDGER_${paymentId}`);
    const intentRef = db.collection("paymentIntents").doc(orderId);

    const callerUid = request.auth.uid;
    const now = new Date();
    const paidAt = now.toISOString().slice(0, 10);
    const receiptNo = `RC-ONL-${now.getFullYear()}-${Date.now().toString().slice(-6)}`;

    const result = await db.runTransaction(async (transaction) => {
      // 1. Check if payment already exists (Idempotency check)
      const existingPayment = await transaction.get(paymentRef);
      if (existingPayment.exists) {
        const data = existingPayment.data();
        return {
          success: true,
          paymentRecordId: existingPayment.id,
          receiptNo: data.receiptNo || `RC-${existingPayment.id.slice(-6)}`,
          transactionId: paymentId,
          paidAt: data.paidAt || paidAt,
          message: "Payment already verified and credited to ledger (idempotent duplicate request).",
        };
      }

      // 2. Fetch payment intent
      const intentSnap = await transaction.get(intentRef);
      if (intentSnap.exists) {
        const intentData = intentSnap.data();
        if (intentData.status === "completed" && intentData.paymentId !== paymentId) {
          throw new HttpsError("failed-precondition", "Order intent has already been fulfilled by another payment.");
        }
      }

      // 3. Atomically write authoritative feePayments record
      const paymentData = {
        id: paymentId,
        orderId,
        paymentId,
        reference: paymentId,
        studentId,
        studentUid: studentUid || callerUid,
        studentName: studentName || "",
        grade: grade || "",
        structureId: structureId || "",
        assignmentId: assignmentId || null,
        academicSession: academicSession || "",
        termId: termId || "",
        termName: termName || "",
        installmentId: installmentId || "",
        installmentLabel: installmentLabel || "",
        amount: numAmount,
        paymentMode: paymentMode || "online",
        paidAt,
        receiptNo,
        verificationStatus: "verified",
        verifiedAt: now.toISOString(),
        recordedBy: callerUid,
        notes: `Online Gateway Payment verified (Order: ${orderId})`,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      transaction.set(paymentRef, paymentData);

      // 4. Atomically write authoritative feeLedgerEntries record
      transaction.set(ledgerRef, {
        studentId,
        studentUid: studentUid || callerUid,
        assignmentId: assignmentId || "",
        sessionId: academicSession || "",
        type: "payment",
        description: `Payment for ${termName ? `${termName} - ` : ""}${installmentLabel || "Tuition"} (online) — Receipt: ${receiptNo}`,
        amount: -numAmount,
        termId: termId || "",
        termName: termName || "",
        installmentId: installmentId || "",
        installmentLabel: installmentLabel || "",
        referenceId: paymentId,
        referenceType: "feePayment",
        verificationStatus: "verified",
        recordedBy: callerUid,
        recordedByName: "Payment Gateway",
        createdAt: now.toISOString(),
      });

      // 5. Update payment intent
      if (intentSnap.exists) {
        transaction.update(intentRef, {
          status: "completed",
          paymentRecordId: paymentId,
          receiptNo,
          completedAt: now.toISOString(),
        });
      }

      // 6. If assignment exists, update installment status in studentFeeAssignments (and terms)
      if (assignmentId) {
        const assignRef = db.collection("studentFeeAssignments").doc(assignmentId);
        const assignSnap = await transaction.get(assignRef);
        if (assignSnap.exists) {
          const assignData = assignSnap.data();
          const installments = assignData.installments || [];
          let updated = false;
          const updatedInsts = installments.map((inst) => {
            if (inst.id === installmentId || inst.label === installmentLabel) {
              updated = true;
              return { ...inst, status: "paid" };
            }
            return inst;
          });
          const updatePayload = {};
          if (updated) {
            updatePayload.installments = updatedInsts;
            updatePayload.updatedAt = now.toISOString();
          }
          if (assignData.terms && Array.isArray(assignData.terms)) {
            const updatedTerms = assignData.terms.map((t) => ({
              ...t,
              installments: (t.installments || []).map((inst) => {
                if (inst.id === installmentId || inst.label === installmentLabel) {
                  return { ...inst, status: "paid" };
                }
                return inst;
              }),
            }));
            updatePayload.terms = updatedTerms;
            updatePayload.updatedAt = now.toISOString();
          }
          if (Object.keys(updatePayload).length > 0) {
            transaction.update(assignRef, updatePayload);
          }
        }
      }

      return {
        success: true,
        paymentRecordId: paymentId,
        receiptNo,
        transactionId: paymentId,
        paidAt,
        message: "Payment successfully verified and posted to the official fee ledger.",
      };
    });

    // Central Audit Logging
    try {
      await db.collection("auditLogs").add({
        userId: callerUid,
        userName: studentName || "Online Student",
        role: "student",
        action: "create",
        entity: "fee_payment",
        entityId: paymentId,
        details: `Online Fee Payment verified: ₹${numAmount} for ${studentName} (${installmentLabel}) - Receipt: ${result.receiptNo}`,
        metadata: {
          orderId,
          paymentId,
          amount: numAmount,
          receiptNo: result.receiptNo,
          installmentId,
          assignmentId: assignmentId || null,
        },
        timestamp: now.toISOString(),
      });
    } catch (e) {
      console.warn("Could not write audit log:", e);
    }

    return result;
  }
);

/**
 * Razorpay Webhook Handler: Cryptographically verifies webhooks and records payments idempotently.
 */
exports.razorpayWebhook = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const signature = req.headers["x-razorpay-signature"];
    if (!signature) {
      res.status(400).send("Missing webhook signature");
      return;
    }

    try {
      const rawBody = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body);
      const expected = crypto
        .createHmac("sha256", getWebhookSecret())
        .update(rawBody)
        .digest("hex");

      const expectedBuf = Buffer.from(expected, "utf-8");
      const receivedBuf = Buffer.from(signature, "utf-8");
      if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
        res.status(400).send("Invalid webhook signature");
        return;
      }

      const event = req.body?.event;
      if (event === "payment.captured") {
        const paymentEntity = req.body?.payload?.payment?.entity;
        if (paymentEntity) {
          const paymentId = paymentEntity.id;
          const orderId = paymentEntity.order_id;
          const amount = paymentEntity.amount / 100; // Razorpay paisa to INR
          const notes = paymentEntity.notes || {};

          const paymentRef = db.collection("feePayments").doc(paymentId);
          const ledgerRef = db.collection("feeLedgerEntries").doc(`LEDGER_${paymentId}`);

          await db.runTransaction(async (t) => {
            const existing = await t.get(paymentRef);
            if (existing.exists) return; // Idempotent

            const now = new Date();
            const receiptNo = `RC-ONL-${now.getFullYear()}-${Date.now().toString().slice(-6)}`;

            t.set(paymentRef, {
              id: paymentId,
              orderId: orderId || null,
              paymentId,
              reference: paymentId,
              studentId: notes.studentId || null,
              studentUid: notes.studentUid || null,
              assignmentId: notes.assignmentId || null,
              amount,
              paymentMode: "online",
              paidAt: now.toISOString().slice(0, 10),
              receiptNo,
              verificationStatus: "verified",
              verifiedAt: now.toISOString(),
              recordedBy: "razorpay_webhook",
              notes: "Razorpay Webhook capture",
              createdAt: now.toISOString(),
            });

            if (notes.studentId) {
              t.set(ledgerRef, {
                studentId: notes.studentId,
                studentUid: notes.studentUid || null,
                assignmentId: notes.assignmentId || "",
                sessionId: notes.sessionId || "",
                type: "payment",
                description: `Online Gateway Payment — Receipt: ${receiptNo}`,
                amount: -amount,
                referenceId: paymentId,
                referenceType: "feePayment",
                verificationStatus: "verified",
                recordedBy: "razorpay_webhook",
                recordedByName: "Razorpay Gateway",
                createdAt: now.toISOString(),
              });
            }
          });
        }
      }

      res.status(200).json({ status: "ok" });
    } catch (err) {
      console.error("Webhook processing error:", err);
      res.status(500).send("Webhook handler error");
    }
  }
);

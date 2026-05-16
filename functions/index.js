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
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

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

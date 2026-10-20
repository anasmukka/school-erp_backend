/**
 * Authoritative Recipient Resolution Engine
 * Prestige International School ERP
 *
 * Resolves recipients exclusively from official ERP records in Firestore:
 * - students
 * - teachers
 * - users (parents, hods, staff)
 * - deviceTokens (registered push devices)
 *
 * Never accepts or fabricates arbitrary client-supplied phone numbers or emails.
 */

function normalizePhone(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  let digits = raw.replace(/[^\d]/g, "");

  // Common India formats:
  // 10 digits => prefix 91
  // 11 digits starting with 0 => drop 0 and prefix 91
  // already 12+ digits with country code => keep
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    digits = `91${digits}`;
  }

  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

function normalizeEmail(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(raw) ? raw : null;
}

/**
 * Resolves recipients for a published notice based on its target audience and grade filter.
 */
async function resolveNoticeRecipients(db, noticeData) {
  const audience = noticeData.targetAudience || "all";
  const targetGrade = noticeData.grade;
  const recipients = [];

  const includeStudents = ["all", "students", "students_and_parents"].includes(audience);
  const includeParents = ["all", "parents", "students_and_parents"].includes(audience);
  const includeTeachers = ["all", "teachers", "staff"].includes(audience);

  // 1. Resolve Students & Parents
  if (includeStudents || includeParents) {
    let q = db.collection("students");
    if (targetGrade && targetGrade !== "all") {
      q = q.where("grade", "==", targetGrade);
    }
    const studentSnap = await q.get();

    studentSnap.forEach((docSnap) => {
      const s = docSnap.data() || {};
      const studentId = docSnap.id;
      const studentUid = s.uid || s.studentUid || studentId;
      const studentName = s.studentName || s.name || "Student";
      const grade = s.grade || "";
      const section = s.section || s.sectionId || "";

      if (includeStudents) {
        recipients.push({
          recipientId: studentUid,
          recipientType: "student",
          name: studentName,
          email: normalizeEmail(s.email),
          phone: normalizePhone(s.phone || s.studentPhone),
          studentId,
          studentName,
          grade,
          section,
        });
      }

      if (includeParents) {
        const parentPhone = normalizePhone(s.parentContact || s.fatherContact || s.motherContact);
        const parentEmail = normalizeEmail(s.parentEmail || s.fatherEmail || s.motherEmail);
        const parentName = s.guardianName || s.fatherName || s.motherName || `Parent of ${studentName}`;

        recipients.push({
          recipientId: `parent_${studentId}`,
          recipientType: "parent",
          name: parentName,
          email: parentEmail,
          phone: parentPhone,
          studentId,
          studentName,
          grade,
          section,
        });
      }
    });
  }

  // 2. Resolve Teachers / Staff
  if (includeTeachers) {
    const teacherSnap = await db.collection("teachers").get();
    teacherSnap.forEach((docSnap) => {
      const t = docSnap.data() || {};
      recipients.push({
        recipientId: t.uid || docSnap.id,
        recipientType: "teacher",
        name: t.name || "Teacher",
        email: normalizeEmail(t.email),
        phone: normalizePhone(t.phone),
        grade: "",
        section: "",
      });
    });
  }

  return recipients;
}

/**
 * Resolves parent / guardian for a specific student.
 */
async function resolveParentForStudent(db, studentId) {
  if (!studentId) return null;

  const stuDoc = await db.collection("students").doc(studentId).get();
  if (!stuDoc.exists) {
    return null;
  }

  const s = stuDoc.data() || {};
  const studentName = s.studentName || s.name || "Student";
  const grade = s.grade || "";
  const section = s.section || s.sectionId || "";
  const parentPhone = normalizePhone(s.parentContact || s.fatherContact || s.motherContact);
  const parentEmail = normalizeEmail(s.parentEmail || s.fatherEmail || s.motherEmail);
  const parentName = s.guardianName || s.fatherName || s.motherName || `Parent of ${studentName}`;

  // Check if a linked parent user account exists
  let parentUid = null;
  const parentUsers = await db
    .collection("users")
    .where("role", "==", "parent")
    .where("linkedStudentUids", "array-contains", studentId)
    .limit(1)
    .get();

  if (!parentUsers.empty) {
    parentUid = parentUsers.docs[0].id;
  }

  return {
    recipientId: parentUid || `parent_${studentId}`,
    recipientType: "parent",
    uid: parentUid,
    name: parentName,
    email: parentEmail,
    phone: parentPhone,
    studentId,
    studentName,
    grade,
    section,
  };
}

/**
 * Fetches active FCM device registration tokens for a given ERP user UID.
 */
async function resolveDeviceTokensForUser(db, userId) {
  if (!userId) return [];
  try {
    const snap = await db
      .collection("deviceTokens")
      .where("userId", "==", userId)
      .where("valid", "==", true)
      .get();

    return snap.docs.map((d) => d.data().token).filter(Boolean);
  } catch (err) {
    console.warn(`Could not resolve device tokens for user ${userId}:`, err);
    return [];
  }
}

module.exports = {
  normalizePhone,
  normalizeEmail,
  resolveNoticeRecipients,
  resolveParentForStudent,
  resolveDeviceTokensForUser,
};

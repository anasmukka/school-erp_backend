import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { User } from "@/lib/types";
import { getActiveEnrollment } from "@/lib/enrollments";

export interface StaffProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  photo?: string;
  designation?: string;
  department?: string;
  subject?: string;
  employeeId?: string;
  role: string;
  DOB?: string;
  address?: string;
  hodIds?: string[];
  hodAssignments?: any[];
  createdAt?: string;
  joinedAt?: string;
}

export interface StudentProfile {
  id: string;
  name: string;
  email?: string;
  photo?: string;
  DOB?: string;
  gender?: string;
  parentContact?: string;
  fatherName?: string;
  motherName?: string;
  address?: string;
  studentUid?: string;
  admissionNo?: string;
  rollNo?: string;
  // From enrollment
  grade?: string;
  section?: string;
  academicYear?: string;
  sectionId?: string | null;
  // Class teacher
  classTeacherName?: string;
}

export interface ParentProfile {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  photo?: string;
  address?: string;
  role: string;
  linkedChildren: {
    studentId: string;
    studentName: string;
    grade?: string;
    section?: string;
    studentUid?: string;
    admissionNo?: string;
  }[];
}

/**
 * Fetch full staff profile data from the teachers collection.
 * Falls back to users doc if teacher doc not found.
 */
export async function fetchStaffProfile(appUser: User): Promise<StaffProfile> {
  const base: StaffProfile = {
    id: appUser.id,
    name: appUser.name,
    email: appUser.email,
    role: appUser.role,
    photo: appUser.photo,
    DOB: appUser.DOB,
  };

  // Try teachers collection first (for teacher/hod roles)
  if (appUser.role === "teacher" || appUser.role === "hod") {
    try {
      // First try staffDocId if available
      if (appUser.staffDocId) {
        const snap = await getDoc(doc(db, "teachers", appUser.staffDocId));
        if (snap.exists()) {
          const d = snap.data();
          return {
            ...base,
            id: snap.id,
            name: d.name || base.name,
            email: d.email || base.email,
            photo: d.photo || base.photo,
            phone: d.phone,
            designation: d.designation,
            department: d.department,
            subject: d.subject,
            employeeId: d.employeeId,
            DOB: d.DOB || base.DOB,
            address: d.address,
            hodIds: d.hodIds,
            hodAssignments: d.hodAssignments,
            createdAt: d.createdAt,
            joinedAt: d.joinedAt,
          };
        }
      }
      // Search by uid
      let snap2 = await getDocs(
        query(collection(db, "teachers"), where("uid", "==", appUser.id)),
      );
      if (snap2.empty && appUser.email) {
        snap2 = await getDocs(
          query(collection(db, "teachers"), where("email", "==", appUser.email)),
        );
      }
      if (!snap2.empty) {
        const d = snap2.docs[0].data();
        return {
          ...base,
          id: snap2.docs[0].id,
          name: d.name || base.name,
          email: d.email || base.email,
          photo: d.photo || base.photo,
          phone: d.phone,
          designation: d.designation,
          department: d.department,
          subject: d.subject,
          employeeId: d.employeeId,
          DOB: d.DOB || base.DOB,
          address: d.address,
          hodIds: d.hodIds,
          hodAssignments: d.hodAssignments,
          createdAt: d.createdAt,
          joinedAt: d.joinedAt,
        };
      }
    } catch (e) {
      console.error("Error fetching staff profile:", e);
    }
  }

  // For admin/accountant/printing/operations — use users doc only
  return base;
}

/**
 * Fetch full student profile with enrollment data.
 * Must be the student's own auth UID.
 */
export async function fetchStudentProfile(appUser: User): Promise<StudentProfile | null> {
  try {
    // Find the student document linked to this auth account
    let studentId: string | null = null;
    let studentData: any = null;

    // Strategy 1: studentUid on user doc points to student doc id
    if (appUser.studentUid) {
      const snap = await getDoc(doc(db, "students", appUser.studentUid));
      if (snap.exists()) {
        studentId = snap.id;
        studentData = snap.data();
      }
    }

    // Strategy 2: try auth UID as student doc ID
    if (!studentData) {
      const snap = await getDoc(doc(db, "students", appUser.id));
      if (snap.exists()) {
        studentId = snap.id;
        studentData = snap.data();
      }
    }

    // Strategy 3: query by authUid
    if (!studentData) {
      const snap = await getDocs(
        query(collection(db, "students"), where("authUid", "==", appUser.id)),
      );
      if (!snap.empty) {
        studentId = snap.docs[0].id;
        studentData = snap.docs[0].data();
      }
    }

    // Strategy 4: query by email
    if (!studentData && appUser.email) {
      const snap = await getDocs(
        query(collection(db, "students"), where("email", "==", appUser.email)),
      );
      if (!snap.empty) {
        studentId = snap.docs[0].id;
        studentData = snap.docs[0].data();
      }
    }

    if (!studentId || !studentData) return null;

    // Get active enrollment for grade/section/year
    const enrollment = await getActiveEnrollment(studentId);

    // Get class teacher name if sectionId is available
    let classTeacherName: string | undefined;
    const sectionId = enrollment?.sectionId || studentData.sectionId;
    if (sectionId) {
      try {
        const secSnap = await getDoc(doc(db, "sections", sectionId));
        if (secSnap.exists()) {
          const sec = secSnap.data();
          if (sec.classTeacherId) {
            const ctSnap = await getDoc(doc(db, "teachers", sec.classTeacherId));
            if (ctSnap.exists()) {
              classTeacherName = ctSnap.data().name;
            }
          }
        }
      } catch { /* ignore */ }
    }

    return {
      id: studentId,
      name: studentData.name || appUser.name,
      email: studentData.email || appUser.email,
      photo: studentData.photo || appUser.photo,
      DOB: studentData.DOB,
      gender: studentData.gender,
      parentContact: studentData.parentContact,
      fatherName: studentData.fatherName,
      motherName: studentData.motherName,
      address: studentData.address,
      studentUid: studentData.studentUid || studentData.uid,
      admissionNo: studentData.admissionNo,
      rollNo: enrollment?.rollNo || studentData.rollNo,
      grade: enrollment?.className || studentData.grade,
      section: enrollment?.sectionName || undefined,
      academicYear: enrollment?.academicYear,
      sectionId: enrollment?.sectionId || studentData.sectionId,
      classTeacherName,
    };
  } catch (e) {
    console.error("Error fetching student profile:", e);
    return null;
  }
}

/**
 * Fetch parent/guardian profile with linked children.
 */
export async function fetchParentProfile(appUser: User): Promise<ParentProfile> {
  const linkedChildren: ParentProfile["linkedChildren"] = [];

  const studentUids = appUser.linkedStudentUids || [];
  for (const uid of studentUids) {
    try {
      // Try student doc
      let studentDoc: any = null;
      let studentId = uid;
      const snap = await getDoc(doc(db, "students", uid));
      if (snap.exists()) {
        studentDoc = snap.data();
      } else {
        // Try by authUid
        const snap2 = await getDocs(
          query(collection(db, "students"), where("authUid", "==", uid)),
        );
        if (!snap2.empty) {
          studentId = snap2.docs[0].id;
          studentDoc = snap2.docs[0].data();
        }
      }
      if (!studentDoc) continue;

      const enrollment = await getActiveEnrollment(studentId);
      linkedChildren.push({
        studentId,
        studentName: studentDoc.name || "Unknown",
        grade: enrollment?.className || studentDoc.grade,
        section: enrollment?.sectionName || undefined,
        studentUid: studentDoc.studentUid || studentDoc.uid,
        admissionNo: studentDoc.admissionNo,
      });
    } catch { /* ignore */ }
  }

  return {
    id: appUser.id,
    name: appUser.name,
    email: appUser.email,
    photo: appUser.photo,
    role: appUser.role,
    linkedChildren,
  };
}

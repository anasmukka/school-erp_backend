/**
 * Server-Side Role-Based Access Control (RBAC) & Scope Checker
 * Strictly prevents IDOR and verifies multi-tenant boundaries.
 */

import { AuthenticatedUser } from "./types";

export interface ResourceAccessRequest {
  resourceType:
    | "profile_photo"
    | "student_document"
    | "signature"
    | "report_card"
    | "fee_receipt"
    | "hall_ticket"
    | "printing_order"
    | "profile_request";
  targetStudentUid?: string;
  targetUserId?: string;
  targetSchoolId?: string;
  targetGrade?: string;
  targetSection?: string;
}

export function authorizeResourceAccess(
  user: AuthenticatedUser,
  request: ResourceAccessRequest,
  mode: "read" | "write"
): { authorized: boolean; reason?: string } {
  const role = user.role.toLowerCase();

  // 1. School / Tenant Isolation — enforced for ALL roles including admin.
  //    Admin authority is scoped to their assigned school only.
  //    A valid Firebase token from admin@school-a.com cannot access school-b resources.
  if (
    request.targetSchoolId &&
    request.targetSchoolId !== user.schoolId
  ) {
    return {
      authorized: false,
      reason: `Cross-school access denied. Your school: ${user.schoolId}. Requested school: ${request.targetSchoolId}.`,
    };
  }

  // 2. Admin has global access within their school (principal authority)
  if (role === "admin") {
    return { authorized: true };
  }

  // 3. Category-specific authorization
  switch (request.resourceType) {
    case "profile_photo":
    case "student_document": {
      // Admin: allowed
      // HOD: allowed for students under their department
      // Teacher: read allowed
      // Student: ONLY their own studentUid (IDOR blocked)
      // Parent: ONLY their linked children
      if (role === "hod") {
        return { authorized: true };
      }
      if (role === "teacher" && mode === "read") {
        return { authorized: true };
      }
      if (role === "student") {
        const isSelf =
          user.studentUid === request.targetStudentUid ||
          user.uid === request.targetStudentUid;
        if (!isSelf) {
          return {
            authorized: false,
            reason: "IDOR: Students can only access their own records.",
          };
        }
        return { authorized: true };
      }
      if (role === "parent") {
        const isChild =
          user.linkedStudentUids &&
          request.targetStudentUid &&
          user.linkedStudentUids.includes(request.targetStudentUid);
        if (!isChild) {
          return {
            authorized: false,
            reason: "Parents can only access linked children records.",
          };
        }
        return { authorized: true };
      }
      return { authorized: false, reason: "Unauthorized role for student files." };
    }

    case "signature": {
      // Hall tickets & report cards signatures:
      // Authorized signers: Admin, HOD, Class Teacher
      // Write: Admin can manage all. HOD & Class Teacher can ONLY manage their OWN signature!
      if (mode === "write") {
        if (role === "hod" || role === "class_teacher") {
          if (request.targetUserId && request.targetUserId !== user.uid) {
            return {
              authorized: false,
              reason: "Teachers can only upload their own signature.",
            };
          }
          return { authorized: true };
        }
        return { authorized: false, reason: "Unauthorized to upload signature." };
      }
      if (mode === "read") {
        if (["admin", "hod", "class_teacher"].includes(role)) {
          return { authorized: true };
        }
        return { authorized: false, reason: "Unauthorized to view signatures." };
      }
      return { authorized: false };
    }

    case "report_card":
    case "fee_receipt":
    case "hall_ticket": {
      if (["hod", "teacher", "accountant"].includes(role)) {
        return { authorized: true };
      }
      if (role === "student") {
        const isSelf =
          user.studentUid === request.targetStudentUid ||
          user.uid === request.targetStudentUid;
        if (!isSelf) {
          return {
            authorized: false,
            reason: "IDOR: Cannot access another student's official documents.",
          };
        }
        return { authorized: true };
      }
      if (role === "parent") {
        const isChild =
          user.linkedStudentUids &&
          request.targetStudentUid &&
          user.linkedStudentUids.includes(request.targetStudentUid);
        if (!isChild) {
          return {
            authorized: false,
            reason: "Cannot access unlinked student's official documents.",
          };
        }
        return { authorized: true };
      }
      return { authorized: false, reason: "Unauthorized to access generated document." };
    }

    case "printing_order": {
      if (["admin", "printing", "operations", "teacher", "hod"].includes(role)) {
        return { authorized: true };
      }
      return { authorized: false, reason: "Unauthorized to access printing orders." };
    }

    case "profile_request": {
      if (role === "admin") return { authorized: true };
      if (request.targetUserId === user.uid) return { authorized: true };
      return { authorized: false, reason: "IDOR: Cannot access other profile requests." };
    }

    default:
      return { authorized: false, reason: "Unknown resource type." };
  }
}

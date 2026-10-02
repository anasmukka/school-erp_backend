/**
 * Cloudflare Worker Environment Interface & Type Definitions
 */

export interface Env {
  STORAGE_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  SCHOOL_ID: string;
  FIREBASE_PROJECT_ID: string;
  /**
   * Comma-separated list of allowed frontend origins for CORS.
   * Example: https://erp.prestigeschool.com,https://staging.erp.prestigeschool.com
   * MUST be set in production. No wildcard (*) allowed.
   */
  WORKER_ALLOWED_ORIGINS: string;
  // Secrets & Public Gateway Identifiers
  FIREBASE_SERVICE_ACCOUNT_KEY?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
}

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  role: string;
  schoolId: string;
  name?: string;
  studentUid?: string;
  studentId?: string;
  linkedStudentUids?: string[];
  assignedGrade?: string;
  assignedSection?: string;
  assignedSubject?: string;
}

export type PermissionScope =
  | "GLOBAL"
  | "DEPARTMENT"
  | "CLASS_ASSIGNED"
  | "SELF"
  | "PARENT_CHILD";

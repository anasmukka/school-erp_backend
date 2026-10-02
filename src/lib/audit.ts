import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AuditActionType, AuditEntityType, AuditLogRecord, Role } from "@/lib/types";

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /passcode/i,
  /secret/i,
  /token/i,
  /credential/i,
  /salt/i,
  /hash/i,
  /plainPassword/i,
  /tempPassword/i,
];

/**
 * Recursively redacts sensitive authentication keys from metadata and details objects.
 */
export function sanitizeAuditData<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditData(item)) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeAuditData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized as T;
}

export interface LogAuditParams {
  userId: string;
  userName: string;
  role: Role;
  action: AuditActionType;
  entity: AuditEntityType;
  entityId: string;
  details: string;
  metadata?: Record<string, unknown>;
}

/**
 * Creates an immutable audit log entry in the `auditLogs` Firestore collection.
 * Errors are caught and logged to console to prevent blocking primary business flows.
 * Redacts any sensitive authentication credentials from details and metadata.
 */
export async function logAuditEvent(params: LogAuditParams): Promise<string | null> {
  if (!db) return null;
  try {
    const sanitizedMetadata = sanitizeAuditData(params.metadata || {});
    const record: Omit<AuditLogRecord, "id"> = {
      userId: params.userId,
      userName: params.userName,
      role: params.role,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      details: params.details,
      metadata: sanitizedMetadata,
      timestamp: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, "auditLogs"), record);
    return docRef.id;
  } catch (error) {
    console.error("Failed to write audit log:", error);
    return null;
  }
}

export interface LogAcademicAuditParams {
  action: string;
  module: "academic_structure" | "marks" | "exam_schedule" | "results";
  targetId: string;
  targetName: string;
  sessionId?: string;
  academicYear?: string;
  grade?: string;
  sectionId?: string;
  subjectId?: string;
  details?: Record<string, unknown> | string;
  performedBy: {
    uid: string;
    name: string;
    role: string;
  };
}

/**
 * Creates an audit log entry for academic operations (academic structure modifications, marks workflow, publication).
 * Redacts any sensitive authentication credentials from details and metadata.
 */
export async function logAcademicAudit(params: LogAcademicAuditParams): Promise<string | null> {
  if (!db) return null;
  try {
    const sanitizedDetails = typeof params.details === "object" && params.details !== null
      ? sanitizeAuditData(params.details)
      : params.details;
    const detailsStr = typeof sanitizedDetails === "string" 
      ? sanitizedDetails 
      : JSON.stringify(sanitizedDetails || {});

    const record = {
      userId: params.performedBy.uid,
      userName: params.performedBy.name,
      role: params.performedBy.role,
      action: params.action,
      entity: params.module,
      entityId: params.targetId,
      entityName: params.targetName,
      details: detailsStr,
      sessionId: params.sessionId || null,
      academicYear: params.academicYear || null,
      grade: params.grade || null,
      sectionId: params.sectionId || null,
      subjectId: params.subjectId || null,
      metadata: typeof sanitizedDetails === "object" ? sanitizedDetails : {},
      timestamp: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, "auditLogs"), record);
    return docRef.id;
  } catch (error) {
    console.error("Failed to write academic audit log:", error);
    return null;
  }
}

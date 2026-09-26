import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AuditActionType, AuditEntityType, AuditLogRecord, Role } from "@/lib/types";

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
 */
export async function logAuditEvent(params: LogAuditParams): Promise<string | null> {
  if (!db) return null;
  try {
    const record: Omit<AuditLogRecord, "id"> = {
      userId: params.userId,
      userName: params.userName,
      role: params.role,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      details: params.details,
      metadata: params.metadata || {},
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
 */
export async function logAcademicAudit(params: LogAcademicAuditParams): Promise<string | null> {
  if (!db) return null;
  try {
    const detailsStr = typeof params.details === "string" ? params.details : JSON.stringify(params.details || {});
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
      metadata: typeof params.details === "object" ? params.details : {},
      timestamp: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, "auditLogs"), record);
    return docRef.id;
  } catch (error) {
    console.error("Failed to write academic audit log:", error);
    return null;
  }
}

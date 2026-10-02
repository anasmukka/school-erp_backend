/**
 * Unified Cloudflare R2 & File Storage Key Utility
 *
 * Implements predictable, secure, tenant/school/session-aware paths:
 * - schools/{schoolId}/students/{studentUid}/profile.{ext}
 * - schools/{schoolId}/students/{studentUid}/documents/{docId}.{ext}
 * - schools/{schoolId}/signatures/{userId}/{versionId}.{ext}
 * - schools/{schoolId}/report-cards/{sessionId}/{studentUid}/{reportCardId}.pdf
 * - schools/{schoolId}/receipts/{sessionId}/{studentUid}/{receiptId}.pdf
 * - schools/{schoolId}/certificates/{sessionId}/{studentUid}/{certificateId}.pdf
 * - schools/{schoolId}/hall-tickets/{sessionId}/{studentUid}/{hallTicketId}.pdf
 * - schools/{schoolId}/printing-orders/{orderId}/{cleanFileName}
 * - schools/{schoolId}/profile-requests/{requestId}/{cleanFileName}
 */

export const DEFAULT_SCHOOL_ID = "prestige";

export interface R2ObjectMetadata {
  objectKey: string;
  contentType: string;
  sizeBytes?: number;
  uploadedAt: string;
  uploadedBy?: string;
  schoolId?: string;
  checksumSha256?: string;
  publicUrl?: string;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getFileExtension(filenameOrMime: string): string {
  if (filenameOrMime.includes("/")) {
    switch (filenameOrMime.toLowerCase()) {
      case "image/jpeg":
      case "image/jpg":
        return "jpg";
      case "image/png":
        return "png";
      case "image/webp":
        return "webp";
      case "application/pdf":
        return "pdf";
      default:
        return "bin";
    }
  }
  const parts = filenameOrMime.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "bin";
}

export const R2KeyBuilders = {
  studentProfilePhoto(params: { schoolId?: string; studentUid: string; ext?: string }): string {
    const school = params.schoolId || DEFAULT_SCHOOL_ID;
    const ext = params.ext || "webp";
    return `schools/${school}/students/${params.studentUid}/profile.${ext}`;
  },

  studentDocument(params: { schoolId?: string; studentUid: string; documentId: string; ext?: string }): string {
    const school = params.schoolId || DEFAULT_SCHOOL_ID;
    const ext = params.ext || "pdf";
    return `schools/${school}/students/${params.studentUid}/documents/${params.documentId}.${ext}`;
  },

  signature(params: { schoolId?: string; userId: string; signatureVersion: string | number; ext?: string }): string {
    const school = params.schoolId || DEFAULT_SCHOOL_ID;
    const ext = params.ext || "webp";
    const v = String(params.signatureVersion).startsWith("v") ? params.signatureVersion : `v${params.signatureVersion}`;
    return `schools/${school}/signatures/${params.userId}/${v}.${ext}`;
  },

  reportCard(params: { schoolId?: string; academicSessionId: string; studentUid: string; reportCardId: string }): string {
    const school = params.schoolId || DEFAULT_SCHOOL_ID;
    return `schools/${school}/report-cards/${params.academicSessionId}/${params.studentUid}/${params.reportCardId}.pdf`;
  },

  receipt(params: { schoolId?: string; academicSessionId: string; studentUid: string; receiptId: string }): string {
    const school = params.schoolId || DEFAULT_SCHOOL_ID;
    return `schools/${school}/receipts/${params.academicSessionId}/${params.studentUid}/${params.receiptId}.pdf`;
  },

  certificate(params: { schoolId?: string; academicSessionId: string; studentUid: string; certificateId: string }): string {
    const school = params.schoolId || DEFAULT_SCHOOL_ID;
    return `schools/${school}/certificates/${params.academicSessionId}/${params.studentUid}/${params.certificateId}.pdf`;
  },

  hallTicket(params: { schoolId?: string; academicSessionId: string; studentUid: string; hallTicketId: string }): string {
    const school = params.schoolId || DEFAULT_SCHOOL_ID;
    return `schools/${school}/hall-tickets/${params.academicSessionId}/${params.studentUid}/${params.hallTicketId}.pdf`;
  },

  printingOrder(params: { schoolId?: string; orderId: string; fileName: string }): string {
    const school = params.schoolId || DEFAULT_SCHOOL_ID;
    const clean = sanitizeFileName(params.fileName);
    return `schools/${school}/printing-orders/${params.orderId}/${clean}`;
  },

  profileChangeRequest(params: { schoolId?: string; requestId: string; fileName: string }): string {
    const school = params.schoolId || DEFAULT_SCHOOL_ID;
    const clean = sanitizeFileName(params.fileName);
    return `schools/${school}/profile-requests/${params.requestId}/${clean}`;
  },
};

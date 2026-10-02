import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  addDoc,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "./firebase";
import { logAcademicAudit } from "./audit";

// ============================================================
// TYPES
// ============================================================

/**
 * Only these three roles are authorized to have ERP signatures.
 * - admin: The Principal / Admin authority.
 * - hod: Head of Department.
 * - class_teacher: Class Teacher (assigned to a section).
 *
 * Subject teachers, students, parents, accounts, printing, and operations
 * are NOT authorized signatories and must never appear here.
 */
export type SignatoryRole = "admin" | "hod" | "class_teacher";

export type SignatureStatus = "active" | "deactivated";

/**
 * Document types that support institutional e-signatures.
 *
 * Permission matrix (enforced by DOCUMENT_SIGN_PERMISSIONS):
 *   report_card  → admin, hod, class_teacher
 *   hall_ticket  → admin ONLY
 *   official_notice → admin, hod
 *   transfer_certificate → admin ONLY
 */
export type OfficialDocumentType =
  | "report_card"
  | "hall_ticket"
  | "transfer_certificate"
  | "official_notice";

/**
 * Roles allowed to sign each document type.
 * This is the authoritative permission matrix — enforced in both the UI and the placement engine.
 */
export const DOCUMENT_SIGN_PERMISSIONS: Record<OfficialDocumentType, SignatoryRole[]> = {
  report_card: ["admin", "hod", "class_teacher"],
  hall_ticket: ["admin"],
  transfer_certificate: ["admin"],
  official_notice: ["admin", "hod"],
};

export function canSignDocument(role: SignatoryRole, docType: OfficialDocumentType): boolean {
  return DOCUMENT_SIGN_PERMISSIONS[docType]?.includes(role) ?? false;
}

// ============================================================
// AUDIT
// ============================================================

export interface SignatureAuditEntry {
  action: "create" | "update" | "activate" | "deactivate" | "version_upload" | "authorized";
  performedByUid: string;
  performedByName: string;
  timestamp: string;
  versionId?: string;
  notes?: string;
}

// ============================================================
// VERSIONED SIGNATURE IMAGE
// ============================================================

/**
 * A single version of a user's signature image.
 * Each upload creates a new version. Only one version is "current".
 * Once a document is finalized with a specific versionId, that versionId
 * is stored on the finalized document snapshot — old documents NEVER change
 * when a user uploads a new signature version.
 */
export interface SignatureVersion {
  versionId: string;       // Unique ID for this version
  versionNumber: number;   // Sequential: 1, 2, 3...
  storagePath: string;     // Firebase Storage path (e.g. "signatures/{userId}/v3.png")
  downloadUrl: string;     // Public download URL
  uploadedAt: string;      // ISO timestamp
  uploadedBy: string;      // UID of the uploader
  uploadedByName: string;  // Display name of uploader
  isCurrent: boolean;      // Only one version per user is current
  fileSizeBytes?: number;
  mimeType?: string;
}

// ============================================================
// SIGNATURE RECORD (PRIMARY PROFILE)
// ============================================================

/**
 * The master signature profile for an authorized signatory.
 * Stored at: signatures/{userId}
 *
 * The active signature image URL is always the downloadUrl of the
 * version where isCurrent === true (or activeVersionId points to).
 */
export interface SignatureRecord {
  id: string;               // = userId (Firebase Auth UID)
  userId: string;           // Firebase Auth UID
  staffId?: string;         // ERP staff Firestore document ID (may differ from Auth UID)
  role: SignatoryRole;
  name: string;             // Display name of the signatory
  designation: string;      // Print label: "Principal", "Head of Department", "Class Teacher"
  imageUrl: string;         // Current active signature image download URL (denormalized for fast reads)
  activeVersionId: string;  // Points to the current SignatureVersion versionId
  activeVersionNumber: number;
  status: SignatureStatus;
  authorizedDocumentTypes: OfficialDocumentType[];
  authorizedBy: string;     // Admin UID who authorized this signature
  authorizedByName?: string;
  authorizedAt: string;
  history: SignatureAuditEntry[];
  versions: SignatureVersion[];  // All uploaded versions, newest first
  updatedAt: string;
}

// ============================================================
// DOCUMENT SIGNATORY CONFIGURATION
// ============================================================

export interface DocumentSignatorySlot {
  slotId: string;
  label: string;        // Display label on document (e.g. "Principal", "Class Teacher")
  role: SignatoryRole;  // Underlying ERP authorization role
  required: boolean;
  order: number;
}

export interface DocumentSignatoryConfig {
  id: OfficialDocumentType;
  documentType: OfficialDocumentType;
  title: string;
  description: string;
  slots: DocumentSignatorySlot[];
  updatedAt: string;
  updatedBy: string;
  updatedByName?: string;
}

export const DEFAULT_SIGNATORY_CONFIGS: DocumentSignatoryConfig[] = [
  {
    id: "report_card",
    documentType: "report_card",
    title: "Official Student Report Card",
    description:
      "Three-tier signatory workflow: Class Teacher, Section Head / HOD, and Principal.",
    slots: [
      { slotId: "class_teacher", label: "Class Teacher", role: "class_teacher", required: true, order: 1 },
      { slotId: "hod", label: "Section Head / HOD", role: "hod", required: true, order: 2 },
      { slotId: "admin", label: "Principal", role: "admin", required: true, order: 3 },
    ],
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  },
  {
    id: "hall_ticket",
    documentType: "hall_ticket",
    title: "Examination Admit Card / Hall Ticket",
    description: "Official institutional hall tickets with principal authorization.",
    slots: [
      { slotId: "admin", label: "Principal & Seal", role: "admin", required: true, order: 1 },
    ],
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  },
  {
    id: "official_notice",
    documentType: "official_notice",
    title: "Official School Notice",
    description: "Notices may be signed by the Principal (Admin) or HOD.",
    slots: [
      { slotId: "admin", label: "Principal", role: "admin", required: false, order: 1 },
      { slotId: "hod", label: "Head of Department", role: "hod", required: false, order: 2 },
    ],
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  },
];

// ============================================================
// UPLOAD HELPERS
// ============================================================

export interface SignatureUploadResult {
  downloadUrl: string;
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
}

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Validates a signature image file before upload.
 */
export function validateSignatureImageFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return "Only PNG, JPG/JPEG, or WebP images are accepted for signatures.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "Signature image must be smaller than 2 MB.";
  }
  return null;
}

/**
 * Uploads a signature image to Firebase Storage.
 * Path: signatures/{userId}/v{version}_{timestamp}.{ext}
 */
export async function uploadSignatureImage(
  file: File,
  userId: string,
  nextVersionNumber: number,
  onProgress?: (percent: number) => void
): Promise<SignatureUploadResult> {
  const validationError = validateSignatureImageFile(file);
  if (validationError) throw new Error(validationError);

  const { uploadObject } = await import("./objectStorage");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const objectKey = `schools/prestige/signatures/${userId}/v${nextVersionNumber}_${Date.now()}.${ext}`;

  const result = await uploadObject({
    file,
    category: "signature",
    resourceType: "signature",
    userId,
    objectKey,
    onProgress,
  });

  return {
    downloadUrl: result.downloadUrl,
    storagePath: result.storagePath,
    mimeType: result.mimeType,
    fileSizeBytes: result.fileSizeBytes,
  };
}

// ============================================================
// FIRESTORE READ HELPERS
// ============================================================

/**
 * Fetch all registered signatures from Firestore.
 * Only returns records with authorized roles (admin, hod, class_teacher).
 */
export async function getSignatures(filters?: {
  role?: SignatoryRole;
  status?: SignatureStatus;
}): Promise<SignatureRecord[]> {
  try {
    const snap = await getDocs(collection(db, "signatures"));
    let results: SignatureRecord[] = snap.docs
      .map((d) => {
        const data = d.data();
        return {
          ...data,
          id: d.id,
          userId: data.userId || d.id,
          role: data.role || "admin",
          name: data.name || "",
          designation: data.designation || "",
          imageUrl: data.imageUrl || "",
          activeVersionId: data.activeVersionId || "",
          activeVersionNumber: data.activeVersionNumber || 1,
          status: data.status || "active",
          authorizedDocumentTypes: data.authorizedDocumentTypes || ["report_card"],
          authorizedBy: data.authorizedBy || "",
          authorizedByName: data.authorizedByName || "",
          authorizedAt: data.authorizedAt || data.updatedAt || "",
          history: data.history || [],
          versions: data.versions || [],
          updatedAt: data.updatedAt || "",
        } as SignatureRecord;
      })
      // Only return authorized signatory roles
      .filter((s) => ["admin", "hod", "class_teacher"].includes(s.role));

    if (filters?.role) {
      results = results.filter((s) => s.role === filters.role);
    }
    if (filters?.status) {
      results = results.filter((s) => s.status === filters.status);
    }

    return results;
  } catch (err) {
    console.error("Failed to fetch signatures:", err);
    return [];
  }
}

/**
 * Gets a single signature record by user ID.
 */
export async function getSignatureForUser(userId: string): Promise<SignatureRecord | null> {
  try {
    const snap = await getDoc(doc(db, "signatures", userId));
    if (!snap.exists()) return null;
    const data = snap.data() as SignatureRecord;
    if (!["admin", "hod", "class_teacher"].includes(data.role)) return null;
    return { ...data, id: snap.id };
  } catch {
    return null;
  }
}

/**
 * Gets the active signature for a given role.
 * Used by PDF generators to resolve signatories.
 */
export async function getActiveSignatureForRole(
  role: SignatoryRole
): Promise<SignatureRecord | null> {
  try {
    const q = query(
      collection(db, "signatures"),
      where("role", "==", role),
      where("status", "==", "active")
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as SignatureRecord;
  } catch (err) {
    console.error("getActiveSignatureForRole failed:", role, err);
    return null;
  }
}

/**
 * Gets the specific signature version by versionId.
 * Used when rendering FINALIZED documents to ensure the historical version
 * is used — not the user's current active signature.
 */
export async function getSignatureVersion(
  userId: string,
  versionId: string
): Promise<SignatureVersion | null> {
  try {
    const rec = await getSignatureForUser(userId);
    if (!rec) return null;
    return rec.versions.find((v) => v.versionId === versionId) ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// FIRESTORE WRITE HELPERS
// ============================================================

/**
 * Publishes a new signature version for a user.
 * - Creates the signature profile if it doesn't exist.
 * - Adds the new version to the versions array.
 * - Sets the new version as current.
 * - Updates the denormalized imageUrl on the profile.
 *
 * Access control:
 * - Admin can manage any authorized signatory's signature.
 * - HOD / class_teacher can only manage their OWN signature.
 */
export async function publishSignatureVersion(
  params: {
    userId: string;
    role: SignatoryRole;
    name: string;
    designation: string;
    authorizedDocumentTypes: OfficialDocumentType[];
    downloadUrl: string;
    storagePath: string;
    mimeType: string;
    fileSizeBytes: number;
    staffId?: string;
  },
  actor: { uid: string; name: string; role: string }
): Promise<void> {
  const isAdmin = actor.role === "admin";
  const isSelf = actor.uid === params.userId;

  if (!isAdmin && !isSelf) {
    throw new Error("Unauthorized: You can only manage your own signature.");
  }

  // Role must be an authorized signatory role
  if (!["admin", "hod", "class_teacher"].includes(params.role)) {
    throw new Error("Unauthorized: Only Admin, HOD, and Class Teacher roles may have signatures.");
  }

  // Document type permission check
  const invalidDocs = params.authorizedDocumentTypes.filter(
    (d) => !canSignDocument(params.role, d)
  );
  if (invalidDocs.length > 0) {
    throw new Error(
      `Role '${params.role}' is not permitted to sign: ${invalidDocs.join(", ")}.`
    );
  }

  const now = new Date().toISOString();
  const existingDoc = await getDoc(doc(db, "signatures", params.userId));
  const existing = existingDoc.exists()
    ? (existingDoc.data() as SignatureRecord)
    : null;

  const existingVersions: SignatureVersion[] = existing?.versions ?? [];
  const nextVersionNumber = existingVersions.length + 1;
  const versionId = `v${nextVersionNumber}_${Date.now().toString(36)}`;

  const newVersion: SignatureVersion = {
    versionId,
    versionNumber: nextVersionNumber,
    storagePath: params.storagePath,
    downloadUrl: params.downloadUrl,
    uploadedAt: now,
    uploadedBy: actor.uid,
    uploadedByName: actor.name,
    isCurrent: true,
    fileSizeBytes: params.fileSizeBytes,
    mimeType: params.mimeType,
  };

  // Mark all previous versions as not current
  const updatedVersions: SignatureVersion[] = [
    ...existingVersions.map((v) => ({ ...v, isCurrent: false })),
    newVersion,
  ];

  const auditEntry: SignatureAuditEntry = {
    action: "version_upload",
    performedByUid: actor.uid,
    performedByName: actor.name,
    timestamp: now,
    versionId,
    notes: `Signature v${nextVersionNumber} uploaded${isAdmin && !isSelf ? " by Admin" : ""}.`,
  };

  const payload: SignatureRecord = {
    id: params.userId,
    userId: params.userId,
    staffId: params.staffId || existing?.staffId || params.userId,
    role: params.role,
    name: params.name,
    designation: params.designation,
    imageUrl: params.downloadUrl,
    activeVersionId: versionId,
    activeVersionNumber: nextVersionNumber,
    status: existing?.status ?? "active",
    authorizedDocumentTypes: params.authorizedDocumentTypes,
    authorizedBy: isAdmin ? actor.uid : existing?.authorizedBy ?? actor.uid,
    authorizedByName: isAdmin ? actor.name : existing?.authorizedByName ?? actor.name,
    authorizedAt: isAdmin ? now : existing?.authorizedAt ?? now,
    history: [...(existing?.history ?? []), auditEntry],
    versions: updatedVersions,
    updatedAt: now,
  };

  await setDoc(doc(db, "signatures", params.userId), payload);

  await logAcademicAudit({
    action: "create",
    module: "signatures",
    targetId: params.userId,
    targetName: `Signature v${nextVersionNumber} for ${params.name} (${params.role})`,
    details: {
      versionId,
      versionNumber: nextVersionNumber,
      role: params.role,
      authorizedDocs: params.authorizedDocumentTypes,
    },
    performedBy: {
      uid: actor.uid,
      name: actor.name,
      role: actor.role as any,
    },
  });
}

/**
 * Updates metadata on a signature profile (name, designation, authorized docs).
 * Does NOT replace the signature image; use publishSignatureVersion for that.
 */
export async function updateSignatureMetadata(
  userId: string,
  updates: {
    name?: string;
    designation?: string;
    authorizedDocumentTypes?: OfficialDocumentType[];
  },
  actor: { uid: string; name: string; role: string }
): Promise<void> {
  const isAdmin = actor.role === "admin";
  const isSelf = actor.uid === userId;

  if (!isAdmin && !isSelf) {
    throw new Error("Unauthorized: You can only manage your own signature.");
  }

  const existing = await getSignatureForUser(userId);
  if (!existing) {
    throw new Error("Signature profile not found. Upload a signature first.");
  }

  if (updates.authorizedDocumentTypes) {
    const invalidDocs = updates.authorizedDocumentTypes.filter(
      (d) => !canSignDocument(existing.role, d)
    );
    if (invalidDocs.length > 0) {
      throw new Error(
        `Role '${existing.role}' is not permitted to sign: ${invalidDocs.join(", ")}.`
      );
    }
  }

  const now = new Date().toISOString();
  await updateDoc(doc(db, "signatures", userId), {
    ...(updates.name !== undefined && { name: updates.name }),
    ...(updates.designation !== undefined && { designation: updates.designation }),
    ...(updates.authorizedDocumentTypes !== undefined && {
      authorizedDocumentTypes: updates.authorizedDocumentTypes,
    }),
    updatedAt: now,
  });
}

/**
 * Activates or deactivates a signature.
 * Restricted to Admin only.
 */
export async function toggleSignatureStatus(
  userId: string,
  newStatus: SignatureStatus,
  actor: { uid: string; name: string; role: string },
  reason?: string
): Promise<void> {
  if (actor.role !== "admin") {
    throw new Error("Unauthorized: Only the Admin can activate or deactivate signatures.");
  }

  const now = new Date().toISOString();
  const existingDoc = await getDoc(doc(db, "signatures", userId));
  if (!existingDoc.exists()) {
    throw new Error("Signature not found.");
  }

  const existing = existingDoc.data() as SignatureRecord;
  const auditEntry: SignatureAuditEntry = {
    action: newStatus === "active" ? "activate" : "deactivate",
    performedByUid: actor.uid,
    performedByName: actor.name,
    timestamp: now,
    notes: reason ?? `Status changed to ${newStatus} by Admin`,
  };

  await updateDoc(doc(db, "signatures", userId), {
    status: newStatus,
    history: [...(existing.history ?? []), auditEntry],
    updatedAt: now,
  });

  await logAcademicAudit({
    action: "status_change",
    module: "signatures",
    targetId: userId,
    targetName: `Signature Status (${existing.name}) → ${newStatus}`,
    details: { status: newStatus, reason },
    performedBy: {
      uid: actor.uid,
      name: actor.name,
      role: actor.role as any,
    },
  });
}

// ============================================================
// ============================================================
// DOCUMENT SIGNATORY CONFIG
// ============================================================

/**
 * Authoritatively sanitizes a document signatory configuration.
 * For Hall Tickets: strictly enforces exactly ONE slot: Principal & Seal (role: 'admin', required: true).
 * Completely strips any Candidate, Student, Teacher, or Class Teacher slots from Hall Tickets.
 * For other documents: filters slots against DOCUMENT_SIGN_PERMISSIONS.
 */
export function sanitizeSignatoryConfig(config: DocumentSignatoryConfig): DocumentSignatoryConfig {
  if (config.documentType === "hall_ticket") {
    return {
      ...config,
      id: "hall_ticket",
      documentType: "hall_ticket",
      title: "Examination Admit Card / Hall Ticket",
      description: "Official institutional hall tickets with principal authorization.",
      slots: [
        {
          slotId: "admin",
          label: "Principal & Seal",
          role: "admin",
          required: true,
          order: 1,
        },
      ],
      updatedAt: config.updatedAt || new Date().toISOString(),
      updatedBy: config.updatedBy || "system",
      updatedByName: config.updatedByName,
    };
  }

  const allowedRoles = DOCUMENT_SIGN_PERMISSIONS[config.documentType] || [];
  const cleanSlots = (config.slots || [])
    .filter((slot) => allowedRoles.includes(slot.role))
    .map((slot, idx) => ({ ...slot, order: idx + 1 }));

  return {
    ...config,
    slots: cleanSlots,
  };
}

export async function getDocumentSignatoryConfigs(): Promise<DocumentSignatoryConfig[]> {
  try {
    const snap = await getDocs(collection(db, "signatureConfigs"));
    if (snap.empty) return DEFAULT_SIGNATORY_CONFIGS.map(sanitizeSignatoryConfig);

    const configs: DocumentSignatoryConfig[] = [];
    for (const d of snap.docs) {
      const raw = { id: d.id, ...d.data() } as DocumentSignatoryConfig;
      const clean = sanitizeSignatoryConfig(raw);
      configs.push(clean);

      // Self-heal Firestore if stored config contained invalid/deprecated slots (e.g. candidate or teacher in hall_ticket)
      if (
        raw.documentType === "hall_ticket" &&
        (raw.slots?.length !== 1 || raw.slots[0]?.role !== "admin" || raw.slots[0]?.slotId !== "admin")
      ) {
        void setDoc(doc(db, "signatureConfigs", "hall_ticket"), clean, { merge: true }).catch(() => {});
      }
    }

    // Ensure all default document types are present
    for (const def of DEFAULT_SIGNATORY_CONFIGS) {
      if (!configs.some((c) => c.documentType === def.documentType)) {
        configs.push(sanitizeSignatoryConfig(def));
      }
    }

    return configs;
  } catch {
    return DEFAULT_SIGNATORY_CONFIGS.map(sanitizeSignatoryConfig);
  }
}

export async function saveDocumentSignatoryConfig(
  config: DocumentSignatoryConfig,
  actor: { uid: string; name: string; role: string }
): Promise<void> {
  if (actor.role !== "admin") {
    throw new Error("Unauthorized: Only the Admin can configure document signatories.");
  }

  // Authoritatively sanitize before saving — rejects/strips any invalid slots
  const sanitized = sanitizeSignatoryConfig(config);

  const now = new Date().toISOString();
  await setDoc(doc(db, "signatureConfigs", sanitized.id), {
    ...sanitized,
    updatedAt: now,
    updatedBy: actor.uid,
    updatedByName: actor.name,
  });

  await logAcademicAudit({
    action: "update",
    module: "signatures",
    targetId: sanitized.id,
    targetName: `Signatory Config for ${sanitized.title}`,
    details: { slots: sanitized.slots },
    performedBy: {
      uid: actor.uid,
      name: actor.name,
      role: actor.role as any,
    },
  });
}

// ============================================================
// SIGNATURE PLACEMENT ENGINE
// ============================================================

export interface ResolvedSignatory {
  slot: DocumentSignatorySlot;
  signature: SignatureRecord | null;
  /** The specific version to use for this rendering pass. null = no image available. */
  version: SignatureVersion | null;
  /** Whether this slot is satisfied (signature exists and is active). */
  isSatisfied: boolean;
}

/**
 * Resolves all signatory slots for a given document type.
 * Returns metadata for each slot with the active signature and version.
 *
 * For Hall Tickets: Strictly resolves the Admin (Principal) signature slot ONLY.
 * For Report Cards: Resolves Class Teacher, HOD, and Admin.
 * For Notices: Resolves Admin and HOD.
 *
 * Use this before finalizing any document. If any required slot is not
 * satisfied, do not finalize.
 */
export async function resolveDocumentSignatories(
  documentType: OfficialDocumentType,
  customConfig?: DocumentSignatoryConfig
): Promise<ResolvedSignatory[]> {
  if (documentType === "hall_ticket") {
    // Hall Ticket is strictly Admin ONLY — no candidate, student, or teacher signing exists
    const signature = await getActiveSignatureForRole("admin");
    const version = signature
      ? (signature.versions?.find((v) => v.versionId === signature.activeVersionId) ??
         signature.versions?.find((v) => v.isCurrent) ??
         null)
      : null;

    const hasActiveImg = !!(signature && signature.status === "active" && (signature.imageUrl || version?.downloadUrl));

    return [
      {
        slot: {
          slotId: "admin",
          label: "Principal & Seal",
          role: "admin",
          required: true,
          order: 1,
        },
        signature,
        version,
        isSatisfied: hasActiveImg,
      },
    ];
  }

  const configs = await getDocumentSignatoryConfigs();
  const rawConfig =
    customConfig ??
    configs.find((c) => c.documentType === documentType) ??
    DEFAULT_SIGNATORY_CONFIGS.find((c) => c.documentType === documentType);

  if (!rawConfig) return [];
  const config = sanitizeSignatoryConfig(rawConfig);

  // Filter slots to only roles actually permitted for this document
  const permittedSlots = config.slots.filter((s) =>
    canSignDocument(s.role, documentType)
  );

  const results: ResolvedSignatory[] = await Promise.all(
    permittedSlots.map(async (slot) => {
      const signature = await getActiveSignatureForRole(slot.role);
      const version = signature
        ? (signature.versions?.find((v) => v.versionId === signature.activeVersionId) ??
           signature.versions?.find((v) => v.isCurrent) ??
           null)
        : null;

      const hasActiveImg = !!(signature && signature.status === "active" && (signature.imageUrl || version?.downloadUrl));

      return {
        slot,
        signature,
        version,
        isSatisfied: hasActiveImg,
      };
    })
  );

  return results;
}

/**
 * Checks whether all required signature slots for a document type are satisfied.
 * Returns an array of missing slot labels if any are missing.
 *
 * For Hall Tickets: Guarantees that only the Principal & Seal requirement is checked.
 */
export async function checkDocumentSignatureReadiness(
  documentType: OfficialDocumentType
): Promise<{ ready: boolean; missingSlots: string[] }> {
  const resolved = await resolveDocumentSignatories(documentType);
  const required = resolved.filter((r) => r.slot.required);
  const missing = required.filter((r) => !r.isSatisfied).map((r) => r.slot.label);
  return { ready: missing.length === 0, missingSlots: missing };
}

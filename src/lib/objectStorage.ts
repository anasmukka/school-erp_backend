/**
 * Unified Object Storage Client
 *
 * Production behaviour (VITE_ALLOW_FIREBASE_STORAGE_FALLBACK != "true"):
 *   - R2 configured  → upload to R2 via Worker; failure throws a hard error.
 *   - R2 absent      → throws; Firebase Storage is NOT used as a silent fallback.
 *
 * Migration-only behaviour (VITE_ALLOW_FIREBASE_STORAGE_FALLBACK=true, R2 absent):
 *   - Falls back to Firebase Storage ONLY when R2 is entirely unconfigured.
 *
 * IMPORTANT:
 *   - VITE_ALLOW_FIREBASE_STORAGE_FALLBACK must NEVER be "true" in production.
 *   - A failed R2 upload must NEVER silently route to Firebase Storage.
 *   - Do not add try/catch around the R2 upload block that continues to Firebase Storage.
 */

import { auth } from "@/lib/firebase";
import { uploadPrintingDocument as uploadFirebaseDocument } from "@/lib/storage";
import { R2ObjectMetadata } from "@/lib/r2StorageKeys";
import { validateFile, FileCategory } from "@/lib/fileValidation";

export interface UnifiedUploadParams {
  file: File | Blob;
  fileName?: string;
  category: FileCategory;
  resourceType: string;
  studentUid?: string;
  userId?: string;
  schoolId?: string;
  objectKey?: string;
  onProgress?: (percent: number) => void;
}

export interface UnifiedUploadResult {
  downloadUrl: string;
  storagePath: string; // Object key or Firebase path
  objectKey: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  storageProvider: "cloudflare_r2" | "firebase_storage";
}

function getEnvVar(key: string): string {
  if (typeof import.meta !== "undefined" && (import.meta as any).env) {
    return (import.meta as any).env[key] || "";
  }
  if (typeof process !== "undefined" && process.env) {
    return process.env[key] || "";
  }
  return "";
}

const WORKER_URL = getEnvVar("VITE_WORKER_URL");

/**
 * Whether the Firebase Storage fallback is explicitly allowed via env var.
 * MUST be absent or "false" in production.
 * Only set to "true" during initial migration when R2 is not yet deployed.
 */
const FIREBASE_FALLBACK_ALLOWED =
  getEnvVar("VITE_ALLOW_FIREBASE_STORAGE_FALLBACK") === "true";

/**
 * Checks if Cloudflare Worker / R2 endpoint is configured
 */
export function isR2Configured(): boolean {
  return Boolean(WORKER_URL && WORKER_URL.trim().length > 0);
}

/**
 * Uploads a file through Cloudflare Worker to R2.
 *
 * When R2 is configured, upload failures throw a hard error.
 * Firebase Storage is never used as a silent fallback for R2 failures.
 */
export async function uploadObject(
  params: UnifiedUploadParams
): Promise<UnifiedUploadResult> {
  const fileName =
    params.fileName || (params.file instanceof File ? params.file.name : "unnamed_file");
  const fileType = params.file.type || "application/octet-stream";
  const fileSize = params.file.size;

  // 1. Centralized File Validation
  const validation = validateFile(
    { name: fileName, type: fileType, size: fileSize },
    params.category
  );
  if (!validation.valid) {
    throw new Error(validation.error || "File validation failed.");
  }

  // 2. R2 via Cloudflare Worker — primary and only production upload path.
  //    Failures throw immediately; no fallback.
  if (isR2Configured()) {
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      throw new Error("Authentication required for upload.");
    }

    const idToken = await currentUser.getIdToken();
    const queryParams = new URLSearchParams({
      resourceType: params.resourceType,
    });

    if (params.studentUid) queryParams.set("studentUid", params.studentUid);
    if (params.userId) queryParams.set("userId", params.userId);
    if (params.schoolId) queryParams.set("schoolId", params.schoolId);
    if (params.objectKey) queryParams.set("objectKey", params.objectKey);

    const endpoint = `${WORKER_URL}/api/storage/upload?${queryParams.toString()}`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": fileType,
        },
        body: params.file,
      });
    } catch (networkErr: any) {
      // Hard error — do NOT fall back to Firebase Storage.
      throw new Error(
        `R2 upload network error: ${networkErr?.message || "Worker unreachable"}. ` +
          "Upload aborted. Check VITE_WORKER_URL and Worker deployment."
      );
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      // Hard failure — do NOT silently fall back to Firebase Storage in production.
      throw new Error(
        (errJson as any).error ||
          `R2 upload failed (HTTP ${res.status}). Upload aborted. Check Worker configuration.`
      );
    }

    const data = (await res.json()) as { objectKey: string };
    const downloadUrl = `${WORKER_URL}/api/storage/file/${encodeURIComponent(data.objectKey)}`;

    if (params.onProgress) params.onProgress(100);

    return {
      downloadUrl,
      storagePath: data.objectKey,
      objectKey: data.objectKey,
      fileName,
      fileSizeBytes: fileSize,
      mimeType: fileType,
      storageProvider: "cloudflare_r2",
    };
  }

  // 3. R2 is not configured at all.
  //    Firebase Storage fallback: ONLY active when explicitly opted-in AND R2 is absent.
  //    This path MUST NOT be reachable in production.
  if (!FIREBASE_FALLBACK_ALLOWED) {
    throw new Error(
      "Object storage is not configured (VITE_WORKER_URL is unset). " +
        "Set VITE_WORKER_URL to your deployed Cloudflare Worker URL. " +
        "Firebase Storage fallback is disabled in production. " +
        "Do NOT set VITE_ALLOW_FIREBASE_STORAGE_FALLBACK=true in production."
    );
  }

  if (params.file instanceof File) {
    console.warn(
      "[objectStorage] MIGRATION MODE: Using Firebase Storage fallback because R2 is not configured. " +
        "VITE_ALLOW_FIREBASE_STORAGE_FALLBACK=true is active. " +
        "Disable this before production deploy."
    );
    const folder = params.resourceType.includes("signature")
      ? "signatures"
      : params.resourceType.includes("photo")
      ? "photos"
      : "printing-orders";

    const fbResult = await uploadFirebaseDocument(params.file, folder, params.onProgress);
    return {
      downloadUrl: fbResult.downloadUrl,
      storagePath: fbResult.storagePath,
      objectKey: fbResult.storagePath,
      fileName: fbResult.fileName,
      fileSizeBytes: fbResult.fileSize,
      mimeType: fileType,
      storageProvider: "firebase_storage",
    };
  }

  throw new Error("Unable to upload non-File blob without Worker R2 configured.");
}

export type StorageReferenceType =
  | "http_url"
  | "firebase_storage"
  | "base64_data"
  | "r2_key"
  | "empty"
  | "unknown";

/**
 * Classifies a storage reference string into its underlying category.
 */
export function classifyStorageReference(
  reference: string | undefined | null
): StorageReferenceType {
  if (!reference || typeof reference !== "string" || !reference.trim()) {
    return "empty";
  }
  const trimmed = reference.trim();
  if (trimmed.startsWith("data:")) {
    return "base64_data";
  }
  if (
    trimmed.includes("firebasestorage.googleapis.com") ||
    trimmed.includes("storage.googleapis.com")
  ) {
    return "firebase_storage";
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return "http_url";
  }
  if (
    trimmed.startsWith("schools/") ||
    trimmed.startsWith("printing-orders/") ||
    trimmed.startsWith("photos/") ||
    trimmed.startsWith("signatures/") ||
    trimmed.startsWith("profile-change-requests/")
  ) {
    return "r2_key";
  }
  return "unknown";
}

export interface StorageCapability {
  r2Configured: boolean;
  workerUrl: string;
  firebaseFallbackAllowed: boolean;
  status: "r2_ready" | "unconfigured" | "migration_fallback";
  description: string;
}

/**
 * Returns current object storage readiness without throwing errors.
 */
export function getStorageCapabilityStatus(): StorageCapability {
  const r2 = isR2Configured();
  if (r2) {
    return {
      r2Configured: true,
      workerUrl: WORKER_URL,
      firebaseFallbackAllowed: FIREBASE_FALLBACK_ALLOWED,
      status: "r2_ready",
      description: "Cloudflare R2 storage operational via Worker gateway.",
    };
  }
  if (FIREBASE_FALLBACK_ALLOWED) {
    return {
      r2Configured: false,
      workerUrl: "",
      firebaseFallbackAllowed: true,
      status: "migration_fallback",
      description: "Migration fallback: Firebase Storage active (temporary).",
    };
  }
  return {
    r2Configured: false,
    workerUrl: "",
    firebaseFallbackAllowed: false,
    status: "unconfigured",
    description: "Cloudflare R2 is unconfigured. VITE_WORKER_URL is unset.",
  };
}

/**
 * Resolves public or authenticated URL for an object key, Base64 string, or legacy URL.
 *
 * Distinguishes between:
 * - Base64 data URLs: returned directly.
 * - HTTP/HTTPS download URLs (including Firebase Storage): returned directly.
 * - R2 object keys:
 *     - When Worker is configured: resolves to ${WORKER_URL}/api/storage/file/{key}
 *     - When Worker is NOT configured: returns "" (NEVER returns raw object key as a URL).
 * - Empty/null/undefined: returns "".
 */
export function resolveFileUrl(
  reference: string | R2ObjectMetadata | undefined | null
): string {
  if (!reference) return "";

  if (typeof reference !== "string") {
    if (reference.publicUrl) return reference.publicUrl;
    if (reference.objectKey && isR2Configured()) {
      return `${WORKER_URL}/api/storage/file/${encodeURIComponent(reference.objectKey)}`;
    }
    return "";
  }

  const trimmed = reference.trim();
  if (!trimmed) return "";

  // 1. Base64 data URLs: directly renderable
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }

  // 2. HTTP/HTTPS URLs (including Firebase Storage download URLs)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // 3. R2 object keys
  if (isR2Configured()) {
    return `${WORKER_URL}/api/storage/file/${encodeURIComponent(trimmed)}`;
  }

  // 4. Worker is unconfigured and reference is not a URL:
  // Never treat an R2 object key as a directly accessible URL.
  // Returning empty string allows consumer components to render placeholders/avatars cleanly.
  return "";
}

/**
 * Checks whether a given reference resolves to a renderable URL
 */
export function isRenderableUrl(reference: string | undefined | null): boolean {
  const resolved = resolveFileUrl(reference);
  return Boolean(
    resolved &&
      (resolved.startsWith("http://") ||
        resolved.startsWith("https://") ||
        resolved.startsWith("data:"))
  );
}


/**
 * Centralized File Validation Service
 * Validates MIME types, extensions, and file sizes across ERP categories.
 */

export type FileCategory =
  | "profile_photo"
  | "student_document"
  | "signature"
  | "generated_pdf"
  | "attachment";

export interface FileValidationRule {
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  maxSizeBytes: number;
}

export const FILE_VALIDATION_RULES: Record<FileCategory, FileValidationRule> = {
  profile_photo: {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    allowedExtensions: ["jpg", "jpeg", "png", "webp"],
    maxSizeBytes: 5 * 1024 * 1024, // 5 MB
  },
  student_document: {
    allowedMimeTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ],
    allowedExtensions: ["pdf", "jpg", "jpeg", "png", "webp"],
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  },
  signature: {
    allowedMimeTypes: ["image/png", "image/webp", "image/jpeg"],
    allowedExtensions: ["png", "webp", "jpg", "jpeg"],
    maxSizeBytes: 2 * 1024 * 1024, // 2 MB
  },
  generated_pdf: {
    allowedMimeTypes: ["application/pdf"],
    allowedExtensions: ["pdf"],
    maxSizeBytes: 15 * 1024 * 1024, // 15 MB
  },
  attachment: {
    allowedMimeTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ],
    allowedExtensions: ["pdf", "jpg", "jpeg", "png", "webp", "docx", "doc"],
    maxSizeBytes: 30 * 1024 * 1024, // 30 MB
  },
};

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateFile(
  file: { name: string; type: string; size: number },
  category: FileCategory
): ValidationResult {
  const rule = FILE_VALIDATION_RULES[category];
  if (!rule) {
    return { valid: false, error: `Unknown file category: ${category}` };
  }

  // 1. Size Check
  if (file.size > rule.maxSizeBytes) {
    const maxMb = Math.round(rule.maxSizeBytes / (1024 * 1024));
    return {
      valid: false,
      error: `File size exceeds maximum allowed limit of ${maxMb}MB.`,
    };
  }

  // 2. MIME Type Check
  const normalizedMime = (file.type || "").trim().toLowerCase();
  if (normalizedMime && !rule.allowedMimeTypes.includes(normalizedMime)) {
    return {
      valid: false,
      error: `Invalid file type (${normalizedMime}). Allowed types: ${rule.allowedMimeTypes.join(", ")}`,
    };
  }

  // 3. Extension Check
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!rule.allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `Invalid file extension (.${ext}). Allowed extensions: .${rule.allowedExtensions.join(", .")}`,
    };
  }

  return { valid: true };
}

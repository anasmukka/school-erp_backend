/**
 * Base64 Image Compression and Storage Controls
 *
 * Enforces strict limits and compression for Base64 images stored in Firestore:
 * - Allowed types: image/jpeg, image/png, image/webp
 * - Max raw input file size: 5 MB
 * - Max attachments per document: 3
 * - Max compressed data URL length per image: 160 KB (~120 KB binary)
 * - Max combined attachments payload per document: 450 KB (well within Firestore 1 MiB document limit)
 * - Canvas-based client-side downscaling and JPEG/WebP compression
 */

export interface ImageCompressionOptions {
  maxDimension?: number; // Max width or height (default: 1024px)
  quality?: number; // Compression quality 0.1 to 1.0 (default: 0.75)
  maxDataUrlLength?: number; // Max characters in resulting data URL (default: 163,840 ~ 160 KB)
}

export interface CompressedImageResult {
  name: string;
  dataUrl: string;
  sizeBytes: number;
  mimeType: string;
}

export interface Base64StorageLimits {
  maxRawFileSize: number;
  maxCompressedDataUrlLength: number;
  maxTotalPayloadBytes: number;
  maxAttachmentsPerDocument: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
}

export const BASE64_STORAGE_LIMITS: Base64StorageLimits = {
  maxRawFileSize: 5 * 1024 * 1024, // 5 MB raw input limit
  maxCompressedDataUrlLength: 160 * 1024, // 160 KB per compressed data URL
  maxTotalPayloadBytes: 450 * 1024, // 450 KB total across all images in a document
  maxAttachmentsPerDocument: 3,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  allowedExtensions: ["jpg", "jpeg", "png", "webp"],
};

/**
 * Validates a raw image file before reading or compressing
 */
export function validateImageFile(file: {
  name: string;
  type: string;
  size: number;
}): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: "No file provided." };
  }

  // 1. Raw size check
  if (file.size > BASE64_STORAGE_LIMITS.maxRawFileSize) {
    const maxMb = Math.round(BASE64_STORAGE_LIMITS.maxRawFileSize / (1024 * 1024));
    return {
      valid: false,
      error: `File "${file.name}" exceeds the maximum allowed size of ${maxMb}MB.`,
    };
  }

  // 2. MIME type check
  const normalizedMime = (file.type || "").trim().toLowerCase();
  if (normalizedMime && !BASE64_STORAGE_LIMITS.allowedMimeTypes.includes(normalizedMime)) {
    return {
      valid: false,
      error: `File "${file.name}" has invalid image type (${normalizedMime}). Allowed: JPG, PNG, WebP.`,
    };
  }

  // 3. Extension check
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!BASE64_STORAGE_LIMITS.allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `File "${file.name}" has invalid extension (.${ext}). Allowed: .jpg, .jpeg, .png, .webp.`,
    };
  }

  return { valid: true };
}

/**
 * Validates the combined payload of all images intended for a single Firestore document
 */
export function validateImagesTotalPayload(
  images: { dataUrl: string; name?: string }[]
): { valid: boolean; totalBytes: number; error?: string } {
  if (images.length > BASE64_STORAGE_LIMITS.maxAttachmentsPerDocument) {
    return {
      valid: false,
      totalBytes: 0,
      error: `Maximum ${BASE64_STORAGE_LIMITS.maxAttachmentsPerDocument} image attachments allowed per document.`,
    };
  }

  let totalBytes = 0;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img.dataUrl || typeof img.dataUrl !== "string") {
      return {
        valid: false,
        totalBytes,
        error: `Attachment ${i + 1} (${img.name || "unnamed"}) contains invalid image data.`,
      };
    }
    const len = img.dataUrl.length;
    if (len > BASE64_STORAGE_LIMITS.maxCompressedDataUrlLength) {
      const kb = Math.round(len / 1024);
      const maxKb = Math.round(BASE64_STORAGE_LIMITS.maxCompressedDataUrlLength / 1024);
      return {
        valid: false,
        totalBytes,
        error: `Image "${img.name || `Attachment ${i + 1}`}" payload (${kb}KB) exceeds limit of ${maxKb}KB.`,
      };
    }
    totalBytes += len;
  }

  if (totalBytes > BASE64_STORAGE_LIMITS.maxTotalPayloadBytes) {
    const totalKb = Math.round(totalBytes / 1024);
    const maxTotalKb = Math.round(BASE64_STORAGE_LIMITS.maxTotalPayloadBytes / 1024);
    return {
      valid: false,
      totalBytes,
      error: `Combined image attachments size (${totalKb}KB) exceeds Firestore safety limit of ${maxTotalKb}KB.`,
    };
  }

  return { valid: true, totalBytes };
}

/**
 * Helper to read a File as a data URL using FileReader
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read file as data URL"));
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

/**
 * Compresses and rescales an image file to a compact Base64 data URL.
 * In browser environments with HTMLCanvasElement, it downscales and re-encodes.
 * In non-browser environments or if canvas fails, it reads via FileReader while enforcing limits.
 */
export async function compressImageToDataUrl(
  file: File,
  options?: ImageCompressionOptions
): Promise<CompressedImageResult> {
  // 1. Initial file validation
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const maxDimension = options?.maxDimension ?? 1024;
  const quality = options?.quality ?? 0.75;
  const maxLen = options?.maxDataUrlLength ?? BASE64_STORAGE_LIMITS.maxCompressedDataUrlLength;

  // Check if browser HTML5 Canvas is available
  const hasCanvas = typeof document !== "undefined" && typeof document.createElement === "function";

  if (!hasCanvas) {
    // Non-DOM environment (e.g. Node.js unit tests): Read data URL directly and enforce length
    const rawDataUrl = await readFileAsDataUrl(file);
    if (rawDataUrl.length > maxLen) {
      throw new Error(
        `Image "${file.name}" data URL (${Math.round(rawDataUrl.length / 1024)}KB) exceeds limit of ${Math.round(maxLen / 1024)}KB.`
      );
    }
    return {
      name: file.name,
      dataUrl: rawDataUrl,
      sizeBytes: Math.round(rawDataUrl.length * 0.75),
      mimeType: file.type || "image/jpeg",
    };
  }

  return new Promise((resolve, reject) => {
    const rawUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(rawUrl);

      try {
        let width = img.width;
        let height = img.height;

        // Downscale while preserving aspect ratio
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Unable to create canvas 2D rendering context.");
        }

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Export as JPEG (good compression ratio) or WebP if supported
        const targetMime = file.type === "image/webp" ? "image/webp" : "image/jpeg";
        let dataUrl = canvas.toDataURL(targetMime, quality);

        // If still too large, try re-compressing at lower quality (0.55)
        if (dataUrl.length > maxLen) {
          dataUrl = canvas.toDataURL(targetMime, 0.55);
        }

        // Final check against max length
        if (dataUrl.length > maxLen) {
          const kb = Math.round(dataUrl.length / 1024);
          const limitKb = Math.round(maxLen / 1024);
          throw new Error(
            `Image "${file.name}" could not be compressed below ${limitKb}KB (result: ${kb}KB). Please select a smaller image.`
          );
        }

        const estimatedBinaryBytes = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);

        resolve({
          name: file.name,
          dataUrl,
          sizeBytes: estimatedBinaryBytes,
          mimeType: targetMime,
        });
      } catch (canvasErr: any) {
        reject(canvasErr);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(rawUrl);
      reject(new Error(`Failed to load image "${file.name}" for compression.`));
    };

    img.src = rawUrl;
  });
}

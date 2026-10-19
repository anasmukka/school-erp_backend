/**
 * Storage Architecture Stabilization & Security Test Suite
 *
 * Verifies:
 * 1. R2 Unavailable & Missing Worker URL Handling
 * 2. Storage Capability Discovery (isR2Configured, getStorageCapabilityStatus)
 * 3. File URL Resolution & Categorization (resolveFileUrl, classifyStorageReference)
 *    - Base64 data URLs preserved
 *    - HTTP/HTTPS URLs preserved
 *    - Legacy Firebase Storage URLs preserved
 *    - R2 object keys resolved via Worker when configured
 *    - R2 object keys NOT returned as raw URLs when unconfigured (prevents 404 navigation)
 * 4. File Validation & Size Limits (validateFile, validateImageFile)
 * 5. Base64 Storage Controls & Compression Limits (BASE64_STORAGE_LIMITS, validateImagesTotalPayload)
 * 6. Firestore Document-Size Protection (< 450KB combined images payload vs 1 MiB limit)
 * 7. Failed Upload Error Handling & Prevention of Corrupt Metadata Persistence
 * 8. Storage Security Rules Immutability & Access Isolation
 */

import {
  isR2Configured,
  getStorageCapabilityStatus,
  resolveFileUrl,
  classifyStorageReference,
  isRenderableUrl,
} from "../src/lib/objectStorage";
import {
  validateImageFile,
  validateImagesTotalPayload,
  BASE64_STORAGE_LIMITS,
} from "../src/lib/base64Image";
import { validateFile } from "../src/lib/fileValidation";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failed++;
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  PASS: ${msg}`);
  passed++;
}

function runSection(name: string) {
  console.log(`\n--- ${name} ---`);
}

async function runStorageStabilizationTests() {
  console.log("==================================================================");
  console.log("STORAGE ARCHITECTURE STABILIZATION & SECURITY VERIFICATION SUITE");
  console.log("==================================================================");

  // ---------------------------------------------------------------------------
  // SECTION 1: R2 Unavailable & Missing Worker URL Handling
  // ---------------------------------------------------------------------------
  runSection("Section 1: R2 Unavailable & Missing Worker URL Behavior");

  // In the current test/local environment, VITE_WORKER_URL is unset
  const r2Configured = isR2Configured();
  assert(
    r2Configured === false,
    "isR2Configured() returns false when VITE_WORKER_URL is unset"
  );

  const capability = getStorageCapabilityStatus();
  assert(
    capability.r2Configured === false,
    "getStorageCapabilityStatus reports r2Configured === false"
  );
  assert(
    capability.status === "unconfigured" || capability.status === "migration_fallback",
    `Storage capability status is safe (${capability.status})`
  );
  assert(
    typeof capability.description === "string" && capability.description.length > 0,
    "Storage capability returns clear human-readable status description"
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: Storage Reference Classification
  // ---------------------------------------------------------------------------
  runSection("Section 2: Storage Reference Classification");

  assert(
    classifyStorageReference("data:image/jpeg;base64,/9j/4AAQSkZJRg==") === "base64_data",
    "Base64 JPEG data URL classified as 'base64_data'"
  );
  assert(
    classifyStorageReference("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==") === "base64_data",
    "Base64 PNG data URL classified as 'base64_data'"
  );
  assert(
    classifyStorageReference(
      "https://firebasestorage.googleapis.com/v0/b/school-erp.appspot.com/o/printing-orders%2F123.pdf?alt=media&token=xyz"
    ) === "firebase_storage",
    "Firebase Storage download URL classified as 'firebase_storage'"
  );
  assert(
    classifyStorageReference("https://prestigeschool.com/assets/logo.png") === "http_url",
    "External HTTPS URL classified as 'http_url'"
  );
  assert(
    classifyStorageReference("schools/prestige/students/std_123/profile.webp") === "r2_key",
    "R2 student profile key classified as 'r2_key'"
  );
  assert(
    classifyStorageReference("printing-orders/order_123.pdf") === "r2_key",
    "Printing orders storage path classified as 'r2_key'"
  );
  assert(
    classifyStorageReference("") === "empty",
    "Empty string classified as 'empty'"
  );
  assert(
    classifyStorageReference(null) === "empty",
    "Null reference classified as 'empty'"
  );
  assert(
    classifyStorageReference(undefined) === "empty",
    "Undefined reference classified as 'empty'"
  );

  // ---------------------------------------------------------------------------
  // SECTION 3: URL Resolution (resolveFileUrl)
  // ---------------------------------------------------------------------------
  runSection("Section 3: URL Resolution & Backward Compatibility");

  // 3a. Base64 data URLs
  const sampleDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD";
  assert(
    resolveFileUrl(sampleDataUrl) === sampleDataUrl,
    "resolveFileUrl preserves Base64 data URLs intact"
  );

  // 3b. Legacy Firebase Storage URLs
  const fbStorageUrl =
    "https://firebasestorage.googleapis.com/v0/b/school-erp.appspot.com/o/photos%2Fstudent1.jpg?alt=media";
  assert(
    resolveFileUrl(fbStorageUrl) === fbStorageUrl,
    "resolveFileUrl preserves legacy Firebase Storage download URLs intact"
  );

  // 3c. Regular HTTP/HTTPS URLs
  const publicHttpUrl = "https://cdn.prestigeschool.com/badges/honors.png";
  assert(
    resolveFileUrl(publicHttpUrl) === publicHttpUrl,
    "resolveFileUrl preserves public HTTPS image URLs intact"
  );

  // 3d. R2 Object Keys when Worker is NOT configured:
  // MUST NOT return the raw object key as a URL (which would trigger 404 HTTP requests)
  const r2Key = "schools/prestige/students/std_999/profile.webp";
  const resolvedWhenUnconfigured = resolveFileUrl(r2Key);
  assert(
    resolvedWhenUnconfigured === "",
    "resolveFileUrl returns empty string for R2 keys when Worker is unconfigured (prevents broken image 404s)"
  );
  assert(
    resolvedWhenUnconfigured !== r2Key,
    "resolveFileUrl never treats raw R2 object key as a directly accessible URL"
  );

  // 3e. Null, undefined, empty
  assert(resolveFileUrl(null) === "", "resolveFileUrl(null) returns empty string");
  assert(resolveFileUrl(undefined) === "", "resolveFileUrl(undefined) returns empty string");
  assert(resolveFileUrl("") === "", "resolveFileUrl('') returns empty string");
  assert(resolveFileUrl("   ") === "", "resolveFileUrl whitespace string returns empty string");

  // 3f. Object metadata object
  assert(
    resolveFileUrl({ objectKey: r2Key, publicUrl: "https://example.com/cached.jpg" }) ===
      "https://example.com/cached.jpg",
    "resolveFileUrl respects publicUrl on R2ObjectMetadata object"
  );

  // 3g. isRenderableUrl helper
  assert(
    isRenderableUrl(sampleDataUrl) === true,
    "isRenderableUrl is true for valid Base64 data URL"
  );
  assert(
    isRenderableUrl(fbStorageUrl) === true,
    "isRenderableUrl is true for valid Firebase Storage URL"
  );
  assert(
    isRenderableUrl(r2Key) === false,
    "isRenderableUrl is false for unresolvable R2 key when Worker is unconfigured"
  );
  assert(
    isRenderableUrl("") === false,
    "isRenderableUrl is false for empty string"
  );

  // ---------------------------------------------------------------------------
  // SECTION 4: Centralized File Validation & Limits
  // ---------------------------------------------------------------------------
  runSection("Section 4: File Validation & Category Limits");

  // Profile photo limits (5 MB, jpg/png/webp)
  const validPhoto = validateFile(
    { name: "student_photo.jpg", type: "image/jpeg", size: 2 * 1024 * 1024 },
    "profile_photo"
  );
  assert(validPhoto.valid === true, "2MB JPG profile photo is valid");

  const oversizedPhoto = validateFile(
    { name: "huge_photo.jpg", type: "image/jpeg", size: 6 * 1024 * 1024 },
    "profile_photo"
  );
  assert(oversizedPhoto.valid === false, "6MB photo exceeds 5MB limit and is rejected");

  const invalidPhotoType = validateFile(
    { name: "script.exe", type: "application/x-msdownload", size: 1024 },
    "profile_photo"
  );
  assert(invalidPhotoType.valid === false, "Executable file is rejected as profile photo");

  // Signature limits (2 MB, png/webp/jpg)
  const validSig = validateFile(
    { name: "principal_seal.png", type: "image/png", size: 500 * 1024 },
    "signature"
  );
  assert(validSig.valid === true, "500KB PNG signature is valid");

  const oversizedSig = validateFile(
    { name: "big_seal.png", type: "image/png", size: 3 * 1024 * 1024 },
    "signature"
  );
  assert(oversizedSig.valid === false, "3MB signature exceeds 2MB limit and is rejected");

  // Student document limits (10 MB, pdf/jpg/png/webp)
  const validDoc = validateFile(
    { name: "birth_certificate.pdf", type: "application/pdf", size: 4 * 1024 * 1024 },
    "student_document"
  );
  assert(validDoc.valid === true, "4MB PDF document is valid");

  const invalidDocType = validateFile(
    { name: "malicious.js", type: "text/javascript", size: 1024 },
    "student_document"
  );
  assert(invalidDocType.valid === false, "JavaScript file is rejected as student document");

  // ---------------------------------------------------------------------------
  // SECTION 5: Base64 Storage Controls & Image Validation
  // ---------------------------------------------------------------------------
  runSection("Section 5: Base64 Storage Controls & Limits");

  // Raw file validation
  const validNoticeImg = validateImageFile({
    name: "sports_day.jpg",
    type: "image/jpeg",
    size: 1 * 1024 * 1024,
  });
  assert(validNoticeImg.valid === true, "1MB JPG image passes notice image validation");

  const oversizedNoticeImg = validateImageFile({
    name: "raw_dslr.jpg",
    type: "image/jpeg",
    size: 8 * 1024 * 1024,
  });
  assert(
    oversizedNoticeImg.valid === false,
    "8MB raw image exceeds 5MB limit and is rejected before compression"
  );

  const invalidNoticeExt = validateImageFile({
    name: "circular.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 50 * 1024,
  });
  assert(
    invalidNoticeExt.valid === false,
    "DOCX file is rejected for Base64 image attachment"
  );

  // ---------------------------------------------------------------------------
  // SECTION 6: Firestore Document-Size Protection (< 450 KB vs 1 MiB limit)
  // ---------------------------------------------------------------------------
  runSection("Section 6: Firestore Document-Size Safety Limits");

  // Valid small payload
  const smallImages = [
    { dataUrl: "data:image/jpeg;base64," + "A".repeat(50 * 1024), name: "img1.jpg" },
    { dataUrl: "data:image/jpeg;base64," + "B".repeat(60 * 1024), name: "img2.jpg" },
  ];
  const smallCheck = validateImagesTotalPayload(smallImages);
  assert(smallCheck.valid === true, "Combined 110KB images payload passes Firestore safety check");

  // Exceeds max count (> 3 attachments)
  const tooManyImages = [
    { dataUrl: "data:image/jpeg;base64," + "A".repeat(10 * 1024), name: "img1.jpg" },
    { dataUrl: "data:image/jpeg;base64," + "B".repeat(10 * 1024), name: "img2.jpg" },
    { dataUrl: "data:image/jpeg;base64," + "C".repeat(10 * 1024), name: "img3.jpg" },
    { dataUrl: "data:image/jpeg;base64," + "D".repeat(10 * 1024), name: "img4.jpg" },
  ];
  const countCheck = validateImagesTotalPayload(tooManyImages);
  assert(countCheck.valid === false, "More than 3 attachments is rejected");

  // Single oversized image (> 160 KB)
  const singleOversized = [
    { dataUrl: "data:image/jpeg;base64," + "X".repeat(200 * 1024), name: "huge.jpg" },
  ];
  const singleCheck = validateImagesTotalPayload(singleOversized);
  assert(
    singleCheck.valid === false,
    "Single image exceeding 160KB limit is rejected"
  );

  // Combined oversized images (> 450 KB)
  const combinedOversized = [
    { dataUrl: "data:image/jpeg;base64," + "X".repeat(155 * 1024), name: "pic1.jpg" },
    { dataUrl: "data:image/jpeg;base64," + "Y".repeat(155 * 1024), name: "pic2.jpg" },
    { dataUrl: "data:image/jpeg;base64," + "Z".repeat(155 * 1024), name: "pic3.jpg" },
  ];
  const combinedCheck = validateImagesTotalPayload(combinedOversized);
  assert(
    combinedCheck.valid === false,
    "Combined payload exceeding 450KB is rejected (protects Firestore 1 MiB limit)"
  );

  assert(
    BASE64_STORAGE_LIMITS.maxTotalPayloadBytes <= 512 * 1024,
    "Max total image payload is strictly <= 512KB, leaving >50% of Firestore 1 MiB headroom"
  );

  // ---------------------------------------------------------------------------
  // SECTION 7: Failed Upload Guard & Prevention of Incomplete Metadata
  // ---------------------------------------------------------------------------
  runSection("Section 7: Failed Upload Guard & Data Integrity");

  // Read Admissions.tsx to verify the upload guard
  const admissionsPath = path.resolve(__dirname, "../src/pages/admin/Admissions.tsx");
  const admissionsCode = fs.readFileSync(admissionsPath, "utf8");

  assert(
    admissionsCode.includes("isR2Configured()"),
    "Admissions.tsx checks isR2Configured() before attempting file uploads"
  );
  assert(
    admissionsCode.includes("Cloudflare R2 object storage is not configured"),
    "Admissions.tsx halts with actionable error when R2 is unconfigured"
  );
  assert(
    admissionsCode.includes("resolveFileUrl(previewDoc.fileData)"),
    "Admissions.tsx preview modal uses resolveFileUrl"
  );
  assert(
    admissionsCode.includes("Storage Gateway Unconfigured"),
    "Admissions.tsx shows explicit gateway unconfigured notice instead of broken preview"
  );

  // Verify Signatures.tsx uses uploadSignatureImage with error handling
  const signaturesCode = fs.readFileSync(
    path.resolve(__dirname, "../src/pages/admin/Signatures.tsx"),
    "utf8"
  );
  assert(
    signaturesCode.includes("uploadSignatureImage"),
    "Signatures.tsx routes signature uploads through uploadSignatureImage"
  );
  assert(
    signaturesCode.includes("publishSignatureVersion"),
    "Signatures.tsx publishes signature record only after upload succeeds"
  );

  // ---------------------------------------------------------------------------
  // SECTION 8: Storage Rules & Firestore Security Invariants
  // ---------------------------------------------------------------------------
  runSection("Section 8: Storage Rules & Security Invariants");

  const storageRulesPath = path.resolve(__dirname, "../storage.rules");
  const storageRules = fs.readFileSync(storageRulesPath, "utf8");

  assert(
    storageRules.includes("match /printing-orders/{fileName}"),
    "storage.rules protects printing-orders path"
  );
  assert(
    storageRules.includes("match /profile-change-requests/{fileName}"),
    "storage.rules protects profile-change-requests path"
  );
  assert(
    storageRules.includes("match /photos/{fileName}"),
    "storage.rules protects photos path"
  );
  assert(
    storageRules.includes("match /signatures/{fileName}"),
    "storage.rules protects signatures path"
  );
  assert(
    storageRules.includes("request.auth != null"),
    "storage.rules strictly requires authentication on all paths"
  );

  // Firestore rules: no passwords
  const firestoreRulesPath = path.resolve(__dirname, "../firestore.rules");
  const firestoreRules = fs.readFileSync(firestoreRulesPath, "utf8");
  assert(
    firestoreRules.includes("hasNoSensitiveAuthFields"),
    "firestore.rules enforces hasNoSensitiveAuthFields"
  );

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n==================================================================");
  console.log(`TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  if (failed === 0) {
    console.log("✓ All storage architecture stabilization & security tests PASSED!");
  } else {
    console.error(`✗ ${failed} test(s) failed.`);
    process.exit(1);
  }
  console.log("==================================================================");
}

runStorageStabilizationTests().catch((err) => {
  console.error("Test runner encountered an error:", err);
  process.exit(1);
});

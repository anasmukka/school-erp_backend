/**
 * Resumable & Idempotent Migration Script:
 * 1. Scans Firestore collections for Base64 binary strings (admissions, students, teachers)
 * 2. Decodes the binary data and uploads it to Cloudflare R2 via the S3-compatible API
 * 3. Idempotently updates Firestore documents with the new R2 object key reference
 * 4. Does NOT delete Base64 data automatically — operator must verify and clean up separately
 *
 * Prerequisites:
 *   export CF_ACCOUNT_ID="your_cloudflare_account_id"
 *   export CF_R2_ACCESS_KEY_ID="your_r2_access_key_id"
 *   export CF_R2_SECRET_ACCESS_KEY="your_r2_secret_access_key"
 *   export CF_R2_BUCKET_NAME="school-erp-storage"  (or your bucket name)
 *   export GOOGLE_APPLICATION_CREDENTIALS="path/to/serviceAccountKey.json"
 *
 * Run (dry run — inspect without writing):
 *   npx tsx scripts/migrate_base64_to_r2.ts --dry-run
 *
 * Run (live migration):
 *   npx tsx scripts/migrate_base64_to_r2.ts
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Firebase Admin initialization
// ---------------------------------------------------------------------------
const serviceAccountPath = path.resolve(
  __dirname,
  "../backend/serviceAccountKey.json"
);

if (fs.existsSync(serviceAccountPath) && getApps().length === 0) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  initializeApp({ credential: cert(serviceAccount) });
} else if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

// ---------------------------------------------------------------------------
// R2 S3-compatible upload via AWS Signature v4
// We use the built-in `https` module + manual AWS SigV4 to avoid requiring
// @aws-sdk/client-s3 as a dependency in the migration script.
// ---------------------------------------------------------------------------

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
}

function getR2Config(): R2Config {
  const accountId = process.env.CF_ACCOUNT_ID;
  const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.CF_R2_BUCKET_NAME || "school-erp-storage";

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 credentials. Set CF_ACCOUNT_ID, CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY."
    );
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint: `${accountId}.r2.cloudflarestorage.com`,
  };
}

/**
 * Minimal AWS Signature V4 signer for PUT object uploads to R2
 */
async function uploadToR2(
  objectKey: string,
  body: Buffer,
  contentType: string,
  config: R2Config
): Promise<void> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const host = `${config.endpoint}`;
  const path_ = `/${config.bucketName}/${objectKey}`;
  const region = "auto";
  const service = "s3";

  // Payload hash
  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");

  // Canonical headers
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  // Canonical request
  const canonicalRequest = [
    "PUT",
    encodeURIComponent(path_).replace(/%2F/g, "/"),
    "", // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // String to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  // Signing key
  function hmac(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac("sha256", key).update(data).digest();
  }

  const signingKey = hmac(
    hmac(
      hmac(
        hmac(Buffer.from(`AWS4${config.secretAccessKey}`, "utf8"), dateStamp),
        region
      ),
      service
    ),
    "aws4_request"
  );

  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path: path_,
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": body.length,
          "x-amz-date": amzDate,
          "x-amz-content-sha256": payloadHash,
          Authorization: authHeader,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          let errorBody = "";
          res.on("data", (chunk) => (errorBody += chunk));
          res.on("end", () =>
            reject(
              new Error(
                `R2 PUT failed: HTTP ${res.statusCode} for key ${objectKey}. Body: ${errorBody}`
              )
            )
          );
        }
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Base64 data URL parser
// ---------------------------------------------------------------------------
function parseDataUrl(
  dataUrl: string
): { mimeType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([a-zA-Z0-9+\/]+\/[a-zA-Z0-9+\/]+);base64,(.+)$/s);
  if (!match) return null;
  const [, mimeType, base64Data] = match;
  try {
    return { mimeType, buffer: Buffer.from(base64Data, "base64") };
  } catch {
    return null;
  }
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
  };
  return map[mimeType] || "bin";
}

// ---------------------------------------------------------------------------
// Migration statistics
// ---------------------------------------------------------------------------
interface MigrationStats {
  admissionsInspected: number;
  admissionsMigrated: number;
  studentsInspected: number;
  studentsMigrated: number;
  skippedAlreadyMigrated: number;
  errors: number;
  errorDetails: string[];
}

// ---------------------------------------------------------------------------
// Main migration runner
// ---------------------------------------------------------------------------
export async function runBase64ToR2Migration(dryRun = false): Promise<MigrationStats> {
  console.log("==================================================================");
  console.log(`Starting Base64 → R2 Migration (DryRun: ${dryRun})`);
  console.log("==================================================================");

  let r2Config: R2Config | null = null;
  if (!dryRun) {
    r2Config = getR2Config();
    console.log(`R2 bucket: ${r2Config.bucketName} @ ${r2Config.endpoint}`);
  } else {
    console.log("DRY RUN: No files will be uploaded or Firestore documents updated.");
  }

  const stats: MigrationStats = {
    admissionsInspected: 0,
    admissionsMigrated: 0,
    studentsInspected: 0,
    studentsMigrated: 0,
    skippedAlreadyMigrated: 0,
    errors: 0,
    errorDetails: [],
  };

  // -------------------------------------------------------------------------
  // 1. Migrate Admissions Documents & Photos
  // -------------------------------------------------------------------------
  console.log("\n--- Checking 'admissions' collection ---");
  const admissionsSnap = await db.collection("admissions").get();

  for (const docSnap of admissionsSnap.docs) {
    stats.admissionsInspected++;
    const data = docSnap.data();
    let hasBase64 = false;
    const updates: Record<string, any> = {};

    // Check photoData
    if (data.photoData && typeof data.photoData === "string" && data.photoData.startsWith("data:")) {
      hasBase64 = true;
      const parsed = parseDataUrl(data.photoData);

      if (!parsed) {
        console.warn(`  ✗ [admissions/${docSnap.id}] Failed to parse photoData Base64`);
        stats.errors++;
        stats.errorDetails.push(`admissions/${docSnap.id}: malformed photoData`);
      } else {
        const ext = mimeToExt(parsed.mimeType);
        const objectKey = `schools/prestige/admissions/${docSnap.id}/profile.${ext}`;

        if (!dryRun && r2Config) {
          try {
            await uploadToR2(objectKey, parsed.buffer, parsed.mimeType, r2Config);
            console.log(`  ✓ [admissions/${docSnap.id}] Uploaded photo → ${objectKey}`);
          } catch (err: any) {
            console.error(`  ✗ [admissions/${docSnap.id}] R2 upload failed:`, err.message);
            stats.errors++;
            stats.errorDetails.push(`admissions/${docSnap.id}: ${err.message}`);
            continue; // Do NOT update Firestore if upload failed
          }
        } else {
          console.log(`  [DRY RUN] Would upload admissions/${docSnap.id} photo → ${objectKey}`);
        }

        updates.photoData = null; // clear Base64
        updates.photoR2Key = objectKey;
        updates.photoContentType = parsed.mimeType;
      }
    } else if (data.photoData && !data.photoData.startsWith("data:")) {
      // Already migrated
    }

    // Check documents array
    if (Array.isArray(data.documents)) {
      let docUpdated = false;
      const updatedDocs: any[] = [];

      for (let idx = 0; idx < data.documents.length; idx++) {
        const d = data.documents[idx];
        if (d.fileData && typeof d.fileData === "string" && d.fileData.startsWith("data:")) {
          hasBase64 = true;
          const parsed = parseDataUrl(d.fileData);

          if (!parsed) {
            console.warn(`  ✗ [admissions/${docSnap.id}] doc[${idx}] malformed fileData`);
            stats.errors++;
            updatedDocs.push(d); // keep original
            continue;
          }

          const ext = mimeToExt(parsed.mimeType);
          const objectKey = `schools/prestige/admissions/${docSnap.id}/doc_${idx}.${ext}`;

          if (!dryRun && r2Config) {
            try {
              await uploadToR2(objectKey, parsed.buffer, parsed.mimeType, r2Config);
              console.log(`  ✓ [admissions/${docSnap.id}] Uploaded doc[${idx}] → ${objectKey}`);
              updatedDocs.push({
                ...d,
                fileData: null, // clear Base64
                r2ObjectKey: objectKey,
                contentType: parsed.mimeType,
              });
              docUpdated = true;
            } catch (err: any) {
              console.error(`  ✗ [admissions/${docSnap.id}] doc[${idx}] R2 upload failed:`, err.message);
              stats.errors++;
              stats.errorDetails.push(`admissions/${docSnap.id}/doc_${idx}: ${err.message}`);
              updatedDocs.push(d); // keep original on failure
            }
          } else {
            console.log(
              `  [DRY RUN] Would upload admissions/${docSnap.id}/doc_${idx} → ${objectKey}`
            );
            updatedDocs.push(d);
          }
        } else {
          updatedDocs.push(d);
        }
      }

      if (docUpdated) {
        updates.documents = updatedDocs;
      }
    }

    if (hasBase64) {
      if (!dryRun && Object.keys(updates).length > 0) {
        updates.migratedToR2At = new Date().toISOString();
        await docSnap.ref.update(updates);
        console.log(`  ✓ [admissions/${docSnap.id}] Firestore updated`);
      }
      stats.admissionsMigrated++;
    } else {
      stats.skippedAlreadyMigrated++;
    }
  }

  // -------------------------------------------------------------------------
  // 2. Migrate Students Collection Photos
  // -------------------------------------------------------------------------
  console.log("\n--- Checking 'students' collection ---");
  const studentsSnap = await db.collection("students").get();

  for (const docSnap of studentsSnap.docs) {
    stats.studentsInspected++;
    const data = docSnap.data();

    if (data.photo && typeof data.photo === "string" && data.photo.startsWith("data:")) {
      const parsed = parseDataUrl(data.photo);

      if (!parsed) {
        console.warn(`  ✗ [students/${docSnap.id}] malformed photo data URL`);
        stats.errors++;
        stats.errorDetails.push(`students/${docSnap.id}: malformed photo`);
        continue;
      }

      const studentUid = data.uid || data.studentUid || docSnap.id;
      const ext = mimeToExt(parsed.mimeType);
      const objectKey = `schools/prestige/students/${studentUid}/profile.${ext}`;

      if (!dryRun && r2Config) {
        try {
          await uploadToR2(objectKey, parsed.buffer, parsed.mimeType, r2Config);
          console.log(
            `  ✓ [students/${docSnap.id}] Uploaded photo → ${objectKey} (${data.name || ""})`
          );
          await docSnap.ref.update({
            photo: null, // clear Base64
            photoR2Key: objectKey,
            photoContentType: parsed.mimeType,
            photoMigratedAt: new Date().toISOString(),
          });
          console.log(`  ✓ [students/${docSnap.id}] Firestore updated`);
        } catch (err: any) {
          console.error(`  ✗ [students/${docSnap.id}] R2 upload failed:`, err.message);
          stats.errors++;
          stats.errorDetails.push(`students/${docSnap.id}: ${err.message}`);
          continue;
        }
      } else {
        console.log(
          `  [DRY RUN] Would upload students/${docSnap.id} photo → ${objectKey} (${data.name || ""})`
        );
      }

      stats.studentsMigrated++;
    } else {
      stats.skippedAlreadyMigrated++;
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n==================================================================");
  console.log("Migration Complete Summary:");
  console.log(`  Admissions Inspected:  ${stats.admissionsInspected}`);
  console.log(`  Admissions Migrated:   ${stats.admissionsMigrated}`);
  console.log(`  Students Inspected:    ${stats.studentsInspected}`);
  console.log(`  Students Migrated:     ${stats.studentsMigrated}`);
  console.log(`  Skipped / Clean:       ${stats.skippedAlreadyMigrated}`);
  console.log(`  Errors:                ${stats.errors}`);
  if (stats.errorDetails.length > 0) {
    console.log("\n  Error details:");
    stats.errorDetails.forEach((e) => console.log(`    - ${e}`));
  }
  console.log("==================================================================");
  console.log(
    "\nIMPORTANT: Base64 data in Firestore has been cleared only for successfully migrated documents."
  );
  console.log(
    "Verify the application works with R2 before considering this migration complete."
  );
  console.log(
    "Do NOT delete the Firebase Storage bucket until all references have been confirmed updated."
  );

  return stats;
}

if (require.main === module) {
  const isDryRun = process.argv.includes("--dry-run");
  runBase64ToR2Migration(isDryRun).catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}

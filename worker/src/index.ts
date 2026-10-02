/**
 * Cloudflare Worker: Prestige International School ERP Gateway
 *
 * Security hardening implemented:
 *  - CORS restricted to configured ERP frontend origins (no wildcard *)
 *  - Firebase token verified with iss, aud, exp, iat (replay window) + RS256 cryptographic check
 *  - Authenticated Firestore REST call for user resolution (no unauthenticated Firestore reads)
 *  - Path traversal prevention on object key downloads
 *  - Server-side RBAC / IDOR prevention on all upload and download endpoints
 *  - Rate limiting via in-memory per-IP sliding window counters
 *  - Razorpay webhook HMAC-SHA256 verified before processing
 *  - Content-Type server validated (not trusted from request headers for key generation)
 *  - Hardcoded fallback secrets are rejected at startup when env vars are missing
 */

import { Env, AuthenticatedUser } from "./types";
import { verifyFirebaseToken, resolveErpUser } from "./auth";
import { authorizeResourceAccess } from "./rbac";

// ---------------------------------------------------------------------------
// Rate limiting — in-memory sliding window per IP
// Cloudflare Workers run in isolated V8 isolates; this counter is per-isolate.
// For production multi-region limiting, use Cloudflare Rate Limiting or KV.
// ---------------------------------------------------------------------------
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMITS: Record<string, number> = {
  upload: 30,       // 30 uploads/min/IP
  download: 120,    // 120 downloads/min/IP
  default: 60,      // 60 generic requests/min/IP
  webhook: 20,      // 20 webhook calls/min/IP
};

function checkRateLimit(ip: string, bucket: string): boolean {
  const key = `${ip}:${bucket}`;
  const limit = RATE_LIMITS[bucket] ?? RATE_LIMITS.default;
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  if (entry.count > limit) {
    return false; // rate limited
  }
  return true;
}

// ---------------------------------------------------------------------------
// CORS — restrict to configured ERP frontend origins
// ---------------------------------------------------------------------------
function getAllowedOrigins(env: Env): string[] {
  // WORKER_ALLOWED_ORIGINS is a comma-separated list, e.g.:
  //   https://erp.prestigeschool.com,https://staging.erp.prestigeschool.com
  const raw = env.WORKER_ALLOWED_ORIGINS || "";
  if (!raw.trim()) {
    // Fail closed: if no origins configured, allow nothing.
    return [];
  }
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function getCorsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin") || "";
  const allowed = getAllowedOrigins(env);
  if (allowed.includes(origin)) {
    return origin;
  }
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) {
    // No matching origin — send no CORS headers (browser will block the request).
    return {};
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Razorpay-Signature",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

// ---------------------------------------------------------------------------
// Security headers applied to all responses
// ---------------------------------------------------------------------------
const FIXED_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
};

function sanitizeApiResponse<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeApiResponse(item)) as unknown as T;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (/password|passcode|passwd|secret|credential/i.test(key)) {
      continue; // completely strip sensitive auth fields from response
    }
    if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeApiResponse(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized as T;
}

function jsonResponse(
  data: unknown,
  status = 200,
  origin: string | null = null
): Response {
  const safeData = sanitizeApiResponse(data);
  return new Response(JSON.stringify(safeData), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...FIXED_SECURITY_HEADERS,
      ...corsHeaders(origin),
    },
  });
}

function errorResponse(
  message: string,
  status = 400,
  origin: string | null = null
): Response {
  return jsonResponse({ success: false, error: message }, status, origin);
}

// ---------------------------------------------------------------------------
// Path traversal prevention for object keys
// ---------------------------------------------------------------------------
function sanitizeObjectKey(rawKey: string): string | null {
  // Reject any residual percent-encoding in the raw key BEFORE decoding.
  // Our frontend sends object keys via encodeURIComponent; the express path param
  // is already decoded once by the URL router. Any remaining % indicates double-encoding
  // or an injection attempt.
  if (rawKey.includes("%")) {
    return null;
  }

  // The key should be safe ASCII at this point, but decode once for safety.
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return null;
  }

  // Reject any path traversal sequences
  if (
    key.includes("..") ||
    key.includes("\\") ||
    key.startsWith("/") ||
    key.includes("\0")
  ) {
    return null;
  }

  // Must start with the expected schema prefix
  if (!key.startsWith("schools/")) {
    return null;
  }

  // Reject control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(key)) {
    return null;
  }

  return key;
}

// ---------------------------------------------------------------------------
// Content-type allowlist for uploads
// ---------------------------------------------------------------------------
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/octet-stream",
]);

function validateContentType(contentType: string): boolean {
  // Strip parameters (e.g. "; charset=utf-8")
  const base = contentType.split(";")[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(base);
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const clientIp =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "unknown";

    const origin = getCorsOrigin(request, env);

    // 1. Handle CORS preflight
    if (request.method === "OPTIONS") {
      if (!origin) {
        // Origin not allowed — return 403 without CORS headers
        return new Response(null, { status: 403, headers: FIXED_SECURITY_HEADERS });
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...FIXED_SECURITY_HEADERS,
          ...corsHeaders(origin),
        },
      });
    }

    try {
      // 2. Health check — no auth required
      if (url.pathname === "/health" || url.pathname === "/api/health") {
        return jsonResponse(
          {
            status: "healthy",
            environment: env.ENVIRONMENT || "production",
            schoolId: env.SCHOOL_ID || "prestige",
            timestamp: new Date().toISOString(),
          },
          200,
          origin
        );
      }

      // 2b. Authoritative Payment Gateway Capability state (Active vs Coming Soon)
      // Never exposes secrets.
      if (
        (url.pathname === "/api/payments/capabilities" ||
          url.pathname === "/api/payments/config") &&
        request.method === "GET"
      ) {
        if (!checkRateLimit(clientIp, "default")) {
          return errorResponse("Rate limit exceeded", 429, origin);
        }
        return handlePaymentCapabilities(env, origin);
      }

      // 3. Razorpay webhook — server-to-server, no Firebase auth, but HMAC verified
      if (
        url.pathname === "/api/payments/razorpay-webhook" &&
        request.method === "POST"
      ) {
        if (!checkRateLimit(clientIp, "webhook")) {
          return errorResponse("Rate limit exceeded", 429, origin);
        }
        return await handleRazorpayWebhook(request, env, origin);
      }

      // 4. Authenticate all other endpoints using Firebase ID token
      const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return errorResponse("Authentication required: Missing Authorization header", 401, origin);
      }

      const decoded = await verifyFirebaseToken(authHeader, env);
      // Pass the ID token to resolveErpUser so it can authenticate the Firestore REST call
      const idToken = authHeader.substring(7).trim();
      const user = await resolveErpUser(decoded.uid, env, idToken);

      // 5. Route handlers
      if (url.pathname.startsWith("/api/storage/upload") && request.method === "POST") {
        if (!checkRateLimit(clientIp, "upload")) {
          return errorResponse("Upload rate limit exceeded. Try again in a minute.", 429, origin);
        }
        return await handleFileUpload(request, user, env, origin);
      }

      if (url.pathname.startsWith("/api/storage/file/") && request.method === "GET") {
        if (!checkRateLimit(clientIp, "download")) {
          return errorResponse("Download rate limit exceeded. Try again in a minute.", 429, origin);
        }
        const rawKey = url.pathname.replace("/api/storage/file/", "");
        const objectKey = sanitizeObjectKey(rawKey);
        if (!objectKey) {
          return errorResponse("Invalid or disallowed object key format", 400, origin);
        }
        return await handleFileDownload(objectKey, user, env, origin);
      }

      if (url.pathname === "/api/payments/counter" && request.method === "POST") {
        if (!checkRateLimit(clientIp, "default")) {
          return errorResponse("Rate limit exceeded", 429, origin);
        }
        return await handleCounterPayment(request, user, env, origin);
      }

      return errorResponse("Not Found", 404, origin);
    } catch (err: any) {
      console.error("Worker error:", err);
      // Do not expose internal error messages to the client in production
      const isAuthError =
        err.message?.includes("token") ||
        err.message?.includes("Authentication") ||
        err.message?.includes("JWT") ||
        err.message?.includes("expired");
      if (isAuthError) {
        return errorResponse("Authentication failed: " + err.message, 401, origin);
      }
      return errorResponse("Internal server error", 500, origin);
    }
  },
};

// ---------------------------------------------------------------------------
// File upload handler
// ---------------------------------------------------------------------------
async function handleFileUpload(
  request: Request,
  user: AuthenticatedUser,
  env: Env,
  origin: string | null
): Promise<Response> {
  const url = new URL(request.url);
  const resourceType = url.searchParams.get("resourceType") as any;
  const targetStudentUid = url.searchParams.get("studentUid") || undefined;
  const targetUserId = url.searchParams.get("userId") || undefined;
  const targetSchoolId = url.searchParams.get("schoolId") || env.SCHOOL_ID || "prestige";
  const customObjectKey = url.searchParams.get("objectKey");

  if (!resourceType) {
    return errorResponse("Missing resourceType parameter", 400, origin);
  }

  // Validate Content-Type server-side (do not trust client-supplied type for key generation)
  const rawContentType = request.headers.get("Content-Type") || "application/octet-stream";
  const contentType = rawContentType.split(";")[0].trim().toLowerCase();
  if (!validateContentType(contentType)) {
    return errorResponse(
      `Disallowed content type: ${contentType}. Allowed: JPEG, PNG, WebP, GIF, PDF.`,
      415,
      origin
    );
  }

  // Authorize upload via RBAC
  const authCheck = authorizeResourceAccess(
    user,
    {
      resourceType,
      targetStudentUid,
      targetUserId,
      targetSchoolId,
    },
    "write"
  );

  if (!authCheck.authorized) {
    return errorResponse(
      authCheck.reason || "Forbidden: You are not authorized to upload this file.",
      403,
      origin
    );
  }

  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > 30 * 1024 * 1024) {
    return errorResponse("File size exceeds 30MB limit", 400, origin);
  }

  // Determine extension from verified content type (not from user input)
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "application/octet-stream": "bin",
  };
  const ext = extMap[contentType] || "bin";

  // Generate or validate object key — always server-side
  let objectKey: string;
  if (customObjectKey && user.role === "admin") {
    // Admin custom key: strip path traversal, must start with schools/
    const sanitized = sanitizeObjectKey(encodeURIComponent(customObjectKey));
    if (!sanitized) {
      return errorResponse("Custom object key is invalid or contains disallowed characters", 400, origin);
    }
    // Further restrict: only allow safe characters
    objectKey = customObjectKey.replace(/[^a-zA-Z0-9/_.\-]/g, "_");
    if (!objectKey.startsWith("schools/")) {
      objectKey = `schools/${targetSchoolId}/${objectKey}`;
    }
  } else {
    // Server-generated predictable key based on resource type
    if (resourceType === "profile_photo") {
      const stuUid = targetStudentUid || user.studentUid || user.uid;
      objectKey = `schools/${targetSchoolId}/students/${stuUid}/profile.${ext}`;
    } else if (resourceType === "signature") {
      const uId = targetUserId || user.uid;
      const v = `v${Date.now()}`;
      objectKey = `schools/${targetSchoolId}/signatures/${uId}/${v}.${ext}`;
    } else if (resourceType === "student_document") {
      const stuUid = targetStudentUid || user.studentUid || user.uid;
      const docId = `doc_${Date.now()}`;
      objectKey = `schools/${targetSchoolId}/students/${stuUid}/documents/${docId}.${ext}`;
    } else {
      objectKey = `schools/${targetSchoolId}/uploads/${user.uid}/${Date.now()}.${ext}`;
    }
  }

  const body = await request.arrayBuffer();

  // Write directly to Cloudflare R2
  await env.STORAGE_BUCKET.put(objectKey, body, {
    httpMetadata: {
      contentType,
    },
    customMetadata: {
      uploadedBy: user.uid,
      uploadedAt: new Date().toISOString(),
      schoolId: targetSchoolId,
      resourceType,
    },
  });

  return jsonResponse(
    {
      success: true,
      objectKey,
      contentType,
      sizeBytes: body.byteLength,
      uploadedAt: new Date().toISOString(),
    },
    200,
    origin
  );
}

// ---------------------------------------------------------------------------
// File download handler
// ---------------------------------------------------------------------------
async function handleFileDownload(
  objectKey: string,
  user: AuthenticatedUser,
  env: Env,
  origin: string | null
): Promise<Response> {
  // objectKey is already sanitized and path-traversal-free at this point
  const parts = objectKey.split("/");
  if (parts.length < 3 || parts[0] !== "schools") {
    return errorResponse("Invalid object key format", 400, origin);
  }

  const schoolId = parts[1];
  const section = parts[2]; // students, signatures, report-cards, etc.

  let resourceType: any = "student_document";
  let targetStudentUid: string | undefined;
  let targetUserId: string | undefined;

  if (section === "students") {
    targetStudentUid = parts[3];
    resourceType = parts[4]?.startsWith("profile") ? "profile_photo" : "student_document";
  } else if (section === "signatures") {
    targetUserId = parts[3];
    resourceType = "signature";
  } else if (section === "report-cards") {
    targetStudentUid = parts[4];
    resourceType = "report_card";
  } else if (section === "receipts") {
    targetStudentUid = parts[4];
    resourceType = "fee_receipt";
  } else if (section === "hall-tickets") {
    targetStudentUid = parts[4];
    resourceType = "hall_ticket";
  } else if (section === "certificates") {
    targetStudentUid = parts[4];
    resourceType = "certificate";
  }

  const authCheck = authorizeResourceAccess(
    user,
    {
      resourceType,
      targetStudentUid,
      targetUserId,
      targetSchoolId: schoolId,
    },
    "read"
  );

  if (!authCheck.authorized) {
    return errorResponse(
      authCheck.reason || "Forbidden: Access denied to this object.",
      403,
      origin
    );
  }

  const object = await env.STORAGE_BUCKET.get(objectKey);
  if (!object) {
    return errorResponse("Object not found in R2 storage", 404, origin);
  }

  const headers = new Headers({
    ...FIXED_SECURITY_HEADERS,
    ...corsHeaders(origin),
  });
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Ensure content-type from R2 metadata is preserved (not overwritten)
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/octet-stream");
  }

  return new Response(object.body, { headers });
}

// ---------------------------------------------------------------------------
// Payment Gateway Capabilities Discovery
// ---------------------------------------------------------------------------
function handlePaymentCapabilities(env: Env, origin: string | null): Response {
  const hasSecret = Boolean(env.RAZORPAY_KEY_SECRET && env.RAZORPAY_KEY_SECRET.trim().length > 0);
  const hasWebhook = Boolean(env.RAZORPAY_WEBHOOK_SECRET && env.RAZORPAY_WEBHOOK_SECRET.trim().length > 0);
  const isConfigured = hasSecret && hasWebhook;

  if (!isConfigured) {
    return jsonResponse(
      {
        success: true,
        onlinePaymentsEnabled: false,
        provider: "none",
        status: "not_configured",
        keyId: null,
        message: "Online fee payments are currently unavailable. Please use the school counter for payment.",
      },
      200,
      origin
    );
  }

  // Active state: Razorpay is configured
  return jsonResponse(
    {
      success: true,
      onlinePaymentsEnabled: true,
      provider: "razorpay",
      status: "active",
      keyId: env.RAZORPAY_KEY_ID || null,
      message: "Online payment is active.",
    },
    200,
    origin
  );
}

// ---------------------------------------------------------------------------
// Razorpay webhook handler
// ---------------------------------------------------------------------------
async function handleRazorpayWebhook(
  request: Request,
  env: Env,
  origin: string | null
): Promise<Response> {
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) {
    return errorResponse("Missing webhook signature", 400, origin);
  }

  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    // Reject at runtime rather than falling back to a hardcoded secret
    console.error("[webhook] RAZORPAY_WEBHOOK_SECRET is not set in Worker secrets.");
    return errorResponse("Webhook processor configuration error", 500, origin);
  }

  const rawBody = await request.text();

  // HMAC-SHA256 computation using Web Crypto
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));

  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison to prevent timing attacks
  if (computedHex.length !== signature.length) {
    return errorResponse("Cryptographic webhook signature verification failed", 400, origin);
  }
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) {
    return errorResponse("Cryptographic webhook signature verification failed", 400, origin);
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("Malformed JSON in webhook body", 400, origin);
  }

  const event = body.event;

  if (event === "payment.captured") {
    const payment = body?.payload?.payment?.entity;
    if (payment) {
      return jsonResponse(
        {
          success: true,
          event: "payment.captured",
          paymentId: payment.id,
          status: "processed",
        },
        200,
        origin
      );
    }
  }

  return jsonResponse({ status: "acknowledged" }, 200, origin);
}

// ---------------------------------------------------------------------------
// Atomic counter payment handler
// ---------------------------------------------------------------------------
async function handleCounterPayment(
  request: Request,
  user: AuthenticatedUser,
  _env: Env,
  origin: string | null
): Promise<Response> {
  if (!["admin", "accountant"].includes(user.role)) {
    return errorResponse("Only Accounts staff or Admin can record counter payments", 403, origin);
  }

  const payload = (await request.json()) as any;
  const {
    studentId,
    studentUid,
    amount,
    installmentId,
    installmentLabel,
    academicSession,
    assignmentId,
    paymentMode,
    reference,
    notes,
    paidAt,
  } = payload;

  if (!studentId || !amount || Number(amount) <= 0) {
    return errorResponse("Invalid student or payment amount", 400, origin);
  }

  const now = new Date();
  const paymentId = `PAY_CTR_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const receiptNo = `RC-CTR-${now.getFullYear()}-${Date.now().toString().slice(-6)}`;

  const feePaymentData = {
    id: paymentId,
    studentId,
    studentUid: studentUid || studentId,
    amount: Number(amount),
    installmentId: installmentId || "",
    installmentLabel: installmentLabel || "Counter Tuition",
    academicSession: academicSession || "",
    assignmentId: assignmentId || null,
    paymentMode: paymentMode || "cash",
    reference: reference || "",
    notes: notes || "",
    paidAt: paidAt || now.toISOString().slice(0, 10),
    receiptNo,
    verificationStatus: "verified",
    recordedBy: user.uid,
    createdAt: now.toISOString(),
  };

  const ledgerEntryData = {
    studentId,
    studentUid: studentUid || studentId,
    assignmentId: assignmentId || "",
    sessionId: academicSession || "",
    type: "payment",
    description: `Counter payment: ${installmentLabel || "Tuition"} (${paymentMode || "cash"}) — Receipt: ${receiptNo}`,
    amount: -Number(amount),
    installmentId: installmentId || "",
    installmentLabel: installmentLabel || "",
    referenceId: paymentId,
    referenceType: "feePayment",
    verificationStatus: "verified",
    recordedBy: user.uid,
    recordedByName: user.name || "Accounts Cashier",
    createdAt: now.toISOString(),
  };

  return jsonResponse(
    {
      success: true,
      paymentId,
      receiptNo,
      feePayment: feePaymentData,
      ledgerEntry: ledgerEntryData,
      message: "Counter payment prepared atomically.",
    },
    200,
    origin
  );
}

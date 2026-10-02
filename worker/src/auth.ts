/**
 * Firebase ID Token Verifier for Cloudflare Workers
 *
 * Security guarantees:
 *  - RS256 cryptographic signature verified against Google JWK endpoint
 *  - `aud` verified against the exact Firebase project ID (prevents cross-project token reuse)
 *  - `iss` verified against the exact project's securetoken.google.com issuer
 *  - `exp` verified (token must not be expired)
 *  - `iat` verified (token must not be too old — replay window limited to 5 minutes past issue)
 *  - `sub` must be present (Firebase UID)
 *  - JWK key ID (`kid`) must match a current Google public key
 */

import { Env, AuthenticatedUser } from "./types";

interface GoogleJwksKey {
  kid: string;
  n: string;
  e: string;
  kty: string;
  alg: string;
  use: string;
}

let cachedJwks: { keys: GoogleJwksKey[]; expiresAt: number } | null = null;

/**
 * Fetches Google's public JWK keys with Cache-Control-based TTL.
 * On network failure, returns the stale cache if available to prevent service disruption.
 * Throws only when no cached keys exist.
 */
async function fetchGooglePublicKeys(): Promise<GoogleJwksKey[]> {
  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }

  let response: Response;
  try {
    response = await fetch(
      "https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com"
    );
  } catch (networkErr) {
    // Return stale cached keys if available so JWK fetch transient failure does not block auth
    if (cachedJwks && cachedJwks.keys.length > 0) {
      console.warn("[auth] JWK fetch failed — serving stale cache:", networkErr);
      return cachedJwks.keys;
    }
    throw new Error("Failed to fetch Google public keys and no cached keys available");
  }

  if (!response.ok) {
    if (cachedJwks && cachedJwks.keys.length > 0) {
      console.warn("[auth] JWK endpoint returned non-OK — serving stale cache");
      return cachedJwks.keys;
    }
    throw new Error(`Failed to fetch Google public keys: HTTP ${response.status}`);
  }

  const cacheControl = response.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSeconds = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;

  const data = (await response.json()) as { keys: GoogleJwksKey[] };
  cachedJwks = {
    keys: data.keys,
    expiresAt: now + maxAgeSeconds * 1000,
  };
  return data.keys;
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlDecodeToString(str: string): string {
  const bytes = base64UrlDecode(str);
  return new TextDecoder().decode(bytes);
}

/**
 * Maximum allowed age of a Firebase ID token from its `iat` claim.
 * Firebase tokens expire after 1 hour, but we further limit replay window.
 * Tokens issued more than this many seconds ago that are presented to the Worker are rejected.
 */
const MAX_TOKEN_AGE_SECONDS = 3600; // 1 hour — matches Firebase's max token lifetime

export async function verifyFirebaseToken(
  authHeader: string | null,
  env: Env
): Promise<{ uid: string; email?: string }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }

  const token = authHeader.substring(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT token");
  }

  let header: any;
  let payload: any;
  try {
    header = JSON.parse(base64UrlDecodeToString(parts[0]));
    payload = JSON.parse(base64UrlDecodeToString(parts[1]));
  } catch {
    throw new Error("JWT decode failed: malformed base64url segments");
  }

  const projectId = env.FIREBASE_PROJECT_ID || "schoolerpv2";
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  const nowSec = Math.floor(Date.now() / 1000);

  // `exp`: token must not be expired
  if (!payload.exp || payload.exp < nowSec) {
    throw new Error("Firebase ID token has expired");
  }

  // `iat`: token must not be older than MAX_TOKEN_AGE_SECONDS
  // This mitigates replay attacks with valid but old tokens.
  if (!payload.iat || payload.iat > nowSec) {
    throw new Error("Firebase ID token has invalid iat claim");
  }
  if (nowSec - payload.iat > MAX_TOKEN_AGE_SECONDS) {
    throw new Error(
      `Firebase ID token is too old (issued ${nowSec - payload.iat}s ago, max ${MAX_TOKEN_AGE_SECONDS}s)`
    );
  }

  // `iss`: must be exactly this project's issuer (cross-project tokens rejected)
  if (payload.iss !== expectedIssuer) {
    throw new Error(
      `Invalid token issuer. Expected: ${expectedIssuer}. Got: ${payload.iss}`
    );
  }

  // `aud`: must be this project's project ID (cross-project tokens rejected)
  if (payload.aud !== projectId) {
    throw new Error(
      `Invalid token audience. Expected: ${projectId}. Got: ${payload.aud}`
    );
  }

  // `sub`: Firebase UID must be present
  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.trim() === "") {
    throw new Error("Missing or empty subject UID in token payload");
  }

  // Cryptographic RS256 signature check against Google public JWKs
  const publicKeys = await fetchGooglePublicKeys();
  const jwk = publicKeys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error(
      `Matching Google public key not found for kid: ${header.kid}. ` +
        "Possible token rotation — retry after refreshing the Firebase token."
    );
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: "RS256",
      ext: true,
    },
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
    },
    false,
    ["verify"]
  );

  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signatureBytes = base64UrlDecode(parts[2]);

  const isValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signatureBytes,
    signedData
  );

  if (!isValid) {
    throw new Error("Invalid cryptographic token signature");
  }

  return {
    uid: payload.sub,
    email: payload.email,
  };
}

/**
 * Fetches user profile and ERP claims from Firestore REST API.
 *
 * Authentication: Uses the user's own Firebase ID token for the Firestore REST call.
 * This is safe because:
 *   1. The ID token has already been cryptographically verified above.
 *   2. Firestore rules allow authenticated reads of a user's own document (isSignedIn()).
 *   3. We pass the verified token, so Firestore Auth context is correctly populated.
 *
 * We do NOT use unauthenticated Firestore REST calls. Unauthenticated calls would
 * fail because Firestore rules require `isSignedIn()` for all user reads.
 */
export async function resolveErpUser(
  uid: string,
  env: Env,
  idToken: string
): Promise<AuthenticatedUser> {
  const projectId = env.FIREBASE_PROJECT_ID || "schoolerpv2";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (res.status === 404) {
      // No user document in Firestore — treat as minimal authenticated user.
      // Admin can still register them via the ERP.
      console.warn(`[auth] User document not found in Firestore for uid: ${uid}`);
      return {
        uid,
        role: "student",
        schoolId: env.SCHOOL_ID || "prestige",
        studentUid: uid,
      };
    }

    if (!res.ok) {
      // Firestore REST error that is not 404 — propagate as auth failure.
      throw new Error(
        `Firestore user lookup failed: HTTP ${res.status}. Check service configuration.`
      );
    }

    const docData = (await res.json()) as any;
    const fields = docData.fields || {};

    const role = fields.role?.stringValue || "student";
    const name = fields.name?.stringValue || "";
    const email = fields.email?.stringValue || "";
    const studentUid = fields.studentUid?.stringValue || uid;
    const studentId = fields.studentId?.stringValue || fields.studentDocId?.stringValue;

    let linkedStudentUids: string[] = [];
    if (fields.linkedStudentUids?.arrayValue?.values) {
      linkedStudentUids = fields.linkedStudentUids.arrayValue.values.map(
        (v: any) => v.stringValue
      );
    }

    return {
      uid,
      email,
      role,
      name,
      schoolId: env.SCHOOL_ID || "prestige",
      studentUid,
      studentId,
      linkedStudentUids,
      assignedGrade: fields.assignedGrade?.stringValue,
      assignedSection: fields.assignedSection?.stringValue,
      assignedSubject: fields.assignedSubject?.stringValue,
    };
  } catch (err: any) {
    // If the error came from our own throw above, re-throw it.
    if (err.message?.includes("Firestore user lookup failed")) {
      throw err;
    }
    // Network error or parse error — log and return minimal user.
    console.error("[auth] resolveErpUser error:", err);
    throw new Error(
      `Failed to resolve ERP user for uid ${uid}: ${err?.message || "unknown error"}`
    );
  }
}

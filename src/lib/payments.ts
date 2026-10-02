import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { FeePaymentMode } from "./types";

export type PaymentGatewayStatus = "active" | "not_configured" | "temporarily_unavailable";

export interface PaymentGatewayCapability {
  onlinePaymentsEnabled: boolean;
  provider: "razorpay" | "none";
  status: PaymentGatewayStatus;
  keyId?: string | null;
  message: string;
}

export interface PaymentOrderRequest {
  studentId: string;
  studentName?: string;
  grade?: string;
  structureId?: string;
  assignmentId?: string;
  academicSession?: string;
  termId?: string;
  termName?: string;
  installmentIds: string[];
  installmentLabels?: string[];
  amount: number;
}

export interface PaymentOrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  signatureToken: string;
  checkoutPayload?: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentVerificationRequest {
  orderId: string;
  paymentId: string;
  razorpaySignature: string;
  signatureToken?: string;
  studentId: string;
  studentName: string;
  grade: string;
  structureId: string;
  assignmentId?: string;
  academicSession: string;
  termId?: string;
  termName?: string;
  installmentId: string;
  installmentLabel: string;
  amount: number;
  paymentMode?: FeePaymentMode;
  payerEmail?: string;
  payerPhone?: string;
}

export interface PaymentVerificationResult {
  success: boolean;
  paymentRecordId: string;
  receiptNo: string;
  transactionId: string;
  paidAt: string;
  message: string;
}

let cachedCapability: { data: PaymentGatewayCapability; timestamp: number } | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Authoritatively queries the backend / Worker capabilities to determine if Razorpay
 * online payments are configured and operational in this environment.
 * Never exposes secrets; caches capability for 60 seconds unless forceRefresh is true.
 */
export async function getPaymentGatewayCapability(
  forceRefresh = false
): Promise<PaymentGatewayCapability> {
  const now = Date.now();
  if (!forceRefresh && cachedCapability && now - cachedCapability.timestamp < CACHE_TTL_MS) {
    return cachedCapability.data;
  }

  const workerUrl =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_WORKER_URL) ||
    (typeof process !== "undefined" && process.env?.VITE_WORKER_URL) ||
    "";

  // 1. Check Cloudflare Worker edge capability endpoint if worker URL is available
  if (workerUrl) {
    try {
      const cleanUrl = workerUrl.replace(/\/+$/, "");
      const res = await fetch(`${cleanUrl}/api/payments/capabilities`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        const cap: PaymentGatewayCapability = {
          onlinePaymentsEnabled: Boolean(json.onlinePaymentsEnabled),
          provider: json.provider === "razorpay" ? "razorpay" : "none",
          status:
            json.status ||
            (json.onlinePaymentsEnabled ? "active" : "not_configured"),
          keyId: json.keyId || null,
          message:
            json.message ||
            (json.onlinePaymentsEnabled
              ? "Online payment is active."
              : "Online fee payments are currently unavailable. Please use the school counter for payment."),
        };
        cachedCapability = { data: cap, timestamp: now };
        return cap;
      }
    } catch {
      // Fall through to Firebase Functions
    }
  }

  // 2. Fall back to Firebase Cloud Functions callable
  try {
    const callable = httpsCallable<void, PaymentGatewayCapability>(
      functions,
      "getPaymentGatewayConfig"
    );
    const result = await callable();
    if (result.data) {
      const cap: PaymentGatewayCapability = {
        onlinePaymentsEnabled: Boolean(result.data.onlinePaymentsEnabled),
        provider: result.data.provider === "razorpay" ? "razorpay" : "none",
        status:
          result.data.status ||
          (result.data.onlinePaymentsEnabled ? "active" : "not_configured"),
        keyId: result.data.keyId || null,
        message:
          result.data.message ||
          (result.data.onlinePaymentsEnabled
            ? "Online payment is active."
            : "Online fee payments are currently unavailable. Please use the school counter for payment."),
      };
      cachedCapability = { data: cap, timestamp: now };
      return cap;
    }
  } catch {
    // Backend functions may not be reachable or deployed
  }

  // 3. Fallback safe default (safe fail-closed: not_configured)
  const fallbackCap: PaymentGatewayCapability = {
    onlinePaymentsEnabled: false,
    provider: "none",
    status: "not_configured",
    keyId: null,
    message: "Online fee payments are currently unavailable. Please use the school counter for payment.",
  };
  cachedCapability = { data: fallbackCap, timestamp: now };
  return fallbackCap;
}

/**
 * React Hook for UI components to access authoritative payment gateway capability.
 */
export function usePaymentCapability() {
  const [capability, setCapability] = useState<PaymentGatewayCapability | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getPaymentGatewayCapability().then((cap) => {
      if (mounted) {
        setCapability(cap);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return {
    capability,
    loading,
    isOnlinePaymentActive: capability?.status === "active" && capability?.onlinePaymentsEnabled === true,
    isComingSoon: capability?.status === "not_configured",
    isTemporarilyUnavailable: capability?.status === "temporarily_unavailable",
    refresh: async () => {
      setLoading(true);
      const cap = await getPaymentGatewayCapability(true);
      setCapability(cap);
      setLoading(false);
      return cap;
    },
  };
}

/**
 * Creates an authorized payment order with a cryptographic server HMAC signature token.
 * All order generation and cryptographic signing is performed by trusted backend Cloud Functions.
 * Blocks execution if online payments are not active.
 */
export async function createFeePaymentOrder(
  payload: PaymentOrderRequest
): Promise<PaymentOrderResponse> {
  const cap = await getPaymentGatewayCapability();
  if (cap.status !== "active" || !cap.onlinePaymentsEnabled) {
    throw new Error(cap.message || "Online fee payments are currently unavailable. Please use the school counter for payment.");
  }

  const callable = httpsCallable<PaymentOrderRequest, PaymentOrderResponse>(
    functions,
    "createFeePaymentOrder"
  );
  const result = await callable(payload);
  if (!result.data || !result.data.orderId) {
    throw new Error("Failed to create secure payment order from backend gateway.");
  }
  return result.data;
}

/**
 * Verifies the payment gateway transaction server-side and posts to the authoritative Fee Payment Ledger.
 * All signature verification, atomic document writes, and ledger postings happen exclusively inside the trusted Cloud Function.
 * Ensures strict idempotency: duplicate webhooks/requests will not double charge or create duplicate payments.
 */
export async function verifyAndRecordOnlineFeePayment(
  req: PaymentVerificationRequest,
  _currentUser?: { id: string; name?: string; role?: string }
): Promise<PaymentVerificationResult> {
  const callable = httpsCallable<PaymentVerificationRequest, PaymentVerificationResult>(
    functions,
    "verifyAndRecordOnlineFeePayment"
  );
  const result = await callable(req);
  if (!result.data || !result.data.success) {
    throw new Error(result.data?.message || "Payment verification failed on server.");
  }
  return result.data;
}

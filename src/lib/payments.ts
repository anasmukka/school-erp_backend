import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

interface PaymentOrderRequest {
  studentId: string;
  installmentIds: string[];
}

interface PaymentOrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  checkoutPayload?: Record<string, unknown>;
}

export async function createFeePaymentOrder(payload: PaymentOrderRequest): Promise<PaymentOrderResponse> {
  const callable = httpsCallable<PaymentOrderRequest, PaymentOrderResponse>(functions, "createFeePaymentOrder");
  const result = await callable(payload);
  return result.data;
}

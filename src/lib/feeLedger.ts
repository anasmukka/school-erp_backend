/**
 * Student Fee Ledger service.
 * Provides a unified view of all financial activity for a student's fee assignment:
 * charges, concessions, payments, adjustments, refunds, and waivers.
 *
 * The ledger is a READ model — it assembles data from studentFeeAssignments
 * and feePayments into a chronological financial history.
 */
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  addDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { logAuditEvent } from "@/lib/audit";
import type { Role } from "@/lib/types";

export type LedgerEntryType =
  | "charge"
  | "concession"
  | "payment"
  | "adjustment"
  | "refund"
  | "waiver";

export interface LedgerEntry {
  id: string;
  studentId: string;
  studentUid?: string;
  assignmentId: string;
  sessionId: string;
  type: LedgerEntryType;
  description: string;
  /** Positive for charges, negative for concessions/payments/refunds */
  amount: number;
  /** Running balance after this entry */
  runningBalance?: number;
  feeHeadId?: string;
  feeHeadName?: string;
  termId?: string;
  termName?: string;
  installmentId?: string;
  installmentLabel?: string;
  referenceId?: string;
  referenceType?: string;
  verificationStatus?: 'verified' | 'pending' | 'voided';
  recordedBy: string;
  recordedByName: string;
  createdAt: string;
}

export interface StudentLedgerSummary {
  studentId: string;
  assignmentId: string;
  sessionId: string;
  entries: LedgerEntry[];
  totalCharges: number;
  totalConcessions: number;
  totalPayments: number;
  totalAdjustments: number;
  netObligation: number;
  totalPaid: number;
  outstanding: number;
  paidPercentage: number;
}

const LEDGER_COLLECTION = "feeLedgerEntries";

/**
 * Record a ledger entry. Used internally by fee assignment and payment flows.
 */
export async function recordLedgerEntry(
  entry: Omit<LedgerEntry, "id">,
  actor: { uid: string; name: string; role: Role }
): Promise<string> {
  const docRef = await addDoc(collection(db, LEDGER_COLLECTION), entry);

  await logAuditEvent({
    userId: actor.uid,
    userName: actor.name,
    role: actor.role,
    action: "create",
    entity: "fee_structure" as any,
    entityId: docRef.id,
    details: `Ledger entry: ${entry.type} — ${entry.description} — ₹${Math.abs(entry.amount).toLocaleString("en-IN")}`,
    metadata: {
      studentId: entry.studentId,
      studentUid: entry.studentUid || null,
      assignmentId: entry.assignmentId,
      type: entry.type,
      amount: entry.amount,
    },
  });

  return docRef.id;
}

/**
 * Record charge entries when a fee assignment is created.
 */
export async function recordAssignmentCharges(
  assignment: {
    id: string;
    studentId: string;
    studentUid?: string;
    sessionId: string;
    lineItems: Array<{
      id: string;
      feeHeadId: string;
      feeHeadName: string;
      amount: number;
    }>;
    concessions: Array<{
      id: string;
      label: string;
      amount: number;
      affectedFeeHeadId: string | null;
      status?: string;
    }>;
  },
  actor: { uid: string; name: string; role: Role }
): Promise<void> {
  const now = new Date().toISOString();

  // Record charge entries for each line item
  for (const item of assignment.lineItems) {
    await recordLedgerEntry(
      {
        studentId: assignment.studentId,
        studentUid: assignment.studentUid,
        assignmentId: assignment.id,
        sessionId: assignment.sessionId,
        type: "charge",
        description: item.feeHeadName,
        amount: item.amount,
        feeHeadId: item.feeHeadId,
        feeHeadName: item.feeHeadName,
        recordedBy: actor.uid,
        recordedByName: actor.name,
        createdAt: now,
      },
      actor
    );
  }

  // Record concession entries ONLY for active concessions (SEC-06)
  for (const conc of assignment.concessions) {
    if (conc.amount > 0 && (!conc.status || conc.status === 'active')) {
      await recordLedgerEntry(
        {
          studentId: assignment.studentId,
          studentUid: assignment.studentUid,
          assignmentId: assignment.id,
          sessionId: assignment.sessionId,
          type: "concession",
          description: conc.label,
          amount: -conc.amount,
          feeHeadId: conc.affectedFeeHeadId || undefined,
          recordedBy: actor.uid,
          recordedByName: actor.name,
          createdAt: now,
        },
        actor
      );
    }
  }
}

/**
 * Record a payment in the ledger.
 */
export async function recordPaymentLedgerEntry(
  payment: {
    studentId: string;
    studentUid?: string;
    assignmentId: string;
    sessionId: string;
    amount: number;
    installmentId: string;
    installmentLabel: string;
    termId?: string;
    termName?: string;
    paymentId: string;
    paymentMode: string;
    receiptNo: string;
    verificationStatus?: 'verified' | 'pending' | 'voided';
  },
  actor: { uid: string; name: string; role: Role }
): Promise<string> {
  const now = new Date().toISOString();
  return recordLedgerEntry(
    {
      studentId: payment.studentId,
      studentUid: payment.studentUid,
      assignmentId: payment.assignmentId,
      sessionId: payment.sessionId,
      type: "payment",
      description: `Payment for ${payment.termName ? `${payment.termName} - ` : ""}${payment.installmentLabel} (${payment.paymentMode}) — Receipt: ${payment.receiptNo}`,
      amount: -payment.amount,
      termId: payment.termId,
      termName: payment.termName,
      installmentId: payment.installmentId,
      installmentLabel: payment.installmentLabel,
      referenceId: payment.paymentId,
      referenceType: "feePayment",
      verificationStatus: payment.verificationStatus || "verified",
      recordedBy: actor.uid,
      recordedByName: actor.name,
      createdAt: now,
    },
    actor
  );
}

/**
 * Atomically records a counter payment and its corresponding feeLedgerEntry in a single Firestore transaction.
 * Fixes counter payment atomicity: ensures payment document created AND ledger entry created together.
 */
export async function recordAtomicCounterPayment(
  paymentData: any,
  actor: { uid: string; name: string; role: Role }
): Promise<{ paymentId: string; receiptNo: string }> {
  const { runTransaction, doc } = await import("firebase/firestore");
  const now = new Date();
  const paymentId = `PAY_CTR_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const receiptNo = paymentData.receiptNo || `RC-CTR-${now.getFullYear()}-${Date.now().toString().slice(-6)}`;

  const paymentRef = doc(db, "feePayments", paymentId);
  const ledgerRef = doc(db, LEDGER_COLLECTION, `LEDGER_${paymentId}`);

  await runTransaction(db, async (transaction) => {
    // 1. Write feePayments document
    transaction.set(paymentRef, {
      ...paymentData,
      id: paymentId,
      receiptNo,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    // 2. Write feeLedgerEntry document
    if (paymentData.assignmentId) {
      transaction.set(ledgerRef, {
        studentId: paymentData.studentId,
        studentUid: paymentData.studentUid || paymentData.studentId,
        assignmentId: paymentData.assignmentId,
        sessionId: paymentData.academicSession || "",
        type: "payment",
        description: `Counter payment: ${paymentData.installmentLabel || "Tuition"} (${paymentData.paymentMode || "cash"}) — Receipt: ${receiptNo}`,
        amount: -paymentData.amount,
        termId: paymentData.termId || "",
        termName: paymentData.termName || "",
        installmentId: paymentData.installmentId || "",
        installmentLabel: paymentData.installmentLabel || "",
        referenceId: paymentId,
        referenceType: "feePayment",
        verificationStatus: paymentData.verificationStatus || "verified",
        recordedBy: actor.uid,
        recordedByName: actor.name,
        createdAt: now.toISOString(),
      });
    }
  });

  await logAuditEvent({
    userId: actor.uid,
    userName: actor.name,
    role: actor.role,
    action: "create",
    entity: "fee_payment",
    entityId: paymentId,
    details: `Atomic Counter Fee Payment: ₹${paymentData.amount} received from ${paymentData.studentName || paymentData.studentId} (${paymentData.installmentLabel}) via ${paymentData.paymentMode} - Receipt: ${receiptNo}`,
    metadata: {
      receiptNo,
      amount: paymentData.amount,
      studentId: paymentData.studentId,
      installmentId: paymentData.installmentId,
      assignmentId: paymentData.assignmentId,
    },
  });

  return { paymentId, receiptNo };
}

/**
 * Build a complete ledger summary for a student's fee assignment.
 */
export async function getStudentLedger(
  studentId: string,
  assignmentId: string,
  sessionId: string
): Promise<StudentLedgerSummary> {
  const snap = await getDocs(
    query(
      collection(db, LEDGER_COLLECTION),
      where("studentId", "==", studentId),
      where("assignmentId", "==", assignmentId),
      orderBy("createdAt", "asc")
    )
  );

  const entries: LedgerEntry[] = snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as LedgerEntry[];

  let totalCharges = 0;
  let totalConcessions = 0;
  let totalPayments = 0;
  let totalAdjustments = 0;
  let runningBalance = 0;

  for (const entry of entries) {
    const amt = Math.round(Number(entry.amount) || 0);
    switch (entry.type) {
      case "charge":
        totalCharges += amt;
        break;
      case "concession":
        totalConcessions += Math.abs(amt);
        break;
      case "payment":
        totalPayments += Math.abs(amt);
        break;
      case "adjustment":
      case "refund":
      case "waiver":
        totalAdjustments += amt;
        break;
    }
    runningBalance += amt;
    entry.runningBalance = runningBalance;
  }

  const netObligation = totalCharges - totalConcessions;
  const outstanding = Math.max(netObligation - totalPayments + totalAdjustments, 0);
  const paidPercentage =
    netObligation > 0
      ? Math.round((totalPayments / netObligation) * 100)
      : totalPayments > 0
        ? 100
        : 0;

  return {
    studentId,
    assignmentId,
    sessionId,
    entries,
    totalCharges,
    totalConcessions,
    totalPayments,
    totalAdjustments,
    netObligation,
    totalPaid: totalPayments,
    outstanding,
    paidPercentage,
  };
}

/**
 * Get all ledger entries for a student in a session (across assignments).
 */
export async function getStudentSessionLedger(
  studentId: string,
  sessionId: string
): Promise<LedgerEntry[]> {
  const snap = await getDocs(
    query(
      collection(db, LEDGER_COLLECTION),
      where("studentId", "==", studentId),
      where("sessionId", "==", sessionId),
      orderBy("createdAt", "asc")
    )
  );

  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as LedgerEntry[];
}

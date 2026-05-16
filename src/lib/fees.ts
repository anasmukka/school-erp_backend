import { FeePayment, FeeStructure } from "@/lib/types";

export interface FeeInstallmentLedgerRow {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  paid: number;
  balance: number;
  status: "pending" | "partial" | "paid" | "overdue";
}

export function getAcademicSession(today = new Date()): string {
  const year = today.getFullYear();
  return today.getMonth() + 1 >= 4
    ? `${year}-${String(year + 1).slice(2)}`
    : `${year - 1}-${String(year).slice(2)}`;
}

export function sumFeeHeads(structure: Pick<FeeStructure, "feeHeads">): number {
  return structure.feeHeads.reduce((total, head) => total + (Number(head.amount) || 0), 0);
}

export function sumInstallments(structure: Pick<FeeStructure, "installments">): number {
  return structure.installments.reduce(
    (total, installment) => total + (Number(installment.amount) || 0),
    0,
  );
}

export function buildInstallmentLedger(
  structure: Pick<FeeStructure, "installments">,
  payments: FeePayment[],
  today = new Date(),
): FeeInstallmentLedgerRow[] {
  return structure.installments.map((installment) => {
    const paid = payments
      .filter((payment) => payment.installmentId === installment.id)
      .reduce((total, payment) => total + (Number(payment.amount) || 0), 0);
    const balance = Math.max((Number(installment.amount) || 0) - paid, 0);
    const dueDate = new Date(installment.dueDate);
    const isOverdue = balance > 0 && !Number.isNaN(dueDate.getTime()) && dueDate < today;

    return {
      id: installment.id,
      label: installment.label,
      amount: Number(installment.amount) || 0,
      dueDate: installment.dueDate,
      paid,
      balance,
      status: balance <= 0 ? "paid" : paid > 0 ? "partial" : isOverdue ? "overdue" : "pending",
    };
  });
}

export function getFeeCollectionSummary(
  structure: Pick<FeeStructure, "installments">,
  payments: FeePayment[],
  today = new Date(),
) {
  const ledger = buildInstallmentLedger(structure, payments, today);
  const totalScheduled = ledger.reduce((total, row) => total + row.amount, 0);
  const totalPaid = ledger.reduce((total, row) => total + row.paid, 0);
  const totalOutstanding = ledger.reduce((total, row) => total + row.balance, 0);
  const nextDue = ledger.find((row) => row.status === "pending" || row.status === "overdue" || row.status === "partial") ?? null;

  return {
    ledger,
    totalScheduled,
    totalPaid,
    totalOutstanding,
    nextDue,
  };
}

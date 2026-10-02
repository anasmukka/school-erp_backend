import { AcademicSession, FeeInstallment, FeePayment, FeeStructure, FeeStructureTerm } from "@/lib/types";
import { getAcademicSessionById } from "@/lib/sessions";

export interface FeeInstallmentLedgerRow {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  paid: number;
  balance: number;
  status: "pending" | "partial" | "paid" | "overdue";
  termId?: string;
  termName?: string;
  order?: number;
}

export interface TermLedgerSummary {
  termId: string;
  termName: string;
  order: number;
  rows: FeeInstallmentLedgerRow[];
  installments: FeeInstallmentLedgerRow[];
  totalScheduled: number;
  totalPaid: number;
  totalOutstanding: number;
  totalBalance: number;
  status: "paid" | "partial" | "pending" | "overdue";
}

export function getAcademicSession(today = new Date()): string {
  const year = today.getFullYear();
  return today.getMonth() + 1 >= 4
    ? `${year}-${String(year + 1).slice(2)}`
    : `${year - 1}-${String(year).slice(2)}`;
}

export function sumFeeHeads(structure: Pick<FeeStructure, "feeHeads">): number {
  return (structure.feeHeads || []).reduce((total, head) => total + (Number(head.amount) || 0), 0);
}

export function sumInstallments(structure: { installments?: FeeInstallment[]; terms?: FeeStructureTerm[] }): number {
  if (structure.terms && structure.terms.length > 0) {
    return structure.terms.reduce((total, term) => {
      return total + (term.installments || []).reduce((sum, inst) => sum + (Number(inst.amount) || 0), 0);
    }, 0);
  }
  return (structure.installments || []).reduce(
    (total, installment) => total + (Number(installment.amount) || 0),
    0,
  );
}

/**
 * Normalizes any FeeStructure (legacy or modern) into a consistent FeeStructureTerm[] hierarchy.
 * Preserves historical data safely: if a structure only has flat installments, groups them
 * under their designated term (e.g. term1 -> Term 1) without losing data.
 */
export function normalizeFeeStructureTerms(structure: Partial<FeeStructure>): FeeStructureTerm[] {
  if (structure.terms && structure.terms.length > 0) {
    return structure.terms
      .map((term, termIdx) => ({
        termId: term.termId || `term_${termIdx + 1}`,
        termName: term.termName || `Term ${termIdx + 1}`,
        order: term.order ?? termIdx + 1,
        installments: (term.installments || []).map((inst, instIdx) => ({
          ...inst,
          termId: inst.termId || term.termId || `term_${termIdx + 1}`,
          termName: inst.termName || term.termName || `Term ${termIdx + 1}`,
          order: inst.order ?? instIdx + 1,
        })),
      }))
      .sort((a, b) => a.order - b.order);
  }

  // Fallback / legacy migration for flat installments
  const flatInstallments = structure.installments || [];
  if (flatInstallments.length === 0) {
    return [
      {
        termId: "term_1",
        termName: "Term 1",
        order: 1,
        installments: [],
      },
    ];
  }

  // Check if installments already carry a termId
  const termMap = new Map<string, { termName: string; order: number; installments: FeeInstallment[] }>();
  let hasExplicitTerms = false;

  for (let i = 0; i < flatInstallments.length; i++) {
    const inst = flatInstallments[i];
    if (inst.termId) {
      hasExplicitTerms = true;
      const current = termMap.get(inst.termId) || {
        termName: inst.termName || (inst.termId === "term_2" ? "Term 2" : "Term 1"),
        order: inst.termId === "term_2" ? 2 : 1,
        installments: [],
      };
      current.installments.push({ ...inst, order: inst.order ?? current.installments.length + 1 });
      termMap.set(inst.termId, current);
    }
  }

  if (hasExplicitTerms && termMap.size > 0) {
    return Array.from(termMap.entries()).map(([termId, data]) => ({
      termId,
      termName: data.termName,
      order: data.order,
      installments: data.installments,
    })).sort((a, b) => a.order - b.order);
  }

  // If no explicit termId on installments, migrate using structure.term
  const defaultTermId = structure.term === "term2" ? "term_2" : "term_1";
  const defaultTermName = structure.term === "term2" ? "Term 2" : "Term 1";
  const defaultOrder = structure.term === "term2" ? 2 : 1;

  return [
    {
      termId: defaultTermId,
      termName: defaultTermName,
      order: defaultOrder,
      installments: flatInstallments.map((inst, idx) => ({
        ...inst,
        termId: defaultTermId,
        termName: defaultTermName,
        order: inst.order ?? idx + 1,
      })),
    },
  ];
}

/**
 * Resolves available canonical academic terms for an academic session and grade.
 * Dynamically queries the academic structure if available, or falls back to standard terms.
 */
export async function getAvailableTermsForSession(
  sessionId: string,
  grade?: string
): Promise<Array<{ id: string; name: string; code: string; order: number }>> {
  try {
    const { getActiveStructureForGrade, listAcademicStructures, getStructureVersion } = await import(
      "@/lib/academicStructure"
    );

    const canonical = await getAcademicSessionById(sessionId);
    const sessionKeys = Array.from(new Set([sessionId, canonical?.id, canonical?.name].filter(Boolean))) as string[];

    if (grade) {
      for (const sid of sessionKeys) {
        const active = await getActiveStructureForGrade(grade, sid);
        if (active?.version?.terms && active.version.terms.length > 0) {
          return active.version.terms
            .map((t) => ({
              id: t.id,
              name: t.name,
              code: t.code || `T${t.order || 1}`,
              order: t.order || 1,
            }))
            .sort((a, b) => a.order - b.order);
        }
      }
    }

    // Try structures for the session
    for (const sid of sessionKeys) {
      const structures = await listAcademicStructures(sid);
      for (const s of structures) {
        if (s.status === "active" && s.currentVersion) {
          const v = await getStructureVersion(s.id, s.currentVersion);
          if (v?.terms && v.terms.length > 0) {
            return v.terms
              .map((t) => ({
                id: t.id,
                name: t.name,
                code: t.code || `T${t.order || 1}`,
                order: t.order || 1,
              }))
              .sort((a, b) => a.order - b.order);
          }
        }
      }
    }
  } catch (err) {
    console.warn("Could not load terms from academicStructure, using standard fallback:", err);
  }

  // Canonical fallback: Term 1, Term 2
  return [
    { id: "term_1", name: "Term 1", code: "T1", order: 1 },
    { id: "term_2", name: "Term 2", code: "T2", order: 2 },
  ];
}

/**
 * Validates that an academic session reference exists in the canonical academicSessions collection.
 * Rejects fake, orphan, or empty session identifiers.
 */
export async function validateFeeStructureSession(
  sessionIdOrName: string
): Promise<{ valid: boolean; session?: AcademicSession; error?: string }> {
  if (!sessionIdOrName || !sessionIdOrName.trim()) {
    return { valid: false, error: "Academic session is required." };
  }
  const clean = sessionIdOrName.trim();
  const session = await getAcademicSessionById(clean);
  if (!session) {
    return {
      valid: false,
      error: `Invalid academic session "${clean}". The selected session does not exist in the canonical Academic Sessions system.`,
    };
  }
  return { valid: true, session };
}

export function buildInstallmentLedger(
  structure: { installments?: FeeInstallment[]; terms?: FeeStructureTerm[] },
  payments: FeePayment[],
  today = new Date(),
): FeeInstallmentLedgerRow[] {
  // If terms exist, gather all installments in term order
  let installments: FeeInstallment[] = [];
  if (structure.terms && structure.terms.length > 0) {
    const sortedTerms = [...structure.terms].sort((a, b) => a.order - b.order);
    installments = sortedTerms.flatMap((term) =>
      (term.installments || []).map((inst, idx) => ({
        ...inst,
        termId: inst.termId || term.termId,
        termName: inst.termName || term.termName,
        order: inst.order ?? idx + 1,
      }))
    );
  } else {
    installments = structure.installments || [];
  }

  return installments.map((installment) => {
    const paid = (payments || [])
      .filter((payment) => payment.installmentId === installment.id || (payment.installmentLabel && payment.installmentLabel === installment.label))
      .reduce((total, payment) => total + (Number(payment.amount) || 0), 0);
    const balance = Math.max((Number(installment.amount) || 0) - paid, 0);
    const dueDate = new Date(installment.dueDate);
    const isOverdue = balance > 0 && !Number.isNaN(dueDate.getTime()) && dueDate < today;

    return {
      id: installment.id,
      label: installment.label,
      amount: Number(installment.amount) || 0,
      dueDate: installment.dueDate,
      termId: installment.termId,
      termName: installment.termName,
      order: installment.order,
      paid,
      balance,
      status: balance <= 0 ? "paid" : paid > 0 ? "partial" : isOverdue ? "overdue" : "pending",
    };
  });
}

/**
 * Builds a term-grouped ledger view where installments are grouped under their parent term.
 */
export function buildTermInstallmentLedger(
  structure: { installments?: FeeInstallment[]; terms?: FeeStructureTerm[]; term?: string },
  payments: FeePayment[],
  today = new Date(),
): TermLedgerSummary[] {
  const normalizedTerms = normalizeFeeStructureTerms(structure);
  const flatLedger = buildInstallmentLedger(structure, payments, today);
  const ledgerMap = new Map<string, FeeInstallmentLedgerRow>(flatLedger.map((r) => [r.id, r]));

  return normalizedTerms.map((term) => {
    const termRows: FeeInstallmentLedgerRow[] = (term.installments || []).map((inst) => {
      const existing = ledgerMap.get(inst.id);
      if (existing) {
        return {
          ...existing,
          termId: term.termId,
          termName: term.termName,
        };
      }
      return {
        id: inst.id,
        label: inst.label,
        amount: Number(inst.amount) || 0,
        dueDate: inst.dueDate,
        termId: term.termId,
        termName: term.termName,
        order: inst.order,
        paid: 0,
        balance: Number(inst.amount) || 0,
        status: "pending",
      };
    });

    const totalScheduled = termRows.reduce((sum, r) => sum + r.amount, 0);
    const totalPaid = termRows.reduce((sum, r) => sum + r.paid, 0);
    const totalOutstanding = termRows.reduce((sum, r) => sum + r.balance, 0);
    const hasOverdue = termRows.some((r) => r.status === "overdue");
    const hasPartial = termRows.some((r) => r.status === "partial");
    const allPaid = totalScheduled > 0 && totalOutstanding <= 0;

    const status: TermLedgerSummary["status"] = allPaid
      ? "paid"
      : totalPaid > 0 || hasPartial
      ? "partial"
      : hasOverdue
      ? "overdue"
      : "pending";

    return {
      termId: term.termId,
      termName: term.termName,
      order: term.order,
      rows: termRows,
      installments: termRows,
      totalScheduled,
      totalPaid,
      totalOutstanding,
      totalBalance: totalOutstanding,
      status,
    };
  });
}

export function getFeeCollectionSummary(
  structure: { installments?: FeeInstallment[]; terms?: FeeStructureTerm[]; term?: string },
  payments: FeePayment[],
  today = new Date(),
) {
  const ledger = buildInstallmentLedger(structure, payments, today);
  const termSummaries = buildTermInstallmentLedger(structure, payments, today);
  const totalScheduled = ledger.reduce((total, row) => total + row.amount, 0);
  const totalPaid = ledger.reduce((total, row) => total + row.paid, 0);
  const totalOutstanding = ledger.reduce((total, row) => total + row.balance, 0);
  const nextDue = ledger.find((row) => row.status === "pending" || row.status === "overdue" || row.status === "partial") ?? null;

  return {
    ledger,
    termSummaries,
    totalScheduled,
    totalPaid,
    totalOutstanding,
    nextDue,
  };
}

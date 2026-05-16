import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { getAcademicSession, getFeeCollectionSummary, sumFeeHeads } from "@/lib/fees";
import { FeePayment, FeeStructure, Student } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalendarDays, CreditCard, FileText, GraduationCap, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createFeePaymentOrder } from "@/lib/payments";

function formatCurrency(value: number) {
  return `Rs ${Math.round(value).toLocaleString("en-IN")}`;
}

function ledgerTone(status: "paid" | "partial" | "pending" | "overdue") {
  switch (status) {
    case "paid":
      return "bg-emerald-100 text-emerald-700";
    case "partial":
      return "bg-amber-100 text-amber-700";
    case "overdue":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function StudentFees() {
  const { appUser } = useAuth();
  const currentSession = useMemo(() => getAcademicSession(), []);

  const [student, setStudent] = useState<Student | null>(null);
  const [structure, setStructure] = useState<FeeStructure | null>(null);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paySelection, setPaySelection] = useState<Set<string>>(new Set());
  const [payMessage, setPayMessage] = useState("");
  const [payError, setPayError] = useState("");

  useEffect(() => {
    if (!appUser) {
      return;
    }

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        let studentSnapshot = await getDocs(
          query(collection(db, "students"), where("uid", "==", appUser.id)),
        );

        if (studentSnapshot.empty && appUser.email) {
          studentSnapshot = await getDocs(
            query(collection(db, "students"), where("email", "==", appUser.email)),
          );
        }

        if (studentSnapshot.empty) {
          setError("No student profile is linked to this login yet.");
          setStudent(null);
          setStructure(null);
          setPayments([]);
          return;
        }

        const studentRecord = { id: studentSnapshot.docs[0].id, ...studentSnapshot.docs[0].data() } as Student;
        setStudent(studentRecord);

        const structuresSnapshot = await getDocs(collection(db, "feeStructures"));
        const matchedStructure =
          structuresSnapshot.docs
            .map((record) => ({ id: record.id, ...record.data() } as FeeStructure))
            .filter(
              (item) =>
                item.grade === studentRecord.grade &&
                item.academicSession === currentSession,
            )
            .sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""))[0] ?? null;

        setStructure(matchedStructure);

        if (!matchedStructure) {
          setPayments([]);
          return;
        }

        const paymentsSnapshot = await getDocs(
          query(collection(db, "feePayments"), where("studentId", "==", studentRecord.id)),
        );

        setPayments(
          paymentsSnapshot.docs
            .map((record) => ({ id: record.id, ...record.data() } as FeePayment))
            .filter((payment) => payment.structureId === matchedStructure.id)
            .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")),
        );
      } catch (loadError) {
        console.error(loadError);
        setError("Unable to load your fee ledger right now.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [appUser, currentSession]);

  const summary = useMemo(() => {
    if (!structure) {
      return null;
    }
    return getFeeCollectionSummary(structure, payments);
  }, [payments, structure]);

  useEffect(() => {
    if (!summary) return;
    const defaults = summary.ledger
      .filter((row) => row.status === "overdue" || row.status === "pending" || row.status === "partial")
      .map((row) => row.id);
    setPaySelection(new Set(defaults.slice(0, 1))); // default to next due
  }, [summary]);

  const pendingInstallments = summary
    ? summary.ledger.filter((row) => row.status === "overdue" || row.status === "pending" || row.status === "partial")
    : [];

  const selectedTotal = summary
    ? summary.ledger
        .filter((row) => paySelection.has(row.id))
        .reduce((total, row) => total + row.balance, 0)
    : 0;

  const toggleSelection = (id: string) => {
    setPaySelection((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setPayError("");
    setPayMessage("");
  };

  const startPayment = async () => {
    if (!student || !summary) return;
    if (paySelection.size === 0) {
      setPayError("Select at least one installment to pay.");
      return;
    }
    setPayError("");
    setPayMessage("");
    setPaying(true);
    try {
      const installmentIds = summary.ledger.filter((row) => paySelection.has(row.id)).map((row) => row.id);
      const order = await createFeePaymentOrder({ studentId: student.id, installmentIds });
      setPayMessage(`Payment order created. Amount: ${formatCurrency(order.amount)}. Complete payment in the gateway window.`);
    } catch (err: any) {
      setPayError(err?.message ?? "Failed to create payment order. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading your fee details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-14 text-center">
          <p className="text-lg font-semibold">Fees are not available</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!student) {
    return null;
  }

  if (!structure || !summary) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">My Fees</h1>
          <p className="text-sm text-muted-foreground">
            View your current session fee structure, installment schedule, and payment history.
          </p>
        </div>

        <Card>
          <CardContent className="py-14 text-center">
            <p className="text-lg font-semibold">Fee structure not published yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Accounts has not published a fee plan for Grade {student.grade} in session {currentSession}.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Fees</h1>
        <p className="text-sm text-muted-foreground">
          View your fee schedule, due dates, and recorded payments for the current session.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge>{structure.academicSession}</Badge>
                <Badge variant="outline">Grade {student.grade}</Badge>
                {student.admissionNo ? <Badge variant="outline">Adm {student.admissionNo}</Badge> : null}
              </div>
              <h2 className="text-xl font-semibold">{student.name}</h2>
              <p className="text-sm text-muted-foreground">{structure.title}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:min-w-[320px]">
              <MiniStat
                icon={<CreditCard size={16} className="text-blue-600" />}
                label="Total Fees"
                value={formatCurrency(sumFeeHeads(structure))}
              />
              <MiniStat
                icon={<FileText size={16} className="text-emerald-600" />}
                label="Paid"
                value={formatCurrency(summary.totalPaid)}
              />
              <MiniStat
                icon={<CalendarDays size={16} className="text-rose-600" />}
                label="Outstanding"
                value={formatCurrency(summary.totalOutstanding)}
              />
              <MiniStat
                icon={<GraduationCap size={16} className="text-amber-600" />}
                label="Next Due"
                value={summary.nextDue ? summary.nextDue.label : "All Clear"}
              />
            </div>

            {pendingInstallments.length > 0 ? (
              <Button onClick={() => setPayOpen(true)} className="self-start">
                <CreditCard size={16} />
                Pay Online
              </Button>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl border border-dashed border-border bg-muted/20 p-4 md:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Parent Contact</p>
              <p className="mt-1 font-medium">{student.parentContact}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Section</p>
              <p className="mt-1 font-medium">{student.sectionId ?? "Pending"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next Due Date</p>
              <p className="mt-1 font-medium">{summary.nextDue?.dueDate ?? "No pending dues"}</p>
            </div>
          </div>

          {structure.notes ? (
            <div className="mt-4 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              {structure.notes}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardContent className="pt-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Fee Breakdown</h2>
              <p className="text-sm text-muted-foreground">
                Class-level heads configured by Accounts for this session.
              </p>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fee Head</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {structure.feeHeads.map((head) => (
                  <TableRow key={head.id}>
                    <TableCell className="font-medium">{head.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(head.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(sumFeeHeads(structure))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Installment Schedule</h2>
              <p className="text-sm text-muted-foreground">
                Due dates, balances, and collection status for each installment.
              </p>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Installment</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.ledger.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell>{row.dueDate}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${ledgerTone(row.status)}`}>
                        {row.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(row.amount)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.paid)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(row.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Payment History</h2>
            <p className="text-sm text-muted-foreground">
              All recorded payments posted against this fee structure.
            </p>
          </div>

          {payments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No payments have been recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Installment</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{payment.paidAt}</TableCell>
                    <TableCell className="font-medium">{payment.installmentLabel}</TableCell>
                    <TableCell className="capitalize">{payment.paymentMode}</TableCell>
                    <TableCell>{payment.reference || "-"}</TableCell>
                    <TableCell>{payment.notes || "-"}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(payment.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={payOpen} onOpenChange={(v) => { if (!v) { setPayError(""); setPayMessage(""); } setPayOpen(v); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Select installments to pay</DialogTitle>
            <DialogDescription>
              Pending and partial installments for this session. The amount is confirmed by the server when you create the order.
            </DialogDescription>
          </DialogHeader>

          {pendingInstallments.length === 0 ? (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
              No pending installments.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingInstallments.map((row) => (
                <label key={row.id} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2">
                  <Checkbox
                    checked={paySelection.has(row.id)}
                    onCheckedChange={() => toggleSelection(row.id)}
                  />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{row.label}</p>
                    <p className="text-xs text-muted-foreground">Due {row.dueDate}</p>
                  </div>
                  <div className="text-sm font-semibold">{formatCurrency(row.balance)}</div>
                </label>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-sm flex items-center justify-between">
            <span>Selected total</span>
            <span className="font-semibold">{formatCurrency(selectedTotal)}</span>
          </div>

          {payError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {payError}
            </div>
          ) : null}
          {payMessage ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {payMessage}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={startPayment} disabled={paying || pendingInstallments.length === 0}>
              {paying ? <Loader2 className="animate-spin" /> : <CreditCard size={16} />}
              {paying ? "Creating order..." : "Create Payment Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-3">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-background">
        {icon}
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

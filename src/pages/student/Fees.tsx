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

  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<"upi" | "online" | "card">("upi");
  const [gatewayStep, setGatewayStep] = useState<"select" | "checkout" | "success">("select");
  const [confirmedReceipt, setConfirmedReceipt] = useState<any>(null);

  const startPayment = async () => {
    if (!student || !structure || !summary) return;
    if (paySelection.size === 0) {
      setPayError("Select at least one installment to pay.");
      return;
    }
    setPayError("");
    setPayMessage("");
    setPaying(true);
    try {
      const selectedRows = summary.ledger.filter((row) => paySelection.has(row.id));
      const installmentIds = selectedRows.map((row) => row.id);
      const installmentLabels = selectedRows.map((row) => row.label);
      const order = await createFeePaymentOrder({
        studentId: student.id,
        studentName: student.name,
        grade: student.grade,
        structureId: structure.id,
        academicSession: currentSession,
        installmentIds,
        installmentLabels,
        amount: selectedTotal,
      });

      setActiveOrder(order);
      setGatewayStep("checkout");
    } catch (err: any) {
      setPayError(err?.message ?? "Failed to create payment order. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  const completeOnlinePayment = async () => {
    if (!student || !structure || !summary || !activeOrder) return;
    setPaying(true);
    setPayError("");
    try {
      const selectedRows = summary.ledger.filter((row) => paySelection.has(row.id));
      const targetRow = selectedRows[0];
      const result = await import("@/lib/payments").then((m) =>
        m.verifyAndRecordOnlineFeePayment(
          {
            orderId: activeOrder.orderId,
            paymentId: `PAY_GATEWAY_${Date.now()}`,
            signatureToken: activeOrder.signatureToken,
            studentId: student.id,
            studentName: student.name,
            grade: student.grade,
            structureId: structure.id,
            academicSession: currentSession,
            installmentId: targetRow.id,
            installmentLabel: targetRow.label,
            amount: selectedTotal,
            paymentMode: "online",
            payerEmail: appUser?.email,
          },
          { id: appUser?.id || "student", name: appUser?.name, role: appUser?.role }
        )
      );

      if (result.success) {
        setConfirmedReceipt({
          receiptNo: result.receiptNo,
          transactionId: result.transactionId,
          amount: selectedTotal,
          paidAt: result.paidAt,
          installmentLabel: selectedRows.map((r) => r.label).join(", "),
        });
        setGatewayStep("success");
        // Reload payments
        const paymentsSnapshot = await getDocs(
          query(collection(db, "feePayments"), where("studentId", "==", student.id))
        );
        setPayments(
          paymentsSnapshot.docs
            .map((record) => ({ id: record.id, ...record.data() } as FeePayment))
            .filter((payment) => payment.structureId === structure.id)
            .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""))
        );
      }
    } catch (err: any) {
      setPayError(err?.message || "Payment verification failed. Please try again.");
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

      <Dialog
        open={payOpen}
        onOpenChange={(v) => {
          if (!v) {
            setPayError("");
            setPayMessage("");
            setGatewayStep("select");
            setActiveOrder(null);
            setConfirmedReceipt(null);
          }
          setPayOpen(v);
        }}
      >
        <DialogContent className="max-w-lg">
          {gatewayStep === "select" && (
            <>
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
                    <label key={row.id} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-slate-50">
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

              <DialogFooter>
                <Button variant="outline" onClick={() => setPayOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={startPayment} disabled={paying || pendingInstallments.length === 0 || selectedTotal <= 0}>
                  {paying ? <Loader2 className="animate-spin mr-1.5" size={16} /> : <CreditCard size={16} className="mr-1.5" />}
                  {paying ? "Creating order..." : `Proceed to Pay (${formatCurrency(selectedTotal)})`}
                </Button>
              </DialogFooter>
            </>
          )}

          {gatewayStep === "checkout" && activeOrder && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CreditCard className="text-primary" size={20} />
                  <span>Prestige Secure Payment Gateway</span>
                </DialogTitle>
                <DialogDescription>
                  Complete your authorized transaction. Transaction is verified and credited immediately to your student ledger.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="rounded-xl border border-border bg-slate-50/80 p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order Reference</span>
                    <span className="font-mono font-bold text-slate-800">{activeOrder.orderId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Student Name</span>
                    <span className="font-semibold text-slate-900">{student.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Class & Session</span>
                    <span className="font-semibold text-slate-900">Grade {student.grade} · {currentSession}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between text-sm">
                    <span className="font-bold text-slate-900">Total Payable</span>
                    <span className="font-bold text-primary text-base">{formatCurrency(activeOrder.amount)}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-700">Select Payment Method</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPaymentMode("upi")}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        selectedPaymentMode === "upi"
                          ? "border-primary bg-primary/5 text-primary font-bold shadow-xs"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-xs font-bold">UPI / QR</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">GPay, PhonePe, Paytm</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPaymentMode("card")}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        selectedPaymentMode === "card"
                          ? "border-primary bg-primary/5 text-primary font-bold shadow-xs"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-xs font-bold">Card</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Debit / Credit Card</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPaymentMode("online")}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        selectedPaymentMode === "online"
                          ? "border-primary bg-primary/5 text-primary font-bold shadow-xs"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-xs font-bold">Net Banking</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">All Major Banks</p>
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <span>🔒 256-bit Encrypted Transaction</span>
                  </p>
                  <p className="text-[11px] text-emerald-700">
                    Once verified, your fee status and exam Hall Ticket eligibility will be updated in real time.
                  </p>
                </div>

                {payError ? (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {payError}
                  </div>
                ) : null}
              </div>

              <DialogFooter className="flex items-center justify-between sm:justify-between">
                <Button variant="outline" onClick={() => setGatewayStep("select")} disabled={paying}>
                  Back
                </Button>
                <Button onClick={completeOnlinePayment} disabled={paying} className="bg-emerald-600 hover:bg-emerald-700">
                  {paying ? <Loader2 className="animate-spin mr-1.5" size={16} /> : null}
                  {paying ? "Verifying Transaction..." : `Pay ${formatCurrency(activeOrder.amount)} Now`}
                </Button>
              </DialogFooter>
            </>
          )}

          {gatewayStep === "success" && confirmedReceipt && (
            <>
              <DialogHeader>
                <div className="mx-auto my-2 h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <CheckCircle2 size={28} />
                </div>
                <DialogTitle className="text-center text-lg text-emerald-800">
                  Payment Verified & Completed!
                </DialogTitle>
                <DialogDescription className="text-center text-xs">
                  Your payment has been successfully recorded in the official fee ledger.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-2.5 text-xs text-slate-800 my-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt Number</span>
                  <span className="font-mono font-bold text-emerald-800">{confirmedReceipt.receiptNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Transaction ID</span>
                  <span className="font-mono text-slate-700">{confirmedReceipt.transactionId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Installment(s)</span>
                  <span className="font-semibold">{confirmedReceipt.installmentLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount Paid</span>
                  <span className="font-bold text-slate-900 text-sm">{formatCurrency(confirmedReceipt.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Date</span>
                  <span className="font-medium">{confirmedReceipt.paidAt}</span>
                </div>
              </div>

              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
                <p className="font-semibold">Exam Eligibility Status Updated</p>
                <p className="text-[11px] text-blue-700 mt-0.5">
                  Your updated fee status has been recorded. Check your <strong>Hall Tickets</strong> section to download your exam admit card.
                </p>
              </div>

              <DialogFooter className="flex items-center justify-between sm:justify-between">
                <Button variant="outline" onClick={() => window.print()}>
                  Print Receipt
                </Button>
                <Button onClick={() => setPayOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
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

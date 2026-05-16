import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { FeePayment, FeePaymentMode, FeeStructure, Student } from "@/lib/types";
import { buildInstallmentLedger, getAcademicSession, getFeeCollectionSummary, sumInstallments } from "@/lib/fees";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, CalendarDays, CreditCard, Users } from "lucide-react";

interface PaymentFormState {
  installmentId: string;
  amount: string;
  paymentMode: FeePaymentMode;
  reference: string;
  notes: string;
  paidAt: string;
}

interface StudentCollectionRow {
  student: Student;
  summary: ReturnType<typeof getFeeCollectionSummary>;
}

function formatCurrency(value: number) {
  return `Rs ${Math.round(value).toLocaleString("en-IN")}`;
}

function statusBadgeClass(status: "paid" | "partial" | "pending" | "overdue") {
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

export default function Collections() {
  const { appUser } = useAuth();
  const currentSession = useMemo(() => getAcademicSession(), []);

  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loadingStructures, setLoadingStructures] = useState(true);
  const [collectionStructure, setCollectionStructure] = useState<FeeStructure | null>(null);
  const [collectionStudents, setCollectionStudents] = useState<Student[]>([]);
  const [collectionPayments, setCollectionPayments] = useState<FeePayment[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [pageMessage, setPageMessage] = useState("");

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentStudent, setPaymentStudent] = useState<Student | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptPayment, setReceiptPayment] = useState<FeePayment | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({
    installmentId: "",
    amount: "",
    paymentMode: "cash",
    reference: "",
    notes: "",
    paidAt: new Date().toISOString().slice(0, 10),
  });

  const currentSessionStructures = useMemo(
    () => structures.filter((structure) => structure.academicSession === currentSession),
    [currentSession, structures],
  );

  const collectionRows: StudentCollectionRow[] = useMemo(() => {
    if (!collectionStructure) return [];
    return collectionStudents.map((student) => {
      const payments = collectionPayments.filter((payment) => payment.studentId === student.id);
      const summary = getFeeCollectionSummary(collectionStructure, payments);
      return { student, summary };
    });
  }, [collectionStructure, collectionStudents, collectionPayments]);

  const collectionTotals = useMemo(
    () =>
      collectionRows.reduce(
        (totals, row) => {
          totals.students += 1;
          totals.scheduled += row.summary.totalScheduled;
          totals.collected += row.summary.totalPaid;
          totals.outstanding += row.summary.totalOutstanding;
          if (row.summary.ledger.some((item) => item.status === "overdue")) {
            totals.overdueStudents += 1;
          }
          return totals;
        },
        { students: 0, scheduled: 0, collected: 0, outstanding: 0, overdueStudents: 0 },
      ),
    [collectionRows],
  );

  const selectedStudentPayments = useMemo(() => {
    if (!paymentStudent) {
      return [];
    }
    return collectionPayments.filter((payment) => payment.studentId === paymentStudent.id);
  }, [collectionPayments, paymentStudent]);

  const selectedStudentLedger = useMemo(() => {
    if (!collectionStructure || !paymentStudent) {
      return [];
    }
    return buildInstallmentLedger(collectionStructure, selectedStudentPayments);
  }, [collectionStructure, paymentStudent, selectedStudentPayments]);

  const selectedLedgerRow = selectedStudentLedger.find((row) => row.id === paymentForm.installmentId) ?? null;
  const hasLedgerOptions = selectedStudentLedger.length > 0;

  const loadStructures = async () => {
    setLoadingStructures(true);
    try {
      const snapshot = await getDocs(collection(db, "feeStructures"));
      const records = snapshot.docs
        .map((record) => ({ id: record.id, ...record.data() } as FeeStructure))
        .sort((a, b) => {
          const right = b.updatedAt ?? b.createdAt ?? "";
          const left = a.updatedAt ?? a.createdAt ?? "";
          return right.localeCompare(left);
        });
      setStructures(records);
    } finally {
      setLoadingStructures(false);
    }
  };

  const loadCollections = async (structure: FeeStructure) => {
    setLoadingCollections(true);
    try {
      const [studentSnapshot, paymentSnapshot] = await Promise.all([
        getDocs(query(collection(db, "students"), where("grade", "==", structure.grade))),
        getDocs(query(collection(db, "feePayments"), where("structureId", "==", structure.id))),
      ]);

      setCollectionStudents(
        studentSnapshot.docs
          .map((record) => ({ id: record.id, ...record.data() } as Student))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setCollectionPayments(
        paymentSnapshot.docs
          .map((record) => ({ id: record.id, ...record.data() } as FeePayment))
          .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")),
      );
    } finally {
      setLoadingCollections(false);
    }
  };

  const openCollections = async (structure: FeeStructure) => {
    setPageMessage("");
    setCollectionStructure(structure);
    await loadCollections(structure);
  };

  useEffect(() => {
    void loadStructures();
  }, []);

  useEffect(() => {
    if (collectionStructure || currentSessionStructures.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("structureId");
    const target =
      currentSessionStructures.find((s) => s.id === targetId) ?? currentSessionStructures[0];
    if (target) {
      void openCollections(target);
    }
  }, [collectionStructure, currentSessionStructures]);

  const openPaymentDialog = (student: Student) => {
    if (!collectionStructure) {
      return;
    }

    const studentPayments = collectionPayments.filter((payment) => payment.studentId === student.id);
    const summary = getFeeCollectionSummary(collectionStructure, studentPayments);
    const nextInstallment = summary.nextDue ?? summary.ledger[0] ?? null;

    setPaymentStudent(student);
    setPaymentForm({
      installmentId: nextInstallment?.id ?? collectionStructure.installments[0]?.id ?? "",
      amount: nextInstallment ? String(nextInstallment.balance || nextInstallment.amount) : "",
      paymentMode: "cash",
      reference: "",
      notes: "",
      paidAt: new Date().toISOString().slice(0, 10),
    });
    setPaymentError("");
    setPaymentOpen(true);
  };

  const handleRecordPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!collectionStructure || !paymentStudent || !selectedLedgerRow) {
      setPaymentError("Choose a student and an installment with a remaining balance before saving.");
      return;
    }

    const amount = Number(paymentForm.amount) || 0;
    if (amount <= 0) {
      setPaymentError("Enter a valid payment amount.");
      return;
    }
    if (amount > selectedLedgerRow.balance) {
      setPaymentError("Payment amount cannot exceed the remaining balance for this installment.");
      return;
    }

    const installmentMeta =
      collectionStructure.installments.find((installment) => installment.id === paymentForm.installmentId) ??
      collectionStructure.installments[0];

    setRecordingPayment(true);
    setPaymentError("");

    try {
      const receiptNo = `RC-${Date.now()}`;
      await addDoc(collection(db, "feePayments"), {
        academicSession: collectionStructure.academicSession,
        grade: collectionStructure.grade,
        structureId: collectionStructure.id,
        studentId: paymentStudent.id,
        studentName: paymentStudent.name,
        installmentId: paymentForm.installmentId,
        installmentLabel: installmentMeta?.label ?? selectedLedgerRow.label,
        amount,
        paymentMode: paymentForm.paymentMode,
        reference: paymentForm.reference.trim(),
        notes: paymentForm.notes.trim(),
        paidAt: paymentForm.paidAt,
        recordedBy: appUser?.id ?? "",
        receiptNo,
      });

      setPaymentOpen(false);
      setPaymentStudent(null);
      setPageMessage(`Payment recorded for ${paymentStudent.name}.`);
      await loadCollections(collectionStructure);
    } catch (error) {
      console.error(error);
      setPaymentError("Unable to record this payment right now.");
    } finally {
      setRecordingPayment(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fee Collections</h1>
          <p className="text-sm text-muted-foreground">
            Post installment payments, see outstanding dues, and print receipts.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={<BookOpen size={18} className="text-blue-600" />}
            label="Current Session"
            value={currentSession}
            subtext={`${currentSessionStructures.length} structure${currentSessionStructures.length === 1 ? "" : "s"}`}
            tone="bg-blue-50"
          />
          <SummaryCard
            icon={<Users size={18} className="text-violet-600" />}
            label="Students in Class"
            value={collectionStudents.length ? String(collectionStudents.length) : "--"}
            subtext={collectionStructure ? `Grade ${collectionStructure.grade}` : "Select a structure"}
            tone="bg-violet-50"
          />
          <SummaryCard
            icon={<CreditCard size={18} className="text-emerald-600" />}
            label="Payments Logged"
            value={collectionPayments.length ? String(collectionPayments.length) : "--"}
            subtext={collectionStructure ? collectionStructure.title : "Select a structure"}
            tone="bg-emerald-50"
          />
        </div>
      </div>

      {pageMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {pageMessage}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
        <Card>
          <CardContent className="pt-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Choose Fee Structure</h2>
              <p className="text-sm text-muted-foreground">
                Collections are posted against one class structure at a time.
              </p>
            </div>

            {loadingStructures ? (
              <div className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Loading fee structures...
              </div>
            ) : currentSessionStructures.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                No structures available yet.
              </div>
            ) : (
              <div className="space-y-3">
                {currentSessionStructures.map((structure) => (
                  <button
                    key={structure.id}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      collectionStructure?.id === structure.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                    onClick={() => openCollections(structure)}
                    type="button"
                  >
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge>{structure.academicSession}</Badge>
                      <Badge variant="outline">Grade {structure.grade}</Badge>
                    </div>
                    <p className="font-semibold">{structure.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatCurrency(sumInstallments(structure))} total across {structure.installments.length} installments
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!collectionStructure ? (
            <Card>
              <CardContent className="py-16 text-center">
                <p className="text-lg font-semibold">Select a fee structure</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Once selected, you will see class-wise outstanding balances and can record installment payments.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                  icon={<Users size={18} className="text-blue-600" />}
                  label="Students"
                  value={String(collectionTotals.students)}
                  subtext={`Grade ${collectionStructure.grade} in ${collectionStructure.academicSession}`}
                  tone="bg-blue-50"
                />
                <SummaryCard
                  icon={<BookOpen size={18} className="text-violet-600" />}
                  label="Expected"
                  value={formatCurrency(collectionTotals.scheduled)}
                  subtext="Scheduled against this structure"
                  tone="bg-violet-50"
                />
                <SummaryCard
                  icon={<CreditCard size={18} className="text-emerald-600" />}
                  label="Collected"
                  value={formatCurrency(collectionTotals.collected)}
                  subtext={`${collectionPayments.length} payment record${collectionPayments.length === 1 ? "" : "s"}`}
                  tone="bg-emerald-50"
                />
                <SummaryCard
                  icon={<CalendarDays size={18} className="text-rose-600" />}
                  label="Outstanding"
                  value={formatCurrency(collectionTotals.outstanding)}
                  subtext={`${collectionTotals.overdueStudents} overdue student${collectionTotals.overdueStudents === 1 ? "" : "s"}`}
                  tone="bg-rose-50"
                />
              </div>

              <Card>
                <CardContent className="pt-6">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold">{collectionStructure.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      Record payments installment by installment. Partial payments are supported up to the remaining balance.
                    </p>
                  </div>

                  {loadingCollections ? (
                    <div className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
                      Loading collections...
                    </div>
                  ) : collectionRows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                      No students found in Grade {collectionStructure.grade}. Add students first to begin collections.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>Total Due</TableHead>
                          <TableHead>Paid</TableHead>
                          <TableHead>Outstanding</TableHead>
                          <TableHead>Next Due</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {collectionRows.map((row) => {
                          const overdue = row.summary.ledger.some((item) => item.status === "overdue");
                          const settled = row.summary.totalOutstanding <= 0;
                          const nextDue = row.summary.nextDue;
                          const status = settled ? "paid" : overdue ? "overdue" : row.summary.totalPaid > 0 ? "partial" : "pending";

                          return (
                            <TableRow key={row.student.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{row.student.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {row.student.admissionNo ? `Adm ${row.student.admissionNo}` : `Grade ${row.student.grade}`}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>{formatCurrency(row.summary.totalScheduled)}</TableCell>
                              <TableCell>{formatCurrency(row.summary.totalPaid)}</TableCell>
                              <TableCell>{formatCurrency(row.summary.totalOutstanding)}</TableCell>
                              <TableCell>
                                {nextDue ? (
                                  <div className="text-sm">
                                    <p className="font-medium">{nextDue.label}</p>
                                    <p className="text-xs text-muted-foreground">{nextDue.dueDate}</p>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">All paid</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClass(status)}`}>
                                  {status === "paid" ? "Paid up" : status}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  onClick={() => openPaymentDialog(row.student)}
                                  disabled={row.summary.totalOutstanding <= 0}
                                >
                                  Record Payment
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold">Payment History</h2>
                    <p className="text-sm text-muted-foreground">
                      Latest collection entries for this class fee structure.
                    </p>
                  </div>

                  {collectionPayments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                      No payments recorded yet for this structure.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Student</TableHead>
                          <TableHead>Installment</TableHead>
                          <TableHead>Mode</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Receipt</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {collectionPayments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell>{payment.paidAt}</TableCell>
                            <TableCell>{payment.studentName}</TableCell>
                            <TableCell>{payment.installmentLabel}</TableCell>
                            <TableCell className="capitalize">{payment.paymentMode}</TableCell>
                            <TableCell>{payment.reference || "-"}</TableCell>
                            <TableCell>{payment.receiptNo || "-"}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(payment.amount)}</TableCell>
                            <TableCell className="text-right">
                              {payment.receiptNo ? (
                                <Button size="sm" variant="outline" onClick={() => { setReceiptPayment(payment); setReceiptOpen(true); }}>
                                  View Receipt
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Record Payment{paymentStudent ? ` for ${paymentStudent.name}` : ""}
            </DialogTitle>
          </DialogHeader>

          <form className="space-y-5" onSubmit={handleRecordPayment}>
            {paymentError ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {paymentError}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-muted/20 p-4 md:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Student</p>
                <p className="mt-1 font-semibold">{paymentStudent?.name ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Class</p>
                <p className="mt-1 font-semibold">Grade {collectionStructure?.grade ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outstanding</p>
                <p className="mt-1 font-semibold">
                  {selectedStudentLedger.length > 0
                    ? formatCurrency(selectedStudentLedger.reduce((total, row) => total + row.balance, 0))
                    : "-"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Installment</Label>
                {hasLedgerOptions ? (
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={paymentForm.installmentId}
                    onChange={(event) => {
                      const nextInstallmentId = event.target.value;
                      const installment = selectedStudentLedger.find((row) => row.id === nextInstallmentId);
                      setPaymentForm((current) => ({
                        ...current,
                        installmentId: nextInstallmentId,
                        amount: installment ? String(installment.balance || installment.amount) : current.amount,
                      }));
                    }}
                    required
                  >
                    {selectedStudentLedger.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label} - {formatCurrency(row.balance)} balance
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                    No pending installments for this student.
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input
                  min="0"
                  step="0.01"
                  type="number"
                  value={paymentForm.amount}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                  required
                />
              </div>
            </div>

            {selectedLedgerRow ? (
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-dashed border-border p-4 text-sm md:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Due Date</p>
                  <p className="font-medium">{selectedLedgerRow.dueDate}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Already Paid</p>
                  <p className="font-medium">{formatCurrency(selectedLedgerRow.paid)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Remaining Balance</p>
                  <p className="font-medium">{formatCurrency(selectedLedgerRow.balance)}</p>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Payment Mode</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={paymentForm.paymentMode}
                  onChange={(event) =>
                    setPaymentForm((current) => ({
                      ...current,
                      paymentMode: event.target.value as FeePaymentMode,
                    }))
                  }
                >
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="online">Online</option>
                  <option value="upi">UPI</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Payment Date</Label>
                <Input
                  type="date"
                  value={paymentForm.paidAt}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, paidAt: event.target.value }))}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Reference</Label>
                <Input
                  value={paymentForm.reference}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))}
                  placeholder="Receipt no / cheque no / txn id"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={paymentForm.notes}
                onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Optional internal notes"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>
                Cancel
              </Button>
              <Button className="gap-2" disabled={recordingPayment || !hasLedgerOptions} type="submit">
                <CreditCard size={15} />
                {recordingPayment ? "Saving..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Payment Receipt</DialogTitle>
          </DialogHeader>
          {receiptPayment ? (
            <div className="space-y-2 text-sm">
              <div className="rounded-lg border border-border p-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt No</span>
                  <span className="font-semibold">{receiptPayment.receiptNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Student</span>
                  <span className="font-semibold">{receiptPayment.studentName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Installment</span>
                  <span className="font-semibold">{receiptPayment.installmentLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-semibold">{receiptPayment.paidAt}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mode</span>
                  <span className="font-semibold capitalize">{receiptPayment.paymentMode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-semibold">{formatCurrency(receiptPayment.amount)}</span>
                </div>
              </div>
              <DialogFooter className="justify-between">
                <Button variant="outline" onClick={() => setReceiptOpen(false)}>
                  Close
                </Button>
                <Button onClick={() => window.print()}>Print</Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subtext,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext: string;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold">{value}</p>
            <p className="text-xs text-muted-foreground">{subtext}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

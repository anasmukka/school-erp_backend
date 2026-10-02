import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Printer,
  Download,
  CheckCircle2,
  Receipt,
  Building,
  User,
  Calendar,
  CreditCard,
  FileText,
  Loader2,
} from "lucide-react";
import {
  FeeReceiptData,
  downloadFeeReceiptPdf,
  printFeeReceiptPdf,
} from "@/lib/generateFeeReceiptPdf";
import { amountInWordsINR } from "@/lib/numberToWords";

interface FeeReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: FeeReceiptData | null;
}

export function FeeReceiptModal({ open, onOpenChange, data }: FeeReceiptModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);

  if (!data) return null;

  const handleDownload = async () => {
    try {
      setDownloading(true);
      await downloadFeeReceiptPdf(data);
    } catch (e) {
      console.error("Failed to download PDF receipt:", e);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = async () => {
    try {
      setPrinting(true);
      await printFeeReceiptPdf(data);
    } catch (e) {
      console.error("Failed to print receipt:", e);
    } finally {
      setPrinting(false);
    }
  };

  const formatCurrency = (val: number | undefined | null) => {
    const num = Number(val) || 0;
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(num);
  };

  const scheduledVal = data.scheduledAmount ?? data.amount;
  const prevPaidVal = data.previouslyPaid ?? 0;
  const paidNowVal = data.amount;
  const remainingVal =
    data.remainingBalance ?? Math.max(0, scheduledVal - prevPaidVal - paidNowVal);

  const termDisplay = data.termName || "Academic Session Fee";
  const installmentDisplay = data.installmentLabel || "Scheduled Installment";
  const words = amountInWordsINR(paidNowVal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 border border-slate-300 shadow-2xl bg-white text-slate-900">
        <DialogHeader className="p-6 pb-2 border-b bg-slate-50/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
                <Receipt size={20} />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-900">
                  Official Fee Payment Receipt
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  Prestige International School Institutional Receipt — Document ID: {data.receiptNo}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="bg-emerald-50 text-emerald-700 border-emerald-300 text-xs px-2.5 py-0.5"
              >
                <CheckCircle2 size={12} className="mr-1" />
                {(data.verificationStatus || "PAID").toUpperCase()}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Printable/Preview Receipt Container */}
        <div className="p-6 space-y-5 text-xs font-sans">
          {/* Header Card with Logos & Title */}
          <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b pb-3.5">
              {/* School Logo */}
              <div className="w-14 h-14 shrink-0 flex items-center justify-center overflow-hidden">
                <img
                  src="/prestige_logo.png"
                  alt="Prestige Logo"
                  className="max-h-full max-w-full object-contain"
                />
              </div>

              {/* School Central Typography */}
              <div className="flex-1 text-center px-2">
                <h1 className="text-lg font-bold uppercase tracking-wider text-slate-900 font-serif">
                  {data.schoolDetails?.name || "PRESTIGE INTERNATIONAL SCHOOL"}
                </h1>
                <p className="text-[11px] text-slate-600 italic">
                  {data.schoolDetails?.tagline || "SCALING NEW HEIGHTS WITH EXCELLENCE"}
                </p>
                <p className="text-[10px] text-slate-500 font-medium">
                  {data.schoolDetails?.affiliationNo ||
                    "Affiliated to CBSE, New Delhi — Senior Secondary Sector"}
                </p>
              </div>

              {/* CBSE Logo */}
              <div className="w-14 h-14 shrink-0 flex items-center justify-center overflow-hidden">
                <img
                  src="/cbse_logo.png"
                  alt="CBSE Logo"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>

            <div className="mt-3 text-center bg-slate-900 text-white font-bold py-1.5 rounded-md uppercase tracking-wider text-[11px]">
              OFFICIAL FEE PAYMENT RECEIPT
            </div>
          </div>

          {/* Metadata Grid: Student & Receipt Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Student Information Card */}
            <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/50 space-y-2">
              <div className="flex items-center gap-1.5 border-b pb-1.5 text-slate-800 font-semibold text-xs">
                <User size={13} className="text-slate-500" />
                <span>STUDENT PROFILE</span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Student Name:</span>
                  <p className="font-semibold text-slate-900">{data.studentName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Permanent UID:</span>
                  <p className="font-mono text-slate-800">{data.studentUid || data.studentId || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Admission No:</span>
                  <p className="font-semibold text-slate-900">{data.admissionNo || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Class & Section:</span>
                  <p className="font-medium text-slate-800">
                    Grade {data.grade || "—"} {data.sectionName ? `(${data.sectionName})` : ""}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Roll No:</span>
                  <p className="font-medium text-slate-800">{data.rollNo || "—"}</p>
                </div>
                {data.fatherName && (
                  <div>
                    <span className="text-muted-foreground">Parent / Guardian:</span>
                    <p className="font-medium text-slate-800">{data.fatherName}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Receipt Metadata Card */}
            <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/50 space-y-2">
              <div className="flex items-center gap-1.5 border-b pb-1.5 text-slate-800 font-semibold text-xs">
                <FileText size={13} className="text-slate-500" />
                <span>RECEIPT METADATA</span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Receipt Number:</span>
                  <p className="font-mono font-bold text-slate-900">{data.receiptNo}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment Date:</span>
                  <p className="font-medium text-slate-800">{data.receiptDate || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Academic Session:</span>
                  <p className="font-medium text-slate-800">{data.academicSession}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment Mode:</span>
                  <p className="font-semibold capitalize text-slate-900">{data.paymentMode}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Verification:</span>
                  <p className="text-emerald-700 font-medium">Ledger Confirmed</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Reference / UTR:</span>
                  <p className="font-mono text-slate-800 truncate" title={data.reference || "Direct"}>
                    {data.reference || "Direct"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Installment Breakdown Table */}
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <div className="bg-slate-100 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between">
              <span className="font-semibold text-slate-800 text-xs">
                FEE SCHEDULE BREAKDOWN — {termDisplay.toUpperCase()}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Installment: <strong>{installmentDisplay}</strong>
              </span>
            </div>

            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-slate-800 text-white text-[10px] uppercase font-semibold">
                  <th className="py-2 px-3 text-left">Term / Installment</th>
                  <th className="py-2 px-3 text-left">Due Date</th>
                  <th className="py-2 px-3 text-right">Scheduled</th>
                  <th className="py-2 px-3 text-right">Prev. Paid</th>
                  <th className="py-2 px-3 text-right bg-slate-900 text-emerald-300">Paid Now</th>
                  <th className="py-2 px-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-semibold text-slate-900">
                    {termDisplay} - {installmentDisplay}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">{data.dueDate || "—"}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-slate-700">
                    {formatCurrency(scheduledVal)}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-600">
                    {formatCurrency(prevPaidVal)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-emerald-800 bg-emerald-50/60">
                    {formatCurrency(paidNowVal)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                    {formatCurrency(remainingVal)}
                  </td>
                </tr>

                {data.feeHeads && data.feeHeads.length > 0 && (
                  <tr className="bg-slate-50/60 text-[10px] text-slate-600">
                    <td colSpan={6} className="py-2 px-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="font-semibold text-slate-700">Fee Heads Allocated:</span>
                        {data.feeHeads.map((h, i) => (
                          <span key={i} className="inline-flex items-center gap-1">
                            {h.name}: <strong>{formatCurrency(h.amount)}</strong>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Amount In Words Banner */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
            <span className="text-slate-700 font-semibold">Amount Received in Words:</span>
            <span className="font-bold text-indigo-900 font-serif italic text-sm">{words}</span>
          </div>

          {/* Financial Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center">
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Total Fee</span>
              <p className="text-sm font-bold text-slate-900">
                {formatCurrency(data.totalStructureAmount || scheduledVal)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center">
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Prev. Paid</span>
              <p className="text-sm font-bold text-slate-700">{formatCurrency(prevPaidVal)}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-center">
              <span className="text-[10px] text-emerald-800 uppercase font-bold">This Receipt</span>
              <p className="text-base font-extrabold text-emerald-700">{formatCurrency(paidNowVal)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center">
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Balance</span>
              <p
                className={`text-sm font-bold ${
                  remainingVal > 0 ? "text-rose-600" : "text-slate-900"
                }`}
              >
                {formatCurrency(remainingVal)}
              </p>
            </div>
          </div>

          {/* Payment Method Details Box */}
          <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/40 text-[11px] text-slate-700 space-y-1">
            <p className="font-semibold text-slate-800">Payment & Verification Details:</p>
            <p>
              {data.paymentMode === "cash"
                ? `Received in cash at Accounts Department collection counter. Register Ref: ${data.reference || "0001"}`
                : data.paymentMode === "upi"
                ? `UPI Transfer. Reference / UTR Number: ${data.reference || "Verified"}`
                : data.paymentMode === "online"
                ? `Online Payment Gateway. Transaction ID: ${data.reference || data.orderId || "Verified"}`
                : `Payment Mode: ${data.paymentMode.toUpperCase()}. Ref: ${data.reference || "Verified"}`}
            </p>
            {data.notes && <p className="italic text-slate-500">Notes: {data.notes}</p>}
          </div>

          {/* Institutional Signatures & Footer */}
          <div className="pt-4 border-t border-slate-200 flex items-end justify-between text-[11px] text-slate-600">
            <div className="text-center w-40">
              <div className="border-b border-slate-400 pb-1 mb-1 text-slate-400 font-mono text-[10px]">
                _________________
              </div>
              <p className="font-medium text-slate-700">Depositor Signature</p>
            </div>

            <div className="text-center text-[10px] text-muted-foreground">
              <p className="font-semibold text-slate-800">Accounts & Fee Administration</p>
              <p>Prestige International School</p>
            </div>

            <div className="text-center w-44">
              <div className="border-b border-slate-400 pb-1 mb-1 text-slate-400 font-mono text-[10px]">
                _________________
              </div>
              <p className="font-bold text-slate-900">Authorized Accounts Officer</p>
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 bg-slate-50 border-t flex flex-col sm:flex-row items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handlePrint}
              disabled={printing}
            >
              {printing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              Print Receipt
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-slate-900 hover:bg-slate-800 text-white"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Download Official PDF
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

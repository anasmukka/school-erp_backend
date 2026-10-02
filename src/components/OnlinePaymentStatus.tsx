import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCard, Info, Clock, AlertTriangle, Building2, CheckCircle2 } from "lucide-react";
import type { PaymentGatewayCapability, PaymentGatewayStatus } from "@/lib/payments";

interface OnlinePaymentCardProps {
  capability?: PaymentGatewayCapability | null;
  className?: string;
  onRefresh?: () => void;
}

/**
 * Polished, intentional "Coming Soon" card displayed when Razorpay is not configured.
 * Never looks like a system error or broken flow.
 */
export function OnlinePaymentComingSoonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-50 via-white to-slate-50/60 p-5 shadow-xs transition-all ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 shadow-2xs">
            <CreditCard size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 text-sm">Online Payments</h3>
            <p className="text-xs text-slate-500">School fee gateway</p>
          </div>
        </div>
        <Badge
          variant="secondary"
          className="bg-slate-200/80 text-slate-700 hover:bg-slate-200/80 font-semibold px-2.5 py-0.5 text-xs rounded-full border border-slate-300/60"
        >
          <Clock size={12} className="mr-1 inline text-slate-600" />
          Coming Soon
        </Badge>
      </div>

      <div className="mt-3.5 space-y-2.5 text-xs text-slate-600">
        <p className="leading-relaxed font-normal">
          Online fee payments are currently unavailable. Please use the school counter for payment.
        </p>

        <div className="flex items-start gap-2 rounded-xl border border-slate-200/60 bg-white/80 p-2.5 text-slate-600">
          <Building2 size={16} className="text-slate-500 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">
            <span className="font-semibold text-slate-700">Accounts Counter:</span> Payments are accepted via Cash, Cheque, or POS at the school accounts desk during office hours.
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Button
          disabled
          variant="outline"
          size="sm"
          className="w-full text-xs font-semibold text-slate-400 bg-slate-50/80 border-slate-200 cursor-not-allowed"
        >
          <CreditCard size={14} className="mr-1.5 opacity-40" />
          Pay Online (Coming Soon)
        </Button>
      </div>
    </div>
  );
}

/**
 * Distinct card for temporary maintenance or downtime when Razorpay is configured but disabled.
 */
export function OnlinePaymentUnavailableCard({
  message,
  className = "",
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/70 via-white to-amber-50/40 p-5 shadow-xs ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100/80 text-amber-800 shadow-2xs">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-amber-950 text-sm">Online Payments</h3>
            <p className="text-xs text-amber-700/80">System notice</p>
          </div>
        </div>
        <Badge
          variant="outline"
          className="bg-amber-100/80 text-amber-800 border-amber-300 font-semibold px-2.5 py-0.5 text-xs rounded-full"
        >
          Maintenance
        </Badge>
      </div>

      <div className="mt-3.5 space-y-2.5 text-xs text-amber-900/90">
        <p className="leading-relaxed">
          {message ||
            "Online fee payments are temporarily unavailable for scheduled maintenance. Please visit the school counter for assistance."}
        </p>

        <div className="flex items-start gap-2 rounded-xl border border-amber-200/60 bg-white/80 p-2.5 text-amber-800">
          <Building2 size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed">
            <span className="font-semibold text-amber-900">Alternative Option:</span> Counter payments remain active and will update your student ledger instantly.
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Button
          disabled
          variant="outline"
          size="sm"
          className="w-full text-xs font-semibold text-amber-700/50 bg-amber-50/50 border-amber-200 cursor-not-allowed"
        >
          Pay Online (Temporarily Unavailable)
        </Button>
      </div>
    </div>
  );
}

/**
 * Compact inline badge reflecting current payment gateway status.
 */
export function OnlinePaymentStatusBadge({
  status,
  provider,
  className = "",
}: {
  status?: PaymentGatewayStatus;
  provider?: "razorpay" | "none";
  className?: string;
}) {
  if (status === "active") {
    return (
      <Badge
        variant="outline"
        className={`bg-emerald-50 text-emerald-700 border-emerald-300 font-medium text-xs px-2.5 py-0.5 gap-1 ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>Online Payments: Active ({provider === "razorpay" ? "Razorpay" : "Online"})</span>
      </Badge>
    );
  }

  if (status === "temporarily_unavailable") {
    return (
      <Badge
        variant="outline"
        className={`bg-amber-50 text-amber-800 border-amber-300 font-medium text-xs px-2.5 py-0.5 gap-1 ${className}`}
      >
        <AlertTriangle size={12} />
        <span>Online Payments: Maintenance</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={`bg-slate-100 text-slate-700 border border-slate-300/70 font-medium text-xs px-2.5 py-0.5 gap-1 ${className}`}
    >
      <Clock size={12} className="text-slate-500" />
      <span>Online Payments: Coming Soon</span>
    </Badge>
  );
}

/**
 * Administrative summary card for Accounts & Management dashboards.
 */
export function OnlinePaymentAdminCard({
  capability,
  className = "",
}: OnlinePaymentCardProps) {
  const isConfigured = capability?.status === "active";
  const isMaintenance = capability?.status === "temporarily_unavailable";

  return (
    <Card className={`overflow-hidden border border-border/70 ${className}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard size={18} className="text-primary" />
            <h4 className="text-sm font-semibold text-slate-900">Payment Gateway Gateway Status</h4>
          </div>
          <OnlinePaymentStatusBadge
            status={capability?.status}
            provider={capability?.provider}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-muted/30 p-2.5 border border-border/50">
            <span className="text-muted-foreground block text-[11px]">Provider</span>
            <span className="font-semibold text-slate-800 capitalize">
              {capability?.provider || "None (Optional)"}
            </span>
          </div>
          <div className="rounded-lg bg-muted/30 p-2.5 border border-border/50">
            <span className="text-muted-foreground block text-[11px]">Counter Desk Mode</span>
            <span className="font-semibold text-emerald-700 flex items-center gap-1">
              <CheckCircle2 size={13} />
              Always Operational
            </span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {isConfigured
            ? "Razorpay credentials verified. Students and parents can pay dues directly online."
            : isMaintenance
            ? "Online gateway is currently in maintenance mode. Counter receipts continue to operate normally."
            : "Razorpay credentials are not configured in this environment. The portal displays a polished 'Coming Soon' notice to students and parents."}
        </p>
      </CardContent>
    </Card>
  );
}

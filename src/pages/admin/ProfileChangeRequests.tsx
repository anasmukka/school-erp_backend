import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  CheckCircle2, XCircle, AlertCircle, Clock, Filter,
  User, FileText, ExternalLink, MessageSquare, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  getAllProfileChangeRequests,
  approveProfileChangeRequest,
  rejectProfileChangeRequest,
} from "@/lib/profileChangeRequests";
import { logAuditEvent } from "@/lib/audit";
import type { ProfileChangeRequestV2, ProfileChangeRequestStatus, Role } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

function StatusBadge({ status }: { status: ProfileChangeRequestV2["status"] }) {
  const config: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    pending: { label: "Pending", className: "bg-amber-100 text-amber-800 border-amber-200", icon: <Clock size={12} /> },
    under_review: { label: "Under Review", className: "bg-blue-100 text-blue-800 border-blue-200", icon: <AlertCircle size={12} /> },
    approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 size={12} /> },
    rejected: { label: "Rejected", className: "bg-rose-100 text-rose-800 border-rose-200", icon: <XCircle size={12} /> },
    cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600 border-slate-200", icon: <XCircle size={12} /> },
  };
  const c = config[status] ?? config.pending;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${c.className}`}>
      {c.icon} {c.label}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colorMap: Record<string, string> = {
    admin: "bg-indigo-100 text-indigo-800",
    hod: "bg-blue-100 text-blue-800",
    teacher: "bg-emerald-100 text-emerald-800",
    student: "bg-amber-100 text-amber-800",
    accountant: "bg-teal-100 text-teal-800",
    printing: "bg-cyan-100 text-cyan-800",
    operations: "bg-orange-100 text-orange-800",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${colorMap[role] || "bg-slate-100 text-slate-700"}`}>
      {role}
    </span>
  );
}

function ReviewDialog({
  request,
  onClose,
  onDone,
}: {
  request: ProfileChangeRequestV2 | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState<"approve" | "reject" | null>(null);

  if (!request) return null;

  const canReview = request.status === "pending" || request.status === "under_review";

  const handleAction = async (act: "approve" | "reject") => {
    if (!appUser) return;
    if (act === "reject" && !comment.trim()) {
      toast({ title: "A reviewer comment is required for rejection.", variant: "destructive" });
      return;
    }
    setAction(act);
    setSubmitting(true);
    try {
      if (act === "approve") {
        await approveProfileChangeRequest(request.id, appUser.id, appUser.name, comment || undefined);
        await logAuditEvent({
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
          action: "status_change",
          entity: "printing" as any, // using generic entity; the audit framework accepts any string
          entityId: request.id,
          details: `Profile change request APPROVED for ${request.userName} [${request.userRole}] — field: ${request.fieldLabel}. Change applied.`,
          metadata: { field: request.field, originalValue: request.originalValue, newValue: request.requestedValue, requestedBy: request.userId },
        });
        toast({ title: "Request approved", description: "The profile has been updated." });
      } else {
        await rejectProfileChangeRequest(request.id, appUser.id, appUser.name, comment);
        await logAuditEvent({
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
          action: "status_change",
          entity: "printing" as any,
          entityId: request.id,
          details: `Profile change request REJECTED for ${request.userName} [${request.userRole}] — field: ${request.fieldLabel}. Reason: ${comment}`,
          metadata: { field: request.field, requestedBy: request.userId },
        });
        toast({ title: "Request rejected" });
      }
      onDone();
      onClose();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
      setAction(null);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Review Change Request</DialogTitle>
          <DialogDescription>
            Request from {request.userName} ({request.userRole})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-1">User</p>
              <p className="text-sm font-semibold">{request.userName}</p>
              <RoleBadge role={request.userRole} />
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-1">Status</p>
              <StatusBadge status={request.status} />
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(request.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>

          <div className="rounded-xl border p-4 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Field</p>
              <p className="font-semibold text-sm">{request.fieldLabel}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/40 p-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">Original Value</p>
                <p className="text-sm font-medium">{request.originalValue || "(empty)"}</p>
              </div>
              <div className="rounded-lg bg-primary/5 border border-primary/10 p-2.5">
                <p className="text-xs text-muted-foreground mb-0.5">Requested Value</p>
                <p className="text-sm font-semibold text-primary">{request.requestedValue}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Reason</p>
              <p className="text-sm">{request.reason}</p>
            </div>
            {request.supportingDocUrl && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Supporting Document</p>
                <a
                  href={request.supportingDocUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/5 border border-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  <FileText size={13} />
                  {request.supportingDocName || "View Document"}
                  <ExternalLink size={11} />
                </a>
              </div>
            )}
          </div>

          {canReview && (
            <div className="space-y-1.5">
              <Label>Reviewer Comment {action === "reject" ? <span className="text-rose-500">*</span> : <span className="text-muted-foreground text-xs">(optional for approval)</span>}</Label>
              <Textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Add a comment for the user..."
                rows={3}
              />
            </div>
          )}

          {!canReview && request.reviewerComment && (
            <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
              <p className="text-xs font-medium text-amber-900 mb-0.5">Reviewer Comment</p>
              <p className="text-xs text-amber-800">{request.reviewerComment}</p>
              {request.reviewedByName && <p className="text-xs text-muted-foreground mt-1">By: {request.reviewedByName}</p>}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Close</Button>
          {canReview && (
            <>
              <Button
                variant="destructive"
                onClick={() => handleAction("reject")}
                disabled={submitting}
              >
                {submitting && action === "reject" ? "Rejecting..." : "Reject"}
              </Button>
              <Button
                onClick={() => handleAction("approve")}
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {submitting && action === "approve" ? "Approving..." : "Approve"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProfileChangeRequests() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<ProfileChangeRequestV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<ProfileChangeRequestV2 | null>(null);
  const [filterStatus, setFilterStatus] = useState<ProfileChangeRequestStatus | "all">("all");
  const [filterRole, setFilterRole] = useState<Role | "all">("all");

  useEffect(() => { loadRequests(); }, []);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const allReqs = await getAllProfileChangeRequests();
      setRequests(allReqs);
    } catch (e: any) {
      toast({ title: "Failed to load requests", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const filtered = requests.filter(r => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (filterRole !== "all" && r.userRole !== filterRole) return false;
    return true;
  });

  const stats = {
    pending: requests.filter(r => r.status === "pending").length,
    under_review: requests.filter(r => r.status === "under_review").length,
    approved: requests.filter(r => r.status === "approved").length,
    rejected: requests.filter(r => r.status === "rejected").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Profile Change Requests</h1>
          <p className="text-sm text-muted-foreground">Review and action user-submitted profile correction requests</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadRequests} className="gap-2">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[{label: "Pending", count: stats.pending, color: "bg-amber-50 border-amber-100 text-amber-900"},
          {label: "Under Review", count: stats.under_review, color: "bg-blue-50 border-blue-100 text-blue-900"},
          {label: "Approved", count: stats.approved, color: "bg-emerald-50 border-emerald-100 text-emerald-900"},
          {label: "Rejected", count: stats.rejected, color: "bg-rose-50 border-rose-100 text-rose-900"},
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-3 text-center ${s.color}`}>
            <p className="text-2xl font-bold">{s.count}</p>
            <p className="text-xs font-medium opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-muted-foreground" />
          <span className="text-sm font-medium">Filters:</span>
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="under_review">Under Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterRole} onValueChange={(v) => setFilterRole(v as any)}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="hod">HOD</SelectItem>
            <SelectItem value="teacher">Teacher</SelectItem>
            <SelectItem value="student">Student</SelectItem>
            <SelectItem value="accountant">Accountant</SelectItem>
            <SelectItem value="printing">Printing</SelectItem>
            <SelectItem value="operations">Operations</SelectItem>
          </SelectContent>
        </Select>
        {(filterStatus !== "all" || filterRole !== "all") && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterStatus("all"); setFilterRole("all"); }}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Request list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileText size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">{requests.length === 0 ? "No change requests yet." : "No requests match the current filters."}</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map(req => (
                <button
                  key={req.id}
                  className="w-full text-left px-5 py-4 hover:bg-muted/40 transition-colors"
                  onClick={() => setSelectedRequest(req)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <User size={13} className="text-muted-foreground shrink-0" />
                        <span className="font-semibold text-sm">{req.userName}</span>
                        <RoleBadge role={req.userRole} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Requesting to change <strong className="text-foreground">{req.fieldLabel}</strong>
                        <span className="mx-1">→</span>
                        <span className="text-primary font-medium">{req.requestedValue}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(req.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <StatusBadge status={req.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <ReviewDialog
        request={selectedRequest}
        onClose={() => setSelectedRequest(null)}
        onDone={loadRequests}
      />
    </div>
  );
}

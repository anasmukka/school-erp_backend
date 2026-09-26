import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  PrintOrder,
  PrintOrderStatus,
  PrintPriority,
} from "@/lib/types";
import {
  getPrintOrders,
  getPrintMetrics,
  updatePrintOrderStatus,
} from "@/lib/printing";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Printer,
  Clock,
  CheckCircle2,
  AlertCircle,
  Search,
  Download,
  FileText,
  Filter,
  Check,
  X,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export default function PrintingDashboard() {
  const { appUser } = useAuth();
  const [orders, setOrders] = useState<PrintOrder[]>([]);
  const [metrics, setMetrics] = useState({
    pending: 0,
    inProgress: 0,
    completed: 0,
    highPriority: 0,
    total: 0,
    totalPagesPrinted: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");

  // Selected Order for Detail Modal
  const [selectedOrder, setSelectedOrder] = useState<PrintOrder | null>(null);

  // Reject Dialog
  const [rejectOrderTarget, setRejectOrderTarget] = useState<PrintOrder | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ordersData, metricsData] = await Promise.all([
        getPrintOrders({
          status: statusFilter as any,
          priority: priorityFilter as any,
          search,
        }),
        getPrintMetrics(),
      ]);
      setOrders(ordersData);
      setMetrics(metricsData);
    } catch (err: any) {
      toast.error(err.message || "Failed to load printing orders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [statusFilter, priorityFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadData();
  };

  const handleStatusTransition = async (order: PrintOrder, newStatus: PrintOrderStatus) => {
    if (!appUser) return;
    try {
      setActionLoading(true);
      await updatePrintOrderStatus(order.id, newStatus, {
        userId: appUser.id,
        userName: appUser.name,
        role: appUser.role,
      });
      toast.success(`Order ${order.orderNo} updated to ${newStatus.toUpperCase()}`);
      if (selectedOrder?.id === order.id) {
        setSelectedOrder({ ...selectedOrder, status: newStatus });
      }
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to update order status.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!appUser || !rejectOrderTarget) return;
    if (!rejectReason.trim()) {
      toast.error("Please provide a reason for rejecting the print request.");
      return;
    }
    try {
      setActionLoading(true);
      await updatePrintOrderStatus(
        rejectOrderTarget.id,
        "rejected",
        {
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
        },
        { rejectionReason: rejectReason.trim() }
      );
      toast.success(`Order ${rejectOrderTarget.orderNo} rejected.`);
      setRejectOrderTarget(null);
      setRejectReason("");
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to reject order.");
    } finally {
      setActionLoading(false);
    }
  };

  const getPriorityBadge = (priority: PrintPriority) => {
    switch (priority) {
      case "urgent":
        return <Badge className="bg-rose-500 hover:bg-rose-600 text-white animate-pulse">Urgent</Badge>;
      case "high":
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">High</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground">Normal</Badge>;
    }
  };

  const getStatusBadge = (status: PrintOrderStatus) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">Pending</Badge>;
      case "accepted":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-300">Accepted</Badge>;
      case "printing":
        return <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 border-indigo-300 animate-pulse">Printing</Badge>;
      case "completed":
        return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-300">Completed</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      case "cancelled":
        return <Badge variant="outline">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Printer className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Printing Department Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                Manage high-volume printing requests, examination papers, and official documents.
              </p>
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadData()} disabled={loading}>
          <RotateCcw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics.pending}</p>
              <p className="text-xs text-muted-foreground">Pending Orders</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics.inProgress}</p>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics.completed}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-700 shrink-0">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics.highPriority}</p>
              <p className="text-xs text-muted-foreground">High / Urgent</p>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2 sm:col-span-1 rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics.totalPagesPrinted.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Pages Printed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="rounded-2xl border border-border/70 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3 justify-between items-center">
            <form onSubmit={handleSearchSubmit} className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search order no, title, requester..."
                className="pl-9 rounded-xl"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </form>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Status:</span>
                <select
                  aria-label="Filter by Status"
                  className="text-xs h-9 rounded-xl border border-input bg-background px-3 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="accepted">Accepted</option>
                  <option value="printing">Printing</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Priority:</span>
                <select
                  aria-label="Filter by Priority"
                  className="text-xs h-9 rounded-xl border border-input bg-background px-3 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                >
                  <option value="all">All Priorities</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                </select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border/60 bg-muted/20 flex justify-between items-center">
          <h2 className="font-semibold text-sm">Printing Requests ({orders.length})</h2>
          <span className="text-xs text-muted-foreground">Click on any order to view details & job specifications</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-muted/40 text-muted-foreground border-b border-border/60">
              <tr>
                <th className="px-4 py-3">Order No</th>
                <th className="px-4 py-3">Document Title</th>
                <th className="px-4 py-3">Requester</th>
                <th className="px-4 py-3">Copies / Specs</th>
                <th className="px-4 py-3">Required By</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
                    <p>Loading printing orders...</p>
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <Printer className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                    <p className="font-medium">No printing orders found.</p>
                    <p className="text-xs mt-0.5">Try adjusting your filters or search criteria.</p>
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedOrder(order)}
                  >
                    <td className="px-4 py-3 font-semibold text-primary font-mono text-xs">
                      {order.orderNo}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium line-clamp-1">{order.title}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {order.documentType.replace("_", " ")}
                        {order.grade && ` • Grade ${order.grade}`}
                        {order.section && `-${order.section}`}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-xs">{order.requesterName}</div>
                      <div className="text-[11px] text-muted-foreground uppercase">{order.requesterRole}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-semibold">
                        {order.copies} copies • {order.pageCount} pgs
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {order.colorMode.toUpperCase()} • {order.sides === "double" ? "2-Sided" : "1-Sided"} • {order.paperSize}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-medium">{order.requiredDate}</span>
                    </td>
                    <td className="px-4 py-3">
                      {getPriorityBadge(order.priority)}
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(order.status)}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {order.fileUrl && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            title="Download Attachment"
                            asChild
                          >
                            <a href={order.fileUrl} target="_blank" rel="noopener noreferrer" download>
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        )}

                        {order.status === "pending" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                              onClick={() => handleStatusTransition(order, "accepted")}
                              disabled={actionLoading}
                            >
                              <Check className="h-3.5 w-3.5 mr-1" /> Accept
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2.5 text-xs text-rose-600 border-rose-200 hover:bg-rose-50"
                              onClick={() => setRejectOrderTarget(order)}
                              disabled={actionLoading}
                            >
                              <X className="h-3.5 w-3.5 mr-1" /> Reject
                            </Button>
                          </>
                        )}

                        {order.status === "accepted" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-2.5 text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                            onClick={() => handleStatusTransition(order, "printing")}
                            disabled={actionLoading}
                          >
                            <Play className="h-3.5 w-3.5 mr-1" /> Print
                          </Button>
                        )}

                        {order.status === "printing" && (
                          <Button
                            size="sm"
                            className="h-8 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => handleStatusTransition(order, "completed")}
                            disabled={actionLoading}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Done
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Detail Modal */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl">
          {selectedOrder && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-2 pr-6">
                  <DialogTitle className="text-lg font-bold flex items-center gap-2">
                    <Printer className="h-5 w-5 text-primary" />
                    Order Details: {selectedOrder.orderNo}
                  </DialogTitle>
                  <div className="flex items-center gap-2">
                    {getPriorityBadge(selectedOrder.priority)}
                    {getStatusBadge(selectedOrder.status)}
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 py-2 text-sm">
                <div className="bg-muted/30 p-3 rounded-xl border border-border/60">
                  <h3 className="font-semibold text-base">{selectedOrder.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                    Category: {selectedOrder.documentType.replace("_", " ")}
                    {selectedOrder.department && ` • Department: ${selectedOrder.department}`}
                    {selectedOrder.grade && ` • Grade ${selectedOrder.grade}`}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-card p-3 rounded-xl border border-border/60">
                  <div>
                    <span className="text-xs text-muted-foreground block">Copies</span>
                    <span className="font-semibold text-base">{selectedOrder.copies}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Pages per Copy</span>
                    <span className="font-semibold text-base">{selectedOrder.pageCount}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Total Print Volume</span>
                    <span className="font-semibold text-base text-primary">
                      {selectedOrder.copies * selectedOrder.pageCount} pages
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Paper Size</span>
                    <span className="font-semibold text-base">{selectedOrder.paperSize}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="border border-border/60 rounded-xl p-3">
                    <span className="text-xs text-muted-foreground block">Color Mode</span>
                    <span className="font-medium capitalize">{selectedOrder.colorMode === "color" ? "Full Color" : "Black & White (B&W)"}</span>
                  </div>
                  <div className="border border-border/60 rounded-xl p-3">
                    <span className="text-xs text-muted-foreground block">Sides</span>
                    <span className="font-medium capitalize">{selectedOrder.sides === "double" ? "Double Sided (Duplex)" : "Single Sided (Simplex)"}</span>
                  </div>
                  <div className="border border-border/60 rounded-xl p-3">
                    <span className="text-xs text-muted-foreground block">Binding / Finishing</span>
                    <span className="font-medium capitalize">{selectedOrder.binding}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="border border-border/60 rounded-xl p-3">
                    <span className="text-xs text-muted-foreground block">Requested By</span>
                    <span className="font-medium">{selectedOrder.requesterName}</span>
                    <span className="text-xs text-muted-foreground block capitalize">{selectedOrder.requesterRole}</span>
                  </div>
                  <div className="border border-border/60 rounded-xl p-3">
                    <span className="text-xs text-muted-foreground block">Required Deadline</span>
                    <span className="font-semibold text-rose-600">{selectedOrder.requiredDate}</span>
                  </div>
                </div>

                {selectedOrder.instructions && (
                  <div className="border border-border/60 rounded-xl p-3 bg-amber-50/50">
                    <span className="text-xs font-semibold text-amber-900 block mb-1">Special Instructions:</span>
                    <p className="text-xs text-amber-950 whitespace-pre-wrap">{selectedOrder.instructions}</p>
                  </div>
                )}

                {selectedOrder.rejectionReason && (
                  <div className="border border-rose-200 rounded-xl p-3 bg-rose-50/50">
                    <span className="text-xs font-semibold text-rose-900 block mb-1">Rejection Reason:</span>
                    <p className="text-xs text-rose-950">{selectedOrder.rejectionReason}</p>
                  </div>
                )}

                {/* Attached Document Download Box */}
                {selectedOrder.fileUrl ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-primary/20 bg-primary/5">
                    <div className="flex items-center gap-3">
                      <FileText className="h-8 w-8 text-primary shrink-0" />
                      <div>
                        <p className="font-semibold text-xs text-foreground truncate max-w-sm">
                          {selectedOrder.fileName || "Printable_Document"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {selectedOrder.fileSize ? `${(selectedOrder.fileSize / (1024 * 1024)).toFixed(2)} MB` : "Firebase Storage Document"}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" asChild>
                      <a href={selectedOrder.fileUrl} target="_blank" rel="noopener noreferrer" download>
                        <Download className="h-4 w-4 mr-1.5" /> Download File
                      </a>
                    </Button>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic p-2">
                    No digital file was attached to this request (physical original submitted).
                  </div>
                )}

                {/* Print completion logs */}
                {selectedOrder.printedAt && (
                  <div className="text-xs text-muted-foreground border-t border-border/60 pt-2">
                    Completed by <span className="font-medium">{selectedOrder.printedByName || "Printing Dept"}</span> on{" "}
                    {new Date(selectedOrder.printedAt).toLocaleString()}
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <div className="flex items-center gap-2 w-full justify-between">
                  <div className="flex items-center gap-2">
                    {selectedOrder.status === "pending" && (
                      <Button
                        variant="outline"
                        className="text-rose-600 border-rose-200 hover:bg-rose-50"
                        onClick={() => {
                          const o = selectedOrder;
                          setSelectedOrder(null);
                          setRejectOrderTarget(o);
                        }}
                      >
                        Reject Request
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedOrder.status === "pending" && (
                      <Button
                        onClick={() => handleStatusTransition(selectedOrder, "accepted")}
                        disabled={actionLoading}
                      >
                        Accept Request
                      </Button>
                    )}
                    {selectedOrder.status === "accepted" && (
                      <Button
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        onClick={() => handleStatusTransition(selectedOrder, "printing")}
                        disabled={actionLoading}
                      >
                        Start Printing
                      </Button>
                    )}
                    {selectedOrder.status === "printing" && (
                      <Button
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => handleStatusTransition(selectedOrder, "completed")}
                        disabled={actionLoading}
                      >
                        Mark as Completed
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => setSelectedOrder(null)}>
                      Close
                    </Button>
                  </div>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Reason Dialog */}
      <Dialog open={!!rejectOrderTarget} onOpenChange={(open) => !open && setRejectOrderTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Reject Print Request ({rejectOrderTarget?.orderNo})
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Please enter the reason for rejecting this print request. This explanation will be visible to the requesting teacher or staff member.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Rejection Reason *</Label>
              <Input
                placeholder="e.g. File unreadable, insufficient paper size, deadline cannot be met..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOrderTarget(null)} disabled={actionLoading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmReject}
              disabled={actionLoading || !rejectReason.trim()}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

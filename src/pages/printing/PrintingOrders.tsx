import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  PrintBinding,
  PrintColorMode,
  PrintDocumentType,
  PrintOrder,
  PrintPaperSize,
  PrintPriority,
  PrintSides,
} from "@/lib/types";
import {
  createPrintOrder,
  getPrintOrders,
  deletePrintOrder,
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
  Plus,
  UploadCloud,
  FileText,
  Download,
  AlertCircle,
  Clock,
  CheckCircle2,
  Trash2,
  Info,
} from "lucide-react";
import { toast } from "sonner";

export default function PrintingOrders() {
  const { appUser } = useAuth();
  const [orders, setOrders] = useState<PrintOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Form State
  const [formData, setFormData] = useState<{
    title: string;
    documentType: PrintDocumentType;
    department: string;
    grade: string;
    section: string;
    copies: number;
    pageCount: number;
    paperSize: PrintPaperSize;
    colorMode: PrintColorMode;
    sides: PrintSides;
    binding: PrintBinding;
    priority: PrintPriority;
    requiredDate: string;
    instructions: string;
  }>({
    title: "",
    documentType: "question_paper",
    department: "",
    grade: "",
    section: "",
    copies: 30,
    pageCount: 1,
    paperSize: "A4",
    colorMode: "bw",
    sides: "single",
    binding: "none",
    priority: "normal",
    requiredDate: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
    instructions: "",
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const loadOrders = async () => {
    if (!appUser) return;
    try {
      setLoading(true);
      // Teachers and HODs see their own requests; admins can see all
      const filters = appUser.role === "admin" ? {} : { requesterId: appUser.id };
      const data = await getPrintOrders(filters);
      setOrders(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to load print requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOrders();
  }, [appUser]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 30 * 1024 * 1024) {
        toast.error("File size exceeds 30MB limit.");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;

    if (!formData.title.trim()) {
      toast.error("Please enter a document title.");
      return;
    }
    if (formData.copies <= 0) {
      toast.error("Number of copies must be at least 1.");
      return;
    }
    if (formData.pageCount <= 0) {
      toast.error("Page count must be at least 1.");
      return;
    }

    try {
      setSubmitting(true);
      setUploadProgress(0);

      await createPrintOrder(
        {
          title: formData.title.trim(),
          documentType: formData.documentType,
          requesterId: appUser.id,
          requesterName: appUser.name,
          requesterRole: appUser.role,
          department: formData.department.trim() || undefined,
          grade: formData.grade.trim() || undefined,
          section: formData.section.trim() || undefined,
          copies: Number(formData.copies),
          pageCount: Number(formData.pageCount),
          paperSize: formData.paperSize,
          colorMode: formData.colorMode,
          sides: formData.sides,
          binding: formData.binding,
          priority: formData.priority,
          requiredDate: formData.requiredDate,
          instructions: formData.instructions.trim() || undefined,
        },
        selectedFile || undefined,
        (progress) => setUploadProgress(progress)
      );

      toast.success("Printing request submitted successfully!");
      setIsSubmitModalOpen(false);
      setSelectedFile(null);
      setFormData({
        title: "",
        documentType: "question_paper",
        department: "",
        grade: "",
        section: "",
        copies: 30,
        pageCount: 1,
        paperSize: "A4",
        colorMode: "bw",
        sides: "single",
        binding: "none",
        priority: "normal",
        requiredDate: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
        instructions: "",
      });
      await loadOrders();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit print request.");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  const handleDelete = async (orderId: string) => {
    if (!appUser) return;
    if (!window.confirm("Are you sure you want to cancel and delete this print request?")) return;
    try {
      await deletePrintOrder(orderId, {
        userId: appUser.id,
        userName: appUser.name,
        role: appUser.role,
      });
      toast.success("Print request deleted.");
      await loadOrders();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete order.");
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Printer className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Print Requests</h1>
              <p className="text-sm text-muted-foreground">
                Submit examination question papers, worksheets, and circulars to the Printing Department.
              </p>
            </div>
          </div>
        </div>

        <Button onClick={() => setIsSubmitModalOpen(true)} className="rounded-xl">
          <Plus className="h-4 w-4 mr-1.5" /> Submit New Print Request
        </Button>
      </div>

      {/* Orders Table */}
      <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border/60 bg-muted/20 flex justify-between items-center">
          <h2 className="font-semibold text-sm">
            {appUser?.role === "admin" ? "All School Print Requests" : "My Print Requests"} ({orders.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-muted/40 text-muted-foreground border-b border-border/60">
              <tr>
                <th className="px-4 py-3">Order No</th>
                <th className="px-4 py-3">Document Title</th>
                <th className="px-4 py-3">Copies / Specs</th>
                <th className="px-4 py-3">Required By</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Attachment</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
                    <p>Loading requests...</p>
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <Printer className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                    <p className="font-medium">No print requests submitted yet.</p>
                    <p className="text-xs mt-0.5">Click "Submit New Print Request" to send your first document.</p>
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">
                      {order.orderNo}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{order.title}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {order.documentType.replace("_", " ")}
                        {order.grade && ` • Grade ${order.grade}`}
                        {order.section && `-${order.section}`}
                      </div>
                      {order.rejectionReason && (
                        <div className="mt-1 text-xs text-rose-600 bg-rose-50 p-1.5 rounded-lg border border-rose-200">
                          <strong>Rejection Note:</strong> {order.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium">
                        {order.copies} copies • {order.pageCount} pgs
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {order.colorMode.toUpperCase()} • {order.sides === "double" ? "2-Sided" : "1-Sided"} • {order.paperSize}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">
                      {order.requiredDate}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={order.priority === "urgent" ? "destructive" : order.priority === "high" ? "default" : "outline"}
                        className={order.priority === "high" ? "bg-amber-500" : ""}
                      >
                        {order.priority}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          order.status === "completed"
                            ? "bg-emerald-100 text-emerald-800"
                            : order.status === "printing"
                            ? "bg-indigo-100 text-indigo-800 animate-pulse"
                            : order.status === "accepted"
                            ? "bg-blue-100 text-blue-800"
                            : order.status === "rejected"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {order.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {order.fileUrl ? (
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-blue-600" asChild>
                          <a href={order.fileUrl} target="_blank" rel="noopener noreferrer" download>
                            <Download className="h-3.5 w-3.5 mr-1" />
                            {order.fileName ? order.fileName.slice(0, 15) : "Download"}
                          </a>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(order.status === "pending" || appUser?.role === "admin") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => handleDelete(order.id)}
                          title="Cancel / Delete Request"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Submit Print Request Dialog */}
      <Dialog open={isSubmitModalOpen} onOpenChange={setIsSubmitModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-primary" />
              Submit Document for Printing
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Document Title *</Label>
              <Input
                placeholder="e.g. Grade 10 Mathematics Term 1 Examination Paper"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Document Type</Label>
                <select
                  className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  value={formData.documentType}
                  onChange={(e) => setFormData({ ...formData, documentType: e.target.value as PrintDocumentType })}
                >
                  <option value="question_paper">Question Paper</option>
                  <option value="worksheet">Worksheet</option>
                  <option value="syllabus">Syllabus</option>
                  <option value="circular">Circular</option>
                  <option value="administrative">Administrative</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Grade (Optional)</Label>
                <Input
                  placeholder="e.g. 10"
                  value={formData.grade}
                  onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Section (Optional)</Label>
                <Input
                  placeholder="e.g. A"
                  value={formData.section}
                  onChange={(e) => setFormData({ ...formData, section: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/20 p-3 rounded-xl border border-border/60">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Copies Required *</Label>
                <Input
                  type="number"
                  min="1"
                  value={formData.copies}
                  onChange={(e) => setFormData({ ...formData, copies: parseInt(e.target.value) || 1 })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Pages per Copy *</Label>
                <Input
                  type="number"
                  min="1"
                  value={formData.pageCount}
                  onChange={(e) => setFormData({ ...formData, pageCount: parseInt(e.target.value) || 1 })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Paper Size</Label>
                <select
                  className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  value={formData.paperSize}
                  onChange={(e) => setFormData({ ...formData, paperSize: e.target.value as PrintPaperSize })}
                >
                  <option value="A4">A4 (Standard)</option>
                  <option value="A3">A3 (Large)</option>
                  <option value="Legal">Legal</option>
                  <option value="Letter">Letter</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Priority</Label>
                <select
                  className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as PrintPriority })}
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Color Mode</Label>
                <select
                  className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  value={formData.colorMode}
                  onChange={(e) => setFormData({ ...formData, colorMode: e.target.value as PrintColorMode })}
                >
                  <option value="bw">Black & White (Economical)</option>
                  <option value="color">Full Color</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Sides</Label>
                <select
                  className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  value={formData.sides}
                  onChange={(e) => setFormData({ ...formData, sides: e.target.value as PrintSides })}
                >
                  <option value="single">Single-Sided</option>
                  <option value="double">Double-Sided (Duplex)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Binding / Finishing</Label>
                <select
                  className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  value={formData.binding}
                  onChange={(e) => setFormData({ ...formData, binding: e.target.value as PrintBinding })}
                >
                  <option value="none">None (Loose)</option>
                  <option value="stapled">Stapled (Top-Left)</option>
                  <option value="spiral">Spiral Bound</option>
                  <option value="laminated">Laminated</option>
                  <option value="booklet">Booklet</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Required By Deadline *</Label>
                <Input
                  type="date"
                  value={formData.requiredDate}
                  onChange={(e) => setFormData({ ...formData, requiredDate: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Department / Subject</Label>
                <Input
                  placeholder="e.g. Mathematics Department"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Special Instructions (Optional)</Label>
              <Input
                placeholder="e.g. Please staple in batches of 25, wrap question papers in sealed envelopes..."
                value={formData.instructions}
                onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
              />
            </div>

            {/* File Upload Area */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Attach Document File (PDF, Word, or Image)</Label>
              <div className="border-2 border-dashed border-border/80 rounded-xl p-4 text-center hover:bg-muted/20 transition-colors">
                <input
                  type="file"
                  id="print-file-upload"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                />
                <label htmlFor="print-file-upload" className="cursor-pointer block">
                  <UploadCloud className="h-8 w-8 mx-auto text-primary/70 mb-1" />
                  {selectedFile ? (
                    <div className="text-xs font-semibold text-primary">
                      {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                      <p className="text-[11px] text-muted-foreground font-normal mt-0.5">Click to change file</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-medium">Click to select or drag and drop file here</p>
                      <p className="text-[11px] text-muted-foreground">PDF, DOCX, DOC, JPG, PNG (Max 30MB)</p>
                    </div>
                  )}
                </label>
              </div>

              {uploadProgress !== null && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Uploading to Storage...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-1.5 transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsSubmitModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Print Request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

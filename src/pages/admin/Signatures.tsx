import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  SignatureRecord,
  SignatureVersion,
  SignatoryRole,
  OfficialDocumentType,
  DocumentSignatoryConfig,
  DOCUMENT_SIGN_PERMISSIONS,
  getSignatures,
  getDocumentSignatoryConfigs,
  toggleSignatureStatus,
  publishSignatureVersion,
  uploadSignatureImage,
  validateSignatureImageFile,
  DEFAULT_SIGNATORY_CONFIGS,
  sanitizeSignatoryConfig,
} from "@/lib/signatures";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  PenTool,
  Plus,
  ShieldCheck,
  FileSignature,
  History,
  AlertCircle,
  Loader2,
  Settings2,
  Upload,
  ImageIcon,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const ROLE_LABELS: Record<SignatoryRole, string> = {
  admin: "Admin (Principal)",
  hod: "HOD (Head of Department)",
  class_teacher: "Class Teacher",
};

const DOC_LABELS: Record<OfficialDocumentType, string> = {
  report_card: "Report Cards",
  hall_ticket: "Hall Tickets",
  official_notice: "Official Notices",
  transfer_certificate: "Transfer Certificates",
};

function getPermittedDocs(role: SignatoryRole): OfficialDocumentType[] {
  return (Object.keys(DOCUMENT_SIGN_PERMISSIONS) as OfficialDocumentType[]).filter((d) =>
    DOCUMENT_SIGN_PERMISSIONS[d].includes(role)
  );
}

function VersionBadge({ version }: { version: SignatureVersion }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
        version.isCurrent
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-zinc-100 text-zinc-500 border border-zinc-200"
      }`}
    >
      v{version.versionNumber}
      {version.isCurrent && " (active)"}
    </span>
  );
}

function SignatureImageBox({
  imageUrl,
  name,
  className = "",
}: {
  imageUrl?: string;
  name: string;
  className?: string;
}) {
  return (
    <div
      className={`bg-white border rounded-xl flex items-center justify-center min-h-[90px] shadow-inner ${className}`}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")" }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`Signature of ${name}`}
          className="max-h-16 max-w-full object-contain"
          style={{ imageRendering: "crisp-edges" }}
        />
      ) : (
        <div className="flex flex-col items-center text-muted-foreground gap-1">
          <ImageIcon className="w-6 h-6 opacity-40" />
          <span className="text-xs opacity-60">No signature image</span>
        </div>
      )}
    </div>
  );
}

export default function AdminSignatures() {
  const { appUser } = useAuth();

  const [signatures, setSignatures] = useState<SignatureRecord[]>([]);
  const [configs, setConfigs] = useState<DocumentSignatoryConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formRole, setFormRole] = useState<SignatoryRole>("admin");
  const [formDesignation, setFormDesignation] = useState("Principal");
  const [formDocs, setFormDocs] = useState<OfficialDocumentType[]>(["report_card", "hall_ticket"]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Audit / history modal
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditSig, setAuditSig] = useState<SignatureRecord | null>(null);

  // Version history expand
  const [expandedVersions, setExpandedVersions] = useState<Record<string, boolean>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const [sigs, confs] = await Promise.all([getSignatures(), getDocumentSignatoryConfigs()]);
      setSignatures(sigs);
      setConfigs(confs);
    } catch (err: any) {
      toast.error("Failed to load signatures: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const openUploadForNew = () => {
    setEditingUserId(null);
    setFormName("");
    setFormRole("admin");
    setFormDesignation("Principal");
    setFormDocs(["report_card", "hall_ticket"]);
    setSelectedFile(null);
    setPreviewUrl("");
    setFileError("");
    setUploadProgress(0);
    setUploadModalOpen(true);
  };

  const openUploadForExisting = (sig: SignatureRecord) => {
    setEditingUserId(sig.userId);
    setFormName(sig.name);
    setFormRole(sig.role);
    setFormDesignation(sig.designation);
    setFormDocs(sig.authorizedDocumentTypes);
    setSelectedFile(null);
    setPreviewUrl(sig.imageUrl);
    setFileError("");
    setUploadProgress(0);
    setUploadModalOpen(true);
  };

  const handleRoleChange = (role: SignatoryRole) => {
    setFormRole(role);
    if (role === "admin") setFormDesignation("Principal");
    else if (role === "hod") setFormDesignation("Head of Department");
    else setFormDesignation("Class Teacher");
    // Reset docs to permitted ones for the new role
    setFormDocs(getPermittedDocs(role));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const error = validateSignatureImageFile(file);
    if (error) {
      setFileError(error);
      setSelectedFile(null);
      setPreviewUrl("");
      return;
    }

    setFileError("");
    setSelectedFile(file);

    // Generate preview
    const reader = new FileReader();
    reader.onload = (ev) => setPreviewUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleDocToggle = (docType: OfficialDocumentType, checked: boolean) => {
    if (checked) {
      setFormDocs((prev) => [...prev, docType]);
    } else {
      setFormDocs((prev) => prev.filter((d) => d !== docType));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;

    if (!formName.trim()) {
      toast.error("Please enter the signatory's full name.");
      return;
    }

    // For new signatures, a file is required
    // For existing signature updates, file is required (always upload a new version)
    if (!selectedFile) {
      toast.error("Please select a signature image file to upload.");
      return;
    }

    setSaving(true);
    setUploadProgress(0);
    try {
      // Determine the userId for the signature record
      // For admin managing a new staff signature: use a predictable ID
      // For self-upload: use own UID
      const targetUserId = editingUserId ?? `sig-${formRole}-${appUser.id}`;

      // Get existing version count for numbering
      const existingSig = signatures.find((s) => s.userId === targetUserId || s.id === targetUserId);
      const nextVersion = (existingSig?.versions?.length ?? 0) + 1;

      // Upload the image
      const uploadResult = await uploadSignatureImage(
        selectedFile,
        targetUserId,
        nextVersion,
        setUploadProgress
      );

      // Save the signature profile
      await publishSignatureVersion(
        {
          userId: targetUserId,
          role: formRole,
          name: formName.trim(),
          designation: formDesignation.trim() || (formRole === "admin" ? "Principal" : "Faculty"),
          authorizedDocumentTypes: formDocs,
          downloadUrl: uploadResult.downloadUrl,
          storagePath: uploadResult.storagePath,
          mimeType: uploadResult.mimeType,
          fileSizeBytes: uploadResult.fileSizeBytes,
        },
        { uid: appUser.id, name: appUser.name, role: appUser.role }
      );

      toast.success(
        existingSig
          ? `Signature v${nextVersion} uploaded for ${formName}.`
          : `Signature authorized for ${formName}.`
      );
      setUploadModalOpen(false);
      void loadData();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save signature.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (sig: SignatureRecord) => {
    if (!appUser || appUser.role !== "admin") return;
    const newStatus = sig.status === "active" ? "deactivated" : "active";
    try {
      await toggleSignatureStatus(
        sig.userId,
        newStatus,
        { uid: appUser.id, name: appUser.name, role: appUser.role },
        `Status changed to ${newStatus} by Admin`
      );
      toast.success(
        `Signature for ${sig.name} ${newStatus === "active" ? "activated" : "deactivated"}.`
      );
      void loadData();
    } catch (err: any) {
      toast.error("Failed to update status: " + err.message);
    }
  };

  const effectiveConfigs = configs.length > 0 ? configs : DEFAULT_SIGNATORY_CONFIGS;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 text-primary rounded-xl">
              <FileSignature className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Institutional E-Signatures</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage official signatures for Admin, HOD, and Class Teacher.
              </p>
            </div>
          </div>
        </div>

        <Button onClick={openUploadForNew} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" /> Authorize New Signature
        </Button>
      </div>

      {/* Role Access Notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <div>
          <p className="font-semibold">Authorized Signatories Only</p>
          <p className="mt-0.5 text-amber-700">
            Only <strong>Admin (Principal)</strong>, <strong>HOD</strong>, and{" "}
            <strong>Class Teacher</strong> roles may hold institutional signatures. Subject teachers,
            accounts, and other roles cannot sign official documents.
          </p>
        </div>
      </div>

      <Tabs defaultValue="signatures" className="space-y-4">
        <TabsList className="bg-muted/60 p-1 rounded-xl">
          <TabsTrigger value="signatures" className="gap-2 rounded-lg text-xs">
            <PenTool className="w-3.5 h-3.5" /> Authorized Signatures ({signatures.length})
          </TabsTrigger>
          <TabsTrigger value="matrix" className="gap-2 rounded-lg text-xs">
            <Settings2 className="w-3.5 h-3.5" /> Document Permission Matrix
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2 rounded-lg text-xs">
            <History className="w-3.5 h-3.5" /> Audit Trail
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: AUTHORIZED SIGNATURES */}
        <TabsContent value="signatures" className="space-y-4">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
              Loading signatures…
            </div>
          ) : signatures.length === 0 ? (
            <Card className="rounded-2xl p-12 text-center text-muted-foreground border">
              <FileSignature className="w-12 h-12 mx-auto text-primary/40 mb-3" />
              <h3 className="text-base font-bold text-foreground">No Signatures Configured</h3>
              <p className="text-xs mt-1 max-w-sm mx-auto">
                Authorize the first official signature to enable document signing for report cards,
                hall tickets, and notices.
              </p>
              <Button onClick={openUploadForNew} className="mt-4 gap-2 text-xs">
                <Plus className="w-3.5 h-3.5" /> Authorize First Signature
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {signatures.map((sig) => (
                <Card
                  key={sig.id}
                  className={`rounded-2xl overflow-hidden border transition-all ${
                    sig.status === "active"
                      ? "border-border shadow-sm hover:shadow-md"
                      : "border-border/60 bg-muted/20 opacity-75"
                  }`}
                >
                  <CardHeader className="pb-3 border-b bg-muted/10">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                          {sig.name}
                          {sig.role === "admin" && (
                            <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                          )}
                        </CardTitle>
                        <div className="space-y-0.5 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground/80">Role:</span>
                            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                              {ROLE_LABELS[sig.role as SignatoryRole] ?? sig.role}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground/80">Designation:</span>
                            <span>{sig.designation}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground/80">Version:</span>
                            {sig.versions?.length > 0 ? (
                              <VersionBadge
                                version={
                                  sig.versions.find((v) => v.versionId === sig.activeVersionId) ??
                                  sig.versions[sig.versions.length - 1]
                                }
                              />
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase font-semibold shrink-0 ${
                          sig.status === "active"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-zinc-100 text-zinc-600 border-zinc-200"
                        }`}
                      >
                        {sig.status}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="p-4 space-y-3">
                    {/* Signature Preview */}
                    <SignatureImageBox imageUrl={sig.imageUrl} name={sig.name} />

                    {/* Authorized Documents */}
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground font-medium">
                        Authorized for:
                      </Label>
                      <div className="flex flex-wrap gap-1">
                        {(sig.authorizedDocumentTypes || []).map((dt) => (
                          <Badge
                            key={dt}
                            variant="secondary"
                            className="text-[10px] py-0 px-1.5 font-normal"
                          >
                            {DOC_LABELS[dt as OfficialDocumentType] ?? dt}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Version history collapsible */}
                    {sig.versions && sig.versions.length > 1 && (
                      <div className="border-t pt-2">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() =>
                            setExpandedVersions((prev) => ({
                              ...prev,
                              [sig.id]: !prev[sig.id],
                            }))
                          }
                        >
                          {expandedVersions[sig.id] ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                          {sig.versions.length} versions uploaded
                        </button>
                        {expandedVersions[sig.id] && (
                          <div className="mt-2 space-y-1.5">
                            {[...sig.versions].reverse().map((v) => (
                              <div
                                key={v.versionId}
                                className="flex items-center justify-between text-[10px] text-muted-foreground bg-muted/20 rounded px-2 py-1"
                              >
                                <div className="flex items-center gap-1.5">
                                  <VersionBadge version={v} />
                                  <span>by {v.uploadedByName}</span>
                                </div>
                                <span>{new Date(v.uploadedAt).toLocaleDateString()}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Footer info */}
                    <div className="text-[10px] text-muted-foreground border-t pt-2">
                      <p>
                        Authorized by: <span className="font-medium">{sig.authorizedByName || "Admin"}</span>
                      </p>
                      <p>Updated: {sig.updatedAt ? new Date(sig.updatedAt).toLocaleDateString() : "—"}</p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAuditSig(sig);
                          setAuditModalOpen(true);
                        }}
                        className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                      >
                        <History className="w-3 h-3 mr-1" /> History
                      </Button>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openUploadForExisting(sig)}
                          className="h-7 text-xs px-2.5 gap-1"
                        >
                          <Upload className="w-3 h-3" /> Replace
                        </Button>
                        <Button
                          variant={sig.status === "active" ? "destructive" : "default"}
                          size="sm"
                          onClick={() => handleToggleStatus(sig)}
                          className="h-7 text-xs px-2.5"
                        >
                          {sig.status === "active" ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* TAB 2: DOCUMENT PERMISSION MATRIX */}
        <TabsContent value="matrix" className="space-y-4">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base font-bold">Document Signature Permission Matrix</CardTitle>
              <CardDescription className="text-xs">
                System-enforced rules controlling which roles may sign each document type.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {effectiveConfigs.map(sanitizeSignatoryConfig).map((config) => (
                <div key={config.id} className="p-4 rounded-xl border bg-muted/20 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold">{config.title}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0 bg-primary/5 text-primary border-primary/20">
                      {config.documentType.replace("_", " ")}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {config.slots.map((slot) => {
                      const hasSig = signatures.some(
                        (s) => s.role === slot.role && s.status === "active"
                      );
                      return (
                        <div
                          key={slot.slotId}
                          className="bg-white p-3 rounded-lg border shadow-xs space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold">{slot.label}</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                                slot.required
                                  ? "bg-rose-50 text-rose-700"
                                  : "bg-zinc-100 text-zinc-600"
                              }`}
                            >
                              {slot.required ? "Required" : "Optional"}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Role: {ROLE_LABELS[slot.role as SignatoryRole] ?? slot.role}
                          </p>
                          <div className="flex items-center gap-1.5 text-[10px]">
                            {hasSig ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <XCircle className="w-3 h-3 text-rose-500" />
                            )}
                            <span className={hasSig ? "text-emerald-700 font-medium" : "text-rose-600 font-medium"}>
                              {hasSig ? "Active signature" : "No active signature"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: AUDIT TRAIL */}
        <TabsContent value="audit" className="space-y-4">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base font-bold">Central Signature Audit Logs</CardTitle>
              <CardDescription className="text-xs">
                Immutable record of all signature uploads, version changes, and status transitions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {signatures
                  .flatMap((s) =>
                    (s.history || []).map((h) => ({
                      ...h,
                      signatoryName: s.name,
                      role: s.role,
                    }))
                  )
                  .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                  .slice(0, 50)
                  .map((entry, idx) => (
                    <div
                      key={idx}
                      className="flex gap-3 p-3 rounded-xl border text-xs bg-muted/10"
                    >
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-foreground">
                            {entry.action.replace("_", " ").toUpperCase()} — {entry.signatoryName}{" "}
                            ({entry.role})
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {new Date(entry.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-muted-foreground">{entry.notes || "Executed by Admin"}</p>
                        <p className="text-[10px] text-muted-foreground">
                          By: {entry.performedByName}
                        </p>
                      </div>
                    </div>
                  ))}
                {signatures.every((s) => (s.history || []).length === 0) && (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No audit events recorded yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== UPLOAD / AUTHORIZE MODAL ===== */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {editingUserId ? "Upload New Signature Version" : "Authorize New Signature"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {editingUserId
                ? "Uploading a new image creates a new version. Existing finalized documents retain their original version."
                : "Set up an official institutional signature for an authorized staff member."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 py-1">
            {/* Name */}
            <div className="space-y-1.5">
              <Label className="text-xs">Signatory Full Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Dr. Sarah Khan"
                required
                disabled={saving}
              />
            </div>

            {/* Role — only authorized roles */}
            <div className="space-y-1.5">
              <Label className="text-xs">ERP Role</Label>
              <select
                value={formRole}
                onChange={(e) => handleRoleChange(e.target.value as SignatoryRole)}
                className="w-full text-xs rounded-lg border border-input bg-background p-2.5"
                disabled={!!editingUserId || saving}
              >
                <option value="admin">Admin (Designation: Principal)</option>
                <option value="hod">HOD — Head of Department</option>
                <option value="class_teacher">Class Teacher</option>
              </select>
              {editingUserId && (
                <p className="text-[10px] text-muted-foreground">
                  Role cannot be changed when replacing a signature.
                </p>
              )}
            </div>

            {/* Designation */}
            <div className="space-y-1.5">
              <Label className="text-xs">Print Designation (shown on documents)</Label>
              <Input
                value={formDesignation}
                onChange={(e) => setFormDesignation(e.target.value)}
                placeholder="e.g. Principal, Head of Department, Class Teacher - Grade 9A"
                disabled={saving}
              />
            </div>

            {/* Authorized Documents (constrained by role) */}
            <div className="space-y-2">
              <Label className="text-xs">Authorized Document Types</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(DOC_LABELS) as OfficialDocumentType[]).map((dt) => {
                  const permitted = DOCUMENT_SIGN_PERMISSIONS[dt]?.includes(formRole);
                  const checked = formDocs.includes(dt);
                  return (
                    <label
                      key={dt}
                      className={`flex items-center gap-2 text-xs rounded-lg border p-2 cursor-pointer transition-colors ${
                        !permitted
                          ? "opacity-40 cursor-not-allowed bg-muted/30"
                          : checked
                          ? "bg-primary/5 border-primary/30"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked && permitted}
                        disabled={!permitted || saving}
                        onChange={(e) => handleDocToggle(dt, e.target.checked)}
                        className="rounded border-input"
                      />
                      <span className={permitted ? "" : "line-through text-muted-foreground"}>
                        {DOC_LABELS[dt]}
                      </span>
                      {!permitted && (
                        <span className="text-[9px] text-muted-foreground ml-auto">(not allowed)</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* File Upload */}
            <div className="space-y-2">
              <Label className="text-xs">Signature Image</Label>
              <div
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                  selectedFile
                    ? "border-primary/40 bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-muted/30"
                }`}
                onClick={() => !saving && fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) {
                    const synth = { target: { files: e.dataTransfer.files } } as any;
                    handleFileSelect(synth);
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={saving}
                />
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2 text-xs text-primary">
                    <ImageIcon className="w-4 h-4" />
                    <span className="font-medium truncate max-w-[200px]">{selectedFile.name}</span>
                    <span className="text-muted-foreground">
                      ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1 text-muted-foreground">
                    <Upload className="w-6 h-6 mx-auto opacity-50" />
                    <p className="text-xs font-medium">Click or drag to upload</p>
                    <p className="text-[10px]">PNG (recommended), JPG, WebP — max 2 MB</p>
                    <p className="text-[10px]">Use transparent background PNG for best results</p>
                  </div>
                )}
              </div>

              {fileError && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {fileError}
                </p>
              )}
            </div>

            {/* Preview */}
            {previewUrl && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                <SignatureImageBox imageUrl={previewUrl} name={formName} className="min-h-[80px]" />
                <p className="text-[10px] text-muted-foreground text-center">
                  The signature is displayed at natural size with transparent background preserved.
                </p>
              </div>
            )}

            {/* Upload progress */}
            {saving && uploadProgress > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Uploading…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadModalOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="gap-2">
                {saving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {uploadProgress > 0 ? `Uploading ${uploadProgress}%…` : "Saving…"}
                  </>
                ) : editingUserId ? (
                  "Upload New Version"
                ) : (
                  "Authorize Signature"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== AUDIT HISTORY MODAL ===== */}
      <Dialog open={auditModalOpen} onOpenChange={setAuditModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Audit History: {auditSig?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Complete log of authorizations, version uploads, and status changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2 max-h-72 overflow-y-auto">
            {[...(auditSig?.history ?? [])].reverse().map((entry, idx) => (
              <div key={idx} className="p-2.5 rounded-lg border text-xs bg-muted/10 space-y-0.5">
                <div className="flex justify-between items-center">
                  <span className="font-semibold capitalize">
                    {entry.action.replace("_", " ")}
                    {entry.versionId ? ` (${entry.versionId})` : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-muted-foreground">{entry.notes || "Action logged."}</p>
                <p className="text-[10px] text-muted-foreground">
                  By: {entry.performedByName}
                </p>
              </div>
            ))}
            {(auditSig?.history ?? []).length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-6">No history yet.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setAuditModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

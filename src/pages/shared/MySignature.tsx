/**
 * My Signature — Personal Signature Management Portal
 *
 * Requirements:
 * - Every signature belongs to one authenticated ERP user account.
 * - Only users explicitly granted eligibility by Admin (isEligible === true) can manage/upload.
 * - Unauthorized/ineligible users can view their status, but cannot upload or activate themselves.
 * - Authorized users can upload, preview, replace (new version), and view their authorized document types.
 * - Permitted document types cannot be modified by the user.
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  SignatureRecord,
  SignatureVersion,
  SignatoryRole,
  OfficialDocumentType,
  getSignatureForUser,
  publishSignatureVersion,
  uploadSignatureImage,
  validateSignatureImageFile,
} from "@/lib/signatures";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  FileSignature,
  History,
  ImageIcon,
  Info,
  Loader2,
  Upload,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

const DOC_LABELS: Record<OfficialDocumentType, string> = {
  report_card: "Report Cards",
  hall_ticket: "Hall Tickets",
  official_notice: "Official Notices",
  transfer_certificate: "Transfer Certificates",
};

const ROLE_DESIGNATION_DEFAULTS: Partial<Record<SignatoryRole, string>> = {
  admin: "Principal",
  hod: "Head of Department",
  class_teacher: "Class Teacher",
};

function VersionRow({ version }: { version: SignatureVersion }) {
  return (
    <div className="flex items-center justify-between text-[10px] text-muted-foreground bg-muted/20 rounded px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-semibold ${
            version.isCurrent
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-zinc-100 text-zinc-500 border border-zinc-200"
          }`}
        >
          v{version.versionNumber}
          {version.isCurrent && " (active)"}
        </span>
        <span>Uploaded by {version.uploadedByName}</span>
      </div>
      <span>{new Date(version.uploadedAt).toLocaleDateString()}</span>
    </div>
  );
}

export default function MySignature() {
  const { appUser } = useAuth();

  const [record, setRecord] = useState<SignatureRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const [formDesignation, setFormDesignation] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [fileError, setFileError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const rawRole = appUser?.role;
  const signatoryRole: SignatoryRole | undefined =
    rawRole === "admin"
      ? "admin"
      : rawRole === "hod"
      ? "hod"
      : rawRole === "teacher"
      ? "class_teacher"
      : undefined;

  const isRoleCandidate = !!signatoryRole;

  const loadRecord = async () => {
    if (!appUser?.id || !isRoleCandidate) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rec = await getSignatureForUser(appUser.id);
      setRecord(rec);
      if (rec) {
        setFormDesignation(rec.designation);
        setPreviewUrl(rec.imageUrl || rec.signatureImageUrl || "");
      } else {
        setFormDesignation(ROLE_DESIGNATION_DEFAULTS[signatoryRole as SignatoryRole] ?? "Faculty");
      }
    } catch (err: any) {
      toast.error("Failed to load your signature: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecord();
  }, [appUser?.id]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const error = validateSignatureImageFile(file);
    if (error) {
      setFileError(error);
      setSelectedFile(null);
      return;
    }

    setFileError("");
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (ev) => setPreviewUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser || !signatoryRole) return;

    if (!record || !record.isEligible) {
      toast.error("Unauthorized: Signature eligibility has not been granted by Administrator.");
      return;
    }

    if (record.status !== "active" || record.isActive === false) {
      toast.error("Unauthorized: Your signature profile is currently deactivated. Contact Administrator.");
      return;
    }

    if (!selectedFile) {
      toast.error("Please select a signature image file to upload.");
      return;
    }

    if (!formDesignation.trim()) {
      toast.error("Please enter your print designation.");
      return;
    }

    setSaving(true);
    setUploadProgress(0);
    try {
      const nextVersion = (record?.versions?.length ?? 0) + 1;

      const uploadResult = await uploadSignatureImage(
        selectedFile,
        appUser.id,
        nextVersion,
        setUploadProgress
      );

      await publishSignatureVersion(
        {
          userId: appUser.id,
          role: record.role || signatoryRole,
          name: appUser.name || appUser.email || "Staff Member",
          designation: formDesignation.trim(),
          authorizedDocumentTypes: record.authorizedDocumentTypes || ["report_card"],
          downloadUrl: uploadResult.downloadUrl,
          storagePath: uploadResult.storagePath,
          mimeType: uploadResult.mimeType,
          fileSizeBytes: uploadResult.fileSizeBytes,
        },
        { uid: appUser.id, name: appUser.name || appUser.email || "Staff", role: signatoryRole }
      );

      toast.success(`Signature v${nextVersion} saved successfully.`);
      setSelectedFile(null);
      void loadRecord();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save signature.");
    } finally {
      setSaving(false);
    }
  };

  // If user role is student, parent, operations, etc.
  if (!isRoleCandidate) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[350px] gap-3 text-center max-w-md mx-auto p-6">
        <div className="p-3 bg-rose-50 text-rose-600 rounded-full">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold text-foreground">Access Restricted</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The institutional e-signature portal is restricted to authorized faculty and administrative signatories.
        </p>
      </div>
    );
  }

  const isEligible = record?.isEligible === true;
  const isActive = record?.status === "active" && record?.isActive !== false;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 text-primary rounded-xl">
          <FileSignature className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Signature</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage your personal institutional signature image and review authorization status.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !isEligible ? (
        /* INELIGIBLE NOTICE CARD */
        <Card className="rounded-2xl border-amber-200 bg-amber-50/50 p-6 shadow-xs">
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <div className="p-3 bg-amber-100 text-amber-800 rounded-xl shrink-0">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <div className="space-y-2 flex-1">
              <h2 className="text-base font-bold text-amber-900">
                Signature Eligibility Not Granted
              </h2>
              <p className="text-xs text-amber-800 leading-relaxed">
                Your ERP account (<strong>{appUser?.name || appUser?.email}</strong>) has not been granted
                institutional e-signature eligibility by the School Administration.
              </p>
              <div className="bg-white/80 rounded-xl p-3 border border-amber-200 text-xs space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>ERP Account:</span>
                  <span className="font-semibold text-foreground">{appUser?.name || "Staff Member"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Email:</span>
                  <span>{appUser?.email}</span>
                </div>
                <div className="flex justify-between">
                  <span>Assigned Role:</span>
                  <span className="capitalize">{rawRole}</span>
                </div>
                <div className="flex justify-between">
                  <span>Firebase Auth UID:</span>
                  <span className="font-mono text-[10px]">{appUser?.id}</span>
                </div>
              </div>
              <p className="text-xs text-amber-800 pt-1">
                To sign official report cards or institutional documents, please contact the Principal or
                School Administrator to request signature authorization.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        /* AUTHORIZED SIGNATORY PORTAL */
        <div className="space-y-6">
          {/* Eligibility Banner */}
          <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
              <div>
                <p className="font-semibold">Authorized Institutional Signatory</p>
                <p className="mt-0.5 text-emerald-800">
                  You are authorized by Administrator{" "}
                  <strong>{record.assignedByName || record.authorizedByName || "Principal"}</strong>.
                  Your signature is authorized for:{" "}
                  <strong>
                    {(record.authorizedDocumentTypes || []).map((d) => DOC_LABELS[d]).join(", ")}
                  </strong>
                  .
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-[9px] uppercase font-semibold shrink-0 ${
                isActive
                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                  : "bg-rose-100 text-rose-800 border-rose-300"
              }`}
            >
              {isActive ? "Active" : "Deactivated"}
            </Badge>
          </div>

          {!isActive && (
            <div className="flex items-center gap-2 p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>
                Your signature is temporarily deactivated by the Administrator. You cannot sign documents
                or update signatures until an Administrator reactivates your account.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* LEFT: Active Signature Overview */}
            <Card className="rounded-2xl">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold">Active Signature Profile</CardTitle>
                <CardDescription className="text-[11px]">
                  Immutable record linked to your verified Firebase Auth UID.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div
                  className="bg-white border rounded-xl flex items-center justify-center min-h-[120px] shadow-inner"
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
                  }}
                >
                  {record.imageUrl || record.signatureImageUrl ? (
                    <img
                      src={record.imageUrl || record.signatureImageUrl}
                      alt="Your official signature"
                      className="max-h-20 max-w-full object-contain"
                      style={{ imageRendering: "crisp-edges" }}
                    />
                  ) : (
                    <div className="flex flex-col items-center text-muted-foreground gap-1.5 p-3 text-center">
                      <ImageIcon className="w-7 h-7 opacity-30" />
                      <span className="text-xs font-medium text-amber-700">No signature image uploaded</span>
                      <span className="text-[10px] text-muted-foreground">Upload your handwritten signature image below</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2 text-xs divide-y">
                  <div className="flex items-center justify-between pb-1.5">
                    <span className="text-muted-foreground">Print Designation</span>
                    <span className="font-semibold text-foreground">{record.designation}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-muted-foreground">Active Version</span>
                    <span className="font-semibold">v{record.activeVersionNumber || 1}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-muted-foreground">Permitted Documents</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {(record.authorizedDocumentTypes || []).map((d) => (
                        <Badge key={d} variant="secondary" className="text-[9px] py-0 px-1.5">
                          {DOC_LABELS[d]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1.5">
                    <span className="text-muted-foreground">Authorized On</span>
                    <span>
                      {record.assignedAt || record.authorizedAt
                        ? new Date(record.assignedAt || record.authorizedAt).toLocaleDateString()
                        : "—"}
                    </span>
                  </div>
                </div>

                {/* Version History Collapsible */}
                {record.versions && record.versions.length > 0 && (
                  <div className="border-t pt-3 space-y-2">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowHistory((p) => !p)}
                    >
                      <History className="w-3.5 h-3.5" />
                      {showHistory ? "Hide" : "Show"} Version History ({record.versions.length})
                      {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    {showHistory && (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pt-1">
                        {[...record.versions].reverse().map((v) => (
                          <VersionRow key={v.versionId} version={v} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* RIGHT: Upload or Replace Form */}
            <Card className="rounded-2xl">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold">
                  {record.imageUrl ? "Replace Signature Image" : "Upload Signature Image"}
                </CardTitle>
                <CardDescription className="text-[11px]">
                  Uploading creates a new version (e.g. v{(record.versions?.length || 0) + 1}). Past finalized documents preserve their original signature snapshot.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSave} className="space-y-4">
                  {/* Designation */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Print Designation (on documents)</Label>
                    <Input
                      value={formDesignation}
                      onChange={(e) => setFormDesignation(e.target.value)}
                      placeholder="e.g. Class Teacher - Grade 9A"
                      required
                      disabled={saving || !isActive}
                    />
                  </div>

                  {/* File dropzone */}
                  <div className="space-y-2">
                    <Label className="text-xs">Signature Image</Label>
                    <div
                      className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
                        !isActive
                          ? "opacity-50 cursor-not-allowed bg-muted/20"
                          : selectedFile
                          ? "border-primary/40 bg-primary/5 cursor-pointer"
                          : "border-border hover:border-primary/40 hover:bg-muted/20 cursor-pointer"
                      }`}
                      onClick={() => !saving && isActive && fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!isActive) return;
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
                        disabled={saving || !isActive}
                      />
                      {selectedFile ? (
                        <div className="flex items-center justify-center gap-2 text-xs text-primary">
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="font-medium truncate max-w-[200px]">{selectedFile.name}</span>
                          <span className="text-muted-foreground">
                            ({(selectedFile.size / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-1 text-muted-foreground">
                          <Upload className="w-6 h-6 mx-auto opacity-40" />
                          <p className="text-xs font-medium">Click or drag & drop signature file</p>
                          <p className="text-[10px]">PNG (transparent recommended), JPG, WebP — max 2 MB</p>
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
                  {selectedFile && previewUrl && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Preview of new signature</Label>
                      <div
                        className="bg-white border rounded-xl flex items-center justify-center min-h-[80px] shadow-inner"
                        style={{
                          backgroundImage:
                            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
                        }}
                      >
                        <img
                          src={previewUrl}
                          alt="New signature preview"
                          className="max-h-16 max-w-full object-contain"
                          style={{ imageRendering: "crisp-edges" }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Progress */}
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

                  <Button
                    type="submit"
                    disabled={saving || !selectedFile || !isActive}
                    className="w-full gap-2"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {uploadProgress > 0 ? `Uploading ${uploadProgress}%…` : "Saving…"}
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        {record.imageUrl ? "Upload New Version" : "Save Signature"}
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

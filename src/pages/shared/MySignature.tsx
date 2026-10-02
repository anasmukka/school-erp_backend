/**
 * My Signature — Self-Service Signature Portal
 *
 * Accessible by: HOD, Class Teacher
 * Access: Each user manages ONLY their own signature.
 *
 * Features:
 * - Upload or replace their own signature image
 * - View current active signature
 * - See version history
 * - View which documents they are authorized to sign
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  SignatureRecord,
  SignatureVersion,
  SignatoryRole,
  OfficialDocumentType,
  DOCUMENT_SIGN_PERMISSIONS,
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
} from "lucide-react";
import { toast } from "sonner";

const DOC_LABELS: Record<OfficialDocumentType, string> = {
  report_card: "Report Cards",
  hall_ticket: "Hall Tickets",
  official_notice: "Official Notices",
  transfer_certificate: "Transfer Certificates",
};

const ROLE_DESIGNATION_DEFAULTS: Partial<Record<SignatoryRole, string>> = {
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

  const role = appUser?.role as SignatoryRole | undefined;

  // Only HOD and class_teacher should access this page
  const isAuthorized = role === "hod" || role === "class_teacher";

  const loadRecord = async () => {
    if (!appUser?.id || !isAuthorized) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rec = await getSignatureForUser(appUser.id);
      setRecord(rec);
      if (rec) {
        setFormDesignation(rec.designation);
        setPreviewUrl(rec.imageUrl || "");
      } else {
        setFormDesignation(ROLE_DESIGNATION_DEFAULTS[role as SignatoryRole] ?? "");
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
    if (!appUser || !role || !isAuthorized) return;

    if (!selectedFile) {
      toast.error("Please select a signature image file.");
      return;
    }

    if (!formDesignation.trim()) {
      toast.error("Please enter your document designation (e.g. Class Teacher — Grade 9A).");
      return;
    }

    setSaving(true);
    setUploadProgress(0);
    try {
      const nextVersion = (record?.versions?.length ?? 0) + 1;

      // Determine the permitted document types for this role
      const permittedDocs = (Object.keys(DOCUMENT_SIGN_PERMISSIONS) as OfficialDocumentType[]).filter(
        (d) => DOCUMENT_SIGN_PERMISSIONS[d].includes(role)
      );

      const uploadResult = await uploadSignatureImage(
        selectedFile,
        appUser.id,
        nextVersion,
        setUploadProgress
      );

      await publishSignatureVersion(
        {
          userId: appUser.id,
          role,
          name: appUser.name || appUser.email || "Staff Member",
          designation: formDesignation.trim(),
          authorizedDocumentTypes: permittedDocs,
          downloadUrl: uploadResult.downloadUrl,
          storagePath: uploadResult.storagePath,
          mimeType: uploadResult.mimeType,
          fileSizeBytes: uploadResult.fileSizeBytes,
        },
        { uid: appUser.id, name: appUser.name || appUser.email || "Staff", role }
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

  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3 text-center">
        <AlertCircle className="w-12 h-12 text-rose-400" />
        <h2 className="text-lg font-bold text-foreground">Access Denied</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Only HOD and Class Teacher roles can access the signature portal.
        </p>
      </div>
    );
  }

  const permittedDocs = (Object.keys(DOCUMENT_SIGN_PERMISSIONS) as OfficialDocumentType[]).filter(
    (d) => DOCUMENT_SIGN_PERMISSIONS[d].includes(role!)
  );

  const activeVersion = record?.versions?.find(
    (v) => v.versionId === record.activeVersionId
  ) ?? record?.versions?.find((v) => v.isCurrent) ?? null;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 text-primary rounded-xl">
          <FileSignature className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Signature</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload and manage your official institutional signature image.
          </p>
        </div>
      </div>

      {/* Role info notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
        <div>
          <p className="font-semibold">Your Signature Permissions</p>
          <p className="mt-0.5 text-blue-700">
            As a <strong>{role === "hod" ? "Head of Department" : "Class Teacher"}</strong>, your
            signature will appear on:{" "}
            {permittedDocs.map((d) => DOC_LABELS[d]).join(", ")}.
          </p>
          <p className="mt-1 text-blue-600">
            You can only manage your own signature. Contact the Admin if there is an issue.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_1fr]">
          {/* LEFT: Current signature status */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-sm font-bold">Current Active Signature</CardTitle>
              {record && (
                <CardDescription className="text-[11px]">
                  Version {record.activeVersionNumber} •{" "}
                  {record.updatedAt
                    ? `Updated ${new Date(record.updatedAt).toLocaleDateString()}`
                    : "Just uploaded"}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Preview box */}
              <div
                className="bg-white border rounded-xl flex items-center justify-center min-h-[120px] shadow-inner"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
                }}
              >
                {record?.imageUrl ? (
                  <img
                    src={record.imageUrl}
                    alt="Your signature"
                    className="max-h-20 max-w-full object-contain"
                    style={{ imageRendering: "crisp-edges" }}
                  />
                ) : (
                  <div className="flex flex-col items-center text-muted-foreground gap-1.5">
                    <ImageIcon className="w-8 h-8 opacity-30" />
                    <span className="text-xs opacity-60">No signature uploaded yet</span>
                  </div>
                )}
              </div>

              {record ? (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        record.status === "active"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {record.status}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Designation</span>
                    <span className="font-medium">{record.designation}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Version</span>
                    <span className="font-medium">v{record.activeVersionNumber}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Authorized for</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {record.authorizedDocumentTypes.map((d) => (
                        <Badge key={d} variant="secondary" className="text-[9px] py-0 px-1.5">
                          {DOC_LABELS[d as OfficialDocumentType]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  No signature on file. Upload one to enable document signing.
                </div>
              )}

              {/* Version history */}
              {record && record.versions && record.versions.length > 0 && (
                <div className="border-t pt-3 space-y-2">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowHistory((p) => !p)}
                  >
                    <History className="w-3.5 h-3.5" />
                    {showHistory ? "Hide" : "Show"} version history ({record.versions.length})
                    {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  {showHistory && (
                    <div className="space-y-1.5">
                      {[...record.versions].reverse().map((v) => (
                        <VersionRow key={v.versionId} version={v} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* RIGHT: Upload form */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-sm font-bold">
                {record ? "Upload New Version" : "Upload Your Signature"}
              </CardTitle>
              <CardDescription className="text-[11px]">
                {record
                  ? "Each upload creates a new version. Old finalized documents keep their original signature."
                  : "Upload a clear PNG or JPG of your handwritten signature."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4">
                {/* Designation */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Document Designation</Label>
                  <Input
                    value={formDesignation}
                    onChange={(e) => setFormDesignation(e.target.value)}
                    placeholder="e.g. Class Teacher — Grade 9A, Head of Department — Science"
                    required
                    disabled={saving}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    This label appears beneath your signature on printed documents.
                  </p>
                </div>

                {/* File drop zone */}
                <div className="space-y-2">
                  <Label className="text-xs">Signature Image</Label>
                  <div
                    className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                      selectedFile
                        ? "border-primary/40 bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/20"
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
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="font-medium truncate max-w-[200px]">
                          {selectedFile.name}
                        </span>
                        <span className="text-muted-foreground">
                          ({(selectedFile.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1 text-muted-foreground">
                        <Upload className="w-6 h-6 mx-auto opacity-40" />
                        <p className="text-xs font-medium">Click or drag & drop</p>
                        <p className="text-[10px]">PNG (recommended), JPG, WebP — max 2 MB</p>
                        <p className="text-[10px] text-blue-600">
                          Tip: Use a white paper, sign with a dark pen, scan or photograph clearly.
                          PNG with transparent background works best.
                        </p>
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

                {/* Preview of newly selected file */}
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
                    <p className="text-[10px] text-muted-foreground text-center">
                      Transparent backgrounds are preserved. Aspect ratio is maintained.
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

                <Button type="submit" disabled={saving || !selectedFile} className="w-full gap-2">
                  {saving ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {uploadProgress > 0 ? `Uploading ${uploadProgress}%…` : "Saving…"}
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      {record ? "Upload New Version" : "Save Signature"}
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, useMemo } from "react";
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
  grantSignatureEligibility,
  revokeSignatureEligibility,
  updateUserSignaturePermissions,
  uploadSignatureImage,
  validateSignatureImageFile,
  DEFAULT_SIGNATORY_CONFIGS,
  sanitizeSignatoryConfig,
} from "@/lib/signatures";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
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
  Search,
  Users,
  ShieldAlert,
  UserCheck,
  UserX,
  Edit3,
} from "lucide-react";
import { toast } from "sonner";
import { TableSkeleton } from "@/components/common/Skeletons";

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
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='10' height='10' fill='%23f3f4f6'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f3f4f6'/%3E%3C/svg%3E\")",
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`Signature of ${name}`}
          className="max-h-16 max-w-full object-contain"
          style={{ imageRendering: "crisp-edges" }}
        />
      ) : (
        <div className="flex flex-col items-center text-muted-foreground gap-1 p-2 text-center">
          <ImageIcon className="w-5 h-5 opacity-40" />
          <span className="text-[11px] font-medium text-amber-600">Pending Signature Image</span>
          <span className="text-[10px] text-muted-foreground">Authorized staff can upload via /my-signature</span>
        </div>
      )}
    </div>
  );
}

interface StaffCandidate {
  uid: string;
  name: string;
  email: string;
  erpRole: string;
  staffDocId?: string;
}

export default function AdminSignatures() {
  const { appUser } = useAuth();

  const [signatures, setSignatures] = useState<SignatureRecord[]>([]);
  const [configs, setConfigs] = useState<DocumentSignatoryConfig[]>([]);
  const [staffCandidates, setStaffCandidates] = useState<StaffCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [staffSearchQuery, setStaffSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // Authorization / Modal state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [selectedStaffUid, setSelectedStaffUid] = useState<string>("");
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formErpRole, setFormErpRole] = useState("teacher");
  const [formRole, setFormRole] = useState<SignatoryRole>("class_teacher");
  const [formDesignation, setFormDesignation] = useState("Class Teacher");
  const [formDocs, setFormDocs] = useState<OfficialDocumentType[]>(["report_card"]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit Permissions Dialog
  const [editPermissionsOpen, setEditPermissionsOpen] = useState(false);
  const [editingSig, setEditingSig] = useState<SignatureRecord | null>(null);
  const [editDocs, setEditDocs] = useState<OfficialDocumentType[]>([]);
  const [editDesignation, setEditDesignation] = useState("");

  // Audit modal
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

      // Load staff candidates from users and teachers collections
      const staffMap = new Map<string, StaffCandidate>();

      try {
        const usersSnap = await getDocs(collection(db, "users"));
        usersSnap.docs.forEach((d) => {
          const u = d.data();
          const r = (u.role || "").toLowerCase();
          if (["admin", "hod", "teacher"].includes(r)) {
            staffMap.set(d.id, {
              uid: d.id,
              name: u.name || u.displayName || u.email || "Staff Member",
              email: u.email || "",
              erpRole: r,
            });
          }
        });
      } catch (err) {
        console.warn("Could not fetch users collection for staff directory:", err);
      }

      try {
        const teachersSnap = await getDocs(collection(db, "teachers"));
        teachersSnap.docs.forEach((d) => {
          const t = d.data();
          const uid = t.uid || d.id;
          if (uid) {
            const existing = staffMap.get(uid);
            staffMap.set(uid, {
              uid,
              name: t.name || existing?.name || "Teacher",
              email: t.email || existing?.email || "",
              erpRole: existing?.erpRole || "teacher",
              staffDocId: d.id,
            });
          }
        });
      } catch (err) {
        console.warn("Could not fetch teachers collection:", err);
      }

      setStaffCandidates(Array.from(staffMap.values()));
    } catch (err: any) {
      toast.error("Failed to load signatures: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Filtered signatures
  const filteredSignatures = useMemo(() => {
    return signatures.filter((s) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.displayName && s.displayName.toLowerCase().includes(q)) ||
        (s.email && s.email.toLowerCase().includes(q)) ||
        (s.designation && s.designation.toLowerCase().includes(q)) ||
        (s.userId && s.userId.toLowerCase().includes(q));

      const matchesRole = roleFilter === "all" || s.role === roleFilter;

      return matchesSearch && matchesRole;
    });
  }, [signatures, searchQuery, roleFilter]);

  // Filtered staff candidates
  const filteredStaff = useMemo(() => {
    const q = staffSearchQuery.toLowerCase().trim();
    return staffCandidates.filter((st) => {
      if (!q) return true;
      return (
        st.name.toLowerCase().includes(q) ||
        st.email.toLowerCase().includes(q) ||
        st.erpRole.toLowerCase().includes(q) ||
        st.uid.toLowerCase().includes(q)
      );
    });
  }, [staffCandidates, staffSearchQuery]);

  const openAuthorizeModalForStaff = (staff: StaffCandidate) => {
    setSelectedStaffUid(staff.uid);
    setFormName(staff.name);
    setFormEmail(staff.email);
    setFormErpRole(staff.erpRole);

    let sigRole: SignatoryRole = "class_teacher";
    let defaultDesig = "Class Teacher";
    if (staff.erpRole === "admin") {
      sigRole = "admin";
      defaultDesig = "Principal";
    } else if (staff.erpRole === "hod") {
      sigRole = "hod";
      defaultDesig = "Head of Department";
    }

    setFormRole(sigRole);
    setFormDesignation(defaultDesig);
    setFormDocs(getPermittedDocs(sigRole));
    setSelectedFile(null);
    setPreviewUrl("");
    setFileError("");
    setUploadProgress(0);
    setAuthModalOpen(true);
  };

  const openUploadForExisting = (sig: SignatureRecord) => {
    setSelectedStaffUid(sig.userId);
    setFormName(sig.name || sig.displayName || "");
    setFormEmail(sig.email || "");
    setFormErpRole(sig.currentRole || sig.role);
    setFormRole(sig.role);
    setFormDesignation(sig.designation);
    setFormDocs(sig.authorizedDocumentTypes);
    setSelectedFile(null);
    setPreviewUrl(sig.imageUrl || "");
    setFileError("");
    setUploadProgress(0);
    setAuthModalOpen(true);
  };

  const openEditPermissions = (sig: SignatureRecord) => {
    setEditingSig(sig);
    setEditDesignation(sig.designation);
    setEditDocs(sig.authorizedDocumentTypes || []);
    setEditPermissionsOpen(true);
  };

  const handleRoleChange = (role: SignatoryRole) => {
    setFormRole(role);
    if (role === "admin") setFormDesignation("Principal");
    else if (role === "hod") setFormDesignation("Head of Department");
    else setFormDesignation("Class Teacher");
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

  const handleEditDocToggle = (docType: OfficialDocumentType, checked: boolean) => {
    if (checked) {
      setEditDocs((prev) => [...prev, docType]);
    } else {
      setEditDocs((prev) => prev.filter((d) => d !== docType));
    }
  };

  const handleSaveAuthorization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser || appUser.role !== "admin") {
      toast.error("Unauthorized: Admin authorization required.");
      return;
    }

    if (!selectedStaffUid) {
      toast.error("Please select a valid staff member account.");
      return;
    }

    if (!formName.trim()) {
      toast.error("Please enter the signatory's full name.");
      return;
    }

    if (formDocs.length === 0) {
      toast.error("Please select at least one authorized document type.");
      return;
    }

    setSaving(true);
    setUploadProgress(0);
    try {
      const existingSig = signatures.find((s) => s.userId === selectedStaffUid);
      let downloadUrl = existingSig?.imageUrl || "";
      let storagePath = existingSig?.signatureStorageKey || "";

      // If a file was selected, upload it
      if (selectedFile) {
        const nextVersion = (existingSig?.versions?.length ?? 0) + 1;
        const uploadResult = await uploadSignatureImage(
          selectedFile,
          selectedStaffUid,
          nextVersion,
          setUploadProgress
        );
        downloadUrl = uploadResult.downloadUrl;
        storagePath = uploadResult.storagePath;

        // Also publish version record
        await publishSignatureVersion(
          {
            userId: selectedStaffUid,
            role: formRole,
            name: formName.trim(),
            designation: formDesignation.trim() || (formRole === "admin" ? "Principal" : "Faculty"),
            authorizedDocumentTypes: formDocs,
            downloadUrl,
            storagePath,
            mimeType: uploadResult.mimeType,
            fileSizeBytes: uploadResult.fileSizeBytes,
          },
          { uid: appUser.id, name: appUser.name, role: appUser.role }
        );
      }

      // Grant / refresh authoritative eligibility
      await grantSignatureEligibility(
        {
          userId: selectedStaffUid,
          displayName: formName.trim(),
          email: formEmail,
          currentRole: formErpRole,
          role: formRole,
          designation: formDesignation.trim() || (formRole === "admin" ? "Principal" : "Faculty"),
          authorizedDocumentTypes: formDocs,
          imageUrl: downloadUrl,
          storagePath,
        },
        { uid: appUser.id, name: appUser.name, role: appUser.role }
      );

      toast.success(
        existingSig
          ? `Updated signature authorization for ${formName}.`
          : `Signature eligibility granted to ${formName}.`
      );
      setAuthModalOpen(false);
      void loadData();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to authorize signature.");
    } finally {
      setSaving(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!appUser || appUser.role !== "admin" || !editingSig) return;

    if (editDocs.length === 0) {
      toast.error("Please select at least one authorized document type.");
      return;
    }

    setSaving(true);
    try {
      await updateUserSignaturePermissions(
        editingSig.userId,
        editDocs,
        { uid: appUser.id, name: appUser.name, role: appUser.role }
      );

      if (editDesignation.trim() !== editingSig.designation) {
        const { updateSignatureMetadata } = await import("@/lib/signatures");
        await updateSignatureMetadata(
          editingSig.userId,
          { designation: editDesignation.trim() },
          { uid: appUser.id, name: appUser.name, role: appUser.role }
        );
      }

      toast.success(`Updated permissions for ${editingSig.name || editingSig.displayName}.`);
      setEditPermissionsOpen(false);
      void loadData();
    } catch (err: any) {
      toast.error("Failed to update permissions: " + err.message);
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
        `Signature for ${sig.name || sig.displayName} ${newStatus === "active" ? "activated" : "deactivated"}.`
      );
      void loadData();
    } catch (err: any) {
      toast.error("Failed to update status: " + err.message);
    }
  };

  const handleToggleEligibility = async (sig: SignatureRecord) => {
    if (!appUser || appUser.role !== "admin") return;
    try {
      if (sig.isEligible) {
        await revokeSignatureEligibility(
          sig.userId,
          "Revoked by Administrator in Signature Management",
          { uid: appUser.id, name: appUser.name, role: appUser.role }
        );
        toast.success(`Signature eligibility revoked for ${sig.name || sig.displayName}.`);
      } else {
        await grantSignatureEligibility(
          {
            userId: sig.userId,
            displayName: sig.name || sig.displayName || "Staff Member",
            email: sig.email,
            currentRole: sig.currentRole || sig.role,
            role: sig.role,
            designation: sig.designation,
            authorizedDocumentTypes: sig.authorizedDocumentTypes || ["report_card"],
            imageUrl: sig.imageUrl,
          },
          { uid: appUser.id, name: appUser.name, role: appUser.role }
        );
        toast.success(`Signature eligibility restored for ${sig.name || sig.displayName}.`);
      }
      void loadData();
    } catch (err: any) {
      toast.error("Failed to update eligibility: " + err.message);
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
                Admin-authorized, user-linked e-signatures for official report cards, hall tickets, and notices.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              if (staffCandidates.length > 0) {
                openAuthorizeModalForStaff(staffCandidates[0]);
              } else {
                toast.info("Loading staff directory…");
              }
            }}
            className="gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" /> Authorize Staff Signatory
          </Button>
        </div>
      </div>

      {/* Role Access Notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
        <div>
          <p className="font-semibold">User-Linked, Document-Specific Authorization</p>
          <p className="mt-0.5 text-blue-700">
            Signatures are linked to verified Firebase Auth UIDs. Staff members do not automatically receive
            signing authority merely by their role. The Administrator explicitly grants eligibility and configures permitted document types.
          </p>
        </div>
      </div>

      <Tabs defaultValue="signatures" className="space-y-4">
        <TabsList className="bg-muted/60 p-1 rounded-xl">
          <TabsTrigger value="signatures" className="gap-2 rounded-lg text-xs">
            <PenTool className="w-3.5 h-3.5" /> Authorized Signatories ({signatures.length})
          </TabsTrigger>
          <TabsTrigger value="directory" className="gap-2 rounded-lg text-xs">
            <Users className="w-3.5 h-3.5" /> Staff Directory ({staffCandidates.length})
          </TabsTrigger>
          <TabsTrigger value="matrix" className="gap-2 rounded-lg text-xs">
            <Settings2 className="w-3.5 h-3.5" /> Document Permission Matrix
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2 rounded-lg text-xs">
            <History className="w-3.5 h-3.5" /> Central Audit Trail
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: AUTHORIZED SIGNATORIES */}
        <TabsContent value="signatures" className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-center gap-3 bg-card p-3 rounded-xl border">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search signatories by name, email, designation, or UID…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="h-9 text-xs rounded-lg border border-input bg-background px-3 py-1 text-foreground"
              >
                <option value="all">All Roles</option>
                <option value="admin">Admin (Principal)</option>
                <option value="hod">HOD</option>
                <option value="class_teacher">Class Teacher</option>
              </select>
            </div>
          </div>

          {loading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : filteredSignatures.length === 0 ? (
            <Card className="rounded-2xl p-12 text-center text-muted-foreground border">
              <FileSignature className="w-12 h-12 mx-auto text-primary/40 mb-3" />
              <h3 className="text-base font-bold text-foreground">No Authorized Signatories Found</h3>
              <p className="text-xs mt-1 max-w-sm mx-auto">
                {searchQuery || roleFilter !== "all"
                  ? "No signatories match your search criteria."
                  : "Authorize your first official signatory to enable secure document finalization."}
              </p>
              {staffCandidates.length > 0 && (
                <Button
                  onClick={() => openAuthorizeModalForStaff(staffCandidates[0])}
                  className="mt-4 gap-2 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" /> Authorize First Signatory
                </Button>
              )}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredSignatures.map((sig) => {
                const isEligible = sig.isEligible;
                const isActive = sig.status === "active" && sig.isActive !== false;

                return (
                  <Card
                    key={sig.id}
                    className={`rounded-2xl overflow-hidden border transition-all ${
                      isActive && isEligible
                        ? "border-border shadow-sm hover:shadow-md"
                        : "border-border/60 bg-muted/20 opacity-80"
                    }`}
                  >
                    <CardHeader className="pb-3 border-b bg-muted/10">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          <CardTitle className="text-sm font-bold flex items-center gap-1.5 truncate">
                            {sig.name || sig.displayName}
                            {sig.role === "admin" && (
                              <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                            )}
                          </CardTitle>
                          {sig.email && (
                            <p className="text-[11px] text-muted-foreground truncate">{sig.email}</p>
                          )}
                          <div className="space-y-0.5 text-xs text-muted-foreground pt-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-foreground/80">Designation:</span>
                              <span className="truncate">{sig.designation}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-foreground/80">Role:</span>
                              <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                                {ROLE_LABELS[sig.role] ?? sig.role}
                              </Badge>
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

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[9px] uppercase font-semibold ${
                              isEligible
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`}
                          >
                            {isEligible ? "Eligible" : "Revoked"}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[9px] uppercase font-semibold ${
                              isActive
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-zinc-100 text-zinc-600 border-zinc-200"
                            }`}
                          >
                            {isActive ? "Active" : "Deactivated"}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 space-y-3">
                      {/* Signature Preview */}
                      <SignatureImageBox imageUrl={sig.imageUrl || sig.signatureImageUrl} name={sig.name || sig.displayName || "Staff"} />

                      {/* Authorized Documents */}
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground font-medium">
                          Authorized Document Types:
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

                      {/* Footer info: Authorizer & Timestamp */}
                      <div className="text-[10px] text-muted-foreground border-t pt-2 space-y-0.5">
                        <p>
                          Authorized by:{" "}
                          <span className="font-medium text-foreground">
                            {sig.assignedByName || sig.authorizedByName || "Administrator"}
                          </span>
                        </p>
                        <p>
                          UID: <span className="font-mono text-[9px]">{sig.userId}</span>
                        </p>
                        <p>
                          Last Updated:{" "}
                          {sig.updatedAt ? new Date(sig.updatedAt).toLocaleDateString() : "—"}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-2 pt-2 border-t">
                        <div className="flex items-center justify-between gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditPermissions(sig)}
                            className="h-7 text-xs px-2 gap-1"
                          >
                            <Edit3 className="w-3 h-3" /> Permissions
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openUploadForExisting(sig)}
                            className="h-7 text-xs px-2 gap-1"
                          >
                            <Upload className="w-3 h-3" /> Image
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAuditSig(sig);
                              setAuditModalOpen(true);
                            }}
                            className="h-7 text-xs px-2 text-muted-foreground"
                          >
                            <History className="w-3 h-3 mr-1" /> Log
                          </Button>
                        </div>

                        <div className="flex items-center justify-between gap-1.5 pt-1 border-t">
                          <Button
                            variant={isEligible ? "ghost" : "outline"}
                            size="sm"
                            onClick={() => handleToggleEligibility(sig)}
                            className={`h-7 text-xs px-2 ${
                              isEligible
                                ? "text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                : "text-emerald-700 hover:bg-emerald-50"
                            }`}
                          >
                            {isEligible ? (
                              <>
                                <UserX className="w-3 h-3 mr-1" /> Revoke
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-3 h-3 mr-1" /> Restore
                              </>
                            )}
                          </Button>

                          <Button
                            variant={isActive ? "secondary" : "default"}
                            size="sm"
                            onClick={() => handleToggleStatus(sig)}
                            className="h-7 text-xs px-2.5"
                          >
                            {isActive ? "Deactivate" : "Activate"}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* TAB 2: STAFF DIRECTORY */}
        <TabsContent value="directory" className="space-y-4">
          <Card className="rounded-2xl">
            <CardHeader className="pb-3 border-b">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold">ERP Staff Account Directory</CardTitle>
                  <CardDescription className="text-xs">
                    Search authenticated accounts to grant or review institutional signature eligibility.
                  </CardDescription>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search staff by name or email…"
                    value={staffSearchQuery}
                    onChange={(e) => setStaffSearchQuery(e.target.value)}
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 border-b text-muted-foreground text-left font-medium">
                    <tr>
                      <th className="p-3">Staff Name</th>
                      <th className="p-3">Email</th>
                      <th className="p-3">ERP Role</th>
                      <th className="p-3">Signature Status</th>
                      <th className="p-3">Allowed Documents</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredStaff.map((staff) => {
                      const sig = signatures.find((s) => s.userId === staff.uid);
                      const isEligible = sig?.isEligible;
                      const hasImage = !!(sig?.imageUrl || sig?.signatureImageUrl);

                      return (
                        <tr key={staff.uid} className="hover:bg-muted/10 transition-colors">
                          <td className="p-3 font-medium">
                            <div className="flex items-center gap-1.5">
                              <span>{staff.name}</span>
                              {staff.erpRole === "admin" && (
                                <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                              )}
                            </div>
                            <span className="font-mono text-[9px] text-muted-foreground">
                              UID: {staff.uid.slice(0, 10)}…
                            </span>
                          </td>
                          <td className="p-3 text-muted-foreground">{staff.email || "—"}</td>
                          <td className="p-3">
                            <Badge variant="outline" className="text-[10px] uppercase font-mono">
                              {staff.erpRole}
                            </Badge>
                          </td>
                          <td className="p-3">
                            {sig ? (
                              isEligible ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {hasImage ? `Active (v${sig.activeVersionNumber || 1})` : "Pending Image"}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 font-medium">
                                  <XCircle className="w-3.5 h-3.5" /> Revoked
                                </span>
                              )
                            ) : (
                              <span className="text-[11px] text-muted-foreground">Not Authorized</span>
                            )}
                          </td>
                          <td className="p-3">
                            {sig && sig.authorizedDocumentTypes?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {sig.authorizedDocumentTypes.map((dt) => (
                                  <Badge key={dt} variant="secondary" className="text-[9px] py-0 px-1">
                                    {DOC_LABELS[dt as OfficialDocumentType] ?? dt}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {sig ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openUploadForExisting(sig)}
                                className="h-7 text-xs px-2.5 gap-1"
                              >
                                Manage
                              </Button>
                            ) : (
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => openAuthorizeModalForStaff(staff)}
                                className="h-7 text-xs px-2.5 gap-1"
                              >
                                <Plus className="w-3 h-3" /> Authorize
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredStaff.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-muted-foreground">
                          No staff accounts found matching your query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: DOCUMENT PERMISSION MATRIX */}
        <TabsContent value="matrix" className="space-y-4">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base font-bold">Document Signature Permission Matrix</CardTitle>
              <CardDescription className="text-xs">
                Authoritative institutional policies controlling which signatory roles apply to each document type.
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
                      const hasActiveSig = signatures.some(
                        (s) => s.role === slot.role && s.status === "active" && s.isEligible && (s.imageUrl || s.signatureImageUrl)
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
                            {hasActiveSig ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <XCircle className="w-3 h-3 text-amber-500" />
                            )}
                            <span className={hasActiveSig ? "text-emerald-700 font-medium" : "text-amber-700 font-medium"}>
                              {hasActiveSig ? "Active signatory configured" : "Pending signatory setup"}
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

        {/* TAB 4: AUDIT TRAIL */}
        <TabsContent value="audit" className="space-y-4">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base font-bold">Central Signature Audit Trail</CardTitle>
              <CardDescription className="text-xs">
                Immutable audit trail tracking all authorization grants, revocations, and version updates.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {signatures
                  .flatMap((s) =>
                    (s.history || []).map((h) => ({
                      ...h,
                      signatoryName: s.name || s.displayName,
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
                          Actor: {entry.performedByName} ({entry.performedByUid})
                        </p>
                      </div>
                    </div>
                  ))}
                {signatures.every((s) => (s.history || []).length === 0) && (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No signature audit events recorded yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== AUTHORIZATION / UPLOAD MODAL ===== */}
      <Dialog open={authModalOpen} onOpenChange={setAuthModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Authorize E-Signature: {formName}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure signature authorization, permitted document types, and upload an official signature.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveAuthorization} className="space-y-4 py-1">
            {/* Account Info (Read-only verified linkage) */}
            <div className="p-3 rounded-xl bg-muted/20 border space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Linked User:</span>
                <span className="font-semibold">{formName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Account Email:</span>
                <span>{formEmail || "—"}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Firebase UID:</span>
                <span className="font-mono text-[10px]">{selectedStaffUid}</span>
              </div>
            </div>

            {/* Functional Signatory Role */}
            <div className="space-y-1.5">
              <Label className="text-xs">Signatory Role</Label>
              <select
                value={formRole}
                onChange={(e) => handleRoleChange(e.target.value as SignatoryRole)}
                className="w-full text-xs rounded-lg border border-input bg-background p-2.5"
                disabled={saving}
              >
                <option value="admin">Admin (Designation: Principal)</option>
                <option value="hod">HOD (Head of Department)</option>
                <option value="class_teacher">Class Teacher</option>
              </select>
            </div>

            {/* Designation */}
            <div className="space-y-1.5">
              <Label className="text-xs">Print Designation (shown on documents)</Label>
              <Input
                value={formDesignation}
                onChange={(e) => setFormDesignation(e.target.value)}
                placeholder="e.g. Principal, Head of Department, Class Teacher"
                disabled={saving}
                required
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

            {/* File Upload (Optional: staff can also upload themselves via /my-signature) */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Signature Image (Optional at setup)</Label>
                <span className="text-[10px] text-muted-foreground">
                  Can be uploaded now or later via /my-signature
                </span>
              </div>
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
                    <p className="text-xs font-medium">Click or drag to upload signature image</p>
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
            {previewUrl && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                <SignatureImageBox imageUrl={previewUrl} name={formName} className="min-h-[80px]" />
              </div>
            )}

            {/* Upload progress */}
            {saving && uploadProgress > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Uploading signature…</span>
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
                onClick={() => setAuthModalOpen(false)}
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
                ) : (
                  "Save Authorization"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== EDIT PERMISSIONS MODAL ===== */}
      <Dialog open={editPermissionsOpen} onOpenChange={setEditPermissionsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Edit Signatory Permissions: {editingSig?.name || editingSig?.displayName}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update authorized document types and print designation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Print Designation</Label>
              <Input
                value={editDesignation}
                onChange={(e) => setEditDesignation(e.target.value)}
                placeholder="e.g. Principal, Head of Department"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Authorized Document Types</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(DOC_LABELS) as OfficialDocumentType[]).map((dt) => {
                  const permitted = editingSig ? DOCUMENT_SIGN_PERMISSIONS[dt]?.includes(editingSig.role) : false;
                  const checked = editDocs.includes(dt);
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
                        onChange={(e) => handleEditDocToggle(dt, e.target.checked)}
                        className="rounded border-input"
                      />
                      <span className={permitted ? "" : "line-through text-muted-foreground"}>
                        {DOC_LABELS[dt]}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPermissionsOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSavePermissions} disabled={saving}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== AUDIT HISTORY MODAL ===== */}
      <Dialog open={auditModalOpen} onOpenChange={setAuditModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Audit History: {auditSig?.name || auditSig?.displayName}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Complete log of authorizations, version uploads, and status transitions.
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
                  By: {entry.performedByName} ({entry.performedByUid})
                </p>
              </div>
            ))}
            {(auditSig?.history ?? []).length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-6">No history recorded yet.</p>
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

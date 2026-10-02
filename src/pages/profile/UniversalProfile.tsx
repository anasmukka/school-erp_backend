import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import {
  User, ShieldCheck, GraduationCap, Users, Printer, Settings,
  Edit3, Clock, CheckCircle2, XCircle, AlertCircle, ChevronDown,
  Upload, FileText, Phone, Mail, MapPin, Calendar, BookOpen,
  BadgeCheck, Info, ArrowLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchStaffProfile, fetchStudentProfile, fetchParentProfile, StaffProfile, StudentProfile, ParentProfile } from "@/lib/profile";
import {
  submitProfileChangeRequest,
  getMyProfileChangeRequests,
  cancelProfileChangeRequest,
} from "@/lib/profileChangeRequests";
import { uploadPrintingDocument } from "@/lib/storage";
import type { ProfileChangeRequestV2, ProfileChangeRequestField, Role } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

// ============================================================
// Field options per role
// ============================================================
const STUDENT_FIELDS: { value: ProfileChangeRequestField; label: string }[] = [
  { value: "name", label: "Full Name" },
  { value: "DOB", label: "Date of Birth" },
  { value: "gender", label: "Gender" },
  { value: "address", label: "Address" },
  { value: "phone", label: "Phone Number" },
  { value: "email", label: "Email Address" },
  { value: "fatherName", label: "Father's Name" },
  { value: "motherName", label: "Mother's Name" },
  { value: "guardianInfo", label: "Guardian Information" },
];

const STAFF_FIELDS: { value: ProfileChangeRequestField; label: string }[] = [
  { value: "name", label: "Full Name" },
  { value: "email", label: "Email Address" },
  { value: "staffPhone", label: "Phone Number" },
  { value: "staffAddress", label: "Address" },
  { value: "designation", label: "Designation" },
  { value: "department", label: "Department" },
];

const PARENT_FIELDS: { value: ProfileChangeRequestField; label: string }[] = [
  { value: "parentName", label: "Full Name" },
  { value: "parentPhone", label: "Phone Number" },
  { value: "parentEmail", label: "Email Address" },
  { value: "parentAddress", label: "Address" },
];

function getFieldsForRole(role: Role) {
  if (role === "student") return STUDENT_FIELDS;
  if (role === "hod" || role === "teacher" || role === "accountant" || role === "printing" || role === "operations" || role === "admin") return STAFF_FIELDS;
  return PARENT_FIELDS;
}

// ============================================================
// Status badge helper
// ============================================================
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

// ============================================================
// Profile avatar
// ============================================================
function ProfileAvatar({ name, photo, size = "lg" }: { name: string; photo?: string; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-24 w-24 text-3xl" : size === "md" ? "h-16 w-16 text-xl" : "h-10 w-10 text-sm";
  if (photo) {
    return (
      <div className={`${sizeClass} rounded-full overflow-hidden border-4 border-white shadow-md shrink-0`}>
        <img src={photo} alt={name} className="w-full h-full object-cover" />
      </div>
    );
  }
  const initials = name.split(" ").slice(0, 2).map(p => p[0]).join("").toUpperCase();
  return (
    <div className={`${sizeClass} rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center border-4 border-white shadow-md font-bold text-white shrink-0`}>
      {initials || <User size={size === 'lg' ? 36 : 20} />}
    </div>
  );
}

// ============================================================
// Info row component
// ============================================================
function InfoRow({ icon, label, value, fallback = "Not available" }: { icon: React.ReactNode; label: string; value?: string | null; fallback?: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground font-medium mb-0.5">{label}</p>
        <p className={`text-sm font-medium ${!value ? "text-muted-foreground italic" : "text-foreground"}`}>
          {value || fallback}
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Role label helper
// ============================================================
function getRoleDisplayLabel(role: Role): string {
  const map: Record<Role, string> = {
    admin: "Administrator / Principal",
    hod: "Section Head (HOD)",
    teacher: "Teacher",
    student: "Student",
    accountant: "Accounts Staff",
    printing: "Printing Department",
    operations: "Operations Staff",
  };
  return map[role] || role;
}

function getRoleIcon(role: Role) {
  if (role === "admin") return <ShieldCheck size={18} className="text-indigo-600" />;
  if (role === "student") return <GraduationCap size={18} className="text-amber-600" />;
  if (role === "hod" || role === "teacher") return <BookOpen size={18} className="text-emerald-600" />;
  if (role === "accountant") return <BadgeCheck size={18} className="text-teal-600" />;
  if (role === "printing") return <Printer size={18} className="text-cyan-600" />;
  if (role === "operations") return <Settings size={18} className="text-orange-600" />;
  return <User size={18} className="text-slate-600" />;
}

// ============================================================
// Change Request Form
// ============================================================
function ChangeRequestDialog({
  open,
  onClose,
  role,
  appUserId,
  appUserName,
  appUserRole,
  entityId,
  entityType,
  profileData,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  appUserId: string;
  appUserName: string;
  appUserRole: Role;
  entityId: string;
  entityType: ProfileChangeRequestV2["entityType"];
  profileData: Record<string, string | undefined>;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const fields = getFieldsForRole(role);
  const [selectedField, setSelectedField] = useState<ProfileChangeRequestField | "">("");
  const [requestedValue, setRequestedValue] = useState("");
  const [reason, setReason] = useState("");
  const [supportFile, setSupportFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const selectedFieldObj = fields.find(f => f.value === selectedField);
  const originalValue = selectedField ? (profileData[selectedField] || profileData[selectedField.replace("parent", "").toLowerCase()] || "") : "";

  const handleSubmit = async () => {
    if (!selectedField || !requestedValue.trim() || !reason.trim()) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      let supportingDocUrl: string | undefined;
      let supportingDocPath: string | undefined;
      let supportingDocName: string | undefined;

      if (supportFile) {
        setUploading(true);
        const uploaded = await uploadPrintingDocument(supportFile, "profile-change-requests", (p) => setUploadProgress(p));
        supportingDocUrl = uploaded.downloadUrl;
        supportingDocPath = uploaded.storagePath;
        supportingDocName = uploaded.fileName;
        setUploading(false);
      }

      await submitProfileChangeRequest({
        userId: appUserId,
        userName: appUserName,
        userRole: appUserRole,
        entityType,
        entityId,
        field: selectedField as ProfileChangeRequestField,
        fieldLabel: selectedFieldObj?.label || selectedField,
        originalValue,
        requestedValue: requestedValue.trim(),
        reason: reason.trim(),
        supportingDocUrl,
        supportingDocPath,
        supportingDocName,
      });

      toast({ title: "Change request submitted", description: "Your request is pending admin review." });
      onSubmitted();
      onClose();
    } catch (e: any) {
      toast({ title: "Failed to submit request", description: e.message || "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 size={18} />
            Request Information Change
          </DialogTitle>
          <DialogDescription>
            Submit a request to correct your official ERP record. Admin will review and apply the change.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Field to Change <span className="text-rose-500">*</span></Label>
            <Select value={selectedField} onValueChange={(v) => { setSelectedField(v as ProfileChangeRequestField); setRequestedValue(""); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select field..." />
              </SelectTrigger>
              <SelectContent>
                {fields.map(f => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedField && (
            <div className="rounded-lg bg-muted/50 border px-3 py-2">
              <p className="text-xs text-muted-foreground mb-0.5">Current Value</p>
              <p className="text-sm font-medium">{originalValue || <span className="italic text-muted-foreground">Not set</span>}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Requested Value <span className="text-rose-500">*</span></Label>
            <Input
              value={requestedValue}
              onChange={e => setRequestedValue(e.target.value)}
              placeholder={`Enter correct ${selectedFieldObj?.label || "value"}...`}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Reason <span className="text-rose-500">*</span></Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain why this information needs to be corrected..."
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Supporting Document <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={e => setSupportFile(e.target.files?.[0] || null)}
                className="text-sm"
              />
            </div>
            {supportFile && <p className="text-xs text-muted-foreground">Selected: {supportFile.name} ({(supportFile.size / 1024).toFixed(1)} KB)</p>}
            {uploading && <div className="w-full bg-muted rounded-full h-1.5"><div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || uploading}>
            {submitting ? "Submitting..." : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Request History
// ============================================================
function RequestHistory({ requests, onCancel }: { requests: ProfileChangeRequestV2[]; onCancel: (id: string) => void }) {
  if (requests.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">No change requests submitted yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map(req => (
        <div key={req.id} className="rounded-xl border bg-card p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{req.fieldLabel}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(req.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <StatusBadge status={req.status} />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
              <p className="text-muted-foreground mb-0.5">Original</p>
              <p className="font-medium truncate">{req.originalValue || "(empty)"}</p>
            </div>
            <div className="rounded-lg bg-primary/5 border border-primary/10 px-2.5 py-1.5">
              <p className="text-muted-foreground mb-0.5">Requested</p>
              <p className="font-medium truncate text-primary">{req.requestedValue}</p>
            </div>
          </div>

          {req.reason && <p className="text-xs text-muted-foreground">Reason: {req.reason}</p>}

          {req.reviewerComment && (
            <div className="rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-2">
              <p className="text-xs font-medium text-amber-900">Reviewer Comment:</p>
              <p className="text-xs text-amber-800 mt-0.5">{req.reviewerComment}</p>
            </div>
          )}

          {req.status === "pending" && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 text-slate-600"
              onClick={() => onCancel(req.id)}
            >
              Cancel Request
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Admin Profile View
// ============================================================
function AdminProfileView({ profile }: { profile: StaffProfile }) {
  return (
    <div className="space-y-1 divide-y divide-border/50">
      <InfoRow icon={<User size={15} />} label="Full Name" value={profile.name} />
      <InfoRow icon={<Mail size={15} />} label="Email Address" value={profile.email} />
      <InfoRow icon={<Phone size={15} />} label="Phone" value={profile.phone} />
      <InfoRow icon={<BadgeCheck size={15} />} label="Role" value="Administrator / Principal" />
      <InfoRow icon={<BadgeCheck size={15} />} label="Designation" value={profile.designation} />
      <InfoRow icon={<Calendar size={15} />} label="Date of Birth" value={profile.DOB} />
      <InfoRow icon={<MapPin size={15} />} label="Address" value={profile.address} />
    </div>
  );
}

// ============================================================
// Staff Profile View (HOD, Teacher, Accountant, Printing, Operations)
// ============================================================
function StaffProfileView({ profile }: { profile: StaffProfile }) {
  return (
    <div className="space-y-1 divide-y divide-border/50">
      <InfoRow icon={<User size={15} />} label="Full Name" value={profile.name} />
      <InfoRow icon={<Mail size={15} />} label="Email Address" value={profile.email} />
      <InfoRow icon={<Phone size={15} />} label="Phone" value={profile.phone} />
      <InfoRow icon={<BadgeCheck size={15} />} label="Role" value={getRoleDisplayLabel(profile.role as Role)} />
      <InfoRow icon={<BadgeCheck size={15} />} label="Designation" value={profile.designation} />
      <InfoRow icon={<BookOpen size={15} />} label="Department" value={profile.department} />
      {profile.subject && <InfoRow icon={<BookOpen size={15} />} label="Subject" value={profile.subject} />}
      <InfoRow icon={<BadgeCheck size={15} />} label="Employee ID" value={profile.employeeId} />
      <InfoRow icon={<Calendar size={15} />} label="Date of Birth" value={profile.DOB} />
      <InfoRow icon={<MapPin size={15} />} label="Address" value={profile.address} />
    </div>
  );
}

// ============================================================
// Student Profile View
// ============================================================
function StudentProfileView({ profile }: { profile: StudentProfile }) {
  return (
    <div className="space-y-1 divide-y divide-border/50">
      <InfoRow icon={<User size={15} />} label="Full Name" value={profile.name} />
      <InfoRow icon={<BadgeCheck size={15} />} label="Student UID" value={profile.studentUid} />
      <InfoRow icon={<FileText size={15} />} label="Admission Number" value={profile.admissionNo} />
      <InfoRow icon={<FileText size={15} />} label="Roll Number" value={profile.rollNo} />
      <InfoRow icon={<Calendar size={15} />} label="Date of Birth" value={profile.DOB} />
      <InfoRow icon={<User size={15} />} label="Gender" value={profile.gender} />
      <InfoRow icon={<BookOpen size={15} />} label="Class" value={profile.grade ? `Class ${profile.grade}` : undefined} />
      <InfoRow icon={<BookOpen size={15} />} label="Section" value={profile.section} />
      <InfoRow icon={<Calendar size={15} />} label="Academic Year" value={profile.academicYear} />
      <InfoRow icon={<Users size={15} />} label="Class Teacher" value={profile.classTeacherName} />
      <InfoRow icon={<Mail size={15} />} label="Email" value={profile.email} />
      <InfoRow icon={<Phone size={15} />} label="Parent Contact" value={profile.parentContact} />
      <InfoRow icon={<User size={15} />} label="Father's Name" value={profile.fatherName} />
      <InfoRow icon={<User size={15} />} label="Mother's Name" value={profile.motherName} />
      <InfoRow icon={<MapPin size={15} />} label="Address" value={profile.address} />
    </div>
  );
}

// ============================================================
// Parent Profile View
// ============================================================
function ParentProfileView({ profile }: { profile: ParentProfile }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1 divide-y divide-border/50">
        <InfoRow icon={<User size={15} />} label="Full Name" value={profile.name} />
        <InfoRow icon={<Mail size={15} />} label="Email Address" value={profile.email} />
        <InfoRow icon={<Phone size={15} />} label="Phone" value={profile.phone} />
        <InfoRow icon={<MapPin size={15} />} label="Address" value={profile.address} />
      </div>

      <Separator />

      <div>
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <GraduationCap size={16} className="text-amber-600" />
          Linked Children
        </h3>
        {profile.linkedChildren.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No linked children found.</p>
        ) : (
          <div className="space-y-2">
            {profile.linkedChildren.map((child) => (
              <div key={child.studentId} className="rounded-xl border bg-amber-50/50 px-3 py-2.5">
                <p className="font-semibold text-sm">{child.studentName}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {child.grade && <span>Class {child.grade}{child.section ? ` – ${child.section}` : ""}</span>}
                  {child.admissionNo && <span>Adm: {child.admissionNo}</span>}
                  {child.studentUid && <span>UID: {child.studentUid}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================
export default function UniversalProfile() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [loading, setLoading] = useState(true);
  const [staffProfile, setStaffProfile] = useState<StaffProfile | null>(null);
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null);
  const [parentProfile, setParentProfile] = useState<ParentProfile | null>(null);
  const [requests, setRequests] = useState<ProfileChangeRequestV2[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);

  useEffect(() => {
    if (!appUser) return;
    loadProfile();
    loadRequests();
  }, [appUser]);

  const loadProfile = async () => {
    if (!appUser) return;
    setLoading(true);
    try {
      if (appUser.role === "student") {
        const p = await fetchStudentProfile(appUser);
        setStudentProfile(p);
      } else if (appUser.role === "hod" || appUser.role === "teacher" || appUser.role === "admin" || appUser.role === "accountant" || appUser.role === "printing" || appUser.role === "operations") {
        const p = await fetchStaffProfile(appUser);
        setStaffProfile(p);
      } else {
        // parent / guardian or unknown
        const p = await fetchParentProfile(appUser);
        setParentProfile(p);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadRequests = async () => {
    if (!appUser) return;
    setRequestsLoading(true);
    try {
      const reqs = await getMyProfileChangeRequests(appUser.id);
      setRequests(reqs);
    } catch (e) {
      console.error(e);
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleCancelRequest = async (reqId: string) => {
    if (!appUser) return;
    try {
      await cancelProfileChangeRequest(reqId, appUser.id);
      toast({ title: "Request cancelled" });
      loadRequests();
    } catch (e: any) {
      toast({ title: "Failed to cancel", description: e.message, variant: "destructive" });
    }
  };

  if (!appUser) return null;

  // Determine entity info for change requests
  const entityType: ProfileChangeRequestV2["entityType"] =
    appUser.role === "student" ? "student" :
    appUser.role === "hod" || appUser.role === "teacher" ? "staff" :
    appUser.role === "admin" || appUser.role === "accountant" || appUser.role === "printing" || appUser.role === "operations" ? "user" :
    "parent";

  const entityId =
    appUser.role === "student" ? (studentProfile?.id || appUser.id) :
    appUser.role === "hod" || appUser.role === "teacher" ? (staffProfile?.id || appUser.id) :
    appUser.id;

  // Build profileData map for displaying current values in the form
  const profileDataMap: Record<string, string | undefined> = {};
  if (studentProfile) {
    profileDataMap.name = studentProfile.name;
    profileDataMap.DOB = studentProfile.DOB;
    profileDataMap.gender = studentProfile.gender;
    profileDataMap.address = studentProfile.address;
    profileDataMap.phone = studentProfile.parentContact;
    profileDataMap.email = studentProfile.email;
    profileDataMap.fatherName = studentProfile.fatherName;
    profileDataMap.motherName = studentProfile.motherName;
    profileDataMap.parentContact = studentProfile.parentContact;
  } else if (staffProfile) {
    profileDataMap.name = staffProfile.name;
    profileDataMap.email = staffProfile.email;
    profileDataMap.staffPhone = staffProfile.phone;
    profileDataMap.staffAddress = staffProfile.address;
    profileDataMap.designation = staffProfile.designation;
    profileDataMap.department = staffProfile.department;
  } else if (parentProfile) {
    profileDataMap.parentName = parentProfile.name;
    profileDataMap.parentPhone = parentProfile.phone;
    profileDataMap.parentEmail = parentProfile.email;
    profileDataMap.parentAddress = parentProfile.address;
  }

  const displayName = staffProfile?.name || studentProfile?.name || parentProfile?.name || appUser.name;
  const displayPhoto = staffProfile?.photo || studentProfile?.photo || parentProfile?.photo || appUser.photo;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2">
          <ArrowLeft size={16} /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
          <p className="text-sm text-muted-foreground">View your ERP profile information</p>
        </div>
      </div>

      {/* Profile card */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 py-6">
          <div className="flex items-center gap-5">
            <ProfileAvatar name={displayName} photo={displayPhoto} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold truncate">{displayName}</h2>
              <div className="flex items-center gap-2 mt-1">
                {getRoleIcon(appUser.role)}
                <span className="text-sm text-muted-foreground">{getRoleDisplayLabel(appUser.role)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{appUser.email}</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-2 bg-amber-50/80 border-b border-amber-100">
          <p className="text-xs text-amber-800 flex items-start gap-2">
            <Info size={13} className="shrink-0 mt-0.5" />
            Some information is managed by the school. If you find incorrect information, submit a change request.
          </p>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="profile">
        <TabsList className="w-full">
          <TabsTrigger value="profile" className="flex-1">Profile</TabsTrigger>
          <TabsTrigger value="requests" className="flex-1">
            Requests
            {requests.filter(r => r.status === "pending" || r.status === "under_review").length > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5">
                {requests.filter(r => r.status === "pending" || r.status === "under_review").length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Profile Information</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setChangeDialogOpen(true)}
                >
                  <Edit3 size={14} />
                  Request a Change
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}
                </div>
              ) : (
                <>
                  {appUser.role === "admin" && staffProfile && <AdminProfileView profile={staffProfile} />}
                  {(appUser.role === "hod" || appUser.role === "teacher" || appUser.role === "accountant" || appUser.role === "printing" || appUser.role === "operations") && staffProfile && <StaffProfileView profile={staffProfile} />}
                  {appUser.role === "student" && studentProfile && <StudentProfileView profile={studentProfile} />}
                  {appUser.role === "student" && !studentProfile && (
                    <p className="text-sm text-muted-foreground italic text-center py-8">Student profile data not found. Please contact the school office.</p>
                  )}
                  {(appUser.role !== "admin" && appUser.role !== "hod" && appUser.role !== "teacher" && appUser.role !== "accountant" && appUser.role !== "printing" && appUser.role !== "operations" && appUser.role !== "student") && parentProfile && <ParentProfileView profile={parentProfile} />}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requests">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">My Change Requests</CardTitle>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setChangeDialogOpen(true)}>
                  <Edit3 size={14} /> New Request
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {requestsLoading ? (
                <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
              ) : (
                <RequestHistory requests={requests} onCancel={handleCancelRequest} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Change Request Dialog */}
      <ChangeRequestDialog
        open={changeDialogOpen}
        onClose={() => setChangeDialogOpen(false)}
        role={appUser.role}
        appUserId={appUser.id}
        appUserName={appUser.name}
        appUserRole={appUser.role}
        entityId={entityId}
        entityType={entityType}
        profileData={profileDataMap}
        onSubmitted={loadRequests}
      />
    </div>
  );
}

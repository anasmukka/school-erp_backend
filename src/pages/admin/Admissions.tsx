import { useEffect, useMemo, useRef, useState } from "react";
import { deleteApp, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, deleteUser, getAuth } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
  addDoc,
} from "firebase/firestore";
import firebaseApp, { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Download,
  FileText,
  UploadCloud,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  UserCheck,
  UserX,
  CreditCard,
  Eye,
  Plus,
  RefreshCw,
  Search,
  Filter,
  Users,
  Shield,
  FileCheck,
  Calendar,
  Phone,
  Mail,
  MapPin,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { User } from "@/lib/types";
import { getActiveAcademicSession } from "@/lib/sessions";
import { getAcademicSession } from "@/lib/fees";
import { SearchInput } from "@/components/ui/SearchInput";

export type AdmissionType = "student" | "teacher" | "accountant" | "hod" | "printing";
export type AdmissionStatus = "pending" | "approved" | "shortlisted" | "rejected" | "documents_requested";
export type DocumentVerificationStatus = "pending" | "verified" | "rejected";
export type FeePaymentStatus = "paid" | "unpaid" | "waived";

const GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];
const CATEGORIES = ["General", "OBC", "SC", "ST", "EWS", "Other"];

export type DocumentEntry = {
  fileName: string;
  mimeType: string;
  fileData: string; // base64 data URL
  label?: string;
  verifiedStatus?: DocumentVerificationStatus;
};

export interface AdmissionRecord {
  id: string;
  type: AdmissionType;
  name: string;
  email: string;
  grade?: string;
  subject?: string;
  dob?: string;
  gender?: string;
  bloodGroup?: string;
  category?: string;
  nationality?: string;
  parentName?: string;
  relationship?: string;
  parentContact?: string;
  parentPhone?: string;
  parentEmail?: string;
  occupation?: string;
  annualIncome?: string;
  address?: string;
  residentialAddress?: string;
  permanentAddress?: string;
  hodId?: string;
  hodIds?: string[];
  hodAssignments?: { hodId: string; grades?: string[] }[];
  assignedGrades?: string[];
  linkedUid?: string;
  photoData?: string;
  photoName?: string;
  documents: DocumentEntry[];
  applicationNo?: string;
  admissionNo?: string;
  academicYear?: string;
  feeStatus?: FeePaymentStatus;
  feeTransactionId?: string;
  feePaymentDate?: string;
  status?: AdmissionStatus;
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  createdAt: string;
}

type ProvisionedAuthUser = {
  uid: string;
  rollback: () => Promise<void>;
  cleanup: () => Promise<void>;
};

function buildStudentAdmissionNo(uid: string) {
  return `ADM${new Date().getFullYear()}${uid.slice(0, 6).toUpperCase()}`;
}

function generateApplicationNo() {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `APP-${year}-${rand}`;
}

async function provisionAuthUser(email: string, password: string): Promise<ProvisionedAuthUser> {
  const scopedAppName = `admissions-provision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const scopedApp = initializeApp(firebaseApp.options, scopedAppName);
  const scopedAuth = getAuth(scopedApp);
  const credential = await createUserWithEmailAndPassword(scopedAuth, email, password);

  return {
    uid: credential.user.uid,
    rollback: async () => {
      try {
        await deleteUser(credential.user);
      } catch {
        // best-effort rollback
      }
    },
    cleanup: async () => {
      try {
        await scopedAuth.signOut();
      } catch {
        // ignore
      }
      try {
        await deleteApp(scopedApp);
      } catch {
        // ignore
      }
    },
  };
}

export default function Admissions() {
  const { appUser } = useAuth();
  const { workingSession } = useAcademicSession();
  const [records, setRecords] = useState<AdmissionRecord[]>([]);
  const [hods, setHods] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Selected Applicant for Details Modal
  const [selectedApplicant, setSelectedApplicant] = useState<AdmissionRecord | null>(null);
  const [reviewNotesInput, setReviewNotesInput] = useState("");
  const [updatingDecision, setUpdatingDecision] = useState(false);

  // Document Preview Modal State
  const [previewDoc, setPreviewDoc] = useState<DocumentEntry | null>(null);

  const docInputRef = useRef<HTMLInputElement | null>(null);

  const buildEmptyForm = () => ({
    type: "student" as AdmissionType,
    name: "",
    email: "",
    password: "",
    grade: "",
    subject: "",
    dob: "",
    gender: "Male",
    bloodGroup: "O+",
    category: "General",
    nationality: "Indian",
    parentName: "",
    relationship: "Father",
    parentContact: "",
    parentEmail: "",
    occupation: "",
    annualIncome: "",
    address: "",
    permanentAddress: "",
    hodId: "",
    selectedHodIds: [] as string[],
    selectedGrades: [] as string[],
    feeStatus: "paid" as FeePaymentStatus,
    feeTransactionId: `TXN-${Date.now().toString().slice(-6)}`,
    photo: null as File | null,
    documents: [] as { file: File; label: string }[],
    docFile: null as File | null,
    docLabel: "",
  });

  const [form, setForm] = useState(buildEmptyForm());

  const load = async () => {
    setLoading(true);
    try {
      const [admissionSnap, hodSnap] = await Promise.all([
        getDocs(collection(db, "admissions")),
        getDocs(query(collection(db, "users"), where("role", "==", "hod"))),
      ]);

      setHods(hodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as User)));

      const mapped = admissionSnap.docs.map((d) => {
        const data = d.data() as Partial<AdmissionRecord> & { documents?: any[] };
        const documents: DocumentEntry[] = (data.documents ?? []).map((doc) => ({
          fileName: doc.fileName ?? doc.label ?? "document",
          mimeType: doc.mimeType ?? "application/octet-stream",
          fileData: doc.fileData ?? "",
          label: doc.label ?? doc.fileName ?? "Document",
          verifiedStatus: doc.verifiedStatus || "pending",
        }));

        return {
          id: d.id,
          type: (data.type as AdmissionType) ?? "student",
          name: data.name ?? "",
          email: data.email ?? "",
          grade: data.grade ?? "",
          subject: data.subject ?? "",
          dob: data.dob ?? "",
          gender: data.gender ?? "Unspecified",
          bloodGroup: data.bloodGroup ?? "",
          category: data.category ?? "General",
          nationality: data.nationality ?? "Indian",
          parentName: data.parentName ?? "",
          relationship: data.relationship ?? "Parent / Guardian",
          parentContact: data.parentContact ?? data.parentPhone ?? "",
          parentPhone: data.parentPhone ?? data.parentContact ?? "",
          parentEmail: data.parentEmail ?? "",
          occupation: data.occupation ?? "",
          annualIncome: data.annualIncome ?? "",
          address: data.address ?? data.residentialAddress ?? "",
          residentialAddress: data.residentialAddress ?? data.address ?? "",
          permanentAddress: data.permanentAddress ?? data.address ?? "",
          hodId: data.hodId ?? "",
          hodIds: data.hodIds ?? [],
          hodAssignments: data.hodAssignments ?? [],
          assignedGrades: data.assignedGrades ?? [],
          linkedUid: data.linkedUid ?? "",
          photoData: data.photoData ?? "",
          photoName: data.photoName ?? "",
          documents,
          applicationNo: data.applicationNo || `APP-${d.id.slice(0, 6).toUpperCase()}`,
          admissionNo: data.admissionNo || "",
          academicYear: data.academicYear || workingSession?.name || "2026-27",
          feeStatus: data.feeStatus || "paid",
          feeTransactionId: data.feeTransactionId || "",
          feePaymentDate: data.feePaymentDate || data.createdAt || "",
          status: data.status || "pending",
          reviewNotes: data.reviewNotes || "",
          reviewedBy: data.reviewedBy || "",
          reviewedByName: data.reviewedByName || "",
          reviewedAt: data.reviewedAt || "",
          createdAt: data.createdAt ?? "",
        } as AdmissionRecord;
      });

      setRecords(mapped.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
    } catch (err: any) {
      console.error("Error loading admissions:", err);
      setError("Failed to load admission records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [workingSession?.name]);

  const getHodGrades = (hodId: string): string[] => {
    const hod = hods.find((h) => h.id === hodId);
    return (hod?.assignedGrades as string[] | undefined) ?? [];
  };

  const resetForm = () => {
    setForm(buildEmptyForm());
    if (docInputRef.current) docInputRef.current.value = "";
  };

  const addDocument = () => {
    if (!form.docFile) {
      setError("Choose a document file to add.");
      return;
    }
    const label = form.docLabel.trim() || form.docFile.name;
    setForm((f) => ({
      ...f,
      documents: [...f.documents, { file: f.docFile as File, label }],
      docFile: null,
      docLabel: "",
    }));
    if (docInputRef.current) docInputRef.current.value = "";
  };

  const removeDocument = (idx: number) => {
    setForm((f) => ({
      ...f,
      documents: f.documents.filter((_, i) => i !== idx),
    }));
  };

  const handleTypeChange = (nextType: AdmissionType) => {
    setError("");
    if (docInputRef.current) docInputRef.current.value = "";
    setForm({ ...buildEmptyForm(), type: nextType });
  };

  const handlePhoto = (file: File | null) => {
    setForm((f) => ({ ...f, photo: file }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!form.password.trim()) {
      setError("Password is required to create the applicant login.");
      return;
    }
    if (form.type === "student" && !form.grade.trim()) {
      setError("Grade is required for student admissions.");
      return;
    }
    if ((form.type === "teacher" || form.type === "hod") && !form.subject.trim()) {
      setError("Subject / department is required.");
      return;
    }
    if (form.type === "student" && !form.hodId) {
      setError("Assign an HOD for the student.");
      return;
    }
    if (form.type === "teacher" && form.selectedHodIds.length === 0) {
      setError("Assign at least one HOD for the teacher.");
      return;
    }
    if (form.type === "hod" && form.selectedGrades.length === 0) {
      setError("Select grades for the HOD.");
      return;
    }

    setSaving(true);
    let provisioned: ProvisionedAuthUser | null = null;
    let linkedSaved = false;

    try {
      const normalizedEmail = form.email.trim().toLowerCase();
      let photoData = "";
      if (form.photo) {
        const { uploadObject } = await import("@/lib/objectStorage");
        const uploadRes = await uploadObject({
          file: form.photo,
          category: "profile_photo",
          resourceType: "profile_photo",
        });
        photoData = uploadRes.downloadUrl;
      }

      const docEntries: DocumentEntry[] = await Promise.all(
        form.documents.map(async (d) => {
          const { uploadObject } = await import("@/lib/objectStorage");
          const uploadRes = await uploadObject({
            file: d.file,
            category: "student_document",
            resourceType: "student_document",
          });
          return {
            fileName: d.file.name,
            mimeType: d.file.type || "application/octet-stream",
            fileData: uploadRes.downloadUrl,
            label: d.label?.trim() || d.file.name,
            verifiedStatus: "verified" as DocumentVerificationStatus,
          };
        })
      );

      const hodAssignments =
        form.type === "teacher"
          ? form.selectedHodIds.map((hodId) => ({ hodId, grades: getHodGrades(hodId) }))
          : [];

      const existingUserSnap = await getDocs(
        query(collection(db, "users"), where("email", "==", normalizedEmail))
      );
      if (!existingUserSnap.empty) {
        setError("An account with this email already exists. Use a different email.");
        return;
      }

      if (form.type === "student") {
        const existingStudentSnap = await getDocs(
          query(collection(db, "students"), where("email", "==", normalizedEmail))
        );
        if (!existingStudentSnap.empty) {
          setError("A student profile with this email already exists.");
          return;
        }
      }

      if (form.type === "teacher") {
        const existingTeacherSnap = await getDocs(
          query(collection(db, "teachers"), where("email", "==", normalizedEmail))
        );
        if (!existingTeacherSnap.empty) {
          setError("A teacher profile with this email already exists.");
          return;
        }
      }

      provisioned = await provisionAuthUser(normalizedEmail, form.password.trim());
      const uid = provisioned.uid;
      const now = new Date().toISOString();
      const batch = writeBatch(db);

      const appNo = generateApplicationNo();
      const admissionNo = form.type === "student" ? buildStudentAdmissionNo(uid) : "";
      const activeSess = await getActiveAcademicSession();
      const activeYear = workingSession?.name || activeSess?.name || getAcademicSession();

      const admissionRef = doc(collection(db, "admissions"));
      batch.set(admissionRef, {
        type: form.type,
        name: form.name.trim(),
        email: normalizedEmail,
        grade: form.type === "student" ? form.grade.trim() : "",
        subject: form.type === "teacher" || form.type === "hod" ? form.subject.trim() : "",
        dob: form.dob || "",
        gender: form.gender || "Male",
        bloodGroup: form.bloodGroup || "O+",
        category: form.category || "General",
        nationality: form.nationality || "Indian",
        parentName: form.parentName || "",
        relationship: form.relationship || "Father",
        parentContact: form.parentContact || "",
        parentPhone: form.parentContact || "",
        parentEmail: form.parentEmail || "",
        occupation: form.occupation || "",
        annualIncome: form.annualIncome || "",
        address: form.address || "",
        residentialAddress: form.address || "",
        permanentAddress: form.permanentAddress || form.address || "",
        hodId: form.type === "student" ? form.hodId : "",
        hodIds: form.type === "teacher" ? form.selectedHodIds : [],
        assignedGrades: form.type === "hod" ? form.selectedGrades : [],
        hodAssignments,
        linkedUid: uid,
        photoData,
        photoName: form.photo?.name ?? "",
        documents: docEntries,
        applicationNo: appNo,
        admissionNo,
        academicYear: activeYear,
        feeStatus: form.feeStatus,
        feeTransactionId: form.feeTransactionId,
        feePaymentDate: now,
        status: "approved", // Admins creating directly approves it
        reviewNotes: "Direct admission created by Admin",
        reviewedBy: appUser?.id || "admin",
        reviewedByName: appUser?.name || "Admin",
        reviewedAt: now,
        createdAt: now,
      });

      if (form.type === "student") {
        const admissionGrade = form.grade.trim();
        batch.set(doc(db, "students", uid), {
          uid,
          name: form.name.trim(),
          email: normalizedEmail,
          DOB: form.dob || "",
          gender: form.gender || "Male",
          bloodGroup: form.bloodGroup || "O+",
          parentName: form.parentName || "",
          parentContact: form.parentContact || "",
          parentEmail: form.parentEmail || "",
          hodId: form.hodId,
          photo: photoData,
          address: form.address || "",
          admissionNo,
          createdAt: now,
        });

        const enrollmentRef = doc(collection(db, "enrollments"));
        batch.set(enrollmentRef, {
          studentId: uid,
          academicYear: activeYear,
          sessionId: workingSession?.id || activeSess?.id || null,
          className: admissionGrade,
          sectionName: null,
          sectionId: null,
          hodId: form.hodId,
          status: "active",
          createdAt: now,
        });

        batch.set(doc(db, "users", uid), {
          name: form.name.trim(),
          email: normalizedEmail,
          role: "student",
          DOB: form.dob || "",
          photo: photoData,
          hodId: form.hodId,
          grade: form.grade.trim(),
        });
      }

      if (form.type === "teacher") {
        batch.set(doc(db, "teachers", uid), {
          uid,
          name: form.name.trim(),
          email: normalizedEmail,
          subject: form.subject.trim(),
          DOB: form.dob || "",
          photo: photoData,
          hodIds: form.selectedHodIds,
          hodAssignments,
          designation: "Teacher",
          phone: form.parentContact || "",
          address: form.address || "",
          createdAt: now,
        });

        batch.set(doc(db, "users", uid), {
          name: form.name.trim(),
          email: normalizedEmail,
          role: "teacher",
          subject: form.subject.trim(),
          DOB: form.dob || "",
          photo: photoData,
        });
      }

      if (form.type === "accountant") {
        batch.set(doc(db, "users", uid), {
          name: form.name.trim(),
          email: normalizedEmail,
          role: "accountant",
          subject: form.subject.trim() || "Accounts",
          designation: "Accounts Staff",
          DOB: form.dob || "",
          photo: photoData,
          phone: form.parentContact || "",
          address: form.address || "",
        });
      }

      if (form.type === "hod") {
        batch.set(doc(db, "users", uid), {
          name: form.name.trim(),
          email: normalizedEmail,
          role: "hod",
          subject: form.subject.trim(),
          DOB: form.dob || "",
          photo: photoData,
          assignedGrades: form.selectedGrades,
          address: form.address || "",
          phone: form.parentContact || "",
          designation: "Head of Department",
        });
      }

      if (form.type === "printing") {
        batch.set(doc(db, "users", uid), {
          name: form.name.trim(),
          email: normalizedEmail,
          role: "printing",
          subject: "Printing Department",
          designation: "Printing Department Staff",
          DOB: form.dob || "",
          photo: photoData,
          address: form.address || "",
          phone: form.parentContact || "",
        });
      }

      await batch.commit();
      linkedSaved = true;
      resetForm();
      setShowCreateForm(false);
      await load();
    } catch (err: any) {
      if (provisioned && !linkedSaved) {
        await provisioned.rollback();
      }
      setError(err?.message ?? "Failed to save admission and linked records.");
    } finally {
      if (provisioned) {
        await provisioned.cleanup();
      }
      setSaving(false);
    }
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Unable to read file"));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const downloadFile = (doc: DocumentEntry) => {
    const link = document.createElement("a");
    link.href = doc.fileData;
    link.download = doc.fileName || doc.label || "document";
    link.click();
  };

  // Status and Decision Handlers
  const handleUpdateStatus = async (newStatus: AdmissionStatus) => {
    if (!selectedApplicant) return;
    setUpdatingDecision(true);
    try {
      const now = new Date().toISOString();
      const updates = {
        status: newStatus,
        reviewNotes: reviewNotesInput.trim() || selectedApplicant.reviewNotes || "",
        reviewedBy: appUser?.id || "admin",
        reviewedByName: appUser?.name || "Admin",
        reviewedAt: now,
      };

      await updateDoc(doc(db, "admissions", selectedApplicant.id), updates);

      setSelectedApplicant((prev) => (prev ? { ...prev, ...updates } : null));
      setRecords((prev) =>
        prev.map((r) => (r.id === selectedApplicant.id ? { ...r, ...updates } : r))
      );
    } catch (err: any) {
      alert("Failed to update status: " + err.message);
    } finally {
      setUpdatingDecision(false);
    }
  };

  const handleToggleFeeStatus = async (newFeeStatus: FeePaymentStatus) => {
    if (!selectedApplicant) return;
    setUpdatingDecision(true);
    try {
      const updates = {
        feeStatus: newFeeStatus,
        feePaymentDate: newFeeStatus === "paid" ? new Date().toISOString() : "",
      };
      await updateDoc(doc(db, "admissions", selectedApplicant.id), updates);
      setSelectedApplicant((prev) => (prev ? { ...prev, ...updates } : null));
      setRecords((prev) =>
        prev.map((r) => (r.id === selectedApplicant.id ? { ...r, ...updates } : r))
      );
    } catch (err: any) {
      alert("Failed to update fee status: " + err.message);
    } finally {
      setUpdatingDecision(false);
    }
  };

  const handleUpdateDocumentStatus = async (
    docIndex: number,
    newDocStatus: DocumentVerificationStatus
  ) => {
    if (!selectedApplicant) return;
    try {
      const updatedDocs = [...selectedApplicant.documents];
      if (updatedDocs[docIndex]) {
        updatedDocs[docIndex] = {
          ...updatedDocs[docIndex],
          verifiedStatus: newDocStatus,
        };
      }

      await updateDoc(doc(db, "admissions", selectedApplicant.id), {
        documents: updatedDocs,
      });

      setSelectedApplicant((prev) => (prev ? { ...prev, documents: updatedDocs } : null));
      setRecords((prev) =>
        prev.map((r) => (r.id === selectedApplicant.id ? { ...r, documents: updatedDocs } : r))
      );
    } catch (err: any) {
      alert("Failed to update document verification: " + err.message);
    }
  };

  // Filtered Admissions List
  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      // Status filter
      if (statusFilter !== "all" && rec.status !== statusFilter) return false;

      // Grade filter
      if (gradeFilter !== "all" && rec.grade !== gradeFilter) return false;

      // Type filter
      if (typeFilter !== "all" && rec.type !== typeFilter) return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = rec.name.toLowerCase().includes(q);
        const matchEmail = (rec.email || "").toLowerCase().includes(q);
        const matchAppNo = (rec.applicationNo || "").toLowerCase().includes(q);
        const matchAdmNo = (rec.admissionNo || "").toLowerCase().includes(q);
        const matchParent = (rec.parentName || "").toLowerCase().includes(q);
        const matchPhone = (rec.parentContact || rec.parentPhone || "").toLowerCase().includes(q);

        if (!matchName && !matchEmail && !matchAppNo && !matchAdmNo && !matchParent && !matchPhone) {
          return false;
        }
      }

      return true;
    });
  }, [records, statusFilter, gradeFilter, typeFilter, searchQuery]);

  const openApplicantDetails = (rec: AdmissionRecord) => {
    setSelectedApplicant(rec);
    setReviewNotesInput(rec.reviewNotes || "");
  };

  const getStatusBadge = (status?: AdmissionStatus) => {
    switch (status) {
      case "approved":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 border-emerald-300 gap-1">
            <CheckCircle2 size={12} /> Approved
          </Badge>
        );
      case "shortlisted":
        return (
          <Badge className="bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 border-blue-300 gap-1">
            <UserCheck size={12} /> Shortlisted
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 border-rose-300 gap-1">
            <XCircle size={12} /> Rejected
          </Badge>
        );
      case "documents_requested":
        return (
          <Badge className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border-amber-300 gap-1">
            <AlertTriangle size={12} /> Docs Requested
          </Badge>
        );
      default:
        return (
          <Badge className="bg-slate-500/10 text-slate-700 hover:bg-slate-500/20 border-slate-300 gap-1">
            <Clock size={12} /> Pending Review
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Admissions & Applications</h1>
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary text-xs">
              {records.length} Total
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Process, inspect, review, and provision institutional admissions and document verification.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={showCreateForm ? "secondary" : "default"}
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="gap-2 shadow-xs"
          >
            {showCreateForm ? (
              "View Applications List"
            ) : (
              <>
                <Plus size={16} /> New Admission
              </>
            )}
          </Button>
          <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Refresh">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* Collapsible Create Admission Form */}
      {showCreateForm && (
        <Card className="border border-primary/20 shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between border-b pb-3 mb-5">
              <div>
                <h2 className="text-lg font-semibold">New Applicant Registration</h2>
                <p className="text-xs text-muted-foreground">
                  Enroll a new student or onboard staff with immediate credentials and documentation.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              {error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Applicant Type</Label>
                  <select
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    value={form.type}
                    onChange={(e) => handleTypeChange(e.target.value as AdmissionType)}
                  >
                    <option value="student">Student</option>
                    <option value="teacher">Teacher</option>
                    <option value="hod">HOD</option>
                    <option value="accountant">Accounts Staff</option>
                    <option value="printing">Printing Department Staff</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Full Name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Full legal name"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="applicant@school.com"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Initial Password *</Label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                    placeholder="Login password"
                  />
                </div>
              </div>

              {/* Biographical Details */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Date of Birth</Label>
                  <Input
                    type="date"
                    value={form.dob}
                    onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Gender</Label>
                  <select
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    value={form.gender}
                    onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Blood Group</Label>
                  <select
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    value={form.bloodGroup}
                    onChange={(e) => setForm((f) => ({ ...f, bloodGroup: e.target.value }))}
                  >
                    {BLOOD_GROUPS.map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <select
                    className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Academic Placement */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>
                    {form.type === "student"
                      ? "Applying for Grade *"
                      : form.type === "teacher"
                        ? "Subject *"
                        : "Department / Specialization"}
                  </Label>
                  {form.type === "student" ? (
                    <select
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      value={form.grade}
                      onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                      required
                    >
                      <option value="">Select Grade</option>
                      {GRADES.map((g) => (
                        <option key={g} value={g}>
                          Grade {g}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={form.subject}
                      onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                      placeholder={form.type === "teacher" ? "e.g. Mathematics" : "Department"}
                      required={form.type === "teacher" || form.type === "hod"}
                    />
                  )}
                </div>

                {form.type === "student" && (
                  <div className="space-y-1.5">
                    <Label>Assign HOD *</Label>
                    <select
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                      value={form.hodId}
                      onChange={(e) => setForm((f) => ({ ...f, hodId: e.target.value }))}
                      required
                    >
                      <option value="">Select Overseeing HOD</option>
                      {hods.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name} ({h.email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Nationality</Label>
                  <Input
                    value={form.nationality}
                    onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value }))}
                    placeholder="e.g. Indian"
                  />
                </div>
              </div>

              {/* HOD Managed Grades Selection */}
              {form.type === "hod" && (
                <div className="space-y-2 p-4 rounded-xl border border-primary/20 bg-primary/5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <Label className="text-sm font-semibold text-slate-800">
                        Grades Managed by this HOD *
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Select all academic classes / grades overseen by this Section Head (HOD).
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            selectedGrades: [...GRADES],
                          }))
                        }
                      >
                        Select All (1-12)
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            selectedGrades: [],
                          }))
                        }
                      >
                        Clear All
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 pt-2">
                    {GRADES.map((g) => {
                      const checked = form.selectedGrades.includes(g);
                      return (
                        <label
                          key={g}
                          className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm cursor-pointer select-none transition-colors ${
                            checked
                              ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                              : "border-border bg-white hover:bg-muted/50 text-slate-700"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded accent-primary cursor-pointer"
                            checked={checked}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                selectedGrades: e.target.checked
                                  ? [...f.selectedGrades, g]
                                  : f.selectedGrades.filter((x) => x !== g),
                              }))
                            }
                          />
                          <span>Grade {g}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Teacher HOD Assignment Selection */}
              {form.type === "teacher" && (
                <div className="space-y-2 p-4 rounded-xl border border-primary/20 bg-primary/5">
                  <Label className="text-sm font-semibold text-slate-800">
                    Assign HOD(s) to this Teacher *
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Select the Section Head / HOD department(s) this teacher reports to.
                  </p>
                  {hods.length === 0 ? (
                    <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                      No HODs registered yet. Please create an HOD first before onboarding teachers.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                      {hods.map((h) => {
                        const selected = form.selectedHodIds.includes(h.id);
                        const grades = getHodGrades(h.id);
                        return (
                          <label
                            key={h.id}
                            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm cursor-pointer select-none transition-colors ${
                              selected
                                ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                                : "border-border bg-white hover:bg-muted/50 text-slate-700"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 w-4 h-4 rounded accent-primary cursor-pointer"
                              checked={selected}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  selectedHodIds: e.target.checked
                                    ? [...f.selectedHodIds, h.id]
                                    : f.selectedHodIds.filter((x) => x !== h.id),
                                }))
                              }
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold">{h.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{h.email}</p>
                              <p className="text-[10px] text-primary/80">
                                Grades: {grades.join(", ") || "None"}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Guardian / Contact Information */}
              <div className="border-t pt-4">
                <p className="text-sm font-semibold mb-3 text-slate-800">
                  {form.type === "student" ? "Parent / Primary Guardian Information" : "Emergency & Contact Information"}
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label>Parent / Guardian Name</Label>
                    <Input
                      value={form.parentName}
                      onChange={(e) => setForm((f) => ({ ...f, parentName: e.target.value }))}
                      placeholder="Father / Mother / Guardian"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Relationship</Label>
                    <Input
                      value={form.relationship}
                      onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
                      placeholder="e.g. Father, Mother, Guardian"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone / Contact *</Label>
                    <Input
                      value={form.parentContact}
                      onChange={(e) => setForm((f) => ({ ...f, parentContact: e.target.value }))}
                      placeholder="+91 98765 43210"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Parent Email</Label>
                    <Input
                      type="email"
                      value={form.parentEmail}
                      onChange={(e) => setForm((f) => ({ ...f, parentEmail: e.target.value }))}
                      placeholder="parent@example.com"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mt-3">
                  <div className="space-y-1.5">
                    <Label>Occupation</Label>
                    <Input
                      value={form.occupation}
                      onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))}
                      placeholder="e.g. Engineer, Business"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Residential Address</Label>
                    <Input
                      value={form.address}
                      onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="Street, locality, city, postal code"
                    />
                  </div>
                </div>
              </div>

              {/* Uploads */}
              <div className="border-t pt-4">
                <p className="text-sm font-semibold mb-3 text-slate-800">
                  Documents & Photograph Upload
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Applicant Photograph (JPG/PNG)</Label>
                    <Input
                      type="file"
                      accept=".jpg,.jpeg,.png"
                      onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
                    />
                    {form.photo && (
                      <p className="text-xs text-emerald-600 font-medium">
                        Selected: {form.photo.name}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Attach Documents (PDF/JPG/PNG)</Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        type="text"
                        className="flex-1"
                        placeholder="Document label (e.g. Birth Certificate)"
                        value={form.docLabel}
                        onChange={(e) => setForm((f) => ({ ...f, docLabel: e.target.value }))}
                      />
                      <Input
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf"
                        ref={docInputRef}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          setForm((f) => ({
                            ...f,
                            docFile: file,
                            docLabel: f.docLabel || file?.name || "",
                          }));
                        }}
                      />
                      <Button type="button" variant="outline" onClick={addDocument}>
                        Attach
                      </Button>
                    </div>

                    {form.documents.length > 0 && (
                      <ul className="space-y-1.5 mt-2">
                        {form.documents.map((d, idx) => (
                          <li
                            key={idx}
                            className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-xs bg-slate-50"
                          >
                            <span className="font-medium truncate">{d.label}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-destructive"
                              onClick={() => removeDocument(idx)}
                            >
                              <Trash2 size={12} />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                  Reset
                </Button>
                <Button type="submit" className="gap-2" disabled={saving}>
                  <UploadCloud size={16} />
                  {saving ? "Provisioning..." : "Submit & Enroll"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Search and Filters Bar */}
      <Card className="glass-card shadow-xs">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search by Applicant Name, App No, Admission No, Parent Name, Phone..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Status Filter */}
              <select
                className="h-10 rounded-xl border border-white/80 bg-white/80 px-3 text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending Review</option>
                <option value="approved">Approved</option>
                <option value="shortlisted">Shortlisted</option>
                <option value="rejected">Rejected</option>
                <option value="documents_requested">Docs Requested</option>
              </select>

              {/* Grade Filter */}
              <select
                className="h-10 rounded-xl border border-white/80 bg-white/80 px-3 text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
              >
                <option value="all">All Grades</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </select>

              {/* Type Filter */}
              <select
                className="h-10 rounded-xl border border-white/80 bg-white/80 px-3 text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">All Types</option>
                <option value="student">Students</option>
                <option value="teacher">Teachers</option>
                <option value="hod">HODs</option>
                <option value="accountant">Accounts</option>
                <option value="printing">Printing</option>
              </select>

              {(searchQuery || statusFilter !== "all" || gradeFilter !== "all" || typeFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setGradeFilter("all");
                    setTypeFilter("all");
                  }}
                  className="text-xs text-muted-foreground hover:text-slate-900"
                >
                  Reset Filters
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admissions List View */}
      {loading ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-primary mb-2" />
            <p className="text-sm font-medium">Loading admissions records...</p>
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="py-16 text-center flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <Users className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800">No Admissions Found</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1 mb-5">
              The admissions database is currently clean with no registered applicants. Create a new
              application or register students to begin.
            </p>
            <Button onClick={() => setShowCreateForm(true)} className="gap-2">
              <Plus size={16} /> New Admission
            </Button>
          </CardContent>
        </Card>
      ) : filteredRecords.length === 0 ? (
        <Card className="border-dashed border-slate-200">
          <CardContent className="py-12 text-center flex flex-col items-center justify-center">
            <Search className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-700">No applications match your search</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-4">
              Try adjusting your search query or filters.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setGradeFilter("all");
                setTypeFilter("all");
              }}
            >
              Clear All Filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredRecords.map((rec) => {
            return (
              <Card
                key={rec.id}
                className="overflow-hidden hover:shadow-md transition-all border border-slate-200/80 cursor-pointer group"
                onClick={() => openApplicantDetails(rec)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      {rec.photoData ? (
                        <img
                          src={rec.photoData}
                          alt={rec.name}
                          className="h-12 w-12 rounded-xl object-cover border border-slate-200 shadow-xs"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-base">
                          {rec.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 group-hover:text-primary transition-colors truncate">
                          {rec.name}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground">
                          {rec.applicationNo || rec.admissionNo || "NO-ID"}
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(rec.status)}
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-600 mb-4 bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Applied Role/Grade:</span>
                      <span className="font-medium text-slate-800">
                        {rec.type === "student" ? `Grade ${rec.grade}` : rec.subject || rec.type}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Guardian:</span>
                      <span className="font-medium text-slate-800 truncate max-w-[150px]">
                        {rec.parentName || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Contact:</span>
                      <span className="font-mono">{rec.parentContact || rec.parentPhone || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fee Status:</span>
                      <span
                        className={`font-semibold capitalize ${
                          rec.feeStatus === "paid"
                            ? "text-emerald-600"
                            : rec.feeStatus === "waived"
                              ? "text-blue-600"
                              : "text-amber-600"
                        }`}
                      >
                        {rec.feeStatus || "Unpaid"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <FileCheck size={13} className="text-slate-400" />
                      {rec.documents?.length || 0} document(s)
                    </span>
                    <span className="font-medium text-primary flex items-center gap-1 group-hover:underline">
                      View Applicant Details <ChevronRight size={14} />
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Comprehensive Applicant Details Modal */}
      {selectedApplicant && (
        <Dialog
          open={!!selectedApplicant}
          onOpenChange={(open) => !open && setSelectedApplicant(null)}
        >
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 rounded-2xl bg-white border border-slate-200">
            {/* Modal Header */}
            <div className="sticky top-0 z-10 bg-slate-900 text-white px-6 py-5 rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-4">
                {selectedApplicant.photoData ? (
                  <img
                    src={selectedApplicant.photoData}
                    alt={selectedApplicant.name}
                    className="w-14 h-14 rounded-xl object-cover border-2 border-white/30"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-white/20 text-white flex items-center justify-center font-bold text-xl">
                    {selectedApplicant.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{selectedApplicant.name}</h2>
                    {getStatusBadge(selectedApplicant.status)}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 mt-1">
                    <span>App No: <strong className="font-mono text-white">{selectedApplicant.applicationNo}</strong></span>
                    {selectedApplicant.admissionNo && (
                      <span>Adm No: <strong className="font-mono text-white">{selectedApplicant.admissionNo}</strong></span>
                    )}
                    <span>Session: <strong className="text-white">{selectedApplicant.academicYear}</strong></span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Section 1: Applicant Information */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 border-b pb-1.5">
                  <UserCheck size={16} className="text-primary" />
                  <h3>1. Applicant Information</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl text-xs">
                  <div>
                    <p className="text-muted-foreground">Full Legal Name</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Applied Grade / Role</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">
                      {selectedApplicant.type === "student"
                        ? `Grade ${selectedApplicant.grade}`
                        : selectedApplicant.subject || selectedApplicant.type}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date of Birth</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.dob || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Gender</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.gender || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Blood Group</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.bloodGroup || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Category</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.category || "General"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Nationality</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.nationality || "Indian"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Submission Date</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">
                      {selectedApplicant.createdAt
                        ? new Date(selectedApplicant.createdAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 2: Guardian / Parent Information */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 border-b pb-1.5">
                  <Users size={16} className="text-primary" />
                  <h3>2. Guardian & Contact Information</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl text-xs">
                  <div>
                    <p className="text-muted-foreground">Primary Contact / Parent</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.parentName || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Relationship</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.relationship || "Guardian"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Phone Number</p>
                    <p className="font-semibold font-mono text-slate-900 text-sm mt-0.5">
                      {selectedApplicant.parentContact || selectedApplicant.parentPhone || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Email</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5 truncate">
                      {selectedApplicant.parentEmail || selectedApplicant.email || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Occupation</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.occupation || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Annual Income</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{selectedApplicant.annualIncome || "—"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Residential Address</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">
                      {selectedApplicant.residentialAddress || selectedApplicant.address || "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 3: Uploaded Documents */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b pb-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <FileCheck size={16} className="text-primary" />
                    <h3>3. Uploaded Documents & Verification</h3>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {selectedApplicant.documents?.length || 0} document(s) uploaded
                  </span>
                </div>

                {selectedApplicant.documents && selectedApplicant.documents.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedApplicant.documents.map((d, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl border border-slate-200 p-3 bg-white flex flex-col justify-between gap-3 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                              <FileText size={16} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-900 truncate">
                                {d.label || d.fileName}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">{d.fileName}</p>
                            </div>
                          </div>

                          <Badge
                            variant="outline"
                            className={`text-[10px] shrink-0 capitalize ${
                              d.verifiedStatus === "verified"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                : d.verifiedStatus === "rejected"
                                  ? "border-rose-300 bg-rose-50 text-rose-700"
                                  : "border-amber-300 bg-amber-50 text-amber-700"
                            }`}
                          >
                            {d.verifiedStatus || "Pending"}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between border-t pt-2 gap-2">
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => setPreviewDoc(d)}
                            >
                              <Eye size={12} /> View
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => downloadFile(d)}
                            >
                              <Download size={12} /> Download
                            </Button>
                          </div>

                          <div className="flex items-center gap-1">
                            {d.verifiedStatus !== "verified" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-50"
                                onClick={() => handleUpdateDocumentStatus(idx, "verified")}
                                title="Mark as Verified"
                              >
                                <CheckCircle2 size={13} className="mr-1" /> Verify
                              </Button>
                            )}
                            {d.verifiedStatus !== "rejected" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50"
                                onClick={() => handleUpdateDocumentStatus(idx, "rejected")}
                                title="Reject Document"
                              >
                                <XCircle size={13} className="mr-1" /> Reject
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-dashed text-center text-xs text-muted-foreground bg-slate-50">
                    No documents uploaded by applicant yet.
                  </div>
                )}
              </div>

              {/* Section 4: Financial & Application Fee Status */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b pb-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CreditCard size={16} className="text-primary" />
                    <h3>4. Financial & Application Fee Status</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedApplicant.feeStatus !== "paid" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                        onClick={() => handleToggleFeeStatus("paid")}
                      >
                        Mark as Paid
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-amber-600 border-amber-300 hover:bg-amber-50"
                        onClick={() => handleToggleFeeStatus("unpaid")}
                      >
                        Mark as Unpaid
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl text-xs">
                  <div>
                    <p className="text-muted-foreground">Fee Payment Status</p>
                    <Badge
                      className={`mt-1 font-semibold capitalize ${
                        selectedApplicant.feeStatus === "paid"
                          ? "bg-emerald-100 text-emerald-800"
                          : selectedApplicant.feeStatus === "waived"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {selectedApplicant.feeStatus || "Unpaid"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Transaction ID / Receipt</p>
                    <p className="font-semibold font-mono text-slate-900 text-sm mt-0.5">
                      {selectedApplicant.feeTransactionId || "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Payment Date</p>
                    <p className="font-semibold text-slate-900 text-sm mt-0.5">
                      {selectedApplicant.feePaymentDate
                        ? new Date(selectedApplicant.feePaymentDate).toLocaleDateString("en-IN")
                        : "Pending"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 5: Review & Decision Actions */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Shield size={16} className="text-primary" />
                  <h3>5. Review & Decision Actions</h3>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Internal Admission Notes / Decision Remarks</Label>
                    <Textarea
                      rows={3}
                      value={reviewNotesInput}
                      onChange={(e) => setReviewNotesInput(e.target.value)}
                      placeholder="Enter internal review notes, condition for admission, or reasons for rejection..."
                      className="text-xs"
                    />
                  </div>

                  {selectedApplicant.reviewedByName && (
                    <div className="text-xs text-muted-foreground bg-blue-50/70 p-2.5 rounded-lg border border-blue-100 flex items-center justify-between">
                      <span>Reviewed by: <strong className="text-slate-800">{selectedApplicant.reviewedByName}</strong></span>
                      <span>
                        Timestamp:{" "}
                        <strong>
                          {selectedApplicant.reviewedAt
                            ? new Date(selectedApplicant.reviewedAt).toLocaleString("en-IN")
                            : "—"}
                        </strong>
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        disabled={updatingDecision}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs"
                        onClick={() => handleUpdateStatus("approved")}
                      >
                        <CheckCircle2 size={13} /> Approve Admission
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingDecision}
                        className="border-blue-400 text-blue-700 hover:bg-blue-50 gap-1 text-xs"
                        onClick={() => handleUpdateStatus("shortlisted")}
                      >
                        <UserCheck size={13} /> Shortlist
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updatingDecision}
                        className="border-amber-400 text-amber-700 hover:bg-amber-50 gap-1 text-xs"
                        onClick={() => handleUpdateStatus("documents_requested")}
                      >
                        <AlertTriangle size={13} /> Request Re-upload
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={updatingDecision}
                        className="gap-1 text-xs"
                        onClick={() => handleUpdateStatus("rejected")}
                      >
                        <XCircle size={13} /> Reject Application
                      </Button>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedApplicant(null)}
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Document Preview Modal */}
      {previewDoc && (
        <Dialog open={!!previewDoc} onOpenChange={(open) => !open && setPreviewDoc(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] p-6">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between text-base">
                <span>{previewDoc.label || previewDoc.fileName}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadFile(previewDoc)}
                  className="gap-1.5 text-xs mr-6"
                >
                  <Download size={13} /> Download
                </Button>
              </DialogTitle>
            </DialogHeader>

            <div className="mt-4 flex items-center justify-center min-h-[300px] max-h-[60vh] overflow-auto bg-slate-100 rounded-xl p-2">
              {previewDoc.fileData.startsWith("data:image/") ? (
                <img
                  src={previewDoc.fileData}
                  alt={previewDoc.fileName}
                  className="max-h-[55vh] max-w-full object-contain rounded-lg shadow-sm"
                />
              ) : previewDoc.fileData.startsWith("data:application/pdf") ? (
                <iframe
                  src={previewDoc.fileData}
                  title={previewDoc.fileName}
                  className="w-full h-[55vh] rounded-lg border-0"
                />
              ) : (
                <div className="text-center p-8">
                  <FileText className="w-12 h-12 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-700">Preview not supported for this file type</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">
                    Download the file to view on your device.
                  </p>
                  <Button onClick={() => downloadFile(previewDoc)} size="sm">
                    Download File
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

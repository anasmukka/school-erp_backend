import { useEffect, useRef, useState } from "react";
import { deleteApp, initializeApp } from "firebase/app";
import { createUserWithEmailAndPassword, deleteUser, getAuth } from "firebase/auth";
import { collection, doc, getDocs, query, where, writeBatch } from "firebase/firestore";
import firebaseApp, { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, UploadCloud, Trash2 } from "lucide-react";
import { User } from "@/lib/types";
import { getAcademicSession } from "@/lib/fees";

type AdmissionType = "student" | "teacher" | "accountant" | "hod";

const GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

type DocumentEntry = {
  fileName: string;
  mimeType: string;
  fileData: string; // base64 data URL
  label?: string;
};

interface AdmissionRecord {
  id: string;
  type: AdmissionType;
  name: string;
  email: string;
  password?: string;
  grade?: string;
  subject?: string;
  dob?: string;
  parentContact?: string;
  address?: string;
  hodId?: string;
  hodIds?: string[];
  hodAssignments?: { hodId: string; grades?: string[] }[];
  assignedGrades?: string[];
  linkedUid?: string;
  photoData?: string;
  photoName?: string;
  documents: DocumentEntry[];
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
        // best-effort rollback for partially created users
      }
    },
    cleanup: async () => {
      try {
        await scopedAuth.signOut();
      } catch {
        // ignore cleanup sign-out failures
      }
      try {
        await deleteApp(scopedApp);
      } catch {
        // ignore cleanup app deletion failures
      }
    },
  };
}

export default function Admissions() {
  const [records, setRecords] = useState<AdmissionRecord[]>([]);
  const [hods, setHods] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const buildEmptyForm = () => ({
    type: "student" as AdmissionType,
    name: "",
    email: "",
    password: "",
    grade: "",
    subject: "",
    dob: "",
    parentContact: "",
    address: "",
    hodId: "",
    selectedHodIds: [] as string[],
    selectedGrades: [] as string[],
    photo: null as File | null,
    documents: [] as { file: File; label: string }[],
    docFile: null as File | null,
    docLabel: "",
  });
  const [form, setForm] = useState(buildEmptyForm());

  const load = async () => {
    setLoading(true);
    const [admissionSnap, hodSnap] = await Promise.all([
      getDocs(collection(db, "admissions")),
      getDocs(query(collection(db, "users"), where("role", "==", "hod"))),
    ]);

    setHods(hodSnap.docs.map((d) => ({ id: d.id, ...d.data() } as User)));

    const mapped = admissionSnap.docs.map((d) => {
      const data = d.data() as Partial<AdmissionRecord> & { documents?: any[] };
      const documents = (data.documents ?? []).map((doc) => ({
        fileName: doc.fileName ?? doc.label ?? "document",
        mimeType: doc.mimeType ?? "application/octet-stream",
        fileData: doc.fileData ?? "",
        label: doc.label ?? doc.fileName ?? "Document",
      }));

      return {
        id: d.id,
        type: (data.type as AdmissionType) ?? "student",
        name: data.name ?? "",
        email: data.email ?? "",
        password: data.password ?? "",
        grade: data.grade ?? "",
        subject: data.subject ?? "",
        dob: data.dob ?? "",
        parentContact: data.parentContact ?? "",
        address: data.address ?? "",
        hodId: data.hodId ?? "",
        hodIds: data.hodIds ?? [],
        hodAssignments: data.hodAssignments ?? [],
        assignedGrades: data.assignedGrades ?? [],
        linkedUid: data.linkedUid ?? "",
        photoData: data.photoData ?? "",
        photoName: data.photoName ?? "",
        documents,
        createdAt: data.createdAt ?? "",
      } as AdmissionRecord;
    });

    setRecords(mapped.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

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
      const photoData = form.photo ? await fileToDataUrl(form.photo) : "";
      const docEntries = await Promise.all(
        form.documents.map(async (d) => ({
          fileName: d.file.name,
          mimeType: d.file.type || "application/octet-stream",
          fileData: await fileToDataUrl(d.file),
          label: d.label?.trim() || d.file.name,
        })),
      );
      const hodAssignments =
        form.type === "teacher"
          ? form.selectedHodIds.map((hodId) => ({ hodId, grades: getHodGrades(hodId) }))
          : [];

      const existingUserSnap = await getDocs(
        query(collection(db, "users"), where("email", "==", normalizedEmail)),
      );
      if (!existingUserSnap.empty) {
        setError("An account with this email already exists. Use a different email.");
        return;
      }

      if (form.type === "student") {
        const existingStudentSnap = await getDocs(
          query(collection(db, "students"), where("email", "==", normalizedEmail)),
        );
        if (!existingStudentSnap.empty) {
          setError("A student profile with this email already exists.");
          return;
        }
      }

      if (form.type === "teacher") {
        const existingTeacherSnap = await getDocs(
          query(collection(db, "teachers"), where("email", "==", normalizedEmail)),
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

      const admissionRef = doc(collection(db, "admissions"));
      batch.set(admissionRef, {
        type: form.type,
        name: form.name.trim(),
        email: normalizedEmail,
        password: form.password.trim(),
        grade: form.type === "student" ? form.grade.trim() : "",
        subject: form.type === "teacher" || form.type === "hod" ? form.subject.trim() : "",
        dob: form.dob || "",
        parentContact: form.parentContact || "",
        address: form.address || "",
        hodId: form.type === "student" ? form.hodId : "",
        hodIds: form.type === "teacher" ? form.selectedHodIds : [],
        assignedGrades: form.type === "hod" ? form.selectedGrades : [],
        hodAssignments,
        linkedUid: uid,
        photoData,
        photoName: form.photo?.name ?? "",
        documents: docEntries,
        createdAt: now,
      });

      if (form.type === "student") {
        const admissionGrade = form.grade.trim();
        batch.set(doc(db, "students", uid), {
          uid,
          name: form.name.trim(),
          email: normalizedEmail,
          DOB: form.dob || "",
          parentContact: form.parentContact || "",
          hodId: form.hodId,
          photo: photoData,
          address: form.address || "",
          admissionNo: buildStudentAdmissionNo(uid),
          createdAt: now,
        });

        const enrollmentRef = doc(collection(db, "enrollments"));
        batch.set(enrollmentRef, {
          studentId: uid,
          academicYear: getAcademicSession(),
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

      await batch.commit();
      linkedSaved = true;
      resetForm();
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admissions</h1>
          <p className="text-sm text-muted-foreground">Capture admission details and store attached documents (JPG/JPEG/PDF).</p>
        </div>
        <Badge variant="outline">{records.length} stored</Badge>
      </div>

      <Card>
        <CardContent className="pt-6">
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
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.type}
                  onChange={(e) => handleTypeChange(e.target.value as AdmissionType)}
                >
                  <option value="student">Student</option>
                  <option value="teacher">Teacher</option>
                  <option value="hod">HOD</option>
                  <option value="accountant">Accounts Staff</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  placeholder="Login password"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Date of Birth</Label>
                <Input type="date" value={form.dob} onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {form.type === "student"
                    ? "Grade"
                    : form.type === "teacher"
                      ? "Subject"
                      : form.type === "hod"
                        ? "Department"
                        : "Department / Role"}
                </Label>
                {form.type === "student" ? (
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.grade}
                    onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                    required
                  >
                    <option value="">Select grade</option>
                    {GRADES.map((g) => (
                      <option key={g} value={g}>
                        Grade {g}
                      </option>
                    ))}
                  </select>
                ) : form.type === "teacher" || form.type === "hod" ? (
                  <Input
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="e.g. Mathematics"
                    required
                  />
                ) : (
                  <Input
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="e.g. Accounts / Finance"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Phone / Contact</Label>
                <Input value={form.parentContact} onChange={(e) => setForm((f) => ({ ...f, parentContact: e.target.value }))} />
              </div>
            </div>

            {form.type === "student" ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Assign HOD *</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.hodId}
                    onChange={(e) => setForm((f) => ({ ...f, hodId: e.target.value }))}
                    required
                  >
                    <option value="">Select HOD</option>
                    {hods.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                  {hods.length === 0 && <p className="text-xs text-muted-foreground">Create HODs first to assign students.</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Address</Label>
                  <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
              </div>
            ) : form.type === "teacher" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Address</Label>
                  <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Assign HOD(s) *</Label>
                  <p className="text-xs text-muted-foreground">Select one or more HODs; grades are inherited from each HOD profile.</p>
                  {hods.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No HODs available. Create them first.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {hods.map((hod) => {
                        const selected = form.selectedHodIds.includes(hod.id);
                        const grades = getHodGrades(hod.id);
                        return (
                          <button
                            key={hod.id}
                            type="button"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                selectedHodIds: selected
                                  ? f.selectedHodIds.filter((id) => id !== hod.id)
                                  : [...f.selectedHodIds, hod.id],
                              }))
                            }
                            className={`flex items-start gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors ${
                              selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                            }`}
                          >
                            <div className="mt-0.5 h-3.5 w-3.5 rounded-sm border" data-state={selected ? "checked" : "unchecked"}>
                              <div className={`h-full w-full ${selected ? "bg-primary" : "bg-transparent"}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">{hod.name}</p>
                              <p className="text-xs text-muted-foreground">
                                Grades: {grades.length > 0 ? grades.join(", ") : "Not set"}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {form.selectedHodIds.length > 0 && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                      <p className="font-semibold mb-1">Coverage Summary</p>
                      {form.selectedHodIds.map((id) => {
                        const hod = hods.find((h) => h.id === id);
                        const grades = getHodGrades(id);
                        return (
                          <div key={id} className="flex items-center justify-between">
                            <span>{hod?.name ?? id}</span>
                            <span>{grades.length > 0 ? `Grades ${grades.join(", ")}` : "No grades"}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : form.type === "hod" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Address</Label>
                  <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Grades Managed *</Label>
                  <p className="text-xs text-muted-foreground">Select all grades this HOD will oversee.</p>
                  <div className="grid grid-cols-3 gap-2">
                    {GRADES.map((g) => {
                      const checked = form.selectedGrades.includes(g);
                      return (
                        <label
                          key={g}
                          className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${
                            checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary"
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
                          Grade {g}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Address</Label>
                  <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Input
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="Optional notes / role details"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Photo (JPG/JPEG)</Label>
                <Input type="file" accept=".jpg,.jpeg" onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)} />
                {form.photo ? (
                  <p className="text-xs text-muted-foreground">Selected: {form.photo.name}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Upload applicant photograph.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Documents (JPG/JPEG/PDF)</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="text"
                    className="flex-1"
                    placeholder="Document name (e.g. TC / ID proof)"
                    value={form.docLabel}
                    onChange={(e) => setForm((f) => ({ ...f, docLabel: e.target.value }))}
                  />
                  <Input
                    type="file"
                    accept=".jpg,.jpeg,.pdf"
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
                    Add document
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Enter a document name, attach the file, then click Add. Repeat for multiple uploads.</p>
                {form.documents.length > 0 && (
                  <ul className="space-y-2">
                    {form.documents.map((d, idx) => (
                      <li key={idx} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{d.label}</p>
                          <p className="text-xs text-muted-foreground truncate">{d.file.name}</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeDocument(idx)}>
                          <Trash2 size={16} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                Reset
              </Button>
              <Button type="submit" className="gap-2" disabled={saving}>
                <UploadCloud size={16} />
                {saving ? "Saving..." : "Save Admission"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-lg font-semibold">Stored Documents</p>
              <p className="text-sm text-muted-foreground">Download or review uploaded files.</p>
            </div>
          </div>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>
          ) : records.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No admissions yet.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {records.map((rec) => {
                const studentHod = rec.type === "student" && rec.hodId ? hods.find((h) => h.id === rec.hodId)?.name ?? rec.hodId : "";
                const teacherHods = rec.type === "teacher" ? rec.hodIds?.map((id) => hods.find((h) => h.id === id)?.name ?? id) ?? [] : [];
                const teacherGrades =
                  rec.type === "teacher"
                    ? Array.from(
                        new Set(
                          (rec.hodAssignments ?? []).flatMap((a) => a.grades ?? []),
                        ),
                      ).sort((a, b) => Number(a) - Number(b))
                    : rec.assignedGrades ?? [];
                return (
                  <div key={rec.id} className="rounded-xl border border-border p-4 flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      {rec.photoData ? (
                        <img src={rec.photoData} alt={rec.name} className="h-10 w-10 rounded-full object-cover border border-border" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          <FileText size={18} className="text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold truncate">{rec.name}</p>
                          <Badge variant="outline" className="capitalize">{rec.type}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{rec.email}</p>
                        {rec.parentContact ? <p className="text-xs text-muted-foreground">Phone: {rec.parentContact}</p> : null}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {rec.createdAt ? new Date(rec.createdAt).toLocaleDateString("en-IN") : ""}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      {rec.grade ? <Badge variant="secondary">Grade {rec.grade}</Badge> : null}
                      {rec.subject ? <Badge variant="secondary">{rec.subject}</Badge> : null}
                      {studentHod ? <Badge variant="outline">HOD: {studentHod}</Badge> : null}
                      {teacherHods.map((h) => (
                        <Badge key={h} variant="outline">
                          HOD: {h}
                        </Badge>
                      ))}
                      {teacherGrades.length > 0 ? <Badge variant="outline">Grades {teacherGrades.join(", ")}</Badge> : null}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">Documents</p>
                      {rec.documents?.length ? (
                        rec.documents.map((doc, idx) => (
                          <div key={idx} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{doc.label ?? doc.fileName}</p>
                              <p className="text-xs text-muted-foreground truncate">{doc.fileName}</p>
                            </div>
                            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadFile(doc)}>
                              <Download size={14} /> Download
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">No documents uploaded.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, setDoc } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { FeeHead, FeeInstallment, FeeStructure } from "@/lib/types";
import { getAcademicSession, sumFeeHeads, sumInstallments } from "@/lib/fees";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, CalendarDays, CreditCard, Plus, Trash2, Users } from "lucide-react";

const GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

interface StructureFormState {
  id: string | null;
  academicSession: string;
  grade: string;
  title: string;
  term: "term1" | "term2";
  notes: string;
  createdAt?: string;
}

function createFeeHead(index: number): FeeHead {
  return {
    id: `head-${Date.now()}-${index}`,
    name: "",
    amount: 0,
  };
}

function createInstallment(index: number): FeeInstallment {
  return {
    id: `inst-${Date.now()}-${index}`,
    label: "",
    amount: 0,
    dueDate: "",
  };
}

function formatCurrency(value: number) {
  return `Rs ${Math.round(value).toLocaleString("en-IN")}`;
}

export default function FeesManagement() {
  const { appUser } = useAuth();
  const currentSession = useMemo(() => getAcademicSession(), []);

  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loadingStructures, setLoadingStructures] = useState(true);
  const [savingStructure, setSavingStructure] = useState(false);
  const [formError, setFormError] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [form, setForm] = useState<StructureFormState>({
    id: null,
    academicSession: currentSession,
    grade: "",
    title: "",
    term: "term1",
    notes: "",
  });
  const [feeHeads, setFeeHeads] = useState<FeeHead[]>([createFeeHead(0)]);
  const [installments, setInstallments] = useState<FeeInstallment[]>([createInstallment(0)]);

  const configuredAmount = sumFeeHeads({ feeHeads });
  const scheduledAmount = sumInstallments({ installments });

  const currentSessionStructures = useMemo(
    () => structures.filter((structure) => structure.academicSession === currentSession),
    [currentSession, structures],
  );

  const totalConfiguredForSession = currentSessionStructures.reduce(
    (total, structure) => total + sumInstallments(structure),
    0,
  );

  const loadStructures = async () => {
    setLoadingStructures(true);
    try {
      const snapshot = await getDocs(collection(db, "feeStructures"));
      const records = snapshot.docs
        .map((record) => ({ id: record.id, ...record.data() } as FeeStructure))
        .sort((a, b) => {
          const right = b.updatedAt ?? b.createdAt ?? "";
          const left = a.updatedAt ?? a.createdAt ?? "";
          return right.localeCompare(left);
        });
      setStructures(records);
    } finally {
      setLoadingStructures(false);
    }
  };

  useEffect(() => {
    void loadStructures();
  }, []);

  const resetStructureForm = () => {
    setForm({
      id: null,
      academicSession: currentSession,
      grade: "",
      title: "",
      term: "term1",
      notes: "",
    });
    setFeeHeads([createFeeHead(0)]);
    setInstallments([createInstallment(0)]);
    setFormError("");
  };

  const handleEdit = (structure: FeeStructure) => {
    setPageMessage("");
    setForm({
      id: structure.id,
      academicSession: structure.academicSession,
      grade: structure.grade,
      title: structure.title,
      term: structure.term === "term2" ? "term2" : "term1",
      notes: structure.notes ?? "",
      createdAt: structure.createdAt,
    });
    setFeeHeads(structure.feeHeads.length > 0 ? structure.feeHeads : [createFeeHead(0)]);
    setInstallments(structure.installments.length > 0 ? structure.installments : [createInstallment(0)]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSaveStructure = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    setPageMessage("");

    const cleanedHeads = feeHeads
      .map((head, index) => ({
        ...head,
        id: head.id || `head-${Date.now()}-${index}`,
        name: head.name.trim(),
        amount: Number(head.amount) || 0,
      }))
      .filter((head) => head.name && head.amount > 0);

    const cleanedInstallments = installments
      .map((installment, index) => ({
        ...installment,
        id: installment.id || `inst-${Date.now()}-${index}`,
        label: installment.label.trim(),
        amount: Number(installment.amount) || 0,
        dueDate: installment.dueDate,
      }))
      .filter((installment) => installment.label && installment.amount > 0 && installment.dueDate);

    if (!form.grade || !form.title.trim() || !form.academicSession.trim()) {
      setFormError("Academic session, class, and structure title are required.");
      return;
    }

    if (cleanedHeads.length === 0) {
      setFormError("Add at least one fee head such as tuition, books, transport, or uniform.");
      return;
    }

    if (cleanedInstallments.length === 0) {
      setFormError("Add at least one installment with amount and due date.");
      return;
    }

    const headsTotal = sumFeeHeads({ feeHeads: cleanedHeads });
    const installmentsTotal = sumInstallments({ installments: cleanedInstallments });

    if (headsTotal !== installmentsTotal) {
      setFormError("Installment total must exactly match the total of all fee heads.");
      return;
    }

    setSavingStructure(true);
    try {
      const now = new Date().toISOString();
      const payload = {
        academicSession: form.academicSession.trim(),
        grade: form.grade,
        title: form.title.trim(),
        term: form.term,
        notes: form.notes.trim(),
        feeHeads: cleanedHeads,
        installments: cleanedInstallments,
        createdBy: appUser?.id ?? "",
        createdAt: form.createdAt ?? now,
        updatedAt: now,
      };

      if (form.id) {
        await setDoc(doc(db, "feeStructures", form.id), payload, { merge: true });
        setPageMessage("Fee structure updated successfully.");
      } else {
        await addDoc(collection(db, "feeStructures"), payload);
        setPageMessage("Fee structure created successfully.");
      }

      resetStructureForm();
      await loadStructures();
    } catch (error) {
      console.error(error);
      setFormError("Unable to save the fee structure right now.");
    } finally {
      setSavingStructure(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fees Management</h1>
          <p className="text-sm text-muted-foreground">
            Build class-wise fee structures, define monthly due dates, and publish them for collections.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={<BookOpen size={18} className="text-blue-600" />}
            label="Current Session"
            value={currentSession}
            subtext={`${currentSessionStructures.length} structure${currentSessionStructures.length === 1 ? "" : "s"}`}
            tone="bg-blue-50"
          />
          <SummaryCard
            icon={<CalendarDays size={18} className="text-amber-600" />}
            label="Configured Amount"
            value={formatCurrency(totalConfiguredForSession)}
            subtext="Across current session structures"
            tone="bg-amber-50"
          />
          <SummaryCard
            icon={<Users size={18} className="text-emerald-600" />}
            label="Published Classes"
            value={String(new Set(currentSessionStructures.map((item) => item.grade)).size)}
            subtext="Classes with active fee setup"
            tone="bg-emerald-50"
          />
        </div>
      </div>

      {pageMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {pageMessage}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardContent className="pt-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold">
                {form.id ? "Edit Fee Structure" : "Create Fee Structure"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Define fee heads like tuition, books, uniform, transport, then map them into due-date based installments.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSaveStructure}>
              {formError ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {formError}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Academic Session</Label>
                  <Input
                    value={form.academicSession}
                    onChange={(event) => setForm((current) => ({ ...current, academicSession: event.target.value }))}
                    placeholder="2026-27"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Class</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.grade}
                    onChange={(event) => setForm((current) => ({ ...current, grade: event.target.value }))}
                    required
                  >
                    <option value="">Select class</option>
                    {GRADES.map((grade) => (
                      <option key={grade} value={grade}>
                        Grade {grade}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Structure Title</Label>
                  <Input
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Grade 6 Fee Plan"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Term</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.term}
                    onChange={(event) => setForm((current) => ({ ...current, term: event.target.value as StructureFormState["term"] }))}
                  >
                    <option value="term1">Term 1</option>
                    <option value="term2">Term 2</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Fee Heads</Label>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setFeeHeads((current) => [...current, createFeeHead(current.length)])}
                  >
                    <Plus size={15} />
                    Add Head
                  </Button>
                </div>
                <div className="space-y-3">
                  {feeHeads.map((head, index) => (
                    <div key={head.id} className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 md:grid-cols-[1.2fr_0.8fr_auto]">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Head Name</Label>
                        <Input
                          value={head.name}
                          onChange={(event) =>
                            setFeeHeads((current) => {
                              const next = [...current];
                              next[index] = { ...next[index], name: event.target.value };
                              return next;
                            })
                          }
                          placeholder="Transport / Books / Tuition"
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Amount</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={head.amount}
                          onChange={(event) =>
                            setFeeHeads((current) => {
                              const next = [...current];
                              next[index] = { ...next[index], amount: Number(event.target.value) || 0 };
                              return next;
                            })
                          }
                          placeholder="0"
                          required
                        />
                      </div>
                      <div className="flex items-end justify-end">
                        {feeHeads.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setFeeHeads((current) => current.filter((_, idx) => idx !== index))
                            }
                          >
                            <Trash2 size={16} />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Installments and Due Dates</Label>
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setInstallments((current) => [...current, createInstallment(current.length)])}
                  >
                    <Plus size={15} />
                    Add Installment
                  </Button>
                </div>

                <div className="space-y-3">
                  {installments.map((installment, index) => (
                    <div key={installment.id} className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 md:grid-cols-[1.1fr_0.7fr_0.7fr_auto]">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Label</Label>
                        <Input
                          value={installment.label}
                          onChange={(event) =>
                            setInstallments((current) => {
                              const next = [...current];
                              next[index] = { ...next[index], label: event.target.value };
                              return next;
                            })
                          }
                          placeholder="April Installment"
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Amount</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={installment.amount}
                          onChange={(event) =>
                            setInstallments((current) => {
                              const next = [...current];
                              next[index] = { ...next[index], amount: Number(event.target.value) || 0 };
                              return next;
                            })
                          }
                          placeholder="0"
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Due Date</Label>
                        <Input
                          type="date"
                          value={installment.dueDate}
                          onChange={(event) =>
                            setInstallments((current) => {
                              const next = [...current];
                              next[index] = { ...next[index], dueDate: event.target.value };
                              return next;
                            })
                          }
                          required
                        />
                      </div>
                      <div className="flex items-end justify-end">
                        {installments.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setInstallments((current) => current.filter((_, idx) => idx !== index))
                            }
                          >
                            <Trash2 size={16} />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-xl bg-muted/40 p-4 text-sm md:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Heads Total</p>
                  <p className="mt-1 text-lg font-semibold">{formatCurrency(configuredAmount)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Installments Total</p>
                  <p className="mt-1 text-lg font-semibold">{formatCurrency(scheduledAmount)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
                  <p className={`mt-1 text-sm font-medium ${configuredAmount === scheduledAmount ? "text-emerald-600" : "text-amber-600"}`}>
                    {configuredAmount === scheduledAmount ? "Ready to publish" : "Match installment total to fee heads"}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Optional instructions for the accounts team or parents."
                />
              </div>

              <div className="flex flex-wrap justify-end gap-3">
                {form.id ? (
                  <Button type="button" variant="outline" onClick={resetStructureForm}>
                    Cancel Edit
                  </Button>
                ) : null}
                <Button className="gap-2" disabled={savingStructure} type="submit">
                  <CreditCard size={16} />
                  {savingStructure ? "Saving..." : form.id ? "Update Structure" : "Save Structure"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Saved Structures</h2>
                <p className="text-sm text-muted-foreground">
                  Review each class plan and jump straight into collections.
                </p>
              </div>
              <Badge variant="outline">{structures.length} total</Badge>
            </div>

            {loadingStructures ? (
              <div className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Loading fee structures...
              </div>
            ) : currentSessionStructures.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                No fee structures yet. Create the first class plan to start the fees workflow.
              </div>
            ) : (
              <div className="space-y-3">
                {currentSessionStructures.map((structure) => (
                  <div key={structure.id} className="rounded-2xl border border-border p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge>{structure.academicSession}</Badge>
                      <Badge variant="outline">Grade {structure.grade}</Badge>
                      <Badge variant="outline">
                        {structure.term === "term1" ? "Term 1" : structure.term === "term2" ? "Term 2" : "Full Year"}
                      </Badge>
                      <Badge variant="outline">{structure.installments.length} installments</Badge>
                    </div>

                    <div className="mb-3">
                      <p className="font-semibold">{structure.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {structure.feeHeads.length} head{structure.feeHeads.length === 1 ? "" : "s"} configured
                      </p>
                    </div>

                    <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/30 p-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Total</p>
                        <p className="font-semibold">{formatCurrency(sumInstallments(structure))}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Updated</p>
                        <p className="font-semibold">
                          {(structure.updatedAt ?? structure.createdAt ?? "").slice(0, 10) || "Not set"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleEdit(structure)}>
                        Edit Structure
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          window.location.href = `/accounts/collections?structureId=${structure.id}`;
                        }}
                      >
                        Open Collections
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subtext,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext: string;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold">{value}</p>
            <p className="text-xs text-muted-foreground">{subtext}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

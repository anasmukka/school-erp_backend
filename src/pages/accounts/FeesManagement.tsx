import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import { FeeHead, FeeInstallment, FeeStructure, FeeStructureTerm } from "@/lib/types";
import {
  getAcademicSession,
  getAvailableTermsForSession,
  normalizeFeeStructureTerms,
  sumFeeHeads,
  sumInstallments,
  validateFeeStructureSession,
} from "@/lib/fees";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePaymentCapability } from "@/lib/payments";
import { OnlinePaymentStatusBadge } from "@/components/OnlinePaymentStatus";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calendar,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Layers,
  Plus,
  Trash2,
  Users,
} from "lucide-react";

const GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

interface FormInstallment {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  order: number;
}

interface FormTerm {
  termId: string;
  termName: string;
  order: number;
  installments: FormInstallment[];
}

interface StructureFormState {
  id: string | null;
  academicSessionId: string;
  academicSession: string;
  grade: string;
  title: string;
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

function createFormInstallment(order: number): FormInstallment {
  return {
    id: `inst-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    label: `Installment ${order}`,
    amount: 0,
    dueDate: "",
    order,
  };
}

function formatCurrency(value: number) {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export default function FeesManagement() {
  const { appUser } = useAuth();
  const paymentCap = usePaymentCapability();
  const { sessions, activeSession, workingSession, loading: sessionsLoading } = useAcademicSession();
  const currentSession = useMemo(() => getAcademicSession(), []);

  // Canonical active session defaults
  const defaultSession = useMemo(() => {
    return (
      activeSession ||
      workingSession ||
      sessions.find((s) => s.isCurrent || s.status === "active") ||
      sessions[0] ||
      null
    );
  }, [activeSession, workingSession, sessions]);

  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [loadingStructures, setLoadingStructures] = useState(true);
  const [savingStructure, setSavingStructure] = useState(false);
  const [formError, setFormError] = useState("");
  const [pageMessage, setPageMessage] = useState("");
  const [filterSessionId, setFilterSessionId] = useState<string>("active");

  const [availableTerms, setAvailableTerms] = useState<Array<{ id: string; name: string; code: string; order: number }>>([
    { id: "term_1", name: "Term 1", code: "T1", order: 1 },
    { id: "term_2", name: "Term 2", code: "T2", order: 2 },
  ]);

  const [form, setForm] = useState<StructureFormState>({
    id: null,
    academicSessionId: defaultSession?.id || "",
    academicSession: defaultSession?.name || currentSession,
    grade: "",
    title: "",
    notes: "",
  });

  // Sync form with canonical active session once sessions are loaded (if not editing an existing structure)
  useEffect(() => {
    if (!form.id && !form.academicSessionId && defaultSession) {
      setForm((current) => ({
        ...current,
        academicSessionId: defaultSession.id,
        academicSession: defaultSession.name,
      }));
    }
  }, [defaultSession, form.id, form.academicSessionId]);

  const [feeHeads, setFeeHeads] = useState<FeeHead[]>([createFeeHead(0)]);

  // The hierarchical terms state: Term is parent, installments belong to term
  const [formTerms, setFormTerms] = useState<FormTerm[]>([
    {
      termId: "term_1",
      termName: "Term 1",
      order: 1,
      installments: [createFormInstallment(1)],
    },
  ]);

  // Load available canonical terms when session or grade changes
  useEffect(() => {
    let isMounted = true;
    async function loadTerms() {
      const sessionIdToQuery = form.academicSessionId || form.academicSession;
      if (!sessionIdToQuery) return;
      const terms = await getAvailableTermsForSession(sessionIdToQuery, form.grade || undefined);
      if (isMounted && terms && terms.length > 0) {
        setAvailableTerms(terms);
      }
    }
    void loadTerms();
    return () => {
      isMounted = false;
    };
  }, [form.academicSessionId, form.academicSession, form.grade]);

  // Calculate totals
  const configuredAmount = sumFeeHeads({ feeHeads });
  const scheduledAmount = useMemo(() => {
    return formTerms.reduce((sum, term) => {
      return sum + term.installments.reduce((termSum, inst) => termSum + (Number(inst.amount) || 0), 0);
    }, 0);
  }, [formTerms]);

  const effectiveCurrentSessionName = activeSession?.name || workingSession?.name || currentSession;
  const effectiveCurrentSessionId = activeSession?.id || workingSession?.id;

  const currentSessionStructures = useMemo(
    () =>
      structures.filter(
        (structure) =>
          (effectiveCurrentSessionId && structure.academicSessionId === effectiveCurrentSessionId) ||
          structure.academicSession === effectiveCurrentSessionName,
      ),
    [effectiveCurrentSessionId, effectiveCurrentSessionName, structures],
  );

  const displayedStructures = useMemo(() => {
    if (filterSessionId === "all") return structures;
    if (filterSessionId === "active") return currentSessionStructures;
    return structures.filter(
      (s) => s.academicSessionId === filterSessionId || s.academicSession === filterSessionId,
    );
  }, [filterSessionId, structures, currentSessionStructures]);

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
    const targetSession =
      defaultSession || sessions.find((s) => s.isCurrent || s.status === "active") || sessions[0];
    setForm({
      id: null,
      academicSessionId: targetSession?.id || "",
      academicSession: targetSession?.name || currentSession,
      grade: "",
      title: "",
      notes: "",
    });
    setFeeHeads([createFeeHead(0)]);
    setFormTerms([
      {
        termId: "term_1",
        termName: "Term 1",
        order: 1,
        installments: [createFormInstallment(1)],
      },
    ]);
    setFormError("");
  };

  const handleEdit = (structure: FeeStructure) => {
    setPageMessage("");
    setFormError("");
    const matchedSession = sessions.find(
      (s) =>
        s.id === structure.academicSessionId ||
        s.name === structure.academicSession ||
        s.id === structure.academicSession,
    );
    setForm({
      id: structure.id,
      academicSessionId: structure.academicSessionId || matchedSession?.id || structure.academicSession,
      academicSession: matchedSession?.name || structure.academicSession,
      grade: structure.grade,
      title: structure.title,
      notes: structure.notes ?? "",
      createdAt: structure.createdAt,
    });

    setFeeHeads(structure.feeHeads?.length > 0 ? structure.feeHeads : [createFeeHead(0)]);

    // Safely normalize existing structure into Term -> Installment hierarchy
    const normalized = normalizeFeeStructureTerms(structure);
    setFormTerms(
      normalized.map((t) => ({
        termId: t.termId,
        termName: t.termName,
        order: t.order,
        installments: t.installments.map((inst, idx) => ({
          id: inst.id,
          label: inst.label,
          amount: Number(inst.amount) || 0,
          dueDate: inst.dueDate,
          order: inst.order ?? idx + 1,
        })),
      })),
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Add a new Term section
  const handleAddTerm = (termConfig: { id: string; name: string; order: number }) => {
    // Check if term already added
    if (formTerms.some((t) => t.termId === termConfig.id)) {
      setFormError(`${termConfig.name} is already added to this fee structure.`);
      return;
    }

    const newOrder = formTerms.length + 1;
    const newTerm: FormTerm = {
      termId: termConfig.id,
      termName: termConfig.name,
      order: termConfig.order ?? newOrder,
      installments: [createFormInstallment(1)],
    };

    const nextTerms = [...formTerms, newTerm].sort((a, b) => a.order - b.order);
    setFormTerms(nextTerms);
    setFormError("");
  };

  // Remove a Term section with safety check against orphaned records
  const handleRemoveTerm = async (termIndex: number) => {
    if (formTerms.length <= 1) {
      setFormError("A fee structure must contain at least one term.");
      return;
    }

    const targetTerm = formTerms[termIndex];

    // If editing an existing structure, check if finalized student assignments reference this term
    if (form.id) {
      try {
        const q = query(
          collection(db, "studentFeeAssignments"),
          where("structureId", "==", form.id),
          where("status", "==", "active"),
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          // Check if any active assignment uses an installment from this term
          const termInstallmentIds = new Set(targetTerm.installments.map((i) => i.id));
          const hasConflict = snap.docs.some((docSnap) => {
            const data = docSnap.data();
            const insts = data.installments || [];
            return insts.some(
              (i: any) =>
                termInstallmentIds.has(i.id) ||
                i.termId === targetTerm.termId ||
                i.termName === targetTerm.termName,
            );
          });

          if (hasConflict) {
            setFormError(
              `Cannot delete ${targetTerm.termName} because active student fee assignments reference its installments. Destructive deletion is blocked to prevent orphaning historical financial records.`,
            );
            return;
          }
        }
      } catch (err) {
        console.warn("Could not verify assignment usage before deleting term:", err);
      }
    }

    setFormTerms((current) => current.filter((_, idx) => idx !== termIndex));
    setFormError("");
  };

  // Move term order up or down
  const handleMoveTerm = (termIndex: number, direction: "up" | "down") => {
    if (
      (direction === "up" && termIndex === 0) ||
      (direction === "down" && termIndex === formTerms.length - 1)
    ) {
      return;
    }
    const targetIndex = direction === "up" ? termIndex - 1 : termIndex + 1;
    const nextTerms = [...formTerms];
    const temp = nextTerms[termIndex];
    nextTerms[termIndex] = nextTerms[targetIndex];
    nextTerms[targetIndex] = temp;

    // Re-assign explicit orders
    nextTerms.forEach((t, idx) => {
      t.order = idx + 1;
    });

    setFormTerms(nextTerms);
  };

  // Add an installment directly under a parent Term
  const handleAddInstallmentToTerm = (termIndex: number) => {
    setFormTerms((current) => {
      const next = [...current];
      const targetTerm = { ...next[termIndex] };
      const newOrder = targetTerm.installments.length + 1;
      targetTerm.installments = [
        ...targetTerm.installments,
        createFormInstallment(newOrder),
      ];
      next[termIndex] = targetTerm;
      return next;
    });
  };

  // Update an installment inside its parent Term
  const handleUpdateInstallment = (
    termIndex: number,
    installmentIndex: number,
    field: keyof FormInstallment,
    value: string | number,
  ) => {
    setFormTerms((current) => {
      const next = [...current];
      const targetTerm = { ...next[termIndex] };
      const nextInsts = [...targetTerm.installments];
      nextInsts[installmentIndex] = {
        ...nextInsts[installmentIndex],
        [field]: value,
      };
      targetTerm.installments = nextInsts;
      next[termIndex] = targetTerm;
      return next;
    });
  };

  // Delete an installment from inside its parent Term
  const handleDeleteInstallmentFromTerm = (termIndex: number, installmentIndex: number) => {
    setFormTerms((current) => {
      const next = [...current];
      const targetTerm = { ...next[termIndex] };
      if (targetTerm.installments.length <= 1) {
        setFormError(`Each term must retain at least one installment.`);
        return current;
      }
      targetTerm.installments = targetTerm.installments
        .filter((_, idx) => idx !== installmentIndex)
        .map((inst, idx) => ({ ...inst, order: idx + 1 }));
      next[termIndex] = targetTerm;
      return next;
    });
  };

  // Move installment up or down within its term
  const handleMoveInstallment = (
    termIndex: number,
    installmentIndex: number,
    direction: "up" | "down",
  ) => {
    setFormTerms((current) => {
      const next = [...current];
      const targetTerm = { ...next[termIndex] };
      const insts = [...targetTerm.installments];
      if (
        (direction === "up" && installmentIndex === 0) ||
        (direction === "down" && installmentIndex === insts.length - 1)
      ) {
        return current;
      }
      const targetIdx = direction === "up" ? installmentIndex - 1 : installmentIndex + 1;
      const temp = insts[installmentIndex];
      insts[installmentIndex] = insts[targetIdx];
      insts[targetIdx] = temp;
      insts.forEach((inst, idx) => {
        inst.order = idx + 1;
      });
      targetTerm.installments = insts;
      next[termIndex] = targetTerm;
      return next;
    });
  };

  // Available terms that have not been added yet
  const unaddedTerms = availableTerms.filter(
    (at) => !formTerms.some((ft) => ft.termId === at.id),
  );

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

    if (!form.grade || !form.title.trim() || (!form.academicSessionId && !form.academicSession.trim())) {
      setFormError("Academic session, class, and structure title are required.");
      return;
    }

    // Backend / Canonical session integrity check
    const sessionKeyToValidate = form.academicSessionId || form.academicSession;
    const sessionValidation = await validateFeeStructureSession(sessionKeyToValidate);
    if (!sessionValidation.valid || !sessionValidation.session) {
      setFormError(sessionValidation.error || "The selected academic session is invalid or does not exist.");
      return;
    }
    const canonicalSession = sessionValidation.session;

    if (cleanedHeads.length === 0) {
      setFormError("Add at least one fee head such as tuition, books, transport, or uniform.");
      return;
    }

    if (formTerms.length === 0) {
      setFormError("Add at least one term to the fee structure.");
      return;
    }

    // Clean and validate terms & installments
    let hasInvalidInstallment = false;
    let invalidMessage = "";

    const cleanedTerms: FeeStructureTerm[] = formTerms.map((term, termIdx) => {
      const validInsts: FeeInstallment[] = [];
      term.installments.forEach((inst, instIdx) => {
        const numAmount = Number(inst.amount) || 0;
        const cleanLabel = inst.label.trim();
        const dueDate = inst.dueDate ? String(inst.dueDate).trim() : "";

        if (!cleanLabel) {
          hasInvalidInstallment = true;
          invalidMessage = `Installment in ${term.termName} requires a descriptive label.`;
        } else if (numAmount <= 0) {
          hasInvalidInstallment = true;
          invalidMessage = `Amount for ${cleanLabel} in ${term.termName} must be greater than zero.`;
        } else if (!dueDate) {
          hasInvalidInstallment = true;
          invalidMessage = `Due date for ${cleanLabel} in ${term.termName} is required.`;
        }

        validInsts.push({
          id: inst.id || `inst-${Date.now()}-${termIdx}-${instIdx}`,
          label: cleanLabel,
          amount: numAmount,
          dueDate,
          termId: term.termId,
          termName: term.termName,
          order: inst.order ?? instIdx + 1,
        });
      });

      if (validInsts.length === 0) {
        hasInvalidInstallment = true;
        invalidMessage = `${term.termName} must contain at least one valid installment.`;
      }

      return {
        termId: term.termId,
        termName: term.termName,
        order: term.order ?? termIdx + 1,
        installments: validInsts,
      };
    });

    if (hasInvalidInstallment) {
      setFormError(invalidMessage || "Please fill all required installment details.");
      return;
    }

    // Flatten installments for backward compatibility with existing readers
    const flattenedInstallments: FeeInstallment[] = cleanedTerms.flatMap((term) => term.installments);

    const headsTotal = sumFeeHeads({ feeHeads: cleanedHeads });
    const installmentsTotal = sumInstallments({ terms: cleanedTerms });

    if (headsTotal !== installmentsTotal) {
      setFormError(
        `Total installments (${formatCurrency(installmentsTotal)}) must exactly match total fee heads (${formatCurrency(headsTotal)}). Difference: ${formatCurrency(Math.abs(headsTotal - installmentsTotal))}.`,
      );
      return;
    }

    // Determine legacy term fallback representation
    let legacyTermValue: "term1" | "term2" | "full_year" = "full_year";
    if (cleanedTerms.length === 1) {
      if (cleanedTerms[0].termId === "term_2" || cleanedTerms[0].termName.toLowerCase().includes("2")) {
        legacyTermValue = "term2";
      } else {
        legacyTermValue = "term1";
      }
    }

    setSavingStructure(true);
    try {
      const now = new Date().toISOString();
      const payload: Omit<FeeStructure, "id"> = {
        academicSessionId: canonicalSession.id,
        academicSession: canonicalSession.name,
        grade: form.grade,
        title: form.title.trim(),
        term: legacyTermValue,
        notes: form.notes.trim(),
        feeHeads: cleanedHeads,
        terms: cleanedTerms,
        installments: flattenedInstallments,
        createdBy: appUser?.id ?? "",
        createdAt: form.createdAt ?? now,
        updatedAt: now,
      };

      if (form.id) {
        await setDoc(doc(db, "feeStructures", form.id), payload, { merge: true });
        setPageMessage("Fee structure updated successfully with Term → Installment hierarchy.");
      } else {
        await addDoc(collection(db, "feeStructures"), payload);
        setPageMessage("Fee structure created successfully with Term → Installment hierarchy.");
      }

      resetStructureForm();
      await loadStructures();
    } catch (error) {
      console.error(error);
      setFormError("Unable to save the fee structure right now. Please try again.");
    } finally {
      setSavingStructure(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold">Fee Structures</h1>
            <OnlinePaymentStatusBadge
              status={paymentCap.capability?.status}
              provider={paymentCap.capability?.provider}
            />
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure reusable master class fee plans with terms as parent groups and due-date installments.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Button
              size="sm"
              onClick={() => {
                window.location.href = "/accounts/student-fees";
              }}
              className="text-xs"
            >
              <CreditCard size={14} className="mr-1.5" />
              Student Fee Assignments & Ledger
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = "/accounts/collections";
              }}
              className="text-xs"
            >
              Collections Counter
            </Button>
          </div>
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
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span>{pageMessage}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardContent className="pt-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Layers size={18} className="text-primary" />
                {form.id ? "Edit Fee Structure" : "Create Fee Structure"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Define master fee heads, organize installments under canonical academic terms, and balance schedules.
              </p>
            </div>

            <form className="space-y-6" onSubmit={handleSaveStructure}>
              {formError ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0 text-destructive" />
                  <span>{formError}</span>
                </div>
              ) : null}

              {/* Master Plan Details */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="academic-session-select">Academic Session</Label>
                  <select
                    id="academic-session-select"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-ring focus:border-input disabled:cursor-not-allowed disabled:opacity-50"
                    value={
                      form.academicSessionId ||
                      sessions.find((s) => s.name === form.academicSession)?.id ||
                      form.academicSession
                    }
                    onChange={(event) => {
                      const selectedId = event.target.value;
                      const selectedObj = sessions.find((s) => s.id === selectedId || s.name === selectedId);
                      setForm((current) => ({
                        ...current,
                        academicSessionId: selectedObj ? selectedObj.id : selectedId,
                        academicSession: selectedObj ? selectedObj.name : selectedId,
                      }));
                    }}
                    required
                  >
                    {sessions.length === 0 ? (
                      <option value="">Loading sessions...</option>
                    ) : (
                      sessions.map((session) => {
                        const isCurrentActive = session.isCurrent || session.status === "active";
                        const statusBadge = isCurrentActive
                          ? "(Active)"
                          : session.status === "archived"
                          ? "(Archived)"
                          : "(Upcoming)";
                        return (
                          <option key={session.id} value={session.id}>
                            {session.name} {statusBadge}
                          </option>
                        );
                      })
                    )}
                  </select>
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
                    placeholder="Grade 1 Annual Fees"
                    required
                  />
                </div>
              </div>

              {/* SECTION: FEE HEADS */}
              <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <div>
                    <h3 className="font-semibold text-sm">Fee Heads</h3>
                    <p className="text-xs text-muted-foreground">Components that make up the total annual fee</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs h-8"
                    onClick={() => setFeeHeads((current) => [...current, createFeeHead(current.length)])}
                  >
                    <Plus size={14} />
                    Add Head
                  </Button>
                </div>

                <div className="space-y-2.5">
                  {feeHeads.map((head, index) => (
                    <div
                      key={head.id}
                      className="grid grid-cols-1 gap-3 rounded-xl border border-muted bg-muted/20 p-2.5 md:grid-cols-[1.2fr_0.8fr_auto]"
                    >
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Head Name</Label>
                        <Input
                          value={head.name}
                          onChange={(event) =>
                            setFeeHeads((current) => {
                              const next = [...current];
                              next[index] = { ...next[index], name: event.target.value };
                              return next;
                            })
                          }
                          placeholder="Tuition / Transport / Technology"
                          required
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Amount (₹)</Label>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={head.amount || ""}
                          onChange={(event) =>
                            setFeeHeads((current) => {
                              const next = [...current];
                              next[index] = { ...next[index], amount: Number(event.target.value) || 0 };
                              return next;
                            })
                          }
                          placeholder="60000"
                          required
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="flex items-end justify-end">
                        {feeHeads.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setFeeHeads((current) => current.filter((_, idx) => idx !== index))}
                          >
                            <Trash2 size={15} />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between items-center pt-2 text-xs border-t font-medium">
                  <span className="text-muted-foreground">Total Fee Heads:</span>
                  <span className="font-semibold text-sm">{formatCurrency(configuredAmount)}</span>
                </div>
              </div>

              {/* SECTION: TERMS & INSTALLMENTS HIERARCHY */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-base">Terms & Installments Schedule</h3>
                    <p className="text-xs text-muted-foreground">
                      Installments are organized UNDER their parent academic term.
                    </p>
                  </div>
                </div>

                {/* Iterate over each parent Term */}
                {formTerms.map((term, termIdx) => {
                  const termSubtotal = term.installments.reduce(
                    (sum, inst) => sum + (Number(inst.amount) || 0),
                    0,
                  );

                  return (
                    <div
                      key={term.termId}
                      className="rounded-2xl border-2 border-primary/20 bg-card overflow-hidden shadow-xs"
                    >
                      {/* Term Group Header */}
                      <div className="bg-primary/5 border-b border-primary/15 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
                            {term.order}
                          </span>
                          <div>
                            <span className="font-bold text-sm tracking-wide text-foreground uppercase">
                              {term.termName}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2">
                              ({term.installments.length} installment{term.installments.length === 1 ? "" : "s"})
                            </span>
                          </div>
                          <Badge variant="secondary" className="font-semibold text-xs ml-1">
                            {formatCurrency(termSubtotal)}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={termIdx === 0}
                            onClick={() => handleMoveTerm(termIdx, "up")}
                            title="Move Term Up"
                          >
                            <ArrowUp size={14} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={termIdx === formTerms.length - 1}
                            onClick={() => handleMoveTerm(termIdx, "down")}
                            title="Move Term Down"
                          >
                            <ArrowDown size={14} />
                          </Button>
                          {formTerms.length > 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive hover:bg-destructive/10"
                              onClick={() => handleRemoveTerm(termIdx)}
                            >
                              <Trash2 size={13} className="mr-1" />
                              Remove Term
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {/* Installments inside this Term */}
                      <div className="p-4 space-y-3">
                        <div className="space-y-2.5">
                          {term.installments.map((inst, instIdx) => (
                            <div
                              key={inst.id}
                              className="grid grid-cols-1 gap-2.5 rounded-xl border border-border/70 bg-muted/10 p-3 md:grid-cols-[1.2fr_0.7fr_0.8fr_auto] items-end"
                            >
                              <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Installment Label</Label>
                                <Input
                                  value={inst.label}
                                  onChange={(e) =>
                                    handleUpdateInstallment(termIdx, instIdx, "label", e.target.value)
                                  }
                                  placeholder={`Installment ${instIdx + 1}`}
                                  required
                                  className="h-8 text-sm"
                                />
                              </div>

                              <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Amount (₹)</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={inst.amount || ""}
                                  onChange={(e) =>
                                    handleUpdateInstallment(
                                      termIdx,
                                      instIdx,
                                      "amount",
                                      Number(e.target.value) || 0,
                                    )
                                  }
                                  placeholder="15000"
                                  required
                                  className="h-8 text-sm"
                                />
                              </div>

                              <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Due Date</Label>
                                <Input
                                  type="date"
                                  value={inst.dueDate}
                                  onChange={(e) =>
                                    handleUpdateInstallment(termIdx, instIdx, "dueDate", e.target.value)
                                  }
                                  required
                                  className="h-8 text-sm"
                                />
                              </div>

                              <div className="flex items-center gap-1 justify-end">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground"
                                  disabled={instIdx === 0}
                                  onClick={() => handleMoveInstallment(termIdx, instIdx, "up")}
                                  title="Move Up"
                                >
                                  <ArrowUp size={13} />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground"
                                  disabled={instIdx === term.installments.length - 1}
                                  onClick={() => handleMoveInstallment(termIdx, instIdx, "down")}
                                  title="Move Down"
                                >
                                  <ArrowDown size={13} />
                                </Button>
                                {term.installments.length > 1 ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleDeleteInstallmentFromTerm(termIdx, instIdx)}
                                    title="Delete Installment"
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Add Installment inside this specific Term */}
                        <div className="pt-1 flex items-center justify-between">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs h-8 border-dashed"
                            onClick={() => handleAddInstallmentToTerm(termIdx)}
                          >
                            <Plus size={13} />
                            Add Installment to {term.termName}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {term.termName} Subtotal: <strong>{formatCurrency(termSubtotal)}</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Add Term Section */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {unaddedTerms.length > 0 ? (
                    unaddedTerms.map((termOption) => (
                      <Button
                        key={termOption.id}
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5 text-xs"
                        onClick={() => handleAddTerm(termOption)}
                      >
                        <Plus size={14} />
                        Add {termOption.name} Section
                      </Button>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      All canonical academic terms ({availableTerms.map((t) => t.name).join(", ")}) have been added to this fee structure.
                    </p>
                  )}
                </div>
              </div>

              {/* RECONCILIATION SUMMARY */}
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-muted/20 p-4 md:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Fee Heads</p>
                  <p className="mt-1 text-lg font-bold">{formatCurrency(configuredAmount)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Installments Total</p>
                  <p className="mt-1 text-lg font-bold">{formatCurrency(scheduledAmount)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Balance Status</p>
                  {configuredAmount === scheduledAmount && configuredAmount > 0 ? (
                    <div className="mt-1 flex items-center gap-1.5 text-emerald-600 font-semibold text-sm">
                      <CheckCircle2 size={16} />
                      <span>✓ Balanced</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-amber-600">
                      Difference: {formatCurrency(Math.abs(configuredAmount - scheduledAmount))}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Optional instructions for the accounts team or parents."
                  rows={2}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-3 pt-2">
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

        {/* SAVED STRUCTURES LIST */}
        <Card>
          <CardContent className="pt-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Saved Fee Structures</h2>
                <p className="text-sm text-muted-foreground">Review each class plan and term structure.</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={filterSessionId}
                  onChange={(e) => setFilterSessionId(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300"
                  aria-label="Filter structures by session"
                >
                  <option value="active">Active Session ({effectiveCurrentSessionName})</option>
                  <option value="all">All Sessions ({structures.length})</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.isCurrent || s.status === "active" ? "(Active)" : ""}
                    </option>
                  ))}
                </select>
                <Badge variant="outline">{displayedStructures.length} shown</Badge>
              </div>
            </div>

            {loadingStructures ? (
              <div className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Loading fee structures...
              </div>
            ) : displayedStructures.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                No fee structures found for this session filter. Create the first class plan above.
              </div>
            ) : (
              <div className="space-y-3.5">
                {displayedStructures.map((structure) => {
                  const normalizedTerms = normalizeFeeStructureTerms(structure);
                  const totalAmt = sumInstallments(structure);

                  return (
                    <div
                      key={structure.id}
                      className="rounded-2xl border border-border p-4 bg-card hover:border-primary/40 transition-colors"
                    >
                      <div className="mb-2.5 flex flex-wrap items-center gap-2">
                        <Badge>{structure.academicSession}</Badge>
                        <Badge variant="outline">Grade {structure.grade}</Badge>
                        {normalizedTerms.map((t) => (
                          <Badge
                            key={t.termId}
                            variant="secondary"
                            className="bg-primary/10 text-primary text-[11px]"
                          >
                            {t.termName} ({t.installments.length} inst)
                          </Badge>
                        ))}
                      </div>

                      <div className="mb-3">
                        <p className="font-semibold text-base">{structure.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {structure.feeHeads?.length || 0} fee head
                          {structure.feeHeads?.length === 1 ? "" : "s"} • {normalizedTerms.length} term
                          {normalizedTerms.length === 1 ? "" : "s"} • {structure.installments?.length || 0} total installments
                        </p>
                      </div>

                      {/* Term Breakdown Preview */}
                      <div className="mb-3.5 space-y-1.5 rounded-xl bg-muted/30 p-2.5 text-xs">
                        {normalizedTerms.map((t) => {
                          const tSub = t.installments.reduce((s, i) => s + (Number(i.amount) || 0), 0);
                          return (
                            <div key={t.termId} className="flex justify-between items-center text-muted-foreground">
                              <span>
                                <strong>{t.termName}:</strong> {t.installments.map((i) => i.label).join(", ")}
                              </span>
                              <span className="font-semibold text-foreground">{formatCurrency(tSub)}</span>
                            </div>
                          );
                        })}
                        <div className="flex justify-between items-center pt-1.5 border-t font-semibold text-foreground">
                          <span>Total Amount:</span>
                          <span>{formatCurrency(totalAmt)}</span>
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
                  );
                })}
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
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>{icon}</div>
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

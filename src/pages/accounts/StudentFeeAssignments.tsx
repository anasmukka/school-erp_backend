import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import {
  Student,
  Enrollment,
  FeeStructure,
  FeePayment,
  StudentFeeAssignment,
  AssignmentTerm,
  AssignmentInstallment,
  FeeLineItem,
  FeeConcession,
  ConcessionType,
} from "@/lib/types";
import { normalizeFeeStructureTerms, sumInstallments } from "@/lib/fees";
import {
  listFeeAssignments,
  createFeeAssignment,
  getFeeAssignment,
  addConcession,
  approveConcession,
  rejectConcession,
  removeConcession,
  voidFeeAssignment,
  CONCESSION_ADMIN_THRESHOLD_INR,
} from "@/lib/feeAssignments";
import { getStudentLedger, recordAssignmentCharges, StudentLedgerSummary } from "@/lib/feeLedger";
import { listActiveFeeHeads, MasterFeeHead } from "@/lib/feeHeads";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchInput } from "@/components/ui/SearchInput";
import {
  CreditCard,
  FileText,
  Users,
  AlertCircle,
  CheckCircle2,
  Clock,
  Plus,
  ArrowRight,
  Printer,
  Sparkles,
  Layers,
  Percent,
  XCircle,
  Eye,
  SlidersHorizontal,
} from "lucide-react";

const GRADES = Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`);

function formatCurrency(amount: number): string {
  return "₹" + Math.round(amount).toLocaleString("en-IN");
}

export default function StudentFeeAssignments() {
  const { appUser } = useAuth();
  const { workingSession } = useAcademicSession();
  const effectiveSessionId = workingSession?.name || workingSession?.id || "2026-27";

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [assignments, setAssignments] = useState<StudentFeeAssignment[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [masterFeeHeads, setMasterFeeHeads] = useState<MasterFeeHead[]>([]);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGrade, setSelectedGrade] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Assignment Modal State
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [targetStudent, setTargetStudent] = useState<Student | null>(null);
  const [selectedStructureId, setSelectedStructureId] = useState<string>("");
  const [optionalCharges, setOptionalCharges] = useState<Array<{ feeHeadId: string; feeHeadName: string; amount: number; category: "additional" | "transport" }>>([]);
  const [upfrontConcessions, setUpfrontConcessions] = useState<Array<{ type: ConcessionType; label: string; amount: number; reason: string }>>([]);
  const [assignNotes, setAssignNotes] = useState("");
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignError, setAssignError] = useState("");

  // Concession Modal State (for existing assignment)
  const [concessionModalOpen, setConcessionModalOpen] = useState(false);
  const [concessionTargetAssignment, setConcessionTargetAssignment] = useState<StudentFeeAssignment | null>(null);
  const [concessionForm, setConcessionForm] = useState<{
    type: ConcessionType;
    label: string;
    amount: string;
    reason: string;
  }>({
    type: "scholarship",
    label: "Merit Scholarship",
    amount: "",
    reason: "",
  });
  const [savingConcession, setSavingConcession] = useState(false);
  const [concessionError, setConcessionError] = useState("");

  // Ledger / Details Modal State
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [viewingAssignment, setViewingAssignment] = useState<StudentFeeAssignment | null>(null);
  const [viewingStudent, setViewingStudent] = useState<Student | null>(null);
  const [studentLedger, setStudentLedger] = useState<StudentLedgerSummary | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [detailsTermFilter, setDetailsTermFilter] = useState<string>("all");

  // Load All Primary Data
  const loadData = async () => {
    setLoading(true);
    try {
      const [
        studentsSnap,
        enrollmentsSnap,
        structuresSnap,
        paymentsSnap,
        headsList,
        assignmentsList,
      ] = await Promise.all([
        getDocs(collection(db, "students")),
        getDocs(collection(db, "enrollments")),
        getDocs(collection(db, "feeStructures")),
        getDocs(collection(db, "feePayments")),
        listActiveFeeHeads(),
        listFeeAssignments({ sessionId: effectiveSessionId }),
      ]);

      const loadedStudents = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Student));
      const loadedEnrollments = enrollmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
      const loadedStructures = structuresSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeeStructure));
      const loadedPayments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeePayment));

      setStudents(loadedStudents);
      setEnrollments(loadedEnrollments);
      setFeeStructures(loadedStructures);
      setPayments(loadedPayments);
      setMasterFeeHeads(headsList);
      setAssignments(assignmentsList);
    } catch (err) {
      console.error("Error loading fee assignments workspace:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [effectiveSessionId]);

  // Map student assignments & compute payment summaries
  const studentRows = useMemo(() => {
    return students.map((student) => {
      const enrollment = enrollments.find(
        (e) => (e.studentId === student.id || e.studentUid === student.uid) && e.status === "active"
      );
      const studentGrade = enrollment?.className || student.grade || "Grade 1";
      const studentSection = enrollment?.sectionName || student.sectionId || "Unassigned";

      const assignment = assignments.find(
        (a) => a.studentId === student.id && a.sessionId === effectiveSessionId && a.status === "active"
      ) || null;

      const studentPayments = payments.filter((p) => p.studentId === student.id);
      const totalPaid = studentPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

      const grossAmount = assignment ? assignment.grossAmount : 0;
      const discountAmount = assignment ? assignment.discountAmount : 0;
      const netAmount = assignment ? assignment.netAmount : 0;
      const outstanding = assignment ? Math.max(netAmount - totalPaid, 0) : 0;

      let status: "unassigned" | "paid" | "partial" | "overdue" | "active" = "unassigned";
      if (!assignment) {
        status = "unassigned";
      } else if (outstanding === 0 && totalPaid > 0) {
        status = "paid";
      } else if (totalPaid > 0) {
        status = "partial";
      } else {
        const hasOverdue = assignment.installments?.some(
          (inst) => inst.dueDate && new Date(inst.dueDate) < new Date()
        );
        status = hasOverdue ? "overdue" : "active";
      }

      return {
        student,
        enrollment,
        grade: studentGrade,
        section: studentSection,
        assignment,
        grossAmount,
        discountAmount,
        netAmount,
        totalPaid,
        outstanding,
        status,
      };
    });
  }, [students, enrollments, assignments, payments, effectiveSessionId]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return studentRows.filter((row) => {
      // Grade filter
      if (selectedGrade !== "all" && row.grade !== selectedGrade) {
        return false;
      }

      // Status filter
      if (statusFilter === "unassigned" && row.assignment) return false;
      if (statusFilter === "assigned" && !row.assignment) return false;
      if (statusFilter === "with_concessions" && (!row.assignment || row.discountAmount === 0)) return false;
      if (statusFilter === "fully_paid" && row.status !== "paid") return false;
      if (statusFilter === "outstanding" && row.outstanding === 0) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameMatch = row.student.name?.toLowerCase().includes(q);
        const admMatch = row.student.admissionNo?.toLowerCase().includes(q);
        const uidMatch = (row.student.uid || row.student.studentUid || row.student.id)?.toLowerCase().includes(q);
        const rollMatch = (row.enrollment?.rollNo || row.student.rollNo)?.toLowerCase().includes(q);
        return nameMatch || admMatch || uidMatch || rollMatch;
      }

      return true;
    });
  }, [studentRows, selectedGrade, statusFilter, searchQuery]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    const totalStudents = studentRows.length;
    const assignedCount = studentRows.filter((r) => r.assignment !== null).length;
    const unassignedCount = totalStudents - assignedCount;
    const totalGross = studentRows.reduce((sum, r) => sum + r.grossAmount, 0);
    const totalConcessions = studentRows.reduce((sum, r) => sum + r.discountAmount, 0);
    const totalNet = studentRows.reduce((sum, r) => sum + r.netAmount, 0);
    const totalCollected = studentRows.reduce((sum, r) => sum + r.totalPaid, 0);
    const totalOutstanding = studentRows.reduce((sum, r) => sum + r.outstanding, 0);

    return {
      totalStudents,
      assignedCount,
      unassignedCount,
      totalGross,
      totalConcessions,
      totalNet,
      totalCollected,
      totalOutstanding,
    };
  }, [studentRows]);

  // Open Assign Modal for a student
  const openAssignModal = (student: Student) => {
    const enrollment = enrollments.find(
      (e) => (e.studentId === student.id || e.studentUid === student.uid) && e.status === "active"
    );
    const grade = enrollment?.className || student.grade || "Grade 1";

    // Find compatible structures for this grade & session
    const compatible = feeStructures.filter(
      (s) => s.grade === grade && s.academicSession === effectiveSessionId
    );

    setTargetStudent(student);
    setSelectedStructureId(compatible[0]?.id || "");
    setOptionalCharges([]);
    setUpfrontConcessions([]);
    setAssignNotes("");
    setAssignError("");
    setAssignModalOpen(true);
  };

  // Selected base structure in modal
  const selectedBaseStructure = useMemo(() => {
    return feeStructures.find((s) => s.id === selectedStructureId) || null;
  }, [feeStructures, selectedStructureId]);

  const normalizedTerms = useMemo(() => {
    return selectedBaseStructure ? normalizeFeeStructureTerms(selectedBaseStructure) : [];
  }, [selectedBaseStructure]);

  // Calculation for assignment preview
  const assignmentPreview = useMemo(() => {
    if (!selectedBaseStructure) return null;

    const baseCharges = selectedBaseStructure.feeHeads.map((head) => ({
      id: head.id,
      feeHeadId: head.id,
      feeHeadName: head.name,
      amount: Number(head.amount) || 0,
      category: "base" as const,
    }));

    const allLineItems: FeeLineItem[] = [
      ...baseCharges,
      ...optionalCharges.map((c, i) => ({
        id: `opt_${i}_${c.feeHeadId}`,
        feeHeadId: c.feeHeadId,
        feeHeadName: c.feeHeadName,
        amount: Number(c.amount) || 0,
        category: c.category,
      })),
    ];

    const grossAmount = allLineItems.reduce((sum, item) => sum + item.amount, 0);
    // Only active concessions reduce discountAmount and netAmount (SEC-06)
    const activeConcessions = upfrontConcessions.filter((c) => {
      if (appUser?.role === "admin") return true;
      return (Number(c.amount) || 0) <= CONCESSION_ADMIN_THRESHOLD_INR;
    });
    const discountAmount = activeConcessions.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const netAmount = Math.max(grossAmount - discountAmount, 0);

    // Flatten all installments in term order
    const flatBaseInstallments: Array<{ id: string; label: string; amount: number; dueDate: string; termId: string; termName: string; order: number }> = [];
    normalizedTerms.forEach((term) => {
      (term.installments || []).forEach((inst, idx) => {
        flatBaseInstallments.push({
          id: inst.id,
          label: inst.label,
          amount: Number(inst.amount) || 0,
          dueDate: inst.dueDate,
          termId: inst.termId || term.termId,
          termName: inst.termName || term.termName,
          order: inst.order ?? idx + 1,
        });
      });
    });

    const baseTotal = flatBaseInstallments.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

    let calculatedInstallments: AssignmentInstallment[] = [];
    if (flatBaseInstallments.length > 0 && baseTotal > 0) {
      let accumulated = 0;
      calculatedInstallments = flatBaseInstallments.map((inst, index) => {
        if (index === flatBaseInstallments.length - 1) {
          return {
            id: inst.id,
            label: inst.label,
            amount: Math.max(netAmount - accumulated, 0),
            dueDate: inst.dueDate,
            termId: inst.termId,
            termName: inst.termName,
            order: inst.order,
            status: "upcoming" as const,
          };
        }
        const proportion = inst.amount / baseTotal;
        const instAmount = Math.round(netAmount * proportion);
        accumulated += instAmount;
        return {
          id: inst.id,
          label: inst.label,
          amount: instAmount,
          dueDate: inst.dueDate,
          termId: inst.termId,
          termName: inst.termName,
          order: inst.order,
          status: "upcoming" as const,
        };
      });
    }

    const calculatedTerms: AssignmentTerm[] = normalizedTerms.map((term) => {
      const termInsts = calculatedInstallments.filter((i) => i.termId === term.termId);
      return {
        termId: term.termId,
        termName: term.termName,
        order: term.order,
        installments: termInsts,
      };
    });

    return {
      allLineItems,
      grossAmount,
      discountAmount,
      netAmount,
      installments: calculatedInstallments,
      terms: calculatedTerms,
    };
  }, [selectedBaseStructure, normalizedTerms, optionalCharges, upfrontConcessions, appUser]);

  // Save new Student Fee Assignment
  const handleSaveAssignment = async () => {
    if (!targetStudent || !selectedBaseStructure || !assignmentPreview) {
      setAssignError("Please select a base fee structure.");
      return;
    }

    setSavingAssignment(true);
    setAssignError("");

    try {
      const enrollment = enrollments.find(
        (e) => (e.studentId === targetStudent.id || e.studentUid === targetStudent.uid) && e.status === "active"
      );

      const studentGrade = enrollment?.className || targetStudent.grade || selectedBaseStructure.grade;
      const studentSection = enrollment?.sectionName || targetStudent.sectionId || null;
      const studentAuthUid = targetStudent.uid || (targetStudent as any).studentUid || targetStudent.id;

      // 1. Create the individualized snapshot assignment with studentUid (SEC-05)
      const assignmentId = await createFeeAssignment(
        {
          studentId: targetStudent.id,
          studentUid: studentAuthUid,
          studentName: targetStudent.name,
          admissionNo: targetStudent.admissionNo || "",
          grade: studentGrade,
          sectionId: enrollment?.sectionId || null,
          sectionName: studentSection,
          sessionId: effectiveSessionId,
          academicYear: effectiveSessionId,
          enrollmentId: enrollment?.id || "",
          structureId: selectedBaseStructure.id,
          structureSnapshot: {
            title: selectedBaseStructure.title,
            grade: selectedBaseStructure.grade,
            feeHeads: selectedBaseStructure.feeHeads,
            installments: selectedBaseStructure.installments,
            terms: normalizedTerms,
            term: selectedBaseStructure.term || "full_year",
            createdAt: selectedBaseStructure.createdAt,
          },
          lineItems: assignmentPreview.allLineItems,
          concessions: upfrontConcessions.map((c, idx) => {
            const isHighValue = appUser?.role !== "admin" && c.amount > CONCESSION_ADMIN_THRESHOLD_INR;
            return {
              id: `conc_${Date.now()}_${idx}`,
              type: c.type,
              label: c.label,
              amount: c.amount,
              percentage: null,
              affectedFeeHeadId: null,
              reason: c.reason,
              requestedBy: isHighValue ? (appUser?.id || "accountant") : undefined,
              requestedByName: isHighValue ? (appUser?.name || "Accounts Staff") : undefined,
              requestedAt: isHighValue ? new Date().toISOString() : undefined,
              approvedBy: isHighValue ? undefined : (appUser?.id || "admin"),
              approvedByName: isHighValue ? undefined : (appUser?.name || "Accounts / Admin"),
              approvedAt: isHighValue ? undefined : new Date().toISOString(),
              status: isHighValue ? ("pending_approval" as const) : ("active" as const),
            };
          }),
          installments: assignmentPreview.installments,
          terms: assignmentPreview.terms,
          grossAmount: assignmentPreview.grossAmount,
          discountAmount: assignmentPreview.discountAmount,
          netAmount: assignmentPreview.netAmount,
          notes: assignNotes.trim(),
        },
        {
          uid: appUser?.id || "admin",
          name: appUser?.name || "Accounts Staff",
          role: appUser?.role || "accountant",
        }
      );

      // 2. Post initial charges and concessions to the Student Fee Ledger
      await recordAssignmentCharges(
        {
          id: assignmentId,
          studentId: targetStudent.id,
          studentUid: studentAuthUid,
          sessionId: effectiveSessionId,
          lineItems: assignmentPreview.allLineItems,
          concessions: upfrontConcessions.map((c, idx) => {
            const isHighValue = appUser?.role !== "admin" && c.amount > CONCESSION_ADMIN_THRESHOLD_INR;
            return {
              id: `conc_${idx}`,
              label: c.label,
              amount: c.amount,
              affectedFeeHeadId: null,
              status: isHighValue ? "pending_approval" : "active",
            };
          }),
        },
        {
          uid: appUser?.id || "admin",
          name: appUser?.name || "Accounts Staff",
          role: (appUser?.role as any) || "accountant",
        }
      );

      setAssignModalOpen(false);
      await loadData();
    } catch (err: any) {
      console.error("Failed to create fee assignment:", err);
      setAssignError(err?.message || "Failed to create fee assignment. Please verify all details.");
    } finally {
      setSavingAssignment(false);
    }
  };

  // Terms and term-level metrics for currently viewed assignment
  const viewingTermsData = useMemo(() => {
    if (!viewingAssignment) return [];
    let termsList: AssignmentTerm[] = [];
    if (viewingAssignment.terms && viewingAssignment.terms.length > 0) {
      termsList = viewingAssignment.terms;
    } else {
      const normalized = normalizeFeeStructureTerms({
        installments: (viewingAssignment.installments || []).map((i) => ({
          id: i.id,
          label: i.label,
          amount: i.amount,
          dueDate: i.dueDate,
          termId: i.termId,
          termName: i.termName,
          order: i.order,
        })),
      });
      termsList = normalized.map((t) => ({
        termId: t.termId,
        termName: t.termName,
        order: t.order,
        installments: (t.installments || []).map((i) => ({
          id: i.id,
          label: i.label,
          amount: i.amount,
          dueDate: i.dueDate,
          termId: t.termId,
          termName: t.termName,
          order: i.order,
          status: ((viewingAssignment.installments || []).find((vi) => vi.id === i.id)?.status || "upcoming") as any,
        })),
      }));
    }

    const studentPayments = viewingStudent
      ? payments.filter((p) => p.studentId === viewingStudent.id || (p as any).studentUid === viewingStudent.uid)
      : [];

    return termsList.map((term) => {
      const scheduled = term.installments.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
      const paid = term.installments.reduce((sum, i) => {
        const matchingPayments = studentPayments.filter(
          (p) => p.installmentId === i.id || (p.installmentLabel && p.installmentLabel === i.label)
        );
        const pTotal = matchingPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        return sum + Math.min(pTotal, Number(i.amount) || 0);
      }, 0);
      const outstanding = Math.max(scheduled - paid, 0);
      const status: "paid" | "partial" | "pending" | "overdue" =
        outstanding <= 0 && scheduled > 0
          ? "paid"
          : paid > 0
          ? "partial"
          : term.installments.some((i) => i.dueDate && new Date(i.dueDate) < new Date())
          ? "overdue"
          : "pending";

      return {
        termId: term.termId,
        termName: term.termName,
        order: term.order,
        installments: term.installments,
        scheduled,
        paid,
        outstanding,
        status,
      };
    });
  }, [viewingAssignment, viewingStudent, payments]);

  // Open Details & Ledger
  const openStudentDetails = async (assignment: StudentFeeAssignment, student: Student) => {
    setViewingAssignment(assignment);
    setViewingStudent(student);
    setDetailsTermFilter("all");
    setDetailsModalOpen(true);
    setLoadingLedger(true);

    try {
      const ledger = await getStudentLedger(student.id, assignment.id, effectiveSessionId);
      setStudentLedger(ledger);
    } catch (e) {
      console.error("Could not fetch student ledger:", e);
    } finally {
      setLoadingLedger(false);
    }
  };

  // Open Add Concession Modal
  const openAddConcessionModal = (assignment: StudentFeeAssignment) => {
    setConcessionTargetAssignment(assignment);
    setConcessionForm({
      type: "scholarship",
      label: "Merit Scholarship",
      amount: "",
      reason: "",
    });
    setConcessionError("");
    setConcessionModalOpen(true);
  };

  // Save Concession
  const handleSaveConcession = async () => {
    if (!concessionTargetAssignment) return;
    const amount = Number(concessionForm.amount) || 0;
    if (amount <= 0) {
      setConcessionError("Please enter a valid concession amount.");
      return;
    }
    if (!concessionForm.reason.trim()) {
      setConcessionError("Please provide an administrative reason or justification for this concession.");
      return;
    }

    setSavingConcession(true);
    setConcessionError("");

    try {
      const newConcession: FeeConcession = {
        id: `conc_${Date.now()}`,
        type: concessionForm.type,
        label: concessionForm.label.trim() || "Concession",
        amount,
        percentage: null,
        affectedFeeHeadId: null,
        reason: concessionForm.reason.trim(),
        approvedBy: appUser?.id || "admin",
        approvedByName: appUser?.name || "Accounts Staff",
        approvedAt: new Date().toISOString(),
        status: "active",
      };

      await addConcession(
        concessionTargetAssignment.id,
        newConcession,
        {
          uid: appUser?.id || "admin",
          name: appUser?.name || "Accounts Staff",
          role: appUser?.role || "accountant",
        }
      );

      setConcessionModalOpen(false);
      await loadData();

      // Refresh viewing ledger if open
      if (viewingAssignment?.id === concessionTargetAssignment.id && viewingStudent) {
        const ledger = await getStudentLedger(viewingStudent.id, concessionTargetAssignment.id, effectiveSessionId);
        setStudentLedger(ledger);
      }
    } catch (err: any) {
      setConcessionError(err?.message || "Failed to apply concession.");
    } finally {
      setSavingConcession(false);
    }
  };

  const handleApproveConcession = async (assignmentId: string, concessionId: string) => {
    if (!appUser) return;
    try {
      await approveConcession(assignmentId, concessionId, {
        uid: appUser.id,
        name: appUser.name || "Administrator",
        role: appUser.role || "admin",
      });
      const updated = await getFeeAssignment(assignmentId);
      setViewingAssignment(updated);
      if (viewingStudent) {
        const ledger = await getStudentLedger(viewingStudent.id, assignmentId, effectiveSessionId);
        setStudentLedger(ledger);
      }
      await loadData();
    } catch (err: any) {
      alert(err.message || "Failed to approve concession");
    }
  };

  const handleRejectConcession = async (assignmentId: string, concessionId: string) => {
    if (!appUser) return;
    const reason = window.prompt("Enter reason for rejecting this concession:") || "Rejected by Administrator";
    try {
      await rejectConcession(assignmentId, concessionId, reason, {
        uid: appUser.id,
        name: appUser.name || "Administrator",
        role: appUser.role || "admin",
      });
      const updated = await getFeeAssignment(assignmentId);
      setViewingAssignment(updated);
      if (viewingStudent) {
        const ledger = await getStudentLedger(viewingStudent.id, assignmentId, effectiveSessionId);
        setStudentLedger(ledger);
      }
      await loadData();
    } catch (err: any) {
      alert(err.message || "Failed to reject concession");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Context */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Student Fee Assignments</h1>
            <Badge variant="secondary" className="font-semibold text-xs">
              {effectiveSessionId}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Individual student fee obligations, concessions, installment schedules, and authoritative financial ledgers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/accounts/fees">
            <Button variant="outline" size="sm">
              <Layers size={14} className="mr-1.5" />
              Fee Structures
            </Button>
          </Link>
          <Link href="/accounts/collections">
            <Button variant="outline" size="sm">
              <CreditCard size={14} className="mr-1.5" />
              Collections
            </Button>
          </Link>
          <Link href="/accounts/bypasses">
            <Button variant="outline" size="sm">
              <FileText size={14} className="mr-1.5" />
              Hall Ticket Bypasses
            </Button>
          </Link>
        </div>
      </div>

      {/* Aggregate Metric Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users size={14} />
            <span>Enrolled Students</span>
          </div>
          <p className="mt-2 text-2xl font-bold">{metrics.totalStudents}</p>
        </Card>

        <Card className="p-4 border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
            <CheckCircle2 size={14} />
            <span>Assigned Fees</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{metrics.assignedCount}</p>
        </Card>

        <Card className={`p-4 ${metrics.unassignedCount > 0 ? "border-amber-500/30 bg-amber-500/5" : ""}`}>
          <div className="flex items-center gap-2 text-xs text-amber-600 font-medium">
            <AlertCircle size={14} />
            <span>Unassigned</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-700">{metrics.unassignedCount}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CreditCard size={14} />
            <span>Total Assigned Net</span>
          </div>
          <p className="mt-2 text-xl font-bold">{formatCurrency(metrics.totalNet)}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
            <CheckCircle2 size={14} />
            <span>Total Collected</span>
          </div>
          <p className="mt-2 text-xl font-bold text-emerald-600">{formatCurrency(metrics.totalCollected)}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-rose-600 font-medium">
            <Clock size={14} />
            <span>Total Outstanding</span>
          </div>
          <p className="mt-2 text-xl font-bold text-rose-600">{formatCurrency(metrics.totalOutstanding)}</p>
        </Card>
      </div>

      {/* Unassigned Students Callout Banner */}
      {metrics.unassignedCount > 0 ? (
        <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-center gap-3">
            <AlertCircle size={20} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-semibold">
                {metrics.unassignedCount} {metrics.unassignedCount === 1 ? "student has" : "students have"} no fee assignment for {effectiveSessionId}.
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Exam hall tickets are fail-closed and will remain blocked for unassigned students until an individualized fee plan is recorded.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-400 bg-white text-amber-900 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-100"
            onClick={() => setStatusFilter("unassigned")}
          >
            Show Unassigned
          </Button>
        </div>
      ) : null}

      {/* Filters & Search Toolbar */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex-1 max-w-md">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                onClear={() => setSearchQuery("")}
                placeholder="Search student, admission no, UID, roll no..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Select value={selectedGrade} onValueChange={setSelectedGrade}>
                <SelectTrigger className="w-[140px] text-xs">
                  <SelectValue placeholder="All Grades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Grades</SelectItem>
                  {GRADES.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[170px] text-xs">
                  <SelectValue placeholder="Fee Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="assigned">Assigned Only</SelectItem>
                  <SelectItem value="unassigned">Unassigned Only</SelectItem>
                  <SelectItem value="with_concessions">With Concessions</SelectItem>
                  <SelectItem value="fully_paid">Fully Paid</SelectItem>
                  <SelectItem value="outstanding">Has Outstanding</SelectItem>
                </SelectContent>
              </Select>

              {(selectedGrade !== "all" || statusFilter !== "all" || searchQuery) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedGrade("all");
                    setStatusFilter("all");
                    setSearchQuery("");
                  }}
                  className="text-xs text-muted-foreground"
                >
                  Reset Filters
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Student Fee Assignment Roster */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Student Fee Roster</CardTitle>
              <CardDescription className="text-xs">
                Showing {filteredRows.length} of {studentRows.length} students
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium">No students matching criteria</p>
              <p className="text-xs text-muted-foreground mt-1">
                {studentRows.length === 0
                  ? `No students found for ${effectiveSessionId}. Enroll students via Admissions.`
                  : "Try clearing search keywords or active filters."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Grade & Section</TableHead>
                    <TableHead>Fee Assignment</TableHead>
                    <TableHead className="text-right">Gross Charges</TableHead>
                    <TableHead className="text-right">Concessions</TableHead>
                    <TableHead className="text-right">Net Payable</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => (
                    <TableRow key={row.student.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{row.student.name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          {row.student.admissionNo ? <span>Adm: {row.student.admissionNo}</span> : null}
                          {row.enrollment?.rollNo ? <span>• Roll: {row.enrollment.rollNo}</span> : null}
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {row.grade}
                        </Badge>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Sec: {row.section}
                        </div>
                      </TableCell>

                      <TableCell>
                        {row.assignment ? (
                          <div>
                            <div className="text-xs font-semibold">
                              {row.assignment.structureSnapshot?.title || "Custom Plan"}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              v{row.assignment.version} • {new Date(row.assignment.assignedAt).toLocaleDateString()}
                            </div>
                          </div>
                        ) : (
                          <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            Unassigned
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right font-medium">
                        {row.assignment ? formatCurrency(row.grossAmount) : "—"}
                      </TableCell>

                      <TableCell className="text-right">
                        {row.discountAmount > 0 ? (
                          <span className="text-emerald-600 font-semibold">
                            -{formatCurrency(row.discountAmount)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">₹0</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right font-semibold">
                        {row.assignment ? formatCurrency(row.netAmount) : "—"}
                      </TableCell>

                      <TableCell className="text-right text-emerald-600 font-medium">
                        {formatCurrency(row.totalPaid)}
                      </TableCell>

                      <TableCell className="text-right font-bold">
                        {row.assignment ? (
                          row.outstanding > 0 ? (
                            <span className="text-rose-600">{formatCurrency(row.outstanding)}</span>
                          ) : (
                            <span className="text-emerald-600">Cleared</span>
                          )
                        ) : (
                          "—"
                        )}
                      </TableCell>

                      <TableCell>
                        {row.status === "unassigned" ? (
                          <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 bg-amber-50">
                            Unassigned
                          </Badge>
                        ) : row.status === "paid" ? (
                          <Badge className="text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none">
                            Paid Up
                          </Badge>
                        ) : row.status === "partial" ? (
                          <Badge className="text-xs bg-amber-100 text-amber-800 hover:bg-amber-100 border-none">
                            Partial
                          </Badge>
                        ) : row.status === "overdue" ? (
                          <Badge className="text-xs bg-rose-100 text-rose-800 hover:bg-rose-100 border-none">
                            Overdue
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Active
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {row.assignment ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs px-2.5"
                                onClick={() => openStudentDetails(row.assignment!, row.student)}
                              >
                                <Eye size={13} className="mr-1" />
                                Ledger
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 text-xs px-2"
                                title="Add Concession / Scholarship"
                                onClick={() => openAddConcessionModal(row.assignment!)}
                              >
                                <Percent size={13} className="text-emerald-600" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              className="h-8 text-xs px-3 bg-primary"
                              onClick={() => openAssignModal(row.student)}
                            >
                              <Plus size={13} className="mr-1" />
                              Assign Fee
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ASSIGN FEE MODAL */}
      <Dialog open={assignModalOpen} onOpenChange={setAssignModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Student Fee Plan</DialogTitle>
            <DialogDescription>
              Assign a versioned fee structure snapshot to {targetStudent?.name}. Modifying student charges will not change the master class template.
            </DialogDescription>
          </DialogHeader>

          {assignError ? (
            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
              {assignError}
            </div>
          ) : null}

          {targetStudent ? (
            <div className="space-y-4 py-2">
              {/* Student Metadata Card */}
              <div className="rounded-lg bg-muted/40 p-3.5 border border-border text-xs grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <span className="text-muted-foreground block">Student</span>
                  <span className="font-semibold text-sm">{targetStudent.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Admission No</span>
                  <span className="font-medium">{targetStudent.admissionNo || "Pending"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Grade</span>
                  <span className="font-medium">{targetStudent.grade}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Session</span>
                  <span className="font-medium">{effectiveSessionId}</span>
                </div>
              </div>

              {/* Select Base Structure */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Base Fee Structure</Label>
                <Select value={selectedStructureId} onValueChange={setSelectedStructureId}>
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Choose base structure..." />
                  </SelectTrigger>
                  <SelectContent>
                    {feeStructures
                      .filter((s) => s.academicSession === effectiveSessionId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.title} ({s.grade}) — Total {formatCurrency(sumInstallments(s))}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedBaseStructure ? (
                <>
                  {/* Base Line Items */}
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                      Base Fee Heads (Template Snapshot)
                    </span>
                    <Table>
                      <TableBody>
                        {selectedBaseStructure.feeHeads.map((head) => (
                          <TableRow key={head.id} className="text-xs">
                            <TableCell className="py-1.5 font-medium">{head.name}</TableCell>
                            <TableCell className="py-1.5 text-right">{formatCurrency(head.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Optional Charges (Transport, Books, Uniform) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">Optional / Additional Charges</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          const transportHead = masterFeeHeads.find((h) => h.category === "transport") || masterFeeHeads[0];
                          if (transportHead) {
                            setOptionalCharges([
                              ...optionalCharges,
                              {
                                feeHeadId: transportHead.id,
                                feeHeadName: transportHead.name,
                                amount: 15000,
                                category: transportHead.category === "transport" ? "transport" : "additional",
                              },
                            ]);
                          }
                        }}
                      >
                        <Plus size={12} className="mr-1" />
                        Add Optional Charge
                      </Button>
                    </div>

                    {optionalCharges.map((charge, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Select
                          value={charge.feeHeadId}
                          onValueChange={(val) => {
                            const found = masterFeeHeads.find((h) => h.id === val);
                            const updated = [...optionalCharges];
                            updated[idx] = {
                              ...updated[idx],
                              feeHeadId: val,
                              feeHeadName: found?.name || "Charge",
                              category: found?.category === "transport" ? "transport" : "additional",
                            };
                            setOptionalCharges(updated);
                          }}
                        >
                          <SelectTrigger className="text-xs flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {masterFeeHeads.map((h) => (
                              <SelectItem key={h.id} value={h.id}>
                                {h.name} ({h.category})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Input
                          type="number"
                          value={charge.amount || ""}
                          placeholder="Amount (₹)"
                          className="w-28 text-xs"
                          onChange={(e) => {
                            const updated = [...optionalCharges];
                            updated[idx].amount = Number(e.target.value) || 0;
                            setOptionalCharges(updated);
                          }}
                        />

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-rose-600"
                          onClick={() => {
                            setOptionalCharges(optionalCharges.filter((_, i) => i !== idx));
                          }}
                        >
                          <XCircle size={14} />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Upfront Concessions */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">Concessions & Scholarships</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-emerald-600"
                        onClick={() => {
                          setUpfrontConcessions([
                            ...upfrontConcessions,
                            {
                              type: "sibling_discount",
                              label: "Sibling Discount",
                              amount: 5000,
                              reason: "Sibling enrolled in Grade 5",
                            },
                          ]);
                        }}
                      >
                        <Plus size={12} className="mr-1" />
                        Add Concession
                      </Button>
                    </div>

                    {upfrontConcessions.map((conc, idx) => (
                      <div key={idx} className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
                        <div className="flex items-center gap-2">
                          <Select
                            value={conc.type}
                            onValueChange={(val: any) => {
                              const updated = [...upfrontConcessions];
                              updated[idx].type = val;
                              updated[idx].label = val.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
                              setUpfrontConcessions(updated);
                            }}
                          >
                            <SelectTrigger className="text-xs flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="scholarship">Merit Scholarship</SelectItem>
                              <SelectItem value="sibling_discount">Sibling Discount</SelectItem>
                              <SelectItem value="staff_concession">Staff Concession</SelectItem>
                              <SelectItem value="financial_concession">Financial Hardship Concession</SelectItem>
                              <SelectItem value="management_concession">Management Concession</SelectItem>
                              <SelectItem value="other">Other Concession</SelectItem>
                            </SelectContent>
                          </Select>

                          <Input
                            type="number"
                            value={conc.amount || ""}
                            placeholder="Discount (₹)"
                            className="w-28 text-xs"
                            onChange={(e) => {
                              const updated = [...upfrontConcessions];
                              updated[idx].amount = Number(e.target.value) || 0;
                              setUpfrontConcessions(updated);
                            }}
                          />

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-rose-600"
                            onClick={() => {
                              setUpfrontConcessions(upfrontConcessions.filter((_, i) => i !== idx));
                            }}
                          >
                            <XCircle size={14} />
                          </Button>
                        </div>

                        <Input
                          value={conc.reason}
                          placeholder="Reason / justification (mandatory for audit)..."
                          className="text-xs h-7"
                          onChange={(e) => {
                            const updated = [...upfrontConcessions];
                            updated[idx].reason = e.target.value;
                            setUpfrontConcessions(updated);
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Final Calculation Summary Box */}
                  {assignmentPreview ? (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs space-y-2">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Gross Charges:</span>
                        <span className="font-semibold text-foreground">{formatCurrency(assignmentPreview.grossAmount)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-600 font-medium">
                        <span>Total Concessions:</span>
                        <span>-{formatCurrency(assignmentPreview.discountAmount)}</span>
                      </div>
                      <div className="border-t border-border pt-1.5 flex justify-between text-sm font-bold">
                        <span>Net Assigned Payable:</span>
                        <span className="text-primary">{formatCurrency(assignmentPreview.netAmount)}</span>
                      </div>

                      {/* Installments Breakdown Preview Grouped By Term */}
                      <div className="pt-2 space-y-2">
                        <span className="text-[11px] font-semibold text-muted-foreground block">
                          Generated Installments by Academic Term ({assignmentPreview.installments.length} total):
                        </span>
                        {assignmentPreview.terms && assignmentPreview.terms.length > 0 ? (
                          <div className="space-y-2">
                            {assignmentPreview.terms.map((term) => (
                              <div key={term.termId} className="rounded-lg border border-border/70 bg-background/80 p-2 text-xs">
                                <div className="flex items-center justify-between font-semibold text-foreground mb-1.5 pb-1 border-b border-border/40">
                                  <span className="flex items-center gap-1.5">
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                    {term.termName}
                                  </span>
                                  <span className="text-muted-foreground text-[11px]">
                                    Term Subtotal: {formatCurrency(term.installments.reduce((s, i) => s + i.amount, 0))}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                  {term.installments.map((inst, idx) => (
                                    <div key={idx} className="rounded bg-background p-1.5 border border-border text-[11px]">
                                      <span className="text-muted-foreground block truncate">{inst.label}</span>
                                      <span className="font-semibold">{formatCurrency(inst.amount)}</span>
                                      {inst.dueDate && (
                                        <span className="text-[10px] text-muted-foreground block">
                                          Due: {inst.dueDate}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                            {assignmentPreview.installments.map((inst, idx) => (
                              <div key={idx} className="rounded bg-background p-1.5 border border-border text-[11px]">
                                <span className="text-muted-foreground block truncate">{inst.label}</span>
                                <span className="font-semibold">{formatCurrency(inst.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* Notes */}
                  <div className="space-y-1">
                    <Label className="text-xs">Assignment Notes (Optional)</Label>
                    <Textarea
                      rows={2}
                      value={assignNotes}
                      onChange={(e) => setAssignNotes(e.target.value)}
                      placeholder="Add any specific comments or approval references..."
                      className="text-xs"
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={savingAssignment || !selectedBaseStructure}
              onClick={handleSaveAssignment}
            >
              {savingAssignment ? "Saving Assignment..." : "Confirm & Assign Fee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADD CONCESSION MODAL */}
      <Dialog open={concessionModalOpen} onOpenChange={setConcessionModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Concession / Scholarship</DialogTitle>
            <DialogDescription>
              Apply an authorized concession to {concessionTargetAssignment?.studentName}. Upcoming installments will be adjusted proportionally.
            </DialogDescription>
          </DialogHeader>

          {concessionError ? (
            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200">
              {concessionError}
            </div>
          ) : null}

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Concession Type</Label>
              <Select
                value={concessionForm.type}
                onValueChange={(val: any) => {
                  setConcessionForm({
                    ...concessionForm,
                    type: val,
                    label: val.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
                  });
                }}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scholarship">Merit Scholarship</SelectItem>
                  <SelectItem value="sibling_discount">Sibling Discount</SelectItem>
                  <SelectItem value="staff_concession">Staff Concession</SelectItem>
                  <SelectItem value="financial_concession">Financial Concession</SelectItem>
                  <SelectItem value="management_concession">Management Concession</SelectItem>
                  <SelectItem value="other">Other Concession</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Label / Title</Label>
              <Input
                value={concessionForm.label}
                onChange={(e) => setConcessionForm({ ...concessionForm, label: e.target.value })}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Amount (₹)</Label>
              <Input
                type="number"
                value={concessionForm.amount}
                onChange={(e) => setConcessionForm({ ...concessionForm, amount: e.target.value })}
                placeholder="e.g. 5000"
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Reason & Approval Reference</Label>
              <Textarea
                rows={2}
                value={concessionForm.reason}
                onChange={(e) => setConcessionForm({ ...concessionForm, reason: e.target.value })}
                placeholder="Reason or approval note (mandatory for audit trail)..."
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConcessionModalOpen(false)}>
              Cancel
            </Button>
            <Button disabled={savingConcession} onClick={handleSaveConcession}>
              {savingConcession ? "Applying..." : "Apply Concession"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* STUDENT DETAILS & FINANCIAL LEDGER MODAL */}
      <Dialog open={detailsModalOpen} onOpenChange={setDetailsModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Student Fee Ledger & Assignment Details</DialogTitle>
            <DialogDescription>
              Complete financial record and chronological ledger statement for {viewingStudent?.name}.
            </DialogDescription>
          </DialogHeader>

          {viewingAssignment && viewingStudent ? (
            <div className="space-y-5 py-2">
              {/* Top Student Overview */}
              <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <span className="text-muted-foreground block">Student Name</span>
                  <span className="font-bold text-sm">{viewingStudent.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Admission / Roll</span>
                  <span className="font-medium">{viewingStudent.admissionNo || "—"} / {viewingStudent.rollNo || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Grade & Section</span>
                  <span className="font-medium">{viewingAssignment.grade} ({viewingAssignment.sectionName || "—"})</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Session</span>
                  <span className="font-medium">{effectiveSessionId}</span>
                </div>
              </div>

              {/* Assignment Information */}
              <div className="rounded-lg border border-border p-3 text-xs space-y-1 bg-background">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-foreground">
                    Base Plan: {viewingAssignment.structureSnapshot?.title || "Class Plan"} (v{viewingAssignment.version})
                  </span>
                  <Badge variant="outline" className="text-xs">
                    Assigned: {new Date(viewingAssignment.assignedAt).toLocaleDateString()}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Assigned by: {viewingAssignment.assignedByName || "Accounts"}
                </p>
              </div>

              {/* Line Items Breakdown */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Assigned Fee Line Items
                </h4>
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead>Fee Head</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingAssignment.lineItems?.map((item) => (
                        <TableRow key={item.id} className="text-xs">
                          <TableCell className="font-medium">{item.feeHeadName}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px] capitalize">
                              {item.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(item.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold text-xs border-t">
                        <TableCell colSpan={2}>Gross Total</TableCell>
                        <TableCell className="text-right">{formatCurrency(viewingAssignment.grossAmount)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Concessions Section */}
              {viewingAssignment.concessions && viewingAssignment.concessions.length > 0 ? (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Applied Concessions & Scholarships
                  </h4>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead>Type</TableHead>
                          <TableHead>Reason / Notes</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          {appUser?.role === "admin" && <TableHead className="text-right">Admin Action</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewingAssignment.concessions.map((c) => (
                          <TableRow key={c.id} className="text-xs">
                            <TableCell className="font-medium">{c.label}</TableCell>
                            <TableCell className="text-muted-foreground">{c.reason}</TableCell>
                            <TableCell className="text-right font-semibold text-emerald-600">
                              -{formatCurrency(c.amount)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  c.status === "active"
                                    ? "text-emerald-700 bg-emerald-50"
                                    : c.status === "pending_approval"
                                    ? "text-amber-700 bg-amber-50 border-amber-300"
                                    : c.status === "rejected"
                                    ? "text-rose-700 bg-rose-50 border-rose-300"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {c.status === "pending_approval" ? "Pending Admin Approval" : c.status}
                              </Badge>
                            </TableCell>
                            {appUser?.role === "admin" && (
                              <TableCell className="text-right">
                                {c.status === "pending_approval" ? (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-[11px] font-semibold text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                      onClick={() => handleApproveConcession(viewingAssignment.id, c.id)}
                                    >
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-[11px] font-semibold text-rose-700 border-rose-300 hover:bg-rose-50"
                                      onClick={() => handleRejectConcession(viewingAssignment.id, c.id)}
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}

              {/* Term-Grouped Installment Schedule & Breakdown */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Installments by Academic Term
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      Structured fee schedule organized under academic terms.
                    </p>
                  </div>
                  {/* Term Filter Tabs */}
                  {viewingTermsData.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Button
                        size="sm"
                        variant={detailsTermFilter === "all" ? "default" : "outline"}
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setDetailsTermFilter("all")}
                      >
                        All Terms
                      </Button>
                      {viewingTermsData.map((term) => (
                        <Button
                          key={term.termId}
                          size="sm"
                          variant={detailsTermFilter === term.termId ? "default" : "outline"}
                          className="h-7 px-2.5 text-xs"
                          onClick={() => setDetailsTermFilter(term.termId)}
                        >
                          {term.termName}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Term Summary Cards (Term 1 Paid/Outstanding vs Term 2 Paid/Outstanding) */}
                {viewingTermsData.length > 0 && (
                  <div className={`grid grid-cols-1 gap-2.5 ${viewingTermsData.length === 1 ? "sm:grid-cols-1" : viewingTermsData.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                    {viewingTermsData.map((term) => (
                      <div
                        key={term.termId}
                        className={`rounded-lg border p-3 text-xs space-y-1.5 transition-all ${
                          detailsTermFilter === term.termId
                            ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                            : "border-border bg-card"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-primary" />
                            {term.termName}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${
                              term.status === "paid"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                                : term.status === "partial"
                                ? "bg-amber-50 text-amber-700 border-amber-300"
                                : term.status === "overdue"
                                ? "bg-rose-50 text-rose-700 border-rose-300"
                                : "bg-slate-50 text-slate-700 border-slate-300"
                            }`}
                          >
                            {term.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-1 pt-1 border-t border-border/50 text-[11px]">
                          <div>
                            <span className="text-muted-foreground block text-[10px]">Scheduled</span>
                            <span className="font-medium">{formatCurrency(term.scheduled)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[10px]">Paid</span>
                            <span className="font-semibold text-emerald-600">{formatCurrency(term.paid)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[10px]">Outstanding</span>
                            <span className={`font-semibold ${term.outstanding > 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                              {formatCurrency(term.outstanding)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Term-Grouped Installment Tables */}
                {viewingTermsData
                  .filter((term) => detailsTermFilter === "all" || detailsTermFilter === term.termId)
                  .map((term) => (
                    <div key={term.termId} className="rounded-lg border border-border overflow-hidden bg-card">
                      <div className="bg-muted/40 px-3 py-2 flex items-center justify-between border-b border-border text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{term.termName} Installments</span>
                          <span className="text-muted-foreground text-[11px]">
                            ({term.installments.length} installment{term.installments.length === 1 ? "" : "s"})
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px]">
                          <span>
                            Subtotal: <strong className="text-foreground">{formatCurrency(term.scheduled)}</strong>
                          </span>
                          <span>
                            Paid: <strong className="text-emerald-600">{formatCurrency(term.paid)}</strong>
                          </span>
                          <span>
                            Balance: <strong className={term.outstanding > 0 ? "text-rose-600" : "text-muted-foreground"}>{formatCurrency(term.outstanding)}</strong>
                          </span>
                        </div>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs">
                            <TableHead>Installment</TableHead>
                            <TableHead>Due Date</TableHead>
                            <TableHead className="text-right">Assigned Amount</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {term.installments.map((inst) => (
                            <TableRow key={inst.id} className="text-xs">
                              <TableCell className="font-medium">{inst.label}</TableCell>
                              <TableCell>{inst.dueDate ? new Date(inst.dueDate).toLocaleDateString() : "—"}</TableCell>
                              <TableCell className="text-right font-semibold">{formatCurrency(inst.amount)}</TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="text-[10px] capitalize">
                                  {inst.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
              </div>

              {/* Chronological Fee Ledger */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Chronological Fee Ledger
                  </h4>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => window.print()}
                  >
                    <Printer size={12} className="mr-1" />
                    Print Statement
                  </Button>
                </div>

                {loadingLedger ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">Loading ledger entries...</div>
                ) : studentLedger && studentLedger.entries.length > 0 ? (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead>Date</TableHead>
                          <TableHead>Entry Type</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Running Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {studentLedger.entries.map((entry) => (
                          <TableRow key={entry.id} className="text-xs">
                            <TableCell className="text-muted-foreground">
                              {new Date(entry.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] capitalize ${
                                  entry.type === "charge"
                                    ? "text-blue-700 bg-blue-50"
                                    : entry.type === "concession"
                                    ? "text-emerald-700 bg-emerald-50"
                                    : entry.type === "payment"
                                    ? "text-purple-700 bg-purple-50"
                                    : ""
                                }`}
                              >
                                {entry.type}
                              </Badge>
                            </TableCell>
                            <TableCell>{entry.description}</TableCell>
                            <TableCell className={`text-right font-medium ${entry.amount > 0 ? "text-foreground" : "text-emerald-600"}`}>
                              {entry.amount > 0 ? formatCurrency(entry.amount) : `-${formatCurrency(Math.abs(entry.amount))}`}
                            </TableCell>
                            <TableCell className="text-right font-bold">
                              {formatCurrency(entry.runningBalance || 0)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="py-4 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                    No ledger entries recorded yet.
                  </div>
                )}
              </div>

              {/* Financial Balance Summary Footer */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs grid grid-cols-2 gap-2 sm:grid-cols-5 text-center font-medium">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Gross Charges</span>
                  <span className="font-bold text-sm">{formatCurrency(viewingAssignment.grossAmount)}</span>
                </div>
                <div>
                  <span className="text-emerald-600 block text-[11px]">Concessions</span>
                  <span className="font-bold text-sm text-emerald-600">-{formatCurrency(viewingAssignment.discountAmount)}</span>
                </div>
                <div>
                  <span className="text-primary block text-[11px]">Net Obligation</span>
                  <span className="font-bold text-sm">{formatCurrency(viewingAssignment.netAmount)}</span>
                </div>
                <div>
                  <span className="text-purple-600 block text-[11px]">Total Paid</span>
                  <span className="font-bold text-sm text-purple-600">
                    {formatCurrency(studentLedger?.totalPaid || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-rose-600 block text-[11px]">Outstanding Due</span>
                  <span className="font-bold text-sm text-rose-600">
                    {formatCurrency(studentLedger?.outstanding || viewingAssignment.netAmount)}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button onClick={() => setDetailsModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

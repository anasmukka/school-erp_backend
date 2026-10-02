import { db } from '@/lib/firebase';
import { logAuditEvent } from '@/lib/audit';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  serverTimestamp, 
  orderBy, 
  limit as fsLimit,
  startAfter 
} from 'firebase/firestore';

export interface Actor {
  uid: string;
  name: string;
  role: string;
}

export interface FeeStructureSnapshot {
  title: string;
  grade: string;
  academicSessionId?: string;
  academicSession?: string;
  feeHeads: Array<{id: string; name: string; amount: number}>;
  terms?: Array<{
    termId: string;
    termName: string;
    order: number;
    installments: Array<{ id: string; label: string; amount: number; dueDate: string; termId?: string; termName?: string; order?: number }>;
  }>;
  installments: Array<{id: string; label: string; amount: number; dueDate: string; termId?: string; termName?: string; order?: number}>;
  term?: string;
  createdAt: string;
}

export interface LineItem {
  id: string;
  feeHeadId: string;
  feeHeadName: string;
  amount: number;
  category: 'base' | 'additional' | 'transport' | 'other';
}

export type ConcessionStatus = 'pending_approval' | 'active' | 'rejected' | 'revoked';

export const CONCESSION_ADMIN_THRESHOLD_INR = 5000;

export interface Concession {
  id: string;
  type: 'scholarship' | 'sibling_discount' | 'staff_concession' | 'financial_concession' | 'management_concession' | 'other';
  label: string;
  amount: number;
  percentage: number | null;
  affectedFeeHeadId: string | null;
  reason: string;
  requestedBy?: string;
  requestedByName?: string;
  requestedAt?: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  status: ConcessionStatus;
}

export interface Installment {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  status: 'upcoming' | 'due' | 'partially_paid' | 'paid' | 'overdue' | 'waived';
  termId?: string;
  termName?: string;
  order?: number;
}

export interface AssignmentTerm {
  termId: string;
  termName: string;
  order: number;
  installments: Installment[];
}

export interface CreateFeeAssignmentParams {
  studentId: string;
  studentUid?: string;
  authUid?: string;
  studentName: string;
  admissionNo: string;
  grade: string;
  sectionId: string | null;
  sectionName: string | null;
  sessionId: string;
  academicYear: string;
  enrollmentId: string;
  structureId: string;
  structureVersion?: number;
  structureSnapshot: FeeStructureSnapshot;
  lineItems: LineItem[];
  concessions: Concession[];
  terms?: AssignmentTerm[];
  installments: Installment[];
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  notes: string;
}

export interface StudentFeeAssignment extends CreateFeeAssignmentParams {
  id?: string;
  studentUid?: string;
  authUid?: string;
  structureVersion: number;
  status: 'active' | 'voided' | 'superseded';
  version: number;
  assignedBy: string;
  assignedByName: string;
  assignedAt: string;
  createdAt: string;
  updatedAt: string;
}

export async function createFeeAssignment(params: CreateFeeAssignmentParams, actor: Actor): Promise<string> {
  const timestamp = new Date().toISOString();
  
  // Infer terms if not explicitly provided
  let terms = params.terms;
  if (!terms || terms.length === 0) {
    if (params.structureSnapshot?.terms && params.structureSnapshot.terms.length > 0) {
      const instMap = new Map((params.installments || []).map(i => [i.id, i]));
      terms = params.structureSnapshot.terms.map(st => ({
        termId: st.termId,
        termName: st.termName,
        order: st.order,
        installments: st.installments.map(si => instMap.get(si.id) || {
          id: si.id,
          label: si.label,
          amount: si.amount,
          dueDate: si.dueDate,
          status: 'upcoming' as const,
          termId: st.termId,
          termName: st.termName,
          order: si.order,
        }),
      }));
    } else if (params.installments && params.installments.some(i => i.termId)) {
      const termMap = new Map<string, AssignmentTerm>();
      params.installments.forEach(inst => {
        const tId = inst.termId || 'term_1';
        const tName = inst.termName || 'Term 1';
        const existing = termMap.get(tId) || { termId: tId, termName: tName, order: inst.order || 1, installments: [] };
        existing.installments.push(inst);
        termMap.set(tId, existing);
      });
      terms = Array.from(termMap.values());
    }
  }

  const assignmentData: StudentFeeAssignment = {
    ...params,
    terms,
    studentUid: params.studentUid || params.studentId,
    authUid: params.authUid || params.studentUid || params.studentId,
    structureVersion: params.structureVersion || 1,
    status: 'active',
    version: 1,
    assignedBy: actor.uid,
    assignedByName: actor.name,
    assignedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const docRef = await addDoc(collection(db, 'studentFeeAssignments'), assignmentData);

  await logAuditEvent({
    action: 'create',
    entity: 'fee_assignment',
    entityId: docRef.id,
    actor: { id: actor.uid, name: actor.name, role: actor.role },
    details: {
      studentId: params.studentId,
      studentUid: assignmentData.studentUid,
      authUid: assignmentData.authUid,
      sessionId: params.sessionId,
      netAmount: params.netAmount
    }
  });

  return docRef.id;
}

export async function updateFeeAssignment(assignmentId: string, updates: Partial<StudentFeeAssignment>, actor: Actor, reason: string): Promise<void> {
  const docRef = doc(db, 'studentFeeAssignments', assignmentId);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) {
    throw new Error('Fee assignment not found');
  }
  
  const currentData = docSnap.data() as StudentFeeAssignment;
  const newVersion = (currentData.version || 1) + 1;
  
  const updateData = {
    ...updates,
    version: newVersion,
    updatedAt: new Date().toISOString()
  };
  
  await updateDoc(docRef, updateData);
  
  await logAuditEvent({
    action: 'update',
    entity: 'fee_assignment',
    entityId: assignmentId,
    actor: { id: actor.uid, name: actor.name, role: actor.role },
    details: {
      reason,
      changes: Object.keys(updates).join(', '),
      version: newVersion
    }
  });
}

export async function getFeeAssignment(assignmentId: string): Promise<StudentFeeAssignment | null> {
  const docRef = doc(db, 'studentFeeAssignments', assignmentId);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) {
    return null;
  }
  
  return { id: docSnap.id, ...docSnap.data() } as StudentFeeAssignment;
}

export async function getStudentFeeAssignment(
  studentId: string,
  sessionId: string,
  studentUid?: string
): Promise<StudentFeeAssignment | null> {
  // 1. Primary query: studentId + sessionId
  const q1 = query(
    collection(db, 'studentFeeAssignments'),
    where('studentId', '==', studentId),
    where('sessionId', '==', sessionId),
    where('status', '==', 'active')
  );
  const snap1 = await getDocs(q1);
  if (!snap1.empty) {
    const d = snap1.docs[0];
    return { id: d.id, ...d.data() } as StudentFeeAssignment;
  }

  // 2. Fallback query: studentUid + sessionId
  if (studentUid && studentUid !== studentId) {
    const q2 = query(
      collection(db, 'studentFeeAssignments'),
      where('studentUid', '==', studentUid),
      where('sessionId', '==', sessionId),
      where('status', '==', 'active')
    );
    const snap2 = await getDocs(q2);
    if (!snap2.empty) {
      const d = snap2.docs[0];
      return { id: d.id, ...d.data() } as StudentFeeAssignment;
    }
  }

  // 3. Fallback query: studentId + academicYear
  const q3 = query(
    collection(db, 'studentFeeAssignments'),
    where('studentId', '==', studentId),
    where('academicYear', '==', sessionId),
    where('status', '==', 'active')
  );
  const snap3 = await getDocs(q3);
  if (!snap3.empty) {
    const d = snap3.docs[0];
    return { id: d.id, ...d.data() } as StudentFeeAssignment;
  }

  // 4. Fallback query: studentUid + academicYear
  if (studentUid && studentUid !== studentId) {
    const q4 = query(
      collection(db, 'studentFeeAssignments'),
      where('studentUid', '==', studentUid),
      where('academicYear', '==', sessionId),
      where('status', '==', 'active')
    );
    const snap4 = await getDocs(q4);
    if (!snap4.empty) {
      const d = snap4.docs[0];
      return { id: d.id, ...d.data() } as StudentFeeAssignment;
    }
  }

  // 5. Fallback query by authUid
  const effectiveAuthUid = studentUid || studentId;
  const q5 = query(
    collection(db, 'studentFeeAssignments'),
    where('authUid', '==', effectiveAuthUid),
    where('status', '==', 'active')
  );
  const snap5 = await getDocs(q5);
  if (!snap5.empty) {
    const matching = snap5.docs.find(d => {
      const data = d.data();
      return data.sessionId === sessionId || data.academicYear === sessionId;
    });
    if (matching) {
      return { id: matching.id, ...matching.data() } as StudentFeeAssignment;
    }
  }

  return null;
}

export async function listFeeAssignments(filters: { sessionId?: string; grade?: string; status?: string; limit?: number; startAfter?: any }): Promise<StudentFeeAssignment[]> {
  let conditions: any[] = [];
  
  if (filters.sessionId) conditions.push(where('sessionId', '==', filters.sessionId));
  if (filters.grade) conditions.push(where('grade', '==', filters.grade));
  if (filters.status) conditions.push(where('status', '==', filters.status));
  
  conditions.push(orderBy('createdAt', 'desc'));
  
  if (filters.limit) conditions.push(fsLimit(filters.limit));
  if (filters.startAfter) conditions.push(startAfter(filters.startAfter));
  
  const q = query(collection(db, 'studentFeeAssignments'), ...conditions);
  const querySnapshot = await getDocs(q);
  
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StudentFeeAssignment));
}

export async function getUnassignedStudents(sessionId: string, grade?: string): Promise<any[]> {
  // 1. Fetch active enrollments for the session (and optionally grade)
  let enrollmentsConditions = [where('sessionId', '==', sessionId), where('status', '==', 'active')];
  if (grade) {
    enrollmentsConditions.push(where('grade', '==', grade));
  }
  
  const enrollmentsQuery = query(collection(db, 'enrollments'), ...enrollmentsConditions);
  const enrollmentsSnap = await getDocs(enrollmentsQuery);
  const enrollments = enrollmentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  
  // 2. Fetch active fee assignments for the session
  let assignmentsConditions = [where('sessionId', '==', sessionId), where('status', '==', 'active')];
  if (grade) {
    assignmentsConditions.push(where('grade', '==', grade));
  }
  
  const assignmentsQuery = query(collection(db, 'studentFeeAssignments'), ...assignmentsConditions);
  const assignmentsSnap = await getDocs(assignmentsQuery);
  const assignedStudentIds = new Set(assignmentsSnap.docs.map(d => d.data().studentId));
  
  // 3. Filter unassigned
  const unassigned = enrollments.filter(e => !assignedStudentIds.has(e.studentId));
  return unassigned;
}

export async function addConcession(assignmentId: string, concession: Concession, actor: Actor): Promise<void> {
  const assignment = await getFeeAssignment(assignmentId);
  if (!assignment) throw new Error('Fee assignment not found');
  
  // Enforce threshold and role-based concession workflow (SEC-06)
  if (actor.role === 'admin') {
    concession.status = 'active';
    concession.approvedBy = actor.uid;
    concession.approvedByName = actor.name;
    concession.approvedAt = new Date().toISOString();
  } else {
    // Non-admin (e.g. accountant): If exceeding threshold, must be pending_approval
    if (concession.amount > CONCESSION_ADMIN_THRESHOLD_INR) {
      concession.status = 'pending_approval';
      concession.requestedBy = actor.uid;
      concession.requestedByName = actor.name;
      concession.requestedAt = new Date().toISOString();
    } else {
      concession.status = 'active';
      concession.approvedBy = actor.uid;
      concession.approvedByName = actor.name;
      concession.approvedAt = new Date().toISOString();
    }
  }

  // Add concession to list
  const updatedConcessions = [...(assignment.concessions || []), concession];
  
  if (concession.status === 'active') {
    // Recalculate totals only with active concessions
    const totalConcessionAmount = updatedConcessions.filter(c => c.status === 'active').reduce((sum, c) => sum + c.amount, 0);
    const newDiscountAmount = totalConcessionAmount;
    const newNetAmount = Math.max(0, assignment.grossAmount - newDiscountAmount);
    
    // Proportionally recalculate upcoming installments
    const updatedInstallments = assignment.installments.map(inst => ({ ...inst }));
    const activeUpcoming = updatedInstallments.filter(i => i.status === 'upcoming');
    if (activeUpcoming.length > 0) {
      const fixedAmount = updatedInstallments.filter(i => i.status !== 'upcoming').reduce((sum, i) => sum + i.amount, 0);
      const amountToDistribute = Math.max(0, newNetAmount - fixedAmount);
      const originalUpcomingTotal = activeUpcoming.reduce((sum, i) => sum + i.amount, 0);
      
      if (originalUpcomingTotal > 0) {
        let distributedSum = 0;
        activeUpcoming.forEach((inst, index) => {
          if (index === activeUpcoming.length - 1) {
            inst.amount = amountToDistribute - distributedSum;
          } else {
            const ratio = inst.amount / originalUpcomingTotal;
            const newAmount = Math.round(amountToDistribute * ratio);
            inst.amount = newAmount;
            distributedSum += newAmount;
          }
        });
      }
    }

function syncAssignmentTerms(
  terms: AssignmentTerm[] | undefined,
  updatedInstallments: Installment[]
): AssignmentTerm[] | undefined {
  if (!terms || terms.length === 0) return undefined;
  const instMap = new Map(updatedInstallments.map((i) => [i.id, i]));
  return terms.map((t) => ({
    ...t,
    installments: t.installments.map((i) => instMap.get(i.id) || i),
  }));
}

    await updateFeeAssignment(assignmentId, {
      concessions: updatedConcessions,
      discountAmount: newDiscountAmount,
      netAmount: newNetAmount,
      installments: updatedInstallments,
      terms: syncAssignmentTerms(assignment.terms, updatedInstallments),
    }, actor, 'Added active concession: ' + concession.label);

    // Record concession in fee ledger
    try {
      const { recordLedgerEntry } = await import('./feeLedger');
      await recordLedgerEntry(
        {
          studentId: assignment.studentId,
          studentUid: assignment.studentUid,
          assignmentId,
          sessionId: assignment.sessionId,
          type: 'concession',
          description: `Concession: ${concession.label}`,
          amount: -concession.amount,
          feeHeadId: concession.affectedFeeHeadId || undefined,
          recordedBy: actor.uid,
          recordedByName: actor.name,
          createdAt: new Date().toISOString(),
        },
        actor as any
      );
    } catch (e) {
      console.warn('Could not post concession to ledger:', e);
    }
  } else {
    // Concession is pending_approval: DO NOT reduce netAmount or modify installments!
    await updateFeeAssignment(assignmentId, {
      concessions: updatedConcessions
    }, actor, `Submitted concession for Admin approval: ${concession.label} (₹${concession.amount})`);
  }
}

export async function approveConcession(assignmentId: string, concessionId: string, actor: Actor): Promise<void> {
  if (actor.role !== 'admin') {
    throw new Error('Unauthorized: Only administrators can approve concessions.');
  }

  const assignment = await getFeeAssignment(assignmentId);
  if (!assignment) throw new Error('Fee assignment not found');

  let approvedConcession: Concession | null = null;
  const updatedConcessions = assignment.concessions.map((c) => {
    if (c.id === concessionId && c.status === 'pending_approval') {
      approvedConcession = {
        ...c,
        status: 'active' as const,
        approvedBy: actor.uid,
        approvedByName: actor.name,
        approvedAt: new Date().toISOString(),
      };
      return approvedConcession;
    }
    return c;
  });

  if (!approvedConcession) {
    throw new Error('Pending concession not found or already processed.');
  }

  // Recalculate totals
  const totalConcessionAmount = updatedConcessions
    .filter((c) => c.status === 'active')
    .reduce((sum, c) => sum + c.amount, 0);
  const newDiscountAmount = totalConcessionAmount;
  const newNetAmount = Math.max(0, assignment.grossAmount - newDiscountAmount);

  // Recalculate upcoming installments
  const updatedInstallments = assignment.installments.map(inst => ({ ...inst }));
  const activeUpcoming = updatedInstallments.filter((i) => i.status === 'upcoming');
  if (activeUpcoming.length > 0) {
    const fixedAmount = updatedInstallments
      .filter((i) => i.status !== 'upcoming')
      .reduce((sum, i) => sum + i.amount, 0);
    const amountToDistribute = Math.max(0, newNetAmount - fixedAmount);
    const originalUpcomingTotal = activeUpcoming.reduce((sum, i) => sum + i.amount, 0);

    if (originalUpcomingTotal > 0) {
      let distributedSum = 0;
      activeUpcoming.forEach((inst, index) => {
        if (index === activeUpcoming.length - 1) {
          inst.amount = amountToDistribute - distributedSum;
        } else {
          const ratio = inst.amount / originalUpcomingTotal;
          const newAmount = Math.round(amountToDistribute * ratio);
          inst.amount = newAmount;
          distributedSum += newAmount;
        }
      });
    }
  }

  await updateFeeAssignment(
    assignmentId,
    {
      concessions: updatedConcessions,
      discountAmount: newDiscountAmount,
      netAmount: newNetAmount,
      installments: updatedInstallments,
      terms: syncAssignmentTerms(assignment.terms, updatedInstallments),
    },
    actor,
    `Admin approved concession: ${(approvedConcession as Concession).label}`
  );

  // Record ledger entry
  try {
    const { recordLedgerEntry } = await import('./feeLedger');
    await recordLedgerEntry(
      {
        studentId: assignment.studentId,
        studentUid: assignment.studentUid,
        assignmentId,
        sessionId: assignment.sessionId,
        type: 'concession',
        description: `Approved Concession: ${(approvedConcession as Concession).label}`,
        amount: -(approvedConcession as Concession).amount,
        feeHeadId: (approvedConcession as Concession).affectedFeeHeadId || undefined,
        recordedBy: actor.uid,
        recordedByName: actor.name,
        createdAt: new Date().toISOString(),
      },
      actor as any
    );
  } catch (e) {
    console.warn('Could not post approved concession to ledger:', e);
  }
}

export async function rejectConcession(assignmentId: string, concessionId: string, reason: string, actor: Actor): Promise<void> {
  if (actor.role !== 'admin') {
    throw new Error('Unauthorized: Only administrators can reject concessions.');
  }

  const assignment = await getFeeAssignment(assignmentId);
  if (!assignment) throw new Error('Fee assignment not found');

  let rejected = false;
  const updatedConcessions = assignment.concessions.map((c) => {
    if (c.id === concessionId && c.status === 'pending_approval') {
      rejected = true;
      return {
        ...c,
        status: 'rejected' as const,
        rejectedBy: actor.uid,
        rejectedByName: actor.name,
        rejectedAt: new Date().toISOString(),
        rejectionReason: reason || 'Rejected by Administrator',
      };
    }
    return c;
  });

  if (!rejected) {
    throw new Error('Pending concession not found or already processed.');
  }

  await updateFeeAssignment(
    assignmentId,
    {
      concessions: updatedConcessions,
    },
    actor,
    `Admin rejected concession: ${reason}`
  );
}

export async function removeConcession(assignmentId: string, concessionId: string, actor: Actor): Promise<void> {
  const assignment = await getFeeAssignment(assignmentId);
  if (!assignment) throw new Error('Fee assignment not found');
  
  let concessionFound = false;
  const updatedConcessions = assignment.concessions.map(c => {
    if (c.id === concessionId && c.status === 'active') {
      concessionFound = true;
      return { ...c, status: 'revoked' as const };
    }
    return c;
  });
  
  if (!concessionFound) throw new Error('Active concession not found');
  
  // Recalculate totals
  const totalConcessionAmount = updatedConcessions.filter(c => c.status === 'active').reduce((sum, c) => sum + c.amount, 0);
  const newDiscountAmount = totalConcessionAmount;
  const newNetAmount = Math.max(0, assignment.grossAmount - newDiscountAmount);
  
  // Proportionally recalculate upcoming installments
  const updatedInstallments = assignment.installments.map(inst => ({ ...inst }));
  const activeUpcoming = updatedInstallments.filter(i => i.status === 'upcoming');
  if (activeUpcoming.length > 0) {
    const fixedAmount = updatedInstallments.filter(i => i.status !== 'upcoming').reduce((sum, i) => sum + i.amount, 0);
    const amountToDistribute = Math.max(0, newNetAmount - fixedAmount);
    
    const originalUpcomingTotal = activeUpcoming.reduce((sum, i) => sum + i.amount, 0);
    
    if (originalUpcomingTotal > 0) {
      let distributedSum = 0;
      activeUpcoming.forEach((inst, index) => {
        if (index === activeUpcoming.length - 1) {
          inst.amount = amountToDistribute - distributedSum;
        } else {
          const ratio = inst.amount / originalUpcomingTotal;
          const newAmount = Math.round(amountToDistribute * ratio);
          inst.amount = newAmount;
          distributedSum += newAmount;
        }
      });
    }
  }

  await updateFeeAssignment(assignmentId, {
    concessions: updatedConcessions,
    discountAmount: newDiscountAmount,
    netAmount: newNetAmount,
    installments: updatedInstallments,
    terms: syncAssignmentTerms(assignment.terms, updatedInstallments),
  }, actor, 'Removed concession: ' + concessionId);
}

export async function voidFeeAssignment(assignmentId: string, reason: string, actor: Actor): Promise<void> {
  await updateFeeAssignment(assignmentId, { status: 'voided' }, actor, 'Voided fee assignment: ' + reason);
}

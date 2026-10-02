import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AcademicSession, AcademicSessionStatus } from "@/lib/types";

export const DEFAULT_SESSION_NAME = "2026-27";

export interface SessionSummary {
  enrolledStudents: number;
  studentCount: number;
  classesCount: number;
  sectionsCount: number;
  sectionCount: number;
}

/**
 * List all academic sessions.
 * Gracefully migrates from legacy `academicYears` or seeds initial 2026-27 session if none exist.
 */
export async function listAcademicSessions(): Promise<AcademicSession[]> {
  try {
    const snap = await getDocs(collection(db, "academicSessions"));
    if (!snap.empty) {
      const rawList = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AcademicSession));
      const byName = new Map<string, AcademicSession>();
      for (const s of rawList) {
        const existing = byName.get(s.name);
        if (!existing) {
          byName.set(s.name, s);
        } else {
          // Prioritize canonical doc where id === name, or active/isCurrent
          if (s.id === s.name || (!existing.isCurrent && s.isCurrent)) {
            byName.set(s.name, s);
          }
        }
      }
      return Array.from(byName.values()).sort((a, b) =>
        (b.startDate || b.name).localeCompare(a.startDate || a.name),
      );
    }

    // Check if legacy academicYears has entries
    const legacySnap = await getDocs(collection(db, "academicYears"));
    if (!legacySnap.empty) {
      const batch = writeBatch(db);
      const migrated: AcademicSession[] = [];

      for (const d of legacySnap.docs) {
        const data = d.data();
        const name = String(data.name || d.id);
        const sessionDoc: AcademicSession = {
          id: name,
          name,
          startDate: data.startDate || "2026-06-01",
          endDate: data.endDate || "2027-04-30",
          status: data.isCurrent ? "active" : "archived",
          isCurrent: !!data.isCurrent,
          notes: data.notes || "",
          createdAt: data.createdAt || new Date().toISOString(),
        };
        batch.set(doc(db, "academicSessions", name), sessionDoc);
        migrated.push(sessionDoc);
      }
      await batch.commit();
      return migrated.sort((a, b) => (b.startDate || b.name).localeCompare(a.startDate || a.name));
    }

    // Default seed if totally clean database
    const initialSession: AcademicSession = {
      id: DEFAULT_SESSION_NAME,
      name: DEFAULT_SESSION_NAME,
      startDate: "2026-06-01",
      endDate: "2027-04-30",
      status: "active",
      isCurrent: true,
      notes: "Primary academic session",
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, "academicSessions", DEFAULT_SESSION_NAME), initialSession);
    // Also mirror to legacy academicYears
    await setDoc(doc(db, "academicYears", DEFAULT_SESSION_NAME), {
      name: DEFAULT_SESSION_NAME,
      startDate: "2026-06-01",
      endDate: "2027-04-30",
      isCurrent: true,
      notes: "Primary academic session",
      createdAt: new Date().toISOString(),
    });
    return [initialSession];
  } catch (err) {
    console.error("Failed to list academic sessions:", err);
    return [
      {
        id: DEFAULT_SESSION_NAME,
        name: DEFAULT_SESSION_NAME,
        startDate: "2026-06-01",
        endDate: "2027-04-30",
        status: "active",
        isCurrent: true,
        createdAt: new Date().toISOString(),
      },
    ];
  }
}

/**
 * Get the single currently active academic session.
 */
export async function getActiveAcademicSession(): Promise<AcademicSession> {
  const sessions = await listAcademicSessions();
  const active = sessions.find((s) => s.isCurrent || s.status === "active");
  if (active) return active;
  return sessions[0];
}

/**
 * Retrieves a canonical session by its ID or Name.
 * Validates that it exists in the canonical academicSessions collection.
 */
export async function getAcademicSessionById(
  sessionIdOrName: string
): Promise<AcademicSession | null> {
  if (!sessionIdOrName || !sessionIdOrName.trim()) return null;
  try {
    const cleanId = sessionIdOrName.trim();
    // 1. Direct doc lookup by ID
    const snap = await getDoc(doc(db, "academicSessions", cleanId));
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() } as AcademicSession;
    }
    // 2. Lookup by name if doc ID differs
    const q = query(collection(db, "academicSessions"), where("name", "==", cleanId));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const d = querySnap.docs[0];
      return { id: d.id, ...d.data() } as AcademicSession;
    }
    return null;
  } catch (err) {
    console.error(`Failed to get academic session ${sessionIdOrName}:`, err);
    return null;
  }
}

/**
 * Create a new planned academic session (never active by default).
 */
export async function createAcademicSession(input: {
  name: string;
  startDate: string;
  endDate: string;
  notes?: string;
}): Promise<AcademicSession> {
  const cleanName = input.name.trim();
  if (!cleanName) throw new Error("Session name is required.");
  if (!input.startDate || !input.endDate) throw new Error("Start and End dates are required.");
  if (input.startDate >= input.endDate) throw new Error("Start date must be before End date.");

  const docId = cleanName;
  const existingSnap = await getDoc(doc(db, "academicSessions", docId));
  if (existingSnap.exists()) {
    throw new Error(`Academic session ${cleanName} already exists.`);
  }

  const newSession: AcademicSession = {
    id: docId,
    name: cleanName,
    startDate: input.startDate,
    endDate: input.endDate,
    status: "planned",
    isCurrent: false,
    notes: input.notes?.trim() || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const batch = writeBatch(db);
  batch.set(doc(db, "academicSessions", docId), newSession);
  // Mirror to academicYears for backward compatibility
  batch.set(doc(db, "academicYears", docId), {
    name: cleanName,
    startDate: input.startDate,
    endDate: input.endDate,
    isCurrent: false,
    notes: input.notes?.trim() || "",
    createdAt: new Date().toISOString(),
  });

  await batch.commit();
  return newSession;
}

/**
 * Atomically activate a session.
 * The target session becomes isCurrent: true, status: 'active'.
 * Any previously active session becomes isCurrent: false, status: 'archived'.
 */
export async function activateAcademicSession(sessionId: string): Promise<void> {
  const snap = await getDocs(collection(db, "academicSessions"));
  if (snap.empty) throw new Error("No academic sessions found.");

  const allDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AcademicSession));
  const target = allDocs.find((s) => s.id === sessionId || s.name === sessionId);
  if (!target) throw new Error(`Session ${sessionId} not found.`);

  const batch = writeBatch(db);
  for (const s of allDocs) {
    const isTarget = s.name === target.name;
    const sessionRef = doc(db, "academicSessions", s.id);
    const legacyRef = doc(db, "academicYears", s.name);

    const nextStatus: AcademicSessionStatus = isTarget
      ? "active"
      : s.status === "active"
        ? "archived"
        : s.status;

    batch.update(sessionRef, {
      isCurrent: isTarget,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });

    batch.set(
      legacyRef,
      {
        name: s.name,
        isCurrent: isTarget,
      },
      { merge: true },
    );
  }

  await batch.commit();
}

/**
 * Archive an academic session.
 * Prevents archiving if it is currently active.
 */
export async function archiveAcademicSession(sessionId: string): Promise<void> {
  const sessions = await listAcademicSessions();
  const target = sessions.find((s) => s.id === sessionId || s.name === sessionId);
  if (!target) throw new Error(`Session ${sessionId} not found.`);
  if (target.isCurrent || target.status === "active") {
    throw new Error("Cannot archive the currently active session. Activate another session first.");
  }

  await updateDoc(doc(db, "academicSessions", target.id), {
    status: "archived",
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Compute counts of enrolled students, distinct grades, and sections for any session.
 */
export async function getSessionSummary(
  sessionId: string,
  sessionName?: string,
): Promise<SessionSummary> {
  try {
    const queryIds = Array.from(
      new Set([sessionId, sessionName].filter((x): x is string => Boolean(x) && typeof x === "string")),
    );

    const enrollmentQueries: Promise<any>[] = [];
    for (const qid of queryIds) {
      enrollmentQueries.push(
        getDocs(query(collection(db, "enrollments"), where("sessionId", "==", qid))),
      );
      enrollmentQueries.push(
        getDocs(query(collection(db, "enrollments"), where("academicYear", "==", qid))),
      );
    }

    const [sectionsSnap, ...enrollmentResults] = await Promise.all([
      getDocs(collection(db, "sections")),
      ...enrollmentQueries,
    ]);

    const seenEnrollmentIds = new Set<string>();
    const studentIds = new Set<string>();
    const classes = new Set<string>();
    const enrolledSectionIds = new Set<string>();

    const processDoc = (d: any) => {
      if (seenEnrollmentIds.has(d.id)) return;
      seenEnrollmentIds.add(d.id);
      const data = d.data();
      if (data.status === "transferred" || data.status === "graduated") return;
      if (data.studentId) studentIds.add(data.studentId);
      if (data.className) classes.add(data.className);
      if (data.sectionId) enrolledSectionIds.add(data.sectionId);
    };

    for (const snap of enrollmentResults) {
      snap.docs.forEach(processDoc);
    }

    const totalSections = sectionsSnap.size;
    let computedSections = enrolledSectionIds.size;
    if (enrolledSectionIds.size > 0 && totalSections > enrolledSectionIds.size) {
      computedSections = totalSections;
    }

    return {
      enrolledStudents: studentIds.size,
      studentCount: studentIds.size,
      classesCount: classes.size,
      sectionsCount: computedSections,
      sectionCount: computedSections,
    };
  } catch (err) {
    console.error(`Failed to get summary for session ${sessionId}:`, err);
    return {
      enrolledStudents: 0,
      studentCount: 0,
      classesCount: 0,
      sectionsCount: 0,
      sectionCount: 0,
    };
  }
}

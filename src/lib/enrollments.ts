import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  addDoc,
  updateDoc,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Enrollment, EnrollmentStatus, Section, Student } from "@/lib/types";
import { getAcademicSession } from "@/lib/fees";
import { getActiveAcademicSession, listAcademicSessions } from "@/lib/sessions";

export type StudentWithEnrollment = Student & {
  enrollmentId: string;
  academicYear: string;
  className: string;
  sectionName: string | null;
  /** Resolved from active enrollment (not legacy student doc). */
  activeSectionId: string | null;
  activeGrade: string;
  rollNo?: string;
  enrollmentStatus?: EnrollmentStatus;
};

export async function getCurrentAcademicYear(): Promise<string> {
  try {
    const active = await getActiveAcademicSession();
    if (active?.name) return active.name;
    const snap = await getDocs(
      query(collection(db, "academicYears"), where("isCurrent", "==", true)),
    );
    if (!snap.empty) {
      const name = snap.docs[0].data().name;
      if (name) return String(name);
    }
  } catch {
    /* fallback */
  }
  return getAcademicSession();
}

export async function listAcademicYears(): Promise<{ id: string; name: string; isCurrent?: boolean }[]> {
  try {
    const sessions = await listAcademicSessions();
    if (sessions.length > 0) {
      return sessions.map((s) => ({
        id: s.id,
        name: s.name,
        isCurrent: s.isCurrent,
      }));
    }
  } catch {
    /* fallback */
  }
  const snap = await getDocs(collection(db, "academicYears"));
  return snap.docs
    .map((d) => ({ id: d.id, name: String(d.data().name ?? ""), isCurrent: !!d.data().isCurrent }))
    .filter((y) => y.name)
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function enrollmentFromStudentLegacy(student: Student, academicYear: string): Omit<Enrollment, "id"> {
  return {
    studentId: student.id,
    academicYear,
    className: student.grade || "",
    sectionName: null,
    sectionId: student.sectionId ?? null,
    rollNo: student.rollNo ?? "",
    hodId: student.hodId || "",
    status: "active",
    createdAt: new Date().toISOString(),
  };
}

export async function getActiveEnrollment(studentId: string, academicYear?: string): Promise<Enrollment | null> {
  if (academicYear) {
    const snap = await getDocs(
      query(
        collection(db, "enrollments"),
        where("studentId", "==", studentId),
        where("academicYear", "==", academicYear),
      ),
    );
    const valid = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Enrollment))
      .filter((e) => e.status !== "transferred");
    return valid[0] ?? null;
  }

  const snap = await getDocs(
    query(
      collection(db, "enrollments"),
      where("studentId", "==", studentId),
      where("status", "==", "active"),
    ),
  );
  if (snap.empty) return null;
  if (snap.docs.length > 1) {
    console.warn(`Multiple active enrollments for student ${studentId}; using newest.`);
    const sorted = snap.docs.sort(
      (a, b) => String(b.data().createdAt ?? "").localeCompare(String(a.data().createdAt ?? "")),
    );
    return { id: sorted[0].id, ...sorted[0].data() } as Enrollment;
  }
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Enrollment;
}

export async function getEnrollmentForStudentInSession(
  studentId: string,
  academicYear: string,
): Promise<Enrollment | null> {
  const snap = await getDocs(
    query(
      collection(db, "enrollments"),
      where("studentId", "==", studentId),
      where("academicYear", "==", academicYear),
    ),
  );
  const valid = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Enrollment))
    .filter((e) => e.status !== "transferred");
  return valid[0] ?? null;
}

export async function hasStudentSessionEnrollment(
  studentId: string,
  academicYear: string,
): Promise<boolean> {
  const existing = await getEnrollmentForStudentInSession(studentId, academicYear);
  return !!existing;
}

export async function getActiveEnrollmentsForSection(
  sectionId: string,
  academicYear?: string,
): Promise<Enrollment[]> {
  const year = academicYear ?? (await getCurrentAcademicYear());
  const [snapYear, snapSession] = await Promise.all([
    getDocs(
      query(
        collection(db, "enrollments"),
        where("sectionId", "==", sectionId),
        where("academicYear", "==", year),
      ),
    ),
    getDocs(
      query(
        collection(db, "enrollments"),
        where("sectionId", "==", sectionId),
        where("sessionId", "==", year),
      ),
    ),
  ]);

  const map = new Map<string, Enrollment>();
  snapYear.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() } as Enrollment));
  snapSession.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() } as Enrollment));

  // Return all non-transferred enrollments in this section for this academic year
  return Array.from(map.values()).filter((e) => e.status !== "transferred");
}

export async function loadStudentsForSection(
  sectionId: string,
  academicYear?: string,
): Promise<StudentWithEnrollment[]> {
  const enrollments = await getActiveEnrollmentsForSection(sectionId, academicYear);
  if (enrollments.length === 0) {
    // Legacy fallback: students still keyed by sectionId on student doc
    const legacySnap = await getDocs(
      query(collection(db, "students"), where("sectionId", "==", sectionId)),
    );
    const year = academicYear ?? (await getCurrentAcademicYear());
    return legacySnap.docs.map((d) => {
      const s = { id: d.id, ...d.data() } as Student;
      return {
        ...s,
        enrollmentId: "",
        academicYear: year,
        className: s.grade || "",
        sectionName: null,
        activeSectionId: s.sectionId ?? null,
        activeGrade: s.grade || "",
        rollNo: s.rollNo || undefined,
      };
    });
  }

  const students = await Promise.all(
    enrollments.map(async (en) => {
      let sSnap = await getDoc(doc(db, "students", en.studentId));
      let sData: any = sSnap.exists() ? sSnap.data() : null;

      // Fallback 1: check admissions collection where linkedUid == en.studentId
      if (!sData) {
        const admSnap = await getDocs(
          query(collection(db, "admissions"), where("linkedUid", "==", en.studentId)),
        );
        if (!admSnap.empty) {
          const adm = admSnap.docs[0].data();
          sData = {
            name: adm.name || "Student",
            email: adm.email || "",
            DOB: adm.dob || "",
            parentContact: adm.parentContact || "",
            grade: adm.grade || en.className || "",
            hodId: adm.hodId || en.hodId || "",
            photo: adm.photoData || "",
            address: adm.address || "",
          };
        }
      }

      // Fallback 2: check users collection
      if (!sData) {
        const uSnap = await getDoc(doc(db, "users", en.studentId));
        if (uSnap.exists()) {
          const u = uSnap.data();
          sData = {
            name: u.name || "Student",
            email: u.email || "",
            DOB: u.DOB || "",
            parentContact: "",
            grade: u.grade || en.className || "",
            hodId: u.hodId || en.hodId || "",
            photo: u.photo || "",
          };
        }
      }

      if (!sData) return null;

      const s = { id: en.studentId, ...sData } as Student;
      return {
        ...s,
        enrollmentId: en.id,
        academicYear: en.academicYear || academicYear || "",
        className: en.className,
        sectionName: en.sectionName,
        activeSectionId: en.sectionId,
        activeGrade: en.className,
        rollNo: en.rollNo || s.rollNo || undefined,
      } satisfies StudentWithEnrollment;
    }),
  );

  return students.filter(Boolean) as StudentWithEnrollment[];
}

export async function getStudentWithActiveEnrollment(
  studentId: string,
): Promise<StudentWithEnrollment | null> {
  let sSnap = await getDoc(doc(db, "students", studentId));
  let sData: any = sSnap.exists() ? sSnap.data() : null;

  if (!sData) {
    const admSnap = await getDocs(
      query(collection(db, "admissions"), where("linkedUid", "==", studentId)),
    );
    if (!admSnap.empty) {
      const adm = admSnap.docs[0].data();
      sData = {
        name: adm.name || "Student",
        email: adm.email || "",
        DOB: adm.dob || "",
        parentContact: adm.parentContact || "",
        grade: adm.grade || "",
        hodId: adm.hodId || "",
        photo: adm.photoData || "",
        address: adm.address || "",
      };
    }
  }

  if (!sData) {
    const uSnap = await getDoc(doc(db, "users", studentId));
    if (uSnap.exists()) {
      const u = uSnap.data();
      sData = {
        name: u.name || "Student",
        email: u.email || "",
        DOB: u.DOB || "",
        parentContact: "",
        grade: u.grade || "",
        hodId: u.hodId || "",
        photo: u.photo || "",
      };
    }
  }

  if (!sData) return null;
  const s = { id: studentId, ...sData } as Student;
  const en = await getActiveEnrollment(studentId);
  if (!en) {
    return {
      ...s,
      enrollmentId: "",
      academicYear: await getCurrentAcademicYear(),
      className: s.grade || "",
      sectionName: null,
      activeSectionId: s.sectionId ?? null,
      activeGrade: s.grade || "",
      rollNo: s.rollNo || undefined,
    };
  }
  return {
    ...s,
    enrollmentId: en.id,
    academicYear: en.academicYear,
    className: en.className,
    sectionName: en.sectionName,
    activeSectionId: en.sectionId,
    activeGrade: en.className,
    rollNo: en.rollNo || s.rollNo || undefined,
  };
}

export async function listPendingEnrollmentsForHod(hodId: string): Promise<
  { student: Student; enrollment: Enrollment }[]
> {
  const studentSnap = await getDocs(query(collection(db, "students"), where("hodId", "==", hodId)));
  const results: { student: Student; enrollment: Enrollment }[] = [];

  for (const d of studentSnap.docs) {
    const student = { id: d.id, ...d.data() } as Student;
    const en = await getActiveEnrollment(student.id);
    if (en && !en.sectionId) {
      results.push({ student, enrollment: en });
      continue;
    }
    // Legacy: no enrollment yet but student has null section
    if (!en && student.sectionId == null) {
      results.push({
        student,
        enrollment: {
          id: "",
          studentId: student.id,
          academicYear: await getCurrentAcademicYear(),
          className: student.grade || "",
          sectionName: null,
          sectionId: null,
          rollNo: student.rollNo || undefined,
          hodId: student.hodId || "",
          status: "active",
          createdAt: "",
        },
      });
    }
  }
  return results;
}

/**
 * Automatically sorts all active students in a section alphabetically by their name
 * and assigns sequential roll numbers ("01", "02", "03", ...).
 * Updates both the enrollment documents and student documents in Firestore.
 */
export async function syncAlphabeticalRollNumbersForSection(
  sectionId: string,
  academicYear?: string,
): Promise<{ updatedCount: number; studentRollMap: Record<string, string> }> {
  if (!sectionId) return { updatedCount: 0, studentRollMap: {} };
  const year = academicYear || (await getCurrentAcademicYear());

  // 1. Fetch all active enrollments for this section
  const [enSnapYear, enSnapSession] = await Promise.all([
    getDocs(
      query(
        collection(db, "enrollments"),
        where("sectionId", "==", sectionId),
        where("academicYear", "==", year),
      ),
    ),
    getDocs(
      query(
        collection(db, "enrollments"),
        where("sectionId", "==", sectionId),
        where("sessionId", "==", year),
      ),
    ),
  ]);

  const mapEnrollments = new Map<string, Enrollment>();
  const processDoc = (d: any) => {
    const data = { id: d.id, ...d.data() } as Enrollment;
    if (data.status !== "transferred" && data.status !== "graduated") {
      mapEnrollments.set(data.studentId, data);
    }
  };
  enSnapYear.docs.forEach(processDoc);
  enSnapSession.docs.forEach(processDoc);

  if (mapEnrollments.size === 0) {
    // If no enrollments found with specific year/session, fallback to all active enrollments in this section
    const fallbackSnap = await getDocs(
      query(collection(db, "enrollments"), where("sectionId", "==", sectionId)),
    );
    fallbackSnap.docs.forEach(processDoc);
  }

  if (mapEnrollments.size === 0) return { updatedCount: 0, studentRollMap: {} };

  // 2. Fetch student names
  const studentIds = Array.from(mapEnrollments.keys());
  const studentSnaps = await Promise.all(
    studentIds.map((sid) => getDoc(doc(db, "students", sid))),
  );

  const studentsList: {
    studentId: string;
    name: string;
    enrollment: Enrollment;
    studentDocExists: boolean;
  }[] = [];

  for (let idx = 0; idx < studentIds.length; idx++) {
    const sid = studentIds[idx];
    const en = mapEnrollments.get(sid)!;
    const sDoc = studentSnaps[idx];
    let name = "";
    let studentDocExists = false;

    if (sDoc.exists()) {
      studentDocExists = true;
      name = (sDoc.data()?.name ?? "").trim();
    }

    if (!name) {
      try {
        const uDoc = await getDoc(doc(db, "users", sid));
        if (uDoc.exists()) {
          name = (uDoc.data()?.name ?? "").trim();
        }
      } catch {
        // ignore
      }
    }

    if (!name) {
      name = (en as any).studentName?.trim() || `Student ${sid.slice(0, 4)}`;
    }

    studentsList.push({ studentId: sid, name, enrollment: en, studentDocExists });
  }

  // 3. Sort alphabetically by student name (case-insensitive)
  studentsList.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  );

  // 4. Update roll numbers in batch
  const batch = writeBatch(db);
  let updatedCount = 0;
  const studentRollMap: Record<string, string> = {};

  studentsList.forEach((item, index) => {
    const newRollNo = String(index + 1).padStart(2, "0");
    studentRollMap[item.studentId] = newRollNo;
    const currentRollNo = item.enrollment.rollNo?.trim();

    if (currentRollNo !== newRollNo) {
      batch.update(doc(db, "enrollments", item.enrollment.id), {
        rollNo: newRollNo,
        updatedAt: new Date().toISOString(),
      });
      if (item.studentDocExists) {
        batch.update(doc(db, "students", item.studentId), {
          rollNo: newRollNo,
          updatedAt: new Date().toISOString(),
        });
      }
      updatedCount++;
    }
  });

  if (updatedCount > 0) {
    await batch.commit();
  }

  return { updatedCount, studentRollMap };
}

export async function assignSectionToEnrollment(
  enrollmentId: string,
  section: Section,
  rollNo?: string,
): Promise<{ rollNo: string }> {
  if (!enrollmentId) throw new Error("Missing enrollment");

  const enRef = doc(db, "enrollments", enrollmentId);
  const enSnap = await getDoc(enRef);
  const enData = enSnap.exists() ? (enSnap.data() as Enrollment) : null;
  const studentId = enData?.studentId;
  const academicYear = enData?.academicYear;

  await updateDoc(enRef, {
    sectionId: section.id,
    sectionName: section.name,
    className: section.grade,
    ...(rollNo !== undefined ? { rollNo } : {}),
  });

  if (studentId) {
    await updateDoc(doc(db, "students", studentId), {
      sectionId: section.id,
      grade: section.grade,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  // Automatically recalculate alphabetical roll numbers for all students in this section
  const { studentRollMap } = await syncAlphabeticalRollNumbersForSection(
    section.id,
    academicYear,
  );

  const assignedRoll = (studentId && studentRollMap[studentId]) || rollNo || "01";
  return { rollNo: assignedRoll };
}

export async function createActiveEnrollment(
  payload: Omit<Enrollment, "id" | "status" | "createdAt">,
): Promise<string> {
  const existing = await getEnrollmentForStudentInSession(payload.studentId, payload.academicYear);
  if (existing) {
    throw new Error(`Student already has an enrollment in session ${payload.academicYear}.`);
  }
  const ref = await addDoc(collection(db, "enrollments"), {
    ...payload,
    status: "active" as EnrollmentStatus,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export interface PromoteStudentInput {
  studentId: string;
  enrollmentId: string;
  targetAcademicYear: string;
  targetSessionId?: string;
  targetClassName?: string;
  targetSectionName?: string;
  targetSectionId?: string;
  rollNo?: string;
  action?: "promote" | "repeat" | "detain" | "transfer" | "graduate";
}

export async function promoteEnrollment(input: PromoteStudentInput): Promise<void> {
  const prevRef = doc(db, "enrollments", input.enrollmentId);
  const prevSnap = await getDoc(prevRef);
  if (!prevSnap.exists()) throw new Error("Previous enrollment not found");

  const prev = { id: prevSnap.id, ...prevSnap.data() } as Enrollment;
  if (prev.status === "graduated" || prev.status === "transferred") {
    throw new Error(`Student has already ${prev.status} from this session.`);
  }

  const action = input.action ?? "promote";

  const nextStatus: EnrollmentStatus =
    action === "graduate"
      ? "graduated"
      : action === "transfer"
        ? "transferred"
        : action === "repeat" || action === "detain"
          ? "repeating"
          : "promoted";

  const batch = writeBatch(db);
  batch.update(prevRef, {
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  });

  if (action === "graduate") {
    batch.update(doc(db, "students", input.studentId), {
      grade: "Graduated",
      updatedAt: new Date().toISOString(),
    });
  } else if (action === "transfer") {
    batch.update(doc(db, "students", input.studentId), {
      grade: "Transferred",
      updatedAt: new Date().toISOString(),
    });
  } else {
    // Check duplicate target enrollment
    const alreadyEnrolled = await getEnrollmentForStudentInSession(
      input.studentId,
      input.targetAcademicYear,
    );
    if (alreadyEnrolled) {
      throw new Error(
        `Student is already enrolled in session ${input.targetAcademicYear}. Cannot promote again.`,
      );
    }

    const newRef = doc(collection(db, "enrollments"));
    batch.set(newRef, {
      studentId: input.studentId,
      academicYear: input.targetAcademicYear,
      sessionId: input.targetSessionId || null,
      className: input.targetClassName ?? prev.className,
      sectionName: input.targetSectionName ?? prev.sectionName,
      sectionId: input.targetSectionId ?? prev.sectionId,
      rollNo: input.rollNo ?? prev.rollNo ?? "",
      hodId: prev.hodId ?? "",
      status: "active",
      createdAt: new Date().toISOString(),
      promotedFromEnrollmentId: prev.id,
    });
  }

  await batch.commit();
}

/** One-time migration: create active enrollment from legacy student grade/section. */
export async function migrateLegacyStudentsToEnrollments(
  onProgress?: (done: number, total: number) => void,
): Promise<{ created: number; skipped: number }> {
  const year = await getCurrentAcademicYear();
  const snap = await getDocs(collection(db, "students"));
  let created = 0;
  let skipped = 0;
  const total = snap.docs.length;

  for (let i = 0; i < snap.docs.length; i++) {
    const student = { id: snap.docs[i].id, ...snap.docs[i].data() } as Student;
    const active = await getActiveEnrollment(student.id);
    if (active) {
      skipped++;
    } else if (!student.grade || student.grade === "Graduated") {
      skipped++;
    } else {
      let sectionName: string | null = null;
      if (student.sectionId) {
        const secSnap = await getDoc(doc(db, "sections", student.sectionId));
        if (secSnap.exists()) sectionName = (secSnap.data() as Section).name;
      }
      await addDoc(collection(db, "enrollments"), {
        ...enrollmentFromStudentLegacy(student, year),
        sectionName,
        createdAt: new Date().toISOString(),
      });
      created++;
    }
    onProgress?.(i + 1, total);
  }
  return { created, skipped };
}

export function sortStudentsByRoll<T extends { rollNo?: string | null; name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ar = a.rollNo?.trim() ?? "";
    const br = b.rollNo?.trim() ?? "";
    return (
      ar.localeCompare(br, undefined, { numeric: true, sensitivity: "base" }) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  });
}

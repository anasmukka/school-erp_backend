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

export type StudentWithEnrollment = Student & {
  enrollmentId: string;
  academicYear: string;
  className: string;
  sectionName: string | null;
  /** Resolved from active enrollment (not legacy student doc). */
  activeSectionId: string | null;
  activeGrade: string;
  rollNo: string | null;
};

export async function getCurrentAcademicYear(): Promise<string> {
  try {
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

export async function getActiveEnrollment(studentId: string): Promise<Enrollment | null> {
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

export async function getActiveEnrollmentsForSection(
  sectionId: string,
  academicYear?: string,
): Promise<Enrollment[]> {
  const year = academicYear ?? (await getCurrentAcademicYear());
  const constraints: QueryConstraint[] = [
    where("sectionId", "==", sectionId),
    where("status", "==", "active"),
    where("academicYear", "==", year),
  ];
  const snap = await getDocs(query(collection(db, "enrollments"), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Enrollment));
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
        className: s.grade,
        sectionName: null,
        activeSectionId: s.sectionId,
        activeGrade: s.grade,
        rollNo: s.rollNo ?? null,
      };
    });
  }

  const students = await Promise.all(
    enrollments.map(async (en) => {
      const sSnap = await getDoc(doc(db, "students", en.studentId));
      if (!sSnap.exists()) return null;
      const s = { id: sSnap.id, ...sSnap.data() } as Student;
      return {
        ...s,
        enrollmentId: en.id,
        academicYear: en.academicYear,
        className: en.className,
        sectionName: en.sectionName,
        activeSectionId: en.sectionId,
        activeGrade: en.className,
        rollNo: en.rollNo ?? s.rollNo ?? null,
      } satisfies StudentWithEnrollment;
    }),
  );

  return students.filter(Boolean) as StudentWithEnrollment[];
}

export async function getStudentWithActiveEnrollment(
  studentId: string,
): Promise<StudentWithEnrollment | null> {
  const sSnap = await getDoc(doc(db, "students", studentId));
  if (!sSnap.exists()) return null;
  const s = { id: sSnap.id, ...sSnap.data() } as Student;
  const en = await getActiveEnrollment(studentId);
  if (!en) {
    return {
      ...s,
      enrollmentId: "",
      academicYear: await getCurrentAcademicYear(),
      className: s.grade,
      sectionName: null,
      activeSectionId: s.sectionId,
      activeGrade: s.grade,
      rollNo: s.rollNo ?? null,
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
    rollNo: en.rollNo ?? s.rollNo ?? null,
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
          className: student.grade,
          sectionName: null,
          sectionId: null,
          rollNo: student.rollNo,
          hodId: student.hodId,
          status: "active",
          createdAt: "",
        },
      });
    }
  }
  return results;
}

export async function assignSectionToEnrollment(
  enrollmentId: string,
  section: Section,
  rollNo?: string,
): Promise<void> {
  if (!enrollmentId) throw new Error("Missing enrollment");
  await updateDoc(doc(db, "enrollments", enrollmentId), {
    sectionId: section.id,
    sectionName: section.name,
    className: section.grade,
    ...(rollNo !== undefined ? { rollNo } : {}),
  });
}

export async function createActiveEnrollment(
  payload: Omit<Enrollment, "id" | "status" | "createdAt">,
): Promise<string> {
  const existing = await getActiveEnrollment(payload.studentId);
  if (existing) {
    throw new Error("Student already has an active enrollment.");
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
  targetClassName: string;
  targetSectionName: string;
  targetSectionId: string;
  rollNo?: string;
  action?: "promote" | "detain" | "transfer" | "graduate";
}

export async function promoteEnrollment(input: PromoteStudentInput): Promise<void> {
  const prevRef = doc(db, "enrollments", input.enrollmentId);
  const prevSnap = await getDoc(prevRef);
  if (!prevSnap.exists()) throw new Error("Previous enrollment not found");

  const prev = { id: prevSnap.id, ...prevSnap.data() } as Enrollment;
  if (prev.status !== "active") throw new Error("Only active enrollments can be promoted");

  const nextStatus: EnrollmentStatus =
    input.action === "graduate"
      ? "graduated"
      : input.action === "transfer"
        ? "transferred"
        : input.action === "detain"
          ? "active"
          : "promoted";

  const batch = writeBatch(db);
  batch.update(prevRef, { status: input.action === "detain" ? "promoted" : nextStatus });

  if (input.action !== "graduate" && input.action !== "transfer") {
    const activeCheck = await getActiveEnrollment(input.studentId);
    if (activeCheck && activeCheck.id !== input.enrollmentId) {
      throw new Error("Student already has another active enrollment.");
    }
    const newRef = doc(collection(db, "enrollments"));
    batch.set(newRef, {
      studentId: input.studentId,
      academicYear: input.targetAcademicYear,
      className: input.targetClassName,
      sectionName: input.targetSectionName,
      sectionId: input.targetSectionId,
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

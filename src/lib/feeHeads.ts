/**
 * Master Fee Heads catalog service.
 * Provides CRUD operations for configurable fee head types
 * used in fee structures and student fee assignments.
 */
import {
  collection,
  doc,
  addDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { logAuditEvent } from "@/lib/audit";
import type { Role } from "@/lib/types";

export interface MasterFeeHead {
  id: string;
  name: string;
  category:
    | "tuition"
    | "technology"
    | "sports"
    | "examination"
    | "transport"
    | "books"
    | "uniform"
    | "cca"
    | "admission"
    | "annual"
    | "other";
  description: string;
  isDefault: boolean;
  sortOrder: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt?: string;
}

export type FeeHeadCategory = MasterFeeHead["category"];

const COLLECTION = "masterFeeHeads";

/** Default fee heads seeded on first use */
const DEFAULT_FEE_HEADS: Omit<MasterFeeHead, "id" | "createdAt">[] = [
  { name: "Tuition Fee", category: "tuition", description: "Core tuition charges", isDefault: true, sortOrder: 1, status: "active" },
  { name: "Technology Fee", category: "technology", description: "IT infrastructure and digital resources", isDefault: true, sortOrder: 2, status: "active" },
  { name: "Sports Fee", category: "sports", description: "Sports and physical education", isDefault: true, sortOrder: 3, status: "active" },
  { name: "Examination Fee", category: "examination", description: "Exam administration and evaluation", isDefault: true, sortOrder: 4, status: "active" },
  { name: "Transport Fee", category: "transport", description: "School bus and transport services", isDefault: true, sortOrder: 5, status: "active" },
  { name: "Books & Stationery", category: "books", description: "Textbooks and study materials", isDefault: true, sortOrder: 6, status: "active" },
  { name: "Uniform Fee", category: "uniform", description: "School uniform charges", isDefault: true, sortOrder: 7, status: "active" },
  { name: "CCA Fee", category: "cca", description: "Co-curricular activities", isDefault: true, sortOrder: 8, status: "active" },
  { name: "Admission Fee", category: "admission", description: "One-time admission processing", isDefault: true, sortOrder: 9, status: "active" },
  { name: "Annual Fee", category: "annual", description: "Annual school charges", isDefault: true, sortOrder: 10, status: "active" },
];

/**
 * List all active master fee heads, sorted by sortOrder.
 * On first call, seeds default fee heads if the collection is empty.
 */
export async function listMasterFeeHeads(): Promise<MasterFeeHead[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTION), orderBy("sortOrder", "asc"))
  );

  if (snap.empty) {
    // Seed defaults on first use
    const now = new Date().toISOString();
    const seeded: MasterFeeHead[] = [];
    for (const head of DEFAULT_FEE_HEADS) {
      const docRef = await addDoc(collection(db, COLLECTION), {
        ...head,
        createdAt: now,
      });
      seeded.push({ id: docRef.id, ...head, createdAt: now });
    }
    return seeded;
  }

  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as MasterFeeHead[];
}

/** List only active fee heads */
export async function listActiveFeeHeads(): Promise<MasterFeeHead[]> {
  const snap = await getDocs(
    query(
      collection(db, COLLECTION),
      where("status", "==", "active"),
      orderBy("sortOrder", "asc")
    )
  );

  if (snap.empty) {
    // Try seeding first
    return listMasterFeeHeads().then((all) =>
      all.filter((h) => h.status === "active")
    );
  }

  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  })) as MasterFeeHead[];
}

/** Create a new master fee head */
export async function createMasterFeeHead(
  data: Omit<MasterFeeHead, "id" | "createdAt" | "updatedAt">,
  actor: { uid: string; name: string; role: Role }
): Promise<string> {
  const now = new Date().toISOString();
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...data,
    createdAt: now,
  });

  await logAuditEvent({
    userId: actor.uid,
    userName: actor.name,
    role: actor.role,
    action: "create",
    entity: "fee_structure" as any,
    entityId: docRef.id,
    details: `Created master fee head: ${data.name} (${data.category})`,
    metadata: { feeHeadName: data.name, category: data.category },
  });

  return docRef.id;
}

/** Update an existing master fee head */
export async function updateMasterFeeHead(
  id: string,
  updates: Partial<Omit<MasterFeeHead, "id" | "createdAt">>,
  actor: { uid: string; name: string; role: Role }
): Promise<void> {
  const now = new Date().toISOString();
  await setDoc(
    doc(db, COLLECTION, id),
    { ...updates, updatedAt: now },
    { merge: true }
  );

  await logAuditEvent({
    userId: actor.uid,
    userName: actor.name,
    role: actor.role,
    action: "update",
    entity: "fee_structure" as any,
    entityId: id,
    details: `Updated master fee head: ${updates.name || id}`,
    metadata: { updates },
  });
}

/** Archive a fee head (soft delete) */
export async function archiveMasterFeeHead(
  id: string,
  actor: { uid: string; name: string; role: Role }
): Promise<void> {
  await updateMasterFeeHead(id, { status: "archived" }, actor);
}

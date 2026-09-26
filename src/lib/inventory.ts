import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  BookDistribution,
  BookDistributionReturnStatus,
  InventoryCategory,
  InventoryItem,
  InventoryMovement,
  Role,
  StockMovementType,
  TextbookItem,
  UniformIssue,
  UniformItem,
} from "@/lib/types";
import { logAuditEvent } from "@/lib/audit";

// ==========================================
// 1. GENERAL INVENTORY & MOVEMENTS
// ==========================================

export interface CreateInventoryItemInput {
  name: string;
  category: InventoryCategory;
  unit: string;
  initialQuantity: number;
  minStock: number;
  unitCost?: number;
  location?: string;
  supplierInfo?: string;
  notes?: string;
}

/**
 * Creates a new inventory master item and records an initial stock movement.
 */
export async function createInventoryItem(
  input: CreateInventoryItemInput,
  actor: { userId: string; userName: string; role: Role }
): Promise<string> {
  if (!db) throw new Error("Firestore not initialized.");

  const now = new Date().toISOString();
  const itemRef = doc(collection(db, "inventoryItems"));
  const initialQty = Math.max(0, input.initialQuantity || 0);

  const itemData: Omit<InventoryItem, "id"> = {
    name: input.name,
    category: input.category,
    unit: input.unit || "pcs",
    currentQuantity: initialQty,
    minStock: input.minStock || 5,
    unitCost: input.unitCost || 0,
    location: input.location || "",
    supplierInfo: input.supplierInfo || "",
    notes: input.notes || "",
    createdAt: now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(itemRef, itemData);

  if (initialQty > 0) {
    const movRef = doc(collection(db, "inventoryMovements"));
    const movData: Omit<InventoryMovement, "id"> = {
      itemId: itemRef.id,
      itemName: input.name,
      category: input.category,
      movementType: "in",
      quantity: initialQty,
      previousQuantity: 0,
      newQuantity: initialQty,
      reason: "Initial stock registration",
      performedBy: actor.userId,
      performedByName: actor.userName,
      timestamp: now,
    };
    batch.set(movRef, movData);
  }

  await batch.commit();

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "create",
    entity: "inventory_item",
    entityId: itemRef.id,
    details: `Added inventory item "${input.name}" with initial stock ${initialQty} ${input.unit}`,
    metadata: { name: input.name, category: input.category, quantity: initialQty },
  });

  return itemRef.id;
}

export interface RecordMovementInput {
  itemId: string;
  movementType: StockMovementType;
  quantity: number;
  reason: string;
  reference?: string;
  recipientName?: string;
  recipientRole?: string;
}

/**
 * Records a stock movement atomically, updating currentQuantity on the item doc.
 * Enforces stock availability on deductions (issue, damage, loss).
 */
export async function recordStockMovement(
  input: RecordMovementInput,
  actor: { userId: string; userName: string; role: Role }
): Promise<void> {
  if (!db) throw new Error("Firestore not initialized.");
  if (input.quantity <= 0) throw new Error("Quantity must be greater than 0.");

  const itemRef = doc(db, "inventoryItems", input.itemId);

  await runTransaction(db, async (transaction) => {
    const itemSnap = await transaction.get(itemRef);
    if (!itemSnap.exists()) throw new Error("Inventory item not found.");
    const item = itemSnap.data() as InventoryItem;

    const isDeduction = ["issue", "damage", "loss", "adjustment"].includes(input.movementType) &&
      !(input.movementType === "adjustment" && input.quantity > 0); // adjustments can be + or -

    let newQuantity: number;
    if (["in", "purchase", "return"].includes(input.movementType)) {
      newQuantity = (item.currentQuantity || 0) + input.quantity;
    } else {
      // Deduction
      if ((item.currentQuantity || 0) < input.quantity) {
        throw new Error(
          `Insufficient stock. Available: ${item.currentQuantity} ${item.unit}, Requested: ${input.quantity} ${item.unit}`
        );
      }
      newQuantity = (item.currentQuantity || 0) - input.quantity;
    }

    const now = new Date().toISOString();
    transaction.update(itemRef, {
      currentQuantity: newQuantity,
      updatedAt: now,
    });

    const movRef = doc(collection(db, "inventoryMovements"));
    const movData: Omit<InventoryMovement, "id"> = {
      itemId: input.itemId,
      itemName: item.name,
      category: item.category,
      movementType: input.movementType,
      quantity: input.quantity,
      previousQuantity: item.currentQuantity || 0,
      newQuantity,
      reason: input.reason,
      reference: input.reference || "",
      recipientName: input.recipientName || "",
      recipientRole: input.recipientRole || "",
      performedBy: actor.userId,
      performedByName: actor.userName,
      timestamp: now,
    };
    transaction.set(movRef, movData);
  });

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "stock_movement",
    entity: "stock_movement",
    entityId: input.itemId,
    details: `${input.movementType.toUpperCase()}: ${input.quantity} units for "${input.itemId}" - ${input.reason}`,
    metadata: input,
  });
}

/**
 * Fetches inventory movements with optional filters.
 */
export async function getInventoryMovements(filters?: {
  itemId?: string;
  category?: InventoryCategory | "all";
  movementType?: StockMovementType | "all";
}): Promise<InventoryMovement[]> {
  if (!db) return [];

  let q = query(collection(db, "inventoryMovements"), orderBy("timestamp", "desc"), limit(200));

  if (filters?.itemId) {
    q = query(collection(db, "inventoryMovements"), where("itemId", "==", filters.itemId), orderBy("timestamp", "desc"), limit(200));
  }

  const snap = await getDocs(q);
  let movements = snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryMovement));

  if (filters?.category && filters.category !== "all") {
    movements = movements.filter((m) => m.category === filters.category);
  }
  if (filters?.movementType && filters.movementType !== "all") {
    movements = movements.filter((m) => m.movementType === filters.movementType);
  }

  return movements;
}

// ==========================================
// 2. UNIFORMS (SIZE MATRIX & STUDENT ISSUANCE)
// ==========================================

export interface CreateUniformItemInput {
  name: string;
  gender: UniformItem["gender"];
  category: UniformItem["category"];
  sizes: Record<string, number>;
  minStockPerSize?: Record<string, number>;
  unitPrice?: number;
  location?: string;
}

export async function createUniformItem(
  input: CreateUniformItemInput,
  actor: { userId: string; userName: string; role: Role }
): Promise<string> {
  if (!db) throw new Error("Firestore not initialized.");

  const now = new Date().toISOString();
  const ref = doc(collection(db, "uniformItems"));

  const data: Omit<UniformItem, "id"> = {
    name: input.name,
    gender: input.gender,
    category: input.category,
    sizes: input.sizes || {},
    minStockPerSize: input.minStockPerSize || {},
    unitPrice: input.unitPrice || 0,
    location: input.location || "",
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(ref, data);

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "create",
    entity: "uniform",
    entityId: ref.id,
    details: `Added uniform item "${input.name}" with size matrix`,
    metadata: { name: input.name, gender: input.gender, sizes: input.sizes },
  });

  return ref.id;
}

/**
 * Updates stock for specific sizes in a uniform item (e.g. adding new stock or restocking).
 */
export async function restockUniformSizes(
  uniformItemId: string,
  restockMatrix: Record<string, number>,
  reason: string,
  actor: { userId: string; userName: string; role: Role }
): Promise<void> {
  if (!db) throw new Error("Firestore not initialized.");

  const ref = doc(db, "uniformItems", uniformItemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Uniform item not found.");
  const uniform = snap.data() as UniformItem;

  const updatedSizes = { ...(uniform.sizes || {}) };
  for (const [size, qty] of Object.entries(restockMatrix)) {
    if (qty > 0) {
      updatedSizes[size] = (updatedSizes[size] || 0) + qty;
    }
  }

  await updateDoc(ref, {
    sizes: updatedSizes,
    updatedAt: new Date().toISOString(),
  });

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "update",
    entity: "uniform",
    entityId: uniformItemId,
    details: `Restocked uniform "${uniform.name}": ${JSON.stringify(restockMatrix)} (${reason})`,
    metadata: { uniformItemId, restockMatrix, reason },
  });
}

export interface IssueUniformInput {
  uniformItemId: string;
  size: string;
  quantity: number;
  studentId: string;
  studentName: string;
  admissionNo?: string;
  grade: string;
  section?: string;
  academicSession: string;
  notes?: string;
}

/**
 * Issues a uniform item of a specific size to a student, enforcing stock availability for that size.
 */
export async function issueUniformToStudent(
  input: IssueUniformInput,
  actor: { userId: string; userName: string; role: Role }
): Promise<string> {
  if (!db) throw new Error("Firestore not initialized.");
  if (input.quantity <= 0) throw new Error("Quantity must be at least 1.");

  const uniformRef = doc(db, "uniformItems", input.uniformItemId);

  let issueId = "";
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(uniformRef);
    if (!snap.exists()) throw new Error("Uniform item not found.");
    const uniform = snap.data() as UniformItem;

    const availableInSize = uniform.sizes?.[input.size] ?? 0;
    if (availableInSize < input.quantity) {
      throw new Error(
        `Insufficient stock for "${uniform.name}" in Size ${input.size}. Available: ${availableInSize}, Requested: ${input.quantity}`
      );
    }

    const updatedSizes = { ...(uniform.sizes || {}) };
    updatedSizes[input.size] = availableInSize - input.quantity;

    const now = new Date().toISOString();
    transaction.update(uniformRef, {
      sizes: updatedSizes,
      updatedAt: now,
    });

    const issueRef = doc(collection(db, "uniformIssues"));
    issueId = issueRef.id;

    const issueData: Omit<UniformIssue, "id"> = {
      uniformItemId: input.uniformItemId,
      uniformName: uniform.name,
      size: input.size,
      quantity: input.quantity,
      studentId: input.studentId,
      studentName: input.studentName,
      admissionNo: input.admissionNo || "",
      grade: input.grade,
      section: input.section || "",
      academicSession: input.academicSession,
      issueDate: now.slice(0, 10),
      issuedBy: actor.userId,
      issuedByName: actor.userName,
      notes: input.notes || "",
      createdAt: now,
    };
    transaction.set(issueRef, issueData);
  });

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "issue",
    entity: "uniform",
    entityId: issueId,
    details: `Issued uniform Size ${input.size} (${input.quantity} pcs) to student ${input.studentName} (${input.grade})`,
    metadata: input,
  });

  return issueId;
}

// ==========================================
// 3. BOOK DISTRIBUTION (TEXTBOOKS)
// ==========================================

export interface CreateTextbookInput {
  title: string;
  grade: string;
  subject: string;
  publisher?: string;
  academicSession?: string;
  totalStock: number;
}

export async function createTextbookItem(
  input: CreateTextbookInput,
  actor: { userId: string; userName: string; role: Role }
): Promise<string> {
  if (!db) throw new Error("Firestore not initialized.");

  const now = new Date().toISOString();
  const ref = doc(collection(db, "textbookItems"));

  const data: Omit<TextbookItem, "id"> = {
    title: input.title,
    grade: input.grade,
    subject: input.subject,
    publisher: input.publisher || "",
    academicSession: input.academicSession || "",
    totalStock: input.totalStock || 0,
    distributedCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(ref, data);

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "create",
    entity: "textbook",
    entityId: ref.id,
    details: `Added curriculum textbook "${input.title}" for Grade ${input.grade} (${input.totalStock} copies)`,
    metadata: input,
  });

  return ref.id;
}

export interface DistributeTextbookInput {
  textbookId: string;
  studentId: string;
  studentName: string;
  admissionNo?: string;
  grade: string;
  section?: string;
  quantity?: number;
  academicYear: string;
  returnRequired?: boolean;
  notes?: string;
}

/**
 * Distributes curriculum textbook to a student.
 */
export async function distributeTextbookToStudent(
  input: DistributeTextbookInput,
  actor: { userId: string; userName: string; role: Role }
): Promise<string> {
  if (!db) throw new Error("Firestore not initialized.");

  const tbRef = doc(db, "textbookItems", input.textbookId);
  const qty = input.quantity || 1;

  let distId = "";
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(tbRef);
    if (!snap.exists()) throw new Error("Textbook record not found.");
    const textbook = snap.data() as TextbookItem;

    const available = (textbook.totalStock || 0) - (textbook.distributedCount || 0);
    if (available < qty) {
      throw new Error(`Insufficient textbook stock for "${textbook.title}". Available: ${available}, Requested: ${qty}`);
    }

    const now = new Date().toISOString();
    transaction.update(tbRef, {
      distributedCount: increment(qty),
      updatedAt: now,
    });

    const distRef = doc(collection(db, "bookDistributions"));
    distId = distRef.id;

    const distData: Omit<BookDistribution, "id"> = {
      textbookId: input.textbookId,
      bookTitle: textbook.title,
      studentId: input.studentId,
      studentName: input.studentName,
      admissionNo: input.admissionNo || "",
      grade: input.grade,
      section: input.section || "",
      quantity: qty,
      academicYear: input.academicYear,
      issueDate: now.slice(0, 10),
      issuedBy: actor.userId,
      issuedByName: actor.userName,
      returnRequired: input.returnRequired ?? true,
      returnStatus: input.returnRequired === false ? "not_required" : "pending",
      notes: input.notes || "",
      createdAt: now,
    };
    transaction.set(distRef, distData);
  });

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "issue",
    entity: "textbook",
    entityId: distId,
    details: `Distributed textbook "${input.textbookId}" to student ${input.studentName} (${input.grade})`,
    metadata: input,
  });

  return distId;
}

/**
 * Returns a distributed textbook at the end of the academic year.
 */
export async function returnDistributedTextbook(
  distributionId: string,
  status: "returned" | "lost" | "damaged",
  notes?: string,
  actor?: { userId: string; userName: string; role: Role }
): Promise<void> {
  if (!db) throw new Error("Firestore not initialized.");

  const distRef = doc(db, "bookDistributions", distributionId);
  const snap = await getDoc(distRef);
  if (!snap.exists()) throw new Error("Distribution record not found.");
  const dist = snap.data() as BookDistribution;

  const now = new Date().toISOString();
  const batch = writeBatch(db);

  batch.update(distRef, {
    returnStatus: status,
    returnedAt: now,
    notes: notes ? `${dist.notes || ""}; ${notes}`.trim() : dist.notes,
  });

  if (status === "returned") {
    batch.update(doc(db, "textbookItems", dist.textbookId), {
      distributedCount: increment(-dist.quantity),
      updatedAt: now,
    });
  }

  await batch.commit();

  if (actor) {
    void logAuditEvent({
      userId: actor.userId,
      userName: actor.userName,
      role: actor.role,
      action: "return",
      entity: "textbook",
      entityId: distributionId,
      details: `Processed textbook return: "${dist.bookTitle}" from ${dist.studentName} (${status})`,
    });
  }
}

// ==========================================
// 4. STATS & OVERVIEWS
// ==========================================
export async function getInventoryStats(): Promise<{
  totalInventoryItems: number;
  lowStockItemsCount: number;
  totalUniformItems: number;
  totalTextbookItems: number;
  activeDistributionsCount: number;
}> {
  if (!db) {
    return {
      totalInventoryItems: 0,
      lowStockItemsCount: 0,
      totalUniformItems: 0,
      totalTextbookItems: 0,
      activeDistributionsCount: 0,
    };
  }

  const [invSnap, uniSnap, tbSnap, distSnap] = await Promise.all([
    getDocs(collection(db, "inventoryItems")),
    getDocs(collection(db, "uniformItems")),
    getDocs(collection(db, "textbookItems")),
    getDocs(query(collection(db, "bookDistributions"), where("returnStatus", "==", "pending"))),
  ]);

  let lowStockItemsCount = 0;
  for (const doc of invSnap.docs) {
    const data = doc.data() as InventoryItem;
    if ((data.currentQuantity || 0) <= (data.minStock || 0)) {
      lowStockItemsCount++;
    }
  }

  return {
    totalInventoryItems: invSnap.docs.length,
    lowStockItemsCount,
    totalUniformItems: uniSnap.docs.length,
    totalTextbookItems: tbSnap.docs.length,
    activeDistributionsCount: distSnap.docs.length,
  };
}

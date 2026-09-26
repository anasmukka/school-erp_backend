import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PrintOrder, PrintOrderStatus, Role } from "@/lib/types";
import { uploadPrintingDocument } from "@/lib/storage";
import { logAuditEvent } from "@/lib/audit";

export interface CreatePrintOrderInput {
  title: string;
  documentType: PrintOrder["documentType"];
  requesterId: string;
  requesterName: string;
  requesterRole: Role;
  department?: string;
  grade?: string;
  section?: string;
  copies: number;
  pageCount: number;
  paperSize: PrintOrder["paperSize"];
  colorMode: PrintOrder["colorMode"];
  sides: PrintOrder["sides"];
  binding: PrintOrder["binding"];
  priority: PrintOrder["priority"];
  requiredDate: string;
  instructions?: string;
}

export function generatePrintOrderNo(): string {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `PRN-${year}-${randomSuffix}`;
}

/**
 * Submits a new print order, optionally uploading an attached document to Firebase Storage.
 */
export async function createPrintOrder(
  input: CreatePrintOrderInput,
  file?: File,
  onUploadProgress?: (percent: number) => void
): Promise<PrintOrder> {
  if (!db) throw new Error("Firestore is not initialized.");

  let fileUrl: string | undefined;
  let fileName: string | undefined;
  let fileStoragePath: string | undefined;
  let fileSize: number | undefined;

  if (file) {
    const uploadResult = await uploadPrintingDocument(file, "printing-orders", onUploadProgress);
    fileUrl = uploadResult.downloadUrl;
    fileName = uploadResult.fileName;
    fileStoragePath = uploadResult.storagePath;
    fileSize = uploadResult.fileSize;
  }

  const orderNo = generatePrintOrderNo();
  const now = new Date().toISOString();

  const newOrderData: Omit<PrintOrder, "id"> = {
    ...input,
    orderNo,
    fileUrl,
    fileName,
    fileStoragePath,
    fileSize,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await addDoc(collection(db, "printingRequests"), newOrderData);
  const createdOrder: PrintOrder = { id: docRef.id, ...newOrderData };

  void logAuditEvent({
    userId: input.requesterId,
    userName: input.requesterName,
    role: input.requesterRole,
    action: "create",
    entity: "printing",
    entityId: docRef.id,
    details: `Created print order ${orderNo}: "${input.title}" (${input.copies} copies, ${input.priority} priority)`,
    metadata: { orderNo, copies: input.copies, documentType: input.documentType },
  });

  return createdOrder;
}

/**
 * Updates the lifecycle status of a printing order.
 */
export async function updatePrintOrderStatus(
  orderId: string,
  newStatus: PrintOrderStatus,
  actor: { userId: string; userName: string; role: Role },
  metadata?: {
    rejectionReason?: string;
  }
): Promise<void> {
  if (!db) throw new Error("Firestore is not initialized.");

  const ref = doc(db, "printingRequests", orderId);
  const existingSnap = await getDoc(ref);
  if (!existingSnap.exists()) {
    throw new Error(`Print order ${orderId} not found.`);
  }
  const existing = existingSnap.data() as PrintOrder;

  const now = new Date().toISOString();
  const updatePayload: Partial<PrintOrder> = {
    status: newStatus,
    updatedAt: now,
  };

  if (newStatus === "completed") {
    updatePayload.printedAt = now;
    updatePayload.printedBy = actor.userId;
    updatePayload.printedByName = actor.userName;
  }

  if (newStatus === "rejected" && metadata?.rejectionReason) {
    updatePayload.rejectionReason = metadata.rejectionReason;
  }

  await updateDoc(ref, updatePayload);

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "status_change",
    entity: "printing",
    entityId: orderId,
    details: `Updated print order ${existing.orderNo || orderId} status from "${existing.status}" to "${newStatus}"`,
    metadata: { previousStatus: existing.status, newStatus, reason: metadata?.rejectionReason },
  });
}

/**
 * Fetches print orders with optional filtering by status, priority, requester, or search.
 */
export async function getPrintOrders(filters?: {
  status?: PrintOrderStatus | "all";
  priority?: PrintOrder["priority"] | "all";
  requesterId?: string;
  search?: string;
}): Promise<PrintOrder[]> {
  if (!db) return [];

  let q = query(collection(db, "printingRequests"), orderBy("createdAt", "desc"), limit(200));

  if (filters?.requesterId) {
    q = query(collection(db, "printingRequests"), where("requesterId", "==", filters.requesterId), orderBy("createdAt", "desc"), limit(200));
  }

  const snapshot = await getDocs(q);
  let orders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PrintOrder));

  if (filters?.status && filters.status !== "all") {
    orders = orders.filter((o) => o.status === filters.status);
  }

  if (filters?.priority && filters.priority !== "all") {
    orders = orders.filter((o) => o.priority === filters.priority);
  }

  if (filters?.search && filters.search.trim()) {
    const term = filters.search.toLowerCase().trim();
    orders = orders.filter(
      (o) =>
        o.title.toLowerCase().includes(term) ||
        o.orderNo.toLowerCase().includes(term) ||
        o.requesterName.toLowerCase().includes(term) ||
        (o.department && o.department.toLowerCase().includes(term))
    );
  }

  return orders;
}

/**
 * Computes metrics summary for the Printing Department dashboard.
 */
export async function getPrintMetrics(): Promise<{
  pending: number;
  inProgress: number;
  completed: number;
  highPriority: number;
  total: number;
  totalPagesPrinted: number;
}> {
  if (!db) {
    return { pending: 0, inProgress: 0, completed: 0, highPriority: 0, total: 0, totalPagesPrinted: 0 };
  }

  const snapshot = await getDocs(collection(db, "printingRequests"));
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  let highPriority = 0;
  let totalPagesPrinted = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() as PrintOrder;
    if (data.status === "pending") pending++;
    if (data.status === "accepted" || data.status === "printing") inProgress++;
    if (data.status === "completed") {
      completed++;
      totalPagesPrinted += (data.copies || 1) * (data.pageCount || 1);
    }
    if ((data.priority === "high" || data.priority === "urgent") && data.status !== "completed" && data.status !== "cancelled") {
      highPriority++;
    }
  }

  return {
    pending,
    inProgress,
    completed,
    highPriority,
    total: snapshot.docs.length,
    totalPagesPrinted,
  };
}

export async function deletePrintOrder(orderId: string, actor: { userId: string; userName: string; role: Role }): Promise<void> {
  if (!db) throw new Error("Firestore is not initialized.");
  await deleteDoc(doc(db, "printingRequests", orderId));
  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "delete",
    entity: "printing",
    entityId: orderId,
    details: `Deleted print order ${orderId}`,
  });
}

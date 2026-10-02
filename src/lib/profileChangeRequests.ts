import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ProfileChangeRequestV2, ProfileChangeRequestV2Status, Role } from "@/lib/types";

const COL = "profileChangeRequests";

/**
 * Submit a new profile change request.
 * The userId is always taken from the authenticated user passed in — never from client input.
 */
export async function submitProfileChangeRequest(params: {
  userId: string;       // auth UID — must be the caller's own uid
  userName: string;
  userRole: Role;
  entityType: ProfileChangeRequestV2["entityType"];
  entityId: string;
  field: ProfileChangeRequestV2["field"];
  fieldLabel: string;
  originalValue: string;
  requestedValue: string;
  reason: string;
  supportingDocUrl?: string;
  supportingDocPath?: string;
  supportingDocName?: string;
}): Promise<string> {
  const now = new Date().toISOString();
  const data: Omit<ProfileChangeRequestV2, "id"> = {
    userId: params.userId,
    userName: params.userName,
    userRole: params.userRole,
    entityType: params.entityType,
    entityId: params.entityId,
    field: params.field,
    fieldLabel: params.fieldLabel,
    originalValue: params.originalValue,
    requestedValue: params.requestedValue,
    reason: params.reason,
    supportingDocUrl: params.supportingDocUrl,
    supportingDocPath: params.supportingDocPath,
    supportingDocName: params.supportingDocName,
    status: "pending",
    submittedAt: now,
    updatedAt: now,
  };
  const ref = await addDoc(collection(db, COL), data);
  return ref.id;
}

/**
 * Fetch all change requests submitted by a specific user (own requests only).
 */
export async function getMyProfileChangeRequests(
  userId: string,
): Promise<ProfileChangeRequestV2[]> {
  const snap = await getDocs(
    query(
      collection(db, COL),
      where("userId", "==", userId),
      orderBy("submittedAt", "desc"),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProfileChangeRequestV2));
}

/**
 * Admin: fetch all profile change requests with optional filters.
 */
export async function getAllProfileChangeRequests(filters?: {
  status?: ProfileChangeRequestV2Status;
  userRole?: Role;
}): Promise<ProfileChangeRequestV2[]> {
  const constraints: Parameters<typeof query>[1][] = [orderBy("submittedAt", "desc")];
  if (filters?.status) constraints.unshift(where("status", "==", filters.status));
  if (filters?.userRole) constraints.unshift(where("userRole", "==", filters.userRole));
  const snap = await getDocs(query(collection(db, COL), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProfileChangeRequestV2));
}

/**
 * Admin: approve a request and apply the change to the authoritative record.
 */
export async function approveProfileChangeRequest(
  requestId: string,
  reviewerUid: string,
  reviewerName: string,
  comment?: string,
): Promise<void> {
  const reqRef = doc(db, COL, requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("Request not found");
  const req = { id: reqSnap.id, ...reqSnap.data() } as ProfileChangeRequestV2;

  // Apply the approved change to the authoritative record
  await applyApprovedChange(req);

  await updateDoc(reqRef, {
    status: "approved",
    reviewedBy: reviewerUid,
    reviewedByName: reviewerName,
    reviewerComment: comment || "",
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Admin: reject a request without modifying any profile record.
 */
export async function rejectProfileChangeRequest(
  requestId: string,
  reviewerUid: string,
  reviewerName: string,
  comment: string,
): Promise<void> {
  await updateDoc(doc(db, COL, requestId), {
    status: "rejected",
    reviewedBy: reviewerUid,
    reviewedByName: reviewerName,
    reviewerComment: comment,
    reviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * User: cancel own pending request.
 */
export async function cancelProfileChangeRequest(
  requestId: string,
  userId: string,
): Promise<void> {
  const reqRef = doc(db, COL, requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("Request not found");
  const req = reqSnap.data() as ProfileChangeRequestV2;
  if (req.userId !== userId) throw new Error("Unauthorized: not your request");
  if (req.status !== "pending") throw new Error("Only pending requests can be cancelled");
  await updateDoc(reqRef, {
    status: "cancelled",
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Applies an approved change to the correct Firestore collection.
 * Field names map to their respective document fields.
 */
async function applyApprovedChange(req: ProfileChangeRequestV2): Promise<void> {
  const fieldMap: Record<string, string> = {
    name: "name",
    DOB: "DOB",
    gender: "gender",
    address: "address",
    phone: "parentContact",
    email: "email",
    fatherName: "fatherName",
    motherName: "motherName",
    parentContact: "parentContact",
    guardianInfo: "guardianInfo",
    designation: "designation",
    department: "department",
    staffPhone: "phone",
    staffAddress: "address",
    parentName: "name",
    parentPhone: "phone",
    parentEmail: "email",
    parentAddress: "address",
  };

  const docField = fieldMap[req.field] || req.field;
  const updatePayload = {
    [docField]: req.requestedValue,
    updatedAt: new Date().toISOString(),
  };

  if (req.entityType === "student") {
    await updateDoc(doc(db, "students", req.entityId), updatePayload);
    // Also update the user doc if it mirrors the field
    if (req.field === "name" || req.field === "email") {
      await updateDoc(doc(db, "users", req.userId), updatePayload).catch(() => {});
    }
  } else if (req.entityType === "staff") {
    await updateDoc(doc(db, "teachers", req.entityId), updatePayload);
    if (req.field === "name" || req.field === "email") {
      await updateDoc(doc(db, "users", req.userId), updatePayload).catch(() => {});
    }
  } else if (req.entityType === "parent") {
    await updateDoc(doc(db, "users", req.entityId), updatePayload);
  } else if (req.entityType === "user") {
    // admin/printing/operations/accountant — update the users doc
    await updateDoc(doc(db, "users", req.entityId), updatePayload);
  }
}

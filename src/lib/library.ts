import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  increment,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  LibraryBook,
  LibraryCopy,
  LibraryCopyCondition,
  LibraryCopyStatus,
  LibraryFinePaidStatus,
  LibraryFineRule,
  LibraryMemberType,
  LibraryTransaction,
  Role,
} from "@/lib/types";
import { logAuditEvent } from "@/lib/audit";

export const DEFAULT_FINE_RULES: LibraryFineRule = {
  finePerDay: 5,
  gracePeriodDays: 1,
  maxFineCap: 250,
  lostBookMultiplier: 1.5,
  standardDurationDaysStudent: 14,
  standardDurationDaysStaff: 30,
  maxBorrowLimitStudent: 3,
  maxBorrowLimitStaff: 5,
  reminderDaysBeforeDue: 3,
};

/**
 * Loads library fine rules from librarySettings/fineRules or returns default rules.
 */
export async function getLibraryFineRules(): Promise<LibraryFineRule> {
  if (!db) return DEFAULT_FINE_RULES;
  try {
    const snap = await getDoc(doc(db, "librarySettings", "fineRules"));
    if (snap.exists()) {
      return { ...DEFAULT_FINE_RULES, ...snap.data() } as LibraryFineRule;
    }
  } catch (error) {
    console.error("Error reading fine rules, using defaults:", error);
  }
  return DEFAULT_FINE_RULES;
}

/**
 * Updates library fine and borrowing rules.
 */
export async function updateLibraryFineRules(
  rules: Partial<LibraryFineRule>,
  actor: { userId: string; userName: string; role: Role }
): Promise<void> {
  if (!db) throw new Error("Firestore not initialized.");
  const ref = doc(db, "librarySettings", "fineRules");
  const payload = {
    ...rules,
    updatedAt: new Date().toISOString(),
  };
  await setDoc(ref, payload, { merge: true });

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "update",
    entity: "library_book",
    entityId: "fineRules",
    details: "Updated library fine and circulation rules",
    metadata: rules,
  });
}

/**
 * Calculates overdue fine based on due date, return date, and active fine rules.
 */
export function calculateOverdueFine(
  dueDateStr: string,
  returnDateStr: string = new Date().toISOString().slice(0, 10),
  rules: LibraryFineRule = DEFAULT_FINE_RULES
): { daysOverdue: number; fineAmount: number } {
  const due = new Date(dueDateStr);
  const ret = new Date(returnDateStr);
  const diffTime = ret.getTime() - due.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= rules.gracePeriodDays) {
    return { daysOverdue: Math.max(0, diffDays), fineAmount: 0 };
  }

  const chargeableDays = diffDays - rules.gracePeriodDays;
  const rawFine = chargeableDays * rules.finePerDay;
  const fineAmount = Math.min(rawFine, rules.maxFineCap);

  return { daysOverdue: diffDays, fineAmount };
}

/**
 * Generates sequential accession numbers e.g. ACC-1001, ACC-1002.
 */
function generateAccessionNumber(index: number): string {
  const num = 1000 + Math.floor(Math.random() * 9000) + index;
  return `ACC-${num}`;
}

export interface CreateBookInput {
  title: string;
  isbn?: string;
  author: string;
  publisher?: string;
  edition?: string;
  category: LibraryBook["category"];
  subject?: string;
  grade?: string;
  language?: string;
  shelfLocation?: string;
  description?: string;
  coverImageUrl?: string;
  initialCopiesCount: number;
  initialPrice?: number;
}

/**
 * Creates a catalog title in libraryBooks and creates individual physical copies in libraryCopies.
 */
export async function createBookWithCopies(
  input: CreateBookInput,
  actor: { userId: string; userName: string; role: Role }
): Promise<string> {
  if (!db) throw new Error("Firestore not initialized.");

  const now = new Date().toISOString();
  const copiesCount = Math.max(1, input.initialCopiesCount || 1);

  // 1. Create Book Document
  const bookRef = doc(collection(db, "libraryBooks"));
  const bookData: Omit<LibraryBook, "id"> = {
    title: input.title,
    isbn: input.isbn || "",
    author: input.author,
    publisher: input.publisher || "",
    edition: input.edition || "",
    category: input.category,
    subject: input.subject || "",
    grade: input.grade || "",
    language: input.language || "English",
    shelfLocation: input.shelfLocation || "",
    description: input.description || "",
    coverImageUrl: input.coverImageUrl || "",
    totalCopies: copiesCount,
    availableCopies: copiesCount,
    createdAt: now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(bookRef, bookData);

  // 2. Create physical copies in batch
  for (let i = 0; i < copiesCount; i++) {
    const copyRef = doc(collection(db, "libraryCopies"));
    const accessionNo = generateAccessionNumber(i);
    const copyData: Omit<LibraryCopy, "id"> = {
      bookId: bookRef.id,
      bookTitle: input.title,
      accessionNumber: accessionNo,
      barcode: accessionNo,
      condition: "new",
      status: "available",
      shelfLocation: input.shelfLocation || "",
      acquisitionDate: now.slice(0, 10),
      price: input.initialPrice || 0,
      createdAt: now,
      updatedAt: now,
    };
    batch.set(copyRef, copyData);
  }

  await batch.commit();

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "create",
    entity: "library_book",
    entityId: bookRef.id,
    details: `Added new book "${input.title}" by ${input.author} with ${copiesCount} physical copies`,
    metadata: { title: input.title, copiesCount, category: input.category },
  });

  return bookRef.id;
}

/**
 * Adds additional physical copies to an existing book title.
 */
export async function addCopiesToExistingBook(
  bookId: string,
  count: number,
  condition: LibraryCopyCondition = "new",
  price?: number,
  shelfLocation?: string,
  actor?: { userId: string; userName: string; role: Role }
): Promise<void> {
  if (!db) throw new Error("Firestore not initialized.");
  if (count <= 0) return;

  const bookSnap = await getDoc(doc(db, "libraryBooks", bookId));
  if (!bookSnap.exists()) throw new Error("Book not found.");
  const book = bookSnap.data() as LibraryBook;

  const batch = writeBatch(db);
  const now = new Date().toISOString();

  for (let i = 0; i < count; i++) {
    const copyRef = doc(collection(db, "libraryCopies"));
    const accessionNo = generateAccessionNumber(i);
    const copyData: Omit<LibraryCopy, "id"> = {
      bookId,
      bookTitle: book.title,
      accessionNumber: accessionNo,
      barcode: accessionNo,
      condition,
      status: "available",
      shelfLocation: shelfLocation || book.shelfLocation || "",
      acquisitionDate: now.slice(0, 10),
      price: price || 0,
      createdAt: now,
      updatedAt: now,
    };
    batch.set(copyRef, copyData);
  }

  batch.update(doc(db, "libraryBooks", bookId), {
    totalCopies: increment(count),
    availableCopies: increment(count),
    updatedAt: now,
  });

  await batch.commit();

  if (actor) {
    void logAuditEvent({
      userId: actor.userId,
      userName: actor.userName,
      role: actor.role,
      action: "create",
      entity: "library_copy",
      entityId: bookId,
      details: `Added ${count} new physical copies to book "${book.title}"`,
      metadata: { bookId, count },
    });
  }
}

export interface IssueBookInput {
  copyId: string;
  memberId: string; // Student or Staff UID
  memberType: LibraryMemberType;
  memberName: string;
  memberIdentifier: string; // Roll No, Admission No, or Email
  memberGrade?: string;
  memberSection?: string;
  dueDate?: string; // Optional custom due date (YYYY-MM-DD)
  notes?: string;
}

/**
 * Issues a physical book copy to a student or staff member.
 */
export async function issueBookCopy(
  input: IssueBookInput,
  actor: { userId: string; userName: string; role: Role }
): Promise<string> {
  if (!db) throw new Error("Firestore not initialized.");

  // Check copy availability
  const copyRef = doc(db, "libraryCopies", input.copyId);
  const copySnap = await getDoc(copyRef);
  if (!copySnap.exists()) throw new Error("Book copy not found.");
  const copy = copySnap.data() as LibraryCopy;

  if (copy.status !== "available") {
    throw new Error(`This copy (${copy.accessionNumber}) is currently ${copy.status} and cannot be issued.`);
  }

  // Check borrower limits
  const rules = await getLibraryFineRules();
  const maxLimit = input.memberType === "student" ? rules.maxBorrowLimitStudent : rules.maxBorrowLimitStaff;

  const activeIssuesSnap = await getDocs(
    query(
      collection(db, "libraryTransactions"),
      where("memberId", "==", input.memberId),
      where("status", "in", ["issued", "overdue"])
    )
  );

  if (activeIssuesSnap.docs.length >= maxLimit) {
    throw new Error(
      `Borrowing limit reached. ${input.memberName} already has ${activeIssuesSnap.docs.length} books issued (Maximum allowed: ${maxLimit}).`
    );
  }

  // Calculate due date
  const now = new Date();
  const issueDateStr = now.toISOString().slice(0, 10);
  let dueDateStr = input.dueDate;
  if (!dueDateStr) {
    const durationDays = input.memberType === "student" ? rules.standardDurationDaysStudent : rules.standardDurationDaysStaff;
    const due = new Date();
    due.setDate(due.getDate() + durationDays);
    dueDateStr = due.toISOString().slice(0, 10);
  }

  const txRef = doc(collection(db, "libraryTransactions"));
  const txData: Omit<LibraryTransaction, "id"> = {
    copyId: input.copyId,
    bookId: copy.bookId,
    bookTitle: copy.bookTitle,
    accessionNumber: copy.accessionNumber,
    memberId: input.memberId,
    memberType: input.memberType,
    memberName: input.memberName,
    memberIdentifier: input.memberIdentifier,
    memberGrade: input.memberGrade,
    memberSection: input.memberSection,
    issueDate: issueDateStr,
    dueDate: dueDateStr,
    status: "issued",
    renewalCount: 0,
    fineAmount: 0,
    finePaidStatus: "none",
    issuedBy: actor.userId,
    issuedByName: actor.userName,
    notes: input.notes || "",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const batch = writeBatch(db);
  batch.set(txRef, txData);

  // Update Copy
  batch.update(copyRef, {
    status: "issued",
    currentIssueId: txRef.id,
    currentBorrowerId: input.memberId,
    currentBorrowerName: input.memberName,
    currentBorrowerType: input.memberType,
    updatedAt: now.toISOString(),
  });

  // Decrement availableCopies in book catalog
  batch.update(doc(db, "libraryBooks", copy.bookId), {
    availableCopies: increment(-1),
    updatedAt: now.toISOString(),
  });

  await batch.commit();

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "issue",
    entity: "library_loan",
    entityId: txRef.id,
    details: `Issued book copy ${copy.accessionNumber} ("${copy.bookTitle}") to ${input.memberName} (${input.memberIdentifier}), Due: ${dueDateStr}`,
    metadata: { copyId: input.copyId, memberId: input.memberId, dueDate: dueDateStr },
  });

  return txRef.id;
}

export interface ReturnBookInput {
  transactionId: string;
  conditionOnReturn?: LibraryCopyCondition;
  finePaidStatus?: LibraryFinePaidStatus;
  fineWaivedReason?: string;
  returnDate?: string;
  notes?: string;
}

/**
 * Returns an issued book copy, calculates overdue fine, updates condition and inventory balances.
 */
export async function returnBookCopy(
  input: ReturnBookInput,
  actor: { userId: string; userName: string; role: Role }
): Promise<{ fineAmount: number; daysOverdue: number }> {
  if (!db) throw new Error("Firestore not initialized.");

  const txRef = doc(db, "libraryTransactions", input.transactionId);
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) throw new Error("Transaction record not found.");
  const tx = txSnap.data() as LibraryTransaction;

  if (tx.status === "returned") {
    throw new Error("This book has already been marked as returned.");
  }

  const rules = await getLibraryFineRules();
  const returnDateStr = input.returnDate || new Date().toISOString().slice(0, 10);
  const { daysOverdue, fineAmount } = calculateOverdueFine(tx.dueDate, returnDateStr, rules);

  let finePaidStatus: LibraryFinePaidStatus = input.finePaidStatus || "none";
  if (fineAmount > 0 && (!input.finePaidStatus || input.finePaidStatus === "none")) {
    finePaidStatus = "unpaid";
  }

  const returnCondition: LibraryCopyCondition = input.conditionOnReturn || "good";
  const newCopyStatus: LibraryCopyStatus = returnCondition === "damaged" ? "damaged" : "available";

  const now = new Date().toISOString();
  const batch = writeBatch(db);

  // 1. Update Transaction
  batch.update(txRef, {
    status: "returned",
    returnDate: returnDateStr,
    conditionOnReturn: returnCondition,
    fineAmount,
    finePaidStatus,
    fineWaivedReason: input.fineWaivedReason || "",
    returnedTo: actor.userId,
    returnedToName: actor.userName,
    notes: input.notes ? `${tx.notes || ""}; ${input.notes}`.trim() : tx.notes,
    updatedAt: now,
  });

  // 2. Update Copy
  const copyRef = doc(db, "libraryCopies", tx.copyId);
  batch.update(copyRef, {
    status: newCopyStatus,
    condition: returnCondition,
    currentIssueId: null,
    currentBorrowerId: null,
    currentBorrowerName: null,
    currentBorrowerType: null,
    updatedAt: now,
  });

  // 3. Increment available copies if copy returned in available condition
  if (newCopyStatus === "available") {
    batch.update(doc(db, "libraryBooks", tx.bookId), {
      availableCopies: increment(1),
      updatedAt: now,
    });
  }

  await batch.commit();

  void logAuditEvent({
    userId: actor.userId,
    userName: actor.userName,
    role: actor.role,
    action: "return",
    entity: "library_loan",
    entityId: tx.id,
    details: `Processed return of ${tx.accessionNumber} ("${tx.bookTitle}") from ${tx.memberName}. Overdue: ${daysOverdue} days, Fine: ₹${fineAmount} (${finePaidStatus})`,
    metadata: { copyId: tx.copyId, daysOverdue, fineAmount, finePaidStatus },
  });

  return { fineAmount, daysOverdue };
}

/**
 * Renews an active book issue, extending due date by standard duration.
 */
export async function renewBookCopy(
  transactionId: string,
  extraDays?: number,
  actor?: { userId: string; userName: string; role: Role }
): Promise<string> {
  if (!db) throw new Error("Firestore not initialized.");

  const txRef = doc(db, "libraryTransactions", transactionId);
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) throw new Error("Transaction not found.");
  const tx = txSnap.data() as LibraryTransaction;

  if (tx.status !== "issued" && tx.status !== "overdue") {
    throw new Error("Only active issues can be renewed.");
  }

  if (tx.renewalCount >= 2) {
    throw new Error("Maximum renewal limit (2 times) has been reached for this loan.");
  }

  const rules = await getLibraryFineRules();
  const defaultExtra = tx.memberType === "student" ? rules.standardDurationDaysStudent : rules.standardDurationDaysStaff;
  const daysToAdd = extraDays || defaultExtra;

  const currentDue = new Date(tx.dueDate);
  currentDue.setDate(currentDue.getDate() + daysToAdd);
  const newDueDate = currentDue.toISOString().slice(0, 10);

  const now = new Date().toISOString();
  await updateDoc(txRef, {
    dueDate: newDueDate,
    renewalCount: increment(1),
    status: "issued",
    updatedAt: now,
  });

  if (actor) {
    void logAuditEvent({
      userId: actor.userId,
      userName: actor.userName,
      role: actor.role,
      action: "renew",
      entity: "library_loan",
      entityId: transactionId,
      details: `Renewed loan for ${tx.accessionNumber} ("${tx.bookTitle}") to ${newDueDate}`,
    });
  }

  return newDueDate;
}

/**
 * Updates fine payment status (e.g. paid or waived).
 */
export async function updateFinePaymentStatus(
  transactionId: string,
  status: "paid" | "waived",
  waiverReason?: string,
  actor?: { userId: string; userName: string; role: Role }
): Promise<void> {
  if (!db) throw new Error("Firestore not initialized.");
  const ref = doc(db, "libraryTransactions", transactionId);
  await updateDoc(ref, {
    finePaidStatus: status,
    fineWaivedReason: waiverReason || "",
    updatedAt: new Date().toISOString(),
  });

  if (actor) {
    void logAuditEvent({
      userId: actor.userId,
      userName: actor.userName,
      role: actor.role,
      action: status === "waived" ? "fine_waiver" : "update",
      entity: "library_loan",
      entityId: transactionId,
      details: `Updated fine status to ${status}${waiverReason ? ` (Reason: ${waiverReason})` : ""}`,
    });
  }
}

/**
 * Computes dashboard statistics for the library module.
 */
export async function getLibraryStats(): Promise<{
  totalTitles: number;
  totalCopies: number;
  availableCopies: number;
  issuedCopies: number;
  overdueCount: number;
  totalFinesCollected: number;
  totalFinesPending: number;
}> {
  if (!db) {
    return {
      totalTitles: 0,
      totalCopies: 0,
      availableCopies: 0,
      issuedCopies: 0,
      overdueCount: 0,
      totalFinesCollected: 0,
      totalFinesPending: 0,
    };
  }

  const [booksSnap, copiesSnap, activeLoansSnap, allLoansSnap] = await Promise.all([
    getDocs(collection(db, "libraryBooks")),
    getDocs(collection(db, "libraryCopies")),
    getDocs(query(collection(db, "libraryTransactions"), where("status", "in", ["issued", "overdue"]))),
    getDocs(query(collection(db, "libraryTransactions"), limit(500))),
  ]);

  let availableCopies = 0;
  let issuedCopies = 0;
  for (const c of copiesSnap.docs) {
    const data = c.data() as LibraryCopy;
    if (data.status === "available") availableCopies++;
    if (data.status === "issued") issuedCopies++;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  let overdueCount = 0;
  for (const loan of activeLoansSnap.docs) {
    const data = loan.data() as LibraryTransaction;
    if (data.dueDate < todayStr) {
      overdueCount++;
    }
  }

  let totalFinesCollected = 0;
  let totalFinesPending = 0;
  for (const loan of allLoansSnap.docs) {
    const data = loan.data() as LibraryTransaction;
    if (data.fineAmount > 0) {
      if (data.finePaidStatus === "paid") {
        totalFinesCollected += data.fineAmount;
      } else if (data.finePaidStatus === "unpaid") {
        totalFinesPending += data.fineAmount;
      }
    }
  }

  return {
    totalTitles: booksSnap.docs.length,
    totalCopies: copiesSnap.docs.length,
    availableCopies,
    issuedCopies,
    overdueCount,
    totalFinesCollected,
    totalFinesPending,
  };
}

// ============================================================
// STUDENT PORTAL LIBRARY HELPERS
// ============================================================

export interface StudentLibrarySummary {
  borrowedCount: number;
  dueSoonCount: number;
  overdueCount: number;
  historyCount: number;
  totalPendingFine: number;
}

/**
 * Resolves the authenticated student's library member identifiers (Auth UID, studentDocId, studentUid).
 * Prevents IDOR by resolving strictly from the authenticated account.
 */
export async function resolveStudentLibraryIdentifiers(
  authUid: string,
  email?: string
): Promise<{ primaryStudentId: string; allIdentifiers: string[]; studentData?: any }> {
  if (!db) {
    return { primaryStudentId: authUid, allIdentifiers: [authUid] };
  }

  const ids = new Set<string>([authUid]);
  let resolvedStudent: any = null;

  try {
    // 1. Direct lookup in students collection by doc ID == authUid
    const directDoc = await getDoc(doc(db, "students", authUid));
    if (directDoc.exists()) {
      resolvedStudent = { id: directDoc.id, ...directDoc.data() };
      ids.add(directDoc.id);
      if (resolvedStudent.studentUid) ids.add(resolvedStudent.studentUid);
      if (resolvedStudent.uid) ids.add(resolvedStudent.uid);
      if (resolvedStudent.admissionNo) ids.add(resolvedStudent.admissionNo);
    }

    // 2. Query students collection by uid == authUid
    if (!resolvedStudent) {
      const qUid = query(collection(db, "students"), where("uid", "==", authUid), limit(1));
      const snapUid = await getDocs(qUid);
      if (!snapUid.empty) {
        const d = snapUid.docs[0];
        resolvedStudent = { id: d.id, ...d.data() };
        ids.add(d.id);
        if (resolvedStudent.studentUid) ids.add(resolvedStudent.studentUid);
        if (resolvedStudent.uid) ids.add(resolvedStudent.uid);
      }
    }

    // 3. Query students collection by authUid == authUid
    if (!resolvedStudent) {
      const qAuth = query(collection(db, "students"), where("authUid", "==", authUid), limit(1));
      const snapAuth = await getDocs(qAuth);
      if (!snapAuth.empty) {
        const d = snapAuth.docs[0];
        resolvedStudent = { id: d.id, ...d.data() };
        ids.add(d.id);
        if (resolvedStudent.studentUid) ids.add(resolvedStudent.studentUid);
      }
    }

    // 4. Query students collection by email
    if (!resolvedStudent && email) {
      const qEmail = query(collection(db, "students"), where("email", "==", email), limit(1));
      const snapEmail = await getDocs(qEmail);
      if (!snapEmail.empty) {
        const d = snapEmail.docs[0];
        resolvedStudent = { id: d.id, ...d.data() };
        ids.add(d.id);
        if (resolvedStudent.studentUid) ids.add(resolvedStudent.studentUid);
      }
    }

    // 5. Check user document for studentUid / studentDocId links
    const userSnap = await getDoc(doc(db, "users", authUid));
    if (userSnap.exists()) {
      const uData = userSnap.data();
      if (uData.studentUid) ids.add(uData.studentUid);
      if (uData.studentDocId) ids.add(uData.studentDocId);
    }
  } catch (err) {
    console.error("Error resolving student library identifiers:", err);
  }

  const allIdentifiers = Array.from(ids).filter(Boolean);
  const primaryStudentId = resolvedStudent?.id || resolvedStudent?.studentUid || authUid;

  return { primaryStudentId, allIdentifiers, studentData: resolvedStudent };
}

/**
 * Subscribes to real-time library transactions for a student.
 * Reflects immediately when a librarian issues, returns, or renews a book.
 */
export function subscribeToStudentLibraryTransactions(
  identifiers: string[],
  onData: (transactions: LibraryTransaction[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!db || identifiers.length === 0) {
    onData([]);
    return () => {};
  }

  // Firestore 'in' query supports up to 10 values
  const safeIds = identifiers.slice(0, 10);
  const q = query(
    collection(db, "libraryTransactions"),
    where("memberId", "in", safeIds)
  );

  return onSnapshot(
    q,
    (snap) => {
      const txs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LibraryTransaction));
      // Sort newest issue first
      txs.sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));
      onData(txs);
    },
    (err) => {
      console.error("Failed to subscribe to student library transactions:", err);
      onError?.(err);
    }
  );
}

/**
 * Loads book catalog records for a set of transaction bookIds.
 * Provides author, ISBN, category, coverImageUrl, and shelf location.
 */
export async function getBooksMapForTransactions(
  bookIds: string[]
): Promise<Record<string, LibraryBook>> {
  if (!db || bookIds.length === 0) return {};
  const uniqueIds = Array.from(new Set(bookIds.filter(Boolean)));
  const bookMap: Record<string, LibraryBook> = {};

  await Promise.all(
    uniqueIds.map(async (bId) => {
      try {
        const snap = await getDoc(doc(db, "libraryBooks", bId));
        if (snap.exists()) {
          bookMap[bId] = { id: snap.id, ...snap.data() } as LibraryBook;
        }
      } catch (err) {
        console.error(`Failed to load book ${bId}:`, err);
      }
    })
  );

  return bookMap;
}

/**
 * Calculates days difference between due date and current date (or specified date).
 * Positive = days remaining.
 * Zero = due today.
 * Negative = days overdue.
 */
export function getLoanDaysDiff(
  dueDateStr: string,
  asOfDateStr: string = new Date().toISOString().slice(0, 10)
): number {
  if (!dueDateStr) return 0;
  const due = new Date(dueDateStr);
  const asOf = new Date(asOfDateStr);
  const diffTime = due.getTime() - asOf.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Calculates summary metrics for the student's library activity.
 * Ideal for both the Student Library page and Dashboard widget.
 */
export function calculateStudentLibrarySummary(
  transactions: LibraryTransaction[],
  rules: LibraryFineRule = DEFAULT_FINE_RULES
): StudentLibrarySummary {
  const todayStr = new Date().toISOString().slice(0, 10);
  const reminderThreshold = rules.reminderDaysBeforeDue || 3;

  let borrowedCount = 0;
  let dueSoonCount = 0;
  let overdueCount = 0;
  let historyCount = 0;
  let totalPendingFine = 0;

  for (const tx of transactions) {
    if (tx.status === "returned" || tx.status === "lost") {
      historyCount++;
      if (tx.finePaidStatus === "unpaid" && tx.fineAmount > 0) {
        totalPendingFine += tx.fineAmount;
      }
    } else {
      // Active loan ("issued" or "overdue")
      borrowedCount++;
      const daysDiff = getLoanDaysDiff(tx.dueDate, todayStr);
      if (daysDiff < 0 || tx.status === "overdue") {
        overdueCount++;
        const { fineAmount } = calculateOverdueFine(tx.dueDate, todayStr, rules);
        totalPendingFine += Math.max(fineAmount, tx.fineAmount || 0);
      } else if (daysDiff <= reminderThreshold) {
        dueSoonCount++;
      }
    }
  }

  return {
    borrowedCount,
    dueSoonCount,
    overdueCount,
    historyCount,
    totalPendingFine,
  };
}

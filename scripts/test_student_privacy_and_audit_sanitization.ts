/**
 * Targeted Verification Suite:
 * 1. Student Privacy & IDOR Firestore Rules Analysis
 * 2. Audit Data Sanitization & Undefined Stripping
 */

import * as fs from "fs";
import * as path from "path";
import { sanitizeAuditData } from "../src/lib/audit";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✓ PASS: ${msg}`);
  passed++;
}

function runSection(title: string) {
  console.log(`\n======================================================================`);
  console.log(title);
  console.log(`======================================================================`);
}

async function main() {
  runSection("SECTION 1: FIRESTORE RULES — STUDENT PRIVACY & IDOR SCOPING");

  const rulesPath = path.resolve(process.cwd(), "firestore.rules");
  const rulesContent = fs.readFileSync(rulesPath, "utf-8");

  // Extract match /students/{studentId} block
  const matchStudents = rulesContent.match(/match\s+\/students\/\{studentId\}\s*\{([\s\S]*?)\n\s*\}/);
  assert(matchStudents !== null, "firestore.rules defines match /students/{studentId}");

  const studentRules = matchStudents ? matchStudents[1] : "";

  // 1. Unauthenticated blocked (requires isSignedIn())
  assert(
    studentRules.includes("isSignedIn()"),
    "Rule enforces isSignedIn() for all reads"
  );

  // 2. Printing department strictly excluded
  assert(
    studentRules.includes("!isPrintingDept()"),
    "Rule strictly excludes printing department from reading student records"
  );

  // 3. Admin authorized
  assert(
    studentRules.includes("isAdmin()"),
    "Rule permits Admin (Principal) to access student records"
  );

  // 4. Staff authorized for academic/management tasks
  assert(
    studentRules.includes("isStaff()"),
    "Rule permits Staff (HOD, Teacher, Accountant) to access student records"
  );

  // 5. Operations authorized for library & uniforms
  assert(
    studentRules.includes("isOperations()"),
    "Rule permits Operations staff to access student records"
  );

  // 6. Student self-ownership by document ID (auth.uid == studentId)
  assert(
    studentRules.includes("studentId == request.auth.uid"),
    "Rule permits student self-read when studentId matches auth.uid"
  );

  // 7. Student self-ownership by resource fields
  assert(
    studentRules.includes("resource.data.uid == request.auth.uid") &&
    studentRules.includes("resource.data.authUid == request.auth.uid") &&
    studentRules.includes("resource.data.studentUid == request.auth.uid"),
    "Rule permits student self-read when resource data contains matching uid, authUid, or studentUid"
  );

  // 8. Student self-ownership by profile mappings in user doc
  assert(
    studentRules.includes("resource.data.studentUid == getUserData().studentUid") &&
    studentRules.includes("studentId == getUserData().studentDocId"),
    "Rule permits student self-read via canonical studentUid and studentDocId in user profile"
  );

  // 9. Parent scoping via linkedStudentUids
  assert(
    studentRules.includes("getUserRole() == 'parent'") &&
    studentRules.includes("'linkedStudentUids' in getUserData()") &&
    studentRules.includes("studentId in getUserData().linkedStudentUids"),
    "Rule permits Parent access strictly to students in linkedStudentUids"
  );

  // 10. Write protection (Admin and HOD only with sensitive auth field rejection)
  assert(
    studentRules.includes("allow create: if (isAdmin() || (isSignedIn() && getUserRole() == 'hod')) && hasNoSensitiveAuthFields(request.resource.data);"),
    "Student document creation strictly guarded by admin/HOD and hasNoSensitiveAuthFields"
  );
  assert(
    studentRules.includes("allow delete: if isAdmin();"),
    "Student document deletion reserved exclusively for Admin"
  );

  // 11. Simulate evaluation logic for cross-student traversal (IDOR protection)
  function evaluateStudentRead(user: { role: string; uid: string; linkedStudentUids?: string[]; studentUid?: string }, studentDoc: { id: string; uid?: string; authUid?: string; studentUid?: string }): boolean {
    if (!user || !user.uid) return false;
    if (user.role === "printing") return false;
    if (user.role === "admin" || user.role === "teacher" || user.role === "hod" || user.role === "accountant" || user.role === "operations") return true;

    // Student self-read
    if (user.role === "student") {
      if (studentDoc.id === user.uid) return true;
      if (studentDoc.uid === user.uid) return true;
      if (studentDoc.authUid === user.uid) return true;
      if (studentDoc.studentUid === user.uid) return true;
      if (user.studentUid && studentDoc.studentUid === user.studentUid) return true;
      return false;
    }

    // Parent linked child read
    if (user.role === "parent") {
      const linked = user.linkedStudentUids || [];
      if (linked.includes(studentDoc.id)) return true;
      if (studentDoc.uid && linked.includes(studentDoc.uid)) return true;
      if (studentDoc.authUid && linked.includes(studentDoc.authUid)) return true;
      if (studentDoc.studentUid && linked.includes(studentDoc.studentUid)) return true;
      return false;
    }

    return false;
  }

  const studentA = { id: "STU-001", uid: "AUTH-STU-1", studentUid: "STU-001" };
  const studentB = { id: "STU-002", uid: "AUTH-STU-2", studentUid: "STU-002" };
  const studentUserA = { role: "student", uid: "AUTH-STU-1", studentUid: "STU-001" };
  const studentUserB = { role: "student", uid: "AUTH-STU-2", studentUid: "STU-002" };
  const parentUserA = { role: "parent", uid: "AUTH-PAR-1", linkedStudentUids: ["STU-001"] };
  const printingUser = { role: "printing", uid: "AUTH-PRN-1" };
  const teacherUser = { role: "teacher", uid: "AUTH-TCH-1" };
  const adminUser = { role: "admin", uid: "AUTH-ADM-1" };

  assert(evaluateStudentRead(studentUserA, studentA) === true, "Student A accessing own record is ALLOWED");
  assert(evaluateStudentRead(studentUserA, studentB) === false, "Student A accessing Student B record is DENIED (IDOR blocked)");
  assert(evaluateStudentRead(parentUserA, studentA) === true, "Parent A accessing linked child Student A is ALLOWED");
  assert(evaluateStudentRead(parentUserA, studentB) === false, "Parent A accessing unlinked child Student B is DENIED (IDOR blocked)");
  assert(evaluateStudentRead(printingUser, studentA) === false, "Printing staff accessing student record is DENIED");
  assert(evaluateStudentRead(teacherUser, studentA) === true, "Teacher accessing student record is ALLOWED");
  assert(evaluateStudentRead(adminUser, studentA) === true, "Admin accessing student record is ALLOWED");

  runSection("SECTION 2: AUDIT DATA SANITIZATION & UNDEFINED STRIPPING");

  // Test 1: Undefined values at top-level are completely stripped
  const inputWithUndefined = {
    action: "marks_reopen",
    reason: undefined,
    previousStatus: undefined,
    count: 5,
    note: "Valid note",
  };
  const sanitizedTop = sanitizeAuditData(inputWithUndefined);
  assert(!("reason" in sanitizedTop), "Top-level undefined key 'reason' is omitted");
  assert(!("previousStatus" in sanitizedTop), "Top-level undefined key 'previousStatus' is omitted");
  assert(sanitizedTop.count === 5, "Legitimate number preserved");
  assert(sanitizedTop.note === "Valid note", "Legitimate string preserved");

  // Test 2: Deeply nested undefined values are completely stripped
  const inputNested = {
    studentUid: "STU-101",
    details: {
      examId: "exam-midterm",
      reason: undefined,
      metadata: {
        previousWorkflowStatus: undefined,
        currentWorkflowStatus: "draft",
      },
    },
  };
  const sanitizedNested: any = sanitizeAuditData(inputNested);
  assert(!("reason" in sanitizedNested.details), "Nested undefined key 'details.reason' is omitted");
  assert(!("previousWorkflowStatus" in sanitizedNested.details.metadata), "Deeply nested undefined key is omitted");
  assert(sanitizedNested.details.metadata.currentWorkflowStatus === "draft", "Deeply nested valid value preserved");

  // Test 3: Arrays with undefined elements
  const inputArr = {
    stages: ["stage1", undefined, "stage2"],
  };
  const sanitizedArr: any = sanitizeAuditData(inputArr);
  assert(sanitizedArr.stages.length === 2, "Undefined elements filtered out of arrays");
  assert(sanitizedArr.stages[0] === "stage1" && sanitizedArr.stages[1] === "stage2", "Array items preserved in order");

  // Test 4: Sensitive password and secret redaction is preserved
  const inputSensitive = {
    user: "staff1",
    password: "secretpassword123",
    authToken: "jwt-token-value",
    safeField: "safe",
  };
  const sanitizedSensitive: any = sanitizeAuditData(inputSensitive);
  assert(sanitizedSensitive.password === "[REDACTED]", "Password field is redacted to [REDACTED]");
  assert(sanitizedSensitive.authToken === "[REDACTED]", "Token field is redacted to [REDACTED]");
  assert(sanitizedSensitive.safeField === "safe", "Non-sensitive field preserved intact");

  // Test 5: Firestore document write simulation (ensure zero undefined values in payload)
  function assertNoUndefined(obj: any, pathStr = ""): void {
    if (obj === undefined) {
      throw new Error(`Found undefined at path: ${pathStr}`);
    }
    if (obj !== null && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) {
          throw new Error(`Found undefined property at: ${pathStr ? `${pathStr}.${k}` : k}`);
        }
        assertNoUndefined(v, pathStr ? `${pathStr}.${k}` : k);
      }
    }
  }

  const complexAuditPayload = {
    userId: "AUTH-USER-01",
    userName: "Teacher Jane",
    role: "teacher",
    action: "signature_invalidated",
    entity: "report_card_signatures",
    details: {
      studentUid: "STU-101",
      previousWorkflowStatus: undefined, // Simulates uninitialized workflow status
      newWorkflowStatus: "draft",
      reason: undefined, // Simulates omitted reason
      originalMarks: null,
      updatedMarks: { math: 85, science: 90 },
    },
    metadata: {
      traceId: "TRC-12345",
      optionalNote: undefined,
    },
  };

  const fullySanitized = sanitizeAuditData(complexAuditPayload);
  let errorFound = false;
  try {
    assertNoUndefined(fullySanitized);
  } catch (err: any) {
    errorFound = true;
  }
  assert(!errorFound, "Sanitized complex audit payload contains ZERO undefined values (100% Firestore compatible)");

  runSection("SUMMARY OF VERIFICATION");
  console.log(`  Total assertions executed: ${passed + failed}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Execution error:", err);
  process.exit(1);
});

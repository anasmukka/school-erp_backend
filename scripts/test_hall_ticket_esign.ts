/**
 * Hall Ticket E-Signature System Verification Test Suite
 * Prestige International School ERP
 *
 * Verifies that:
 * 1. The ONLY authorized signer on Hall Tickets is Admin (Principal).
 * 2. Candidate's Signature is completely eliminated from config, resolver, PDF, and rules.
 * 3. Class Teacher and HOD cannot sign Hall Tickets.
 * 4. Report Cards and Notices retain their respective authorized signers.
 * 5. Sanitization strictly strips any unauthorized slots.
 * 6. Finalization blocker throws exact error: "Principal signature is required before this Hall Ticket can be finalized."
 * 7. Firestore Security Rules enforce strict access controls on signatures and signatureConfigs.
 */

import fs from "fs";
import path from "path";
import {
  DOCUMENT_SIGN_PERMISSIONS,
  canSignDocument,
  DEFAULT_SIGNATORY_CONFIGS,
  sanitizeSignatoryConfig,
  type DocumentSignatoryConfig,
  type SignatoryRole,
} from "../src/lib/signatures";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
    failedCount++;
  }
}

console.log("======================================================================");
console.log("HALL TICKET E-SIGNATURE VERIFICATION TEST SUITE");
console.log("======================================================================\n");

// -----------------------------------------------------------------------------
// [SECTION 1] PERMISSION MATRIX & ROLE RESTRICTIONS
// -----------------------------------------------------------------------------
console.log("--- Section 1: Permission Matrix & Role Restrictions ---");

const htPermissions = DOCUMENT_SIGN_PERMISSIONS.hall_ticket;
assert(
  Array.isArray(htPermissions) && htPermissions.length === 1 && htPermissions[0] === "admin",
  "TEST 1: DOCUMENT_SIGN_PERMISSIONS.hall_ticket contains ONLY 'admin'"
);

assert(
  canSignDocument("admin", "hall_ticket") === true,
  "TEST 2: Admin canSignDocument('admin', 'hall_ticket') -> TRUE"
);

assert(
  canSignDocument("hod", "hall_ticket") === false,
  "TEST 3: HOD canSignDocument('hod', 'hall_ticket') -> FALSE"
);

assert(
  canSignDocument("class_teacher", "hall_ticket") === false,
  "TEST 4: Class Teacher canSignDocument('class_teacher', 'hall_ticket') -> FALSE"
);

const unauthorizedRoles: string[] = ["teacher", "student", "parent", "accountant", "operations", "printing"];
const anyUnauthorizedCanSign = unauthorizedRoles.some((role) =>
  canSignDocument(role as SignatoryRole, "hall_ticket")
);
assert(
  !anyUnauthorizedCanSign,
  "TEST 5: Unauthorized roles (student, parent, teacher, accounts, etc.) -> DENIED"
);

// Verify other document types are preserved
assert(
  DOCUMENT_SIGN_PERMISSIONS.report_card.includes("class_teacher") &&
  DOCUMENT_SIGN_PERMISSIONS.report_card.includes("hod") &&
  DOCUMENT_SIGN_PERMISSIONS.report_card.includes("admin"),
  "TEST 6: Report card permissions preserved (class_teacher, hod, admin)"
);

assert(
  DOCUMENT_SIGN_PERMISSIONS.official_notice.includes("admin") &&
  DOCUMENT_SIGN_PERMISSIONS.official_notice.includes("hod") &&
  !DOCUMENT_SIGN_PERMISSIONS.official_notice.includes("class_teacher"),
  "TEST 7: Official notice permissions preserved (admin, hod only)"
);

// -----------------------------------------------------------------------------
// [SECTION 2] DEFAULT SIGNATORY CONFIGURATION
// -----------------------------------------------------------------------------
console.log("\n--- Section 2: Default Hall Ticket Signatory Config ---");

const defaultHtConfig = DEFAULT_SIGNATORY_CONFIGS.find((c) => c.documentType === "hall_ticket");
assert(!!defaultHtConfig, "TEST 8: Default config for 'hall_ticket' exists");

if (defaultHtConfig) {
  assert(
    defaultHtConfig.slots.length === 1,
    "TEST 9: Hall ticket config has EXACTLY 1 slot (no extra slots)"
  );

  const slot = defaultHtConfig.slots[0];
  assert(
    slot?.role === "admin" && slot?.slotId === "admin",
    "TEST 10: Single slot has role 'admin' and slotId 'admin'"
  );

  assert(
    slot?.label === "Principal & Seal",
    "TEST 11: Single slot label is 'Principal & Seal'"
  );

  assert(
    slot?.required === true,
    "TEST 12: Single slot is marked as required (required === true)"
  );

  const hasCandidateSlot = defaultHtConfig.slots.some(
    (s) => s.slotId === "candidate" || s.label.toLowerCase().includes("candidate")
  );
  assert(!hasCandidateSlot, "TEST 13: NO 'candidate' slot in Hall Ticket default config");

  const hasTeacherSlot = defaultHtConfig.slots.some(
    (s) => s.role === "class_teacher" || (s.role as string) === "teacher"
  );
  assert(!hasTeacherSlot, "TEST 14: NO teacher or class_teacher slot in Hall Ticket default config");
}

// -----------------------------------------------------------------------------
// [SECTION 3] CONFIG SANITIZATION ENGINE (SELF-HEALING)
// -----------------------------------------------------------------------------
console.log("\n--- Section 3: Sanitization Engine & Dirty Config Stripping ---");

const legacyDirtyHtConfig: DocumentSignatoryConfig = {
  id: "hall_ticket",
  documentType: "hall_ticket",
  title: "Examination Admit Card / Hall Ticket",
  description: "Legacy config with obsolete candidate and teacher slots",
  slots: [
    { slotId: "candidate", label: "Candidate's Signature", role: "teacher" as SignatoryRole, required: true, order: 1 },
    { slotId: "class_teacher", label: "Class Teacher", role: "class_teacher", required: false, order: 2 },
    { slotId: "admin", label: "Principal & Seal", role: "admin", required: true, order: 3 },
  ],
  updatedAt: new Date().toISOString(),
  updatedBy: "legacy_seed",
};

const sanitizedHt = sanitizeSignatoryConfig(legacyDirtyHtConfig);

assert(
  sanitizedHt.slots.length === 1,
  "TEST 15: sanitizeSignatoryConfig strips legacy dirty slots down to exactly 1"
);

assert(
  sanitizedHt.slots[0]?.role === "admin" && sanitizedHt.slots[0]?.slotId === "admin",
  "TEST 16: Sanitized slot is strictly Admin (Principal & Seal)"
);

assert(
  !sanitizedHt.slots.some((s) => s.slotId === "candidate" || s.label.includes("Candidate")),
  "TEST 17: Candidate's signature completely stripped from sanitized config"
);

assert(
  !sanitizedHt.slots.some((s) => s.role === "class_teacher"),
  "TEST 18: Class Teacher completely stripped from sanitized Hall Ticket config"
);

// -----------------------------------------------------------------------------
// [SECTION 4] HALL TICKET ENGINE BLOCKER LOGIC
// -----------------------------------------------------------------------------
console.log("\n--- Section 4: Engine Blocker Verification ---");

const engineSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/hallTicketEngine.ts"),
  "utf-8"
);

const exactErrorMessage = "Principal signature is required before this Hall Ticket can be finalized.";

assert(
  engineSource.includes(exactErrorMessage),
  "TEST 19: hallTicketEngine.ts contains exact blocker error message"
);

// Check that generateHallTicketForStudent enforces the check
const hasSingleTicketBlocker =
  engineSource.includes("if (!principalSignatureUrl)") &&
  engineSource.includes(exactErrorMessage);
assert(
  hasSingleTicketBlocker,
  "TEST 20: generateHallTicketForStudent blocks finalization when principal signature is missing"
);

// Check that bulkGenerateHallTickets enforces the check before processing
const hasBulkTicketBlocker =
  engineSource.includes("bulkGenerateHallTickets") &&
  engineSource.includes("hasActivePrincipalSig") &&
  engineSource.includes(exactErrorMessage);
assert(
  hasBulkTicketBlocker,
  "TEST 21: bulkGenerateHallTickets validates active Principal signature before batch generation"
);

// -----------------------------------------------------------------------------
// [SECTION 5] PDF TEMPLATE VERIFICATION
// -----------------------------------------------------------------------------
console.log("\n--- Section 5: PDF Template Verification ---");

const pdfSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/generateHallTicketPdf.ts"),
  "utf-8"
);

const hasCandidateInPdf =
  pdfSource.toLowerCase().includes("candidate's signature") ||
  pdfSource.toLowerCase().includes("candidate signature");
assert(
  !hasCandidateInPdf,
  "TEST 22: generateHallTicketPdf.ts contains NO reference to Candidate's Signature"
);

const hasClassTeacherInPdf = pdfSource.toLowerCase().includes("class teacher / verifier");
assert(
  !hasClassTeacherInPdf,
  "TEST 23: generateHallTicketPdf.ts contains NO Class Teacher / Verifier signature line"
);

const hasPrincipalSealSection =
  pdfSource.includes("Principal / Controller of Exam") &&
  pdfSource.includes("(Official Seal & Authorized Signature)");
assert(
  hasPrincipalSealSection,
  "TEST 24: generateHallTicketPdf.ts contains official Principal / Controller of Exam seal"
);

// -----------------------------------------------------------------------------
// [SECTION 6] FIRESTORE SECURITY RULES VERIFICATION
// -----------------------------------------------------------------------------
console.log("\n--- Section 6: Firestore Security Rules Static Verification ---");

const rulesSource = fs.readFileSync(
  path.resolve(process.cwd(), "firestore.rules"),
  "utf-8"
);

// 1. signatures collection
const sigRulesMatch = rulesSource.match(/match\s+\/signatures\/\{sigId\}\s*\{([\s\S]*?)\}/);
const sigRules = sigRulesMatch ? sigRulesMatch[1] : "";

assert(
  sigRules.includes("isAdmin() || getUserRole() in ['hod', 'class_teacher']"),
  "TEST 25: signatures collection read restricted to Admin, HOD, and Class Teacher only"
);

assert(
  !sigRules.includes("getUserRole() == 'student'") &&
  !sigRules.includes("getUserRole() == 'parent'") &&
  !sigRules.includes("getUserRole() == 'accountant'"),
  "TEST 26: Students, Parents, and Accountants have NO access to signatures collection"
);

assert(
  sigRules.includes("allow delete: if isAdmin();"),
  "TEST 27: Signatures delete operation restricted to Admin ONLY"
);

// 2. signatureConfigs collection
const configRulesMatch = rulesSource.match(/match\s+\/signatureConfigs\/\{configId\}\s*\{([\s\S]*?)\}/);
const configRules = configRulesMatch ? configRulesMatch[1] : "";

assert(
  configRules.includes("allow write: if isAdmin();"),
  "TEST 28: signatureConfigs write operation strictly restricted to Admin ONLY"
);

// -----------------------------------------------------------------------------
// [SECTION 7] SUMMARY
// -----------------------------------------------------------------------------
console.log("\n======================================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED out of ${passedCount + failedCount} TESTS`);
console.log("======================================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("ALL HALL TICKET E-SIGNATURE VERIFICATION TESTS PASSED SUCCESSFULLY! ✓\n");
  process.exit(0);
}

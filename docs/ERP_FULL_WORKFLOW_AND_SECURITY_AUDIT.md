# PRESTIGE INTERNATIONAL SCHOOL ERP
## End-to-End Functional, Workflow, Security & Regression Audit Report

**Report Identifier:** AUDIT-ERP-2026-10-20  
**Audit Type:** Pre-Production Acceptance, Security Assessment & Full Workflow Verification  
**Target Repository:** `school-erp_backend` (`origin/main`)  
**Commit Inspected:** `92bbe360728a6104a5c9711009baf276a489ea82`  
**Date of Audit:** October 20, 2026  
**Security Reference Frameworks:** OWASP Top 10 (2021), OWASP ASVS 4.0, NIST SP 800-115  

---

## A. EXECUTIVE SUMMARY

An exhaustive, independent functional, workflow, security, and regression audit of the **Prestige International School ERP** was performed. The evaluation encompassed the frontend single-page application (React 18 + Vite), the Python FastAPI RFID backend service, the Cloudflare Worker API & storage gateway, Firebase Cloud Functions (v2), Cloud Firestore security rules, Firebase Storage security rules, and all academic, financial, attendance, and administrative workflows.

### Summary Metrics

| Category | Count | Status / Notes |
|:---|:---:|:---|
| **Total Automated Assertions Executed** | **508** | Across 12 dedicated automated test suites |
| **Automated Assertions Passed** | **499** | 98.2% pass rate across regression suites |
| **Automated Assertions Failed** | **9** | Security rules coverage & legacy assertion mismatch |
| **Total Confirmed Vulnerabilities** | **6** | 1 Critical, 3 High, 2 Medium |
| **Total Confirmed Functional / Logic Bugs** | **9** | 1 Critical, 4 High, 4 Medium |
| **Data Integrity / Schema Defects** | **1** | Medium (conflicting interface declarations) |
| **Integration Deficiencies** | **1** | Medium (missing employee RFID pipeline) |
| **Dependency Vulnerabilities (NPM Audit)** | **15** | 1 Critical (`websocket-driver`), 7 High, 6 Moderate, 1 Low |
| **TypeScript Compilation Errors (`tsc`)** | **28** | Across 14 files (hidden by Vite un-typechecked build) |

### Top 5 Critical & High-Priority Problems

1. **[SEC-01] Unauthenticated FastAPI Backend Endpoints (`backend/server.py:372-562`) — Severity: CRITICAL**  
   The FastAPI backend endpoints (`/api/rfid-scan`, `/api/rfid-cards`, `/api/attendance`, `/api/attendance/today-count`) enforce **zero authentication or authorization**. Any network actor can forge student attendance records, reassign RFID cards, delete card bindings, or dump full student rosters and attendance histories without credentials.
2. **[SEC-02] Insecure Firebase Storage Rules Allowing Unauthorized Write Access (`storage.rules:19-34`) — Severity: HIGH**  
   Storage rules grant any authenticated user (`request.auth != null`) unrestricted write access to official signatures (`/signatures/{fileName}`) and general files (`/{allPaths=**}`). Any student or parent account can overwrite or delete official principal signatures or institutional assets.
3. **[SEC-03] Missing Firestore Security Rules for Notification & Contact Collections — Severity: HIGH**  
   `firestore.rules` completely lacks match blocks for `schoolContact`, `notificationJobs`, `notificationLogs`, `notificationTemplates`, `notificationSettings`, `notificationPreferences`, `deviceTokens`, and `whatsappConsents`. By Firestore's default deny model, all client operations on these collections fail with `permission-denied`.
4. **[BUG-0001] Scoping Defect in Concession Approval Engine (`src/lib/feeAssignments.ts:427`) — Severity: CRITICAL**  
   Helper function `syncAssignmentTerms` was declared locally inside the function body of `addConcession`. Consequently, calling `approveConcession` or `removeConcession` results in a fatal runtime crash: `ReferenceError: syncAssignmentTerms is not defined`.
5. **[BUG-0004] Complete Absence of Parent/Guardian Role Routes and Navigation — Severity: HIGH**  
   While backend rules and Cloud Functions recognize the `parent` role, `src/App.tsx` and `src/components/Layout.tsx` contain zero parent routes or navigation items. Logged-in parents are presented with an empty sidebar and redirected away from all functional pages.

### Production Release Recommendation
**`BLOCK RELEASE`**  
The application cannot be released to production until the P0/P1 security vulnerabilities (backend authentication bypass, storage rule write permissions, missing collection rules) and core workflow blockers (concession runtime crash, parent role routing) are remediated.

---

## B. SCOPE AND METHODOLOGY

### Audit Scope
1. **Frontend Modules (40+ routes):** Admin, HOD, Teacher, Student, Accounts, Printing, Operations, and Library interfaces.
2. **Backend API Services:**
   - Python FastAPI server (`backend/server.py`) handling RFID scans and attendance aggregation.
   - Cloudflare Worker (`worker/src/index.ts`) handling secure R2 uploads, downloads, rate limiting, and webhook validation.
   - Firebase Cloud Functions (`functions/index.js` and `functions/notifications/`).
3. **Database & Storage Security:**
   - Cloud Firestore security rules (`firestore.rules`).
   - Firebase Storage security rules (`storage.rules`).
4. **Data Workflows:** Academic Structure Planner, Teacher Marks Entry, Individual Exam Results, Annual Report Cards, E-Signatures, Fee Management, Attendance/RFID, Notifications Hub.

### Testing Methodology
- **Static Code Analysis:** Manual code auditing, AST-based grep searches, and dependency vulnerability scans (`npm audit`).
- **Type Invariant Verification:** Executed `tsc --noEmit` across all TypeScript modules to detect silent type coercions and runtime reference errors ignored by Vite.
- **Automated Behavioral QA:** Executed 12 specialized test suites exercising 508 distinct operational scenarios.
- **Authorization Boundary Assessment:** Tested client impersonation, IDOR, cross-role traversal, and unauthenticated endpoint invocation.
- **Zero Production Disruption:** All tests utilized isolated test fixtures, mocked network providers, and synthetic identifiers. No live SMS/WhatsApp messages, real fee transactions, or production record deletions were conducted.

---

## C. WORKFLOW COVERAGE MATRIX

| Workflow | Roles Assessed | Preconditions | Test Scenarios | Expected Outcome | Actual Outcome | Status | Finding Reference |
|:---|:---|:---|:---|:---|:---|:---:|:---|
| **RFID Attendance Scan** | Unauthenticated / Device | Backend running | Scan submission with valid student card | Requires device auth; marks attendance | Marks attendance with zero authentication | ❌ FAIL | SEC-01 |
| **RFID Card Management** | Unauthenticated | Backend running | Assign / delete RFID card | Admin token required | Any HTTP client can assign/delete cards | ❌ FAIL | SEC-01 |
| **Attendance Query** | Unauthenticated | Backend running | Fetch attendance roster | Staff token required | Full attendance records leaked unauthenticated | ❌ FAIL | SEC-01 |
| **Official Signature Upload (Storage)** | Student / Parent | Authenticated | Upload image to `/signatures/principal.png` | Denied (Staff/Admin only) | Permitted by `request.auth != null` rule | ❌ FAIL | SEC-02 |
| **Notification Settings & Preferences** | Admin / Student | Authenticated | Fetch/update notification settings & prefs | Authorized read/write | Blocked by missing rules in `firestore.rules` | ❌ FAIL | SEC-03 |
| **School Contact Settings** | Admin / Student | Authenticated | Fetch/update school contact info | Authorized read/write | Blocked by missing rules in `firestore.rules` | ❌ FAIL | SEC-03 |
| **Notice Creation Broadcast** | Student | Authenticated | Inject notice into `/notifications` | Blocked to Admin/HOD | Permitted by `allow create: if isSignedIn()` | ❌ FAIL | SEC-04 |
| **Fee Concession Approval** | Accountant / Admin | Assignment exists | Admin approves discount > ₹5,000 | Concession approved; ledger updated | Crashes with `ReferenceError: syncAssignmentTerms` | ❌ FAIL | BUG-0001 |
| **Student Promotion Workflow** | Admin | Active enrollment | Promote student to next academic year | Student promoted; grade updated | New enrollment created; `student.grade` unchanged | ❌ FAIL | BUG-0002 |
| **Student Admission Enrollment** | Admin | Session loaded | Submit new admission record | Application generated | Crashes if session null (`getAcademicSession`) | ❌ FAIL | BUG-0003 |
| **Parent Portal Login** | Parent | Authenticated | Access child's fees and report cards | Parent views linked student records | Sidebar empty; all routes redirect to `/` | ❌ FAIL | BUG-0004 |
| **Annual Report Card Generation** | Class Teacher | Draft status | Sequential sign on ungenerated card | Aggregates whole-year marks | Creates empty stub lacking scholastic results | ❌ FAIL | BUG-0005 |
| **Student Web Report Card View** | Student | Published card | Student views scorecard | Displays component marks & totals | Displays `—` (dash) due to interface mismatch | ❌ FAIL | BUG-0006 |
| **Student Exam Results View** | Student | Published results | Student views subject scorecard | Dynamic maxMarks and session grade | Displays fallback 100 maxMarks and Grade 5 | ❌ FAIL | BUG-0007 |
| **HOD Result Verification** | HOD / Admin | Marks entered | HOD reviews subject marks | Dynamic maxMarks from structure | Displays 100 maxMarks for all modular exams | ❌ FAIL | BUG-0008 |
| **Dynamic Exam Discovery** | Teacher | Active structure | Teacher opens Marks Entry | Loads dynamic exams from Planner | Loads dynamic exams correctly | ✅ PASS | REQ-09 |
| **Marks Entry Validation** | Teacher | Exam concluded | Enter negative marks or marks > max | Rejected with clear error | Correctly rejected | ✅ PASS | REQ-14, 15 |
| **Absent / Exempt Marks Handling** | Teacher | Marks Entry | Student marked absent / exempt | Absent = 0 marks; Exempt = passed | Handled correctly (`AB` / `EX`) | ✅ PASS | REQ-12, 13 |
| **Exam Results Publication Gate** | HOD | Incomplete marks | Publish exam results | Blocked until all subjects complete | Blocked correctly; verified required | ✅ PASS | REQ-19 |
| **Term-Wise Discipline Grading** | Class Teacher | Pending Details | Input discipline grade `A`-`D` | Strictly `A`, `B`, `C`, `D` accepted | Numbers & invalid letters rejected | ✅ PASS | REQ-25-30 |
| **Sequential E-Signatures** | Teacher, HOD, Admin | Annual card | Step 1 -> Step 2 -> Step 3 | Enforces sequential stages | Validates stage order & snapshots | ✅ PASS | REQ-33-35 |
| **Hall Ticket Fee Gate** | Student | Fees pending | Generate hall ticket | Blocked if dues outstanding | Correctly blocks unverified dues | ✅ PASS | SEC-04 |
| **Payment Gateway Idempotency** | Webhook / Student | Gateway callback | Duplicate payment payload | Single ledger & payment record | Idempotently verified via HMAC | ✅ PASS | SEC-03, 07 |
| **R2 Storage Gateway Security** | Student / Staff | File download | Download student document | Path traversal blocked; RBAC enforced | Path traversal rejected; RBAC validated | ✅ PASS | SEC-08 |

---

## D. BUG REGISTER

| Bug ID | Severity | Module | Component / File | Title | Confidence | Status |
|:---|:---:|:---|:---|:---|:---:|:---:|
| **BUG-0001** | CRITICAL | Accounts / Fees | `src/lib/feeAssignments.ts:427` | Scoping defect causes fatal `ReferenceError: syncAssignmentTerms` on concession approval | Confirmed | Open |
| **BUG-0002** | HIGH | Student Admin | `src/lib/enrollments.ts:582-618` | Student promotion fails to update `students/{studentId}` grade and section | Confirmed | Open |
| **BUG-0003** | HIGH | Admissions | `src/pages/admin/Admissions.tsx:468` | Undefined reference `getAcademicSession()` causes unhandled crash during admission submission | Confirmed | Open |
| **BUG-0004** | HIGH | Role Management | `src/App.tsx`, `src/components/Layout.tsx` | Parent/Guardian role lacks all frontend routes and sidebar navigation | Confirmed | Open |
| **BUG-0005** | HIGH | Academic Results | `src/lib/resultEngine.ts:1739-1816` | Sequential signing on ungenerated report card creates empty snapshot lacking marks | Confirmed | Open |
| **BUG-0006** | MEDIUM | Student Portal | `src/pages/student/ReportCard.tsx:369` | Student web report card renders all components as dashes due to property name mismatch | Confirmed | Open |
| **BUG-0007** | MEDIUM | Student Portal | `src/pages/student/Results.tsx:117, 373` | Student results view queries non-existent `Enrollment.grade` and displays fallback 100 maxMarks | Confirmed | Open |
| **BUG-0008** | MEDIUM | Results Engine | `src/pages/admin/ResultVerification.tsx:490` | Result verification displays hardcoded 100 maxMarks for modular exams | Confirmed | Open |
| **BUG-0009** | LOW | Testing Suite | `scripts/test_user_linked_esign.ts:464` | Outdated assertion in legacy e-sign test expects report card logic in `ResultVerification.tsx` | Confirmed | Open |
| **DATA-0001** | MEDIUM | Data Models | `src/lib/types.ts` vs `src/lib/feeAssignments.ts` | Conflicting and duplicate `StudentFeeAssignment` TypeScript interfaces | Confirmed | Open |
| **INTEG-0001** | MEDIUM | Attendance | `backend/server.py:384-413` | Backend RFID scan processor lacks employee / staff attendance pipeline | Confirmed | Open |

---

## E. SECURITY FINDINGS

### SEC-01: Completely Unauthenticated FastAPI Backend Endpoints
- **Severity:** CRITICAL
- **CVSS v3.1 Score:** 9.8 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H)
- **Vulnerability Class:** CWE-306: Missing Authentication for Critical Function
- **Affected File:** `backend/server.py:372-562`
- **Affected Endpoints:**
  - `POST /api/rfid-scan`
  - `POST /api/rfid-cards`
  - `DELETE /api/rfid-cards/{uid}`
  - `GET /api/rfid-cards`
  - `GET /api/attendance`
  - `GET /api/attendance/today-count`
- **Preconditions:** Backend server running and reachable over HTTP.
- **Vulnerability Analysis:**  
  The endpoints take inputs directly from HTTP request bodies and URL parameters without validating a Firebase ID token, an API key, or a registered device secret.
- **Reproduction Procedure:**
  1. Send an unauthenticated HTTP GET request: `curl http://localhost:8000/api/rfid-cards`  
     *Result:* Receives full list of assigned RFID card UIDs, student IDs, student names, grades, and section IDs.
  2. Send an unauthenticated HTTP POST request:
     ```bash
     curl -X POST http://localhost:8000/api/rfid-scan \
          -H "Content-Type: application/json" \
          -d '{"uid": "04a1b2c3d4", "deviceId": "GATE_01"}'
     ```
     *Result:* System records "present" attendance in Firestore for whichever student is linked to `04a1b2c3d4`.
- **Impact:** Complete compromise of attendance records, unauthorized student tracking, and enumeration of student personally identifiable information (PII).
- **Remediation:** Implement Firebase Admin Auth token verification middleware for administrative and query routes (`/api/rfid-cards`, `/api/attendance`). For `/api/rfid-scan`, require a cryptographically signed HMAC token or pre-shared device secret (`X-Device-Secret`) registered in Firestore.

---

### SEC-02: Firebase Storage Rules Grant Write Access to Any Authenticated User
- **Severity:** HIGH
- **CVSS v3.1 Score:** 8.1 (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:H)
- **Vulnerability Class:** CWE-285: Improper Authorization
- **Affected File:** `storage.rules:19-34`
- **Vulnerability Analysis:**  
  Lines 19-22:
  ```rules
  match /signatures/{fileName} {
    allow read: if request.auth != null;
    allow write: if request.auth != null && request.resource.size < 2 * 1024 * 1024 && request.resource.contentType.matches('image/.*');
  }
  ```
  Lines 31-34:
  ```rules
  match /{allPaths=**} {
    allow read: if request.auth != null;
    allow write: if request.auth != null && request.resource.size < 15 * 1024 * 1024;
  }
  ```
  The rule checks only `request.auth != null`. Any valid Firebase Auth session (such as a student or parent account) is permitted to upload, replace, or delete files under `/signatures/` and across all unmapped storage buckets.
- **Impact:** A student can overwrite the official Principal signature or seal image with arbitrary artwork, resulting in forged or defaced official documents, hall tickets, and report cards.
- **Remediation:** Restrict write permissions on `/signatures/{fileName}` exclusively to administrative users or enforce that `fileName` begins with `request.auth.uid`. Remove the permissive wildcard `match /{allPaths=**}` rule and adopt an explicit whitelist model.

---

### SEC-03: Missing Firestore Rules for Notification & School Contact Collections
- **Severity:** HIGH
- **CVSS v3.1 Score:** 7.5 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
- **Vulnerability Class:** CWE-276: Incorrect Default Permissions (Deny-All Availability Defect)
- **Affected File:** `firestore.rules`
- **Vulnerability Analysis:**  
  The centralized notification system and student contact features interact with the following collections via the Firebase Web Client SDK:
  `schoolContact`, `notificationJobs`, `notificationLogs`, `notificationTemplates`, `notificationSettings`, `notificationPreferences`, `deviceTokens`, `whatsappConsents`.
  Because these collections lack explicit match statements in `firestore.rules`, all client SDK reads and writes are blocked by Firestore's root deny policy.
- **Impact:**
  - Students cannot read official school contact information on `/student/contact`.
  - Admins cannot save school contact settings on `/admin/settings/contact`.
  - Client-side FCM token registration (`registerDeviceToken`) fails with permission errors.
  - Notification preference management is rendered non-functional.
- **Remediation:** Add explicit, least-privilege security rules for each missing collection in `firestore.rules`.

---

### SEC-04: Unrestricted Client Creation of Broadcast Notifications
- **Severity:** HIGH
- **CVSS v3.1 Score:** 7.1 (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N)
- **Vulnerability Class:** CWE-269: Improper Privilege Management
- **Affected File:** `firestore.rules:407`
- **Vulnerability Analysis:**  
  ```rules
  match /notifications/{notifId} {
    allow create: if isSignedIn();
  }
  ```
  Any signed-in user can write a document to `/notifications/` with `audienceType: "all"` or `audienceType: "students"`. Furthermore, setting `type: "missing_marks"` triggers the `sendNotificationEmail` Cloud Function, allowing students to dispatch spoofed emails to teachers.
- **Impact:** Phishing, spam dissemination, and spoofing of institutional academic notices.
- **Remediation:** Restrict `allow create` on `notifications` to `isAdmin() || isStaff()`, or constrain regular user notifications strictly to support tickets directed to admin recipients.

---

### SEC-05: Permissive CORS Configuration in Backend
- **Severity:** MEDIUM
- **CVSS v3.1 Score:** 6.5 (CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N)
- **Vulnerability Class:** CWE-942: Permissive Cross-Origin Resource Sharing Policy
- **Affected File:** `backend/.env:1` & `backend/server.py:575`
- **Vulnerability Analysis:**  
  `backend/.env` defines `CORS_ORIGINS=*`, and `backend/server.py` enables `allow_credentials=True` with wildcard origins.
- **Impact:** Malicious web pages visited by school staff can execute cross-origin requests against the local or hosted backend service.
- **Remediation:** Set `CORS_ORIGINS` to explicit production domain origins (e.g. `https://erp.prestigeschool.edu`).

---

### SEC-06: Known Vulnerabilities in Third-Party NPM Dependencies
- **Severity:** MEDIUM
- **Vulnerability Class:** CWE-1395: Dependency on Vulnerable Third-Party Component
- **Affected Manifest:** `package.json`
- **Summary:** `npm audit` identifies 15 vulnerabilities across transitive and direct dependencies:
  - 1 Critical: `websocket-driver <= 0.7.4` (Resource limit bypass & message corruption).
  - 7 High: `nanoid <= 3.3.17`, `browserslist <= 4.28.6`, `protobufjs <= 7.6.4`, `postcss <= 8.5.22`, `source-map-js`, `vite <= 6.4.2`, `@grpc/grpc-js <= 1.13.5`.
  - 6 Moderate, 1 Low.
- **Remediation:** Execute targeted updates via `npm audit fix` and upgrade build dependencies to patched releases.

---

## F. ACADEMIC WORKFLOW FINDINGS

### 1. Scoping Defect in Fee Concessions (`BUG-0001`)
- **Location:** `src/lib/feeAssignments.ts:427, 543, 660`
- **Root Cause:** Helper function `syncAssignmentTerms` was mistakenly authored inside the closure of `addConcession`.
- **Runtime Error:** `ReferenceError: syncAssignmentTerms is not defined at approveConcession`
- **Workflow Impact:** Blocks all administrative fee concession approvals and concession removals.
- **Remediation:** Move `syncAssignmentTerms` to module-level scope in `src/lib/feeAssignments.ts`.

### 2. Student Promotion Grade Desynchronization (`BUG-0002`)
- **Location:** `src/lib/enrollments.ts:582-618`
- **Root Cause:** `promoteEnrollment` creates a new active enrollment record with `className: input.targetClassName`, but fails to update `students/{studentId}` fields `grade` and `sectionId`.
- **Workflow Impact:** Downstream queries that read `student.grade` retrieve stale academic grades.
- **Remediation:** Include `batch.update(doc(db, "students", input.studentId), { grade: input.targetClassName, sectionId: input.targetSectionId, updatedAt: new Date().toISOString() })` inside the promotion batch.

### 3. Admissions Session Reference Failure (`BUG-0003`)
- **Location:** `src/pages/admin/Admissions.tsx:468`
- **Root Cause:** `getAcademicSession()` is invoked without import or definition when `workingSession` is undefined.
- **Runtime Error:** `ReferenceError: getAcademicSession is not defined`
- **Remediation:** Import `getActiveAcademicSession` or fallback cleanly to a standard session string.

### 4. Sequential E-Signatures on Ungenerated Report Cards (`BUG-0005`)
- **Location:** `src/lib/resultEngine.ts:1739-1816`
- **Root Cause:** `signReportCardSequential` executes `setDoc(cardRef, updatePayload, { merge: true })` on non-existent report card documents without computing `scholasticResults`, `grandTotal`, etc.
- **Workflow Impact:** Produces incomplete report card records that fail to display marks or generate valid PDFs.
- **Remediation:** Require report card calculation prior to signing, or invoke the whole-year aggregation engine inside `signReportCardSequential` when initializing a new snapshot.

### 5. Web Report Card UI Property Mismatch (`BUG-0006`)
- **Location:** `src/pages/student/ReportCard.tsx:369, 377, 381, 389`
- **Root Cause:** Looks for `sub.term1?.components` and `sub.term1?.scaledTotal` instead of `sub.term1?.componentScores` and `sub.term1?.totalMarks`.
- **Workflow Impact:** Renders all component marks and scaled totals as `—` (dash) on the student portal web scorecard.
- **Remediation:** Update property accessors to match `TermSubjectPerformance` interface definitions.

---

## G. FINANCIAL AND ATTENDANCE FINDINGS

### 1. Dual Incompatible `StudentFeeAssignment` Interfaces (`DATA-0001`)
- **Location:** `src/lib/types.ts:98` vs `src/lib/feeAssignments.ts:63`
- **Root Cause:** `types.ts` defines `id: string`, whereas `feeAssignments.ts` defines `id?: string`.
- **Diagnostic Evidence:** TypeScript error `TS2345: Argument of type 'StudentFeeAssignment | null' is not assignable to parameter of type 'SetStateAction<StudentFeeAssignment | null>'`.
- **Remediation:** Consolidate `StudentFeeAssignment` into a single authoritative definition in `src/lib/types.ts`.

### 2. Missing Employee Attendance Support in Backend (`INTEG-0001`)
- **Location:** `backend/server.py:384-413`
- **Root Cause:** The RFID scan endpoint explicitly asserts `student_id = card.get("studentId")` and aborts if empty.
- **Workflow Impact:** Faculty and staff RFID scans cannot be registered.
- **Remediation:** Add support for `employeeId` / `staffId` resolution and separate employee attendance logging.

---

## H. NOTIFICATION FINDINGS

### 1. Missing Rules for Notification Queue & Logs
- **Impact:** Frontend cannot query notification logs or retry failed jobs directly.
- **Remediation:** Add Firestore rules permitting Admin read/write to `notificationJobs`, `notificationLogs`, `notificationTemplates`, and `notificationSettings`.

### 2. Unconfigured Channel Graceful Degradation
- **Assessment:** When WhatsApp or Email credentials are not configured, `functions/notifications/providers/` safely return descriptive errors without crashing the Cloud Functions runtime.
- **Status:** Verified and passing in `scripts/test_notification_system.ts`.

---

## I. UI/UX AND ACCESSIBILITY FINDINGS

### 1. Complete Absence of Parent/Guardian Role Routes (`BUG-0004`)
- **Location:** `src/App.tsx`, `src/components/Layout.tsx`
- **Impact:** Logged-in parents have no accessible views or navigation.
- **Remediation:** Add dedicated parent routes (e.g. `/parent/student-fees`, `/parent/report-card`) and wire them into `Layout.tsx`.

### 2. Result Verification Hardcoded 100 Max Marks (`BUG-0008`)
- **Location:** `src/pages/admin/ResultVerification.tsx:490`
- **Impact:** HODs observe misleading 100 maxMarks for 40-mark modular assessments.
- **Remediation:** Fetch the effective maxMarks from the active `AcademicStructureVersion` assessment components.

---

## J. PERFORMANCE AND COMPILER AUDIT

### 1. Vite Build Bypassing TypeScript Compiler (`tsc`)
- **Finding:** `npm run build` succeeds cleanly in 16 seconds because `vite build` uses esbuild to strip types without validation.
- **Evidence:** Executing `npx tsc --noEmit` uncovered **28 critical type errors** across 14 files, including runtime reference errors (`getAcademicSession`, `syncAssignmentTerms`).
- **Remediation:** Add `tsc --noEmit && vite build` to the `build` script in `package.json` to prevent type regressions from reaching production builds.

---

## K. TEST RESULTS SUMMARY

| Test Script | Description | Total Assertions | Passed | Failed | Status |
|:---|:---|:---:|:---:|:---:|:---:|
| `scripts/run_erp_qa_suite.ts` | 45-point comprehensive ERP QA suite | 45 | 45 | 0 | ✅ PASS |
| `scripts/test_production_security.ts` | Production security & fee ledger isolation | 23 | 23 | 0 | ✅ PASS |
| `scripts/test_user_linked_esign.ts` | E-signature permission matrix & snapshots | 57 | 56 | 1 | ⚠️ 1 FAIL |
| `scripts/test_hall_ticket_esign.ts` | Single principal signature on hall tickets | 28 | 28 | 0 | ✅ PASS |
| `scripts/test_fee_structure_term_hierarchy.ts` | Fee terms, installments & concessions | 48 | 48 | 0 | ✅ PASS |
| `scripts/test_optional_razorpay_flow.ts` | Gateway status degradation & HMAC checks | 29 | 29 | 0 | ✅ PASS |
| `scripts/test_password_security.ts` | Elimination of plaintext passwords | 32 | 32 | 0 | ✅ PASS |
| `scripts/test_storage_stabilization.ts` | Storage classification & Base64 limits | 54 | 54 | 0 | ✅ PASS |
| `scripts/test_student_contact_section.ts` | Contact settings validation & rules | 57 | 56 | 1 | ⚠️ 1 FAIL |
| `scripts/test_student_library.ts` | Library book borrowing & fine calculations | 29 | 29 | 0 | ✅ PASS |
| `scripts/test_notification_system.ts` | Centralized notification engine | 71 | 64 | 7 | ⚠️ 7 FAIL |
| `scripts/test_academic_structure_marks_entry.ts` | Dynamic marks entry from structure planner | 35 | 35 | 0 | ✅ PASS |
| **TOTALS** | **Comprehensive Automated Verification** | **508** | **499** | **9** | **98.2% Pass** |

---

## L. FINDINGS REGISTER

| Finding ID | Severity | Module | Title | Reproduced? | Verification Status |
|:---|:---:|:---|:---|:---:|:---:|
| **SEC-01** | CRITICAL | Backend | Unauthenticated FastAPI backend endpoints | Yes | Confirmed Vulnerability |
| **SEC-02** | HIGH | Storage | Permissive Firebase Storage rules allow signature overwrite | Yes | Confirmed Vulnerability |
| **SEC-03** | HIGH | Firestore | Missing rules for notification & schoolContact collections | Yes | Confirmed Vulnerability |
| **SEC-04** | HIGH | Notifications | Unrestricted client creation of broadcast notifications | Yes | Confirmed Vulnerability |
| **SEC-05** | MEDIUM | Backend | Permissive CORS wildcard configuration | Yes | Confirmed Vulnerability |
| **SEC-06** | MEDIUM | Dependencies | 15 known vulnerabilities in third-party NPM packages | Yes | Confirmed Vulnerability |
| **BUG-0001** | CRITICAL | Accounts | Scoping defect crashes concession approval workflow | Yes | Confirmed Defect |
| **BUG-0002** | HIGH | Student Admin | Student promotion fails to update `students` collection grade | Yes | Confirmed Defect |
| **BUG-0003** | HIGH | Admissions | Undefined `getAcademicSession()` crashes admission submission | Yes | Confirmed Defect |
| **BUG-0004** | HIGH | Layout / Nav | Parent role completely lacks frontend routes & navigation | Yes | Confirmed Defect |
| **BUG-0005** | HIGH | Academic Results | Sequential signing on ungenerated report card creates empty card | Yes | Confirmed Defect |
| **BUG-0006** | MEDIUM | Student Portal | Student web report card renders dashes for components | Yes | Confirmed Defect |
| **BUG-0007** | MEDIUM | Student Portal | Student results view queries non-existent `Enrollment.grade` | Yes | Confirmed Defect |
| **BUG-0008** | MEDIUM | Results Engine | Result verification displays hardcoded 100 maxMarks | Yes | Confirmed Defect |
| **BUG-0009** | LOW | QA Tests | Outdated assertion in legacy e-sign test suite | Yes | Confirmed Defect |
| **DATA-0001** | MEDIUM | Data Models | Conflicting `StudentFeeAssignment` TypeScript interfaces | Yes | Confirmed Defect |
| **INTEG-0001**| MEDIUM | Attendance | Backend RFID scan engine lacks employee attendance support | Yes | Confirmed Limitation |

---

## M. EVIDENCE AND REPRODUCTION DETAILS

### 1. Reproduction of BUG-0001 (Concession Approval Crash)
- **Precondition:** An accountant submits a fee concession $> ₹5,000$, transitioning its status to `pending_approval`.
- **Action:** An administrator clicks "Approve Concession" in the Accounts Concessions UI, invoking `approveConcession(assignmentId, concessionId, actor)`.
- **Code Trace:** In `src/lib/feeAssignments.ts`:
  Line 543 calls `syncAssignmentTerms(assignment.terms, updatedInstallments)`.
  However, `syncAssignmentTerms` was declared at line 427 *inside* `addConcession`.
- **Outcome:** JavaScript runtime throws `Uncaught (in promise) ReferenceError: syncAssignmentTerms is not defined`, aborting the database write.

### 2. Reproduction of BUG-0003 (Admissions Crash)
- **Precondition:** Administrator attempts to admit a student when `workingSession` is not actively populated in context.
- **Code Trace:** In `src/pages/admin/Admissions.tsx:468`:
  `const activeYear = workingSession?.name || activeSess?.name || getAcademicSession();`
- **Outcome:** JavaScript runtime throws `ReferenceError: getAcademicSession is not defined`.

### 3. Reproduction of SEC-01 (Backend Attendance Forgery)
- **Precondition:** Backend server running on port 8000.
- **Action:** An attacker sends an HTTP POST to `/api/rfid-scan` with an arbitrary student's card UID.
- **Outcome:** The server responds with `{"success": true, "message": "Attendance marked"}` and writes a verified attendance record to Firestore without any credential check.

---

## N. REMEDIATION ROADMAP

### Phase P0: Critical Security & Crash Remediation (Immediate Blockers)
1. **Remediate SEC-01:** Implement authentication middleware on FastAPI backend (`backend/server.py`). Require a shared secret header (`X-Device-Secret`) for RFID scanners and Firebase Auth Bearer tokens for card management and queries.
2. **Remediate SEC-02:** Overhaul `storage.rules`. Restrict `/signatures/{fileName}` writes to `request.auth.uid == fileName.split('.')[0]` or admin roles. Delete the permissive wildcard write rule.
3. **Remediate BUG-0001:** Lift `syncAssignmentTerms` to module scope in `src/lib/feeAssignments.ts`.
4. **Remediate BUG-0003:** Correct line 468 in `src/pages/admin/Admissions.tsx` to safely fallback without invoking undefined functions.

### Phase P1: High-Severity Workflow & Security Fixes
1. **Remediate SEC-03:** Add missing security rules in `firestore.rules` for `schoolContact`, `notificationJobs`, `notificationLogs`, `notificationTemplates`, `notificationSettings`, `notificationPreferences`, `deviceTokens`, and `whatsappConsents`.
2. **Remediate SEC-04:** Restrict `/notifications` document creation in `firestore.rules` to authorized staff and admin roles.
3. **Remediate BUG-0002:** Update `promoteEnrollment` in `src/lib/enrollments.ts` to update `students/{studentId}` grade and section alongside new enrollments.
4. **Remediate BUG-0004:** Implement parent role routing in `src/App.tsx` and parent navigation entries in `src/components/Layout.tsx`.
5. **Remediate BUG-0005:** Ensure `signReportCardSequential` verifies that whole-year academic calculation is finalized before signing a report card snapshot.

### Phase P2: Medium-Severity Functional & Data Integrity Fixes
1. **Remediate BUG-0006:** Fix property accessors in `src/pages/student/ReportCard.tsx` (`componentScores` and `totalMarks`).
2. **Remediate BUG-0007 & BUG-0008:** Pass dynamic `maxMarks` from Academic Structure to `ResultVerification.tsx` and `Results.tsx`; resolve `className` on `Enrollment`.
3. **Remediate DATA-0001:** Unify duplicate `StudentFeeAssignment` interfaces in `src/lib/types.ts`.
4. **Remediate SEC-05:** Configure explicit CORS allowed origins in `backend/.env`.
5. **Remediate SEC-06:** Execute `npm audit fix` to resolve vulnerable NPM dependencies.

### Phase P3: Maintainability & Test Improvements
1. **Update `package.json` Build Script:** Change `"build": "vite build"` to `"build": "tsc --noEmit && vite build"` to catch compiler errors during CI/CD.
2. **Update Legacy QA Assertion (`BUG-0009`):** Update `scripts/test_user_linked_esign.ts` to inspect `AnnualReportCards.tsx` instead of `ResultVerification.tsx`.

---

## O. PRODUCTION RELEASE DECISION

### Decision: `BLOCK RELEASE`

### Justification:
1. **Unauthenticated Critical Backend Endpoints (`SEC-01`):** Anyone on the network can mark student attendance and enumerate student records without logging in.
2. **Storage Rule Privilege Escalation (`SEC-02`):** Any student account can overwrite official school signatures and seals.
3. **Core Accounting Workflow Crash (`BUG-0001`):** Concession approval throws an unhandled reference error.
4. **Missing Parent Role UI (`BUG-0004`):** Parent users have no functional interface in the system.
5. **Silent Type Errors:** 28 TypeScript compiler errors exist across 14 core files, masked by Vite's un-typechecked build.

The ERP exhibits excellent dynamic academic structure planning, robust cryptographic payment verification, and accurate marks calculation logic. However, production deployment must be withheld until the P0 and P1 security and workflow remediations detailed above are implemented and verified.

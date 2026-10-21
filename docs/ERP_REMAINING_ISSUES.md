# PRESTIGE INTERNATIONAL SCHOOL ERP
## Outstanding Issues, Production Blockers & Operational Status

**Document Identifier:** DOCS-PROD-2026-10-21  
**Target Repository:** `school-erp_backend` (`main`)  
**Scope:** Production Readiness Blockers, Security/Privacy Rules, Cloud Infrastructure, Academic Workflows & Deployment Status  
**Status:** Production Readiness Sprint Complete (All Code & Security Blockers Resolved & Verified; Cloudflare R2 Cloud Setup Cataloged)

---

## 1. Executive Summary

During the production readiness remediation sprint on the active project (`prestige-erp`), all five identified critical production blockers and git hygiene requirements were addressed:

1. **Worker Firebase Project Configuration:** Updated `worker/wrangler.toml` and `worker/src/auth.ts` to strictly validate against the active project `prestige-erp`. Hardcoded fallbacks to legacy project `schoolerpv2` were completely removed.
2. **Object Storage & Cloudflare Worker URL:** Inspected Cloudflare deployment state for account `anasmukka@gmail.com`. The Cloudflare Worker and R2 bucket are not yet provisioned on Cloudflare because the R2 feature has not been enabled on the Cloudflare dashboard for this account. Zero-egress direct R2 storage architecture has been preserved without fabricating fake hostnames or opening unauthenticated fallbacks. Exact deployment prerequisite steps are cataloged below.
3. **Firestore Student Privacy Rules:** Re-authored and deployed least-privilege student document rules in `firestore.rules`. Signed-in students can now only access their own student records, and parents can only access records of their explicitly linked children. Bulk enumeration and cross-student PII inspection are strictly blocked. Rules were deployed live to `prestige-erp` and verified.
4. **Audit Data Sanitization:** Hardened `sanitizeAuditData` in `src/lib/audit.ts` to recursively strip `undefined` object properties and array elements, preventing Firestore document write rejections while preserving valid nulls, nested structures, and credentials redactions. Updated audit callers in `src/lib/resultEngine.ts`.
5. **Firestore Composite Indexes:** Deployed all 11 required composite indexes in `firestore.indexes.json` directly to the active project `prestige-erp` using the Firebase CLI. Verified live index status on `prestige-erp`.
6. **Git & Environment Hygiene:** Untracked `.env` and `dist/` from Git repository index, updated `.gitignore` to ignore `.env*`, `dist/`, and `.wrangler/`, and added a clean, safe template `.env.example`.

---

## 2. Production Blockers Status Matrix

| Blocker ID | Area | Issue Description | Status | Verification & Resolution Details |
|:---|:---|:---|:---:|:---|
| **PROD-01** | Cloudflare Worker Auth | Worker used legacy project ID `schoolerpv2` instead of `prestige-erp` | **Fixed and verified** | Updated `worker/wrangler.toml` (`[vars]` and `[env.development.vars]`) and `worker/src/auth.ts` (`verifyFirebaseToken` and `resolveErpUser`) to use `prestige-erp`. Verified via `scripts/test_cloudflare_migration.ts` (49/49 passed) and `tsc --noEmit` (0 errors). |
| **PROD-02** | Object Storage & Worker | `VITE_WORKER_URL` missing; Cloudflare Worker & R2 bucket not yet provisioned | **Blocked by deployment or configuration** | Cloudflare account `anasmukka@gmail.com` requires enabling R2 subscription via the Cloudflare Dashboard before `wrangler deploy` can create the bucket and deploy the worker. Storage architecture preserved; insecure fallbacks rejected. Deployment steps detailed in Section 3.2. |
| **PROD-03** | Firestore Security Rules | Authenticated students and parents could query entire `/students` collection and leak PII | **Fixed and verified** | Delegated rule authoring to `firestore-rules-author`. Replaced broad read permissions on `/students/{studentId}` with least-privilege checks: Admin, Staff, Operations (excluding Printing Dept); Students restricted to matching Auth UID / student UID / email mappings; Parents restricted to `linkedStudentUids`. Deployed live to `prestige-erp` and verified with 32 test assertions in `scripts/test_student_privacy_and_audit_sanitization.ts`. |
| **PROD-04** | Audit Logging | `sanitizeAuditData` allowed `undefined` values, causing Firestore `addDoc` rejections | **Fixed and verified** | Hardened `sanitizeAuditData` in `src/lib/audit.ts` to recursively omit `undefined` keys and array elements while preserving nulls, valid values, and sensitive data redactions. Updated `resultEngine.ts` to pass `null` instead of `undefined`. Verified with 32 assertions in `test_student_privacy_and_audit_sanitization.ts` and 35 assertions in `test_academic_structure_marks_entry.ts`. |
| **PROD-05** | Firestore Database | Required composite indexes were not deployed to `prestige-erp` | **Fixed and verified** | Deployed all 11 composite indexes from `firestore.indexes.json` using `npx firebase-tools deploy --only firestore:indexes --project prestige-erp`. Remote query to `prestige-erp` confirms all 11 indexes are active for `attendance`, `enrollments`, `assignmentsActivities`, `feeLedgerEntries`, `feePayments`, and `studentFeeAssignments`. |
| **PROD-06** | Git & Secret Hygiene | `.env` and `dist/` were tracked in Git repository index | **Fixed and verified** | Removed `.env` and `dist/` from Git tracking (`git rm --cached`). Updated `.gitignore` to exclude `.env*`, `dist/`, and `.wrangler/`. Created `.env.example` with documented environment variable keys and placeholders. Local files remain intact. |

---

## 3. Detailed Resolution & Verification Breakdown

### 3.1 PROD-01: Worker Firebase Project ID Alignment
- **Problem:** `worker/wrangler.toml` specified `FIREBASE_PROJECT_ID = "schoolerpv2"` and `worker/src/auth.ts` had `"schoolerpv2"` hardcoded as default fallback in `verifyFirebaseToken` and `resolveErpUser`. The active Firebase project is `prestige-erp`.
- **Changes Applied:**
  - `worker/wrangler.toml`: Set `FIREBASE_PROJECT_ID = "prestige-erp"` in both production `[vars]` and development `[env.development.vars]`.
  - `worker/src/auth.ts`: Updated `env.FIREBASE_PROJECT_ID || "prestige-erp"` in `verifyFirebaseToken` and `resolveErpUser`.
- **Verification:**
  - `worker/tsc --noEmit` passed with 0 errors.
  - `scripts/test_cloudflare_migration.ts` passed 49/49 assertions.

### 3.2 PROD-02: Object Storage & Cloudflare Worker Deployment
- **Status:** **Blocked by deployment or configuration** (Requires Cloudflare Dashboard Action).
- **Inspection Findings:**
  - Wrangler CLI is authenticated under user `anasmukka@gmail.com` (Account ID `813ff76f013659451929327f6bdcfbee`).
  - Worker `school-erp-worker` has not yet been deployed to this account (`Error 10007: This Worker does not exist on your account`).
  - Cloudflare R2 is not yet activated on the account (`Error 10042: Please enable R2 through the Cloudflare Dashboard`).
- **Policy Enforcement:**
  - In accordance with audit requirements, no fictitious worker URLs (such as `*.workers.dev`) were invented.
  - Insecure storage fallbacks that bypass authorization rules were NOT enabled.
- **Exact Action Steps to Complete Worker & R2 Deployment:**
  1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) and navigate to **R2 Object Storage**.
  2. Click **Get Started** / **Enable R2** (R2 plan activation).
  3. Create the production and development R2 buckets via CLI:
     ```bash
     cd worker
     npx wrangler r2 bucket create school-erp-storage
     npx wrangler r2 bucket create school-erp-storage-dev
     ```
  4. Deploy the Cloudflare Worker:
     ```bash
     npx wrangler deploy
     ```
  5. Note the deployed Worker URL (e.g. `https://school-erp-worker.<subdomain>.workers.dev` or custom domain `https://api-storage.prestigeschool.com`).
  6. Add the URL to `.env`:
     ```env
     VITE_WORKER_URL="https://your-worker-subdomain.workers.dev"
     ```

### 3.3 PROD-03: Firestore Student Privacy Rules
- **Problem:** `match /students/{studentId}` in `firestore.rules` previously allowed `read: if isSignedIn() && !isPrintingDept();`. Any authenticated parent or student could read personal documents (DOB, parent phone numbers, home address, medical info) of all other students.
- **Changes Applied:**
  - Modified `firestore.rules` to enforce least-privilege document reads:
    - **Administrative & Staff Roles:** `isAdmin() || isStaff() || isOperations()` (printing department remains excluded).
    - **Student Self-Access:** Direct check on `studentId == request.auth.uid` or document fields `resource.data.uid`, `resource.data.authUid`, `resource.data.studentUid`, or user profile identity mappings (`studentUid`, `studentDocId`, `studentId`, `email` in `getUserData()`).
    - **Parent Access:** Restricted to children explicitly linked to the parent account via `getUserRole() == 'parent' && 'linkedStudentUids' in getUserData() && (...)`.
    - **Cross-school & Unrelated Access:** Blocked by default.
  - Deployed live:
    ```bash
    npx firebase-tools deploy --only firestore:rules --project prestige-erp
    ```
- **Verification:**
  - Automated test suite `scripts/test_student_privacy_and_audit_sanitization.ts` executed and passed 32/32 assertions, covering admin access, staff access, student own-record access, unauthorized student cross-access, parent linked-child access, unauthorized parent unlinked-child access, and printing department denial.

### 3.4 PROD-04: Audit Data Sanitization
- **Problem:** In Firestore SDK v9/v10, passing `undefined` as a field value inside a document or array throws `FirebaseError: Function addDoc() cannot be called with an undefined element`. When optional audit metadata was omitted, audit logging crashed.
- **Changes Applied:**
  - `src/lib/audit.ts`: Enhanced `sanitizeAuditData` to omit `undefined` object properties (`continue` on `value === undefined`) and filter `undefined` values from arrays (`.filter((item) => item !== undefined)`).
  - `src/lib/resultEngine.ts`: Replaced `cardData.workflowStatus || undefined` and `reason || undefined` with `|| null` in `invalidateReportCardSignaturesOnMarksChange` and `transitionMarksWorkflow`.
- **Verification:**
  - Verified with `scripts/test_student_privacy_and_audit_sanitization.ts` (sanitization assertions 100% passed).
  - Verified with `scripts/test_academic_structure_marks_entry.ts` (35/35 passed without any `undefined` write errors).

### 3.5 PROD-05: Firestore Composite Indexes
- **Problem:** `firestore.indexes.json` defined 11 composite indexes required for compound filtering and sorting (attendance, enrollments, activities, fee ledgers, payments), but the remote database reported `indexes: []`.
- **Changes Applied:**
  - Deployed index definitions directly to the active project:
    ```bash
    npx firebase-tools deploy --only firestore:indexes --project prestige-erp
    ```
- **Verification:**
  - Ran `npx firebase-tools firestore:indexes --project prestige-erp`.
  - Confirmed all 11 composite indexes are provisioned and active on `prestige-erp`:
    - `assignmentsActivities` (sectionId ASC, dueDate ASC)
    - `attendance` (sectionId ASC, date ASC)
    - `attendance` (studentId ASC, date ASC)
    - `enrollments` (sectionId ASC, status ASC, academicYear ASC)
    - `feeLedgerEntries` (studentId ASC, sessionId ASC, createdAt ASC)
    - `feePayments` (studentId ASC, paymentDate DESC)
    - `feePayments` (sessionId ASC, status ASC, paymentDate DESC)
    - `feePayments` (receiptNumber ASC, status ASC)
    - `studentFeeAssignments` (studentId ASC, sessionId ASC, status ASC)
    - `studentFeeAssignments` (sectionId ASC, sessionId ASC, status ASC)
    - `studentFeeAssignments` (feeStructureId ASC, status ASC)

### 3.6 PROD-06: Git & Environment-File Hygiene
- **Problem:** `.env` (containing local configuration) and `dist/` (build artifacts) were tracked in git index.
- **Changes Applied:**
  - `git rm --cached .env` and `git rm -r --cached dist/` removed them from the git tree while keeping files on disk.
  - `.gitignore` updated to ignore `.env`, `.env.local`, `.env.*.local`, `dist/`, and `.wrangler/`.
  - Created `.env.example` with clear, safe placeholders and instructions.
- **Verification:**
  - `git status` shows `.env` and `dist/` staged for deletion from index.
  - Neither `.env` nor build artifacts will be committed.

---

## 4. Outstanding Roadmap Enhancements (Non-Blockers)

| ID | Domain | Title | Severity | Status | Next Milestone |
|:---|:---|:---|:---:|:---:|:---|
| **NONSEC-01** | Academic Engine | Subject-Level Exemption Denominator Recomputation | Low | **Fixed & Verified** | Completed in previous sprint. |
| **NONSEC-02** | Marks Entry | Bulk CSV / Spreadsheet Import for Large Sections | Enhancement | Open (Roadmap) | Offline template upload planned for v1.2. |
| **NONSEC-03** | Marks Entry | Granular Audit Trail for Post-Submission Unlocking | Low | Open (Roadmap) | UI modal reason prompt planned for v1.1. |
| **NONSEC-04** | Report Cards | Client-Side PDF Generation Batching for Mobile Browsers | Medium | Open (Roadmap) | Sequential batching queue planned for v1.1. |
| **NONSEC-05** | Report Cards | Student Passport Photo Fallback in Generated PDFs | Low | Open (Roadmap) | Standard vector crest fallback planned for v1.1. |
| **NONSEC-06** | E-Signatures | Multi-Signatory Invalidation Hook on Marks Re-Entry | Low | **Fixed & Verified** | Completed in previous sprint. |
| **NONSEC-07** | Fees / Accounts | Automated Sibling Concession Detection | Enhancement | Open (Roadmap) | Sibling discount auto-detection planned for v1.2. |
| **NONSEC-08** | Fees / Accounts | Fine Calculation Grace Period for School Holidays | Low | Open (Roadmap) | Calendar holiday filter planned for v1.2. |
| **NONSEC-09** | Parent Portal | Multi-Child Sibling Switcher Tab State Invalidation | Low | Open (Roadmap) | Default overview reset planned for v1.1. |
| **NONSEC-10** | Document Gen | Transfer Certificate (TC) Counter & Serial Number Locks | Medium | Open (Roadmap) | Distributed lock planned for v1.1. |
| **NONSEC-11** | Deployment | Automated Firestore Composite Index Provisioning | Medium | **Fixed & Verified** | 100% deployed to `prestige-erp`. |
| **NONSEC-12** | Deployment | Environment Variable Validation at Startup | Low | Open (Roadmap) | Pre-flight console banner planned for v1.0. |

---

## 5. Comprehensive Verification Summary

| Suite | Scope | Total Tests | Passed | Failed | Status |
|:---|:---|:---:|:---:|:---:|:---|
| **Student Privacy & Audit Sanitization** | PROD-03 & PROD-04 | 32 | 32 | 0 | **100% PASS** |
| **Cloudflare Worker Migration & Auth** | PROD-01 & Worker Env | 49 | 49 | 0 | **100% PASS** |
| **Storage Architecture & Contracts** | PROD-02 Contracts | 54 | 54 | 0 | **100% PASS** |
| **Academic Marks & Audit Writes** | PROD-04 Audit & Marks | 35 | 35 | 0 | **100% PASS** |
| **TypeScript Compiler (`root tsc`)** | Full App Type Check | N/A | 0 Errors | 0 Errors | **CLEAN** |
| **TypeScript Compiler (`worker tsc`)** | Worker Type Check | N/A | 0 Errors | 0 Errors | **CLEAN** |
| **Production Build (`npm run build`)** | Vite Asset Bundler | N/A | Built in 8.73s | 0 Errors | **SUCCESS** |

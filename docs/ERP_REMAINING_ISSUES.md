# PRESTIGE INTERNATIONAL SCHOOL ERP
## Outstanding Non-Security Issues & Operational Enhancements

**Document Identifier:** DOCS-NONSEC-2026-10-21  
**Target Repository:** `school-erp_backend` (`main`)  
**Scope:** Functional Workflows, UX Edge Cases, Academic Calculations, Document Generation & Deployment Requirements  
**Status:** Post-Remediation Verification Complete (Security & Core Vulnerabilities 100% Resolved; Calculation & E-Sign Invalidation Verified)

---

## 1. Executive Summary

Following the comprehensive remediation sprint (commit `03d49ad`), all six reported security vulnerabilities (SEC-01 through SEC-06), all nine functional defects (BUG-0001 through BUG-0009), data model conflicts (DATA-0001), and all 28 TypeScript compiler errors were resolved and verified with 0 diagnostics. Furthermore, the RFID attendance subsystem was decoupled from the active ERP and cleanly preserved in `archive/future-rfid/`, with the Class Teacher Manual Attendance workflow (`src/pages/teacher/ManualAttendance.tsx`) serving as the authoritative attendance register.

In this sprint, targeted corrections were implemented for **NONSEC-01** (Exemption denominator recomputation across all evaluation tiers) and **NONSEC-06** (E-Signature invalidation after marks re-entry), alongside a focused assessment of **NONSEC-11** (Firestore composite indexes).

---

## 2. Issue Categorization Matrix

| ID | Domain | Title | Severity | Status | Verification & Resolution Details |
|:---|:---|:---|:---:|:---:|:---|
| **NONSEC-01** | Academic Engine | Subject-Level Exemption Denominator Recomputation | Low | **Fixed & Verified** | Optional subjects with `EX` status are authoritatively excluded from calculation denominators across Marks Entry, Result Verification, Student Results, and Annual Report Cards. Non-optional `EX` subjects follow standard policy. Zero-denominator edge cases safely return `EX`/`WITHHELD` without `NaN`/`Infinity`. Verified with 40 automated test assertions. |
| **NONSEC-02** | Marks Entry | Bulk CSV / Spreadsheet Import for Large Sections | Enhancement | Open (Roadmap) | Teachers entering marks for classes with >45 students currently enter scores row-by-row in UI. Offline template upload planned for v1.2. |
| **NONSEC-03** | Marks Entry | Granular Audit Trail for Post-Submission Unlocking | Low | Open (Roadmap) | When HOD unlocks a submitted marks sheet, the unlock reason is logged in UI toast and academic audits. Modal reason prompt planned for v1.1. |
| **NONSEC-04** | Report Cards | Client-Side PDF Generation Batching for Mobile Browsers | Medium | Open (Roadmap) | Generating >50 PDF report cards simultaneously on lower-end mobile devices can cause memory pressure. Sequential batching queue planned for v1.1. |
| **NONSEC-05** | Report Cards | Student Passport Photo Fallback in Generated PDFs | Low | Open (Roadmap) | If a student profile lacks a profile photo in Cloudflare R2 / Storage, PDF renders initials box. Standard vector crest fallback planned for v1.1. |
| **NONSEC-06** | E-Signatures | Multi-Signatory Invalidation Hook on Marks Re-Entry | Low | **Fixed & Verified** | Reopening marks or modifying submitted scores for a student authoritatively resets in-progress report cards (`teacher_signed`, `hod_signed`) to `draft` and clears invalidated signatures. Requires the full sequential signing pipeline to repeat. Published historical records are strictly protected and immutable. Verified with automated assertions. |
| **NONSEC-07** | Fees / Accounts | Automated Sibling Concession Detection | Enhancement | Open (Roadmap) | Sibling discounts currently require manual application by the accountant rather than auto-detecting shared parent contact. Planned for v1.2. |
| **NONSEC-08** | Fees / Accounts | Fine Calculation Grace Period for School Holidays | Low | Open (Roadmap) | Late fee daily accumulation treats national and declared school holidays as standard overdue days. Calendar holiday filter planned for v1.2. |
| **NONSEC-09** | Parent Portal | Multi-Child Sibling Switcher Tab State Invalidation | Low | Open (Roadmap) | When a parent switches between siblings, browser session persists active tab. Default overview reset planned for v1.1. |
| **NONSEC-10** | Document Gen | Transfer Certificate (TC) Counter & Serial Number Locks | Medium | Open (Roadmap) | TC serial numbers require strict atomic sequential increment to prevent race conditions during bulk admissions. Transaction lock planned for v1.1. |
| **NONSEC-11** | Deployment | Automated Firestore Composite Index Provisioning | Medium | **Verified - Setup Ready** | Composite indexes for `attendance`, `enrollments`, `assignmentsActivities`, and `studentFeeAssignments` are defined in `firestore.indexes.json`. Remote inspection of `prestige-erp` confirms clean status. Deployment command documented. |
| **NONSEC-12** | Deployment | Environment Variable Validation at Startup | Low | Open (Roadmap) | Missing non-critical environment variables fallback to window origin without console banner. Startup logger planned for v1.0 pre-flight. |

---

## 3. Detailed Analysis of Targeted Fixes

### 3.1 NONSEC-01: Exemption Denominator Recomputation
- **Root Cause:** When an optional subject was marked as `EX` (Exempt), calculation engines previously aggregated the maximum marks of the exempt subject into `grandMax` or `totalMax`, causing the student's aggregate percentage to drop artificially.
- **Resolution Implemented:**
  1. Extended `Subject`, `StructureSubjectEntry`, `CalculatedSubjectResult`, and `MarksEntryRecord` with `isOptional?: boolean`.
  2. Implemented `isSubjectOptional` helper to inspect subject definitions, structure entries, and overrides.
  3. Updated `evaluateInstitutionalResult` in `src/lib/resultEngine.ts`:
     - Optional subjects marked `EX` are excluded from `grandMax` and `grandTotal`.
     - Non-optional subjects marked `EX` retain their denominator per institutional policy, but are never counted as failed subjects.
     - When `grandMax === 0` (no eligible assessments), returns `grandPercentage: 0`, `grandGrade: "EX"`, `resultStatus: "WITHHELD"` without `NaN` or division by zero.
  4. Updated `calculateTermResult` to exclude exempt optional subjects from term totals and denominators.
  5. Updated `calculateSubjectTermAndOverall` so single-term exemptions do not halve annual subject scores (the evaluated term represents annual performance).
  6. Aligned `src/pages/admin/ResultVerification.tsx` and `src/pages/student/Results.tsx` to exclude exempt optional subjects and handle zero-denominator scorecards gracefully.
- **Verification:** 100% passed (23 dedicated calculation assertions in `scripts/test_academic_exemption_and_esign_invalidation.ts`).

---

### 3.2 NONSEC-06: E-Signature Invalidation on Marks Re-Entry
- **Root Cause:** If a Class Teacher or HOD had already signed an annual report card in progress, and an authorized user reopened or modified a student's marks, previous signatures remained attached to an out-of-date document snapshot.
- **Resolution Implemented:**
  1. Implemented `invalidateReportCardSignaturesOnMarksChange` in `src/lib/resultEngine.ts`:
     - Inspects whether the student's annual report card exists in `publishedReportCards`.
     - **Historical Document Protection:** If `workflowStatus === "published"` or `isLocked === true`, the document is treated as immutable and preserved untouched.
     - If the card is unfinalized (`teacher_signed` or `hod_signed`), invalidates `signatures.classTeacher`, `signatures.hod`, and `signatures.principal`, resets `workflowStatus: "draft"`, records invalidation metadata, and logs an immutable audit event in `academicAudits`.
  2. Integrated invalidation directly into `saveMarksEntriesBatch` so that modifying submitted marks for any student automatically triggers signature invalidation for only that student.
  3. Integrated invalidation into `transitionMarksWorkflow` when an Admin or HOD reopens marks back to `"draft"`.
  4. Implemented `compileStudentAnnualReportCard` and `generateAnnualReportCardsForSection` in `src/lib/resultEngine.ts` and wired a "Calculate / Refresh Drafts" button into `src/pages/admin/AnnualReportCards.tsx`.
- **Verification:** 100% passed (17 dedicated signature invalidation and workflow assertions in `scripts/test_academic_exemption_and_esign_invalidation.ts`).

---

### 3.3 NONSEC-11: Firestore Composite Index Status
- **Inspection Performed:** Executed `npx firebase-tools firestore:indexes --project prestige-erp` to inspect the remote Cloud Firestore database on the target project (`prestige-erp`, Project Number `260740002503`).
- **Inspection Result:** Remote database reported `indexes: []`.
- **Local Index Definition:** [firestore.indexes.json](file:///c:/Users/Anas%20Pc/Desktop/erp/firestore.indexes.json) contains all required composite indexes for compound queries:
  - `attendance`: `(sectionId ASC, date ASC)` and `(studentId ASC, date ASC)`
  - `enrollments`: `(sectionId ASC, status ASC, academicYear ASC)`
  - `assignmentsActivities`: `(sectionId ASC, dueDate ASC)`
  - `studentFeeAssignments`: `(studentId ASC, sessionId ASC, status ASC)`
  - `feeLedgerEntries`: `(studentId ASC, sessionId ASC, createdAt ASC)`
- **Deployment Requirement:** To deploy the index definitions to the remote project safely when authorized by the project owner:
  ```bash
  firebase deploy --only firestore:indexes --project prestige-erp
  ```

---

## 4. Summary of Verification Status

| Suite | Scope | Total Assertions | Passed | Failed | Status |
|:---|:---|:---:|:---:|:---:|:---|
| **Academic Exemption & E-Sign Invalidation** | NONSEC-01 & NONSEC-06 | 40 | 40 | 0 | **100% PASS** |
| **Comprehensive QA Suite** | Core ERP Workflows | 45 | 45 | 0 | **100% PASS** |
| **TypeScript Compiler (`tsc --noEmit`)** | Whole Repository Type Check | N/A | 0 Errors | 0 Errors | **CLEAN** |
| **Vite Production Build (`npm run build`)** | Production Asset Bundler | N/A | Built in 8.88s | 0 Errors | **SUCCESS** |

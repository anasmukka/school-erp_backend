# Prestige International School ERP

A production-grade, multi-tenant hybrid School ERP system combining **Firebase** (Auth, Firestore canonical database, FCM, Cloud Functions) and **Cloudflare** (Workers edge API, R2 object storage, WAF/CDN).

---

## Architecture Overview

```
                      ┌──────────────────────────────────────┐
                      │        Vite React Frontend           │
                      └──────────────┬───────────────────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           │ (User Identity & Auth)  │ (Edge Files & API)      │ (Realtime DB & State)
           ▼                         ▼                         ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│ Firebase Auth       │   │ Cloudflare Workers  │   │ Cloud Firestore     │
│ (Identity & Creds)  │   │ Edge API & Routing  │   │ Canonical Database  │
└─────────────────────┘   └──────────┬──────────┘   └──────────┬──────────┘
                                     │                         │
                                     ▼                         ▼
                          ┌─────────────────────┐   ┌─────────────────────┐
                          │ Cloudflare R2       │   │ Firebase Functions  │
                          │ Binary Object Store │   │ Triggers & Alerts   │
                          └─────────────────────┘   └─────────────────────┘
```

| Layer | Responsibility | Technology |
|-------|----------------|------------|
| **Frontend** | Responsive SPA | React 18, TypeScript, Vite, Tailwind CSS v4, Lucide Icons |
| **Authentication** | User identity, password ownership, password reset | Firebase Authentication |
| **Primary Database** | Canonical ERP database & source of truth | Cloud Firestore |
| **Edge API & Files** | Secure file upload/download, capability discovery, webhooks | Cloudflare Workers (TypeScript) |
| **Object Storage** | Student photos, signatures, PDFs, receipts, admit cards | Cloudflare R2 Storage (S3-compatible, zero egress) |
| **Background Tasks**| Email & WhatsApp notification triggers, payment order intents | Firebase Cloud Functions (Node.js 18) |
| **Edge Security**   | WAF, rate limiting, CORS allowlist, MIME & size enforcement | Cloudflare Edge / Workers |

---

## Core Modules & Capabilities

### 1. Fee Management & Ledger System
- **Term-to-Installment Hierarchy**: Fee structures support parent Terms (Term 1, Term 2, etc.) grouping individual dated installments with fee head breakdowns.
- **Individualized Student Assignments**: Fee structures assignable to students with custom concessions, scholarship discounts, and preserved historical versioning.
- **Atomic Double-Entry Ledger**: Immutable transaction logging for tuition charges, concessions, waivers, counter payments, and online receipts.
- **Optional Razorpay Online Payment Gateway**:
  - **Graceful Degradation**: If Razorpay credentials are not configured in the active environment, the portal **automatically detects** capability and presents a polished, intentional **"Coming Soon"** state directing students and parents to the school counter.
  - **Zero Secrets Exposure**: Private secrets (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) never leave the backend. Only the public `keyId` is exposed when active.
  - **Cryptographic Verification**: Webhook and client payment verifications utilize server-side HMAC-SHA256 signatures with constant-time equality comparisons.
  - **Counter Desk Mode**: Accounts staff record Cash, Cheque, UPI, and Bank Transfer counter payments with instantaneous atomic receipt generation (`RC-CTR-YYYY-XXXXXX`).

### 2. Examination & Admit Card (Hall Ticket) Engine
- **CBSE-Compliant PDF Admit Cards**: Auto-generates formal hall tickets featuring school and CBSE emblems, student photo, exam timetable, venue, and official candidate conduct rules.
- **Principal E-Signature Verification**: Finalization and batch generation strictly require an approved, active Principal signature.
- **Fee Clearance Gate**: Automatically assesses student fee clearance before hall ticket release; supports administrative bypass requests with review notes.
- **Cryptographic Verification QR**: Admit cards contain verifiable QR codes for exam hall invigilators.

### 3. Report Card & Marks Workflow
- **Multi-Tier Signing Chain**: Draft generation by Class Teacher → Review & signing by HOD → Final approval & seal by Principal → Publication to Student Portal.
- **Automated Alerts**: Email and WhatsApp alerts triggered automatically for missing subject marks.

### 4. RFID Attendance System
- **IoT Hardware Integration**: ESP32 / Arduino devices submit attendance scans via HTTP POST.
- **Daily Aggregation**: One attendance record per student per day with real-time cashier and class dashboards.

### 5. P0 Security Architecture & Plaintext Password Elimination
- **Zero Firestore Passwords**: Firestore Security Rules strictly reject any document creation or update containing `password`, `plainPassword`, `tempPassword`, `passwordHash`, or `salt`.
- **API Response Sanitizer**: The Cloudflare Worker API strips sensitive credential and token fields from all output.
- **Native Firebase Auth Password Reset**: Self-service forgot-password and reset workflows operate entirely through Firebase Auth oob codes.

---

## Project Structure

```
.
├── src/                          # Frontend React source
│   ├── components/               # UI components
│   │   ├── ui/                   # Primitive design system (shadcn/ui)
│   │   ├── OnlinePaymentStatus.tsx # Coming Soon, Maintenance & Status Badges
│   │   ├── FeeReceiptModal.tsx   # Printable PDF fee receipt modal
│   │   └── Layout.tsx            # Navigation & role-based sidebar
│   ├── contexts/                 # React contexts (AuthContext, SessionContext)
│   ├── lib/                      # Core business logic & SDK integrations
│   │   ├── payments.ts           # Capability discovery & online payment flow
│   │   ├── objectStorage.ts      # Cloudflare R2 unified storage client
│   │   ├── r2StorageKeys.ts      # Deterministic tenant-isolated R2 keys
│   │   ├── feeLedger.ts          # Atomic fee ledger & transactions
│   │   ├── fees.ts               # Term hierarchy & installment calculations
│   │   ├── hallTicketEngine.ts   # Exam eligibility & admit card engine
│   │   ├── generateHallTicketPdf.ts # CBSE hall ticket PDF generator
│   │   └── firebase.ts           # Firebase client initialization
│   └── pages/                    # Role-specific application views
│       ├── admin/                # Principal & Admin management views
│       ├── hod/                  # Head of Department & exam coordination
│       ├── teacher/              # Teacher marks entry & attendance
│       ├── accounts/             # Fee structures, collections, assignments
│       └── student/              # Student fees, admit cards, report cards
├── worker/                       # Cloudflare Worker Edge API
│   ├── src/
│   │   ├── index.ts              # Fetch router, CORS, capabilities, webhooks
│   │   ├── auth.ts               # Firebase ID token verification
│   │   ├── rbac.ts               # Role-based access control & IDOR guards
│   │   └── types.ts              # Worker environment bindings
│   ├── wrangler.toml             # Cloudflare Wrangler configuration
│   └── package.json
├── functions/                    # Firebase Cloud Functions (v2 triggers)
│   ├── index.js                  # Email notifications & fallback payment intents
│   └── package.json
├── scripts/                      # Automated test suites & migration utilities
│   ├── test_optional_razorpay_flow.ts # Razorpay optional flow & Coming Soon tests
│   ├── test_password_security.ts      # P0 password elimination tests
│   ├── test_cloudflare_migration.ts   # R2 storage & Worker edge tests
│   ├── test_production_security.ts    # Ledger security & IDOR protection tests
│   ├── test_hall_ticket_esign.ts      # Admit card signature & PDF tests
│   ├── test_fee_structure_term_hierarchy.ts # Term hierarchy & concession tests
│   └── test_reset_and_auth.ts         # Password reset & auth validation tests
├── firestore.rules               # Authoritative Firestore Security Rules
├── storage.rules                 # Firebase Storage Rules (locked in production)
├── package.json
└── README.md
```

---

## Setup & Local Development

### Prerequisites
- **Node.js** 18+ and **npm**
- **Cloudflare Wrangler CLI** (`npm install -g wrangler`)
- **Firebase CLI** (`npm install -g firebase-tools`)
- A Firebase project with Authentication and Firestore enabled
- A Cloudflare account with an R2 bucket created

### 1. Install Dependencies

```bash
# Frontend dependencies
npm install

# Cloudflare Worker dependencies
cd worker && npm install && cd ..

# Firebase Functions dependencies
cd functions && npm install && cd ..
```

### 2. Frontend Configuration (`.env`)

Create a `.env` file in the project root:

```env
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Cloudflare Worker endpoint (optional in dev, required in production)
VITE_WORKER_URL=http://localhost:8787

# Razorpay Public Key (optional; set if Razorpay is active)
VITE_RAZORPAY_KEY_ID=
```

### 3. Cloudflare Worker Configuration (`worker/wrangler.toml`)

Configure `worker/wrangler.toml`:

```toml
name = "prestige-erp-worker"
main = "src/index.ts"
compatibility_date = "2024-04-01"

[vars]
ENVIRONMENT = "development"
SCHOOL_ID = "prestige"
ALLOWED_ORIGINS = "http://localhost:3000,http://localhost:5173"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "prestige-erp-storage"
```

Set worker secrets via Wrangler:

```bash
cd worker
wrangler secret put FIREBASE_PROJECT_ID
wrangler secret put RAZORPAY_KEY_SECRET     # Optional
wrangler secret put RAZORPAY_WEBHOOK_SECRET  # Optional
```

### 4. Running the Development Environment

```bash
# Terminal 1: Run Cloudflare Worker
cd worker
npm run dev

# Terminal 2: Run React Frontend
npm run dev
```

The application will be accessible at `http://localhost:3000`.

---

## Production Deployment

### 1. Deploy Cloudflare Worker & R2

```bash
cd worker
wrangler deploy
```

Set the production `VITE_WORKER_URL` in your frontend environment to the worker's route (e.g. `https://api.yourdomain.com`).

### 2. Deploy Firestore Rules & Indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

### 3. Deploy Cloud Functions

```bash
firebase deploy --only functions
```

### 4. Build & Deploy Frontend

```bash
npm run build
firebase deploy --only hosting
```

---

## Automated Test Suites

The codebase includes comprehensive automated test suites verifying all security, storage, ledger, and capability flows:

```bash
# Run Optional Razorpay Provider & Coming Soon degradation tests (29 tests)
npx tsx scripts/test_optional_razorpay_flow.ts

# Run P0 Password Security & Sanitization tests (32 tests)
npx tsx scripts/test_password_security.ts

# Run Cloudflare R2 Migration, Path Traversal & RBAC tests (49 tests)
npx tsx scripts/test_cloudflare_migration.ts

# Run Production Ledger, Idempotency & IDOR Protection tests (23 tests)
npx tsx scripts/test_production_security.ts

# Run Hall Ticket E-Signature & PDF Template tests (28 tests)
npx tsx scripts/test_hall_ticket_esign.ts

# Run Fee Structure Term Hierarchy & Concession tests (48 tests)
npx tsx scripts/test_fee_structure_term_hierarchy.ts

# Run Authentication & Password Reset validation tests (30 tests)
npx tsx scripts/test_reset_and_auth.ts
```

All **239 tests** pass with 0 failures.

---

## Role & Permission Matrix

| Role | Module Access | Capabilities |
|------|---------------|--------------|
| **Admin (Principal)** | Complete ERP Access | Staff provisioning, academic session planner, official signatory, fee concessions approval, hall ticket finalization |
| **HOD** | Academic Management | Class & section management, exam scheduling, report card review, attendance oversight |
| **Teacher** | Class & Subject Desk | Daily RFID/manual attendance, marks entry, report card draft generation |
| **Accountant** | Financial Desk | Fee structures with term hierarchy, individualized student fee assignments, atomic counter collections, receipt issuance |
| **Student** | Student Portal | Academic report cards, examination admit cards, fee schedule breakdown, online payment / counter status |
| **Parent** | Parent Portal | Multi-child tracking, fee statements, attendance logs, report card downloads |

---

## License

Private and Confidential — Prestige International School. All rights reserved.

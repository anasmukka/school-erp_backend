# Prestige International School ERP — RFID Attendance Archive

> **STATUS:** DEFERRED / ARCHIVED FOR FUTURE REACTIVATION  
> **DATE ARCHIVED:** October 2026  
> **ACTIVE REPLACEMENT:** Class Teacher Manual Attendance (`src/pages/teacher/ManualAttendance.tsx`)

---

## 1. Architectural Reasons for Deferral

During the production readiness assessment and architectural evaluation of the Prestige International School ERP, the RFID-based attendance system was deferred and decoupled from the active ERP application for the following reasons:

1. **Hardware & Physical Dependency:** RFID requires physical card provisioning, edge readers (ESP32 / RC522 or turnkey turnstiles), reliable local gate power, and Wi-Fi/Ethernet connectivity. School operations cannot be blocked when cards are forgotten, lost, damaged, or when hardware readers encounter gateway drops.
2. **Security & Edge Ingestion Surface:** The original `/api/rfid-scan` webhook accepted card UIDs without hardware cryptographic attestation (HMAC / shared secret device token), introducing an unauthenticated edge injection risk. Decoupling this allows hardware authentication standards to be engineered before production hardware deployment.
3. **Operational Pedagogy & Accountability:** School policy requires class teachers to physically verify student presence during homeroom roll call. Manual attendance in the Class Teacher Panel gives educators direct authority to mark Present, Absent, and Late (P/A/L) with instantaneous record synchronization and monthly register exports.
4. **Clean Decoupling:** Moving RFID out of the primary build path simplifies the core ERP bundle, eliminates unauthenticated backend endpoints, and allows future hardware development to proceed on an isolated cadence.

---

## 2. Catalog of Archived Files

This archive contains the complete, battle-tested source files, models, and schemas originally built for RFID operations:

```
archive/future-rfid/
├── README.md                                  # Architectural rationale, catalog & reactivation guide
├── frontend/
│   ├── RfidCards.tsx                          # Admin RFID card inventory, student pairing & search UI
│   └── RfidAttendance.tsx                     # Class Teacher live RFID tap monitor with real-time Firestore listeners
├── backend/
│   └── rfid_backend_reference.py              # FastAPI endpoints, UID sanitization, card assignment & scan hooks
└── schemas/
    └── rfid_schemas.json                      # Formal JSON Schema for rfidCards and attendance documents
```

### Component Details:
- **`frontend/RfidCards.tsx`:** Provides the admin interface for scanning new physical RFID cards, validating lowercase hexadecimal UIDs, searching enrolled students, linking cards, and revoking cards.
- **`frontend/RfidAttendance.tsx`:** Provides an interactive classroom dashboard displaying live student taps in real time, showing in-time, out-time, and P/A/L status with automatic fallback.
- **`backend/rfid_backend_reference.py`:** Contains FastAPI endpoint logic for `/api/rfid-scan`, `/api/rfid-cards`, `/api/rfid-cards/{uid}`, and `/api/attendance` with lowercase hex normalization, duplicate assignment guards, and daily attendance upserts.
- **`schemas/rfid_schemas.json`:** JSON Schema definitions for `/rfidCards/{uid}` and `/attendance/{studentId}_{date}` documents.

---

## 3. Active ERP Decoupling Summary

To ensure zero dependencies, dead code, or unintended bundle bloat in the active ERP, the following modifications were completed:

1. **Route Removal:** Removed `/admin/rfid-cards` and `/teacher/rfid-attendance` routes from `src/App.tsx`.
2. **Navigation Cleanup:** Removed RFID navigation menu items and sidebar links from `src/components/Layout.tsx`.
3. **Teacher Dashboard:** Removed RFID QuickLink cards from `src/pages/teacher/Dashboard.tsx`.
4. **Backend Gateway:** Removed active `/api/rfid-scan` and `/api/rfid-cards` routes from `backend/server.py`. The root endpoint `/api/` reports `"attendanceMode": "manual_class_teacher"` and `"rfidStatus": "deferred"`.
5. **Build Isolation:** The `archive/` folder is explicitly excluded from TypeScript (`tsconfig.json`) and Vite bundler paths.
6. **Manual Attendance Workflow:** Deployed `src/pages/teacher/ManualAttendance.tsx` as the authoritative attendance tool for class teachers, offering single-click P/A/L toggling, bulk marking, section filtering, and integration with `AttendanceRegister.tsx`.

---

## 4. Historical Data Preservation

**Important:** No database migration or destructive operation was performed on existing historical attendance records.

- **`attendance` Collection:** Existing records tagged with `source: "rfid"` remain intact in Firestore. The manual attendance system and monthly attendance register read all records for a date/section regardless of source (`source == "rfid"` or `source == "manual"`).
- **`rfidCards` Collection:** Existing card assignment documents in `/rfidCards/` remain preserved in Firestore and can be re-accessed upon reactivation without data re-entry.
- **`students.rfidUid` Field:** The optional `rfidUid` property on student documents is preserved in TypeScript type definitions (`src/lib/types.ts`) for backward compatibility with existing Firestore student profiles.

---

## 5. Reactivation Prerequisites & Security Hardening

When the institution is ready to roll out physical RFID turnstiles or classroom readers, follow these prerequisites before reconnecting:

### A. Edge Hardware & Gateway Security
1. **Device Authentication:** Implement pre-shared API keys (`X-Device-Token`) or HMAC request signatures in `rfid_backend_reference.py` to authenticate hardware readers.
2. **Rate Limiting & Debouncing:** Configure a Redis-backed or in-memory debounce window (e.g., minimum 5 seconds between scans of the same card) to avoid hardware bounce.
3. **Device Registry:** Create an `/rfidDevices` collection in Firestore to maintain authorized reader MAC addresses, locations (e.g., "Main Gate 1", "Library"), and operational status.

### B. Backend Reactivation
1. Copy or mount `archive/future-rfid/backend/rfid_backend_reference.py` into `backend/server.py` or a dedicated microservice.
2. Ensure Firebase Admin SDK service account credentials have write permissions to `rfidCards` and `attendance`.
3. Protect card assignment endpoints (`/api/rfid-cards`) with JWT authorization checking for `role === "admin"`.

### C. Frontend Reactivation
1. Move `archive/future-rfid/frontend/RfidCards.tsx` to `src/pages/admin/RfidCards.tsx`.
2. Move `archive/future-rfid/frontend/RfidAttendance.tsx` to `src/pages/teacher/RfidAttendance.tsx`.
3. Restore routes in `src/App.tsx`:
   - Admin route: `<AdminRoute path="/admin/rfid-cards" component={RfidCards} />`
   - Teacher route: `<TeacherRoute path="/teacher/rfid-attendance" component={RfidAttendance} />`
4. Re-add navigation items to `src/components/Layout.tsx`.

### D. Firestore Security Rules
Update `firestore.rules` to enforce RBAC on `rfidCards`:
```firestore-security-rules
match /rfidCards/{uid} {
  allow read: if isSignedIn() && (isAdmin() || isTeacher());
  allow write: if isAdmin();
}
```

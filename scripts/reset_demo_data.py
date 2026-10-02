import os
import sys
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore, auth

ROOT_DIR = Path(__file__).resolve().parent.parent
SA_PATH = ROOT_DIR / "backend" / "serviceAccountKey.json"

if not SA_PATH.exists():
    print(f"[FATAL] Service account not found at {SA_PATH}")
    sys.exit(1)

cred = credentials.Certificate(str(SA_PATH))
firebase_admin.initialize_app(cred)
db = firestore.client()

ADMIN_UID = "A8CrLrjitoMrMeeMflUe88gY5042"
ADMIN_EMAIL = "anasmukka@gmail.com"

# Collections to preserve completely intact
PRESERVED_CONFIG_COLLECTIONS = {
    "academicSessions",
    "academicYears",
    "academicStructures",
    "academicStructureVersions",
    "eventTypes",
    "hallTicketSettings",
    "signatureConfigs",
    "subjects",
}

# Collections completely purged
PURGE_COLLECTIONS = [
    "students",
    "teachers",
    "admissions",
    "enrollments",
    "subjectAssignments",
    "examSchedules",
    "exams",
    "marks",
    "marksEntries",
    "reportCards",
    "publishedReportCards",
    "feePayments",
    "feeStructures",
    "hallTickets",
    "hallTicketBypasses",
    "hallTicketRules",
    "events",
    "notifications",
    "printingRequests",
    "libraryBooks",
    "libraryCopies",
    "libraryTransactions",
    "inventoryItems",
    "inventoryMovements",
    "uniformItems",
    "uniformIssues",
    "textbookItems",
    "bookDistributions",
    "signatures",
]

print("==================================================")
print("1. PURGING DEMO FIREBASE AUTH ACCOUNTS")
print("==================================================")

auth_users = list(auth.list_users().iterate_all())
deleted_auth_count = 0
deleted_auth_details = []

for u in auth_users:
    if u.uid == ADMIN_UID or (u.email and u.email.lower() == ADMIN_EMAIL.lower()):
        print(f"[PRESERVED] Sole Admin Auth Account: {u.email} ({u.uid})")
        continue

    # Delete test/demo user
    try:
        auth.delete_user(u.uid)
        deleted_auth_count += 1
        deleted_auth_details.append({"uid": u.uid, "email": u.email, "displayName": u.display_name})
        print(f"[DELETED AUTH] {u.email or '(no email)'} | UID: {u.uid}")
    except Exception as e:
        print(f"[ERROR DELETING AUTH] {u.uid}: {e}")

print(f"\nTotal Firebase Auth demo accounts deleted: {deleted_auth_count}")

print("\n==================================================")
print("2. PURGING FIRESTORE DEMO COLLECTIONS")
print("==================================================")

deleted_firestore_counts = {}

for col_name in PURGE_COLLECTIONS:
    col_ref = db.collection(col_name)
    docs = list(col_ref.list_documents())
    count = 0
    batch = db.batch()
    for doc in docs:
        batch.delete(doc)
        count += 1
        if count % 400 == 0:
            batch.commit()
            batch = db.batch()
    if count % 400 != 0:
        batch.commit()
    deleted_firestore_counts[col_name] = count
    print(f"[PURGED] Collection '{col_name}': {count} documents deleted")

print("\n==================================================")
print("3. SURGICAL CLEANUP OF USERS COLLECTION")
print("==================================================")

users_ref = db.collection("users")
user_docs = list(users_ref.list_documents())
deleted_users_count = 0

for doc in user_docs:
    if doc.id == ADMIN_UID:
        admin_doc = doc.get().to_dict() or {}
        print(f"[PRESERVED] Admin user doc: {doc.id} ({admin_doc.get('email', '')}, role={admin_doc.get('role', '')})")
        continue
    
    doc.delete()
    deleted_users_count += 1
    print(f"[DELETED USER DOC] {doc.id}")

deleted_firestore_counts["users"] = deleted_users_count

print("\n==================================================")
print("4. SURGICAL CLEANUP OF AUDIT LOGS")
print("==================================================")

audit_ref = db.collection("auditLogs")
audit_docs = list(audit_ref.list_documents())
deleted_audit_count = 0

for doc in audit_docs:
    data = doc.get().to_dict() or {}
    actor = data.get("actorEmail") or data.get("performedBy") or data.get("userId") or data.get("actor")
    if actor == ADMIN_UID or (actor and actor.lower() == ADMIN_EMAIL.lower()):
        print(f"[PRESERVED] Admin audit log: {doc.id} (actor={actor})")
        continue
    doc.delete()
    deleted_audit_count += 1

deleted_firestore_counts["auditLogs"] = deleted_audit_count
print(f"[CLEARED] auditLogs: {deleted_audit_count} demo logs deleted")

print("\n==================================================")
print("5. SANITIZING SECTIONS (CLEARING DEMO TEACHER/HOD REFERENCES)")
print("==================================================")

sections_ref = db.collection("sections")
section_docs = list(sections_ref.list_documents())
sanitized_sections_count = 0

for doc in section_docs:
    doc.update({
        "classTeacherId": "",
        "hodId": ""
    })
    sanitized_sections_count += 1

print(f"[SANITIZED] {sanitized_sections_count} sections cleared of demo teacher/hod references.")

print("\n==================================================")
print("6. POST-CLEANUP AUDIT & INTEGRITY CHECK")
print("==================================================")

# 1. Verify Auth users
remaining_auth = list(auth.list_users().iterate_all())
print(f"Remaining Auth users count: {len(remaining_auth)}")
for u in remaining_auth:
    print(f" - Auth User: {u.email} ({u.uid})")

# 2. Verify Admin user in Firestore
admin_snap = db.collection("users").document(ADMIN_UID).get()
if admin_snap.exists:
    print(f"Admin Firestore Doc exists: YES | Data: {admin_snap.to_dict()}")
else:
    print("FATAL ERROR: Admin doc was deleted!")

# 3. Verify all collections
print("\nCurrent Firestore collections state:")
for col in db.collections():
    c_count = len(list(col.list_documents()))
    is_preserved = col.id in PRESERVED_CONFIG_COLLECTIONS or col.id in ["users", "sections", "auditLogs"]
    status_str = "PRESERVED CONFIG" if col.id in PRESERVED_CONFIG_COLLECTIONS else ("ACTIVE ADMIN/SYSTEM" if col.id in ["users", "sections", "auditLogs"] else "UNEXPECTED!")
    print(f" - Collection '{col.id:26}': {c_count} doc(s) [{status_str}]")

print("\nCleanup Script Complete!")

import os
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore

ROOT_DIR = Path(__file__).resolve().parent.parent
SA_PATH = ROOT_DIR / "backend" / "serviceAccountKey.json"

if not SA_PATH.exists():
    print(f"Service account not found at {SA_PATH}")
    exit(1)

cred = credentials.Certificate(str(SA_PATH))
firebase_admin.initialize_app(cred)
db = firestore.client()

# Collections to preserve intact
PRESERVED_COLLECTIONS = {
    "academicSessions",
    "academicYears",
    "eventTypes",
    "hallTicketSettings",
}

# Specific documents in collections to preserve (e.g. primary admin user)
PRESERVED_DOCS = {
    "users": {"A8CrLrjitoMrMeeMflUe88gY5042"}, # anasmukka@gmail.com (admin)
}

print("==================================================")
print("STARTING CONTROLLED DATABASE RESET")
print("==================================================")

deleted_counts = {}
all_collections = list(db.collections())

for col in all_collections:
    col_id = col.id
    if col_id in PRESERVED_COLLECTIONS:
        print(f"[PRESERVED] Skipping system configuration collection: {col_id}")
        continue
    
    docs = list(col.list_documents())
    deleted_in_col = 0
    
    batch = db.batch()
    batch_count = 0
    
    for doc in docs:
        if col_id in PRESERVED_DOCS and doc.id in PRESERVED_DOCS[col_id]:
            print(f"  [PRESERVED] Keeping critical document: {col_id}/{doc.id}")
            continue
        
        batch.delete(doc)
        batch_count += 1
        deleted_in_col += 1
        
        if batch_count >= 400:
            batch.commit()
            batch = db.batch()
            batch_count = 0
            
    if batch_count > 0:
        batch.commit()
        
    deleted_counts[col_id] = deleted_in_col
    print(f"[CLEARED] {col_id}: deleted {deleted_in_col} document(s)")

print("\n==================================================")
print("RESET COMPLETE - VERIFYING REMAINING STATE")
print("==================================================")

all_after = list(db.collections())
total_remaining = 0
for col in all_after:
    count = len(list(col.list_documents()))
    total_remaining += count
    status = "OK (Config/Admin)" if (col.id in PRESERVED_COLLECTIONS or col.id == "users") else "LEAKED!"
    print(f"Collection: {col.id:30} | Remaining docs: {count} [{status}]")

# Verify admin exists
admin_snap = db.collection("users").document("A8CrLrjitoMrMeeMflUe88gY5042").get()
if admin_snap.exists:
    admin_data = admin_snap.to_dict()
    print(f"\n[VERIFIED] Admin account preserved: {admin_data.get('email')} ({admin_data.get('role')})")
else:
    print("\n[ERROR] Admin account was NOT found!")

print(f"\nTotal documents remaining across entire database: {total_remaining}")
print("==================================================")

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

print("Listing all collections in Firestore...")
collections = list(db.collections())

total_docs = 0
for col in collections:
    docs = list(col.list_documents())
    count = len(docs)
    total_docs += count
    print(f"Collection: {col.id:30} | Document count: {count}")
    if col.id in ["users", "academicSessions", "academicYears", "hallTicketSettings"]:
        for d in docs[:5]:
            snap = d.get()
            data = snap.to_dict() or {}
            # print basic info without sensitive data
            print(f"   - Doc ID: {d.id} | Data: { {k: v for k, v in data.items() if k in ['name', 'email', 'role', 'isCurrent', 'feeGateEnabled']} }")

print(f"\nTotal documents across all collections: {total_docs}")

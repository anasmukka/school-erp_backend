import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime

cred = credentials.Certificate('backend/serviceAccountKey.json')
try:
    firebase_admin.get_app()
except ValueError:
    firebase_admin.initialize_app(cred)

db = firestore.client()

print("Regenerating Firestore hall tickets with canonical student photos and real branding...")

ver_doc = db.collection("academicStructureVersions").document("struct-secondary_v1").get()
layout = ver_doc.to_dict().get("reportCardLayout", {}) if ver_doc.exists else {}

school_name = layout.get("schoolName") or "PRESTIGE INTERNATIONAL SCHOOL"
affil_no = layout.get("affiliationNo")
address = layout.get("schoolAddress")
tagline = layout.get("tagline")

students_snap = db.collection("students").where("grade", "==", "10").stream()
updated_count = 0

for s_doc in students_snap:
    s = s_doc.to_dict()
    ticket_id = f"ht_sched-10-hy_{s_doc.id}"
    t_ref = db.collection("hallTickets").document(ticket_id)
    t_snap = t_ref.get()

    if t_snap.exists:
        print(f"Updating {ticket_id} ({s.get('name')}) with photo: {s.get('photo')}")
        update_data = {
            "studentUid": s.get("studentUid") or s_doc.id,
            "studentPhotoUrl": s.get("photo") or None,
            "dob": s.get("DOB") or "On Record",
            "admissionNo": s.get("admissionNo") or "",
            "rollNo": s.get("rollNo") or "",
            "schoolDetails": {
                "name": school_name,
                "affiliationNo": affil_no,
                "address": address,
                "tagline": tagline,
                "logoUrl": "/prestige_logo.png"
            },
            "updatedAt": datetime.utcnow().isoformat() + "Z"
        }
        t_ref.update(update_data)
        updated_count += 1

print(f"Successfully updated {updated_count} hall tickets in Firestore with canonical photos and real school branding!")

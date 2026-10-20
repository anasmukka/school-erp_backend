from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore, auth

SA_PATH = Path('backend/serviceAccountKey.json')
cred = credentials.Certificate(str(SA_PATH))
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

emails = ['hod@gmail.com', 'classteacher@gmail.com', 'teacher@gmail.com', 'student@gmail.com']

print("--- AUTH ACCOUNTS ---")
for email in emails:
    u = auth.get_user_by_email(email)
    print(f"Auth: {email:25} | UID: {u.uid} | DisplayName: {u.display_name}")

print("\n--- FIRESTORE USERS ---")
for email in emails:
    u = auth.get_user_by_email(email)
    doc = db.collection('users').document(u.uid).get()
    d = doc.to_dict() or {}
    print(f"User: {email:25} | Role: {d.get('role')} | Name: {d.get('name')} | Phone: {d.get('phone')}")

print("\n--- TEACHERS ---")
for d in db.collection('teachers').stream():
    data = d.to_dict() or {}
    if data.get('email') in emails:
        print(f"Teacher: {data.get('email'):25} | Name: {data.get('name')} | Subject: {data.get('subject')} | Sections: {data.get('assignedSections')}")

print("\n--- STUDENTS ---")
for d in db.collection('students').stream():
    data = d.to_dict() or {}
    if data.get('email') in emails:
        print(f"Student: {data.get('email'):25} | Name: {data.get('name')} | Grade: {data.get('grade')}-{data.get('section')} | Parent: {data.get('parentName')} ({data.get('parentContact')})")

print("\n--- SUBJECT ASSIGNMENTS ---")
for d in db.collection('subjectAssignments').stream():
    print(f"Assignment: {d.id} -> {d.to_dict()}")

print("\n--- ENROLLMENTS ---")
for d in db.collection('enrollments').stream():
    data = d.to_dict() or {}
    if data.get('studentId') == auth.get_user_by_email('student@gmail.com').uid:
        print(f"Enrollment: {d.id} -> Student: {data.get('studentName')} | Session: {data.get('sessionId')} | Grade: {data.get('className')}-{data.get('sectionName')}")

print("\n--- FEE ASSIGNMENTS & PAYMENTS ---")
for d in db.collection('studentFeeAssignments').stream():
    data = d.to_dict() or {}
    print(f"Fee Assignment: {d.id} -> Student: {data.get('studentName')}, Net: {data.get('netAmount')}, Status: {data.get('status')}")
for d in db.collection('feePayments').stream():
    data = d.to_dict() or {}
    print(f"Fee Payment: {d.id} -> Student: {data.get('studentName')}, Amount: {data.get('amount')}, Status: {data.get('verificationStatus')}")

import os
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, firestore, auth

SA_PATH = Path('backend/serviceAccountKey.json')
cred = credentials.Certificate(str(SA_PATH))
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

STANDARD_PASSWORD = "admin123"

def get_or_create_auth_user(email, display_name, password=STANDARD_PASSWORD):
    try:
        user = auth.get_user_by_email(email)
        print(f"Existing Auth User found: {email} -> UID: {user.uid}")
        auth.update_user(user.uid, password=password, display_name=display_name)
        print(f"  [OK] Password set to '{password}' for {email}")
        return user.uid
    except auth.UserNotFoundError:
        user = auth.create_user(
            email=email,
            password=password,
            display_name=display_name,
            email_verified=True
        )
        print(f"Created new Auth User: {email} -> UID: {user.uid}")
        return user.uid

def main():
    print("======================================================================")
    print("SEEDING SAMPLE USERS: HOD, TEACHERS, STUDENT")
    print("======================================================================\n")

    # 1. Ensure Auth Accounts with Password123!
    hod_uid = get_or_create_auth_user("hod@gmail.com", "Dr. Robert Vance (HOD)")
    classteacher_uid = get_or_create_auth_user("classteacher@gmail.com", "Sarah Jenkins (Class Teacher)")
    teacher_uid = get_or_create_auth_user("teacher@gmail.com", "Michael Chang (Teacher)")
    student_uid = get_or_create_auth_user("student@gmail.com", "Aarav Sharma (Student)")

    print("\n--- 2. Creating / Updating Firestore User Records ---")

    # HOD User Doc
    db.collection("users").document(hod_uid).set({
        "id": hod_uid,
        "uid": hod_uid,
        "name": "Dr. Robert Vance",
        "email": "hod@gmail.com",
        "role": "hod",
        "designation": "Head of Department (High School)",
        "phone": "+919876543201",
        "assignedGrades": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] users/hod@gmail.com updated (Role: hod)")

    # Class Teacher User Doc
    db.collection("users").document(classteacher_uid).set({
        "id": classteacher_uid,
        "uid": classteacher_uid,
        "name": "Sarah Jenkins",
        "email": "classteacher@gmail.com",
        "role": "teacher",
        "designation": "Senior Class Teacher (Grade 10-A)",
        "subject": "Mathematics",
        "phone": "+919876543202",
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] users/classteacher@gmail.com updated (Role: teacher)")

    # Subject Teacher User Doc
    db.collection("users").document(teacher_uid).set({
        "id": teacher_uid,
        "uid": teacher_uid,
        "name": "Michael Chang",
        "email": "teacher@gmail.com",
        "role": "teacher",
        "designation": "Subject Teacher (Science)",
        "subject": "Science",
        "phone": "+919876543203",
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] users/teacher@gmail.com updated (Role: teacher)")

    # Student User Doc
    db.collection("users").document(student_uid).set({
        "id": student_uid,
        "uid": student_uid,
        "studentUid": student_uid,
        "name": "Aarav Sharma",
        "email": "student@gmail.com",
        "role": "student",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "phone": "+919876543210",
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] users/student@gmail.com updated (Role: student)")

    print("\n--- 3. Setting Up Teachers in 'teachers' Collection ---")

    # Sarah Jenkins in teachers
    db.collection("teachers").document(classteacher_uid).set({
        "id": classteacher_uid,
        "uid": classteacher_uid,
        "name": "Sarah Jenkins",
        "email": "classteacher@gmail.com",
        "designation": "Senior Class Teacher",
        "subject": "Mathematics",
        "phone": "+919876543202",
        "hodIds": [hod_uid],
        "hodAssignments": [{"hodId": hod_uid, "grades": ["9", "10"]}],
        "assignedSections": ["sec-10a"],
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] teachers/classteacher updated (Mathematics)")

    # Michael Chang in teachers
    db.collection("teachers").document(teacher_uid).set({
        "id": teacher_uid,
        "uid": teacher_uid,
        "name": "Michael Chang",
        "email": "teacher@gmail.com",
        "designation": "Subject Teacher",
        "subject": "Science",
        "phone": "+919876543203",
        "hodIds": [hod_uid],
        "hodAssignments": [{"hodId": hod_uid, "grades": ["9", "10"]}],
        "assignedSections": ["sec-10a"],
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] teachers/teacher updated (Science)")

    print("\n--- 4. Setting Up Section Grade 10-A ---")
    db.collection("sections").document("sec-10a").set({
        "id": "sec-10a",
        "grade": "10",
        "className": "10",
        "name": "A",
        "sectionName": "A",
        "classTeacherId": classteacher_uid,
        "classTeacherName": "Sarah Jenkins",
        "hodId": hod_uid,
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] sections/sec-10a linked to Class Teacher Sarah Jenkins & HOD")

    print("\n--- 5. Setting Up Subject Assignments ---")
    # Math for Grade 10-A
    db.collection("subjectAssignments").document("assign-10a-math").set({
        "id": "assign-10a-math",
        "subjectId": "subj-10-math",
        "sectionId": "sec-10a",
        "teacherId": classteacher_uid,
        "updatedAt": "2026-10-20T14:00:00.000Z"
    })
    # Science for Grade 10-A
    db.collection("subjectAssignments").document("assign-10a-sci").set({
        "id": "assign-10a-sci",
        "subjectId": "subj-10-sci",
        "sectionId": "sec-10a",
        "teacherId": teacher_uid,
        "updatedAt": "2026-10-20T14:00:00.000Z"
    })
    print("  [OK] subjectAssignments created (Grade 10-A: Math & Science)")

    print("\n--- 6. Setting Up Student Profile in 'students' Collection ---")
    db.collection("students").document(student_uid).set({
        "id": student_uid,
        "uid": student_uid,
        "authUid": student_uid,
        "studentUid": student_uid,
        "name": "Aarav Sharma",
        "studentName": "Aarav Sharma",
        "email": "student@gmail.com",
        "grade": "10",
        "className": "10",
        "section": "A",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "admissionNo": "ADM202610A001",
        "rollNo": "101",
        "parentName": "Dev Sharma",
        "fatherName": "Dev Sharma",
        "guardianName": "Dev Sharma",
        "parentEmail": "parent.aarav@gmail.com",
        "fatherEmail": "parent.aarav@gmail.com",
        "parentContact": "+919876543220",
        "fatherContact": "+919876543220",
        "phone": "+919876543210",
        "studentPhone": "+919876543210",
        "address": "42 Prestige Enclave, MG Road, Bangalore 560001",
        "DOB": "2010-05-15",
        "gender": "Male",
        "bloodGroup": "O+",
        "hodId": hod_uid,
        "classTeacherId": classteacher_uid,
        "createdAt": "2026-05-01T00:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] students/Aarav Sharma updated in Grade 10-A")

    print("\n--- 7. Setting Up Active Academic Enrollment ---")
    db.collection("enrollments").document("enroll-2026-27-aarav").set({
        "id": "enroll-2026-27-aarav",
        "studentId": student_uid,
        "studentUid": student_uid,
        "studentName": "Aarav Sharma",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "className": "10",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "rollNo": "101",
        "status": "active",
        "hodId": hod_uid,
        "classTeacherId": classteacher_uid,
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] enrollments/enroll-2026-27-aarav registered (Grade 10-A Active)")

    print("\n--- 8. Setting Up Fee Structure for Grade 10 (2026-27) ---")
    grade10_structure_id = "struct-grade-10-2026-27"
    db.collection("feeStructures").document(grade10_structure_id).set({
        "id": grade10_structure_id,
        "title": "Grade 10 Annual Fee Structure (2026-27)",
        "grade": "10",
        "academicSessionId": "2026-27",
        "academicSession": "2026-27",
        "term": "full_year",
        "feeHeads": [
            {"id": "head-tution-10", "name": "Tuition Fee", "amount": 40000},
            {"id": "head-lab-10", "name": "Science & Computer Lab Fee", "amount": 10000}
        ],
        "terms": [
            {
                "order": 1,
                "termId": "term_1",
                "termName": "Term 1",
                "installments": [
                    {"id": "inst-10-t1", "label": "Term 1 Installment", "amount": 25000, "dueDate": "2026-07-15", "termId": "term_1", "termName": "Term 1", "order": 1}
                ]
            },
            {
                "order": 2,
                "termId": "term_2",
                "termName": "Term 2",
                "installments": [
                    {"id": "inst-10-t2", "label": "Term 2 Installment", "amount": 25000, "dueDate": "2026-10-30", "termId": "term_2", "termName": "Term 2", "order": 1}
                ]
            }
        ],
        "installments": [
            {"id": "inst-10-t1", "label": "Term 1 Installment", "amount": 25000, "dueDate": "2026-07-15", "termId": "term_1", "termName": "Term 1", "order": 1},
            {"id": "inst-10-t2", "label": "Term 2 Installment", "amount": 25000, "dueDate": "2026-10-30", "termId": "term_2", "termName": "Term 2", "order": 1}
        ],
        "createdAt": "2026-06-01T00:00:00.000Z",
        "updatedAt": "2026-10-20T14:00:00.000Z"
    }, merge=True)
    print("  [OK] feeStructures/Grade 10 Annual Fee Structure (INR 50,000)")

    print("\n--- 9. Setting Up Student Fee Assignment ---")
    assignment_id = "assign-fee-aarav-2026-27"
    db.collection("studentFeeAssignments").document(assignment_id).set({
        "id": assignment_id,
        "studentId": student_uid,
        "studentUid": student_uid,
        "studentName": "Aarav Sharma",
        "admissionNo": "ADM202610A001",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "enrollmentId": "enroll-2026-27-aarav",
        "structureId": grade10_structure_id,
        "structureVersion": 1,
        "grossAmount": 50000,
        "discountAmount": 0,
        "netAmount": 50000,
        "status": "active",
        "installments": [
            {"id": "inst-10-t1", "label": "Term 1 Installment", "amount": 25000, "dueDate": "2026-07-15", "termId": "term_1", "termName": "Term 1", "order": 1},
            {"id": "inst-10-t2", "label": "Term 2 Installment", "amount": 25000, "dueDate": "2026-10-30", "termId": "term_2", "termName": "Term 2", "order": 1}
        ],
        "assignedAt": "2026-06-05T00:00:00.000Z",
        "assignedBy": "A8CrLrjitoMrMeeMflUe88gY5042",
        "assignedByName": "Anas (Admin)",
        "notes": "Annual Fee Assignment for Grade 10-A",
        "createdAt": "2026-06-05T00:00:00.000Z"
    }, merge=True)
    print("  [OK] studentFeeAssignments/Aarav Sharma registered")

    print("\n--- 10. Recording Verified Payment for Term 1 (INR 25,000) ---")
    payment_id = "pay-aarav-term1"
    db.collection("feePayments").document(payment_id).set({
        "id": payment_id,
        "studentId": student_uid,
        "studentUid": student_uid,
        "authUid": student_uid,
        "studentName": "Aarav Sharma",
        "academicSession": "2026-27",
        "sessionId": "2026-27",
        "grade": "10",
        "installmentId": "inst-10-t1",
        "installmentLabel": "Term 1 Installment",
        "amount": 25000,
        "paidAt": "2026-07-10",
        "paymentMode": "online",
        "receiptNo": "RCP-2026-10A-001",
        "reference": "PAY_TERM1_SUCCESS",
        "verificationStatus": "verified",
        "verifiedAt": "2026-07-10T11:00:00.000Z",
        "recordedBy": "A8CrLrjitoMrMeeMflUe88gY5042",
        "structureId": grade10_structure_id,
        "notes": "Paid in full via online banking"
    }, merge=True)
    print("  [OK] feePayments/pay-aarav-term1 recorded (Term 1 Paid, Term 2 Pending INR 25,000 due 2026-10-30)")

    print("\n--- 11. Creating Sample School Notices ---")
    # Notice 1 for Grade 10
    db.collection("notices").document("notice-10-exam-schedule").set({
        "id": "notice-10-exam-schedule",
        "title": "Grade 10 Mid-Term Examination Schedule Released",
        "content": "Dear Students and Parents, the official timetable for the upcoming Mid-Term Examinations (Term 2) is now published. Please download your hall tickets from the student portal.",
        "targetAudience": "students_and_parents",
        "grade": "10",
        "priority": "high",
        "authorName": "Dr. Robert Vance (HOD)",
        "authorRole": "hod",
        "authorId": hod_uid,
        "createdAt": "2026-10-18T09:00:00.000Z",
        "published": True
    }, merge=True)

    # Notice 2 for Teachers
    db.collection("notices").document("notice-staff-meeting").set({
        "id": "notice-staff-meeting",
        "title": "Faculty Departmental Meeting - Term 2 Academic Review",
        "content": "All secondary school teachers are requested to attend the academic review meeting on Friday at 3:30 PM in the Conference Hall. Marks entry status and syllabus coverage will be reviewed.",
        "targetAudience": "teachers",
        "grade": "all",
        "priority": "medium",
        "authorName": "Dr. Robert Vance (HOD)",
        "authorRole": "hod",
        "authorId": hod_uid,
        "createdAt": "2026-10-19T10:00:00.000Z",
        "published": True
    }, merge=True)
    print("  [OK] notices created for Grade 10 & Teaching Staff")

    print("\n--- 12. Recording Sample Attendance for Student ---")
    dates = ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]
    for d in dates:
        att_id = f"att-aarav-{d}"
        db.collection("attendance").document(att_id).set({
            "id": att_id,
            "studentId": student_uid,
            "studentName": "Aarav Sharma",
            "sectionId": "sec-10a",
            "grade": "10",
            "date": d,
            "status": "present",
            "time": "08:25 AM",
            "inTime": "08:25 AM",
            "outTime": "03:15 PM",
            "recordedBy": classteacher_uid,
            "recordedByName": "Sarah Jenkins",
            "createdAt": f"{d}T08:30:00.000Z"
        }, merge=True)
    print(f"  [OK] attendance records created for {len(dates)} days (Status: Present)")

    print("\n======================================================================")
    print("SEEDING COMPLETE!")
    print("======================================================================")
    print(f"HOD Login:            hod@gmail.com           / {STANDARD_PASSWORD} (Role: hod)")
    print(f"Class Teacher Login:  classteacher@gmail.com  / {STANDARD_PASSWORD} (Role: teacher - Maths)")
    print(f"Subject Teacher Login:teacher@gmail.com        / {STANDARD_PASSWORD} (Role: teacher - Science)")
    print(f"Student Login:        student@gmail.com       / {STANDARD_PASSWORD} (Role: student - Grade 10-A)")
    print("======================================================================")

if __name__ == "__main__":
    main()

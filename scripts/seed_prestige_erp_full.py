import json
from pathlib import Path
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, auth, firestore

cred = credentials.Certificate('backend/serviceAccountKey.json')
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

PASSWORD = "admin123"

def get_or_create_user(email, display_name, password=PASSWORD):
    try:
        u = auth.get_user_by_email(email)
        auth.update_user(u.uid, password=password, display_name=display_name)
        print(f"[OK] Auth user updated: {email} -> UID: {u.uid}")
        return u.uid
    except auth.UserNotFoundError:
        u = auth.create_user(email=email, password=password, display_name=display_name, email_verified=True)
        print(f"[OK] Auth user created: {email} -> UID: {u.uid}")
        return u.uid

def main():
    print("======================================================================")
    print("SEEDING PRESTIGE-ERP: AUTH ACCOUNTS, EXAM SCHEDULES & MARKS")
    print("======================================================================\n")

    # 1. AUTH ACCOUNTS
    admin_uid = get_or_create_user("anasmukka@gmail.com", "Anas (Admin)")
    hod_uid = get_or_create_user("hod@gmail.com", "Dr. Robert Vance (HOD)")
    classteacher_uid = get_or_create_user("classteacher@gmail.com", "Sarah Jenkins (Class Teacher)")
    teacher_uid = get_or_create_user("teacher@gmail.com", "Michael Chang (Teacher)")
    student_uid = get_or_create_user("student@gmail.com", "Aarav Sharma (Student)")
    accounts_uid = get_or_create_user("accounts@gmail.com", "Finance & Accounts")

    now_iso = datetime.utcnow().isoformat() + "Z"

    # 2. ACADEMIC SESSION
    print("\n--- Seeding Academic Session 2026-27 ---")
    session_id = "2026-27"
    db.collection("academicSessions").document(session_id).set({
        "id": session_id,
        "name": session_id,
        "startDate": "2026-06-01",
        "endDate": "2027-04-30",
        "status": "active",
        "isCurrent": True,
        "notes": "Current primary active academic cycle",
        "createdAt": now_iso,
        "updatedAt": now_iso
    }, merge=True)

    # 3. ACADEMIC STRUCTURE & VERSION
    print("\n--- Seeding CBSE Secondary Academic Structure ---")
    struct_id = "struct-secondary"
    struct_ver_id = "struct-secondary_v1"

    grading_scale = {
        "id": "cbse-8-point",
        "name": "CBSE 8-Point Scale",
        "passingPercentage": 33,
        "tiers": [
            {"grade": "A1", "gradePoint": 10, "minPercentage": 91, "maxPercentage": 100, "description": "Outstanding"},
            {"grade": "A2", "gradePoint": 9, "minPercentage": 81, "maxPercentage": 90.99, "description": "Excellent"},
            {"grade": "B1", "gradePoint": 8, "minPercentage": 71, "maxPercentage": 80.99, "description": "Very Good"},
            {"grade": "B2", "gradePoint": 7, "minPercentage": 61, "maxPercentage": 70.99, "description": "Good"},
            {"grade": "C1", "gradePoint": 6, "minPercentage": 51, "maxPercentage": 60.99, "description": "Fair"},
            {"grade": "C2", "gradePoint": 5, "minPercentage": 41, "maxPercentage": 50.99, "description": "Average"},
            {"grade": "D", "gradePoint": 4, "minPercentage": 33, "maxPercentage": 40.99, "description": "Pass"},
            {"grade": "E", "gradePoint": 0, "minPercentage": 0, "maxPercentage": 32.99, "description": "Essential Repeat"}
        ]
    }

    terms = [
        {
            "id": "term_1",
            "name": "Term 1",
            "code": "T1",
            "order": 1,
            "startDate": "2026-06-01",
            "endDate": "2026-10-31",
            "status": "open",
            "maxMarks": 100,
            "examIds": ["exam-t1-pt1", "exam-t1-hy"],
            "assessmentComponentIds": ["comp-pt", "comp-nb", "comp-sea", "comp-th"]
        },
        {
            "id": "term_2",
            "name": "Term 2",
            "code": "T2",
            "order": 2,
            "startDate": "2026-11-01",
            "endDate": "2027-04-15",
            "status": "open",
            "maxMarks": 100,
            "examIds": ["exam-t2-pt2", "exam-t2-ann"],
            "assessmentComponentIds": ["comp-pt2", "comp-nb2", "comp-sea2", "comp-th2"]
        }
    ]

    defined_exams = [
        {"id": "exam-t1-pt1", "termId": "term_1", "term": "term1", "name": "Periodic Test 1", "code": "PT1", "order": 1, "weightagePercentage": 20, "applicableComponentIds": ["comp-pt"]},
        {"id": "exam-t1-hy", "termId": "term_1", "term": "term1", "name": "Half-Yearly Examination", "code": "HY", "order": 2, "weightagePercentage": 80, "applicableComponentIds": ["comp-pt", "comp-nb", "comp-sea", "comp-th"]},
        {"id": "exam-t2-pt2", "termId": "term_2", "term": "term2", "name": "Periodic Test 2", "code": "PT2", "order": 1, "weightagePercentage": 20, "applicableComponentIds": ["comp-pt2"]},
        {"id": "exam-t2-ann", "termId": "term_2", "term": "term2", "name": "Annual Examination", "code": "ANN", "order": 2, "weightagePercentage": 80, "applicableComponentIds": ["comp-pt2", "comp-nb2", "comp-sea2", "comp-th2"]}
    ]

    assessment_components = [
        {"id": "comp-pt", "code": "PT", "name": "Periodic Test (PT)", "order": 1, "maxMarks": 10, "scalingTargetMarks": 10, "testedMaxMarks": 40, "weightage": 10, "applicableTermId": "term_1", "applicableExamId": "exam-t1-hy", "contributeToTotal": True, "displayOnReportCard": True, "calculationMethod": "scaled"},
        {"id": "comp-nb", "code": "NB", "name": "Notebook Submission", "order": 2, "maxMarks": 5, "weightage": 5, "applicableTermId": "term_1", "applicableExamId": "exam-t1-hy", "contributeToTotal": True, "displayOnReportCard": True},
        {"id": "comp-sea", "code": "SEA", "name": "Subject Enrichment Activity", "order": 3, "maxMarks": 5, "weightage": 5, "applicableTermId": "term_1", "applicableExamId": "exam-t1-hy", "contributeToTotal": True, "displayOnReportCard": True},
        {"id": "comp-th", "code": "TH", "name": "Theory Exam (Half-Yearly)", "order": 4, "maxMarks": 80, "weightage": 80, "applicableTermId": "term_1", "applicableExamId": "exam-t1-hy", "contributeToTotal": True, "displayOnReportCard": True},
        {"id": "comp-pt2", "code": "PT", "name": "Periodic Test 2 (PT)", "order": 1, "maxMarks": 10, "scalingTargetMarks": 10, "testedMaxMarks": 40, "weightage": 10, "applicableTermId": "term_2", "applicableExamId": "exam-t2-ann", "contributeToTotal": True, "displayOnReportCard": True, "calculationMethod": "scaled"},
        {"id": "comp-nb2", "code": "NB", "name": "Notebook Submission (T2)", "order": 2, "maxMarks": 5, "weightage": 5, "applicableTermId": "term_2", "applicableExamId": "exam-t2-ann", "contributeToTotal": True, "displayOnReportCard": True},
        {"id": "comp-sea2", "code": "SEA", "name": "Subject Enrichment Activity (T2)", "order": 3, "maxMarks": 5, "weightage": 5, "applicableTermId": "term_2", "applicableExamId": "exam-t2-ann", "contributeToTotal": True, "displayOnReportCard": True},
        {"id": "comp-th2", "code": "TH", "name": "Theory Exam (Annual)", "order": 4, "maxMarks": 80, "weightage": 80, "applicableTermId": "term_2", "applicableExamId": "exam-t2-ann", "contributeToTotal": True, "displayOnReportCard": True}
    ]

    db.collection("academicStructures").document(struct_id).set({
        "id": struct_id,
        "name": "Secondary Wing (CBSE High School)",
        "description": "Standard CBSE curriculum structure for Grades 9 and 10",
        "sessionId": session_id,
        "academicYear": session_id,
        "applicableGrades": ["9", "10"],
        "status": "active",
        "currentVersion": 1,
        "activeVersionId": struct_ver_id,
        "createdBy": admin_uid,
        "createdAt": now_iso,
        "updatedAt": now_iso
    }, merge=True)

    db.collection("academicStructureVersions").document(struct_ver_id).set({
        "id": struct_ver_id,
        "structureId": struct_id,
        "versionNumber": 1,
        "academicYear": session_id,
        "effectiveSessionId": session_id,
        "terms": terms,
        "exams": defined_exams,
        "assessmentComponents": assessment_components,
        "gradingScale": grading_scale,
        "reportCardLayout": {
            "header": {"schoolName": "PRESTIGE INTERNATIONAL SCHOOL", "subHeader": "Affiliated to CBSE, New Delhi (Affiliation No: 830123)"},
            "showQrCode": True,
            "showGradeScale": True
        },
        "scholasticTableConfig": {
            "term1Columns": [
                {"id": "col_pt", "header": "PT (10)", "maxMarks": 10, "order": 1},
                {"id": "col_nb", "header": "NB (5)", "maxMarks": 5, "order": 2},
                {"id": "col_sea", "header": "SEA (5)", "maxMarks": 5, "order": 3},
                {"id": "col_th", "header": "Theory (80)", "maxMarks": 80, "order": 4},
                {"id": "col_tot", "header": "Total (100)", "maxMarks": 100, "order": 5},
                {"id": "col_grd", "header": "Grade", "order": 6}
            ]
        },
        "coScholasticAreas": [
            {"id": "work_edu", "name": "Work Education", "scaleId": "3-point"},
            {"id": "art_edu", "name": "Art Education", "scaleId": "3-point"},
            {"id": "health_edu", "name": "Health & Physical Education", "scaleId": "3-point"}
        ],
        "createdAt": now_iso,
        "createdBy": admin_uid
    }, merge=True)

    # 4. FIRESTORE USERS
    print("\n--- Seeding Firestore User Profiles ---")
    db.collection("users").document(admin_uid).set({
        "id": admin_uid,
        "uid": admin_uid,
        "name": "Anas",
        "email": "anasmukka@gmail.com",
        "role": "admin",
        "updatedAt": now_iso
    }, merge=True)

    db.collection("users").document(hod_uid).set({
        "id": hod_uid,
        "uid": hod_uid,
        "name": "Dr. Robert Vance",
        "email": "hod@gmail.com",
        "role": "hod",
        "designation": "Head of Department (High School)",
        "phone": "+919876543201",
        "assignedGrades": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        "updatedAt": now_iso
    }, merge=True)

    db.collection("users").document(classteacher_uid).set({
        "id": classteacher_uid,
        "uid": classteacher_uid,
        "name": "Sarah Jenkins",
        "email": "classteacher@gmail.com",
        "role": "teacher",
        "designation": "Senior Class Teacher (Grade 10-A)",
        "subject": "Mathematics",
        "phone": "+919876543202",
        "updatedAt": now_iso
    }, merge=True)

    db.collection("users").document(teacher_uid).set({
        "id": teacher_uid,
        "uid": teacher_uid,
        "name": "Michael Chang",
        "email": "teacher@gmail.com",
        "role": "teacher",
        "designation": "Subject Teacher (Science)",
        "subject": "Science",
        "phone": "+919876543203",
        "updatedAt": now_iso
    }, merge=True)

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
        "updatedAt": now_iso
    }, merge=True)

    db.collection("users").document(accounts_uid).set({
        "id": accounts_uid,
        "uid": accounts_uid,
        "name": "Finance & Accounts",
        "email": "accounts@gmail.com",
        "role": "accountant",
        "updatedAt": now_iso
    }, merge=True)

    # 5. TEACHERS COLLECTION
    print("\n--- Seeding Teachers Collection ---")
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
        "updatedAt": now_iso
    }, merge=True)

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
        "updatedAt": now_iso
    }, merge=True)

    # 6. SECTIONS
    print("\n--- Seeding Sections ---")
    sections_data = [
        {"id": "sec-10a", "grade": "10", "className": "10", "name": "A", "sectionName": "A", "classTeacherId": classteacher_uid, "classTeacherName": "Sarah Jenkins", "hodId": hod_uid},
        {"id": "sec-10b", "grade": "10", "className": "10", "name": "B", "sectionName": "B", "classTeacherId": "", "classTeacherName": "", "hodId": hod_uid},
        {"id": "sec-9a", "grade": "9", "className": "9", "name": "A", "sectionName": "A", "classTeacherId": "", "classTeacherName": "", "hodId": hod_uid}
    ]
    for s in sections_data:
        db.collection("sections").document(s["id"]).set(s, merge=True)

    # 7. SUBJECTS
    print("\n--- Seeding Subjects for Grade 10 ---")
    subjects_data = [
        {"id": "subj-10-math", "grade": "10", "name": "Mathematics", "order": 1, "category": "scholastic"},
        {"id": "subj-10-sci", "grade": "10", "name": "Science", "order": 2, "category": "scholastic"},
        {"id": "subj-10-eng", "grade": "10", "name": "English Language & Lit", "order": 3, "category": "scholastic"},
        {"id": "subj-10-soc", "grade": "10", "name": "Social Science", "order": 4, "category": "scholastic"},
        {"id": "subj-10-hin", "grade": "10", "name": "Hindi Course-A", "order": 5, "category": "scholastic"}
    ]
    for sub in subjects_data:
        db.collection("subjects").document(sub["id"]).set(sub, merge=True)

    # 8. SUBJECT ASSIGNMENTS
    print("\n--- Seeding Subject Assignments ---")
    assignments = [
        {"id": "assign-10a-math", "subjectId": "subj-10-math", "sectionId": "sec-10a", "teacherId": classteacher_uid},
        {"id": "assign-10a-sci", "subjectId": "subj-10-sci", "sectionId": "sec-10a", "teacherId": teacher_uid},
        {"id": "assign-10a-eng", "subjectId": "subj-10-eng", "sectionId": "sec-10a", "teacherId": teacher_uid},
        {"id": "assign-10a-soc", "subjectId": "subj-10-soc", "sectionId": "sec-10a", "teacherId": teacher_uid},
        {"id": "assign-10a-hin", "subjectId": "subj-10-hin", "sectionId": "sec-10a", "teacherId": classteacher_uid}
    ]
    for a in assignments:
        db.collection("subjectAssignments").document(a["id"]).set(a, merge=True)

    # 9. STUDENT PROFILE
    print("\n--- Seeding Student Profile ---")
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
        "createdAt": now_iso,
        "updatedAt": now_iso
    }, merge=True)

    # 10. ENROLLMENT
    print("\n--- Seeding Active Enrollment ---")
    enroll_id = "enroll-2026-27-aarav"
    db.collection("enrollments").document(enroll_id).set({
        "id": enroll_id,
        "studentId": student_uid,
        "studentUid": student_uid,
        "studentName": "Aarav Sharma",
        "sessionId": session_id,
        "academicYear": session_id,
        "className": "10",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "rollNo": "101",
        "status": "active",
        "hodId": hod_uid,
        "classTeacherId": classteacher_uid,
        "createdAt": now_iso,
        "updatedAt": now_iso
    }, merge=True)

    # 11. FEE STRUCTURE & ASSIGNMENT
    print("\n--- Seeding Fee Structure & Payment ---")
    grade10_fee_id = "struct-grade-10-2026-27"
    db.collection("feeStructures").document(grade10_fee_id).set({
        "id": grade10_fee_id,
        "title": "Grade 10 Annual Fee Structure (2026-27)",
        "grade": "10",
        "academicSessionId": session_id,
        "academicSession": session_id,
        "term": "full_year",
        "feeHeads": [
            {"id": "head-tution-10", "name": "Tuition Fee", "amount": 40000},
            {"id": "head-lab-10", "name": "Science & Computer Lab Fee", "amount": 10000}
        ],
        "terms": [
            {
                "order": 1, "termId": "term_1", "termName": "Term 1",
                "installments": [{"id": "inst-10-t1", "label": "Term 1 Installment", "amount": 25000, "dueDate": "2026-07-15", "termId": "term_1", "termName": "Term 1", "order": 1}]
            },
            {
                "order": 2, "termId": "term_2", "termName": "Term 2",
                "installments": [{"id": "inst-10-t2", "label": "Term 2 Installment", "amount": 25000, "dueDate": "2026-10-30", "termId": "term_2", "termName": "Term 2", "order": 1}]
            }
        ],
        "installments": [
            {"id": "inst-10-t1", "label": "Term 1 Installment", "amount": 25000, "dueDate": "2026-07-15", "termId": "term_1", "termName": "Term 1", "order": 1},
            {"id": "inst-10-t2", "label": "Term 2 Installment", "amount": 25000, "dueDate": "2026-10-30", "termId": "term_2", "termName": "Term 2", "order": 1}
        ],
        "createdAt": now_iso,
        "updatedAt": now_iso
    }, merge=True)

    fee_assign_id = "assign-fee-aarav-2026-27"
    db.collection("studentFeeAssignments").document(fee_assign_id).set({
        "id": fee_assign_id,
        "studentId": student_uid,
        "studentUid": student_uid,
        "studentName": "Aarav Sharma",
        "admissionNo": "ADM202610A001",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "sessionId": session_id,
        "academicYear": session_id,
        "enrollmentId": enroll_id,
        "structureId": grade10_fee_id,
        "structureVersion": 1,
        "grossAmount": 50000,
        "discountAmount": 0,
        "netAmount": 50000,
        "status": "active",
        "installments": [
            {"id": "inst-10-t1", "label": "Term 1 Installment", "amount": 25000, "dueDate": "2026-07-15", "termId": "term_1", "termName": "Term 1", "order": 1},
            {"id": "inst-10-t2", "label": "Term 2 Installment", "amount": 25000, "dueDate": "2026-10-30", "termId": "term_2", "termName": "Term 2", "order": 1}
        ],
        "assignedAt": now_iso,
        "assignedBy": admin_uid,
        "assignedByName": "Anas (Admin)",
        "createdAt": now_iso
    }, merge=True)

    db.collection("feePayments").document("pay-aarav-term1").set({
        "id": "pay-aarav-term1",
        "studentId": student_uid,
        "studentUid": student_uid,
        "authUid": student_uid,
        "studentName": "Aarav Sharma",
        "academicSession": session_id,
        "sessionId": session_id,
        "grade": "10",
        "installmentId": "inst-10-t1",
        "installmentLabel": "Term 1 Installment",
        "amount": 25000,
        "paidAt": "2026-07-10",
        "paymentMode": "online",
        "receiptNo": "RCP-2026-10A-001",
        "reference": "PAY_TERM1_SUCCESS",
        "verificationStatus": "verified",
        "verifiedAt": now_iso,
        "recordedBy": admin_uid,
        "structureId": grade10_fee_id
    }, merge=True)

    # 12. ATTENDANCE & NOTICES
    print("\n--- Seeding Attendance & Notices ---")
    for d in ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]:
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

    db.collection("notices").document("notice-10-exam-schedule").set({
        "id": "notice-10-exam-schedule",
        "title": "Grade 10 Examination Schedule Released",
        "content": "Dear Students and Parents, the official timetable for the secondary examination is now published. Hall tickets are available in the portal.",
        "targetAudience": "students_and_parents",
        "grade": "10",
        "priority": "high",
        "authorName": "Dr. Robert Vance (HOD)",
        "authorRole": "hod",
        "authorId": hod_uid,
        "createdAt": now_iso,
        "published": True
    }, merge=True)

    # 13. SCHEDULE EXAMS
    print("\n--- Seeding Exam Schedules (4 Exams for Grade 10) ---")
    exam_configs = [
        {
            "id": "sched-10-t1-pt1",
            "examType": "Periodic Test 1",
            "definedExamId": "exam-t1-pt1",
            "termId": "term_1",
            "termName": "Term 1",
            "exams": [
                {"subjectId": "subj-10-math", "subjectName": "Mathematics", "date": "2026-07-20", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall A"},
                {"subjectId": "subj-10-sci", "subjectName": "Science", "date": "2026-07-21", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall A"},
                {"subjectId": "subj-10-eng", "subjectName": "English Language & Lit", "date": "2026-07-22", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall A"},
                {"subjectId": "subj-10-soc", "subjectName": "Social Science", "date": "2026-07-23", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall A"},
                {"subjectId": "subj-10-hin", "subjectName": "Hindi Course-A", "date": "2026-07-24", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall A"}
            ]
        },
        {
            "id": "sched-10-t1-hy",
            "examType": "Half-Yearly Examination",
            "definedExamId": "exam-t1-hy",
            "termId": "term_1",
            "termName": "Term 1",
            "exams": [
                {"subjectId": "subj-10-math", "subjectName": "Mathematics", "date": "2026-09-21", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Main Exam Hall"},
                {"subjectId": "subj-10-sci", "subjectName": "Science", "date": "2026-09-23", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Main Exam Hall"},
                {"subjectId": "subj-10-eng", "subjectName": "English Language & Lit", "date": "2026-09-25", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Main Exam Hall"},
                {"subjectId": "subj-10-soc", "subjectName": "Social Science", "date": "2026-09-28", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Main Exam Hall"},
                {"subjectId": "subj-10-hin", "subjectName": "Hindi Course-A", "date": "2026-09-30", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Main Exam Hall"}
            ]
        },
        {
            "id": "sched-10-t2-pt2",
            "examType": "Periodic Test 2",
            "definedExamId": "exam-t2-pt2",
            "termId": "term_2",
            "termName": "Term 2",
            "exams": [
                {"subjectId": "subj-10-math", "subjectName": "Mathematics", "date": "2026-11-16", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall B"},
                {"subjectId": "subj-10-sci", "subjectName": "Science", "date": "2026-11-17", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall B"},
                {"subjectId": "subj-10-eng", "subjectName": "English Language & Lit", "date": "2026-11-18", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall B"},
                {"subjectId": "subj-10-soc", "subjectName": "Social Science", "date": "2026-11-19", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall B"},
                {"subjectId": "subj-10-hin", "subjectName": "Hindi Course-A", "date": "2026-11-20", "startTime": "09:30", "endTime": "11:00", "maxMarks": 40, "passingMarks": 14, "venue": "Hall B"}
            ]
        },
        {
            "id": "sched-10-t2-ann",
            "examType": "Annual Examination",
            "definedExamId": "exam-t2-ann",
            "termId": "term_2",
            "termName": "Term 2",
            "exams": [
                {"subjectId": "subj-10-math", "subjectName": "Mathematics", "date": "2027-02-15", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Auditorium"},
                {"subjectId": "subj-10-sci", "subjectName": "Science", "date": "2027-02-17", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Auditorium"},
                {"subjectId": "subj-10-eng", "subjectName": "English Language & Lit", "date": "2027-02-19", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Auditorium"},
                {"subjectId": "subj-10-soc", "subjectName": "Social Science", "date": "2027-02-22", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Auditorium"},
                {"subjectId": "subj-10-hin", "subjectName": "Hindi Course-A", "date": "2027-02-24", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Auditorium"}
            ]
        }
    ]

    for ec in exam_configs:
        db.collection("examSchedules").document(ec["id"]).set({
            "id": ec["id"],
            "sessionId": session_id,
            "academicYear": session_id,
            "examType": ec["examType"],
            "definedExamId": ec["definedExamId"],
            "termId": ec["termId"],
            "termName": ec["termName"],
            "structureId": struct_id,
            "structureVersion": 1,
            "grade": "10",
            "hodId": hod_uid,
            "hodName": "Dr. Robert Vance",
            "exams": ec["exams"],
            "status": "approved",
            "reviewedBy": admin_uid,
            "reviewedByName": "Anas (Admin)",
            "reviewedAt": now_iso,
            "reviewRemarks": "Curriculum verified and approved for Grade 10-A",
            "createdAt": now_iso,
            "updatedAt": now_iso
        }, merge=True)
        print(f"  [OK] Exam Schedule: {ec['examType']} (Status: approved)")

    # 14. ENTER ALL EXAM MARKS
    print("\n--- Entering Marks for All Subjects & Exams ---")
    # Subject score specifications for student Aarav Sharma
    # High-achieving CBSE student profile
    student_scores = {
        "subj-10-math": {"name": "Mathematics", "pt1": 37, "hy_th": 74, "nb1": 5, "sea1": 5, "pt2": 38, "ann_th": 76, "nb2": 5, "sea2": 5},
        "subj-10-sci": {"name": "Science", "pt1": 36, "hy_th": 72, "nb1": 5, "sea1": 5, "pt2": 37, "ann_th": 75, "nb2": 5, "sea2": 5},
        "subj-10-eng": {"name": "English Language & Lit", "pt1": 38, "hy_th": 75, "nb1": 5, "sea1": 5, "pt2": 39, "ann_th": 77, "nb2": 5, "sea2": 5},
        "subj-10-soc": {"name": "Social Science", "pt1": 35, "hy_th": 70, "nb1": 5, "sea1": 5, "pt2": 36, "ann_th": 72, "nb2": 5, "sea2": 5},
        "subj-10-hin": {"name": "Hindi Course-A", "pt1": 36, "hy_th": 73, "nb1": 5, "sea1": 5, "pt2": 37, "ann_th": 74, "nb2": 5, "sea2": 5}
    }

    # 14A. Periodic Test 1 Marks
    for sub_id, scores in student_scores.items():
        doc_id = f"{session_id}_10_sec-10a_{sub_id}_term_1_exam-t1-pt1_{student_uid}"
        raw = scores["pt1"]
        max_m = 40
        pct = round((raw / max_m) * 100, 2)
        grade = "A1" if pct >= 91 else "A2"
        db.collection("marksEntries").document(doc_id).set({
            "id": doc_id,
            "sessionId": session_id,
            "academicYear": session_id,
            "structureId": struct_id,
            "structureVersion": 1,
            "grade": "10",
            "sectionId": "sec-10a",
            "subjectId": sub_id,
            "termId": "term_1",
            "termName": "Term 1",
            "examId": "exam-t1-pt1",
            "studentUid": student_uid,
            "studentDocId": student_uid,
            "studentId": student_uid,
            "studentName": "Aarav Sharma",
            "rollNo": "101",
            "admissionNo": "ADM202610A001",
            "componentMarks": {
                "comp-pt": {"marks": raw, "status": "present", "remarks": "Very Good"}
            },
            "totalRawMarks": raw,
            "totalMaxMarks": max_m,
            "scaledTotalMarks": round(raw * (10 / 40), 2),
            "calculatedPercentage": pct,
            "calculatedGrade": grade,
            "isAbsent": False,
            "isExempt": False,
            "isPassed": True,
            "workflowStatus": "published",
            "enteredBy": classteacher_uid,
            "enteredAt": now_iso,
            "submittedAt": now_iso,
            "verifiedBy": hod_uid,
            "verifiedAt": now_iso,
            "publishedAt": now_iso
        }, merge=True)

    # 14B. Half-Yearly Marks (PT Scaled + NB + SEA + Theory = 100)
    for sub_id, scores in student_scores.items():
        doc_id = f"{session_id}_10_sec-10a_{sub_id}_term_1_exam-t1-hy_{student_uid}"
        pt_scaled = round(scores["pt1"] * (10 / 40), 2)
        total_100 = pt_scaled + scores["nb1"] + scores["sea1"] + scores["hy_th"]
        pct = round(total_100, 2)
        grade = "A1" if pct >= 91 else "A2"
        db.collection("marksEntries").document(doc_id).set({
            "id": doc_id,
            "sessionId": session_id,
            "academicYear": session_id,
            "structureId": struct_id,
            "structureVersion": 1,
            "grade": "10",
            "sectionId": "sec-10a",
            "subjectId": sub_id,
            "termId": "term_1",
            "termName": "Term 1",
            "examId": "exam-t1-hy",
            "studentUid": student_uid,
            "studentDocId": student_uid,
            "studentId": student_uid,
            "studentName": "Aarav Sharma",
            "rollNo": "101",
            "admissionNo": "ADM202610A001",
            "componentMarks": {
                "comp-pt": {"marks": pt_scaled, "status": "present"},
                "comp-nb": {"marks": scores["nb1"], "status": "present"},
                "comp-sea": {"marks": scores["sea1"], "status": "present"},
                "comp-th": {"marks": scores["hy_th"], "status": "present"}
            },
            "totalRawMarks": round(scores["pt1"] + scores["nb1"] + scores["sea1"] + scores["hy_th"], 2),
            "totalMaxMarks": 130,
            "scaledTotalMarks": total_100,
            "calculatedPercentage": pct,
            "calculatedGrade": grade,
            "isAbsent": False,
            "isExempt": False,
            "isPassed": True,
            "workflowStatus": "published",
            "enteredBy": classteacher_uid,
            "enteredAt": now_iso,
            "submittedAt": now_iso,
            "verifiedBy": hod_uid,
            "verifiedAt": now_iso,
            "publishedAt": now_iso
        }, merge=True)

    # 14C. Periodic Test 2 Marks
    for sub_id, scores in student_scores.items():
        doc_id = f"{session_id}_10_sec-10a_{sub_id}_term_2_exam-t2-pt2_{student_uid}"
        raw = scores["pt2"]
        max_m = 40
        pct = round((raw / max_m) * 100, 2)
        grade = "A1" if pct >= 91 else "A2"
        db.collection("marksEntries").document(doc_id).set({
            "id": doc_id,
            "sessionId": session_id,
            "academicYear": session_id,
            "structureId": struct_id,
            "structureVersion": 1,
            "grade": "10",
            "sectionId": "sec-10a",
            "subjectId": sub_id,
            "termId": "term_2",
            "termName": "Term 2",
            "examId": "exam-t2-pt2",
            "studentUid": student_uid,
            "studentDocId": student_uid,
            "studentId": student_uid,
            "studentName": "Aarav Sharma",
            "rollNo": "101",
            "admissionNo": "ADM202610A001",
            "componentMarks": {
                "comp-pt2": {"marks": raw, "status": "present", "remarks": "Excellent"}
            },
            "totalRawMarks": raw,
            "totalMaxMarks": max_m,
            "scaledTotalMarks": round(raw * (10 / 40), 2),
            "calculatedPercentage": pct,
            "calculatedGrade": grade,
            "isAbsent": False,
            "isExempt": False,
            "isPassed": True,
            "workflowStatus": "published",
            "enteredBy": teacher_uid,
            "enteredAt": now_iso,
            "submittedAt": now_iso,
            "verifiedBy": hod_uid,
            "verifiedAt": now_iso,
            "publishedAt": now_iso
        }, merge=True)

    # 14D. Annual Examination Marks (PT2 Scaled + NB2 + SEA2 + Theory2 = 100)
    for sub_id, scores in student_scores.items():
        doc_id = f"{session_id}_10_sec-10a_{sub_id}_term_2_exam-t2-ann_{student_uid}"
        pt_scaled = round(scores["pt2"] * (10 / 40), 2)
        total_100 = pt_scaled + scores["nb2"] + scores["sea2"] + scores["ann_th"]
        pct = round(total_100, 2)
        grade = "A1" if pct >= 91 else "A2"
        db.collection("marksEntries").document(doc_id).set({
            "id": doc_id,
            "sessionId": session_id,
            "academicYear": session_id,
            "structureId": struct_id,
            "structureVersion": 1,
            "grade": "10",
            "sectionId": "sec-10a",
            "subjectId": sub_id,
            "termId": "term_2",
            "termName": "Term 2",
            "examId": "exam-t2-ann",
            "studentUid": student_uid,
            "studentDocId": student_uid,
            "studentId": student_uid,
            "studentName": "Aarav Sharma",
            "rollNo": "101",
            "admissionNo": "ADM202610A001",
            "componentMarks": {
                "comp-pt2": {"marks": pt_scaled, "status": "present"},
                "comp-nb2": {"marks": scores["nb2"], "status": "present"},
                "comp-sea2": {"marks": scores["sea2"], "status": "present"},
                "comp-th2": {"marks": scores["ann_th"], "status": "present"}
            },
            "totalRawMarks": round(scores["pt2"] + scores["nb2"] + scores["sea2"] + scores["ann_th"], 2),
            "totalMaxMarks": 130,
            "scaledTotalMarks": total_100,
            "calculatedPercentage": pct,
            "calculatedGrade": grade,
            "isAbsent": False,
            "isExempt": False,
            "isPassed": True,
            "workflowStatus": "published",
            "enteredBy": teacher_uid,
            "enteredAt": now_iso,
            "submittedAt": now_iso,
            "verifiedBy": hod_uid,
            "verifiedAt": now_iso,
            "publishedAt": now_iso
        }, merge=True)
    print("  [OK] Successfully entered and published marks for 5 subjects across 4 exams!")

    # 15. PUBLISHED REPORT CARD SNAPSHOTS
    print("\n--- Generating Published Report Card Snapshots ---")
    scholastic_t1 = []
    tot_t1 = 0
    for sub_id, scores in student_scores.items():
        pt_scaled = round(scores["pt1"] * (10 / 40), 2)
        tot = pt_scaled + scores["nb1"] + scores["sea1"] + scores["hy_th"]
        tot_t1 += tot
        scholastic_t1.append({
            "subjectId": sub_id,
            "subjectName": scores["name"],
            "periodicTest": pt_scaled,
            "notebook": scores["nb1"],
            "subjectEnrichment": scores["sea1"],
            "theoryExam": scores["hy_th"],
            "termTotal": tot,
            "termGrade": "A1" if tot >= 91 else "A2",
            "rank": 1
        })

    snapshot_t1 = {
        "id": f"{session_id}_term_1_{student_uid}",
        "period": "term_1",
        "sessionId": session_id,
        "academicYear": session_id,
        "studentId": student_uid,
        "studentUid": student_uid,
        "studentName": "Aarav Sharma",
        "admissionNo": "ADM202610A001",
        "rollNo": "101",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "fatherName": "Dev Sharma",
        "motherName": "Pooja Sharma",
        "dob": "2010-05-15",
        "structureId": struct_id,
        "structureVersionNumber": 1,
        "structureName": "Secondary Wing (CBSE High School)",
        "scholasticResults": scholastic_t1,
        "coScholasticGrades": {
            "Work Education": {"term1": "A", "term2": "A"},
            "Art Education": {"term1": "A", "term2": "A"},
            "Health & Physical Education": {"term1": "A", "term2": "A"}
        },
        "disciplineGrades": {"Discipline": {"term1": "A", "term2": "A"}},
        "grandTotal": tot_t1,
        "grandMax": 500,
        "grandPercentage": round((tot_t1 / 500) * 100, 2),
        "grandGrade": "A1",
        "resultStatus": "PASSED",
        "rank": 1,
        "teacherRemarks": "Outstanding academic performance and exemplary conduct in Term 1.",
        "publishedAt": now_iso,
        "publishedBy": admin_uid,
        "signatures": {
            "classTeacher": {"name": "Sarah Jenkins", "signedAt": now_iso},
            "hod": {"name": "Dr. Robert Vance", "signedAt": now_iso},
            "principal": {"name": "Rev. Dr. Joseph Mathews", "signedAt": now_iso}
        }
    }
    db.collection("publishedReportCards").document(f"{session_id}_term_1_{student_uid}").set(snapshot_t1, merge=True)

    # Annual Report Card Snapshot
    snapshot_ann = dict(snapshot_t1)
    snapshot_ann["id"] = f"{session_id}_annual_{student_uid}"
    snapshot_ann["period"] = "annual"
    snapshot_ann["promotedToGrade"] = "Grade 11"
    snapshot_ann["teacherRemarks"] = "Passed with distinction. Promoted to Senior Secondary (Grade 11)."
    db.collection("publishedReportCards").document(f"{session_id}_annual_{student_uid}").set(snapshot_ann, merge=True)
    db.collection("publishedReportCards").document(f"{session_id}_{student_uid}").set(snapshot_ann, merge=True)
    print("  [OK] Published Report Card Snapshots generated (Term 1 & Annual)")

    # 16. HALL TICKETS
    print("\n--- Generating Hall Tickets ---")
    ht_subjects = [
        {"subjectId": "subj-10-math", "subjectName": "Mathematics", "date": "2026-09-21", "startTime": "09:30", "endTime": "12:30", "room": "Hall A", "seatNumber": "10A-01"},
        {"subjectId": "subj-10-sci", "subjectName": "Science", "date": "2026-09-23", "startTime": "09:30", "endTime": "12:30", "room": "Hall A", "seatNumber": "10A-01"},
        {"subjectId": "subj-10-eng", "subjectName": "English Language & Lit", "date": "2026-09-25", "startTime": "09:30", "endTime": "12:30", "room": "Hall A", "seatNumber": "10A-01"},
        {"subjectId": "subj-10-soc", "subjectName": "Social Science", "date": "2026-09-28", "startTime": "09:30", "endTime": "12:30", "room": "Hall A", "seatNumber": "10A-01"},
        {"subjectId": "subj-10-hin", "subjectName": "Hindi Course-A", "date": "2026-09-30", "startTime": "09:30", "endTime": "12:30", "room": "Hall A", "seatNumber": "10A-01"}
    ]

    ht_doc_id = f"ht-{session_id}-sched-10-t1-hy-{student_uid}"
    db.collection("hallTickets").document(ht_doc_id).set({
        "id": ht_doc_id,
        "ticketNumber": "HT-2026-10A-001",
        "sessionId": session_id,
        "academicYear": session_id,
        "scheduleId": "sched-10-t1-hy",
        "definedExamId": "exam-t1-hy",
        "examName": "Half-Yearly Examination",
        "termId": "term_1",
        "termName": "Term 1",
        "structureId": struct_id,
        "structureVersion": 1,
        "studentId": student_uid,
        "studentUid": student_uid,
        "studentName": "Aarav Sharma",
        "admissionNo": "ADM202610A001",
        "rollNo": "101",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "dob": "2010-05-15",
        "fatherName": "Dev Sharma",
        "motherName": "Pooja Sharma",
        "schoolDetails": {
            "name": "PRESTIGE INTERNATIONAL SCHOOL",
            "affiliationNo": "830123",
            "schoolCode": "45123",
            "address": "42 Prestige Enclave, MG Road, Bangalore 560001",
            "phone": "+91 80 2345 6789",
            "email": "info@prestigegroup.com"
        },
        "scheduledSubjects": ht_subjects,
        "instructions": [
            "Students must arrive 15 minutes before the scheduled exam start time.",
            "This Hall Ticket must be presented for verification at every exam session.",
            "Possession of electronic gadgets or unauthorized study materials is strictly prohibited."
        ],
        "status": "issued",
        "eligibilitySnapshot": {
            "eligible": True,
            "reason": "All academic criteria and Term 1 fee installments satisfied.",
            "totalFee": 50000,
            "totalPaid": 25000,
            "outstanding": 25000,
            "evaluatedAt": now_iso
        },
        "qrCodeData": f"PIS-HT:ADM202610A001:sched-10-t1-hy",
        "generatedAt": now_iso,
        "generatedBy": {"uid": admin_uid, "name": "Anas (Admin)", "role": "admin"}
    }, merge=True)
    print("  [OK] Hall Ticket issued for Half-Yearly Examination")

    print("\n======================================================================")
    print("ALL SEEDING OPERATIONS COMPLETED SUCCESSFULLY FOR PRESTIGE-ERP!")
    print("======================================================================")

if __name__ == "__main__":
    main()

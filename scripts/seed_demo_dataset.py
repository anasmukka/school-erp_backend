import os
import sys
from pathlib import Path
from datetime import datetime, date, timedelta
import firebase_admin
from firebase_admin import credentials, auth, firestore

ROOT_DIR = Path(__file__).resolve().parent.parent
SA_PATH = ROOT_DIR / "backend" / "serviceAccountKey.json"

if not SA_PATH.exists():
    print(f"Service account not found at {SA_PATH}")
    sys.exit(1)

cred = credentials.Certificate(str(SA_PATH))
try:
    firebase_admin.get_app()
except ValueError:
    firebase_admin.initialize_app(cred)

db = firestore.client()

DEMO_PASSWORD = "DemoPassword123!"

print("==================================================")
print("PRESTIGE SCHOOL ERP — DEMO DATASET SEEDER")
print("==================================================")

stats = {}

def track(category, count=1):
    stats[category] = stats.get(category, 0) + count

# ----------------------------------------------------------------------
# 1. AUTHENTICATION & USER ACCOUNTS
# ----------------------------------------------------------------------
print("\n[1/19] Seeding Firebase Authentication & Identity Records...")

DEMO_USERS = [
    {
        "email": "admin.demo@demo.example",
        "displayName": "Dr. Eleanor Vance",
        "role": "admin",
        "designation": "Principal",
        "extra": {"designation": "Principal"}
    },
    {
        "email": "hod.demo@demo.example",
        "displayName": "Prof. Rajesh Sharma",
        "role": "hod",
        "designation": "Head of Department (Secondary)",
        "extra": {"assignedGrades": ["9", "10"]}
    },
    {
        "email": "teacher.class.demo@demo.example",
        "displayName": "Sarah Jenkins",
        "role": "teacher",
        "designation": "Senior Teacher",
        "extra": {"subject": "Mathematics", "assignedGrades": ["9", "10"]}
    },
    {
        "email": "teacher.subject.demo@demo.example",
        "displayName": "David Miller",
        "role": "teacher",
        "designation": "Science Faculty",
        "extra": {"subject": "Science", "assignedGrades": ["9", "10"]}
    },
    {
        "email": "accounts.demo@demo.example",
        "displayName": "Fathima Zahra",
        "role": "accountant",
        "designation": "Senior Accountant",
        "extra": {}
    },
    {
        "email": "printing.demo@demo.example",
        "displayName": "Vikram Patel",
        "role": "printing",
        "designation": "Print Department Head",
        "extra": {}
    },
    {
        "email": "operations.demo@demo.example",
        "displayName": "Anand Verma",
        "role": "operations",
        "designation": "Operations & Inventory Head",
        "extra": {}
    },
    {
        "email": "student.demo@demo.example",
        "displayName": "Aarav Sharma",
        "role": "student",
        "designation": "Student",
        "extra": {"studentUid": "DEMO-STU-001"}
    },
    {
        "email": "student.b.demo@demo.example",
        "displayName": "Rohan Gupta",
        "role": "student",
        "designation": "Student",
        "extra": {"studentUid": "DEMO-STU-002"}
    },
    {
        "email": "parent.demo@demo.example",
        "displayName": "Mohan Sharma",
        "role": "parent",
        "designation": "Parent/Guardian",
        "extra": {"linkedStudentUids": ["DEMO-STU-001"], "studentUids": ["DEMO-STU-001"]}
    },
    {
        "email": "parent.b.demo@demo.example",
        "displayName": "Sunil Gupta",
        "role": "parent",
        "designation": "Parent/Guardian",
        "extra": {"linkedStudentUids": ["DEMO-STU-002"], "studentUids": ["DEMO-STU-002"]}
    },
    {
        "email": "parent.multi.demo@demo.example",
        "displayName": "Pooja Reddy",
        "role": "parent",
        "designation": "Parent (2 Children)",
        "extra": {"linkedStudentUids": ["DEMO-STU-003", "DEMO-STU-004"], "studentUids": ["DEMO-STU-003", "DEMO-STU-004"]}
    }
]

# Clean up any leftover separate principal account if present
try:
    legacy_principal = auth.get_user_by_email("principal.demo@demo.example")
    auth.delete_user(legacy_principal.uid)
    db.collection("users").document(legacy_principal.uid).delete()
    print("Cleaned up temporary principal.demo@demo.example account.")
except Exception:
    pass

created_auth_map = {}

for udata in DEMO_USERS:
    email = udata["email"]
    # Check if already exists in Firebase Auth
    try:
        fb_user = auth.get_user_by_email(email)
        auth.update_user(fb_user.uid, password=DEMO_PASSWORD, display_name=udata["displayName"])
    except auth.UserNotFoundError:
        fb_user = auth.create_user(
            email=email,
            password=DEMO_PASSWORD,
            display_name=udata["displayName"]
        )
    created_auth_map[email] = fb_user.uid
    
    # Save/update Firestore users/{uid}
    user_doc = {
        "id": fb_user.uid,
        "name": udata["displayName"],
        "email": email,
        "role": udata["role"],
        "createdAt": datetime.now().isoformat(),
        **udata["extra"]
    }
    db.collection("users").document(fb_user.uid).set(user_doc, merge=True)
    track("Demo User Accounts")

HOD_UID = created_auth_map["hod.demo@demo.example"]
CLASS_TEACHER_UID = created_auth_map["teacher.class.demo@demo.example"]
SUBJECT_TEACHER_UID = created_auth_map["teacher.subject.demo@demo.example"]
ACCOUNTS_UID = created_auth_map["accounts.demo@demo.example"]
PRINTING_UID = created_auth_map["printing.demo@demo.example"]
OPERATIONS_UID = created_auth_map["operations.demo@demo.example"]
ADMIN_UID = created_auth_map["admin.demo@demo.example"]
PRINCIPAL_UID = ADMIN_UID

# ----------------------------------------------------------------------
# 2. TEACHERS COLLECTION
# ----------------------------------------------------------------------
print("[2/19] Seeding Staff Profiles (teachers collection)...")

teachers_data = [
    {
        "id": CLASS_TEACHER_UID,
        "uid": CLASS_TEACHER_UID,
        "name": "Sarah Jenkins",
        "email": "teacher.class.demo@demo.example",
        "subject": "Mathematics",
        "designation": "Senior Teacher",
        "phone": "+91 98765 43210",
        "DOB": "1988-04-12",
        "address": "42 Orchid Enclave, Bangalore",
        "hodIds": [HOD_UID],
        "hodAssignments": [{"hodId": HOD_UID, "grades": ["9", "10"]}],
        "createdAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": SUBJECT_TEACHER_UID,
        "uid": SUBJECT_TEACHER_UID,
        "name": "David Miller",
        "email": "teacher.subject.demo@demo.example",
        "subject": "Science",
        "designation": "Science Faculty",
        "phone": "+91 98765 43211",
        "DOB": "1990-09-25",
        "address": "15 Maple Towers, Bangalore",
        "hodIds": [HOD_UID],
        "hodAssignments": [{"hodId": HOD_UID, "grades": ["9", "10"]}],
        "createdAt": "2026-06-01T08:00:00.000Z"
    }
]

for t in teachers_data:
    db.collection("teachers").document(t["id"]).set(t)
    track("Teachers")

# ----------------------------------------------------------------------
# 3. ACADEMIC SESSIONS & ACADEMIC YEARS
# ----------------------------------------------------------------------
print("[3/19] Seeding Academic Sessions & Years (Current, Previous, Next)...")

sessions_data = [
    {
        "id": "2025-26",
        "name": "2025-26",
        "startDate": "2025-06-01",
        "endDate": "2026-04-30",
        "status": "archived",
        "isCurrent": False,
        "notes": "Previous completed academic cycle",
        "createdAt": "2025-05-15T00:00:00.000Z"
    },
    {
        "id": "2026-27",
        "name": "2026-27",
        "startDate": "2026-06-01",
        "endDate": "2027-04-30",
        "status": "active",
        "isCurrent": True,
        "notes": "Current active primary academic session",
        "createdAt": "2026-05-15T00:00:00.000Z"
    },
    {
        "id": "2027-28",
        "name": "2027-28",
        "startDate": "2027-06-01",
        "endDate": "2028-03-31",
        "status": "planned",
        "isCurrent": False,
        "notes": "Next upcoming planning cycle",
        "createdAt": "2026-06-01T00:00:00.000Z"
    }
]

for s in sessions_data:
    db.collection("academicSessions").document(s["id"]).set(s)
    db.collection("academicYears").document(s["id"]).set({
        "name": s["name"],
        "startDate": s["startDate"],
        "endDate": s["endDate"],
        "isCurrent": s["isCurrent"],
        "notes": s["notes"],
        "createdAt": s["createdAt"]
    })
    track("Academic Sessions & Years")

# ----------------------------------------------------------------------
# 4. CLASSES & SECTIONS
# ----------------------------------------------------------------------
print("[4/19] Seeding Grades & Sections...")

SECTIONS_CONFIG = [
    {"id": "sec-10a", "grade": "10", "name": "A", "className": "10", "sectionName": "A", "classTeacherId": CLASS_TEACHER_UID, "hodId": HOD_UID},
    {"id": "sec-10b", "grade": "10", "name": "B", "className": "10", "sectionName": "B", "classTeacherId": SUBJECT_TEACHER_UID, "hodId": HOD_UID},
    {"id": "sec-9a", "grade": "9", "name": "A", "className": "9", "sectionName": "A", "classTeacherId": CLASS_TEACHER_UID, "hodId": HOD_UID},
    {"id": "sec-9b", "grade": "9", "name": "B", "className": "9", "sectionName": "B", "classTeacherId": SUBJECT_TEACHER_UID, "hodId": HOD_UID},
    {"id": "sec-9c", "grade": "9", "name": "C", "className": "9", "sectionName": "C", "classTeacherId": "", "hodId": HOD_UID},
    {"id": "sec-8a", "grade": "8", "name": "A", "className": "8", "sectionName": "A", "classTeacherId": "", "hodId": HOD_UID},
    {"id": "sec-8b", "grade": "8", "name": "B", "className": "8", "sectionName": "B", "classTeacherId": "", "hodId": HOD_UID},
    {"id": "sec-5a", "grade": "5", "name": "A", "className": "5", "sectionName": "A", "classTeacherId": "", "hodId": HOD_UID},
    {"id": "sec-5b", "grade": "5", "name": "B", "className": "5", "sectionName": "B", "classTeacherId": "", "hodId": HOD_UID},
    {"id": "sec-5c", "grade": "5", "name": "C", "className": "5", "sectionName": "C", "classTeacherId": "", "hodId": HOD_UID},
    {"id": "sec-1a", "grade": "1", "name": "A", "className": "1", "sectionName": "A", "classTeacherId": "", "hodId": HOD_UID},
    {"id": "sec-1b", "grade": "1", "name": "B", "className": "1", "sectionName": "B", "classTeacherId": "", "hodId": HOD_UID},
]

for sec in SECTIONS_CONFIG:
    db.collection("sections").document(sec["id"]).set(sec)
    track("Sections")

# ----------------------------------------------------------------------
# 5. SUBJECTS & SUBJECT ASSIGNMENTS
# ----------------------------------------------------------------------
print("[5/19] Seeding Subjects & Teacher Assignments...")

SUBJECTS_LIST = [
    # Grade 10
    {"id": "subj-10-math", "grade": "10", "name": "Mathematics", "category": "scholastic", "order": 1},
    {"id": "subj-10-sci", "grade": "10", "name": "Science", "category": "scholastic", "order": 2},
    {"id": "subj-10-eng", "grade": "10", "name": "English Language & Lit", "category": "scholastic", "order": 3},
    {"id": "subj-10-soc", "grade": "10", "name": "Social Science", "category": "scholastic", "order": 4},
    {"id": "subj-10-hin", "grade": "10", "name": "Hindi Course-A", "category": "scholastic", "order": 5},
    # Grade 9
    {"id": "subj-9-math", "grade": "9", "name": "Mathematics", "category": "scholastic", "order": 1},
    {"id": "subj-9-sci", "grade": "9", "name": "Science", "category": "scholastic", "order": 2},
    {"id": "subj-9-eng", "grade": "9", "name": "English", "category": "scholastic", "order": 3},
    # Grade 8
    {"id": "subj-8-math", "grade": "8", "name": "Mathematics", "category": "scholastic", "order": 1},
    {"id": "subj-8-sci", "grade": "8", "name": "Science", "category": "scholastic", "order": 2},
    # Grade 5
    {"id": "subj-5-math", "grade": "5", "name": "Mathematics", "category": "scholastic", "order": 1},
    {"id": "subj-5-eng", "grade": "5", "name": "English", "category": "scholastic", "order": 2},
    {"id": "subj-5-evs", "grade": "5", "name": "Environmental Studies", "category": "scholastic", "order": 3},
    # Grade 1
    {"id": "subj-1-eng", "grade": "1", "name": "English", "category": "scholastic", "order": 1},
    {"id": "subj-1-math", "grade": "1", "name": "Numeracy & Math", "category": "scholastic", "order": 2},
]

for s in SUBJECTS_LIST:
    db.collection("subjects").document(s["id"]).set(s)
    track("Subjects")

ASSIGNMENTS_LIST = [
    # 10-A
    {"id": "assign-10a-math", "subjectId": "subj-10-math", "sectionId": "sec-10a", "teacherId": CLASS_TEACHER_UID, "academicYear": "2026-27"},
    {"id": "assign-10a-sci", "subjectId": "subj-10-sci", "sectionId": "sec-10a", "teacherId": SUBJECT_TEACHER_UID, "academicYear": "2026-27"},
    {"id": "assign-10a-eng", "subjectId": "subj-10-eng", "sectionId": "sec-10a", "teacherId": CLASS_TEACHER_UID, "academicYear": "2026-27"},
    # 10-B
    {"id": "assign-10b-math", "subjectId": "subj-10-math", "sectionId": "sec-10b", "teacherId": CLASS_TEACHER_UID, "academicYear": "2026-27"},
    {"id": "assign-10b-sci", "subjectId": "subj-10-sci", "sectionId": "sec-10b", "teacherId": SUBJECT_TEACHER_UID, "academicYear": "2026-27"},
    # 9-A
    {"id": "assign-9a-math", "subjectId": "subj-9-math", "sectionId": "sec-9a", "teacherId": CLASS_TEACHER_UID, "academicYear": "2026-27"},
    {"id": "assign-9a-sci", "subjectId": "subj-9-sci", "sectionId": "sec-9a", "teacherId": SUBJECT_TEACHER_UID, "academicYear": "2026-27"},
]

for a in ASSIGNMENTS_LIST:
    db.collection("subjectAssignments").document(a["id"]).set(a)
    track("Subject Assignments")

# ----------------------------------------------------------------------
# 6. ACADEMIC STRUCTURE PLANNER (Secondary & Primary)
# ----------------------------------------------------------------------
print("[6/19] Seeding Academic Structures, Terms, Defined Exams & Assessment Components...")

sec_terms = [
    {
        "id": "term_1",
        "name": "Term 1",
        "code": "T1",
        "order": 1,
        "startDate": "2026-06-01",
        "endDate": "2026-10-31",
        "status": "open",
        "examIds": ["exam-t1-pt1", "exam-t1-hy"],
        "assessmentComponentIds": ["comp-pt", "comp-nb", "comp-sea", "comp-th"],
        "maxMarks": 100
    },
    {
        "id": "term_2",
        "name": "Term 2",
        "code": "T2",
        "order": 2,
        "startDate": "2026-11-01",
        "endDate": "2027-04-15",
        "status": "not_started",
        "examIds": ["exam-t2-pt2", "exam-t2-ann"],
        "assessmentComponentIds": ["comp-pt2", "comp-nb2", "comp-sea2", "comp-th2"],
        "maxMarks": 100
    }
]

sec_exams = [
    {
        "id": "exam-t1-pt1",
        "termId": "term_1",
        "name": "Periodic Test 1",
        "code": "PT1",
        "term": "term1",
        "order": 1,
        "weightagePercentage": 20,
        "applicableComponentIds": ["comp-pt"]
    },
    {
        "id": "exam-t1-hy",
        "termId": "term_1",
        "name": "Half-Yearly Examination",
        "code": "HY",
        "term": "term1",
        "order": 2,
        "weightagePercentage": 80,
        "applicableComponentIds": ["comp-pt", "comp-nb", "comp-sea", "comp-th"]
    },
    {
        "id": "exam-t2-pt2",
        "termId": "term_2",
        "name": "Periodic Test 2",
        "code": "PT2",
        "term": "term2",
        "order": 1,
        "weightagePercentage": 20,
        "applicableComponentIds": ["comp-pt2"]
    },
    {
        "id": "exam-t2-ann",
        "termId": "term_2",
        "name": "Annual Examination",
        "code": "ANN",
        "term": "term2",
        "order": 2,
        "weightagePercentage": 80,
        "applicableComponentIds": ["comp-pt2", "comp-nb2", "comp-sea2", "comp-th2"]
    }
]

sec_components = [
    {
        "id": "comp-pt",
        "name": "Periodic Test (PT)",
        "code": "PT",
        "maxMarks": 10,
        "testedMaxMarks": 40,
        "scalingTargetMarks": 10,
        "calculationMethod": "scaled",
        "weightage": 10,
        "contributeToTotal": True,
        "displayOnReportCard": True,
        "order": 1,
        "applicableTermId": "term_1",
        "applicableExamId": "exam-t1-hy"
    },
    {
        "id": "comp-nb",
        "name": "Notebook Submission",
        "code": "NB",
        "maxMarks": 5,
        "weightage": 5,
        "contributeToTotal": True,
        "displayOnReportCard": True,
        "order": 2,
        "applicableTermId": "term_1",
        "applicableExamId": "exam-t1-hy"
    },
    {
        "id": "comp-sea",
        "name": "Subject Enrichment Activity",
        "code": "SEA",
        "maxMarks": 5,
        "weightage": 5,
        "contributeToTotal": True,
        "displayOnReportCard": True,
        "order": 3,
        "applicableTermId": "term_1",
        "applicableExamId": "exam-t1-hy"
    },
    {
        "id": "comp-th",
        "name": "Theory Exam (Half-Yearly)",
        "code": "TH",
        "maxMarks": 80,
        "weightage": 80,
        "contributeToTotal": True,
        "displayOnReportCard": True,
        "order": 4,
        "applicableTermId": "term_1",
        "applicableExamId": "exam-t1-hy"
    },
    # Term 2 components
    {
        "id": "comp-pt2",
        "name": "Periodic Test 2 (PT)",
        "code": "PT",
        "maxMarks": 10,
        "testedMaxMarks": 40,
        "scalingTargetMarks": 10,
        "calculationMethod": "scaled",
        "weightage": 10,
        "contributeToTotal": True,
        "displayOnReportCard": True,
        "order": 1,
        "applicableTermId": "term_2",
        "applicableExamId": "exam-t2-ann"
    },
    {
        "id": "comp-nb2",
        "name": "Notebook Submission (T2)",
        "code": "NB",
        "maxMarks": 5,
        "weightage": 5,
        "contributeToTotal": True,
        "displayOnReportCard": True,
        "order": 2,
        "applicableTermId": "term_2",
        "applicableExamId": "exam-t2-ann"
    },
    {
        "id": "comp-sea2",
        "name": "Subject Enrichment Activity (T2)",
        "code": "SEA",
        "maxMarks": 5,
        "weightage": 5,
        "contributeToTotal": True,
        "displayOnReportCard": True,
        "order": 3,
        "applicableTermId": "term_2",
        "applicableExamId": "exam-t2-ann"
    },
    {
        "id": "comp-th2",
        "name": "Theory Exam (Annual)",
        "code": "TH",
        "maxMarks": 80,
        "weightage": 80,
        "contributeToTotal": True,
        "displayOnReportCard": True,
        "order": 4,
        "applicableTermId": "term_2",
        "applicableExamId": "exam-t2-ann"
    }
]

secondary_structure = {
    "id": "struct-secondary",
    "name": "Secondary Wing (CBSE High School)",
    "description": "Standard CBSE curriculum structure for Grades 9 and 10",
    "sessionId": "2026-27",
    "academicYear": "2026-27",
    "applicableGrades": ["9", "10"],
    "status": "active",
    "currentVersion": 1,
    "activeVersionId": "struct-secondary_v1",
    "createdAt": "2026-06-01T08:00:00.000Z",
    "updatedAt": "2026-06-01T08:00:00.000Z",
    "createdBy": ADMIN_UID
}

secondary_version = {
    "id": "struct-secondary_v1",
    "structureId": "struct-secondary",
    "versionNumber": 1,
    "effectiveSessionId": "2026-27",
    "academicYear": "2026-27",
    "terms": sec_terms,
    "subjects": [
        {"subjectId": "subj-10-math", "subjectName": "Mathematics", "category": "scholastic", "order": 1, "enabledOnReportCard": True},
        {"subjectId": "subj-10-sci", "subjectName": "Science", "category": "scholastic", "order": 2, "enabledOnReportCard": True},
        {"subjectId": "subj-10-eng", "subjectName": "English Language & Lit", "category": "scholastic", "order": 3, "enabledOnReportCard": True},
        {"subjectId": "subj-10-soc", "subjectName": "Social Science", "category": "scholastic", "order": 4, "enabledOnReportCard": True},
        {"subjectId": "subj-10-hin", "subjectName": "Hindi Course-A", "category": "scholastic", "order": 5, "enabledOnReportCard": True},
    ],
    "exams": sec_exams,
    "assessmentComponents": sec_components,
    "calculationConfig": {
        "componentRules": {
            "comp-pt": {"scalingMode": "scaled_to_target", "targetScaleMarks": 10, "mandatoryForPass": False},
            "comp-nb": {"scalingMode": "raw", "targetScaleMarks": 5, "mandatoryForPass": False},
            "comp-sea": {"scalingMode": "raw", "targetScaleMarks": 5, "mandatoryForPass": False},
            "comp-th": {"scalingMode": "raw", "targetScaleMarks": 80, "mandatoryForPass": True, "minPassingPercentage": 33},
            "comp-pt2": {"scalingMode": "scaled_to_target", "targetScaleMarks": 10, "mandatoryForPass": False},
            "comp-nb2": {"scalingMode": "raw", "targetScaleMarks": 5, "mandatoryForPass": False},
            "comp-sea2": {"scalingMode": "raw", "targetScaleMarks": 5, "mandatoryForPass": False},
            "comp-th2": {"scalingMode": "raw", "targetScaleMarks": 80, "mandatoryForPass": True, "minPassingPercentage": 33}
        },
        "examAggregation": {"mode": "raw_sum"},
        "termAggregation": {
            "mode": "equal_average",
            "termWeights": {"term1": 50, "term2": 50}
        },
        "rounding": {"method": "round_half_up", "decimalPlaces": 1},
        "passingCriteria": {
            "overallPassingPercentage": 33,
            "requirePassInAllSubjects": True,
            "compartmentThresholdCount": 2
        }
    },
    "gradingScale": {
        "id": "cbse-8-point",
        "name": "CBSE 8-Point Scale",
        "passingPercentage": 33,
        "tiers": [
            {"grade": "A1", "minPercentage": 91, "maxPercentage": 100, "gradePoint": 10, "description": "Outstanding"},
            {"grade": "A2", "minPercentage": 81, "maxPercentage": 90.99, "gradePoint": 9, "description": "Excellent"},
            {"grade": "B1", "minPercentage": 71, "maxPercentage": 80.99, "gradePoint": 8, "description": "Very Good"},
            {"grade": "B2", "minPercentage": 61, "maxPercentage": 70.99, "gradePoint": 7, "description": "Good"},
            {"grade": "C1", "minPercentage": 51, "maxPercentage": 60.99, "gradePoint": 6, "description": "Fair"},
            {"grade": "C2", "minPercentage": 41, "maxPercentage": 50.99, "gradePoint": 5, "description": "Average"},
            {"grade": "D",  "minPercentage": 33, "maxPercentage": 40.99, "gradePoint": 4, "description": "Pass"},
            {"grade": "E",  "minPercentage": 0,  "maxPercentage": 32.99, "gradePoint": 0, "description": "Essential Repeat"}
        ]
    },
    "discreteGradingScales": [
        {
            "id": "scale-3-point",
            "name": "3-Point Scale (A, B, C)",
            "tiers": [
                {"grade": "A", "description": "Outstanding", "order": 1},
                {"grade": "B", "description": "Very Good", "order": 2},
                {"grade": "C", "description": "Fair", "order": 3}
            ]
        }
    ],
    "coScholasticAreas": [
        {"id": "cosch-work-ed", "name": "Work Education (Pre-Vocational)", "category": "co-scholastic", "scale": "3-point", "order": 1},
        {"id": "cosch-art-ed", "name": "Art Education (Visual & Performing)", "category": "co-scholastic", "scale": "3-point", "order": 2},
        {"id": "cosch-health-pe", "name": "Health & Physical Education", "category": "co-scholastic", "scale": "3-point", "order": 3},
        {"id": "cosch-discipline", "name": "Discipline (Attendance & Values)", "category": "discipline", "scale": "3-point", "order": 4}
    ],
    "reportCardLayout": {
        "schoolName": "PRESTIGE INTERNATIONAL SCHOOL",
        "affiliationNo": "CBSE AFFILIATION NO. 930123",
        "schoolAddress": "Affiliated to CBSE, New Delhi — Senior Secondary Sector",
        "tagline": "SCALING NEW HEIGHTS WITH EXCELLENCE",
        "showSchoolLogo": True,
        "showBoardLogo": True,
        "gradingScalePlacement": "back_page",
        "signatureSlots": [
            {"role": "class_teacher", "label": "Class Teacher", "required": True},
            {"role": "hod", "label": "Head of Department", "required": True},
            {"role": "principal", "label": "Principal", "required": True}
        ],
        "sections": [
            {"id": "sec-header", "type": "header", "title": "School Header", "enabled": True, "order": 1},
            {"id": "sec-student-info", "type": "student_info", "title": "Student Profile", "enabled": True, "order": 2},
            {"id": "sec-scholastic", "type": "scholastic_table", "title": "Scholastic Performance", "enabled": True, "order": 3},
            {"id": "sec-co-scholastic", "type": "co_scholastic", "title": "Co-Scholastic Activities", "enabled": True, "order": 4},
            {"id": "sec-discipline", "type": "discipline", "title": "Discipline", "enabled": True, "order": 5},
            {"id": "sec-remarks", "type": "remarks", "title": "Remarks", "enabled": True, "order": 6},
            {"id": "sec-signatures", "type": "signatures", "title": "Signatures", "enabled": True, "order": 7}
        ]
    },
    "createdAt": "2026-06-01T08:00:00.000Z",
    "createdBy": ADMIN_UID
}

db.collection("academicStructures").document("struct-secondary").set(secondary_structure)
db.collection("academicStructureVersions").document("struct-secondary_v1").set(secondary_version)
track("Academic Structures")
track("Academic Structure Versions")

# Also seed defined exams in legacy exams collection for backward compatibility
for de in sec_exams:
    exam_doc = {
        "id": de["id"],
        "examType": de["name"],
        "grade": "10",
        "termId": de["termId"],
        "order": de["order"],
        "hodId": HOD_UID,
        "date": "2026-09-15"
    }
    db.collection("exams").document(de["id"]).set(exam_doc)
    track("Exams")

# ----------------------------------------------------------------------
# 7. STUDENTS & ENROLLMENTS (40 Students across grades)
# ----------------------------------------------------------------------
print("[7/19] Seeding 40 Fictional Students with Profiles & Enrollments...")

STUDENTS_METADATA = [
    # Grade 10-A (15 students)
    {"uid": "DEMO-STU-001", "name": "Aarav Sharma", "adm": "DEMO-ADM-2026-001", "roll": "1", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-05-14", "gender": "male", "father": "Mohan Sharma", "mother": "Kavita Sharma", "phone": "+91 98765 00001", "authEmail": "student.demo@demo.example"},
    {"uid": "DEMO-STU-002", "name": "Rohan Gupta", "adm": "DEMO-ADM-2026-002", "roll": "2", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-08-20", "gender": "male", "father": "Sunil Gupta", "mother": "Anita Gupta", "phone": "+91 98765 00002", "authEmail": "student.b.demo@demo.example"},
    {"uid": "DEMO-STU-003", "name": "Priya Reddy", "adm": "DEMO-ADM-2026-003", "roll": "3", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-03-11", "gender": "female", "father": "Kishore Reddy", "mother": "Pooja Reddy", "phone": "+91 98765 00003"},
    {"uid": "DEMO-STU-004", "name": "Rahul Reddy", "adm": "DEMO-ADM-2026-004", "roll": "4", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-03-11", "gender": "male", "father": "Kishore Reddy", "mother": "Pooja Reddy", "phone": "+91 98765 00003"},
    {"uid": "DEMO-STU-005", "name": "Ananya Verma", "adm": "DEMO-ADM-2026-005", "roll": "5", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-11-04", "gender": "female", "father": "Ramesh Verma", "mother": "Sita Verma", "phone": "+91 98765 00005"},
    {"uid": "DEMO-STU-006", "name": "Kabir Das", "adm": "DEMO-ADM-2026-006", "roll": "6", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-07-19", "gender": "male", "father": "Alok Das", "mother": "Meena Das", "phone": "+91 98765 00006"},
    {"uid": "DEMO-STU-007", "name": "Sneha Iyer", "adm": "DEMO-ADM-2026-007", "roll": "7", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-01-28", "gender": "female", "father": "Venkatesh Iyer", "mother": "Lakshmi Iyer", "phone": "+91 98765 00007"},
    {"uid": "DEMO-STU-008", "name": "Aditya Nair", "adm": "DEMO-ADM-2026-008", "roll": "8", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-09-15", "gender": "male", "father": "Girish Nair", "mother": "Radha Nair", "phone": "+91 98765 00008"},
    {"uid": "DEMO-STU-009", "name": "Meera Menon", "adm": "DEMO-ADM-2026-009", "roll": "9", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-12-02", "gender": "female", "father": "Unni Menon", "mother": "Deepa Menon", "phone": "+91 98765 00009"},
    {"uid": "DEMO-STU-010", "name": "Varun Joshi", "adm": "DEMO-ADM-2026-010", "roll": "10", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-04-17", "gender": "male", "father": "Prakash Joshi", "mother": "Shashi Joshi", "phone": "+91 98765 00010"},
    {"uid": "DEMO-STU-011", "name": "Diya Sen", "adm": "DEMO-ADM-2026-011", "roll": "11", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-06-30", "gender": "female", "father": "Subhash Sen", "mother": "Aparna Sen", "phone": "+91 98765 00011"},
    {"uid": "DEMO-STU-012", "name": "Siddharth Rao", "adm": "DEMO-ADM-2026-012", "roll": "12", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-10-10", "gender": "male", "father": "Madhav Rao", "mother": "Vidya Rao", "phone": "+91 98765 00012"},
    {"uid": "DEMO-STU-013", "name": "Ishita Saxena", "adm": "DEMO-ADM-2026-013", "roll": "13", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-02-14", "gender": "female", "father": "Anand Saxena", "mother": "Richa Saxena", "phone": "+91 98765 00013"},
    {"uid": "DEMO-STU-014", "name": "Karthik Pillai", "adm": "DEMO-ADM-2026-014", "roll": "14", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-07-08", "gender": "male", "father": "Murugan Pillai", "mother": "Geetha Pillai", "phone": "+91 98765 00014"},
    {"uid": "DEMO-STU-015", "name": "Tanvi Bhat", "adm": "DEMO-ADM-2026-015", "roll": "15", "grade": "10", "sec": "A", "secId": "sec-10a", "dob": "2010-11-23", "gender": "female", "father": "Nagesh Bhat", "mother": "Uma Bhat", "phone": "+91 98765 00015"},

    # Grade 10-B (8 students)
    {"uid": "DEMO-STU-016", "name": "Devansh Kulkarni", "adm": "DEMO-ADM-2026-016", "roll": "1", "grade": "10", "sec": "B", "secId": "sec-10b", "dob": "2010-03-29", "gender": "male", "father": "Ajay Kulkarni", "mother": "Smita Kulkarni", "phone": "+91 98765 00016"},
    {"uid": "DEMO-STU-017", "name": "Aanya Kapoor", "adm": "DEMO-ADM-2026-017", "roll": "2", "grade": "10", "sec": "B", "secId": "sec-10b", "dob": "2010-05-18", "gender": "female", "father": "Sanjay Kapoor", "mother": "Ritu Kapoor", "phone": "+91 98765 00017"},
    {"uid": "DEMO-STU-018", "name": "Nikhil Agarwal", "adm": "DEMO-ADM-2026-018", "roll": "3", "grade": "10", "sec": "B", "secId": "sec-10b", "dob": "2010-09-03", "gender": "male", "father": "Vijay Agarwal", "mother": "Saroj Agarwal", "phone": "+91 98765 00018"},
    {"uid": "DEMO-STU-019", "name": "Sanya Chopra", "adm": "DEMO-ADM-2026-019", "roll": "4", "grade": "10", "sec": "B", "secId": "sec-10b", "dob": "2010-01-12", "gender": "female", "father": "Rajiv Chopra", "mother": "Neelam Chopra", "phone": "+91 98765 00019"},
    {"uid": "DEMO-STU-020", "name": "Manish Tiwari", "adm": "DEMO-ADM-2026-020", "roll": "5", "grade": "10", "sec": "B", "secId": "sec-10b", "dob": "2010-12-25", "gender": "male", "father": "Dinesh Tiwari", "mother": "Kamla Tiwari", "phone": "+91 98765 00020"},
    {"uid": "DEMO-STU-021", "name": "Rhea D'Souza", "adm": "DEMO-ADM-2026-021", "roll": "6", "grade": "10", "sec": "B", "secId": "sec-10b", "dob": "2010-04-05", "gender": "female", "father": "Anthony D'Souza", "mother": "Maria D'Souza", "phone": "+91 98765 00021"},
    {"uid": "DEMO-STU-022", "name": "Tushar Bansal", "adm": "DEMO-ADM-2026-022", "roll": "7", "grade": "10", "sec": "B", "secId": "sec-10b", "dob": "2010-08-14", "gender": "male", "father": "Harish Bansal", "mother": "Suman Bansal", "phone": "+91 98765 00022"},
    {"uid": "DEMO-STU-023", "name": "Kavya Pandey", "adm": "DEMO-ADM-2026-023", "roll": "8", "grade": "10", "sec": "B", "secId": "sec-10b", "dob": "2010-06-22", "gender": "female", "father": "Naveen Pandey", "mother": "Tara Pandey", "phone": "+91 98765 00023"},

    # Grade 9-A (7 students)
    {"uid": "DEMO-STU-024", "name": "Arjun Singhania", "adm": "DEMO-ADM-2026-024", "roll": "1", "grade": "9", "sec": "A", "secId": "sec-9a", "dob": "2011-03-10", "gender": "male", "father": "Dev Singhania", "mother": "Nalini Singhania", "phone": "+91 98765 00024"},
    {"uid": "DEMO-STU-025", "name": "Bhavya Trivedi", "adm": "DEMO-ADM-2026-025", "roll": "2", "grade": "9", "sec": "A", "secId": "sec-9a", "dob": "2011-07-21", "gender": "female", "father": "Ashwin Trivedi", "mother": "Bela Trivedi", "phone": "+91 98765 00025"},
    {"uid": "DEMO-STU-026", "name": "Chirag Mehta", "adm": "DEMO-ADM-2026-026", "roll": "3", "grade": "9", "sec": "A", "secId": "sec-9a", "dob": "2011-10-15", "gender": "male", "father": "Bhavesh Mehta", "mother": "Chetna Mehta", "phone": "+91 98765 00026"},
    {"uid": "DEMO-STU-027", "name": "Deepika Bhatt", "adm": "DEMO-ADM-2026-027", "roll": "4", "grade": "9", "sec": "A", "secId": "sec-9a", "dob": "2011-01-09", "gender": "female", "father": "Kishore Bhatt", "mother": "Leela Bhatt", "phone": "+91 98765 00027"},
    {"uid": "DEMO-STU-028", "name": "Eshan Qureshi", "adm": "DEMO-ADM-2026-028", "roll": "5", "grade": "9", "sec": "A", "secId": "sec-9a", "dob": "2011-05-27", "gender": "male", "father": "Farhan Qureshi", "mother": "Yasmin Qureshi", "phone": "+91 98765 00028"},
    {"uid": "DEMO-STU-029", "name": "Farida Khan", "adm": "DEMO-ADM-2026-029", "roll": "6", "grade": "9", "sec": "A", "secId": "sec-9a", "dob": "2011-09-18", "gender": "female", "father": "Imran Khan", "mother": "Zeenat Khan", "phone": "+91 98765 00029"},
    {"uid": "DEMO-STU-030", "name": "Gaurav Soni", "adm": "DEMO-ADM-2026-030", "roll": "7", "grade": "9", "sec": "A", "secId": "sec-9a", "dob": "2011-11-30", "gender": "male", "father": "Mukesh Soni", "mother": "Renuka Soni", "phone": "+91 98765 00030"},

    # Grade 8-A (4 students)
    {"uid": "DEMO-STU-031", "name": "Harshvardhan Patil", "adm": "DEMO-ADM-2026-031", "roll": "1", "grade": "8", "sec": "A", "secId": "sec-8a", "dob": "2012-04-12", "gender": "male", "father": "Pradeep Patil", "mother": "Sunanda Patil", "phone": "+91 98765 00031"},
    {"uid": "DEMO-STU-032", "name": "Isha Deshmukh", "adm": "DEMO-ADM-2026-032", "roll": "2", "grade": "8", "sec": "A", "secId": "sec-8a", "dob": "2012-08-08", "gender": "female", "father": "Sharad Deshmukh", "mother": "Anjali Deshmukh", "phone": "+91 98765 00032"},
    {"uid": "DEMO-STU-033", "name": "Jatin Nambiar", "adm": "DEMO-ADM-2026-033", "roll": "3", "grade": "8", "sec": "A", "secId": "sec-8a", "dob": "2012-12-14", "gender": "male", "father": "Raghavan Nambiar", "mother": "Sudha Nambiar", "phone": "+91 98765 00033"},
    {"uid": "DEMO-STU-034", "name": "Khushi Jain", "adm": "DEMO-ADM-2026-034", "roll": "4", "grade": "8", "sec": "A", "secId": "sec-8a", "dob": "2012-02-28", "gender": "female", "father": "Hemant Jain", "mother": "Pratibha Jain", "phone": "+91 98765 00034"},

    # Grade 5-A (4 students)
    {"uid": "DEMO-STU-035", "name": "Lakshya Goswami", "adm": "DEMO-ADM-2026-035", "roll": "1", "grade": "5", "sec": "A", "secId": "sec-5a", "dob": "2015-06-15", "gender": "male", "father": "Kishore Goswami", "mother": "Madhuri Goswami", "phone": "+91 98765 00035"},
    {"uid": "DEMO-STU-036", "name": "Manvi Rawat", "adm": "DEMO-ADM-2026-036", "roll": "2", "grade": "5", "sec": "A", "secId": "sec-5a", "dob": "2015-09-22", "gender": "female", "father": "Surendra Rawat", "mother": "Kamlesh Rawat", "phone": "+91 98765 00036"},
    {"uid": "DEMO-STU-037", "name": "Neel Chauhan", "adm": "DEMO-ADM-2026-037", "roll": "3", "grade": "5", "sec": "A", "secId": "sec-5a", "dob": "2015-01-19", "gender": "male", "father": "Vikram Chauhan", "mother": "Poonam Chauhan", "phone": "+91 98765 00037"},
    {"uid": "DEMO-STU-038", "name": "Ojasvi Shukla", "adm": "DEMO-ADM-2026-038", "roll": "4", "grade": "5", "sec": "A", "secId": "sec-5a", "dob": "2015-11-05", "gender": "female", "father": "Satish Shukla", "mother": "Archana Shukla", "phone": "+91 98765 00038"},

    # Grade 1-A (2 students)
    {"uid": "DEMO-STU-039", "name": "Pranav Hegde", "adm": "DEMO-ADM-2026-039", "roll": "1", "grade": "1", "sec": "A", "secId": "sec-1a", "dob": "2019-07-25", "gender": "male", "father": "Ganesh Hegde", "mother": "Sowmya Hegde", "phone": "+91 98765 00039"},
    {"uid": "DEMO-STU-040", "name": "Riddhi Barua", "adm": "DEMO-ADM-2026-040", "roll": "2", "grade": "1", "sec": "A", "secId": "sec-1a", "dob": "2019-10-18", "gender": "female", "father": "Prabhat Barua", "mother": "Anamika Barua", "phone": "+91 98765 00040"}
]

for s in STUDENTS_METADATA:
    # Student record in students
    auth_uid = created_auth_map.get(s.get("authEmail", ""))
    student_doc = {
        "id": s["uid"],
        "studentUid": s["uid"],
        "name": s["name"],
        "admissionNo": s["adm"],
        "rollNo": s["roll"],
        "grade": s["grade"],
        "sectionId": s["secId"],
        "DOB": s["dob"],
        "gender": s["gender"],
        "fatherName": s["father"],
        "motherName": s["mother"],
        "parentContact": s["phone"],
        "address": f"Demo Residence #{s['roll']}, Prestige Avenue, Bangalore",
        "hodId": HOD_UID,
        "photo": "https://api.dicebear.com/7.x/bottts/svg?seed=" + s["uid"],
        "createdAt": "2026-06-01T08:00:00.000Z",
        **({"authUid": auth_uid} if auth_uid else {})
    }
    db.collection("students").document(s["uid"]).set(student_doc)
    track("Students")

    # Active enrollment in enrollments
    enr_id = f"enr-2026-{s['uid'].lower()}"
    enr_doc = {
        "id": enr_id,
        "studentId": s["uid"],
        "studentUid": s["uid"],
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "className": s["grade"],
        "sectionName": s["sec"],
        "sectionId": s["secId"],
        "rollNo": s["roll"],
        "hodId": HOD_UID,
        "status": "active",
        "createdAt": "2026-06-01T08:00:00.000Z"
    }
    db.collection("enrollments").document(enr_id).set(enr_doc)
    track("Enrollments")

    # For senior Grade 10 students, add previous year historical enrollment
    if s["grade"] == "10":
        hist_enr_id = f"enr-2025-{s['uid'].lower()}"
        hist_enr_doc = {
            "id": hist_enr_id,
            "studentId": s["uid"],
            "studentUid": s["uid"],
            "sessionId": "2025-26",
            "academicYear": "2025-26",
            "className": "9",
            "sectionName": s["sec"],
            "sectionId": f"sec-9{s['sec'].lower()}",
            "rollNo": s["roll"],
            "hodId": HOD_UID,
            "status": "promoted",
            "createdAt": "2025-06-01T08:00:00.000Z"
        }
        db.collection("enrollments").document(hist_enr_id).set(hist_enr_doc)
        track("Historical Enrollments (2025-26)")

# ----------------------------------------------------------------------
# 8. ADMISSIONS (Multiple workflow states)
# ----------------------------------------------------------------------
print("[8/19] Seeding Admissions in various lifecycle states...")

ADMISSIONS_DATA = [
    {
        "id": "DEMO-ADM-APP-001",
        "admissionNo": "DEMO-ADM-2026-001",
        "studentName": "Aarav Sharma",
        "grade": "10",
        "academicYear": "2026-27",
        "status": "approved",
        "parentName": "Mohan Sharma",
        "parentPhone": "+91 98765 00001",
        "parentEmail": "parent.demo@demo.example",
        "previousSchool": "Greenwood Public School",
        "documents": [{"name": "Transfer Certificate", "verified": True}],
        "paymentStatus": "paid",
        "resultingStudentUid": "DEMO-STU-001",
        "createdAt": "2026-05-10T10:00:00.000Z"
    },
    {
        "id": "DEMO-ADM-APP-002",
        "admissionNo": "DEMO-ADM-2026-041",
        "studentName": "Vikrant Mehra",
        "grade": "9",
        "academicYear": "2026-27",
        "status": "shortlisted",
        "parentName": "Rajan Mehra",
        "parentPhone": "+91 98765 00041",
        "parentEmail": "rajan.mehra@demo.example",
        "previousSchool": "Delhi Public School",
        "documents": [{"name": "Birth Certificate", "verified": True}, {"name": "Marksheet", "verified": True}],
        "paymentStatus": "paid",
        "createdAt": "2026-05-18T14:30:00.000Z"
    },
    {
        "id": "DEMO-ADM-APP-003",
        "admissionNo": "DEMO-ADM-2026-042",
        "studentName": "Sana Siddiqui",
        "grade": "5",
        "academicYear": "2026-27",
        "status": "under_review",
        "parentName": "Tariq Siddiqui",
        "parentPhone": "+91 98765 00042",
        "parentEmail": "tariq.s@demo.example",
        "previousSchool": "St. Mary Convent",
        "documents": [{"name": "Application Form", "verified": True}],
        "paymentStatus": "pending",
        "createdAt": "2026-05-22T09:15:00.000Z"
    },
    {
        "id": "DEMO-ADM-APP-004",
        "admissionNo": "DEMO-ADM-2026-043",
        "studentName": "Reyansh Nair",
        "grade": "1",
        "academicYear": "2026-27",
        "status": "draft",
        "parentName": "Manoj Nair",
        "parentPhone": "+91 98765 00043",
        "parentEmail": "manoj.n@demo.example",
        "previousSchool": "Little Stars Preschool",
        "documents": [],
        "paymentStatus": "pending",
        "createdAt": "2026-05-25T11:00:00.000Z"
    },
    {
        "id": "DEMO-ADM-APP-005",
        "admissionNo": "DEMO-ADM-2026-044",
        "studentName": "Samar Ghosh",
        "grade": "8",
        "academicYear": "2026-27",
        "status": "rejected",
        "parentName": "Barun Ghosh",
        "parentPhone": "+91 98765 00044",
        "parentEmail": "barun.g@demo.example",
        "previousSchool": "Calcutta Boys School",
        "rejectionReason": "Age criterion out of boundary; seat capacity full in requested section.",
        "documents": [{"name": "Transfer Certificate", "verified": False}],
        "paymentStatus": "refunded",
        "createdAt": "2026-05-12T16:00:00.000Z"
    }
]

for adm in ADMISSIONS_DATA:
    db.collection("admissions").document(adm["id"]).set(adm)
    track("Admissions")

# ----------------------------------------------------------------------
# 9. FEES & INSTALLMENTS (Structures & Real Payments)
# ----------------------------------------------------------------------
print("[9/19] Seeding Fee Structures, Installments & Realistic Payment Ledgers...")

fee_struct_10 = {
    "id": "fee-struct-10",
    "academicSession": "2026-27",
    "grade": "10",
    "title": "Grade 10 Annual Comprehensive Fee",
    "term": "full_year",
    "feeHeads": [
        {"id": "head-1", "name": "Tuition Fee", "amount": 40000},
        {"id": "head-2", "name": "Annual Development & Tech", "amount": 12000},
        {"id": "head-3", "name": "Science & Computer Lab", "amount": 5000},
        {"id": "head-4", "name": "Library, Sports & Activity", "amount": 3000}
    ],
    "installments": [
        {"id": "inst-1", "label": "Installment 1 (Term 1)", "amount": 30000, "dueDate": "2026-06-30"},
        {"id": "inst-2", "label": "Installment 2 (Term 2)", "amount": 30000, "dueDate": "2026-11-30"}
    ],
    "notes": "Annual composite fee structured in 2 equal semester installments.",
    "createdAt": "2026-05-20T08:00:00.000Z",
    "createdBy": ACCOUNTS_UID
}

db.collection("feeStructures").document("fee-struct-10").set(fee_struct_10)
track("Fee Structures")

# Seed payments for Grade 10-A students covering every eligibility & ledger scenario
PAYMENTS_CONFIG = [
    # STU-001: Fully paid both installments (₹30,000 + ₹30,000)
    {"stu": "DEMO-STU-001", "name": "Aarav Sharma", "inst": "inst-1", "label": "Installment 1 (Term 1)", "amt": 30000, "mode": "online", "ref": "PAY_ONL_9918231", "rec": "REC-2026-001", "date": "2026-06-15T10:00:00.000Z"},
    {"stu": "DEMO-STU-001", "name": "Aarav Sharma", "inst": "inst-2", "label": "Installment 2 (Term 2)", "amt": 30000, "mode": "cheque", "ref": "CHQ-882190", "rec": "REC-2026-002", "date": "2026-06-15T10:00:00.000Z"},

    # STU-002: Partially paid Inst 1 (₹15,000 / ₹30,000 = exactly 50%)
    {"stu": "DEMO-STU-002", "name": "Rohan Gupta", "inst": "inst-1", "label": "Installment 1 (Term 1)", "amt": 15000, "mode": "upi", "ref": "UPI_881923019", "rec": "REC-2026-003", "date": "2026-06-20T11:30:00.000Z"},

    # STU-005: Partially paid Inst 1 (₹9,000 / ₹30,000 = 30% -> below 50% threshold)
    {"stu": "DEMO-STU-005", "name": "Ananya Verma", "inst": "inst-1", "label": "Installment 1 (Term 1)", "amt": 9000, "mode": "online", "ref": "PAY_ONL_772183", "rec": "REC-2026-004", "date": "2026-06-25T14:00:00.000Z"},

    # STU-006: Fully paid Inst 1 in cash (₹30,000)
    {"stu": "DEMO-STU-006", "name": "Kabir Das", "inst": "inst-1", "label": "Installment 1 (Term 1)", "amt": 30000, "mode": "cash", "ref": "CSH-COUNTER-01", "rec": "REC-2026-005", "date": "2026-06-28T09:45:00.000Z"},

    # STU-010: Fully paid Inst 1 (₹30,000)
    {"stu": "DEMO-STU-010", "name": "Varun Joshi", "inst": "inst-1", "label": "Installment 1 (Term 1)", "amt": 30000, "mode": "online", "ref": "PAY_ONL_44192", "rec": "REC-2026-006", "date": "2026-06-29T15:20:00.000Z"},

    # STU-011: Fully paid Inst 1 (₹30,000)
    {"stu": "DEMO-STU-011", "name": "Diya Sen", "inst": "inst-1", "label": "Installment 1 (Term 1)", "amt": 30000, "mode": "upi", "ref": "UPI_990184", "rec": "REC-2026-007", "date": "2026-06-30T10:15:00.000Z"}

    # STU-003, STU-004: ₹0 paid (Overdue)
    # STU-007: ₹0 paid (With Approved Bypass)
    # STU-008: ₹0 paid (With Rejected Bypass)
    # STU-009: ₹0 paid (With Pending Bypass)
]

for p in PAYMENTS_CONFIG:
    pay_id = f"pay-{p['rec'].lower()}"
    pdoc = {
        "id": pay_id,
        "academicSession": "2026-27",
        "grade": "10",
        "structureId": "fee-struct-10",
        "studentId": p["stu"],
        "studentUid": p["stu"],
        "studentName": p["name"],
        "installmentId": p["inst"],
        "installmentLabel": p["label"],
        "amount": p["amt"],
        "paymentMode": p["mode"],
        "reference": p["ref"],
        "receiptNo": p["rec"],
        "paidAt": p["date"],
        "recordedBy": ACCOUNTS_UID
    }
    db.collection("feePayments").document(pay_id).set(pdoc)
    track("Fee Payments")

# ----------------------------------------------------------------------
# 10. HALL TICKET RULES, BYPASSES & HALL TICKETS
# ----------------------------------------------------------------------
print("[10/19] Seeding Hall Ticket Fee Gate Rules, Bypasses & Generated Tickets...")

db.collection("hallTicketSettings").document("default").set({
    "id": "default",
    "feeGateEnabled": True,
    "defaultInstructions": [
        "Candidates must bring this original Hall Ticket / Admit Card and their School ID card to each examination session.",
        "Candidates should report to the examination hall at least 15 minutes before the scheduled commencement time.",
        "No electronic gadgets, smart watches, mobile phones, or unauthorized papers are permitted inside the examination room.",
        "Candidates must write their Roll Number and Admission Number clearly on the answer booklet.",
        "Leaving the examination room before the designated half-time or without invigilator permission is strictly prohibited.",
        "Any form of malpractice or communication between candidates during the exam will lead to immediate cancellation of candidature."
    ],
    "updatedAt": "2026-06-01T08:00:00.000Z",
    "updatedBy": ADMIN_UID
})
track("Hall Ticket Settings")

rule_doc = {
    "id": "ht-rule-t1-hy",
    "sessionId": "2026-27",
    "academicYear": "2026-27",
    "definedExamId": "exam-t1-hy",
    "examName": "Half-Yearly Examination",
    "termId": "term_1",
    "termName": "Term 1",
    "feeGateEnabled": True,
    "requirementType": "installment_percentage",
    "installmentId": "inst-1",
    "installmentLabel": "Installment 1 (Term 1)",
    "minimumPaymentPercentage": 50,
    "notes": "Candidates must have cleared at least 50% of Term 1 fees to be eligible for Half-Yearly Hall Ticket.",
    "createdAt": "2026-06-01T08:00:00.000Z",
    "updatedAt": "2026-06-01T08:00:00.000Z",
    "updatedBy": ADMIN_UID
}
db.collection("hallTicketRules").document("ht-rule-t1-hy").set(rule_doc)
track("Hall Ticket Rules")

# Seed Bypasses (Approved, Rejected, Pending)
BYPASSES_DATA = [
    {
        "id": "bypass-stu-007",
        "studentId": "DEMO-STU-007",
        "studentUid": "DEMO-STU-007",
        "studentName": "Sneha Iyer",
        "admissionNo": "DEMO-ADM-2026-007",
        "rollNo": "7",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "definedExamId": "exam-t1-hy",
        "examName": "Half-Yearly Examination",
        "reason": "Family medical emergency; parent requested installment extension until October 15 with written post-dated cheque.",
        "feeShortfallAmount": 30000,
        "feeStatusSummary": "Unpaid (₹0 of ₹30,000 paid)",
        "status": "approved",
        "requestedBy": {"uid": ACCOUNTS_UID, "name": "Fathima Zahra", "role": "accountant"},
        "requestedAt": "2026-09-01T10:00:00.000Z",
        "reviewedBy": {"uid": PRINCIPAL_UID, "name": "Dr. Eleanor Vance", "role": "admin"},
        "reviewedAt": "2026-09-02T11:30:00.000Z",
        "reviewNotes": "Approved on compassionate grounds with parent undertaking.",
        "createdAt": "2026-09-01T10:00:00.000Z",
        "updatedAt": "2026-09-02T11:30:00.000Z"
    },
    {
        "id": "bypass-stu-008",
        "studentId": "DEMO-STU-008",
        "studentUid": "DEMO-STU-008",
        "studentName": "Aditya Nair",
        "admissionNo": "DEMO-ADM-2026-008",
        "rollNo": "8",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "definedExamId": "exam-t1-hy",
        "examName": "Half-Yearly Examination",
        "reason": "Parent verbally promised to pay after exam.",
        "feeShortfallAmount": 30000,
        "feeStatusSummary": "Unpaid (₹0 of ₹30,000 paid)",
        "status": "rejected",
        "requestedBy": {"uid": ACCOUNTS_UID, "name": "Fathima Zahra", "role": "accountant"},
        "requestedAt": "2026-09-03T09:00:00.000Z",
        "reviewedBy": {"uid": PRINCIPAL_UID, "name": "Dr. Eleanor Vance", "role": "admin"},
        "reviewedAt": "2026-09-03T16:00:00.000Z",
        "reviewNotes": "Rejected due to repeated default without formal written commitment.",
        "createdAt": "2026-09-03T09:00:00.000Z",
        "updatedAt": "2026-09-03T16:00:00.000Z"
    },
    {
        "id": "bypass-stu-009",
        "studentId": "DEMO-STU-009",
        "studentUid": "DEMO-STU-009",
        "studentName": "Meera Menon",
        "admissionNo": "DEMO-ADM-2026-009",
        "rollNo": "9",
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "definedExamId": "exam-t1-hy",
        "examName": "Half-Yearly Examination",
        "reason": "Bank transfer pending verification.",
        "feeShortfallAmount": 30000,
        "feeStatusSummary": "Unpaid (₹0 of ₹30,000 paid)",
        "status": "pending",
        "requestedBy": {"uid": ACCOUNTS_UID, "name": "Fathima Zahra", "role": "accountant"},
        "requestedAt": "2026-09-10T14:00:00.000Z",
        "createdAt": "2026-09-10T14:00:00.000Z",
        "updatedAt": "2026-09-10T14:00:00.000Z"
    }
]

for bp in BYPASSES_DATA:
    db.collection("hallTicketBypasses").document(bp["id"]).set(bp)
    track("Hall Ticket Bypasses")

# Seed Generated Hall Tickets for eligible and bypass-approved students
subject_schedules = [
    {"subjectId": "subj-10-math", "subjectName": "Mathematics", "date": "2026-09-15", "dayName": "Tuesday", "startTime": "09:30", "endTime": "12:30", "venue": "Hall 1, Main Block", "maxMarks": 80, "passingMarks": 27},
    {"subjectId": "subj-10-sci", "subjectName": "Science", "date": "2026-09-17", "dayName": "Thursday", "startTime": "09:30", "endTime": "12:30", "venue": "Hall 1, Main Block", "maxMarks": 80, "passingMarks": 27},
    {"subjectId": "subj-10-eng", "subjectName": "English Language & Lit", "date": "2026-09-19", "dayName": "Saturday", "startTime": "09:30", "endTime": "12:30", "venue": "Hall 1, Main Block", "maxMarks": 80, "passingMarks": 27},
    {"subjectId": "subj-10-soc", "subjectName": "Social Science", "date": "2026-09-22", "dayName": "Tuesday", "startTime": "09:30", "endTime": "12:30", "venue": "Hall 1, Main Block", "maxMarks": 80, "passingMarks": 27},
    {"subjectId": "subj-10-hin", "subjectName": "Hindi Course-A", "date": "2026-09-24", "dayName": "Thursday", "startTime": "09:30", "endTime": "12:30", "venue": "Hall 1, Main Block", "maxMarks": 80, "passingMarks": 27}
]

TICKETED_STUDENTS = [
    # STU-001: Eligible (100% paid)
    {"stu": "DEMO-STU-001", "name": "Aarav Sharma", "adm": "DEMO-ADM-2026-001", "roll": "1", "ticket": "HT-2026-10-0001", "reason": "Fee requirement satisfied: Installment 1 (Term 1) is 100% paid.", "bypass": None},
    # STU-002: Eligible (50% paid meets rule)
    {"stu": "DEMO-STU-002", "name": "Rohan Gupta", "adm": "DEMO-ADM-2026-002", "roll": "2", "ticket": "HT-2026-10-0002", "reason": "Fee requirement satisfied: Installment 1 (Term 1) is 50% paid (meets 50% threshold).", "bypass": None},
    # STU-007: Bypass approved
    {"stu": "DEMO-STU-007", "name": "Sneha Iyer", "adm": "DEMO-ADM-2026-007", "roll": "7", "ticket": "HT-2026-10-0007", "reason": "Eligible via Administrative Bypass approved by Principal.", "bypass": "bypass-stu-007"}
]

for t in TICKETED_STUDENTS:
    ht_doc = {
        "id": f"ht-hy-{t['stu'].lower()}",
        "ticketNumber": t["ticket"],
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "structureId": "struct-secondary",
        "structureVersion": 1,
        "scheduleId": "sched-10-hy",
        "definedExamId": "exam-t1-hy",
        "examName": "Half-Yearly Examination",
        "termId": "term_1",
        "termName": "Term 1",
        "studentId": t["stu"],
        "studentUid": t["stu"],
        "studentName": t["name"],
        "admissionNo": t["adm"],
        "rollNo": t["roll"],
        "grade": "10",
        "sectionId": "sec-10a",
        "sectionName": "A",
        "studentPhotoUrl": "https://api.dicebear.com/7.x/bottts/svg?seed=" + t["stu"],
        "schoolDetails": {
            "name": "PRESTIGE INTERNATIONAL SCHOOL",
            "affiliationNo": "CBSE AFFILIATION NO. 930123",
            "address": "Affiliated to CBSE, New Delhi — Senior Secondary Sector",
            "tagline": "SCALING NEW HEIGHTS WITH EXCELLENCE",
            "logoUrl": "/prestige_logo.png"
        },
        "scheduledSubjects": subject_schedules,
        "instructions": [
            "Candidates must bring this original Hall Ticket / Admit Card and their School ID card to each examination session.",
            "Candidates should report to the examination hall at least 15 minutes before the scheduled commencement time.",
            "No electronic gadgets, smart watches, mobile phones, or unauthorized papers are permitted inside the examination room."
        ],
        "status": "generated",
        "eligibilitySnapshot": {
            "eligible": True,
            "reason": t["reason"],
            "evaluatedAt": "2026-09-10T12:00:00.000Z"
        },
        "qrCodeData": f"VERIFY_HT:{t['ticket']}:{t['stu']}:2026-27:HALF_YEARLY",
        "generatedAt": "2026-09-10T12:00:00.000Z",
        "generatedBy": {"uid": ADMIN_UID, "name": "Dr. Eleanor Vance", "role": "admin"},
        "updatedAt": "2026-09-10T12:00:00.000Z"
    }
    db.collection("hallTickets").document(ht_doc["id"]).set(ht_doc)
    track("Hall Tickets")

# ----------------------------------------------------------------------
# 11. EXAM SCHEDULING
# ----------------------------------------------------------------------
print("[11/19] Seeding Exam Schedules...")

exam_sched_hy = {
    "id": "sched-10-hy",
    "sessionId": "2026-27",
    "academicYear": "2026-27",
    "examType": "Half-Yearly Examination",
    "termId": "term_1",
    "termName": "Term 1",
    "definedExamId": "exam-t1-hy",
    "structureId": "struct-secondary",
    "structureVersion": 1,
    "grade": "10",
    "hodId": HOD_UID,
    "hodName": "Prof. Rajesh Sharma",
    "status": "approved",
    "exams": [
        {"subjectId": "subj-10-math", "subjectName": "Mathematics", "date": "2026-09-15", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Hall 1"},
        {"subjectId": "subj-10-sci", "subjectName": "Science", "date": "2026-09-17", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Hall 1"},
        {"subjectId": "subj-10-eng", "subjectName": "English Language & Lit", "date": "2026-09-19", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Hall 1"},
        {"subjectId": "subj-10-soc", "subjectName": "Social Science", "date": "2026-09-22", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Hall 1"},
        {"subjectId": "subj-10-hin", "subjectName": "Hindi Course-A", "date": "2026-09-24", "startTime": "09:30", "endTime": "12:30", "maxMarks": 80, "passingMarks": 27, "venue": "Hall 1"}
    ],
    "submittedAt": "2026-08-20T10:00:00.000Z",
    "reviewedBy": ADMIN_UID,
    "reviewedByName": "Dr. Eleanor Vance",
    "reviewedAt": "2026-08-22T14:00:00.000Z",
    "reviewRemarks": "Timetable approved with no clashes. Seating capacity verified.",
    "createdAt": "2026-08-20T10:00:00.000Z",
    "updatedAt": "2026-08-22T14:00:00.000Z"
}

db.collection("examSchedules").document("sched-10-hy").set(exam_sched_hy)
track("Exam Schedules")

# ----------------------------------------------------------------------
# 12. MARKS ENTRIES (Real calculation engine output)
# ----------------------------------------------------------------------
print("[12/19] Seeding Marks Entries across Workflow States (draft, submitted, verified, published, locked)...")

# Helper to calculate and build mark entry
def make_mark_entry(stu_uid, stu_name, roll, adm, pt_raw, nb, sea, th, status):
    # PT scaling: tested out of 40 scaled to 10
    pt_scaled = round((pt_raw / 40.0) * 10.0, 1)
    tot_raw = pt_raw + nb + sea + th
    tot_scaled = round(pt_scaled + nb + sea + th, 1)
    pct = round((tot_scaled / 100.0) * 100.0, 1)
    
    if pct >= 91: grade = "A1"
    elif pct >= 81: grade = "A2"
    elif pct >= 71: grade = "B1"
    elif pct >= 61: grade = "B2"
    elif pct >= 51: grade = "C1"
    elif pct >= 41: grade = "C2"
    elif pct >= 33: grade = "D"
    else: grade = "E"

    doc_id = f"marks_2026-27_10_sec-10a_subj-10-math_term_1_exam-t1-hy_{stu_uid}"
    return {
        "id": doc_id,
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "structureId": "struct-secondary",
        "structureVersion": 1,
        "grade": "10",
        "sectionId": "sec-10a",
        "subjectId": "subj-10-math",
        "termId": "term_1",
        "termName": "Term 1",
        "examId": "exam-t1-hy",
        "studentUid": stu_uid,
        "studentDocId": stu_uid,
        "studentId": stu_uid,
        "studentName": stu_name,
        "rollNo": roll,
        "admissionNo": adm,
        "componentMarks": {
            "comp-pt": {"score": pt_raw, "testedScore": pt_raw, "maxMarks": 10, "testedMaxMarks": 40, "scaledScore": pt_scaled, "isAbsent": False, "isExempt": False},
            "comp-nb": {"score": nb, "maxMarks": 5, "isAbsent": False, "isExempt": False},
            "comp-sea": {"score": sea, "maxMarks": 5, "isAbsent": False, "isExempt": False},
            "comp-th": {"score": th, "maxMarks": 80, "isAbsent": False, "isExempt": False}
        },
        "totalRawMarks": tot_raw,
        "totalMaxMarks": 130,
        "scaledTotalMarks": tot_scaled,
        "calculatedPercentage": pct,
        "calculatedGrade": grade,
        "isAbsent": False,
        "isExempt": False,
        "isPassed": pct >= 33,
        "workflowStatus": status,
        "enteredBy": CLASS_TEACHER_UID,
        "enteredAt": "2026-09-26T10:00:00.000Z",
        "submittedAt": "2026-09-26T11:00:00.000Z" if status != "draft" else None,
        "verifiedAt": "2026-09-26T12:00:00.000Z" if status in ["verified", "published", "locked"] else None,
        "publishedAt": "2026-09-26T14:00:00.000Z" if status in ["published", "locked"] else None
    }

# Variety of realistic mark performances in Section 10-A
MARKS_RECORDS = [
    # High Performer (A1): 38/40 PT (9.5) + 5 NB + 5 SEA + 76 TH = 95.5% [PUBLISHED]
    make_mark_entry("DEMO-STU-001", "Aarav Sharma", "1", "DEMO-ADM-2026-001", 38, 5, 5, 76, "published"),
    # Good Performer (A2): 34/40 PT (8.5) + 5 NB + 4 SEA + 68 TH = 85.5% [VERIFIED]
    make_mark_entry("DEMO-STU-002", "Rohan Gupta", "2", "DEMO-ADM-2026-002", 34, 5, 4, 68, "verified"),
    # Average Performer (B1): 28/40 PT (7.0) + 4 NB + 4 SEA + 60 TH = 75.0% [SUBMITTED]
    make_mark_entry("DEMO-STU-003", "Priya Reddy", "3", "DEMO-ADM-2026-003", 28, 4, 4, 60, "submitted"),
    # Average Performer (B2): 26/40 PT (6.5) + 4 NB + 3 SEA + 52 TH = 65.5% [SUBMITTED]
    make_mark_entry("DEMO-STU-004", "Rahul Reddy", "4", "DEMO-ADM-2026-004", 26, 4, 3, 52, "submitted"),
    # Borderline Pass (D): 14/40 PT (3.5) + 2 NB + 2 SEA + 27 TH = 34.5% [DRAFT]
    make_mark_entry("DEMO-STU-005", "Ananya Verma", "5", "DEMO-ADM-2026-005", 14, 2, 2, 27, "draft"),
    # Solid B1 [VERIFIED]
    make_mark_entry("DEMO-STU-006", "Kabir Das", "6", "DEMO-ADM-2026-006", 30, 4, 4, 58, "verified"),
    # High Performer A1 [PUBLISHED]
    make_mark_entry("DEMO-STU-007", "Sneha Iyer", "7", "DEMO-ADM-2026-007", 39, 5, 5, 74, "published"),
]

# Absent Student (DEMO-STU-010)
absent_entry = {
    "id": "marks_2026-27_10_sec-10a_subj-10-math_term_1_exam-t1-hy_DEMO-STU-010",
    "sessionId": "2026-27",
    "academicYear": "2026-27",
    "structureId": "struct-secondary",
    "structureVersion": 1,
    "grade": "10",
    "sectionId": "sec-10a",
    "subjectId": "subj-10-math",
    "termId": "term_1",
    "termName": "Term 1",
    "examId": "exam-t1-hy",
    "studentUid": "DEMO-STU-010",
    "studentDocId": "DEMO-STU-010",
    "studentId": "DEMO-STU-010",
    "studentName": "Varun Joshi",
    "rollNo": "10",
    "admissionNo": "DEMO-ADM-2026-010",
    "componentMarks": {
        "comp-pt": {"score": 0, "isAbsent": True, "isExempt": False, "maxMarks": 10},
        "comp-nb": {"score": 0, "isAbsent": True, "isExempt": False, "maxMarks": 5},
        "comp-sea": {"score": 0, "isAbsent": True, "isExempt": False, "maxMarks": 5},
        "comp-th": {"score": 0, "isAbsent": True, "isExempt": False, "maxMarks": 80}
    },
    "totalRawMarks": 0,
    "totalMaxMarks": 100,
    "scaledTotalMarks": 0,
    "calculatedPercentage": 0,
    "calculatedGrade": "E",
    "isAbsent": True,
    "isExempt": False,
    "isPassed": False,
    "workflowStatus": "submitted",
    "enteredBy": CLASS_TEACHER_UID,
    "enteredAt": "2026-09-26T10:00:00.000Z",
    "submittedAt": "2026-09-26T11:00:00.000Z"
}
MARKS_RECORDS.append(absent_entry)

for m in MARKS_RECORDS:
    db.collection("marksEntries").document(m["id"]).set(m)
    # Also write into marks collection for backward compatibility
    db.collection("marks").document(m["id"]).set(m)
    track("Marks Entries")

# ----------------------------------------------------------------------
# 13. REPORT CARDS
# ----------------------------------------------------------------------
print("[13/19] Seeding Published Report Cards with Signatures & Co-Scholastic Evaluations...")

rc_stu1 = {
    "id": "rc-2026-t1-demo-stu-001",
    "studentId": "DEMO-STU-001",
    "studentUid": "DEMO-STU-001",
    "studentDocId": "DEMO-STU-001",
    "studentName": "Aarav Sharma",
    "grade": "10",
    "sectionId": "sec-10a",
    "sectionName": "A",
    "examType": "Half-Yearly Examination",
    "academicSession": "2026-27",
    "academicYear": "2026-27",
    "status": "published",
    "rollNo": "1",
    "admissionNo": "DEMO-ADM-2026-001",
    "fatherName": "Mohan Sharma",
    "motherName": "Kavita Sharma",
    "dob": "2010-05-14",
    "address": "Demo Residence #1, Prestige Avenue, Bangalore",
    "reportDate": "2026-10-05",
    "attendance1": "96 / 102 Days (94.1%)",
    "subjectMarks": [
        {"subjectId": "subj-10-math", "subjectName": "Mathematics", "marks": 96, "perTest": 9.5, "notebook": 5, "enrichment": 5, "examMarks": 76, "grade": "A1", "gradeLevel": 10},
        {"subjectId": "subj-10-sci", "subjectName": "Science", "marks": 92, "perTest": 9.0, "notebook": 5, "enrichment": 5, "examMarks": 73, "grade": "A1", "gradeLevel": 10},
        {"subjectId": "subj-10-eng", "subjectName": "English Language & Lit", "marks": 88, "perTest": 8.5, "notebook": 4.5, "enrichment": 5, "examMarks": 70, "grade": "A2", "gradeLevel": 9},
        {"subjectId": "subj-10-soc", "subjectName": "Social Science", "marks": 90, "perTest": 9.0, "notebook": 5, "enrichment": 4, "examMarks": 72, "grade": "A2", "gradeLevel": 9},
        {"subjectId": "subj-10-hin", "subjectName": "Hindi Course-A", "marks": 85, "perTest": 8.0, "notebook": 5, "enrichment": 5, "examMarks": 67, "grade": "A2", "gradeLevel": 9}
    ],
    "total": 451,
    "outOf": 500,
    "percentage": 90.2,
    "gradeLetter": "A1",
    "coScholastic1": {"workEd": "A", "artEd": "A", "healthPE": "A"},
    "coActivities1": {"generalKnowledge": "A", "valueEd": "A", "computer": "A"},
    "discipline1": "A",
    "classTeacherRemarks": "Aarav exhibits outstanding academic diligence, sharp analytical acumen, and exemplary conduct.",
    "promotedTo": "Eligible for Term 2",
    "classTeacherSign": {"name": "Sarah Jenkins", "signedAt": "2026-10-02T10:00:00.000Z"},
    "hodSign": {"name": "Prof. Rajesh Sharma", "signedAt": "2026-10-03T11:30:00.000Z"},
    "adminSign": {"name": "Dr. Eleanor Vance", "signedAt": "2026-10-04T15:00:00.000Z"},
    "releasedAt": "2026-10-05T09:00:00.000Z",
    "generatedBy": ADMIN_UID,
    "generatedAt": "2026-10-02T09:00:00.000Z"
}

db.collection("publishedReportCards").document("rc-2026-t1-demo-stu-001").set(rc_stu1)
db.collection("reportCards").document("rc-2026-t1-demo-stu-001").set(rc_stu1)
track("Report Cards")

# ----------------------------------------------------------------------
# 14. EVENTS & SCHOOL CALENDAR (All Types & Audiences)
# ----------------------------------------------------------------------
print("[14/19] Seeding Comprehensive Calendar Events...")

CALENDAR_EVENTS = [
    {
        "id": "evt-asm-weekly",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "title": "Morning General Assembly & National Anthem",
        "description": "Weekly school-wide morning assembly, student news bulletin, thought for the day and institutional announcements.",
        "eventTypeId": "X1Zd5yV4aV1TX409V6fM", # Assembly
        "eventTypeName": "Assembly",
        "eventTypeColor": "#6366f1",
        "startDate": "2026-06-05",
        "endDate": "2027-03-31",
        "startTime": "08:15",
        "endTime": "08:45",
        "allDay": False,
        "location": "Central School Amphitheatre",
        "priority": "normal",
        "status": "published",
        "audienceType": "entire_school",
        "audienceIds": [],
        "recurrence": {"frequency": "weekly", "daysOfWeek": [1, 2, 3, 4, 5], "endDate": "2027-03-31"},
        "createdBy": {"uid": ADMIN_UID, "name": "Dr. Eleanor Vance", "role": "admin"},
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": "evt-hol-ind-day",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "title": "Independence Day Holiday",
        "description": "National Holiday observing the 80th Independence Day of India. Flag hoisting ceremony at 08:00 AM.",
        "eventTypeId": "tFJvOCZZUgSrmT7LtGo6", # Holiday
        "eventTypeName": "Holiday",
        "eventTypeColor": "#10b981",
        "startDate": "2026-08-15",
        "endDate": "2026-08-15",
        "allDay": True,
        "location": "Campus Grounds",
        "priority": "high",
        "status": "published",
        "audienceType": "entire_school",
        "audienceIds": [],
        "createdBy": {"uid": ADMIN_UID, "name": "Dr. Eleanor Vance", "role": "admin"},
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": "evt-exam-hy",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "title": "Half-Yearly Examination Window (Term 1)",
        "description": "Summative Half-Yearly Assessments for Grades 9 through 12. Adherence to issued hall tickets is mandatory.",
        "eventTypeId": "Lg1dKEKVD5wjEEc5N04u", # Examination
        "eventTypeName": "Examination",
        "eventTypeColor": "#f43f5e",
        "startDate": "2026-09-15",
        "endDate": "2026-09-25",
        "allDay": True,
        "location": "Main Academic Wing Examination Rooms",
        "priority": "urgent",
        "status": "published",
        "audienceType": "specific_grades",
        "audienceIds": ["9", "10"],
        "createdBy": {"uid": HOD_UID, "name": "Prof. Rajesh Sharma", "role": "hod"},
        "createdAt": "2026-08-15T09:00:00.000Z",
        "updatedAt": "2026-08-15T09:00:00.000Z"
    },
    {
        "id": "evt-ptm-t1",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "title": "Parent-Teacher Meeting (PTM - Term 1)",
        "description": "Individual one-on-one progress review between parents and subject educators following Half-Yearly evaluations.",
        "eventTypeId": "0faOeIhhhYdxzFFxiLw2", # Parent Meeting
        "eventTypeName": "Parent Meeting",
        "eventTypeColor": "#06b6d4",
        "startDate": "2026-10-10",
        "endDate": "2026-10-10",
        "startTime": "09:00",
        "endTime": "14:00",
        "allDay": False,
        "location": "Respective Homerooms",
        "priority": "high",
        "status": "published",
        "audienceType": "entire_school",
        "audienceIds": [],
        "createdBy": {"uid": ADMIN_UID, "name": "Dr. Eleanor Vance", "role": "admin"},
        "createdAt": "2026-08-20T08:00:00.000Z",
        "updatedAt": "2026-08-20T08:00:00.000Z"
    },
    {
        "id": "evt-comp-robotics",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "title": "Inter-House Robotics & STEM Olympiad",
        "description": "Annual student competition showcasing autonomous robotics, IoT innovations, and applied physics models.",
        "eventTypeId": "1BCNkK498nDrPUfJOCkd", # Competition
        "eventTypeName": "Competition",
        "eventTypeColor": "#ea580c",
        "startDate": "2026-11-14",
        "endDate": "2026-11-15",
        "allDay": False,
        "startTime": "10:00",
        "endTime": "16:00",
        "location": "Science Center Auditorium",
        "priority": "normal",
        "status": "published",
        "audienceType": "students",
        "audienceIds": [],
        "createdBy": {"uid": SUBJECT_TEACHER_UID, "name": "David Miller", "role": "teacher"},
        "createdAt": "2026-08-25T11:00:00.000Z",
        "updatedAt": "2026-08-25T11:00:00.000Z"
    },
    {
        "id": "evt-sports-annual",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "title": "Annual Athletic Meet & Sports Day",
        "description": "Track and field events, relay races, inter-house marching contingent parade, and trophy presentation.",
        "eventTypeId": "hnYQy2XNXsXoTw8SiDCz", # Sports
        "eventTypeName": "Sports",
        "eventTypeColor": "#0284c7",
        "startDate": "2026-12-04",
        "endDate": "2026-12-05",
        "allDay": True,
        "location": "Prestige International Sports Complex",
        "priority": "high",
        "status": "published",
        "audienceType": "entire_school",
        "audienceIds": [],
        "createdBy": {"uid": ADMIN_UID, "name": "Dr. Eleanor Vance", "role": "admin"},
        "createdAt": "2026-09-01T08:00:00.000Z",
        "updatedAt": "2026-09-01T08:00:00.000Z"
    },
    {
        "id": "evt-cult-annual",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "title": "Annual Cultural Gala 'Tarang 2026'",
        "description": "Dramatic productions, classical and contemporary dance performances, choir presentations, and student honors.",
        "eventTypeId": "XJEHtFDIgGpv0rt9HrD9", # Cultural
        "eventTypeName": "Cultural",
        "eventTypeColor": "#c026d3",
        "startDate": "2026-12-18",
        "endDate": "2026-12-19",
        "allDay": False,
        "startTime": "17:00",
        "endTime": "21:00",
        "location": "Grand Auditorium",
        "priority": "high",
        "status": "published",
        "audienceType": "entire_school",
        "audienceIds": [],
        "createdBy": {"uid": ADMIN_UID, "name": "Dr. Eleanor Vance", "role": "admin"},
        "createdAt": "2026-09-01T08:00:00.000Z",
        "updatedAt": "2026-09-01T08:00:00.000Z"
    },
    {
        "id": "evt-wrk-teacher",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "title": "Faculty Development Workshop: AI in Classrooms",
        "description": "Pedagogical workshop for teaching faculty on integrating adaptive generative tools into lesson planning.",
        "eventTypeId": "c38Dke4cV4H47gvrbMLr", # Workshop
        "eventTypeName": "Workshop",
        "eventTypeColor": "#0d9488",
        "startDate": "2026-09-05",
        "endDate": "2026-09-05",
        "allDay": False,
        "startTime": "14:00",
        "endTime": "17:00",
        "location": "Media Conference Room",
        "priority": "normal",
        "status": "published",
        "audienceType": "teachers",
        "audienceIds": [],
        "createdBy": {"uid": PRINCIPAL_UID, "name": "Dr. Eleanor Vance", "role": "admin"},
        "createdAt": "2026-08-10T08:00:00.000Z",
        "updatedAt": "2026-08-10T08:00:00.000Z"
    },
    {
        "id": "evt-can-trial",
        "sessionId": "2026-27",
        "academicYear": "2026-27",
        "title": "Under-16 Football Trials (Cancelled due to weather)",
        "description": "Selection trials postponed due to heavy monsoon rains and waterlogged ground.",
        "eventTypeId": "hnYQy2XNXsXoTw8SiDCz",
        "eventTypeName": "Sports",
        "eventTypeColor": "#0284c7",
        "startDate": "2026-09-12",
        "endDate": "2026-09-12",
        "allDay": False,
        "startTime": "15:30",
        "endTime": "18:00",
        "location": "Main Football Pitch",
        "priority": "low",
        "status": "cancelled",
        "audienceType": "students",
        "audienceIds": [],
        "createdBy": {"uid": CLASS_TEACHER_UID, "name": "Sarah Jenkins", "role": "teacher"},
        "createdAt": "2026-09-08T08:00:00.000Z",
        "updatedAt": "2026-09-11T12:00:00.000Z"
    }
]

for ev in CALENDAR_EVENTS:
    db.collection("events").document(ev["id"]).set(ev)
    track("Calendar Events")

# ----------------------------------------------------------------------
# 15. LIBRARY MODULE (Books, Physical Copies, Transactions)
# ----------------------------------------------------------------------
print("[15/19] Seeding Library Books, Copies & Circulation Transactions...")

LIBRARY_BOOKS = [
    {
        "id": "bk-sci-001",
        "title": "Concepts of Physics (Vol 1 & 2)",
        "author": "Dr. H.C. Verma",
        "publisher": "Bharati Bhawan",
        "isbn": "978-8177091878",
        "category": "science",
        "subject": "Physics",
        "grade": "10",
        "totalCopies": 5,
        "availableCopies": 3,
        "shelfLocation": "Rack B-03",
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": "bk-math-001",
        "title": "Secondary School Mathematics Class 10",
        "author": "R.S. Aggarwal",
        "publisher": "Bharati Bhawan",
        "isbn": "978-9387410091",
        "category": "mathematics",
        "subject": "Mathematics",
        "grade": "10",
        "totalCopies": 6,
        "availableCopies": 4,
        "shelfLocation": "Rack A-01",
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": "bk-fict-001",
        "title": "To Kill a Mockingbird",
        "author": "Harper Lee",
        "publisher": "HarperCollins",
        "isbn": "978-0061120084",
        "category": "fiction",
        "totalCopies": 4,
        "availableCopies": 3,
        "shelfLocation": "Rack F-08",
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    }
]

for b in LIBRARY_BOOKS:
    db.collection("libraryBooks").document(b["id"]).set(b)
    track("Library Books")

# Copies
COPIES_DATA = [
    {"id": "copy-phy-001", "bookId": "bk-sci-001", "bookTitle": "Concepts of Physics", "accessionNumber": "ACC-2026-0101", "condition": "good", "status": "issued", "currentBorrowerName": "Aarav Sharma", "currentBorrowerId": "DEMO-STU-001", "currentBorrowerType": "student", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-09-01T08:00:00.000Z"},
    {"id": "copy-phy-002", "bookId": "bk-sci-001", "bookTitle": "Concepts of Physics", "accessionNumber": "ACC-2026-0102", "condition": "good", "status": "issued", "currentBorrowerName": "Priya Reddy", "currentBorrowerId": "DEMO-STU-003", "currentBorrowerType": "student", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-08-10T08:00:00.000Z"},
    {"id": "copy-phy-003", "bookId": "bk-sci-001", "bookTitle": "Concepts of Physics", "accessionNumber": "ACC-2026-0103", "condition": "new", "status": "available", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-06-01T08:00:00.000Z"},
    {"id": "copy-math-001", "bookId": "bk-math-001", "bookTitle": "Secondary School Mathematics Class 10", "accessionNumber": "ACC-2026-0201", "condition": "good", "status": "issued", "currentBorrowerName": "Sarah Jenkins", "currentBorrowerId": CLASS_TEACHER_UID, "currentBorrowerType": "staff", "createdAt": "2026-06-01T08:00:00.000Z", "updatedAt": "2026-09-05T08:00:00.000Z"}
]

for cp in COPIES_DATA:
    db.collection("libraryCopies").document(cp["id"]).set(cp)
    track("Library Copies")

# Transactions
TRANSACTIONS_DATA = [
    # Active Issued Book
    {
        "id": "tx-lib-001",
        "copyId": "copy-phy-001",
        "bookId": "bk-sci-001",
        "bookTitle": "Concepts of Physics",
        "accessionNumber": "ACC-2026-0101",
        "memberId": "DEMO-STU-001",
        "memberType": "student",
        "memberName": "Aarav Sharma",
        "memberIdentifier": "DEMO-ADM-2026-001",
        "memberGrade": "10",
        "memberSection": "A",
        "issueDate": "2026-09-18",
        "dueDate": "2026-10-02",
        "status": "issued",
        "renewalCount": 0,
        "fineAmount": 0,
        "finePaidStatus": "none",
        "issuedBy": OPERATIONS_UID,
        "createdAt": "2026-09-18T10:00:00.000Z",
        "updatedAt": "2026-09-18T10:00:00.000Z"
    },
    # Overdue Book with Fine Pending
    {
        "id": "tx-lib-002",
        "copyId": "copy-phy-002",
        "bookId": "bk-sci-001",
        "bookTitle": "Concepts of Physics",
        "accessionNumber": "ACC-2026-0102",
        "memberId": "DEMO-STU-003",
        "memberType": "student",
        "memberName": "Priya Reddy",
        "memberIdentifier": "DEMO-ADM-2026-003",
        "memberGrade": "10",
        "memberSection": "A",
        "issueDate": "2026-08-10",
        "dueDate": "2026-08-24",
        "status": "overdue",
        "renewalCount": 0,
        "fineAmount": 150,
        "finePaidStatus": "unpaid",
        "issuedBy": OPERATIONS_UID,
        "createdAt": "2026-08-10T11:00:00.000Z",
        "updatedAt": "2026-09-25T11:00:00.000Z"
    },
    # Returned Book with Paid Fine
    {
        "id": "tx-lib-003",
        "copyId": "copy-math-001",
        "bookId": "bk-math-001",
        "bookTitle": "Secondary School Mathematics Class 10",
        "accessionNumber": "ACC-2026-0201",
        "memberId": "DEMO-STU-002",
        "memberType": "student",
        "memberName": "Rohan Gupta",
        "memberIdentifier": "DEMO-ADM-2026-002",
        "memberGrade": "10",
        "memberSection": "A",
        "issueDate": "2026-07-01",
        "dueDate": "2026-07-15",
        "returnDate": "2026-07-20",
        "status": "returned",
        "renewalCount": 0,
        "fineAmount": 50,
        "finePaidStatus": "paid",
        "issuedBy": OPERATIONS_UID,
        "returnedTo": OPERATIONS_UID,
        "createdAt": "2026-07-01T10:00:00.000Z",
        "updatedAt": "2026-07-20T12:00:00.000Z"
    }
]

for tx in TRANSACTIONS_DATA:
    db.collection("libraryTransactions").document(tx["id"]).set(tx)
    track("Library Transactions")

# ----------------------------------------------------------------------
# 16. INVENTORY, UNIFORMS & TEXTBOOKS
# ----------------------------------------------------------------------
print("[16/19] Seeding Inventory Stock, Uniforms & Textbooks...")

INVENTORY_ITEMS = [
    {
        "id": "inv-paper-a4",
        "name": "JK Copier A4 Paper 75 GSM",
        "category": "paper",
        "unit": "reams",
        "currentQuantity": 150,
        "minStock": 30,
        "unitCost": 280,
        "location": "Print Store Room B",
        "supplierInfo": "National Stationery Mart",
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": "inv-toner-canon",
        "name": "Canon NPG-59 Toner Cartridge",
        "category": "consumables",
        "unit": "cartridges",
        "currentQuantity": 12,
        "minStock": 4,
        "unitCost": 3500,
        "location": "Print Workshop Cabinet 1",
        "supplierInfo": "Canon Business Solutions",
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": "inv-marker-white",
        "name": "Camlin Whiteboard Markers (Box of 10)",
        "category": "stationery",
        "unit": "boxes",
        "currentQuantity": 45,
        "minStock": 10,
        "unitCost": 320,
        "location": "Staff Room Stationery Rack",
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    }
]

for itm in INVENTORY_ITEMS:
    db.collection("inventoryItems").document(itm["id"]).set(itm)
    track("Inventory Items")

# Stock Movement
INVENTORY_MOVEMENTS = [
    {
        "id": "mov-001",
        "itemId": "inv-paper-a4",
        "itemName": "JK Copier A4 Paper 75 GSM",
        "category": "paper",
        "movementType": "purchase",
        "quantity": 200,
        "previousQuantity": 0,
        "newQuantity": 200,
        "reason": "Annual bulk purchase for examination and circular printing",
        "reference": "PO-2026-092",
        "performedBy": OPERATIONS_UID,
        "performedByName": "Anand Verma",
        "timestamp": "2026-06-05T09:00:00.000Z"
    },
    {
        "id": "mov-002",
        "itemId": "inv-paper-a4",
        "itemName": "JK Copier A4 Paper 75 GSM",
        "category": "paper",
        "movementType": "issue",
        "quantity": 50,
        "previousQuantity": 200,
        "newQuantity": 150,
        "reason": "Issued to Printing Dept for Half-Yearly Question Papers",
        "recipientName": "Vikram Patel",
        "recipientRole": "printing",
        "performedBy": OPERATIONS_UID,
        "performedByName": "Anand Verma",
        "timestamp": "2026-09-01T10:30:00.000Z"
    }
]

for mv in INVENTORY_MOVEMENTS:
    db.collection("inventoryMovements").document(mv["id"]).set(mv)
    track("Inventory Stock Movements")

# Uniforms
UNIFORM_ITEMS = [
    {
        "id": "uni-reg-boys",
        "name": "Regular Uniform Blazer & Trousers (Boys)",
        "gender": "boys",
        "category": "regular",
        "sizes": {"28": 15, "30": 25, "32": 40, "34": 30, "36": 12},
        "minStockPerSize": {"28": 5, "30": 5, "32": 5, "34": 5, "36": 5},
        "unitPrice": 1850,
        "location": "Uniform Store Room 1",
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": "uni-sports-unisex",
        "name": "House Sports Tracksuit (Red/Blue/Green/Yellow)",
        "gender": "unisex",
        "category": "sports",
        "sizes": {"28": 20, "30": 30, "32": 45, "34": 35, "36": 15},
        "unitPrice": 1250,
        "location": "Uniform Store Room 2",
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    }
]

for uni in UNIFORM_ITEMS:
    db.collection("uniformItems").document(uni["id"]).set(uni)
    track("Uniform Items")

# Uniform Issues
UNIFORM_ISSUES = [
    {
        "id": "iss-uni-001",
        "uniformItemId": "uni-reg-boys",
        "uniformName": "Regular Uniform Blazer & Trousers (Boys)",
        "size": "32",
        "quantity": 1,
        "studentId": "DEMO-STU-001",
        "studentName": "Aarav Sharma",
        "admissionNo": "DEMO-ADM-2026-001",
        "grade": "10",
        "section": "A",
        "academicSession": "2026-27",
        "issueDate": "2026-06-10",
        "issuedBy": OPERATIONS_UID,
        "issuedByName": "Anand Verma",
        "createdAt": "2026-06-10T11:00:00.000Z"
    }
]

for uiss in UNIFORM_ISSUES:
    db.collection("uniformIssues").document(uiss["id"]).set(uiss)
    track("Uniform Issues")

# Textbooks
TEXTBOOK_ITEMS = [
    {
        "id": "tb-10-math",
        "title": "NCERT Mathematics Class 10",
        "grade": "10",
        "subject": "Mathematics",
        "publisher": "NCERT",
        "academicSession": "2026-27",
        "totalStock": 100,
        "distributedCount": 23,
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": "tb-10-sci",
        "title": "NCERT Science Class 10",
        "grade": "10",
        "subject": "Science",
        "publisher": "NCERT",
        "academicSession": "2026-27",
        "totalStock": 100,
        "distributedCount": 23,
        "createdAt": "2026-06-01T08:00:00.000Z",
        "updatedAt": "2026-06-01T08:00:00.000Z"
    }
]

for tb in TEXTBOOK_ITEMS:
    db.collection("textbookItems").document(tb["id"]).set(tb)
    track("Textbook Items")

BOOK_DISTRIBUTIONS = [
    {
        "id": "dist-tb-001",
        "textbookId": "tb-10-math",
        "bookTitle": "NCERT Mathematics Class 10",
        "studentId": "DEMO-STU-001",
        "studentName": "Aarav Sharma",
        "admissionNo": "DEMO-ADM-2026-001",
        "grade": "10",
        "section": "A",
        "quantity": 1,
        "academicYear": "2026-27",
        "issueDate": "2026-06-05",
        "issuedBy": OPERATIONS_UID,
        "issuedByName": "Anand Verma",
        "returnRequired": False,
        "returnStatus": "not_required",
        "createdAt": "2026-06-05T09:30:00.000Z"
    }
]

for bd in BOOK_DISTRIBUTIONS:
    db.collection("bookDistributions").document(bd["id"]).set(bd)
    track("Book Distributions")

# ----------------------------------------------------------------------
# 17. PRINTING DEPARTMENT REQUESTS
# ----------------------------------------------------------------------
print("[17/19] Seeding Printing Department Work Orders in Various Statuses...")

PRINTING_REQUESTS = [
    {
        "id": "ord-print-001",
        "orderNo": "PO-2026-001",
        "title": "Grade 10 Mathematics Half-Yearly Question Papers",
        "documentType": "question_paper",
        "requesterId": CLASS_TEACHER_UID,
        "requesterName": "Sarah Jenkins",
        "requesterRole": "teacher",
        "grade": "10",
        "section": "All",
        "copies": 80,
        "pageCount": 4,
        "paperSize": "A4",
        "colorMode": "bw",
        "sides": "double",
        "binding": "stapled",
        "priority": "urgent",
        "requiredDate": "2026-09-12",
        "instructions": "Strict confidentiality. Hand over directly in sealed envelopes to Exam Controller.",
        "status": "completed",
        "printedAt": "2026-09-11T16:00:00.000Z",
        "printedBy": PRINTING_UID,
        "printedByName": "Vikram Patel",
        "createdAt": "2026-09-08T09:00:00.000Z",
        "updatedAt": "2026-09-11T16:00:00.000Z"
    },
    {
        "id": "ord-print-002",
        "orderNo": "PO-2026-002",
        "title": "Grade 9 Science Lab Safety Worksheets",
        "documentType": "worksheet",
        "requesterId": SUBJECT_TEACHER_UID,
        "requesterName": "David Miller",
        "requesterRole": "teacher",
        "grade": "9",
        "section": "A",
        "copies": 40,
        "pageCount": 2,
        "paperSize": "A4",
        "colorMode": "bw",
        "sides": "single",
        "binding": "none",
        "priority": "high",
        "requiredDate": "2026-09-20",
        "instructions": "Standard worksheet printing.",
        "status": "printing",
        "createdAt": "2026-09-15T11:00:00.000Z",
        "updatedAt": "2026-09-16T10:00:00.000Z"
    },
    {
        "id": "ord-print-003",
        "orderNo": "PO-2026-003",
        "title": "School Calendar & PTM Circular for Term 1",
        "documentType": "circular",
        "requesterId": ADMIN_UID,
        "requesterName": "Dr. Eleanor Vance",
        "requesterRole": "admin",
        "copies": 500,
        "pageCount": 1,
        "paperSize": "A4",
        "colorMode": "color",
        "sides": "single",
        "binding": "none",
        "priority": "normal",
        "requiredDate": "2026-09-28",
        "status": "pending",
        "createdAt": "2026-09-20T14:00:00.000Z",
        "updatedAt": "2026-09-20T14:00:00.000Z"
    },
    {
        "id": "ord-print-004",
        "orderNo": "PO-2026-004",
        "title": "Senior Faculty Academic Syllabus Booklet",
        "documentType": "syllabus",
        "requesterId": HOD_UID,
        "requesterName": "Prof. Rajesh Sharma",
        "requesterRole": "hod",
        "copies": 25,
        "pageCount": 28,
        "paperSize": "A4",
        "colorMode": "bw",
        "sides": "double",
        "binding": "spiral",
        "priority": "normal",
        "requiredDate": "2026-10-05",
        "status": "accepted",
        "createdAt": "2026-09-22T10:30:00.000Z",
        "updatedAt": "2026-09-23T09:00:00.000Z"
    },
    {
        "id": "ord-print-005",
        "orderNo": "PO-2026-005",
        "title": "Personal Notes Printing (Unapproved)",
        "documentType": "other",
        "requesterId": CLASS_TEACHER_UID,
        "requesterName": "Sarah Jenkins",
        "requesterRole": "teacher",
        "copies": 10,
        "pageCount": 10,
        "paperSize": "A4",
        "colorMode": "color",
        "sides": "single",
        "binding": "none",
        "priority": "normal",
        "requiredDate": "2026-09-10",
        "status": "rejected",
        "rejectionReason": "Non-curricular printing request not approved under departmental policy.",
        "createdAt": "2026-09-09T08:00:00.000Z",
        "updatedAt": "2026-09-09T10:00:00.000Z"
    }
]

for pr in PRINTING_REQUESTS:
    db.collection("printingRequests").document(pr["id"]).set(pr)
    track("Printing Orders")

# ----------------------------------------------------------------------
# 18. NOTIFICATIONS
# ----------------------------------------------------------------------
print("[18/19] Seeding Targeted Notifications...")

NOTIFICATIONS_DATA = [
    {
        "id": "notif-stu-001",
        "userId": created_auth_map["student.demo@demo.example"],
        "title": "Half-Yearly Examination Hall Ticket Issued",
        "message": "Your Hall Ticket for the upcoming Half-Yearly Examination has been generated. You can download and print it from the Hall Tickets menu.",
        "type": "success",
        "read": False,
        "priority": "high",
        "audienceType": "students",
        "createdAt": "2026-09-10T12:05:00.000Z"
    },
    {
        "id": "notif-par-001",
        "userId": created_auth_map["parent.demo@demo.example"],
        "title": "Term 1 Parent-Teacher Meeting Scheduled",
        "message": "The Term 1 PTM is scheduled for Saturday, October 10 from 09:00 AM to 02:00 PM. Please check the school calendar for details.",
        "type": "info",
        "read": True,
        "priority": "normal",
        "audienceType": "parents",
        "createdAt": "2026-09-12T09:00:00.000Z"
    },
    {
        "id": "notif-tch-001",
        "userId": CLASS_TEACHER_UID,
        "recipientTeacherId": CLASS_TEACHER_UID,
        "title": "Marks Entry Portal Open for Section 10-A",
        "message": "The marks entry window for Half-Yearly Examinations is now open. Please complete and submit all scholastic component evaluations before the cutoff date.",
        "type": "warning",
        "read": False,
        "priority": "high",
        "audienceType": "teachers",
        "createdAt": "2026-09-25T08:00:00.000Z"
    },
    {
        "id": "notif-hod-001",
        "userId": HOD_UID,
        "title": "Section 10-A Mathematics Marks Submitted for Verification",
        "message": "Class Teacher Sarah Jenkins has submitted Term 1 Half-Yearly mathematics marks for Section 10-A. Verification is requested.",
        "type": "info",
        "read": False,
        "priority": "normal",
        "audienceType": "hods",
        "createdAt": "2026-09-26T11:05:00.000Z"
    }
]

for n in NOTIFICATIONS_DATA:
    db.collection("notifications").document(n["id"]).set(n)
    track("Notifications")

# ----------------------------------------------------------------------
# 19. AUDIT LOGS
# ----------------------------------------------------------------------
print("[19/19] Seeding Immutable Central Audit Logs...")

AUDIT_LOGS = [
    {
        "id": "log-001",
        "userId": ADMIN_UID,
        "userName": "Dr. Eleanor Vance",
        "role": "admin",
        "action": "create",
        "entity": "academic_structure",
        "entityId": "struct-secondary",
        "details": "Created Secondary Wing Academic Structure Version 1 for Academic Session 2026-27.",
        "timestamp": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": "log-002",
        "userId": ADMIN_UID,
        "userName": "Dr. Eleanor Vance",
        "role": "admin",
        "action": "create",
        "entity": "student_admission",
        "entityId": "DEMO-ADM-2026-001",
        "details": "Approved admission for student Aarav Sharma into Grade 10 Section A.",
        "timestamp": "2026-06-01T09:00:00.000Z"
    },
    {
        "id": "log-003",
        "userId": ACCOUNTS_UID,
        "userName": "Fathima Zahra",
        "role": "accountant",
        "action": "create",
        "entity": "fee_payment",
        "entityId": "REC-2026-001",
        "details": "Recorded online fee payment of Rs 30,000 for student DEMO-STU-001 (Installment 1).",
        "timestamp": "2026-06-15T10:00:00.000Z"
    },
    {
        "id": "log-004",
        "userId": PRINCIPAL_UID,
        "userName": "Dr. Eleanor Vance",
        "role": "admin",
        "action": "status_change",
        "entity": "hall_ticket_bypass",
        "entityId": "bypass-stu-007",
        "details": "Approved examination hall ticket fee bypass for student Sneha Iyer (DEMO-STU-007).",
        "timestamp": "2026-09-02T11:30:00.000Z"
    },
    {
        "id": "log-005",
        "userId": CLASS_TEACHER_UID,
        "userName": "Sarah Jenkins",
        "role": "teacher",
        "action": "status_change",
        "entity": "marks_entry",
        "entityId": "sec-10a_subj-10-math",
        "details": "Submitted Half-Yearly mathematics marks for 15 students in Section 10-A.",
        "timestamp": "2026-09-26T11:00:00.000Z"
    }
]

for al in AUDIT_LOGS:
    db.collection("auditLogs").document(al["id"]).set(al)
    track("Audit Logs")

# ----------------------------------------------------------------------
# 20. E-SIGNATURES & DOCUMENT SIGNATORY CONFIGS
# ----------------------------------------------------------------------
print("[20/20] Seeding Authorized E-Signatures & Document Signatory Configurations...")

SIGNATURES_DATA = [
    {
        "id": ADMIN_UID,
        "staffId": ADMIN_UID,
        "userId": ADMIN_UID,
        "role": "admin",
        "name": "Dr. Eleanor Vance",
        "designation": "Principal",
        "imageUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='250' height='70'><path d='M20 50 Q 60 10 90 40 T 170 30 T 230 45' stroke='%231e3a8a' stroke-width='3' fill='none'/><text x='30' y='65' font-family='cursive' font-size='18' fill='%231e3a8a'>Eleanor Vance</text></svg>",
        "status": "active",
        "authorizedDocumentTypes": ["report_card", "hall_ticket", "transfer_certificate", "official_notice"],
        "authorizedBy": ADMIN_UID,
        "authorizedByName": "Dr. Eleanor Vance",
        "authorizedAt": "2026-06-01T08:00:00.000Z",
        "history": [
            {
                "action": "create",
                "performedByUid": ADMIN_UID,
                "performedByName": "Dr. Eleanor Vance",
                "timestamp": "2026-06-01T08:00:00.000Z",
                "notes": "Admin institutional digital signature initialized (Designation: Principal)."
            }
        ],
        "updatedAt": "2026-06-01T08:00:00.000Z"
    },
    {
        "id": HOD_UID,
        "staffId": HOD_UID,
        "userId": HOD_UID,
        "role": "hod",
        "name": "Prof. Rajesh Sharma",
        "designation": "Head of Department (Secondary)",
        "imageUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='250' height='70'><path d='M20 40 Q 70 15 110 45 T 190 25 T 230 40' stroke='%230f766e' stroke-width='3' fill='none'/><text x='30' y='65' font-family='cursive' font-size='18' fill='%230f766e'>R. Sharma</text></svg>",
        "status": "active",
        "authorizedDocumentTypes": ["report_card"],
        "authorizedBy": ADMIN_UID,
        "authorizedByName": "Dr. Eleanor Vance",
        "authorizedAt": "2026-06-01T08:30:00.000Z",
        "history": [
            {
                "action": "authorized",
                "performedByUid": ADMIN_UID,
                "performedByName": "Dr. Eleanor Vance",
                "timestamp": "2026-06-01T08:30:00.000Z",
                "notes": "Authorized for secondary division academic report cards."
            }
        ],
        "updatedAt": "2026-06-01T08:30:00.000Z"
    },
    {
        "id": CLASS_TEACHER_UID,
        "staffId": CLASS_TEACHER_UID,
        "userId": CLASS_TEACHER_UID,
        "role": "class_teacher",
        "name": "Sarah Jenkins",
        "designation": "Senior Teacher (10-A)",
        "imageUrl": "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='250' height='70'><path d='M20 45 Q 60 20 120 45 T 180 30 T 230 45' stroke='%234338ca' stroke-width='3' fill='none'/><text x='30' y='65' font-family='cursive' font-size='18' fill='%234338ca'>S. Jenkins</text></svg>",
        "status": "active",
        "authorizedDocumentTypes": ["report_card"],
        "authorizedBy": ADMIN_UID,
        "authorizedByName": "Dr. Eleanor Vance",
        "authorizedAt": "2026-06-01T09:00:00.000Z",
        "history": [
            {
                "action": "authorized",
                "performedByUid": ADMIN_UID,
                "performedByName": "Dr. Eleanor Vance",
                "timestamp": "2026-06-01T09:00:00.000Z",
                "notes": "Authorized for Class 10-A report card signing."
            }
        ],
        "updatedAt": "2026-06-01T09:00:00.000Z"
    }
]

for sig in SIGNATURES_DATA:
    db.collection("signatures").document(sig["id"]).set(sig)
    track("Authorized Staff Signatures")

SIGNATORY_CONFIGS_DATA = [
    {
        "id": "report_card",
        "documentType": "report_card",
        "title": "Official Student Report Card",
        "description": "Multi-tier signatory workflow for semester and annual report cards.",
        "slots": [
            {"slotId": "class_teacher", "label": "Class Teacher", "role": "class_teacher", "required": True, "order": 1},
            {"slotId": "hod", "label": "Section Head / HOD", "role": "hod", "required": True, "order": 2},
            {"slotId": "admin", "label": "Principal", "role": "admin", "required": True, "order": 3}
        ],
        "updatedAt": "2026-06-01T08:00:00.000Z",
        "updatedBy": ADMIN_UID,
        "updatedByName": "Dr. Eleanor Vance"
    },
    {
        "id": "hall_ticket",
        "documentType": "hall_ticket",
        "title": "Examination Admit Card / Hall Ticket",
        "description": "Official institutional hall tickets with principal authorization.",
        "slots": [
            {"slotId": "admin", "label": "Principal & Seal", "role": "admin", "required": True, "order": 1}
        ],
        "updatedAt": "2026-06-01T08:00:00.000Z",
        "updatedBy": ADMIN_UID,
        "updatedByName": "Dr. Eleanor Vance"
    }
]

for cfg in SIGNATORY_CONFIGS_DATA:
    db.collection("signatureConfigs").document(cfg["id"]).set(cfg)
    track("Document Signatory Configurations")

print("\n==================================================")
print("SEEDING COMPLETE! DATASET SUMMARY:")
print("==================================================")
total_seeded = 0
for cat, cnt in sorted(stats.items()):
    print(f" - {cat:35}: {cnt}")
    total_seeded += cnt
print(f"Total seeded entities across collections: {total_seeded}")
print("==================================================")

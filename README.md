# Prestige International School ERP

A production-ready School ERP system with multi-role authentication, marks management, report card workflow with digital signatures, RFID-based attendance, and in-app + email notifications.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS v4 |
| Auth & DB | Firebase (Firestore + Firebase Auth) |
| Backend API | FastAPI + Firebase Admin SDK (Firestore) |
| Cloud Functions | Node.js 18 + Nodemailer (email notifications) |
| PDF Generation | jsPDF |

---

## Project Structure

```
project-root/
├── src/                      # React frontend source
│   ├── components/           # UI components (shadcn/ui)
│   │   ├── ui/               # Base UI components
│   │   └── timetable/        # Timetable sheet component
│   ├── contexts/             # AuthContext (Firebase Auth)
│   ├── hooks/                # Custom hooks (toast, mobile)
│   ├── lib/                  # Firebase config, types, utilities
│   │   ├── firebase.ts       # Firebase initialization
│   │   ├── types.ts          # TypeScript interfaces
│   │   ├── fees.ts           # Fee calculation helpers
│   │   ├── generateReportCardPdf.ts  # Report card PDF generator
│   │   └── generateQPPdf.ts  # Question paper PDF generator
│   └── pages/                # Page components by role
│       ├── admin/            # Admin pages (teachers, students, subjects, etc.)
│       ├── hod/              # HOD pages (class management, exams, etc.)
│       ├── teacher/          # Teacher pages (marks entry, report cards)
│       ├── student/          # Student pages (fees, report card)
│       └── accounts/         # Accountant pages (fees, collections)
├── public/                   # Static assets (logo, favicon)
├── backend/                  # FastAPI backend (RFID attendance)
│   ├── server.py             # Main API server
│   ├── requirements.txt      # Python dependencies
│   └── .env.example          # Backend environment template
├── functions/                # Firebase Cloud Functions
│   ├── index.js              # Email notification function
│   ├── package.json          # Node.js dependencies
│   └── README.md             # Deployment instructions
├── index.html                # HTML entry point
├── package.json              # Frontend dependencies
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript configuration
├── components.json           # shadcn/ui config
├── firebase.json             # Firebase hosting config
├── .firebaserc               # Firebase project config
├── .env.example              # Frontend environment template
└── README.md                 # This file
```

---

## Prerequisites

- **Node.js** 18+ and **npm** (or yarn)
- **Python** 3.10+ and **pip**
- **Firebase** project (for auth and Firestore)
- **Firebase service account key** saved at `backend/serviceAccountKey.json`

---

## Setup Instructions

### 1. Install Frontend Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your Firebase credentials:

```bash
cp .env.example .env
```

Get your Firebase config from:
**Firebase Console → Project Settings → General → Your Apps → Config**

### 3. Run Frontend (Development)

```bash
npm run dev
```

The app starts at **http://localhost:3000**

### 4. Setup Backend (RFID Attendance API)

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Place your Firebase service account JSON at backend/serviceAccountKey.json
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

The API starts at **http://localhost:8001**

### 5. Build for Production

```bash
npm run build
```

Output goes to `dist/` folder.

### 6. Deploy to Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```

### 7. Deploy Cloud Functions (Email Notifications)

See `functions/README.md` for detailed instructions:

```bash
cd functions
npm install
firebase deploy --only functions
```

---

## User Roles

| Role | Access |
|------|--------|
| **Admin** (Principal) | Full access, manages teachers/students/subjects, signs report cards as principal, manages signatures, RFID card assignment |
| **HOD** | Class/section management, exam scheduling, timetable, report card review + publish |
| **Teacher** | Marks entry, report card generation + signing, question papers |
| **Student** | View published report cards, fees, timetable |
| **Accountant** | Fee structures, collections |

---

## Key Features

### Exam Structure (Hardcoded)
- Unit Test 1 → marks only
- Term 1 → marks only
- Unit Test 2 → marks only
- Final Exam → used for **report card generation**

### Report Card Workflow
```
Class Teacher generates (draft)
    → Class Teacher signs (teacher_signed)
        → HOD signs (hod_signed)
            → Admin/Principal signs (principal_signed)
                → HOD publishes (published) → Student can view
```

### Marks Entry
- One record per (studentId + subjectId + examId) — enforced uniqueness
- Inline marks entry for class teacher's own missing subjects
- Missing subjects detection with teacher notifications

### Signature System
- Admin uploads signature images for: Class Teacher, HOD, Principal
- Signatures embedded in report card PDF (left/center/right layout)

### RFID Attendance
- ESP32 sends `POST /api/rfid-scan` with `{uid, deviceId, timestamp}`
- One attendance record per student per day
- Admin assigns RFID cards to students via UI (`/admin/rfid-cards`)

### Notifications
- In-app notification bell with unread count
- "Notify Teachers" sends alerts for missing marks
- Firebase Cloud Function sends email notifications

---

## API Endpoints (RFID Backend)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/rfid-scan` | ESP32 scan — marks attendance |
| `POST` | `/api/rfid-cards` | Assign RFID card to student |
| `DELETE` | `/api/rfid-cards/{uid}` | Remove card assignment |
| `GET` | `/api/rfid-cards` | List all assigned cards |
| `GET` | `/api/attendance?date=YYYY-MM-DD` | Get attendance records |
| `GET` | `/api/attendance/today-count` | Today's scan count |

### ESP32 Example

```cpp
// Arduino / ESP32 HTTP POST
HTTPClient http;
http.begin("https://your-server.com/api/rfid-scan");
http.addHeader("Content-Type", "application/json");
String body = "{\"uid\":\"" + cardUID + "\",\"deviceId\":\"ESP32-01\",\"timestamp\":\"08:30:00\"}";
int code = http.POST(body);
```

---

## First-Time Setup

1. Run the app and go to `/setup`
2. Create the admin account (this is your principal login)
3. Log in as admin
4. Add teachers, students, subjects, and sections
5. Assign class teachers and subject teachers
6. Upload signatures at `/admin/signatures`
7. Assign RFID cards at `/admin/rfid-cards`
8. Class teachers monitor attendance at `/teacher/rfid-attendance` and mark manual attendance at `/teacher/manual-attendance`

---

## Firebase Collections

| Collection | Purpose |
|-----------|---------|
| `users` | Auth user records with roles |
| `teachers` | Teacher profiles |
| `students` | Student records |
| `sections` | Grade sections with class teacher |
| `subjects` | Subject definitions per grade |
| `subjectAssignments` | Teacher-subject-section mapping |
| `marks` | Student marks (unique per student+exam+subject) |
| `reportCards` | Report cards with status workflow |
| `signatures` | Uploaded signature images |
| `notifications` | In-app notification messages |
| `exams` | Exam scheduling records |
| `timetables` | Section timetables |
| `feeStructures` | Class fee definitions |
| `feePayments` | Payment records |
| `rfidCards` | RFID card assignments for students |
| `attendance` | RFID attendance records |

---

## License

Private — Prestige International School

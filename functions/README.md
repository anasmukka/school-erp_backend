# Firebase Cloud Functions — Email Notifications

## Overview
This Cloud Function automatically sends email notifications to teachers when they have missing marks for the Final Exam.

## How it works
1. Class teacher clicks "Notify Teachers" on the Report Cards page
2. A notification document is created in Firestore `notifications` collection
3. The Cloud Function `sendNotificationEmail` triggers automatically
4. It looks up the teacher's email from the `teachers` collection
5. Sends a professional HTML email via Gmail SMTP

## Setup Instructions

### Prerequisites
- Firebase Blaze (pay-as-you-go) plan (required for Cloud Functions)
- Gmail account for sending emails
- Firebase CLI installed

### Step 1: Install Firebase CLI
```bash
npm install -g firebase-tools
firebase login
```

### Step 2: Initialize Functions
```bash
cd your-project-root
firebase init functions
# Select your Firebase project
# Choose JavaScript
# Say YES to ESLint (optional)
```

### Step 3: Copy Function Code
Copy `functions/index.js` to your Firebase project's `functions/` directory.

### Step 4: Set Email Credentials
You need a Gmail App Password (not your regular password):
1. Go to https://myaccount.google.com/apppasswords
2. Generate a new app password for "Mail"
3. Set the :

```bash
# Using Firebase secrets (recommended for v2 functions)
firebase functions:secrets:set EMAIL_USER
# Enter: your-email@gmail.com

firebase functions:secrets:set EMAIL_PASS
# Enter: your-16-char-app-password
```

### Step 5: Deploy
```bash
firebase deploy --only functions
```

### Step 6: Verify
1. Go to the School ERP → Teacher Login → Report Cards
2. Click "Notify Teachers" for a student with missing marks
3. Check the teacher's email inbox
4. Check Firebase Console → Functions → Logs for any errors

## Troubleshooting
- **"Email not configured"**: Set the EMAIL_USER and EMAIL_PASS secrets
- **"Teacher not found"**: Ensure the teacher document exists in Firestore
- **"No email for teacher"**: Add the `email` field to the teacher document
- **Gmail blocks the email**: Enable "Less secure app access" or use an App Password

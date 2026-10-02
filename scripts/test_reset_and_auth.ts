import fs from "fs";
import path from "path";

// Load .env into process.env before importing firebase
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

async function run() {
  const { validateEmail, validatePassword, sendResetEmail, verifyResetCode, confirmNewPassword } = await import("../src/lib/passwordReset");
  const { db } = await import("../src/lib/firebase");
  const { doc, getDoc } = await import("firebase/firestore");

  console.log("==================================================");
  console.log("RUNNING FORGOT PASSWORD & DATABASE RESET VERIFICATION");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${details ? "- " + details : ""}`);
      failed++;
    }
  }

  // 1. Email validation tests
  console.log("\n--- TEST GROUP 1: EMAIL FORMAT VALIDATION ---");
  assert("Valid standard email passes", validateEmail("anasmukka@gmail.com").valid === true);
  assert("Valid school email passes", validateEmail("teacher@school.edu").valid === true);
  assert("Empty email rejected", validateEmail("").valid === false);
  assert("Whitespace-only email rejected", validateEmail("   ").valid === false);
  assert("Missing @ rejected", validateEmail("notanemail.com").valid === false);
  assert("Missing domain rejected", validateEmail("user@").valid === false);
  assert("Missing TLD rejected", validateEmail("user@school").valid === false);
  assert("Spaces in email rejected", validateEmail("user name@school.com").valid === false);

  // 2. Password validation tests
  console.log("\n--- TEST GROUP 2: PASSWORD RULES & MISMATCH VALIDATION ---");
  assert("Empty password rejected", validatePassword("").valid === false);
  assert("Password under 6 chars rejected", validatePassword("12345").valid === false);
  assert("Password with 6 chars accepted", validatePassword("123456").valid === true);
  assert("Password matching confirmPassword accepted", validatePassword("Secret123!", "Secret123!").valid === true);
  assert("Password mismatch rejected", validatePassword("Secret123!", "DifferentPass!").valid === false);
  assert("Mismatch gives correct error message", validatePassword("Pass123", "Pass456").error === "Passwords do not match.");

  // 3. Database reset verification
  console.log("\n--- TEST GROUP 3: DATABASE RESET VERIFICATION ---");
  try {
    const adminDoc = await getDoc(doc(db, "users", "A8CrLrjitoMrMeeMflUe88gY5042"));
    assert("Admin user doc exists in Firestore", adminDoc.exists() === true);
    if (adminDoc.exists()) {
      const data = adminDoc.data();
      assert("Admin user has email anasmukka@gmail.com", data?.email === "anasmukka@gmail.com");
      assert("Admin user has role 'admin'", data?.role === "admin");
    }

    const sessionDoc = await getDoc(doc(db, "academicSessions", "2026-27"));
    assert("Current academic session 2026-27 is preserved", sessionDoc.exists() === true && sessionDoc.data()?.isCurrent === true);

    const yearDoc = await getDoc(doc(db, "academicYears", "2026-27"));
    assert("Academic year 2026-27 is preserved", yearDoc.exists() === true);

    const { getDocs, collection } = await import("firebase/firestore");
    const eventTypesSnap = await getDocs(collection(db, "eventTypes"));
    assert("Event types configuration collection has 12 default categories", eventTypesSnap.size === 12);
    const hasExamCategory = eventTypesSnap.docs.some(d => d.data().name === "Examination");
    assert("Event type 'Examination' category is preserved", hasExamCategory);
  } catch (err: any) {
    assert("Database checks connected and executed without error", false, err.message);
  }

  // 4. Firebase Auth password reset flow tests
  console.log("\n--- TEST GROUP 4: FIREBASE AUTH PASSWORD RESET INTEGRATION ---");
  try {
    // Test registered email
    const regResult = await sendResetEmail("anasmukka@gmail.com");
    assert("sendResetEmail with registered email succeeds", regResult.success === true);
    assert("sendResetEmail returns standard instructions message", regResult.message.includes("password reset instructions have been sent"));

    // Test unregistered email (Anti-enumeration check)
    const unregResult = await sendResetEmail("unregistered-ghost-account-99999@school-test.org");
    assert("sendResetEmail with unregistered email does NOT reveal account non-existence", unregResult.success === true);
    assert("sendResetEmail provides identical safe message for unregistered accounts", unregResult.message.includes("password reset instructions have been sent"));

    // Test invalid email syntax error propagation
    let threwInvalid = false;
    try {
      await sendResetEmail("not-a-valid-email");
    } catch (e: any) {
      threwInvalid = true;
      assert("sendResetEmail rejects invalid email format before network call", e.message.includes("valid email"));
    }
    assert("sendResetEmail threw on invalid email", threwInvalid);

    // Test verifyResetCode with invalid code
    const invalidCodeRes = await verifyResetCode("invalid-dummy-code-12345");
    assert("verifyResetCode reports false for invalid code", invalidCodeRes.success === false);
    assert("verifyResetCode returns user-friendly error", typeof invalidCodeRes.error === "string");

    // Test confirmNewPassword with invalid code
    const confirmRes = await confirmNewPassword("invalid-dummy-code-12345", "NewValidPassword123!");
    assert("confirmNewPassword fails gracefully on invalid code", confirmRes.success === false);
  } catch (err: any) {
    assert("Firebase Auth password reset operations executed", false, err.message);
  }

  console.log("\n==================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

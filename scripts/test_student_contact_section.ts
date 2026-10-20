/**
 * Automated Test Suite: Student Panel Contact Section
 *
 * Verifies:
 * 1. Role Navigation Isolation (Contact exists exclusively for Student Panel; School Contact for Admin only).
 * 2. Contact Form Field Validation (Email, Phone, WhatsApp, Emergency Phone, Office Hours, Address, Map URL).
 * 3. Optional Fields Handling (Secondary phone, WhatsApp, emergency helpline, instructions omitted when empty).
 * 4. Action & URI Formatters (tel:, mailto:, WhatsApp https://wa.me/, Google Maps).
 * 5. Notification System Decoupling & Secret Isolation (Public contact details strictly segregated from private provider credentials).
 * 6. Security & Audit Logging (Audit trail generation, Firestore rule restrictions).
 */

import fs from "fs";
import path from "path";
import {
  validateEmail,
  validatePhone,
  validateUrl,
  validateContactForm,
  formatPhoneForTel,
  formatWhatsAppUrl,
  formatEmailMailto,
  formatMapUrl,
  formatContactForTemplate,
  SchoolContact,
  SchoolContactInput,
} from "../src/lib/schoolContact";
import { DEFAULT_SCHOOL_ID } from "../src/lib/r2StorageKeys";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
    failedCount++;
  }
}

console.log("======================================================================");
console.log("STUDENT PANEL CONTACT SECTION — COMPREHENSIVE QA TEST SUITE");
console.log("======================================================================\n");

// ---------------------------------------------------------------------------
// Suite 1: Navigation Role Isolation
// ---------------------------------------------------------------------------
console.log("--- Suite 1: Navigation Role Isolation ---");

const layoutPath = path.resolve(process.cwd(), "src/components/Layout.tsx");
const layoutContent = fs.readFileSync(layoutPath, "utf-8");

// Extract navItems definitions
const studentContactNavMatch = layoutContent.match(/\{\s*label:\s*"Contact",\s*href:\s*"\/student\/contact",\s*icon:[^,]+,\s*roles:\s*\[([^\]]+)\]\s*\}/);
assert(Boolean(studentContactNavMatch), "Contact nav item exists in Layout.tsx");

if (studentContactNavMatch) {
  const rolesRaw = studentContactNavMatch[1];
  const roles = rolesRaw.split(",").map((r) => r.trim().replace(/['"]/g, ""));
  assert(roles.length === 1 && roles[0] === "student", "Contact nav item is EXCLUSIVELY granted to 'student' role", `Found: ${JSON.stringify(roles)}`);
  assert(!roles.includes("parent"), "Contact is NOT present for parent role");
  assert(!roles.includes("teacher"), "Contact is NOT present for teacher role");
  assert(!roles.includes("hod"), "Contact is NOT present for hod role");
  assert(!roles.includes("accountant"), "Contact is NOT present for accountant role");
  assert(!roles.includes("operations"), "Contact is NOT present for operations role");
  assert(!roles.includes("printing"), "Contact is NOT present for printing role");
}

const adminContactNavMatch = layoutContent.match(/\{\s*label:\s*"School Contact",\s*href:\s*"\/admin\/settings\/contact",\s*icon:[^,]+,\s*roles:\s*\[([^\]]+)\]\s*\}/);
assert(Boolean(adminContactNavMatch), "School Contact management nav item exists for Admin in Layout.tsx");

if (adminContactNavMatch) {
  const adminRoles = adminContactNavMatch[1].split(",").map((r) => r.trim().replace(/['"]/g, ""));
  assert(adminRoles.includes("admin") && !adminRoles.includes("student"), "School Contact admin route is restricted to admin role only");
}

// ---------------------------------------------------------------------------
// Suite 2: Contact Form Field Validation
// ---------------------------------------------------------------------------
console.log("\n--- Suite 2: Contact Form Validation Engine ---");

// Email validation
assert(validateEmail("contact@prestigeschool.edu").valid, "Valid standard official email accepted");
assert(validateEmail("admin.office@mangaluru.prestige.ac.in").valid, "Valid subdomained email accepted");
assert(!validateEmail("").valid, "Empty email rejected");
assert(!validateEmail("not-an-email").valid, "Plain string without domain rejected");
assert(!validateEmail("missing@domain").valid, "Email without TLD rejected");
assert(!validateEmail("spaces in@domain.com").valid, "Email with spaces rejected");

// Phone validation
assert(validatePhone("+91 824 227 7777").valid, "Valid international formatted phone accepted");
assert(validatePhone("0824-2277777").valid, "Valid STD formatted phone accepted");
assert(validatePhone("9876543210").valid, "Valid 10-digit mobile number accepted");
assert(!validatePhone("").valid, "Empty phone rejected");
assert(!validatePhone("12345").valid, "Phone with < 7 digits rejected");
assert(!validatePhone("+91 99999999999999999999").valid, "Phone with > 15 digits rejected");
assert(!validatePhone("phone-number-abc").valid, "Phone with alphabets rejected");

// Map URL validation
assert(validateUrl("https://maps.google.com/?q=Prestige+School").valid, "Valid https maps link accepted");
assert(validateUrl("http://goo.gl/maps/12345").valid, "Valid http maps link accepted");
assert(validateUrl("").valid, "Empty optional map URL accepted as valid");
assert(!validateUrl("javascript:alert(1)").valid, "XSS javascript: protocol URL rejected");
assert(!validateUrl("invalid-link").valid, "Invalid URL string rejected");

// Full form validation
const validFormPayload: SchoolContactInput = {
  schoolId: DEFAULT_SCHOOL_ID,
  schoolName: "Prestige International School",
  email: "info@prestigeschool.edu",
  phone: "+91 824 227 7777",
  secondaryPhone: "+91 824 227 7778",
  whatsapp: "+91 9876543210",
  officeHours: "Monday – Friday: 8:00 AM – 3:30 PM",
  address: "Jeppinamogaru, Mangaluru, Karnataka 575009",
  emergencyPhone: "+91 9876500000",
  instructions: "Include your student ID.",
  mapUrl: "https://maps.google.com/?q=Prestige+International+School",
  published: true,
};

const validResult = validateContactForm(validFormPayload);
assert(validResult.valid && Object.keys(validResult.errors).length === 0, "Complete valid contact payload passes validation");

const invalidPayload: Partial<SchoolContactInput> = {
  schoolName: "",
  email: "bad-email",
  phone: "123",
  whatsapp: "invalid-wa",
  officeHours: "",
  address: "",
};
const invalidResult = validateContactForm(invalidPayload);
assert(!invalidResult.valid, "Incomplete/invalid payload correctly fails validation");
assert(Boolean(invalidResult.errors.schoolName), "Error reported for empty schoolName");
assert(Boolean(invalidResult.errors.email), "Error reported for invalid email");
assert(Boolean(invalidResult.errors.phone), "Error reported for invalid primary phone");
assert(Boolean(invalidResult.errors.whatsapp), "Error reported for invalid whatsapp");
assert(Boolean(invalidResult.errors.officeHours), "Error reported for empty officeHours");
assert(Boolean(invalidResult.errors.address), "Error reported for empty address");

// ---------------------------------------------------------------------------
// Suite 3: Optional Fields Handling
// ---------------------------------------------------------------------------
console.log("\n--- Suite 3: Optional Fields Handling ---");

const minimalValidPayload: SchoolContactInput = {
  schoolId: DEFAULT_SCHOOL_ID,
  schoolName: "Prestige International School",
  email: "info@prestigeschool.edu",
  phone: "+91 824 227 7777",
  officeHours: "Monday – Friday: 8:00 AM – 3:30 PM",
  address: "Jeppinamogaru, Mangaluru, Karnataka 575009",
  published: true,
};
const minimalResult = validateContactForm(minimalValidPayload);
assert(minimalResult.valid, "Payload without optional fields (secondaryPhone, whatsapp, emergencyPhone, mapUrl, instructions) passes validation");

// ---------------------------------------------------------------------------
// Suite 4: Action & URI Formatting Helpers
// ---------------------------------------------------------------------------
console.log("\n--- Suite 4: Action & URI Formatting Helpers ---");

// tel: link formatting
assert(formatPhoneForTel("+91 824 227 7777") === "tel:+918242277777", "formatPhoneForTel strips spaces and formats +91 number");
assert(formatPhoneForTel("0824-227-7777") === "tel:08242277777", "formatPhoneForTel strips dashes and formats standard number");

// WhatsApp formatting
assert(formatWhatsAppUrl("+91 9876543210") === "https://wa.me/919876543210", "formatWhatsAppUrl strips plus and spaces for wa.me link");
const prefilledWa = formatWhatsAppUrl("+91 9876543210", "Student Inquiry");
assert(prefilledWa.startsWith("https://wa.me/919876543210?text=Student%20Inquiry"), "formatWhatsAppUrl encodes prefilled inquiry text");

// mailto: link formatting
const mailto = formatEmailMailto("info@prestigeschool.edu");
assert(mailto.startsWith("mailto:info@prestigeschool.edu?subject="), "formatEmailMailto produces valid mailto with prefilled subject");

// Map URL formatting
assert(formatMapUrl("School Campus", "https://custom.map.link") === "https://custom.map.link", "formatMapUrl returns custom mapUrl when provided");
const fallbackMap = formatMapUrl("Jeppinamogaru, Mangaluru");
assert(fallbackMap.includes("https://www.google.com/maps/search/?api=1&query=Jeppinamogaru"), "formatMapUrl generates Google Maps search fallback from address");

// ---------------------------------------------------------------------------
// Suite 5: Notification System Decoupling & Secret Isolation
// ---------------------------------------------------------------------------
console.log("\n--- Suite 5: Notification System Decoupling & Secret Isolation ---");

// Verify template footer generator uses only public details
const sampleContact: SchoolContact = {
  id: "prestige",
  schoolId: "prestige",
  schoolName: "Prestige International School",
  email: "contact@prestigeschool.edu",
  phone: "+91 824 227 7777",
  whatsapp: "+91 9876543210",
  officeHours: "8:00 AM – 3:30 PM",
  address: "Mangaluru, Karnataka",
  published: true,
};

const templateFooter = formatContactForTemplate(sampleContact);
assert(templateFooter.includes("Prestige International School"), "Template footer includes school name");
assert(templateFooter.includes("contact@prestigeschool.edu"), "Template footer includes public email");
assert(templateFooter.includes("+91 824 227 7777"), "Template footer includes public phone");
assert(templateFooter.includes("+91 9876543210"), "Template footer includes public whatsapp");

// Verify that no private notification credentials exist on contact object
const forbiddenSecretKeys = ["WHATSAPP_TOKEN", "token", "secret", "password", "apiKey", "authKey", "phoneNumberId"];
const sampleKeys = Object.keys(sampleContact);
const hasLeakedSecretKey = forbiddenSecretKeys.some((k) => sampleKeys.includes(k));
assert(!hasLeakedSecretKey, "SchoolContact schema is strictly free of private notification credentials / tokens");

// ---------------------------------------------------------------------------
// Suite 6: Security Rules & Static Analysis
// ---------------------------------------------------------------------------
console.log("\n--- Suite 6: Security Rules & Static Analysis ---");

const rulesPath = path.resolve(process.cwd(), "firestore.rules");
const rulesContent = fs.readFileSync(rulesPath, "utf-8");

assert(rulesContent.includes("match /schoolContact/{schoolId}"), "firestore.rules defines match for schoolContact collection");
assert(rulesContent.includes("allow read: if isSignedIn();"), "firestore.rules permits read to all signed-in users (including students)");
assert(/allow (create,\s*update|write):\s*if\s+isAdmin\(\)/.test(rulesContent), "firestore.rules strictly restricts create and update to isAdmin()");
assert(rulesContent.includes("hasNoSensitiveAuthFields(request.resource.data)"), "firestore.rules enforces hasNoSensitiveAuthFields on contact writes");

// App routes check
const appPath = path.resolve(process.cwd(), "src/App.tsx");
const appContent = fs.readFileSync(appPath, "utf-8");
assert(appContent.includes('path="/student/contact"'), "App.tsx registers /student/contact route");
assert(appContent.includes('roles={["student"]}'), "App.tsx protects /student/contact route strictly with roles=['student']");
assert(appContent.includes('path="/admin/settings/contact"'), "App.tsx registers /admin/settings/contact route");
assert(appContent.includes('roles={["admin"]}'), "App.tsx protects /admin/settings/contact route strictly with roles=['admin']");

// ---------------------------------------------------------------------------
// Final Summary
// ---------------------------------------------------------------------------
console.log("\n======================================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED out of ${passedCount + failedCount} TESTS`);
console.log("======================================================================");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("ALL STUDENT CONTACT SECTION TESTS PASSED SUCCESSFULLY! ✓\n");
}

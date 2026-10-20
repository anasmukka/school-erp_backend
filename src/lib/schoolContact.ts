/**
 * School Contact Configuration Service
 *
 * Provides authoritative management for official school contact information
 * displayed exclusively in the Student Panel and used in public notification signatures.
 *
 * Security & Architecture Invariants:
 * 1. Public contact details (display email, display phone, WhatsApp number) are strictly
 *    isolated from backend notification provider credentials (Meta WhatsApp tokens, SMTP secrets).
 * 2. Students and non-admin users have read-only access.
 * 3. Only authorized administrators can publish contact changes.
 * 4. All administrative modifications are recorded in the central audit log.
 * 5. Multi-tenant / school isolation is preserved via schoolId partitioning.
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_SCHOOL_ID } from "@/lib/r2StorageKeys";
import { logAuditEvent } from "@/lib/audit";

export interface SchoolContact {
  id: string; // Document ID (typically schoolId, e.g. "prestige")
  schoolId: string;
  schoolName: string;
  email: string;
  phone: string;
  secondaryPhone?: string;
  whatsapp?: string;
  officeHours: string;
  address: string;
  emergencyPhone?: string;
  instructions?: string;
  mapUrl?: string;
  published: boolean;
  updatedAt?: string;
  updatedBy?: string;
  updatedByEmail?: string;
  updatedByName?: string;
}

export type SchoolContactInput = Omit<
  SchoolContact,
  "id" | "updatedAt" | "updatedBy" | "updatedByEmail" | "updatedByName"
>;

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validates standard email address format
 */
export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || !email.trim()) {
    return { valid: false, error: "Email address is required." };
  }
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(email.trim())) {
    return { valid: false, error: "Please provide a valid official email address (e.g., info@prestigeschool.edu)." };
  }
  return { valid: true };
}

/**
 * Validates international/national phone number format (must contain at least 7 digits, permits +, -, spaces, parentheses)
 */
export function validatePhone(phone: string, fieldName = "Phone number"): { valid: boolean; error?: string } {
  if (!phone || !phone.trim()) {
    return { valid: false, error: `${fieldName} is required.` };
  }
  const trimmed = phone.trim();
  const digitCount = (trimmed.match(/\d/g) || []).length;
  if (digitCount < 7 || digitCount > 15) {
    return { valid: false, error: `${fieldName} must contain between 7 and 15 digits.` };
  }
  const allowedCharsRegex = /^[+]?[\d\s().-]{7,25}$/;
  if (!allowedCharsRegex.test(trimmed)) {
    return { valid: false, error: `${fieldName} contains invalid characters.` };
  }
  return { valid: true };
}

/**
 * Validates map URL format (HTTP / HTTPS)
 */
export function validateUrl(url: string, fieldName = "Map URL"): { valid: boolean; error?: string } {
  if (!url || !url.trim()) return { valid: true };
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: `${fieldName} must use http or https.` };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `${fieldName} must be a valid web link (e.g. https://maps.google.com/...).` };
  }
}

/**
 * Validates the entire contact configuration form
 */
export function validateContactForm(data: Partial<SchoolContactInput>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!data.schoolName || !data.schoolName.trim()) {
    errors.schoolName = "School name is required.";
  }

  const emailResult = validateEmail(data.email || "");
  if (!emailResult.valid && emailResult.error) {
    errors.email = emailResult.error;
  }

  const phoneResult = validatePhone(data.phone || "", "Primary phone");
  if (!phoneResult.valid && phoneResult.error) {
    errors.phone = phoneResult.error;
  }

  if (data.secondaryPhone && data.secondaryPhone.trim()) {
    const secResult = validatePhone(data.secondaryPhone, "Secondary phone");
    if (!secResult.valid && secResult.error) {
      errors.secondaryPhone = secResult.error;
    }
  }

  if (data.whatsapp && data.whatsapp.trim()) {
    const waResult = validatePhone(data.whatsapp, "WhatsApp number");
    if (!waResult.valid && waResult.error) {
      errors.whatsapp = waResult.error;
    }
  }

  if (data.emergencyPhone && data.emergencyPhone.trim()) {
    const emResult = validatePhone(data.emergencyPhone, "Emergency phone");
    if (!emResult.valid && emResult.error) {
      errors.emergencyPhone = emResult.error;
    }
  }

  if (!data.officeHours || !data.officeHours.trim()) {
    errors.officeHours = "Office hours are required.";
  }

  if (!data.address || !data.address.trim()) {
    errors.address = "School physical address is required.";
  }

  if (data.mapUrl && data.mapUrl.trim()) {
    const urlResult = validateUrl(data.mapUrl, "Map destination link");
    if (!urlResult.valid && urlResult.error) {
      errors.mapUrl = urlResult.error;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Action & Link Formatting Helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes phone numbers for device tel: links (keeps leading +, digits only)
 */
export function formatPhoneForTel(phone: string): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  const startsWithPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return startsWithPlus ? `tel:+${digits}` : `tel:${digits}`;
}

/**
 * Generates an authoritative WhatsApp conversation URL (https://wa.me/<digits>)
 */
export function formatWhatsAppUrl(whatsapp: string, prefilledText?: string): string {
  if (!whatsapp) return "";
  const digits = whatsapp.replace(/\D/g, "");
  if (!digits) return "";
  const base = `https://wa.me/${digits}`;
  if (prefilledText && prefilledText.trim()) {
    return `${base}?text=${encodeURIComponent(prefilledText.trim())}`;
  }
  return base;
}

/**
 * Normalizes email address for mailto: links
 */
export function formatEmailMailto(email: string, subject = "Student Inquiry - Prestige International School"): string {
  if (!email) return "";
  return `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}`;
}

/**
 * Returns map link (custom URL or Google Maps search query)
 */
export function formatMapUrl(address: string, mapUrl?: string): string {
  if (mapUrl && mapUrl.trim()) {
    return mapUrl.trim();
  }
  if (!address || !address.trim()) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

// ---------------------------------------------------------------------------
// Firestore Database Operations
// ---------------------------------------------------------------------------

const COLLECTION_NAME = "schoolContact";

/**
 * Fetches the published school contact details for the specified school
 */
export async function getSchoolContact(schoolId = DEFAULT_SCHOOL_ID): Promise<SchoolContact | null> {
  if (!db) return null;
  try {
    const contactDoc = await getDoc(doc(db, COLLECTION_NAME, schoolId));
    if (!contactDoc.exists()) {
      return null;
    }
    return {
      id: contactDoc.id,
      ...contactDoc.data(),
    } as SchoolContact;
  } catch (error) {
    console.error(`[SchoolContact] Failed to load contact information for school ${schoolId}:`, error);
    throw error;
  }
}

/**
 * Saves and publishes school contact configuration (Admin only)
 * Records an immutable audit log entry.
 */
export async function saveSchoolContact(
  input: SchoolContactInput,
  author: { uid: string; email: string; name?: string }
): Promise<SchoolContact> {
  if (!db) {
    throw new Error("Firestore database is not initialized.");
  }

  // Validate form
  const validation = validateContactForm(input);
  if (!validation.valid) {
    const firstError = Object.values(validation.errors)[0] || "Invalid contact information provided.";
    throw new Error(firstError);
  }

  const schoolId = input.schoolId || DEFAULT_SCHOOL_ID;
  const now = new Date().toISOString();

  // Clean payload (ensuring no sensitive fields or undefined values)
  const payload: SchoolContact = {
    id: schoolId,
    schoolId,
    schoolName: input.schoolName.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    secondaryPhone: input.secondaryPhone?.trim() || "",
    whatsapp: input.whatsapp?.trim() || "",
    officeHours: input.officeHours.trim(),
    address: input.address.trim(),
    emergencyPhone: input.emergencyPhone?.trim() || "",
    instructions: input.instructions?.trim() || "",
    mapUrl: input.mapUrl?.trim() || "",
    published: input.published ?? true,
    updatedAt: now,
    updatedBy: author.uid,
    updatedByEmail: author.email,
    updatedByName: author.name || "Administrator",
  };

  // Remove empty optional keys if preferred or keep normalized empty strings
  await setDoc(doc(db, COLLECTION_NAME, schoolId), payload);

  // Central audit trail
  try {
    await logAuditEvent({
      userId: author.uid,
      userName: author.name || author.email,
      role: "admin",
      action: "publish",
      entity: "school_contact",
      entityId: schoolId,
      details: `Published official school contact details for ${payload.schoolName} (${schoolId})`,
      metadata: {
        schoolId,
        email: payload.email,
        phone: payload.phone,
        hasWhatsApp: Boolean(payload.whatsapp),
        hasEmergencyPhone: Boolean(payload.emergencyPhone),
        updatedAt: now,
      },
    });
  } catch (auditErr) {
    console.warn("[SchoolContact] Non-blocking audit log failure:", auditErr);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Notification System Integration
// ---------------------------------------------------------------------------

/**
 * Safe public contact formatter for notifications and transactional messages.
 * Note: Never contains WhatsApp API tokens, phone number IDs, or private provider credentials.
 */
export function formatContactForTemplate(contact: SchoolContact | null): string {
  if (!contact) {
    return "";
  }
  const lines: string[] = [
    contact.schoolName,
    `Email: ${contact.email}`,
    `Phone: ${contact.phone}`,
  ];
  if (contact.whatsapp) {
    lines.push(`WhatsApp: ${contact.whatsapp}`);
  }
  if (contact.officeHours) {
    lines.push(`Office Hours: ${contact.officeHours}`);
  }
  return lines.join(" | ");
}

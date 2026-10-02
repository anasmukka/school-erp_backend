import { 
  sendPasswordResetEmail, 
  verifyPasswordResetCode, 
  confirmPasswordReset,
  ActionCodeSettings
} from "firebase/auth";
import { auth, firebaseSetup } from "./firebase";

export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || !email.trim()) {
    return { valid: false, error: "Email address is required." };
  }
  if (!EMAIL_REGEX.test(email.trim())) {
    return { valid: false, error: "Please enter a valid email address (e.g. name@school.com)." };
  }
  return { valid: true };
}

export function validatePassword(password: string, confirmPassword?: string): { valid: boolean; error?: string } {
  if (!password) {
    return { valid: false, error: "Password is required." };
  }
  if (password.length < 6) {
    return { valid: false, error: "Password must be at least 6 characters long." };
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return { valid: false, error: "Passwords do not match." };
  }
  return { valid: true };
}

/**
 * Sends a password reset email using Firebase Authentication.
 * Intentionally handles auth/user-not-found identically to success to prevent account enumeration.
 */
export async function sendResetEmail(email: string): Promise<{ success: boolean; message: string }> {
  if (!firebaseSetup.isConfigured || !auth) {
    throw new Error("Firebase authentication is not configured.");
  }

  const trimmedEmail = email.trim();
  const validation = validateEmail(trimmedEmail);
  if (!validation.valid) {
    throw new Error(validation.error || "Invalid email address.");
  }

  const genericSuccessMessage = 
    "If an account exists for this email address, password reset instructions have been sent. Please check your inbox and spam folder.";

  const continueUrl = typeof window !== "undefined" 
    ? `${window.location.origin}/reset-password` 
    : undefined;

  const actionCodeSettings: ActionCodeSettings | undefined = continueUrl
    ? {
        url: continueUrl,
        handleCodeInApp: true,
      }
    : undefined;

  try {
    if (actionCodeSettings) {
      try {
        await sendPasswordResetEmail(auth, trimmedEmail, actionCodeSettings);
      } catch (innerErr: any) {
        // If continue url is not authorized in Firebase console, fallback to default handler
        if (
          innerErr?.code === "auth/unauthorized-continue-uri" || 
          innerErr?.code === "auth/invalid-continue-uri"
        ) {
          await sendPasswordResetEmail(auth, trimmedEmail);
        } else {
          throw innerErr;
        }
      }
    } else {
      await sendPasswordResetEmail(auth, trimmedEmail);
    }
    return { success: true, message: genericSuccessMessage };
  } catch (err: any) {
    const code = err?.code ?? "";

    // Anti-enumeration: treat user-not-found as success
    if (code === "auth/user-not-found") {
      return { success: true, message: genericSuccessMessage };
    }

    if (code === "auth/invalid-email") {
      throw new Error("Please enter a valid email address format.");
    }
    if (code === "auth/network-request-failed") {
      throw new Error("Network error: Unable to reach authentication server. Please check your connection.");
    }
    if (code === "auth/too-many-requests") {
      throw new Error("Too many reset attempts. Please wait a few minutes before trying again.");
    }

    throw new Error(err?.message || "Failed to send password reset email. Please try again.");
  }
}

/**
 * Verifies a password reset oobCode and retrieves the associated email.
 */
export async function verifyResetCode(oobCode: string): Promise<{ success: boolean; email?: string; error?: string }> {
  if (!firebaseSetup.isConfigured || !auth) {
    return { success: false, error: "Firebase authentication is not configured." };
  }

  try {
    const email = await verifyPasswordResetCode(auth, oobCode);
    return { success: true, email };
  } catch (err: any) {
    const code = err?.code ?? "";
    if (code === "auth/expired-action-code") {
      return { success: false, error: "This password reset link has expired. Please request a new one." };
    }
    if (code === "auth/invalid-action-code") {
      return { success: false, error: "This password reset link is invalid or has already been used. Please request a new one." };
    }
    if (code === "auth/user-disabled") {
      return { success: false, error: "This user account has been disabled." };
    }
    if (code === "auth/network-request-failed") {
      return { success: false, error: "Network error: Unable to verify reset code. Please check your connection." };
    }
    return { success: false, error: err?.message || "Invalid or expired password reset link." };
  }
}

/**
 * Confirms the new password with Firebase Auth using the oobCode.
 */
export async function confirmNewPassword(oobCode: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  if (!firebaseSetup.isConfigured || !auth) {
    return { success: false, error: "Firebase authentication is not configured." };
  }

  if (newPassword.length < 6) {
    return { success: false, error: "Password must be at least 6 characters." };
  }

  try {
    await confirmPasswordReset(auth, oobCode, newPassword);
    return { success: true };
  } catch (err: any) {
    const code = err?.code ?? "";
    if (code === "auth/expired-action-code") {
      return { success: false, error: "This reset link has expired. Please request a new password reset." };
    }
    if (code === "auth/invalid-action-code") {
      return { success: false, error: "This reset link is invalid or has already been used." };
    }
    if (code === "auth/weak-password") {
      return { success: false, error: "Password is too weak. Please use at least 6 characters." };
    }
    if (code === "auth/network-request-failed") {
      return { success: false, error: "Network error. Please check your connection and try again." };
    }
    return { success: false, error: err?.message || "Failed to update password." };
  }
}

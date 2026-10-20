/**
 * Firebase Cloud Messaging (FCM) Client Integration
 * Prestige International School ERP
 *
 * Responsibilities:
 * 1. Safe detection of browser push notification capabilities (isSupported).
 * 2. Request user notification permission.
 * 3. Retrieve device FCM token and register it into Firestore (`deviceTokens`).
 * 4. Token refresh and safe deregistration.
 */

import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { collection, doc, setDoc, deleteDoc } from "firebase/firestore";
import app, { db } from "@/firebase/config";

export interface FCMRegistrationResult {
  success: boolean;
  token?: string;
  error?: string;
}

/**
 * Requests notification permission and retrieves device registration token.
 * Stores token in Firestore `deviceTokens` collection mapped to current authenticated user.
 */
export async function registerPushNotifications(
  userId: string,
  role: string
): Promise<FCMRegistrationResult> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return { success: false, error: "Browser does not support notifications." };
    }

    const supported = await isSupported();
    if (!supported) {
      return { success: false, error: "Firebase Messaging is not supported in this environment." };
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { success: false, error: `Notification permission ${permission}.` };
    }

    const messaging = getMessaging(app);

    // Register service worker if available
    let swRegistration: ServiceWorkerRegistration | undefined;
    if ("serviceWorker" in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      } catch (swErr) {
        console.warn("Service worker registration warning:", swErr);
      }
    }

    const currentToken = await getToken(messaging, {
      serviceWorkerRegistration: swRegistration,
    });

    if (!currentToken) {
      return { success: false, error: "Failed to retrieve device push token." };
    }

    // Persist token to Firestore
    const tokenId = `tok_${userId}_${currentToken.slice(-12)}`;
    await setDoc(
      doc(db, "deviceTokens", tokenId),
      {
        id: tokenId,
        token: currentToken,
        userId,
        role,
        platform: "web",
        userAgent: navigator.userAgent.slice(0, 150),
        valid: true,
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return { success: true, token: currentToken };
  } catch (err: any) {
    console.error("Error registering push notifications:", err);
    return { success: false, error: err.message || "Unknown error registering push token" };
  }
}

/**
 * Deregisters device token when user logs out or disables push notifications.
 */
export async function deregisterDeviceToken(userId: string, token: string): Promise<void> {
  try {
    const tokenId = `tok_${userId}_${token.slice(-12)}`;
    await deleteDoc(doc(db, "deviceTokens", tokenId));
  } catch (err) {
    console.warn("Failed to deregister device token:", err);
  }
}

/**
 * Foreground message listener when app is active.
 */
export function setupForegroundMessageListener(
  onNotificationReceived: (payload: { title?: string; body?: string; data?: any }) => void
) {
  if (typeof window === "undefined") return () => {};

  isSupported().then((supported) => {
    if (!supported) return;
    try {
      const messaging = getMessaging(app);
      onMessage(messaging, (payload) => {
        onNotificationReceived({
          title: payload.notification?.title || payload.data?.title,
          body: payload.notification?.body || payload.data?.body,
          data: payload.data,
        });
      });
    } catch {
      // ignore
    }
  });
}

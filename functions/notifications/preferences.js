/**
 * Notification Preferences & Consent Resolution
 * Prestige International School ERP
 */

const { CHANNELS } = require("./types");

async function isChannelEnabledForEvent(db, eventType, channel) {
  try {
    const settingsDoc = await db.collection("notificationSettings").doc("global").get();
    if (!settingsDoc.exists) {
      // Default fallback
      return true;
    }

    const settings = settingsDoc.data() || {};

    // 1. Check global master channel switch
    if (channel === CHANNELS.EMAIL && settings.emailConfig?.enabled === false) return false;
    if (channel === CHANNELS.WHATSAPP && settings.whatsappConfig?.enabled === false) return false;
    if (channel === CHANNELS.PUSH && settings.fcmConfig?.enabled === false) return false;

    // 2. Check category-specific channel setting
    const catConfig = settings.categories?.[eventType];
    if (catConfig && typeof catConfig[channel] === "boolean") {
      return catConfig[channel];
    }

    return true;
  } catch (err) {
    console.warn("Error reading notificationSettings:", err);
    return true;
  }
}

async function isUserOptedIn(db, userId, channel, eventType) {
  if (!userId) return true;

  try {
    const prefsDoc = await db.collection("notificationPreferences").doc(userId).get();
    if (!prefsDoc.exists) return true;

    const prefs = prefsDoc.data() || {};

    // Master user channel switch
    if (channel === CHANNELS.EMAIL && prefs.emailOptIn === false) return false;
    if (channel === CHANNELS.WHATSAPP && prefs.whatsappOptIn === false) return false;
    if (channel === CHANNELS.PUSH && prefs.pushOptIn === false) return false;

    // Category-specific user preference
    if (eventType && prefs.categoryPreferences?.[eventType]) {
      const catPref = prefs.categoryPreferences[eventType];
      if (typeof catPref[channel] === "boolean") {
        return catPref[channel];
      }
    }

    return true;
  } catch (err) {
    console.warn(`Error reading user preferences for ${userId}:`, err);
    return true;
  }
}

async function isWhatsAppOptedOut(db, phone, userId) {
  if (!phone && !userId) return false;

  try {
    if (phone) {
      const snap = await db
        .collection("whatsappConsents")
        .where("phone", "==", phone)
        .where("optedOut", "==", true)
        .limit(1)
        .get();

      if (!snap.empty) return true;
    }

    if (userId) {
      const snap = await db
        .collection("whatsappConsents")
        .where("userId", "==", userId)
        .where("optedOut", "==", true)
        .limit(1)
        .get();

      if (!snap.empty) return true;
    }

    return false;
  } catch (err) {
    console.warn("Error checking WhatsApp opt-out:", err);
    return false;
  }
}

module.exports = {
  isChannelEnabledForEvent,
  isUserOptedIn,
  isWhatsAppOptedOut,
};

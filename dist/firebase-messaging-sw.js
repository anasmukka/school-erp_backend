/**
 * Firebase Cloud Messaging Service Worker
 * Prestige International School ERP
 *
 * Handles background push notifications when ERP tab is not focused or browser is closed.
 */

// Give the service worker access to Firebase Messaging.
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// Initialize Firebase inside the Service Worker
firebase.initializeApp({
  apiKey: "AIzaSyDvdldan1ka0QhbIkyrhemdcePxL65j0Q8",
  authDomain: "prestige-erp.firebaseapp.com",
  projectId: "prestige-erp",
  storageBucket: "prestige-erp.firebasestorage.app",
  messagingSenderId: "260740002503",
  appId: "1:260740002503:web:fed0cbe0d4e6274b4a04e2",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification?.title || payload.data?.title || "Prestige International School";
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || "An update is available in Prestige ERP.",
    icon: "/prestige_logo.png",
    badge: "/favicon.svg",
    data: payload.data || {},
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.route || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

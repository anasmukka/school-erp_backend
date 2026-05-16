import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_API_KEY,
  authDomain:        import.meta.env.VITE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_APP_ID,
};

const requiredFirebaseEnv = [
  { key: "VITE_API_KEY", value: firebaseConfig.apiKey },
  { key: "VITE_AUTH_DOMAIN", value: firebaseConfig.authDomain },
  { key: "VITE_PROJECT_ID", value: firebaseConfig.projectId },
  { key: "VITE_STORAGE_BUCKET", value: firebaseConfig.storageBucket },
  { key: "VITE_MESSAGING_SENDER_ID", value: firebaseConfig.messagingSenderId },
  { key: "VITE_APP_ID", value: firebaseConfig.appId },
];

function isPlaceholderValue(value: string | undefined) {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized.startsWith("your_") || normalized.includes("your_project");
}

const missingKeys = requiredFirebaseEnv
  .filter(({ value }) => isPlaceholderValue(value))
  .map(({ key }) => key);

export const firebaseSetup = {
  isConfigured: missingKeys.length === 0,
  missingKeys,
  message:
    missingKeys.length === 0
      ? null
      : `Firebase is not configured yet. Create a .env file from .env.example and set: ${missingKeys.join(", ")}.`,
};

const app = (firebaseSetup.isConfigured ? initializeApp(firebaseConfig) : null) as FirebaseApp;

export const auth = (app ? getAuth(app) : null) as Auth;
export const db = (app ? getFirestore(app) : null) as Firestore;
export const functions = (app ? getFunctions(app) : null) as Functions;
export default app;

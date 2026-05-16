import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User as FirebaseUser, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, firebaseSetup } from "@/lib/firebase";
import { User } from "@/lib/types";

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  appUser: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getAuthBootstrapErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code === "auth/invalid-api-key") {
      return "The Firebase API key is invalid. Update your .env file with real Firebase credentials.";
    }
    if (code === "auth/network-request-failed") {
      return "Firebase could not be reached. Check your internet connection and Firebase project settings.";
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unable to start authentication for this app.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [appUser, setAppUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(firebaseSetup.message);

  useEffect(() => {
    if (!firebaseSetup.isConfigured) {
      setFirebaseUser(null);
      setAppUser(null);
      setLoading(false);
      setError(firebaseSetup.message);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      try {
        setFirebaseUser(fbUser);
        setError(null);

        if (fbUser) {
          const userDoc = await getDoc(doc(db, "users", fbUser.uid));
          if (userDoc.exists()) {
            setAppUser({ id: fbUser.uid, ...userDoc.data() } as User);
          } else {
            setAppUser(null);
          }
        } else {
          setAppUser(null);
        }

        setLoading(false);
      } catch (bootstrapError) {
        console.error("Failed to restore auth session:", bootstrapError);
        setAppUser(null);
        setError(getAuthBootstrapErrorMessage(bootstrapError));
        setLoading(false);
      }
    }, (authError) => {
      console.error("Failed to initialize auth listener:", authError);
      setFirebaseUser(null);
      setAppUser(null);
      setError(getAuthBootstrapErrorMessage(authError));
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    if (!firebaseSetup.isConfigured) {
      throw new Error(firebaseSetup.message ?? "Firebase is not configured.");
    }

    const cred = await signInWithEmailAndPassword(auth, email, password);
    const userDoc = await getDoc(doc(db, "users", cred.user.uid));
    if (userDoc.exists()) {
      setAppUser({ id: cred.user.uid, ...userDoc.data() } as User);
      setError(null);
    }
  };

  const logout = async () => {
    if (!firebaseSetup.isConfigured) {
      setFirebaseUser(null);
      setAppUser(null);
      return;
    }

    await signOut(auth);
    setAppUser(null);
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

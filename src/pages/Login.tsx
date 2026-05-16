import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { firebaseSetup } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Info } from "lucide-react";
import { Link } from "wouter";

function getFirebaseErrorMessage(err: any): string {
  const code = err?.code ?? "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Incorrect email or password. Please try again.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This domain is not authorized in Firebase. Go to Firebase Console -> Authentication -> Settings -> Authorized Domains and add this site's domain.";
  }
  if (code === "auth/network-request-failed") {
    return "Network error — check your internet connection and try again.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many failed attempts. Please wait a moment and try again.";
  }
  if (code === "auth/invalid-api-key") {
    return "Firebase API key is invalid. Check your Firebase configuration.";
  }
  return err?.message ?? `Login failed (${code || "unknown error"})`;
}

export default function Login() {
  const { login, error: authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const configBlocked = !firebaseSetup.isConfigured;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      console.error("Login error:", err);
      setError(getFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{
      background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f1f5f9 100%)",
    }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-white flex items-center justify-center shadow-lg overflow-hidden mb-4" style={{
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)"
          }}>
            <img src="/prestige_logo.png" alt="Prestige International School" className="h-16 w-16 object-contain" />
          </div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Prestige International School</h1>
          <p className="text-sm text-muted-foreground mt-1">Management Portal</p>
        </div>

        <div className="glass-card-strong rounded-2xl overflow-hidden" style={{
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.03)"
        }}>
          <div className="px-6 pt-6 pb-2 text-center">
            <p className="text-sm text-muted-foreground">Sign in to your account</p>
          </div>
          <div className="px-6 pb-6">
            <form onSubmit={handleSubmit} className="space-y-4" data-testid="login-form">
              {authError && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{authError}</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2.5">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  data-testid="login-email-input"
                  type="email"
                  placeholder="you@school.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  data-testid="login-password-input"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              <Button data-testid="login-submit-btn" type="submit" className="w-full" disabled={loading || configBlocked}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </span>
                ) : configBlocked ? "Firebase Setup Required" : "Sign In"}
              </Button>
            </form>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground glass-card rounded-xl px-3 py-2.5">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>
            {configBlocked ? (
              <>Copy `.env.example` to `.env`, add your Firebase project values, then open <Link href="/setup" className="text-primary underline font-medium">the setup page</Link> to create the first admin account.</>
            ) : (
              <>First time? <Link href="/setup" className="text-primary underline font-medium">Create the admin account</Link> before logging in.</>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

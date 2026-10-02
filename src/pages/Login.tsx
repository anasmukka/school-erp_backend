import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { firebaseSetup } from "@/lib/firebase";
import { validateEmail, sendResetEmail } from "@/lib/passwordReset";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AlertCircle, Info, KeyRound, CheckCircle2, Loader2, Mail } from "lucide-react";
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

  // Forgot password modal state
  const [showForgotDialog, setShowForgotDialog] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);

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

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotSuccess(null);

    const validation = validateEmail(forgotEmail);
    if (!validation.valid) {
      setForgotError(validation.error || "Please enter a valid email address.");
      return;
    }

    setForgotLoading(true);
    try {
      const res = await sendResetEmail(forgotEmail);
      setForgotSuccess(res.message);
    } catch (err: any) {
      setForgotError(err?.message || "Failed to send reset email. Please try again.");
    } finally {
      setForgotLoading(false);
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(email);
                      setForgotError(null);
                      setForgotSuccess(null);
                      setShowForgotDialog(true);
                    }}
                    className="text-xs text-primary hover:underline font-medium transition-colors focus:outline-none"
                    data-testid="forgot-password-link"
                  >
                    Forgot Password?
                  </button>
                </div>
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

      {/* Forgot Password Dialog */}
      <Dialog open={showForgotDialog} onOpenChange={setShowForgotDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary mb-2">
              <KeyRound className="w-5 h-5" />
            </div>
            <DialogTitle className="text-lg">Reset Password</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Enter your registered school email address. We will send you instructions to reset your password.
            </DialogDescription>
          </DialogHeader>

          {forgotSuccess ? (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs text-emerald-800">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                <div className="space-y-1">
                  <p className="font-semibold text-emerald-900">Reset instructions sent</p>
                  <p>{forgotSuccess}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setShowForgotDialog(false)}
                  className="w-full sm:w-auto"
                >
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleForgotPasswordSubmit} className="space-y-4 py-2" data-testid="forgot-password-form">
              {forgotError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{forgotError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="forgot-email" className="text-xs">Email Address</Label>
                <Input
                  id="forgot-email"
                  data-testid="forgot-email-input"
                  type="email"
                  placeholder="you@school.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <Link 
                  href="/reset-password" 
                  onClick={() => setShowForgotDialog(false)}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  Have a reset code?
                </Link>
                <div className="flex items-center gap-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowForgotDialog(false)}
                    disabled={forgotLoading}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={forgotLoading}
                    data-testid="forgot-submit-btn"
                  >
                    {forgotLoading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Sending...
                      </span>
                    ) : (
                      "Send Reset Link"
                    )}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


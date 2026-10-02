import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { 
  validateEmail, 
  validatePassword, 
  sendResetEmail, 
  verifyResetCode, 
  confirmNewPassword 
} from "@/lib/passwordReset";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  KeyRound, 
  Mail, 
  CheckCircle2, 
  AlertCircle, 
  ArrowLeft, 
  Eye, 
  EyeOff, 
  Loader2 
} from "lucide-react";

export default function ResetPassword() {
  const [, setLocation] = useLocation();

  // URL state
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  // Form states for password reset (when oobCode is present)
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submittingReset, setSubmittingReset] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form states for requesting reset email (when no oobCode or requesting again)
  const [requestEmail, setRequestEmail] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestSuccessMessage, setRequestSuccessMessage] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("oobCode") || params.get("code");
    
    if (code) {
      setOobCode(code);
      setIsVerifyingCode(true);
      verifyResetCode(code).then((res) => {
        setIsVerifyingCode(false);
        if (res.success && res.email) {
          setTargetEmail(res.email);
        } else {
          setCodeError(res.error || "This password reset link is invalid or has expired.");
        }
      });
    }
  }, []);

  // Handler for setting a new password
  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validation = validatePassword(newPassword, confirmPassword);
    if (!validation.valid) {
      setFormError(validation.error || "Please check your password entries.");
      return;
    }

    if (!oobCode) {
      setFormError("Missing reset authorization code. Please request a new link.");
      return;
    }

    setSubmittingReset(true);
    try {
      const res = await confirmNewPassword(oobCode, newPassword);
      if (res.success) {
        setResetSuccess(true);
      } else {
        setFormError(res.error || "Failed to update password.");
      }
    } catch (err: any) {
      setFormError(err?.message || "An unexpected error occurred.");
    } finally {
      setSubmittingReset(false);
    }
  };

  // Handler for requesting a reset email
  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError(null);
    setRequestSuccessMessage(null);

    const validation = validateEmail(requestEmail);
    if (!validation.valid) {
      setRequestError(validation.error || "Please enter a valid email address.");
      return;
    }

    setSubmittingRequest(true);
    try {
      const res = await sendResetEmail(requestEmail);
      setRequestSuccessMessage(res.message);
      setRequestEmail("");
    } catch (err: any) {
      setRequestError(err?.message || "Failed to send reset link.");
    } finally {
      setSubmittingRequest(false);
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f1f5f9 100%)",
      }}
    >
      <div className="w-full max-w-md">
        {/* School Branding */}
        <div className="flex flex-col items-center mb-6">
          <div 
            className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-lg overflow-hidden mb-3"
            style={{
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)"
            }}
          >
            <img src="/prestige_logo.png" alt="Prestige International School" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="text-lg font-bold text-foreground tracking-tight">Prestige International School</h1>
          <p className="text-xs text-muted-foreground">Account Recovery & Security</p>
        </div>

        {/* Main Card */}
        <div 
          className="glass-card-strong rounded-2xl overflow-hidden"
          style={{
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.03)"
          }}
        >
          {/* CASE 1: Verifying oobCode */}
          {isVerifyingCode && (
            <div className="p-8 text-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <h2 className="text-base font-semibold text-foreground">Verifying Reset Link...</h2>
              <p className="text-xs text-muted-foreground">Please wait while we validate your security token.</p>
            </div>
          )}

          {/* CASE 2: Invalid or Expired Code */}
          {!isVerifyingCode && oobCode && codeError && (
            <div className="p-6 space-y-5">
              <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-destructive">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Invalid or Expired Link</h3>
                  <p className="text-xs text-destructive/90">{codeError}</p>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <p className="text-xs text-muted-foreground">
                  Reset links are single-use and expire after a limited period for your account's security. Enter your email below to request a new link.
                </p>

                <form onSubmit={handleRequestSubmit} className="space-y-3">
                  {requestSuccessMessage && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs text-emerald-800">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                      <span>{requestSuccessMessage}</span>
                    </div>
                  )}

                  {requestError && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{requestError}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="req-email" className="text-xs">Your Registered Email</Label>
                    <Input
                      id="req-email"
                      type="email"
                      placeholder="user@school.com"
                      value={requestEmail}
                      onChange={(e) => setRequestEmail(e.target.value)}
                      required
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={submittingRequest}>
                    {submittingRequest ? "Sending..." : "Request New Reset Link"}
                  </Button>
                </form>
              </div>

              <div className="pt-2 text-center">
                <Link href="/login" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Sign In
                </Link>
              </div>
            </div>
          )}

          {/* CASE 3: Valid Code - Reset Password Form */}
          {!isVerifyingCode && oobCode && !codeError && !resetSuccess && (
            <div className="p-6 space-y-5">
              <div className="text-center space-y-1">
                <div className="inline-flex p-2.5 bg-primary/10 text-primary rounded-xl mb-1">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h2 className="text-base font-bold text-foreground">Set New Password</h2>
                {targetEmail && (
                  <p className="text-xs text-muted-foreground">
                    Resetting password for: <span className="font-semibold text-foreground">{targetEmail}</span>
                  </p>
                )}
              </div>

              {formError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleResetSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 6 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Re-enter your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground space-y-1 bg-muted/40 p-2.5 rounded-lg border border-border/40">
                  <p className="font-medium text-foreground">Password requirements:</p>
                  <p className={newPassword.length >= 6 ? "text-emerald-600 font-medium" : ""}>
                    • At least 6 characters long
                  </p>
                  <p className={newPassword && confirmPassword && newPassword === confirmPassword ? "text-emerald-600 font-medium" : ""}>
                    • Passwords must match
                  </p>
                </div>

                <Button type="submit" className="w-full" disabled={submittingReset}>
                  {submittingReset ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Updating Password...
                    </span>
                  ) : (
                    "Save & Update Password"
                  )}
                </Button>
              </form>

              <div className="text-center pt-1">
                <Link href="/login" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Sign In
                </Link>
              </div>
            </div>
          )}

          {/* CASE 4: Reset Success State */}
          {resetSuccess && (
            <div className="p-8 text-center space-y-4">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-foreground">Password Reset Successfully!</h2>
                <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                  Your account password has been updated. You can now sign in with your new credentials.
                </p>
              </div>

              <div className="pt-2">
                <Button 
                  onClick={() => setLocation("/login")} 
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Sign In to ERP
                </Button>
              </div>
            </div>
          )}

          {/* CASE 5: Direct Access without Code - Request Form */}
          {!isVerifyingCode && !oobCode && (
            <div className="p-6 space-y-5">
              <div className="text-center space-y-1">
                <div className="inline-flex p-2.5 bg-primary/10 text-primary rounded-xl mb-1">
                  <Mail className="w-5 h-5" />
                </div>
                <h2 className="text-base font-bold text-foreground">Forgot Password</h2>
                <p className="text-xs text-muted-foreground">
                  Enter your registered school email address to receive password reset instructions.
                </p>
              </div>

              {requestSuccessMessage && (
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                  <span>{requestSuccessMessage}</span>
                </div>
              )}

              {requestError && (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{requestError}</span>
                </div>
              )}

              <form onSubmit={handleRequestSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email-direct">Email Address</Label>
                  <Input
                    id="email-direct"
                    type="email"
                    placeholder="you@school.com"
                    value={requestEmail}
                    onChange={(e) => setRequestEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>

                <Button type="submit" className="w-full" disabled={submittingRequest}>
                  {submittingRequest ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending Instructions...
                    </span>
                  ) : (
                    "Send Reset Instructions"
                  )}
                </Button>
              </form>

              <div className="text-center pt-2">
                <Link href="/login" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back to Sign In
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

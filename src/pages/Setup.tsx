import { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db, firebaseSetup } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { School, CheckCircle, AlertCircle } from "lucide-react";

export default function Setup() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const configBlocked = !firebaseSetup.isConfigured;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (configBlocked) return;
    setError("");
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await setDoc(doc(db, "users", cred.user.uid), {
        name: form.name,
        email: form.email,
        role: "admin",
      });
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? "Setup failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
            <School size={24} className="text-primary-foreground" />
          </div>
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Initial Setup</CardTitle>
            <CardDescription>Create the first admin account</CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="text-center space-y-3">
                <CheckCircle size={40} className="mx-auto text-green-500" />
                <p className="font-semibold text-green-700">Admin account created!</p>
                <p className="text-sm text-muted-foreground">You can now <a href="/" className="text-primary underline">sign in</a> with your credentials.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {configBlocked && (
                  <div className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-300/50 rounded-lg px-3 py-2">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <span>{firebaseSetup.message}</span>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                    <AlertCircle size={15} />
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Full Name</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Admin Name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
                </div>
                <Button type="submit" className="w-full" disabled={loading || configBlocked}>
                  {loading ? "Creating..." : configBlocked ? "Firebase Setup Required" : "Create Admin Account"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-center text-muted-foreground mt-4">
          Only use this page once to create the initial admin account.
        </p>
      </div>
    </div>
  );
}

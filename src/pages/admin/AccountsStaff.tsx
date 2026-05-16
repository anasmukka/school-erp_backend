import { useEffect, useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { User } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditCard, Plus, User as UserIcon } from "lucide-react";

export default function AccountsStaff() {
  const [staff, setStaff] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  const load = async () => {
    const snapshot = await getDocs(query(collection(db, "users"), where("role", "==", "accountant")));
    setStaff(
      snapshot.docs
        .map((record) => ({ id: record.id, ...record.data() } as User))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setForm({ name: "", email: "", password: "" });
    setError("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const credential = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await setDoc(doc(db, "users", credential.user.uid), {
        name: form.name,
        email: form.email,
        role: "accountant",
      });
      setOpen(false);
      resetForm();
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create accounts staff user.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <div>
          <h1 className="text-2xl font-bold">Accounts Staff</h1>
          <p className="text-sm text-muted-foreground">
            View users who can operate the fees section. Use the Admissions module to add new accounts staff.
          </p>
        </div>
      </div>

      {staff.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No accounts staff users yet. Add one to start managing fees.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {staff.map((member) => (
            <Card key={member.id}>
              <CardContent className="pt-5">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                    <UserIcon size={18} className="text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-semibold">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm">
                  <span className="text-emerald-700">Access</span>
                  <span className="font-semibold text-emerald-800">Fees Management</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) resetForm();
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Accounts User</DialogTitle>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {error ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input
                required
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                required
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                required
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              />
            </div>

            <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              This user will get access to the Accounts fees section and collection workflows.
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button className="gap-2" disabled={loading} type="submit">
                <CreditCard size={15} />
                {loading ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

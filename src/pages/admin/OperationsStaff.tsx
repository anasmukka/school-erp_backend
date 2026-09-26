import { useEffect, useState } from "react";
import { initializeApp, deleteApp } from "firebase/app";
import { createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { collection, doc, getDocs, query, setDoc, deleteDoc, where } from "firebase/firestore";
import firebaseApp, { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { User } from "@/lib/types";
import { logAuditEvent } from "@/lib/audit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Package,
  Plus,
  Trash2,
  Printer,
  BookOpen,
  Boxes,
  RotateCcw,
  ArrowUpRight,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function OperationsStaff() {
  const { appUser } = useAuth();
  const [staff, setStaff] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    designation: "Operations & Store In-Charge",
    phone: "",
  });

  const load = async () => {
    try {
      setLoading(true);
      const snapshot = await getDocs(query(collection(db, "users"), where("role", "==", "operations")));
      const list = snapshot.docs
        .map((record) => ({ id: record.id, ...record.data() } as User))
        .sort((a, b) => a.name.localeCompare(b.name));
      setStaff(list);
    } catch (err: any) {
      toast.error(err.message || "Failed to load operations staff.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      password: "",
      designation: "Operations & Store In-Charge",
      phone: "",
    });
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    let scopedApp: any = null;
    try {
      setSubmitting(true);
      const normalizedEmail = form.email.trim().toLowerCase();

      // Check if email already exists
      const existingSnap = await getDocs(
        query(collection(db, "users"), where("email", "==", normalizedEmail))
      );
      if (!existingSnap.empty) {
        toast.error("A user account with this email already exists.");
        return;
      }

      // Provision Auth user safely using secondary app instance so Admin is NOT logged out
      const scopedAppName = `ops-provision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      scopedApp = initializeApp(firebaseApp.options, scopedAppName);
      const scopedAuth = getAuth(scopedApp);

      const credential = await createUserWithEmailAndPassword(scopedAuth, normalizedEmail, form.password.trim());
      const uid = credential.user.uid;
      const now = new Date().toISOString();

      // Write user document
      await setDoc(doc(db, "users", uid), {
        name: form.name.trim(),
        email: normalizedEmail,
        role: "operations",
        designation: form.designation.trim() || "Operations Staff",
        phone: form.phone.trim() || "",
        createdAt: now,
      });

      if (appUser) {
        void logAuditEvent({
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
          action: "create",
          entity: "security" as any,
          entityId: uid,
          details: `Created Operations Staff account: ${form.name.trim()} (${normalizedEmail})`,
        });
      }

      toast.success(`Operations Staff account created for ${form.name.trim()}`);
      setOpen(false);
      resetForm();
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to create operations staff user.");
    } finally {
      if (scopedApp) {
        await deleteApp(scopedApp).catch(() => {});
      }
      setSubmitting(false);
    }
  };

  const handleDeleteStaff = async (member: User) => {
    if (!appUser) return;
    if (!window.confirm(`Are you sure you want to remove Operations Staff account for ${member.name}?`)) {
      return;
    }
    try {
      await deleteDoc(doc(db, "users", member.id));
      void logAuditEvent({
        userId: appUser.id,
        userName: appUser.name,
        role: appUser.role,
        action: "delete",
        entity: "security" as any,
        entityId: member.id,
        details: `Deleted Operations Staff account for ${member.name} (${member.email})`,
      });
      toast.success(`Staff account for ${member.name} removed.`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete user.");
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Operations Staff Management</h1>
              <p className="text-sm text-muted-foreground">
                Manage accounts for staff accessing the dedicated Operations Panel (Printing Orders, Library, and Inventory & Uniforms).
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => setOpen(true)} className="rounded-xl">
            <Plus className="h-4 w-4 mr-1.5" /> Add Operations User
          </Button>
          <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
            <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Quick Launch Cards for Admin */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/printing">
          <div className="glass-card hover-elevate rounded-2xl p-4 cursor-pointer group border border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 shrink-0">
                  <Printer size={20} />
                </div>
                <div>
                  <p className="font-semibold text-sm">Printing Console</p>
                  <p className="text-xs text-muted-foreground">Inspect print queue</p>
                </div>
              </div>
              <ArrowUpRight size={16} className="text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
            </div>
          </div>
        </Link>

        <Link href="/library">
          <div className="glass-card hover-elevate rounded-2xl p-4 cursor-pointer group border border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                  <BookOpen size={20} />
                </div>
                <div>
                  <p className="font-semibold text-sm">Library Console</p>
                  <p className="text-xs text-muted-foreground">Catalog & circulation</p>
                </div>
              </div>
              <ArrowUpRight size={16} className="text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
            </div>
          </div>
        </Link>

        <Link href="/inventory">
          <div className="glass-card hover-elevate rounded-2xl p-4 cursor-pointer group border border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <Boxes size={20} />
                </div>
                <div>
                  <p className="font-semibold text-sm">Inventory & Uniforms</p>
                  <p className="text-xs text-muted-foreground">Stock & size matrix</p>
                </div>
              </div>
              <ArrowUpRight size={16} className="text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
            </div>
          </div>
        </Link>
      </div>

      {/* Staff Accounts Card List */}
      <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border/60 bg-muted/20 flex justify-between items-center">
          <h2 className="font-semibold text-sm">Active Operations Accounts ({staff.length})</h2>
          <span className="text-xs text-muted-foreground">
            Staff users log in at the main login screen and land directly on their Operations Console.
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-muted-foreground">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
            <p>Loading accounts...</p>
          </div>
        ) : staff.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-2 text-muted-foreground/40" />
            <p className="font-medium">No Operations Staff users created yet.</p>
            <p className="text-xs mt-0.5">Click "+ Add Operations User" to grant a staff member access to Printing, Library, and Inventory.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {staff.map((member) => (
              <Card key={member.id} className="rounded-2xl border border-border/60 shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{member.name}</h3>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    title="Delete Account"
                    onClick={() => handleDeleteStaff(member)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="bg-muted/20 p-2.5 rounded-xl border border-border/60 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Designation:</span>
                    <span className="font-medium">{(member as any).designation || "Operations Staff"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Panel Access:</span>
                    <span className="font-semibold text-primary">Printing, Library, Inventory</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      {/* Add User Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Add Operations Staff Account
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Full Name *</Label>
              <Input
                placeholder="e.g. Rajesh Kumar"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Email Address *</Label>
              <Input
                type="email"
                placeholder="e.g. operations@school.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Password *</Label>
              <Input
                type="password"
                placeholder="Minimum 6 characters"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Designation / Role Title</Label>
              <Input
                placeholder="e.g. Operations Manager, Storekeeper, Librarian"
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Phone Number (Optional)</Label>
              <Input
                placeholder="e.g. +91 9876543210"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div className="p-3 bg-muted/20 rounded-xl border border-border/60 text-xs">
              <span className="font-semibold block mb-1">Assigned Modules:</span>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                <li>Printing Department Orders</li>
                <li>Library Catalog, Circulation & Fines</li>
                <li>Inventory, Uniforms & Textbooks</li>
              </ul>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating..." : "Create Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Signature, Upload, Loader2, Trash2, Search } from "lucide-react";

interface AppUserRecord {
  id: string;
  name: string;
  email?: string;
  role: string;
}

interface SignatureDoc {
  id: string;
  userId?: string;
  role?: string;
  name?: string;
  imageUrl?: string;
  updatedAt?: string;
}

const SIGNABLE_ROLES = ["admin", "hod", "teacher", "accountant"] as const;
type SignableRole = (typeof SIGNABLE_ROLES)[number];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function SignatureManagement() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AppUserRecord[]>([]);
  const [sigs, setSigs] = useState<Record<string, SignatureDoc>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<SignableRole | "all">("all");

  const load = async () => {
    setLoading(true);
    try {
      const [userSnap, sigSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), where("role", "in", [...SIGNABLE_ROLES]))),
        getDocs(collection(db, "signatures")),
      ]);

      const fetchedUsers = userSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as AppUserRecord))
        .filter((u) => SIGNABLE_ROLES.includes(u.role as SignableRole))
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));

      const sigMap: Record<string, SignatureDoc> = {};
      sigSnap.docs.forEach((d) => {
        const data = d.data() as any;
        const userId = String(data.userId || d.id || "").trim();
        if (!userId) return;
        sigMap[userId] = {
          id: d.id,
          userId,
          role: data.role,
          name: data.name,
          imageUrl: data.imageUrl,
          updatedAt: data.updatedAt,
        };
      });

      setUsers(fetchedUsers);
      setSigs(sigMap);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUpload = async (user: AppUserRecord, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file (PNG, JPG).", variant: "destructive" });
      return;
    }
    if (file.size > 500 * 1024) {
      toast({ title: "File too large", description: "Signature image must be under 500KB.", variant: "destructive" });
      return;
    }
    setSaving(user.id);
    try {
      const base64 = await fileToBase64(file);
      const now = new Date().toISOString();
      await setDoc(doc(db, "signatures", user.id), {
        userId: user.id,
        role: user.role,
        name: user.name,
        imageUrl: base64,
        updatedAt: now,
      });
      setSigs((prev) => ({
        ...prev,
        [user.id]: { id: user.id, userId: user.id, role: user.role, name: user.name, imageUrl: base64, updatedAt: now },
      }));
      toast({ title: "Signature saved", description: `Signature uploaded for ${user.name}.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const deleteSignature = async (user: AppUserRecord) => {
    const existing = sigs[user.id];
    if (!existing) return;
    setSaving(user.id);
    try {
      setSigs((prev) => ({
        ...Object.fromEntries(Object.entries(prev).filter(([key]) => key !== user.id)),
      }));
      await deleteDoc(doc(db, "signatures", user.id));
      toast({ title: "Signature removed", description: `Removed signature for ${user.name}.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (!queryText) return true;
      return (
        (user.name || "").toLowerCase().includes(queryText)
        || (user.email || "").toLowerCase().includes(queryText)
      );
    });
  }, [roleFilter, search, users]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-muted-foreground" size={32} />
      </div>
    );
  }

  return (
    <div data-testid="signature-management" className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manage Signatures</h1>
        <p className="text-sm text-muted-foreground">
          Upload signature images for staff users. Students are excluded.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr,220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff by name or email..."
            className="pl-9"
          />
        </div>
        <div>
          <Label className="text-xs">Role</Label>
          <select
            className="mt-1 w-full border border-input rounded-xl px-3 py-2 text-sm bg-white/70 shadow-[0_8px_16px_-14px_rgba(15,23,42,0.9)] backdrop-blur-md"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
          >
            <option value="all">All staff roles</option>
            <option value="admin">Admin</option>
            <option value="hod">HOD</option>
            <option value="teacher">Teacher</option>
            <option value="accountant">Accountant</option>
          </select>
        </div>
      </div>

      {filteredUsers.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground text-sm">
            No staff users found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredUsers.map((user) => {
            const sig = sigs[user.id];
            return (
              <Card key={user.id} data-testid={`sig-card-${user.id}`}>
                <CardContent className="pt-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Signature size={20} className="text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {user.email || ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Role: <span className="font-semibold">{user.role.toUpperCase()}</span>
                        </p>
                      </div>
                    </div>

                    {sig?.imageUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-red-600 hover:bg-red-50"
                        onClick={() => deleteSignature(user)}
                        disabled={saving === user.id}
                      >
                        {saving === user.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </Button>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {sig?.updatedAt ? `Updated: ${new Date(sig.updatedAt).toLocaleDateString("en-IN")}` : "No signature uploaded"}
                  </p>

                  {sig?.imageUrl && (
                    <div className="border border-border rounded-lg p-3 bg-white">
                      <img src={sig.imageUrl} alt={`${user.name} signature`} className="max-h-20 mx-auto object-contain" />
                    </div>
                  )}

                  <div>
                    <Label className="text-xs block mb-1.5">
                      {sig ? "Replace Signature" : "Upload Signature"}
                    </Label>
                    <label className="flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors">
                      {saving === user.id ? (
                        <Loader2 size={16} className="animate-spin text-muted-foreground" />
                      ) : (
                        <Upload size={16} className="text-muted-foreground" />
                      )}
                      <span className="text-sm text-muted-foreground">
                        {saving === user.id ? "Uploading..." : "Choose image (PNG/JPG, max 500KB)"}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUpload(user, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="bg-muted/50 rounded-xl border border-border px-5 py-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">How signatures work</p>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          <li>Upload a scanned signature image for each staff user</li>
          <li>These images will be embedded in the report card PDF</li>
          <li>Class teacher, HOD, and principal signatures come from the users who sign the report card</li>
          <li>For best results, use a transparent PNG with clear signature</li>
        </ul>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { HodNotice } from "@/lib/types";
import { CalendarDays, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Unable to read file"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type FormState = {
  grade: string;
  title: string;
  message: string;
  images: { file: File; name: string }[];
};

export default function HodNotices() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<HodNotice[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const assignedGrades = useMemo(() => (appUser?.assignedGrades ?? []).map(String).filter(Boolean), [appUser]);

  const buildEmptyForm = (): FormState => ({
    grade: assignedGrades[0] ?? "",
    title: "",
    message: "",
    images: [],
  });

  const [form, setForm] = useState<FormState>(() => buildEmptyForm());

  useEffect(() => {
    setForm((current) => ({
      ...current,
      grade: current.grade || (assignedGrades[0] ?? ""),
    }));
  }, [assignedGrades.join("|")]);

  useEffect(() => {
    if (!appUser) return () => {};
    setLoading(true);

    const q = query(
      collection(db, "notices"),
      where("hodId", "==", appUser.id),
      where("type", "==", "general"),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HodNotice));
        next.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
        setRecords(next);
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
    );

    return unsub;
  }, [appUser?.id]);

  const addImages = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (next.length === 0) {
      toast({ title: "Invalid files", description: "Please choose image files.", variant: "destructive" });
      return;
    }
    const tooLarge = next.find((f) => f.size > 350 * 1024);
    if (tooLarge) {
      toast({ title: "Image too large", description: "Each image must be under 350KB.", variant: "destructive" });
      return;
    }

    setForm((current) => ({
      ...current,
      images: [...current.images, ...next.map((f) => ({ file: f, name: f.name }))].slice(0, 3),
    }));
  };

  const publish = async () => {
    if (!appUser) return;
    if (!form.grade) {
      toast({ title: "Grade required", description: "Select a grade.", variant: "destructive" });
      return;
    }
    if (!form.message.trim()) {
      toast({ title: "Message required", description: "Enter notice text.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const images = await Promise.all(
        form.images.map(async (img) => ({
          name: img.name,
          dataUrl: await fileToDataUrl(img.file),
        })),
      );

      await addDoc(collection(db, "notices"), {
        type: "general",
        grade: form.grade,
        title: form.title.trim(),
        message: form.message.trim(),
        images,
        hodId: appUser.id,
        createdAt: new Date().toISOString(),
      } satisfies Omit<HodNotice, "id">);

      setForm(buildEmptyForm());
      toast({ title: "Notice published", description: `Published for Grade ${form.grade}.` });
    } catch (error: any) {
      toast({ title: "Publish failed", description: error?.message || "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (notice: HodNotice) => {
    if (!confirm("Delete this notice?")) return;
    try {
      await deleteDoc(doc(db, "notices", notice.id));
      toast({ title: "Deleted", description: "Notice removed." });
    } catch (error: any) {
      toast({ title: "Delete failed", description: error?.message || "Try again.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6" data-testid="hod-notices-page">
      <section className="overflow-hidden rounded-[26px] border border-[#e4ddcf] bg-[linear-gradient(145deg,rgba(255,252,245,0.98),rgba(248,243,232,0.94))] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.6)]">
        <div className="px-6 py-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8ccb8] bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#5d6782]">
                <ImageIcon size={14} />
                Notices
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">Post a notice</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Add text and up to 3 images for students of a selected grade.
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-2 rounded-full bg-[#f2ebdc] px-3 py-1 text-xs font-medium text-slate-600">
              <CalendarDays size={14} />
              {new Date().toLocaleDateString("en-IN")}
            </span>
          </div>
        </div>
      </section>

      {assignedGrades.length === 0 ? (
        <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No grades assigned to this HOD account.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Grade</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.grade}
                  onChange={(e) => setForm((c) => ({ ...c, grade: e.target.value }))}
                >
                  {assignedGrades.map((g) => (
                    <option key={g} value={g}>Grade {g}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>Title (optional)</Label>
                <Input value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} placeholder="e.g. PTM reminder" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea value={form.message} onChange={(e) => setForm((c) => ({ ...c, message: e.target.value }))} rows={5} placeholder="Write the notice..." />
            </div>

            <div className="space-y-2">
              <Label>Images (optional)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  type="button"
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={16} />
                  Add images
                </Button>
                <span className="text-xs text-muted-foreground">{form.images.length}/3 selected</span>
              </div>
              {form.images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {form.images.map((img) => (
                    <span
                      key={img.name}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-xs text-muted-foreground"
                    >
                      {img.name}
                      <button
                        type="button"
                        className="text-slate-500 hover:text-slate-900"
                        onClick={() => setForm((c) => ({ ...c, images: c.images.filter((x) => x.name !== img.name) }))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={publish} disabled={saving} className="gap-2">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
                Publish
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-lg font-semibold">Published notices</p>
              <p className="text-sm text-muted-foreground">Only general notices created by this HOD.</p>
            </div>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="animate-spin text-muted-foreground" size={26} />
            </div>
          ) : records.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No notices yet.
            </div>
          ) : (
            <div className="space-y-3">
              {records.map((notice) => (
                <div key={notice.id} className="rounded-2xl border border-border bg-white/85 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">
                        {notice.title?.trim() ? notice.title : "Notice"}
                        <span className="ml-2 text-xs font-semibold text-muted-foreground">Grade {notice.grade}</span>
                      </p>
                      <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{notice.message}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">
                        {notice.createdAt ? new Date(notice.createdAt).toLocaleDateString("en-IN") : ""}
                      </span>
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-red-600 hover:bg-red-50" onClick={() => remove(notice)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>

                  {notice.images && notice.images.length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {notice.images.slice(0, 3).map((img) => (
                        <img
                          key={img.name}
                          src={img.dataUrl}
                          alt={img.name}
                          className="h-28 w-full rounded-xl object-cover border border-border"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


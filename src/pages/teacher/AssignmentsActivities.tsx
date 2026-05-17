import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AssignmentActivity, AssignmentActivityKind, Section } from "@/lib/types";
import { CalendarDays, Loader2, Lock, Plus, RefreshCcw, Upload } from "lucide-react";

type FormState = {
  kind: AssignmentActivityKind;
  title: string;
  dueDate: string;
  description: string;
  images: { file: File; name: string }[];
};

function getLocalIsoDate(date = new Date()) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

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

export default function AssignmentsActivities() {
  const { appUser, loading } = useAuth();
  const { toast } = useToast();
  const [initializing, setInitializing] = useState(true);
  const [teacherDocId, setTeacherDocId] = useState<string | null>(null);
  const [assignedSection, setAssignedSection] = useState<Section | null>(null);
  const [items, setItems] = useState<AssignmentActivity[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const todayIso = useMemo(() => getLocalIsoDate(), []);

  const buildEmptyForm = (): FormState => ({
    kind: "assignment",
    title: "",
    dueDate: todayIso,
    description: "",
    images: [],
  });

  const [form, setForm] = useState<FormState>(buildEmptyForm);

  const loadTeacherSection = async () => {
    if (!appUser) return;
    setInitializing(true);
    try {
      let teacherSnap = await getDocs(query(collection(db, "teachers"), where("uid", "==", appUser.id)));
      if (teacherSnap.empty && appUser.email) {
        teacherSnap = await getDocs(query(collection(db, "teachers"), where("email", "==", appUser.email)));
        if (!teacherSnap.empty) {
          const { doc: firestoreDoc, updateDoc } = await import("firebase/firestore");
          updateDoc(firestoreDoc(db, "teachers", teacherSnap.docs[0].id), { uid: appUser.id }).catch(() => {});
        }
      }

      if (teacherSnap.empty) {
        setTeacherDocId(null);
        setAssignedSection(null);
        return;
      }

      const tDocId = teacherSnap.docs[0].id;
      setTeacherDocId(tDocId);

      const sectionSnap = await getDocs(query(collection(db, "sections"), where("classTeacherId", "==", tDocId)));
      const secs = sectionSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
      secs.sort((a, b) => {
        if (a.grade !== b.grade) return a.grade.localeCompare(b.grade, undefined, { numeric: true });
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

      setAssignedSection(secs[0] ?? null);
    } catch (error: any) {
      toast({
        title: "Unable to load section",
        description: error?.message || "Please try again in a moment.",
        variant: "destructive",
      });
      setTeacherDocId(null);
      setAssignedSection(null);
    } finally {
      setInitializing(false);
    }
  };

  useEffect(() => {
    if (!appUser) return;
    loadTeacherSection();
  }, [appUser]);

  useEffect(() => {
    if (!assignedSection?.id) {
      setItems([]);
      return () => {};
    }

    const itemsQuery = query(
      collection(db, "assignmentsActivities"),
      where("sectionId", "==", assignedSection.id),
    );

    const unsubscribe = onSnapshot(
      itemsQuery,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssignmentActivity));
        next.sort((a, b) => {
          const due = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
          if (due !== 0) return due;
          return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
        });
        setItems(next);
      },
      () => {
        /* ignore */
      },
    );

    return unsubscribe;
  }, [assignedSection?.id]);

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
    if (!teacherDocId || !assignedSection?.id) return;
    if (!form.title.trim()) {
      toast({ title: "Title required", description: "Enter a title.", variant: "destructive" });
      return;
    }
    if (!form.dueDate) {
      toast({ title: "Due date required", description: "Select a due date.", variant: "destructive" });
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

      await addDoc(collection(db, "assignmentsActivities"), {
        kind: form.kind,
        title: form.title.trim(),
        description: form.description.trim(),
        dueDate: form.dueDate,
        sectionId: assignedSection.id,
        grade: assignedSection.grade,
        images,
        createdAt: new Date().toISOString(),
        createdBy: teacherDocId,
        createdByName: appUser?.name ?? "Teacher",
        whatsappStatus: "pending",
      } satisfies Omit<AssignmentActivity, "id">);

      setForm(buildEmptyForm());
      toast({
        title: "Published",
        description: "Assignment/activity saved. WhatsApp sending will run automatically (if configured).",
      });
    } catch (error: any) {
      toast({ title: "Publish failed", description: error?.message || "Try again in a moment.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const sectionLabel = assignedSection ? `Grade ${assignedSection.grade} - ${assignedSection.name}` : "";

  return (
    <div className="space-y-6" data-testid="teacher-assignments-activities-page">
      <section className="overflow-hidden rounded-[26px] border border-[#e4ddcf] bg-[linear-gradient(145deg,rgba(255,252,245,0.98),rgba(248,243,232,0.94))] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.6)]">
        <div className="px-6 py-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8ccb8] bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#5d6782]">
                <CalendarDays size={14} />
                Assignments & Activities
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">Publish work for students</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Students will see due dates in their portal. WhatsApp messages can be sent automatically via Cloud Functions.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="gap-2 border-[#d8ccb8] bg-white/80"
                onClick={loadTeacherSection}
                disabled={loading || initializing}
              >
                {initializing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
                Refresh
              </Button>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#f2ebdc] px-3 py-1 text-xs font-medium text-slate-600">
                <CalendarDays size={14} />
                {todayIso}
              </span>
            </div>
          </div>
        </div>
      </section>

      {initializing ? (
        <div className="flex h-72 items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" size={30} />
        </div>
      ) : !assignedSection ? (
        <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="py-12">
            <div className="flex items-start gap-3 text-slate-700">
              <div className="mt-0.5 rounded-full bg-slate-200 p-2">
                <Lock size={16} />
              </div>
              <div>
                <p className="font-semibold">No class section assigned</p>
                <p className="text-sm text-muted-foreground">
                  You need an assigned class section to publish assignments and activities.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{sectionLabel}</p>
                  <p className="text-sm text-muted-foreground">Create a new entry (max 3 images, 350KB each).</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.kind}
                    onChange={(e) => setForm((c) => ({ ...c, kind: e.target.value as AssignmentActivityKind }))}
                  >
                    <option value="assignment">Assignment</option>
                    <option value="activity">Activity</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label>Due date</Label>
                  <Input type="date" value={form.dueDate} onChange={(e) => setForm((c) => ({ ...c, dueDate: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} placeholder="e.g. Mathematics worksheet 5" />
              </div>

              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
                  placeholder="Add instructions for students..."
                  rows={4}
                />
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
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Publish
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-lg font-semibold">Published</p>
                  <p className="text-sm text-muted-foreground">Entries saved for this section.</p>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No assignments or activities yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-border bg-white/85 px-4 py-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">
                            {item.kind === "activity" ? "Activity: " : "Assignment: "}
                            {item.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Due: <span className="font-semibold">{item.dueDate}</span>
                            {" "}·{" "}
                            WhatsApp: {item.whatsappStatus || "pending"}
                          </p>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-IN") : ""}
                        </span>
                      </div>

                      {item.description ? (
                        <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{item.description}</p>
                      ) : null}

                      {item.images && item.images.length > 0 ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {item.images.slice(0, 3).map((img) => (
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
        </>
      )}
    </div>
  );
}


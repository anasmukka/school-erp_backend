import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import type { Notice, NoticePriority, NoticeTargetAudience } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  Calendar,
  Filter,
  Image as ImageIcon,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  AlertTriangle,
  Megaphone,
  Eye,
} from "lucide-react";

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

export default function AdminNotices() {
  const { appUser } = useAuth();
  const { activeSession, workingSession } = useAcademicSession();
  const { toast } = useToast();

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Dialog & Form
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [targetAudience, setTargetAudience] = useState<NoticeTargetAudience>("all");
  const [targetGrade, setTargetGrade] = useState("all");
  const [priority, setPriority] = useState<NoticePriority>("normal");
  const [images, setImages] = useState<{ file: File; name: string }[]>([]);
  const [formError, setFormError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [audienceFilter, setAudienceFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  // Image Preview Modal
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Real-time listener for notices
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, "notices"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Notice));
        list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setNotices(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading notices:", err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  const filteredNotices = useMemo(() => {
    return notices.filter((n) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (n.title || "").toLowerCase().includes(q);
        const matchMsg = (n.message || "").toLowerCase().includes(q);
        if (!matchTitle && !matchMsg) return false;
      }
      if (audienceFilter !== "all" && n.targetAudience && n.targetAudience !== audienceFilter) {
        return false;
      }
      if (gradeFilter !== "all" && n.grade && n.grade !== "all" && n.grade !== gradeFilter) {
        return false;
      }
      if (priorityFilter !== "all" && n.priority && n.priority !== priorityFilter) {
        return false;
      }
      return true;
    });
  }, [notices, searchQuery, audienceFilter, gradeFilter, priorityFilter]);

  const handleOpenCreate = () => {
    setTitle("");
    setMessage("");
    setTargetAudience("all");
    setTargetGrade("all");
    setPriority("normal");
    setImages([]);
    setFormError("");
    setDialogOpen(true);
  };

  const handleAddImages = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) {
      toast({ title: "Invalid files", description: "Only image files are allowed.", variant: "destructive" });
      return;
    }
    const tooLarge = list.find((f) => f.size > 500 * 1024);
    if (tooLarge) {
      toast({
        title: "Image too large",
        description: "Each image must be under 500KB for fast loading.",
        variant: "destructive",
      });
      return;
    }
    setImages((prev) => [...prev, ...list.map((f) => ({ file: f, name: f.name }))].slice(0, 3));
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveNotice = async () => {
    if (!title.trim()) {
      setFormError("Notice title is required.");
      return;
    }
    if (!message.trim()) {
      setFormError("Notice content message is required.");
      return;
    }

    setFormError("");
    setSaving(true);

    try {
      // Convert images to data URLs
      const encodedImages = await Promise.all(
        images.map(async (img) => ({
          name: img.name,
          dataUrl: await fileToDataUrl(img.file),
        })),
      );

      const now = new Date().toISOString();
      const currentSessionName = workingSession?.name || activeSession?.name || "2026-27";

      await addDoc(collection(db, "notices"), {
        type: "general",
        title: title.trim(),
        message: message.trim(),
        targetAudience,
        grade: targetGrade,
        priority,
        authorId: appUser?.id || "admin",
        authorName: appUser?.name || "School Administration",
        authorRole: "admin",
        images: encodedImages,
        createdAt: now,
        academicSession: currentSessionName,
      });

      toast({
        title: "Notice Broadcasted",
        description: "Your notice has been published and broadcasted successfully.",
      });
      setDialogOpen(false);
    } catch (err: any) {
      console.error("Failed to post notice:", err);
      setFormError(err?.message || "Failed to post notice.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNotice = async (noticeId: string) => {
    if (!confirm("Are you sure you want to delete this notice?")) return;
    try {
      await deleteDoc(doc(db, "notices", noticeId));
      toast({ title: "Notice deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete notice", description: err.message, variant: "destructive" });
    }
  };

  const getPriorityBadge = (p?: NoticePriority) => {
    switch (p) {
      case "urgent":
        return (
          <Badge className="bg-rose-600 hover:bg-rose-700 text-white gap-1 text-[11px] font-semibold">
            <AlertTriangle size={11} /> Urgent
          </Badge>
        );
      case "important":
        return (
          <Badge className="bg-amber-600 hover:bg-amber-700 text-white gap-1 text-[11px] font-semibold">
            Important
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700 text-[11px]">
            Normal
          </Badge>
        );
    }
  };

  const getAudienceLabel = (aud?: NoticeTargetAudience, grade?: string) => {
    let audStr = "All School";
    if (aud === "students") audStr = "Students";
    if (aud === "teachers") audStr = "Teachers";
    if (aud === "hods") audStr = "Section Heads (HODs)";

    const gradeStr = grade && grade !== "all" ? `Grade ${grade}` : "All Grades";
    return `${audStr} • ${gradeStr}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            School Notices & Circulars
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Broadcast official announcements, circulars, and notifications to students, teachers, and section heads.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-2 shrink-0">
          <Plus size={16} /> Post Notice
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-slate-200 shadow-xs">
        <CardContent className="p-3.5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search notices by title or content..."
              className="pl-8 h-9 text-xs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="w-40">
            <Select value={audienceFilter} onValueChange={setAudienceFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Audience" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Audiences</SelectItem>
                <SelectItem value="students" className="text-xs">Students Only</SelectItem>
                <SelectItem value="teachers" className="text-xs">Teachers Only</SelectItem>
                <SelectItem value="hods" className="text-xs">HODs Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-32">
            <Select value={gradeFilter} onValueChange={setGradeFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Grade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Grades</SelectItem>
                {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((g) => (
                  <SelectItem key={g} value={g} className="text-xs">Grade {g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-32">
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Priorities</SelectItem>
                <SelectItem value="normal" className="text-xs">Normal</SelectItem>
                <SelectItem value="important" className="text-xs">Important</SelectItem>
                <SelectItem value="urgent" className="text-xs">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(searchQuery || audienceFilter !== "all" || gradeFilter !== "all" || priorityFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-slate-500 hover:text-slate-800"
              onClick={() => {
                setSearchQuery("");
                setAudienceFilter("all");
                setGradeFilter("all");
                setPriorityFilter("all");
              }}
            >
              Reset
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Notices Feed */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="animate-spin h-8 w-8 text-primary" />
        </div>
      ) : filteredNotices.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="py-16 text-center space-y-2">
            <Bell className="mx-auto h-10 w-10 text-slate-300" />
            <h3 className="text-base font-semibold text-slate-800">No Notices Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No notices match your current filters or none have been published yet.
            </p>
            <Button onClick={handleOpenCreate} size="sm" className="gap-1.5 mt-2">
              <Plus size={14} /> Post First Notice
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredNotices.map((notice) => {
            const isUrgent = notice.priority === "urgent";
            const dateStr = notice.createdAt
              ? new Date(notice.createdAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "Recent";

            return (
              <Card
                key={notice.id}
                className={`border transition-all duration-200 shadow-xs ${
                  isUrgent
                    ? "border-rose-300 bg-rose-50/15"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-base font-bold text-slate-900">
                        {notice.title || "School Notice"}
                      </CardTitle>
                      {getPriorityBadge(notice.priority)}
                      <Badge variant="outline" className="text-[11px] bg-slate-50 text-slate-600 font-medium">
                        {getAudienceLabel(notice.targetAudience, notice.grade)}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <span className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Calendar size={12} /> {dateStr}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 rounded-full"
                        onClick={() => handleDeleteNotice(notice.id)}
                        title="Delete Notice"
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    Posted by: <strong className="text-slate-700">{notice.authorName || "Administration"}</strong>
                    {notice.academicSession && ` • Session ${notice.academicSession}`}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                    {notice.message}
                  </p>

                  {/* Attached images */}
                  {notice.images && notice.images.length > 0 && (
                    <div className="flex flex-wrap gap-2.5 pt-2">
                      {notice.images.map((img, idx) => (
                        <div
                          key={idx}
                          className="relative group rounded-lg overflow-hidden border border-slate-200 w-24 h-24 cursor-pointer"
                          onClick={() => setPreviewImage(img.dataUrl)}
                        >
                          <img
                            src={img.dataUrl}
                            alt={img.name || `Attachment ${idx + 1}`}
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                            <Eye size={16} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Post Notice Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b border-slate-100">
            <DialogTitle className="text-xl font-bold text-slate-900">
              Post School Notice or Circular
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Compose an official notice. It will appear on relevant student, teacher, or staff dashboards immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 space-y-4 flex-1 overflow-y-auto text-xs">
            {formError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg font-medium flex items-center gap-2">
                <AlertTriangle size={15} className="shrink-0" />
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Notice Title *</Label>
              <Input
                placeholder="e.g. Schedule of Annual Sports Meet 2026 / School Closure Circular"
                className="h-9 text-xs"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Target Options Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs font-semibold text-slate-700">Target Audience</Label>
                <Select value={targetAudience} onValueChange={(v: any) => setTargetAudience(v)}>
                  <SelectTrigger className="mt-1 h-9 text-xs">
                    <SelectValue placeholder="Select Audience" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">Entire School (All)</SelectItem>
                    <SelectItem value="students" className="text-xs">Students Only</SelectItem>
                    <SelectItem value="teachers" className="text-xs">Teachers Only</SelectItem>
                    <SelectItem value="hods" className="text-xs">Section Heads (HODs)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-700">Target Grade</Label>
                <Select value={targetGrade} onValueChange={setTargetGrade}>
                  <SelectTrigger className="mt-1 h-9 text-xs">
                    <SelectValue placeholder="Select Grade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Grades (1-12)</SelectItem>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((g) => (
                      <SelectItem key={g} value={g} className="text-xs">Grade {g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-700">Priority</Label>
                <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
                  <SelectTrigger className="mt-1 h-9 text-xs">
                    <SelectValue placeholder="Select Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal" className="text-xs">Normal</SelectItem>
                    <SelectItem value="important" className="text-xs">Important (Highlighted)</SelectItem>
                    <SelectItem value="urgent" className="text-xs">Urgent (Red Alert)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Notice Content / Message *</Label>
              <Textarea
                placeholder="Write the full announcement or circular text here..."
                className="text-xs resize-none h-32 leading-relaxed"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            {/* Image Attachments */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-700">
                  Image Attachments (Max 3, up to 500KB each)
                </Label>
                <span className="text-[11px] text-slate-400">{images.length} / 3</span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {images.map((img, idx) => (
                  <div
                    key={idx}
                    className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 group"
                  >
                    <img
                      src={URL.createObjectURL(img.file)}
                      alt={img.name}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveImage(idx)}
                      className="absolute top-1 right-1 bg-rose-600 text-white rounded-full p-1 opacity-90 hover:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}

                {images.length < 3 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-20 w-20 border-dashed flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-slate-800"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={16} />
                    <span className="text-[10px]">Add Image</span>
                  </Button>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleAddImages(e.target.files)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveNotice}
              disabled={saving}
              className="gap-1.5 bg-primary hover:bg-primary/90 text-white"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
              Publish Notice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full image preview lightbox */}
      {previewImage && (
        <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
          <DialogContent className="max-w-3xl p-2 bg-black/90 border-none text-white">
            <div className="relative flex items-center justify-center max-h-[80vh]">
              <img
                src={previewImage}
                alt="Attachment Preview"
                className="max-h-[80vh] max-w-full object-contain rounded"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

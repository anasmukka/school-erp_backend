import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { HodNotice, Student } from "@/lib/types";
import { CalendarDays, Image as ImageIcon, Loader2, RefreshCcw } from "lucide-react";

export default function StudentNotices() {
  const { appUser } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [records, setRecords] = useState<HodNotice[]>([]);

  const loadStudent = async () => {
    if (!appUser) return;
    setLoading(true);
    try {
      let studentSnap = await getDocs(query(collection(db, "students"), where("uid", "==", appUser.id)));
      if (studentSnap.empty && appUser.email) {
        studentSnap = await getDocs(query(collection(db, "students"), where("email", "==", appUser.email)));
      }
      if (studentSnap.empty) {
        setStudent(null);
        return;
      }
      setStudent({ id: studentSnap.docs[0].id, ...studentSnap.docs[0].data() } as Student);
    } catch (error: any) {
      toast({ title: "Unable to load notices", description: error?.message || "Try again.", variant: "destructive" });
      setStudent(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudent();
  }, [appUser]);

  useEffect(() => {
    if (!student?.grade) {
      setRecords([]);
      return () => {};
    }

    const q = query(
      collection(db, "notices"),
      where("grade", "==", student.grade),
      where("type", "==", "general"),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...d.data() } as HodNotice));
        next.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
        setRecords(next);
      },
      () => {
        /* ignore */
      },
    );

    return unsub;
  }, [student?.grade]);

  const headerLabel = useMemo(() => {
    const gradeLabel = student?.grade ? `Grade ${student.grade}` : "Notices";
    return gradeLabel;
  }, [student?.grade]);

  return (
    <div className="space-y-6" data-testid="student-notices-page">
      <section className="overflow-hidden rounded-[26px] border border-[#e4ddcf] bg-[linear-gradient(145deg,rgba(255,252,245,0.98),rgba(248,243,232,0.94))] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.6)]">
        <div className="px-6 py-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8ccb8] bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#5d6782]">
                <ImageIcon size={14} />
                Notices
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">{headerLabel}</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Updates shared by your HOD.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="gap-2 border-[#d8ccb8] bg-white/80" onClick={loadStudent}>
                <RefreshCcw size={15} />
                Refresh
              </Button>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#f2ebdc] px-3 py-1 text-xs font-medium text-slate-600">
                <CalendarDays size={14} />
                {new Date().toLocaleDateString("en-IN")}
              </span>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex h-72 items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" size={30} />
        </div>
      ) : !student ? (
        <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Student profile not found.
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No notices right now.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="pt-6">
            <div className="space-y-3">
              {records.map((notice) => (
                <div key={notice.id} className="rounded-2xl border border-border bg-white/85 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">
                        {notice.title?.trim() ? notice.title : "Notice"}
                      </p>
                      <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{notice.message}</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {notice.createdAt ? new Date(notice.createdAt).toLocaleDateString("en-IN") : ""}
                    </span>
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}


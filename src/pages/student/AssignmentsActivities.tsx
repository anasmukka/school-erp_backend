import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AssignmentActivity, AssignmentActivityKind, Student } from "@/lib/types";
import { CalendarDays, ClipboardList, Loader2, RefreshCcw } from "lucide-react";

function getLocalIsoDate(date = new Date()) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function daysUntil(dueDate: string) {
  const [y, m, d] = dueDate.split("-").map((v) => Number(v));
  if (!y || !m || !d) return null;
  const start = new Date();
  const end = new Date(y, m - 1, d);
  const diff = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Number.isFinite(diff) ? diff : null;
}

export default function StudentAssignmentsActivities() {
  const { appUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [items, setItems] = useState<AssignmentActivity[]>([]);
  const [kindFilter, setKindFilter] = useState<AssignmentActivityKind | "all">("all");
  const today = useMemo(() => getLocalIsoDate(), []);

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
      const { getStudentWithActiveEnrollment } = await import("@/lib/enrollments");
      const withEn = await getStudentWithActiveEnrollment(studentSnap.docs[0].id);
      setStudent(withEn);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudent();
  }, [appUser]);

  useEffect(() => {
    const sectionId = (student as { activeSectionId?: string | null })?.activeSectionId ?? student?.sectionId;
    if (!sectionId) {
      setItems([]);
      return () => {};
    }

    const q = query(collection(db, "assignmentsActivities"), where("sectionId", "==", sectionId));
    const unsub = onSnapshot(
      q,
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
    return unsub;
  }, [student?.sectionId]);

  const filtered = useMemo(() => {
    const base = items.filter((i) => i.dueDate && i.dueDate >= today);
    if (kindFilter === "all") return base;
    return base.filter((i) => i.kind === kindFilter);
  }, [items, kindFilter, today]);

  return (
    <div className="space-y-6" data-testid="student-assignments-activities-page">
      <section className="overflow-hidden rounded-[26px] border border-[#e4ddcf] bg-[linear-gradient(145deg,rgba(255,252,245,0.98),rgba(248,243,232,0.94))] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.6)]">
        <div className="px-6 py-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8ccb8] bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#5d6782]">
                <ClipboardList size={14} />
                Assignments & Activities
              </div>
              <div>
                <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">Due dates</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Upcoming work shared by your class teacher.
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
                {today}
              </span>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex h-72 items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" size={30} />
        </div>
      ) : !student?.sectionId ? (
        <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Your section is not assigned yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Filters</p>
              <p className="text-xs text-muted-foreground">Showing upcoming entries only.</p>
            </div>
            <div className="w-56">
              <Label className="text-xs">Type</Label>
              <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="assignment">Assignments</SelectItem>
                  <SelectItem value="activity">Activities</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card className="border-[#e4ddcf] bg-white/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.55)]">
            <CardContent className="pt-6">
              {filtered.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No upcoming assignments or activities.
                </div>
              ) : (
                <div className="space-y-3">
                  {filtered.map((item) => {
                    const remaining = item.dueDate ? daysUntil(item.dueDate) : null;
                    const remainingLabel =
                      remaining === null ? "" : remaining < 0 ? "Overdue" : remaining === 0 ? "Due today" : `${remaining} day(s) left`;
                    return (
                      <div key={item.id} className="rounded-2xl border border-border bg-white/85 px-4 py-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate">
                              {item.kind === "activity" ? "Activity: " : "Assignment: "}
                              {item.title}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Due: <span className="font-semibold">{item.dueDate}</span>
                              {remainingLabel ? ` · ${remainingLabel}` : ""}
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
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}


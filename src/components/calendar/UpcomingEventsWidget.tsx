import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { Link } from "wouter";
import {
  CalendarDays,
  Clock,
  MapPin,
  ChevronRight,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { getUpcomingCalendarItems, UserCalendarContext } from "@/lib/calendar";
import type { UnifiedCalendarItem } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function UpcomingEventsWidget({ className = "" }: { className?: string }) {
  const { appUser } = useAuth();
  const { workingSession, activeSession } = useAcademicSession();
  const [items, setItems] = useState<UnifiedCalendarItem[]>([]);
  const [loading, setLoading] = useState(true);

  const sessionId = workingSession?.id || activeSession?.id || "2026-27";

  const calendarLink = (() => {
    switch (appUser?.role) {
      case "admin":
        return "/admin/calendar";
      case "hod":
        return "/hod/calendar";
      case "teacher":
        return "/teacher/calendar";
      case "student":
        return "/student/calendar";
      default:
        return "/calendar";
    }
  })();

  useEffect(() => {
    if (!appUser) return;
    let isMounted = true;

    const loadUpcoming = async () => {
      try {
        setLoading(true);
        const ctx: UserCalendarContext = { user: appUser };

        // Resolve context for role
        if (appUser.role === "student") {
          let stuSnap = await getDocs(
            query(collection(db, "students"), where("uid", "==", appUser.id))
          );
          if (stuSnap.empty && appUser.email) {
            stuSnap = await getDocs(
              query(collection(db, "students"), where("email", "==", appUser.email))
            );
          }
          if (!stuSnap.empty) {
            const sData = stuSnap.docs[0].data();
            const enSnap = await getDocs(
              query(
                collection(db, "enrollments"),
                where("studentId", "==", stuSnap.docs[0].id),
                where("status", "==", "active")
              )
            );
            const enData = !enSnap.empty ? enSnap.docs[0].data() : null;
            ctx.student = {
              grade: String(enData?.className || sData.grade || ""),
              sectionId: enData?.sectionId || sData.sectionId || null,
            };
          }
        } else if (appUser.role === "teacher") {
          let tSnap = await getDocs(
            query(collection(db, "teachers"), where("uid", "==", appUser.id))
          );
          if (tSnap.empty && appUser.email) {
            tSnap = await getDocs(
              query(collection(db, "teachers"), where("email", "==", appUser.email))
            );
          }
          const tDocId = !tSnap.empty ? tSnap.docs[0].id : appUser.id;
          const [assignSnap, classTeacherSnap] = await Promise.all([
            getDocs(
              query(collection(db, "subjectAssignments"), where("teacherId", "==", tDocId))
            ),
            getDocs(
              query(collection(db, "sections"), where("classTeacherId", "==", tDocId))
            ),
          ]);
          const taughtSectionIds = Array.from(
            new Set(assignSnap.docs.map((d) => d.data().sectionId).filter(Boolean))
          );
          const classTeacherSectionId = !classTeacherSnap.empty
            ? classTeacherSnap.docs[0].id
            : null;

          const secDocs = await getDocs(collection(db, "sections"));
          const taughtGrades = new Set<string>();
          secDocs.docs.forEach((d) => {
            const data = d.data();
            if (taughtSectionIds.includes(d.id) || d.id === classTeacherSectionId) {
              if (data.grade) taughtGrades.add(String(data.grade));
            }
          });

          ctx.teacher = {
            taughtGrades: Array.from(taughtGrades),
            taughtSectionIds,
            classTeacherSectionId,
          };
        } else if (appUser.role === "hod") {
          ctx.hod = {
            managedGrades: (appUser.assignedGrades || []).map(String),
          };
        }

        const upcoming = await getUpcomingCalendarItems(sessionId, ctx, 4);
        if (isMounted) setItems(upcoming);
      } catch (err) {
        console.error("Failed to load upcoming events:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadUpcoming();
    return () => {
      isMounted = false;
    };
  }, [appUser, sessionId]);

  const formatDateLabel = (dateStr: string) => {
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    if (dateStr === today) return "Today";
    if (dateStr === tomorrowStr) return "Tomorrow";

    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  return (
    <Card className={`rounded-2xl border-slate-200/90 shadow-sm overflow-hidden bg-white/90 backdrop-blur-sm ${className}`}>
      <CardHeader className="p-4 pb-2 border-b border-slate-100 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <CalendarDays size={16} className="text-primary" /> Upcoming Events
        </CardTitle>
        <Link href={calendarLink}>
          <span className="text-xs font-semibold text-primary hover:underline flex items-center gap-0.5 cursor-pointer">
            Full Calendar <ChevronRight size={13} />
          </span>
        </Link>
      </CardHeader>

      <CardContent className="p-3">
        {loading ? (
          <div className="py-6 text-center text-xs text-slate-400">Loading events...</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            No upcoming events or examinations scheduled.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <Link key={item.id} href={calendarLink}>
                <div className="p-2 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/70 hover:border-slate-200 transition-all cursor-pointer flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Date Pill */}
                    <div className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-center shrink-0 min-w-[50px] shadow-2xs">
                      <span className="text-[10px] font-bold text-slate-900 leading-none block">
                        {formatDateLabel(item.startDate)}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1 font-medium">
                          <Clock size={10} className="text-primary" />
                          {item.allDay ? "All Day" : item.startTime || "Scheduled"}
                        </span>
                        {item.location && (
                          <span className="truncate flex items-center gap-0.5 text-slate-400">
                            • <MapPin size={10} /> {item.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Badge */}
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 shrink-0 font-semibold"
                    style={{ borderColor: item.color, color: item.color }}
                  >
                    {item.typeName}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

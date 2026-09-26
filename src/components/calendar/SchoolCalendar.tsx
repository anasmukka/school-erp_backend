import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  MapPin,
  Users,
  Search,
  Filter,
  Tag,
  AlertTriangle,
  FileText,
  Paperclip,
  CheckCircle2,
  X,
  Layers,
  Sparkles,
  CalendarDays,
  CalendarRange,
  List,
  Edit2,
  Trash2,
  Ban,
  Eye,
  Settings,
  GraduationCap,
  Bell,
  RefreshCw,
  Info,
} from "lucide-react";
import {
  listEventTypes,
  createEventType,
  updateEventType,
  archiveEventType,
  createSchoolEvent,
  updateSchoolEvent,
  cancelSchoolEvent,
  archiveSchoolEvent,
  deleteSchoolEvent,
  getUnifiedCalendar,
  PRESET_EVENT_COLORS,
  UserCalendarContext,
} from "@/lib/calendar";
import type {
  SchoolEvent,
  EventType,
  UnifiedCalendarItem,
  EventAudienceType,
  EventPriority,
  EventStatus,
  Section,
} from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// Days of week header (Mon - Sun)
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ALL_GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

interface SchoolCalendarProps {
  initialView?: "month" | "week" | "day" | "agenda";
  readOnly?: boolean;
  forcedAudience?: EventAudienceType;
  titleOverride?: string;
  portalName?: string;
}

export default function SchoolCalendar({
  initialView = "month",
  readOnly = false,
  titleOverride,
  portalName,
}: SchoolCalendarProps) {
  const { appUser } = useAuth();
  const { workingSession, activeSession, sessions, setWorkingSessionId } = useAcademicSession();
  const { toast } = useToast();

  const currentSessionId = workingSession?.id || activeSession?.id || "2026-27";
  const currentSessionName = workingSession?.name || activeSession?.name || "2026-27";

  // Navigation & View Mode
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<"month" | "week" | "day" | "agenda">(initialView);

  // Data state
  const [loading, setLoading] = useState(true);
  const [calendarItems, setCalendarItems] = useState<UnifiedCalendarItem[]>([]);
  const [eventTypes, setEventTypes] = useState<EventType[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  // User context for security & audience scope
  const [userContext, setUserContext] = useState<UserCalendarContext>({
    user: appUser!,
  });

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  // Selected item for details modal
  const [selectedItem, setSelectedItem] = useState<UnifiedCalendarItem | null>(null);

  // Manage Categories modal
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState(PRESET_EVENT_COLORS[0]);
  const [newCategoryDesc, setNewCategoryDesc] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  // Create / Edit Event modal
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [modalSaving, setModalSaving] = useState(false);

  // Form State
  const [eventTitle, setEventTitle] = useState("");
  const [eventTypeId, setEventTypeId] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [eventStartTime, setEventStartTime] = useState("09:00");
  const [eventEndTime, setEventEndTime] = useState("10:00");
  const [eventAllDay, setEventAllDay] = useState(false);
  const [eventLocation, setEventLocation] = useState("");
  const [eventOrganizer, setEventOrganizer] = useState("");
  const [eventPriority, setEventPriority] = useState<EventPriority>("normal");
  const [eventStatus, setEventStatus] = useState<EventStatus>("published");
  const [eventAudienceType, setEventAudienceType] = useState<EventAudienceType>("entire_school");
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [eventNotes, setEventNotes] = useState("");
  const [notifyAudience, setNotifyAudience] = useState(true);

  // Recurrence Form State
  const [recurrenceFreq, setRecurrenceFreq] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([1]); // default Mon
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");

  // Assembly Form State
  const [assemblyTheme, setAssemblyTheme] = useState("");
  const [assemblyConductedBy, setAssemblyConductedBy] = useState("");
  const [assemblySpecialNotes, setAssemblySpecialNotes] = useState("");

  // Cancellation prompt modal
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const isAdmin = appUser?.role === "admin" && !readOnly;

  // 1. Resolve user calendar context (Student/Teacher/HOD grade & section bindings)
  useEffect(() => {
    if (!appUser) return;
    let isMounted = true;

    const resolveContext = async () => {
      try {
        const ctx: UserCalendarContext = { user: appUser };

        if (appUser.role === "student") {
          // Resolve student active grade & section
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
            // Also check active enrollment
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
          // Resolve teacher assignments
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

          // Fetch grades for these sections
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

        if (isMounted) {
          setUserContext(ctx);
        }
      } catch (err) {
        console.error("Error resolving user calendar context:", err);
      }
    };

    resolveContext();
    return () => {
      isMounted = false;
    };
  }, [appUser]);

  // 2. Fetch sections & event types once
  useEffect(() => {
    let isMounted = true;
    Promise.all([listEventTypes(true), getDocs(collection(db, "sections"))]).then(
      ([types, secSnap]) => {
        if (!isMounted) return;
        setEventTypes(types);
        const secs = secSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Section));
        secs.sort((a, b) => (a.grade || "").localeCompare(b.grade || "") || a.name.localeCompare(b.name));
        setSections(secs);
      }
    );
    return () => {
      isMounted = false;
    };
  }, []);

  // 3. Compute active date range for the current view
  const { rangeStart, rangeEnd, displayTitle } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    if (viewMode === "month") {
      // First day of month
      const firstDay = new Date(year, month, 1);
      // Last day of month
      const lastDay = new Date(year, month + 1, 0);

      // Pad to start on Monday (0=Sun, 1=Mon, ..., 6=Sat)
      const startDayOfWeek = (firstDay.getDay() + 6) % 7; // 0=Mon, 6=Sun
      const paddedStart = new Date(firstDay);
      paddedStart.setDate(firstDay.getDate() - startDayOfWeek);

      const endDayOfWeek = (lastDay.getDay() + 6) % 7;
      const paddedEnd = new Date(lastDay);
      paddedEnd.setDate(lastDay.getDate() + (6 - endDayOfWeek));

      const monthName = currentDate.toLocaleString("en-US", { month: "long", year: "numeric" });
      return {
        rangeStart: paddedStart.toISOString().split("T")[0],
        rangeEnd: paddedEnd.toISOString().split("T")[0],
        displayTitle: monthName,
      };
    }

    if (viewMode === "week") {
      const cur = new Date(currentDate);
      const dayOfWeek = (cur.getDay() + 6) % 7;
      const mon = new Date(cur);
      mon.setDate(cur.getDate() - dayOfWeek);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);

      const startFmt = mon.toLocaleDateString("en-US", { day: "numeric", month: "short" });
      const endFmt = sun.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
      return {
        rangeStart: mon.toISOString().split("T")[0],
        rangeEnd: sun.toISOString().split("T")[0],
        displayTitle: `${startFmt} – ${endFmt}`,
      };
    }

    if (viewMode === "day") {
      const curStr = currentDate.toISOString().split("T")[0];
      const dayFmt = currentDate.toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      return {
        rangeStart: curStr,
        rangeEnd: curStr,
        displayTitle: dayFmt,
      };
    }

    // Agenda: 7 days back to 90 days ahead
    const past = new Date(currentDate);
    past.setDate(past.getDate() - 7);
    const future = new Date(currentDate);
    future.setDate(future.getDate() + 90);
    return {
      rangeStart: past.toISOString().split("T")[0],
      rangeEnd: future.toISOString().split("T")[0],
      displayTitle: `Agenda: ${currentDate.toLocaleString("en-US", { month: "short", year: "numeric" })}`,
    };
  }, [currentDate, viewMode]);

  // 4. Fetch unified events & aggregated exams
  const loadCalendarData = useCallback(async () => {
    if (!currentSessionId || !userContext.user) return;
    setLoading(true);
    try {
      const items = await getUnifiedCalendar({
        sessionId: currentSessionId,
        rangeStart,
        rangeEnd,
        userContext,
        filters: {
          eventTypeId: typeFilter,
          grade: gradeFilter,
          priority: priorityFilter,
          search: searchQuery,
        },
      });
      setCalendarItems(items);
    } catch (err) {
      console.error("Failed to load calendar data:", err);
      toast({ title: "Failed to load events", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentSessionId, rangeStart, rangeEnd, userContext, typeFilter, gradeFilter, priorityFilter, searchQuery, toast]);

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  // Navigation handlers
  const handlePrev = () => {
    const next = new Date(currentDate);
    if (viewMode === "month") next.setMonth(next.getMonth() - 1);
    else if (viewMode === "week") next.setDate(next.getDate() - 7);
    else if (viewMode === "day") next.setDate(next.getDate() - 1);
    else next.setMonth(next.getMonth() - 1);
    setCurrentDate(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (viewMode === "month") next.setMonth(next.getMonth() + 1);
    else if (viewMode === "week") next.setDate(next.getDate() + 7);
    else if (viewMode === "day") next.setDate(next.getDate() + 1);
    else next.setMonth(next.getMonth() + 1);
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Helper: Open Create Event modal
  const handleOpenCreateEvent = (datePreset?: string) => {
    const targetDate = datePreset || new Date().toISOString().split("T")[0];
    setEditingEventId(null);
    setEventTitle("");
    setEventTypeId(eventTypes[0]?.id || "");
    setEventDescription("");
    setEventStartDate(targetDate);
    setEventEndDate(targetDate);
    setEventStartTime("08:30");
    setEventEndTime("09:30");
    setEventAllDay(false);
    setEventLocation("");
    setEventOrganizer(appUser?.name || "School Administration");
    setEventPriority("normal");
    setEventStatus("published");
    setEventAudienceType("entire_school");
    setSelectedGrades([]);
    setSelectedSectionIds([]);
    setSelectedRoles([]);
    setEventNotes("");
    setNotifyAudience(true);

    // Recurrence
    setRecurrenceFreq("none");
    setRecurrenceDays([new Date(targetDate).getDay()]);
    setRecurrenceEndDate("");

    // Assembly
    setAssemblyTheme("");
    setAssemblyConductedBy("");
    setAssemblySpecialNotes("");

    setEventModalOpen(true);
  };

  // Helper: Open Edit Event modal
  const handleOpenEditEvent = (ev: SchoolEvent) => {
    setEditingEventId(ev.id);
    setEventTitle(ev.title);
    setEventTypeId(ev.eventTypeId);
    setEventDescription(ev.description || "");
    setEventStartDate(ev.startDate);
    setEventEndDate(ev.endDate || ev.startDate);
    setEventStartTime(ev.startTime || "09:00");
    setEventEndTime(ev.endTime || "10:00");
    setEventAllDay(Boolean(ev.allDay));
    setEventLocation(ev.location || "");
    setEventOrganizer(ev.organizer || "");
    setEventPriority(ev.priority || "normal");
    setEventStatus(ev.status || "published");
    setEventAudienceType(ev.audienceType || "entire_school");
    setSelectedGrades(ev.audienceType === "specific_grades" ? ev.audienceIds || [] : []);
    setSelectedSectionIds(ev.audienceType === "specific_sections" ? ev.audienceIds || [] : []);
    setSelectedRoles(ev.audienceType === "specific_roles" ? ev.audienceIds || [] : []);
    setEventNotes(ev.notes || "");
    setNotifyAudience(false);

    // Recurrence
    setRecurrenceFreq(ev.recurrence?.frequency || "none");
    setRecurrenceDays(ev.recurrence?.daysOfWeek || [new Date(ev.startDate).getDay()]);
    setRecurrenceEndDate(ev.recurrence?.endDate || "");

    // Assembly
    setAssemblyTheme(ev.assemblyDetails?.theme || "");
    setAssemblyConductedBy(ev.assemblyDetails?.conductedBy || "");
    setAssemblySpecialNotes(ev.assemblyDetails?.specialNotes || "");

    setEventModalOpen(true);
    setSelectedItem(null);
  };

  // Save Event Handler (Create or Update)
  const handleSaveEvent = async () => {
    if (!eventTitle.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    if (!eventStartDate) {
      toast({ title: "Start date is required", variant: "destructive" });
      return;
    }
    if (!eventTypeId) {
      toast({ title: "Please select an event category", variant: "destructive" });
      return;
    }

    setModalSaving(true);
    try {
      const typeInfo = eventTypes.find((t) => t.id === eventTypeId);
      const isAssembly = typeInfo?.name.toLowerCase().includes("assembly");

      // Compute audience IDs
      let audienceIds: string[] = [];
      if (eventAudienceType === "specific_grades") audienceIds = selectedGrades;
      else if (eventAudienceType === "specific_sections") audienceIds = selectedSectionIds;
      else if (eventAudienceType === "specific_roles") audienceIds = selectedRoles;

      const recurrence =
        recurrenceFreq !== "none"
          ? {
              frequency: recurrenceFreq,
              interval: 1,
              daysOfWeek: recurrenceFreq === "weekly" ? recurrenceDays : undefined,
              endDate: recurrenceEndDate || undefined,
            }
          : undefined;

      const assemblyDetails = isAssembly
        ? {
            theme: assemblyTheme.trim() || undefined,
            conductedBy: assemblyConductedBy.trim() || undefined,
            specialNotes: assemblySpecialNotes.trim() || undefined,
          }
        : undefined;

      const payload = {
        sessionId: currentSessionId,
        academicYear: currentSessionName,
        title: eventTitle.trim(),
        description: eventDescription.trim(),
        eventTypeId,
        eventTypeName: typeInfo?.name || "General",
        eventTypeColor: typeInfo?.color || "#6366f1",
        startDate: eventStartDate,
        endDate: eventEndDate || eventStartDate,
        startTime: eventAllDay ? undefined : eventStartTime,
        endTime: eventAllDay ? undefined : eventEndTime,
        allDay: eventAllDay,
        location: eventLocation.trim() || undefined,
        organizer: eventOrganizer.trim() || undefined,
        priority: eventPriority,
        status: eventStatus,
        audienceType: eventAudienceType,
        audienceIds,
        notes: eventNotes.trim() || undefined,
        recurrence,
        assemblyDetails,
        notifyAudience: notifyAudience && eventStatus === "published",
        createdBy: {
          uid: appUser!.id,
          name: appUser!.name,
          role: appUser!.role,
        },
      };

      if (editingEventId) {
        await updateSchoolEvent(editingEventId, payload);
        toast({ title: "Event Updated", description: `"${eventTitle}" has been saved.` });
      } else {
        await createSchoolEvent(payload);
        toast({ title: "Event Created", description: `"${eventTitle}" has been published to calendar.` });
      }

      setEventModalOpen(false);
      await loadCalendarData();
    } catch (err: any) {
      console.error("Save event failed:", err);
      toast({ title: "Failed to save event", description: err.message, variant: "destructive" });
    } finally {
      setModalSaving(false);
    }
  };

  // Cancel Event Handler
  const handleConfirmCancelEvent = async () => {
    if (!selectedItem || selectedItem.source !== "event") return;
    try {
      await cancelSchoolEvent(selectedItem.id, cancelReason);
      toast({ title: "Event Cancelled", description: `"${selectedItem.title}" marked as cancelled.` });
      setCancelModalOpen(false);
      setSelectedItem(null);
      await loadCalendarData();
    } catch (err: any) {
      toast({ title: "Failed to cancel event", description: err.message, variant: "destructive" });
    }
  };

  // Archive / Delete Event Handler
  const handleDeleteEvent = async (evId: string) => {
    if (!window.confirm("Are you sure you want to remove this event from the calendar?")) return;
    try {
      await archiveSchoolEvent(evId);
      toast({ title: "Event Removed", description: "Event has been archived." });
      setSelectedItem(null);
      await loadCalendarData();
    } catch (err: any) {
      toast({ title: "Failed to archive event", description: err.message, variant: "destructive" });
    }
  };

  // Category Management Handlers
  const handleSaveCategory = async () => {
    if (!newCategoryName.trim()) {
      toast({ title: "Category name is required", variant: "destructive" });
      return;
    }
    try {
      if (editingCategoryId) {
        await updateEventType(editingCategoryId, {
          name: newCategoryName.trim(),
          color: newCategoryColor,
          description: newCategoryDesc.trim(),
        });
        toast({ title: "Category Updated" });
      } else {
        await createEventType({
          name: newCategoryName.trim(),
          color: newCategoryColor,
          description: newCategoryDesc.trim(),
        });
        toast({ title: "Category Created" });
      }
      setNewCategoryName("");
      setNewCategoryDesc("");
      setEditingCategoryId(null);
      const fresh = await listEventTypes(true);
      setEventTypes(fresh);
    } catch (err: any) {
      toast({ title: "Failed to save category", description: err.message, variant: "destructive" });
    }
  };

  const handleToggleArchiveCategory = async (cat: EventType) => {
    try {
      await archiveEventType(cat.id, !cat.archived);
      toast({ title: cat.archived ? "Category Restored" : "Category Archived" });
      const fresh = await listEventTypes(true);
      setEventTypes(fresh);
    } catch (err: any) {
      toast({ title: "Failed to toggle category", description: err.message, variant: "destructive" });
    }
  };

  // Group items by date for grid rendering
  const itemsByDate = useMemo(() => {
    const map = new Map<string, UnifiedCalendarItem[]>();

    for (const item of calendarItems) {
      const start = item.startDate;
      const end = item.endDate || item.startDate;

      if (start === end) {
        if (!map.has(start)) map.set(start, []);
        map.get(start)!.push(item);
      } else {
        // Multi-day spanning: add to every date in the range
        let cur = new Date(start + "T00:00:00");
        const endD = new Date(end + "T23:59:59");
        while (cur <= endD) {
          const dStr = cur.toISOString().split("T")[0];
          if (!map.has(dStr)) map.set(dStr, []);
          map.get(dStr)!.push(item);
          cur.setDate(cur.getDate() + 1);
        }
      }
    }
    return map;
  }, [calendarItems]);

  // Compute month cells for the Month View grid
  const monthGridDays = useMemo(() => {
    if (viewMode !== "month") return [];
    const days: { date: Date; dateStr: string; isCurrentMonth: boolean; isToday: boolean }[] = [];
    const todayStr = new Date().toISOString().split("T")[0];

    const cur = new Date(rangeStart + "T00:00:00");
    const end = new Date(rangeEnd + "T23:59:59");

    while (cur <= end) {
      const dateStr = cur.toISOString().split("T")[0];
      days.push({
        date: new Date(cur),
        dateStr,
        isCurrentMonth: cur.getMonth() === currentDate.getMonth(),
        isToday: dateStr === todayStr,
      });
      cur.setDate(cur.getDate() + 1);
    }

    return days;
  }, [viewMode, rangeStart, rangeEnd, currentDate]);

  // Selected event category info for display
  const selectedTypeObj = useMemo(() => {
    if (!eventTypeId) return null;
    return eventTypes.find((t) => t.id === eventTypeId) || null;
  }, [eventTypes, eventTypeId]);

  return (
    <div className="space-y-5">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white/70 backdrop-blur-md p-4 rounded-2xl border border-white/60 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <CalendarIcon size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">
                {titleOverride || (portalName ? `${portalName} Calendar` : "School Events & Calendar")}
              </h1>
              <p className="text-xs text-slate-500">
                Official centralized academic and institutional schedule • {currentSessionName}
              </p>
            </div>
          </div>

          {/* Academic Session Picker */}
          {sessions && sessions.length > 1 && (
            <div className="ml-2">
              <Select value={workingSession?.id || ""} onValueChange={(val) => setWorkingSessionId(val)}>
                <SelectTrigger className="h-8 text-xs bg-white font-medium border-slate-200">
                  <SelectValue placeholder="Session" />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.name} {s.status === "active" && "(Active)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* View Switcher & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Buttons */}
          <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setViewMode("month")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === "month"
                  ? "bg-white text-primary shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === "week"
                  ? "bg-white text-primary shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode("day")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === "day"
                  ? "bg-white text-primary shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setViewMode("agenda")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === "agenda"
                  ? "bg-white text-primary shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Agenda
            </button>
          </div>

          {/* Admin Management Actions */}
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setManageCategoriesOpen(true)}
                className="h-8 text-xs font-medium border-slate-200 bg-white hover:bg-slate-50 gap-1.5"
              >
                <Settings size={14} className="text-slate-500" />
                Categories
              </Button>
              <Button
                size="sm"
                onClick={() => handleOpenCreateEvent()}
                className="h-8 text-xs font-semibold gap-1.5 shadow-sm"
              >
                <Plus size={15} />
                Create Event
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 2. Navigation Bar & Search Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Calendar Prev / Today / Next Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrev}
              className="h-8 w-8 rounded-lg border-slate-200"
            >
              <ChevronLeft size={16} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              className="h-8 px-3 text-xs font-semibold border-slate-200"
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleNext}
              className="h-8 w-8 rounded-lg border-slate-200"
            >
              <ChevronRight size={16} />
            </Button>
            <span className="text-base font-bold text-slate-800 ml-2 tracking-tight">
              {displayTitle}
            </span>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              type="text"
              placeholder="Search events, exams, assemblies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs pl-8 bg-slate-50/70 border-slate-200 rounded-lg"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-400 flex items-center gap-1 font-medium text-[11px] mr-1">
            <Filter size={12} /> Filter:
          </span>

          {/* Event Category Filter */}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-7 text-xs w-[130px] bg-slate-50 border-slate-200">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Categories</SelectItem>
              {eventTypes.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </div>
                </SelectItem>
              ))}
              <SelectItem value="Examination" className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Examination (Exams)
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {/* Grade Filter */}
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="h-7 text-xs w-[110px] bg-slate-50 border-slate-200">
              <SelectValue placeholder="All Grades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Grades</SelectItem>
              {ALL_GRADES.map((g) => (
                <SelectItem key={g} value={g} className="text-xs">
                  Grade {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Priority Filter */}
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-7 text-xs w-[110px] bg-slate-50 border-slate-200">
              <SelectValue placeholder="All Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Priority</SelectItem>
              <SelectItem value="low" className="text-xs">Low</SelectItem>
              <SelectItem value="normal" className="text-xs">Normal</SelectItem>
              <SelectItem value="high" className="text-xs">High</SelectItem>
              <SelectItem value="urgent" className="text-xs">Urgent</SelectItem>
            </SelectContent>
          </Select>

          {(typeFilter !== "all" || gradeFilter !== "all" || priorityFilter !== "all" || searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTypeFilter("all");
                setGradeFilter("all");
                setPriorityFilter("all");
                setSearchQuery("");
              }}
              className="h-7 text-[11px] text-slate-500 hover:text-slate-800 px-2"
            >
              Reset Filters
            </Button>
          )}

          <div className="ml-auto text-[11px] text-slate-400 font-medium">
            {calendarItems.length} {calendarItems.length === 1 ? "item" : "items"} scheduled
          </div>
        </div>
      </div>

      {/* 3. Main Calendar Views */}
      <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden bg-white">
        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center gap-3 text-slate-400">
            <RefreshCw className="animate-spin text-primary" size={28} />
            <p className="text-xs font-medium">Loading school calendar events & examinations...</p>
          </div>
        ) : (
          <>
            {/* VIEW A: MONTH VIEW (Default) */}
            {viewMode === "month" && (
              <div className="flex flex-col">
                {/* Weekdays Header */}
                <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80 text-center text-xs font-semibold text-slate-600">
                  {WEEKDAY_NAMES.map((w, idx) => (
                    <div
                      key={w}
                      className={`py-2.5 ${idx === 5 || idx === 6 ? "text-rose-500/80" : ""}`}
                    >
                      {w}
                    </div>
                  ))}
                </div>

                {/* Days Grid */}
                <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
                  {monthGridDays.map((day) => {
                    const dayItems = itemsByDate.get(day.dateStr) || [];
                    const maxDisplay = 3;
                    const overflow = dayItems.length - maxDisplay;

                    return (
                      <div
                        key={day.dateStr}
                        onClick={() => {
                          if (isAdmin) handleOpenCreateEvent(day.dateStr);
                          else {
                            setCurrentDate(day.date);
                            setViewMode("day");
                          }
                        }}
                        className={`min-h-[110px] p-1.5 transition-colors cursor-pointer group flex flex-col justify-between ${
                          day.isCurrentMonth ? "bg-white hover:bg-slate-50/70" : "bg-slate-50/40 text-slate-300"
                        }`}
                      >
                        {/* Day Number Header */}
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-xs font-semibold inline-flex items-center justify-center rounded-full w-6 h-6 ${
                              day.isToday
                                ? "bg-primary text-white shadow-sm ring-2 ring-primary/20"
                                : day.isCurrentMonth
                                ? "text-slate-700"
                                : "text-slate-400"
                            }`}
                          >
                            {day.date.getDate()}
                          </span>

                          {isAdmin && (
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-primary hover:underline font-medium">
                              + Event
                            </span>
                          )}
                        </div>

                        {/* Events list inside cell */}
                        <div className="space-y-1 flex-1 overflow-hidden">
                          {dayItems.slice(0, maxDisplay).map((item) => (
                            <div
                              key={item.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedItem(item);
                              }}
                              className={`text-[11px] leading-tight px-1.5 py-0.5 rounded-md truncate font-medium flex items-center gap-1 shadow-2xs hover:brightness-95 transition-all ${
                                item.status === "cancelled"
                                  ? "line-through opacity-60 bg-slate-100 text-slate-600 border border-slate-300"
                                  : "text-white"
                              }`}
                              style={{
                                backgroundColor: item.status === "cancelled" ? undefined : item.color,
                              }}
                              title={`${item.title} (${item.allDay ? "All Day" : item.startTime || ""})`}
                            >
                              {item.source === "exam_schedule" ? (
                                <GraduationCap size={10} className="shrink-0" />
                              ) : (
                                <span className="w-1.5 h-1.5 rounded-full bg-white/80 shrink-0" />
                              )}
                              <span className="truncate">
                                {!item.allDay && item.startTime && (
                                  <span className="font-normal opacity-90 mr-1">{item.startTime}</span>
                                )}
                                {item.title}
                              </span>
                            </div>
                          ))}

                          {overflow > 0 && (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentDate(day.date);
                                setViewMode("day");
                              }}
                              className="text-[10px] font-semibold text-primary hover:underline px-1 py-0.5 rounded cursor-pointer"
                            >
                              +{overflow} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* VIEW B: WEEK VIEW */}
            {viewMode === "week" && (
              <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                {Array.from({ length: 7 }).map((_, i) => {
                  const day = new Date(rangeStart + "T00:00:00");
                  day.setDate(day.getDate() + i);
                  const dateStr = day.toISOString().split("T")[0];
                  const dayItems = itemsByDate.get(dateStr) || [];
                  const isToday = dateStr === new Date().toISOString().split("T")[0];

                  return (
                    <div key={dateStr} className="min-h-[420px] p-2.5 flex flex-col bg-slate-50/30">
                      {/* Weekday Column Header */}
                      <div className="pb-2 border-b border-slate-200/80 mb-2 flex items-center justify-between">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            {WEEKDAY_NAMES[i]}
                          </p>
                          <p
                            className={`text-sm font-bold inline-flex items-center justify-center rounded-lg px-2 py-0.5 mt-0.5 ${
                              isToday ? "bg-primary text-white" : "text-slate-800"
                            }`}
                          >
                            {day.toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                          </p>
                        </div>
                        {isAdmin && (
                          <button
                            onClick={() => handleOpenCreateEvent(dateStr)}
                            className="p-1 rounded-md text-primary hover:bg-primary/10 transition-colors"
                            title="Add event on this day"
                          >
                            <Plus size={14} />
                          </button>
                        )}
                      </div>

                      {/* Day's Event Cards */}
                      <div className="space-y-1.5 flex-1 overflow-y-auto">
                        {dayItems.length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic text-center py-8">
                            No events
                          </p>
                        ) : (
                          dayItems.map((item) => (
                            <div
                              key={item.id}
                              onClick={() => setSelectedItem(item)}
                              className="p-2 rounded-xl border border-slate-200/80 bg-white hover:border-primary/50 shadow-xs cursor-pointer transition-all space-y-1"
                            >
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: item.color }}
                                />
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1 py-0 border-slate-200"
                                >
                                  {item.typeName}
                                </Badge>
                                {item.status === "cancelled" && (
                                  <Badge variant="destructive" className="text-[9px] px-1 py-0">
                                    Cancelled
                                  </Badge>
                                )}
                              </div>
                              <p className={`text-xs font-semibold leading-snug line-clamp-2 ${item.status === "cancelled" ? "line-through text-slate-500" : "text-slate-800"}`}>
                                {item.title}
                              </p>
                              <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                <Clock size={11} />
                                {item.allDay ? "All Day" : `${item.startTime || ""} – ${item.endTime || ""}`}
                              </div>
                              {item.location && (
                                <div className="text-[10px] text-slate-500 flex items-center gap-1 truncate">
                                  <MapPin size={11} className="shrink-0" />
                                  <span className="truncate">{item.location}</span>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* VIEW C: DAY VIEW */}
            {viewMode === "day" && (
              <div className="p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">{displayTitle}</h2>
                    <p className="text-xs text-slate-500">
                      {(itemsByDate.get(rangeStart) || []).length} scheduled activities
                    </p>
                  </div>
                  {isAdmin && (
                    <Button size="sm" onClick={() => handleOpenCreateEvent(rangeStart)} className="gap-1.5 text-xs">
                      <Plus size={14} /> Add Event for Today
                    </Button>
                  )}
                </div>

                <div className="space-y-2.5">
                  {(itemsByDate.get(rangeStart) || []).length === 0 ? (
                    <div className="py-16 text-center text-slate-400 space-y-2">
                      <CalendarDays size={40} className="mx-auto text-slate-300" />
                      <p className="text-sm font-medium">No events or examinations scheduled for this day.</p>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenCreateEvent(rangeStart)}
                          className="mt-2 text-xs"
                        >
                          + Schedule New Event
                        </Button>
                      )}
                    </div>
                  ) : (
                    (itemsByDate.get(rangeStart) || []).map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className="p-4 rounded-2xl border border-slate-200 bg-white hover:border-primary/50 shadow-xs cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="w-1.5 h-12 rounded-full shrink-0 mt-0.5"
                            style={{ backgroundColor: item.color }}
                          />
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0.5 font-semibold"
                                style={{ borderColor: item.color, color: item.color }}
                              >
                                {item.typeName}
                              </Badge>
                              {item.source === "exam_schedule" && (
                                <Badge className="text-[10px] bg-rose-600 text-white font-medium">
                                  Official Exam
                                </Badge>
                              )}
                              {item.priority === "urgent" && (
                                <Badge variant="destructive" className="text-[10px]">Urgent</Badge>
                              )}
                              {item.status === "cancelled" && (
                                <Badge variant="destructive" className="text-[10px]">Cancelled</Badge>
                              )}
                            </div>
                            <h3 className={`text-sm font-bold ${item.status === "cancelled" ? "line-through text-slate-500" : "text-slate-900"}`}>
                              {item.title}
                            </h3>
                            {item.description && (
                              <p className="text-xs text-slate-600 line-clamp-2">{item.description}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap sm:flex-col items-start sm:items-end gap-1.5 text-xs text-slate-500 shrink-0">
                          <div className="flex items-center gap-1 font-semibold text-slate-700">
                            <Clock size={13} className="text-primary" />
                            {item.allDay ? "All Day" : `${item.startTime || ""} – ${item.endTime || ""}`}
                          </div>
                          {item.location && (
                            <div className="flex items-center gap-1">
                              <MapPin size={12} />
                              <span>{item.location}</span>
                            </div>
                          )}
                          {item.organizer && (
                            <div className="flex items-center gap-1 text-[11px] text-slate-400">
                              <Users size={11} />
                              <span>{item.organizer}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* VIEW D: AGENDA / LIST VIEW */}
            {viewMode === "agenda" && (
              <div className="p-6 space-y-6">
                {calendarItems.length === 0 ? (
                  <div className="py-20 text-center text-slate-400 space-y-2">
                    <List size={40} className="mx-auto text-slate-300" />
                    <p className="text-sm font-medium">No events found matching your criteria.</p>
                  </div>
                ) : (
                  calendarItems.map((item) => {
                    const dateObj = new Date(item.startDate + "T00:00:00");
                    const dateFmt = dateObj.toLocaleDateString("en-US", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    });

                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className="p-4 rounded-2xl border border-slate-200 bg-white hover:border-primary/50 shadow-xs cursor-pointer transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="flex items-start gap-3.5">
                          <div className="text-center px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 shrink-0 min-w-[70px]">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                              {dateObj.toLocaleDateString("en-US", { month: "short" })}
                            </p>
                            <p className="text-lg font-black text-slate-900 leading-none">
                              {dateObj.getDate()}
                            </p>
                            <p className="text-[10px] text-slate-400 font-medium">
                              {dateObj.toLocaleDateString("en-US", { weekday: "short" })}
                            </p>
                          </div>

                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-white shadow-2xs"
                                style={{ backgroundColor: item.color }}
                              >
                                {item.typeName}
                              </span>
                              {item.source === "exam_schedule" && (
                                <Badge className="text-[10px] bg-rose-600 text-white font-medium">
                                  Official Exam
                                </Badge>
                              )}
                              {item.status === "cancelled" && (
                                <Badge variant="destructive" className="text-[10px]">Cancelled</Badge>
                              )}
                              {item.isRecurringOccurrence && (
                                <Badge variant="outline" className="text-[10px] border-slate-300 text-slate-600">
                                  Recurring
                                </Badge>
                              )}
                            </div>

                            <h3 className={`text-base font-bold ${item.status === "cancelled" ? "line-through text-slate-500" : "text-slate-900"}`}>
                              {item.title}
                            </h3>

                            {item.description && (
                              <p className="text-xs text-slate-600 line-clamp-2 max-w-2xl">{item.description}</p>
                            )}

                            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                              <span className="flex items-center gap-1 font-medium text-slate-700">
                                <Clock size={12} className="text-primary" />
                                {item.allDay ? "All Day" : `${item.startTime || ""} – ${item.endTime || ""}`}
                              </span>
                              {item.location && (
                                <span className="flex items-center gap-1">
                                  <MapPin size={12} />
                                  {item.location}
                                </span>
                              )}
                              {item.organizer && (
                                <span className="flex items-center gap-1">
                                  <Users size={12} />
                                  {item.organizer}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end md:self-center">
                          <Button variant="outline" size="sm" className="text-xs h-8">
                            <Eye size={13} className="mr-1" /> View Details
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {/* ========================================== */}
      {/* 4. EVENT DETAILS MODAL                    */}
      {/* ========================================== */}
      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {selectedItem && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold text-white shadow-2xs"
                    style={{ backgroundColor: selectedItem.color }}
                  >
                    {selectedItem.typeName}
                  </span>
                  {selectedItem.status === "cancelled" && (
                    <Badge variant="destructive">Cancelled</Badge>
                  )}
                  {selectedItem.source === "exam_schedule" && (
                    <Badge className="bg-rose-600 text-white">Academic Examination</Badge>
                  )}
                  {selectedItem.isRecurringOccurrence && (
                    <Badge variant="outline">Recurring Occurrence</Badge>
                  )}
                </div>
                <DialogTitle className={`text-lg font-bold leading-snug ${selectedItem.status === "cancelled" ? "line-through text-slate-500" : ""}`}>
                  {selectedItem.title}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {selectedItem.source === "exam_schedule"
                    ? "Official examination schedule governed by Academic Office"
                    : `Published by ${selectedItem.organizer || "Administration"}`}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2 text-xs">
                {/* Date & Time Grid */}
                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-medium text-slate-400">Date</p>
                    <p className="font-semibold text-slate-800">
                      {new Date(selectedItem.startDate + "T00:00:00").toLocaleDateString("en-IN", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {selectedItem.endDate && selectedItem.endDate !== selectedItem.startDate && (
                        <span> – {new Date(selectedItem.endDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                      )}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] font-medium text-slate-400">Time</p>
                    <p className="font-semibold text-slate-800">
                      {selectedItem.allDay
                        ? "All Day Event"
                        : `${selectedItem.startTime || ""} – ${selectedItem.endTime || ""}`}
                    </p>
                  </div>
                  {selectedItem.location && (
                    <div className="space-y-0.5">
                      <p className="text-[11px] font-medium text-slate-400">Location / Venue</p>
                      <p className="font-semibold text-slate-800">{selectedItem.location}</p>
                    </div>
                  )}
                  {selectedItem.organizer && (
                    <div className="space-y-0.5">
                      <p className="text-[11px] font-medium text-slate-400">Organizer</p>
                      <p className="font-semibold text-slate-800">{selectedItem.organizer}</p>
                    </div>
                  )}
                </div>

                {/* Exam Details Box if Exam */}
                {selectedItem.examDetails && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 space-y-1.5 text-rose-900">
                    <p className="font-bold flex items-center gap-1.5 text-xs text-rose-800">
                      <GraduationCap size={15} /> Examination Particulars
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div><strong>Grade:</strong> Grade {selectedItem.examDetails.grade}</div>
                      <div><strong>Subject:</strong> {selectedItem.examDetails.subjectName}</div>
                      <div><strong>Max Marks:</strong> {selectedItem.examDetails.maxMarks}</div>
                      <div><strong>Passing Marks:</strong> {selectedItem.examDetails.passingMarks}</div>
                    </div>
                  </div>
                )}

                {/* Description */}
                {selectedItem.description && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Description</Label>
                    <p className="text-slate-600 leading-relaxed bg-slate-50/50 p-2.5 rounded-lg border border-slate-100">
                      {selectedItem.description}
                    </p>
                  </div>
                )}

                {/* Assembly Details if Assembly */}
                {selectedItem.originalEvent?.assemblyDetails && (
                  <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-950 space-y-1 text-xs">
                    <p className="font-bold text-indigo-900">Assembly Program</p>
                    {selectedItem.originalEvent.assemblyDetails.theme && (
                      <p><strong>Theme / Topic:</strong> {selectedItem.originalEvent.assemblyDetails.theme}</p>
                    )}
                    {selectedItem.originalEvent.assemblyDetails.conductedBy && (
                      <p><strong>Conducted By:</strong> {selectedItem.originalEvent.assemblyDetails.conductedBy}</p>
                    )}
                    {selectedItem.originalEvent.assemblyDetails.specialNotes && (
                      <p><strong>Notes:</strong> {selectedItem.originalEvent.assemblyDetails.specialNotes}</p>
                    )}
                  </div>
                )}

                {/* Target Audience Scope */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-700">Audience Scope</Label>
                  <div>
                    <Badge variant="outline" className="capitalize text-xs font-medium">
                      {selectedItem.audienceType?.replace(/_/g, " ") || "Entire School"}
                      {selectedItem.audienceIds && selectedItem.audienceIds.length > 0 && (
                        <span>: {selectedItem.audienceIds.join(", ")}</span>
                      )}
                    </Badge>
                  </div>
                </div>

                {/* Notes */}
                {selectedItem.notes && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Institutional Notes</Label>
                    <p className="text-slate-500 italic text-[11px]">{selectedItem.notes}</p>
                  </div>
                )}
              </div>

              <DialogFooter className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                {isAdmin && selectedItem.source === "event" && selectedItem.originalEvent ? (
                  <div className="flex items-center gap-2 w-full justify-between">
                    <div className="flex items-center gap-1.5">
                      {selectedItem.status !== "cancelled" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCancelModalOpen(true)}
                          className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                        >
                          <Ban size={13} className="mr-1" /> Cancel
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteEvent(selectedItem.id)}
                        className="h-8 text-xs text-slate-500 hover:text-rose-600"
                      >
                        <Trash2 size={13} className="mr-1" /> Delete
                      </Button>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => handleOpenEditEvent(selectedItem.originalEvent!)}
                      className="h-8 text-xs font-semibold"
                    >
                      <Edit2 size={13} className="mr-1" /> Edit Event
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setSelectedItem(null)} className="ml-auto text-xs">
                    Close
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ========================================== */}
      {/* 5. CREATE / EDIT EVENT MODAL              */}
      {/* ========================================== */}
      <Dialog open={eventModalOpen} onOpenChange={setEventModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <CalendarDays className="text-primary" size={18} />
              {editingEventId ? "Edit School Event" : "Create New School Event"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure event details, audience scope, recurrence, and automated notifications.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Title & Category */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <Label className="text-xs font-semibold">Event Title *</Label>
                <Input
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  placeholder="e.g. Annual Sports Meet, Morning Assembly"
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Event Category *</Label>
                <Select value={eventTypeId} onValueChange={setEventTypeId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {eventTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                          {t.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea
                value={eventDescription}
                onChange={(e) => setEventDescription(e.target.value)}
                placeholder="Detailed information regarding the agenda, requirements, or instructions..."
                rows={2}
                className="text-xs resize-none"
              />
            </div>

            {/* Date Range & All-Day */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <CalendarRange size={14} className="text-primary" /> Schedule & Timing
                </Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="allDayCheck"
                    checked={eventAllDay}
                    onCheckedChange={(c) => setEventAllDay(Boolean(c))}
                  />
                  <Label htmlFor="allDayCheck" className="text-xs font-medium cursor-pointer">
                    All-Day Event
                  </Label>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500 font-medium">Start Date *</Label>
                  <Input
                    type="date"
                    value={eventStartDate}
                    onChange={(e) => {
                      setEventStartDate(e.target.value);
                      if (!eventEndDate || eventEndDate < e.target.value) {
                        setEventEndDate(e.target.value);
                      }
                    }}
                    className="h-8 text-xs bg-white"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500 font-medium">End Date</Label>
                  <Input
                    type="date"
                    value={eventEndDate}
                    onChange={(e) => setEventEndDate(e.target.value)}
                    min={eventStartDate}
                    className="h-8 text-xs bg-white"
                  />
                </div>

                {!eventAllDay && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500 font-medium">Start Time</Label>
                      <Input
                        type="time"
                        value={eventStartTime}
                        onChange={(e) => setEventStartTime(e.target.value)}
                        className="h-8 text-xs bg-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500 font-medium">End Time</Label>
                      <Input
                        type="time"
                        value={eventEndTime}
                        onChange={(e) => setEventEndTime(e.target.value)}
                        className="h-8 text-xs bg-white"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Location & Organizer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Location / Venue</Label>
                <Input
                  value={eventLocation}
                  onChange={(e) => setEventLocation(e.target.value)}
                  placeholder="e.g. Auditorium, Ground, Room 204"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Organizer / In-Charge</Label>
                <Input
                  value={eventOrganizer}
                  onChange={(e) => setEventOrganizer(e.target.value)}
                  placeholder="e.g. Sports Dept, Principal, Mrs. Sharma"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* Priority & Status */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Priority</Label>
                <Select value={eventPriority} onValueChange={(val: any) => setEventPriority(val)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low" className="text-xs">Low</SelectItem>
                    <SelectItem value="normal" className="text-xs">Normal</SelectItem>
                    <SelectItem value="high" className="text-xs">High</SelectItem>
                    <SelectItem value="urgent" className="text-xs">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Status</Label>
                <Select value={eventStatus} onValueChange={(val: any) => setEventStatus(val)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="published" className="text-xs">Published (Active)</SelectItem>
                    <SelectItem value="draft" className="text-xs">Draft (Internal)</SelectItem>
                    <SelectItem value="cancelled" className="text-xs">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Audience Scope Section (Section 5) */}
            <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200/80 space-y-2.5">
              <div className="space-y-0.5">
                <Label className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
                  <Users size={14} className="text-blue-600" /> Target Audience & Visibility Scope *
                </Label>
                <p className="text-[11px] text-blue-800/80">
                  Enforces strict portal authorization. Students and teachers only view events matching their scope.
                </p>
              </div>

              <Select
                value={eventAudienceType}
                onValueChange={(val: any) => {
                  setEventAudienceType(val);
                  setSelectedGrades([]);
                  setSelectedSectionIds([]);
                }}
              >
                <SelectTrigger className="h-8 text-xs bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entire_school" className="text-xs">Entire School (All Users)</SelectItem>
                  <SelectItem value="students" className="text-xs">Students Only</SelectItem>
                  <SelectItem value="teachers" className="text-xs">Teachers Only</SelectItem>
                  <SelectItem value="hods" className="text-xs">Section Heads (HODs) Only</SelectItem>
                  <SelectItem value="admin" className="text-xs">Administration Only</SelectItem>
                  <SelectItem value="specific_grades" className="text-xs">Specific Grades</SelectItem>
                  <SelectItem value="specific_sections" className="text-xs">Specific Section</SelectItem>
                  <SelectItem value="specific_roles" className="text-xs">Specific Role Group</SelectItem>
                </SelectContent>
              </Select>

              {/* Sub-selector: Specific Grades */}
              {eventAudienceType === "specific_grades" && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[11px] font-semibold text-blue-900">Select Applicable Grades:</Label>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 bg-white rounded-lg border border-blue-200">
                    {ALL_GRADES.map((g) => {
                      const checked = selectedGrades.includes(g);
                      return (
                        <button
                          key={g}
                          type="button"
                          onClick={() => {
                            setSelectedGrades((prev) =>
                              checked ? prev.filter((item) => item !== g) : [...prev, g]
                            );
                          }}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                            checked
                              ? "bg-primary text-white border-primary shadow-2xs"
                              : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          Grade {g}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Sub-selector: Specific Sections */}
              {eventAudienceType === "specific_sections" && (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[11px] font-semibold text-blue-900">Select Section:</Label>
                  <Select
                    value={selectedSectionIds[0] || ""}
                    onValueChange={(val) => setSelectedSectionIds([val])}
                  >
                    <SelectTrigger className="h-8 text-xs bg-white">
                      <SelectValue placeholder="Select section..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">
                          Grade {s.grade} - Section {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Assembly Details Box (Section 11) */}
            {selectedTypeObj?.name.toLowerCase().includes("assembly") && (
              <div className="p-3 rounded-xl bg-purple-50/70 border border-purple-200 space-y-2">
                <Label className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-purple-600" /> Morning / Special Assembly Details
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-[11px] text-purple-900 font-medium">Assembly Theme / Topic</Label>
                    <Input
                      value={assemblyTheme}
                      onChange={(e) => setAssemblyTheme(e.target.value)}
                      placeholder="e.g. International Peace, Science Week"
                      className="h-8 text-xs bg-white"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[11px] text-purple-900 font-medium">Conducted By</Label>
                    <Input
                      value={assemblyConductedBy}
                      onChange={(e) => setAssemblyConductedBy(e.target.value)}
                      placeholder="e.g. Grade 9A, Nature Club"
                      className="h-8 text-xs bg-white"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Recurrence Options (Section 10) */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <RefreshCw size={14} className="text-primary" /> Recurrence / Repeating Rule
                </Label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500 font-medium">Frequency</Label>
                  <Select value={recurrenceFreq} onValueChange={(val: any) => setRecurrenceFreq(val)}>
                    <SelectTrigger className="h-8 text-xs bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">Does not repeat</SelectItem>
                      <SelectItem value="daily" className="text-xs">Daily</SelectItem>
                      <SelectItem value="weekly" className="text-xs">Weekly (Select Day)</SelectItem>
                      <SelectItem value="monthly" className="text-xs">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {recurrenceFreq === "weekly" && (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500 font-medium">Day of Week</Label>
                    <Select
                      value={String(recurrenceDays[0] ?? 1)}
                      onValueChange={(val) => setRecurrenceDays([Number(val)])}
                    >
                      <SelectTrigger className="h-8 text-xs bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1" className="text-xs">Monday</SelectItem>
                        <SelectItem value="2" className="text-xs">Tuesday</SelectItem>
                        <SelectItem value="3" className="text-xs">Wednesday</SelectItem>
                        <SelectItem value="4" className="text-xs">Thursday</SelectItem>
                        <SelectItem value="5" className="text-xs">Friday</SelectItem>
                        <SelectItem value="6" className="text-xs">Saturday</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {recurrenceFreq !== "none" && (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500 font-medium">Repeat Until</Label>
                    <Input
                      type="date"
                      value={recurrenceEndDate}
                      onChange={(e) => setRecurrenceEndDate(e.target.value)}
                      min={eventStartDate}
                      className="h-8 text-xs bg-white"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Notification Checkbox */}
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="notifyAudienceCheck"
                checked={notifyAudience}
                onCheckedChange={(c) => setNotifyAudience(Boolean(c))}
              />
              <Label htmlFor="notifyAudienceCheck" className="text-xs font-medium cursor-pointer text-slate-700">
                Notify target audience via in-app alert banner & notifications
              </Label>
            </div>
          </div>

          <DialogFooter className="border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEventModalOpen(false)}
              className="text-xs"
              disabled={modalSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveEvent}
              className="text-xs font-semibold"
              disabled={modalSaving}
            >
              {modalSaving ? "Saving..." : editingEventId ? "Save Changes" : "Publish Event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================== */}
      {/* 6. MANAGE EVENT CATEGORIES MODAL (Section 4) */}
      {/* ========================================== */}
      <Dialog open={manageCategoriesOpen} onOpenChange={setManageCategoriesOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Tag size={18} className="text-primary" /> Manage Event Categories
            </DialogTitle>
            <DialogDescription className="text-xs">
              Configure dynamic event types and their distinctive badge colors.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Add / Edit Form */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <p className="font-bold text-slate-800 text-xs">
                {editingCategoryId ? "Edit Category" : "Add New Event Category"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium">Category Name</Label>
                  <Input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="e.g. Science Exhibition"
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium">Color Swatch</Label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {PRESET_EVENT_COLORS.slice(0, 7).map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewCategoryColor(color)}
                        className={`w-5 h-5 rounded-full border transition-all ${
                          newCategoryColor === color ? "ring-2 ring-primary ring-offset-1 scale-110" : ""
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                {editingCategoryId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingCategoryId(null);
                      setNewCategoryName("");
                      setNewCategoryDesc("");
                    }}
                    className="h-7 text-xs"
                  >
                    Cancel Edit
                  </Button>
                )}
                <Button size="sm" onClick={handleSaveCategory} className="h-7 text-xs font-semibold">
                  {editingCategoryId ? "Update Category" : "Save Category"}
                </Button>
              </div>
            </div>

            {/* List Existing Categories */}
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              <Label className="text-[11px] font-bold text-slate-600">Existing Categories ({eventTypes.length})</Label>
              <div className="divide-y divide-slate-100 border rounded-xl overflow-hidden">
                {eventTypes.map((cat) => (
                  <div
                    key={cat.id}
                    className={`p-2.5 flex items-center justify-between text-xs transition-colors ${
                      cat.archived ? "bg-slate-50/80 opacity-50" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                      <div>
                        <span className="font-semibold text-slate-800">{cat.name}</span>
                        {cat.isDefault && (
                          <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">Default</Badge>
                        )}
                        {cat.archived && (
                          <Badge variant="destructive" className="ml-1.5 text-[9px] px-1 py-0">Archived</Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingCategoryId(cat.id);
                          setNewCategoryName(cat.name);
                          setNewCategoryColor(cat.color);
                          setNewCategoryDesc(cat.description || "");
                        }}
                        className="p-1 rounded text-slate-400 hover:text-slate-700"
                        title="Edit"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleToggleArchiveCategory(cat)}
                        className={`p-1 rounded ${cat.archived ? "text-emerald-600 hover:text-emerald-800" : "text-rose-500 hover:text-rose-700"}`}
                        title={cat.archived ? "Unarchive" : "Archive"}
                      >
                        {cat.archived ? <RefreshCw size={13} /> : <Ban size={13} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ========================================== */}
      {/* 7. CANCEL EVENT REASON MODAL              */}
      {/* ========================================== */}
      <Dialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-rose-600 flex items-center gap-2">
              <AlertTriangle size={18} /> Cancel School Event
            </DialogTitle>
            <DialogDescription className="text-xs">
              Mark this event as CANCELLED. It will remain visible with an explicit cancelled badge.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <p className="text-slate-700">
              Are you sure you want to cancel <strong>"{selectedItem?.title}"</strong>?
            </p>
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Reason for Cancellation (Optional)</Label>
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Inclement weather, rescheduled to next month"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCancelModalOpen(false)} className="text-xs">
              Back
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmCancelEvent}
              className="text-xs font-semibold"
            >
              Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

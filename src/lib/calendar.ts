import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { stripUndefinedDeep } from "@/lib/academicStructure";
import type {
  SchoolEvent,
  EventType,
  UnifiedCalendarItem,
  EventAudienceType,
  User,
  ExamSchedule,
} from "@/lib/types";

// ==========================================
// 1. DEFAULT EVENT CATEGORIES
// ==========================================
export const DEFAULT_EVENT_TYPES: Omit<EventType, "id" | "createdAt" | "updatedAt">[] = [
  { name: "Assembly", color: "#6366f1", description: "School morning & special assemblies", isDefault: true, archived: false },
  { name: "Holiday", color: "#10b981", description: "Official institutional holidays & vacations", isDefault: true, archived: false },
  { name: "Examination", color: "#f43f5e", description: "Terminal exams, assessments, and unit tests", isDefault: true, archived: false },
  { name: "Meeting", color: "#f59e0b", description: "Staff, committee, and board meetings", isDefault: true, archived: false },
  { name: "Parent Meeting", color: "#06b6d4", description: "Parent-Teacher Meetings (PTM) and orientations", isDefault: true, archived: false },
  { name: "Competition", color: "#ea580c", description: "Interschool, intraschool, and academic competitions", isDefault: true, archived: false },
  { name: "Sports", color: "#0284c7", description: "Sports meets, tournaments, and athletic events", isDefault: true, archived: false },
  { name: "Cultural", color: "#c026d3", description: "Cultural programs, arts days, and annual days", isDefault: true, archived: false },
  { name: "Workshop", color: "#0d9488", description: "Teacher training, seminars, and student workshops", isDefault: true, archived: false },
  { name: "School Function", color: "#ec4899", description: "National celebrations, festivals, and graduations", isDefault: true, archived: false },
  { name: "Academic", color: "#2563eb", description: "Curriculum milestones, project deadlines, and terms", isDefault: true, archived: false },
  { name: "General", color: "#64748b", description: "General school announcements & campus notices", isDefault: true, archived: false },
];

export const PRESET_EVENT_COLORS = [
  "#6366f1", // Indigo
  "#10b981", // Emerald
  "#f43f5e", // Rose
  "#f59e0b", // Amber
  "#0284c7", // Sky
  "#c026d3", // Fuchsia
  "#0d9488", // Teal
  "#06b6d4", // Cyan
  "#ea580c", // Orange
  "#ec4899", // Pink
  "#2563eb", // Blue
  "#64748b", // Slate
  "#8b5cf6", // Purple
  "#84cc16", // Lime
];

/**
 * Ensures default event types exist in Firestore. Seeds them if collection is empty.
 */
export async function ensureDefaultEventTypes(): Promise<EventType[]> {
  try {
    const snap = await getDocs(collection(db, "eventTypes"));
    if (!snap.empty) {
      const types = snap.docs.map((d) => ({ id: d.id, ...d.data() } as EventType));
      return types.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Seed defaults
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    const seeded: EventType[] = [];

    for (const item of DEFAULT_EVENT_TYPES) {
      const ref = doc(collection(db, "eventTypes"));
      const newType: EventType = {
        id: ref.id,
        ...item,
        createdAt: now,
        updatedAt: now,
      };
      batch.set(ref, newType);
      seeded.push(newType);
    }

    await batch.commit();
    return seeded.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error("Failed to ensure default event types:", err);
    return DEFAULT_EVENT_TYPES.map((d, i) => ({
      id: `default_${i}`,
      ...d,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }
}

/**
 * Lists all configured event categories.
 */
export async function listEventTypes(includeArchived = false): Promise<EventType[]> {
  const types = await ensureDefaultEventTypes();
  if (includeArchived) return types;
  return types.filter((t) => !t.archived);
}

/**
 * Creates a new custom event category.
 */
export async function createEventType(data: {
  name: string;
  color: string;
  description?: string;
}): Promise<EventType> {
  const now = new Date().toISOString();
  const ref = doc(collection(db, "eventTypes"));
  const newType: EventType = {
    id: ref.id,
    name: data.name.trim(),
    color: data.color || "#6366f1",
    description: data.description?.trim() || "",
    isDefault: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(ref, newType);
  return newType;
}

/**
 * Updates an event category.
 */
export async function updateEventType(
  id: string,
  data: Partial<Pick<EventType, "name" | "color" | "description" | "archived">>
): Promise<void> {
  const ref = doc(db, "eventTypes", id);
  await updateDoc(ref, {
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Archives an event category.
 */
export async function archiveEventType(id: string, archived = true): Promise<void> {
  await updateEventType(id, { archived });
}

// ==========================================
// 2. AUDIENCE AUTHORIZATION & SECURITY
// ==========================================
export interface UserCalendarContext {
  user: User;
  student?: {
    grade?: string;
    sectionId?: string | null;
  } | null;
  teacher?: {
    taughtGrades: string[];
    taughtSectionIds: string[];
    classTeacherSectionId?: string | null;
  } | null;
  hod?: {
    managedGrades: string[];
  } | null;
}

/**
 * Checks if a user has permission to view an event based on its audience scope.
 * Prevents IDOR and unauthorized visibility.
 */
export function canUserViewEvent(event: SchoolEvent, ctx: UserCalendarContext): boolean {
  const { user } = ctx;
  if (!user) return false;

  // Admin has complete visibility (including drafts and archived)
  if (user.role === "admin") return true;

  // Non-admins can NEVER view archived or draft events
  if (event.status === "archived" || event.status === "draft") {
    return false;
  }

  // Entire School visibility
  if (event.audienceType === "entire_school") return true;

  // Role-specific broad scopes
  if (event.audienceType === "students") {
    return user.role === "student";
  }
  if (event.audienceType === "teachers") {
    return user.role === "teacher" || user.role === "hod";
  }
  if (event.audienceType === "hods") {
    return user.role === "hod";
  }
  if (event.audienceType === "admin") {
    return user.role === "admin";
  }

  // Specific Roles
  if (event.audienceType === "specific_roles") {
    return event.audienceIds.includes(user.role);
  }

  // Specific Grades
  if (event.audienceType === "specific_grades") {
    if (user.role === "student") {
      const studentGrade = ctx.student?.grade;
      return Boolean(studentGrade && event.audienceIds.includes(String(studentGrade)));
    }
    if (user.role === "teacher") {
      const taught = ctx.teacher?.taughtGrades || [];
      return event.audienceIds.some((g) => taught.includes(String(g)));
    }
    if (user.role === "hod") {
      const managed = ctx.hod?.managedGrades || user.assignedGrades || [];
      return event.audienceIds.some((g) => managed.includes(String(g)));
    }
    return false;
  }

  // Specific Sections
  if (event.audienceType === "specific_sections") {
    if (user.role === "student") {
      const secId = ctx.student?.sectionId;
      return Boolean(secId && event.audienceIds.includes(secId));
    }
    if (user.role === "teacher") {
      const taughtSecs = ctx.teacher?.taughtSectionIds || [];
      const classSec = ctx.teacher?.classTeacherSectionId;
      return event.audienceIds.some(
        (id) => taughtSecs.includes(id) || id === classSec
      );
    }
    if (user.role === "hod") {
      // HODs can view sections under their grades
      return true;
    }
    return false;
  }

  return false;
}

// ==========================================
// 3. EVENTS CRUD OPERATIONS
// ==========================================
export async function createSchoolEvent(
  params: Omit<SchoolEvent, "id" | "createdAt" | "updatedAt">
): Promise<SchoolEvent> {
  const ref = doc(collection(db, "events"));
  const now = new Date().toISOString();

  const newEvent: SchoolEvent = {
    ...params,
    id: ref.id,
    createdAt: now,
    updatedAt: now,
  };

  const sanitized = stripUndefinedDeep(newEvent);
  await setDoc(ref, sanitized);

  // If notifyAudience is enabled, trigger in-app notifications
  if (newEvent.notifyAudience && newEvent.status === "published") {
    try {
      await sendEventNotification(newEvent);
    } catch (e) {
      console.warn("Failed to dispatch event notification:", e);
    }
  }

  return newEvent;
}

export async function updateSchoolEvent(
  id: string,
  params: Partial<Omit<SchoolEvent, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  const ref = doc(db, "events", id);
  const now = new Date().toISOString();
  const updateData = stripUndefinedDeep({
    ...params,
    updatedAt: now,
  });
  await updateDoc(ref, updateData);
}

export async function cancelSchoolEvent(id: string, cancelReason?: string): Promise<void> {
  const ref = doc(db, "events", id);
  await updateDoc(ref, {
    status: "cancelled",
    notes: cancelReason ? `Cancelled: ${cancelReason}` : "Event has been cancelled by administration.",
    updatedAt: new Date().toISOString(),
  });
}

export async function archiveSchoolEvent(id: string): Promise<void> {
  const ref = doc(db, "events", id);
  const now = new Date().toISOString();
  await updateDoc(ref, {
    status: "archived",
    archivedAt: now,
    updatedAt: now,
  });
}

export async function deleteSchoolEvent(id: string): Promise<void> {
  const ref = doc(db, "events", id);
  await deleteDoc(ref);
}

/**
 * Creates notification entries for target audiences when an event is published with notifyAudience=true.
 */
async function sendEventNotification(event: SchoolEvent) {
  const notifRef = collection(db, "notifications");
  const timeDesc = event.allDay ? "All Day" : `${event.startTime || ""} - ${event.endTime || ""}`.trim();
  const dateFormatted = new Date(event.startDate).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  await addDoc(notifRef, {
    type: "calendar_event",
    title: `School Event: ${event.title}`,
    message: `${event.title} is scheduled on ${dateFormatted}${timeDesc ? ` (${timeDesc})` : ""}.${event.location ? ` Venue: ${event.location}` : ""}`,
    eventId: event.id,
    audienceType: event.audienceType,
    audienceIds: event.audienceIds || [],
    senderName: event.createdBy.name || "School Administration",
    createdAt: new Date().toISOString(),
    read: false,
  });

  await updateDoc(doc(db, "events", event.id), {
    notificationSentAt: new Date().toISOString(),
  });
}

// ==========================================
// 4. UNIFIED CALENDAR AGGREGATION ENGINE
// ==========================================

/**
 * Expands recurring event occurrences within a specified visible date range.
 * Does not bloat Firestore; calculates occurrences dynamically.
 */
export function expandRecurringOccurrences(
  event: SchoolEvent,
  rangeStart: string, // YYYY-MM-DD
  rangeEnd: string // YYYY-MM-DD
): UnifiedCalendarItem[] {
  if (!event.recurrence || event.recurrence.frequency === "none") {
    return [];
  }

  const occurrences: UnifiedCalendarItem[] = [];
  const rec = event.recurrence;
  const untilDate = rec.endDate || rangeEnd;
  const effectiveEnd = untilDate < rangeEnd ? untilDate : rangeEnd;

  let current = new Date(event.startDate + "T00:00:00");
  const endLimit = new Date(effectiveEnd + "T23:59:59");

  const interval = rec.interval && rec.interval > 0 ? rec.interval : 1;

  while (current <= endLimit) {
    const curYear = current.getFullYear();
    const curMonth = String(current.getMonth() + 1).padStart(2, "0");
    const curDay = String(current.getDate()).padStart(2, "0");
    const curIso = `${curYear}-${curMonth}-${curDay}`;

    // Check if curIso falls in range and matches rules
    if (curIso >= rangeStart && curIso <= rangeEnd) {
      let matches = false;

      if (rec.frequency === "daily") {
        matches = true;
      } else if (rec.frequency === "weekly") {
        const dayOfWeek = current.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        if (rec.daysOfWeek && rec.daysOfWeek.length > 0) {
          matches = rec.daysOfWeek.includes(dayOfWeek);
        } else {
          // Default to the same weekday as the start date
          const originalDay = new Date(event.startDate + "T00:00:00").getDay();
          matches = dayOfWeek === originalDay;
        }
      } else if (rec.frequency === "monthly") {
        const origDate = new Date(event.startDate + "T00:00:00").getDate();
        matches = current.getDate() === origDate;
      }

      // Skip the base date itself since it is already rendered as the primary event
      if (matches && curIso !== event.startDate) {
        occurrences.push({
          id: `${event.id}_rec_${curIso}`,
          source: "event",
          title: event.title,
          description: event.description,
          typeId: event.eventTypeId,
          typeName: event.eventTypeName || "Event",
          color: event.eventTypeColor || "#6366f1",
          startDate: curIso,
          endDate: curIso,
          startTime: event.startTime,
          endTime: event.endTime,
          allDay: event.allDay,
          location: event.location,
          organizer: event.organizer,
          priority: event.priority,
          status: event.status,
          audienceType: event.audienceType,
          audienceIds: event.audienceIds,
          notes: event.notes,
          isRecurringOccurrence: true,
          parentEventId: event.id,
          originalEvent: event,
        });
      }
    }

    // Advance
    if (rec.frequency === "daily") {
      current.setDate(current.getDate() + interval);
    } else if (rec.frequency === "weekly") {
      current.setDate(current.getDate() + 1); // step by 1 day to catch selected daysOfWeek
    } else if (rec.frequency === "monthly") {
      current.setMonth(current.getMonth() + interval);
    } else {
      break;
    }
  }

  return occurrences;
}

/**
 * Fetches and unites:
 * 1. Central School Events (filtered by audience authorization)
 * 2. Approved Exam Schedules (referenced from existing Exam Scheduling system)
 * within the requested date range and academic session.
 */
export async function getUnifiedCalendar(params: {
  sessionId: string;
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string; // YYYY-MM-DD
  userContext: UserCalendarContext;
  filters?: {
    eventTypeId?: string;
    grade?: string;
    priority?: string;
    search?: string;
  };
}): Promise<UnifiedCalendarItem[]> {
  const { sessionId, rangeStart, rangeEnd, userContext, filters } = params;
  const items: UnifiedCalendarItem[] = [];

  try {
    // 1. Fetch event categories for name/color resolution
    const eventTypes = await listEventTypes(true);
    const typeMap = new Map<string, EventType>(eventTypes.map((t) => [t.id, t]));

    // 2. Query Central Events Collection for this session
    const eventsQuery = query(
      collection(db, "events"),
      where("sessionId", "==", sessionId)
    );

    const eventsSnap = await getDocs(eventsQuery);
    const rawEvents: SchoolEvent[] = [];

    eventsSnap.docs.forEach((docSnap) => {
      const e = { id: docSnap.id, ...docSnap.data() } as SchoolEvent;
      // Date range overlap check: event starts before/on rangeEnd AND ends after/on rangeStart
      const eventEnd = e.endDate || e.startDate;
      const overlaps = e.startDate <= rangeEnd && eventEnd >= rangeStart;
      const isRecurring = Boolean(e.recurrence && e.recurrence.frequency !== "none");

      if ((overlaps || isRecurring) && canUserViewEvent(e, userContext)) {
        rawEvents.push(e);
      }
    });

    // Transform raw events to UnifiedCalendarItem
    for (const ev of rawEvents) {
      const typeInfo = typeMap.get(ev.eventTypeId);
      const typeName = ev.eventTypeName || typeInfo?.name || "General";
      const color = ev.eventTypeColor || typeInfo?.color || "#6366f1";

      // Base event entry
      items.push({
        id: ev.id,
        source: "event",
        title: ev.title,
        description: ev.description,
        typeId: ev.eventTypeId,
        typeName,
        color,
        startDate: ev.startDate,
        endDate: ev.endDate || ev.startDate,
        startTime: ev.startTime,
        endTime: ev.endTime,
        allDay: ev.allDay,
        location: ev.location,
        organizer: ev.organizer,
        priority: ev.priority,
        status: ev.status,
        audienceType: ev.audienceType,
        audienceIds: ev.audienceIds,
        notes: ev.notes,
        isRecurringOccurrence: false,
        originalEvent: ev,
      });

      // Expand recurring occurrences if applicable
      if (ev.recurrence && ev.recurrence.frequency !== "none") {
        const occs = expandRecurringOccurrences(ev, rangeStart, rangeEnd);
        items.push(...occs);
      }
    }

    // 3. Integrate Existing Exam Schedules (Section 12 & 26: DO NOT duplicate exams into events)
    const examSchedQuery = query(
      collection(db, "examSchedules"),
      where("status", "==", "approved")
    );
    const examSnap = await getDocs(examSchedQuery);

    examSnap.docs.forEach((d) => {
      const sched = { id: d.id, ...d.data() } as ExamSchedule;
      // Filter by session
      if (sched.sessionId && sched.sessionId !== sessionId && sched.academicYear !== sessionId) {
        return;
      }

      // Check audience for exam based on grade
      let canViewExam = false;
      const uRole = userContext.user.role;
      const exGrade = String(sched.grade);

      if (uRole === "admin") {
        canViewExam = true;
      } else if (uRole === "hod") {
        const managed = userContext.hod?.managedGrades || userContext.user.assignedGrades || [];
        canViewExam = managed.includes(exGrade);
      } else if (uRole === "teacher") {
        const taught = userContext.teacher?.taughtGrades || [];
        canViewExam = taught.includes(exGrade);
      } else if (uRole === "student") {
        const stuGrade = String(userContext.student?.grade || "");
        canViewExam = stuGrade === exGrade;
      }

      if (!canViewExam) return;

      // Map each scheduled exam paper into an aggregated calendar entry
      if (Array.isArray(sched.exams)) {
        sched.exams.forEach((paper, idx) => {
          if (!paper.date) return;
          if (paper.date >= rangeStart && paper.date <= rangeEnd) {
            items.push({
              id: `exam_${sched.id}_${paper.subjectId || idx}`,
              source: "exam_schedule",
              title: `${sched.examType}: ${paper.subjectName}`,
              description: `Official Exam • Grade ${sched.grade} • Max Marks: ${paper.maxMarks} • Pass: ${paper.passingMarks}`,
              typeName: "Examination",
              color: "#f43f5e", // Rose for exams
              startDate: paper.date,
              endDate: paper.date,
              startTime: paper.startTime || "09:30",
              endTime: paper.endTime || "12:30",
              allDay: false,
              location: paper.venue || `Grade ${sched.grade} Classroom`,
              organizer: sched.hodName || "Academic Office",
              priority: "high",
              status: "approved",
              audienceType: "specific_grades",
              audienceIds: [exGrade],
              notes: `Exam Schedule Reference: ${sched.examType} (Grade ${sched.grade})`,
              originalExamSchedule: sched,
              examDetails: {
                subjectId: paper.subjectId,
                subjectName: paper.subjectName,
                maxMarks: paper.maxMarks,
                passingMarks: paper.passingMarks,
                grade: exGrade,
                examType: sched.examType,
              },
            });
          }
        });
      }
    });
  } catch (err) {
    console.error("Failed to load unified calendar items:", err);
  }

  // 4. Apply in-memory client filters
  let filtered = items;

  if (filters?.eventTypeId && filters.eventTypeId !== "all") {
    filtered = filtered.filter(
      (item) => item.typeId === filters.eventTypeId || item.typeName === filters.eventTypeId
    );
  }

  if (filters?.grade && filters.grade !== "all") {
    filtered = filtered.filter((item) => {
      if (item.audienceType === "entire_school") return true;
      if (item.audienceType === "specific_grades" && item.audienceIds) {
        return item.audienceIds.includes(filters.grade!);
      }
      if (item.examDetails) {
        return item.examDetails.grade === filters.grade;
      }
      return false;
    });
  }

  if (filters?.priority && filters.priority !== "all") {
    filtered = filtered.filter((item) => item.priority === filters.priority);
  }

  if (filters?.search && filters.search.trim()) {
    const term = filters.search.toLowerCase().trim();
    filtered = filtered.filter(
      (item) =>
        item.title.toLowerCase().includes(term) ||
        (item.description && item.description.toLowerCase().includes(term)) ||
        (item.location && item.location.toLowerCase().includes(term)) ||
        item.typeName.toLowerCase().includes(term)
    );
  }

  // Sort by date, then time
  filtered.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
    const timeA = a.allDay ? "00:00" : a.startTime || "00:00";
    const timeB = b.allDay ? "00:00" : b.startTime || "00:00";
    return timeA.localeCompare(timeB);
  });

  return filtered;
}

/**
 * Returns upcoming events & exams for the portal dashboard widget (e.g. next 3-5 items).
 */
export async function getUpcomingCalendarItems(
  sessionId: string,
  userContext: UserCalendarContext,
  limitCount = 4
): Promise<UnifiedCalendarItem[]> {
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAhead = new Date();
  thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);
  const rangeEnd = thirtyDaysAhead.toISOString().split("T")[0];

  const items = await getUnifiedCalendar({
    sessionId,
    rangeStart: today,
    rangeEnd,
    userContext,
  });

  return items.slice(0, limitCount);
}

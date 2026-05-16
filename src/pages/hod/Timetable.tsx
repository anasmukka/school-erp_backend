import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import {
  Section,
  Subject,
  SubjectAssignment,
  Teacher,
  TimetableEntry,
  TimetableEntryType,
} from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Clock3, Download, Save, School } from "lucide-react";
import SchoolTimetableSheet, { SchoolTimetableSheetSlot } from "@/components/timetable/SchoolTimetableSheet";

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const BREAK_OPTIONS: { value: TimetableEntryType; label: string }[] = [
  { value: "short_break", label: "Short Break" },
  { value: "lunch_break", label: "Lunch Break" },
  { value: "assembly", label: "Assembly" },
];

const SCHOOL_NAME = "Prestige International School";

type TimetableSlotForm = {
  subjectId: string;
  durationMinutes: number;
  entryType: TimetableEntryType;
};

type SubjectOption = {
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  category?: string;
};

type PeriodWindow = {
  periodNumber: number;
  label: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
};

function getAcademicSessionLabel() {
  const today = new Date();
  const year = today.getFullYear();
  return today.getMonth() + 1 >= 4
    ? `${year}-${String(year + 1).slice(2)}`
    : `${year - 1}-${String(year).slice(2)}`;
}

function slotKey(day: string, periodNumber: number) {
  return `${day}__${periodNumber}`;
}

function createDefaultSlot(durationMinutes = 45): TimetableSlotForm {
  return {
    subjectId: "",
    durationMinutes,
    entryType: "subject",
  };
}

function parseTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function deriveLegacyDurationMinutes(
  classStartTime: string,
  disperseTime: string,
  periodCount: number,
) {
  const startMinutes = parseTimeToMinutes(classStartTime);
  const endMinutes = parseTimeToMinutes(disperseTime);
  if (
    startMinutes === null ||
    endMinutes === null ||
    periodCount <= 0 ||
    endMinutes <= startMinutes
  ) {
    return 45;
  }
  return Math.max(5, Math.floor((endMinutes - startMinutes) / periodCount));
}

function getDurationFromRange(startTime?: string, endTime?: string) {
  const startMinutes = startTime ? parseTimeToMinutes(startTime) : null;
  const endMinutes = endTime ? parseTimeToMinutes(endTime) : null;
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return null;
  }
  return endMinutes - startMinutes;
}

function normalizeDuration(value: number, fallback = 45) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(5, Math.min(180, Math.round(value)));
}

function isBreakType(entryType: TimetableEntryType) {
  return entryType === "short_break" || entryType === "lunch_break" || entryType === "assembly";
}

function getActivityLabel(entryType: TimetableEntryType) {
  switch (entryType) {
    case "subject":
      return "Subject Period";
    case "short_break":
      return "Short Break";
    case "lunch_break":
      return "Lunch Break";
    case "assembly":
      return "Assembly";
    default:
      return "Subject Period";
  }
}

function defaultDurationForEntryType(entryType: TimetableEntryType) {
  switch (entryType) {
    case "short_break":
      return 10;
    case "lunch_break":
      return 30;
    case "assembly":
      return 15;
    default:
      return 45;
  }
}

function normalizeSlotEntryType(entryType?: TimetableEntryType): TimetableEntryType {
  if (
    entryType === "short_break" ||
    entryType === "lunch_break" ||
    entryType === "assembly"
  ) {
    return entryType;
  }
  return "subject";
}

function inferEntryType(entry: Partial<TimetableEntry>): TimetableEntryType {
  if (
    entry.entryType === "subject" ||
    entry.entryType === "short_break" ||
    entry.entryType === "lunch_break" ||
    entry.entryType === "assembly"
  ) {
    return entry.entryType;
  }

  const label = (entry.subjectName || "").toLowerCase();
  if (label.includes("lunch")) return "lunch_break";
  if (label.includes("short")) return "short_break";
  if (label.includes("assembly")) return "assembly";
  if (entry.subjectId) return "subject";
  return "subject";
}

function getDaySlots(slotMap: Record<string, TimetableSlotForm>, day: string) {
  return Object.entries(slotMap)
    .filter(([key]) => key.startsWith(`${day}__`))
    .sort((a, b) => {
      const indexA = Number(a[0].split("__")[1]) || 0;
      const indexB = Number(b[0].split("__")[1]) || 0;
      return indexA - indexB;
    })
    .map(([, slot]) => slot);
}

function setDaySlots(
  slotMap: Record<string, TimetableSlotForm>,
  day: string,
  slots: TimetableSlotForm[],
) {
  const next = { ...slotMap };
  Object.keys(next).forEach((key) => {
    if (key.startsWith(`${day}__`)) {
      delete next[key];
    }
  });

  slots.forEach((slot, index) => {
    next[slotKey(day, index + 1)] = slot;
  });

  return next;
}

function countTeachingSlots(slots: TimetableSlotForm[]) {
  return slots.filter((slot) => !isBreakType(slot.entryType)).length;
}

function getLastSlotDurationForEndTime(
  classStartTime: string,
  slots: TimetableSlotForm[],
  endTime: string,
) {
  const startMinutes = parseTimeToMinutes(classStartTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null || slots.length === 0) {
    return null;
  }

  const consumedBeforeLast = slots
    .slice(0, -1)
    .reduce((total, slot) => total + normalizeDuration(slot.durationMinutes), 0);

  const lastDuration = endMinutes - (startMinutes + consumedBeforeLast);
  if (lastDuration < 5 || lastDuration > 180) {
    return null;
  }

  return lastDuration;
}

function reconcileDaySlots(
  slots: TimetableSlotForm[],
  teachingPeriodCount: number,
  fallbackDuration = 45,
) {
  const normalizedSlots = slots.map((slot) => ({
    subjectId: slot.subjectId || "",
    durationMinutes: normalizeDuration(slot.durationMinutes, fallbackDuration),
    entryType: normalizeSlotEntryType(slot.entryType),
  }));

  if (normalizedSlots.length === 0) {
    return Array.from({ length: teachingPeriodCount }, () => createDefaultSlot(fallbackDuration));
  }

  let teachingCount = countTeachingSlots(normalizedSlots);

  while (teachingCount < teachingPeriodCount) {
    normalizedSlots.push(createDefaultSlot(fallbackDuration));
    teachingCount += 1;
  }

  while (teachingCount > teachingPeriodCount) {
    const removeIndex = [...normalizedSlots]
      .map((slot, index) => ({ slot, index }))
      .reverse()
      .find(({ slot }) => !isBreakType(slot.entryType))?.index;

    if (removeIndex === undefined) {
      break;
    }

    normalizedSlots.splice(removeIndex, 1);
    teachingCount -= 1;
  }

  return normalizedSlots;
}

function buildDayPeriodWindows(
  classStartTime: string,
  slots: TimetableSlotForm[],
): PeriodWindow[] {
  const startMinutes = parseTimeToMinutes(classStartTime);

  if (startMinutes === null || slots.length === 0) {
    return slots.map((slot, index) => ({
      periodNumber: index + 1,
      label: isBreakType(slot.entryType) ? getActivityLabel(slot.entryType) : `Period ${index + 1}`,
      startTime: "",
      endTime: "",
      durationMinutes: normalizeDuration(slot.durationMinutes ?? 45),
    }));
  }

  let cursor = startMinutes;
  let teachingPeriodNumber = 0;

  return slots.map((slot, index) => {
    const periodNumber = index + 1;
    const durationMinutes = normalizeDuration(slot.durationMinutes);
    const nextCursor = cursor + durationMinutes;
    const isBreak = isBreakType(slot.entryType);

    if (!isBreak) {
      teachingPeriodNumber += 1;
    }

    const period = {
      periodNumber,
      label: isBreak ? getActivityLabel(slot.entryType) : `Period ${teachingPeriodNumber}`,
      startTime: minutesToTime(cursor),
      endTime: minutesToTime(nextCursor),
      durationMinutes,
    };

    cursor = nextCursor;
    return period;
  });
}

function reconcileSlotMap(
  previous: Record<string, TimetableSlotForm>,
  days: string[],
  periodCount: number,
  fallbackDuration = 45,
) {
  const next: Record<string, TimetableSlotForm> = {};
  days.forEach((day) => {
    const daySlots = reconcileDaySlots(getDaySlots(previous, day), periodCount, fallbackDuration);
    daySlots.forEach((slot, index) => {
      next[slotKey(day, index + 1)] = slot;
    });
  });
  return next;
}

function formatSectionLabel(section: Section) {
  return `Grade ${section.grade} - Section ${section.name}`;
}

function getTeacherDisplay(slot: TimetableSlotForm, option?: SubjectOption) {
  if (slot.entryType === "subject") {
    return option?.teacherName || "Select a subject to map teacher";
  }
  return "Not required for break";
}

function getSavedSlotData(slot: TimetableSlotForm, option?: SubjectOption) {
  if (slot.entryType === "subject") {
    return {
      entryType: "subject" as TimetableEntryType,
      subjectId: option?.subjectId || "",
      subjectName: option?.subjectName || "Subject Period",
      teacherId: option?.teacherId || "",
      teacherName: option?.teacherName || "",
    };
  }

  return {
    entryType: slot.entryType,
    subjectId: "",
    subjectName: getActivityLabel(slot.entryType),
    teacherId: "",
    teacherName: "",
  };
}

export default function HodTimetable() {
  const { appUser } = useAuth();
  const [sections, setSections] = useState<Section[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [days, setDays] = useState<string[]>(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  const [periodCount, setPeriodCount] = useState(8);
  const [classStartTime, setClassStartTime] = useState("08:30");
  const [slotMap, setSlotMap] = useState<Record<string, TimetableSlotForm>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const previewSheetRef = useRef<HTMLDivElement | null>(null);

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === selectedSectionId) ?? null,
    [sections, selectedSectionId],
  );

  const subjectOptionMap = useMemo(
    () => new Map(subjectOptions.map((option) => [option.subjectId, option])),
    [subjectOptions],
  );

  const dayPeriodWindows = useMemo(() => {
    const next: Record<string, PeriodWindow[]> = {};
    days.forEach((day) => {
      next[day] = buildDayPeriodWindows(classStartTime, getDaySlots(slotMap, day));
    });
    return next;
  }, [classStartTime, days, slotMap]);

  const dayEndTimes = useMemo(() => {
    const next: Record<string, string> = {};
    days.forEach((day) => {
      const windows = dayPeriodWindows[day] ?? [];
      next[day] = windows[windows.length - 1]?.endTime || "";
    });
    return next;
  }, [dayPeriodWindows, days]);

  const latestDisperseTime = useMemo(() => {
    let latestMinutes = 0;
    Object.values(dayEndTimes).forEach((value) => {
      const minutes = value ? parseTimeToMinutes(value) : null;
      if (minutes !== null) {
        latestMinutes = Math.max(latestMinutes, minutes);
      }
    });
    return latestMinutes ? minutesToTime(latestMinutes) : classStartTime;
  }, [classStartTime, dayEndTimes]);

  const timetableSheetSlots = useMemo(() => {
    const next: SchoolTimetableSheetSlot[] = [];

    days.forEach((day) => {
      const windows = dayPeriodWindows[day] ?? [];
      const daySlots = getDaySlots(slotMap, day);

      windows.forEach((window) => {
        const currentSlot = daySlots[window.periodNumber - 1] ?? createDefaultSlot();
        const option = subjectOptionMap.get(currentSlot.subjectId);
        const slotData = getSavedSlotData(currentSlot, option);

        next.push({
          id: `${day}_${window.periodNumber}`,
          day,
          periodNumber: window.periodNumber,
          periodLabel: window.label,
          startTime: window.startTime,
          endTime: window.endTime,
          subjectName: slotData.subjectName,
          teacherName: slotData.entryType === "subject" ? slotData.teacherName : "",
          entryType: slotData.entryType,
        });
      });
    });

    return next;
  }, [days, dayPeriodWindows, slotMap, subjectOptionMap]);

  const breakSlotCount = useMemo(() => {
    let total = 0;
    days.forEach((day) => {
      getDaySlots(slotMap, day).forEach((slot) => {
        if (isBreakType(slot.entryType)) {
          total += 1;
        }
      });
    });
    return total;
  }, [days, slotMap]);

  useEffect(() => {
    if (!appUser) return;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [sectionSnap, teacherSnap] = await Promise.all([
          getDocs(query(collection(db, "sections"), where("hodId", "==", appUser.id))),
          getDocs(query(collection(db, "teachers"), where("hodIds", "array-contains", appUser.id))),
        ]);

        const fetchedSections = sectionSnap.docs
          .map((record) => ({ id: record.id, ...record.data() } as Section))
          .sort((a, b) => {
            const gradeDiff = Number(a.grade) - Number(b.grade);
            if (gradeDiff !== 0) return gradeDiff;
            return a.name.localeCompare(b.name);
          });

        setSections(fetchedSections);
        setTeachers(teacherSnap.docs.map((record) => ({ id: record.id, ...record.data() } as Teacher)));

        if (fetchedSections.length > 0) {
          setSelectedSectionId((current) => current || fetchedSections[0].id);
        }
      } catch (loadError: any) {
        setError(loadError?.message ?? "Failed to load timetable setup.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [appUser]);

  useEffect(() => {
    if (!selectedSection || !appUser) return;

    const loadSectionTimetable = async () => {
      setError("");
      setMessage("");
      try {
        const [subjectSnap, assignmentSnap, timetableSnap] = await Promise.all([
          getDocs(query(collection(db, "subjects"), where("grade", "==", selectedSection.grade))),
          getDocs(query(collection(db, "subjectAssignments"), where("sectionId", "==", selectedSection.id))),
          getDocs(query(collection(db, "timetables"), where("sectionId", "==", selectedSection.id))),
        ]);

        const subjectMap = new Map(
          subjectSnap.docs.map((record) => [record.id, { id: record.id, ...record.data() } as Subject]),
        );
        const teacherMap = new Map(teachers.map((teacher) => [teacher.id, teacher]));

        const options = assignmentSnap.docs
          .map((record) => {
            const assignment = { id: record.id, ...record.data() } as SubjectAssignment;
            const subject = subjectMap.get(assignment.subjectId);
            const teacher = teacherMap.get(assignment.teacherId);
            if (!subject || !teacher) return null;
            return {
              subjectId: subject.id,
              subjectName: subject.name,
              teacherId: teacher.id,
              teacherName: teacher.name,
              category: subject.category,
            } as SubjectOption;
          })
          .filter((option): option is SubjectOption => Boolean(option))
          .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

        setSubjectOptions(options);

        const config = selectedSection.timetableConfig;
        const nextDays = config?.days?.length ? config.days : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
        const nextPeriodCount = config?.periodCount || 8;
        const nextClassStart = config?.classStartTime || "08:30";
        const fallbackDuration = config?.periodDurationMinutes ||
          deriveLegacyDurationMinutes(nextClassStart, config?.disperseTime || "15:30", nextPeriodCount);

        setDays(nextDays);
        setPeriodCount(nextPeriodCount);
        setClassStartTime(nextClassStart);

        const nextSlotMap = reconcileSlotMap({}, nextDays, nextPeriodCount, fallbackDuration);
        timetableSnap.docs.forEach((record) => {
          const entry = { id: record.id, ...record.data() } as TimetableEntry;
          const key = slotKey(entry.day, entry.periodNumber);
          nextSlotMap[key] = {
            subjectId: entry.subjectId || "",
            durationMinutes: normalizeDuration(
              entry.durationMinutes ?? getDurationFromRange(entry.startTime, entry.endTime) ?? fallbackDuration,
              fallbackDuration,
            ),
            entryType: inferEntryType(entry),
          };
        });
        setSlotMap(nextSlotMap);
      } catch (loadError: any) {
        setError(loadError?.message ?? "Failed to load timetable data.");
      }
    };

    void loadSectionTimetable();
  }, [selectedSection, appUser, teachers]);

  useEffect(() => {
    setSlotMap((current) => reconcileSlotMap(current, days, periodCount));
  }, [days, periodCount]);

  const toggleDay = (day: string) => {
    setDays((current) => {
      if (current.includes(day)) {
        return current.filter((item) => item !== day);
      }
      const next = [...current, day];
      return WEEK_DAYS.filter((item) => next.includes(item));
    });
    setMessage("");
    setError("");
  };

  const updateSlot = (
    day: string,
    periodNumber: number,
    patch: Partial<TimetableSlotForm>,
  ) => {
    setSlotMap((current) => {
      const daySlots = getDaySlots(current, day);
      const currentIndex = Math.max(0, periodNumber - 1);
      const base = daySlots[currentIndex] ?? createDefaultSlot();

      if (patch.entryType && isBreakType(patch.entryType) && !isBreakType(base.entryType)) {
        daySlots.splice(currentIndex, 0, {
          subjectId: "",
          durationMinutes: defaultDurationForEntryType(patch.entryType),
          entryType: patch.entryType,
        });
        return setDaySlots(current, day, daySlots);
      }

      const nextSlot: TimetableSlotForm = {
        subjectId: patch.subjectId !== undefined ? patch.subjectId : base.subjectId,
        durationMinutes: normalizeDuration(
          patch.durationMinutes !== undefined ? patch.durationMinutes : base.durationMinutes,
          base.durationMinutes,
        ),
        entryType: patch.entryType || base.entryType,
      };

      if (nextSlot.entryType !== "subject") {
        nextSlot.subjectId = "";
      }

      daySlots[currentIndex] = nextSlot;
      return setDaySlots(current, day, daySlots);
    });
    setMessage("");
    setError("");
  };

  const removeBreakSlot = (day: string, periodNumber: number) => {
    setSlotMap((current) => {
      const daySlots = getDaySlots(current, day);
      const currentIndex = Math.max(0, periodNumber - 1);
      if (!isBreakType(daySlots[currentIndex]?.entryType || "subject")) {
        return current;
      }
      daySlots.splice(currentIndex, 1);
      return setDaySlots(current, day, reconcileDaySlots(daySlots, periodCount));
    });
    setMessage("");
    setError("");
  };

  const applyEndTime = (targetEndTime: string) => {
    if (!targetEndTime) {
      setError("Set a valid end time.");
      return;
    }

    let invalidDay = "";

    setSlotMap((current) => {
      let next = current;

      for (const day of days) {
        const daySlots = getDaySlots(next, day);
        if (daySlots.length === 0) continue;

        const nextDuration = getLastSlotDurationForEndTime(classStartTime, daySlots, targetEndTime);
        if (nextDuration === null) {
          invalidDay = day;
          return current;
        }

        daySlots[daySlots.length - 1] = {
          ...daySlots[daySlots.length - 1],
          durationMinutes: nextDuration,
        };
        next = setDaySlots(next, day, daySlots);
      }

      return next;
    });

    if (invalidDay) {
      setError(`Cannot set ${targetEndTime} as the end time for ${invalidDay}. Adjust the slots or break durations first.`);
      return;
    }

    setMessage("");
    setError("");
  };

  const saveTimetable = async () => {
    if (!appUser || !selectedSection) return;
    setError("");
    setMessage("");

    if (days.length === 0) {
      setError("Select at least one working day.");
      return;
    }
    if (periodCount <= 0 || periodCount > 12) {
      setError("Teaching periods should be between 1 and 12.");
      return;
    }

    const startMinutes = parseTimeToMinutes(classStartTime);
    if (startMinutes === null) {
      setError("Set a valid class start time.");
      return;
    }

    for (const day of days) {
      const daySlots = getDaySlots(slotMap, day);
      if (countTeachingSlots(daySlots) !== periodCount) {
        setError(`${day}: teaching periods do not match the selected count yet.`);
        return;
      }

      for (let periodNumber = 1; periodNumber <= daySlots.length; periodNumber += 1) {
        const currentSlot = daySlots[periodNumber - 1] ?? createDefaultSlot();
        if (currentSlot.durationMinutes <= 0) {
          setError(`${day} ${periodNumber}: enter a valid duration in minutes.`);
          return;
        }
        if (currentSlot.entryType === "subject" && !currentSlot.subjectId) {
          setError(`${day} ${periodNumber}: choose a subject or insert a break before this period.`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      const existingSnap = await getDocs(
        query(collection(db, "timetables"), where("sectionId", "==", selectedSection.id)),
      );

      const batch = writeBatch(db);
      existingSnap.docs.forEach((record) => batch.delete(record.ref));

      const nextDayEndTimes: Record<string, string> = {};

      days.forEach((day) => {
        const windows = dayPeriodWindows[day] ?? [];
        const daySlots = getDaySlots(slotMap, day);
        nextDayEndTimes[day] = windows[windows.length - 1]?.endTime || classStartTime;

        windows.forEach((window) => {
          const currentSlot = daySlots[window.periodNumber - 1] ?? createDefaultSlot();
          const option = subjectOptionMap.get(currentSlot.subjectId);
          const slotData = getSavedSlotData(currentSlot, option);
          const ref = doc(
            db,
            "timetables",
            `${selectedSection.id}_${day.toLowerCase()}_${window.periodNumber}`,
          );

          batch.set(ref, {
            sectionId: selectedSection.id,
            grade: selectedSection.grade,
            hodId: appUser.id,
            day,
            periodNumber: window.periodNumber,
            periodLabel: window.label,
            startTime: window.startTime,
            endTime: window.endTime,
            durationMinutes: window.durationMinutes,
            entryType: slotData.entryType,
            subjectId: slotData.subjectId,
            subjectName: slotData.subjectName,
            teacherId: slotData.teacherId,
            teacherName: slotData.teacherName,
            updatedAt: new Date().toISOString(),
          });
        });
      });

      const updatedAt = new Date().toISOString();

      batch.update(doc(db, "sections", selectedSection.id), {
        timetableConfig: {
          days,
          periodCount,
          classStartTime,
          disperseTime: latestDisperseTime,
          dayEndTimes: nextDayEndTimes,
          updatedAt,
        },
      });

      await batch.commit();

      setSections((current) =>
        current.map((section) =>
          section.id === selectedSection.id
            ? {
                ...section,
                timetableConfig: {
                  days,
                  periodCount,
                  classStartTime,
                  disperseTime: latestDisperseTime,
                  dayEndTimes: nextDayEndTimes,
                  updatedAt,
                },
              }
            : section,
        ),
      );
      setMessage("Timetable saved and published for students.");
    } catch (saveError: any) {
      setError(saveError?.message ?? "Failed to save timetable.");
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async () => {
    if (!selectedSection) return;

    const source = previewSheetRef.current;
    if (!source) {
      setError("Timetable preview is not ready for download yet.");
      return;
    }

    setDownloadingPdf(true);
    setError("");
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const previewElement = source.querySelector("[data-timetable-sheet='true']") as HTMLElement | null;
      const target = previewElement ?? source;
      const bounds = target.getBoundingClientRect();
      const canvas = await html2canvas(target, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height),
      });

      const image = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const maxWidth = pageWidth - 12;
      const maxHeight = pageHeight - 12;
      const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      const renderWidth = canvas.width * ratio;
      const renderHeight = canvas.height * ratio;
      const x = (pageWidth - renderWidth) / 2;
      const y = (pageHeight - renderHeight) / 2;

      pdf.addImage(image, "PNG", x, y, renderWidth, renderHeight);

      const fileName = `Timetable_Grade_${selectedSection.grade}_Section_${selectedSection.name}`
        .replace(/[^a-z0-9_-]+/gi, "_")
        .replace(/^_+|_+$/g, "");
      pdf.save(`${fileName || "Timetable"}.pdf`);
    } catch (downloadError: any) {
      setError(downloadError?.message ?? "Failed to download timetable PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading timetable setup...</div>;
  }

  if (sections.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No sections are assigned to you yet. Create sections in Class Management first.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Class Timetable</h1>
          <p className="text-sm text-muted-foreground">
            Set working days, teaching periods, class start time, and end time, then insert breaks wherever the day needs them.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Section</p>
            <p className="mt-1 text-sm font-semibold">{selectedSection ? formatSectionLabel(selectedSection) : "None"}</p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Days</p>
            <p className="mt-1 text-sm font-semibold">{days.length}</p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Teaching Periods</p>
            <p className="mt-1 text-sm font-semibold">{periodCount}</p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Break Slots</p>
            <p className="mt-1 text-sm font-semibold">{breakSlotCount}</p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Assigned Subjects</p>
            <p className="mt-1 text-sm font-semibold">{subjectOptions.length}</p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Section</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedSectionId}
                onChange={(event) => setSelectedSectionId(event.target.value)}
              >
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {formatSectionLabel(section)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Teaching Periods</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={periodCount}
                onChange={(event) => setPeriodCount(Math.max(1, Math.min(12, Number(event.target.value) || 1)))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Class Start Time</Label>
              <Input type="time" value={classStartTime} onChange={(event) => setClassStartTime(event.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>End Time</Label>
              <Input
                type="time"
                value={latestDisperseTime}
                onChange={(event) => applyEndTime(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Working Days</Label>
            <div className="flex flex-wrap gap-2">
              {WEEK_DAYS.map((day) => {
                const active = days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground hover:bg-muted"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            Add the duration inside each row. If you change the end time, the last slot of each selected day is adjusted automatically. Breaks are inserted between periods instead of replacing a teaching period.
          </div>

          {subjectOptions.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No section subjects are assigned yet. You can still set timing rows and breaks now, then map subject periods after teachers are assigned.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {days.map((day) => (
          <Card key={day}>
            <CardContent className="pt-5">
              {(() => {
                const daySlots = getDaySlots(slotMap, day);
                const teachingPeriodTotal = countTeachingSlots(daySlots);

                return (
                  <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CalendarDays size={16} className="text-primary" />
                  <h2 className="font-semibold">{day}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{teachingPeriodTotal} periods</Badge>
                  <Badge variant="outline">{daySlots.length} slots</Badge>
                  <Badge variant="outline">Ends {dayEndTimes[day] || "--:--"}</Badge>
                </div>
              </div>

              <div className="space-y-3">
                {(dayPeriodWindows[day] ?? []).map((window) => {
                  const currentSlot = daySlots[window.periodNumber - 1] ?? createDefaultSlot();
                  const currentOption = subjectOptionMap.get(currentSlot.subjectId);
                  const isSubjectRow = currentSlot.entryType === "subject";
                  const breakRow = isBreakType(currentSlot.entryType);

                  return (
                    <div
                      key={`${day}_${window.periodNumber}`}
                      className={`grid grid-cols-1 gap-3 rounded-2xl border p-4 xl:grid-cols-[170px_180px_120px_minmax(0,240px)_minmax(0,1fr)] ${
                        breakRow
                          ? "border-amber-200 bg-amber-50/70"
                          : "border-border bg-muted/20"
                      }`}
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">{window.label}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock3 size={13} />
                          <span>
                            {window.startTime && window.endTime
                              ? `${window.startTime} - ${window.endTime}`
                              : "Set class timings"}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label>Activity</Label>
                          {breakRow ? (
                            <button
                              type="button"
                              onClick={() => removeBreakSlot(day, window.periodNumber)}
                              className="text-xs font-medium text-destructive transition-colors hover:text-destructive/80"
                            >
                              Remove Break
                            </button>
                          ) : null}
                        </div>
                        <select
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={currentSlot.entryType}
                          onChange={(event) =>
                            updateSlot(day, window.periodNumber, {
                              entryType: event.target.value as TimetableEntryType,
                            })
                          }
                        >
                          {breakRow ? (
                            BREAK_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))
                          ) : (
                            <>
                              <option value="subject">Subject Period</option>
                              {BREAK_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {`Insert ${option.label}`}
                                </option>
                              ))}
                            </>
                          )}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Duration</Label>
                        <Input
                          type="number"
                          min={5}
                          max={180}
                          value={currentSlot.durationMinutes}
                          onChange={(event) =>
                            updateSlot(day, window.periodNumber, {
                              durationMinutes: Number(event.target.value) || 5,
                            })
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label>{isSubjectRow ? "Subject" : "Slot Details"}</Label>
                        {isSubjectRow ? (
                          <select
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={currentSlot.subjectId}
                            onChange={(event) =>
                              updateSlot(day, window.periodNumber, {
                                subjectId: event.target.value,
                              })
                            }
                          >
                            <option value="">Select subject</option>
                            {subjectOptions.map((option) => (
                              <option key={option.subjectId} value={option.subjectId}>
                                {option.subjectName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                            {getActivityLabel(currentSlot.entryType)}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label>Teacher</Label>
                        <div className="rounded-md border border-border bg-background px-3 py-2 text-sm">
                          {getTeacherDisplay(currentSlot, currentOption)}
                        </div>
                        {isSubjectRow && currentOption?.category ? (
                          <p className="text-xs text-muted-foreground">
                            {currentOption.category === "co-scholastic" ? "Co-Scholastic" : "Scholastic"}
                          </p>
                        ) : breakRow ? (
                          <p className="text-xs text-muted-foreground">
                            This break sits between periods and does not reduce the teaching period count.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">Professional Timetable Preview</p>
              <p className="text-sm text-muted-foreground">
                This exact table format is shown to students and exported in PDF.
              </p>
            </div>
            <Badge variant="outline">
              {selectedSection ? formatSectionLabel(selectedSection) : "Section not selected"}
            </Badge>
          </div>
          <div className="overflow-x-auto pb-2" ref={previewSheetRef}>
            <SchoolTimetableSheet
              slots={timetableSheetSlots}
              classLabel={selectedSection ? `Grade ${selectedSection.grade}` : "Grade --"}
              sectionLabel={selectedSection ? `Section ${selectedSection.name}` : "Section --"}
              schoolName={SCHOOL_NAME}
              sessionLabel={getAcademicSessionLabel()}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        <Button
          variant="outline"
          className="gap-2"
          onClick={downloadPdf}
          disabled={!selectedSection || downloadingPdf}
        >
          <Download size={16} />
          {downloadingPdf ? "Generating PDF..." : "Download PDF"}
        </Button>
        <Button className="gap-2" onClick={saveTimetable} disabled={saving || !selectedSection}>
          <Save size={16} />
          {saving ? "Saving Timetable..." : "Save & Publish Timetable"}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <School size={18} className="text-primary" />
            </div>
            <div>
              <p className="font-semibold">How this works</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The published timetable is saved section-wise. Students in that section see the same timetable in their dashboard under My Timetable, including any breaks you place between periods.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

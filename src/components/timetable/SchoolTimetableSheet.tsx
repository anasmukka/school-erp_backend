import { TimetableEntryType } from "@/lib/types";
import { School } from "lucide-react";

const DAY_ORDER: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

export interface SchoolTimetableSheetSlot {
  id: string;
  day: string;
  periodNumber?: number;
  periodLabel?: string;
  startTime?: string;
  endTime?: string;
  subjectName: string;
  teacherName?: string;
  entryType?: TimetableEntryType;
}

interface SchoolTimetableSheetProps {
  slots: SchoolTimetableSheetSlot[];
  classLabel: string;
  sectionLabel: string;
  schoolName?: string;
  sessionLabel?: string;
  logoUrl?: string;
  generatedAt?: string;
  className?: string;
}

function normalizeDay(value?: string): string {
  return value?.trim() || "Day";
}

function formatTimeRange(start?: string, end?: string): string {
  if (start && end) return `${start} - ${end}`;
  return start || end || "--";
}

function getPeriodSortValue(slot: SchoolTimetableSheetSlot): number {
  if (Number.isFinite(slot.periodNumber)) return Number(slot.periodNumber);
  const extracted = Number((slot.periodLabel || "").replace(/\D/g, ""));
  return Number.isFinite(extracted) && extracted > 0 ? extracted : Number.MAX_SAFE_INTEGER;
}

function getEntryLabel(slot: SchoolTimetableSheetSlot): string {
  if (slot.entryType === "short_break") return "Short Break";
  if (slot.entryType === "lunch_break") return "Lunch Break";
  if (slot.entryType === "assembly") return "Assembly";
  return slot.subjectName || "Subject";
}

function isBreak(entryType?: TimetableEntryType): boolean {
  return entryType === "short_break" || entryType === "lunch_break" || entryType === "assembly";
}

function getColumnHeading(columnNumber: number): string {
  return `P${columnNumber}`;
}

export default function SchoolTimetableSheet({
  slots,
  classLabel,
  sectionLabel,
  schoolName = "Prestige International School",
  sessionLabel,
  logoUrl,
  generatedAt,
  className = "",
}: SchoolTimetableSheetProps) {
  const groupedByDay = slots.reduce<Record<string, SchoolTimetableSheetSlot[]>>((acc, slot) => {
    const day = normalizeDay(slot.day);
    if (!acc[day]) {
      acc[day] = [];
    }
    acc[day].push(slot);
    return acc;
  }, {});

  const orderedDays = Object.keys(groupedByDay).sort((a, b) => {
    const aOrder = DAY_ORDER[a.toLowerCase()] ?? 99;
    const bOrder = DAY_ORDER[b.toLowerCase()] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.localeCompare(b);
  });

  const sortedByDay: Record<string, SchoolTimetableSheetSlot[]> = {};
  orderedDays.forEach((day) => {
    sortedByDay[day] = [...groupedByDay[day]].sort((a, b) => getPeriodSortValue(a) - getPeriodSortValue(b));
  });

  const maxColumns = Math.max(
    1,
    ...orderedDays.map((day) => sortedByDay[day]?.length || 0),
  );

  const generatedLabel = generatedAt || new Date().toLocaleDateString("en-IN");

  return (
    <div
      data-timetable-sheet="true"
      className={`min-w-[900px] rounded-xl border border-slate-300 bg-white p-4 text-slate-900 ${className}`}
    >
      <div className="grid grid-cols-[120px_minmax(0,1fr)_190px] items-center gap-4 border-b border-slate-300 pb-3">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-slate-300 bg-white p-1">
              <img src={logoUrl} alt="School Logo" className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-600">
              <School size={22} />
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">School</p>
            <p className="text-xs font-semibold">Official Sheet</p>
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{schoolName}</p>
          <h3 className="mt-1 text-2xl font-bold tracking-wide text-slate-900">Timetable</h3>
          <p className="mt-1 text-sm font-semibold text-slate-700">
            {classLabel} | {sectionLabel}
          </p>
        </div>

        <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs">
          <p className="font-semibold text-slate-700">Generated</p>
          <p className="mt-0.5 text-slate-600">{generatedLabel}</p>
          <p className="mt-2 font-semibold text-slate-700">Session</p>
          <p className="mt-0.5 text-slate-600">{sessionLabel || "--"}</p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-[120px] border border-slate-400 bg-slate-100 px-2 py-2 text-left text-[11px] font-semibold text-slate-700">
                Day
              </th>
              {Array.from({ length: maxColumns }, (_, index) => (
                <th
                  key={`col_head_${index + 1}`}
                  className="min-w-[135px] border border-slate-400 bg-slate-100 px-2 py-2 text-center text-[11px] font-semibold text-slate-700"
                >
                  {getColumnHeading(index + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedDays.map((day) => (
              <tr key={day}>
                <td className="border border-slate-400 bg-slate-50 px-2 py-3 align-top text-[11px] font-semibold text-slate-700">
                  {day}
                </td>
                {Array.from({ length: maxColumns }, (_, index) => {
                  const slot = sortedByDay[day]?.[index];
                  if (!slot) {
                    return (
                      <td
                        key={`${day}_${index + 1}_empty`}
                        className="border border-slate-300 px-2 py-2 align-top text-center text-[11px] text-slate-400"
                      >
                        --
                      </td>
                    );
                  }

                  const breakSlot = isBreak(slot.entryType);
                  return (
                    <td
                      key={slot.id}
                      className={`border border-slate-300 px-2 py-2 align-top ${
                        breakSlot ? "bg-amber-50" : "bg-white"
                      }`}
                    >
                      <p className="text-[11px] font-semibold text-slate-900">{getEntryLabel(slot)}</p>
                      <p className="mt-0.5 text-[10px] text-slate-600">{formatTimeRange(slot.startTime, slot.endTime)}</p>
                      {!breakSlot ? (
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {slot.teacherName ? `Teacher: ${slot.teacherName}` : "Teacher: --"}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[10px] text-amber-700">Break</p>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

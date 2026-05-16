import { ReactNode, useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Briefcase,
  CalendarDays,
  CreditCard,
  Download,
  GraduationCap,
  Hash,
  Mail,
  MapPin,
  Phone,
  ScanLine,
  School,
  ShieldCheck,
  LucideIcon,
  User as UserIcon,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { Section } from "@/lib/types";

type Tab = "hods" | "teachers" | "students" | "accountants";

interface CardPerson {
  id: string;
  name: string;
  role: "hod" | "teacher" | "student" | "accountant";
  photo?: string;
  grade?: string;
  sectionName?: string;
  dob?: string;
  parentContact?: string;
  fatherName?: string;
  motherName?: string;
  address?: string;
  admissionNo: string;
  designation?: string;
  subject?: string;
  email?: string;
  phone?: string;
}

interface Theme {
  header: string;
  headerAlt: string;
  accent: string;
  accentSoft: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  muted: string;
  chip: string;
  qr: string;
}

interface DetailRow {
  label: string;
  value: string;
  icon: LucideIcon;
  wide?: boolean;
}

interface CardPresentation {
  cardLabel: string;
  descriptor: string;
  supporting: string;
  accessNote: string;
  verificationNote: string;
  identityLabel: string;
  issueDate: string;
  session: string;
  validThrough: string;
  details: DetailRow[];
}

interface TabConfig {
  key: Tab;
  label: string;
  icon: ReactNode;
}

const THEMES: Record<CardPerson["role"], Theme> = {
  student: {
    header: "#143562",
    headerAlt: "#21528e",
    accent: "#f4c76a",
    accentSoft: "#e8f0ff",
    surface: "#f8fbff",
    surfaceAlt: "#edf4ff",
    border: "#cfdcf1",
    text: "#10213e",
    muted: "#617490",
    chip: "#e6eefc",
    qr: "#17355f",
  },
  teacher: {
    header: "#194d3f",
    headerAlt: "#2f7a68",
    accent: "#b8e39c",
    accentSoft: "#eefcf5",
    surface: "#f8fffb",
    surfaceAlt: "#eaf8f2",
    border: "#cde6da",
    text: "#12342b",
    muted: "#5d776f",
    chip: "#e4f4ec",
    qr: "#194d3f",
  },
  hod: {
    header: "#4f256f",
    headerAlt: "#7d45a4",
    accent: "#e0c6ff",
    accentSoft: "#f7f0ff",
    surface: "#fcf9ff",
    surfaceAlt: "#f1e9fb",
    border: "#decee9",
    text: "#311847",
    muted: "#7a6889",
    chip: "#efe4fb",
    qr: "#4f256f",
  },
  accountant: {
    header: "#0f4c5c",
    headerAlt: "#146b82",
    accent: "#f4d35e",
    accentSoft: "#e8f6fb",
    surface: "#f7fbfd",
    surfaceAlt: "#e9f2f6",
    border: "#c8dfe8",
    text: "#0d2f3a",
    muted: "#56707a",
    chip: "#e3f1f6",
    qr: "#0f4c5c",
  },
};

function getTheme(role: CardPerson["role"]): Theme {
  return THEMES[role];
}

function getSession(): string {
  const today = new Date();
  const year = today.getFullYear();
  return today.getMonth() + 1 >= 4
    ? `${year}-${String(year + 1).slice(2)}`
    : `${year - 1}-${String(year).slice(2)}`;
}

function getSessionEndYear(session: string): number | null {
  const [start, endSuffix] = session.split("-");
  if (!start || !endSuffix) return null;
  const century = start.slice(0, 2);
  const fullYear = Number(`${century}${endSuffix}`);
  return Number.isFinite(fullYear) ? fullYear : null;
}

function formatDateValue(value?: string): string {
  if (!value) return "Not available";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getValidThrough(session: string): string {
  const sessionEndYear = getSessionEndYear(session);
  return sessionEndYear ? `31 Mar ${sessionEndYear}` : session;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function getRoleLabel(role: CardPerson["role"]): string {
  if (role === "student") return "Student";
  if (role === "hod") return "HOD";
  if (role === "accountant") return "Accounts";
  return "Teacher";
}

function getIdentityLabel(role: CardPerson["role"]): string {
  return role === "student" ? "Admission No" : "Employee ID";
}

function joinNonEmpty(values: Array<string | undefined>, separator: string): string {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(separator);
}

function getPersonSummary(p: CardPerson): string {
  if (p.role === "student") {
    const classLabel = joinNonEmpty([p.grade, p.sectionName], " - ");
    return classLabel ? `Class ${classLabel}` : "Student Record";
  }

  return joinNonEmpty([p.designation ?? getRoleLabel(p.role), p.subject], " | ") || "Staff";
}

function buildCardPresentation(p: CardPerson): CardPresentation {
  const session = getSession();
  const issueDate = formatDateValue(new Date().toISOString());
  const validThrough = getValidThrough(session);
  const parentNames = joinNonEmpty([p.fatherName, p.motherName], " / ");
  const classLabel = joinNonEmpty([p.grade, p.sectionName], " - ");

  if (p.role === "student") {
    return {
      cardLabel: "Student ID",
      descriptor: classLabel ? `Class ${classLabel}` : "Student",
      supporting: parentNames || "Guardian details maintained in school records",
      accessNote: "Student access profile",
      verificationNote: "Verified against the active student roster and guardian record.",
      identityLabel: getIdentityLabel(p.role),
      issueDate,
      session,
      validThrough,
      details: [
        { label: "Admission No", value: p.admissionNo, icon: Hash },
        { label: "Date of Birth", value: formatDateValue(p.dob), icon: CalendarDays },
        { label: "Contact Number", value: p.parentContact || "Not available", icon: Phone },
        { label: "Issued On", value: issueDate, icon: ShieldCheck },
        { label: "Parent / Guardian", value: parentNames || "Not available", icon: UserIcon, wide: true },
        { label: "Address", value: p.address || "Not available", icon: MapPin, wide: true },
      ],
    };
  }

  const descriptor =
    p.designation ||
    (p.role === "hod"
      ? "Head of Department"
      : p.role === "accountant"
        ? "Accounts Staff"
        : "Teacher");
  const department =
    p.subject ||
    (p.role === "hod"
      ? "Academic Administration"
      : p.role === "accountant"
        ? "Finance & Collections"
        : "Academic Staff");

  return {
    cardLabel: p.role === "hod" ? "HOD ID" : p.role === "accountant" ? "Accounts ID" : "Teacher ID",
    descriptor,
    supporting: p.subject ? `${p.subject} Department` : p.role === "accountant" ? "Finance team credential" : "Academic staff credential",
    accessNote: p.role === "hod" ? "Leadership access profile" : p.role === "accountant" ? "Finance access profile" : "Faculty access profile",
    verificationNote: "Validated by school administration for campus and record access.",
    identityLabel: getIdentityLabel(p.role),
    issueDate,
    session,
    validThrough,
    details: [
      { label: "Employee ID", value: p.admissionNo, icon: Hash },
      { label: "Department", value: department, icon: Briefcase },
      { label: "Date of Birth", value: formatDateValue(p.dob), icon: CalendarDays },
      { label: "Issued On", value: issueDate, icon: ShieldCheck },
      { label: "Official Email", value: p.email || "Not available", icon: Mail, wide: true },
      { label: "Contact Number", value: p.phone || p.parentContact || "Not available", icon: Phone, wide: true },
      { label: "Address", value: p.address || "Not available", icon: MapPin, wide: true },
    ],
  };
}

function QRPlaceholder({
  size = 56,
  foreground = "#10213e",
  background = "#ffffff",
}: {
  size?: number;
  foreground?: string;
  background?: string;
}) {
  const pattern = [
    [1, 1, 1, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1, 0, 1, 0, 0],
    [1, 0, 1, 0, 1, 0, 1, 1, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 0, 1, 0, 1],
    [0, 0, 0, 0, 0, 0, 1, 0, 0],
    [1, 1, 0, 1, 0, 1, 1, 1, 0],
    [0, 0, 1, 0, 0, 1, 0, 1, 1],
    [1, 0, 1, 1, 0, 0, 1, 0, 1],
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 9 9"
      style={{ display: "block", shapeRendering: "crispEdges" }}
    >
      <rect width="9" height="9" rx="1.2" fill={background} />
      {pattern.map((row, rowIndex) =>
        row.map((cell, colIndex) =>
          cell ? (
            <rect
              key={`${rowIndex}-${colIndex}`}
              x={colIndex}
              y={rowIndex}
              width="1"
              height="1"
              fill={foreground}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

function DetailTile({
  row,
  theme,
  compact = false,
}: {
  row: DetailRow;
  theme: Theme;
  compact?: boolean;
}) {
  const Icon = row.icon;

  return (
    <div
      className={`${row.wide ? "col-span-2" : ""} rounded-[18px] border px-3 py-2.5`}
      style={{
        borderColor: theme.border,
        background: `linear-gradient(180deg, rgba(255,255,255,0.94) 0%, ${theme.surfaceAlt} 100%)`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: theme.chip, color: theme.header }}
        >
          <Icon size={compact ? 14 : 15} />
        </div>
        <div className="min-w-0">
          <p
            className="text-[10px] font-semibold uppercase"
            style={{ color: theme.muted, letterSpacing: "0.18em" }}
          >
            {row.label}
          </p>
          <p
            className={`${compact ? "text-[11px]" : "text-xs"} mt-1 break-words font-semibold leading-snug`}
            style={{ color: theme.text }}
          >
            {row.value}
          </p>
        </div>
      </div>
    </div>
  );
}

interface IDField {
  label: string;
  value: string;
}

const SCHOOL_NAME = "PRESTIGE INTERNATIONAL SCHOOL";
const SCHOOL_TAGLINE = "Excellence in Education";
const SCHOOL_ADDRESS = "Prestige International School";
const SCHOOL_PHONE = "";

function getClassSectionLabel(p: CardPerson): string {
  const gradeLabel = p.grade ? `Grade ${p.grade}` : "";
  const sectionLabel = p.sectionName ? `Section ${p.sectionName}` : "";
  const classLabel = joinNonEmpty([gradeLabel, sectionLabel], " - ");
  return classLabel || "Not available";
}

function getStaffDesignation(p: CardPerson): string {
  return p.designation || (p.role === "hod" ? "Head of Department" : p.role === "accountant" ? "Accounts Staff" : "Teacher");
}

function getPhoneValue(p: CardPerson): string {
  return p.parentContact || p.phone || "Not available";
}

function getCardFields(p: CardPerson): IDField[] {
  if (p.role === "student") {
    return [
      { label: "Name", value: p.name || "Not available" },
      { label: "DOB", value: formatDateValue(p.dob) },
      { label: "Class with Section", value: getClassSectionLabel(p) },
      { label: "Father Name", value: p.fatherName || "Not available" },
      { label: "Mother Name", value: p.motherName || "Not available" },
      { label: "Address", value: p.address || "Not available" },
      { label: "Mob No", value: getPhoneValue(p) },
    ];
  }

  return [
    { label: "Name", value: p.name || "Not available" },
    { label: "Designation", value: getStaffDesignation(p) },
    { label: "DOB", value: formatDateValue(p.dob) },
    { label: "Address", value: p.address || "Not available" },
    { label: "Mob No", value: getPhoneValue(p) },
  ];
}

function IDCardDisplay({ p, compact = false }: { p: CardPerson; compact?: boolean }) {
  const theme = getTheme(p.role);
  const fields = getCardFields(p);
  const roleLabel = p.role === "student" ? "STUDENT ID CARD" : "STAFF ID CARD";
  const cardWidth = compact ? "w-[320px]" : "w-[360px]";
  const photoHeight = compact ? "h-[120px]" : "h-[132px]";

  return (
    <div data-id-card-preview="true" className={`flex min-w-max ${compact ? "gap-3" : "gap-4 justify-center"}`}>
      <div
        className={`${cardWidth} overflow-hidden rounded-xl border bg-white`}
        style={{ borderColor: theme.border, boxShadow: "0 10px 26px rgba(15, 23, 42, 0.16)" }}
      >
        <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: theme.header }}>
          <div className="flex items-center gap-2 text-white">
            <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-white/90 overflow-hidden">
              <img src="/prestige_logo.png" alt="Logo" className="h-6 w-6 object-contain" />
            </div>
            <div>
              <p className="text-[12px] font-bold leading-none">{SCHOOL_NAME}</p>
              <p className="text-[9px] opacity-90">{SCHOOL_TAGLINE}</p>
            </div>
          </div>
          <p className="text-[10px] font-bold text-white">{roleLabel}</p>
        </div>

        <div
          className={`grid grid-cols-[86px_minmax(0,1fr)] gap-3 ${compact ? "p-3" : "p-4"}`}
          style={{ backgroundColor: "#ffffff" }}
        >
          <div
            className={`overflow-hidden rounded-sm border bg-slate-100 ${photoHeight}`}
            style={{ borderColor: theme.headerAlt }}
          >
            {p.photo ? (
              <img src={p.photo} alt={p.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-base font-semibold text-slate-500">
                {getInitials(p.name)}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            {fields.map((field) => (
              <div key={field.label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-b border-slate-200 pb-1">
                <p className="text-[10px] font-semibold text-slate-600">{field.label}</p>
                <p className="text-[10px] font-semibold text-slate-900">{field.value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-[10px] text-white" style={{ backgroundColor: theme.headerAlt }}>
          <span>{SCHOOL_ADDRESS}</span>
          <span>Principal</span>
        </div>
      </div>

      <div
        className={`${cardWidth} overflow-hidden rounded-xl border bg-white`}
        style={{ borderColor: theme.border, boxShadow: "0 10px 26px rgba(15, 23, 42, 0.16)" }}
      >
        <div className="flex h-full flex-col items-center justify-center px-4 py-6 text-center">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-lg border bg-white overflow-hidden"
            style={{ borderColor: theme.headerAlt }}
          >
            <img src="/prestige_logo.png" alt="Logo" className="h-16 w-16 object-contain" />
          </div>
          <p className="mt-4 text-lg font-bold" style={{ color: theme.header }}>{SCHOOL_NAME}</p>
          <p className="text-xs text-slate-600">{SCHOOL_TAGLINE}</p>
        </div>
      </div>
    </div>
  );
}

async function generateIDCardPDF(p: CardPerson) {
  const { jsPDF } = await import("jspdf");
  
  const theme = getTheme(p.role);
  const fields = getCardFields(p);
  const roleLabel = p.role === "student" ? "STUDENT ID CARD" : "STAFF ID CARD";
  const session = getSession();

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const cardW = 85.6;
  const cardH = 54;
  const gap = 8;
  const startX = (pageW - cardW * 2 - gap) / 2;
  const startY = (pageH - cardH) / 2;

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 0, b: 0 };
  };

  const headerColor = hexToRgb(theme.header);
  const headerAltColor = hexToRgb(theme.headerAlt);

  // ============ FRONT CARD ============
  let x = startX;
  let y = startY;

  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(x, y, cardW, cardH, 3, 3, "S");

  // Header
  pdf.setFillColor(headerColor.r, headerColor.g, headerColor.b);
  pdf.roundedRect(x, y, cardW, 12, 3, 3, "F");
  pdf.rect(x, y + 3, cardW, 9, "F");

  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.text(SCHOOL_NAME, x + 4, y + 5);
  pdf.setFontSize(5);
  pdf.setFont("helvetica", "normal");
  pdf.text(SCHOOL_TAGLINE, x + 4, y + 8.5);
  pdf.setFontSize(5);
  pdf.setFont("helvetica", "bold");
  pdf.text(roleLabel, x + cardW - 4, y + 6, { align: "right" });

  // Photo placeholder
  const photoX = x + 4;
  const photoY = y + 13;
  const photoW = 18;
  const photoH = 22;
  pdf.setFillColor(240, 240, 240);
  pdf.setDrawColor(headerAltColor.r, headerAltColor.g, headerAltColor.b);
  pdf.setLineWidth(0.4);
  pdf.rect(photoX, photoY, photoW, photoH, "FD");
  pdf.setTextColor(150, 150, 150);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "bold");
  pdf.text(getInitials(p.name), photoX + photoW / 2, photoY + photoH / 2 + 3, { align: "center" });

  // Fields
  const fieldX = x + 25;
  let fieldY = y + 15;
  const fieldGap = 4.2;
  pdf.setFontSize(5.5);
  fields.forEach((field) => {
    pdf.setTextColor(100, 100, 100);
    pdf.setFont("helvetica", "normal");
    pdf.text(field.label, fieldX, fieldY);
    pdf.setTextColor(30, 30, 30);
    pdf.setFont("helvetica", "bold");
    const value = field.value.length > 28 ? field.value.substring(0, 26) + "..." : field.value;
    pdf.text(value, fieldX + 24, fieldY);
    pdf.setDrawColor(230, 230, 230);
    pdf.setLineWidth(0.1);
    pdf.line(fieldX, fieldY + 1.5, x + cardW - 4, fieldY + 1.5);
    fieldY += fieldGap;
  });

  // Footer
  pdf.setFillColor(headerAltColor.r, headerAltColor.g, headerAltColor.b);
  pdf.roundedRect(x, y + cardH - 9, cardW, 9, 3, 3, "F");
  pdf.rect(x, y + cardH - 9, cardW, 6, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(5);
  pdf.setFont("helvetica", "normal");
  pdf.text(SCHOOL_ADDRESS, x + 4, y + cardH - 3);
  pdf.text("Principal", x + cardW - 4, y + cardH - 3, { align: "right" });

  // ============ BACK CARD ============
  x = startX + cardW + gap;
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(x, y, cardW, cardH, 3, 3, "S");

  const centerX = x + cardW / 2;
  pdf.setTextColor(headerColor.r, headerColor.g, headerColor.b);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text(SCHOOL_NAME, centerX, y + 20, { align: "center" });
  pdf.setTextColor(100, 100, 100);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6);
  pdf.text(SCHOOL_TAGLINE, centerX, y + 25, { align: "center" });

  pdf.setFontSize(5.5);
  pdf.setTextColor(60, 60, 60);
  pdf.text("Session: " + session, centerX, y + 32, { align: "center" });
  pdf.text("Valid Through: " + getValidThrough(session), centerX, y + 36, { align: "center" });

  pdf.setDrawColor(headerColor.r, headerColor.g, headerColor.b);
  pdf.setLineWidth(0.5);
  pdf.line(x + 15, y + 40, x + cardW - 15, y + 40);
  pdf.setFontSize(5);
  pdf.setTextColor(120, 120, 120);
  pdf.text("Authorized Signatory", centerX, y + 47, { align: "center" });

  const safeName = p.name.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "record";
  pdf.save(`ID_${p.role.toUpperCase()}_${safeName}.pdf`);
}

export default function IDCards() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";
  const [tab, setTab] = useState<Tab>(isAdmin ? "hods" : "teachers");
  const [people, setPeople] = useState<CardPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<CardPerson | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const cardPreviewRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const modalPreviewRef = useRef<HTMLDivElement | null>(null);

  const handleDownload = async (person: CardPerson) => {
    try {
      setDownloadingId(person.id);
      await generateIDCardPDF(person);
    } catch (err) {
      console.error("Failed to download ID card", err);
      alert("Unable to generate ID card right now. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  const loadData = async (selectedTab: Tab) => {
    if (!appUser) return;

    setLoading(true);
    setPeople([]);

    try {
      if (selectedTab === "hods" && isAdmin) {
        const snapshot = await getDocs(
          query(collection(db, "users"), where("role", "==", "hod")),
        );

        setPeople(
          snapshot.docs
            .map((doc) => {
              const data = doc.data();
              return {
                id: doc.id,
                name: data.name,
                role: "hod" as const,
                email: data.email,
                photo: data.photo,
                subject: data.subject,
                designation: data.designation ?? "Head of Department",
                phone: data.phone,
                address: data.address,
                dob: data.DOB,
                admissionNo: doc.id.slice(0, 8).toUpperCase(),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } else if (selectedTab === "accountants" && isAdmin) {
        const snapshot = await getDocs(query(collection(db, "users"), where("role", "==", "accountant")));
        setPeople(
          snapshot.docs
            .map((doc) => {
              const data = doc.data();
              return {
                id: doc.id,
                name: data.name,
                role: "accountant" as const,
                email: data.email,
                photo: data.photo,
                subject: data.subject ?? "Accounts",
                designation: data.designation ?? "Accounts Staff",
                phone: data.phone ?? data.parentContact,
                address: data.address,
                dob: data.DOB,
                admissionNo: doc.id.slice(0, 8).toUpperCase(),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } else if (selectedTab === "teachers") {
        const teacherQuery = isAdmin
          ? query(collection(db, "teachers"))
          : query(collection(db, "teachers"), where("hodIds", "array-contains", appUser.id));
        const snapshot = await getDocs(teacherQuery);

        setPeople(
          snapshot.docs
            .map((doc) => {
              const data = doc.data();
              return {
                id: doc.id,
                name: data.name,
                role: "teacher" as const,
                email: data.email,
                photo: data.photo,
                subject: data.subject,
                designation: data.designation ?? "Teacher",
                phone: data.phone,
                address: data.address,
                dob: data.DOB,
                admissionNo: doc.id.slice(0, 8).toUpperCase(),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } else if (selectedTab === "students") {
        const studentsQuery = isAdmin
          ? query(collection(db, "students"))
          : query(collection(db, "students"), where("hodId", "==", appUser.id));

        const [studentSnapshot, sectionSnapshot] = await Promise.all([
          getDocs(studentsQuery),
          getDocs(collection(db, "sections")),
        ]);

        const sectionMap: Record<string, string> = {};
        sectionSnapshot.docs.forEach((doc) => {
          sectionMap[doc.id] = (doc.data() as Section).name;
        });

        setPeople(
          studentSnapshot.docs
            .map((doc) => {
              const data = doc.data();
              return {
                id: doc.id,
                name: data.name,
                role: "student" as const,
                photo: data.photo,
                grade: data.grade,
                sectionName: data.sectionId ? sectionMap[data.sectionId] : undefined,
                dob: data.DOB,
                parentContact: data.parentContact,
                fatherName: data.fatherName,
                motherName: data.motherName,
                address: data.address,
                admissionNo: data.admissionNo ?? doc.id.slice(0, 8).toUpperCase(),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(tab);
  }, [tab, appUser]);

  const tabs: TabConfig[] = [
    ...(isAdmin ? [{ key: "hods" as const, label: "HODs", icon: <School size={15} /> }] : []),
    ...(isAdmin ? [{ key: "accountants" as const, label: "Accounts", icon: <CreditCard size={15} /> }] : []),
    { key: "teachers", label: "Teachers", icon: <Users size={15} /> },
    { key: "students", label: "Students", icon: <GraduationCap size={15} /> },
  ];

  const activeTabLabel = tabs.find((item) => item.key === tab)?.label ?? "Records";

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-border/60 shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
                <CreditCard size={14} />
                Identity Studio
              </div>
              <h1 className="text-3xl font-bold tracking-tight">ID Card Generator</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Create polished identity badges for students, teachers, and academic leadership
                with a stronger preview layout and print-ready PDF output.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Records
                </p>
                <p className="mt-1 text-2xl font-bold">{people.length}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Current View
                </p>
                <p className="mt-1 text-sm font-semibold">{activeTabLabel}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Session
                </p>
                <p className="mt-1 text-sm font-semibold">{getSession()}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all ${
              tab === item.key
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : people.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="py-14 text-center text-muted-foreground">
            <CreditCard size={42} className="mx-auto mb-3 opacity-35" />
            <p className="text-base font-medium">No records found in this category.</p>
            <p className="mt-1 text-sm">Switch categories or add data to start generating ID cards.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {people.map((person) => (
            <Card key={person.id} className="overflow-hidden border-border/60 shadow-sm">
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold">{person.name}</p>
                    <p className="text-sm text-muted-foreground">{getPersonSummary(person)}</p>
                  </div>
                  <div className="inline-flex items-center rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {getRoleLabel(person.role)}
                  </div>
                </div>

                <div
                  className="overflow-x-auto pb-2"
                  data-preview-owner={person.id}
                  ref={(el) => {
                    cardPreviewRefs.current[person.id] = el;
                  }}
                >
                  <IDCardDisplay p={person} compact />
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button variant="outline" onClick={() => setPreview(person)}>
                    Preview Layout
                  </Button>
                  <Button
                    className="gap-2"
                    disabled={downloadingId === person.id}
                    style={{ background: getTheme(person.role).header }}
                    onClick={() => handleDownload(person)}
                  >
                    <Download size={15} />
                    {downloadingId === person.id ? "Generating..." : "Download PDF"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        {preview ? (
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>ID Card Preview - {preview.name}</DialogTitle>
            </DialogHeader>

            <div className="flex justify-center overflow-x-auto py-2" ref={modalPreviewRef}>
              <IDCardDisplay p={preview} />
            </div>

            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Review the layout, details, and verification panel before exporting the final
                printable card.
              </p>
              <Button
                className="gap-2"
                disabled={downloadingId === preview.id}
                style={{ background: getTheme(preview.role).header }}
                onClick={() => handleDownload(preview)}
              >
                <Download size={15} />
                {downloadingId === preview.id ? "Generating..." : "Download PDF"}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

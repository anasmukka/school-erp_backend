import { useAuth } from "@/contexts/AuthContext";
import SchoolCalendar from "@/components/calendar/SchoolCalendar";

export default function SchoolCalendarPage() {
  const { appUser } = useAuth();

  const portalTitle = (() => {
    switch (appUser?.role) {
      case "admin":
        return "Events & School Calendar";
      case "hod":
        return "Department & School Calendar";
      case "teacher":
        return "Academic & School Calendar";
      case "student":
        return "Student School Calendar";
      default:
        return "School Calendar";
    }
  })();

  const isReadOnly = appUser?.role !== "admin";

  return (
    <div className="space-y-6">
      <SchoolCalendar
        titleOverride={portalTitle}
        readOnly={isReadOnly}
        initialView="month"
      />
    </div>
  );
}

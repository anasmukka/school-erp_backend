import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Teachers from "@/pages/admin/Teachers";
import Students from "@/pages/admin/Students";
import Subjects from "@/pages/admin/Subjects";
import CreateHod from "@/pages/admin/CreateHod";
import AccountsStaff from "@/pages/admin/AccountsStaff";
import PendingStudents from "@/pages/hod/PendingStudents";
import ClassManagement from "@/pages/hod/ClassManagement";
import HodTimetable from "@/pages/hod/Timetable";
import HodNotices from "@/pages/hod/Notices";
import IDCards from "@/pages/IDCards";
import FeesManagement from "@/pages/accounts/FeesManagement";
import Collections from "@/pages/accounts/Collections";
import Setup from "@/pages/Setup";
import AttendanceRegister from "@/pages/teacher/AttendanceRegister";
import TeacherRfidAttendance from "@/pages/teacher/RfidAttendance";
import ManualAttendance from "@/pages/teacher/ManualAttendance";
import TeacherAssignmentsActivities from "@/pages/teacher/AssignmentsActivities";
import StudentFees from "@/pages/student/Fees";
import StudentAssignmentsActivities from "@/pages/student/AssignmentsActivities";
import StudentAttendanceOverview from "@/pages/student/AttendanceOverview";
import StudentNotices from "@/pages/student/Notices";
import StudentExams from "@/pages/student/Exams";
import Admissions from "@/pages/admin/Admissions";
import RfidCards from "@/pages/admin/RfidCards";
import StudentPromotion from "@/pages/admin/Promotion";
import AcademicSessions from "@/pages/admin/AcademicSessions";
import ExamApprovals from "@/pages/admin/ExamApprovals";
import AdminNotices from "@/pages/admin/Notices";
import HodExamScheduling from "@/pages/hod/ExamScheduling";
import AcademicStructurePlanner from "@/pages/admin/AcademicStructurePlanner";
import ResultVerification from "@/pages/admin/ResultVerification";
import TeacherMarksEntry from "@/pages/teacher/MarksEntry";
import StudentReportCard from "@/pages/student/ReportCard";
import PrintingDashboard from "@/pages/printing/PrintingDashboard";
import PrintingOrders from "@/pages/printing/PrintingOrders";
import LibraryManagement from "@/pages/library/LibraryManagement";
import InventoryManagement from "@/pages/inventory/InventoryManagement";
import ReportsHub from "@/pages/reports/ReportsHub";
import OperationsStaff from "@/pages/admin/OperationsStaff";
import SchoolCalendarPage from "@/pages/calendar/SchoolCalendarPage";
import HallTickets from "@/pages/admin/HallTickets";
import AccountsBypasses from "@/pages/accounts/AccountsBypasses";
import StudentHallTickets from "@/pages/student/StudentHallTickets";
import { AcademicSessionProvider } from "@/contexts/AcademicSessionContext";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, roles }: { component: React.ComponentType; roles?: string[] }) {
  const { appUser, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  if (!appUser) return <Redirect to="/login" />;
  if (roles && !roles.includes(appUser.role)) return <Redirect to="/" />;
  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const { appUser, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  if (appUser) return <Redirect to="/" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={() => <PublicRoute component={Login} />} />
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/admin/teachers" component={() => <ProtectedRoute component={Teachers} roles={["admin"]} />} />
      <Route path="/admin/students" component={() => <ProtectedRoute component={Students} roles={["admin"]} />} />
      <Route path="/admin/subjects" component={() => <ProtectedRoute component={Subjects} roles={["admin"]} />} />
      <Route path="/admin/hods" component={() => <ProtectedRoute component={CreateHod} roles={["admin"]} />} />
      <Route path="/admin/accounts" component={() => <ProtectedRoute component={AccountsStaff} roles={["admin"]} />} />
      <Route path="/admin/admissions" component={() => <ProtectedRoute component={Admissions} roles={["admin"]} />} />
      <Route path="/admin/rfid-cards" component={() => <ProtectedRoute component={RfidCards} roles={["admin"]} />} />
      <Route path="/admin/sessions" component={() => <ProtectedRoute component={AcademicSessions} roles={["admin"]} />} />
      <Route path="/admin/promotion" component={() => <ProtectedRoute component={StudentPromotion} roles={["admin"]} />} />
      <Route path="/admin/academic-structure" component={() => <ProtectedRoute component={AcademicStructurePlanner} roles={["admin"]} />} />
      <Route path="/admin/results" component={() => <ProtectedRoute component={ResultVerification} roles={["admin", "hod"]} />} />
      <Route path="/admin/exam-approvals" component={() => <ProtectedRoute component={ExamApprovals} roles={["admin"]} />} />
      <Route path="/admin/notices" component={() => <ProtectedRoute component={AdminNotices} roles={["admin"]} />} />
      <Route path="/admin/classes" component={() => <ProtectedRoute component={ClassManagement} roles={["admin"]} />} />
      <Route path="/admin/operations" component={() => <ProtectedRoute component={OperationsStaff} roles={["admin"]} />} />
      <Route path="/admin/reports" component={() => <ProtectedRoute component={ReportsHub} roles={["admin"]} />} />
      <Route path="/admin/calendar" component={() => <ProtectedRoute component={SchoolCalendarPage} roles={["admin"]} />} />
      <Route path="/admin/hall-tickets" component={() => <ProtectedRoute component={HallTickets} roles={["admin"]} />} />
      <Route path="/printing" component={() => <ProtectedRoute component={PrintingDashboard} roles={["printing", "operations", "admin"]} />} />
      <Route path="/printing/orders" component={() => <ProtectedRoute component={PrintingOrders} roles={["teacher", "hod", "admin"]} />} />
      <Route path="/library" component={() => <ProtectedRoute component={LibraryManagement} roles={["operations", "admin", "teacher", "hod"]} />} />
      <Route path="/inventory" component={() => <ProtectedRoute component={InventoryManagement} roles={["operations", "admin"]} />} />
      <Route path="/accounts/fees" component={() => <ProtectedRoute component={FeesManagement} roles={["accountant"]} />} />
      <Route path="/accounts/collections" component={() => <ProtectedRoute component={Collections} roles={["accountant"]} />} />
      <Route path="/accounts/bypasses" component={() => <ProtectedRoute component={AccountsBypasses} roles={["accountant", "admin"]} />} />
      <Route path="/hod/pending" component={() => <ProtectedRoute component={PendingStudents} roles={["hod"]} />} />
      <Route path="/hod/classes" component={() => <ProtectedRoute component={ClassManagement} roles={["admin", "hod"]} />} />
      <Route path="/hod/timetable" component={() => <ProtectedRoute component={HodTimetable} roles={["hod"]} />} />
      <Route path="/hod/exam-scheduling" component={() => <ProtectedRoute component={HodExamScheduling} roles={["hod"]} />} />
      <Route path="/hod/notices" component={() => <ProtectedRoute component={HodNotices} roles={["hod"]} />} />
      <Route path="/hod/calendar" component={() => <ProtectedRoute component={SchoolCalendarPage} roles={["hod"]} />} />
      <Route path="/teacher/rfid-attendance" component={() => <ProtectedRoute component={TeacherRfidAttendance} roles={["teacher"]} />} />
      <Route path="/teacher/manual-attendance" component={() => <ProtectedRoute component={ManualAttendance} roles={["teacher"]} />} />
      <Route path="/teacher/attendance-register" component={() => <ProtectedRoute component={AttendanceRegister} roles={["teacher"]} />} />
      <Route path="/teacher/assignments" component={() => <ProtectedRoute component={TeacherAssignmentsActivities} roles={["teacher"]} />} />
      <Route path="/teacher/marks" component={() => <ProtectedRoute component={TeacherMarksEntry} roles={["teacher", "admin", "hod"]} />} />
      <Route path="/teacher/calendar" component={() => <ProtectedRoute component={SchoolCalendarPage} roles={["teacher"]} />} />
      <Route path="/student/exams" component={() => <ProtectedRoute component={StudentExams} roles={["student"]} />} />
      <Route path="/student/fees" component={() => <ProtectedRoute component={StudentFees} roles={["student"]} />} />
      <Route path="/student/assignments" component={() => <ProtectedRoute component={StudentAssignmentsActivities} roles={["student"]} />} />
      <Route path="/student/attendance-overview" component={() => <ProtectedRoute component={StudentAttendanceOverview} roles={["student"]} />} />
      <Route path="/student/notices" component={() => <ProtectedRoute component={StudentNotices} roles={["student"]} />} />
      <Route path="/student/report-card" component={() => <ProtectedRoute component={StudentReportCard} roles={["student"]} />} />
      <Route path="/student/calendar" component={() => <ProtectedRoute component={SchoolCalendarPage} roles={["student"]} />} />
      <Route path="/student/hall-tickets" component={() => <ProtectedRoute component={StudentHallTickets} roles={["student"]} />} />
      <Route path="/calendar" component={() => <ProtectedRoute component={SchoolCalendarPage} />} />
      <Route path="/id-cards" component={() => <ProtectedRoute component={IDCards} roles={["admin", "hod"]} />} />
      <Route path="/setup" component={Setup} />
      <Route component={() => <Redirect to="/" />} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AcademicSessionProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </AcademicSessionProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

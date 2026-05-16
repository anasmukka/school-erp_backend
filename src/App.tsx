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
import ExamScheduling from "@/pages/hod/ExamScheduling";
import QuestionPaperApproval from "@/pages/hod/QuestionPaperApproval";
import HodReportCardApproval from "@/pages/hod/ReportCardApproval";
import IDCards from "@/pages/IDCards";
import FeesManagement from "@/pages/accounts/FeesManagement";
import Setup from "@/pages/Setup";
import MarksEntry from "@/pages/teacher/MarksEntry";
import TeacherReportCards from "@/pages/teacher/ReportCards";
import CoScholastic from "@/pages/teacher/CoScholastic";
import QuestionPaper from "@/pages/teacher/QuestionPaper";
import AttendanceRegister from "@/pages/teacher/AttendanceRegister";
import TeacherRfidAttendance from "@/pages/teacher/RfidAttendance";
import ManualAttendance from "@/pages/teacher/ManualAttendance";
import StudentFees from "@/pages/student/Fees";
import StudentReportCard from "@/pages/student/ReportCard";
import Collections from "@/pages/accounts/Collections";
import Admissions from "@/pages/admin/Admissions";
import AdminReportCardApproval from "@/pages/admin/ReportCardApproval";
import SignatureManagement from "@/pages/admin/SignatureManagement";
import RfidCards from "@/pages/admin/RfidCards";

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
      <Route path="/admin/signatures" component={() => <ProtectedRoute component={SignatureManagement} roles={["admin"]} />} />
      <Route path="/admin/report-cards" component={() => <ProtectedRoute component={AdminReportCardApproval} roles={["admin"]} />} />
      <Route path="/admin/rfid-cards" component={() => <ProtectedRoute component={RfidCards} roles={["admin"]} />} />
      <Route path="/accounts/fees" component={() => <ProtectedRoute component={FeesManagement} roles={["admin", "accountant"]} />} />
      <Route path="/accounts/collections" component={() => <ProtectedRoute component={Collections} roles={["admin", "accountant"]} />} />
      <Route path="/hod/pending" component={() => <ProtectedRoute component={PendingStudents} roles={["hod"]} />} />
      <Route path="/hod/classes" component={() => <ProtectedRoute component={ClassManagement} roles={["hod"]} />} />
      <Route path="/hod/timetable" component={() => <ProtectedRoute component={HodTimetable} roles={["hod"]} />} />
      <Route path="/hod/exams" component={() => <ProtectedRoute component={ExamScheduling} roles={["hod"]} />} />
      <Route path="/hod/question-papers" component={() => <ProtectedRoute component={QuestionPaperApproval} roles={["hod"]} />} />
      <Route path="/hod/report-cards" component={() => <ProtectedRoute component={HodReportCardApproval} roles={["hod"]} />} />
      <Route path="/teacher/marks" component={() => <ProtectedRoute component={MarksEntry} roles={["teacher"]} />} />
      <Route path="/teacher/report-cards" component={() => <ProtectedRoute component={TeacherReportCards} roles={["teacher"]} />} />
      <Route path="/teacher/co-scholastic" component={() => <ProtectedRoute component={CoScholastic} roles={["teacher"]} />} />
      <Route path="/teacher/rfid-attendance" component={() => <ProtectedRoute component={TeacherRfidAttendance} roles={["teacher"]} />} />
      <Route path="/teacher/manual-attendance" component={() => <ProtectedRoute component={ManualAttendance} roles={["teacher"]} />} />
      <Route path="/teacher/attendance-register" component={() => <ProtectedRoute component={AttendanceRegister} roles={["teacher"]} />} />
      <Route path="/teacher/question-papers" component={() => <ProtectedRoute component={QuestionPaper} roles={["teacher"]} />} />
      <Route path="/student/report-card" component={() => <ProtectedRoute component={StudentReportCard} roles={["student"]} />} />
      <Route path="/student/fees" component={() => <ProtectedRoute component={StudentFees} roles={["student"]} />} />
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
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

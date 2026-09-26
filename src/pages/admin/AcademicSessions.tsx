import { useEffect, useState, useMemo } from "react";
import {
  CalendarDays,
  Plus,
  CheckCircle2,
  Archive,
  Clock,
  Eye,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ShieldAlert,
  Users,
  School,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAcademicSession } from "@/contexts/AcademicSessionContext";
import {
  createAcademicSession,
  activateAcademicSession,
  archiveAcademicSession,
  getSessionSummary,
  type SessionSummary,
} from "@/lib/sessions";
import type { AcademicSession } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

export default function AcademicSessions() {
  const { toast } = useToast();
  const {
    sessions,
    activeSession,
    workingSession,
    setWorkingSessionId,
    refreshSessions,
    loading: contextLoading,
  } = useAcademicSession();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [activatingSession, setActivatingSession] = useState<AcademicSession | null>(null);
  const [archivingSession, setArchivingSession] = useState<AcademicSession | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [loadingSummaries, setLoadingSummaries] = useState(false);

  // Form state for creating a new session
  const [sessionName, setSessionName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [createAsActive, setCreateAsActive] = useState(false);
  const [formError, setFormError] = useState("");

  // Load enrollment summaries for all sessions
  useEffect(() => {
    if (sessions.length === 0) return;
    let isMounted = true;
    setLoadingSummaries(true);

    Promise.all(
      sessions.map(async (s) => {
        const summary = await getSessionSummary(s.id, s.name);
        return { sessionId: s.id, sessionName: s.name, summary };
      }),
    )
      .then((results) => {
        if (!isMounted) return;
        const map: Record<string, SessionSummary> = {};
        for (const res of results) {
          map[res.sessionId] = res.summary;
          if (res.sessionName) {
            map[res.sessionName] = res.summary;
          }
        }
        setSummaries(map);
      })
      .catch((err) => console.error("Error loading session summaries:", err))
      .finally(() => {
        if (isMounted) setLoadingSummaries(false);
      });

    return () => {
      isMounted = false;
    };
  }, [sessions]);

  const handleOpenCreate = () => {
    // Suggest default next session name
    const currentName = activeSession?.name ?? "";
    const match = currentName.match(/^(\d{4})-(\d{2,4})$/);
    let defaultName = "";
    let defaultStart = "";
    let defaultEnd = "";

    if (match) {
      const startYear = parseInt(match[1], 10);
      const nextStart = startYear + 1;
      const nextEnd = (startYear + 2).toString().slice(-2);
      defaultName = `${nextStart}-${nextEnd}`;
      defaultStart = `${nextStart}-06-01`;
      defaultEnd = `${nextStart + 1}-03-31`;
    } else {
      const nowYear = new Date().getFullYear();
      defaultName = `${nowYear}-${(nowYear + 1).toString().slice(-2)}`;
      defaultStart = `${nowYear}-06-01`;
      defaultEnd = `${nowYear + 1}-03-31`;
    }

    setSessionName(defaultName);
    setStartDate(defaultStart);
    setEndDate(defaultEnd);
    setCreateAsActive(false);
    setFormError("");
    setDialogOpen(true);
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    const trimmedName = sessionName.trim();
    if (!trimmedName) {
      setFormError("Session name is required (e.g. 2027-28).");
      return;
    }
    if (!startDate || !endDate) {
      setFormError("Both start and end dates are required.");
      return;
    }
    if (new Date(startDate) >= new Date(endDate)) {
      setFormError("End date must be after start date.");
      return;
    }

    setActionLoading(true);
    try {
      await createAcademicSession({
        name: trimmedName,
        startDate,
        endDate,
        activateImmediately: createAsActive,
      });

      toast({
        title: "Session created",
        description: `Academic session "${trimmedName}" has been created successfully.`,
      });

      setDialogOpen(false);
      await refreshSessions();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to create academic session.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmActivate = async () => {
    if (!activatingSession) return;
    setActionLoading(true);
    try {
      await activateAcademicSession(activatingSession.id);
      toast({
        title: "Session activated",
        description: `Session "${activatingSession.name}" is now the active academic session.`,
      });
      setActivatingSession(null);
      await refreshSessions();
    } catch (err: unknown) {
      toast({
        title: "Activation failed",
        description: err instanceof Error ? err.message : "Failed to activate session.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archivingSession) return;
    setActionLoading(true);
    try {
      await archiveAcademicSession(archivingSession.id);
      toast({
        title: "Session archived",
        description: `Session "${archivingSession.name}" has been marked as archived.`,
      });
      setArchivingSession(null);
      await refreshSessions();
    } catch (err: unknown) {
      toast({
        title: "Archiving failed",
        description: err instanceof Error ? err.message : "Failed to archive session.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Academic Sessions</h1>
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
              {sessions.length} Session{sessions.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Manage school academic sessions, set active school years, and switch working context for viewing historical records.
          </p>
        </div>

        <Button onClick={handleOpenCreate} className="gap-2 shadow-sm">
          <Plus size={16} />
          <span>New Academic Session</span>
        </Button>
      </div>

      {/* Active Session & Working Session Banner */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-teal-50/40 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                System Active Session
              </span>
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-200" />
            </div>
            <CardTitle className="text-xl font-bold text-emerald-950">
              {activeSession ? activeSession.name : "No active session"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-emerald-900/80">
            {activeSession ? (
              <div className="space-y-1">
                <p>
                  <span className="font-semibold">Period:</span>{" "}
                  {new Date(activeSession.startDate).toLocaleDateString("en-IN", {
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  –{" "}
                  {new Date(activeSession.endDate).toLocaleDateString("en-IN", {
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                <p className="text-emerald-700">
                  All new admissions and everyday workflows automatically operate under this session.
                </p>
              </div>
            ) : (
              <p>Please activate an academic session below.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/70 to-sky-50/40 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-800">
                Current Working Context
              </span>
              <Badge
                variant="outline"
                className={
                  workingSession?.id === activeSession?.id
                    ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                    : "border-amber-300 bg-amber-100 text-amber-800"
                }
              >
                {workingSession?.id === activeSession?.id ? "Live Session" : "Historical / Custom Context"}
              </Badge>
            </div>
            <CardTitle className="text-xl font-bold text-indigo-950">
              {workingSession ? workingSession.name : "Not selected"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-indigo-900/80">
            <p>
              You are currently viewing student rosters, enrollments, and classes as they existed in session{" "}
              <span className="font-semibold text-indigo-950">{workingSession?.name}</span>.
            </p>
            {workingSession?.id !== activeSession?.id && activeSession && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setWorkingSessionId(activeSession.id)}
                className="h-auto p-0 mt-1 text-xs text-indigo-700 font-semibold underline"
              >
                Switch back to active session ({activeSession.name})
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sessions Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">All Academic Sessions</h2>

        {contextLoading ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-slate-200 bg-white/50">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <CalendarDays className="h-12 w-12 text-slate-400 mb-3" />
            <h3 className="text-base font-semibold text-slate-800">No Academic Sessions Yet</h3>
            <p className="text-sm text-slate-500 max-w-sm mt-1 mb-4">
              Get started by creating your first academic session (e.g. 2026-27).
            </p>
            <Button onClick={handleOpenCreate} className="gap-2">
              <Plus size={16} />
              Create First Session
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => {
              const isActive = session.isCurrent || session.status === "active";
              const isWorking = workingSession?.id === session.id;
              const summary = summaries[session.id] || summaries[session.name];

              return (
                <Card
                  key={session.id}
                  className={`relative flex flex-col transition-all duration-200 shadow-sm ${
                    isWorking
                      ? "ring-2 ring-primary border-primary/40 bg-white"
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-xl font-bold tracking-tight text-slate-900">
                            {session.name}
                          </CardTitle>
                        </div>
                        <CardDescription className="text-xs mt-1">
                          {new Date(session.startDate).toLocaleDateString("en-IN", {
                            month: "short",
                            year: "numeric",
                          })}{" "}
                          –{" "}
                          {new Date(session.endDate).toLocaleDateString("en-IN", {
                            month: "short",
                            year: "numeric",
                          })}
                        </CardDescription>
                      </div>

                      <div className="flex flex-col items-end gap-1.5">
                        {isActive ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 px-2.5 py-0.5 text-xs font-semibold shadow-xs">
                            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                            Active Session
                          </Badge>
                        ) : session.status === "archived" ? (
                          <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-600 gap-1 text-xs">
                            <Archive size={12} />
                            Archived
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 gap-1 text-xs">
                            <Clock size={12} />
                            Planned
                          </Badge>
                        )}

                        {isWorking && (
                          <span className="text-[11px] font-semibold text-primary">
                            Viewing Now
                          </span>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 space-y-4 pt-0">
                    {/* Stats pills */}
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5 text-center text-xs">
                      <div className="flex flex-col items-center justify-center p-1">
                        <span className="text-slate-500 flex items-center gap-1 font-medium">
                          <Users size={13} /> Students
                        </span>
                        <span className="text-base font-bold text-slate-800 mt-0.5">
                          {loadingSummaries ? (
                            <Loader2 className="h-3 w-3 animate-spin inline" />
                          ) : (
                            summary?.studentCount ?? summary?.enrolledStudents ?? 0
                          )}
                        </span>
                      </div>
                      <div className="flex flex-col items-center justify-center p-1 border-l border-slate-200">
                        <span className="text-slate-500 flex items-center gap-1 font-medium">
                          <School size={13} /> Sections
                        </span>
                        <span className="text-base font-bold text-slate-800 mt-0.5">
                          {loadingSummaries ? (
                            <Loader2 className="h-3 w-3 animate-spin inline" />
                          ) : (
                            summary?.sectionCount ?? summary?.sectionsCount ?? 0
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      {/* Set as working session */}
                      {!isWorking ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-center gap-1.5 text-xs font-medium"
                          onClick={() => setWorkingSessionId(session.id)}
                        >
                          <Eye size={14} />
                          <span>View in this Context</span>
                        </Button>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5 rounded-md bg-primary/10 py-1.5 text-xs font-semibold text-primary">
                          <CheckCircle2 size={14} />
                          <span>Active Working Context</span>
                        </div>
                      )}

                      {/* Primary state transition buttons */}
                      <div className="flex gap-2">
                        {!isActive && (
                          <Button
                            variant="default"
                            size="sm"
                            className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => setActivatingSession(session)}
                          >
                            Activate Session
                          </Button>
                        )}

                        {!isActive && session.status !== "archived" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-slate-600 hover:text-slate-900"
                            onClick={() => setArchivingSession(session)}
                          >
                            Archive
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Session Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Create Academic Session</DialogTitle>
            <DialogDescription>
              Add an academic session period. Sessions represent independent academic years with separate student enrollments.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSession} className="space-y-4 py-2">
            {formError && (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="sessionName">Session Name *</Label>
              <Input
                id="sessionName"
                placeholder="e.g. 2027-28"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Standard convention is YYYY-YY (e.g. 2026-27, 2027-28).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="endDate">End Date *</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-900">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={14} className="text-amber-600" />
                Session Lifecycle Rule
              </div>
              <p className="mt-1 text-amber-800/90 leading-relaxed">
                New sessions are created as <strong>Planned</strong> by default. You can activate it once you are ready to transition school operations to this session.
              </p>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={actionLoading} className="gap-2">
                {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Session
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog: Activate Session */}
      <AlertDialog
        open={!!activatingSession}
        onOpenChange={(open) => !open && setActivatingSession(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-emerald-700">
              <ShieldAlert size={20} />
              <AlertDialogTitle>Activate Academic Session "{activatingSession?.name}"?</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-2 text-left pt-2">
              <p>
                Activating this session will set it as the <strong>primary active academic session</strong> for the school ERP.
              </p>
              <p className="text-xs text-slate-600 bg-slate-100 p-2.5 rounded-md border border-slate-200">
                • The previous active session ({activeSession?.name ?? "none"}) will automatically be marked as <strong>Archived</strong>.<br />
                • Exactly one academic session is active at a time.<br />
                • Historical enrollments and student records in previous sessions are preserved permanently.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmActivate}
              disabled={actionLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Confirm Activation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation Dialog: Archive Session */}
      <AlertDialog
        open={!!archivingSession}
        onOpenChange={(open) => !open && setArchivingSession(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-slate-800">
              <Archive size={20} />
              <AlertDialogTitle>Archive Session "{archivingSession?.name}"?</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-left pt-2">
              This session will be marked as archived. Historical records remain fully accessible for reporting, transcripts, and audits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmArchive}
              disabled={actionLoading}
              className="bg-slate-700 hover:bg-slate-800 text-white"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Archive Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

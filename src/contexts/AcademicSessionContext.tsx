import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import type { AcademicSession } from "@/lib/types";
import { getActiveAcademicSession, listAcademicSessions } from "@/lib/sessions";

export interface AcademicSessionContextType {
  activeSession: AcademicSession | null;
  selectedSession: AcademicSession | null;
  workingSession: AcademicSession | null;
  sessions: AcademicSession[];
  setSelectedSessionId: (id: string) => void;
  setWorkingSessionId: (id: string) => void;
  refreshSessions: () => Promise<void>;
  loading: boolean;
}

const AcademicSessionContext = createContext<AcademicSessionContextType | null>(null);

const STORAGE_KEY = "erp_working_academic_session";

export function AcademicSessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [activeSession, setActiveSession] = useState<AcademicSession | null>(null);
  const [selectedSessionId, setSelectedSessionIdState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || "";
  });
  const [loading, setLoading] = useState(true);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await listAcademicSessions();
      setSessions(list);

      const active = list.find((s) => s.isCurrent || s.status === "active") || list[0] || null;
      setActiveSession(active);

      const stored = localStorage.getItem(STORAGE_KEY);
      const isStoredValid = list.some((s) => s.id === stored || s.name === stored);
      if (stored && isStoredValid) {
        setSelectedSessionIdState(stored);
      } else if (active) {
        setSelectedSessionIdState(active.id);
        localStorage.setItem(STORAGE_KEY, active.id);
      }
    } catch (err) {
      console.error("Failed to load academic sessions in context:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const setWorkingSessionId = (id: string) => {
    setSelectedSessionIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  const setSelectedSessionId = setWorkingSessionId;

  const currentWorkingSession =
    sessions.find((s) => s.id === selectedSessionId || s.name === selectedSessionId) ||
    activeSession ||
    sessions[0] ||
    null;

  return (
    <AcademicSessionContext.Provider
      value={{
        activeSession,
        selectedSession: currentWorkingSession,
        workingSession: currentWorkingSession,
        sessions,
        setSelectedSessionId,
        setWorkingSessionId,
        refreshSessions,
        loading,
      }}
    >
      {children}
    </AcademicSessionContext.Provider>
  );
}

export function useAcademicSession(): AcademicSessionContextType {
  const ctx = useContext(AcademicSessionContext);
  if (!ctx) {
    throw new Error("useAcademicSession must be used within an AcademicSessionProvider");
  }
  return ctx;
}

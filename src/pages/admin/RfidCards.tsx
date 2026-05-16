import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, Loader2, Trash2, Wifi, AlertCircle } from "lucide-react";

const API = import.meta.env.VITE_BACKEND_URL || (typeof window !== "undefined" ? window.location.origin : "");

interface RfidCard {
  uid: string;
  studentId: string;
  studentName: string;
  sectionId: string;
  grade: string;
  assignedAt: string;
}

interface StudentOption {
  id: string;
  name: string;
  grade: string;
  sectionId: string;
}

const UID_PATTERN = /^[0-9a-f]+$/;

function normalizeUidInput(value: string) {
  return value.toLowerCase();
}

export default function RfidCards() {
  const { toast } = useToast();
  const [cards, setCards] = useState<RfidCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);

  // Assign form
  const [newUid, setNewUid] = useState("");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchJson = async <T,>(path: string, timeoutMs = 8000): Promise<T> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${API}${path}`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`.trim());
      }
      return await res.json();
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error(`Timed out contacting RFID backend at ${API}`);
      }
      throw new Error(error?.message || `Failed to reach RFID backend at ${API}`);
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const loadCards = async () => {
    setLoading(true);
    setBackendError(null);
    try {
      const result = await fetchJson<RfidCard[]>("/api/rfid-cards");
      setCards(result);
    } catch (err: any) {
      console.error("Failed to load RFID cards:", err);
      setCards([]);
      setBackendError(err?.message || `Unable to load RFID cards from ${API}`);
    } finally {
      setLoading(false);
    }
  };

  const loadStudents = async () => {
    try {
      const snap = await getDocs(collection(db, "students"));
      setStudents(
        snap.docs
          .map((d) => {
            const data = d.data();
            return { id: d.id, name: data.name || "", grade: data.grade || "", sectionId: data.sectionId || "" };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadCards();
    loadStudents();
  }, []);

  const assignCard = async () => {
    const normalizedUid = newUid.trim().toLowerCase();

    if (!normalizedUid || !selectedStudent) {
      toast({
        title: "Fill both fields",
        description: "Enter RFID UID and select a student.",
        variant: "destructive",
      });
      return;
    }
    if (!UID_PATTERN.test(normalizedUid)) {
      toast({
        title: "Invalid UID",
        description: "UID must contain lowercase hexadecimal characters only.",
        variant: "destructive",
      });
      return;
    }

    const student = students.find((s) => s.id === selectedStudent);
    if (!student) return;

    setAssigning(true);
    try {
      const res = await fetch(`${API}/api/rfid-cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: normalizedUid,
          studentId: student.id,
          studentName: student.name,
          sectionId: student.sectionId,
          grade: student.grade,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Card assigned", description: data.message });
        setNewUid("");
        setSelectedStudent("");
        setStudentSearch("");
        loadCards();
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAssigning(false);
    }
  };

  const removeCard = async (uid: string) => {
    setDeleting(uid);
    try {
      const res = await fetch(`${API}/api/rfid-cards/${encodeURIComponent(uid)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Card removed" });
        loadCards();
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  };

  const filteredStudents = studentSearch.trim()
    ? students
      .filter((s) => s.name.toLowerCase().includes(studentSearch.toLowerCase()))
      .slice(0, 8)
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-muted-foreground" size={32} />
      </div>
    );
  }

  return (
    <div data-testid="rfid-cards-page" className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Wifi size={18} className="text-muted-foreground" />
          <h1 className="text-2xl font-bold">RFID Cards</h1>
        </div>
        <p className="text-sm text-muted-foreground">Assign RFID cards to students.</p>
      </div>

      {backendError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Backend error</p>
            <p className="text-xs text-red-700/80 mt-0.5">{backendError}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card-strong hover-elevate rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="stat-card-icon bg-blue-100">
              <Wifi size={22} className="text-blue-600 relative z-10" />
            </div>
            <div>
              <p className="text-2xl font-bold">{cards.length}</p>
              <p className="text-sm text-muted-foreground">Assigned Cards</p>
            </div>
          </div>
        </div>
        <div className="glass-card-strong hover-elevate rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="stat-card-icon bg-slate-100">
              <CreditCard size={22} className="text-slate-600 relative z-10" />
            </div>
            <div>
              <p className="text-2xl font-bold">{students.length}</p>
              <p className="text-sm text-muted-foreground">Total Students</p>
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="pt-5">
          <p className="font-semibold mb-3">Assign RFID Card</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">RFID UID</Label>
              <Input
                data-testid="rfid-uid-input"
                className="mt-1 h-9"
                placeholder="e.g. 3a363a16"
                value={newUid}
                onChange={(e) => setNewUid(normalizeUidInput(e.target.value))}
              />
            </div>

            <div className="relative">
              <Label className="text-xs">Student</Label>
              <Input
                data-testid="student-search-input"
                className="mt-1 h-9"
                placeholder="Search student name..."
                value={studentSearch}
                onChange={(e) => {
                  setStudentSearch(e.target.value);
                  setSelectedStudent("");
                }}
              />

              {filteredStudents.length > 0 && !selectedStudent && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-border rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                  {filteredStudents.map((student) => (
                    <button
                      key={student.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                      onClick={() => {
                        setSelectedStudent(student.id);
                        setStudentSearch(student.name);
                      }}
                    >
                      <span className="font-medium">{student.name}</span>
                      <span className="text-muted-foreground ml-2">Grade {student.grade}</span>
                    </button>
                  ))}
                </div>
              )}

              {selectedStudent && (
                <p className="text-[11px] text-green-600 mt-0.5">
                  Selected: {students.find((student) => student.id === selectedStudent)?.name}
                </p>
              )}
            </div>

            <div className="flex items-end">
              <Button
                data-testid="assign-card-btn"
                onClick={assignCard}
                disabled={assigning}
                className="w-full h-9 gap-1.5"
              >
                {assigning ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                Assign Card
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold">Assigned Cards ({cards.length})</p>
          <Button size="sm" variant="outline" onClick={loadCards} className="text-xs h-7">
            Refresh
          </Button>
        </div>

        {cards.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              No RFID cards assigned yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {cards.map((card) => (
              <div
                key={card.uid}
                className="glass-card rounded-xl px-4 py-3 flex items-center justify-between"
                data-testid={`rfid-card-${card.uid}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center font-mono text-xs font-bold text-slate-600">
                    {card.uid.slice(0, 4)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{card.studentName || card.studentId}</p>
                    <p className="text-xs text-muted-foreground">UID: {card.uid} · Grade {card.grade}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500 hover:bg-red-50 h-7 px-2"
                  onClick={() => removeCard(card.uid)}
                  disabled={deleting === card.uid}
                >
                  {deleting === card.uid ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { User } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { User as UserIcon } from "lucide-react";

export default function CreateHod() {
  const [hods, setHods] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, "users"), where("role", "==", "hod")));
        setHods(snap.docs.map((d) => ({ id: d.id, ...d.data() } as User)));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading section heads...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Section Heads (HOD)</h1>
        <p className="text-muted-foreground text-sm">
          View section heads and their assigned grades. Add HOD accounts from the Admissions page.
        </p>
      </div>

      {hods.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No section heads found.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {hods.map((h) => (
            <Card key={h.id}>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3 mb-3">
                  {h.photo ? (
                    <img src={h.photo} alt={h.name} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center">
                      <UserIcon size={18} className="text-violet-500" />
                    </div>
                  )}
                  <div>
                    <p className="font-semibold">{h.name}</p>
                    <p className="text-xs text-muted-foreground">{h.email}</p>
                  </div>
                </div>

                <div className="space-y-1.5 text-sm">
                  {h.subject && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subject</span>
                      <span className="font-medium">{h.subject}</span>
                    </div>
                  )}
                  {h.DOB && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">DOB</span>
                      <span>{h.DOB}</span>
                    </div>
                  )}
                  {h.assignedGrades && h.assignedGrades.length > 0 && (
                    <div className="pt-1">
                      <p className="text-muted-foreground text-xs mb-1.5">Grades</p>
                      <div className="flex flex-wrap gap-1">
                        {(h.assignedGrades as string[]).map((g) => (
                          <span key={g} className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs font-medium">
                            G{g}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}


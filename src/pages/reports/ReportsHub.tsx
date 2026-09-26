import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AuditLogRecord } from "@/lib/types";
import { getPrintMetrics } from "@/lib/printing";
import { getLibraryStats } from "@/lib/library";
import { getInventoryStats } from "@/lib/inventory";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart3,
  Printer,
  BookOpen,
  Package,
  ShieldCheck,
  Search,
  RotateCcw,
  Clock,
  CheckCircle2,
  DollarSign,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";

export default function ReportsHub() {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  const [printStats, setPrintStats] = useState<any>({
    pending: 0,
    inProgress: 0,
    completed: 0,
    highPriority: 0,
    total: 0,
    totalPagesPrinted: 0,
  });

  const [libraryStats, setLibraryStats] = useState<any>({
    totalTitles: 0,
    totalCopies: 0,
    availableCopies: 0,
    issuedCopies: 0,
    overdueCount: 0,
    totalFinesCollected: 0,
    totalFinesPending: 0,
  });

  const [inventoryStats, setInventoryStats] = useState<any>({
    totalInventoryItems: 0,
    lowStockItemsCount: 0,
    totalUniformItems: 0,
    totalTextbookItems: 0,
    activeDistributionsCount: 0,
  });

  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditEntityFilter, setAuditEntityFilter] = useState("all");

  const loadReports = async () => {
    try {
      setLoading(true);
      const [pStats, lStats, iStats, logsSnap] = await Promise.all([
        getPrintMetrics(),
        getLibraryStats(),
        getInventoryStats(),
        getDocs(query(collection(db, "auditLogs"), orderBy("timestamp", "desc"), limit(200))),
      ]);

      setPrintStats(pStats);
      setLibraryStats(lStats);
      setInventoryStats(iStats);
      setAuditLogs(logsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditLogRecord)));
    } catch (err: any) {
      toast.error(err.message || "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, []);

  const filteredLogs = auditLogs.filter((log) => {
    const matchesSearch =
      log.details.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.userName.toLowerCase().includes(auditSearch.toLowerCase());
    const matchesEntity = auditEntityFilter === "all" || log.entity === auditEntityFilter;
    return matchesSearch && matchesEntity;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Institutional Reports & Audit Ledger</h1>
              <p className="text-sm text-muted-foreground">
                Consolidated administrative intelligence across Printing, Library, Inventory, and Central Audit Trail.
              </p>
            </div>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={loadReports} disabled={loading} className="rounded-xl">
          <RotateCcw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/40 p-1 rounded-xl">
          <TabsTrigger value="overview" className="rounded-lg text-xs">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Consolidated Overview
          </TabsTrigger>
          <TabsTrigger value="audits" className="rounded-lg text-xs">
            <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Central Audit Trail ({auditLogs.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Overview */}
        <TabsContent value="overview" className="space-y-6">
          {/* Section 1: Printing Intelligence */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Printer className="h-4 w-4 text-primary" /> Printing Department Summary
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Total Print Orders</span>
                <span className="text-2xl font-bold">{printStats.total}</span>
              </Card>
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Pages Produced</span>
                <span className="text-2xl font-bold text-primary">{printStats.totalPagesPrinted.toLocaleString()}</span>
              </Card>
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Completed</span>
                <span className="text-2xl font-bold text-emerald-600">{printStats.completed}</span>
              </Card>
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Pending / In Progress</span>
                <span className="text-2xl font-bold text-amber-600">
                  {printStats.pending + printStats.inProgress}
                </span>
              </Card>
            </div>
          </div>

          {/* Section 2: Library Intelligence */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" /> Library Circulation & Collection Summary
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Physical Copies in Stock</span>
                <span className="text-2xl font-bold">{libraryStats.totalCopies}</span>
                <span className="text-[11px] text-muted-foreground block">{libraryStats.totalTitles} unique titles</span>
              </Card>
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Currently Issued</span>
                <span className="text-2xl font-bold text-indigo-600">{libraryStats.issuedCopies}</span>
                <span className="text-[11px] text-muted-foreground block">{libraryStats.availableCopies} on shelf</span>
              </Card>
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Overdue Books</span>
                <span className="text-2xl font-bold text-rose-600">{libraryStats.overdueCount}</span>
              </Card>
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Total Fines Settled</span>
                <span className="text-2xl font-bold text-emerald-600">₹{libraryStats.totalFinesCollected}</span>
                <span className="text-[11px] text-muted-foreground block">₹{libraryStats.totalFinesPending} pending</span>
              </Card>
            </div>
          </div>

          {/* Section 3: Inventory & Distribution Intelligence */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" /> Inventory & Distributions Summary
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Stock Line Items</span>
                <span className="text-2xl font-bold">{inventoryStats.totalInventoryItems}</span>
              </Card>
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Low Stock Warnings</span>
                <span className="text-2xl font-bold text-rose-600">{inventoryStats.lowStockItemsCount}</span>
              </Card>
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Uniform Styles</span>
                <span className="text-2xl font-bold">{inventoryStats.totalUniformItems}</span>
              </Card>
              <Card className="rounded-2xl border border-border/70 p-4">
                <span className="text-xs text-muted-foreground block">Textbooks in Student Hands</span>
                <span className="text-2xl font-bold text-primary">{inventoryStats.activeDistributionsCount}</span>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Audit Logs */}
        <TabsContent value="audits" className="space-y-4">
          <Card className="rounded-2xl border border-border/70 shadow-sm">
            <CardContent className="p-4 flex flex-col sm:flex-row justify-between items-center gap-3">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search user, action details..."
                  className="pl-9 rounded-xl"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs font-medium text-muted-foreground">Entity:</span>
                <select
                  aria-label="Filter audit logs by entity"
                  className="text-xs h-9 rounded-xl border border-input bg-background px-3 py-1 font-medium"
                  value={auditEntityFilter}
                  onChange={(e) => setAuditEntityFilter(e.target.value)}
                >
                  <option value="all">All Entities</option>
                  <option value="printing">Printing</option>
                  <option value="library_book">Library Books</option>
                  <option value="library_copy">Library Copies</option>
                  <option value="library_loan">Circulation Loans</option>
                  <option value="inventory_item">Inventory Items</option>
                  <option value="stock_movement">Stock Movements</option>
                  <option value="uniform">Uniforms</option>
                  <option value="textbook">Textbooks</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="uppercase bg-muted/40 text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Entity</th>
                    <th className="px-4 py-3">Audit Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                        <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                        <p>No audit records matching criteria.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">{log.userName}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="uppercase text-[10px]">
                            {log.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono font-medium">{log.action.toUpperCase()}</td>
                        <td className="px-4 py-3 capitalize">{log.entity.replace("_", " ")}</td>
                        <td className="px-4 py-3 text-muted-foreground">{log.details}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

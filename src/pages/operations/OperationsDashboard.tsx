import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getPrintMetrics } from "@/lib/printing";
import { getLibraryStats } from "@/lib/library";
import { getInventoryStats } from "@/lib/inventory";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Printer,
  BookOpen,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Shirt,
  DollarSign,
  RotateCcw,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function OperationsDashboard() {
  const { appUser } = useAuth();
  const [loading, setLoading] = useState(true);

  const [printMetrics, setPrintMetrics] = useState({
    pending: 0,
    inProgress: 0,
    completed: 0,
    highPriority: 0,
    total: 0,
    totalPagesPrinted: 0,
  });

  const [libraryStats, setLibraryStats] = useState({
    totalTitles: 0,
    totalCopies: 0,
    availableCopies: 0,
    issuedCopies: 0,
    overdueCount: 0,
    totalFinesCollected: 0,
    totalFinesPending: 0,
  });

  const [inventoryStats, setInventoryStats] = useState({
    totalInventoryItems: 0,
    lowStockItemsCount: 0,
    totalUniformItems: 0,
    totalTextbookItems: 0,
    activeDistributionsCount: 0,
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [pData, lData, iData] = await Promise.all([
        getPrintMetrics(),
        getLibraryStats(),
        getInventoryStats(),
      ]);
      setPrintMetrics(pData);
      setLibraryStats(lData);
      setInventoryStats(iData);
    } catch (err: any) {
      toast.error(err.message || "Failed to load dashboard metrics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  return (
    <div className="space-y-8 pb-12">
      {/* Banner */}
      <div className="gradient-banner rounded-2xl px-8 py-8 text-white">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-blue-200/80">Operations & Resource Management Console</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Welcome, {appUser?.name}</h1>
            <p className="mt-1.5 text-sm text-slate-300/90">
              Manage printing requests, school library circulation, uniform sizes, and inventory stock.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="border-white/30 text-white hover:bg-white/10"
          >
            <RotateCcw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Primary Module Hub Navigation Cards */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          Operations Modules
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 1. Printing Card */}
          <Link href="/printing">
            <div className="glass-card-strong hover-elevate rounded-2xl p-6 cursor-pointer group border border-border/60">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 shrink-0 group-hover:scale-105 transition-transform">
                    <Printer size={24} />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg text-foreground">Printing Orders</h2>
                    <p className="text-xs text-muted-foreground">Exam papers, worksheets & circulars</p>
                  </div>
                </div>
                <ArrowUpRight size={18} className="text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
              </div>

              <div className="grid grid-cols-3 gap-2 bg-muted/20 p-3 rounded-xl border border-border/60 text-center">
                <div>
                  <span className="text-[10px] text-muted-foreground block">Pending</span>
                  <span className="font-bold text-base text-amber-600">{printMetrics.pending}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">In Progress</span>
                  <span className="font-bold text-base text-indigo-600">{printMetrics.inProgress}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Completed</span>
                  <span className="font-bold text-base text-emerald-600">{printMetrics.completed}</span>
                </div>
              </div>
            </div>
          </Link>

          {/* 2. Library Card */}
          <Link href="/library">
            <div className="glass-card-strong hover-elevate rounded-2xl p-6 cursor-pointer group border border-border/60">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0 group-hover:scale-105 transition-transform">
                    <BookOpen size={24} />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg text-foreground">Library Management</h2>
                    <p className="text-xs text-muted-foreground">Catalog, circulation & overdue fines</p>
                  </div>
                </div>
                <ArrowUpRight size={18} className="text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
              </div>

              <div className="grid grid-cols-3 gap-2 bg-muted/20 p-3 rounded-xl border border-border/60 text-center">
                <div>
                  <span className="text-[10px] text-muted-foreground block">Total Copies</span>
                  <span className="font-bold text-base">{libraryStats.totalCopies}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Issued</span>
                  <span className="font-bold text-base text-indigo-600">{libraryStats.issuedCopies}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Overdue</span>
                  <span className="font-bold text-base text-rose-600">{libraryStats.overdueCount}</span>
                </div>
              </div>
            </div>
          </Link>

          {/* 3. Inventory & Uniforms Card */}
          <Link href="/inventory">
            <div className="glass-card-strong hover-elevate rounded-2xl p-6 cursor-pointer group border border-border/60">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0 group-hover:scale-105 transition-transform">
                    <Package size={24} />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg text-foreground">Inventory & Uniforms</h2>
                    <p className="text-xs text-muted-foreground">Stationery, uniform sizes & textbooks</p>
                  </div>
                </div>
                <ArrowUpRight size={18} className="text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
              </div>

              <div className="grid grid-cols-3 gap-2 bg-muted/20 p-3 rounded-xl border border-border/60 text-center">
                <div>
                  <span className="text-[10px] text-muted-foreground block">Stock Items</span>
                  <span className="font-bold text-base">{inventoryStats.totalInventoryItems}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Low Stock</span>
                  <span className="font-bold text-base text-rose-600">{inventoryStats.lowStockItemsCount}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Uniform Styles</span>
                  <span className="font-bold text-base text-primary">{inventoryStats.totalUniformItems}</span>
                </div>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* Operational Highlights Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="rounded-2xl border border-border/70 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Clock size={20} />
            </div>
            <div>
              <p className="text-xl font-bold">{printMetrics.pending}</p>
              <p className="text-xs text-muted-foreground">Pending Print Jobs</p>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border border-border/70 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
              <AlertCircle size={20} />
            </div>
            <div>
              <p className="text-xl font-bold text-rose-600">{libraryStats.overdueCount}</p>
              <p className="text-xs text-muted-foreground">Overdue Book Loans</p>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border border-border/70 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Shirt size={20} />
            </div>
            <div>
              <p className="text-xl font-bold">{inventoryStats.totalUniformItems}</p>
              <p className="text-xs text-muted-foreground">Active Uniform Sizes</p>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border border-border/70 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <p className="text-xl font-bold">{inventoryStats.activeDistributionsCount}</p>
              <p className="text-xs text-muted-foreground">Textbooks Distributed</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

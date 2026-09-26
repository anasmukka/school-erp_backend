import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, getDocs, query, orderBy, limit, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  InventoryCategory,
  InventoryItem,
  InventoryMovement,
  StockMovementType,
  UniformItem,
  UniformIssue,
  TextbookItem,
  BookDistribution,
} from "@/lib/types";
import {
  createInventoryItem,
  recordStockMovement,
  getInventoryMovements,
  createUniformItem,
  restockUniformSizes,
  issueUniformToStudent,
  createTextbookItem,
  distributeTextbookToStudent,
  returnDistributedTextbook,
  getInventoryStats,
} from "@/lib/inventory";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Package,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  Search,
  RotateCcw,
  AlertCircle,
  Shirt,
  BookOpen,
  ClipboardList,
  CheckCircle2,
  Filter,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

export default function InventoryManagement() {
  const { appUser } = useAuth();
  const [activeTab, setActiveTab] = useState("stock");
  const [loading, setLoading] = useState(true);

  // Stats
  const [stats, setStats] = useState({
    totalInventoryItems: 0,
    lowStockItemsCount: 0,
    totalUniformItems: 0,
    totalTextbookItems: 0,
    activeDistributionsCount: 0,
  });

  // Data Collections
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [uniforms, setUniforms] = useState<UniformItem[]>([]);
  const [uniformIssues, setUniformIssues] = useState<UniformIssue[]>([]);
  const [textbooks, setTextbooks] = useState<TextbookItem[]>([]);
  const [distributions, setDistributions] = useState<BookDistribution[]>([]);

  // Search & Filters
  const [stockSearch, setStockSearch] = useState("");
  const [stockCategoryFilter, setStockCategoryFilter] = useState("all");
  const [movementTypeFilter, setMovementTypeFilter] = useState("all");

  // Modals
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [selectedItemForMovement, setSelectedItemForMovement] = useState<InventoryItem | null>(null);
  const [movementFormType, setMovementFormType] = useState<StockMovementType>("in");

  const [isAddUniformModalOpen, setIsAddUniformModalOpen] = useState(false);
  const [isIssueUniformModalOpen, setIsIssueUniformModalOpen] = useState(false);
  const [selectedUniformForIssue, setSelectedUniformForIssue] = useState<UniformItem | null>(null);

  const [isAddTextbookModalOpen, setIsAddTextbookModalOpen] = useState(false);
  const [isDistributeTextbookModalOpen, setIsDistributeTextbookModalOpen] = useState(false);
  const [selectedTextbookForDist, setSelectedTextbookForDist] = useState<TextbookItem | null>(null);

  // Forms
  const [itemForm, setItemForm] = useState({
    name: "",
    category: "stationery" as InventoryCategory,
    unit: "pcs",
    initialQuantity: 10,
    minStock: 5,
    unitCost: 0,
    location: "",
    supplierInfo: "",
  });

  const [movementForm, setMovementForm] = useState({
    quantity: 1,
    reason: "",
    reference: "",
    recipientName: "",
    recipientRole: "",
  });

  const [uniformForm, setUniformForm] = useState({
    name: "",
    gender: "unisex" as UniformItem["gender"],
    category: "regular" as UniformItem["category"],
    sizesInput: "28:20, 30:30, 32:25, 34:15",
    unitPrice: 450,
  });

  const [uniformIssueForm, setUniformIssueForm] = useState({
    studentId: "",
    studentName: "",
    grade: "",
    section: "",
    size: "",
    quantity: 1,
    academicSession: "2026-27",
  });

  const [textbookForm, setTextbookForm] = useState({
    title: "",
    grade: "10",
    subject: "Mathematics",
    publisher: "NCERT",
    academicSession: "2026-27",
    totalStock: 50,
  });

  const [distributeForm, setDistributeForm] = useState({
    studentId: "",
    studentName: "",
    grade: "",
    section: "",
    quantity: 1,
    academicYear: "2026-27",
    returnRequired: true,
  });

  // Student Search
  const [studentSearchTerm, setStudentSearchTerm] = useState("");
  const [studentSearchResults, setStudentSearchResults] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [statsData, itemsSnap, movsData, uniformsSnap, uniformIssuesSnap, tbSnap, distSnap] =
        await Promise.all([
          getInventoryStats(),
          getDocs(collection(db, "inventoryItems")),
          getInventoryMovements(),
          getDocs(collection(db, "uniformItems")),
          getDocs(query(collection(db, "uniformIssues"), orderBy("createdAt", "desc"), limit(100))),
          getDocs(collection(db, "textbookItems")),
          getDocs(query(collection(db, "bookDistributions"), orderBy("createdAt", "desc"), limit(100))),
        ]);

      setStats(statsData);
      setItems(itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryItem)));
      setMovements(movsData);
      setUniforms(uniformsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as UniformItem)));
      setUniformIssues(uniformIssuesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as UniformIssue)));
      setTextbooks(tbSnap.docs.map((d) => ({ id: d.id, ...d.data() } as TextbookItem)));
      setDistributions(distSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BookDistribution)));
    } catch (err: any) {
      toast.error(err.message || "Failed to load inventory.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  // Filtered Stock Items
  const filteredItems = items.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(stockSearch.toLowerCase());
    const matchesCat = stockCategoryFilter === "all" || item.category === stockCategoryFilter;
    return matchesSearch && matchesCat;
  });

  // Filtered Movements
  const filteredMovements = movements.filter((m) => {
    return movementTypeFilter === "all" || m.movementType === movementTypeFilter;
  });

  // Student Search Handler
  const handleSearchStudents = async (term: string) => {
    setStudentSearchTerm(term);
    if (!term.trim()) {
      setStudentSearchResults([]);
      return;
    }
    const snap = await getDocs(collection(db, "students"));
    const matches = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (s: any) =>
          (s.name && s.name.toLowerCase().includes(term.toLowerCase())) ||
          (s.admissionNo && s.admissionNo.toLowerCase().includes(term.toLowerCase()))
      )
      .slice(0, 6);
    setStudentSearchResults(matches);
  };

  // Add Item
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;
    if (!itemForm.name.trim()) {
      toast.error("Item name is required.");
      return;
    }
    try {
      setActionLoading(true);
      await createInventoryItem(itemForm, {
        userId: appUser.id,
        userName: appUser.name,
        role: appUser.role,
      });
      toast.success(`Inventory item "${itemForm.name}" created.`);
      setIsAddItemModalOpen(false);
      setItemForm({
        name: "",
        category: "stationery",
        unit: "pcs",
        initialQuantity: 10,
        minStock: 5,
        unitCost: 0,
        location: "",
        supplierInfo: "",
      });
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to create item.");
    } finally {
      setActionLoading(false);
    }
  };

  // Record Stock Movement
  const handleRecordMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser || !selectedItemForMovement) return;
    if (movementForm.quantity <= 0) {
      toast.error("Quantity must be greater than 0.");
      return;
    }
    try {
      setActionLoading(true);
      await recordStockMovement(
        {
          itemId: selectedItemForMovement.id,
          movementType: movementFormType,
          quantity: Number(movementForm.quantity),
          reason: movementForm.reason.trim() || `${movementFormType.toUpperCase()} of ${selectedItemForMovement.name}`,
          reference: movementForm.reference.trim() || undefined,
          recipientName: movementForm.recipientName.trim() || undefined,
          recipientRole: movementForm.recipientRole.trim() || undefined,
        },
        {
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
        }
      );
      toast.success(`Stock movement recorded.`);
      setIsMovementModalOpen(false);
      setSelectedItemForMovement(null);
      setMovementForm({
        quantity: 1,
        reason: "",
        reference: "",
        recipientName: "",
        recipientRole: "",
      });
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to record stock movement.");
    } finally {
      setActionLoading(false);
    }
  };

  // Add Uniform Item
  const handleAddUniform = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;
    if (!uniformForm.name.trim()) {
      toast.error("Uniform name is required.");
      return;
    }
    try {
      setActionLoading(true);
      // Parse sizesInput (e.g. "28:20, 30:30")
      const sizesMap: Record<string, number> = {};
      const pairs = uniformForm.sizesInput.split(",");
      for (const pair of pairs) {
        const [size, qty] = pair.split(":");
        if (size && qty) {
          sizesMap[size.trim()] = parseInt(qty.trim()) || 0;
        }
      }

      await createUniformItem(
        {
          name: uniformForm.name.trim(),
          gender: uniformForm.gender,
          category: uniformForm.category,
          sizes: sizesMap,
          unitPrice: uniformForm.unitPrice,
        },
        {
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
        }
      );
      toast.success(`Uniform item "${uniformForm.name}" created with size matrix.`);
      setIsAddUniformModalOpen(false);
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to create uniform.");
    } finally {
      setActionLoading(false);
    }
  };

  // Issue Uniform to Student
  const handleIssueUniform = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser || !selectedUniformForIssue) return;
    if (!uniformIssueForm.studentId || !uniformIssueForm.size) {
      toast.error("Please select a student and uniform size.");
      return;
    }
    try {
      setActionLoading(true);
      await issueUniformToStudent(
        {
          uniformItemId: selectedUniformForIssue.id,
          size: uniformIssueForm.size,
          quantity: Number(uniformIssueForm.quantity) || 1,
          studentId: uniformIssueForm.studentId,
          studentName: uniformIssueForm.studentName,
          grade: uniformIssueForm.grade,
          section: uniformIssueForm.section,
          academicSession: uniformIssueForm.academicSession,
        },
        {
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
        }
      );
      toast.success(`Issued ${uniformIssueForm.quantity}x Size ${uniformIssueForm.size} to ${uniformIssueForm.studentName}.`);
      setIsIssueUniformModalOpen(false);
      setSelectedUniformForIssue(null);
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to issue uniform.");
    } finally {
      setActionLoading(false);
    }
  };

  // Add Textbook Item
  const handleAddTextbook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;
    try {
      setActionLoading(true);
      await createTextbookItem(textbookForm, {
        userId: appUser.id,
        userName: appUser.name,
        role: appUser.role,
      });
      toast.success(`Textbook "${textbookForm.title}" registered.`);
      setIsAddTextbookModalOpen(false);
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to create textbook.");
    } finally {
      setActionLoading(false);
    }
  };

  // Distribute Textbook
  const handleDistributeTextbook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser || !selectedTextbookForDist) return;
    if (!distributeForm.studentId) {
      toast.error("Please select a student.");
      return;
    }
    try {
      setActionLoading(true);
      await distributeTextbookToStudent(
        {
          textbookId: selectedTextbookForDist.id,
          studentId: distributeForm.studentId,
          studentName: distributeForm.studentName,
          grade: distributeForm.grade,
          section: distributeForm.section,
          quantity: Number(distributeForm.quantity) || 1,
          academicYear: distributeForm.academicYear,
          returnRequired: distributeForm.returnRequired,
        },
        {
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
        }
      );
      toast.success(`Distributed "${selectedTextbookForDist.title}" to ${distributeForm.studentName}.`);
      setIsDistributeTextbookModalOpen(false);
      setSelectedTextbookForDist(null);
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to distribute textbook.");
    } finally {
      setActionLoading(false);
    }
  };

  // Return Textbook
  const handleReturnTextbook = async (distId: string, status: "returned" | "lost" | "damaged") => {
    if (!appUser) return;
    try {
      await returnDistributedTextbook(distId, status, undefined, {
        userId: appUser.id,
        userName: appUser.name,
        role: appUser.role,
      });
      toast.success(`Textbook return recorded as ${status.toUpperCase()}.`);
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to process return.");
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Inventory & Stock Management</h1>
              <p className="text-sm text-muted-foreground">
                Stationery, consumables, uniform size matrix, and curriculum textbook distributions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => setIsAddItemModalOpen(true)} className="rounded-xl">
            <Plus className="h-4 w-4 mr-1.5" /> Add Stock Item
          </Button>
          <Button variant="ghost" size="icon" onClick={() => loadAll()} disabled={loading}>
            <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 shrink-0">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalInventoryItems}</p>
              <p className="text-xs text-muted-foreground">Stock Items</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-700 shrink-0">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-rose-600">{stats.lowStockItemsCount}</p>
              <p className="text-xs text-muted-foreground">Low Stock Warnings</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
              <Shirt className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalUniformItems}</p>
              <p className="text-xs text-muted-foreground">Uniform Styles</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalTextbookItems}</p>
              <p className="text-xs text-muted-foreground">Curriculum Books</p>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2 sm:col-span-1 rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.activeDistributionsCount}</p>
              <p className="text-xs text-muted-foreground">Books Distributed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/40 p-1 rounded-xl">
          <TabsTrigger value="stock" className="rounded-lg text-xs">
            <Package className="h-3.5 w-3.5 mr-1.5" /> General Stock
          </TabsTrigger>
          <TabsTrigger value="ledger" className="rounded-lg text-xs">
            <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Movement Ledger ({movements.length})
          </TabsTrigger>
          <TabsTrigger value="uniforms" className="rounded-lg text-xs">
            <Shirt className="h-3.5 w-3.5 mr-1.5" /> Uniforms (Size Matrix)
          </TabsTrigger>
          <TabsTrigger value="textbooks" className="rounded-lg text-xs">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" /> Textbook Distribution
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: General Stock */}
        <TabsContent value="stock" className="space-y-4">
          <Card className="rounded-2xl border border-border/70 shadow-sm">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3 justify-between items-center">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search item name..."
                    className="pl-9 rounded-xl"
                    value={stockSearch}
                    onChange={(e) => setStockSearch(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs text-muted-foreground font-medium">Category:</span>
                  <select
                    aria-label="Filter stock by category"
                    className="text-xs h-9 rounded-xl border border-input bg-background px-3 py-1 font-medium"
                    value={stockCategoryFilter}
                    onChange={(e) => setStockCategoryFilter(e.target.value)}
                  >
                    <option value="all">All Categories</option>
                    <option value="stationery">Stationery</option>
                    <option value="paper">Paper & Printing</option>
                    <option value="consumables">Consumables</option>
                    <option value="sports">Sports</option>
                    <option value="lab">Lab Equipment</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/40 text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="px-4 py-3">Item Name</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">On-Hand Quantity</th>
                    <th className="px-4 py-3">Min Alert Level</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                        <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                        <p>No inventory items found.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const isLow = item.currentQuantity <= item.minStock;
                      return (
                        <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 font-semibold text-foreground">
                            {item.name}
                            {isLow && (
                              <Badge variant="destructive" className="ml-2 text-[10px] py-0">
                                Low Stock
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="capitalize text-xs">
                              {item.category}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-semibold text-sm">
                            <span className={isLow ? "text-rose-600 font-bold" : "text-emerald-600"}>
                              {item.currentQuantity} {item.unit}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {item.minStock} {item.unit}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono">{item.location || "-"}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs rounded-xl text-emerald-700 hover:bg-emerald-50 border-emerald-200"
                                onClick={() => {
                                  setSelectedItemForMovement(item);
                                  setMovementFormType("in");
                                  setIsMovementModalOpen(true);
                                }}
                              >
                                <ArrowDownRight className="h-3.5 w-3.5 mr-1" /> Stock In
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs rounded-xl text-rose-700 hover:bg-rose-50 border-rose-200"
                                onClick={() => {
                                  setSelectedItemForMovement(item);
                                  setMovementFormType("issue");
                                  setIsMovementModalOpen(true);
                                }}
                              >
                                <ArrowUpRight className="h-3.5 w-3.5 mr-1" /> Issue
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Tab 2: Stock Movements Audit Ledger */}
        <TabsContent value="ledger" className="space-y-4">
          <Card className="rounded-2xl border border-border/70 shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Showing latest 200 immutable stock transactions</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Type:</span>
                <select
                  aria-label="Filter movements by type"
                  className="text-xs h-9 rounded-xl border border-input bg-background px-3 py-1 font-medium"
                  value={movementTypeFilter}
                  onChange={(e) => setMovementTypeFilter(e.target.value)}
                >
                  <option value="all">All Movements</option>
                  <option value="in">Stock In / Purchase</option>
                  <option value="issue">Issue</option>
                  <option value="return">Return</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="damage">Damage / Loss</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/40 text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Item Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Delta Quantity</th>
                    <th className="px-4 py-3">New Balance</th>
                    <th className="px-4 py-3">Reason / Details</th>
                    <th className="px-4 py-3">Recipient</th>
                    <th className="px-4 py-3">Performed By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredMovements.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                        <ClipboardList className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                        <p>No stock movements recorded.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-muted/20 transition-colors text-xs">
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {new Date(m.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">{m.itemName}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="secondary"
                            className={`uppercase text-[10px] ${
                              ["in", "purchase", "return"].includes(m.movementType)
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {m.movementType}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-bold">
                          {["in", "purchase", "return"].includes(m.movementType) ? (
                            <span className="text-emerald-600">+{m.quantity}</span>
                          ) : (
                            <span className="text-rose-600">-{m.quantity}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono font-medium">{m.newQuantity}</td>
                        <td className="px-4 py-3 text-muted-foreground">{m.reason}</td>
                        <td className="px-4 py-3 font-medium">{m.recipientName || "-"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{m.performedByName}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Tab 3: Uniforms (Size Matrix) */}
        <TabsContent value="uniforms" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold">Uniforms Catalog & Size Matrix Stock</h3>
            <Button onClick={() => setIsAddUniformModalOpen(true)} className="rounded-xl" size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> Add Uniform Item
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {uniforms.map((u) => {
              const totalStock = Object.values(u.sizes || {}).reduce((acc, curr) => acc + curr, 0);
              return (
                <Card key={u.id} className="rounded-2xl border border-border/70 shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-base text-foreground">{u.name}</h4>
                      <p className="text-xs text-muted-foreground capitalize">
                        Gender: {u.gender} • Category: {u.category}
                      </p>
                    </div>
                    <Badge variant="secondary" className="bg-primary/10 text-primary font-bold">
                      {totalStock} in stock
                    </Badge>
                  </div>

                  {/* Size Matrix Grid */}
                  <div className="border border-border/60 rounded-xl p-2.5 bg-muted/20">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                      Available Stock by Size
                    </span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {Object.entries(u.sizes || {}).map(([size, qty]) => (
                        <div
                          key={size}
                          className={`text-center p-1.5 rounded-lg border text-xs ${
                            qty === 0
                              ? "bg-rose-50 border-rose-200 text-rose-700"
                              : "bg-card border-border/60 text-foreground"
                          }`}
                        >
                          <span className="block text-[10px] text-muted-foreground font-mono">Size {size}</span>
                          <span className="font-bold">{qty}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <span className="text-xs font-semibold text-primary">₹{u.unitPrice || 0}</span>
                    <Button
                      size="sm"
                      className="rounded-xl text-xs h-8"
                      onClick={() => {
                        setSelectedUniformForIssue(u);
                        setUniformIssueForm({
                          studentId: "",
                          studentName: "",
                          grade: "",
                          section: "",
                          size: Object.keys(u.sizes || {})[0] || "",
                          quantity: 1,
                          academicSession: "2026-27",
                        });
                        setStudentSearchTerm("");
                        setStudentSearchResults([]);
                        setIsIssueUniformModalOpen(true);
                      }}
                    >
                      Issue to Student
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Uniform Issue History */}
          <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden mt-6">
            <div className="p-4 border-b border-border/60 bg-muted/20">
              <h4 className="font-semibold text-sm">Recent Uniform Issuance Log</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="uppercase bg-muted/40 text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Student Name</th>
                    <th className="px-4 py-2.5">Grade / Section</th>
                    <th className="px-4 py-2.5">Uniform Item</th>
                    <th className="px-4 py-2.5">Size</th>
                    <th className="px-4 py-2.5">Qty</th>
                    <th className="px-4 py-2.5">Issued By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {uniformIssues.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No uniforms issued yet.
                      </td>
                    </tr>
                  ) : (
                    uniformIssues.map((issue) => (
                      <tr key={issue.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-muted-foreground">{issue.issueDate}</td>
                        <td className="px-4 py-2.5 font-semibold text-foreground">{issue.studentName}</td>
                        <td className="px-4 py-2.5">
                          Grade {issue.grade} {issue.section}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{issue.uniformName}</td>
                        <td className="px-4 py-2.5 font-mono font-bold text-primary">Size {issue.size}</td>
                        <td className="px-4 py-2.5 font-semibold">{issue.quantity}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{issue.issuedByName}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Tab 4: Textbook Distribution */}
        <TabsContent value="textbooks" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold">Curriculum Textbooks & Annual Distributions</h3>
            <Button onClick={() => setIsAddTextbookModalOpen(true)} className="rounded-xl" size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> Add Curriculum Textbook
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {textbooks.map((tb) => {
              const available = tb.totalStock - tb.distributedCount;
              return (
                <Card key={tb.id} className="rounded-2xl border border-border/70 shadow-sm p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-base text-foreground">{tb.title}</h4>
                      <p className="text-xs text-muted-foreground">
                        Grade {tb.grade} • {tb.subject} ({tb.publisher || "NCERT"})
                      </p>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs">
                      Session {tb.academicSession || "2026-27"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 bg-muted/20 p-2.5 rounded-xl border border-border/60 text-center">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Total Stock</span>
                      <span className="font-bold text-sm">{tb.totalStock}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Distributed</span>
                      <span className="font-bold text-sm text-indigo-600">{tb.distributedCount}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Available</span>
                      <span className="font-bold text-sm text-emerald-600">{available}</span>
                    </div>
                  </div>

                  <div className="pt-1 flex justify-end">
                    <Button
                      size="sm"
                      className="rounded-xl text-xs h-8"
                      disabled={available <= 0}
                      onClick={() => {
                        setSelectedTextbookForDist(tb);
                        setDistributeForm({
                          studentId: "",
                          studentName: "",
                          grade: tb.grade,
                          section: "",
                          quantity: 1,
                          academicYear: tb.academicSession || "2026-27",
                          returnRequired: true,
                        });
                        setStudentSearchTerm("");
                        setStudentSearchResults([]);
                        setIsDistributeTextbookModalOpen(true);
                      }}
                    >
                      Distribute to Student
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Distributions List */}
          <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden mt-6">
            <div className="p-4 border-b border-border/60 bg-muted/20">
              <h4 className="font-semibold text-sm">Textbook Distributions & Annual Return Status</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="uppercase bg-muted/40 text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Student Name</th>
                    <th className="px-4 py-2.5">Grade</th>
                    <th className="px-4 py-2.5">Book Title</th>
                    <th className="px-4 py-2.5">Academic Session</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {distributions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No textbook distributions recorded.
                      </td>
                    </tr>
                  ) : (
                    distributions.map((d) => (
                      <tr key={d.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-muted-foreground">{d.issueDate}</td>
                        <td className="px-4 py-2.5 font-semibold text-foreground">{d.studentName}</td>
                        <td className="px-4 py-2.5">
                          Grade {d.grade} {d.section}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{d.bookTitle}</td>
                        <td className="px-4 py-2.5 font-mono">{d.academicYear}</td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant={
                              d.returnStatus === "returned"
                                ? "secondary"
                                : d.returnStatus === "pending"
                                ? "outline"
                                : "destructive"
                            }
                            className={d.returnStatus === "returned" ? "bg-emerald-100 text-emerald-800" : ""}
                          >
                            {d.returnStatus.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {d.returnStatus === "pending" && (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[11px] px-2 rounded-lg text-emerald-700"
                                onClick={() => handleReturnTextbook(d.id, "returned")}
                              >
                                Return
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[11px] px-2 rounded-lg text-rose-700"
                                onClick={() => handleReturnTextbook(d.id, "lost")}
                              >
                                Lost
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal: Add Stock Item */}
      <Dialog open={isAddItemModalOpen} onOpenChange={setIsAddItemModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Add Stock Inventory Item
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddItem} className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Item Name *</Label>
              <Input
                placeholder="e.g. A4 Paper 75GSM"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Category</Label>
                <select
                  className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium"
                  value={itemForm.category}
                  onChange={(e) => setItemForm({ ...itemForm, category: e.target.value as InventoryCategory })}
                >
                  <option value="stationery">Stationery</option>
                  <option value="paper">Paper & Printing</option>
                  <option value="consumables">Consumables</option>
                  <option value="sports">Sports</option>
                  <option value="lab">Lab Equipment</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Unit of Measure</Label>
                <Input
                  placeholder="e.g. reams, pcs, boxes"
                  value={itemForm.unit}
                  onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Initial Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  value={itemForm.initialQuantity}
                  onChange={(e) => setItemForm({ ...itemForm, initialQuantity: parseInt(e.target.value) || 0 })}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Low Stock Alert Level</Label>
                <Input
                  type="number"
                  min="1"
                  value={itemForm.minStock}
                  onChange={(e) => setItemForm({ ...itemForm, minStock: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Location / Storeroom</Label>
              <Input
                placeholder="e.g. Cupboard 2, Shelf B"
                value={itemForm.location}
                onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddItemModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={actionLoading}>
                {actionLoading ? "Saving..." : "Create Item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Record Movement (Stock In / Issue) */}
      <Dialog open={isMovementModalOpen} onOpenChange={setIsMovementModalOpen}>
        <DialogContent className="max-w-md">
          {selectedItemForMovement && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {movementFormType === "in" ? (
                    <ArrowDownRight className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <ArrowUpRight className="h-5 w-5 text-rose-600" />
                  )}
                  {movementFormType === "in" ? "Stock In / Purchase" : "Issue Stock"}: {selectedItemForMovement.name}
                </DialogTitle>
              </DialogHeader>

              <form onSubmit={handleRecordMovement} className="space-y-3 py-2 text-xs">
                <div className="p-2.5 rounded-xl bg-muted/20 border border-border/60">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Current Stock:</span>
                    <span className="font-bold text-sm">
                      {selectedItemForMovement.currentQuantity} {selectedItemForMovement.unit}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Quantity ({selectedItemForMovement.unit}) *</Label>
                  <Input
                    type="number"
                    min="1"
                    max={movementFormType === "issue" ? selectedItemForMovement.currentQuantity : undefined}
                    value={movementForm.quantity}
                    onChange={(e) => setMovementForm({ ...movementForm, quantity: parseInt(e.target.value) || 1 })}
                    required
                  />
                </div>

                {movementFormType === "issue" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Recipient Name *</Label>
                      <Input
                        placeholder="e.g. Mr. Sharma"
                        value={movementForm.recipientName}
                        onChange={(e) => setMovementForm({ ...movementForm, recipientName: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold">Department / Class</Label>
                      <Input
                        placeholder="e.g. Science Lab"
                        value={movementForm.recipientRole}
                        onChange={(e) => setMovementForm({ ...movementForm, recipientRole: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Reason / Notes</Label>
                  <Input
                    placeholder="e.g. Term exam question paper batch, science lab supplies..."
                    value={movementForm.reason}
                    onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })}
                  />
                </div>

                <DialogFooter className="pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsMovementModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={actionLoading}>
                    {actionLoading ? "Processing..." : "Confirm Movement"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: Add Uniform Item */}
      <Dialog open={isAddUniformModalOpen} onOpenChange={setIsAddUniformModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shirt className="h-5 w-5 text-primary" />
              Add Uniform Item & Size Matrix
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddUniform} className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Uniform Name *</Label>
              <Input
                placeholder="e.g. Boys Formal White Shirt"
                value={uniformForm.name}
                onChange={(e) => setUniformForm({ ...uniformForm, name: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Gender</Label>
                <select
                  className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium"
                  value={uniformForm.gender}
                  onChange={(e) => setUniformForm({ ...uniformForm, gender: e.target.value as any })}
                >
                  <option value="boys">Boys</option>
                  <option value="girls">Girls</option>
                  <option value="unisex">Unisex</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Price (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={uniformForm.unitPrice}
                  onChange={(e) => setUniformForm({ ...uniformForm, unitPrice: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Size Matrix (Format: size:qty, size:qty) *</Label>
              <Input
                placeholder="28:20, 30:35, 32:25, 34:10"
                value={uniformForm.sizesInput}
                onChange={(e) => setUniformForm({ ...uniformForm, sizesInput: e.target.value })}
                required
              />
              <span className="text-[11px] text-muted-foreground block">
                Comma-separated sizes with initial quantities.
              </span>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddUniformModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={actionLoading}>
                {actionLoading ? "Saving..." : "Create Uniform"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Issue Uniform to Student */}
      <Dialog open={isIssueUniformModalOpen} onOpenChange={setIsIssueUniformModalOpen}>
        <DialogContent className="max-w-md">
          {selectedUniformForIssue && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Shirt className="h-5 w-5 text-primary" />
                  Issue Uniform: {selectedUniformForIssue.name}
                </DialogTitle>
              </DialogHeader>

              <form onSubmit={handleIssueUniform} className="space-y-3 py-2 text-xs">
                {/* Student Search */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Search Existing Student *</Label>
                  <Input
                    placeholder="Search by student name or admission no..."
                    value={studentSearchTerm}
                    onChange={(e) => handleSearchStudents(e.target.value)}
                  />

                  {studentSearchResults.length > 0 && !uniformIssueForm.studentId && (
                    <div className="divide-y divide-border/60 border border-border/60 rounded-lg max-h-32 overflow-y-auto bg-card mt-1">
                      {studentSearchResults.map((s) => (
                        <div
                          key={s.id}
                          className="p-1.5 hover:bg-muted/40 cursor-pointer flex justify-between items-center"
                          onClick={() => {
                            setUniformIssueForm({
                              ...uniformIssueForm,
                              studentId: s.id,
                              studentName: s.name,
                              grade: s.grade || "",
                              section: s.section || "",
                            });
                            setStudentSearchResults([]);
                          }}
                        >
                          <div>
                            <span className="font-semibold">{s.name}</span>
                            <span className="text-muted-foreground ml-2">Grade {s.grade}</span>
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 text-xs">
                            Select
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {uniformIssueForm.studentId && (
                    <div className="flex items-center justify-between p-2 bg-primary/10 rounded-lg border border-primary/20 mt-1">
                      <div className="flex items-center gap-2">
                        <UserCheck className="h-4 w-4 text-primary" />
                        <div>
                          <span className="font-semibold">{uniformIssueForm.studentName}</span>
                          <span className="text-muted-foreground ml-2">(Grade {uniformIssueForm.grade})</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-rose-600"
                        onClick={() =>
                          setUniformIssueForm({
                            ...uniformIssueForm,
                            studentId: "",
                            studentName: "",
                          })
                        }
                      >
                        Change
                      </Button>
                    </div>
                  )}
                </div>

                {/* Size Selection */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Size *</Label>
                    <select
                      className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium"
                      value={uniformIssueForm.size}
                      onChange={(e) => setUniformIssueForm({ ...uniformIssueForm, size: e.target.value })}
                      required
                    >
                      {Object.entries(selectedUniformForIssue.sizes || {}).map(([s, qty]) => (
                        <option key={s} value={s} disabled={qty <= 0}>
                          Size {s} ({qty} in stock)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Quantity *</Label>
                    <Input
                      type="number"
                      min="1"
                      value={uniformIssueForm.quantity}
                      onChange={(e) =>
                        setUniformIssueForm({ ...uniformIssueForm, quantity: parseInt(e.target.value) || 1 })
                      }
                      required
                    />
                  </div>
                </div>

                <DialogFooter className="pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsIssueUniformModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={actionLoading || !uniformIssueForm.studentId}>
                    {actionLoading ? "Processing..." : "Complete Issuance"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: Add Textbook */}
      <Dialog open={isAddTextbookModalOpen} onOpenChange={setIsAddTextbookModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              Register Curriculum Textbook
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddTextbook} className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Textbook Title *</Label>
              <Input
                placeholder="e.g. NCERT Mathematics Grade 10"
                value={textbookForm.title}
                onChange={(e) => setTextbookForm({ ...textbookForm, title: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Grade</Label>
                <Input
                  placeholder="e.g. 10"
                  value={textbookForm.grade}
                  onChange={(e) => setTextbookForm({ ...textbookForm, grade: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Subject</Label>
                <Input
                  placeholder="e.g. Mathematics"
                  value={textbookForm.subject}
                  onChange={(e) => setTextbookForm({ ...textbookForm, subject: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Total Procured Stock</Label>
                <Input
                  type="number"
                  min="1"
                  value={textbookForm.totalStock}
                  onChange={(e) =>
                    setTextbookForm({ ...textbookForm, totalStock: parseInt(e.target.value) || 1 })
                  }
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Academic Session</Label>
                <Input
                  value={textbookForm.academicSession}
                  onChange={(e) => setTextbookForm({ ...textbookForm, academicSession: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddTextbookModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={actionLoading}>
                {actionLoading ? "Saving..." : "Register Textbook"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Distribute Textbook to Student */}
      <Dialog open={isDistributeTextbookModalOpen} onOpenChange={setIsDistributeTextbookModalOpen}>
        <DialogContent className="max-w-md">
          {selectedTextbookForDist && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  Distribute Textbook: {selectedTextbookForDist.title}
                </DialogTitle>
              </DialogHeader>

              <form onSubmit={handleDistributeTextbook} className="space-y-3 py-2 text-xs">
                {/* Student Search */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Search Existing Student *</Label>
                  <Input
                    placeholder="Search student name..."
                    value={studentSearchTerm}
                    onChange={(e) => handleSearchStudents(e.target.value)}
                  />

                  {studentSearchResults.length > 0 && !distributeForm.studentId && (
                    <div className="divide-y divide-border/60 border border-border/60 rounded-lg max-h-32 overflow-y-auto bg-card mt-1">
                      {studentSearchResults.map((s) => (
                        <div
                          key={s.id}
                          className="p-1.5 hover:bg-muted/40 cursor-pointer flex justify-between items-center"
                          onClick={() => {
                            setDistributeForm({
                              ...distributeForm,
                              studentId: s.id,
                              studentName: s.name,
                              grade: s.grade || selectedTextbookForDist.grade,
                              section: s.section || "",
                            });
                            setStudentSearchResults([]);
                          }}
                        >
                          <div>
                            <span className="font-semibold">{s.name}</span>
                            <span className="text-muted-foreground ml-2">Grade {s.grade}</span>
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 text-xs">
                            Select
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {distributeForm.studentId && (
                    <div className="flex items-center justify-between p-2 bg-primary/10 rounded-lg border border-primary/20 mt-1">
                      <div className="flex items-center gap-2">
                        <UserCheck className="h-4 w-4 text-primary" />
                        <div>
                          <span className="font-semibold">{distributeForm.studentName}</span>
                          <span className="text-muted-foreground ml-2">(Grade {distributeForm.grade})</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-rose-600"
                        onClick={() =>
                          setDistributeForm({
                            ...distributeForm,
                            studentId: "",
                            studentName: "",
                          })
                        }
                      >
                        Change
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Academic Session</Label>
                  <Input
                    value={distributeForm.academicYear}
                    onChange={(e) => setDistributeForm({ ...distributeForm, academicYear: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="returnReq"
                    checked={distributeForm.returnRequired}
                    onChange={(e) => setDistributeForm({ ...distributeForm, returnRequired: e.target.checked })}
                  />
                  <label htmlFor="returnReq" className="text-xs font-medium cursor-pointer">
                    Return Required at End of Academic Session
                  </label>
                </div>

                <DialogFooter className="pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsDistributeTextbookModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={actionLoading || !distributeForm.studentId}>
                    {actionLoading ? "Distributing..." : "Confirm Distribution"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  LibraryBook,
  LibraryBookCategory,
  LibraryCopy,
  LibraryCopyCondition,
  LibraryFineRule,
  LibraryTransaction,
} from "@/lib/types";
import {
  createBookWithCopies,
  addCopiesToExistingBook,
  issueBookCopy,
  returnBookCopy,
  renewBookCopy,
  updateFinePaymentStatus,
  getLibraryFineRules,
  updateLibraryFineRules,
  getLibraryStats,
} from "@/lib/library";
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
  BookOpen,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Barcode,
  Layers,
  Settings,
  ArrowRightLeft,
  DollarSign,
  UserCheck,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

export default function LibraryManagement() {
  const { appUser } = useAuth();
  const [activeTab, setActiveTab] = useState("catalog");
  const [loading, setLoading] = useState(true);

  // Data States
  const [stats, setStats] = useState({
    totalTitles: 0,
    totalCopies: 0,
    availableCopies: 0,
    issuedCopies: 0,
    overdueCount: 0,
    totalFinesCollected: 0,
    totalFinesPending: 0,
  });
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [copies, setCopies] = useState<LibraryCopy[]>([]);
  const [activeLoans, setActiveLoans] = useState<LibraryTransaction[]>([]);
  const [fineRules, setFineRules] = useState<LibraryFineRule>({
    finePerDay: 5,
    gracePeriodDays: 1,
    maxFineCap: 250,
    lostBookMultiplier: 1.5,
    standardDurationDaysStudent: 14,
    standardDurationDaysStaff: 30,
    maxBorrowLimitStudent: 3,
    maxBorrowLimitStaff: 5,
  });

  // Search & Filter
  const [catalogSearch, setCatalogSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [copySearch, setCopySearch] = useState("");

  // Modals
  const [isAddBookModalOpen, setIsAddBookModalOpen] = useState(false);
  const [isAddCopiesModalOpen, setIsAddCopiesModalOpen] = useState(false);
  const [selectedBookForCopies, setSelectedBookForCopies] = useState<LibraryBook | null>(null);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [selectedTxForReturn, setSelectedTxForReturn] = useState<LibraryTransaction | null>(null);

  // Forms
  const [bookForm, setBookForm] = useState({
    title: "",
    author: "",
    isbn: "",
    publisher: "",
    edition: "",
    category: "general" as LibraryBookCategory,
    subject: "",
    grade: "",
    shelfLocation: "",
    description: "",
    initialCopiesCount: 2,
    initialPrice: 250,
  });

  const [addCopiesCount, setAddCopiesCount] = useState(1);
  const [addCopiesCondition, setAddCopiesCondition] = useState<LibraryCopyCondition>("new");

  // Issue Form
  const [issueMemberType, setIssueMemberType] = useState<"student" | "staff">("student");
  const [issueSearchTerm, setIssueSearchTerm] = useState("");
  const [matchedMembers, setMatchedMembers] = useState<any[]>([]);
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const [selectedCopyId, setSelectedCopyId] = useState("");
  const [availableCopiesList, setAvailableCopiesList] = useState<LibraryCopy[]>([]);
  const [issueDueDate, setIssueDueDate] = useState("");

  // Return Form
  const [returnCondition, setReturnCondition] = useState<LibraryCopyCondition>("good");
  const [returnFinePayment, setReturnFinePayment] = useState<"none" | "paid" | "waived">("paid");
  const [returnWaiverReason, setReturnWaiverReason] = useState("");

  // Action Loading
  const [actionLoading, setActionLoading] = useState(false);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const [statsData, rulesData, booksSnap, copiesSnap, loansSnap] = await Promise.all([
        getLibraryStats(),
        getLibraryFineRules(),
        getDocs(collection(db, "libraryBooks")),
        getDocs(query(collection(db, "libraryCopies"), limit(300))),
        getDocs(query(collection(db, "libraryTransactions"), where("status", "in", ["issued", "overdue"]))),
      ]);

      setStats(statsData);
      setFineRules(rulesData);
      setBooks(booksSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LibraryBook)));
      setCopies(copiesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LibraryCopy)));
      setActiveLoans(loansSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LibraryTransaction)));
    } catch (err: any) {
      toast.error(err.message || "Failed to load library data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAllData();
  }, []);

  // Filtered books
  const filteredBooks = books.filter((b) => {
    const matchesSearch =
      b.title.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      b.author.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      (b.isbn && b.isbn.includes(catalogSearch));
    const matchesCat = categoryFilter === "all" || b.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  // Filtered copies
  const filteredCopies = copies.filter((c) => {
    return (
      c.accessionNumber.toLowerCase().includes(copySearch.toLowerCase()) ||
      c.bookTitle.toLowerCase().includes(copySearch.toLowerCase()) ||
      (c.shelfLocation && c.shelfLocation.toLowerCase().includes(copySearch.toLowerCase()))
    );
  });

  // Handle Add Book
  const handleAddBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;
    if (!bookForm.title.trim() || !bookForm.author.trim()) {
      toast.error("Title and author are required.");
      return;
    }
    try {
      setActionLoading(true);
      await createBookWithCopies(bookForm, {
        userId: appUser.id,
        userName: appUser.name,
        role: appUser.role,
      });
      toast.success(`Book "${bookForm.title}" added with ${bookForm.initialCopiesCount} copies.`);
      setIsAddBookModalOpen(false);
      setBookForm({
        title: "",
        author: "",
        isbn: "",
        publisher: "",
        edition: "",
        category: "general",
        subject: "",
        grade: "",
        shelfLocation: "",
        description: "",
        initialCopiesCount: 2,
        initialPrice: 250,
      });
      await loadAllData();
    } catch (err: any) {
      toast.error(err.message || "Failed to create book.");
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Add Copies
  const handleAddCopies = async () => {
    if (!appUser || !selectedBookForCopies) return;
    try {
      setActionLoading(true);
      await addCopiesToExistingBook(
        selectedBookForCopies.id,
        addCopiesCount,
        addCopiesCondition,
        undefined,
        undefined,
        {
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
        }
      );
      toast.success(`Added ${addCopiesCount} new copies to "${selectedBookForCopies.title}".`);
      setIsAddCopiesModalOpen(false);
      setSelectedBookForCopies(null);
      await loadAllData();
    } catch (err: any) {
      toast.error(err.message || "Failed to add copies.");
    } finally {
      setActionLoading(false);
    }
  };

  // Search Members for Checkout
  const handleMemberSearch = async () => {
    if (!issueSearchTerm.trim()) return;
    try {
      const term = issueSearchTerm.trim().toLowerCase();
      if (issueMemberType === "student") {
        const snap = await getDocs(collection(db, "students"));
        const matches = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(
            (s: any) =>
              (s.name && s.name.toLowerCase().includes(term)) ||
              (s.admissionNo && s.admissionNo.toLowerCase().includes(term)) ||
              (s.rollNo && String(s.rollNo).includes(term))
          )
          .slice(0, 8);
        setMatchedMembers(matches);
      } else {
        const snap = await getDocs(query(collection(db, "users"), where("role", "in", ["teacher", "hod", "admin"])));
        const matches = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(
            (u: any) =>
              (u.name && u.name.toLowerCase().includes(term)) ||
              (u.email && u.email.toLowerCase().includes(term))
          )
          .slice(0, 8);
        setMatchedMembers(matches);
      }
    } catch (err: any) {
      toast.error("Failed to search members.");
    }
  };

  // Open Issue Modal
  const openIssueModal = () => {
    const available = copies.filter((c) => c.status === "available");
    setAvailableCopiesList(available);
    setSelectedMember(null);
    setMatchedMembers([]);
    setIssueSearchTerm("");
    setSelectedCopyId(available[0]?.id || "");
    const due = new Date();
    due.setDate(due.getDate() + (issueMemberType === "student" ? fineRules.standardDurationDaysStudent : fineRules.standardDurationDaysStaff));
    setIssueDueDate(due.toISOString().slice(0, 10));
    setIsIssueModalOpen(true);
  };

  // Execute Issue
  const handleExecuteIssue = async () => {
    if (!appUser) return;
    if (!selectedMember) {
      toast.error("Please select a borrower.");
      return;
    }
    if (!selectedCopyId) {
      toast.error("Please select a book copy.");
      return;
    }
    try {
      setActionLoading(true);
      const memberIdent =
        issueMemberType === "student"
          ? selectedMember.admissionNo || selectedMember.rollNo || "Student"
          : selectedMember.email || selectedMember.role;

      await issueBookCopy(
        {
          copyId: selectedCopyId,
          memberId: selectedMember.id,
          memberType: issueMemberType,
          memberName: selectedMember.name,
          memberIdentifier: memberIdent,
          memberGrade: selectedMember.grade || "",
          memberSection: selectedMember.section || "",
          dueDate: issueDueDate || undefined,
        },
        {
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
        }
      );

      toast.success("Book issued successfully!");
      setIsIssueModalOpen(false);
      await loadAllData();
    } catch (err: any) {
      toast.error(err.message || "Failed to issue book.");
    } finally {
      setActionLoading(false);
    }
  };

  // Open Return Modal
  const openReturnModal = (tx: LibraryTransaction) => {
    setSelectedTxForReturn(tx);
    setReturnCondition(tx.conditionOnReturn || "good");
    setReturnFinePayment("paid");
    setReturnWaiverReason("");
    setIsReturnModalOpen(true);
  };

  // Execute Return
  const handleExecuteReturn = async () => {
    if (!appUser || !selectedTxForReturn) return;
    try {
      setActionLoading(true);
      const res = await returnBookCopy(
        {
          transactionId: selectedTxForReturn.id,
          conditionOnReturn: returnCondition,
          finePaidStatus: returnFinePayment,
          fineWaivedReason: returnFinePayment === "waived" ? returnWaiverReason : undefined,
        },
        {
          userId: appUser.id,
          userName: appUser.name,
          role: appUser.role,
        }
      );

      toast.success(
        `Book returned successfully.${res.fineAmount > 0 ? ` Fine: ₹${res.fineAmount} (${returnFinePayment})` : ""}`
      );
      setIsReturnModalOpen(false);
      setSelectedTxForReturn(null);
      await loadAllData();
    } catch (err: any) {
      toast.error(err.message || "Failed to process return.");
    } finally {
      setActionLoading(false);
    }
  };

  // Execute Renewal
  const handleRenew = async (txId: string) => {
    if (!appUser) return;
    try {
      const newDue = await renewBookCopy(txId, undefined, {
        userId: appUser.id,
        userName: appUser.name,
        role: appUser.role,
      });
      toast.success(`Book loan renewed. New Due Date: ${newDue}`);
      await loadAllData();
    } catch (err: any) {
      toast.error(err.message || "Failed to renew book.");
    }
  };

  // Save Rules
  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser) return;
    try {
      setActionLoading(true);
      await updateLibraryFineRules(fineRules, {
        userId: appUser.id,
        userName: appUser.name,
        role: appUser.role,
      });
      toast.success("Library fine and circulation rules updated.");
    } catch (err: any) {
      toast.error("Failed to update rules.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Library Management</h1>
              <p className="text-sm text-muted-foreground">
                Book catalog, accession copies inventory, circulation desk, and overdue fine engine.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={openIssueModal} className="rounded-xl">
            <ArrowRightLeft className="h-4 w-4 mr-1.5" /> Issue Book
          </Button>
          <Button onClick={() => setIsAddBookModalOpen(true)} variant="outline" className="rounded-xl">
            <Plus className="h-4 w-4 mr-1.5" /> Add Book Title
          </Button>
          <Button variant="ghost" size="icon" onClick={() => loadAllData()} disabled={loading}>
            <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 shrink-0">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalTitles}</p>
              <p className="text-xs text-muted-foreground">Book Titles</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalCopies}</p>
              <p className="text-xs text-muted-foreground">Physical Copies ({stats.availableCopies} free)</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
              <ArrowRightLeft className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.issuedCopies}</p>
              <p className="text-xs text-muted-foreground">Active Borrowings</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-700 shrink-0">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-rose-600">{stats.overdueCount}</p>
              <p className="text-xs text-muted-foreground">Overdue Books</p>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-2 sm:col-span-1 rounded-2xl border border-border/70 shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">₹{stats.totalFinesCollected}</p>
              <p className="text-xs text-muted-foreground">Fines Collected (₹{stats.totalFinesPending} uncollected)</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-muted/40 p-1 rounded-xl">
          <TabsTrigger value="catalog" className="rounded-lg text-xs">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" /> Book Catalog
          </TabsTrigger>
          <TabsTrigger value="copies" className="rounded-lg text-xs">
            <Barcode className="h-3.5 w-3.5 mr-1.5" /> Physical Copies ({copies.length})
          </TabsTrigger>
          <TabsTrigger value="loans" className="rounded-lg text-xs">
            <Clock className="h-3.5 w-3.5 mr-1.5" /> Active Loans & Overdues ({activeLoans.length})
          </TabsTrigger>
          <TabsTrigger value="settings" className="rounded-lg text-xs">
            <Settings className="h-3.5 w-3.5 mr-1.5" /> Fine & Borrowing Rules
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Book Catalog */}
        <TabsContent value="catalog" className="space-y-4">
          <Card className="rounded-2xl border border-border/70 shadow-sm">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3 justify-between items-center">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by title, author, ISBN..."
                    className="pl-9 rounded-xl"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs text-muted-foreground font-medium">Category:</span>
                  <select
                    aria-label="Filter by Category"
                    className="text-xs h-9 rounded-xl border border-input bg-background px-3 py-1 font-medium"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <option value="all">All Categories</option>
                    <option value="fiction">Fiction</option>
                    <option value="science">Science</option>
                    <option value="mathematics">Mathematics</option>
                    <option value="social_studies">Social Studies</option>
                    <option value="reference">Reference</option>
                    <option value="languages">Languages</option>
                    <option value="general">General</option>
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
                    <th className="px-4 py-3">Book Title</th>
                    <th className="px-4 py-3">Author</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Shelf</th>
                    <th className="px-4 py-3">Available / Total</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredBooks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                        <BookOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                        <p className="font-medium">No books found in catalog.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredBooks.map((book) => (
                      <tr key={book.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-foreground">{book.title}</div>
                          {book.isbn && <div className="text-[11px] text-muted-foreground font-mono">ISBN: {book.isbn}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">{book.author}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="capitalize text-xs">
                            {book.category.replace("_", " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono">{book.shelfLocation || "Rack A"}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-semibold text-xs ${
                              book.availableCopies === 0 ? "text-rose-600" : "text-emerald-600"
                            }`}
                          >
                            {book.availableCopies} available
                          </span>
                          <span className="text-xs text-muted-foreground"> / {book.totalCopies} total</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs rounded-xl"
                            onClick={() => {
                              setSelectedBookForCopies(book);
                              setIsAddCopiesModalOpen(true);
                            }}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" /> Add Copies
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Tab 2: Physical Copies Inventory */}
        <TabsContent value="copies" className="space-y-4">
          <Card className="rounded-2xl border border-border/70 shadow-sm">
            <CardContent className="p-4">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search accession number or title..."
                  className="pl-9 rounded-xl"
                  value={copySearch}
                  onChange={(e) => setCopySearch(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/40 text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="px-4 py-3">Accession Number</th>
                    <th className="px-4 py-3">Book Title</th>
                    <th className="px-4 py-3">Condition</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Current Borrower</th>
                    <th className="px-4 py-3">Shelf</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredCopies.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                        <Barcode className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                        <p>No copies matching search.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredCopies.map((copy) => (
                      <tr key={copy.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-mono font-semibold text-xs text-primary">
                          {copy.accessionNumber}
                        </td>
                        <td className="px-4 py-3 font-medium text-xs">{copy.bookTitle}</td>
                        <td className="px-4 py-3">
                          <span className="capitalize text-xs font-medium">{copy.condition}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              copy.status === "available"
                                ? "secondary"
                                : copy.status === "issued"
                                ? "default"
                                : "destructive"
                            }
                            className={copy.status === "available" ? "bg-emerald-100 text-emerald-800" : ""}
                          >
                            {copy.status.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {copy.currentBorrowerName ? (
                            <div>
                              <span className="font-semibold">{copy.currentBorrowerName}</span>
                              <span className="text-[11px] text-muted-foreground block capitalize">
                                {copy.currentBorrowerType}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">On Shelf</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono">{copy.shelfLocation || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* Tab 3: Active Loans & Overdues */}
        <TabsContent value="loans" className="space-y-4">
          <Card className="rounded-2xl border border-border/70 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border/60 bg-muted/20 flex justify-between items-center">
              <h3 className="font-semibold text-sm">Active Book Loans & Overdues ({activeLoans.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/40 text-muted-foreground border-b border-border/60">
                  <tr>
                    <th className="px-4 py-3">Accession No</th>
                    <th className="px-4 py-3">Book Title</th>
                    <th className="px-4 py-3">Borrower</th>
                    <th className="px-4 py-3">Issue Date</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {activeLoans.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500/50" />
                        <p>No active borrowings. All books are accounted for.</p>
                      </td>
                    </tr>
                  ) : (
                    activeLoans.map((loan) => {
                      const isOverdue = loan.dueDate < new Date().toISOString().slice(0, 10);
                      return (
                        <tr key={loan.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold text-xs text-primary">
                            {loan.accessionNumber}
                          </td>
                          <td className="px-4 py-3 font-medium text-xs">{loan.bookTitle}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-xs">{loan.memberName}</div>
                            <div className="text-[11px] text-muted-foreground">{loan.memberIdentifier}</div>
                          </td>
                          <td className="px-4 py-3 text-xs">{loan.issueDate}</td>
                          <td className="px-4 py-3 text-xs font-semibold">
                            <span className={isOverdue ? "text-rose-600 font-bold" : ""}>{loan.dueDate}</span>
                          </td>
                          <td className="px-4 py-3">
                            {isOverdue ? (
                              <Badge className="bg-rose-500 text-white animate-pulse">Overdue</Badge>
                            ) : (
                              <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200">
                                Active
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs rounded-xl"
                                onClick={() => handleRenew(loan.id)}
                                title="Renew loan for standard duration"
                              >
                                Renew ({loan.renewalCount}/2)
                              </Button>
                              <Button
                                size="sm"
                                className="h-8 text-xs rounded-xl bg-primary"
                                onClick={() => openReturnModal(loan)}
                              >
                                Return
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

        {/* Tab 4: Fine & Borrowing Rules */}
        <TabsContent value="settings" className="space-y-4">
          <Card className="rounded-2xl border border-border/70 shadow-sm max-w-2xl">
            <CardContent className="p-6">
              <form onSubmit={handleSaveRules} className="space-y-4">
                <h3 className="font-semibold text-base border-b border-border/60 pb-2">
                  Library Circulation & Fine Policies
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Fine Per Day (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={fineRules.finePerDay}
                      onChange={(e) => setFineRules({ ...fineRules, finePerDay: Number(e.target.value) || 0 })}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Grace Period (Days)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={fineRules.gracePeriodDays}
                      onChange={(e) => setFineRules({ ...fineRules, gracePeriodDays: Number(e.target.value) || 0 })}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Maximum Fine Cap per Book (₹)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={fineRules.maxFineCap}
                      onChange={(e) => setFineRules({ ...fineRules, maxFineCap: Number(e.target.value) || 0 })}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Lost Book Replacement Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="1"
                      value={fineRules.lostBookMultiplier}
                      onChange={(e) => setFineRules({ ...fineRules, lostBookMultiplier: Number(e.target.value) || 1 })}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Student Loan Duration (Days)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={fineRules.standardDurationDaysStudent}
                      onChange={(e) =>
                        setFineRules({ ...fineRules, standardDurationDaysStudent: Number(e.target.value) || 14 })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Staff Loan Duration (Days)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={fineRules.standardDurationDaysStaff}
                      onChange={(e) =>
                        setFineRules({ ...fineRules, standardDurationDaysStaff: Number(e.target.value) || 30 })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Max Books Borrow Limit (Students)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={fineRules.maxBorrowLimitStudent}
                      onChange={(e) =>
                        setFineRules({ ...fineRules, maxBorrowLimitStudent: Number(e.target.value) || 3 })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Max Books Borrow Limit (Staff)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={fineRules.maxBorrowLimitStaff}
                      onChange={(e) =>
                        setFineRules({ ...fineRules, maxBorrowLimitStaff: Number(e.target.value) || 5 })
                      }
                      required
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <Button type="submit" disabled={actionLoading} className="rounded-xl">
                    Save Policy Changes
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modal: Add Book Title */}
      <Dialog open={isAddBookModalOpen} onOpenChange={setIsAddBookModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              Add Book Title & Register Initial Copies
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddBook} className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Book Title *</Label>
                <Input
                  placeholder="e.g. To Kill a Mockingbird"
                  value={bookForm.title}
                  onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Author *</Label>
                <Input
                  placeholder="e.g. Harper Lee"
                  value={bookForm.author}
                  onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Category</Label>
                <select
                  className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-ring"
                  value={bookForm.category}
                  onChange={(e) => setBookForm({ ...bookForm, category: e.target.value as LibraryBookCategory })}
                >
                  <option value="fiction">Fiction</option>
                  <option value="science">Science</option>
                  <option value="mathematics">Mathematics</option>
                  <option value="social_studies">Social Studies</option>
                  <option value="reference">Reference</option>
                  <option value="languages">Languages</option>
                  <option value="general">General</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">ISBN (Optional)</Label>
                <Input
                  placeholder="e.g. 978-0061120084"
                  value={bookForm.isbn}
                  onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Shelf / Rack Location</Label>
                <Input
                  placeholder="e.g. Rack B-4"
                  value={bookForm.shelfLocation}
                  onChange={(e) => setBookForm({ ...bookForm, shelfLocation: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-muted/20 p-3 rounded-xl border border-border/60">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Initial Copies to Create *</Label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={bookForm.initialCopiesCount}
                  onChange={(e) =>
                    setBookForm({ ...bookForm, initialCopiesCount: parseInt(e.target.value) || 1 })
                  }
                  required
                />
                <span className="text-[11px] text-muted-foreground block">
                  Unique accession numbers will be auto-generated.
                </span>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Book Price (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={bookForm.initialPrice}
                  onChange={(e) =>
                    setBookForm({ ...bookForm, initialPrice: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Publisher</Label>
                <Input
                  placeholder="e.g. Penguin Books"
                  value={bookForm.publisher}
                  onChange={(e) => setBookForm({ ...bookForm, publisher: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddBookModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={actionLoading}>
                {actionLoading ? "Registering..." : "Add Book & Create Copies"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Add More Copies to Existing Book */}
      <Dialog open={isAddCopiesModalOpen} onOpenChange={setIsAddCopiesModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Add Physical Copies to "{selectedBookForCopies?.title}"
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Number of New Copies</Label>
              <Input
                type="number"
                min="1"
                max="50"
                value={addCopiesCount}
                onChange={(e) => setAddCopiesCount(parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Condition of New Copies</Label>
              <select
                className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium"
                value={addCopiesCondition}
                onChange={(e) => setAddCopiesCondition(e.target.value as LibraryCopyCondition)}
              >
                <option value="new">New (Brand New)</option>
                <option value="good">Good (Clean)</option>
                <option value="fair">Fair (Usable)</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddCopiesModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddCopies} disabled={actionLoading}>
              {actionLoading ? "Adding..." : "Generate Copies"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Issue Book (Circulation Checkout) */}
      <Dialog open={isIssueModalOpen} onOpenChange={setIsIssueModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Circulation Desk: Issue Book Copy
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Step 1: Member Selection */}
            <div className="space-y-2 border border-border/60 rounded-xl p-3 bg-muted/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">1. Select Borrower (Member)</span>
                <div className="flex items-center gap-2">
                  <label className="text-xs flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="memberType"
                      checked={issueMemberType === "student"}
                      onChange={() => {
                        setIssueMemberType("student");
                        setSelectedMember(null);
                        setMatchedMembers([]);
                      }}
                    />
                    Student
                  </label>
                  <label className="text-xs flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="memberType"
                      checked={issueMemberType === "staff"}
                      onChange={() => {
                        setIssueMemberType("staff");
                        setSelectedMember(null);
                        setMatchedMembers([]);
                      }}
                    />
                    Staff / Teacher
                  </label>
                </div>
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder={
                    issueMemberType === "student"
                      ? "Search student by name, admission no, or roll no..."
                      : "Search staff by name or email..."
                  }
                  value={issueSearchTerm}
                  onChange={(e) => setIssueSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleMemberSearch()}
                />
                <Button type="button" onClick={handleMemberSearch} variant="secondary">
                  Search
                </Button>
              </div>

              {matchedMembers.length > 0 && !selectedMember && (
                <div className="divide-y divide-border/60 border border-border/60 rounded-lg max-h-36 overflow-y-auto bg-card">
                  {matchedMembers.map((m) => (
                    <div
                      key={m.id}
                      className="p-2 hover:bg-muted/40 cursor-pointer flex justify-between items-center text-xs"
                      onClick={() => setSelectedMember(m)}
                    >
                      <div>
                        <span className="font-semibold">{m.name}</span>
                        <span className="text-muted-foreground ml-2">
                          {issueMemberType === "student" ? `Adm: ${m.admissionNo || "N/A"}` : m.email}
                        </span>
                      </div>
                      <Button size="sm" variant="ghost" className="h-6 text-xs">
                        Select
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {selectedMember && (
                <div className="flex items-center justify-between p-2 bg-primary/10 rounded-lg border border-primary/20 text-xs">
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-primary" />
                    <div>
                      <span className="font-semibold">{selectedMember.name}</span>
                      <span className="text-muted-foreground ml-2">
                        ({issueMemberType === "student" ? `Adm: ${selectedMember.admissionNo}` : selectedMember.email})
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-rose-600"
                    onClick={() => setSelectedMember(null)}
                  >
                    Change
                  </Button>
                </div>
              )}
            </div>

            {/* Step 2: Copy Selection */}
            <div className="space-y-2 border border-border/60 rounded-xl p-3 bg-muted/10">
              <span className="text-xs font-semibold block">2. Select Physical Copy (Available on Shelf)</span>
              <select
                className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium"
                value={selectedCopyId}
                onChange={(e) => setSelectedCopyId(e.target.value)}
              >
                {availableCopiesList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.accessionNumber} - {c.bookTitle} ({c.shelfLocation || "Rack A"})
                  </option>
                ))}
              </select>
            </div>

            {/* Step 3: Due Date */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Due Date</Label>
              <Input
                type="date"
                value={issueDueDate}
                onChange={(e) => setIssueDueDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsIssueModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleExecuteIssue} disabled={actionLoading || !selectedMember || !selectedCopyId}>
              {actionLoading ? "Processing..." : "Complete Checkout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Return Book (Circulation Checkin & Fine Settlement) */}
      <Dialog open={isReturnModalOpen} onOpenChange={setIsReturnModalOpen}>
        <DialogContent className="max-w-md">
          {selectedTxForReturn && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5 text-primary" />
                  Check-in Book Return
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 py-2 text-xs">
                <div className="bg-muted/30 p-3 rounded-xl border border-border/60">
                  <div className="font-semibold text-sm">{selectedTxForReturn.bookTitle}</div>
                  <div className="text-muted-foreground mt-0.5">
                    Accession No: <strong className="text-primary">{selectedTxForReturn.accessionNumber}</strong>
                  </div>
                  <div className="text-muted-foreground">
                    Borrower: <strong>{selectedTxForReturn.memberName}</strong> ({selectedTxForReturn.memberIdentifier})
                  </div>
                  <div className="text-muted-foreground">
                    Due Date: <strong>{selectedTxForReturn.dueDate}</strong>
                  </div>
                </div>

                {/* Overdue Calculation Preview */}
                {(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  const diff = Math.ceil(
                    (new Date(today).getTime() - new Date(selectedTxForReturn.dueDate).getTime()) /
                      (1000 * 60 * 60 * 24)
                  );
                  const chargeable = Math.max(0, diff - fineRules.gracePeriodDays);
                  const fine = Math.min(chargeable * fineRules.finePerDay, fineRules.maxFineCap);

                  return (
                    <div
                      className={`p-3 rounded-xl border ${
                        diff > 0 ? "bg-rose-50 border-rose-200 text-rose-950" : "bg-emerald-50 border-emerald-200 text-emerald-950"
                      }`}
                    >
                      <div className="font-semibold">
                        {diff > 0 ? `Overdue by ${diff} day(s)` : "Returned on time (No Overdue)"}
                      </div>
                      {fine > 0 && (
                        <div className="text-sm font-bold mt-1 text-rose-700">
                          Overdue Fine Calculated: ₹{fine}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Condition on Return</Label>
                  <select
                    className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium"
                    value={returnCondition}
                    onChange={(e) => setReturnCondition(e.target.value as LibraryCopyCondition)}
                  >
                    <option value="good">Good (No damage, return to shelf)</option>
                    <option value="fair">Fair (Minor wear, return to shelf)</option>
                    <option value="damaged">Damaged (Send for repair / charge)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Fine Settlement</Label>
                  <select
                    className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 py-1 font-medium"
                    value={returnFinePayment}
                    onChange={(e) => setReturnFinePayment(e.target.value as any)}
                  >
                    <option value="paid">Mark Fine as Paid</option>
                    <option value="waived">Waive Fine (Exempt borrower)</option>
                    <option value="none">No Fine Applicable</option>
                  </select>
                </div>

                {returnFinePayment === "waived" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Waiver Reason</Label>
                    <Input
                      placeholder="e.g. Principal exemption, authorized medical leave..."
                      value={returnWaiverReason}
                      onChange={(e) => setReturnWaiverReason(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsReturnModalOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleExecuteReturn} disabled={actionLoading}>
                  {actionLoading ? "Processing..." : "Complete Return"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

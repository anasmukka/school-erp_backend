import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  LibraryBook,
  LibraryTransaction,
  LibraryFineRule,
} from "@/lib/types";
import {
  DEFAULT_FINE_RULES,
  getLibraryFineRules,
  resolveStudentLibraryIdentifiers,
  subscribeToStudentLibraryTransactions,
  getBooksMapForTransactions,
  getLoanDaysDiff,
  calculateOverdueFine,
} from "@/lib/library";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  BookOpen,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  History,
  Info,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  Sparkles,
  Layers,
  ArrowUpRight,
  ShieldAlert,
  Loader2,
} from "lucide-react";

export default function StudentLibrary() {
  const { appUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<LibraryTransaction[]>([]);
  const [booksMap, setBooksMap] = useState<Record<string, LibraryBook>>({});
  const [fineRules, setFineRules] = useState<LibraryFineRule>(DEFAULT_FINE_RULES);
  const [studentIdentifiers, setStudentIdentifiers] = useState<string[]>([]);
  const [studentInfo, setStudentInfo] = useState<any>(null);

  // Selected book for details modal
  const [selectedTx, setSelectedTx] = useState<LibraryTransaction | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // History pagination
  const [historyPage, setHistoryPage] = useState(1);
  const itemsPerPage = 6;

  // 1. Resolve student identity strictly from authenticated account (Zero IDOR)
  useEffect(() => {
    if (!appUser) return;

    let isMounted = true;
    async function initStudent() {
      try {
        setLoading(true);
        const [rules, identity] = await Promise.all([
          getLibraryFineRules(),
          resolveStudentLibraryIdentifiers(appUser.id, appUser.email),
        ]);

        if (isMounted) {
          setFineRules(rules);
          setStudentIdentifiers(identity.allIdentifiers);
          setStudentInfo(identity.studentData);
        }
      } catch (err) {
        console.error("Failed to initialize student library identity:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void initStudent();

    return () => {
      isMounted = false;
    };
  }, [appUser]);

  // 2. Real-time subscription to library transactions
  useEffect(() => {
    if (studentIdentifiers.length === 0) return;

    const unsubscribe = subscribeToStudentLibraryTransactions(
      studentIdentifiers,
      async (txs) => {
        setTransactions(txs);

        // Fetch corresponding catalog book details
        const bookIds = txs.map((t) => t.bookId);
        const bMap = await getBooksMapForTransactions(bookIds);
        setBooksMap((prev) => ({ ...prev, ...bMap }));
        setLoading(false);
      },
      (err) => {
        console.error("Subscription error:", err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [studentIdentifiers]);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Split transactions into active and history
  const { currentlyBorrowed, overdueBooks, dueSoonBooks, borrowingHistory } = useMemo(() => {
    const active: LibraryTransaction[] = [];
    const overdue: LibraryTransaction[] = [];
    const dueSoon: LibraryTransaction[] = [];
    const history: LibraryTransaction[] = [];

    const reminderThreshold = fineRules.reminderDaysBeforeDue || 3;

    for (const tx of transactions) {
      if (tx.status === "returned" || tx.status === "lost") {
        history.push(tx);
      } else {
        // Active loan ("issued" or "overdue")
        active.push(tx);
        const daysDiff = getLoanDaysDiff(tx.dueDate, todayStr);
        if (daysDiff < 0 || tx.status === "overdue") {
          overdue.push(tx);
        } else if (daysDiff <= reminderThreshold) {
          dueSoon.push(tx);
        }
      }
    }

    return {
      currentlyBorrowed: active,
      overdueBooks: overdue,
      dueSoonBooks: dueSoon,
      borrowingHistory: history,
    };
  }, [transactions, todayStr, fineRules]);

  // Pagination for borrowing history
  const totalHistoryPages = Math.ceil(borrowingHistory.length / itemsPerPage) || 1;
  const paginatedHistory = useMemo(() => {
    const start = (historyPage - 1) * itemsPerPage;
    return borrowingHistory.slice(start, start + itemsPerPage);
  }, [borrowingHistory, historyPage]);

  // Open details modal
  const handleOpenDetails = (tx: LibraryTransaction) => {
    setSelectedTx(tx);
    setIsDetailsOpen(true);
  };

  const selectedBook = selectedTx ? booksMap[selectedTx.bookId] : null;

  const maxLimit = fineRules.maxBorrowLimitStudent || 3;
  const borrowQuotaPercent = Math.min(100, Math.round((currentlyBorrowed.length / maxLimit) * 100));

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-6 md:p-8 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-medium text-indigo-200">
              <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
              <span>Prestige Institutional Library</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              My Student Library Portal
            </h1>
            <p className="text-sm text-slate-300 max-w-xl">
              Track your borrowed books, upcoming due dates, institutional fine status, and reading history in real time.
            </p>
            {studentInfo && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-slate-300">
                <span>Student: <strong className="text-white">{studentInfo.name || appUser?.name}</strong></span>
                {studentInfo.admissionNo && <span>• Admission No: <strong className="text-white">{studentInfo.admissionNo}</strong></span>}
                {studentInfo.grade && <span>• Grade: <strong className="text-white">{studentInfo.grade} {studentInfo.sectionName ? `(${studentInfo.sectionName})` : ""}</strong></span>}
              </div>
            )}
          </div>

          {/* Borrowing Limit Quota Card */}
          <div className="bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl p-4 md:min-w-[240px] shrink-0 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">Borrowing Quota</span>
              <span className="font-bold text-white">
                {currentlyBorrowed.length} / {maxLimit} Books
              </span>
            </div>
            <div className="h-2 w-full bg-white/20 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  borrowQuotaPercent >= 100
                    ? "bg-rose-400"
                    : borrowQuotaPercent >= 66
                    ? "bg-amber-400"
                    : "bg-emerald-400"
                }`}
                style={{ width: `${borrowQuotaPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-300">
              {currentlyBorrowed.length >= maxLimit
                ? "Maximum borrow limit reached."
                : `You can borrow ${maxLimit - currentlyBorrowed.length} more book(s).`}
            </p>
          </div>
        </div>

        {/* Subtle decorative background blur circle */}
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* 2. Urgent Reminders & Overdue Alerts (Section 4 & 5) */}
      <div className="space-y-3">
        {/* Overdue Warning Banner */}
        {overdueBooks.length > 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/90 p-4 text-rose-900 shadow-xs">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">Action Required: {overdueBooks.length} Book(s) Overdue</span>
                <Badge variant="destructive" className="text-[10px] uppercase font-bold px-2 py-0">
                  Overdue
                </Badge>
              </div>
              <p className="text-xs text-rose-700">
                The following book(s) have passed their return deadline. Please return them to the institutional library immediately to prevent fine accumulation.
              </p>
              <div className="pt-1 flex flex-wrap gap-2">
                {overdueBooks.map((tx) => {
                  const days = Math.abs(getLoanDaysDiff(tx.dueDate, todayStr));
                  const { fineAmount } = calculateOverdueFine(tx.dueDate, todayStr, fineRules);
                  return (
                    <div
                      key={tx.id}
                      onClick={() => handleOpenDetails(tx)}
                      className="inline-flex items-center gap-2 bg-white/80 border border-rose-200 rounded-lg px-2.5 py-1 text-xs text-rose-900 cursor-pointer hover:bg-white transition-colors"
                    >
                      <span className="font-semibold truncate max-w-[200px]">{tx.bookTitle}</span>
                      <span className="text-[11px] text-rose-600 font-bold">({days}d overdue)</span>
                      {fineAmount > 0 && (
                        <span className="text-[10px] font-bold bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded">
                          Fine: ₹{fineAmount}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Due Soon Reminders Banner */}
        {dueSoonBooks.length > 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-amber-900 shadow-xs">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <span className="font-bold text-sm">Library Reminders: Due Soon</span>
              <p className="text-xs text-amber-700">
                You have books due for return within the next {fineRules.reminderDaysBeforeDue || 3} days.
              </p>
              <div className="pt-1 flex flex-wrap gap-2">
                {dueSoonBooks.map((tx) => {
                  const days = getLoanDaysDiff(tx.dueDate, todayStr);
                  return (
                    <div
                      key={tx.id}
                      onClick={() => handleOpenDetails(tx)}
                      className="inline-flex items-center gap-1.5 bg-white/80 border border-amber-200 rounded-lg px-2.5 py-1 text-xs text-amber-900 cursor-pointer hover:bg-white transition-colors"
                    >
                      <span className="font-semibold truncate max-w-[200px]">📚 {tx.bookTitle}</span>
                      <span className="text-[11px] text-amber-700 font-medium">
                        Due in {days === 0 ? "today" : `${days} day${days > 1 ? "s" : ""}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Main Content: Tabs for Currently Borrowed vs History */}
      <Tabs defaultValue="borrowed" className="space-y-4">
        <TabsList className="bg-muted/70 p-1 rounded-2xl">
          <TabsTrigger value="borrowed" className="gap-2 rounded-xl text-xs font-semibold">
            <BookOpen className="w-3.5 h-3.5" />
            Currently Borrowed ({currentlyBorrowed.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2 rounded-xl text-xs font-semibold">
            <History className="w-3.5 h-3.5" />
            Borrowing History ({borrowingHistory.length})
          </TabsTrigger>
        </TabsList>

        {/* ============================================================ */}
        {/* TAB 1: CURRENTLY BORROWED (Section 3 & 4)                   */}
        {/* ============================================================ */}
        <TabsContent value="borrowed" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">Currently Borrowed Books</h2>
              <p className="text-xs text-muted-foreground">
                Active loans issued to your student account by the school librarian.
              </p>
            </div>
            {currentlyBorrowed.length > 0 && (
              <Badge variant="outline" className="text-xs font-semibold">
                {currentlyBorrowed.length} Active {currentlyBorrowed.length === 1 ? "Book" : "Books"}
              </Badge>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs font-medium">Loading your library loans...</span>
            </div>
          ) : currentlyBorrowed.length === 0 ? (
            /* Empty State (Section 14) */
            <Card className="rounded-3xl border border-dashed p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <BookOpen className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-foreground">You currently have no borrowed books</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Explore the library catalog or check back after borrowing a book from the librarian.
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {currentlyBorrowed.map((tx) => {
                const book = booksMap[tx.bookId];
                const daysDiff = getLoanDaysDiff(tx.dueDate, todayStr);
                const isOverdue = daysDiff < 0 || tx.status === "overdue";
                const isDueSoon = !isOverdue && daysDiff <= (fineRules.reminderDaysBeforeDue || 3);
                const { fineAmount } = calculateOverdueFine(tx.dueDate, todayStr, fineRules);

                return (
                  <Card
                    key={tx.id}
                    className={`rounded-2xl overflow-hidden border transition-all duration-200 hover:shadow-md ${
                      isOverdue
                        ? "border-rose-300 bg-rose-50/20"
                        : isDueSoon
                        ? "border-amber-300 bg-amber-50/20"
                        : "border-border/80 bg-card"
                    }`}
                  >
                    <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                      <div className="flex items-start gap-4">
                        {/* Book Cover Image */}
                        <div className="w-16 h-22 rounded-xl bg-muted/60 border overflow-hidden shrink-0 flex items-center justify-center shadow-xs">
                          {book?.coverImageUrl ? (
                            <img
                              src={book.coverImageUrl}
                              alt={tx.bookTitle}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-muted-foreground/60 p-2 text-center">
                              <BookOpen className="w-6 h-6 text-primary/40 mb-1" />
                              <span className="text-[9px] font-semibold uppercase leading-tight line-clamp-2">
                                {tx.bookTitle}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Title & Metadata */}
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isOverdue ? (
                              <Badge variant="destructive" className="text-[9px] px-1.5 py-0 uppercase font-bold">
                                Overdue
                              </Badge>
                            ) : isDueSoon ? (
                              <Badge className="bg-amber-500 text-white text-[9px] px-1.5 py-0 uppercase font-bold">
                                Due Soon
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-medium text-emerald-700 bg-emerald-50 border-emerald-200">
                                Issued
                              </Badge>
                            )}
                            {book?.category && (
                              <span className="text-[10px] text-muted-foreground capitalize">
                                • {book.category.replace("_", " ")}
                              </span>
                            )}
                          </div>

                          <h3 className="font-bold text-sm text-foreground line-clamp-2 leading-snug">
                            {tx.bookTitle}
                          </h3>
                          <p className="text-xs text-muted-foreground truncate">
                            By {book?.author || "Author not listed"}
                          </p>

                          <div className="pt-1">
                            <span className="inline-block text-[10px] font-mono bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded border">
                              {tx.accessionNumber}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Loan Timelines */}
                      <div className="rounded-xl border bg-muted/20 p-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" /> Issued:
                          </span>
                          <span className="font-medium text-foreground">
                            {new Date(tx.issueDate).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" /> Due Date:
                          </span>
                          <span className={`font-semibold ${isOverdue ? "text-rose-600" : "text-foreground"}`}>
                            {new Date(tx.dueDate).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>

                        {/* Status Days countdown */}
                        <div className="pt-1 border-t flex items-center justify-between text-xs">
                          {isOverdue ? (
                            <span className="font-bold text-rose-600">
                              {Math.abs(daysDiff)} {Math.abs(daysDiff) === 1 ? "day" : "days"} overdue
                            </span>
                          ) : daysDiff === 0 ? (
                            <span className="font-bold text-amber-600">Due today</span>
                          ) : (
                            <span className="font-medium text-emerald-700">
                              Due in {daysDiff} {daysDiff === 1 ? "day" : "days"}
                            </span>
                          )}

                          {isOverdue && fineAmount > 0 && (
                            <span className="text-[11px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded">
                              Fine: ₹{fineAmount}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Action */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenDetails(tx)}
                        className="w-full text-xs font-semibold gap-1 rounded-xl"
                      >
                        <span>View Details</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 2: BORROWING HISTORY (Section 6)                        */}
        {/* ============================================================ */}
        <TabsContent value="history" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">Borrowing History</h2>
              <p className="text-xs text-muted-foreground">
                Chronological record of previously returned and completed library loans.
              </p>
            </div>
            {borrowingHistory.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {borrowingHistory.length} Total {borrowingHistory.length === 1 ? "Record" : "Records"}
              </Badge>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs font-medium">Loading borrowing history...</span>
            </div>
          ) : borrowingHistory.length === 0 ? (
            /* Empty State (Section 14) */
            <Card className="rounded-3xl border border-dashed p-10 text-center space-y-2">
              <History className="w-10 h-10 text-muted-foreground/40 mx-auto" />
              <h3 className="font-bold text-sm text-foreground">No borrowing history yet</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Books you return in the future will automatically appear here for your academic records.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {paginatedHistory.map((tx) => {
                  const book = booksMap[tx.bookId];
                  return (
                    <Card
                      key={tx.id}
                      className="rounded-2xl border bg-card hover:bg-muted/10 transition-colors cursor-pointer"
                      onClick={() => handleOpenDetails(tx)}
                    >
                      <CardContent className="p-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-14 rounded-lg bg-muted border overflow-hidden shrink-0 flex items-center justify-center">
                            {book?.coverImageUrl ? (
                              <img src={book.coverImageUrl} alt={tx.bookTitle} className="w-full h-full object-cover" />
                            ) : (
                              <BookOpen className="w-5 h-5 text-muted-foreground/50" />
                            )}
                          </div>
                          <div className="space-y-0.5 min-w-0">
                            <h4 className="font-bold text-xs text-foreground truncate max-w-[220px]">
                              {tx.bookTitle}
                            </h4>
                            <p className="text-[11px] text-muted-foreground truncate">
                              By {book?.author || "Author not listed"}
                            </p>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-0.5">
                              <span>Issued: {new Date(tx.issueDate).toLocaleDateString()}</span>
                              {tx.returnDate && (
                                <span>• Returned: {new Date(tx.returnDate).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                            Returned
                          </Badge>
                          {tx.fineAmount > 0 && (
                            <span className={`text-[10px] font-semibold ${
                              tx.finePaidStatus === "paid" ? "text-emerald-600" : "text-rose-600"
                            }`}>
                              Fine: ₹{tx.fineAmount} ({tx.finePaidStatus})
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* History Pagination */}
              {totalHistoryPages > 1 && (
                <div className="flex items-center justify-between pt-2 px-1">
                  <p className="text-xs text-muted-foreground">
                    Page {historyPage} of {totalHistoryPages}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={historyPage === 1}
                      className="h-8 text-xs gap-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryPage((p) => Math.min(totalHistoryPages, p + 1))}
                      disabled={historyPage === totalHistoryPages}
                      className="h-8 text-xs gap-1"
                    >
                      Next <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ============================================================ */}
      {/* 4. BOOK DETAILS DIALOG (Section 7)                          */}
      {/* ============================================================ */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              Book Loan Details
            </DialogTitle>
            <DialogDescription className="text-xs">
              Official institutional library record for this copy.
            </DialogDescription>
          </DialogHeader>

          {selectedTx && (
            <div className="space-y-4 py-2 text-xs">
              {/* Book Overview Header */}
              <div className="flex gap-3.5 p-3 rounded-xl bg-muted/30 border">
                <div className="w-16 h-22 rounded-lg bg-white border overflow-hidden shrink-0 flex items-center justify-center">
                  {selectedBook?.coverImageUrl ? (
                    <img src={selectedBook.coverImageUrl} alt={selectedTx.bookTitle} className="w-full h-full object-cover" />
                  ) : (
                    <BookOpen className="w-8 h-8 text-muted-foreground/40" />
                  )}
                </div>
                <div className="space-y-1 min-w-0 flex-1">
                  <h3 className="font-bold text-sm text-foreground leading-snug line-clamp-2">
                    {selectedTx.bookTitle}
                  </h3>
                  <p className="text-muted-foreground">By {selectedBook?.author || "Author not listed"}</p>
                  {selectedBook?.category && (
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {selectedBook.category.replace("_", " ")}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Data Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded-xl border bg-muted/10 space-y-0.5">
                  <span className="text-[10px] text-muted-foreground font-medium">Accession Number</span>
                  <p className="font-mono font-semibold text-foreground">{selectedTx.accessionNumber}</p>
                </div>
                <div className="p-2.5 rounded-xl border bg-muted/10 space-y-0.5">
                  <span className="text-[10px] text-muted-foreground font-medium">ISBN</span>
                  <p className="font-mono font-semibold text-foreground">{selectedBook?.isbn || "—"}</p>
                </div>
                <div className="p-2.5 rounded-xl border bg-muted/10 space-y-0.5">
                  <span className="text-[10px] text-muted-foreground font-medium">Issue Date</span>
                  <p className="font-semibold text-foreground">{selectedTx.issueDate}</p>
                </div>
                <div className="p-2.5 rounded-xl border bg-muted/10 space-y-0.5">
                  <span className="text-[10px] text-muted-foreground font-medium">Due Date</span>
                  <p className="font-semibold text-foreground">{selectedTx.dueDate}</p>
                </div>
                {selectedTx.returnDate && (
                  <div className="p-2.5 rounded-xl border bg-muted/10 space-y-0.5 col-span-2">
                    <span className="text-[10px] text-muted-foreground font-medium">Return Date</span>
                    <p className="font-semibold text-foreground">{selectedTx.returnDate}</p>
                  </div>
                )}
                {selectedBook?.shelfLocation && (
                  <div className="p-2.5 rounded-xl border bg-muted/10 space-y-0.5 col-span-2">
                    <span className="text-[10px] text-muted-foreground font-medium">Library Shelf Location</span>
                    <p className="font-medium text-foreground">{selectedBook.shelfLocation}</p>
                  </div>
                )}
              </div>

              {/* Status & Fine Evaluation */}
              <div className="p-3 rounded-xl border space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Loan Status</span>
                  <Badge
                    variant={selectedTx.status === "returned" ? "secondary" : "outline"}
                    className="capitalize text-[10px]"
                  >
                    {selectedTx.status}
                  </Badge>
                </div>

                {selectedTx.status !== "returned" && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Timeline</span>
                    {(() => {
                      const diff = getLoanDaysDiff(selectedTx.dueDate, todayStr);
                      if (diff < 0) {
                        return <span className="font-bold text-rose-600">{Math.abs(diff)} days overdue</span>;
                      }
                      if (diff === 0) {
                        return <span className="font-bold text-amber-600">Due today</span>;
                      }
                      return <span className="font-medium text-emerald-700">Due in {diff} days</span>;
                    })()}
                  </div>
                )}

                {(() => {
                  const { fineAmount } = calculateOverdueFine(selectedTx.dueDate, todayStr, fineRules);
                  const effectiveFine = selectedTx.status === "returned" ? selectedTx.fineAmount : fineAmount;
                  if (effectiveFine > 0) {
                    return (
                      <div className="flex items-center justify-between pt-1 border-t">
                        <span className="text-rose-600 font-semibold">Overdue Fine</span>
                        <span className="font-bold text-rose-600">
                          ₹{effectiveFine} ({selectedTx.finePaidStatus || "pending"})
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {selectedBook?.description && (
                <div className="space-y-1">
                  <span className="text-[10px] text-muted-foreground font-medium">Description</span>
                  <p className="text-muted-foreground text-xs leading-relaxed max-h-24 overflow-y-auto">
                    {selectedBook.description}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsDetailsOpen(false)} className="w-full">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

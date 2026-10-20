import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Standard page skeleton with title, description, action button, and content area
 */
export function PageSkeleton({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-6 animate-in fade-in-50 duration-300", className)}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border/40">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48 sm:w-64" />
          <Skeleton className="h-4 w-64 sm:w-96" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>

      {/* Main Content Area */}
      {children || <TableSkeleton rows={5} columns={5} />}
    </div>
  );
}

/**
 * Dashboard skeleton with KPI stat cards grid and chart/table placeholders
 */
export function DashboardSkeleton({
  cardsCount = 4,
  className,
}: {
  cardsCount?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-6 animate-in fade-in-50 duration-300", className)}>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: cardsCount }).map((_, i) => (
          <Card key={i} className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-6 rounded-full" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Panel Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border shadow-sm">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-60" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-64 w-full rounded-md" />
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-3 w-48" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Table skeleton with customizable row and column count, headers, and pagination bar
 */
export function TableSkeleton({
  rows = 5,
  columns = 4,
  showToolbar = true,
  className,
}: {
  rows?: number;
  columns?: number;
  showToolbar?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("border shadow-sm overflow-hidden", className)}>
      {showToolbar && (
        <div className="p-4 border-b border-border/40 flex flex-col sm:flex-row items-center justify-between gap-3 bg-muted/20">
          <Skeleton className="h-9 w-full sm:w-64 rounded-md" />
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>
      )}

      {/* Table responsive container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40">
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="p-3.5">
                  <Skeleton className="h-4 w-20 sm:w-28" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r} className="hover:bg-muted/10 transition-colors">
                {Array.from({ length: columns }).map((_, c) => (
                  <td key={c} className="p-3.5">
                    {c === 0 ? (
                      <div className="flex items-center gap-2.5">
                        <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                        <Skeleton className="h-4 w-24 sm:w-36" />
                      </div>
                    ) : c === columns - 1 ? (
                      <div className="flex items-center gap-2 justify-end">
                        <Skeleton className="h-7 w-16 rounded-md" />
                      </div>
                    ) : (
                      <Skeleton className="h-3.5 w-16 sm:w-24" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-3.5 border-t border-border/40 flex items-center justify-between bg-muted/10">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>
    </Card>
  );
}

/**
 * Card grid skeleton for student lists, teacher cards, class tiles, etc.
 */
export function CardGridSkeleton({
  count = 6,
  columns = 3,
  className,
}: {
  count?: number;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const colClass = {
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
  }[columns];

  return (
    <div className={cn("grid gap-4", colClass, className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="border shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <div className="space-y-2 pt-2 border-t border-border/40">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="pt-2 flex items-center justify-between gap-2">
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="h-7 w-16 rounded-md" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Form skeleton for editor panels, admission forms, settings
 */
export function FormSkeleton({
  fieldGroups = 3,
  fieldsPerGroup = 2,
  className,
}: {
  fieldGroups?: number;
  fieldsPerGroup?: number;
  className?: string;
}) {
  return (
    <Card className={cn("border shadow-sm", className)}>
      <CardHeader className="space-y-2 border-b border-border/40 pb-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3.5 w-72" />
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {Array.from({ length: fieldGroups }).map((_, g) => (
          <div key={g} className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: fieldsPerGroup }).map((_, f) => (
                <div key={f} className="space-y-2">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="pt-4 border-t border-border/40 flex items-center justify-end gap-3">
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * User / Staff / Student Profile skeleton
 */
export function ProfileSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6 animate-in fade-in-50 duration-300", className)}>
      {/* Profile Header Hero */}
      <Card className="border shadow-sm overflow-hidden">
        <Skeleton className="h-28 w-full bg-gradient-to-r from-muted/60 to-muted/20" />
        <CardContent className="relative pt-0 pb-6 px-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 -mt-12 sm:-mt-14 mb-4">
            <Skeleton className="h-24 w-24 rounded-full border-4 border-background shrink-0" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-48" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-4 w-24 rounded-full" />
                <Skeleton className="h-4 w-32 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-9 w-32 rounded-md shrink-0" />
          </div>
        </CardContent>
      </Card>

      {/* Tabs / Info Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="border shadow-sm p-4 space-y-4">
          <Skeleton className="h-5 w-32" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="lg:col-span-2 border shadow-sm p-4 space-y-4">
          <Skeleton className="h-5 w-40" />
          <TableSkeleton rows={4} columns={3} showToolbar={false} />
        </Card>
      </div>
    </div>
  );
}

/**
 * Detail Page skeleton (e.g., Exam Schedule Detail, Report Card Viewer)
 */
export function DetailPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6 animate-in fade-in-50 duration-300", className)}>
      {/* Header and status badge */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border/40">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-7 w-64" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Document Body */}
      <Card className="border shadow-sm p-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4 border-b border-border/40">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
        <TableSkeleton rows={5} columns={4} showToolbar={false} />
      </Card>
    </div>
  );
}

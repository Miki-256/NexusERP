"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TableToolbar({
  search,
  onSearchChange,
  onSearchSubmit,
  placeholder = "Search…",
  actions,
  className,
  filterOpen,
  onFilterOpenChange,
  filterContent,
  filterActive,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
  placeholder?: string;
  actions?: React.ReactNode;
  className?: string;
  /** Controlled filter panel (opens when Filter is clicked). */
  filterOpen?: boolean;
  onFilterOpenChange?: (open: boolean) => void;
  filterContent?: React.ReactNode;
  /** Highlight Filter when non-default filters are applied. */
  filterActive?: boolean;
}) {
  const hasFilterPanel = filterContent !== undefined && onFilterOpenChange !== undefined;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-3">
        {onSearchChange !== undefined && (
          <div className="relative min-w-[140px] flex-1 max-w-sm sm:min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearchSubmit?.();
              }}
              placeholder={placeholder}
              className="h-9 pl-9"
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          {hasFilterPanel && (
            <Button
              type="button"
              variant={filterOpen || filterActive ? "default" : "outline"}
              size="sm"
              className="h-9 cursor-pointer gap-1.5"
              aria-expanded={filterOpen}
              aria-controls="table-filter-panel"
              onClick={() => onFilterOpenChange(!filterOpen)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filter
              {filterActive && !filterOpen ? (
                <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-primary-foreground/80" aria-hidden />
              ) : null}
            </Button>
          )}
        </div>
      </div>

      {hasFilterPanel && filterOpen ? (
        <div
          id="table-filter-panel"
          className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-muted/30 p-4"
        >
          {filterContent}
        </div>
      ) : null}
    </div>
  );
}

export function TablePagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">
        {total} result{total === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="px-2 tabular-nums text-muted-foreground">
          {page} / {Math.max(totalPages, 1)}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

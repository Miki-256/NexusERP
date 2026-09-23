"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function TableToolbar({
  search,
  onSearchChange,
  onSearchSubmit,
  placeholder,
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
  const t = useTranslations("common");
  const hasFilterPanel = filterContent !== undefined && onFilterOpenChange !== undefined;
  const resolvedPlaceholder = placeholder ?? t("searchEllipsis");

  return (
    <div
      className={cn(
        "sticky top-0 z-10 space-y-1.5 border-b border-border/60 bg-background/95 py-1.5 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {onSearchChange !== undefined && (
          <div className="relative min-w-[140px] flex-1 max-w-sm sm:min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearchSubmit?.();
              }}
              placeholder={resolvedPlaceholder}
              className="h-control pl-9"
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {actions}
          {hasFilterPanel && (
            <Button
              type="button"
              variant={filterOpen || filterActive ? "default" : "outline"}
              size="sm"
              className="h-control cursor-pointer gap-1.5"
              aria-expanded={filterOpen}
              aria-controls="table-filter-panel"
              onClick={() => onFilterOpenChange(!filterOpen)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t("filter")}
              {filterActive && !filterOpen ? (
                <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-primary-foreground/80" aria-hidden />
              ) : null}
            </Button>
          )}
        </div>
      </div>

      {/* Desktop / tablet: inline filter panel */}
      {hasFilterPanel && filterOpen ? (
        <div
          id="table-filter-panel"
          className="hidden flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-2.5 sm:flex sm:gap-3 sm:p-3"
        >
          {filterContent}
        </div>
      ) : null}

      {/* Mobile: bottom sheet for filters */}
      {hasFilterPanel && (
        <div className="sm:hidden">
          <Sheet open={!!filterOpen} onOpenChange={onFilterOpenChange}>
            <SheetContent side="bottom" showClose>
              <SheetHeader>
                <SheetTitle>{t("filter")}</SheetTitle>
              </SheetHeader>
              <SheetBody className="flex flex-col gap-3">{filterContent}</SheetBody>
              <SheetFooter>
                <Button type="button" className="w-full" onClick={() => onFilterOpenChange?.(false)}>
                  {t("apply")}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      )}
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
  const t = useTranslations("common");

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">{t("resultsCount", { count: total })}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t("previous")}
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
          {t("next")}
        </Button>
      </div>
    </div>
  );
}

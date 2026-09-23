import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
  className,
  compact,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
  /** Extra-tight header (list modules). Default already dense for Wave 1A. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-b border-border",
        compact ? "pb-1.5 sm:pb-2" : "pb-2 sm:pb-2.5",
        className
      )}
    >
      {breadcrumb && <div className="mb-1">{breadcrumb}</div>}
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0 space-y-0.5">
          <h1 className="font-heading text-base font-semibold tracking-tight text-foreground sm:text-lg">
            {title}
          </h1>
          {description && (
            <p className="page-header-desc hidden max-w-2xl text-xs leading-snug text-muted-foreground lg:line-clamp-1 lg:block">
              {description}
            </p>
          )}
        </div>
        {action && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

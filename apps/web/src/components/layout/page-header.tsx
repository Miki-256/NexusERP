import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  breadcrumb?: string;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-border pb-6", className)}>
      {breadcrumb && (
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {breadcrumb}
        </p>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground lg:text-2xl">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

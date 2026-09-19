import { cn } from "@/lib/utils";
import { PANEL, PANEL_BODY, PANEL_HEADER } from "@/lib/ui-classes";

/** Dense titled section — prefer over FormCard for read-only / list blocks. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  headerClassName,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
}) {
  return (
    <div className={cn(PANEL, className)}>
      {(title || description || action) && (
        <div className={cn(PANEL_HEADER, headerClassName)}>
          <div className="min-w-0 space-y-0.5">
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={cn(PANEL_BODY, bodyClassName)}>{children}</div>
    </div>
  );
}

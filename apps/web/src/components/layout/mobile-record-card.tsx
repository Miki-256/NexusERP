import { cn } from "@/lib/utils";

export function MobileRecordCard({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border border-border bg-card p-2.5 text-left shadow-none transition-colors sm:p-3",
        onClick && "cursor-pointer hover:bg-muted/30 active:bg-muted/50",
        className
      )}
    >
      {children}
    </Tag>
  );
}

export function MobileRecordCardRow({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-2 text-sm", className)}>
      {label && <span className="shrink-0 text-xs text-muted-foreground">{label}</span>}
      <div className="min-w-0 flex-1 text-right text-[13px] font-medium sm:text-sm">{children}</div>
    </div>
  );
}

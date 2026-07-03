import { cn } from "@/lib/utils";

const HIDE_BELOW: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export function DataTable({
  children,
  className,
  toolbar,
}: {
  children: React.ReactNode;
  className?: string;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      {toolbar && <div className="border-b border-border bg-muted/40 px-4 py-3">{toolbar}</div>}
      <div className="overflow-x-auto scrollbar-thin">
          <div className="relative min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function DataTableHeader({ children, sticky }: { children: React.ReactNode; sticky?: boolean }) {
  return (
    <thead className={cn(sticky !== false && "sticky top-0 z-10")}>
      <tr className="border-b border-border bg-muted/50">{children}</tr>
    </thead>
  );
}

export function DataTableHead({
  children,
  className,
  align = "left",
  hideBelow,
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  hideBelow?: keyof typeof HIDE_BELOW;
}) {
  const hideClass = hideBelow ? HIDE_BELOW[hideBelow] : undefined;
  return (
    <th
      className={cn(
        "whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        hideClass,
        className
      )}
    >
      {children}
    </th>
  );
}

export function DataTableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function DataTableRow({
  children,
  className,
  selected,
}: {
  children: React.ReactNode;
  className?: string;
  selected?: boolean;
}) {
  return (
    <tr
      className={cn(
        "transition-colors duration-150 hover:bg-muted/30",
        selected && "bg-muted/50",
        className
      )}
    >
      {children}
    </tr>
  );
}

export function DataTableCell({
  children,
  className,
  align = "left",
  hideBelow,
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  hideBelow?: keyof typeof HIDE_BELOW;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3 text-sm text-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
        hideBelow && HIDE_BELOW[hideBelow],
        className
      )}
    >
      {children}
    </td>
  );
}

export function DataTableEmpty({
  colSpan,
  message,
  icon,
}: {
  colSpan: number;
  message: string;
  icon?: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center">
        {icon && <div className="mb-3 flex justify-center text-muted-foreground">{icon}</div>}
        <p className="text-sm text-muted-foreground">{message}</p>
      </td>
    </tr>
  );
}

export function DataTableFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}

import { cn } from "@/lib/utils";

export function ReportSection({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("enterprise-panel", className)}>
      <div className="enterprise-panel-header">
        <div>
          <h2 className="font-heading text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatementTable({
  rows,
  footer,
}: {
  rows: {
    label: string;
    value?: string;
    bold?: boolean;
    indent?: boolean;
    section?: boolean;
    border?: boolean;
    muted?: boolean;
  }[];
  footer?: React.ReactNode;
}) {
  return (
    <div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, i) =>
            row.section ? (
              <tr key={i}>
                <td
                  colSpan={2}
                  className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {row.label}
                </td>
              </tr>
            ) : (
              <tr key={i} className={row.border ? "border-t border-border" : ""}>
                <td
                  className={cn(
                    "py-2.5",
                    row.indent && "pl-4 text-muted-foreground",
                    row.bold && "font-semibold text-foreground",
                    row.muted && "text-xs text-muted-foreground"
                  )}
                >
                  {row.label}
                </td>
                <td
                  className={cn(
                    "py-2.5 text-right font-mono tabular-nums",
                    row.bold && "font-semibold",
                    row.muted && "text-xs"
                  )}
                >
                  {row.value ?? ""}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

export function ComparativeStatementTable({
  rows,
  currentLabel,
  priorLabel,
}: {
  rows: {
    label: string;
    current: string;
    prior: string;
    variance: string;
    bold?: boolean;
    indent?: boolean;
    border?: boolean;
  }[];
  currentLabel: string;
  priorLabel: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="pb-2 text-left font-medium">Line item</th>
            <th className="pb-2 text-right font-medium">{currentLabel}</th>
            <th className="pb-2 text-right font-medium">{priorLabel}</th>
            <th className="pb-2 text-right font-medium">Variance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={row.border ? "border-t border-border" : ""}>
              <td
                className={cn(
                  "py-2.5",
                  row.indent && "pl-4 text-muted-foreground",
                  row.bold && "font-semibold"
                )}
              >
                {row.label}
              </td>
              <td className={cn("py-2.5 text-right font-mono tabular-nums", row.bold && "font-semibold")}>
                {row.current}
              </td>
              <td className={cn("py-2.5 text-right font-mono tabular-nums text-muted-foreground", row.bold && "font-semibold")}>
                {row.prior}
              </td>
              <td className={cn("py-2.5 text-right font-mono tabular-nums", row.bold && "font-semibold")}>
                {row.variance}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

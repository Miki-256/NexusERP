import { cn } from "@/lib/utils";

/**
 * Shows card/list layout on mobile and table layout on lg+.
 * Wrap the desktop `<DataTable>` in the second child.
 */
export function ResponsiveTableLayout({
  mobile,
  children,
  className,
}: {
  mobile: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      <div className="space-y-3 lg:hidden">{mobile}</div>
      <div className="hidden lg:block">{children}</div>
    </div>
  );
}

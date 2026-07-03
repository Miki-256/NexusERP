import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function FormCard({
  title,
  description,
  children,
  className,
  onSubmit,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  onSubmit?: (e: React.FormEvent) => void;
  footer?: React.ReactNode;
}) {
  const body = onSubmit ? (
    <form className="space-y-6" onSubmit={onSubmit}>
      {children}
      {footer && <div className="flex items-center gap-3 border-t border-border/60 pt-4">{footer}</div>}
    </form>
  ) : (
    <>
      <div className="space-y-6">{children}</div>
      {footer && <div className="mt-6 flex items-center gap-3 border-t border-border/60 pt-4">{footer}</div>}
    </>
  );

  return (
    <Card className={cn("border-border", className)}>
      <CardHeader className="border-b border-border bg-muted/40 pb-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="pt-6">{body}</CardContent>
    </Card>
  );
}

export function FormSection({
  title,
  description,
  children,
  columns = 1,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <div className="space-y-4">
      {(title || description) && (
        <div className="space-y-1">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div
        className={cn(
          "grid gap-4",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-2 lg:grid-cols-3"
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function FormField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label className="text-sm font-medium leading-none text-foreground">{label}</label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

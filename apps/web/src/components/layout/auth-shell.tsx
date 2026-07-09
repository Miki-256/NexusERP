import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/loading/loading-spinner";

export function AuthShell({
  title,
  description,
  children,
  footer,
  busy,
  busyMessage = "Please wait…",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  busy?: boolean;
  busyMessage?: string;
}) {
  return (
    <main className="safe-area-top safe-area-bottom flex min-h-[100dvh] items-center justify-center bg-muted/30 p-4 sm:p-6">
      <div className="w-full max-w-[400px] animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-foreground text-sm font-bold text-background">
            N
          </div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="relative rounded-lg border border-border bg-card p-6">
          {busy && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-card/95 backdrop-blur-sm"
              aria-live="polite"
              aria-busy="true"
            >
              <LoadingSpinner size="lg" />
              <p className="text-sm font-medium text-foreground">{busyMessage}</p>
            </div>
          )}
          <div className={cn(busy && "pointer-events-none select-none opacity-40")}>{children}</div>
        </div>
        {footer && (
          <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
        )}
      </div>
    </main>
  );
}

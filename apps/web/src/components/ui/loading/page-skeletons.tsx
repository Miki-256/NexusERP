import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function Stagger({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div className="nexus-stagger-item" style={{ animationDelay: `${index * 45}ms` }}>
      {children}
    </div>
  );
}

export function PageSkeletonHeader() {
  return (
    <Stagger index={0}>
      <div className="space-y-3">
        <Skeleton className="skeleton-glass h-3 w-24" />
        <Skeleton className="skeleton-glass h-8 w-64 max-w-full" />
        <Skeleton className="skeleton-glass h-4 w-96 max-w-full" />
      </div>
    </Stagger>
  );
}

export function DashboardPageSkeleton() {
  return (
    <div className="nexus-stagger space-y-8">
      <PageSkeletonHeader />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Stagger key={i} index={i + 1}>
            <Skeleton className="skeleton-glass h-[108px] rounded-xl" />
          </Stagger>
        ))}
      </div>
      <Stagger index={5}>
        <Skeleton className="skeleton-glass h-80 rounded-xl" />
      </Stagger>
      <div className="grid gap-6 lg:grid-cols-3">
        <Stagger index={6}>
          <Skeleton className="skeleton-glass h-80 rounded-xl lg:col-span-2" />
        </Stagger>
        <Stagger index={7}>
          <Skeleton className="skeleton-glass h-80 rounded-xl" />
        </Stagger>
      </div>
    </div>
  );
}

export function TablePageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="nexus-stagger space-y-6">
      <PageSkeletonHeader />
      <Stagger index={1}>
        <Skeleton className="skeleton-glass h-11 w-full max-w-md rounded-lg" />
      </Stagger>
      <Stagger index={2}>
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm">
          <div className="flex gap-4 border-b border-border/60 bg-muted/30 px-4 py-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="skeleton-glass h-3 flex-1" />
            ))}
          </div>
          <div className="divide-y divide-border/40">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="skeleton-glass h-9 w-9 shrink-0 rounded-lg" />
                <div className="flex flex-1 gap-3">
                  <Skeleton className="skeleton-glass h-4 flex-[2]" />
                  <Skeleton className="skeleton-glass h-4 flex-1" />
                  <Skeleton className="skeleton-glass h-4 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Stagger>
    </div>
  );
}

export function FormPageSkeleton() {
  return (
    <div className="nexus-stagger space-y-6">
      <PageSkeletonHeader />
      <Stagger index={1}>
        <div className="rounded-xl border border-border/60 bg-card/50 p-6 backdrop-blur-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cn("space-y-2", i >= 4 && "sm:col-span-2")}>
                <Skeleton className="skeleton-glass h-3 w-20" />
                <Skeleton className="skeleton-glass h-10 w-full rounded-md" />
              </div>
            ))}
          </div>
          <Skeleton className="skeleton-glass mt-6 h-10 w-32 rounded-md" />
        </div>
      </Stagger>
    </div>
  );
}

export function AuthPageSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="nexus-stagger w-full max-w-[400px] space-y-4 rounded-xl border border-border/60 bg-card/80 p-8 backdrop-blur-sm">
        <Stagger index={0}>
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <Skeleton className="skeleton-glass h-6 w-6 rounded-md" />
          </div>
        </Stagger>
        <Stagger index={1}>
          <Skeleton className="skeleton-glass mx-auto h-7 w-48" />
        </Stagger>
        <Stagger index={2}>
          <Skeleton className="skeleton-glass mx-auto h-4 w-64 max-w-full" />
        </Stagger>
        <div className="space-y-3 pt-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Stagger key={i} index={i + 3}>
              <Skeleton className="skeleton-glass h-10 w-full rounded-md" />
            </Stagger>
          ))}
        </div>
        <Stagger index={6}>
          <Skeleton className="skeleton-glass h-10 w-full rounded-md" />
        </Stagger>
      </div>
    </div>
  );
}

export function AdminPageSkeleton() {
  return (
    <div className="nexus-stagger space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Stagger key={i} index={i}>
            <Skeleton className="skeleton-glass h-24 rounded-xl" />
          </Stagger>
        ))}
      </div>
      <TablePageSkeleton rows={6} />
    </div>
  );
}

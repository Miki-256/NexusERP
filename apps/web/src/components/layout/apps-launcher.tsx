import Link from "next/link";
import { cn } from "@/lib/utils";
import { APP_CATEGORIES, visibleApps, type AppDef } from "@/lib/apps-registry";

function AppTile({ app }: { app: AppDef }) {
  const Icon = app.icon;
  return (
    <Link
      href={app.href}
      prefetch
      className={cn(
        "group flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-card p-4",
        "transition-colors duration-150 hover:border-foreground/20 hover:bg-muted/30"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground transition-colors group-hover:text-foreground">
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-foreground">{app.name}</p>
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{app.description}</p>
    </Link>
  );
}

export function AppsLauncher({
  accessibleAppIds,
  compact,
}: {
  orgName?: string;
  accessibleAppIds: string[];
  compact?: boolean;
}) {
  const apps = visibleApps(accessibleAppIds);
  const byCategory = APP_CATEGORIES.map((cat) => ({
    ...cat,
    apps: apps.filter((a) => a.category === cat.key),
  })).filter((g) => g.apps.length > 0);

  return (
    <div className={cn("space-y-6", compact && "space-y-5")}>
      {!compact && (
        <div className="enterprise-panel p-6 lg:p-8">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Applications</p>
          <h2 className="mt-1 font-heading text-lg font-semibold">All modules</h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Launch any business app from one place. Unified data across sales, finance, inventory, and HR.
          </p>
        </div>
      )}

      {byCategory.map((group) => (
        <section key={group.key} className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {group.apps.map((app) => (
              <AppTile key={app.id} app={app} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

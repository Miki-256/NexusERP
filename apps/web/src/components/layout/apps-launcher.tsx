"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { APP_CATEGORIES, visibleApps, type AppDef } from "@/lib/apps-registry";

function AppTile({ app, dense }: { app: AppDef; dense?: boolean }) {
  const tNav = useTranslations("nav");
  const Icon = app.icon;
  const name = tNav(`apps.${app.id}.name`);
  const description = tNav(`apps.${app.id}.description`);
  return (
    <Link
      href={app.href}
      prefetch
      className={cn(
        "group flex cursor-pointer flex-col rounded-lg border border-border bg-card",
        dense ? "gap-1.5 p-2.5" : "gap-2 p-3 sm:gap-3 sm:p-4",
        "transition-colors duration-150 hover:border-foreground/20 hover:bg-muted/30"
      )}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground transition-colors group-hover:text-foreground",
            dense ? "h-8 w-8" : "h-9 w-9"
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-foreground">{name}</p>
      </div>
      {!dense && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
    </Link>
  );
}

const PINNED_IDS = ["pos", "sales", "products", "purchasing", "inventory", "accounting", "reports", "settings"] as const;

export function AppsLauncher({
  accessibleAppIds,
  compact,
  pinned,
}: {
  orgName?: string;
  accessibleAppIds: string[];
  compact?: boolean;
  /** Show a short pinned grid instead of full category lists (mobile-friendly). */
  pinned?: boolean;
}) {
  const t = useTranslations("nav.launcher");
  const tNav = useTranslations("nav");
  const apps = visibleApps(accessibleAppIds);

  if (pinned) {
    const pinnedApps = PINNED_IDS.map((id) => apps.find((a) => a.id === id)).filter(
      Boolean
    ) as AppDef[];
    const extras = apps.filter((a) => !PINNED_IDS.includes(a.id as (typeof PINNED_IDS)[number]));
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {pinnedApps.map((app) => (
            <AppTile key={app.id} app={app} dense />
          ))}
        </div>
        {extras.length > 0 && (
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
              More modules ({extras.length})
            </summary>
            <div className="grid grid-cols-2 gap-2 border-t border-border p-2 sm:grid-cols-3 md:grid-cols-4">
              {extras.map((app) => (
                <AppTile key={app.id} app={app} dense />
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  const byCategory = APP_CATEGORIES.map((cat) => ({
    ...cat,
    apps: apps.filter((a) => a.category === cat.key),
  })).filter((g) => g.apps.length > 0);

  return (
    <div className={cn("space-y-3 sm:space-y-4", compact && "space-y-3")}>
      {!compact && (
        <div className="enterprise-panel p-3 sm:p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("eyebrow")}
          </p>
          <h2 className="mt-1 font-heading text-base font-semibold sm:text-lg">{t("title")}</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      )}

      {byCategory.map((group) => (
        <section key={group.key} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {group.key === "hr" ? t("hrFull") : tNav(`categories.${group.key}`)}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {group.apps.map((app) => (
              <AppTile key={app.id} app={app} dense={compact} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

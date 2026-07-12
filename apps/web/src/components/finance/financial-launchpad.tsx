"use client";

import {
  BarChart3,
  Banknote,
  BookOpen,
  Bot,
  Building2,
  Calendar,
  Clock,
  Coins,
  FileText,
  Gauge,
  GitBranch,
  HardHat,
  Landmark,
  LayoutDashboard,
  LineChart,
  List,
  Network,
  PenLine,
  Receipt,
  Scale,
  Shield,
  Target,
  TrendingUp,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LaunchpadArea, LaunchpadTile, FinancialShellTab } from "@/lib/finance/financial-shell-config";

const ICONS: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  gauge: Gauge,
  "trending-up": TrendingUp,
  scale: Scale,
  wallet: Wallet,
  "book-open": BookOpen,
  "file-text": FileText,
  "bar-chart-3": BarChart3,
  list: List,
  "git-branch": GitBranch,
  "pen-line": PenLine,
  calendar: Calendar,
  clock: Clock,
  landmark: Landmark,
  banknote: Banknote,
  coins: Coins,
  receipt: Receipt,
  shield: Shield,
  target: Target,
  "line-chart": LineChart,
  "hard-hat": HardHat,
  "building-2": Building2,
  network: Network,
  zap: Zap,
  bot: Bot,
};

const ACCENT: Record<string, string> = {
  blue: "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10",
  indigo: "border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10",
  green: "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10",
  slate: "border-slate-500/30 bg-slate-500/5 hover:bg-slate-500/10",
  teal: "border-teal-500/30 bg-teal-500/5 hover:bg-teal-500/10",
  gray: "border-border bg-muted/30 hover:bg-muted/50",
  purple: "border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10",
  rose: "border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10",
  amber: "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10",
  orange: "border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10",
  red: "border-red-500/30 bg-red-500/5 hover:bg-red-500/10",
  yellow: "border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10",
  violet: "border-violet-500/30 bg-violet-500/5 hover:bg-violet-500/10",
};

function LaunchpadTileButton({
  tile,
  onSelect,
  compact,
}: {
  tile: LaunchpadTile;
  onSelect: (tab: FinancialShellTab) => void;
  compact?: boolean;
}) {
  const Icon = ICONS[tile.icon] ?? LayoutDashboard;
  const accent = ACCENT[tile.accent] ?? ACCENT.gray;

  return (
    <button
      type="button"
      onClick={() => onSelect(tile.tab)}
      className={cn(
        "fiori-tile group flex cursor-pointer flex-col items-start rounded-lg border p-4 text-left transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        accent,
        compact && "p-3"
      )}
    >
      <Icon className="mb-3 h-5 w-5 text-foreground/80 transition-transform duration-200 group-hover:scale-105" strokeWidth={1.5} />
      <span className="font-medium text-foreground">{tile.label}</span>
      <span className={cn("mt-1 text-muted-foreground", compact ? "text-xs" : "text-sm")}>{tile.description}</span>
    </button>
  );
}

export function FinancialLaunchpad({
  catalog,
  pinnedTabs,
  onSelectTab,
  compact,
  kpis,
}: {
  catalog: LaunchpadArea[];
  pinnedTabs: string[];
  onSelectTab: (tab: FinancialShellTab) => void;
  compact?: boolean;
  kpis?: { label: string; value: string; sub?: string }[];
}) {
  const pinned = catalog
    .flatMap((a) => a.tiles)
    .filter((t) => pinnedTabs.includes(t.tab));

  return (
    <div className="space-y-8">
      {kpis && kpis.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="fiori-kpi-card rounded-lg border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{k.value}</p>
              {k.sub && <p className="mt-0.5 text-xs text-muted-foreground">{k.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {pinned.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Pinned</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pinned.map((tile) => (
              <LaunchpadTileButton key={tile.tab} tile={tile} onSelect={onSelectTab} compact={compact} />
            ))}
          </div>
        </section>
      )}

      {catalog.map((area) => (
        <section key={area.id}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">{area.label}</h2>
            <p className="text-sm text-muted-foreground">{area.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {area.tiles.map((tile) => (
              <LaunchpadTileButton key={tile.tab} tile={tile} onSelect={onSelectTab} compact={compact} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

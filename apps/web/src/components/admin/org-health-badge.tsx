import { cn } from "@/lib/utils";
import type { OrgHealthGrade } from "@/lib/admin-types";

const GRADE_STYLES: Record<OrgHealthGrade, string> = {
  healthy: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  watch: "bg-amber-50 text-amber-900 ring-amber-200",
  critical: "bg-red-50 text-red-800 ring-red-200",
  offboarded: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function OrgHealthBadge({
  score,
  grade,
  compact = false,
}: {
  score: number;
  grade: OrgHealthGrade;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        GRADE_STYLES[grade] ?? GRADE_STYLES.watch
      )}
      title={`Health ${score}/100 · ${grade}`}
    >
      <span className="tabular-nums">{score}</span>
      {!compact && <span className="capitalize opacity-80">{grade}</span>}
    </span>
  );
}

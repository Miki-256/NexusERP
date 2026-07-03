export type DatePreset = "today" | "week" | "month" | "quarter" | "year" | "last_month";

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dateRangeForPreset(preset: DatePreset): { from: string; to: string; label: string } {
  const now = new Date();
  const to = isoDate(now);

  switch (preset) {
    case "today":
      return { from: to, to, label: "Today" };
    case "week": {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      return { from: isoDate(start), to, label: "Last 7 days" };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: isoDate(start), to, label: "Month to date" };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: isoDate(start), to: isoDate(end), label: "Last month" };
    }
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1);
      return { from: isoDate(start), to, label: "Quarter to date" };
    }
    case "year": {
      const start = new Date(now.getFullYear(), 0, 1);
      return { from: isoDate(start), to, label: "Year to date" };
    }
  }
}

export function monthToDate(): { from: string; to: string } {
  return dateRangeForPreset("month");
}

export function previousMonthRange(): { from: string; to: string } {
  return dateRangeForPreset("last_month");
}

export function formatPeriod(from: string, to: string): string {
  if (from === to) return from;
  return `${from} → ${to}`;
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Same-length period immediately before [from, to]. */
export function priorPeriod(from: string, to: string): { from: string; to: string } {
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const priorEnd = new Date(start);
  priorEnd.setDate(priorEnd.getDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorStart.getDate() - days + 1);
  return { from: isoDate(priorStart), to: isoDate(priorEnd) };
}

/** Balance-sheet comparison date: same calendar day one month earlier (or prior period end). */
export function priorBalanceSheetDate(asOf: string, periodFrom: string): string {
  const prior = priorPeriod(periodFrom, asOf);
  return prior.to;
}

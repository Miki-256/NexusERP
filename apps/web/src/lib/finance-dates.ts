export type DatePreset = "today" | "week" | "month" | "quarter" | "year" | "last_month";

/**
 * Business-date / display rule (NexusERP):
 * - Persist instants as timestamptz (UTC).
 * - Display all user-facing sale/payment/movement/receipt/JE times in the org IANA
 *   timezone (default Africa/Addis_Ababa) via formatOrgDateTime / formatOrgDateTimeFull.
 * - Report day bounds / MTD use calendar dates in that timezone
 *   (monthToDateInTimeZone, utcDayRangeForCalendarDate) — never UTC toISOString slice alone.
 * - Journal entry_date / day P&L = calendar date of sale.created_at in org TZ
 *   (see post_sale_to_ledger_internal: (created_at AT TIME ZONE v_tz)::date).
 */
export const DEFAULT_ORG_TIMEZONE = "Africa/Addis_Ababa";

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Calendar YYYY-MM-DD for `date` in an IANA timezone (e.g. Africa/Addis_Ababa). */
export function calendarDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/** Month-to-date [from, to] as calendar dates in `timeZone`. */
export function monthToDateInTimeZone(
  timeZone: string = DEFAULT_ORG_TIMEZONE,
  now: Date = new Date()
): { from: string; to: string } {
  const tz = timeZone.trim() || DEFAULT_ORG_TIMEZONE;
  const to = calendarDateInTimeZone(now, tz);
  const [y, m] = to.split("-").map((n) => parseInt(n, 10));
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  return { from, to };
}

/** Shift a calendar YYYY-MM-DD by `deltaDays` (civil date arithmetic). */
function shiftCalendarDate(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return utc.toISOString().slice(0, 10);
}

export function dateRangeForPreset(
  preset: DatePreset,
  timeZone: string = DEFAULT_ORG_TIMEZONE
): { from: string; to: string; label: string } {
  const tz = timeZone.trim() || DEFAULT_ORG_TIMEZONE;
  const now = new Date();
  const to = calendarDateInTimeZone(now, tz);
  const [y, m] = to.split("-").map((n) => parseInt(n, 10));

  switch (preset) {
    case "today":
      return { from: to, to, label: "Today" };
    case "week":
      return { from: shiftCalendarDate(to, -6), to, label: "Last 7 days" };
    case "month":
      return { from: `${y}-${String(m).padStart(2, "0")}-01`, to, label: "Month to date" };
    case "last_month": {
      const lastEnd = shiftCalendarDate(`${y}-${String(m).padStart(2, "0")}-01`, -1);
      const [ly, lm] = lastEnd.split("-").map((n) => parseInt(n, 10));
      return {
        from: `${ly}-${String(lm).padStart(2, "0")}-01`,
        to: lastEnd,
        label: "Last month",
      };
    }
    case "quarter": {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      return {
        from: `${y}-${String(qStartMonth).padStart(2, "0")}-01`,
        to,
        label: "Quarter to date",
      };
    }
    case "year":
      return { from: `${y}-01-01`, to, label: "Year to date" };
  }
}

/** @deprecated Prefer monthToDateInTimeZone(orgTimezone) for finance MTD. */
export function monthToDate(timeZone: string = DEFAULT_ORG_TIMEZONE): { from: string; to: string } {
  const r = dateRangeForPreset("month", timeZone);
  return { from: r.from, to: r.to };
}

export function previousMonthRange(timeZone: string = DEFAULT_ORG_TIMEZONE): { from: string; to: string } {
  const r = dateRangeForPreset("last_month", timeZone);
  return { from: r.from, to: r.to };
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

/**
 * UTC instants for [start, end] of a calendar day in `timeZone`.
 * Use for timestamptz DB filters (gte from, lte to).
 */
export function utcDayRangeForCalendarDate(
  ymd: string,
  timeZone: string
): { from: string; to: string } {
  const start = zonedLocalToUtc(ymd, 0, 0, 0, 0, timeZone);
  const end = zonedLocalToUtc(ymd, 23, 59, 59, 999, timeZone);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Map local wall-clock in `timeZone` to the corresponding UTC instant. */
function zonedLocalToUtc(
  ymd: string,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string
): Date {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  let guess = Date.UTC(y, m - 1, d, hour, minute, second, ms);

  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));

    const pick = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

    const actual = Date.UTC(
      pick("year"),
      pick("month") - 1,
      pick("day"),
      pick("hour"),
      pick("minute"),
      pick("second"),
      0
    );
    const target = Date.UTC(y, m - 1, d, hour, minute, second, ms);
    const delta = target - actual;
    if (delta === 0) break;
    guess += delta;
  }

  return new Date(guess);
}

function parseInstant(iso: string | Date): Date | null {
  if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso;
  const raw = iso.trim();
  if (!raw) return null;
  // Postgres sometimes returns "YYYY-MM-DD HH:MM:SS+00" — normalize space to T
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatOrgDateTime(
  iso: string | Date | null | undefined,
  timeZone: string = DEFAULT_ORG_TIMEZONE,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!iso) return "—";
  const d = parseInstant(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone.trim() || DEFAULT_ORG_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(d);
}

export function formatOrgDateTimeFull(
  iso: string | Date | null | undefined,
  timeZone: string = DEFAULT_ORG_TIMEZONE
): string {
  return formatOrgDateTime(iso, timeZone, { dateStyle: "medium", timeStyle: "medium" });
}

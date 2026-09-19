/**
 * Opt-in performance timing harness.
 * Enable with ?perf=1 in the URL, or localStorage nexus-perf=1, or NODE_ENV=development.
 * Marks are also sent to console as [perf] … ms
 */

const STORAGE_KEY = "nexus-perf";

export function isPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("perf") === "1") return true;
    if (localStorage.getItem(STORAGE_KEY) === "1") return true;
  } catch {
    /* ignore */
  }
  return process.env.NODE_ENV === "development";
}

export function perfMark(name: string): void {
  if (!isPerfEnabled() || typeof performance === "undefined") return;
  try {
    performance.mark(`nexus:${name}`);
  } catch {
    /* ignore */
  }
}

export function perfMeasure(
  name: string,
  startMark: string,
  endMark?: string
): number | null {
  if (!isPerfEnabled() || typeof performance === "undefined") return null;
  try {
    const end = endMark ?? `nexus:${name}:end`;
    const start = startMark.startsWith("nexus:") ? startMark : `nexus:${startMark}`;
    if (!endMark) performance.mark(end);
    const entries = performance.measure(`nexus:${name}`, start, end);
    const ms = Math.round(entries.duration);
    // eslint-disable-next-line no-console
    console.info(`[perf] ${name}: ${ms}ms`);
    return ms;
  } catch {
    return null;
  }
}

/** Time an async function and log duration when perf is enabled. */
export async function perfTime<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!isPerfEnabled()) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - t0);
    // eslint-disable-next-line no-console
    console.info(`[perf] ${name}: ${ms}ms`);
  }
}

export function perfNow(name: string, detail?: Record<string, unknown>): void {
  if (!isPerfEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[perf] ${name}`, detail ?? "");
}

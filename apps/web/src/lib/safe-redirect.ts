/** Same-origin relative path only — blocks open redirects (e.g. //evil.com). */
export function safeRedirectPath(raw: string | null, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  const path = raw.trim();
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//")) return fallback;
  if (path.includes(":")) return fallback;
  if (path.includes("\\")) return fallback;
  return path;
}

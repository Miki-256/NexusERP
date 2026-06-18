import type { NextConfig } from "next";
import path from "path";

// Phase 0 hardening (audit S3): security headers incl. Content-Security-Policy.
// Supabase needs connect/img to its domain; adjust SUPABASE host via env at build.
const supabaseHost = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
  /^https?:\/\//,
  ""
);

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  // Next.js requires inline/eval for its runtime in dev; keep tight in prod.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost}`,
  "font-src 'self' data:",
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@nex/shared"],
  // Pin file-tracing to this monorepo (avoids picking up ~/package-lock.json).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

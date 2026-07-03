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
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost} http://127.0.0.1:17832 http://localhost:17832`,
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
    value: "camera=(self), microphone=(), geolocation=(), payment=()",
  },
];

const securityHeadersWithoutPermissions = securityHeaders.filter(
  (h) => h.key !== "Permissions-Policy"
);

const nextConfig: NextConfig = {
  transpilePackages: ["@nex/shared"],
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    const posCameraPolicy = {
      key: "Permissions-Policy",
      value: "camera=(self), microphone=(), geolocation=(), payment=()",
    };
    const posHeaders = [...securityHeadersWithoutPermissions, posCameraPolicy];
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // Default ERP headers (camera allowed for same-origin — POS barcode scan).
      { source: "/:path*", headers: securityHeaders },
      // POS / register: explicit camera policy (matches default; kept for clarity).
      { source: "/pos", headers: posHeaders },
      { source: "/pos/:path*", headers: posHeaders },
      { source: "/register/:path*", headers: posHeaders },
    ];
  },
};

export default nextConfig;

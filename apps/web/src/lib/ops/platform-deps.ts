/** Server-only platform dependency probe for Admin Health (Level 3). */

export type PlatformDependencyProbe = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function probePlatformDependencies(): PlatformDependencyProbe[] {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cronSecret = process.env.CRON_SECRET;
  const sentry = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  const resend = process.env.RESEND_API_KEY;
  const arifpay = process.env.ARIFPAY_API_KEY;

  return [
    {
      key: "supabase_url",
      label: "Supabase URL",
      ok: present(supabaseUrl),
      detail: present(supabaseUrl) ? "Configured" : "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL",
    },
    {
      key: "service_role",
      label: "Service role key",
      ok: present(serviceRole),
      detail: present(serviceRole)
        ? "Configured (queue drain / health probe)"
        : "Missing SUPABASE_SERVICE_ROLE_KEY",
    },
    {
      key: "cron_secret",
      label: "Cron secret",
      ok: present(cronSecret),
      detail: present(cronSecret)
        ? "Configured (process-queue auth)"
        : "Missing CRON_SECRET — GitHub/Vercel cron cannot authenticate",
    },
    {
      key: "sentry",
      label: "Sentry",
      ok: present(sentry),
      detail: present(sentry) ? "DSN configured" : "Optional — SENTRY_DSN not set",
    },
    {
      key: "resend",
      label: "Resend email",
      ok: present(resend),
      detail: present(resend) ? "API key configured" : "Optional — RESEND_API_KEY not set",
    },
    {
      key: "arifpay",
      label: "Arifpay / Telebirr",
      ok: present(arifpay),
      detail: present(arifpay) ? "API key configured" : "Optional — ARIFPAY_API_KEY not set",
    },
  ];
}

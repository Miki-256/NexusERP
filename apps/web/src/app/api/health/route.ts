import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public liveness probe for uptime monitors.
 * Does not expose tenant data — only queue depths via service role.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 503 }
    );
  }

  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin.rpc("get_platform_health_probe");
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 503 }
      );
    }

    const probe = data as {
      ok?: boolean;
      ledger_queue_pending?: number;
      payment_webhook_queue_pending?: number;
      checked_at?: string;
    };

    const ledgerPending = probe.ledger_queue_pending ?? 0;
    const webhookPending = probe.payment_webhook_queue_pending ?? 0;
    const degraded = ledgerPending > 100 || webhookPending > 50;

    return NextResponse.json(
      {
        ok: probe.ok ?? true,
        status: degraded ? "degraded" : "healthy",
        ledger_queue_pending: ledgerPending,
        payment_webhook_queue_pending: webhookPending,
        checked_at: probe.checked_at ?? new Date().toISOString(),
      },
      { status: degraded ? 503 : 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Health check failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}

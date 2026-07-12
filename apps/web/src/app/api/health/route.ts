import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyInternalSecret } from "@/lib/api/internal-auth";
import { buildHealthResponse, buildLivenessResponse } from "@/lib/api/health-status";

export const dynamic = "force-dynamic";

/**
 * Liveness: public GET returns ok only.
 * Detailed queue probe requires cron/webhook secret (monitoring / ops).
 */
export async function GET(request: Request) {
  if (!verifyInternalSecret(request)) {
    const live = buildLivenessResponse();
    return NextResponse.json(live.body, { status: live.status });
  }

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

    const result = buildHealthResponse(
      (data ?? {}) as {
        ok?: boolean;
        ledger_queue_pending?: number;
        payment_webhook_queue_pending?: number;
        checked_at?: string;
      }
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Health check failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}

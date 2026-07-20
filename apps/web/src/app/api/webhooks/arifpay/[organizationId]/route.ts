import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseArifpayNotify, verifyArifpayNotifyAuth } from "@/lib/payments/arifpay";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ organizationId: string }> };

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Arifpay server-to-server notify for Telebirr (and other methods).
 * URL embeds organization id: /api/webhooks/arifpay/:organizationId
 */
export async function POST(request: Request, ctx: Ctx) {
  if (!verifyArifpayNotifyAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { organizationId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseArifpayNotify(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, ignored: true, reason: "non_success_status", status: parsed.rawStatus },
      { status: 200 }
    );
  }

  const reference = parsed.reference ?? parsed.sessionId;
  if (!reference) {
    return NextResponse.json({ error: "Missing reference/nonce/sessionId" }, { status: 400 });
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const { data, error } = await admin.rpc("confirm_payment_webhook", {
    p_organization_id: organizationId,
    p_reference: reference,
    p_provider: "telebirr",
    p_amount: parsed.amount,
    p_external_id: parsed.externalId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data as { matched?: boolean; reason?: string };
  if (!result.matched) {
    // Retry matching by session id if nonce-based reference failed
    if (parsed.sessionId && parsed.sessionId !== reference) {
      const retry = await admin.rpc("confirm_payment_webhook", {
        p_organization_id: organizationId,
        p_reference: parsed.sessionId,
        p_provider: "telebirr",
        p_amount: parsed.amount,
        p_external_id: parsed.externalId,
      });
      const retryResult = retry.data as { matched?: boolean } | null;
      if (!retry.error && retryResult?.matched) {
        return NextResponse.json({ ...retryResult, matched_by: "sessionId" });
      }
    }

    await admin.rpc("queue_payment_webhook", {
      p_organization_id: organizationId,
      p_reference: reference,
      p_provider: "telebirr",
      p_amount: parsed.amount,
      p_external_id: parsed.externalId,
      p_payload: body as Record<string, unknown>,
    });
    return NextResponse.json({ ...result, queued: true }, { status: 202 });
  }

  return NextResponse.json(result);
}

/** Optional health check for Arifpay dashboard URL validation. */
export async function GET(_request: Request, ctx: Ctx) {
  const { organizationId } = await ctx.params;
  return NextResponse.json({
    ok: true,
    provider: "arifpay",
    organizationId,
  });
}

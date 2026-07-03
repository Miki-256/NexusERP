import { createClient } from "@supabase/supabase-js";
import { mobileMoneyWebhookSchema } from "@nex/shared";
import { parseJsonBody } from "@/lib/api/parse-body";
import { NextResponse } from "next/server";

function verifySecret(request: Request): boolean {
  const expected = process.env.POS_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const header = request.headers.get("x-pos-webhook-secret");
  return header === expected;
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request, mobileMoneyWebhookSchema);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const { organization_id, reference, provider, amount, external_id } = body;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("confirm_payment_webhook", {
    p_organization_id: organization_id,
    p_reference: reference,
    p_provider: provider ?? "other",
    p_amount: amount ?? null,
    p_external_id: external_id ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data as { matched?: boolean; reason?: string };
  if (!result.matched) {
    await admin.rpc("queue_payment_webhook", {
      p_organization_id: organization_id,
      p_reference: reference,
      p_provider: provider ?? "other",
      p_amount: amount ?? null,
      p_external_id: external_id ?? null,
      p_payload: body as unknown as Record<string, unknown>,
    });
    return NextResponse.json({ ...result, queued: true }, { status: 202 });
  }

  return NextResponse.json(result);
}

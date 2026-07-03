import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { dispatchSecurityAlerts } from "@/lib/security-alert-dispatch";

function verifySecret(request: Request): boolean {
  const webhookSecret = process.env.POS_WEBHOOK_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const headerSecret = request.headers.get("x-pos-webhook-secret");
  if (webhookSecret && headerSecret === webhookSecret) return true;

  const auth = request.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  if (!webhookSecret && !cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  return false;
}

async function runDispatch() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await dispatchSecurityAlerts(admin);
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runDispatch();
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runDispatch();
}

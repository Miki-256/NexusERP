import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { dispatchSecurityAlerts } from "@/lib/security-alert-dispatch";
import { verifyInternalSecret } from "@/lib/api/internal-auth";

export const dynamic = "force-dynamic";

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
  if (!verifyInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runDispatch();
}

export async function POST(request: Request) {
  if (!verifyInternalSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runDispatch();
}

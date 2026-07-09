import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { processNotificationPipeline } from "@/lib/notifications/worker";

/** Lightweight notification dispatch after POS sales (Vercel Hobby cron is daily). */
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const result = await processNotificationPipeline(admin, 25);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Notification dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

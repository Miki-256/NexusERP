import { NextRequest, NextResponse } from "next/server";
import { logFailedLoginSchema } from "@nex/shared";
import { parseJsonBody } from "@/lib/api/parse-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`login-failed:${ip}`, 20, 60 * 1000);
  if (!limited.ok) {
    return rateLimitResponse(limited.retryAfterSec);
  }

  try {
    const parsed = await parseJsonBody(request, logFailedLoginSchema);
    if (!parsed.ok) return parsed.response;

    const email = parsed.data.email.trim().toLowerCase();

    const admin = createAdminClient();
    await admin.rpc("log_security_event", {
      p_event_type: "login_failed",
      p_email: email,
      p_ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      p_user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      p_metadata: {},
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}

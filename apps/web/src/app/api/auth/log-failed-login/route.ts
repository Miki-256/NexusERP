import { NextRequest, NextResponse } from "next/server";
import { logFailedLoginSchema } from "@nex/shared";
import { parseJsonBody } from "@/lib/api/parse-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const ipLimited = await rateLimitDistributed(`login-failed:${ip}`, 20, 60 * 1000);
  if (!ipLimited.ok) {
    return rateLimitResponse(ipLimited.retryAfterSec);
  }

  try {
    const parsed = await parseJsonBody(request, logFailedLoginSchema);
    if (!parsed.ok) return parsed.response;

    const email = parsed.data.email.trim().toLowerCase();
    const emailLimited = await rateLimitDistributed(`login-failed-email:${email}`, 5, 15 * 60 * 1000);
    if (!emailLimited.ok) {
      return NextResponse.json({ ok: true });
    }

    const admin = createAdminClient();
    const forwardedIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ip ?? null;
    const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

    await admin.rpc("log_security_event", {
      p_event_type: "login_failed",
      p_email: email,
      p_ip_address: forwardedIp,
      p_user_agent: userAgent,
      p_metadata: {},
    });

    await admin.rpc("enqueue_security_login_failed_notifications", {
      p_email: email,
      p_ip_address: forwardedIp,
      p_user_agent: userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}

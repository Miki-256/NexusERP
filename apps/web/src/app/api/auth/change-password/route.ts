import { NextRequest, NextResponse } from "next/server";
import { changePasswordSchema } from "@nex/shared";
import { parseJsonBody } from "@/lib/api/parse-body";
import { verifyUserPassword } from "@/lib/auth-verify-password";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";
import { createRouteHandlerClient } from "@/lib/supabase/route-handler";

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const ipLimited = await rateLimitDistributed(`change-password-ip:${ip}`, 20, 15 * 60 * 1000);
  if (!ipLimited.ok) {
    return rateLimitResponse(ipLimited.retryAfterSec);
  }

  const { supabase, withCookies } = createRouteHandlerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return withCookies(NextResponse.json({ error: "You must be signed in." }, { status: 401 }));
  }

  const userLimited = await rateLimitDistributed(`change-password:${user.id}`, 8, 15 * 60 * 1000);
  if (!userLimited.ok) {
    return rateLimitResponse(userLimited.retryAfterSec);
  }

  const parsed = await parseJsonBody(request, changePasswordSchema);
  if (!parsed.ok) return withCookies(parsed.response);

  const currentOk = await verifyUserPassword(user.email, parsed.data.currentPassword);
  if (!currentOk) {
    return withCookies(
      NextResponse.json({ error: "Current password is incorrect" }, { status: 400 })
    );
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) {
    return withCookies(
      NextResponse.json({ error: "Could not update password" }, { status: 400 })
    );
  }

  return withCookies(NextResponse.json({ ok: true }));
}

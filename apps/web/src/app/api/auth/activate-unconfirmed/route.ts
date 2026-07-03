import { NextResponse } from "next/server";
import { activateUnconfirmedSchema } from "@nex/shared";
import { parseJsonBody } from "@/lib/api/parse-body";
import { tryActivateUnconfirmedEmail } from "@/lib/auth-activate-unconfirmed";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";

/** Confirm legacy signups that never verified email (password must be correct). */
export async function POST(request: Request) {
  const ip = clientIp(request);

  const parsed = await parseJsonBody(request, activateUnconfirmedSchema);
  if (!parsed.ok) return parsed.response;

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  const limited = await rateLimitDistributed(`activate:${ip}:${email}`, 5, 15 * 60 * 1000);
  if (!limited.ok) {
    return rateLimitResponse(limited.retryAfterSec);
  }

  const result = await tryActivateUnconfirmedEmail(email, password);
  if (!result.ok) {
    const status = result.error === "Server configuration error" ? 500 : 401;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, activated: true });
}

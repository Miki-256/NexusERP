import { NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@nex/shared";
import { parseJsonBody } from "@/lib/api/parse-body";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { tryActivateUnconfirmedEmail } from "@/lib/auth-activate-unconfirmed";
import {
  authLockoutMessage,
  checkAuthThrottle,
  recordAuthFailure,
  recordAuthSuccess,
} from "@/lib/auth-throttle";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";
import { createRouteHandlerClient } from "@/lib/supabase/route-handler";
import { resolveBootstrapDestination } from "@/lib/workspace-bootstrap";

const isProdCookie =
  process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

const ORG_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  httpOnly: true,
  secure: isProdCookie,
  sameSite: "lax" as const,
};

/** Stale access-block cache from a previous session must not survive a fresh login. */
function clearAccessBlockCookie(response: NextResponse) {
  response.cookies.set("nx_access_v1", "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    secure: isProdCookie,
    sameSite: "lax",
  });
}

function requestIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function loginErrorResponse(
  withCookies: (response: NextResponse) => NextResponse,
  message: string,
  status: number
) {
  return withCookies(NextResponse.json({ error: message }, { status }));
}

/** Server-side sign-in — sets auth cookies on the JSON response (required on Vercel). */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`login:${ip}`, 30, 15 * 60 * 1000);
  if (!limited.ok) {
    return rateLimitResponse(limited.retryAfterSec);
  }

  const parsed = await parseJsonBody(request, loginSchema);
  if (!parsed.ok) return parsed.response;

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;
  const inviteId = parsed.data.inviteId?.trim() || null;

  const requestIpValue = requestIp(request);
  const userAgent = request.headers.get("user-agent");
  const { supabase, withCookies } = createRouteHandlerClient(request);

  const [emailThrottle, ipThrottle] = await Promise.all([
    checkAuthThrottle("login_email", email),
    checkAuthThrottle("login_ip", requestIpValue),
  ]);

  if (!emailThrottle.allowed) {
    return loginErrorResponse(withCookies, authLockoutMessage(emailThrottle), 429);
  }
  if (!ipThrottle.allowed) {
    return loginErrorResponse(withCookies, authLockoutMessage(ipThrottle), 429);
  }

  let signIn = await supabase.auth.signInWithPassword({ email, password });

  if (signIn.error?.message === "Invalid login credentials") {
    const activated = await tryActivateUnconfirmedEmail(email, password);
    if (activated.ok) {
      signIn = await supabase.auth.signInWithPassword({ email, password });
    }
  }

  if (signIn.error || !signIn.data.session) {
    await Promise.all([
      recordAuthFailure("login_email", email, { ip: requestIpValue, email, userAgent }),
      recordAuthFailure("login_ip", requestIpValue, { ip: requestIpValue, email, userAgent }),
    ]);
    return loginErrorResponse(
      withCookies,
      signIn.error?.message ?? "Invalid login credentials",
      401
    );
  }

  await Promise.all([
    recordAuthSuccess("login_email", email),
    recordAuthSuccess("login_ip", requestIpValue),
  ]);

  if (inviteId) {
    await supabase.rpc("accept_staff_invite", { p_invite_id: inviteId });
  }

  const activeOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? null;
  const destination = await resolveBootstrapDestination(supabase, activeOrgId);

  const session = signIn.data.session;
  const response = NextResponse.json(
    {
      ok: true,
      redirect: destination.path,
      // Browser backup: client setSession() if Set-Cookie is dropped by the browser.
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
    },
    { status: 200 }
  );
  clearAccessBlockCookie(response);
  if (destination.orgCookie) {
    response.cookies.set(ACTIVE_ORG_COOKIE, destination.orgCookie, ORG_COOKIE_OPTIONS);
  }

  return withCookies(response);
}

"use server";

import { setActiveOrganization } from "@/app/actions/switch-organization";
import {
  authLockoutMessage,
  checkAuthThrottle,
  recordAuthFailure,
  recordAuthSuccess,
} from "@/lib/auth-throttle";
import { getRequestIp, getRequestUserAgent } from "@/lib/request-ip";

export type LoginThrottleResult = { error: string } | { ok: true };

export async function checkLoginThrottle(email: string): Promise<LoginThrottleResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const ip = await getRequestIp();

  const [emailThrottle, ipThrottle] = await Promise.all([
    checkAuthThrottle("login_email", normalizedEmail),
    checkAuthThrottle("login_ip", ip),
  ]);

  if (!emailThrottle.allowed) {
    return { error: authLockoutMessage(emailThrottle) };
  }
  if (!ipThrottle.allowed) {
    return { error: authLockoutMessage(ipThrottle) };
  }

  return { ok: true };
}

export async function recordLoginFailure(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const ip = await getRequestIp();
  const userAgent = await getRequestUserAgent();

  await Promise.all([
    recordAuthFailure("login_email", normalizedEmail, {
      ip,
      email: normalizedEmail,
      userAgent,
    }),
    recordAuthFailure("login_ip", ip, {
      ip,
      email: normalizedEmail,
      userAgent,
    }),
  ]);
}

export async function recordLoginSuccess(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const ip = await getRequestIp();

  await Promise.all([
    recordAuthSuccess("login_email", normalizedEmail),
    recordAuthSuccess("login_ip", ip),
  ]);
}

export async function acceptInviteAfterLogin(
  inviteId: string
): Promise<{ error: string } | { ok: true }> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data: orgId, error: acceptError } = await supabase.rpc("accept_staff_invite", {
    p_invite_id: inviteId,
  });
  if (acceptError) {
    return { error: acceptError.message };
  }
  if (orgId) {
    await setActiveOrganization(orgId);
  }
  return { ok: true };
}

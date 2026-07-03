import { createAdminClient } from "@/lib/supabase/admin";

export type AuthThrottleResult = {
  allowed: boolean;
  lockedUntil?: string;
  attemptsRemaining?: number;
  maxAttempts?: number;
  reason?: string;
};

function parseThrottle(data: unknown): AuthThrottleResult {
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    allowed: row.allowed !== false,
    lockedUntil: typeof row.locked_until === "string" ? row.locked_until : undefined,
    attemptsRemaining: typeof row.attempts_remaining === "number" ? row.attempts_remaining : undefined,
    maxAttempts: typeof row.max_attempts === "number" ? row.max_attempts : undefined,
    reason: typeof row.reason === "string" ? row.reason : undefined,
  };
}

/** Server-only — uses service role so anon cannot call throttle RPCs directly. */
export async function checkAuthThrottle(
  lockoutType: "login_email" | "login_ip" | "pos_manager_pin_register",
  identifier: string
): Promise<AuthThrottleResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("check_auth_throttle", {
    p_lockout_type: lockoutType,
    p_identifier: identifier,
  });
  if (error) {
    return { allowed: true };
  }
  return parseThrottle(data);
}

export async function recordAuthFailure(
  lockoutType: "login_email" | "login_ip",
  identifier: string,
  context: { ip?: string | null; email?: string | null; userAgent?: string | null }
) {
  const supabase = createAdminClient();
  await supabase.rpc("record_auth_failure", {
    p_lockout_type: lockoutType,
    p_identifier: identifier,
    p_ip_address: context.ip ?? null,
    p_email: context.email ?? null,
    p_metadata: {
      user_agent: context.userAgent?.slice(0, 500) ?? null,
    },
  });
}

export async function recordAuthSuccess(
  lockoutType: "login_email" | "login_ip",
  identifier: string
) {
  const supabase = createAdminClient();
  await supabase.rpc("record_auth_success", {
    p_lockout_type: lockoutType,
    p_identifier: identifier,
  });
}

export function authLockoutMessage(result: AuthThrottleResult): string {
  if (result.lockedUntil) {
    const until = new Date(result.lockedUntil);
    if (!Number.isNaN(until.getTime())) {
      return `Too many failed attempts. Try again after ${until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
    }
  }
  return "Too many failed attempts. Please wait and try again.";
}

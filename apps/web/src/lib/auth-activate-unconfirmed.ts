import { createAdminClient } from "@/lib/supabase/admin";
import { findUserByEmail } from "@/lib/admin-auth-users";
import { getSupabaseKey, getSupabaseUrl } from "@/lib/supabase/env";
import type { SupabaseClient } from "@supabase/supabase-js";

async function passwordGrant(email: string, password: string) {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

function isUnconfirmedError(payload: Record<string, unknown>) {
  const msg = String(payload.error_description ?? payload.msg ?? payload.error ?? "").toLowerCase();
  return msg.includes("confirm") || msg.includes("verified") || payload.error === "email_not_confirmed";
}

/** Confirm legacy signups that never verified email (password must be correct). */
export async function tryActivateUnconfirmedEmail(
  email: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const first = await passwordGrant(email, password);
  if (first.ok) return { ok: true };

  if (!isUnconfirmedError(first.body as Record<string, unknown>)) {
    return { ok: false, error: "Invalid login credentials" };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Server configuration error" };
  }

  const user = await findUserByEmail(admin, email);
  if (!user) {
    return { ok: false, error: "Invalid login credentials" };
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    email_confirm: true,
  });
  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  const second = await passwordGrant(email, password);
  if (!second.ok) {
    await admin.auth.admin.updateUserById(user.id, { email_confirm: false });
    return { ok: false, error: "Invalid login credentials" };
  }

  return { ok: true };
}

export async function signInWithPasswordMaybeActivate(
  supabase: SupabaseClient,
  email: string,
  password: string
) {
  const normalizedEmail = email.trim().toLowerCase();
  let { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error?.message === "Invalid login credentials") {
    const activated = await tryActivateUnconfirmedEmail(normalizedEmail, password);
    if (activated.ok) {
      const retry = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      error = retry.error;
    }
  }

  return { error };
}

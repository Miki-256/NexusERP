import { getSupabaseKey, getSupabaseUrl } from "@/lib/supabase/env";

/** Check email+password against GoTrue without mutating the caller's session cookies. */
export async function verifyUserPassword(email: string, password: string): Promise<boolean> {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!url || !key) return false;

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.ok;
}

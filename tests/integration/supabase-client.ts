/**
 * Shared Supabase REST helpers for integration tests.
 * Requires INTEGRATION_TEST_EMAIL + INTEGRATION_TEST_PASSWORD (or E2E_* aliases).
 */

export function integrationCredentials() {
  const email =
    process.env.INTEGRATION_TEST_EMAIL ?? process.env.E2E_EMAIL ?? process.env.LOAD_TEST_EMAIL ?? "";
  const password =
    process.env.INTEGRATION_TEST_PASSWORD ??
    process.env.E2E_PASSWORD ??
    process.env.LOAD_TEST_PASSWORD ??
    "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  return { email, password, supabaseUrl, anonKey };
}

export function hasIntegrationCredentials() {
  const { email, password, supabaseUrl, anonKey } = integrationCredentials();
  return Boolean(email && password && supabaseUrl && anonKey);
}

export async function signIn(): Promise<string> {
  const { email, password, supabaseUrl, anonKey } = integrationCredentials();
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description ?? "Sign-in failed");
  }
  return body.access_token;
}

export async function rpc<T>(
  token: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const { supabaseUrl, anonKey } = integrationCredentials();
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message: string }).message)
        : String(data);
    throw new Error(`${name}: ${msg}`);
  }
  return data as T;
}

export async function restGet<T>(
  token: string,
  table: string,
  query: string
): Promise<T> {
  const { supabaseUrl, anonKey } = integrationCredentials();
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${table}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Prefer server runtime env on Vercel/Edge (not inlined at build). */
export function getSupabaseUrl() {
  return (
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    ""
  );
}

/** Supabase publishable (anon) key — supports runtime + public env names. */
export function getSupabaseKey() {
  return (
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  );
}

/**
 * Direct Postgres pooler URL (Supavisor, port 6543, transaction mode).
 * Use for CLI/scripts — not for @supabase/supabase-js (REST API).
 */
export function getSupabasePoolerUrl() {
  return (
    process.env.SUPABASE_POOLER_URL ??
    process.env.DATABASE_POOLER_URL ??
    ""
  );
}

/**
 * Read replica URL for reporting RPCs (Supabase Pro/Enterprise).
 * Falls back to primary when unset.
 */
export function getSupabaseReadUrl() {
  return (
    process.env.SUPABASE_READ_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_READ_URL ??
    getSupabaseUrl()
  );
}

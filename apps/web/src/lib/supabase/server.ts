import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseKey, getSupabaseReadUrl, getSupabaseUrl } from "./env";

async function createServerSupabaseClient(url: string) {
  const cookieStore = await cookies();

  return createServerClient(url, getSupabaseKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }[]
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Component — ignore
        }
      },
    },
  });
}

/** Primary Supabase client (read/write). */
export async function createClient() {
  return createServerSupabaseClient(getSupabaseUrl());
}

/** Reporting client — uses read replica when SUPABASE_READ_URL is set. */
export async function createReportingClient() {
  return createServerSupabaseClient(getSupabaseReadUrl());
}

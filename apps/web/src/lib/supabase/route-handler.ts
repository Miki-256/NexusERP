import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseKey, getSupabaseUrl } from "./env";

type PendingCookie = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

/**
 * Supabase client for Route Handlers.
 * Collects auth cookies in memory, then apply them onto the final JSON/redirect response.
 * (Avoids losing Set-Cookie when rebuilding NextResponse.)
 */
export function createRouteHandlerClient(request: NextRequest) {
  const pendingCookies: PendingCookie[] = [];

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: PendingCookie[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        // Replace pending set — last setAll wins (matches @supabase/ssr behavior).
        pendingCookies.length = 0;
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  function withCookies(response: NextResponse) {
    for (const { name, value, options } of pendingCookies) {
      const opts = { ...(options ?? {}) } as Record<string, unknown>;
      // Ensure browser accepts session cookies on HTTPS Vercel hosts.
      if (opts.path == null) opts.path = "/";
      if (opts.sameSite == null) opts.sameSite = "lax";
      if (opts.secure == null && (process.env.VERCEL === "1" || process.env.NODE_ENV === "production")) {
        opts.secure = true;
      }
      response.cookies.set(name, value, opts);
    }
    return response;
  }

  return { supabase, withCookies };
}

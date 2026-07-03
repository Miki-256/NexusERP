import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseKey, getSupabaseUrl } from "./env";

/** Supabase client for Route Handlers — binds auth cookies to the outgoing response. */
export function createRouteHandlerClient(request: NextRequest) {
  let pending = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }[]
      ) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        pending = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          pending.cookies.set(name, value, options)
        );
      },
    },
  });

  function withCookies(response: NextResponse) {
    pending.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value, cookie);
    });
    return response;
  }

  return { supabase, withCookies };
}

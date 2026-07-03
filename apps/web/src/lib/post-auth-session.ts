"use client";

import { createClient } from "@/lib/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { completeSessionRedirect } from "@/lib/session-redirect";

export { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      window.setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

/** Read session from local auth storage — avoids network calls that can hang after sign-in. */
export async function readLocalSession(timeoutMs = 1500): Promise<Session | null> {
  const supabase = createClient();
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), timeoutMs, {
      data: { session: null },
      error: null,
    });
    if (data.session) return data.session;
  } catch {
    /* ignore */
  }
  return null;
}

/** Safety net: if login UI is still visible after submit, force navigation to bootstrap. */
export function scheduleLoginEscapeRedirect(href: string, delayMs = 3000) {
  let cancelled = false;

  const attempt = () => {
    if (cancelled || !window.location.pathname.startsWith("/login")) return;
    completeSessionRedirect(href);
  };

  const t1 = window.setTimeout(attempt, delayMs);
  const t2 = window.setTimeout(attempt, delayMs + 2000);

  return () => {
    cancelled = true;
    window.clearTimeout(t1);
    window.clearTimeout(t2);
  };
}

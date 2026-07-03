"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { authLinkErrorMessage } from "@/lib/auth-callback-url";
import { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";

/** Handles Supabase hash redirects (#error=, #access_token=) when Site URL lands on app root. */
export function AuthHashHandler() {
  useEffect(() => {
    const hash = window.location.hash?.replace(/^#/, "");
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", cleanUrl);

    const authError = params.get("error");
    if (authError) {
      const code = params.get("error_code") ?? authError;
      const description = params.get("error_description");
      const message = authLinkErrorMessage(code, description);
      window.location.replace(
        `/login?auth_error=${encodeURIComponent(code)}&auth_message=${encodeURIComponent(message)}`
      );
      return;
    }

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) {
      const supabase = createClient();
      void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
        if (error) {
          window.location.replace(
            `/login?auth_error=session&auth_message=${encodeURIComponent(error.message)}`
          );
          return;
        }
        const type = params.get("type");
        const next = type === "recovery" ? "/reset-password" : POST_AUTH_BOOTSTRAP_PATH;
        window.location.replace(next);
      });
    }
  }, []);

  return null;
}

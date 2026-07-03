"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Fetched once per session — avoids a DB round-trip on every layout render. */
export function usePlatformAdmin(userId: string | undefined) {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function check() {
      const cached = sessionStorage.getItem(`pa:${userId}`);
      if (cached !== null) {
        if (!cancelled) {
          setIsPlatformAdmin(cached === "1");
          setLoaded(true);
        }
        return;
      }

      const supabase = createClient();
      const { data } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (cancelled) return;
      const isAdmin = !!data;
      sessionStorage.setItem(`pa:${userId}`, isAdmin ? "1" : "0");
      setIsPlatformAdmin(isAdmin);
      setLoaded(true);
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { isPlatformAdmin, loaded };
}

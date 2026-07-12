"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BroadcastBanner } from "@/lib/admin-types";
import { PlatformBanner } from "@/components/layout/platform-banner";

const CACHE_KEY = "nx_broadcast_v1";
const CACHE_TTL_MS = 120_000;

function readCachedBanner(): BroadcastBanner | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { banner: BroadcastBanner | null; ts: number };
    if (Date.now() - parsed.ts < CACHE_TTL_MS) return parsed.banner;
  } catch {
    /* ignore */
  }
  return null;
}

function hasFreshCache(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { ts: number };
    return Date.now() - parsed.ts < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

/** Loads broadcast banner client-side so tenant layout is not blocked on an extra RPC. */
export function PlatformBannerLoader() {
  const [banner, setBanner] = useState<BroadcastBanner | null>(() => readCachedBanner());

  useEffect(() => {
    if (hasFreshCache()) return;

    let cancelled = false;
    const supabase = createClient();
    void supabase.rpc("get_platform_broadcast").then(({ data }) => {
      if (cancelled) return;
      const next = (data as BroadcastBanner | null) ?? null;
      setBanner(next);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ banner: next, ts: Date.now() }));
      } catch {
        /* ignore */
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return <PlatformBanner banner={banner} />;
}

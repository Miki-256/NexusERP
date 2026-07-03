import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { BroadcastBanner } from "@/lib/admin-types";

/** Per-request dedupe — safe with cookies(); do not wrap in unstable_cache. */
export const getPlatformBroadcast = cache(async function getPlatformBroadcast(): Promise<BroadcastBanner | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_platform_broadcast");
  if (!data) return null;
  return data as BroadcastBanner;
});

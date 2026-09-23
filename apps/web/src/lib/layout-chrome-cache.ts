import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ActiveSupportSession } from "@/lib/admin-types";

/** Per-request dedupe for layout chrome (layout + nested pages). */
export const getCachedOrgDefaultLocale = cache(async (orgId: string): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select("default_locale")
    .eq("id", orgId)
    .maybeSingle();
  return typeof data?.default_locale === "string" ? data.default_locale : null;
});

export const getCachedActiveSupportSession = cache(
  async (): Promise<ActiveSupportSession | null> => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("admin_get_active_support_session");
    return (data as ActiveSupportSession | null) ?? null;
  }
);

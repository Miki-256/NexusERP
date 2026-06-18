import { createClient } from "@/lib/supabase/server";
import { ImportClient } from "./import-client";
import type { AdminOrg } from "../page";

export default async function ImportPage() {
  const supabase = await createClient();
  const { data: orgs } = await supabase.rpc("admin_list_organizations");
  return <ImportClient orgs={(orgs as AdminOrg[]) ?? []} />;
}

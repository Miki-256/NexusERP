import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPendingOrganizations } from "@/lib/workspace";

/** When user is signed in but has no active org workspace. */
export async function redirectIfNoActiveWorkspace() {
  const supabase = await createClient();
  const pending = await getPendingOrganizations(supabase);
  if (pending.length > 0) {
    redirect("/pending-approval");
  }
  redirect("/onboarding");
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganizationId } from "@/lib/org-context";
import { getPendingOrganizations, resolveUserWorkspace } from "@/lib/workspace";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const activeOrgId = await getActiveOrganizationId();
  const resolved = await resolveUserWorkspace(supabase, activeOrgId);

  if (resolved) {
    redirect("/dashboard");
  }

  const pending = await getPendingOrganizations(supabase);
  if (pending.length > 0) {
    redirect("/pending-approval");
  }

  return <OnboardingForm />;
}

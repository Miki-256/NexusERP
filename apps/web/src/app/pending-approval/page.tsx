import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getPendingOrganizations, resolveUserWorkspace } from "@/lib/workspace";
import { getActiveOrganizationId } from "@/lib/org-context";

export default async function PendingApprovalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const activeOrgId = await getActiveOrganizationId();
  const resolved = await resolveUserWorkspace(supabase, activeOrgId);
  if (resolved) {
    redirect("/dashboard");
  }

  const pending = await getPendingOrganizations(supabase);
  if (pending.length === 0) {
    redirect("/onboarding");
  }

  return (
    <AuthShell
      title="Awaiting approval"
      description="Your business registration has been submitted. A platform administrator must approve it before you can use Nexus ERP."
      footer={
        <>
          Already approved?{" "}
          <Link href="/dashboard" className="font-medium text-primary hover:underline">
            Check again
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          {pending.map((org) => (
            <li key={org.organization_id} className="flex items-center justify-between gap-3">
              <span className="font-medium">{org.organization_name}</span>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Pending
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          You will receive access once a super admin approves your organization from the Super Admin console.
        </p>
        <div className="flex flex-col gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link href="/dashboard">Refresh status</Link>
          </Button>
          <SignOutButton className="w-full" />
        </div>
      </div>
    </AuthShell>
  );
}

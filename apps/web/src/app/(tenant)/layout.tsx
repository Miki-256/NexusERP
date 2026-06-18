import { redirect } from "next/navigation";
import { getCurrentMembership, canManage } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";

export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentMembership();

  if (!ctx) {
    redirect("/onboarding");
  }

  const supabase = await createClient();
  const { data: adminRow } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", ctx.user.id)
    .maybeSingle();

  return (
    <div className="flex min-h-screen">
      <Sidebar
        orgName={ctx.organization.name}
        canManageTeam={canManage(ctx.member.role)}
        isPlatformAdmin={!!adminRow}
      />
      <main className="flex-1 overflow-auto bg-background p-6">
        {children}
      </main>
    </div>
  );
}

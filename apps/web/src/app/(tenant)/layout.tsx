import { redirect } from "next/navigation";
import { getCurrentMembership, canManage } from "@/lib/org-context";
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

  return (
    <div className="flex min-h-screen">
      <Sidebar
        orgName={ctx.organization.name}
        canManageTeam={canManage(ctx.member.role)}
      />
      <main className="flex-1 overflow-auto bg-background p-6">
        {children}
      </main>
    </div>
  );
}

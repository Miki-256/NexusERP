import { getCurrentMembership, canManage } from "@/lib/org-context";
import { redirect } from "next/navigation";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  return (
    <SettingsClient
      organization={ctx.organization}
      canManage={canManage(ctx.member.role)}
      isOwner={ctx.member.role === "owner"}
    />
  );
}

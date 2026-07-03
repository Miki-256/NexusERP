import { redirect } from "next/navigation";
import { getMemberPermissions } from "@/lib/org-context";
import type { ErpAppId } from "@/lib/app-permissions";

export async function requireAppAccess(appId: ErpAppId) {
  const ctx = await getMemberPermissions();
  if (!ctx) redirect("/onboarding");
  if (!ctx.canAccessApp(appId)) redirect("/dashboard");
  return ctx;
}

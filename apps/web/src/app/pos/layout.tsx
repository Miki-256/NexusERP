import { getCurrentMembership } from "@/lib/org-context";
import { redirect } from "next/navigation";

export default async function PosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");
  return <>{children}</>;
}

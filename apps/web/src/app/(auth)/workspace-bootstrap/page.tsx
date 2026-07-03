import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { resolveBootstrapDestination } from "@/lib/workspace-bootstrap";

export const dynamic = "force-dynamic";

const COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  httpOnly: true,
  sameSite: "lax" as const,
};

/** Post-auth landing page — safe for RSC POST navigations (unlike the API route). */
export default async function WorkspaceBootstrapPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;
  const destination = await resolveBootstrapDestination(supabase, activeOrgId);

  if (destination.orgCookie) {
    cookieStore.set(ACTIVE_ORG_COOKIE, destination.orgCookie, COOKIE_OPTIONS);
  }

  redirect(destination.path);
}

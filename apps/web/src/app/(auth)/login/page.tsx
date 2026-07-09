import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { resolveBootstrapDestination } from "@/lib/workspace-bootstrap";
import { LoginForm } from "./login-form";
import { AuthPageSkeleton } from "@/components/ui/loading";

const ORG_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  httpOnly: true,
  sameSite: "lax" as const,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    invite?: string;
    reset?: string;
    signup?: string;
    disabled?: string;
    auth_error?: string;
    auth_message?: string;
    error?: string;
    error_description?: string;
    message?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const cookieStore = await cookies();
    const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;
    const destination = await resolveBootstrapDestination(supabase, activeOrgId);
    if (destination.orgCookie) {
      cookieStore.set(ACTIVE_ORG_COOKIE, destination.orgCookie, ORG_COOKIE_OPTIONS);
    }
    redirect(destination.path);
  }

  const params = await searchParams;
  const inviteId = params.invite ?? null;
  const resetSuccess = params.reset === "success";
  const signupPending = params.signup === "pending";
  const accountDisabled = params.disabled === "1";
  const authError = params.auth_error ?? params.error ?? null;
  const authMessage =
    params.auth_message ?? params.message ?? params.error_description ?? null;

  return (
    <Suspense fallback={<AuthPageSkeleton />}>
      <LoginForm
        inviteId={inviteId}
        resetSuccess={resetSuccess}
        signupPending={signupPending}
        accountDisabled={accountDisabled}
        authError={authError}
        authMessage={authMessage}
      />
    </Suspense>
  );
}

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";
import { LoginForm } from "./login-form";
import { AuthPageSkeleton } from "@/components/ui/loading";

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
    redirect(POST_AUTH_BOOTSTRAP_PATH);
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

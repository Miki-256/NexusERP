"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/layout/auth-shell";
import { authCallbackUrl } from "@/lib/auth-callback-url";
import { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";
import { completeSessionRedirect } from "@/lib/session-redirect";
import { setActiveOrganization } from "@/app/actions/switch-organization";

type InvitePreview = {
  email: string;
  role: string;
  organization_name: string;
};

async function acceptInvite(inviteId: string) {
  const supabase = createClient();
  return supabase.rpc("accept_staff_invite", { p_invite_id: inviteId });
}

export function AcceptInviteClient({
  inviteId,
  awaitingEmailConfirm,
}: {
  inviteId: string | null;
  awaitingEmailConfirm: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!inviteId);
  const [accepting, setAccepting] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(false);

  const tryJoinTeam = useCallback(async () => {
    if (!inviteId) return false;
    setAccepting(true);
    setError(null);
    const { data: orgId, error: fnError } = await acceptInvite(inviteId);
    setAccepting(false);
    if (fnError) {
      setError(fnError.message);
      return false;
    }
    if (orgId) await setActiveOrganization(orgId);
    completeSessionRedirect(POST_AUTH_BOOTSTRAP_PATH);
    return true;
  }, [inviteId, router]);

  const checkSessionAndJoin = useCallback(async () => {
    if (!inviteId) return;
    setCheckingSession(true);
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    setCheckingSession(false);

    if (sessionData.session?.user) {
      setIsLoggedIn(true);
      await tryJoinTeam();
    } else {
      setError("Not signed in yet. Confirm your email first, or sign in with your new password.");
    }
  }, [inviteId, tryJoinTeam]);

  useEffect(() => {
    async function init() {
      if (!inviteId) {
        setLoading(false);
        return;
      }

      const supabase = createClient();
      const [{ data: sessionData }, { data: previewData }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.rpc("get_staff_invite_preview", { p_invite_id: inviteId }),
      ]);

      const loggedIn = !!sessionData.session?.user;
      setIsLoggedIn(loggedIn);
      setPreview(previewData as InvitePreview | null);
      setLoading(false);

      if (loggedIn && previewData && !awaitingEmailConfirm) {
        await tryJoinTeam();
      }
    }

    init();
  }, [inviteId, awaitingEmailConfirm, tryJoinTeam]);

  useEffect(() => {
    if (!awaitingEmailConfirm || !inviteId || isLoggedIn) return;

    const interval = setInterval(async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        setIsLoggedIn(true);
        clearInterval(interval);
        await tryJoinTeam();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [awaitingEmailConfirm, inviteId, isLoggedIn, tryJoinTeam]);

  async function resendConfirmation() {
    if (!preview?.email || !inviteId) return;
    setResendLoading(true);
    setResendMessage(null);
    setError(null);
    const supabase = createClient();
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: preview.email,
      options: {
        emailRedirectTo: authCallbackUrl(`/invite?id=${inviteId}`),
      },
    });
    setResendLoading(false);
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setResendMessage("Confirmation email sent again. Check your inbox and spam folder.");
  }

  const signupHref = inviteId ? `/signup?invite=${inviteId}` : "/signup";
  const loginHref = inviteId ? `/login?invite=${inviteId}` : "/login";

  if (loading) {
    return (
      <AuthShell title="Accept invitation" description="Loading your invite…">
        <p className="text-sm text-muted-foreground">Please wait…</p>
      </AuthShell>
    );
  }

  if (!inviteId) {
    return (
      <AuthShell title="Accept invitation" description="Join your team on Nexus ERP">
        <p className="mb-4 text-sm text-muted-foreground">Missing invite ID in URL.</p>
      </AuthShell>
    );
  }

  if (!preview) {
    return (
      <AuthShell title="Invite not found" description="This link may have expired or already been used.">
        <p className="text-sm text-muted-foreground">
          Ask your manager to send a new invite from Team &amp; access.
        </p>
      </AuthShell>
    );
  }

  if (awaitingEmailConfirm && !isLoggedIn) {
    return (
      <AuthShell
        title="Confirm your email"
        description={`One last step to join ${preview.organization_name}.`}
      >
        <div className="mb-6 space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-800 dark:text-emerald-200">Account created</p>
          <p className="text-muted-foreground">
            If email confirmation is enabled, we may have sent a link to{" "}
            <strong className="text-foreground">{preview.email}</strong>.
            Invited users can skip waiting — use the button below or sign up again from your invite link.
          </p>
        </div>

        <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Fastest:</strong> open your invite link and submit signup again
            with the same email and password (no email needed).
          </li>
          <li>Or confirm via email if you received one, then click the button below.</li>
          <li>Or sign in with your password after confirming.</li>
        </ol>

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        {resendMessage && <p className="mb-4 text-sm text-emerald-700">{resendMessage}</p>}

        <div className="space-y-2">
          <Button
            className="w-full shadow-sm"
            disabled={checkingSession || accepting}
            onClick={checkSessionAndJoin}
          >
            {checkingSession || accepting ? "Checking…" : "I've confirmed my email — join team"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={resendLoading}
            onClick={resendConfirmation}
          >
            {resendLoading ? "Sending…" : "Resend confirmation email"}
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href={signupHref}>Try signup again (no email required)</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href={loginHref}>Sign in with password</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (!isLoggedIn) {
    return (
      <AuthShell
        title={`Join ${preview.organization_name}`}
        description="You were invited to Nexus ERP. Create an account or sign in to continue."
      >
        <div className="mb-6 space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Invited email:</span>{" "}
            <strong>{preview.email}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Role:</span>{" "}
            <strong className="capitalize">{preview.role}</strong>
          </p>
        </div>

        <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">New user?</strong> Create an account and choose a password
            (use the invited email).
          </li>
          <li>
            <strong className="text-foreground">Already have an account?</strong> Sign in with that email.
          </li>
          <li>You&apos;ll return here automatically to join the team.</li>
        </ol>

        <div className="space-y-2">
          <Button asChild className="w-full shadow-sm">
            <Link href={signupHref}>Create account &amp; set password</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href={loginHref}>I already have an account — Sign in</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${preview.organization_name}`}
      description="Confirm to access your team's workspace."
    >
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      <p className="mb-4 text-sm text-muted-foreground">
        Joining as <strong>{preview.email}</strong> ({preview.role}).
      </p>
      <Button onClick={tryJoinTeam} disabled={accepting} className="w-full shadow-sm">
        {accepting ? "Joining…" : "Accept invite & go to dashboard"}
      </Button>
    </AuthShell>
  );
}

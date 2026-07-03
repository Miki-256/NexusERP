"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptPendingStaffInvite } from "@/lib/accept-pending-invite";
import { setActiveOrganization } from "@/app/actions/switch-organization";
import { LoadingButton, LoadingSpinner } from "@/components/ui/loading";
import { completeSessionRedirect } from "@/lib/session-redirect";
import { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/layout/auth-shell";

export function SignupForm({ inviteId }: { inviteId: string | null }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [inviteLoaded, setInviteLoaded] = useState(!inviteId);

  useEffect(() => {
    if (!inviteId) return;
    const supabase = createClient();
    supabase.rpc("get_staff_invite_preview", { p_invite_id: inviteId }).then(({ data }) => {
      const preview = data as { email?: string; organization_name?: string } | null;
      if (preview?.email) setEmail(preview.email);
      if (preview?.organization_name) setOrgName(preview.organization_name);
      setInviteLoaded(true);
    });
  }, [inviteId]);

  async function handleInviteSignup() {
    const res = await fetch("/api/invite/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteId,
        email: email.toLowerCase(),
        password,
        fullName: fullName.trim(),
      }),
    });
    const payload = (await res.json()) as { error?: string };
    if (!res.ok) {
      throw new Error(payload.error ?? "Could not create account");
    }

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
      password,
    });
    if (signInError) {
      throw new Error(
        `${signInError.message} Try signing in from the invite link with the same password.`
      );
    }

    const { data: orgId, error: acceptError } = await supabase.rpc("accept_staff_invite", {
      p_invite_id: inviteId,
    });
    if (acceptError) {
      const joined = await acceptPendingStaffInvite(supabase);
      if (!joined) throw new Error(acceptError.message);
      await setActiveOrganization(joined);
    } else if (orgId) {
      await setActiveOrganization(orgId);
    }

    completeSessionRedirect(POST_AUTH_BOOTSTRAP_PATH);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (inviteId) {
        await handleInviteSignup();
        return;
      }

      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.toLowerCase(),
          password,
          fullName: fullName.trim(),
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "Could not create account");
      }

      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase(),
        password,
      });
      if (signInError) {
        throw new Error(signInError.message);
      }

      completeSessionRedirect("/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (inviteId && !inviteLoaded) {
    return (
      <AuthShell title="Create your account" description="Loading your invite…">
        <LoadingSpinner label="Please wait…" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={inviteId ? `Join ${orgName ?? "your team"}` : "Create your account"}
      description={
        inviteId
          ? "Set a password for your new ERP account. No confirmation email required for invites."
          : "Start your free Nexus ERP workspace. No email confirmation — a platform admin approves new businesses."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={inviteId ? `/login?invite=${inviteId}` : "/login"}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            readOnly={!!inviteId && !!email}
            className={inviteId && email ? "bg-muted" : undefined}
          />
          {inviteId && (
            <p className="text-xs text-muted-foreground">Must match the email on your invite.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            placeholder="At least 8 characters"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <LoadingButton
          type="submit"
          className="w-full shadow-sm"
          loading={loading}
          loadingLabel="Creating account…"
        >
          {inviteId ? "Create account & join team" : "Continue"}
        </LoadingButton>
      </form>
    </AuthShell>
  );
}

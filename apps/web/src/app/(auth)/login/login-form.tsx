"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { LoadingButton, PageLoader } from "@/components/ui/loading";
import { scheduleLoginEscapeRedirect, withTimeout } from "@/lib/post-auth-session";
import { completeSessionRedirect } from "@/lib/session-redirect";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/layout/auth-shell";
import { authLinkErrorMessage } from "@/lib/auth-callback-url";

function followLoginRedirect(response: Response): boolean {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get("Location");
  if (location) {
    completeSessionRedirect(location);
    return true;
  }
  return false;
}

export function LoginForm({
  inviteId,
  resetSuccess,
  signupPending,
  accountDisabled,
  authError,
  authMessage,
}: {
  inviteId: string | null;
  resetSuccess: boolean;
  signupPending: boolean;
  accountDisabled?: boolean;
  authError?: string | null;
  authMessage?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("Signing in…");

  const postAuthPath = "/dashboard";

  useEffect(() => {
    if (!busy) return;
    return scheduleLoginEscapeRedirect(postAuthPath, 4000);
  }, [busy]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    flushSync(() => {
      setBusy(true);
      setBusyMessage("Signing in…");
      setError(null);
    });

    let navigated = false;

    try {
      const normalizedEmail = email.trim().toLowerCase();

      const response = await withTimeout(
        fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            email: normalizedEmail,
            password,
            inviteId,
          }),
        }),
        25_000,
        null
      );

      if (!response) {
        setError("Sign-in timed out. Please try again.");
        return;
      }

      // fetch + redirect:"manual" can yield opaqueredirect (status 0) even when cookies were set.
      if (response.type === "opaqueredirect" || response.status === 0) {
        setBusyMessage("Opening your workspace…");
        navigated = true;
        completeSessionRedirect(postAuthPath);
        return;
      }

      if (followLoginRedirect(response)) {
        navigated = true;
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        redirect?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Could not sign in");
        return;
      }

      setBusyMessage("Opening your workspace…");
      navigated = true;
      completeSessionRedirect(payload.redirect ?? postAuthPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (!navigated) {
        setBusy(false);
      }
    }
  }

  return (
    <>
      {busy && <PageLoader message={busyMessage} />}
      <AuthShell
        title="Welcome back"
        description={
          inviteId
            ? "Sign in to accept your team invitation"
            : "Sign in to your Nexus ERP account"
        }
        busy={busy}
        busyMessage={busyMessage}
        footer={
          <>
            No account?{" "}
            <Link
              href={inviteId ? `/signup?invite=${inviteId}` : "/signup"}
              className="font-medium text-primary hover:underline"
            >
              Create account
            </Link>
          </>
        }
      >
        {authError && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {authMessage ?? authLinkErrorMessage(authError)}
            {(authError === "otp_expired" || authError === "access_denied") && (
              <>
                {" "}
                <Link href="/forgot-password" className="font-medium underline">
                  Request a new reset link
                </Link>
              </>
            )}
          </p>
        )}
        {accountDisabled && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            Your account has been disabled. Contact platform support if you believe this is an error.
          </p>
        )}
        {signupPending && (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Your business is awaiting platform admin approval. Sign in to check status or complete shop setup.
          </p>
        )}
        {resetSuccess && (
          <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Password updated. Sign in with your new password.
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <LoadingButton
            type="submit"
            className="touch-target min-h-11 w-full shadow-sm"
            loading={busy}
            loadingLabel={busyMessage}
          >
            {inviteId ? "Sign in & accept invite" : "Sign in"}
          </LoadingButton>
        </form>
      </AuthShell>
    </>
  );
}

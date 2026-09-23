"use client";

import Link from "next/link";
import { useState } from "react";
import { flushSync } from "react-dom";
import { LoadingButton, PageLoader } from "@/components/ui/loading";
import { scheduleLoginEscapeRedirect, withTimeout } from "@/lib/post-auth-session";
import { completeSessionRedirect } from "@/lib/session-redirect";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/layout/auth-shell";
import { authLinkErrorMessage } from "@/lib/auth-callback-url";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState(() => t("signingIn"));

  const postAuthPath = "/dashboard";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    flushSync(() => {
      setBusy(true);
      setBusyMessage(t("signingIn"));
      setError(null);
    });

    let navigated = false;
    let destination = postAuthPath;
    let stopEscape: (() => void) | undefined;

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
        setError(t("signInTimeout"));
        return;
      }

      // Never treat status 0 / opaque as success — that caused dashboard→login bounce
      // before cookies existed (login often takes >4s on preprod).
      if (response.type === "opaqueredirect" || response.status === 0) {
        setError(t("couldNotSignIn"));
        return;
      }

      if (followLoginRedirect(response)) {
        navigated = true;
        stopEscape = scheduleLoginEscapeRedirect(postAuthPath, 6000);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        redirect?: string;
        access_token?: string;
        refresh_token?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? t("couldNotSignIn"));
        return;
      }

      if (!payload.ok) {
        setError(payload.error ?? t("couldNotSignIn"));
        return;
      }

      // Ensure browser storage/cookies have the session even if Set-Cookie was ignored.
      if (payload.access_token && payload.refresh_token) {
        try {
          const supabase = createClient();
          await withTimeout(
            supabase.auth.setSession({
              access_token: payload.access_token,
              refresh_token: payload.refresh_token,
            }),
            8_000,
            null
          );
        } catch {
          // Cookies from the login response may still work — continue to redirect.
        }
      }

      destination = payload.redirect ?? postAuthPath;
      setBusyMessage(t("openingWorkspace"));
      navigated = true;
      // Only after a real success — never while the login request is still in flight.
      stopEscape = scheduleLoginEscapeRedirect(destination, 6000);
      completeSessionRedirect(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("somethingWentWrong"));
    } finally {
      if (!navigated) {
        stopEscape?.();
        setBusy(false);
      } else {
        // If middleware bounces us back to /login (cookies dropped), recover the form.
        window.setTimeout(() => {
          if (window.location.pathname.startsWith("/login")) {
            stopEscape?.();
            setBusy(false);
            setError(t("couldNotSignIn"));
          }
        }, 3500);
      }
    }
  }

  return (
    <>
      {busy && <PageLoader variant="login" message={busyMessage} />}
      <AuthShell
        title={t("welcomeBack")}
        description={inviteId ? t("signInInvite") : t("signInTitle")}
        busy={busy}
        busyMessage={busyMessage}
        footer={
          <>
            {t("noAccount")}{" "}
            <Link
              href={inviteId ? `/signup?invite=${inviteId}` : "/signup"}
              className="font-medium text-primary hover:underline"
            >
              {t("createAccount")}
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
                  {t("requestNewResetLink")}
                </Link>
              </>
            )}
          </p>
        )}
        {accountDisabled && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {t("accountDisabled")}
          </p>
        )}
        {signupPending && (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {t("signupPending")}
          </p>
        )}
        {resetSuccess && (
          <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {t("passwordUpdated")}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("password")}</Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                {t("forgotPassword")}
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
            {inviteId ? t("signInAccept") : t("signIn")}
          </LoadingButton>
        </form>
      </AuthShell>
    </>
  );
}

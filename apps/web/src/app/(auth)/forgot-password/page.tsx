"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LoadingButton } from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/layout/auth-shell";
import { authCallbackUrl } from "@/lib/auth-callback-url";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const redirectTo = authCallbackUrl("/reset-password");

    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    setLoading(false);
    if (authError) return setError(authError.message);
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        description={`If an account exists for ${email}, we sent a password reset link.`}
        footer={
          <>
            <Link href="/login" className="font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Open the link in the email to choose a new password. The link expires after a
          short time. If you do not see the email, check your spam folder.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          onClick={() => setSent(false)}
        >
          Use a different email
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Forgot password"
      description="Enter your email and we will send you a reset link"
      footer={
        <>
          Remember your password?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <LoadingButton
          type="submit"
          className="w-full shadow-sm"
          loading={loading}
          loadingLabel="Sending link…"
        >
          Send reset link
        </LoadingButton>
      </form>
    </AuthShell>
  );
}

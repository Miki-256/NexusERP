"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/layout/status-badge";
import { FormCard } from "@/components/layout/form-card";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { ROLE_LABELS, type UserProfile } from "@/lib/admin-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { AccessDebugger } from "@/app/admin/security/access-debugger";

export function UserProfileClient({
  profile,
  canManageSecurity,
  canWrite,
}: {
  profile: UserProfile;
  canManageSecurity: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { user } = profile;
  const security = profile.security;
  const isDisabled = security?.is_disabled || (security?.banned_until && new Date(security.banned_until) > new Date());

  async function securityAction(action: "disable" | "enable" | "revoke_sessions") {
    setBusy(action);
    const res = await fetch(`/api/admin/users/${user.id}/security`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason: reason.trim() || undefined }),
    });
    const payload = (await res.json()) as { error?: string };
    setBusy(null);
    if (!res.ok) {
      toast({ title: "Action failed", description: payload.error, variant: "destructive" });
      return;
    }
    toast({ title: "Security action completed" });
    router.refresh();
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }

    setBusy("reset_password");
    const res = await fetch(`/api/admin/users/${user.id}/security`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_password",
        password: newPassword,
        reason: reason.trim() || undefined,
      }),
    });
    const payload = (await res.json()) as { error?: string };
    setBusy(null);
    if (!res.ok) {
      toast({ title: "Password reset failed", description: payload.error, variant: "destructive" });
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    toast({
      title: "Password updated",
      description: "Share the new password with the user securely. All their sessions were signed out.",
    });
    router.refresh();
  }

  async function clearLoginLockout(lockoutType: "login_email" | "login_ip", identifier: string) {
    setBusy(`unlock_${lockoutType}`);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_unlock_auth_lockout", {
      p_lockout_type: lockoutType,
      p_identifier: identifier,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Unlock failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Login lockout cleared",
      description:
        lockoutType === "login_email"
          ? "The user can try signing in again with their email."
          : "IP lockout cleared for this identifier.",
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{user.email}</h1>
          {isDisabled && <StatusBadge status="suspended" />}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Joined {new Date(user.created_at).toLocaleString()}
          {user.last_sign_in_at && (
            <> · Last sign-in {new Date(user.last_sign_in_at).toLocaleString()}</>
          )}
        </p>
        {profile.is_platform_admin && profile.platform_admin_role && (
          <p className="mt-2 text-sm">
            Platform role: <span className="font-medium">{ROLE_LABELS[profile.platform_admin_role]}</span>
          </p>
        )}
        {security?.disabled_reason && (
          <p className="mt-2 text-sm text-amber-800">Disabled: {security.disabled_reason}</p>
        )}
      </div>

      {canWrite && user.email && (
        <FormCard
          title="Login lockout"
          description='Clears "Too many failed attempts" so the user can sign in immediately.'
        >
          <p className="mb-3 text-sm text-muted-foreground">
            Lockouts are usually per email. If login still fails, also check{" "}
            <Link href="/admin/security/throttle" className="font-medium text-primary hover:underline">
              Auth throttling → Active lockouts
            </Link>{" "}
            for an IP-based lockout.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => clearLoginLockout("login_email", user.email!)}
          >
            {busy === "unlock_login_email" ? "Clearing…" : "Clear login lockout (email)"}
          </Button>
        </FormCard>
      )}

      {canManageSecurity && (
        <FormCard title="Security actions" description="Super admin only — requires SUPABASE_SERVICE_ROLE_KEY.">
          <div className="space-y-3">
            <Input
              placeholder="Reason (optional, for disable)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="max-w-md"
            />
            <div className="flex flex-wrap gap-2">
              {!isDisabled ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => securityAction("disable")}
                >
                  {busy === "disable" ? "Disabling…" : "Disable account"}
                </Button>
              ) : (
                <Button size="sm" disabled={busy !== null} onClick={() => securityAction("enable")}>
                  {busy === "enable" ? "Enabling…" : "Re-enable account"}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => securityAction("revoke_sessions")}
              >
                {busy === "revoke_sessions" ? "Revoking…" : "Force logout (all sessions)"}
              </Button>
            </div>
          </div>
        </FormCard>
      )}

      {canManageSecurity && (
        <FormCard
          title="Reset password"
          description="For users who forgot their password. Sets a new password and signs them out everywhere."
        >
          <form onSubmit={resetPassword} className="max-w-md space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-new-password">New password</Label>
              <PasswordInput
                id="admin-new-password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-confirm-password">Confirm password</Label>
              <PasswordInput
                id="admin-confirm-password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Send the new password to the user through a secure channel (not email if you can avoid it).
              They can sign in immediately at the login page.
            </p>
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === "reset_password" ? "Saving…" : "Set new password"}
            </Button>
          </form>
        </FormCard>
      )}

      <AccessDebugger
        userId={user.id}
        organizationId={profile.memberships[0]?.organization_id ?? null}
      />

      <FormCard title="Organization memberships">
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Organization</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead>Role</DataTableHead>
              <DataTableHead>Joined</DataTableHead>
              <DataTableHead align="right">Open</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {profile.memberships.length === 0 ? (
                <DataTableEmpty colSpan={5} message="No organization memberships." />
              ) : (
                profile.memberships.map((m) => (
                  <DataTableRow key={m.member_id}>
                    <DataTableCell className="font-medium">{m.organization_name}</DataTableCell>
                    <DataTableCell>
                      <StatusBadge status={m.organization_status} />
                    </DataTableCell>
                    <DataTableCell className="capitalize">{m.role}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {new Date(m.joined_at).toLocaleDateString()}
                    </DataTableCell>
                    <DataTableCell align="right">
                      <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                        <Link href={`/admin/organizations/${m.organization_id}`}>Org</Link>
                      </Button>
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
      </FormCard>

      <Button variant="outline" size="sm" asChild>
        <Link href="/admin/users">← Back to search</Link>
      </Button>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  ROLE_LABELS,
  type PlatformAdmin,
  type PlatformAdminRole,
} from "@/lib/admin-types";

const ROLES: PlatformAdminRole[] = ["super_admin", "support", "security"];

export function AdminsClient({
  admins,
  canManageAdmins,
}: {
  admins: PlatformAdmin[];
  canManageAdmins: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRole, setGrantRole] = useState<PlatformAdminRole>("support");

  async function grantAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    setBusy("grant");
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_grant_platform_admin", {
      p_email: grantEmail.trim(),
      p_role: grantRole,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Grant failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Platform access granted", description: grantEmail });
    setGrantEmail("");
    router.refresh();
  }

  async function revokeAdmin(userId: string) {
    setBusy(userId);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_revoke_platform_admin", { p_user_id: userId });
    setBusy(null);
    if (error) {
      toast({ title: "Revoke failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Access revoked" });
    router.refresh();
  }

  async function changeRole(userId: string, role: PlatformAdminRole) {
    setBusy(`role-${userId}`);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_set_platform_admin_role", {
      p_user_id: userId,
      p_role: role,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Role update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Role updated" });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <FormCard
        title="Role tiers"
        description="Super Admin: full control. App Support: approve orgs and import data. Security: read-only audit and org views."
      >
        <ul className="grid gap-2 text-sm sm:grid-cols-3">
          {ROLES.map((role) => (
            <li key={role} className="rounded-md border px-3 py-2">
              <p className="font-medium">{ROLE_LABELS[role]}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {role === "super_admin" && "Manage admins, approve/suspend orgs, imports."}
                {role === "support" && "Approve/suspend orgs, imports. No admin management."}
                {role === "security" && "View orgs and audit logs only."}
              </p>
            </li>
          ))}
        </ul>
      </FormCard>

      {canManageAdmins ? (
        <FormCard title="Grant platform access">
          <form onSubmit={grantAdmin} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="grantEmail">User email</Label>
              <Input
                id="grantEmail"
                type="email"
                placeholder="user@email.com"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="grantRole">Role</Label>
              <select
                id="grantRole"
                value={grantRole}
                onChange={(e) => setGrantRole(e.target.value as PlatformAdminRole)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={busy === "grant"}>
              Grant access
            </Button>
          </form>
        </FormCard>
      ) : (
        <p className="text-sm text-muted-foreground">Only super admins can grant or revoke platform access.</p>
      )}

      <FormCard title="Current platform admins">
        <ul className="divide-y rounded-lg border">
          {admins.map((a) => (
            <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{a.email}</p>
                <p className="text-xs text-muted-foreground">
                  Since {new Date(a.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canManageAdmins ? (
                  <select
                    value={a.role}
                    disabled={busy === `role-${a.user_id}`}
                    onChange={(e) => changeRole(a.user_id, e.target.value as PlatformAdminRole)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <StatusBadge status={a.role} />
                )}
                {canManageAdmins && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-red-600"
                    disabled={busy === a.user_id}
                    onClick={() => revokeAdmin(a.user_id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </FormCard>
    </div>
  );
}

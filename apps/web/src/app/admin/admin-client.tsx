"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminOrg, PlatformAdmin } from "./page";

type OrgStatus = AdminOrg["status"];

const statusStyles: Record<OrgStatus, string> = {
  active: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  suspended: "bg-red-100 text-red-800",
};

export function AdminClient({
  orgs,
  admins,
}: {
  orgs: AdminOrg[];
  admins: PlatformAdmin[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [grantEmail, setGrantEmail] = useState("");
  const [error, setError] = useState("");

  async function setStatus(orgId: string, status: OrgStatus) {
    setBusy(orgId);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.rpc("admin_set_org_status", {
      p_org_id: orgId,
      p_status: status,
    });
    setBusy(null);
    if (err) return setError(err.message);
    router.refresh();
  }

  async function grantAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!grantEmail.trim()) return;
    setBusy("grant");
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.rpc("admin_grant_platform_admin", {
      p_email: grantEmail.trim(),
    });
    setBusy(null);
    if (err) return setError(err.message);
    setGrantEmail("");
    router.refresh();
  }

  async function revokeAdmin(userId: string) {
    setBusy(userId);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.rpc("admin_revoke_platform_admin", {
      p_user_id: userId,
    });
    setBusy(null);
    if (err) return setError(err.message);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Plan</th>
                <th className="p-3 text-right">Members</th>
                <th className="p-3 text-left">Created</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">
                    No organizations yet.
                  </td>
                </tr>
              ) : (
                orgs.map((o) => (
                  <tr key={o.id} className="border-b">
                    <td className="p-3 font-medium">{o.name}</td>
                    <td className="p-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusStyles[o.status]}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="p-3 capitalize text-muted-foreground">{o.plan}</td>
                    <td className="p-3 text-right">{o.member_count}</td>
                    <td className="p-3 text-muted-foreground">
                      {new Date(o.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        {o.status !== "active" && (
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={busy === o.id}
                            onClick={() => setStatus(o.id, "active")}
                          >
                            Approve
                          </Button>
                        )}
                        {o.status !== "suspended" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-red-600"
                            disabled={busy === o.id}
                            onClick={() => setStatus(o.id, "suspended")}
                          >
                            Suspend
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform Admins</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={grantAdmin} className="flex gap-2">
            <Input
              type="email"
              placeholder="user@email.com"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              className="max-w-xs"
            />
            <Button type="submit" disabled={busy === "grant"}>
              Grant Admin
            </Button>
          </form>
          <ul className="divide-y rounded-md border">
            {admins.map((a) => (
              <li key={a.user_id} className="flex items-center justify-between p-3 text-sm">
                <span>{a.email}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-red-600"
                  disabled={busy === a.user_id}
                  onClick={() => revokeAdmin(a.user_id)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

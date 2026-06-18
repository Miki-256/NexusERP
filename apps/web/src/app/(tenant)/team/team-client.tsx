"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TeamClient({
  organizationId,
  invites,
  members,
}: {
  organizationId: string;
  invites: { id: string; email: string; role: string; created_at: string }[];
  members: { id: string; role: string; is_active: boolean; user_id: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"cashier" | "manager">("cashier");
  const [loading, setLoading] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("staff_invites").insert({
      organization_id: organizationId,
      email: email.toLowerCase(),
      role,
      invited_by: user!.id,
    });
    setLoading(false);
    setEmail("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Team</h1>

      <Card>
        <CardHeader>
          <CardTitle>Invite staff</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <select
                className="flex h-10 rounded-md border px-3 text-sm"
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "cashier" | "manager")
                }
              >
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <Button type="submit" className="self-end" disabled={loading}>
              Send invite
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Invitee must sign up with this email, then accept the invite from
            their dashboard link.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="text-sm">
                {i.email} — {i.role}
              </li>
            ))}
            {invites.length === 0 && (
              <p className="text-muted-foreground">No pending invites</p>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="text-sm">
                {m.user_id.slice(0, 8)}… — {m.role}{" "}
                {!m.is_active && "(inactive)"}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

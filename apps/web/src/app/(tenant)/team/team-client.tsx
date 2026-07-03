"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { FormCard } from "@/components/layout/form-card";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { relationName } from "@/lib/utils";
import { Copy, Pencil, Shield, AlertTriangle } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import { parsePlanLimitError, planLimitToastDescription } from "@/lib/plan-errors";
import { cn } from "@/lib/utils";
import {
  MemberAccessEditor,
  type DepartmentRoleRow,
} from "./member-access-editor";

type TeamTab = "access" | "pos" | "invites";

type PosStaffRow = {
  id: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

type RegisterRow = {
  id: string;
  name: string;
  stores: { name: string } | { name: string }[] | null;
};

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function TeamClient({
  organizationId,
  invites,
  members,
  posStaff,
  registers,
  departmentRoles,
  roleIdsByMember,
  overridesByMember,
  permissionsReady,
}: {
  organizationId: string;
  invites: { id: string; email: string; role: string; created_at: string }[];
  members: { id: string; role: string; is_active: boolean; user_id: string }[];
  posStaff: PosStaffRow[];
  registers: RegisterRow[];
  departmentRoles: DepartmentRoleRow[];
  roleIdsByMember: Record<string, string[]>;
  overridesByMember: Record<string, { app_id: string; access: "grant" | "deny" }[]>;
  permissionsReady: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<TeamTab>("access");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"cashier" | "manager">("cashier");
  const [loading, setLoading] = useState(false);
  const [initRolesLoading, setInitRolesLoading] = useState(false);

  const [staffName, setStaffName] = useState("");
  const [staffPin, setStaffPin] = useState("");
  const [staffRole, setStaffRole] = useState<"cashier" | "manager">("cashier");
  const [staffLoading, setStaffLoading] = useState(false);
  const [resetPinStaffId, setResetPinStaffId] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffName, setEditStaffName] = useState("");
  const [editStaffRole, setEditStaffRole] = useState<"cashier" | "manager">("cashier");
  const [editStaffLoading, setEditStaffLoading] = useState(false);
  const [editingAccessMemberId, setEditingAccessMemberId] = useState<string | null>(null);

  const configurableMembers = members.filter((m) => m.role !== "owner");
  const ownerOnly = configurableMembers.length === 0;

  async function handleInitRoles() {
    setInitRolesLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("ensure_org_department_roles", {
      p_org_id: organizationId,
    });
    setInitRolesLoading(false);
    if (error) {
      toast({
        title: "Could not initialize roles",
        description:
          error.message.includes("does not exist") || error.message.includes("schema cache")
            ? "Run migration 20260618000016_department_roles.sql in Supabase SQL Editor first."
            : error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Department roles ready", description: "You can now assign HR, Finance, Inventory, and other roles." });
    router.refresh();
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: invite, error } = await supabase
      .from("staff_invites")
      .insert({
        organization_id: organizationId,
        email: email.toLowerCase(),
        role,
        invited_by: user!.id,
      })
      .select("id")
      .single();
    setLoading(false);
    if (error) {
      const parsed = parsePlanLimitError(error);
      return toast({
        title: parsed.isPlanLimit ? parsed.title : "Invite failed",
        description: planLimitToastDescription(parsed),
        variant: "destructive",
      });
    }
    if (invite?.id) {
      await copyInviteLink(invite.id, email.toLowerCase());
    } else {
      toast({ title: "Invite sent", description: `${email} — copy the link from pending invites.` });
    }
    setEmail("");
    setTab("access");
    router.refresh();
  }

  async function handleAddPosStaff(e: React.FormEvent) {
    e.preventDefault();
    setStaffLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("create_pos_staff", {
      p_organization_id: organizationId,
      p_display_name: staffName.trim(),
      p_pin: staffPin,
      p_role: staffRole,
    });
    setStaffLoading(false);
    if (error) {
      toast({ title: "Could not add staff", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "POS staff added", description: staffName });
    setStaffName("");
    setStaffPin("");
    router.refresh();
  }

  async function handleResetPin(staffId: string) {
    if (newPin.length < 4) {
      toast({ title: "PIN must be 4–6 digits", variant: "destructive" });
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.rpc("reset_pos_staff_pin", {
      p_staff_id: staffId,
      p_pin: newPin,
    });
    if (error) {
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "PIN updated" });
    setResetPinStaffId(null);
    setNewPin("");
  }

  async function copyRegisterUrl(path: string) {
    const url = `${window.location.origin}${path}`;
    await navigator.clipboard.writeText(url);
    toast({ title: "Register link copied", description: url });
  }

  async function copyInviteLink(inviteId: string, email: string) {
    const url = `${window.location.origin}/invite?id=${inviteId}`;
    await navigator.clipboard.writeText(url);
    toast({
      title: "Invite link copied",
      description: `Send to ${email}. They open the link, create a password (or sign in), then join your team.`,
    });
  }

  function startEditStaff(staff: PosStaffRow) {
    setEditingStaffId(staff.id);
    setEditStaffName(staff.display_name);
    setEditStaffRole(staff.role as "cashier" | "manager");
    setResetPinStaffId(null);
  }

  async function saveStaffEdit(staffId: string) {
    if (editStaffName.trim().length < 2) {
      toast({ title: "Name must be at least 2 characters", variant: "destructive" });
      return;
    }
    setEditStaffLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("pos_staff")
      .update({ display_name: editStaffName.trim(), role: editStaffRole })
      .eq("id", staffId)
      .eq("organization_id", organizationId);
    setEditStaffLoading(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Staff updated" });
    setEditingStaffId(null);
    router.refresh();
  }

  async function toggleStaffActive(staffId: string, active: boolean) {
    const supabase = createClient();
    const { error } = await supabase.rpc("set_pos_staff_active", {
      p_staff_id: staffId,
      p_active: active,
    });
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: active ? "Staff activated" : "Staff deactivated" });
    router.refresh();
  }

  async function deletePosStaff(staffId: string, displayName: string) {
    const supabase = createClient();
    const { error } = await supabase.from("pos_staff").delete().eq("id", staffId).eq("organization_id", organizationId);
    if (error) {
      toast({ title: "Could not delete staff", description: deleteBlockedMessage(error), variant: "destructive" });
      return;
    }
    toast({ title: "Staff removed", description: displayName });
    if (editingStaffId === staffId) setEditingStaffId(null);
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Team & access"
        description="Assign department roles (HR, Finance, Inventory…) and control which apps each ERP user can open."
      />

      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "access"} onClick={() => setTab("access")}>
          App access
        </TabButton>
        <TabButton active={tab === "invites"} onClick={() => setTab("invites")}>
          Invites & ERP users
        </TabButton>
        <TabButton active={tab === "pos"} onClick={() => setTab("pos")}>
          POS staff (PIN)
        </TabButton>
      </div>

      {tab === "access" && (
        <div className="space-y-4">
          {!permissionsReady && (
            <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium">Department roles not set up yet</p>
                <p className="text-sm text-muted-foreground">
                  Apply migration <code className="text-xs">20260618000016_department_roles.sql</code> in Supabase,
                  or click below to initialize roles for this organization.
                </p>
                <Button size="sm" disabled={initRolesLoading} onClick={handleInitRoles}>
                  {initRolesLoading ? "Initializing…" : "Initialize department roles"}
                </Button>
              </div>
            </div>
          )}

          <FormCard title="How it works">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Invite a user on the <strong className="text-foreground">Invites & ERP users</strong> tab (Manager or Cashier).</li>
              <li>After they join, return here and click <strong className="text-foreground">App access</strong> on their row.</li>
              <li>Pick department roles (HR Manager, Finance Manager, etc.) and optionally override individual apps.</li>
            </ol>
            {ownerOnly && (
              <p className="mt-3 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                You are the only ERP user (owner). Owners always have full access — invite another user to assign
                department permissions.
              </p>
            )}
          </FormCard>

          <FormCard title="Department roles">
            {departmentRoles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No roles loaded. Initialize department roles above.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {departmentRoles.map((r) => (
                  <div key={r.id} className="rounded-lg border px-3 py-2 text-sm">
                    <p className="font-medium">{r.name}</p>
                    {r.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </FormCard>

          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <h3 className="mb-1 font-semibold">Manage user app access</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Click <strong>App access</strong> next to a manager or cashier to assign roles and page visibility.
            </p>
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.id} className="rounded-lg border px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-muted-foreground">{m.user_id.slice(0, 8)}…</span>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant="default" className="capitalize">{m.role}</Badge>
                        {!m.is_active && <Badge variant="destructive">Inactive</Badge>}
                        {(roleIdsByMember[m.id]?.length ?? 0) > 0 && (
                          <Badge variant="secondary">
                            {roleIdsByMember[m.id]?.length} dept role
                            {(roleIdsByMember[m.id]?.length ?? 0) === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {m.role === "owner" ? (
                      <Badge variant="outline">Full access (owner)</Badge>
                    ) : (
                      <Button
                        type="button"
                        variant={editingAccessMemberId === m.id ? "default" : "outline"}
                        size="sm"
                        className="gap-1.5"
                        disabled={!permissionsReady}
                        onClick={() =>
                          setEditingAccessMemberId(editingAccessMemberId === m.id ? null : m.id)
                        }
                      >
                        <Shield className="h-3.5 w-3.5" />
                        App access
                      </Button>
                    )}
                  </div>
                  {editingAccessMemberId === m.id && m.role !== "owner" && (
                    <MemberAccessEditor
                      memberId={m.id}
                      memberRole={m.role}
                      memberLabel={m.user_id.slice(0, 8)}
                      departmentRoles={departmentRoles}
                      assignedRoleIds={roleIdsByMember[m.id] ?? []}
                      overrides={overridesByMember[m.id] ?? []}
                      onClose={() => setEditingAccessMemberId(null)}
                      onSaved={() => {
                        setEditingAccessMemberId(null);
                        router.refresh();
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === "invites" && (
        <div className="space-y-4">
          <FormCard title="Invite ERP user (email login)">
            <p className="mb-4 text-sm text-muted-foreground">
              After they accept the invite, open <strong>App access</strong> to assign HR, Finance, Inventory, or other
              department roles.
            </p>
            <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="min-w-[240px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Base role</Label>
                <select
                  className={SELECT_CLS + " min-w-[140px]"}
                  value={role}
                  onChange={(e) => setRole(e.target.value as "cashier" | "manager")}
                >
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "Sending…" : "Send invite"}
              </Button>
            </form>
          </FormCard>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-5 shadow-sm md:col-span-2">
              <h3 className="mb-1 font-semibold">Pending invites</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Copy the link and send it to the invitee. New users open the link → create a password → join your team.
              </p>
              <ul className="space-y-2">
                {invites.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{i.email}</span>
                      <Badge variant="secondary" className="ml-2 capitalize">{i.role}</Badge>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={() => copyInviteLink(i.id, i.email)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy invite link
                    </Button>
                  </li>
                ))}
                {invites.length === 0 && (
                  <p className="text-sm text-muted-foreground">No pending invites</p>
                )}
              </ul>
            </div>
            <div className="rounded-xl border bg-card p-5 shadow-sm md:col-span-2">
              <h3 className="mb-4 font-semibold">All ERP accounts ({members.length})</h3>
              <ul className="space-y-2">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <span className="font-mono text-muted-foreground">{m.user_id.slice(0, 8)}…</span>
                    <Badge variant="default" className="capitalize">{m.role}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {tab === "pos" && (
        <div className="space-y-4">
          <FormCard title="Add POS staff (register login)">
            <p className="mb-4 text-sm text-muted-foreground">
              Cashiers sign in on the register with a PIN — no email login. This is separate from ERP app access above.
            </p>
            <form onSubmit={handleAddPosStaff} className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>Display name</Label>
                <Input
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  placeholder="e.g. Sara"
                  required
                  minLength={2}
                  className="min-w-[180px]"
                />
              </div>
              <div className="space-y-2">
                <Label>PIN (4–6 digits)</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  value={staffPin}
                  onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••"
                  required
                  minLength={4}
                  maxLength={6}
                  className="min-w-[120px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Register role</Label>
                <select
                  className={SELECT_CLS + " min-w-[140px]"}
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value as "cashier" | "manager")}
                >
                  <option value="cashier">Cashier</option>
                  <option value="manager">Floor manager</option>
                </select>
              </div>
              <Button type="submit" disabled={staffLoading}>
                {staffLoading ? "Adding…" : "Add staff"}
              </Button>
            </form>
          </FormCard>

          {registers.length > 0 && (
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="mb-2 font-semibold">Cashier register links</h3>
              <ul className="space-y-2">
                {registers.map((reg) => {
                  const path = `/pos/${reg.id}`;
                  return (
                    <li
                      key={reg.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <div>
                        <span className="font-medium">{reg.name}</span>
                        <span className="ml-2 text-muted-foreground">{relationName(reg.stores)}</span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => copyRegisterUrl(path)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy link
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <h3 className="mb-4 font-semibold">POS staff ({posStaff.length})</h3>
            <ul className="space-y-2">
              {posStaff.map((s) => (
                <li key={s.id} className="rounded-lg border px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{s.display_name}</span>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="secondary" className="capitalize">{s.role}</Badge>
                        {!s.is_active && <Badge variant="destructive">Inactive</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => startEditStaff(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setResetPinStaffId(s.id);
                          setNewPin("");
                          setEditingStaffId(null);
                        }}
                      >
                        Reset PIN
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => toggleStaffActive(s.id, !s.is_active)}
                      >
                        {s.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      <ConfirmDeleteButton
                        label="Remove"
                        message="Permanently remove this cashier? Deactivate if they have sale history."
                        onConfirm={() => deletePosStaff(s.id, s.display_name)}
                      />
                    </div>
                  </div>
                  {editingStaffId === s.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Display name</Label>
                        <Input
                          value={editStaffName}
                          onChange={(e) => setEditStaffName(e.target.value)}
                          className="h-9 min-w-[160px]"
                          required
                          minLength={2}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Role</Label>
                        <select
                          className={SELECT_CLS + " h-9 min-w-[140px]"}
                          value={editStaffRole}
                          onChange={(e) => setEditStaffRole(e.target.value as "cashier" | "manager")}
                        >
                          <option value="cashier">Cashier</option>
                          <option value="manager">Floor manager</option>
                        </select>
                      </div>
                      <Button size="sm" disabled={editStaffLoading} onClick={() => saveStaffEdit(s.id)}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingStaffId(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                  {resetPinStaffId === s.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                      <div className="space-y-1">
                        <Label className="text-xs">New PIN</Label>
                        <Input
                          type="password"
                          inputMode="numeric"
                          value={newPin}
                          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          className="h-9 w-28"
                          placeholder="••••"
                        />
                      </div>
                      <Button size="sm" onClick={() => handleResetPin(s.id)}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setResetPinStaffId(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </li>
              ))}
              {posStaff.length === 0 && (
                <p className="text-sm text-muted-foreground">No POS staff yet.</p>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

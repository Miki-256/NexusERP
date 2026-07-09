"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Pencil, Shield } from "lucide-react";
import { formatMemberRoleLabel, memberToRoleValue, buildTeamRoleOptions } from "./team-role-options";
import { TeamRoleSelect, teamRoleSelectionFromValue } from "./team-role-select";
import {
  MemberAccessEditor,
  type DepartmentRoleRow,
} from "./member-access-editor";

export type TeamMemberRow = {
  id: string;
  role: string;
  is_active: boolean;
  user_id: string;
  email: string | null;
  display_name: string;
  created_at?: string;
};

type ErpMemberRowProps = {
  member: TeamMemberRow;
  departmentRoles: DepartmentRoleRow[];
  assignedRoleIds: string[];
  overrides: { app_id: string; access: "grant" | "deny" }[];
  permissionsReady: boolean;
  defaultExpanded?: boolean;
  onAccessSaved?: () => void;
};

export function ErpMemberRow({
  member,
  departmentRoles,
  assignedRoleIds,
  overrides,
  permissionsReady,
  defaultExpanded = false,
  onAccessSaved,
}: ErpMemberRowProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState(defaultExpanded);
  const [editRoleValue, setEditRoleValue] = useState(() =>
    memberToRoleValue(
      member.role,
      assignedRoleIds,
      buildTeamRoleOptions(departmentRoles)
    )
  );
  const [saving, setSaving] = useState(false);
  const [editingAccess, setEditingAccess] = useState(false);

  const memberLabel = member.email ?? member.display_name;
  const roleLabel = formatMemberRoleLabel(member.role, assignedRoleIds, departmentRoles);
  const isOwner = member.role === "owner";

  async function saveMemberChanges() {
    if (isOwner) return;
    const selection = teamRoleSelectionFromValue(editRoleValue, departmentRoles);
    setSaving(true);
    const supabase = createClient();
    const { error: roleError } = await supabase.rpc("update_organization_member", {
      p_member_id: member.id,
      p_role: selection.baseRole,
    });
    if (roleError) {
      setSaving(false);
      toast({ title: "Update failed", description: roleError.message, variant: "destructive" });
      return;
    }
    const { error: permError } = await supabase.rpc("save_member_permissions", {
      p_member_id: member.id,
      p_department_role_ids: selection.departmentRoleIds,
      p_overrides: overrides,
    });
    setSaving(false);
    if (permError) {
      toast({ title: "Update failed", description: permError.message, variant: "destructive" });
      return;
    }
    toast({ title: "Member updated", description: memberLabel });
    setEditing(false);
    router.refresh();
    onAccessSaved?.();
  }

  async function toggleActive(active: boolean) {
    if (isOwner) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("update_organization_member", {
      p_member_id: member.id,
      p_is_active: active,
    });
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: active ? "Member activated" : "Member deactivated" });
    router.refresh();
    onAccessSaved?.();
  }

  return (
    <li className="rounded-lg border px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{member.display_name}</p>
          {member.email && (
            <p className="text-xs text-muted-foreground truncate">{member.email}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="default">{roleLabel}</Badge>
            {!member.is_active && <Badge variant="destructive">Inactive</Badge>}
          </div>
        </div>
        {isOwner ? (
          <Badge variant="outline">Full access (owner)</Badge>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (!editing) {
                  setEditRoleValue(
                    memberToRoleValue(
                      member.role,
                      assignedRoleIds,
                      buildTeamRoleOptions(departmentRoles)
                    )
                  );
                }
                setEditing((v) => !v);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              type="button"
              variant={editingAccess ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              disabled={!permissionsReady}
              onClick={() => setEditingAccess((v) => !v)}
            >
              <Shield className="h-3.5 w-3.5" />
              App access
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => toggleActive(!member.is_active)}
            >
              {member.is_active ? "Deactivate" : "Activate"}
            </Button>
          </div>
        )}
      </div>

      {editing && !isOwner && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
          <TeamRoleSelect
            label="Role"
            departmentRoles={departmentRoles}
            value={editRoleValue}
            onChange={setEditRoleValue}
            disabled={!permissionsReady}
            className="min-w-[220px]"
          />
          <Button size="sm" disabled={saving || !permissionsReady} onClick={saveMemberChanges}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      )}

      {editingAccess && !isOwner && (
        <MemberAccessEditor
          memberId={member.id}
          memberRole={member.role}
          memberLabel={memberLabel}
          departmentRoles={departmentRoles}
          assignedRoleIds={assignedRoleIds}
          overrides={overrides}
          onClose={() => setEditingAccess(false)}
          onSaved={() => {
            setEditingAccess(false);
            router.refresh();
            onAccessSaved?.();
          }}
        />
      )}
    </li>
  );
}

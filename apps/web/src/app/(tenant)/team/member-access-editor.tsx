"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  ALL_ERP_APP_IDS,
  type AppOverride,
  type ErpAppId,
  resolvePreviewApps,
} from "@/lib/app-permissions";
import { ERP_APPS } from "@/lib/apps-registry";
import { APP_CATEGORIES } from "@/lib/apps-registry";
import { SELECT_CLS } from "@/lib/ui-classes";
import { DepartmentRolePicker } from "./department-role-picker";

export type DepartmentRoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  app_ids: string[];
};

type MemberAccessEditorProps = {
  memberId: string;
  memberRole: string;
  memberLabel: string;
  departmentRoles: DepartmentRoleRow[];
  assignedRoleIds: string[];
  overrides: { app_id: string; access: "grant" | "deny" }[];
  onClose: () => void;
  onSaved: () => void;
};

const APP_LABELS = Object.fromEntries(ERP_APPS.map((a) => [a.id, a.name])) as Record<string, string>;

function defaultOverrideState(
  appId: ErpAppId,
  overrides: { app_id: string; access: "grant" | "deny" }[]
): AppOverride {
  const row = overrides.find((o) => o.app_id === appId);
  if (!row) return "default";
  return row.access;
}

export function MemberAccessEditor({
  memberId,
  memberRole,
  memberLabel,
  departmentRoles,
  assignedRoleIds: initialRoleIds,
  overrides: initialOverrides,
  onClose,
  onSaved,
}: MemberAccessEditorProps) {
  const { toast } = useToast();
  const [roleIds, setRoleIds] = useState<string[]>(initialRoleIds);
  const [overrides, setOverrides] = useState<Record<string, AppOverride>>(() => {
    const map: Record<string, AppOverride> = {};
    for (const id of ALL_ERP_APP_IDS) {
      if (id === "dashboard") continue;
      map[id] = defaultOverrideState(id, initialOverrides);
    }
    return map;
  });
  const [saving, setSaving] = useState(false);

  const usesCustom = roleIds.length > 0 || Object.values(overrides).some((v) => v !== "default");

  const previewApps = useMemo(() => {
    const roleAppIds = departmentRoles
      .filter((r) => roleIds.includes(r.id))
      .map((r) => r.app_ids);
    const overrideRows = Object.entries(overrides)
      .filter(([, v]) => v !== "default")
      .map(([app_id, access]) => ({ app_id, access: access as "grant" | "deny" }));
    return resolvePreviewApps(
      memberRole as "owner" | "manager" | "cashier",
      roleAppIds,
      overrideRows,
      usesCustom
    );
  }, [departmentRoles, roleIds, overrides, memberRole, usesCustom]);

  function setOverride(appId: string, value: AppOverride) {
    setOverrides((prev) => ({ ...prev, [appId]: value }));
  }

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();
    const payload = Object.entries(overrides)
      .filter(([, v]) => v !== "default")
      .map(([app_id, access]) => ({ app_id, access }));

    const { error } = await supabase.rpc("save_member_permissions", {
      p_member_id: memberId,
      p_department_role_ids: roleIds,
      p_overrides: payload,
    });
    setSaving(false);

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Access updated", description: memberLabel });
    onSaved();
  }

  return (
    <div className="mt-3 space-y-4 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Department roles</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Base ERP role: <span className="capitalize">{memberRole}</span>. Assign department roles, then fine-tune apps below.
        </p>
        <DepartmentRolePicker
          departmentRoles={departmentRoles}
          selectedIds={roleIds}
          onChange={setRoleIds}
        />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">App access overrides</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Default follows department roles. Force allow adds an app; force deny removes it.
        </p>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
          {APP_CATEGORIES.map((cat) => {
            const apps = ERP_APPS.filter(
              (a) => a.category === cat.key && a.live && a.id !== "dashboard"
            );
            if (apps.length === 0) return null;
            return (
              <div key={cat.key}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {cat.label}
                </p>
                <ul className="space-y-1">
                  {apps.map((app) => (
                    <li key={app.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{app.name}</span>
                      <select
                        className={SELECT_CLS + " h-8 min-w-[120px] text-xs"}
                        value={overrides[app.id] ?? "default"}
                        onChange={(e) => setOverride(app.id, e.target.value as AppOverride)}
                      >
                        <option value="default">Default</option>
                        <option value="grant">Allow</option>
                        <option value="deny">Deny</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Preview ({previewApps.size} apps)</p>
        <div className="flex flex-wrap gap-1.5">
          {Array.from(previewApps)
            .filter((id) => id !== "dashboard")
            .map((id) => (
              <Badge key={id} variant="secondary" className="text-xs">
                {APP_LABELS[id] ?? id}
              </Badge>
            ))}
          {previewApps.size <= 1 && (
            <span className="text-xs text-muted-foreground">Dashboard only — assign a department role or allow apps.</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save access"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

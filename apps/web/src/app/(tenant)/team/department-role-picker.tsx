"use client";

import type { DepartmentRoleRow } from "./member-access-editor";

export function DepartmentRolePicker({
  departmentRoles,
  selectedIds,
  onChange,
  disabled,
}: {
  departmentRoles: DepartmentRoleRow[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  function toggle(id: string) {
    if (disabled) return;
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((r) => r !== id)
        : [...selectedIds, id]
    );
  }

  if (departmentRoles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Department roles are not set up yet. Initialize them on the App access tab.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {departmentRoles.map((role) => {
        const active = selectedIds.includes(role.id);
        return (
          <button
            key={role.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(role.id)}
            className={
              "rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 " +
              (active ? "border-primary bg-primary/10" : "hover:bg-muted/50")
            }
          >
            <span className="font-medium">{role.name}</span>
            {role.description && (
              <span className="mt-0.5 block text-xs text-muted-foreground">{role.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function departmentRoleLabels(
  roleIds: string[],
  departmentRoles: DepartmentRoleRow[]
): string[] {
  return departmentRoles.filter((r) => roleIds.includes(r.id)).map((r) => r.name);
}

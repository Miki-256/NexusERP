"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { SELECT_CLS } from "@/lib/ui-classes";
import type { DepartmentRoleRow } from "./member-access-editor";
import {
  buildTeamRoleOptions,
  resolveTeamRoleOption,
  type TeamRoleOption,
} from "./team-role-options";

export function TeamRoleSelect({
  departmentRoles,
  value,
  onChange,
  disabled,
  label = "Role",
  className,
}: {
  departmentRoles: DepartmentRoleRow[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const options = useMemo(() => buildTeamRoleOptions(departmentRoles), [departmentRoles]);
  const selected = resolveTeamRoleOption(value, options);

  return (
    <div className={className}>
      <Label>{label}</Label>
      <select
        className={SELECT_CLS + " mt-2 min-w-[200px]"}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <optgroup label="General">
          {options
            .filter((o) => o.value === "cashier" || o.value === "manager")
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </optgroup>
        {departmentRoles.length > 0 && (
          <optgroup label="Departments">
            {options
              .filter((o) => o.value.startsWith("dept:"))
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        )}
      </select>
      {selected?.description && (
        <p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>
      )}
    </div>
  );
}

export function teamRoleSelectionFromValue(
  value: string,
  departmentRoles: DepartmentRoleRow[]
): Pick<TeamRoleOption, "baseRole" | "departmentRoleIds"> {
  const options = buildTeamRoleOptions(departmentRoles);
  const option = resolveTeamRoleOption(value, options);
  return option ?? { baseRole: "cashier", departmentRoleIds: [] };
}

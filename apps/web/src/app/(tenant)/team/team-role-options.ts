import type { DepartmentRoleRow } from "./member-access-editor";
import { departmentRoleLabels } from "./department-role-picker";

export type TeamRoleOption = {
  value: string;
  label: string;
  description?: string | null;
  baseRole: "cashier" | "manager";
  departmentRoleIds: string[];
};

export function buildTeamRoleOptions(departmentRoles: DepartmentRoleRow[]): TeamRoleOption[] {
  const options: TeamRoleOption[] = [
    {
      value: "cashier",
      label: "Cashier",
      description: "Default POS and front-office apps",
      baseRole: "cashier",
      departmentRoleIds: [],
    },
    {
      value: "manager",
      label: "Manager",
      description: "Full access to all apps",
      baseRole: "manager",
      departmentRoleIds: [],
    },
  ];

  for (const role of departmentRoles) {
    options.push({
      value: `dept:${role.id}`,
      label: role.name,
      description: role.description,
      baseRole: role.code === "full_admin" ? "manager" : "cashier",
      departmentRoleIds: [role.id],
    });
  }

  return options;
}

export function resolveTeamRoleOption(
  value: string,
  options: TeamRoleOption[]
): TeamRoleOption | undefined {
  return options.find((o) => o.value === value);
}

export function memberToRoleValue(
  baseRole: string,
  assignedRoleIds: string[],
  options: TeamRoleOption[]
): string {
  if (assignedRoleIds.length === 1) {
    const deptValue = `dept:${assignedRoleIds[0]}`;
    if (options.some((o) => o.value === deptValue)) return deptValue;
  }
  if (assignedRoleIds.length === 0 && (baseRole === "cashier" || baseRole === "manager")) {
    return baseRole;
  }
  if (assignedRoleIds.length > 0) {
    const first = `dept:${assignedRoleIds[0]}`;
    if (options.some((o) => o.value === first)) return first;
  }
  return baseRole === "manager" ? "manager" : "cashier";
}

export function formatMemberRoleLabel(
  baseRole: string,
  assignedRoleIds: string[],
  departmentRoles: DepartmentRoleRow[]
): string {
  if (baseRole === "owner") return "Owner";
  const names = departmentRoleLabels(assignedRoleIds, departmentRoles);
  if (names.length > 0) return names.join(", ");
  return baseRole.charAt(0).toUpperCase() + baseRole.slice(1);
}

export function inviteToRoleLabel(
  baseRole: string,
  departmentRoleIds: string[] | null | undefined,
  departmentRoles: DepartmentRoleRow[]
): string {
  return formatMemberRoleLabel(baseRole, departmentRoleIds ?? [], departmentRoles);
}

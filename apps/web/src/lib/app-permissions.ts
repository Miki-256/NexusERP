/** Canonical ERP app ids — must stay in sync with supabase migration all_erp_app_ids(). */
export const ALL_ERP_APP_IDS = [
  "dashboard",
  "pos",
  "sales",
  "invoicing",
  "crm",
  "customers",
  "refunds",
  "credits",
  "receivables",
  "products",
  "inventory",
  "purchasing",
  "manufacturing",
  "promotions",
  "accounting",
  "expenses",
  "reports",
  "documents",
  "hr",
  "recruitment",
  "timeoff",
  "projects",
  "helpdesk",
  "stores",
  "team",
  "settings",
  "communications",
] as const;

export type ErpAppId = (typeof ALL_ERP_APP_IDS)[number];

export const CASHIER_DEFAULT_APP_IDS: ErpAppId[] = [
  "dashboard",
  "pos",
  "sales",
  "customers",
  "products",
  "inventory",
  "credits",
  "receivables",
  "crm",
  "timeoff",
  "helpdesk",
  "projects",
];

/** First path segment (after /) → app id. */
export const ROUTE_TO_APP_ID: Record<string, ErpAppId> = {
  dashboard: "dashboard",
  pos: "pos",
  sales: "sales",
  invoicing: "invoicing",
  crm: "crm",
  customers: "customers",
  refunds: "refunds",
  credits: "credits",
  receivables: "receivables",
  products: "products",
  inventory: "inventory",
  fulfillment: "inventory",
  purchasing: "purchasing",
  manufacturing: "manufacturing",
  promotions: "promotions",
  financials: "accounting",
  expenses: "expenses",
  reports: "reports",
  documents: "documents",
  hr: "hr",
  recruitment: "recruitment",
  "time-off": "timeoff",
  projects: "projects",
  helpdesk: "helpdesk",
  communications: "communications",
  stores: "stores",
  team: "team",
  settings: "settings",
  invite: "dashboard",
};

export type AppOverride = "default" | "grant" | "deny";

export type MemberPermissionsPayload = {
  member_id: string | null;
  organization_id?: string;
  role: string | null;
  accessible_apps: string[];
  manage_apps: string[];
  uses_custom_permissions: boolean;
};

export function appIdForPath(pathname: string): ErpAppId | null {
  const segment = pathname.split("/").filter(Boolean)[0];
  if (!segment) return "dashboard";
  return ROUTE_TO_APP_ID[segment] ?? null;
}

export function toAppSet(ids: string[]): Set<ErpAppId> {
  return new Set(ids.filter((id): id is ErpAppId => ALL_ERP_APP_IDS.includes(id as ErpAppId)));
}

export function resolvePreviewApps(
  baseRole: "owner" | "manager" | "cashier",
  departmentRoleAppIds: string[][],
  overrides: { app_id: string; access: "grant" | "deny" }[],
  usesCustom: boolean
): Set<ErpAppId> {
  if (baseRole === "owner") return new Set(ALL_ERP_APP_IDS);

  if (!usesCustom) {
    if (baseRole === "manager") return new Set(ALL_ERP_APP_IDS);
    return new Set(CASHIER_DEFAULT_APP_IDS);
  }

  const apps = new Set<ErpAppId>();
  for (const roleApps of departmentRoleAppIds) {
    for (const id of roleApps) {
      if (ALL_ERP_APP_IDS.includes(id as ErpAppId)) apps.add(id as ErpAppId);
    }
  }
  for (const o of overrides) {
    if (o.access === "grant" && ALL_ERP_APP_IDS.includes(o.app_id as ErpAppId)) {
      apps.add(o.app_id as ErpAppId);
    }
  }
  for (const o of overrides) {
    if (o.access === "deny") apps.delete(o.app_id as ErpAppId);
  }
  apps.add("dashboard");
  return apps;
}

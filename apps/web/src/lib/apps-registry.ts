import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  Contact,
  Target,
  FileText,
  RotateCcw,
  Wallet,
  Package,
  PackageSearch,
  Warehouse,
  Truck,
  Factory,
  Landmark,
  BarChart3,
  BadgeDollarSign,
  Users,
  Briefcase,
  CalendarOff,
  FolderKanban,
  LifeBuoy,
  FileStack,
  Store,
  Settings,
  ShieldCheck,
  Clock,
  Tag,
  Radio,
} from "lucide-react";

export type AppDef = {
  id: string;
  name: string;
  description: string;
  href: string;
  icon: LucideIcon;
  color: string;
  category: "sales" | "finance" | "inventory" | "hr" | "services" | "settings";
  live: boolean;
  managerOnly?: boolean;
};

/** Odoo-style app registry — single source for launcher + navigation. */
export const ERP_APPS: AppDef[] = [
  // Sales
  { id: "dashboard", name: "Apps", description: "All applications", href: "/dashboard", icon: LayoutDashboard, color: "bg-slate-600", category: "sales", live: true },
  { id: "pos", name: "Point of Sale", description: "Checkout & registers", href: "/pos", icon: ShoppingCart, color: "bg-emerald-600", category: "sales", live: true },
  { id: "sales", name: "Sales", description: "Orders & receipts", href: "/sales", icon: Receipt, color: "bg-blue-600", category: "sales", live: true },
  { id: "invoicing", name: "Invoicing", description: "Customer invoices", href: "/invoicing", icon: FileText, color: "bg-sky-600", category: "sales", live: true },
  { id: "crm", name: "CRM", description: "Pipeline & opportunities", href: "/crm", icon: Target, color: "bg-violet-600", category: "sales", live: true },
  { id: "customers", name: "Contacts", description: "Customers & spend", href: "/customers", icon: Contact, color: "bg-indigo-600", category: "sales", live: true },
  { id: "refunds", name: "Refunds", description: "Returns & voids", href: "/refunds", icon: RotateCcw, color: "bg-orange-600", category: "sales", live: true, managerOnly: true },
  { id: "credits", name: "Credits", description: "Store credit balances", href: "/credits", icon: Wallet, color: "bg-amber-600", category: "sales", live: true },
  { id: "receivables", name: "Receivables", description: "Pay-later balances", href: "/receivables", icon: Clock, color: "bg-orange-700", category: "sales", live: true },
  // Inventory
  { id: "products", name: "Products", description: "Catalog & variants", href: "/products", icon: Package, color: "bg-cyan-600", category: "inventory", live: true },
  { id: "inventory", name: "Inventory", description: "Stock by store", href: "/inventory", icon: Warehouse, color: "bg-teal-600", category: "inventory", live: true },
  { id: "fulfillment", name: "Fulfillment", description: "Pick, pack & ship", href: "/fulfillment", icon: PackageSearch, color: "bg-teal-700", category: "inventory", live: true },
  { id: "purchasing", name: "Purchase", description: "POs & vendor bills", href: "/purchasing", icon: Truck, color: "bg-lime-700", category: "inventory", live: true },
  { id: "manufacturing", name: "Manufacturing", description: "BOM & production", href: "/manufacturing", icon: Factory, color: "bg-stone-600", category: "inventory", live: true, managerOnly: true },
  { id: "promotions", name: "Promotions", description: "Discounts & codes", href: "/promotions", icon: Tag, color: "bg-yellow-600", category: "inventory", live: true, managerOnly: true },
  // Finance
  { id: "accounting", name: "Accounting", description: "Ledger & statements", href: "/financials", icon: Landmark, color: "bg-blue-800", category: "finance", live: true },
  { id: "expenses", name: "Expenses", description: "Operating costs", href: "/expenses", icon: Wallet, color: "bg-rose-600", category: "finance", live: true },
  { id: "reports", name: "Reporting", description: "Shifts & audit", href: "/reports", icon: BarChart3, color: "bg-purple-600", category: "finance", live: true },
  { id: "communications", name: "Communications", description: "Alerts & messaging", href: "/communications", icon: Radio, color: "bg-indigo-700", category: "finance", live: true, managerOnly: true },
  { id: "documents", name: "Documents", description: "Files & links", href: "/documents", icon: FileStack, color: "bg-gray-600", category: "finance", live: true },
  // HR
  { id: "hr", name: "Employees", description: "HR & payroll", href: "/hr", icon: BadgeDollarSign, color: "bg-pink-600", category: "hr", live: true, managerOnly: true },
  { id: "recruitment", name: "Recruitment", description: "Jobs & applicants", href: "/recruitment", icon: Briefcase, color: "bg-fuchsia-600", category: "hr", live: true, managerOnly: true },
  { id: "timeoff", name: "Time Off", description: "Leave, attendance & shifts", href: "/time-off", icon: CalendarOff, color: "bg-red-600", category: "hr", live: true },
  // Services
  { id: "projects", name: "Project", description: "Tasks & delivery", href: "/projects", icon: FolderKanban, color: "bg-green-700", category: "services", live: true },
  { id: "helpdesk", name: "Helpdesk", description: "Support tickets", href: "/helpdesk", icon: LifeBuoy, color: "bg-cyan-700", category: "services", live: true },
  // Settings
  { id: "stores", name: "Stores", description: "Locations & registers", href: "/stores", icon: Store, color: "bg-neutral-600", category: "settings", live: true },
  { id: "team", name: "Team & access", description: "Roles, invites & app permissions", href: "/team", icon: Users, color: "bg-slate-700", category: "settings", live: true, managerOnly: true },
  { id: "settings", name: "Settings", description: "Organization", href: "/settings", icon: Settings, color: "bg-zinc-600", category: "settings", live: true, managerOnly: true },
];

export const APP_CATEGORIES: { key: AppDef["category"]; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "inventory", label: "Inventory" },
  { key: "finance", label: "Finance" },
  { key: "hr", label: "Human Resources" },
  { key: "services", label: "Services" },
  { key: "settings", label: "Settings" },
];

export function visibleApps(accessibleAppIds: Iterable<string>): AppDef[] {
  const allowed = new Set(accessibleAppIds);
  return ERP_APPS.filter((a) => a.id !== "dashboard" && a.live && allowed.has(a.id));
}

/** Serializable nav item — passed from server layout to avoid SSR/client nav drift. */
export type SerializedNavApp = {
  id: string;
  name: string;
  href: string;
  category: AppDef["category"];
};

export function serializeNavApps(accessibleAppIds: Iterable<string>): SerializedNavApp[] {
  return visibleApps(accessibleAppIds).map(({ id, name, href, category }) => ({
    id,
    name,
    href,
    category,
  }));
}

const APP_ICON_BY_ID = Object.fromEntries(ERP_APPS.map((app) => [app.id, app.icon])) as Record<
  string,
  LucideIcon
>;

export function appIconById(id: string): LucideIcon {
  return APP_ICON_BY_ID[id] ?? LayoutDashboard;
}

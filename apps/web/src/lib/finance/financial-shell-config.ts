/** Fiori-style financial shell — areas, tab mapping, navigation helpers. */

export type FinancialShellAreaId =
  | "home"
  | "reporting"
  | "ledger"
  | "working_capital"
  | "compliance"
  | "planning"
  | "platform";

export type FinancialShellTab =
  | "home"
  | "overview"
  | "executive"
  | "pnl"
  | "balance"
  | "cashflow"
  | "trial"
  | "ledger"
  | "coa"
  | "journal"
  | "aging"
  | "periods"
  | "banking"
  | "treasury"
  | "tax"
  | "budget"
  | "fpa"
  | "jobcost"
  | "analytics"
  | "assets"
  | "consolidation"
  | "automation"
  | "security"
  | "performance"
  | "assistant"
  | "reports"
  | "fx";

export const FINANCIAL_SHELL_AREAS: { id: FinancialShellAreaId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "reporting", label: "Reporting" },
  { id: "ledger", label: "Ledger" },
  { id: "working_capital", label: "Working Capital" },
  { id: "compliance", label: "Compliance" },
  { id: "planning", label: "Planning" },
  { id: "platform", label: "Platform" },
];

export const TAB_TO_AREA: Record<FinancialShellTab, FinancialShellAreaId> = {
  home: "home",
  overview: "reporting",
  executive: "reporting",
  pnl: "reporting",
  balance: "reporting",
  cashflow: "reporting",
  trial: "reporting",
  reports: "reporting",
  analytics: "reporting",
  ledger: "ledger",
  coa: "ledger",
  journal: "ledger",
  periods: "ledger",
  aging: "working_capital",
  banking: "working_capital",
  treasury: "working_capital",
  fx: "working_capital",
  tax: "compliance",
  security: "compliance",
  budget: "planning",
  fpa: "planning",
  jobcost: "planning",
  assets: "planning",
  consolidation: "planning",
  automation: "platform",
  performance: "platform",
  assistant: "platform",
};

export const AREA_TABS: Record<FinancialShellAreaId, FinancialShellTab[]> = {
  home: ["home"],
  reporting: ["overview", "executive", "pnl", "balance", "cashflow", "trial", "reports", "analytics"],
  ledger: ["ledger", "coa", "journal", "periods"],
  working_capital: ["aging", "banking", "treasury", "fx"],
  compliance: ["tax", "security"],
  planning: ["budget", "fpa", "jobcost", "assets", "consolidation"],
  platform: ["automation", "performance", "assistant"],
};

export const TAB_LABELS: Record<FinancialShellTab, string> = {
  home: "Home",
  overview: "Overview",
  executive: "Executive",
  pnl: "P&L",
  balance: "Balance Sheet",
  cashflow: "Cash Flow",
  trial: "Trial Balance",
  ledger: "Ledger",
  coa: "COA",
  journal: "Manual JE",
  aging: "Aging",
  periods: "Periods",
  banking: "Banking",
  treasury: "Treasury",
  tax: "Tax",
  budget: "Budget",
  fpa: "FP&A",
  jobcost: "Job Cost",
  analytics: "Analytics",
  assets: "Assets",
  consolidation: "Consolidation",
  automation: "Automation",
  security: "Security",
  performance: "Performance",
  assistant: "Assistant",
  reports: "Reports",
  fx: "FX",
};

export function areaForTab(tab: FinancialShellTab): FinancialShellAreaId {
  return TAB_TO_AREA[tab] ?? "reporting";
}

export function isFinancialShellTab(value: string | undefined): value is FinancialShellTab {
  return Boolean(value && value in TAB_TO_AREA);
}

export type FinancialShellPreferences = {
  default_area: FinancialShellAreaId;
  density: "cozy" | "compact";
  pinned_tabs: string[];
  show_launchpad: boolean;
  updated_at?: string;
};

export type LaunchpadTile = {
  tab: FinancialShellTab;
  label: string;
  description: string;
  icon: string;
  accent: string;
};

export type LaunchpadArea = {
  id: FinancialShellAreaId;
  label: string;
  description: string;
  tiles: LaunchpadTile[];
};

export type LaunchpadCatalog = {
  areas: LaunchpadArea[];
};

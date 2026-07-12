import {
  areaForTab,
  isFinancialShellTab,
  type FinancialShellAreaId,
} from "@/lib/finance/financial-shell-config";

export type FinancialsLoadArea = FinancialShellAreaId;

export type FinancialsFetchScope = {
  core: boolean;
  reporting: boolean;
  ledger: boolean;
  workingCapital: boolean;
  compliance: boolean;
  planning: boolean;
  platform: boolean;
};

export function resolveFinancialsLoadArea(
  initialTab?: string,
  initialArea?: string
): FinancialsLoadArea {
  const areas: FinancialShellAreaId[] = [
    "home",
    "reporting",
    "ledger",
    "working_capital",
    "compliance",
    "planning",
    "platform",
  ];
  if (initialArea && areas.includes(initialArea as FinancialShellAreaId)) {
    return initialArea as FinancialShellAreaId;
  }
  if (initialTab && isFinancialShellTab(initialTab)) {
    return areaForTab(initialTab);
  }
  return "home";
}

/** Area-scoped fetch: core always; current area (+ reporting lite on home). */
export function getFinancialsFetchScope(area: FinancialsLoadArea): FinancialsFetchScope {
  return {
    core: true,
    reporting: area === "reporting" || area === "home",
    ledger: area === "ledger",
    workingCapital: area === "working_capital",
    compliance: area === "compliance",
    planning: area === "planning",
    platform: area === "platform",
  };
}

export function shouldRunFinancialAiInsights(
  area: FinancialsLoadArea,
  canPostLedger: boolean
): boolean {
  return canPostLedger && (area === "platform" || area === "home");
}

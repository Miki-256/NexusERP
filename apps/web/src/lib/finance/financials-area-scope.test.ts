import { describe, expect, it } from "vitest";
import {
  getFinancialsFetchScope,
  resolveFinancialsLoadArea,
  shouldRunFinancialAiInsights,
} from "@/lib/finance/financials-area-scope";

describe("resolveFinancialsLoadArea", () => {
  it("prefers explicit area param", () => {
    expect(resolveFinancialsLoadArea(undefined, "compliance")).toBe("compliance");
  });

  it("derives area from shell tab", () => {
    expect(resolveFinancialsLoadArea("treasury", undefined)).toBe("working_capital");
  });

  it("defaults to home", () => {
    expect(resolveFinancialsLoadArea(undefined, undefined)).toBe("home");
  });
});

describe("getFinancialsFetchScope", () => {
  it("loads reporting lite on home", () => {
    const scope = getFinancialsFetchScope("home");
    expect(scope.core).toBe(true);
    expect(scope.reporting).toBe(true);
    expect(scope.ledger).toBe(false);
    expect(scope.compliance).toBe(false);
  });

  it("scopes ledger-only fetches to ledger area", () => {
    const scope = getFinancialsFetchScope("ledger");
    expect(scope.ledger).toBe(true);
    expect(scope.reporting).toBe(false);
    expect(scope.planning).toBe(false);
  });

  it("scopes compliance fetches to compliance area", () => {
    const scope = getFinancialsFetchScope("compliance");
    expect(scope.compliance).toBe(true);
    expect(scope.workingCapital).toBe(false);
  });
});

describe("shouldRunFinancialAiInsights", () => {
  it("runs on home and platform when user can post", () => {
    expect(shouldRunFinancialAiInsights("home", true)).toBe(true);
    expect(shouldRunFinancialAiInsights("platform", true)).toBe(true);
  });

  it("skips when user cannot post ledger", () => {
    expect(shouldRunFinancialAiInsights("home", false)).toBe(false);
  });

  it("skips on non-platform areas", () => {
    expect(shouldRunFinancialAiInsights("ledger", true)).toBe(false);
  });
});

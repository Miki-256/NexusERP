import { describe, expect, it } from "vitest";
import {
  ALL_ERP_APP_IDS,
  CASHIER_DEFAULT_APP_IDS,
  ROUTE_TO_APP_ID,
  appIdForPath,
  resolvePreviewApps,
} from "./app-permissions";

describe("app-permissions", () => {
  it("maps financials route to accounting app", () => {
    expect(appIdForPath("/financials")).toBe("accounting");
    expect(ROUTE_TO_APP_ID.financials).toBe("accounting");
  });

  it("cashier defaults omit manager-only apps", () => {
    const cashier = new Set(CASHIER_DEFAULT_APP_IDS);
    for (const denied of ["accounting", "team", "settings", "invoicing", "purchasing", "stores"] as const) {
      expect(cashier.has(denied)).toBe(false);
    }
    for (const allowed of ["dashboard", "pos", "sales", "customers"] as const) {
      expect(cashier.has(allowed)).toBe(true);
    }
  });

  it("owner and manager preview get the full app catalog", () => {
    expect(resolvePreviewApps("owner", [], [], false).size).toBe(ALL_ERP_APP_IDS.length);
    expect(resolvePreviewApps("manager", [], [], false).size).toBe(ALL_ERP_APP_IDS.length);
  });

  it("cashier preview uses default app set when not custom", () => {
    const apps = resolvePreviewApps("cashier", [], [], false);
    expect([...apps].sort()).toEqual([...CASHIER_DEFAULT_APP_IDS].sort());
  });

  it("custom overrides can grant and deny apps", () => {
    const apps = resolvePreviewApps(
      "cashier",
      [CASHIER_DEFAULT_APP_IDS],
      [
        { app_id: "invoicing", access: "grant" },
        { app_id: "pos", access: "deny" },
      ],
      true
    );
    expect(apps.has("invoicing")).toBe(true);
    expect(apps.has("pos")).toBe(false);
    expect(apps.has("dashboard")).toBe(true);
  });
});

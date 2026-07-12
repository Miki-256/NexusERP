// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getTenantMainElement,
  replaceTenantUrlQuery,
  replaceTenantUrl,
  refreshPreservingTenantScroll,
} from "@/lib/tenant-scroll";

describe("tenant scroll helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = `<main style="height:200px;overflow:auto"><div style="height:2000px"></div></main>`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds the tenant main scroll container", () => {
    const main = getTenantMainElement();
    expect(main?.tagName).toBe("MAIN");
  });

  it("replaceTenantUrlQuery updates history without navigation", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    replaceTenantUrlQuery("/financials", new URLSearchParams("tab=pnl&area=reporting"));
    expect(replaceState).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/financials?tab=pnl&area=reporting"
    );
  });

  it("replaceTenantUrl preserves main scroll position", () => {
    const main = getTenantMainElement()!;
    main.scrollTop = 240;

    const router = {
      replace: vi.fn(),
    };

    replaceTenantUrl(router as never, "/financials", new URLSearchParams("tab=trial"));

    expect(router.replace).toHaveBeenCalledWith("/financials?tab=trial", { scroll: false });
  });

  it("refreshPreservingTenantScroll calls router.refresh", () => {
    const main = getTenantMainElement()!;
    main.scrollTop = 180;
    const router = { refresh: vi.fn() };

    refreshPreservingTenantScroll(router as never);
    expect(router.refresh).toHaveBeenCalled();
  });
});

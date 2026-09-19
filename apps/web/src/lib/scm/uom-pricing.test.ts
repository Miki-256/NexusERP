import { describe, expect, it } from "vitest";
import { buildUomPreset, formatPriceInput, fromBasePrice, toBasePrice } from "./uom-pricing";

describe("toBasePrice / fromBasePrice", () => {
  it("120 ETB/kg → 0.12 per g (factor 1000)", () => {
    expect(toBasePrice(120, 1000)).toBe(0.12);
  });

  it("5 ETB/kg sell → 0.005 per g", () => {
    expect(toBasePrice(5, 1000)).toBe(0.005);
  });

  it("fromBasePrice round-trips with fromBase", () => {
    const base = toBasePrice(120, 1000);
    expect(fromBasePrice(base, 1000)).toBe(120);
  });

  it("handles factor 1 (base UOM)", () => {
    expect(toBasePrice(10, 1)).toBe(10);
    expect(fromBasePrice(10, 1)).toBe(10);
  });

  it("returns 0 for invalid factor", () => {
    expect(toBasePrice(10, 0)).toBe(0);
    expect(fromBasePrice(10, -1)).toBe(0);
  });
});

describe("buildUomPreset", () => {
  it("weight: base g, purchase kg", () => {
    const p = buildUomPreset("weight");
    expect(p.baseCode).toBe("g");
    expect(p.purchaseCode).toBe("kg");
    expect(p.purchaseFactor).toBe(1000);
    expect(p.specs).toHaveLength(2);
  });

  it("volume: base ml, purchase l", () => {
    const p = buildUomPreset("volume");
    expect(p.baseCode).toBe("ml");
    expect(p.purchaseCode).toBe("l");
  });

  it("pack uses pack size", () => {
    const p = buildUomPreset("pack", 12);
    expect(p.purchaseCode).toBe("cs");
    expect(p.purchaseFactor).toBe(12);
  });

  it("each is single ea", () => {
    const p = buildUomPreset("each");
    expect(p.specs).toHaveLength(1);
    expect(p.purchaseFactor).toBe(1);
  });
});

describe("formatPriceInput", () => {
  it("formats finite numbers", () => {
    expect(formatPriceInput(0.12)).toBe("0.12");
  });
});

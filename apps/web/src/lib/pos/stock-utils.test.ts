import { describe, expect, it } from "vitest";
import {
  hasMeasuredSaleUoms,
  isMeasuredUomCode,
  qtyButtonStepForUom,
  qtyStepForUom,
} from "./stock-utils";

describe("measured UOM helpers", () => {
  it("detects weight/volume codes", () => {
    expect(isMeasuredUomCode("kg")).toBe(true);
    expect(isMeasuredUomCode("g")).toBe(true);
    expect(isMeasuredUomCode("L")).toBe(true);
    expect(isMeasuredUomCode("ml")).toBe(true);
    expect(isMeasuredUomCode("ea")).toBe(false);
    expect(isMeasuredUomCode("cs")).toBe(false);
  });

  it("detects products with measured sale UOMs", () => {
    expect(
      hasMeasuredSaleUoms({
        saleUoms: [{ code: "g" }, { code: "kg" }],
      })
    ).toBe(true);
    expect(hasMeasuredSaleUoms({ saleUoms: [{ code: "ea" }] })).toBe(false);
  });

  it("uses decimal steps for kg and button steps of 0.1", () => {
    expect(qtyStepForUom("kg")).toBe(0.001);
    expect(qtyButtonStepForUom("kg")).toBe(0.1);
    expect(qtyButtonStepForUom("g")).toBe(10);
    expect(qtyButtonStepForUom("ea")).toBe(1);
  });
});

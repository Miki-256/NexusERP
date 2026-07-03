import { describe, expect, it } from "vitest";
import type { PosCatalogItem } from "@/components/pos/product-card";
import { buildCatalogSearchIndex, filterCatalogItems } from "./catalog-search";

const sample: PosCatalogItem[] = [
  {
    productId: "p1",
    variantId: "v1",
    name: "Espresso",
    variantName: "Single",
    sellPrice: 50,
    barcode: "123456",
    sku: "ESP-01",
    stock: 10,
    categoryId: "c1",
    categoryName: "Coffee",
  },
  {
    productId: "p2",
    variantId: "v2",
    name: "Latte",
    variantName: "Large",
    sellPrice: 80,
    barcode: null,
    sku: "LAT-02",
    stock: 5,
    categoryId: "c1",
    categoryName: "Coffee",
  },
  {
    productId: "p3",
    variantId: "v3",
    name: "Sandwich",
    variantName: "Ham",
    sellPrice: 120,
    barcode: "999",
    sku: null,
    stock: 3,
    categoryId: "c2",
    categoryName: "Food",
  },
];

const index = buildCatalogSearchIndex(sample);
const baseOpts = {
  search: "",
  category: "all",
  viewFavorites: false,
  viewRecent: false,
  favorites: new Set<string>(),
  recentVariantIds: [] as string[],
};

describe("buildCatalogSearchIndex", () => {
  it("indexes barcode and sku for O(1) lookup", () => {
    expect(index.byBarcode.get("123456")).toBe("v1");
    expect(index.bySku.get("lat-02")).toBe("v2");
  });
});

describe("filterCatalogItems", () => {
  it("filters by category", () => {
    const items = filterCatalogItems(sample, index, { ...baseOpts, category: "Food" });
    expect(items).toHaveLength(1);
    expect(items[0]?.variantId).toBe("v3");
  });

  it("returns exact barcode hit only", () => {
    const items = filterCatalogItems(sample, index, { ...baseOpts, search: "123456" });
    expect(items).toHaveLength(1);
    expect(items[0]?.variantId).toBe("v1");
  });

  it("filters favorites view", () => {
    const items = filterCatalogItems(sample, index, {
      ...baseOpts,
      viewFavorites: true,
      favorites: new Set(["v2"]),
    });
    expect(items.map((i) => i.variantId)).toEqual(["v2"]);
  });

  it("matches name substring search", () => {
    const items = filterCatalogItems(sample, index, { ...baseOpts, search: "lat" });
    expect(items.some((i) => i.variantId === "v2")).toBe(true);
  });
});

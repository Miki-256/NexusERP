import { describe, expect, it } from "vitest";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";

describe("parseRpcJsonArray", () => {
  it("returns arrays as-is", () => {
    expect(parseRpcJsonArray([{ id: "1" }])).toEqual([{ id: "1" }]);
  });

  it("returns empty array for nullish values", () => {
    expect(parseRpcJsonArray(null)).toEqual([]);
    expect(parseRpcJsonArray(undefined)).toEqual([]);
  });

  it("parses JSON string arrays", () => {
    expect(parseRpcJsonArray('[{"id":"a"}]')).toEqual([{ id: "a" }]);
  });

  it("returns empty array for invalid JSON strings", () => {
    expect(parseRpcJsonArray("{bad-json")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseRpcJsonArray('{"id":"a"}')).toEqual([]);
  });
});

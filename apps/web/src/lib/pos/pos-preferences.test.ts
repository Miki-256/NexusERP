import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPosCheckoutMode,
  setPosCheckoutMode,
} from "./pos-preferences";

const REGISTER = "test-register-checkout-mode";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
});

afterEach(() => {
  store.clear();
});

describe("pos checkout mode preference", () => {
  it("defaults to default", () => {
    expect(getPosCheckoutMode(REGISTER)).toBe("default");
  });

  it("persists fastest and default", () => {
    setPosCheckoutMode(REGISTER, "fastest");
    expect(getPosCheckoutMode(REGISTER)).toBe("fastest");
    setPosCheckoutMode(REGISTER, "default");
    expect(getPosCheckoutMode(REGISTER)).toBe("default");
  });
});

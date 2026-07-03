import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
      "@nex/shared": path.resolve(__dirname, "packages/shared/src"),
    },
  },
});

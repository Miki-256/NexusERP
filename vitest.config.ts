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
    setupFiles: ["tests/integration/setup-env.ts"],
    coverage: {
      provider: "v8",
      include: [
        "apps/web/src/lib/api/**/*.ts",
        "apps/web/src/lib/rate-limit.ts",
        "apps/web/src/lib/tenant-scroll.ts",
        "apps/web/src/lib/notifications/parse-rpc-json.ts",
        "apps/web/src/lib/notifications/template-renderer.ts",
        "apps/web/src/lib/notifications/worker-options.ts",
        "apps/web/src/lib/notifications/channels/email-sender.ts",
        "apps/web/src/lib/finance/financials-area-scope.ts",
        "apps/web/src/lib/finance/financials-skip-fetch.ts",
      ],
      exclude: ["**/*.test.ts"],
      thresholds: {
        lines: 75,
        functions: 75,
        statements: 75,
        branches: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
      "@nex/shared": path.resolve(__dirname, "packages/shared/src"),
    },
  },
});

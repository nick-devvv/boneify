import { defineConfig } from "vitest/config";

// `npm test` runs every offline test (no keys, no network).
// `npm run test:live` (LIVE=1) runs only the contract tests in tests/live against the real Nace API.
const live = process.env.LIVE === "1";

export default defineConfig({
  test: {
    include: live ? ["tests/live/**/*.test.ts"] : ["tests/**/*.test.ts"],
    exclude: live ? ["node_modules/**"] : ["node_modules/**", "tests/live/**"],
    environment: "node",
    testTimeout: live ? 120_000 : 20_000,
  },
});

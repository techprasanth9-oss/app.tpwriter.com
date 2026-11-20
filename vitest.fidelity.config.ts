import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * DOCX fidelity suite (`pnpm test:fidelity`). Kept out of `pnpm test`: the
 * default config only includes `*.test.ts`; this one only `*.fidelity.ts`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.fidelity.ts"],
    setupFiles: ["src/test-setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // One file, sequential: the report is built across all fixtures.
    fileParallelism: false,
  },
});

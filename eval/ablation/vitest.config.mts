import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Ablation evaluation (`npx vitest run --config eval/ablation/vitest.config.mts`). Never part of `npm test`. */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    environment: "node",
    include: ["eval/ablation/**/*.test.ts"],
    silent: false,
  },
});

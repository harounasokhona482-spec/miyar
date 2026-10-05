import { defineConfig } from "vitest/config";

/** Real OpenAI smoke tests (`npm run test:real`). Never part of `npm test`. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.real.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

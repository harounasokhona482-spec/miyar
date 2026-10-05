import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Real-model smoke tests run only through `npm run test:real`.
    exclude: ["src/**/*.real.test.ts", "node_modules/**"],
  },
});

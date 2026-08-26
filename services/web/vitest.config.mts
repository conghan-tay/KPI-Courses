import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // Playwright drives the browser; vitest covers the pure layer only.
    exclude: ["e2e/**", "node_modules/**"],
  },
});

import { defineConfig } from "vitest/config";
import path from "path";

// Load .env for tests (GARMIN_TOKEN_KEY etc.) — Node 20+ native
try {
  process.loadEnvFile();
} catch {
  // .env missing or Node <20 — ignore, env must be set externally
}

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:8000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // main.tsx only mounts the router into index.html; the routes themselves are tested through routes.tsx.
      exclude: ["src/main.tsx", "src/test/**", "src/**/*.test.{ts,tsx}"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
      reporter: ["text", "html"],
    },
  },
});

import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@enterprise": path.resolve(__dirname, "src/enterprise"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/unit/helpers/setupTests.ts"],
    css: false,
    server: {
      deps: {
        inline: ["monaco-editor", "vitest-canvas-mock"],
      },
    },
  },
});

// Minimal vitest config for useChatHistory.spec.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue() as any],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@enterprise": fileURLToPath(new URL("./src/enterprise", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/composables/useChatHistory.spec.ts"],
    root: fileURLToPath(new URL(".", import.meta.url)),
    setupFiles: ["src/test/unit/helpers/setupTests.ts"],
    dangerouslyIgnoreUnhandledErrors: true,
    silent: false,
    reporters: ["verbose"],
  },
});

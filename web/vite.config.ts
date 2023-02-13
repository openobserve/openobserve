import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { quasar, transformAssetUrls } from "@quasar/vite-plugin";
import nodePolyfills from "rollup-plugin-node-polyfills";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  test: {
    coverage: {
      reporter: ["text", "json", "html"],
    },
    environment: "happy-dom",
    cache: false,
    maxConcurrency: 20,
    update: true,
    // testNamePattern: "DateTime",
    // ...
  },
  // server: {
  //   port: 8081,
  // },
  base: "/",
  plugins: [
    vue({
      template: { transformAssetUrls },
    }),
    quasar({
      sassVariables: "src/styles/quasar-variables.sass",
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      stream: "rollup-plugin-node-polyfills/polyfills/stream",
      events: "rollup-plugin-node-polyfills/polyfills/events",
      assert: "assert",
      crypto: "crypto-browserify",
      util: "util",
      "./runtimeConfig": "./runtimeConfig.browser",
    },
  },
  build: {
    target: "es2020",
    sourcemap: true,
    rollupOptions: {
      plugins: [nodePolyfills()],
    },
    outDir: path.resolve(__dirname, "dist"),
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [NodeGlobalsPolyfillPlugin({ buffer: true })],
      target: "es2020",
    },
  },
});

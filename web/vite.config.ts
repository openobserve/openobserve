// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import { quasar, transformAssetUrls } from "@quasar/vite-plugin";
import nodePolyfills from "rollup-plugin-node-polyfills";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import path from "path";
import dotenv from "dotenv";
import fs from "fs-extra";

// Load environment variables from the appropriate .env file
if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: ".env.production" });
} else if (process.env.NODE_ENV === "devcloud") {
  dotenv.config({ path: ".env.devcloud" });
} else {
  dotenv.config();
}

const enterpriseResolverPlugin = {
  name: "enterprise-resolver",
  async resolveId(source) {
    if (source.startsWith("@zo/")) {
      const fileName = source.replace("@zo/", "");

      const enterprisePath = path.resolve(
        __dirname,
        `./src/enterprise/${fileName}`
      );
      const defaultPath = path.resolve(__dirname, `./src/${fileName}`);

      if (
        process.env.VITE_ZINCOBSERVE_CLOUD == "true" &&
        (await fs.pathExists(enterprisePath))
      ) {
        return enterprisePath;
      }

      return defaultPath;
    }
  },
};

// let filePath = path.resolve(process.cwd(), "src");
// if (process.env.VITE_ZINCOBSERVE_CLOUD === "true") {
// const filePath = path.resolve(process.cwd(), "src/enterprise");
// }

// const enterprisePath = path.resolve(process.cwd(), 'src/enterprise');
// const srcPath = path.resolve(process.cwd(), 'src');

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  test: {
    global: true,
    setupFiles: "src/test/unit/helpers/setupTests.ts",
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
  server: {
    port: 8081,
  },
  base: "./",
  plugins: [
    vue({
      template: { transformAssetUrls },
    }),
    quasar({
      sassVariables: "src/styles/quasar-variables.sass",
    }),
    enterpriseResolverPlugin,
    vueJsx(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@enterprise": fileURLToPath(new URL("./src/enterprise", import.meta.url)),
      stream: "rollup-plugin-node-polyfills/polyfills/stream",
      events: "rollup-plugin-node-polyfills/polyfills/events",
      assert: "assert",
      crypto: "crypto-browserify",
      util: "util",
      "./runtimeConfig": "./runtimeConfig.browser",
    },
  },
  build: {
    sourcemap: false,
    target: "es2020",
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

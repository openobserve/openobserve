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
import { quasar, transformAssetUrls } from "@quasar/vite-plugin";
import nodePolyfills from "rollup-plugin-node-polyfills";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";

// Load environment variables from the appropriate .env file
if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: ".env.production" });
} else if (process.env.NODE_ENV === "devcloud") {
  dotenv.config({ path: ".env.devcloud" });
} else {
  dotenv.config();
}

// let filePath = path.resolve(process.cwd(), "src");
// if (process.env.VITE_ZINCOBSERVE_CLOUD === "true") {
const filePath = path.resolve(process.cwd(), "src/enterprise");
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
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Check if the file exists in the enterprise folder before creating the alias
      // "@enterprise": fileURLToPath(
        // new URL("./src", import.meta.url)
      // ),
      // Use a default alias for the src folder
      // "@both$": fileURLToPath(new URL("./src", import.meta.url)),
      // "@both": (filePath) => {
      //   console.log(filePath)
      //   const enterpriseFile = path.resolve(enterprisePath, filePath);
      //   if (fs.existsSync(enterpriseFile)) {
      //     return enterpriseFile;
      //   } else {
      //     const srcFile = path.resolve(srcPath, filePath);
      //     return fs.existsSync(srcFile) ? srcFile : null;
      //   }
      // },
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

// Copyright 2023 Zinc Labs Inc.

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
import monacoEditorPlugin from "vite-plugin-monaco-editor";
import visualizer from "rollup-plugin-visualizer";

// Load environment variables from the appropriate .env file
if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: ".env.production" });
} else if (process.env.NODE_ENV === "devcloud") {
  dotenv.config({ path: ".env.devcloud" });
} else {
  dotenv.config();
}

const isTesting = process.env.NODE_ENV === "test";

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
        process.env.VITE_OPENOBSERVE_CLOUD == "true" &&
        (await fs.pathExists(enterprisePath))
      ) {
        return enterprisePath;
      }

      return defaultPath;
    }
  },
};

function monacoEditorTestResolver() {
  return {
    name: "monaco-editor-test-resolver",
    enforce: "pre",
    resolveId(id) {
      if (id === "monaco-editor") {
        return {
          id: "monaco-editor/esm/vs/editor/editor.api",
        };
      }
      return null;
    },
  };
}

// let filePath = path.resolve(process.cwd(), "src");
// if (process.env.VITE_OPENOBSERVE_CLOUD === "true") {
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
    monacoEditorPlugin({
      customDistPath: () =>
        path.resolve(__dirname, "dist/assets/monacoeditorwork"),
    }),
    isTesting && monacoEditorTestResolver(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@enterprise": fileURLToPath(
        new URL("./src/enterprise", import.meta.url)
      ),
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
      plugins: [
        nodePolyfills(),
        visualizer({
          open: true,
          gzipSize: true,
          brotliSize: true,
        }),
      ],
      manualChunks: {
        analytics: ["@sentry/vue", "@sentry/tracing", "rudder-sdk-js"],
        "monaco-editor": ["monaco-editor"],
        // plotly: ["plotly.js-dist-min"],
        "node-sql-parser": ["node-sql-parser/build/mysql"],
        d3: ["d3-hierarchy", "d3-selection"],
        lodash: ["lodash-es", "lodash/lodash.js", "moment"],
      },
    },
    outDir: path.resolve(__dirname, "dist"),
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [NodeGlobalsPolyfillPlugin({ buffer: true })],
      target: "es2020",
    },
  },
  test: {
    enable: true,
    global: true,
    setupFiles: "src/test/unit/helpers/setupTests.ts",
    deps: {
      // inline: ["monaco-editor", "plotly.js"],
      inline: ["monaco-editor"],
    },
    coverage: {
      reporter: ["text", "json", "html"],
      all: true,
      exclude: [
        "coverage/**",
        "dist/**",
        "packages/*/test{,s}/**",
        "cypress/**",
        "src/test/**",
        "test{,s}/**",
        "test{,-*}.{js,cjs,mjs,ts,tsx,jsx}",
        "**/*{.,-}test.{js,cjs,mjs,ts,tsx,jsx}",
        "**/*{.,-}spec.{js,cjs,mjs,ts,tsx,jsx}",
        "**/__tests__/**",
        "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
        "**/.{eslint,mocha,prettier}rc.{js,cjs,yml}",
        "quasar.conf.js",
        "env.d.ts",
      ],
    },
    environment: "jsdom",
    cache: false,
    maxConcurrency: 20,
    update: false,
  },
});

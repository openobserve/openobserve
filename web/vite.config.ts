// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

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
import { visualizer } from "rollup-plugin-visualizer";
import "dotenv/config";

import istanbul from "vite-plugin-istanbul";
import monacoEditorPlugin from "vite-plugin-monaco-editor";

// Load environment variables from the appropriate .env file
if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: ".env.production" });
} else if (process.env.NODE_ENV === "devcloud") {
  dotenv.config({ path: ".env.devcloud" });
} else {
  dotenv.config();
}

const isTesting = process.env.NODE_ENV === "test";

let buildTime = Date.now();

const enterpriseResolverPlugin = {
  name: "enterprise-resolver",
  async resolveId(source: string) {
    if (source.startsWith("@zo/")) {
      const fileName = source.replace("@zo/", "");

      const enterprisePath = path.resolve(
        __dirname,
        `./src/enterprise/${fileName}`,
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
    enforce: "post",
    resolveId(id: string) {
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
    __INTLIFY_JIT_COMPILATION__: true,
    __BUILD_TIME__: buildTime,
  },
  server: {
    port: 8081,
    // headers: {
    //   "Content-Security-Policy":
    //     "default-src 'self'; connect-src 'self' http://localhost:5080;  script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; block-all-mixed-content;",
    // },
  },
  base: "./",
  plugins: [
    vue({
      template: { transformAssetUrls },
    }),
    quasar({
      sassVariables: fileURLToPath(
        new URL("src/styles/quasar-variables.sass", import.meta.url),
      ),
    }),
    process.env.VITE_COVERAGE === "true" &&
      istanbul({
        include: "src/**/*",
        exclude: ["node_modules", "test/", "src/**/*.spec.{ts,js}"],
        extension: [".js", ".ts", ".vue"],
        requireEnv: false,
        forceBuildInstrument: true,
      }),
    enterpriseResolverPlugin,
    vueJsx(),
    (monacoEditorPlugin as any).default({
      customDistPath: () => path.resolve(__dirname, "dist/monacoeditorwork"),
    }),
    isTesting && monacoEditorTestResolver(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@enterprise": fileURLToPath(
        new URL("./src/enterprise", import.meta.url),
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
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      plugins: [
        nodePolyfills() as any,
        visualizer({
          open: true,
          gzipSize: true,
          brotliSize: true,
        }),
      ],
      output: {
        manualChunks: {
          "o2cs-analytics": ["@rudderstack/analytics-js"],
          "o2cs-oo-rum": [
            "@openobserve/browser-logs",
            "@openobserve/browser-rum",
          ],
          "o2cs-date-fns": ["date-fns", "date-fns-tz"],
          "monaco-editor": ["monaco-editor"],
          moment: ["moment", "moment-timezone"],
          lodash: ["lodash-es"],
          echarts: [
            "echarts/core",
            "echarts/renderers",
            "echarts/components",
            "echarts/features",
            "echarts/charts",
          ],
          luxon: ["luxon"],
          marked: ["marked"],
          jszip: ["jszip"],
          leaflet: ["leaflet"],
          gridstack: ["gridstack"],
          "flag-icons": ["flag-icons"],
          "highlight.js": ["highlight.js"],
        },
        chunkFileNames: ({ name }) => {
          if (name.startsWith("o2cs-")) {
            return `assets/vendor/${name}.[hash].js`;
          }

          if (name.includes("editor.api")) {
            return `assets/${name}.v1.js`;
          }

          if (name.includes("monaco-editor")) {
            return `assets/${name}.v1.js`;
          }

          if (name.includes("moment")) {
            return `assets/${name}.v1.js`;
          }

          return `assets/${name}.[hash].js`;
        },
      },
    },
    outDir: path.resolve(__dirname, "dist"),
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [NodeGlobalsPolyfillPlugin({ buffer: true })],
      target: "es2020",
    },
    exclude: [],
    force: false,
  },
});

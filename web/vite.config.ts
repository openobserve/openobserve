// Copyright 2026 OpenObserve Inc.
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
import { spawn } from "node:child_process";

import { defineConfig, loadEnv } from "vite";

// Runs `node <scriptPath>` as a child process and resolves when it finishes.
// We use spawn (not execFileSync/execFile) for two reasons:
//   - stdio: "inherit" streams the script's logs straight to the terminal so a
//     slow/failed fetch is visible instead of looking like a silent hang.
//   - it's async, so awaiting it doesn't block Vite's event loop synchronously.
// spawn is event-based, so we wrap it in a Promise: resolve on exit code 0,
// reject otherwise — the rejection propagates out of the async config hook and
// FAILS the build (this is what makes DS_CONTENT_STRICT actually abort).
const runNode = (scriptPath: string, env: NodeJS.ProcessEnv): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath], { stdio: "inherit", env });
    child.on("error", reject); // process could not be started at all
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`fetch-datasource-content exited with ${code}`)),
    );
  });
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import nodePolyfills from "rollup-plugin-node-polyfills";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
import path from "path";
import dotenv from "dotenv";
import fs from "fs-extra";
import { visualizer } from "rollup-plugin-visualizer";
import "dotenv/config";

import istanbul from "vite-plugin-istanbul";
import monacoEditorPlugin from "vite-plugin-monaco-editor";
import Icons from "unplugin-icons/vite";

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

// Fetches AI data-source UI markdown from the content repo before Vite starts,
// so import.meta.glob can bundle it. Covers `vite dev` and every build mode.
// Builds (CI/prod) force a fresh pull AND fail if it can't be fetched, so we
// never ship stale or missing content; the dev server stays lenient (uses the
// cached generated/ dir). Override with DS_CONTENT_STRICT / DS_CONTENT_FORCE.
// See scripts/fetch-datasource-content.mjs.
const datasourceContentPlugin = {
  name: "datasource-content",
  enforce: "pre" as const,
  // async so it doesn't block Vite's event loop; the script itself caps each
  // fetch with a timeout and only retries under DS_CONTENT_STRICT (builds/CI).
  async config(_config: any, env: { command: string }) {
    // env.command is "build" (vite build / CI / prod) or "serve" (dev server).
    const isBuild = env?.command === "build";
    await runNode(
      path.resolve(__dirname, "scripts/fetch-datasource-content.mjs"),
      {
        // Inherit the parent env (PATH, etc.) so git/node resolve, and so any
        // DS_CONTENT_* the dev set (REPO/REF/TIMEOUT) flows through to the script.
        ...process.env,
        // Policy flags (the `?? ` lets an explicitly-set env var override):
        //   STRICT: a failed fetch exits non-zero → build fails. On for builds,
        //   off for dev (dev falls back to cache / the legacy snippet).
        DS_CONTENT_STRICT:
          process.env.DS_CONTENT_STRICT ?? (isBuild ? "1" : ""),
        //   FORCE: re-fetch the latest instead of reusing the cached generated/
        //   dir. On for builds (always ship fresh), off for dev (fast restarts).
        DS_CONTENT_FORCE: process.env.DS_CONTENT_FORCE ?? (isBuild ? "1" : ""),
      },
    );
  },
};

// let filePath = path.resolve(process.cwd(), "src");
// if (process.env.VITE_OPENOBSERVE_CLOUD === "true") {
// const filePath = path.resolve(process.cwd(), "src/enterprise");
// }

// const enterprisePath = path.resolve(process.cwd(), 'src/enterprise');
// const srcPath = path.resolve(process.cwd(), 'src');

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === "production";

  // Feature-group logging: console.log/debug/info('<namespace>', ...) calls
  // are kept in dev only when their namespace matches VITE_DEBUG_GROUPS
  // (.env, comma-separated, supports trailing-* wildcards). loadEnv reads
  // every .env* file. console.error/warn are never filtered or stripped.
  const allowedGroups = (
    loadEnv(mode, process.cwd(), "").VITE_DEBUG_GROUPS ?? ""
  )
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

  const debugFilterPlugin = {
    name: "vite-plugin-debug-filter",
    transform(code: string, id: string) {
      if (isProd || id.includes("node_modules") || !id.match(/\.(vue|ts|js)$/))
        return;
      return {
        code: code.replace(
          /console\.(?:log|debug|info)\(\s*['"`]([^'"`]+)['"`]/g,
          (match, namespace) => {
            const isAllowed = allowedGroups.some((group) => {
              if (group.endsWith("*"))
                return namespace.startsWith(group.slice(0, -1));
              return namespace === group || namespace.startsWith(`${group}:`);
            });
            // `false &&` instead of commenting out: multi-line calls stay
            // valid JS, and short-circuiting keeps the args unevaluated.
            return isAllowed ? match : `false && ${match}`;
          },
        ),
        map: null,
      };
    },
  };

  return {
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
      vue(),
      debugFilterPlugin,
      process.env.VITE_COVERAGE === "true" &&
        istanbul({
          include: "src/**/*",
          exclude: ["node_modules", "test/", "src/**/*.spec.{ts,js}"],
          extension: [".js", ".ts", ".vue"],
          requireEnv: false,
          forceBuildInstrument: true,
        }),
      enterpriseResolverPlugin,
      // Register the content fetcher for dev + builds, but NOT under vitest
      // (tests mock the content/manifest and must stay offline/deterministic).
      // `false` entries are dropped by the `.filter(Boolean)` at the end.
      !isTesting && datasourceContentPlugin,
      Icons({
        compiler: "vue3",
        autoInstall: false,
      }),
      vueJsx(),
      (monacoEditorPlugin as any).default({
        customDistPath: () => path.resolve(__dirname, "dist/monacoeditorwork"),
      }),
      isTesting && monacoEditorTestResolver(),
    ].filter(Boolean),
    css: {},
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
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        plugins: [
          nodePolyfills() as any,
          visualizer({
            // Opt in with ANALYZE=true; every build used to pop the report open.
            open: process.env.ANALYZE === "true",
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
            // monaco-editor removed from manualChunks to enable true lazy loading
            // "monaco-editor": ["monaco-editor"],
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
            "highlight.js": ["highlight.js"],
          },
          chunkFileNames: ({ name }) => {
            if (name.startsWith("o2cs-")) {
              return `assets/vendor/${name}.[hash].js`;
            }

            if (name.includes("editor.api")) {
              return `assets/${name}.[hash].js`;
            }

            if (name.includes("monaco-editor")) {
              return `assets/${name}.[hash].js`;
            }

            if (name.includes("moment")) {
              return `assets/${name}.[hash].js`;
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
    esbuild: {
      // Production hard-drop: dead-code elimination erases all
      // console.log/debug/info lines (console.error/warn are kept)
      pure: isProd ? ["console.log", "console.debug", "console.info"] : [],
    },
  };
});

import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import type { ConfigEnv } from 'vite'
import type { UserConfig } from 'vite'
import viteConfig from './vite.config'

// Convert the vite config to a plain object if it's a function
const viteConfigObj = typeof viteConfig === 'function'
  ? (viteConfig as (options: ConfigEnv) => UserConfig)({ command: 'serve', mode: 'development' })
  : viteConfig

export default mergeConfig(
  viteConfigObj,
  defineConfig({
    logLevel: 'error', // Suppress Vite warnings (e.g., Monaco editor source map issues)
    customLogger: {
      info: (msg) => console.info(msg),
      warn: (msg) => {
        // Suppress Monaco editor source map warnings
        const msgStr = String(msg);
        if ((msgStr.includes('Failed to load source map') || msgStr.includes('marked.umd.js.map')) &&
            msgStr.includes('monaco-editor')) {
          return;
        }
        console.warn(msg);
      },
      warnOnce: (msg) => {
        const msgStr = String(msg);
        if ((msgStr.includes('Failed to load source map') || msgStr.includes('marked.umd.js.map')) &&
            msgStr.includes('monaco-editor')) {
          return;
        }
        console.warn(msg);
      },
      error: (msg) => {
        const msgStr = String(msg);
        if ((msgStr.includes('Failed to load source map') || msgStr.includes('marked.umd.js.map')) &&
            msgStr.includes('monaco-editor')) {
          return;
        }
        console.error(msg);
      },
      clearScreen: () => {},
      hasErrorLogged: () => false,
      hasWarned: false,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],
      include: ["src/**/*.spec.{ts,js,vue}"],
      root: fileURLToPath(new URL('.', import.meta.url)),
      setupFiles: ['src/test/unit/helpers/setupTests.ts'],
      server: {
        deps: {
          inline: ["monaco-editor", "vitest-canvas-mock"],
        },
      },
      // Prevent unhandled errors from failing the test suite
      dangerouslyIgnoreUnhandledErrors: true,
      // Suppress all console output during tests except test results
      silent: false,
      reporters: ['default'],
      // Suppress all console output (both stderr and stdout)
      onConsoleLog: (log: string, type: 'stdout' | 'stderr') => {
        // Return false to prevent all console logs from being printed
        // This keeps test output clean and only shows test results
        return false;
      },
      coverage: {
        provider: 'v8',
        reporter: ["text", "json", "html", "json-summary"],
        include: ['src/**/*.{js,ts,vue}'],
        thresholds: {
          lines: 27,
          functions: 27,
          branches: 40,
          statements: 27
        },
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
          "**/*.config.js",
          "quasar.conf.js",
          "env.d.ts",
          "src/assets/dashboard/**",
          // Language/translation files - no tests needed
          "src/locales/languages/**/*.json",
          // Main entry point - bootstrapping code
          "src/main.ts",
          // Chart template data files - static configuration
          "src/components/dashboards/addPanel/customChartExamples/chartTemplates/**/*.ts",
          "src/components/dashboards/addPanel/customChartExamples/index.ts",
          "src/components/dashboards/addPanel/customChartExamples/exampleTypes.ts",
          // Type definition files
          "**/*.d.ts",
          "src/contextProviders/types.ts",
          // Index files that only re-export
          "src/components/alerts/index.ts",
          "src/components/functions/index.ts",
          "src/contextProviders/index.ts",
          // Layout mixins (tested via integration)
          "src/enterprise/mixins/layout.mixin.ts",
          "src/mixins/layout.mixin.ts",
          // Plugin index (just exports)
          "src/plugins/index.ts",
          // AWS exports (configuration)
          "src/aws-exports.ts",
          // Constants/config files with only static data
          "src/constants/cards.ts",
        ],
      },
    },
  }),
)


// import { defineConfig } from 'vitest/config';
// import path from 'path';
// import vue from '@vitejs/plugin-vue'
// import { quasar } from "@quasar/vite-plugin";

// export default defineConfig({
//   plugins: [vue(), quasar()],
//   test: {
//     globals: true,
//     setupFiles: "test/unit/helpers/setupTests.ts",
//     deps: {
//       inline: ["monaco-editor", "vitest-canvas-mock"],
//     },
//     coverage: {
//       reporter: ["text", "json", "html"],
//       all: true,
//       exclude: [
//         "coverage/**",
//         "dist/**",
//         "packages/*/test{,s}/**",
//         "cypress/**",
//         "src/test/**",
//         "test{,s}/**",
//         "test{,-*}.{js,cjs,mjs,ts,tsx,jsx}",
//         "**/*{.,-}test.{js,cjs,mjs,ts,tsx,jsx}",
//         "**/*{.,-}spec.{js,cjs,mjs,ts,tsx,jsx}",
//         "**/__tests__/**",
//         "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
//         "**/.{eslint,mocha,prettier}rc.{js,cjs,yml}",
//         "quasar.conf.js",
//         "env.d.ts",
//       ],
//     },
//     environment: "jsdom",
//     environmentOptions: {
//       jsdom: {
//         resources: "usable",
//       },
//     },
//   },
//   resolve: {
//     alias: {
//       '@': path.resolve(__dirname, './src'),
//     },
//   },
// }); 
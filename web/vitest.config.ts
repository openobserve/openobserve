import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
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
      coverage: {
        reporter: ["text", "json", "html", "json-summary"],
        // Vitest v4: 'all' option removed, use 'include' instead
        include: ["src/**/*.{js,ts,vue,jsx,tsx}"],
        thresholds: {
          lines: 27,
          functions: 27,
          branches: 46,
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
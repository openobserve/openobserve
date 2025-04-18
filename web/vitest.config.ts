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
      include: ["src/**/*.{ts,js,vue}"],
      root: fileURLToPath(new URL('./src/test/unit', import.meta.url)),
      setupFiles: ['./helpers/setupTests.ts'],
      deps: {
        inline: ["monaco-editor", "vitest-canvas-mock"],
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
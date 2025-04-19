import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import type { ConfigEnv } from 'vitest/config'
import type { UserConfig } from 'vite'
import viteConfig from './vite.config'

// Convert the vite config to a plain object if it's a function
const viteConfigObj = typeof viteConfig === 'function' 
  ? (viteConfig as (options: ConfigEnv) => UserConfig)({ command: 'serve', mode: 'development' }) 
  : viteConfig

export default mergeConfig(
  viteConfigObj,
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
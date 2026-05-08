import vue from 'eslint-plugin-vue'
import js from '@eslint/js'
import typescript from '@typescript-eslint/eslint-plugin'
import typescriptParser from '@typescript-eslint/parser'
import vueParser from 'vue-eslint-parser'
import prettier from 'eslint-plugin-prettier'
import cypress from 'eslint-plugin-cypress'
import fs from 'fs'

// Read .gitignore to use as ignore patterns
const gitignore = fs.existsSync('.gitignore') 
  ? fs.readFileSync('.gitignore', 'utf8')
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))
      .map(line => line.trim())
  : []

export default [
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,vue}'],
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.vscode/**',
      '*.min.js',
      'packages/rrweb-player/**',
      ...gitignore
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: vueParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      vue,
      '@typescript-eslint': typescript,
      prettier
    },
    rules: {
      // Disable noisy rules inherited from recommended configs
      'prettier/prettier': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
      'no-prototype-builtins': 'off',
      'no-async-promise-executor': 'off',
      'no-empty': 'off',
      'no-self-assign': 'off',
      'no-useless-escape': 'off',
      'no-redeclare': 'off',
      'no-unsafe-optional-chaining': 'off',
      'no-import-assign': 'off',
      'no-useless-catch': 'off',
      'no-unreachable': 'off',
      'no-case-declarations': 'off',
      'no-shadow-restricted-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/no-mutating-props': 'off',
      'vue/no-unused-components': 'off',
      'vue/no-dupe-keys': 'off',
      'vue/no-side-effects-in-computed-properties': 'off',
      'vue/require-valid-default-prop': 'off',
      'vue/no-unused-vars': 'off',
      'vue/no-use-v-if-with-v-for': 'off',
      'vue/no-reserved-component-names': 'off',
      'vue/valid-v-for': 'off',
      'vue/require-v-for-key': 'off',
      'vue/return-in-computed-property': 'off',
      'vue/require-toggle-inside-transition': 'off',
      'vue/no-deprecated-v-bind-sync': 'off',
      'vue/no-parsing-error': 'off',
      'vue/valid-next-tick': 'off',
      'vue/no-v-text-v-html-on-component': 'off',
      'vue/prefer-import-from-vue': 'off',
      'vue/valid-attribute-name': 'off',
      'vue/no-ref-as-operand': 'off',
      'vue/multi-word-component-names': 'off',

      // Enforced rules
      'vue/no-restricted-html-elements': [
        'error',
        {
          element: 'q-btn',
          message: 'Use <OButton> from "@/lib/core/Button/OButton.vue" instead of <q-btn>.'
        },
        {
          element: 'q-btn-group',
          message: 'Use <OButtonGroup> from "@/lib/core/Button/OButtonGroup.vue" instead of <q-btn-group>.'
        },
        {
          element: 'q-tabs',
          message: 'Use <OTabs> from "@/lib/navigation/Tabs/OTabs.vue" instead of <q-tabs>.'
        },
        {
          element: 'q-tab',
          message: 'Use <OTab> from "@/lib/navigation/Tabs/OTab.vue" instead of <q-tab>.'
        },
        {
          element: 'q-tab-panels',
          message: 'Use <OTabPanels> from "@/lib/navigation/Tabs/OTabPanels.vue" instead of <q-tab-panels>.'
        },
        {
          element: 'q-tab-panel',
          message: 'Use <OTabPanel> from "@/lib/navigation/Tabs/OTabPanel.vue" instead of <q-tab-panel>.'
        },
        {
          element: 'q-route-tab',
          message: 'Use <ORouteTab> from "@/lib/navigation/Tabs/ORouteTab.vue" instead of <q-route-tab>.'
        },
        {
          element: 'q-btn-toggle',
          message: 'Use <OToggleGroup> from "@/lib/core/ToggleGroup/OToggleGroup.vue" instead of <q-btn-toggle>.'
        },
        {
          element: 'q-btn-dropdown',
          message: 'Use <OButton> with <ODropdown> instead of <q-btn-dropdown>.'
        }
      ]
    }
  },
  {
    files: ['cypress/e2e/**/*.{cy,spec}.{js,ts,jsx,tsx}'],
    plugins: {
      cypress
    },
    rules: {
      ...cypress.configs.recommended.rules
    }
  }
]
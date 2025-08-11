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
      'vue/max-attributes-per-line': [
        'warn',
        {
          singleline: {
            max: 2
          },
          multiline: {
            max: 1
          }
        }
      ],
      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto'
        }
      ],
      'no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'vue/multi-word-component-names': 'off'
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
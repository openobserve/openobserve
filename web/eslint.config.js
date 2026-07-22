import vue from "eslint-plugin-vue";
import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import vueParser from "vue-eslint-parser";
import prettier from "eslint-plugin-prettier";
import vuePrettierSkipFormatting from "@vue/eslint-config-prettier/skip-formatting";
import cypress from "eslint-plugin-cypress";
import fs from "fs";

// Bans the legacy --o2-* CSS custom-property vocabulary anywhere in a .vue/.ts
// file's raw text — catches Tailwind arbitrary-value usages in templates
// (e.g. class="bg-[var(--o2-*)]"), <style> blocks, and JS string literals.
// This is the enforcing gate for the --o2- ban (stylelint can't allowlist values).
//
// ALLOWLIST: EMPTY on purpose. Every `--o2-*` custom property is a hard error —
// including the ones that still "work" at runtime (OTable tree indents, row-status,
// the dynamic `--o2-span-*` palette). The goal is to eliminate the --o2-* vocabulary
// entirely, so these must be renamed off the namespace (to a --color-* token, a
// Tailwind utility, or a non-o2 runtime custom property). Do NOT add exemptions here;
// fixing the underlying usage is the only way to make this rule pass.
const O2_ALLOWLIST = new Set([]);
const O2_ALLOW_PREFIXES = [];

// A `--o2-*` is a banned CSS custom property only when USED as one: inside var(),
// a Tailwind shorthand/arbitrary bracket, or as a declaration / `:style` key
// (immediately followed by `:`). The `--o2-` prefix also collides with the
// OpenObserve collector's CLI flags (e.g. the k8s installer's `--o2-<flag>=<value>`
// URL flag) and with prose/comments that name them — those are NOT CSS tokens and
// must not trip the ban. This is the same discrimination as scripts/check-css-tokens.mjs.
const isO2CssUsage = (text, index, name) => {
  const before = text.slice(Math.max(0, index - 8), index);
  const after = text.slice(index + name.length, index + name.length + 4);
  return (
    /var\(\s*$/.test(before) || // var(--o2-*
    /[A-Za-z0-9\]]-\(\s*$/.test(before) || // bg-(--o2-*  (Tailwind shorthand)
    /\[\s*$/.test(before) || // [--o2-*  (arbitrary property/value)
    /^\s*['"]?\s*:/.test(after) // --o2-*:  or  '--o2-*':  (decl / :style key)
  );
};

const noLegacyO2Tokens = {
  rules: {
    "no-legacy-o2-tokens": {
      meta: { type: "problem", docs: { description: "Ban legacy --o2-* CSS custom properties" } },
      create(context) {
        const allowed = (name) =>
          O2_ALLOWLIST.has(name) || O2_ALLOW_PREFIXES.some((re) => re.test(name));
        return {
          Program() {
            const sourceCode = context.sourceCode ?? context.getSourceCode();
            const text = sourceCode.getText();
            const re = /--o2-[A-Za-z0-9-]+/g;
            let match;
            while ((match = re.exec(text))) {
              if (allowed(match[0])) continue;
              if (!isO2CssUsage(text, match.index, match[0])) continue; // CLI flag / prose
              const start = match.index;
              const end = start + match[0].length;
              context.report({
                loc: {
                  start: sourceCode.getLocFromIndex(start),
                  end: sourceCode.getLocFromIndex(end),
                },
                message: `Legacy CSS token "${match[0]}" is banned. Use the modern --color-* token or a Tailwind utility.`,
              });
            }
          },
        };
      },
    },
  },
};

// Read .gitignore to use as ignore patterns
const gitignore = fs.existsSync(".gitignore")
  ? fs
      .readFileSync(".gitignore", "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .map((line) => line.trim())
  : [];

export default [
  // Global ignores — must be a standalone entry (no `files` key) so they apply
  // to every config object, including js.configs.recommended. Vendored/minified
  // assets and build output are not lintable source.
  {
    ignores: [
      "**/*.min.js",
      "packages/rrweb-player/**",
      "dist/**",
      "coverage/**",
      "node_modules/**",
      ".vscode/**",
    ],
  },
  js.configs.recommended,
  ...vue.configs["flat/essential"],
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,vue}"],
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      ".vscode/**",
      "*.min.js",
      "packages/rrweb-player/**",
      ...gitignore,
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: vueParser,
      parserOptions: {
        parser: typescriptParser,
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      vue,
      "@typescript-eslint": typescript,
      prettier,
      "local": noLegacyO2Tokens,
    },
    rules: {
      "local/no-legacy-o2-tokens": ["error"],

      // Dark-mode schema (O2_TOKEN_MIGRATION_PLAN §3.R.3) — warn now, error at Phase G.
      // The two sanctioned seams (useTheme.ts / chartTheme.ts) turn this off below.
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "BinaryExpression[operator=/^[!=]==?$/] > MemberExpression[property.name='theme']",
          message:
            "Dark mode has one JS seam: useTheme().isDark or chartColor(). Do not compare store.state.theme (§3.R).",
        },
        {
          selector: "VariableDeclarator[id.name=/^(isDark|isDarkMode|darkMode)$/]",
          message: "Import useTheme() instead of a private isDark flag (§3.R).",
        },
      ],
      // Every <style> block must be scoped (§3.H) — warn now, error at Phase F.
      "vue/enforce-style-attribute": ["warn", { allow: ["scoped", "module"] }],
      // Disable noisy rules inherited from recommended configs
      "prettier/prettier": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      //
      // Formatter / style — owned by the formatter + a separate team decision,
      // not this lint gate.
      "prettier/prettier": "off",
      "vue/max-attributes-per-line": "off",
      "vue/multi-word-component-names": "off",
      //
      // Zero current violations → locked straight to "error".
      "no-shadow-restricted-names": "error",
      "vue/valid-v-else-if": "error",
      "vue/no-deprecated-v-bind-sync": "error",
      "vue/no-v-text-v-html-on-component": "error",
      //
      // Enforced ("error") — the rollout drove each of these to 0 violations.
      // Three rules below stay "warn" (ratchet backlog); see their notes.
      //
      // Unused code (single source of truth; `_`-prefix opts out). Still "warn":
      // ~4 stragglers are imports used only in template `as` casts, which
      // eslint-plugin-vue cannot see (false positives) — TS keeps them honest.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      // Bucket 1 — real bugs.
      "no-unreachable": "error",
      "no-self-assign": "error",
      "no-redeclare": "error",
      "no-case-declarations": "error",
      "no-unsafe-optional-chaining": "error",
      "no-import-assign": "error",
      // Still "warn": 3 left are a prop + a same-named setup-return/computed;
      // deduping would break the component's public prop API.
      "vue/no-dupe-keys": "warn",
      "vue/no-ref-as-operand": "error",
      "vue/no-side-effects-in-computed-properties": "error",
      "vue/return-in-computed-property": "error",
      "vue/require-valid-default-prop": "error",
      "vue/require-v-for-key": "error",
      "vue/valid-v-for": "error",
      "vue/valid-attribute-name": "error",
      "vue/valid-next-tick": "error",
      "vue/no-parsing-error": "error",
      "vue/no-use-v-if-with-v-for": "error",
      "vue/no-reserved-component-names": "error",
      "vue/require-toggle-inside-transition": "error",
      "vue/prefer-import-from-vue": "error",
      // Bucket 2 — low-risk / mechanical.
      "no-prototype-builtins": "error",
      "no-useless-escape": "error",
      "no-empty": "error",
      "no-useless-catch": "error",
      "no-async-promise-executor": "error",
      // Bucket 4 — Vue correctness. Driven to 0 via the behavior-preserving
      // computed-alias pattern (see the eslint-error-handling skill); now enforced.
      "vue/no-mutating-props": "error",
      "vue/no-unused-components": "error",
      "vue/no-unused-vars": "error",

    },
  },
  {
    // The two sanctioned dark-mode seams (§3.R.1) — the only files allowed to
    // compare store.state.theme / declare an isDark flag.
    files: ["src/composables/useTheme.ts", "src/utils/chartTheme.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["cypress/e2e/**/*.{cy,spec}.{js,ts,jsx,tsx}"],
    plugins: {
      cypress,
    },
    rules: {
      ...cypress.configs.recommended.rules,
    },
  },
  // Must be last: disables core/TS/Vue stylistic rules that could conflict
  // with Prettier's formatting decisions. Formatting is owned by `format:check`,
  // not this lint gate — see "prettier/prettier": "off" above.
  vuePrettierSkipFormatting,
];

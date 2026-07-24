import vue from "eslint-plugin-vue";
import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import vueParser from "vue-eslint-parser";
import prettier from "eslint-plugin-prettier";
import cypress from "eslint-plugin-cypress";
import vueI18n from "@intlify/eslint-plugin-vue-i18n";
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

// User-facing text props. `vue/no-bare-strings-in-template` checks these as STATIC
// attributes (label="Save"); the custom rule below checks the SAME names as BOUND
// literals (:label="'Save'" / :label=`Save`). One list feeds both, so "what counts
// as translatable text passed to a component" is defined in exactly one place —
// add a prop name here when a component takes user-facing text through a new prop.
// The a11y/native entries reproduce the built-in rule's defaults (we replace, not
// extend, its attribute map). Component props are evidence-based (scan of web/src).
const TEXT_ATTRS = [
  "title", "aria-label", "aria-placeholder", "aria-roledescription", "aria-valuetext", "alt",
  "label", "sub-label", "sublabel", "placeholder", "hint", "tooltip", "message",
  "content", "help-text", "caption", "description", "subtitle", "header",
  "empty-label", "error-message", "button-label", "primary-button-label",
  "secondary-button-label", "confirm-text", "cancel-text",
  // Additional O2/app text props, discovered by scanning web/src for every
  // `:prop="t(...)"` — a prop a dev already wraps in t() is by definition
  // translatable text, so its STATIC / bound-literal form must be guarded too.
  // Re-run that scan when adding text-carrying props and keep this in sync.
  "sub-title", "footer-title", "dirty-title", "action-label", "ok-label", "firing-label",
  "neutral-button-label", "filter-label", "empty-message", "no-match-text",
  "search-placeholder", "ai-placeholder", "ai-tooltip", "disable-ai-reason",
  "full-time-prefix", "legend-healthy", "legend-avg",
];
const TEXT_ATTR_SET = new Set(TEXT_ATTRS);

// Non-translatable literal tokens — code/syntax/units that must stay identical in
// every language (a CSS unit, a fixed filename, a documented template-variable token).
// Fed to BOTH i18n rules so they pass WITHOUT a scattered inline eslint-disable
// comment. Keep this curated and reasoned — NEVER add real UI text here.
const NON_TRANSLATABLE = [
  // Units / symbols — language-agnostic, appended to numbers or used as bare glyphs.
  // (The rule strips these, so a token only passes when it is the WHOLE text — e.g.
  // "settings" is NOT allowed by "s", only a bare "s" node is.)
  "px", "s", "ms", "×", "→", "$", "fx",
  // Decorative glyphs / emoji — visual only, no language content.
  "●", "🕑", "$_",
  // Specific literal tokens shown to the user as documentation / code.
  "1000",         // hardcoded record-limit value
  "./.env",       // relative config-file path shown in setup steps
  "trace.zip",    // fixed download-artifact filename
  "{rows}",       // literal template-variable token shown as documentation
  "{field_name}", // literal template-variable placeholder token shown as documentation
  "{{ input }}",  // documented template syntax rendered inside a <code> block
];
const NON_TRANSLATABLE_SET = new Set(NON_TRANSLATABLE);

// The built-in rule's DEFAULT allowlist (punctuation it always ignores). Supplying an
// `allowlist` REPLACES this default, so we spread it back in alongside NON_TRANSLATABLE.
const BARE_STRING_DEFAULT_ALLOWLIST = [
  "(", ")", ",", ".", "&", "+", "-", "=", "*", "/", "#", "%", "!", "?", ":", "[", "]",
  "{", "}", "<", ">", "·", "•", "‐", "–", "—", "−", "|",
];

// Bans hardcoded text left directly in a <template> that the built-in
// `vue/no-bare-strings-in-template` (STATIC attrs + text nodes only) can't see:
//   • a BOUND text prop        — :label="'Save'" / :label=`Go`
//   • a v-text / v-html literal — v-text="'Save'"
//   • a text interpolation      — {{ 'Save' }}
// so a dev can't dodge the check by adding a `:`, a v-text, or mustaches. t()-bound
// and variable-bound values are expressions (not bare literals) so they correctly
// pass; a literal with no letters (punctuation like '—') is skipped. Only BARE
// literals are caught — composed expressions (:label="'a'+b", ternaries, `${x} y`)
// remain a separate, not-yet-enforced gap. Non-<template> files are a no-op.
noLegacyO2Tokens.rules["no-bare-bound-text-props"] = {
  meta: { type: "problem", docs: { description: "Ban hardcoded text in bound text props, v-text/v-html, and {{ }} literals" } },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const ps = sourceCode.parserServices ?? context.parserServices;
    if (!ps || !ps.defineTemplateBodyVisitor) return {};
    // A bare string literal (or zero-expression template literal) that contains a
    // letter → return the text; otherwise null (expressions, variables, and
    // punctuation-only literals all pass).
    const bareText = (expr) => {
      if (!expr) return null;
      let text = null;
      if (expr.type === "Literal" && typeof expr.value === "string") text = expr.value;
      else if (expr.type === "TemplateLiteral" && expr.expressions.length === 0)
        text = expr.quasis[0].value.cooked;
      if (text == null || NON_TRANSLATABLE_SET.has(text.trim())) return null;
      return /\p{L}/u.test(text) ? text : null;
    };
    return ps.defineTemplateBodyVisitor({
      VAttribute(node) {
        if (!node.directive) return; // static attrs → handled by no-bare-strings
        const dir = node.key && node.key.name && node.key.name.name;
        const text = bareText(node.value && node.value.expression);
        if (text == null) return;
        if (dir === "bind") {
          const arg = node.key.argument; // only :prop / v-bind:prop in the text-attr set
          if (!arg || arg.type !== "VIdentifier" || !TEXT_ATTR_SET.has(arg.name)) return;
          context.report({
            node,
            message: `Hardcoded text "${text}" in bound prop :${arg.name} — use t('...') with a key in en-US.json.`,
          });
        } else if (dir === "text" || dir === "html") {
          context.report({
            node,
            message: `Hardcoded text "${text}" in v-${dir} — use t('...') with a key in en-US.json.`,
          });
        }
      },
      VExpressionContainer(node) {
        // Only text-position interpolation {{ '...' }}. A directive value's container
        // has a VAttribute parent and is handled above; here the parent is the element.
        const p = node.parent;
        if (!p || (p.type !== "VElement" && p.type !== "VDocumentFragment")) return;
        const text = bareText(node.expression);
        if (text == null) return;
        context.report({
          node,
          message: `Hardcoded text "${text}" in {{ }} — use t('...') with a key in en-US.json.`,
        });
      },
    });
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
      "@intlify/vue-i18n": vueI18n,
    },
    // i18n key resolution points at the English source of truth ONLY. The other
    // locales are generated from en-US.json (scripts/translations) and lag behind,
    // so validating against them would flag every not-yet-translated key.
    settings: {
      "vue-i18n": {
        localeDir: "./src/locales/languages/en-US.json",
        messageSyntaxVersion: "^11.0.0",
      },
    },
    rules: {
      "local/no-legacy-o2-tokens": ["error"],

      // i18n hygiene. `no-missing-keys` (ERROR): every static t('x.y') must exist
      // in en-US.json, else vue-i18n renders the raw key at runtime. Backlog is
      // small (~27 real bugs), so it gates the build outright. A dynamically-built
      // key is ignored by the rule; test fixtures are exempted below.
      "@intlify/vue-i18n/no-missing-keys": "error",
      //
      // `no-bare-strings-in-template` (ERROR): no user-facing string typed straight
      // into a <template> — text nodes AND static text props (label="Save"). We
      // REPLACE the built-in attribute map with TEXT_ATTRS so component props, not
      // just native title/alt/placeholder, are covered. Bound props (:label="'x'")
      // are caught by the local rule below. (@intlify's own `no-raw-text` is NOT
      // used — it flags ~1800 literals/punctuation and is too noisy to gate.)
      "vue/no-bare-strings-in-template": ["error", { attributes: { "/.+/": TEXT_ATTRS }, allowlist: [...BARE_STRING_DEFAULT_ALLOWLIST, ...NON_TRANSLATABLE] }],
      // The bound-prop half of the same rule (see TEXT_ATTRS above).
      "local/no-bare-bound-text-props": "error",

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
    // Query-syntax cheat-sheets — the "text" here is SQL / PromQL / operator
    // examples and code snippets, not translatable prose. Exempt only these from
    // the bare-string rule; add a file here only when it is genuinely code, with
    // a one-line reason.
    files: [
      "src/plugins/logs/SyntaxGuide.vue",
      "src/plugins/traces/SyntaxGuide.vue",
      "src/plugins/metrics/SyntaxGuideMetrics.vue",
    ],
    rules: {
      "vue/no-bare-strings-in-template": "off",
      "local/no-bare-bound-text-props": "off",
    },
  },
  {
    // Tests use throwaway i18n keys as fixtures — don't hold them to the
    // en-US.json contract.
    files: ["**/*.{spec,test}.{js,ts,jsx,tsx}", "**/__tests__/**", "**/test/**"],
    rules: {
      "@intlify/vue-i18n/no-missing-keys": "off",
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
];

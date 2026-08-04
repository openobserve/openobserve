import vue from "eslint-plugin-vue";
import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import vueParser from "vue-eslint-parser";
import prettier from "eslint-plugin-prettier";
import vuePrettierSkipFormatting from "@vue/eslint-config-prettier/skip-formatting";
import cypress from "eslint-plugin-cypress";
import fs from "fs";
import css from "@eslint/css";
// The parser behind @eslint/css. Used directly on .vue <style> blocks, which no ESLint
// parser hands to a rule as an AST — `parse` takes an `offset`, so the positions it returns
// are already absolute to the .vue file. Every style block in this repo is plain CSS (no
// `lang="scss"`), so the .css branch and the <style> branch run the same parser.
import { parse as parseCss, walk as walkCss } from "@eslint/css-tree";
// `px(?![a-zA-Z0-9])`, not `px\b`: `_` is a word char and Tailwind uses `_` for the
// space inside arbitrary values, so `\b` would skip the first value of `p-[8px_12px]`.
const PX_LITERAL = /(?<![a-zA-Z0-9.])(\d+(?:\.\d+)?)px(?![a-zA-Z0-9])/g;

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

// ── no-hardcoded-px ────────────────────────────────────────────────────────
// Sizing is authored in rem (WCAG 1.4.4); 1rem = 16px. No exemption list — a sanctioned
// px carries `eslint-disable-next-line local/no-hardcoded-px -- <reason>` at the site, so
// ESLint reports it once it stops being needed. Placement rules: SKILL.md §3.
//
// px is read from AST nodes on every surface — nothing is scanned as raw text, and no
// comment is masked by regex. Comments therefore cannot report (no parser hands one to
// this rule) and, the reason it matters, a string containing `/*` can no longer blank the
// real code around it, which whole-file comment masking used to do. Surfaces covered:
//
//   .ts/.js/<script>  string and template literals
//   <template>        attribute values (VLiteral), text (VText), and literals inside a
//                     binding expression — so class="w-[320px]", style="margin: 8px",
//                     :style="{ top: '4px' }" and :class="['h-[10px]']" all report
//   .css              Dimension (parsed values), Raw (custom-property values and
//                     Tailwind v4 at-rule preludes), Selector (escaped utility classes)
//   .vue <style>      Dimension / Raw / Selector, same parser as .css above
//
// Checked against the previous whole-file scanner over all of src/: identical report set
// (686 sites, 0 added, 0 lost).
const noHardcodedPx = {
  rules: {
    "no-hardcoded-px": {
      meta: {
        type: "problem",
        docs: { description: "Size in rem, not px" },
      },
      create(context) {
        const filename = (context.filename ?? context.getFilename() ?? "").replace(/\\/g, "/");
        // Spec files legitimately assert on literal px strings.
        if (/\.spec\.|\.test\.|\/tests?\//.test(filename)) return {};
        const sourceCode = context.sourceCode ?? context.getSourceCode();

        // Node ranges can overlap (a TemplateElement reports under its whole literal),
        // so a site is reported at most once.
        const reported = new Set();
        const reportAt = (start, raw) => {
          if (reported.has(start)) return;
          reported.add(start);
          const px = parseFloat(raw);
          const asRem = parseFloat((px / 16).toFixed(6));
          const scale = px / 4;
          const hint = Number.isInteger(scale * 2) ? ` (or the Tailwind scale step ${scale})` : "";
          context.report({
            loc: {
              start: sourceCode.getLocFromIndex(start),
              end: sourceCode.getLocFromIndex(start + raw.length),
            },
            message: `Hardcoded ${raw}. Size in rem: use ${asRem}rem${hint}. If px is genuinely required (hairline, shadow/ring width, query condition, IntersectionObserver rootMargin, user-facing copy, SVG dimension attribute, canvas/ECharts/email consumer), add \`// eslint-disable-next-line local/no-hardcoded-px -- <why px is correct here>\` at the site.`,
          });
        };

        // @eslint/css nodes carry offsets on `loc`, ESLint/Vue nodes carry `range`.
        const rangeOf = (node) => node.range ?? [node.loc.start.offset, node.loc.end.offset];
        const scanRange = (start, end, { suppress } = {}) => {
          const chunk = sourceCode.getText().slice(start, end);
          let match;
          PX_LITERAL.lastIndex = 0;
          while ((match = PX_LITERAL.exec(chunk))) {
            const at = start + match.index;
            if (suppress?.(at)) continue;
            reportAt(at, match[0]);
          }
        };
        const scanNode = (node) => {
          const [start, end] = rangeOf(node);
          scanRange(start, end);
        };

        // ── .css ───────────────────────────────────────────────────────────
        // Three node kinds can carry a length; Comment is never one of them, which is
        // what makes comment exclusion free here.
        if (filename.endsWith(".css")) {
          return {
            Dimension(node) {
              if (node.unit !== "px") return;
              reportAt(rangeOf(node)[0], `${node.value}px`);
            },
            // css-tree leaves custom-property values unparsed (`--radius-full: 9999px`),
            // as well as Tailwind v4 at-rule preludes.
            Raw: scanNode,
            // px inside an escaped utility class: `.h-\[calc\(100vh-105px\)\]`.
            Selector: scanNode,
          };
        }

        // ── .vue <style> ───────────────────────────────────────────────────
        // vue-eslint-parser parses <template> and <script> only, so this rule parses the
        // style block itself with css-tree. Every block is plain CSS — the SCSS ones were
        // converted — so one parser covers the whole codebase. px comes from the same three
        // node kinds as the .css branch; Comment is never one of them, so comments are
        // excluded structurally rather than masked.
        //
        // ESLint core cannot see a style block's comments either, so it never registers a
        // disable directive there. That is why a sanctioned px in CSS historically needed a
        // blanket `eslint-disable` placed *outside* the block — which then silently ran to
        // end of file. This rule therefore honours the scoped directives itself:
        //
        //   /* eslint-disable-next-line local/no-hardcoded-px -- <why px is correct here> */
        //   /* eslint-disable-line local/no-hardcoded-px -- <why px is correct here> */
        //
        // A directive that suppresses nothing, or that omits its `-- reason`, is reported —
        // the same self-cleaning contract the rest of the codebase gets from ESLint core.
        const STYLE_DIRECTIVE =
          /\/\*\s*eslint-disable-(next-line|line)\s+local\/no-hardcoded-px([\s\S]*?)\*\//g;
        const styleDirectives = [];
        const collectDirectives = (start, end) => {
          const chunk = sourceCode.getText().slice(start, end);
          let match;
          STYLE_DIRECTIVE.lastIndex = 0;
          while ((match = STYLE_DIRECTIVE.exec(chunk))) {
            const at = start + match.index;
            styleDirectives.push({
              at,
              end: at + match[0].length,
              line: sourceCode.getLocFromIndex(at).line,
              kind: match[1],
              hasReason: /--\s*\S/.test(match[2]),
              used: false,
            });
          }
        };
        const suppress = (at) => {
          const line = sourceCode.getLocFromIndex(at).line;
          const d = styleDirectives.find((x) =>
            x.kind === "next-line" ? x.line + 1 === line : x.line === line,
          );
          if (!d) return false;
          d.used = true;
          return true;
        };

        const scanStyleBlocks = () => {
          const text = sourceCode.getText();
          const re = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
          let match;
          while ((match = re.exec(text))) {
            const start = match.index + match[0].indexOf(">") + 1;
            const body = match[2];
            collectDirectives(start, start + body.length);

            let ast;
            try {
              ast = parseCss(body, {
                positions: true,
                offset: start, // makes every reported position absolute to the .vue file
                parseCustomProperty: false, // keeps `--x: 4px` a Raw node, as the .css branch expects
                onParseError: () => {}, // tolerate Tailwind v4 / unknown syntax, as @eslint/css does
              });
            } catch {
              // A block nothing can parse would otherwise be silently unchecked. Say so
              // rather than skip — px must never pass because a parser gave up.
              context.report({
                loc: sourceCode.getLocFromIndex(start),
                message: `This <style> block could not be parsed, so it is NOT checked for hardcoded px. Fix the CSS syntax.`,
              });
              continue;
            }
            walkCss(ast, (node) => {
              if (node.type === "Dimension") {
                if (node.unit !== "px") return;
                const at = node.loc.start.offset;
                if (suppress(at)) return;
                reportAt(at, `${node.value}px`);
              } else if (node.type === "Raw" || node.type === "Selector") {
                scanRange(node.loc.start.offset, node.loc.end.offset, { suppress });
              }
            });
          }

          for (const d of styleDirectives) {
            if (!d.used) {
              context.report({
                loc: {
                  start: sourceCode.getLocFromIndex(d.at),
                  end: sourceCode.getLocFromIndex(d.end),
                },
                message: `Unused eslint-disable directive (no px was reported on the ${
                  d.kind === "next-line" ? "next line" : "line"
                }).`,
              });
            } else if (!d.hasReason) {
              context.report({
                loc: {
                  start: sourceCode.getLocFromIndex(d.at),
                  end: sourceCode.getLocFromIndex(d.end),
                },
                message: `This disable must carry its justification: \`-- <why px is correct here>\`.`,
              });
            }
          }
        };

        const scriptVisitor = { Literal: scanNode, TemplateElement: scanNode };
        const services = sourceCode.parserServices ?? context.parserServices;

        if (filename.endsWith(".vue") && services?.defineTemplateBodyVisitor) {
          return services.defineTemplateBodyVisitor(
            { VLiteral: scanNode, VText: scanNode, Literal: scanNode, TemplateElement: scanNode },
            { ...scriptVisitor, Program: scanStyleBlocks },
          );
        }
        return scriptVisitor;
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
  // Scoped: without `files` these apply to .css too, where JS/Vue rules crash on a
  // CSS SourceCode.
  { ...js.configs.recommended, files: ["**/*.{js,mjs,cjs,ts,tsx,vue}"] },
  ...vue.configs["flat/essential"].map((c) => ({ ...c, files: ["**/*.vue"] })),
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
      local: { rules: { ...noLegacyO2Tokens.rules, ...noHardcodedPx.rules } },
    },
    rules: {
      "local/no-legacy-o2-tokens": ["error"],
      "local/no-hardcoded-px": ["error"],

      // Catches components used in <template> but never imported/registered
      // (e.g. <date-time> instead of <DateTime>) — this class of bug is
      // invisible to vue-tsc (unresolved tags aren't a template type error
      // without vueCompilerOptions.strictTemplates) and wasn't caught before.
      // Ignore patterns cover framework-global components (vue-router,
      // vue-i18n, and Vue's own built-ins) that have no local import.
      "vue/no-undef-components": [
        "error",
        {
          ignorePatterns: [
            "router-view",
            "router-link",
            "i18n-t",
            "i18n-d",
            "i18n-n",
            "transition",
            "transition-group",
            "keep-alive",
            "component",
            "slot",
            "teleport",
          ],
        },
      ],

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
      // Always use PascalCase for component tags in templates (auto-fixable).
      "vue/component-name-in-template-casing": [
        "error",
        "PascalCase",
        { registeredComponentsOnly: true, ignores: [] },
      ],
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
  // ── Stylesheets ──────────────────────────────────────────────────────────
  // Only no-hardcoded-px runs here; colour/token rules for stylesheets stay with
  // stylelint (lint:styles).
  {
    files: ["**/*.css"],
    language: "css/css",
    // Tailwind v4 syntax (`--color-*: initial`, @custom-variant, @plugin, @source)
    // is not standard CSS; tolerant mode skips it instead of erroring.
    languageOptions: { tolerant: true },
    plugins: { css, local: { rules: { ...noHardcodedPx.rules } } },
    rules: { "local/no-hardcoded-px": ["error"] },
  },
  // Must be last: disables core/TS/Vue stylistic rules that could conflict
  // with Prettier's formatting decisions. Formatting is owned by `format:check`,
  // not this lint gate — see "prettier/prettier": "off" above.
  vuePrettierSkipFormatting,
];

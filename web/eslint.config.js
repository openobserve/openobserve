import vue from "eslint-plugin-vue";
import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import vueParser from "vue-eslint-parser";
import prettier from "eslint-plugin-prettier";
import vuePrettierSkipFormatting from "@vue/eslint-config-prettier/skip-formatting";
import cypress from "eslint-plugin-cypress";
import vueI18n from "@intlify/eslint-plugin-vue-i18n";
// Deep import: the plugin does not re-export its utils. It declares no `exports`
// map so this resolves, and a path change in a future 4.x fails loudly at load.
import {
  getLocaleMessages,
  isStaticLiteral,
  getStaticLiteralValue,
  skipTSAsExpression,
} from "@intlify/eslint-plugin-vue-i18n/dist/utils/index.js";
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
// Sizing is authored in rem (WCAG 1.4.4); 1rem = 16px. No exemption list: a sanctioned px
// carries `eslint-disable-next-line local/no-hardcoded-px -- <reason>` at the site (SKILL.md §3).
// px is read from AST nodes, never raw text — so comments are excluded structurally, and a
// string containing `/*` cannot blank out the code around it the way comment-masking did.
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

        // Node ranges overlap (a TemplateElement sits inside its own literal), so dedupe.
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
        if (filename.endsWith(".css")) {
          return {
            Dimension(node) {
              if (node.unit !== "px") return;
              reportAt(rangeOf(node)[0], `${node.value}px`);
            },
            // css-tree leaves custom-property values unparsed (`--radius-full: 9999px`).
            Raw: scanNode,
            // px inside an escaped utility class: `.h-\[calc\(100vh-105px\)\]`.
            Selector: scanNode,
          };
        }

        // ── .vue <style> ───────────────────────────────────────────────────
        // No ESLint parser hands a style block to a rule — parse it here, same node kinds as
        // .css. Core cannot see its comments either, so it registers no disable directive;
        // this rule honours `/* eslint-disable-next-line|line … -- <reason> */` itself and
        // reports one that suppresses nothing or omits its reason.
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
              // Never skip silently — px must not pass because a parser gave up.
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

// Directional spacing and borders must follow the document's inline direction.
const PHYSICAL_DIRECTION_UTILITY =
  /(?<![A-Za-z0-9_-])(?:-?(?:ml|mr|pl|pr)-(?:\d+(?:\.\d+)?(?:\/\d+)?|auto|px|full|page-edge|sm|md|\[[^\]\r\n]+\])?!?|border-[lr](?:-(?:\[[^\]\r\n]+\]|[a-z0-9][A-Za-z0-9_./%!-]*))?!?)(?![A-Za-z0-9_-])/g;
const noPhysicalDirectionUtilities = {
  rules: {
    "no-physical-direction-utilities": {
      meta: {
        type: "problem",
        docs: { description: "Use logical Tailwind direction utilities" },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const reported = new Set();
        const replacementFor = (utility) =>
          utility
            .replace(/^(-?)ml-/, "$1ms-")
            .replace(/^(-?)mr-/, "$1me-")
            .replace(/^(-?)pl-/, "$1ps-")
            .replace(/^(-?)pr-/, "$1pe-")
            .replace(/^border-l/, "border-s")
            .replace(/^border-r/, "border-e");
        const scanNode = (node) => {
          const [start, end] = node.range;
          const chunk = sourceCode.getText().slice(start, end);
          let match;
          PHYSICAL_DIRECTION_UTILITY.lastIndex = 0;
          while ((match = PHYSICAL_DIRECTION_UTILITY.exec(chunk))) {
            const at = start + match.index;
            if (reported.has(at)) continue;
            reported.add(at);
            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(at),
                end: sourceCode.getLocFromIndex(at + match[0].length),
              },
              message: `Physical direction utility "${match[0]}" is not RTL-safe. Use "${replacementFor(match[0])}".`,
            });
          }
        };
        const scriptVisitor = { Literal: scanNode, TemplateElement: scanNode };
        const services = sourceCode.parserServices ?? context.parserServices;

        if (services?.defineTemplateBodyVisitor) {
          return services.defineTemplateBodyVisitor(
            { VLiteral: scanNode, Literal: scanNode, TemplateElement: scanNode },
            scriptVisitor,
          );
        }
        return scriptVisitor;
      },
    },
  },
};

// ── no-hardcoded-color ─────────────────────────────────────────────────────
// Colour is a design token: a component reaches it through a --color-* utility class,
// never as a literal, or it cannot follow the theme. <style> blocks are gated by
// stylelint (`color-no-hex`) and .ts by scripts/check-design-consistency.mjs, but the
// `<script>` block of a .vue file was gated by NOTHING — this rule closes that hole.
// Colour is read from AST nodes, never raw text, so a hex named in a comment or in
// prose ("e.g. #FF0000") is excluded structurally rather than by comment-stripping.
//
// `#rgb` / `#rrggbb` / `#rrggbbaa` only — the trailing guard keeps a 7-digit id like
// "#abcdef0" from being read as a 6-digit colour, and the leading guard keeps `##anchor`
// and an HTML entity (`&#fff`) out. The `i` flag is required: CSS function names are
// case-insensitive, so RGBA()/OKLCH() are just as real as the lowercase spellings.
const COLOR_LITERAL =
  /(?<![\w#&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\s*\(/gi;

// Pre-existing violations, measured when this rule was introduced: 260 colour literals
// (201 hex, 59 functional) in the <script> blocks of these 51 .vue files. Every entry is a file that hardcodes
// colour today and is PENDING MIGRATION to design tokens — it is a debt record, NOT a
// sanctioned home. The list must only ever SHRINK: deleting a line when a file is
// migrated is the only edit ever made to it. New entries are NOT accepted — a new colour
// literal is either fixed at the site or, where a literal is genuinely required,
// annotated there with `eslint-disable-next-line local/no-hardcoded-color -- <reason>`.
const COLOR_ALLOWLIST = [
  "web/src/components/CodeQueryEditor.vue",
  "web/src/components/EnterpriseUpgradeDialog.vue",
  "web/src/components/O2AIChat.vue",
  "web/src/components/alerts/FilterGroup.vue",
  "web/src/components/alerts/IncidentDetailDrawer.vue",
  "web/src/components/alerts/IncidentServiceGraph.vue",
  "web/src/components/alerts/PreviewAlert.vue",
  "web/src/components/dashboards/ColorSwatchPicker.vue",
  "web/src/components/dashboards/DashboardLogDrawer.vue",
  "web/src/components/dashboards/PanelSchemaRenderer.vue",
  "web/src/components/dashboards/addPanel/BackGroundColorConfig.vue",
  "web/src/components/dashboards/addPanel/ColorBySeriesPopUp.vue",
  "web/src/components/dashboards/addPanel/ColorPaletteDropDown.vue",
  "web/src/components/dashboards/panels/TableRenderer.vue",
  "web/src/components/ingestion/setupCard/SetupCardRenderer.vue",
  "web/src/components/rum/errorTracking/list/ErrorsOverTimeChart.vue",
  "web/src/components/rum/errorTracking/view/ErrorOccurrencesChart.vue",
  "web/src/components/settings/General.vue",
  "web/src/components/settings/License.vue",
  "web/src/components/settings/ModelPricingEditor.vue",
  "web/src/components/settings/ServiceIdentitySetup.vue",
  "web/src/components/slos/SloBurndownChart.vue",
  "web/src/components/slos/SloPreviewChart.vue",
  "web/src/components/slos/SloTimeSlicePreview.vue",
  "web/src/components/traces/FlameGraphView.vue",
  "web/src/enterprise/components/billings/usage.vue",
  "web/src/lib/forms/Color/OColor.vue",
  "web/src/lib/overlay/Tooltip/OTooltip.vue",
  "web/src/plugins/logs/BuildQueryPage.vue",
  "web/src/plugins/logs/SearchResult.vue",
  "web/src/plugins/pipelines/CustomNode.vue",
  "web/src/plugins/traces/KpiSparkline.vue",
  "web/src/plugins/traces/LLMContentRenderer.vue",
  "web/src/plugins/traces/LLMInsightsDashboard.vue",
  "web/src/plugins/traces/ServiceGraph.vue",
  "web/src/plugins/traces/SessionRibbon.vue",
  "web/src/plugins/traces/SpanBlock.vue",
  "web/src/plugins/traces/TraceDAG.vue",
  "web/src/plugins/traces/TraceDetails.vue",
  "web/src/plugins/traces/TraceDetailsSidebar.vue",
  "web/src/plugins/traces/TraceTree.vue",
  "web/src/plugins/traces/components/TraceLatencyCell.vue",
  "web/src/plugins/traces/components/TraceServiceCell.vue",
  "web/src/plugins/workflows/WorkflowNode.vue",
  "web/src/views/UsageTab.vue",
  "web/src/views/synthetics/MonitorRuns.vue",
];

const noHardcodedColor = {
  rules: {
    "no-hardcoded-color": {
      meta: {
        type: "problem",
        docs: { description: "Colour comes from a design token, not a literal" },
      },
      create(context) {
        const filename = (context.filename ?? context.getFilename() ?? "").replace(/\\/g, "/");
        // Spec files legitimately assert on literal colour strings.
        if (/\.spec\.|\.test\.|\/tests?\//.test(filename)) return {};
        // .vue <script> only — this is the gap nothing else covers. Hex in .ts/.js is
        // already frozen by check-design-consistency.mjs `tsHex` + TS_HEX_ALLOWLIST;
        // duplicating that debt here would give the same literal two owners.
        if (!filename.endsWith(".vue")) return {};
        const matches = (p) => (p.endsWith("/") ? filename.includes(p) : filename.endsWith(p));
        if (COLOR_ALLOWLIST.some(matches)) return {};
        const sourceCode = context.sourceCode ?? context.getSourceCode();

        // Node ranges overlap (a TemplateElement sits inside its own literal), so dedupe.
        const reported = new Set();
        const reportAt = (start, raw) => {
          if (reported.has(start)) return;
          reported.add(start);
          const shown = raw.endsWith("(") ? `${raw.replace(/\s*\($/, "")}()` : raw;
          context.report({
            loc: {
              start: sourceCode.getLocFromIndex(start),
              end: sourceCode.getLocFromIndex(start + raw.length),
            },
            message: `Hardcoded colour ${shown}. Colour comes from a design token: use the --color-* token through its utility class (bg-*/text-*/border-*), or read the token instead of restating its value. If a literal is genuinely required (ECharts/canvas option object, Monaco theme, SVG/email consumer, a token definition), add \`// eslint-disable-next-line local/no-hardcoded-color -- <why a literal is correct here>\` at the site.`,
          });
        };

        const scanNode = (node) => {
          const [start, end] = node.range;
          const chunk = sourceCode.getText().slice(start, end);
          let match;
          COLOR_LITERAL.lastIndex = 0;
          while ((match = COLOR_LITERAL.exec(chunk))) {
            reportAt(start + match.index, match[0]);
          }
        };

        const scriptVisitor = { Literal: scanNode, TemplateElement: scanNode };
        const services = sourceCode.parserServices ?? context.parserServices;

        // .vue: `<script>`/`<script setup>` only. The template's own colour literals
        // (hexClass, inlineHexStyle, inlineHexBind) are already counted by
        // scripts/check-design-consistency.mjs, so the template visitor is empty.
        if (filename.endsWith(".vue") && services?.defineTemplateBodyVisitor) {
          return services.defineTemplateBodyVisitor({}, scriptVisitor);
        }
        return scriptVisitor;
      },
    },
  },
};

// A control's height comes from its `size` prop (the --spacing-control-* tokens), so a
// height class on an O* control or button splits one size name into many (guideline S1, S2).
const CONTROL_HEIGHT_TAGS = new Set(
  [
    "OButton",
    "OButtonGroup",
    "ORefreshButton",
    "OCopyButton",
    "OInput",
    "OFormInput",
    "OSelect",
    "OFormSelect",
    "OSearchInput",
    "OToggleGroup",
    "ODate",
    "OTime",
    "OFormDateTimeRange",
    "OCombobox",
    "OFormCombobox",
    "OToggleGroupItem",
    "OFormToggleGroup",
    "OFormDate",
    "OFormTime",
    "OCheckbox",
    "OFormCheckbox",
    "ORadio",
    "OSwitch",
    "OFormSwitch",
    "OColor",
    "OFormColor",
    "OTemplateInput",
    "OFormTemplateInput",
    "OInlineEdit",
    "OFormInlineEdit",
    "OChipInput",
    "OTagInput",
    "OFormTagInput",
    "OTabs",
    "OTab",
    "ORouteTab",
  ].map((tag) => tag.toLowerCase()),
);
const CONTROL_HEIGHT_CLASS_ATTRS = new Set(["class", "classname"]);
const CONTROL_HEIGHT_UTILITY = /^-?(h|min-h|size)-(.+)$/;
// Relative keywords follow the parent rather than pick a height of their own.
const CONTROL_HEIGHT_RELATIVE = /^(full|auto|fit|min|max|screen|svh|lvh|dvh|lh)$/;
const isControlHeightTag = (rawName) => {
  const tag = typeof rawName === "string" ? rawName.replace(/-/g, "").toLowerCase() : "";
  return CONTROL_HEIGHT_TAGS.has(tag) || tag.startsWith("odatetime");
};
// Splits "max-md:[&_.x]:!h-8" into its variant chain and utility, ignoring ":" inside brackets.
const splitVariants = (token) => {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === "[") depth++;
    else if (token[i] === "]") depth--;
    else if (token[i] === ":" && depth === 0) cut = i;
  }
  return { variants: token.slice(0, cut + 1), utility: token.slice(cut + 1) };
};
const controlHeightOverride = (token) => {
  const { variants, utility } = splitVariants(token);
  const match = CONTROL_HEIGHT_UTILITY.exec(utility.replace(/^!|!$/g, ""));
  if (!match || (match[1] === "min-h" && match[2] === "0")) return false;
  const reachesInside = variants.includes("[&");
  if (reachesInside && match[1] !== "size") return true;
  return !CONTROL_HEIGHT_RELATIVE.test(match[2]);
};
const o2ControlHeight = {
  rules: {
    "o2-control-height": {
      meta: {
        type: "problem",
        docs: { description: "No height overrides on O* form controls and buttons" },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const services = sourceCode.parserServices ?? context.parserServices;
        if (!services?.defineTemplateBodyVisitor) return {};
        const reportTokens = (node, text, tag) => {
          for (const token of text.split(/\s+/)) {
            if (!token || !controlHeightOverride(token)) continue;
            context.report({
              node,
              message: `"${token}" overrides the height of <${tag}>. Heights come from the size prop (24/28/32/36 control tokens); pick the size that matches the row instead (ui-architect guidelines S1, S2).`,
            });
          }
        };
        const collectStrings = (expr, out) => {
          if (!expr || typeof expr !== "object") return out;
          if (expr.type === "Literal" && typeof expr.value === "string") out.push(expr.value);
          else if (expr.type === "TemplateElement") out.push(expr.value.cooked ?? "");
          for (const key of Object.keys(expr)) {
            if (key === "parent" || key === "loc" || key === "range") continue;
            const child = expr[key];
            if (Array.isArray(child)) child.forEach((c) => collectStrings(c, out));
            else if (child && typeof child.type === "string") collectStrings(child, out);
          }
          return out;
        };
        return services.defineTemplateBodyVisitor({
          VAttribute(node) {
            const tag = node.parent?.parent?.rawName;
            if (!isControlHeightTag(tag)) return;
            if (!node.directive) {
              const name = node.key?.name?.toLowerCase?.();
              if (CONTROL_HEIGHT_CLASS_ATTRS.has(name) && node.value) {
                reportTokens(node, node.value.value ?? "", tag);
              }
              return;
            }
            const arg = node.key?.argument?.name;
            if (node.key?.name?.name !== "bind" || typeof arg !== "string") return;
            if (!CONTROL_HEIGHT_CLASS_ATTRS.has(arg.replace(/-/g, "").toLowerCase())) return;
            for (const text of collectStrings(node.value?.expression, [])) {
              reportTokens(node, text, tag);
            }
          },
        });
      },
    },
  },
};

// OButton and its family accept only the v2 API: seven variants by job, four control heights,
// and the renamed props (guidelines B2, S1). Values come from OButton.types.ts.
const BUTTON_API = {
  OButton: {
    values: {
      variant: ["primary", "secondary", "ghost", "accent-ghost", "danger", "danger-ghost", "link"],
      size: ["xs", "sm", "md", "lg"],
      as: ["button", "div"],
    },
    removed: {
      disable: "disabled",
      "icon-left": "icon",
      "icon-right": "icon-end",
      active: "pressed",
      "focusable-unavailable": "disabled-reason",
      "description-id": "disabled-reason",
      spinner: null,
      round: null,
      ripple: null,
      tooltip: "disabled-reason, or a child OTooltip",
    },
    slots: {
      "icon-left": "#icon",
      "icon-right": "#icon-end",
      "unavailable-reason": "disabled-reason",
    },
  },
  OButtonGroup: {
    values: { size: ["xs", "sm", "md", "lg"] },
    removed: { radius: null, divided: null, orientation: null, align: null },
  },
  OSplitButton: {
    values: { variant: ["primary", "secondary"], size: ["sm", "md"] },
  },
  ORefreshButton: {
    values: { size: ["sm", "md"] },
    removed: {
      layout: null,
      variant: null,
      "age-format": null,
      spinner: null,
      "data-from": null,
      "shortcut-id": "shortcut",
    },
  },
  OCopyButton: {
    values: { variant: ["ghost", "secondary"], size: ["xs", "sm", "md"] },
  },
};
const BUTTON_VARIANT_ATTR = /^(primary|secondary|neutral)-button-variant$|^(ok|confirm)-variant$/;
const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const pascalTag = (rawName) =>
  typeof rawName === "string" && rawName.includes("-")
    ? rawName.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())
    : rawName;
const stringLiterals = (expr, out = []) => {
  if (!expr || typeof expr !== "object") return out;
  if (expr.type === "Literal" && typeof expr.value === "string") out.push(expr.value);
  // Keys of a lookup object name the cases, not the values that reach the prop.
  if (expr.type === "Property") return stringLiterals(expr.value, out);
  if (expr.type === "MemberExpression") return stringLiterals(expr.object, out);
  if (expr.type === "BinaryExpression" || expr.type === "CallExpression") return out;
  if (expr.type === "ConditionalExpression") {
    stringLiterals(expr.consequent, out);
    return stringLiterals(expr.alternate, out);
  }
  if (expr.type === "LogicalExpression") return stringLiterals(expr.right, out);
  return out;
};
const o2ButtonApi = {
  rules: {
    "o2-button-api": {
      meta: {
        type: "problem",
        docs: { description: "OButton family: v2 variants, sizes and props only" },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const services = sourceCode.parserServices ?? context.parserServices;
        if (!services?.defineTemplateBodyVisitor) return {};
        const check = (node, tag, prop, value, shown = `<${tag}> ${prop}`) => {
          const allowed = BUTTON_API[tag]?.values?.[prop];
          if (!allowed || allowed.includes(value)) return;
          context.report({
            node,
            message: `${shown}="${value}" is not part of the button API. Use one of: ${allowed.join(", ")} (see OButton.types.ts; guidelines B2, S1).`,
          });
        };
        return services.defineTemplateBodyVisitor({
          VAttribute(node) {
            const element = node.parent?.parent;
            const tag = pascalTag(element?.rawName);
            const isBind = node.directive && node.key?.name?.name === "bind";
            if (node.directive && !isBind) {
              const slot = node.key?.name?.name === "slot" ? node.key.argument?.name : null;
              const owner = pascalTag(element?.parent?.rawName);
              const replacement = slot && BUTTON_API[owner]?.slots?.[slot];
              if (replacement) {
                context.report({
                  node,
                  message: `<${owner}> has no #${slot} slot; use ${replacement}.`,
                });
              }
              return;
            }
            // rawName keeps the camelCase spelling (`:iconLeft`); `name` is lowercased by the parser.
            const key = isBind ? node.key.argument : node.key;
            const raw = key?.rawName ?? key?.name;
            if (typeof raw !== "string") return;
            const prop = kebab(raw);
            const values = isBind
              ? stringLiterals(node.value?.expression)
              : [node.value?.value ?? ""];
            if (BUTTON_VARIANT_ATTR.test(prop)) {
              for (const value of values)
                check(node, "OButton", "variant", value, `<${tag}> ${prop}`);
              return;
            }
            const api = BUTTON_API[tag];
            if (!api) return;
            if (api.removed && prop in api.removed) {
              const to = api.removed[prop];
              context.report({
                node,
                message: `<${tag}> no longer takes "${prop}"${to ? `; use ${to}` : ""} (see ${tag}.types.ts).`,
              });
              return;
            }
            if (api.values?.[prop]) for (const value of values) check(node, tag, prop, value);
          },
        });
      },
    },
  },
};

// Form controls, the segmented control and tabs accept only the v2 API: control-token sizes and
// declared props (guidelines S1, S9, B9). Each family keeps its own table; values mirror *.types.ts.
// Segmented control and choice controls: the group carries the size; checkbox, radio, switch,
// slider and range come in one size (guidelines S1, S2, S9).
const CHOICE_ONE_SIZE = { removed: { size: null } };
const CHECKBOX_API = { removed: { size: null, color: null, val: "value", type: null } };
const SWITCH_API = {
  values: { "label-position": ["start", "end"] },
  removed: { size: null, "checked-value": null, "unchecked-value": null },
};
const CONTROLS_API_SELECTION = {
  OToggleGroup: { values: { size: ["sm", "md"], variant: ["default", "primary"] } },
  OFormToggleGroup: { values: { size: ["sm", "md"], variant: ["default", "primary"] } },
  OToggleGroupItem: { removed: { size: "the size of its OToggleGroup" } },
  OCheckbox: CHECKBOX_API,
  OFormCheckbox: CHECKBOX_API,
  ORadio: { values: { variant: ["default", "card"] }, removed: { size: null, val: "value" } },
  OSwitch: SWITCH_API,
  OFormSwitch: SWITCH_API,
  OOptionGroup: CHOICE_ONE_SIZE,
  OFormOptionGroup: CHOICE_ONE_SIZE,
  OSlider: CHOICE_ONE_SIZE,
  OFormSlider: CHOICE_ONE_SIZE,
  ORange: CHOICE_ONE_SIZE,
  OFormRange: CHOICE_ONE_SIZE,
};
// Text entry, search, select and date fields: control-token sizes, S7 widths, no inside labels.
const FIELD_WIDTHS = ["s", "m", "l", "full"];
const INPUT_API = {
  values: { size: ["xs", "sm", "md", "lg"], width: FIELD_WIDTHS },
  removed: {
    "label-position": 'a label above, or variant="filter" on OSelect',
    revealable: 'type="password" (it always has the toggle)',
    "field-width": "width",
    disable: "disabled",
    hint: "help-text",
    flat: null,
    color: null,
    outlined: null,
    autogrow: "OTextarea",
    rows: "OTextarea",
    "icon-left": "icon",
  },
  slots: {
    "icon-left": "#icon",
    "icon-right": "#icon-end",
    prefix: "the prefix prop",
    suffix: "the suffix prop",
    append: null,
  },
};
const TEXTAREA_API = {
  values: { width: FIELD_WIDTHS },
  removed: { size: null, disable: "disabled", "label-position": null },
};
const SELECT_API = {
  values: {
    size: ["sm", "md", "lg"],
    width: FIELD_WIDTHS,
    variant: ["field", "filter"],
    summary: ["value", "count"],
  },
  removed: {
    "label-position": 'variant="filter"',
    appearance: 'variant="filter"',
    "max-visible-chips": "max-chips",
    "dropdown-style": null,
    "option-tooltip": null,
    disable: "disabled",
    hint: "help-text",
    color: null,
  },
  slots: { "icon-left": "#icon", "selected-item": "#trigger" },
};
const SMALL_FIELD_API = {
  values: { size: ["sm", "md"] },
  removed: { "label-position": "a label above", disable: "disabled" },
};
const CONTROLS_API_FIELDS = {
  OInput: INPUT_API,
  OFormInput: INPUT_API,
  OTemplateInput: INPUT_API,
  OFormTemplateInput: INPUT_API,
  OTextarea: TEXTAREA_API,
  OFormTextarea: TEXTAREA_API,
  OTemplateTextarea: TEXTAREA_API,
  OSearchInput: {
    values: { size: ["sm", "md"], width: ["list", "scope", "full"] },
    removed: { clearable: null, autofocus: "shortcut", "label-position": null },
    slots: { "icon-right": "scope-options", "icon-left": null },
  },
  OSelect: SELECT_API,
  OFormSelect: SELECT_API,
  OCombobox: SMALL_FIELD_API,
  OFormCombobox: SMALL_FIELD_API,
  ODate: SMALL_FIELD_API,
  OFormDate: SMALL_FIELD_API,
  OTime: SMALL_FIELD_API,
  OFormTime: SMALL_FIELD_API,
  OColor: SMALL_FIELD_API,
  OFormColor: SMALL_FIELD_API,
  OChipInput: SMALL_FIELD_API,
};
const DATETIME_API = {
  values: { size: ["sm", "md"] },
  removed: { disable: "disabled", variant: null },
};
const CONTROLS_API_DATETIME = {
  ODateTimeRange: DATETIME_API,
  DateTimePickerDashboard: DATETIME_API,
  OFormDateTimeRange: DATETIME_API,
};
const CONTROLS_API_TABS = {
  OTabs: {
    values: { size: ["page", "compact"], orientation: ["horizontal", "vertical"] },
    removed: {
      dense: 'size="compact"',
      align: null,
      "mobile-arrows": null,
      breakpoint: null,
    },
  },
  OTab: {
    removed: {
      disable: "disabled",
      "suffix-icon": "locked",
      "suffix-label": "locked-label",
      exact: null,
      default: null,
    },
  },
  OStepper: { values: { orientation: ["horizontal", "vertical"] } },
};
const FILE_API = {
  values: { variant: ["zone", "compact"] },
  removed: {
    "drop-zone": null,
    size: "variant",
    "max-file-size": "max-size",
    counter: "max-files",
    "counter-label": null,
    "bottom-slots": null,
  },
  slots: { prepend: null, append: null },
};
const CONTROLS_API_FILE = { OFile: FILE_API, OFormFile: FILE_API };
const CONTROLS_API = {
  ...CONTROLS_API_SELECTION,
  ...CONTROLS_API_FIELDS,
  ...CONTROLS_API_DATETIME,
  ...CONTROLS_API_TABS,
  ...CONTROLS_API_FILE,
};
const controlsApiEntry = (rawName) => {
  if (typeof rawName !== "string") return null;
  const pascal = rawName.includes("-")
    ? rawName.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())
    : rawName;
  return CONTROLS_API[pascal] ? { tag: pascal, api: CONTROLS_API[pascal] } : null;
};
const o2ControlsApi = {
  rules: {
    "o2-controls-api": {
      meta: {
        type: "problem",
        docs: { description: "Form controls, segmented control and tabs: v2 sizes and props only" },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const services = sourceCode.parserServices ?? context.parserServices;
        if (!services?.defineTemplateBodyVisitor) return {};
        return services.defineTemplateBodyVisitor({
          VAttribute(node) {
            const element = node.parent?.parent;
            const isBind = node.directive && node.key?.name?.name === "bind";
            if (node.directive && !isBind) {
              const slot = node.key?.name?.name === "slot" ? node.key.argument?.name : null;
              const owner = controlsApiEntry(element?.parent?.rawName);
              if (!slot || !owner?.api.slots || !(slot in owner.api.slots)) return;
              const to = owner.api.slots[slot];
              context.report({
                node,
                message: `<${owner.tag}> has no #${slot} slot${to ? `; use ${to}` : ""} (see ${owner.tag}.types.ts).`,
              });
              return;
            }
            const entry = controlsApiEntry(element?.rawName);
            if (!entry) return;
            // rawName keeps the camelCase spelling (`:labelPosition`); `name` is lowercased by the parser.
            const key = isBind ? node.key.argument : node.key;
            const raw = key?.rawName ?? key?.name;
            if (typeof raw !== "string") return;
            const prop = kebab(raw);
            const { tag, api } = entry;
            if (api.removed && prop in api.removed) {
              const to = api.removed[prop];
              context.report({
                node,
                message: `<${tag}> does not take "${prop}"${to ? `; use ${to}` : ""} (see ${tag}.types.ts; guidelines S1, B9).`,
              });
              return;
            }
            const allowed = api.values?.[prop];
            if (!allowed) return;
            const values = isBind
              ? stringLiterals(node.value?.expression)
              : [node.value?.value ?? ""];
            for (const value of values) {
              if (allowed.includes(value)) continue;
              context.report({
                node,
                message: `<${tag}> ${prop}="${value}" is not part of its API. Use one of: ${allowed.join(", ")} (see ${tag}.types.ts; guideline S1).`,
              });
            }
          },
        });
      },
    },
  },
};

// Display components accept only the v2 API: tones by meaning, the fixed sizes, and no
// appearance overrides (guidelines C2-C6, K1-K6, F7, D4, S1). Values come from each *.types.ts.
const CHIP_TONES = ["neutral", "outline", "accent", "ok", "warn", "err", "crit", "info"];
const STAT_TONES = [
  "success",
  "warning",
  "error",
  "primary",
  "info",
  "orange",
  "blue",
  "teal",
  "purple",
  "neutral",
];
const CHIP_CLASS_BAN =
  /^(uppercase|tracking-\S+|(min-)?h-\S+|p[xy]?-\S+|leading-\S+|rounded(-\S+)?|text-(3xs|2xs|xs|compact|sm|base))$/;
const CHIP_REMOVED = {
  variant: "tone",
  shape: null,
  clickable: "toggle (+ pressed), removable, or an OButton",
  count: "the #trailing slot or OCountBadge",
  "hide-zero-count": "the #trailing slot or OCountBadge",
};
const NOTICE_REMOVED = {
  variant: "tone",
  content: "message",
  text: "message",
  dense: null,
  "inline-actions": null,
  bar: null,
  center: null,
  "text-size": null,
  colors: null,
  role: null,
  "data-variant": null,
  "preserve-whitespace": 'class="whitespace-pre-line wrap-anywhere"',
};
const DISPLAY_API = {
  OTag: {
    values: { tone: CHIP_TONES, size: ["sm", "md"] },
    removed: CHIP_REMOVED,
    classBan: CHIP_CLASS_BAN,
  },
  OBadge: {
    values: { tone: CHIP_TONES, size: ["sm", "md"] },
    removed: CHIP_REMOVED,
    classBan: CHIP_CLASS_BAN,
  },
  ODimensionChip: { values: { tone: CHIP_TONES }, removed: { variant: "tone" } },
  OSeverity: { values: { level: ["fatal", "error", "warn", "info", "debug"] } },
  OCountBadge: { values: { tone: ["err", "neutral", "accent"] } },
  OStatCard: { values: { tone: STAT_TONES } },
  OCard: {
    removed: { variant: null },
    classBan: /^(rounded(-\S+)?|shadow(-\S+)?|card-container|p[xy]?-\S+)$/,
  },
  OBanner: {
    values: { tone: ["neutral", "info", "warn", "err"], "action-variant": ["secondary", "link"] },
    removed: NOTICE_REMOVED,
    slots: { meta: "the default slot", footer: "the default slot", icon: "the icon prop" },
  },
  OInlineNotice: {
    values: {
      tone: ["neutral", "info", "warn", "err", "ok"],
      "action-variant": ["secondary", "link"],
    },
    removed: NOTICE_REMOVED,
    slots: { meta: "the default slot", footer: "the default slot", icon: "the icon prop" },
  },
  OEmptyState: {
    values: { kind: ["first-run", "filtered", "denied", "error"], size: ["page", "inline"] },
    removed: {
      preset: "kind with title and text",
      illustration: "icon",
      backdrop: null,
      "tone-icon": null,
      variant: "kind",
      filtered: "kind",
      "hide-action": "omitting the action label or listener",
      actions: "action-label and secondary-action-label",
      "action-icon": null,
      "action-id": null,
      "secondary-action-id": null,
      columns: null,
      description: "text",
    },
    slots: { title: "the title prop", description: "#text", illustration: "the icon prop" },
  },
  OSpinner: { values: { size: ["sm", "md", "lg"] }, removed: { variant: null } },
  OSkeleton: {
    values: { shape: ["line", "block", "circle"], preset: ["tableRows", "statStrip", "chart"] },
    removed: { type: "shape", animation: null, variant: null, "custom-radius": null },
    classBan: /^rounded(-\S+)?$/,
  },
  OProgressBar: {
    values: { tone: ["accent", "ok", "warn", "err"] },
    removed: {
      size: null,
      variant: "tone",
      indeterminate: ':value="null"',
      color: null,
      "aria-label": "label",
    },
  },
  OCollapsible: {
    removed: {
      label: "title",
      caption: "summary",
      icon: null,
      variant: null,
      "trigger-class": null,
      "model-value": "v-model:open",
    },
    vModel: "v-model:open",
  },
  OShortcut: { removed: { size: null } },
  OCode: { removed: { block: "OCodeBlock" } },
  OCodeBlock: {
    removed: {
      chrome: null,
      padded: null,
      inset: null,
      "copy-message": null,
      "reveal-tooltip": null,
      "hide-tooltip": null,
    },
  },
  ODescriptionList: {
    values: { labels: ["text", "mono"], layout: ["columns", "stacked", "auto"] },
    removed: { dense: null, "label-width": null, columns: "layout" },
  },
  ODescriptionItem: { removed: { stacked: 'layout="stacked" on the list' } },
};

// ── local/o2-table-api ───────────────────────────────────────────
// OTable v2 (guidelines L7, D1–D7): one frame, density instead of row heights, no
// row-number column, no built-in search box, and one pager (OPagination) for every list.
const OTABLE_REMOVED = {
  "show-index": "nothing; tables have no row-number column (D2)",
  "show-global-filter": "an OSearchInput in #toolbar bound to :global-filter",
  "global-filter-placeholder": "an OSearchInput in #toolbar",
  frame: "nothing; OTable draws one frame (D8)",
  bordered: "nothing; rows always have dividers",
  "toolbar-bordered": "nothing; the toolbar always has its divider",
  "pagination-bordered": "nothing; the footer always has its divider",
  width: "nothing; the table fills its container",
  dense: 'density="default" | "compact" (L7)',
  compact: 'density="compact" (L7)',
  "row-height": 'density="default" | "compact" (L7)',
  "virtual-scroll-item-size": "density; the virtualizer measures a rendered row",
  "row-tone": 'row-state ("paused")',
  "show-footer": "nothing; the footer shows whenever there is a page or a selection",
  "global-filter-active": "nothing",
};
const OTABLE_DENSITIES = ["default", "compact"];
const OPAGINATION_REMOVED = {
  max: "page-count, or total with page-size",
  "max-pages": "nothing; the pager has previous and next only",
  disable: "loading",
  "model-value": "v-model:page",
};
// Pagers are OPagination; the table's own footer renders it as OTablePagination.
const PAGER_TAGS = new Set(["OPagination", "OTablePagination"]);
const o2TableApi = {
  rules: {
    "o2-table-api": {
      meta: {
        type: "problem",
        docs: {
          description: "OTable and OPagination: v2 API only, one pager, no row-number column",
        },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const services = sourceCode.parserServices ?? context.parserServices;
        const isPagerFile = /[\\/]lib[\\/](core[\\/]Table|navigation[\\/]Pagination)[\\/]/.test(
          context.filename ?? context.getFilename(),
        );
        const scriptVisitor = {
          ImportDeclaration(node) {
            const source = String(node.source.value);
            if (!/Pagination[A-Za-z]*\.vue$/.test(source) || isPagerFile) return;
            if (/\/lib\/navigation\/Pagination\/OPagination\.vue$/.test(source)) return;
            context.report({
              node,
              message: `Custom pager "${source}": use OPagination (D5, S8).`,
            });
          },
          ObjectExpression(node) {
            const props = node.properties.filter((p) => p.type === "Property" && !p.computed);
            const keyOf = (p) => p.key?.name ?? p.key?.value;
            const id = props.find((p) => keyOf(p) === "id");
            if (!id || id.value?.type !== "Literal" || id.value.value !== "#") return;
            if (!props.some((p) => keyOf(p) === "header")) return;
            context.report({
              node: id,
              message: "A row-number column is not a table column (D2); drop it.",
            });
          },
        };
        if (!services?.defineTemplateBodyVisitor) return scriptVisitor;
        return services.defineTemplateBodyVisitor(
          {
            VElement(node) {
              const tag = node.rawName;
              if (!/Pagination/.test(tag) || PAGER_TAGS.has(tag)) return;
              context.report({
                node,
                message: `<${tag}> is a custom pager: use OPagination (D5, S8).`,
              });
            },
            VAttribute(node) {
              const element = node.parent?.parent;
              const tag = element?.rawName;
              const isBind = node.directive && node.key?.name?.name === "bind";
              if (node.directive && !isBind) {
                const directive = node.key?.name?.name;
                if (directive === "slot" && element?.parent?.rawName === "OTable") {
                  if (node.key.argument?.type === "VExpressionContainer") {
                    const value = node.key.argument.expression?.quasis?.[0]?.value?.cooked;
                    if (value === "cell-#")
                      context.report({
                        node,
                        message: "A row-number column is not a table column (D2); drop it.",
                      });
                  }
                } else if (directive === "model" && tag === "OPagination" && !node.key.argument) {
                  context.report({ node, message: "<OPagination> binds with v-model:page." });
                }
                return;
              }
              const removed =
                tag === "OTable"
                  ? OTABLE_REMOVED
                  : tag === "OPagination"
                    ? OPAGINATION_REMOVED
                    : null;
              if (!removed) return;
              const raw = isBind ? node.key.argument?.name : node.key?.name;
              if (typeof raw !== "string") return;
              const prop = kebab(raw);
              if (prop in removed) {
                context.report({
                  node,
                  message: `<${tag}> no longer takes "${prop}"; use ${removed[prop]}.`,
                });
                return;
              }
              if (tag !== "OTable") return;
              if (prop === "density") {
                const values = isBind
                  ? stringLiterals(node.value?.expression)
                  : [node.value?.value ?? ""];
                for (const value of values) {
                  if (OTABLE_DENSITIES.includes(value)) continue;
                  context.report({
                    node,
                    message: `<OTable> density="${value}" is not a density. Use: default, compact (L7).`,
                  });
                }
              } else if (prop === "row-actions" && isBind) {
                const expr = node.value?.expression;
                if (expr?.type === "ArrayExpression" && expr.elements.length > 2) {
                  context.report({
                    node,
                    message: "rowActions shows two inline actions; move the rest to row-menu (B7).",
                  });
                }
              }
            },
          },
          scriptVisitor,
        );
      },
    },
  },
};

const o2DisplayApi = {
  rules: {
    "o2-display-api": {
      meta: {
        type: "problem",
        docs: {
          description: "Chips, notices, empty states, loaders, stats, panels and code: v2 API only",
        },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const services = sourceCode.parserServices ?? context.parserServices;
        if (!services?.defineTemplateBodyVisitor) return {};
        const classTokens = (node, isBind) =>
          isBind
            ? stringLiterals(node.value?.expression).flatMap((v) => v.split(/\s+/))
            : (node.value?.value ?? "").split(/\s+/);
        return services.defineTemplateBodyVisitor({
          VAttribute(node) {
            const element = node.parent?.parent;
            const tag = element?.rawName;
            const isBind = node.directive && node.key?.name?.name === "bind";
            if (node.directive && !isBind) {
              const directive = node.key?.name?.name;
              if (directive === "slot") {
                const slot = node.key.argument?.name;
                const owner = element?.parent?.rawName;
                const replacement = slot && DISPLAY_API[owner]?.slots?.[slot];
                if (replacement)
                  context.report({
                    node,
                    message: `<${owner}> has no #${slot} slot; use ${replacement}.`,
                  });
              } else if (directive === "model" && !node.key.argument && DISPLAY_API[tag]?.vModel) {
                context.report({
                  node,
                  message: `<${tag}> binds with ${DISPLAY_API[tag].vModel}.`,
                });
              }
              return;
            }
            const api = DISPLAY_API[tag];
            if (!api) return;
            const raw = isBind ? node.key.argument?.name : node.key?.name;
            if (typeof raw !== "string") return;
            const prop = kebab(raw);
            if (api.removed && prop in api.removed) {
              const to = api.removed[prop];
              context.report({
                node,
                message: `<${tag}> no longer takes "${prop}"${to ? `; use ${to}` : ""} (see ${tag}.types.ts).`,
              });
              return;
            }
            if (prop === "class" && api.classBan) {
              for (const token of classTokens(node, isBind)) {
                const utility = token.replace(/^!|!$/g, "").split(":").pop();
                if (!utility || !api.classBan.test(utility)) continue;
                context.report({
                  node,
                  message: `"${token}" restyles <${tag}>; its size, radius, text and frame are fixed by the component (guidelines S1, T1, T5).`,
                });
              }
              return;
            }
            const allowed = api.values?.[prop];
            if (!allowed) return;
            const values = isBind
              ? stringLiterals(node.value?.expression)
              : [node.value?.value ?? ""];
            for (const value of values) {
              if (allowed.includes(value)) continue;
              context.report({
                node,
                message: `<${tag}> ${prop}="${value}" is not part of the display API. Use one of: ${allowed.join(", ")} (see ${tag}.types.ts).`,
              });
            }
          },
        });
      },
    },
  },
};

// ── local/o2-overlays-api ────────────────────────────────────────
// Dialogs, drawers, popovers, menus and tooltips: fixed sizes, no width overrides, the v2 props
// (guidelines O1, O3, O4, O7, O8, V5, V8, B6). Values mirror lib/overlay/**/*.types.ts.
const OVERLAY_ACTION_PROPS = Object.fromEntries(
  ["primary", "secondary", "neutral"].flatMap((group) =>
    ["label", "variant", "disabled", "loading", "data-test", "color"].map((field) => [
      `${group}-button-${field}`,
      `:${group === "neutral" ? "extra" : group}="{ ${field === "data-test" ? "dataTest" : field}: … }"`,
    ]),
  ),
);
const OVERLAY_SHELL_REMOVED = {
  ...OVERLAY_ACTION_PROPS,
  width: "size",
  "max-height": null,
  "sub-title": "subtitle",
  "sub-title-data-test": "subtitle-data-test",
  "initial-focus": null,
  "close-guard": "dirty (asks in the footer) or persistent",
};
const OVERLAY_WIDTH_CLASS = /^!?-?(w|min-w|max-w)-\S+$|vw/;
const MENU_ITEM_API = {
  values: { tone: ["default", "danger"] },
  removed: {
    "icon-left": "icon",
    variant: 'tone="danger"',
    "focusable-unavailable": "disabled-reason",
    "description-id": null,
    "shortcut-id": "shortcut",
  },
  slots: { "icon-left": "the icon prop, or #icon", "icon-right": "#end" },
};
const OVERLAYS_API = {
  ODialog: {
    values: { size: ["sm", "md", "lg", "full"] },
    removed: OVERLAY_SHELL_REMOVED,
    events: { "click:neutral": "@click:extra" },
    noWidthClass: true,
  },
  ODrawer: {
    values: { size: ["sm", "md", "lg", "xl"], side: ["right", "left"] },
    removed: OVERLAY_SHELL_REMOVED,
    events: { "click:neutral": "@click:extra" },
    noWidthClass: true,
  },
  OPopover: {
    values: { size: ["sm", "md", "lg", "auto"] },
    contentClass: true,
    libOnly: { size: ["auto"] },
  },
  ODropdown: { contentClass: true },
  OContextMenu: { contentClass: true },
  OTooltip: {
    removed: {
      "max-width": null,
      delay: null,
      "side-offset": null,
      align: null,
      "align-offset": null,
      "shortcut-id": "shortcut",
    },
    contentClass: true,
  },
  ODropdownItem: MENU_ITEM_API,
  OContextMenuItem: MENU_ITEM_API,
  ODropdownSub: {
    removed: { "text-value": "label", "description-id": null },
    slots: { trigger: "the label prop", "icon-left": "the icon prop", "icon-right": "#end" },
  },
  ConfirmDialog: {
    values: { kind: ["confirm", "destructive", "typeToConfirm", "discard"] },
    removed: { "ok-variant": "kind", "ok-color": null, "focus-cancel": null },
  },
};
const hasAncestorTag = (element, tag) => {
  for (let node = element?.parent; node; node = node.parent) {
    if (node.type === "VElement" && pascalTag(node.rawName) === tag) return true;
  }
  return false;
};
const o2OverlaysApi = {
  rules: {
    "o2-overlays-api": {
      meta: {
        type: "problem",
        docs: { description: "Dialogs, drawers, popovers, menus and tooltips: v2 API only" },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const services = sourceCode.parserServices ?? context.parserServices;
        if (!services?.defineTemplateBodyVisitor) return {};
        const filename = (context.filename ?? context.getFilename()).replace(/\\/g, "/");
        const inLib = filename.includes("/src/lib/");
        const report = (node, message) => context.report({ node, message });
        const classTokens = (node, isBind) =>
          isBind
            ? stringLiterals(node.value?.expression).flatMap((v) => v.split(/\s+/))
            : (node.value?.value ?? "").split(/\s+/);
        const checkWidthClasses = (node, isBind, tag, prop) => {
          for (const token of classTokens(node, isBind)) {
            const utility = token.split(":").pop();
            if (!utility || !OVERLAY_WIDTH_CLASS.test(utility)) continue;
            report(
              node,
              `"${token}" sets the width of <${tag}> through ${prop}; its width comes from \`size\` (guidelines O3, O4).`,
            );
          }
        };
        const checkDirective = (node, element, tag) => {
          const name = node.key?.name?.name;
          if (name === "slot") {
            const slot = node.key.argument?.name;
            const owner = pascalTag(element?.parent?.rawName);
            const replacement = slot && OVERLAYS_API[owner]?.slots?.[slot];
            if (replacement) report(node, `<${owner}> has no #${slot} slot; use ${replacement}.`);
            return;
          }
          if (name !== "on") return;
          const event = node.key.argument?.name;
          const to = OVERLAYS_API[tag]?.events?.[event];
          if (to) report(node, `<${tag}> no longer emits "${event}"; use ${to}.`);
        };
        return services.defineTemplateBodyVisitor({
          VElement(node) {
            if (
              pascalTag(node.rawName) === "ODropdownSub" &&
              hasAncestorTag(node, "ODropdownSub")
            ) {
              report(
                node.startTag,
                "A submenu inside a submenu breaks guideline O1; keep one level.",
              );
            }
          },
          VAttribute(node) {
            const element = node.parent?.parent;
            const tag = pascalTag(element?.rawName);
            const isBind = node.directive && node.key?.name?.name === "bind";
            if (node.directive && !isBind) {
              checkDirective(node, element, tag);
              return;
            }
            const api = OVERLAYS_API[tag];
            if (!api) return;
            const key = isBind ? node.key.argument : node.key;
            const raw = key?.rawName ?? key?.name;
            if (typeof raw !== "string") return;
            const prop = kebab(raw);
            if (api.removed && prop in api.removed) {
              const to = api.removed[prop];
              report(
                node,
                `<${tag}> no longer takes "${prop}"${to ? `; use ${to}` : ""} (see ${tag}.types.ts).`,
              );
              return;
            }
            if (api.noWidthClass && (prop === "class" || prop === "style")) {
              checkWidthClasses(node, isBind, tag, prop);
              return;
            }
            if (api.contentClass && prop === "content-class") {
              checkWidthClasses(node, isBind, tag, prop);
              return;
            }
            const allowed = api.values?.[prop];
            if (!allowed) return;
            const values = isBind
              ? stringLiterals(node.value?.expression)
              : [node.value?.value ?? ""];
            for (const value of values) {
              if (!allowed.includes(value)) {
                report(
                  node,
                  `<${tag}> ${prop}="${value}" is not part of the overlay API. Use one of: ${allowed.join(", ")} (see ${tag}.types.ts).`,
                );
              } else if (!inLib && api.libOnly?.[prop]?.includes(value)) {
                report(
                  node,
                  `<${tag}> ${prop}="${value}" is for library composites only; pick a fixed size.`,
                );
              }
            }
          },
        });
      },
    },
  },
};

// ── local/o2-page-header-api ─────────────────────────────────────
// The stacked page header (guidelines H1–H8, N3, L3): no icon tile, no subtitle, tabs on their
// own row, Back as the context link on useSmartBack, and one <h1> per page owned by the header.
const PAGE_HEADER_TAGS = new Set(["OPageHeader", "OPageLayout"]);
const PAGE_HEADER_REMOVED = {
  icon: "nothing; the rail shows the area (H2)",
  subtitle: "about, the ⓘ popover beside the title, or nothing (H2)",
  "tabs-below": "nothing; tabs always sit on their own row (H8)",
  "title-overflow": "nothing; a text title truncates, a #title slot owns its overflow",
  "overflow-first": "nothing; #actions-overflow always precedes #actions (H3)",
  "title-min-width": "nothing; the band never wraps (H1)",
};
const PAGE_HEADER_REMOVED_SLOTS = {
  subtitle: "the about prop (H2)",
  "title-trail": "#status (H5)",
  "title-prefix": "nothing; the title starts at the content edge (H1)",
  back: "the back prop (H4)",
};
// Header slots a hand-built back button could sit in.
const PAGE_HEADER_SLOTS = new Set([
  "actions",
  "actions-overflow",
  "title",
  "status",
  "header-tabs",
  "tabs",
]);
const BACK_ICONS = new Set(["arrow-back", "arrow_back", "arrow-left", "keyboard-backspace"]);
const BACK_TEXT = /\bback\b/i;
const isBackCall = (node) => {
  const callee = node.callee;
  if (callee?.type !== "MemberExpression") return false;
  const method = callee.property?.name;
  const object = callee.object;
  const owner =
    object?.type === "Identifier"
      ? object.name
      : object?.type === "MemberExpression"
        ? object.property?.name
        : object?.type === "CallExpression"
          ? object.callee?.name
          : null;
  if (method === "back") return ["router", "$router", "history", "useRouter"].includes(owner);
  if (method !== "go") return false;
  const arg = node.arguments[0];
  return (
    ["router", "$router", "history", "useRouter"].includes(owner) &&
    arg?.type === "UnaryExpression" &&
    arg.operator === "-"
  );
};
const attrValue = (element, name) => {
  for (const attr of element.startTag?.attributes ?? []) {
    const isBind = attr.directive && attr.key?.name?.name === "bind";
    const key = isBind ? attr.key.argument?.name : attr.directive ? null : attr.key?.name;
    if (key !== name) continue;
    return isBind ? stringLiterals(attr.value?.expression).join(" ") : (attr.value?.value ?? "");
  }
  return null;
};
const isBackButton = (element) => {
  const tag = pascalTag(element.rawName);
  if (!["OButton", "button", "a", "RouterLink", "router-link"].includes(tag)) return false;
  if (BACK_ICONS.has(attrValue(element, "icon") ?? "")) return true;
  const glyph = (element.children ?? []).some(
    (child) =>
      child.type === "VElement" &&
      pascalTag(child.rawName) === "OIcon" &&
      BACK_ICONS.has(attrValue(child, "name") ?? ""),
  );
  if (glyph) return true;
  const named = [attrValue(element, "data-test"), attrValue(element, "aria-label")];
  return named.some((v) => v && /(^|-)back(-|$)/.test(v)) && BACK_TEXT.test(named.join(" "));
};
const headerSlotOf = (element) => {
  for (let node = element?.parent; node; node = node.parent) {
    if (node.type !== "VElement") continue;
    if (node.rawName === "template" && PAGE_HEADER_TAGS.has(pascalTag(node.parent?.rawName))) {
      const slot = node.startTag.attributes.find(
        (a) => a.directive && a.key?.name?.name === "slot",
      );
      return slot?.key?.argument?.name ?? "default";
    }
    if (PAGE_HEADER_TAGS.has(pascalTag(node.rawName))) return "default";
  }
  return null;
};
const o2PageHeaderApi = {
  rules: {
    "o2-page-header-api": {
      meta: {
        type: "problem",
        docs: {
          description:
            "OPageHeader / OPageLayout: the stacked v2 header, smart Back, one page title",
        },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const services = sourceCode.parserServices ?? context.parserServices;
        const filename = (context.filename ?? context.getFilename()).replace(/\\/g, "/");
        const inHeaderLib = /\/src\/lib\/core\/Page(Header|Layout)\//.test(filename);
        const rendersHeader = /<OPage(Header|Layout)\b/.test(sourceCode.text);
        const inViews = /\/src\/(enterprise\/)?views\//.test(filename);
        const report = (node, message) => context.report({ node, message });
        const scriptVisitor = {
          CallExpression(node) {
            if (rendersHeader && !inHeaderLib && isBackCall(node)) {
              report(
                node,
                "A page with OPageHeader goes back through useSmartBack, never router.back() (N3).",
              );
            }
          },
        };
        if (!services?.defineTemplateBodyVisitor) return scriptVisitor;
        return services.defineTemplateBodyVisitor(
          {
            CallExpression: scriptVisitor.CallExpression,
            VElement(node) {
              const tag = pascalTag(node.rawName);
              if (inViews && !inHeaderLib && (tag === "h1" || attrValue(node, "as") === "h1")) {
                report(
                  node.startTag,
                  "The page title is OPageHeader's <h1>; a view has no other (H1, T2).",
                );
              }
              if (!rendersHeader || !isBackButton(node)) return;
              const slot = headerSlotOf(node);
              const besideHeader = (node.parent?.children ?? []).some(
                (sibling) =>
                  sibling.type === "VElement" && PAGE_HEADER_TAGS.has(pascalTag(sibling.rawName)),
              );
              if ((slot && PAGE_HEADER_SLOTS.has(slot)) || besideHeader) {
                report(
                  node.startTag,
                  'Back is the header\'s context link: pass :back="{ label, to }" instead of a hand-built button (H4, N3).',
                );
              }
            },
            VAttribute(node) {
              const element = node.parent?.parent;
              const isBind = node.directive && node.key?.name?.name === "bind";
              if (node.directive && !isBind) {
                if (node.key?.name?.name !== "slot") return;
                const owner = pascalTag(element?.parent?.rawName);
                const slot = node.key.argument?.name;
                if (!PAGE_HEADER_TAGS.has(owner) || !(slot in PAGE_HEADER_REMOVED_SLOTS)) return;
                report(
                  node,
                  `<${owner}> has no #${slot} slot; use ${PAGE_HEADER_REMOVED_SLOTS[slot]}.`,
                );
                return;
              }
              const tag = pascalTag(element?.rawName);
              if (!PAGE_HEADER_TAGS.has(tag)) return;
              const key = isBind ? node.key.argument : node.key;
              const raw = key?.rawName ?? key?.name;
              if (typeof raw !== "string") return;
              const prop = kebab(raw);
              if (prop in PAGE_HEADER_REMOVED) {
                report(
                  node,
                  `<${tag}> no longer takes "${prop}"; use ${PAGE_HEADER_REMOVED[prop]}.`,
                );
              }
            },
          },
          scriptVisitor,
        );
      },
    },
  },
};

// Non-translatable tokens, fed to both i18n rules.
//
// An entry is a GLOBAL, PERMANENT exemption with no explanation at the call site,
// so it is a last resort — only for a token that recurs AND sits in a bare text
// node, where there is no declaration to annotate. Everything else has a better
// home: a union type if code branches on it, otherwise `raw("…")` at the call
// site. Never add real UI text.
//
// Matching is whole-text, so "s" allows a bare `s` node, not the "s" in "settings".
const GLYPHS_AND_UNITS = [
  "px",
  "s", // SECONDS, not a plural suffix — manual pluralisation is debt, use a pipe plural
  "ms",
  "min",
  "~",
  "×",
  "→",
  "≠",
  "$",
  "fx",
  "x",
  "●",
  "…",
  "🕑",
  "$_",
];

/** Defined by an external spec — identical in every locale. */
const SPEC_IDENTIFIERS = ["GET", "UTC", "SQL", "PromQL", "OK", "ERROR"];

/** Bare text nodes, where `raw()` has no expression to wrap. */
const TEXT_NODE_LITERALS = ["1000", "./.env", "trace.zip", "OpenObserve"];

const NON_TRANSLATABLE = [...GLYPHS_AND_UNITS, ...SPEC_IDENTIFIERS, ...TEXT_NODE_LITERALS];
const NON_TRANSLATABLE_SET = new Set(NON_TRANSLATABLE);

// The built-in rule's DEFAULT allowlist (punctuation it always ignores). Supplying an
// `allowlist` REPLACES this default, so we spread it back in alongside NON_TRANSLATABLE.
const BARE_STRING_DEFAULT_ALLOWLIST = [
  "(",
  ")",
  ",",
  ".",
  "&",
  "+",
  "-",
  "=",
  "*",
  "/",
  "#",
  "%",
  "!",
  "?",
  ":",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
  "·",
  "•",
  "‐",
  "–",
  "—",
  "−",
  "|",
];

// Catches hardcoded template text the built-in `vue/no-bare-strings-in-template`
// (static attrs + text nodes only) can't see: `{{ 'Save' }}` and v-text/v-html —
// otherwise the check is dodged by adding two braces. Bound PROPS are not checked
// here; `I18nText` covers them, and rejects even a plain string variable.
// Non-<template> files are a no-op.
// Native attributes whose content is always text a user reads.
const NATIVE_TEXT_ATTRS = new Set([
  "placeholder",
  "title",
  "alt",
  "aria-label",
  "aria-placeholder",
  "aria-description",
  "aria-valuetext",
  "aria-roledescription",
]);

noLegacyO2Tokens.rules["no-bare-bound-text-props"] = {
  meta: {
    type: "problem",
    docs: {
      description: "Ban hardcoded text in v-text/v-html and {{ }} literals",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const ps = sourceCode.parserServices ?? context.parserServices;
    if (!ps || !ps.defineTemplateBodyVisitor) return {};
    // Collects hardcoded text from an expression, recursing through the composed
    // shapes (concatenation, ternary, ||-fallback, template literal) — vue-i18n
    // handles all of them via named interpolation, so none needs an exemption.
    //
    // CallExpression is deliberately absent: that is what makes t() and raw() pass.
    // MemberExpression too, so `row["exception.type"]` isn't read as display text.
    const collect = (expr, out) => {
      if (!expr) return out;
      switch (expr.type) {
        case "Literal":
          if (typeof expr.value === "string") out.push(expr.value);
          break;
        case "TemplateLiteral":
          for (const q of expr.quasis) out.push(q.value.cooked ?? "");
          for (const e of expr.expressions) collect(e, out);
          break;
        case "BinaryExpression":
          if (expr.operator === "+") {
            collect(expr.left, out);
            collect(expr.right, out);
          }
          break;
        case "ConditionalExpression":
          collect(expr.consequent, out);
          collect(expr.alternate, out);
          break;
        case "LogicalExpression":
          collect(expr.left, out);
          collect(expr.right, out);
          break;
      }
      return out;
    };
    // → offending text (joined when composed), or null if there is none.
    const bareText = (expr) => {
      const parts = collect(expr, []).filter(
        (t) => t != null && /\p{L}/u.test(t) && !NON_TRANSLATABLE_SET.has(t.trim()),
      );
      return parts.length ? parts.join("|") : null;
    };
    return ps.defineTemplateBodyVisitor({
      VAttribute(node) {
        if (!node.directive) return; // static attrs → handled by no-bare-strings
        const dir = node.key && node.key.name && node.key.name.name;
        const text = bareText(node.value && node.value.expression);
        if (text == null) return;
        if (dir === "bind") {
          // Native only: component props are covered by the I18nText type, and the
          // built-in rule sees only the STATIC form of these attributes.
          const el = node.parent && node.parent.parent;
          const tag = el && el.rawName;
          // A dash or an uppercase letter means a component (OButton, q-btn).
          const isNative = typeof tag === "string" && /^[a-z][a-z0-9]*$/.test(tag);
          const attr = node.key.argument && node.key.argument.name;
          if (isNative && NATIVE_TEXT_ATTRS.has(attr)) {
            context.report({
              node,
              message: `Hardcoded text "${text}" in :${attr} — use t('...') with a key in en-US.json.`,
            });
          }
          return;
        } else if (dir === "text" || dir === "html") {
          context.report({
            node,
            message: `Hardcoded text "${text}" in v-${dir} — use t('...') with a key in en-US.json.`,
          });
        }
      },
      VExpressionContainer(node) {
        // Text-position {{ }} only — a directive value's container has a VAttribute
        // parent and is handled above.
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

// @intlify's no-missing-keys hardcodes /^(\$t|t|\$tc|tc)$/ with `schema: []`, so it
// cannot be told about gt(). A typo'd gt() key otherwise ships and renders its raw
// path. Resolution is delegated to the plugin so both rules stay in step.
noLegacyO2Tokens.rules["no-missing-gt-keys"] = {
  meta: {
    type: "problem",
    docs: { description: "Check gt() keys exist in the configured locale messages" },
    schema: [],
    messages: {
      missing: "gt(\"{{key}}\") is missing: '{{path}}' does not exist in localization messages.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!node.callee || node.callee.type !== "Identifier" || node.callee.name !== "gt") return;
        // Unwrap, or `gt("x" as I18nKey)` becomes a way to opt out of the check.
        const arg = skipTSAsExpression(node.arguments[0]);
        if (!isStaticLiteral(arg)) return; // dynamic keys are unresolvable here
        const key = getStaticLiteralValue(arg);
        if (!key) return;
        // no-missing-keys owns the "localeDir unset" diagnostic; don't double-report.
        const localeMessages = getLocaleMessages(context, { ignoreMissingSettingsError: true });
        if (localeMessages.isEmpty()) return;
        const missingPath = localeMessages.findMissingPath(String(key));
        if (missingPath) {
          context.report({ node: arg, messageId: "missing", data: { key, path: missingPath } });
        }
      },
    };
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
      local: {
        rules: {
          ...noLegacyO2Tokens.rules,
          ...noHardcodedPx.rules,
          ...noPhysicalDirectionUtilities.rules,
          ...noHardcodedColor.rules,
          ...o2ControlHeight.rules,
          ...o2ButtonApi.rules,
          ...o2ControlsApi.rules,
          ...o2DisplayApi.rules,
          ...o2TableApi.rules,
          ...o2OverlaysApi.rules,
          ...o2PageHeaderApi.rules,
        },
      },
      "@intlify/vue-i18n": vueI18n,
    },
    // en-US only. The other locales are generated from it and lag behind, so
    // validating against the whole folder would flag every untranslated key.
    settings: {
      "vue-i18n": {
        localeDir: [
          "./src/locales/languages/en-US.json",
          "./src/components/autoobserve/mock/locale/en-US.json",
          "./src/locales/languages/security/en-US.json",
        ],
        messageSyntaxVersion: "^11.0.0",
      },
    },
    rules: {
      "local/no-legacy-o2-tokens": ["error"],
      "local/no-hardcoded-px": ["error"],
      "local/no-physical-direction-utilities": ["error"],
      "local/no-hardcoded-color": ["error"],
      "local/o2-control-height": ["error"],
      "local/o2-button-api": ["error"],
      "local/o2-controls-api": ["error"],
      "local/o2-display-api": ["error"],
      "local/o2-table-api": ["error"],
      "local/o2-overlays-api": ["error"],
      "local/o2-page-header-api": ["error"],

      // A missing key is invisible at build time — vue-i18n renders the raw key to
      // the user. Dynamic keys are skipped by the rule; specs are exempted below.
      "@intlify/vue-i18n/no-missing-keys": "error",
      //
      // Text nodes, plus the native HTML/ARIA attributes below. Component props are
      // absent on purpose — `I18nText` (src/types/i18n.ts) guards those, and rejects
      // even `:label="someStringVariable"`, which no lint rule can see. These
      // attributes have no prop to annotate, so lint is the only gate they get.
      //
      // Not the old `TEXT_ATTRS` list returning: that tracked OUR components and went
      // stale silently. This tracks the web platform, which does not change.
      // (@intlify's own `no-raw-text` is not used — it counts punctuation and code
      // tokens, so it stays in the hundreds even fully migrated.)
      "vue/no-bare-strings-in-template": [
        "error",
        {
          attributes: {
            "/.+/": [
              "title",
              "alt",
              "aria-label",
              "aria-placeholder",
              "aria-roledescription",
              "aria-valuetext",
            ],
            input: ["placeholder"],
            textarea: ["placeholder"],
          },
          allowlist: [...BARE_STRING_DEFAULT_ALLOWLIST, ...NON_TRANSLATABLE],
        },
      ],
      "local/no-bare-bound-text-props": "error",
      // The gt() half of the key contract; no-missing-keys above covers t().
      "local/no-missing-gt-keys": "error",
      //
      // Vanilla useI18n().t() returns an unbranded `string`, which would silently
      // void every I18nText check in the file. useI18nTyped() is the same composer
      // with a type-level cast — no runtime cost.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vue-i18n",
              importNames: ["useI18n"],
              message:
                "Import useI18nTyped from '@/types/i18n' instead (or gt() outside a setup context) — useI18n() returns an unbranded string and defeats the I18nText check.",
            },
          ],
        },
      ],
      //
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
      // No CSS preprocessor in an SFC. A <style lang="scss"> block is invisible
      // to `lint:styles` unless postcss-scss is installed, so for as long as one
      // existed the hex ban, the --o2-* ban and the .body--dark selector ban
      // silently did not run on that file — 14 of them. Plain CSS is also all
      // these blocks ever needed: what survives a Tailwind-first template is
      // :deep(), pseudo-elements and keyframes, none of which want nesting.
      // `lang="css"` and no lang are both accepted; scss/sass/less error.
      "vue/block-lang": ["error", { style: { lang: "css" } }],
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
    // The ban can't forbid its own implementation: the wrapper has to import
    // useI18n to wrap it, and the bootstrap has to call createI18n.
    files: ["src/types/i18n.ts", "src/locales/**"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // Tests build their own i18n instances as fixtures, and use throwaway keys
    // (`test.key`) that intentionally are not in en-US.json — so neither the
    // import ban nor the key contract applies to them.
    files: ["**/*.{spec,test}.{js,ts,jsx,tsx}", "**/__tests__/**", "**/test/**"],
    rules: {
      "no-restricted-imports": "off",
      "@intlify/vue-i18n/no-missing-keys": "off",
      "local/no-missing-gt-keys": "off",
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

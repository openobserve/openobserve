#!/usr/bin/env node
// CI ratchet: count per-file occurrences of every design-token bypass category
// from O2_TOKEN_MIGRATION_PLAN.md §3 (A–R). Debt can only shrink.
//
//   node scripts/check-design-consistency.mjs            # fail if any file/category exceeds baseline
//   node scripts/check-design-consistency.mjs --strict   # ALSO fail if the baseline is stale (has slack) — CI mode
//   node scripts/check-design-consistency.mjs --baseline # (re)write design-debt-baseline.json
//
// --strict is what CI runs (lint:design:strict). Plain mode lets a file sit
// below its baseline (leaving headroom a future raw token could refill without
// tripping the guard); --strict forbids that slack, so every bypass category is
// strictly monotonic-down and NO new raw token can land anywhere — including in a
// file that still carries pre-existing debt. Improve → re-baseline → commit.
//
// Phase B: ratchet mode (this file). Phase G: delete the baseline → zero tolerance
// (except `stylePxUnit`, which stays ratchet-only per §12.4).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "src");
const BASELINE = join(__dirname, "design-debt-baseline.json");

// Declared homes for literal hex in .ts (§12.3). Excluded from the `tsHex`
// category because their CONSUMER cannot resolve a CSS custom property, so a
// `var(--color-*)` is impossible there — the hex is the only option:
//   • ECharts option objects / canvas 2D contexts (dashboard chart converters)
//   • user-editable chart-template source strings (customChartTemplates/*)
//   • Monaco editor theme + language token colours (vrlLanguage*)
//   • SVG/canvas trace-tree rendering
//   • the theme source-of-truth itself (theme.ts defines the runtime palette)
//   • JS that builds styled log/status HTML from a fixed status→colour map
// Entries ending in "/" match by directory prefix; others by exact suffix.
const TS_HEX_ALLOWLIST = [
  // categorical / series palettes + theme source
  "utils/dashboard/colorPalette.ts",
  "constants/themes.ts",
  "utils/traces/traceColors.ts",
  "utils/theme.ts",
  "utils/themeManager.ts",
  "utils/chartTheme.ts", // sanctioned seam: light-theme fallback constants for jsdom/pre-CSS
  // ECharts / canvas / geo chart builders — options are serialised, no var() resolves
  "utils/dashboard/",
  "composables/dashboard/",
  "components/dashboards/addPanel/customChartExamples/",
  "utils/traces/convertTraceData.ts",
  "utils/traces/treeVisualizationEngine.ts",
  "composables/useServiceGraphTree.ts",
  "composables/useMetricsExplorer.ts",
  // Monaco editor language/theme definitions (colour strings the editor lib reads)
  "utils/query/vrlLanguage.ts",
  "utils/query/vrlLanguageDefinition.ts",
  // JS that builds styled HTML/canvas from a fixed status→colour map
  "utils/logs/convertLogData.ts",
  "utils/logs/statusParser.ts",
  "utils/logs/keyValueParser.ts",
  // LLM / metric / latency chart-panel series palettes (ECharts, no var())
  "plugins/traces/llmTrendPanel.utils.ts",
  "plugins/traces/config/",
  "enterprise/components/billings/usageDailyPanelSchema.ts",
  "composables/useLatencyInsightsDashboard.ts",
  "composables/useMetricsCorrelationDashboard.ts",
  "utils/metrics/metricPalette.ts",
  "utils/traces/treeTooltipHelpers.ts",
  "utils/alerts/alertChartData.ts",
  "composables/useAlertForm.ts", // ECharts markLine colour
  // Ingestion vendor brand accents (D12-style fixed brand colour; `tone` is a
  // reserved-future field that is never read — see setup-card content types)
  "components/ingestion/setupCard/content/",
  "components/ingestion/ai/content/",
];

// The sanctioned dark-mode seams (§3.R.1) — the only files allowed to read theme /
// declare an isDark flag, so they are exempt from the darkMechanism count. useTheme +
// chartTheme are the JS *consumption* seams; themeManager is the theme *applier* — it
// resolves store.state.theme into the mode to apply (upstream of every token, so it
// cannot consume a token without circularity).
//   • ThemeSwitcher.vue is the toggle control itself. A theme switch cannot be written
//     without naming "dark" — the `darkMode` flag OR a `theme === 'dark'` compare both
//     trip the regex — so it is the one canonical home for that decision, not the
//     fragmentation the category targets.
//   • convertLogData.ts reads --color-theme-accent to paint an ECharts canvas bar.
//     applyThemeColors (utils/theme.ts) sets that token inline on document.body in dark
//     mode and on document.documentElement in light, so the consumer must know which
//     element carries it — a var() cannot resolve on a <canvas>.
const DARK_SEAM_ALLOWLIST = [
  "composables/useTheme.ts",
  "utils/chartTheme.ts",
  "utils/themeManager.ts",
  "components/ThemeSwitcher.vue",
  "utils/logs/convertLogData.ts",
];

// Files allowed to keep an UNSCOPED <style> block. An unscoped block leaks globally,
// so it is debt by default — but a few blocks legitimately must reach past the
// component's own subtree, which a `scoped` block physically cannot do:
//   • ViewDashboard.vue: its @media print / fullscreen rules target external ancestors
//     (.o2-app-root, main, .o2-content-scroll, .scroll) that live outside the SFC, so
//     the block is unscoped on purpose (carries a keep(complex-state) note).
const UNSCOPED_STYLE_ALLOWLIST = [
  "views/Dashboards/ViewDashboard.vue",
];

// Files allowed to carry a literal font stack. Email markup renders inside a mail
// client, which can load neither our webfont nor our custom properties, so a
// system stack is the correct choice there (FONT_AUDIT.md §5.2).
const FONT_ALLOWLIST = [
  "utils/prebuilt-templates/email.ts",
  "utils/fonts.ts", // defines the fallback stacks the tokens mirror
];

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PROPS = "text|bg|border|ring|fill|stroke|divide|outline|decoration|placeholder|from|via|to";

// Categories evaluated over the WHOLE file text.
const WHOLE = {
  rawPalette: new RegExp(`\\b(?:dark:|hover:|focus:|group-hover:|active:)*(?:${PROPS})-(?:${PALETTE})-\\d{2,3}\\b`, "g"),
  // PROJECT raw-ramp utilities (Part B, Ring 3): feature code reaching for our own
  // primitives (grey-*/primary-*) instead of semantic tokens. The ramps stay
  // REGISTERED while these consumers exist (un-registering would break them, and
  // migrating is not value-preserving — e.g. accent flips 600→400 in dark), so
  // this ratchet freezes the count: it can only shrink toward the Part-B ideal.
  rawProjectRamp: new RegExp(`\\b(?:dark:|hover:|focus:|group-hover:|active:|focus-visible:)*(?:${PROPS}|ring)-(?:grey|primary)-\\d{2,3}\\b`, "g"),
  hexClass: /-\[#[0-9a-fA-F]{3,8}\]/g,
  inlineHexStyle: /style="[^"]*#[0-9a-fA-F]{3,8}/g,
  inlineHexBind: /:style="[^"]*#[0-9a-fA-F]{3,8}/g,
  themeTernary: /theme\s*===?\s*['"]dark['"]/g,
  // A bare `rounded` utility is bounded by class-list separators on BOTH sides.
  // Requiring a trailing separator (space/quote/backtick/EOL) skips prose in
  // comments ("short, rounded, inset") and JS object keys (`rounded: "..."`).
  // Retired text-colour aliases (Tier 1): text-text-primary → text-text-heading,
  // text-text-caption → text-text-secondary. Baseline 0 after the codemod, so any
  // reintroduction of the class utility is a regression.
  retiredTextAlias: /\btext-text-(?:primary|caption)\b/g,
  bareRounded: /(?:^|[\s"'`])rounded(?=[\s"'`]|$)/gm,
  // Retired radius tiers: the app exposes exactly two corner radii —
  // rounded-default (controls) and rounded-surface (large surfaces) — plus
  // rounded-full. The old sm/md/lg/xl scale (and its var(--radius-*) refs) was a
  // set of same-value aliases that lied about being distinct; it was repointed
  // (small→default, large→surface) and the tokens deleted. Baseline 0 after the
  // codemod, so any reintroduction falls back to Tailwind's stock scale and is a
  // regression. Matches the class utility (incl. per-corner variants) and the var.
  retiredRadiusAlias:
    /\brounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?-(?:sm|md|lg|xl)\b|var\(--radius-(?:sm|md|lg|xl)\)/g,
  // Arbitrary radius VALUE — but not a CSS keyword (`rounded-[inherit]` etc.),
  // which is not a hardcoded dimension and has no scale-token equivalent.
  arbRadius: /rounded(?:-[a-z]+)*-\[(?!(?:inherit|initial|unset|revert|revert-layer)\])[^\]]+\]/g,
  arbTextSize: /text-\[[0-9.]+(?:px|rem)\]/g,
  unscopedStyle: /<style(?![^>]*\bscoped\b)[^>]*>/g,
  twPrefix: /\btw:/g,
  helperUtil: /\btext-weight-[a-z]+\b/g,
  arbPx: /\b(?:gap|p[trblxy]?|m[trblxy]?|w|h|size|min-w|min-h|max-w|max-h|top|left|right|bottom|inset|leading)-\[[0-9.]+px\]/g,
  arbZ: /\bz-\[[0-9]+\]/g,
  // Literal font stacks. The app ships exactly two families, reached only via
  // var(--font-sans) / var(--font-mono) (FONT_AUDIT.md). Anything else resolves
  // to whatever the visitor's OS happens to have, which is how the app came to
  // render in ~14 different stacks. Covers CSS declarations, Tailwind arbitrary
  // values (`[font-family:…]`), and `font-[…]` when the value looks like a
  // family rather than a weight (`font-[600]` stays legal).
  literalFontFamily: new RegExp(
    [
      // font-family: <anything that isn't our token / inherit>.
      // The lookahead absorbs the whitespace itself — if `\s*` were consumed
      // first it could backtrack to zero width and let ` var(--font-mono)` slip
      // through as a "literal" starting with a space.
      String.raw`font-family:(?!\s*(?:var\(--font-(?:sans|mono)\)|inherit))\s*[^;"'\`\n}]+`,
      // [font-family:<literal>]
      String.raw`\[font-family:(?!(?:var\(--font-(?:sans|mono)\)|inherit)\])[^\]]+\]`,
      // font-[<literal family>] — weights like font-[600] are not families
      String.raw`\bfont-\[(?!\d+\]|var\(--font-(?:sans|mono)\)\]|inherit\])[^\]]*(?:mono|serif|Menlo|Monaco|Consolas|Courier|Geist|Inconsolata|Fira|Ubuntu|Segoe|Roboto|apple-system)[^\]]*\]`,
    ].join("|"),
    "g",
  ),
  // Dark-mode mechanism fragmentation (§3.R.2 mechanisms 1,2,5,6,7)
  darkMechanism: /theme\s*[=!]==?\s*['"]dark['"]|const\s+(?:isDark|isDarkMode|darkMode)\s*=|\.body--(?:dark|light)|classList\.contains\(['"]body--|\.(?:light|dark)-mode\b/g,
};

// Categories evaluated ONLY inside <style>…</style> blocks (scoped AND unscoped —
// styleBlocks() collects every block regardless of the `scoped` attribute).
const STYLE_ONLY = {
  styleBlockHex: /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g,
  stylePxUnit: /\b(?:[2-9]|[0-9]{2,})(?:\.[0-9]+)?px\b/g, // 1px hairlines exempt
  // NOTE: rawVarInComponent (F.6) is NOT a flat regex — it is context-aware and
  // computed by countRawVarInComponent() below. See that function for why.
};

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (extname(entry) === ".vue" || extname(entry) === ".ts") files.push(full);
  }
  return files;
}

function styleBlocks(text) {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out.join("\n");
}

// ── rawVarInComponent (F.6), CONTEXT-AWARE ─────────────────────────────────
// A raw `var(--color-*)` inside a component <style> block is debt ONLY when a
// registered utility (bg-x / text-x / border-x) could actually replace it. In a
// handful of CSS positions a utility PHYSICALLY cannot — there the raw var() is
// the correct and only option, exactly like the TS_HEX / DARK_SEAM allowlists
// above exempt patterns that are correct-in-context. So we count an occurrence
// only when it is NOT in one of these structurally-CSS-only positions:
//   • inside :deep(…)             — targets a child component's internal DOM; the
//                                   parent cannot put a utility class on it
//   • inside color-mix()/gradient — a utility cannot be a mix input / colour stop
//   • a pseudo-element rule (::before/::after/::-webkit-scrollbar/::placeholder…)
//                                 — utilities have no pseudo-element surface here
//   • inside @keyframes           — animated colour steps have no utility form
//   • a CSS custom-property def (--x: var(…)) — a utility cannot DEFINE a var that
//                                   sibling rules / child DOM then read
// It is judged PER-OCCURRENCE, deliberately NOT by the block's keep() comment:
// keep() is MANDATORY on every surviving <style> block (it justifies the block's
// existence — see countUnjustifiedBlocks), so a block-level exemption would zero
// the whole category. A block can legitimately exist for one keyframe yet still
// carry an avoidable raw var() in a plain rule — this counts that, not the block.

// selector-nesting stack (raw selector texts, incl. leading comments) at `target`
function selectorStackAt(css, target) {
  const stack = [];
  let pending = 0;
  for (let i = 0; i < target && i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") { stack.push(css.slice(pending, i)); pending = i + 1; }
    else if (ch === "}") { stack.pop(); pending = i + 1; }
    else if (ch === ";") pending = i + 1;
  }
  return stack.join(" ");
}

// is the occurrence inside an unclosed color-mix()/…gradient() in its declaration?
function insideColourFn(css, idx) {
  let s = idx;
  while (s > 0 && !";{}".includes(css[s - 1])) s--;
  const chunk = css.slice(s, idx);
  const k = chunk.search(/(?:color-mix|[a-z-]*gradient)\(/);
  if (k === -1) return false;
  let bal = 0;
  for (let i = chunk.indexOf("(", k); i < chunk.length; i++) {
    if (chunk[i] === "(") bal++;
    else if (chunk[i] === ")") bal--;
  }
  return bal > 0;
}

function countRawVarInComponent(styleText) {
  let n = 0;
  const reVar = /var\(\s*--color-[a-z0-9-]+/g;
  let m;
  while ((m = reVar.exec(styleText)) !== null) {
    const idx = m.index;
    // CSS custom-property definition: the declaration key starts with `--`
    let s = idx;
    while (s > 0 && !";{}".includes(styleText[s - 1])) s--;
    if (/^\s*--[\w-]+\s*:/.test(styleText.slice(s, idx))) continue;
    if (insideColourFn(styleText, idx)) continue;
    const sel = selectorStackAt(styleText, idx);
    if (/:deep\(/.test(sel)) continue;   // child component internals
    if (/::[a-z-]/.test(sel)) continue;  // pseudo-element
    if (/@keyframes/.test(sel)) continue; // keyframe step
    n++;
  }
  return n;
}

// Every surviving <style> block must justify its own existence: it opens with
//   /* keep(<tag>): <one line why this cannot be Tailwind> */
// Both `keep(<tag>)` and `keep: <tag>` are accepted — the punctuation is not the
// point, the stated reason is. Sanctioned tags: O2_STYLE_MIGRATION_PLAN.md §3.1
// step 5. `lib-override:<lib>` takes a free-form library suffix, matched by prefix.
const KEEP_TAG_NAMES =
  "lib-override(?::[\\w.-]+)?|generated-content|keyframes|print|scrollbar|complex-state|brand|third-party";
const KEEP_TAGS = new RegExp(`keep\\s*(?:\\(\\s*(?:${KEEP_TAG_NAMES})\\s*\\)|:\\s*(?:${KEEP_TAG_NAMES}))`);

// Counts style blocks that carry no keep-comment. A block with no justification
// is debt by definition — either it should have been migrated to utilities, or
// its author owes one line saying why it could not be.
function countUnjustifiedBlocks(text) {
  let n = 0;
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!KEEP_TAGS.test(m[1])) n++;
  }
  return n;
}

function countFile(file, rel) {
  const text = readFileSync(file, "utf8");
  const counts = {};
  const isVue = rel.endsWith(".vue");
  const isSpec = rel.includes(".spec.");

  if (isVue) {
    // Per-category sanctioned exceptions (same idiom as the .ts allowlists): a file may
    // carry ONE specific bypass for a reason the category cannot express, while every
    // OTHER category still applies to it in full.
    //   • darkMechanism  → DARK_SEAM_ALLOWLIST (ThemeSwitcher is the toggle control; it
    //     cannot be written without a dark flag / a `theme === 'dark'` compare).
    //   • unscopedStyle  → UNSCOPED_STYLE_ALLOWLIST (a block whose selectors must reach
    //     external ancestors — print / fullscreen — physically cannot be scoped).
    const skip = (k) =>
      (k === "darkMechanism" && DARK_SEAM_ALLOWLIST.some((p) => rel.endsWith(p))) ||
      (k === "unscopedStyle" && UNSCOPED_STYLE_ALLOWLIST.some((p) => rel.endsWith(p)));
    // A component `shape="rounded"` prop (BadgeShape = "pill" | "rounded" |
    // "square") is a first-class API value, NOT a bare Tailwind `rounded` radius
    // class — strip these prop bindings before scanning so bareRounded doesn't
    // false-match them. Real `class="… rounded …"` violations are untouched.
    const scan = text.replace(/:?\bshape=(["'])[^"']*\1/g, "");
    for (const [k, re] of Object.entries(WHOLE)) {
      if (skip(k)) continue;
      const n = (scan.match(re) || []).length;
      if (n) counts[k] = n;
    }
    const sb = styleBlocks(text);
    for (const [k, re] of Object.entries(STYLE_ONLY)) {
      const n = (sb.match(re) || []).length;
      if (n) counts[k] = n;
    }
    const rawVar = countRawVarInComponent(sb);
    if (rawVar) counts.rawVarInComponent = rawVar;
    const unjustified = countUnjustifiedBlocks(text);
    if (unjustified) counts.styleKeepComment = unjustified;
  } else {
    // .ts — only tsHex (non-spec, non-allowlisted) and darkMechanism apply.
    // Allowlist entry ending in "/" matches by directory prefix, else by suffix.
    const allowed = TS_HEX_ALLOWLIST.some((p) =>
      p.endsWith("/") ? rel.includes(p) : rel.endsWith(p),
    );
    if (!isSpec && !allowed) {
      // Strip comments first so a hex mentioned in prose ("e.g. #FF0000")
      // doesn't count as a real colour literal.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      const n = (code.match(/['"]#[0-9a-fA-F]{3,8}['"]/g) || []).length;
      if (n) counts.tsHex = n;
    }
    if (!isSpec && !DARK_SEAM_ALLOWLIST.some((p) => rel.endsWith(p))) {
      const n = (text.match(WHOLE.darkMechanism) || []).length;
      if (n) counts.darkMechanism = n;
    }
    // Literal font stacks also leak in via .ts that builds HTML/CSS strings
    // (trace tooltips, chart tooltips) — that surface was ~20 of the original hits.
    if (!isSpec && !FONT_ALLOWLIST.some((p) => rel.endsWith(p))) {
      const n = (text.match(WHOLE.literalFontFamily) || []).length;
      if (n) counts.literalFontFamily = n;
    }
  }
  return counts;
}

const files = walk(SRC_DIR);
const current = {};
for (const f of files) {
  const rel = relative(SRC_DIR, f).split("\\").join("/");
  const c = countFile(f, rel);
  if (Object.keys(c).length) current[rel] = c;
}

if (process.argv.includes("--baseline")) {
  const totals = {};
  for (const c of Object.values(current))
    for (const [k, n] of Object.entries(c)) totals[k] = (totals[k] || 0) + n;
  writeFileSync(BASELINE, JSON.stringify({ totals, files: current }, null, 2) + "\n");
  console.log(`Wrote baseline: ${Object.keys(current).length} files with debt.`);
  console.log("Totals:", JSON.stringify(totals));
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("No baseline found. Run: node scripts/check-design-consistency.mjs --baseline");
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const base = baseline.files || {};

const regressions = [];
let improved = 0;
for (const [rel, c] of Object.entries(current)) {
  for (const [k, n] of Object.entries(c)) {
    const b = (base[rel] && base[rel][k]) || 0;
    if (n > b) regressions.push({ rel, k, n, b });
  }
}
// count improvements (any file/category strictly below baseline, or dropped to 0)
// and record them: in --strict mode a below-baseline count is a STALE baseline,
// i.e. slack the ratchet is leaving open. That slack is exactly where a future
// raw token would land WITHOUT tripping the guard (a file at baseline 5 that has
// since dropped to 2 would silently accept 3 new raw var()s). Closing it makes
// every category monotonically shrink and forbids ANY new raw-token bypass —
// even inside a file that still carries pre-existing debt.
const stale = [];
for (const [rel, bc] of Object.entries(base)) {
  for (const [k, b] of Object.entries(bc)) {
    const n = (current[rel] && current[rel][k]) || 0;
    if (n < b) {
      improved += b - n;
      stale.push({ rel, k, n, b });
    }
  }
}

// --strict (used by CI): the baseline must equal reality — no headroom. Passed
// by `lint:design:strict` in build-pr-image.yml / playwright.yml.
const STRICT = process.argv.includes("--strict");

if (regressions.length) {
  console.error(`\ncheck-design-consistency: ${regressions.length} regression(s) above baseline:\n`);
  for (const { rel, k, n, b } of regressions.slice(0, 60))
    console.error(`  ${rel}  [${k}]  ${b} → ${n}  (+${n - b})`);
  if (regressions.length > 60) console.error(`  …and ${regressions.length - 60} more`);
  console.error(`\nUse the sanctioned utilities/tokens (§4) instead. See DESIGN_TOKEN_STANDARD.md.\n`);
  process.exit(1);
}

if (STRICT && stale.length) {
  console.error(
    `\ncheck-design-consistency (--strict): baseline is STALE — ${stale.length} file/category ` +
      `pair(s) are below their recorded debt, i.e. ${improved} occurrence(s) of slack the\n` +
      `ratchet would let a future raw token silently refill. Lock the win in:\n`,
  );
  for (const { rel, k, n, b } of stale.slice(0, 60))
    console.error(`  ${rel}  [${k}]  ${b} → ${n}  (−${b - n})`);
  if (stale.length > 60) console.error(`  …and ${stale.length - 60} more`);
  console.error(
    `\nRun:  node scripts/check-design-consistency.mjs --baseline   and commit the tightened baseline.\n`,
  );
  process.exit(1);
}

console.log(`OK — no design-consistency regressions (${Object.keys(current).length} files scanned).`);
if (improved)
  console.log(
    `Improved by ${improved} occurrence(s) below baseline — re-run with --baseline and commit the update` +
      (STRICT ? "" : " (required in --strict / CI)") + ".",
  );

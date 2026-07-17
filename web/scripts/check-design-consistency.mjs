#!/usr/bin/env node
// CI ratchet: count per-file occurrences of every design-token bypass category
// from O2_TOKEN_MIGRATION_PLAN.md §3 (A–R). Debt can only shrink.
//
//   node scripts/check-design-consistency.mjs            # fail if any file/category exceeds baseline
//   node scripts/check-design-consistency.mjs --baseline # (re)write design-debt-baseline.json
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

// The two sanctioned dark-mode seams (§3.R.1) — the only files allowed to read
// theme / declare an isDark flag, so they are exempt from the darkMechanism count.
const DARK_SEAM_ALLOWLIST = ["composables/useTheme.ts", "utils/chartTheme.ts"];

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PROPS = "text|bg|border|ring|fill|stroke|divide|outline|decoration|placeholder|from|via|to";

// Categories evaluated over the WHOLE file text.
const WHOLE = {
  rawPalette: new RegExp(`\\b(?:dark:|hover:|focus:|group-hover:|active:)*(?:${PROPS})-(?:${PALETTE})-\\d{2,3}\\b`, "g"),
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
  // Arbitrary radius VALUE — but not a CSS keyword (`rounded-[inherit]` etc.),
  // which is not a hardcoded dimension and has no scale-token equivalent.
  arbRadius: /rounded(?:-[a-z]+)*-\[(?!(?:inherit|initial|unset|revert|revert-layer)\])[^\]]+\]/g,
  arbTextSize: /text-\[[0-9.]+(?:px|rem)\]/g,
  unscopedStyle: /<style(?![^>]*\bscoped\b)[^>]*>/g,
  twPrefix: /\btw:/g,
  quasarUtil: /\b(?:q-(?:pa|pt|pb|pl|pr|px|py|ma|mt|mb|ml|mr|mx|my|gutter)-(?:none|xs|sm|md|lg|xl)|text-weight-[a-z]+)\b/g,
  arbPx: /\b(?:gap|p[trblxy]?|m[trblxy]?|w|h|size|min-w|min-h|max-w|max-h|top|left|right|bottom|inset|leading)-\[[0-9.]+px\]/g,
  arbZ: /\bz-\[[0-9]+\]/g,
  // Dark-mode mechanism fragmentation (§3.R.2 mechanisms 1,2,5,6,7)
  darkMechanism: /theme\s*[=!]==?\s*['"]dark['"]|const\s+(?:isDark|isDarkMode|darkMode)\s*=|\.body--(?:dark|light)|classList\.contains\(['"]body--|\.(?:light|dark)-mode\b/g,
};

// Categories evaluated ONLY inside <style>…</style> blocks (scoped AND unscoped —
// styleBlocks() collects every block regardless of the `scoped` attribute).
const STYLE_ONLY = {
  styleBlockHex: /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g,
  stylePxUnit: /\b(?:[2-9]|[0-9]{2,})(?:\.[0-9]+)?px\b/g, // 1px hairlines exempt
  // Raw `var(--color-*)` inside a component style block (F.6). The consumption
  // ladder wants colours reached via a registered utility, not a raw var() in a
  // <style> block; ~84% of these already have a utility (AUDIT §7). Ratcheted so
  // the count can only shrink — the biggest previously-unmeasured debt surface.
  rawVarInComponent: /var\(\s*--color-[a-z0-9-]+/g,
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
    for (const [k, re] of Object.entries(WHOLE)) {
      const n = (text.match(re) || []).length;
      if (n) counts[k] = n;
    }
    const sb = styleBlocks(text);
    for (const [k, re] of Object.entries(STYLE_ONLY)) {
      const n = (sb.match(re) || []).length;
      if (n) counts[k] = n;
    }
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
for (const [rel, bc] of Object.entries(base)) {
  for (const [k, b] of Object.entries(bc)) {
    const n = (current[rel] && current[rel][k]) || 0;
    if (n < b) improved += b - n;
  }
}

if (regressions.length) {
  console.error(`\ncheck-design-consistency: ${regressions.length} regression(s) above baseline:\n`);
  for (const { rel, k, n, b } of regressions.slice(0, 60))
    console.error(`  ${rel}  [${k}]  ${b} → ${n}  (+${n - b})`);
  if (regressions.length > 60) console.error(`  …and ${regressions.length - 60} more`);
  console.error(`\nUse the sanctioned utilities/tokens (§4) instead. See O2_TOKEN_MIGRATION_PLAN.md.\n`);
  process.exit(1);
}

console.log(`OK — no design-consistency regressions (${Object.keys(current).length} files scanned).`);
if (improved) console.log(`Improved by ${improved} occurrences below baseline — re-run with --baseline and commit the update.`);

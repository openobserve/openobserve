#!/usr/bin/env node
// CI guard: ZERO occurrences of any design-token bypass category from
// O2_TOKEN_MIGRATION_PLAN.md §3 (A–R). One violation fails the build.
//
//   node scripts/check-design-consistency.mjs           # fail on any violation
//   node scripts/check-design-consistency.mjs --list    # show every violation
//
// Replaced a ratchet against design-debt-baseline.json, which allowed debt to
// persist as long as it never grew — every non-zero entry was headroom a future
// bypass could refill silently. `--strict` is accepted and ignored; zero
// tolerance subsumes it. px is owned by eslint's local/no-hardcoded-px.
//
// If this failed: do not add an exemption. Reach the token through its
// registered utility (register one in tokens/semantic.css or component.css if
// none exists), or move the rule to base-elements.css / utilities.css. The
// allowlists below are only for cases a utility physically CANNOT express.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "src");

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
//   • ThemeSwitcher.vue is the toggle control — can't be written without naming
//     "dark" (a `darkMode` flag or `theme === 'dark'` compare), so it's the one
//     canonical home for that decision, not the fragmentation the category targets.
//   • convertLogData.ts reads --color-theme-accent to paint an ECharts canvas bar.
//     applyThemeColors (utils/theme.ts) sets that token on document.body in dark and
//     document.documentElement in light, so the consumer must know which element
//     carries it — a var() can't resolve on a <canvas>.
const DARK_SEAM_ALLOWLIST = [
  "composables/useTheme.ts",
  "utils/chartTheme.ts",
  "utils/themeManager.ts",
  "components/ThemeSwitcher.vue",
  "utils/logs/convertLogData.ts",
];

// Files allowed to keep an UNSCOPED <style> block. Unscoped leaks globally so it's
// debt by default — but a few blocks must reach past the component's own subtree,
// which `scoped` physically can't:
//   • ViewDashboard.vue: its @media print / fullscreen rules target external ancestors
//     (.o2-app-root, main, .o2-content-scroll, .scroll) outside the SFC — unscoped on
//     purpose (carries a keep(complex-state) note).
const UNSCOPED_STYLE_ALLOWLIST = ["views/Dashboards/ViewDashboard.vue"];

// Files allowed to carry a literal font stack. Email markup renders inside a mail
// client, which can load neither our webfont nor our custom properties, so a
// system stack is the correct choice there (FONT_AUDIT.md §5.2).
const FONT_ALLOWLIST = [
  "utils/prebuilt-templates/email.ts",
  "utils/fonts.ts", // defines the fallback stacks the tokens mirror
];

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PROPS = "text|bg|border|ring|fill|stroke|divide|outline|decoration|placeholder|from|via|to";

// Categories evaluated over the WHOLE file text.
const WHOLE = {
  rawPalette: new RegExp(
    `\\b(?:dark:|hover:|focus:|group-hover:|active:)*(?:${PROPS})-(?:${PALETTE})-\\d{2,3}\\b`,
    "g",
  ),
  // PROJECT raw-ramp utilities (Part B, Ring 3): feature code reaching for our own
  // primitives (grey-*/primary-*) instead of semantic tokens. The ramps stay
  // REGISTERED while these consumers exist (un-registering would break them, and
  // migrating is not value-preserving — e.g. accent flips 600→400 in dark), so
  // this ratchet freezes the count: it can only shrink toward the Part-B ideal.
  rawProjectRamp: new RegExp(
    `\\b(?:dark:|hover:|focus:|group-hover:|active:|focus-visible:)*(?:${PROPS}|ring)-(?:grey|primary)-\\d{2,3}\\b`,
    "g",
  ),
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
  unscopedStyle: /<style(?![^>]*\bscoped\b)[^>]*>/g,
  twPrefix: /\btw:/g,
  helperUtil: /\btext-weight-[a-z]+\b/g,
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
  darkMechanism:
    /theme\s*[=!]==?\s*['"]dark['"]|const\s+(?:isDark|isDarkMode|darkMode)\s*=|\.body--(?:dark|light)|classList\.contains\(['"]body--|\.(?:light|dark)-mode\b/g,
};

// Categories evaluated ONLY inside <style>…</style> blocks (scoped AND unscoped —
// styleBlocks() collects every block regardless of the `scoped` attribute).
const STYLE_ONLY = {
  styleBlockHex: /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g,
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
// A raw var(--color-*) in a <style> block is debt ONLY where a utility could
// replace it. Skipped where one physically cannot: inside :deep(), inside
// color-mix()/gradient, a pseudo-element rule, inside @keyframes, or a custom-
// property definition. Judged PER-OCCURRENCE — keep() is mandatory on every
// surviving block, so a block-level exemption would zero the category.

// Blank comment BODIES, preserving byte offsets so every index stays valid.
// Must run BEFORE the scan: a comment sits between the previous `}` and the next
// `{`, so its punctuation is read as selector structure. A keep() comment naming
// ::after / :deep( / @keyframes exempted the rule after it, and a stray `;` or
// `{` in prose reset the stack mid-sentence. Ten occurrences across seven files
// were invisible before this.
function blankComments(css) {
  let out = "";
  for (let i = 0; i < css.length; ) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (css[i] === "/" && css[i + 1] === "/" && css[i - 1] !== ":") {
      // SCSS line comment (`:` guard keeps `https://…` intact)
      const end = css.indexOf("\n", i);
      const stop = end === -1 ? css.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      out += css[i];
      i++;
    }
  }
  return out;
}

// selector-nesting stack (comment-free — see blankComments) at `target`
function selectorStackAt(css, target) {
  const stack = [];
  let pending = 0;
  for (let i = 0; i < target && i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      stack.push(css.slice(pending, i));
      pending = i + 1;
    } else if (ch === "}") {
      stack.pop();
      pending = i + 1;
    } else if (ch === ";") pending = i + 1;
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

// ── rawVarInTemplate ───────────────────────────────────────────────────────
// rawVarInComponent's twin on the template side. Only three shapes count,
// because only these are PROVABLY replaceable:
//   bg-[var(--color-x)]                          -> bg-x
//   bg-[color-mix(… var(--color-x) 12%, transparent)]  -> bg-x/12  (same bytes)
//   bg-[color-mix(… var(--color-x) 12%, var(--color-y))] -> a derived token
// Everything else is exempt — a gradient/mask stop or drop-shadow colour has no
// utility form. Comments are blanked first (a doc comment showing the bad
// pattern is not a violation — KpiCard.vue had one).
// The `(?:\s*,[^)\]]*)?` tails catch the FALLBACK form `bg-[var(--color-x,#fff)]`:
// the token is defined so the fallback never fires, it only hides the read.
// Shipped without that and two occurrences slipped past.
const BARE_READ =
  /[a-zA-Z][a-zA-Z0-9-]*-(?:\[\s*(?:[a-z]+:)?\s*var\(\s*--color-[a-z0-9-]+\s*(?:,[^)\]]*)?\)\s*\]|\(\s*(?:[a-z]+:)?\s*--color-[a-z0-9-]+\s*(?:,[^)\]]*)?\))/g;
const ALPHA_MIX =
  /[a-zA-Z][a-zA-Z0-9-]*-\[color-mix\(in[_ ]srgb,[_ ]?var\(\s*--color-[a-z0-9-]+\s*\)[_ ]+[0-9.]+%[_ ]?,[_ ]?transparent\)\]/g;
const BLEND_MIX =
  /[a-zA-Z][a-zA-Z0-9-]*-\[color-mix\(in[_ ]srgb,[_ ]?var\(\s*--color-[a-z0-9-]+\s*\)[_ ]+[0-9.]+%[_ ]?,[_ ]?var\(\s*--color-[a-z0-9-]+\s*\)\)\]/g;

function countRawVarInTemplate(text) {
  // template + script only; <style> is rawVarInComponent's job
  const cut = text.indexOf("<style");
  const head = blankComments(cut === -1 ? text : text.slice(0, cut)).replace(
    /<!--[\s\S]*?-->/g,
    (m) => m.replace(/[^\n]/g, " "),
  );
  return (
    (head.match(BARE_READ) || []).length +
    (head.match(ALPHA_MIX) || []).length +
    (head.match(BLEND_MIX) || []).length
  );
}

// ── arbShadow ──────────────────────────────────────────────────────────────
// A hand-written shadow in any of the three syntaxes it hides in. The app ships
// one scale (--shadow-xs/sm/md/lg + the sticky/rail/glow/scroll roles) and
// colour is a separate axis, so spelling out offsets/blur is never needed. A
// ring is ring-*. Mirrors arbRadius.
// Template-only scanning was not enough: a pass that fixed the template left 40
// literals in <style> blocks and JS boxShadow: objects, reporting zero throughout.
const ARB_SHADOW =
  /\b(?:inset-)?(?:drop-)?shadow-\[(?!(?:inherit|initial|unset|none)\])[^\]]+\]|\[box-shadow:[^\]]+\]/g;
// Accepted forms: var(--shadow-*), none/inherit/initial/unset, and an
// interpolated ${…} (already a token by then). The (?<![-\w]) lookbehind stops
// a vendor-prefixed -webkit-box-shadow being counted alongside its twin.
const CSS_SHADOW = /(?<![-\w])box-shadow:\s*(?!\s*(?:var\(|none|inherit|initial|unset|\$\{))[^;]+;/g;
// Three JS spellings occur here: `boxShadow:` literal, `x.boxShadow =`, and
// `"box-shadow":` as a quoted key. The first version had only the literal form,
// and the other two sat in OTableBodyCell/useStickyColumns reporting clean.
const JS_SHADOW =
  /(?:boxShadow\s*[:=]|["']box-shadow["']\s*:)\s*(["'`])(?!\s*(?:var\(|none|\$\{))[^"'`]+\1/g;

// Chart libraries and the email template serialise their own style strings —
// ECharts options and mail markup cannot resolve a CSS custom property, so a
// literal is the only option there. Same rationale as TS_HEX_ALLOWLIST.
const SHADOW_LITERAL_ALLOWLIST = [
  "utils/prebuilt-templates/email.ts",
  "utils/dashboard/",
  "components/dashboards/PanelSchemaRenderer.vue",
  "plugins/traces/ServiceGraph.vue",
];

function countArbShadow(text, rel = "") {
  if (SHADOW_LITERAL_ALLOWLIST.some((p) => (p.endsWith("/") ? rel.includes(p) : rel.endsWith(p)))) {
    return 0;
  }
  const blanked = blankComments(text).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  return (
    (blanked.match(ARB_SHADOW) || []).length +
    (blanked.match(CSS_SHADOW) || []).length +
    (blanked.match(JS_SHADOW) || []).length
  );
}

function countRawVarInComponent(rawStyleText) {
  const styleText = blankComments(rawStyleText);
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
    if (/:deep\(/.test(sel)) continue; // child component internals
    if (/::[a-z-]/.test(sel)) continue; // pseudo-element
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
const KEEP_TAGS = new RegExp(
  `keep\\s*(?:\\(\\s*(?:${KEEP_TAG_NAMES})\\s*\\)|:\\s*(?:${KEEP_TAG_NAMES}))`,
);

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
    // Per-category sanctioned exceptions (like the .ts allowlists): a file may carry
    // ONE specific bypass the category can't express, while every OTHER category
    // still applies in full.
    //   • darkMechanism → DARK_SEAM_ALLOWLIST (ThemeSwitcher, the toggle control).
    //   • unscopedStyle → UNSCOPED_STYLE_ALLOWLIST (selectors that must reach external
    //     ancestors — print / fullscreen — can't be scoped).
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
    const rawTpl = countRawVarInTemplate(text);
    if (rawTpl) counts.rawVarInTemplate = rawTpl;
    const arbShadow = countArbShadow(text, rel);
    if (arbShadow) counts.arbShadow = arbShadow;
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
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      const n = (code.match(/['"]#[0-9a-fA-F]{3,8}['"]/g) || []).length;
      if (n) counts.tsHex = n;
    }
    if (!isSpec) {
      const n = countArbShadow(text, rel);
      if (n) counts.arbShadow = n;
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

// Flatten to (file, category, count). Zero tolerance — any entry fails the build.
const violations = [];
for (const [rel, c] of Object.entries(current))
  for (const [k, n] of Object.entries(c)) violations.push({ rel, k, n });
violations.sort((a, b) => b.n - a.n || a.rel.localeCompare(b.rel));
const total = violations.reduce((sum, v) => sum + v.n, 0);
const fileCount = Object.keys(current).length;

if (process.argv.includes("--list")) {
  for (const { rel, k, n } of violations) console.log(`  ${rel}  [${k}]  ${n}`);
  console.log(`\n${total} violation(s) across ${fileCount} file(s).`);
  process.exit(0);
}

if (violations.length) {
  console.error(
    `\ncheck-design-consistency: ${total} design-token bypass(es) in ${fileCount} file(s):\n`,
  );
  for (const { rel, k, n } of violations.slice(0, 60)) console.error(`  ${rel}  [${k}]  ${n}`);
  if (violations.length > 60) {
    console.error(`  …and ${violations.length - 60} more (--list to see all)`);
  }
  console.error(
    "\nReach the token through its registered utility (bg-x / text-x / border-x), or" +
      "\nmove the rule to src/styles/base-elements.css or src/styles/utilities.css." +
      "\nDo not add an exemption. See DESIGN_TOKEN_STANDARD.md §4.\n",
  );
  process.exit(1);
}

console.log(`OK — no design-token bypasses (${files.length} files scanned).`);

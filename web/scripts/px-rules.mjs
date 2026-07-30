// Shared rules for the `local/no-hardcoded-px` eslint rule (eslint.config.js).
//
// Sizing is authored in rem so the UI honours the reader's browser font-size
// (WCAG 1.4.4). 1rem = 16px, so px/16 = rem and px/4 = the Tailwind scale step.
//
// Kept in its own module, not inlined into eslint.config.js, so there is exactly one
// definition of "is this px allowed?" — an earlier second copy drifted out of sync.

// Whole files where the CONSUMER cannot resolve a relative unit, so px is the only
// option: a detached measurement <canvas>, ECharts options (serialised, no cascade),
// a standalone HTML email (rem resolves against the recipient's mail client), numeric
// JS layout-lib APIs, SVG geometry attributes, and <img width>/<img height>.
// Entries ending in "/" match by directory prefix; others by suffix.
export const PX_FILE_ALLOWLIST = [
  "utils/prebuilt-templates/email.ts",
  "utils/fonts.ts",
  "utils/dashboard/",
  "composables/dashboard/",
  "utils/traces/treeVisualizationEngine.ts",
  "views/Dashboards/RenderDashboardCharts.vue",
  "components/icons/DynamicFilterIcon.vue",
  "components/icons/SlackIcon.vue",
  "components/common/O2AIContextAddBtn.vue",
  // Mobile session replay reproduces wireframes the SDK recorded in device pixels
  // (dp). These are measurements of someone else's screen being replayed faithfully,
  // not sizes we design — scaling them with the viewer's font-size would distort the
  // recording.
  "composables/rum/useMobileSessionReplay.ts",
];

// `px(?![a-zA-Z0-9])`, not `px\b`: `_` is a word char, and Tailwind uses `_` for the
// space inside arbitrary values, so `\b` skips the first value of `p-[8px_12px]`.
export const PX_LITERAL = /(?<![a-zA-Z0-9.])(\d+(?:\.\d+)?)px(?![a-zA-Z0-9])/g;

/**
 * Is this px occurrence one of the sanctioned kinds? Judged per-occurrence from the
 * surrounding text, since the same number is legal or not depending on what it sizes.
 */
export const pxIsAllowed = (text, index, raw) => {
  const value = parseFloat(raw);
  const before = text.slice(Math.max(0, index - 160), index);

  // Tracking is typographic — it must scale with the type, so it never earns the
  // sub-pixel exemption. Checked first: tracking values are routinely < 1px.
  const isTracking =
    /(?:letter-spacing|word-spacing)["']?\s*:[^;{}]*$/i.test(before) ||
    /\btracking-\[[^\]]*$/.test(before);

  // Hairlines and sub-pixel geometry: a 1-device-pixel rule must not scale with text
  // or it smears at non-integer zoom/DPR. Covers half-hairline alignment offsets
  // (0.75px) and gradient dot radii. `>= 9999` is the fully-rounded sentinel.
  if (!isTracking && (value <= 1.5 || value >= 9999)) return true;

  // Layout-chrome height subtracted from 100vh. Nothing sizes the chrome FROM the
  // token, so it is a guess about it; converting leaves one half of the subtraction
  // tracking the window and the other tracking font-size. Remove once those layouts
  // use flex-fill instead of viewport arithmetic.
  if (/--(?:navbar|header|footer|toolbar|statusbar)-height\s*:[^;{}]*$/.test(before)) return true;

  // Optical effects, not layout: shadow offsets, ring/border/outline widths, blur
  // radii. Scaling these with text makes elevation bloom.
  if (
    /(?:shadow|drop-shadow|ring|ring-offset|border(?:-[trblxyse]{1,2})?|outline|divide(?:-[xy])?|blur|backdrop-blur)-\[[^\]]*$/.test(
      before,
    )
  )
    return true;
  // …as a declaration. /i because JS style objects write `boxShadow:`, not `box-shadow:`.
  if (
    /(?:box-?shadow|text-?shadow|drop-?shadow|--[a-z-]*shadow[a-z-]*|blur)["']?\s*:[^;{}]*$/i.test(
      before,
    )
  )
    return true;
  // …as a variable, where there is no property name to match on:
  //   const shadowRight = "4px 0 8px rgba(0,0,0,.15)"
  if (/\b[\w$]*[Ss]hadow[\w$]*\s*[=:]\s*[`"'][^`"']*$/.test(before)) return true;
  // …as an imperative assignment: el.style.boxShadow = "2px 0 4px …"
  if (/\.(?:box|text|drop)?[Ss]hadow\s*=\s*[^;]*$/.test(before)) return true;
  if (/\.style\.(?:boxShadow|textShadow|filter)\s*=\s*[^;]*$/.test(before)) return true;
  // …as a filter function: blur(10px), drop-shadow(0 1px 2px …)
  if (/(?:drop-shadow|blur)\([^)]*$/.test(before)) return true;

  // Border/outline WIDTH, incl. the `border: 2px solid …` shorthand. Structural, not a
  // text-relative dimension. `border-radius` is deliberately NOT matched — a corner
  // radius IS a dimension and belongs on the rem scale (--radius-* tokens exist).
  if (
    /border(?:-(?:top|right|bottom|left|inline|block|start|end)(?:-(?:start|end))?)?(?:-width)?["']?\s*:[^;{}]*$/i.test(
      before,
    )
  )
    return true;
  if (/outline(?:-width)?["']?\s*:[^;{}]*$/i.test(before)) return true;

  // Forwarded to <img width>/<img height> — HTML dimension attributes take a bare
  // integer, so a CSS unit is invalid markup there.
  if (/\bimage(?:Width|Height)["']?\s*=?\s*["'{]?[^;{}]*$/.test(before)) return true;

  // Query conditions are thresholds, not rendered lengths.
  if (/@media|@container/.test(before.slice(before.lastIndexOf("\n") + 1))) return true;
  if (/@?(?:max|min)(?:-[a-z]+)?-\[[^\]]*$/.test(before)) return true;

  // Prose *about* a size, not a size being applied — converting it rewrites the sentence,
  // usually into a falsehood. Narrow by design: px inside an unclosed `<tag …` still reports.
  if (
    /(?:content|placeholder|label|title|aria-label|description|hint|message|caption|subtitle)\s*=\s*["'][^"']*$/i.test(
      before,
    )
  )
    return true;
  // …a template text node: on this line the last tag closed and no new one opened.
  if (/>[^<>]*$/.test(before.slice(before.lastIndexOf("\n") + 1))) return true;

  // IntersectionObserver rootMargin. The API parses px and % ONLY — a rem value
  // throws SyntaxError from the constructor, killing the observer and whatever it
  // gates (lazy-load, prefetch-ahead-of-fold). Like a query condition, it is a
  // scroll threshold rather than a rendered length.
  if (/rootMargin["']?\s*:\s*[^,}]*$/.test(before)) return true;

  // `calc(var(--x) * 1px)` — a unit-conversion operator on a unitless JS value.
  if (/\*\s*$/.test(before)) return true;

  // Gradient colour stop — paint geometry. Needs a much wider lookback than `before`:
  // a Tailwind arbitrary gradient with nested color-mix() runs past 160 chars, and a
  // truncated window can slice the keyword in half ("…radient(45deg,"), which makes
  // the search miss and silently skips this check.
  {
    const wide = text.slice(Math.max(0, index - 900), index);
    const g = wide.search(/(?:repeating-)?(?:linear|radial|conic)-gradient\(/);
    if (g !== -1) {
      let depth = 0;
      for (let i = wide.indexOf("(", g); i < wide.length; i++) {
        if (wide[i] === "(") depth++;
        else if (wide[i] === ")") depth--;
      }
      if (depth > 0) return true;
    }
  }

  // Mixed with a viewport unit on the same line — `calc(100vh - 130px)`. vh/vw track
  // the window while rem tracks font-size, so converting one term makes the result
  // depend on two independent variables. Keep the whole expression unit-consistent.
  {
    const lineStart = text.lastIndexOf("\n", index) + 1;
    let lineEnd = text.indexOf("\n", index);
    if (lineEnd === -1) lineEnd = text.length;
    if (/\d+v[hw]\b/.test(text.slice(lineStart, lineEnd))) return true;
  }

  return false;
};

// Blank comment bodies, preserving offsets so the context checks above stay valid.
// Comments are not debt: the token files annotate rem with its px equivalent on
// purpose (`--text-xs: 0.75rem; /* 12px */`).
export const maskCommentsForPx = (text) => {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
};

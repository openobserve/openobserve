import fs from "node:fs";
import path from "node:path";
import { formatBytes, pctDelta } from "./lib/util.mjs";

// Renders a self-contained, theme-aware HTML report comparing baseline vs
// current across every measured dimension, with signed deltas.

const ms = (v) => (v == null ? "—" : `${Math.round(v)} ms`);
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const num = (v) => (v == null ? "—" : Math.round(v).toLocaleString());

// direction: "lower" = lower is better, "higher" = higher is better.
function deltaCell(base, cur, direction = "lower") {
  const d = pctDelta(base, cur);
  if (d == null) return `<td class="delta">—</td>`;
  const improved = direction === "lower" ? d < 0 : d > 0;
  const cls = Math.abs(d) < 1 ? "flat" : improved ? "good" : "bad";
  const sign = d > 0 ? "+" : "";
  return `<td class="delta ${cls}">${sign}${d.toFixed(1)}%</td>`;
}

function row(label, base, cur, fmt, direction) {
  return `<tr><th>${label}</th><td>${fmt(base)}</td><td>${fmt(cur)}</td>${deltaCell(
    base,
    cur,
    direction,
  )}</tr>`;
}

function section(title, subtitle, bodyHtml) {
  return `<section><h2>${title}</h2>${
    subtitle ? `<p class="sub">${subtitle}</p>` : ""
  }${bodyHtml}</section>`;
}

function table(rowsHtml, headers = ["Metric", "Baseline (Quasar)", "Current (reka)", "Δ"]) {
  return `<table><thead><tr>${headers
    .map((h, i) => `<th class="${i > 0 ? "numcol" : ""}">${h}</th>`)
    .join("")}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function bundleSection(base, cur) {
  if (!base?.bundle && !cur?.bundle) return "";
  const b = base?.bundle, c = cur?.bundle;
  const g = (o, k) => o?.totals?.[k]?.gzip;
  const rows = [
    row("Total JS (gzip)", g(b, "js"), g(c, "js"), formatBytes),
    row("Total CSS (gzip)", g(b, "css"), g(c, "css"), formatBytes),
    row("Total assets (gzip)", g(b, "all"), g(c, "all"), formatBytes),
    row("Total assets (brotli)", b?.totals?.all?.brotli, c?.totals?.all?.brotli, formatBytes),
    row("Total assets (raw)", b?.totals?.all?.raw, c?.totals?.all?.raw, formatBytes),
    row("Initial entry payload (gzip)", b?.initial?.gzip, c?.initial?.gzip, formatBytes),
    row("Asset file count", b?.totals?.all?.count, c?.totals?.all?.count, num),
    row("Quasar weight (gzip)", byCat(b, "quasar"), byCat(c, "quasar"), formatBytes),
    row("reka-ui weight (gzip)", byCat(b, "reka-ui"), byCat(c, "reka-ui"), formatBytes),
  ].join("");
  return section(
    "📦 Bundle size",
    "Production build, compressed transfer sizes. Lower is better.",
    table(rows),
  );
}
const byCat = (o, cat) => o?.byCategory?.[cat]?.gzip ?? (o?.bundle ? 0 : null);

function lighthouseSection(base, cur) {
  const routes = collectRoutes(base?.lighthouse, cur?.lighthouse);
  if (!routes.length) return "";
  const blocks = routes.map((rid) => {
    const b = base?.lighthouse?.[rid]?.medians;
    const c = cur?.lighthouse?.[rid]?.medians;
    const label = cur?.lighthouse?.[rid]?.label || base?.lighthouse?.[rid]?.label || rid;
    const rows = [
      row("Performance score", b?.performance, c?.performance, pct, "higher"),
      row("Accessibility score", b?.accessibility, c?.accessibility, pct, "higher"),
      row("Best-practices score", b?.bestPractices, c?.bestPractices, pct, "higher"),
      row("First Contentful Paint", b?.fcp, c?.fcp, ms),
      row("Largest Contentful Paint", b?.lcp, c?.lcp, ms),
      row("Total Blocking Time", b?.tbt, c?.tbt, ms),
      row("Cumulative Layout Shift", b?.cls, c?.cls, (v) => (v == null ? "—" : v.toFixed(3))),
      row("Speed Index", b?.speedIndex, c?.speedIndex, ms),
      row("Time to Interactive", b?.tti, c?.tti, ms),
      row("JS bootup time", b?.bootupTime, c?.bootupTime, ms),
      row("Main-thread work", b?.mainThreadWork, c?.mainThreadWork, ms),
    ].join("");
    return `<h3>${label}</h3>${table(rows)}`;
  });
  return section(
    "🚦 Lighthouse (median of N runs)",
    "Lab metrics under fixed CPU throttling. Scores: higher is better; times: lower is better.",
    blocks.join(""),
  );
}

function runtimeSection(base, cur) {
  const routes = collectRoutes(base?.runtime, cur?.runtime);
  if (!routes.length) return "";
  const blocks = routes.map((rid) => {
    const b = base?.runtime?.[rid]?.timings;
    const c = cur?.runtime?.[rid]?.timings;
    const label = cur?.runtime?.[rid]?.label || rid;
    const rows = [
      row("TTFB", b?.ttfb, c?.ttfb, ms),
      row("First Contentful Paint", b?.firstContentfulPaint, c?.firstContentfulPaint, ms),
      row("DOM Interactive", b?.domInteractive, c?.domInteractive, ms),
      row("DOMContentLoaded", b?.domContentLoaded, c?.domContentLoaded, ms),
      row("Load event", b?.loadEvent, c?.loadEvent, ms),
      row("JS heap used", b?.jsHeapUsed, c?.jsHeapUsed, formatBytes),
      row("Resource count", b?.resourceCount, c?.resourceCount, num),
    ].join("");
    return `<h3>${label}</h3>${table(rows)}`;
  });
  return section(
    "⚡ Runtime load (Playwright, median)",
    "Real navigation & paint timings against live data.",
    blocks.join(""),
  );
}

function axeSection(base, cur) {
  const routes = collectRoutes(base?.runtime, cur?.runtime);
  const withAxe = routes.filter((r) => base?.runtime?.[r]?.axe || cur?.runtime?.[r]?.axe);
  if (!withAxe.length) return "";
  const rows = withAxe
    .map((rid) => {
      const b = base?.runtime?.[rid]?.axe;
      const c = cur?.runtime?.[rid]?.axe;
      const label = cur?.runtime?.[rid]?.label || rid;
      return `<tr><th>${label}</th><td>${axeCell(b)}</td><td>${axeCell(c)}</td>${deltaCell(
        b?.totalNodes,
        c?.totalNodes,
        "lower",
      )}</tr>`;
    })
    .join("");
  return section(
    "♿ Accessibility (axe-core WCAG 2.1 A/AA)",
    "Violation count (affected nodes). Fewer is better.",
    table(rows, ["Route", "Baseline violations", "Current violations", "Δ nodes"]),
  );
}
function axeCell(a) {
  if (!a) return "—";
  const s = a.bySeverity || {};
  return `<b>${a.count}</b> rules / ${a.totalNodes} nodes<br><span class="sev">crit ${s.critical || 0} · serious ${s.serious || 0} · mod ${s.moderate || 0} · minor ${s.minor || 0}</span>`;
}

function shortcutsSection(base, cur) {
  if (!base?.shortcuts && !cur?.shortcuts) return "";
  const b = base?.shortcuts, c = cur?.shortcuts;
  const bool = (v) => (v ? "✅ yes" : "❌ no");
  const rows = [
    `<tr><th>Central shortcut registry</th><td>${bool(b?.hasRegistry)}</td><td>${bool(c?.hasRegistry)}</td><td>—</td></tr>`,
    `<tr><th>Shortcut cheatsheet UI</th><td>${bool(b?.hasCheatsheet)}</td><td>${bool(c?.hasCheatsheet)}</td><td>—</td></tr>`,
    row("Registered shortcuts", b?.registeredShortcuts, c?.registeredShortcuts, num, "higher"),
    row("Files with keydown handling", b?.keydownFiles, c?.keydownFiles, num, "higher"),
    row("aria-keyshortcuts usages", b?.ariaKeyshortcuts, c?.ariaKeyshortcuts, num, "higher"),
  ].join("");
  return section(
    "⌨️ Keyboard shortcuts & accessibility (feature coverage)",
    "Static source analysis. More is better — this capability was largely absent in the Quasar baseline.",
    table(rows),
  );
}

function collectRoutes(a, b) {
  return [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
}

export function generateReport(results, outPath) {
  const base = results.baseline;
  const cur = results.current;
  const meta = `
    <div class="meta">
      <div><span>Baseline</span>${base?.label || "—"}<code>${base?.ref || ""} ${base?.short || ""}</code></div>
      <div><span>Current</span>${cur?.label || "—"}<code>${cur?.ref || ""} ${cur?.short || ""}</code></div>
      <div><span>Generated</span>${new Date().toISOString()}</div>
    </div>`;

  const errors = ["baseline", "current"]
    .filter((k) => results[k]?.error)
    .map((k) => `<div class="err">⚠ ${k} run failed: ${results[k].error}</div>`)
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenObserve Web — Quasar → reka benchmark</title>
<style>${CSS}</style></head><body>
<header><h1>OpenObserve Web Frontend Benchmark</h1>
<p class="lead">Quasar → reka-ui + custom O2 components</p>${meta}</header>
<main>${errors}
${bundleSection(base, cur)}
${lighthouseSection(base, cur)}
${runtimeSection(base, cur)}
${axeSection(base, cur)}
${shortcutsSection(base, cur)}
</main>
<footer>Green = improvement · Red = regression · Δ is current relative to baseline.</footer>
</body></html>`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  return outPath;
}

const CSS = `
:root{--bg:#fff;--fg:#1a1d23;--muted:#6b7280;--line:#e5e7eb;--card:#f9fafb;--good:#0f9d58;--bad:#d93025;--accent:#0ea5a4}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#232a33;--card:#161b22;--good:#3fb950;--bad:#f85149;--accent:#2dd4bf}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:32px 24px 20px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:24px}.lead{margin:4px 0 16px;color:var(--accent);font-weight:600}
.meta{display:flex;flex-wrap:wrap;gap:20px;font-size:13px}
.meta>div{display:flex;flex-direction:column}.meta span{color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.04em}
.meta code{color:var(--muted);font-size:12px}
main{max-width:920px;margin:0 auto;padding:24px}
section{margin:0 0 40px}h2{font-size:18px;border-bottom:1px solid var(--line);padding-bottom:8px}
h3{font-size:14px;color:var(--muted);margin:20px 0 6px}
.sub{color:var(--muted);font-size:13px;margin:-4px 0 12px}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:14px;overflow-x:auto;display:block}
@media(min-width:640px){table{display:table}}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
thead th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
tbody th{font-weight:500}td{font-variant-numeric:tabular-nums}
td.numcol,.numcol{text-align:right}
.delta{text-align:right;font-weight:600}.delta.good{color:var(--good)}.delta.bad{color:var(--bad)}.delta.flat{color:var(--muted)}
.sev{color:var(--muted);font-size:11px}
.err{background:color-mix(in srgb,var(--bad) 12%,transparent);border:1px solid var(--bad);padding:10px 14px;border-radius:8px;margin-bottom:20px}
footer{max-width:920px;margin:0 auto;padding:16px 24px 48px;color:var(--muted);font-size:12px;border-top:1px solid var(--line)}
`;

#!/usr/bin/env node
// Copyright 2026 OpenObserve Inc.
/**
 * classify-specs.js — the Playwright→pytest migration classifier + anti-drift guard.
 *
 * Statically classifies Playwright `*.spec.js` files as UI-driven vs pure-API,
 * so that:
 *   1. the migration inventory can be re-generated on demand (`--all`), and
 *   2. CI can flag a NEWLY-added pure-API spec (`--check <files...>`) that
 *      should have been authored in pytest (`tests/api-testing/`) instead —
 *      preventing the drift this whole project set out to undo.
 *
 * A spec is:
 *   PURE_API  — has API markers AND no UI markers  → belongs in pytest
 *   UI+SETUP  — has UI markers AND API markers      → stays (API is plumbing)
 *   UI_ONLY   — has UI markers, no API markers       → stays
 *   REVIEW    — no markers matched                   → human confirm
 *
 * Classification is marker-based and intentionally conservative: a spec is only
 * PURE_API when NOT A SINGLE UI marker appears, so
 * the guard never nags a genuine UI test. False "REVIEW" is preferred to a false
 * "PURE_API". Detection is whole-file regex matching over comment-stripped source.
 *
 * Usage (--json emits machine-readable output in any mode):
 *   node classify-specs.js --all [--json]        scan every spec, print summary
 *   node classify-specs.js --check <files...>    exit 1 if any file is PURE_API
 *                                                (also warns, non-fatally, on REVIEW)
 *   node classify-specs.js <files...>            classify just those files
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SPECS_ROOT = path.resolve(__dirname, '..', 'playwright-tests');

// UI markers — anything that drives or asserts on the rendered browser.
const UI_MARKERS = [
  /\bpage\.goto\b/,
  /\bpage\.locator\b/,
  /\bpage\.getBy[A-Z]\w+/,
  /\bpage\.waitForSelector\b/,
  /\bpage\.click\b/,
  /\bpage\.fill\b/,
  /\.click\s*\(/,
  /\.fill\s*\(/,
  /\.hover\s*\(/,
  /\.press\s*\(/,
  /\.selectOption\s*\(/,
  /\blocator\s*\(/,
  /\bgetByRole\b/,
  /\bgetByText\b/,
  /\bgetByTestId\b/,
  /\bgetByLabel\b/,
  /\bgetByPlaceholder\b/,
  /\btoBeVisible\b/,
  /\btoBeHidden\b/,
  /\btoHaveText\b/,
  /\btoContainText\b/,
  /\bnavigateToBase\b/,
  /\bnavigateTo\w+/, // navigateToLogs / navigateToDashboards / ...
  /\.goto\s*\(/, // page.goto OR a page-object's .goto() (login flows)
  /\bpm\.\w+Page\b/, // page-object usage (pm.logsPage, pm.alertsPage, ...)
  /\bpm\.(dashboardPanelActions|chartTypeSelector|dashboard\w*|panel\w*)\b/i, // dashboard page objects
  /\bpage\.waitFor(LoadState|Timeout|Navigation|URL|Selector|Function)\b/,
  /\bwaitFor(DashboardPage|ChartToRender|DateTime\w*|Panel\w*|Visualize\w*)\b/,
  /\b(savePanel|searchAndAddField|applyDashboardBtn)\b/, // dashboard-builder actions
  /\bpage\.screenshot\b/,
  // Importing a page object (PascalCase `...Page.js` under pages/) is a UI
  // signal even when the spec delegates every interaction to it and shows no
  // raw markers of its own. Case-sensitive `Page` so the `page-manager` API
  // aggregator (lowercase) is NOT swept in.
  /require\(['"][^'"]*pages\/[^'"]*Page[^'"]*['"]\)/,
  /\bnew \w*Page\s*\(/, // `new CloudLoginPage(page)` etc.
];

// API markers — direct backend calls or api-helper plumbing.
const API_MARKERS = [
  /\bpage\.request\b/,
  /\bauthedRequest\b/,
  /\bgetAuthHeaders\b/,
  /\brequest\.(get|post|put|delete|patch)\b/,
  /\bfetch\s*\(/, // raw fetch()
  /\baxios\b/,
  /\bXMLHttpRequest\b/,
  /\/_json\b/,
  /\/_search\b/,
  /\/_bulk\b/,
  /-api-helpers/, // import of a shared api-helper module
];

function classifyText(raw) {
  // Strip block + line comments so doc references to markers don't miscount.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
  const ui = UI_MARKERS.filter((re) => re.test(src)).length;
  const api = API_MARKERS.filter((re) => re.test(src)).length;
  let verdict;
  if (ui > 0 && api > 0) verdict = 'UI+SETUP';
  else if (ui > 0) verdict = 'UI_ONLY';
  else if (api > 0) verdict = 'PURE_API';
  else verdict = 'REVIEW';
  return { verdict, ui, api };
}

function classifyFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return { file, ...classifyText(raw) };
}

function walkSpecs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSpecs(p));
    else if (entry.name.endsWith('.spec.js')) out.push(p);
  }
  return out;
}

function rel(file) {
  return path.relative(SPECS_ROOT, path.resolve(file));
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const check = args.includes('--check');
  const all = args.includes('--all');
  const files = args.filter((a) => !a.startsWith('--'));

  let targets;
  if (all) {
    targets = walkSpecs(SPECS_ROOT);
  } else if (files.length) {
    // Only classify spec files that still exist (skip deletions in a diff).
    targets = files
      .map((f) => path.resolve(f))
      .filter((f) => f.endsWith('.spec.js') && fs.existsSync(f));
  } else {
    console.error('usage: classify-specs.js --all [--json] | --check <files...> | <files...>');
    process.exit(2);
  }

  const results = targets.map(classifyFile).sort((a, b) => a.file.localeCompare(b.file));

  if (json) {
    console.log(JSON.stringify(results.map((r) => ({ ...r, file: rel(r.file) })), null, 2));
  } else if (all) {
    const counts = { UI_ONLY: 0, 'UI+SETUP': 0, PURE_API: 0, REVIEW: 0 };
    for (const r of results) counts[r.verdict]++;
    console.log(`Scanned ${results.length} specs under ${path.basename(SPECS_ROOT)}/\n`);
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(9)} ${v}`);
    console.log('\nPURE_API (candidates to migrate to pytest):');
    const pure = results.filter((r) => r.verdict === 'PURE_API');
    if (!pure.length) console.log('  (none)');
    for (const r of pure) console.log(`  - ${rel(r.file)}`);
    console.log('\nREVIEW (no markers matched — confirm by hand):');
    const rev = results.filter((r) => r.verdict === 'REVIEW');
    if (!rev.length) console.log('  (none)');
    for (const r of rev) console.log(`  - ${rel(r.file)}`);
  } else {
    for (const r of results) console.log(`${r.verdict.padEnd(9)} ${rel(r.file)}  (ui=${r.ui} api=${r.api})`);
  }

  if (check) {
    // REVIEW = no markers matched. Non-fatal, but surface it: a spec hitting the
    // API through a helper we don't recognise would land here and otherwise pass
    // behind a green message with false confidence.
    const review = results.filter((r) => r.verdict === 'REVIEW');
    if (review.length) {
      console.warn(
        `⚠ ${review.length} spec(s) matched no UI or API markers (REVIEW) — confirm by ` +
          `hand they are not API-only (a pure-API test belongs in tests/api-testing/):\n` +
          review.map((r) => `    - ${rel(r.file)}`).join('\n'),
      );
    }
    const pure = results.filter((r) => r.verdict === 'PURE_API');
    if (pure.length) {
      console.error(
        `\n✖ ${pure.length} pure-API Playwright spec(s) detected. Pure backend/API tests belong in ` +
          `the pytest suite (tests/api-testing/), not the browser harness:\n` +
          pure.map((r) => `    - ${rel(r.file)}`).join('\n') +
          `\n\nEither author the test under tests/api-testing/ (pytest), or — if it genuinely ` +
          `drives the UI — add the interaction so it is not a pure-API spec.`,
      );
      process.exit(1);
    }
    console.log('✓ no pure-API Playwright specs in the checked set');
  }
}

main();

import { chromium } from "playwright";
import { median, sleep } from "./util.mjs";

// Drives real routes in a headless Chromium (authenticated via storageState)
// and captures navigation + paint timings, JS heap, and a few interaction
// latencies on the migrated components. Runs each route `repeats` times and
// reports medians. Accessibility (axe) is measured here too, in the same pass.
export async function measureRuntime({
  origin,
  baseUrl,
  storagePath,
  routes,
  axeSource,
  repeats = 3,
}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1024 },
    storageState: storagePath,
  });

  const out = {};
  for (const route of routes) {
    const url = origin + baseUrl.replace(origin, "") + route.path;
    const full = origin + "/web/" + route.path;
    const runs = [];
    let axeResult = null;
    let interaction = null;

    for (let i = 0; i < repeats; i++) {
      const page = await context.newPage();
      try {
        const nav = await gotoAndTime(page, full);
        runs.push(nav);
        // Only run the heavier axe + interaction probes once (first run).
        if (i === 0) {
          if (axeSource) axeResult = await runAxe(page, axeSource).catch(() => null);
          interaction = await probeInteractions(page).catch(() => null);
        }
      } catch (e) {
        runs.push({ error: e.message });
      } finally {
        await page.close();
      }
    }

    out[route.id] = {
      label: route.label,
      url: full,
      timings: aggregateTimings(runs),
      axe: axeResult,
      interaction,
    };
  }

  await context.close();
  await browser.close();
  return out;
}

// Navigate and pull Navigation Timing + paint + heap for one load.
async function gotoAndTime(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Let the SPA settle (data fetches, first meaningful render).
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await sleep(500);

  const metrics = await page.evaluate(() => {
    const navEntry = performance.getEntriesByType("navigation")[0] || {};
    const paints = {};
    for (const p of performance.getEntriesByType("paint")) paints[p.name] = p.startTime;
    // LCP via buffered observer (already resolved by now on most loads).
    const mem = performance.memory || {};
    return {
      ttfb: navEntry.responseStart ?? null,
      domContentLoaded: navEntry.domContentLoadedEventEnd ?? null,
      loadEvent: navEntry.loadEventEnd ?? null,
      domInteractive: navEntry.domInteractive ?? null,
      firstPaint: paints["first-paint"] ?? null,
      firstContentfulPaint: paints["first-contentful-paint"] ?? null,
      transferSize: navEntry.transferSize ?? null,
      resourceCount: performance.getEntriesByType("resource").length,
      jsHeapUsed: mem.usedJSHeapSize ?? null,
    };
  });
  return metrics;
}

function aggregateTimings(runs) {
  const ok = runs.filter((r) => !r.error);
  if (!ok.length) return { error: runs[0]?.error || "all runs failed", runs };
  const keys = Object.keys(ok[0]);
  const agg = {};
  for (const k of keys) agg[k] = median(ok.map((r) => r[k]));
  agg._runs = ok.length;
  return agg;
}

// Inject axe-core (source passed in) and run it against the current page.
async function runAxe(page, axeSource) {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return {
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
      })),
    };
  });
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let totalNodes = 0;
  for (const v of results.violations) {
    if (bySeverity[v.impact] != null) bySeverity[v.impact] += 1;
    totalNodes += v.nodes;
  }
  return { count: results.violations.length, totalNodes, bySeverity, violations: results.violations };
}

// A few lightweight interaction-latency probes on migrated components. Each is
// best-effort and guarded — a missing selector just yields null, never a crash.
async function probeInteractions(page) {
  const result = {};

  // 1) Keyboard reachability: how many interactive elements are focusable via
  // Tab from the top of the page (accessibility signal).
  result.tabReachable = await page
    .evaluate(async () => {
      const focusables = document.querySelectorAll(
        'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],[role="tab"],[role="menuitem"]',
      );
      const visible = [...focusables].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return visible.length;
    })
    .catch(() => null);

  // 2) Dialog/menu open latency — click the first obvious trigger and time
  // until an overlay/dialog appears.
  result.overlayOpenMs = await timeOverlay(page).catch(() => null);

  return result;
}

async function timeOverlay(page) {
  const trigger = page
    .locator(
      '[data-test*="dropdown"],[data-test*="menu"],[aria-haspopup="true"],button[aria-expanded]',
    )
    .first();
  if (!(await trigger.count())) return null;
  const t0 = await page.evaluate(() => performance.now());
  await trigger.click({ timeout: 5000 }).catch(() => {});
  await page
    // Cover both stacks: reka/radix poppers AND Quasar's .q-menu/.q-dialog, so
    // the baseline isn't just timing out on a selector it never matches.
    .locator(
      '[role="dialog"],[role="menu"],[role="listbox"],[data-reka-popper-content-wrapper],[data-radix-popper-content-wrapper],.q-menu,.q-dialog,.q-popup-menu',
    )
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => {});
  const t1 = await page.evaluate(() => performance.now());
  return Math.round(t1 - t0);
}

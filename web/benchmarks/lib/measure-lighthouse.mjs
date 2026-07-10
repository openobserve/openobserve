import fs from "node:fs";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "playwright";
import { LIGHTHOUSE_RUNS, LIGHTHOUSE_THROTTLING } from "../config.mjs";
import { median, log, sleep } from "./util.mjs";

// Authenticated Lighthouse: we launch one Chrome, inject the saved session
// (cookies + localStorage) into its profile for our origin, then run Lighthouse
// repeatedly per route. Because localStorage/cookies are per-origin within the
// shared profile, Lighthouse's own tab loads authenticated.
export async function measureLighthouse({ origin, storagePath, routes }) {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  try {
    await injectSession(chrome.port, origin, storagePath);

    const config = {
      extends: "lighthouse:default",
      settings: {
        onlyCategories: ["performance", "accessibility", "best-practices"],
        throttlingMethod: LIGHTHOUSE_THROTTLING.method,
        // Full throttling profile — a partial object breaks lantern (null FCP).
        throttling:
          LIGHTHOUSE_THROTTLING.method === "provided"
            ? undefined
            : {
                rttMs: LIGHTHOUSE_THROTTLING.rttMs,
                throughputKbps: LIGHTHOUSE_THROTTLING.throughputKbps,
                requestLatencyMs: LIGHTHOUSE_THROTTLING.requestLatencyMs,
                downloadThroughputKbps: LIGHTHOUSE_THROTTLING.downloadThroughputKbps,
                uploadThroughputKbps: LIGHTHOUSE_THROTTLING.uploadThroughputKbps,
                cpuSlowdownMultiplier: LIGHTHOUSE_THROTTLING.cpuSlowdownMultiplier,
              },
        formFactor: "desktop",
        screenEmulation: { mobile: false, disabled: false, width: 1500, height: 1024, deviceScaleFactor: 1 },
        skipAudits: ["uses-http2"],
      },
    };

    const out = {};
    for (const route of routes) {
      const url = origin + "/web/" + route.path;
      const samples = [];
      for (let i = 0; i < LIGHTHOUSE_RUNS; i++) {
        log(`lighthouse ${route.id} run ${i + 1}/${LIGHTHOUSE_RUNS}`);
        try {
          const runnerResult = await lighthouse(url, { port: chrome.port, output: "json" }, config);
          if (runnerResult) samples.push(extract(runnerResult.lhr));
        } catch (e) {
          log(`  ⚠ lighthouse ${route.id} run ${i + 1} errored: ${e.message?.split("\n")[0]}`);
        }
        await sleep(300);
      }
      out[route.id] = { label: route.label, url, ...summarize(samples) };
    }
    return out;
  } finally {
    // chrome-launcher's cleanup of its temp profile can throw EPERM on Windows
    // (the \\?\...lighthouse.NNN dir). Never let teardown discard results.
    try {
      await chrome.kill();
    } catch (e) {
      log(`  ⚠ chrome cleanup failed (ignored): ${e.message?.split("\n")[0]}`);
    }
  }
}

function extract(lhr) {
  const a = lhr.audits;
  return {
    performance: lhr.categories.performance?.score ?? null,
    accessibility: lhr.categories.accessibility?.score ?? null,
    bestPractices: lhr.categories["best-practices"]?.score ?? null,
    fcp: a["first-contentful-paint"]?.numericValue ?? null,
    lcp: a["largest-contentful-paint"]?.numericValue ?? null,
    tbt: a["total-blocking-time"]?.numericValue ?? null,
    cls: a["cumulative-layout-shift"]?.numericValue ?? null,
    speedIndex: a["speed-index"]?.numericValue ?? null,
    tti: a["interactive"]?.numericValue ?? null,
    totalByteWeight: a["total-byte-weight"]?.numericValue ?? null,
    mainThreadWork: a["mainthread-work-breakdown"]?.numericValue ?? null,
    bootupTime: a["bootup-time"]?.numericValue ?? null,
  };
}

function summarize(samples) {
  if (!samples.length) return { error: "no lighthouse samples", samples };
  const keys = Object.keys(samples[0]);
  const medians = {};
  for (const k of keys) medians[k] = median(samples.map((s) => s[k]));
  return { medians, runs: samples.length, samples };
}

// Push the Playwright-saved session into the launched Chrome's profile.
async function injectSession(port, origin, storagePath) {
  const state = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const context = browser.contexts()[0] || (await browser.newContext());

  if (state.cookies?.length) {
    await context.addCookies(state.cookies).catch(() => {});
  }

  const originState = (state.origins || []).find((o) => origin.startsWith(o.origin)) || state.origins?.[0];
  const page = await context.newPage();
  await page.goto(origin + "/web/", { waitUntil: "domcontentloaded" }).catch(() => {});
  if (originState?.localStorage?.length) {
    await page
      .evaluate((items) => {
        for (const { name, value } of items) localStorage.setItem(name, value);
      }, originState.localStorage)
      .catch(() => {});
  }
  await page.close();
  await browser.close(); // detaches CDP; Chrome + its profile stay alive
}

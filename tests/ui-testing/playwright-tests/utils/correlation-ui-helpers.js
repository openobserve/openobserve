// Copyright 2026 OpenObserve Inc.

/**
 * Browser-side helpers for the Correlation Phase-2 UI specs.
 *
 * Auth is handled by the framework fixture (enhanced-baseFixtures →
 * global-setup storageState), so there is NO custom login here. `withSetupPage`
 * mints a short-lived authenticated page from the same storageState for
 * expensive one-time beforeAll setup (org create + ingest + discovery wait)
 * without a bespoke Basic-auth context.
 *
 * The behavioral helpers (quick-mode toggle, correlate-traffic sniffer) are
 * ported from the proven pre-standardization corrUi.js. Selectors for the
 * correlation drawer/settings live in their page objects
 * (correlationDrawerPage / correlationSettingsPage); the logs-page interactions
 * below are search-readiness plumbing, kept here alongside the sniffer.
 */

const path = require("path");

const BASE = process.env.ZO_BASE_URL || "http://localhost:5080";
const AUTH_FILE = path.join(__dirname, "auth", "user.json");

/**
 * Run `fn` with a short-lived authenticated page (global-setup storageState).
 * For beforeAll/afterAll setup where the test `page` fixture isn't available.
 */
async function withSetupPage(browser, fn) {
  const ctx = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1500, height: 1024 },
  });
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

/**
 * Force quick mode OFF (state-aware — the buttons are toggles). Quick mode
 * starves dimension extraction: the row source carries only "interesting"
 * fields and correlation sees no dimensions at all.
 */
async function ensureQuickModeOff(page) {
  const readSwitch = async (loc) => {
    const sw = loc.locator('[role="switch"], input[type="checkbox"]').first();
    const target = (await sw.count()) ? sw : loc;
    const aria = await target.getAttribute("aria-checked").catch(() => null);
    if (aria !== null) return aria === "true";
    return target.isChecked().catch(() => null);
  };

  const pinned = page
    .locator('[data-test="logs-search-bar-quick-mode-pinned-btn"]')
    .first();
  if (await pinned.isVisible().catch(() => false)) {
    if ((await readSwitch(pinned)) === true) {
      await pinned.click();
      await page.waitForTimeout(600);
    }
    return;
  }

  const menuToggle = page
    .locator('[data-test="logs-search-bar-menu-quick-mode-toggle-btn"]')
    .first();
  const candidates = [
    page.locator('button:has-text("More")').first(),
    page.locator('[data-test="logs-search-bar-more-btn"]').first(),
    page.locator('[data-test="logs-search-bar-more-options-btn"]').first(),
  ];
  let opened = false;
  for (const cand of candidates) {
    if (!(await cand.isVisible().catch(() => false))) continue;
    await cand.click();
    if (
      await menuToggle
        .waitFor({ state: "visible", timeout: 4_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      opened = true;
      break;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  if (!opened) {
    throw new Error("ensureQuickModeOff: could not open the More menu with the quick-mode item");
  }
  const sw = page.locator('[data-test="logs-search-bar-quick-mode-switch"]').first();
  if ((await sw.count()) && (await readSwitch(sw)) === true) {
    await menuToggle.click();
    await page.waitForTimeout(400);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

/**
 * Open the logs page for a stream, force quick mode off, run the query, and
 * verify the request SQL is a full `select *` (not the dimension-starved
 * quick-mode `select _timestamp`) — correlation is dead without dimensions.
 */
async function openLogsAndQuery(page, org, stream) {
  await page.goto(
    `${BASE}/web/logs?org_identifier=${org}&stream_type=logs&stream=${stream}&period=1h`,
    { waitUntil: "domcontentloaded" },
  );
  const refresh = page.locator('[data-test="logs-search-bar-refresh-btn"]').first();
  await refresh.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(2000);

  for (let attempt = 0; attempt < 3; attempt++) {
    await ensureQuickModeOff(page);
    const sqls = [];
    const handler = (req) => {
      if (req.url().includes("_search") && req.method() === "POST") {
        try {
          const sql = JSON.parse(req.postData() || "{}").query?.sql;
          if (sql) sqls.push(String(sql));
        } catch {}
      }
    };
    page.on("request", handler);
    await refresh.click();
    await page.waitForTimeout(5000);
    page.off("request", handler);
    if (sqls.some((s) => /select\s+\*\s+from/i.test(s) && s.includes(stream))) {
      await page
        .locator('[data-test="logs-search-result-logs-table"] tbody tr')
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
      return;
    }
  }
  throw new Error(
    `openLogsAndQuery: never saw a 'select *' query for ${stream} — quick mode still on?`,
  );
}

/** Click the first result row and wait for the detail dialog. */
async function openFirstRowDialog(page) {
  const row = page.locator('[data-test="logs-search-result-logs-table"] tbody tr').first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.click();
  await page
    .locator('[data-test="dialog-box"]')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Attach sniffers for correlation traffic. Returns live arrays that fill as
 * requests happen: parsed correlate request bodies, parsed correlate response
 * bodies, and raw _search POST bodies.
 */
function sniff(page) {
  const correlateRequests = [];
  const correlateResponses = [];
  const searchBodies = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const url = req.url();
    if (url.includes("/_correlate")) {
      try {
        correlateRequests.push(JSON.parse(req.postData() || "{}"));
      } catch {}
    } else if (url.includes("_search")) {
      const body = req.postData();
      if (body) searchBodies.push(body);
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/_correlate")) {
      res
        .json()
        .then((b) => correlateResponses.push(b))
        .catch(() => {});
    }
  });
  return { correlateRequests, correlateResponses, searchBodies };
}

/** Wait until pred() is truthy (browser-side polling for sniffed traffic). */
async function waitFor(pred, { deadlineMs = 30_000, intervalMs = 500, label = "condition" } = {}) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const v = await pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`correlation-ui-helpers.waitFor: timed out waiting for ${label}`);
}

module.exports = {
  BASE,
  withSetupPage,
  ensureQuickModeOff,
  openLogsAndQuery,
  openFirstRowDialog,
  sniff,
  waitFor,
};

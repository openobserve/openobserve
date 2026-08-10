// Browser-side helpers for the correlation Phase-2 UI suite.
// Selectors proven against the wt-correlation-fix stack (vite :5174 + backend :5090)
// by fe_verify_correlation_fixes.mjs during the 2026-08-06 live verification.

const testLogger = require("../../utils/test-logger.js");

// Deployed envs (alpha1/env workflows) serve the UI from the backend origin
// (ZO_BASE_URL); the vite port is local-dev only.
const UI_BASE_URL =
  process.env.O2_UI_BASE_URL ||
  process.env.ZO_BASE_URL_SC_UI ||
  process.env.ZO_BASE_URL ||
  "http://localhost:5174";
const USER =
  process.env.O2_ROOT_EMAIL ||
  process.env.ZO_ROOT_USER_EMAIL ||
  process.env.ALPHA1_USER_EMAIL;
const PASS =
  process.env.O2_ROOT_PASSWORD ||
  process.env.ZO_ROOT_USER_PASSWORD ||
  process.env.ALPHA1_USER_PASSWORD;

/** Login via the internal-user form; retries once (dev-server render flake). */
async function login(page) {
  try {
    await loginOnce(page);
  } catch (e) {
    testLogger.warn(`login attempt 1 failed (${e.message}); retrying`);
    await loginOnce(page);
  }
}

async function loginOnce(page) {
  await page.goto(`${UI_BASE_URL}/web/`, { waitUntil: "domcontentloaded" });
  const internalBtn = page
    .locator('[data-test="login-as-internal-user"]')
    .first();
  const emailBox = page.locator('[data-test="login-user-id-field"]').first();
  const menuHome = page.locator('[data-test="menu-link-\\/-item"]');

  // Wait for whichever renders first: login chooser, login form, or the app
  // (already-authenticated storage state).
  await Promise.race([
    internalBtn.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {}),
    emailBox.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {}),
    menuHome.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {}),
  ]);
  if (await menuHome.isVisible().catch(() => false)) return;

  if (await internalBtn.isVisible().catch(() => false)) {
    await internalBtn.click();
    await emailBox.waitFor({ state: "visible", timeout: 15_000 });
  }
  await emailBox.fill(USER, { timeout: 15_000 });
  const passBox = page.locator('[data-test="login-password-field"]').first();
  await passBox.waitFor({ state: "visible", timeout: 15_000 });
  await passBox.fill(PASS, { timeout: 15_000 });
  await page
    .locator('[data-test="login-sign-in"]')
    .first()
    .click({ timeout: 15_000 });
  await menuHome.waitFor({ state: "visible", timeout: 30_000 });
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
    const checked = await target.isChecked().catch(() => null);
    return checked;
  };

  // Pinned toolbar button, when present, carries the switch state directly.
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

  // Otherwise the toggle lives in the "More" dropdown. Several toolbar
  // buttons match "more"-ish selectors — click candidates until the
  // quick-mode menu item actually renders.
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
    throw new Error(
      "ensureQuickModeOff: could not open the More menu with the quick-mode item",
    );
  }
  const sw = page
    .locator('[data-test="logs-search-bar-quick-mode-switch"]')
    .first();
  if ((await sw.count()) && (await readSwitch(sw)) === true) {
    await menuToggle.click();
    await page.waitForTimeout(400);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

/**
 * Open the logs page for a stream, force quick mode off, run the query, and
 * verify the first row's source actually carries dimension fields (retrying
 * the quick-mode toggle once if not) — correlation is dead without them.
 */
async function openLogsAndQuery(
  page,
  org,
  stream,
  { dimensionField = "service" } = {},
) {
  await page.goto(
    `${UI_BASE_URL}/web/logs?org_identifier=${org}&stream_type=logs&stream=${stream}&period=1h`,
    { waitUntil: "domcontentloaded" },
  );
  const refresh = page
    .locator('[data-test="logs-search-bar-refresh-btn"]')
    .first();
  await refresh.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(2000);

  // Verify via the REQUEST SQL: quick mode issues `select _timestamp from ...`
  // (dimension-starved); full mode issues `select * from ...`. Response bodies
  // are unreliable here (streaming search), request bodies are not.
  void dimensionField;
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
  const row = page
    .locator('[data-test="logs-search-result-logs-table"] tbody tr')
    .first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.click();
  await page
    .locator('[data-test="dialog-box"]')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Attach sniffers for correlation traffic. Returns live arrays that fill as
 * requests happen: correlate request bodies (parsed), correlate response
 * bodies (parsed), and raw _search POST bodies.
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
async function waitFor(
  pred,
  { deadlineMs = 30_000, intervalMs = 500, label = "condition" } = {},
) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const v = await pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`corrUi.waitFor: timed out waiting for ${label}`);
}

module.exports = {
  UI_BASE_URL,
  login,
  openLogsAndQuery,
  openFirstRowDialog,
  sniff,
  waitFor,
};

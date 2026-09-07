// One-off E2E driver for environment attribution on the results page (not a suite).
// Run: node e2e-env-results.mjs  (needs E2E_EMAIL / E2E_PASS; optional FROM_US/TO_US)
import { chromium } from "@playwright/test";

const UI = "http://localhost:8081";
const MULTI = "3IoNQLxYSGnj726hTMu5y6gjBcR"; // cloud + ap1
const SINGLE = "3IoNn2tdYa9wzcvYwa9aUmume2X"; // ap1 only
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/e2e-env-shots";
const results = [];
const ok = (name, cond, detail = "") => results.push({ name, cond: !!cond, detail });

// Window covering only post-stamp rows, so the lanes' all-attributed rule holds.
const FROM_US = process.env.FROM_US;
const TO_US = process.env.TO_US;
const windowQuery = FROM_US && TO_US ? `&from=${FROM_US}&to=${TO_US}` : "&period=15m";

// No downloaded Playwright browsers on this machine — drive the installed Chrome.
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1100 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

async function login() {
  await page.goto(`${UI}/web/login`);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  const internal = page.locator('[data-test="login-as-internal-user"]');
  if (await internal.isVisible({ timeout: 3000 }).catch(() => false)) await internal.click();
  await page.locator('[data-test="login-user-id"] input').fill(process.env.E2E_EMAIL);
  await page.locator('[data-test="login-password"] input').fill(process.env.E2E_PASS);
  await page.locator('[data-test="login-sign-in"]').click();
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 45000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function openResults(id, extra = "") {
  await page.goto(
    `${UI}/web/synthetics/${id}/results?org_identifier=default&folder=default${windowQuery}${extra}`,
  );
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

try {
  await login();
  ok("U0 login", !page.url().includes("/login"));

  // ── S3: multi-env check in All mode ──
  await openResults(MULTI);
  const scope = page.locator('[data-test="synthetic-monitor-results-env-scope"]');
  ok("A1 scope control rendered for multi-env check", await scope.count());
  const headerText = await page.locator("header, h1").first().innerText().catch(() => "");
  ok("A2 title from check (rename-safe source)", (await page.getByText("OpenObserve").count()) > 0, headerText);
  const envCells = page.locator('[data-test="monitor-runs-runs-table"] tbody tr');
  const tableText = await page.locator('[data-test="monitor-runs-runs-table"]').innerText();
  ok("A3 env chips in table (cloud AND ap1)", tableText.includes("cloud") && tableText.includes("ap1"), tableText.slice(0, 150));
  ok("A4 env breakdown card first", await page.locator('[data-test="monitor-runs-env-breakdown"]').count());
  const laneLabels = page.locator('[data-test="synthetics-timeline-lane-labels"]');
  const lanesText = (await laneLabels.count()) ? await laneLabels.innerText() : "(single strip)";
  ok("A5 timeline lanes per env (all rows attributed)", lanesText.includes("cloud") && lanesText.includes("ap1"), lanesText);
  await page.screenshot({ path: `${SHOTS}/01-multi-all.png`, fullPage: false });

  // ── S4: scoped mode via the control ──
  await scope.click();
  await page.locator('[role="option"]', { hasText: "ap1" }).last().click();
  // Old rows stay rendered while the scoped refetch is in flight — poll for
  // the moment the other env's chips are gone rather than for "rows exist".
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-test="monitor-runs-runs-table"]');
        return el && el.innerText.includes("ap1") && !el.innerText.includes("cloud");
      },
      { timeout: 30000 },
    )
    .catch(() => {});
  ok("B1 URL carries ?env=ap1", page.url().includes("env=ap1"), page.url());
  const scopedTable = await page.locator('[data-test="monitor-runs-runs-table"]').innerText();
  ok("B2 scoped table shows only ap1 rows", scopedTable.includes("ap1") && !scopedTable.includes("cloud"), scopedTable.slice(0, 150));
  ok("B3 scoped mode collapses lanes to single strip", (await laneLabels.count()) === 0);
  await page.screenshot({ path: `${SHOTS}/02-scoped-ap1.png` });

  // ── S4b: deep link with ?env= survives reload ──
  await openResults(MULTI, "&env=cloud");
  const cloudTable = await page.locator('[data-test="monitor-runs-runs-table"]').innerText();
  ok("B4 deep-linked scope restores (cloud only)", cloudTable.includes("cloud") && !cloudTable.includes("ap1"), cloudTable.slice(0, 150));

  // ── Drawer env badge ──
  await openResults(MULTI);
  await page.locator('[data-test="monitor-runs-runs-table"] tbody tr').first().click();
  await page.waitForTimeout(2000);
  const envBadge = page.locator('[data-test="synthetics-run-drawer-env-badge"]');
  ok("C1 drawer header carries the env badge", await envBadge.count(), await envBadge.innerText().catch(() => ""));
  await page.screenshot({ path: `${SHOTS}/03-drawer.png` });
  await page.keyboard.press("Escape");

  // ── S2: single-env check shows no env machinery, drawer still attributes ──
  await openResults(SINGLE);
  ok("D1 no scope control on single-env check", (await scope.count()) === 0);
  ok("D2 no env breakdown card", (await page.locator('[data-test="monitor-runs-env-breakdown"]').count()) === 0);
  const singleTable = await page.locator('[data-test="monitor-runs-runs-table"]').innerText().catch(() => "");
  ok("D3 no env column", !singleTable.split("\n")[0]?.includes("Environment"), singleTable.split("\n").slice(0, 2).join(" | "));
  await page.screenshot({ path: `${SHOTS}/04-single-env.png` });

  ok("U10 no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  ok("FATAL", false, String(e).slice(0, 400));
  await page.screenshot({ path: `${SHOTS}/99-failure.png` }).catch(() => {});
} finally {
  await browser.close();
}

let failed = 0;
for (const r of results) {
  if (!r.cond) failed++;
  console.log(`${r.cond ? "ok  " : "FAIL"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

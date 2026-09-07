// One-off persona-driven E2E for env attribution during a simulated ap1 outage.
// Personas from the results-page review: Priya (on-call), Marco (release gate),
// Dana (flake diagnosis), Sam (reporting). Run with E2E_EMAIL/E2E_PASS,
// FROM_US/TO_US (incident window), WIDE_FROM_US (pre-stamp history window).
import { chromium } from "@playwright/test";

const UI = "http://localhost:8081";
const MULTI = "3IoNQLxYSGnj726hTMu5y6gjBcR"; // cloud + ap1
const SINGLE = "3IoNn2tdYa9wzcvYwa9aUmume2X"; // ap1 only
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/e2e-persona-shots";
const results = [];
const ok = (name, cond, detail = "") => results.push({ name, cond: !!cond, detail });

const { FROM_US, TO_US, WIDE_FROM_US } = process.env;

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

async function openResults(id, from, to, extra = "") {
  await page.goto(
    `${UI}/web/synthetics/${id}/results?org_identifier=default&folder=default&from=${from}&to=${to}${extra}`,
  );
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

const tableText = () =>
  page.locator('[data-test="monitor-runs-runs-table"]').innerText().catch(() => "");

try {
  await login();
  ok("U0 login", !page.url().includes("/login"));

  // ════ Priya — on-call: which environment broke? ════
  await openResults(MULTI, FROM_US, TO_US);
  const failedRows = await page
    .locator('[data-test="monitor-runs-runs-table"] tbody tr', { hasText: "Failed" })
    .allInnerTexts();
  ok("P1a there IS a failure in the window", failedRows.length > 0, `${failedRows.length} failed rows`);
  ok(
    "P1b every failed row is attributed to ap1, none to cloud",
    failedRows.every((r) => r.includes("ap1") && !r.includes("cloud")),
    failedRows[0]?.slice(0, 90),
  );
  const laneLabels = page.locator('[data-test="synthetics-timeline-lane-labels"]');
  ok("P1c timeline lanes render the blast radius", (await laneLabels.count()) === 1 && (await laneLabels.innerText()).includes("ap1"));
  const envCard = await page.locator('[data-test="monitor-runs-env-breakdown"]').innerText();
  const pct = Object.fromEntries([...envCard.matchAll(/(cloud|ap1)\s*\n?\s*(\d+)%/g)].map((m) => [m[1], Number(m[2])]));
  ok("P1d breakdown: cloud 100%, ap1 degraded", pct.cloud === 100 && pct.ap1 < 100, JSON.stringify(pct));
  await page.screenshot({ path: `${SHOTS}/p1-priya-blast-radius.png` });

  // Drill into the failed execution — env badge + error in the drawer.
  await page.locator('[data-test="monitor-runs-runs-table"] tbody tr', { hasText: "Failed" }).first().click();
  await page.waitForTimeout(2500);
  const badge = page.locator('[data-test="synthetics-run-drawer-env-badge"]');
  ok("P1e drawer names the environment", (await badge.innerText().catch(() => "")).includes("ap1"));
  const drawerText = await page.locator('[data-test="synthetics-run-detail-drawer"]').innerText().catch(() => "");
  ok("P1f drawer shows the failure", drawerText.includes("Failed"), drawerText.slice(0, 80));
  await page.screenshot({ path: `${SHOTS}/p1-priya-drawer.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ════ Marco — release gate: is MY env green? ════
  await openResults(MULTI, FROM_US, TO_US, "&env=cloud");
  const cloudText = await tableText();
  const cloudKpi = await page.locator("body").innerText();
  ok("M1 scoped to cloud: no failures visible", !cloudText.includes("Failed"), cloudText.slice(0, 120));
  ok("M2 cloud pass rate reads 100.0%", cloudKpi.includes("100.0%"));
  await page.screenshot({ path: `${SHOTS}/p2-marco-cloud-green.png` });
  await openResults(MULTI, FROM_US, TO_US, "&env=ap1");
  const ap1Text = await tableText();
  ok("M3 scoped to ap1: the outage is undiluted", ap1Text.includes("Failed") && !ap1Text.includes("cloud"), ap1Text.slice(0, 120));
  await page.screenshot({ path: `${SHOTS}/p2-marco-ap1-red.png` });

  // ════ Dana — which env does the step fail in? (Steps tab under scope) ════
  await page.locator('[data-test="monitor-runs-tab-steps"]').click();
  await page.waitForTimeout(4000);
  const stepsAp1 = await page.locator("body").innerText();
  const navRowAp1 = stepsAp1.split("\n").find((l) => l.includes("Navigate to"));
  ok("D1 ap1-scoped Steps tab shows the failing navigate step", stepsAp1.includes("Navigate to"), navRowAp1?.slice(0, 80));
  const failRates = [...stepsAp1.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
  ok("D2 ap1 scope carries a non-zero fail rate", failRates.some((r) => r > 0), JSON.stringify(failRates.slice(0, 8)));
  await page.screenshot({ path: `${SHOTS}/p3-dana-steps-ap1.png` });
  await openResults(MULTI, FROM_US, TO_US, "&env=cloud");
  await page.locator('[data-test="monitor-runs-tab-steps"]').click();
  await page.waitForTimeout(4000);
  const stepsCloud = await page.locator("body").innerText();
  const cloudRates = [...stepsCloud.matchAll(/(\d+(?:\.\d+)?)%\s*flaky|\b(\d+(?:\.\d+)?)% of \d+/g)];
  ok("D3 cloud-scoped Steps tab is clean (steps listed, no failures)", stepsCloud.includes("Navigate to") && !stepsCloud.includes("Failed"), "");
  await page.screenshot({ path: `${SHOTS}/p3-dana-steps-cloud.png` });

  // ════ Sam — per-env numbers for reporting ════
  await openResults(MULTI, FROM_US, TO_US, "&env=ap1");
  const samAp1 = await page.locator("body").innerText();
  const ap1Rate = samAp1.match(/Pass Rate\s*\n?\s*(\d+(?:\.\d+)?)%/);
  ok("S1 scoped KPI gives a clean per-env pass rate", !!ap1Rate && Number(ap1Rate[1]) < 100, ap1Rate?.[1]);

  // ════ History: pre-stamp rows keep the page honest ════
  await openResults(MULTI, WIDE_FROM_US, TO_US);
  ok("H1 mixed-history window falls back to the single strip", (await laneLabels.count()) === 0);
  // Newest-first paging hides old rows; sort the env column ascending so the
  // unattributed ('' sorts first) history surfaces.
  await page
    .locator('[data-test="monitor-runs-runs-table"] th', { hasText: "Environment" })
    .first()
    .click();
  await page.waitForTimeout(800);
  const wideTable = await tableText();
  ok("H2 unattributed rows render as —", wideTable.includes("—"), wideTable.split("\n").slice(0, 6).join(" "));
  await page.screenshot({ path: `${SHOTS}/p4-history-fallback.png` });

  // ════ Rename safety (driven outside; asserted here via stale deep link) ════
  if (process.env.RENAMED_TITLE) {
    await page.goto(
      `${UI}/web/synthetics/${MULTI}/results?org_identifier=default&folder=default&name=OpenObserve&from=${FROM_US}&to=${TO_US}`,
    );
    await page.waitForTimeout(3000);
    const header = await page.locator("body").innerText();
    ok("R1 stale ?name= deep link shows the CURRENT name", header.includes(process.env.RENAMED_TITLE));
    await page.screenshot({ path: `${SHOTS}/p5-renamed-title.png` });
  }

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

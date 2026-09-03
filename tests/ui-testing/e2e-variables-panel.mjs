// One-off E2E driver for the check editor variables panel (not a test suite).
// Run: node e2e-variables-panel.mjs  (needs E2E_EMAIL / E2E_PASS in env)
import { chromium } from "@playwright/test";

const UI = "http://localhost:8081";
const CHECK_ID = "3ImfzhQbNPdKQU1jzYJXbfH9nt8";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/e2e-shots";
const results = [];
const ok = (name, cond, detail = "") => results.push({ name, cond: !!cond, detail });

// No downloaded Playwright browsers on this machine — drive the installed Chrome.
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  // ── Login ──
  await page.goto(`${UI}/web/login`);
  const internal = page.locator('[data-test="login-as-internal-user"]');
  if (await internal.isVisible({ timeout: 3000 }).catch(() => false)) await internal.click();
  await page.locator('[data-test="login-user-id"] input').fill(process.env.E2E_EMAIL);
  await page.locator('[data-test="login-password"] input').fill(process.env.E2E_PASS);
  await page.locator('[data-test="login-sign-in"]').click();
  // Post-login lands on /web/ first; the org param only appears on deeper routes.
  await page.waitForURL(/\/web\//, { timeout: 15000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  ok("U0 login", !page.url().includes("/login"));

  // ── Open the check editor ──
  await page.goto(
    `${UI}/web/synthetics/edit/${CHECK_ID}?org_identifier=default&folder=default`,
  );
  const panel = page.locator('[data-test="synthetics-check-variables-panel"]');
  // The rail ships collapsed; the toolbar's Variables toggle opens it.
  await page.getByRole("button", { name: /Variables/ }).first().waitFor({ timeout: 20000 });
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /Variables/ }).first().click();
  }
  await panel.waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500); // grouped fetch settles
  await page.screenshot({ path: `${SHOTS}/01-editor-stage.png`, fullPage: false });

  // ── U1: Resolve-as switch present with both environments, stage first ──
  const select = page.locator('[data-test="synthetics-check-variables-panel-resolve-as"]');
  ok("U1a resolve-as rendered", await select.count());
  const selectText = await select.innerText().catch(() => "");
  ok("U1b defaults to first env (stage_e2e)", selectText.includes("stage_e2e"), selectText);

  // ── U2: stage view rows ──
  const inherited = page.locator('[data-test="synthetics-inherited-variable"]');
  const stageText = await panel.innerText();
  ok("U2a BASE_URL row shown", stageText.includes("BASE_URL"));
  ok(
    "U2b secret marked by lock, no value-like content",
    (await page.locator('[data-test="synthetics-inherited-secret-lock"]').count()) === 1 &&
      !stageText.includes("••••••"),
  );
  // Row-scoped: the unbound warning legitimately names DEBUG in panel text.
  const rowTexts = await inherited.allInnerTexts();
  ok("U2c no DEBUG row in stage view", !rowTexts.some((t) => t.startsWith("DEBUG")));
  ok("U2d global ORG shown", stageText.includes("ORG"));

  // ── U3: override — struck row, relation on the accessible name only ──
  const struck = page.locator('[data-test="synthetics-inherited-variable"] span.line-through');
  ok("U3a struck CHECKOUT_USER", (await struck.count()) === 1 && (await struck.first().innerText()) === "CHECKOUT_USER");
  ok("U3b relation on aria-label", (await struck.first().getAttribute("aria-label")) === "Overridden by local variable");
  ok("U3c no link and no old badge", !stageText.includes("Overridden here") && !stageText.includes("Overridden by local variable"));

  // ── U4: coverage triangles in stage view (env names on the tooltip/aria-label) ──
  const gapBadges = page.locator('[data-test="synthetics-inherited-gap-badge"]');
  const gapLabels = () =>
    gapBadges.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  const gapTexts = await gapLabels();
  ok("U4a stage-only rows warn 'Not in qa_e2e'", gapTexts.some((t) => t.includes("Not in qa_e2e")), JSON.stringify(gapTexts));
  ok("U4b overridden name has no gap (check tier covers it)", !gapTexts.some((t) => t.includes("CHECKOUT_USER")));

  // ── U5: count = effective for stage (API_KEY, BASE_URL, CHECKOUT_USER, ORG = 4) ──
  const count = await page.locator('[data-test="synthetics-check-variables-panel-count"]').innerText();
  // 6 = fixture (API_KEY, BASE_URL, CHECKOUT_USER, ORG) + pre-existing globals URL, URL_COPY.
  ok("U5 stage count matches the API's effective set (6)", count.trim() === "6", count);

  await page.screenshot({ path: `${SHOTS}/02-override-strike.png` });

  // ── U8: flip to qa_e2e — client-side, rows swap ──
  let grouped_calls = 0;
  page.on("request", (r) => { if (r.url().includes("resolved-variables")) grouped_calls++; });
  await select.click();
  await page.locator('[role="option"], .o-select-item', { hasText: "qa_e2e" }).first().click()
    .catch(async () => { await page.getByText("qa_e2e", { exact: true }).last().click(); });
  await page.waitForTimeout(400);
  const qaText = await panel.innerText();
  ok("U8a DEBUG appears in qa view", qaText.includes("DEBUG"));
  ok("U8b BASE_URL gone in qa view", !qaText.includes("BASE_URL"));
  ok("U8c no struck row in qa view", (await struck.count()) === 0);
  const qaCount = await page.locator('[data-test="synthetics-check-variables-panel-count"]').innerText();
  ok("U8d qa count matches the API's effective set (5)", qaCount.trim() === "5", qaCount);
  ok("U8e no refetch on flip", grouped_calls === 0, `calls=${grouped_calls}`);
  const qaGaps = await gapLabels();
  ok("U8f DEBUG warns 'Not in stage_e2e'", qaGaps.some((t) => t.includes("Not in stage_e2e")), JSON.stringify(qaGaps));
  await page.screenshot({ path: `${SHOTS}/03-qa-view.png` });

  // ── U9: remove-override dialog carries the fallback note (back on stage) ──
  await select.click();
  await page.getByText("stage_e2e", { exact: true }).last().click();
  await page.waitForTimeout(300);
  await page.locator('[data-test="synthetics-check-variables-panel-remove-0-btn"]').click();
  const dialog = page.locator('[data-test="synthetics-check-variables-panel-remove-dialog"]');
  await dialog.waitFor({ timeout: 5000 });
  const dialogText = await dialog.innerText();
  ok("U9 dialog notes fallback to stage_e2e value", dialogText.includes("will now get the stage_e2e value"), dialogText.slice(0, 200));
  await page.screenshot({ path: `${SHOTS}/04-remove-override-dialog.png` });

  // ── U11: clicking the splitter must not hide the panel (frozen-limits regression) ──
  const separator = page.locator('[role="separator"]').last();
  const sepBox = await separator.boundingBox();
  await page.mouse.move(sepBox.x + sepBox.width / 2, sepBox.y + sepBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sepBox.x + sepBox.width / 2 + 1, sepBox.y + sepBox.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(300);
  ok("U11a panel survives a click on the splitter", await panel.isVisible());
  const widthBefore = (await panel.boundingBox()).width;
  await page.mouse.move(sepBox.x + 1, sepBox.y + sepBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sepBox.x - 120, sepBox.y + sepBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const widthAfter = (await panel.boundingBox()).width;
  ok("U11b drag widens the panel within limits", widthAfter > widthBefore && (await panel.isVisible()), `w ${widthBefore}→${widthAfter}`);

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

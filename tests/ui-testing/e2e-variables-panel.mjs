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
  // First load after an HMR of a wide module compiles the whole graph — warm it.
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  const internal = page.locator('[data-test="login-as-internal-user"]');
  if (await internal.isVisible({ timeout: 3000 }).catch(() => false)) await internal.click();
  await page.locator('[data-test="login-user-id"] input').fill(process.env.E2E_EMAIL);
  await page.locator('[data-test="login-password"] input').fill(process.env.E2E_PASS);
  await page.locator('[data-test="login-sign-in"]').click();
  // Post-login lands on /web/ first; the org param only appears on deeper routes.
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 45000 });
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

  // ── U1: 4b union panel — source filter over the check's envs ──
  const filter = page.locator('[data-test="synthetics-inherited-filter"]');
  ok("U1b source filter rendered", await filter.count());
  await filter.click();
  const optionTexts = await page.locator('[role="option"]').allInnerTexts();
  await page.keyboard.press("Escape");
  ok("U1c filter offers All/Global and both envs", ["All", "Global", "stage_e2e", "qa_e2e"].every((o) => optionTexts.some((t) => t.includes(o))), JSON.stringify(optionTexts));

  // ── U2: the union — every selected env's names plus globals, at once ──
  const inherited = page.locator('[data-test="synthetics-inherited-variable"]');
  const stageText = await panel.innerText();
  ok("U2a BASE_URL (stage) and DEBUG (qa) shown together", stageText.includes("BASE_URL") && stageText.includes("DEBUG"));
  ok(
    "U2b secret marked by lock, no value-like content",
    (await page.locator('[data-test="synthetics-inherited-secret-lock"]').count()) === 1 &&
      !stageText.includes("••••••"),
  );
  ok("U2c global ORG shown", stageText.includes("ORG"));
  ok("U2d local group header with add button", stageText.includes("Local") && (await page.locator('[data-test="synthetics-check-variables-panel-add-variable-btn"]').count()) === 1);

  // ── U3: override — struck inherited row, warning on the local winner ──
  const struck = page.locator('[data-test="synthetics-inherited-variable"] span.line-through');
  ok("U3a struck CHECKOUT_USER", (await struck.count()) === 1 && (await struck.first().innerText()) === "CHECKOUT_USER");
  ok("U3b relation on aria-label", (await struck.first().getAttribute("aria-label")) === "Overridden by local variable");
  ok("U3c local row carries the overrides warning", await page.locator('[data-test="synthetics-check-variables-panel-overrides-0-badge"]').count());

  // ── U4: coverage triangles (env names on the tooltip/aria-label) ──
  const gapBadges = page.locator('[data-test="synthetics-inherited-gap-badge"]');
  const gapLabels = () =>
    gapBadges.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  const gapTexts = await gapLabels();
  ok("U4a stage-only rows warn 'Not in qa_e2e'", gapTexts.some((t) => t.includes("Not in qa_e2e")), JSON.stringify(gapTexts));
  ok("U4b DEBUG warns 'Not in stage_e2e' in the same view", gapTexts.some((t) => t.includes("Not in stage_e2e")), JSON.stringify(gapTexts));

  // ── U5: header counts distinct resolved names across the union ──
  const count = await page.locator('[data-test="synthetics-check-variables-panel-count"]').innerText();
  ok("U5 distinct-name count is 7", count.trim() === "7", count);

  // ── U8: source filter is client-side ──
  let grouped_calls = 0;
  page.on("request", (r) => { if (r.url().includes("resolved-variables")) grouped_calls++; });
  await filter.selectOption("qa_e2e").catch(async () => {
    await filter.click();
    await page.getByText("qa_e2e", { exact: true }).last().click();
  });
  await page.waitForTimeout(400);
  const qaRows = await inherited.allInnerTexts();
  ok("U8a qa filter shows DEBUG only", qaRows.length === 1 && qaRows[0].includes("DEBUG"), JSON.stringify(qaRows));
  await filter.selectOption("__global__").catch(async () => {
    await filter.click();
    await page.getByText("Global", { exact: true }).last().click();
  });
  await page.waitForTimeout(400);
  const globalRows = await inherited.allInnerTexts();
  ok("U8b global filter shows the three globals", globalRows.length === 3, JSON.stringify(globalRows));
  ok("U8c no refetch on filtering", grouped_calls === 0, `calls=${grouped_calls}`);
  await filter.selectOption("__all__").catch(async () => {
    await filter.click();
    await page.getByText("All", { exact: true }).last().click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/03-filters.png` });

  // ── U9: remove-override dialog carries the fallback note ──
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

  // ── U12: at minimum panel width the warnings survive; names ellipsize ──
  const sep2 = await page.locator('[role="separator"]').last().boundingBox();
  await page.mouse.move(sep2.x + 1, sep2.y + sep2.height / 2);
  await page.mouse.down();
  await page.mouse.move(sep2.x + 400, sep2.y + sep2.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const panelBox = await panel.boundingBox();
  const badgeBoxes = await gapBadges.evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, right: r.right, w: r.width }; }),
  );
  ok("U12a all warning badges intact at min width", badgeBoxes.length === 3 && badgeBoxes.every((b) => b.w > 0 && b.right <= panelBox.x + panelBox.width + 1), JSON.stringify(badgeBoxes));
  const overflowContract = await page
    .locator('[data-test="synthetics-inherited-variable"]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const name = row.querySelector("span.truncate");
        const badge = row.querySelector('[data-test="synthetics-inherited-gap-badge"]');
        const wrap = badge?.parentElement?.closest("span");
        return {
          ellipsis: name && getComputedStyle(name).textOverflow === "ellipsis",
          noShrink: !badge || (wrap && getComputedStyle(wrap).flexShrink === "0"),
        };
      }),
    );
  ok(
    "U12b names carry ellipsis, badge wrappers never shrink",
    overflowContract.every((c) => c.ellipsis && c.noShrink),
    JSON.stringify(overflowContract),
  );
  await page.screenshot({ path: `${SHOTS}/05-narrow-panel.png` });

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

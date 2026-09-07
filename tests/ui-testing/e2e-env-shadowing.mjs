// One-off E2E driver for env-shadowing (same name in global and env).
// Fixtures: SHADOW_URL (global+ap1), SHADOW_NOTE (global), EXCEPT_RATE (ap1+cloud), PROMO_RATE (ap1+cloud)
// are created via the API by the wrapper before this runs.
import { chromium } from "@playwright/test";

const UI = "http://localhost:8081";
const MULTI = "3IoNQLxYSGnj726hTMu5y6gjBcR"; // cloud + ap1 check
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/e2e-shadow-shots";
const results = [];
const ok = (name, cond, detail = "") => results.push({ name, cond: !!cond, detail });

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1100 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const confirmDialog = () => page.locator('[data-test="confirm-dialog-provider"]');

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

async function openVariablesTab(scope) {
  await page.goto(`${UI}/web/synthetics?org_identifier=default&section=variables`);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.locator('[data-test="synthetics-scope-global"]').waitFor({ timeout: 20000 });
  if (scope !== "global") await page.locator(`[data-test="synthetics-scope-${scope}"]`).click();
  else await page.locator('[data-test="synthetics-scope-global"]').click();
  await page.waitForTimeout(1200);
}

const rowFor = (name) =>
  page.locator('[data-test="synthetics-variables-table"] tbody tr', { hasText: name }).first();

try {
  await login();
  ok("U0 login", !page.url().includes("/login"));

  // ── V2a: creating an env variable that shadows a global asks first ──
  await openVariablesTab("ap1");
  await page.locator('[data-test="synthetic-monitoring-add-variable-btn"]').click();
  await page.locator('[data-test="synthetics-variable-name-input"] input').fill("SHADOW_NOTE");
  await page.locator('[data-test="synthetics-variable-value-input"] input').fill("ap1-note");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await confirmDialog().locator("text=override the global value in ap1").waitFor({ timeout: 8000 });
  ok("V2a shadow create asks, naming the env", true);
  await page.screenshot({ path: `${SHOTS}/v2a-confirm-env.png` });
  // Decline → nothing created.
  await confirmDialog().getByRole("button", { name: /Cancel/i }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await openVariablesTab("ap1");
  ok("V2b declining creates nothing", (await rowFor("SHADOW_NOTE").count()) === 0);

  // Accept path: same create, confirmed.
  await page.locator('[data-test="synthetic-monitoring-add-variable-btn"]').click();
  await page.locator('[data-test="synthetics-variable-name-input"] input').fill("SHADOW_NOTE");
  await page.locator('[data-test="synthetics-variable-value-input"] input').fill("ap1-note");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await confirmDialog().locator("text=override the global value in ap1").waitFor({ timeout: 8000 });
  await confirmDialog().getByRole("button", { name: /^OK$/i }).click();
  await page.waitForTimeout(1500);
  ok("V2c accepting creates the shadow", (await rowFor("SHADOW_NOTE").count()) === 1);

  // ── V2d: creating a global under env rows shows the other flavour ──
  await openVariablesTab("global");
  await page.locator('[data-test="synthetic-monitoring-add-variable-btn"]').click();
  await page.locator('[data-test="synthetics-variable-name-input"] input').fill("EXCEPT_RATE");
  await page.locator('[data-test="synthetics-variable-value-input"] input').fill("30");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const globalFlavour = confirmDialog().locator("text=keep theirs");
  await globalFlavour.waitFor({ timeout: 8000 });
  const flavourText = await confirmDialog().innerText();
  ok("V2d global-under-envs confirm names them", /ap1/.test(flavourText) && /cloud/.test(flavourText), flavourText.slice(0, 140));
  await page.screenshot({ path: `${SHOTS}/v2d-confirm-global.png` });
  await confirmDialog().getByRole("button", { name: /^OK$/i }).click();
  await page.waitForTimeout(1500);

  // ── V4: both-way notes on the tab ──
  ok("V4a global row notes where it is overridden", (await rowFor("SHADOW_URL").innerText()).includes("Overridden in ap1"));
  await page.screenshot({ path: `${SHOTS}/v4-global-notes.png` });
  await openVariablesTab("ap1");
  ok("V4b env row notes it overrides global", (await rowFor("SHADOW_URL").innerText()).includes("Overrides global"));
  await page.screenshot({ path: `${SHOTS}/v4-env-notes.png` });

  // ── V5: delete dialogs name the fallback (cancel both) ──
  await rowFor("SHADOW_URL").locator('[data-test="synthetics-variable-delete-btn"]').click();
  await confirmDialog().locator("text=ap1 will then use the global value").waitFor({ timeout: 8000 });
  ok("V5a env delete names the fallback", true);
  await page.screenshot({ path: `${SHOTS}/v5a-delete-env.png` });
  await confirmDialog().getByRole("button", { name: /Cancel/i }).click();
  await openVariablesTab("global");
  await rowFor("SHADOW_URL").locator('[data-test="synthetics-variable-delete-btn"]').click();
  const globalDelete = await confirmDialog().innerText();
  ok("V5b global delete names survivors and the loss", globalDelete.includes("keep their own values") && globalDelete.includes("SHADOW_URL"), globalDelete.slice(0, 160));
  await confirmDialog().getByRole("button", { name: /Cancel/i }).click();

  // ── V6: split dialog treats the owning env as settled ──
  await rowFor("SHADOW_URL").locator('[data-test="synthetics-variable-split-btn"]').click();
  await page.locator('[data-test="synthetics-split-dialog"]').waitFor({ timeout: 8000 });
  const ownedNote = page.locator('[data-test="synthetics-split-row"]', { hasText: "ap1" });
  ok("V6a owning env row is settled, not an input", (await ownedNote.innerText()).includes("Already has its own value"));
  ok("V6b the lighter-path hint is present", (await page.locator('[data-test="synthetics-split-dialog"]').innerText()).includes("create the variable there instead"));
  await page.screenshot({ path: `${SHOTS}/v6-split.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ── V7: promote is allowed and names who still overrides ──
  await openVariablesTab("cloud");
  await rowFor("PROMO_RATE").locator('[data-test="synthetics-variable-promote-btn"]').click();
  // Promoting cloud's row while ap1 keeps its own — allowed, toast says so.
  await page.locator("text=still override it").waitFor({ timeout: 8000 }).catch(() => {});
  const toastSeen = await page.locator("text=still override it").count();
  ok("V7 promote succeeds and names ap1's override", toastSeen > 0);
  await page.screenshot({ path: `${SHOTS}/v7-promote.png` });

  // ── V3: the check panel names the relation on hover hints ──
  await page.goto(`${UI}/web/synthetics/edit/${MULTI}?org_identifier=default&folder=default`);
  const panel = page.locator('[data-test="synthetics-check-variables-panel"]');
  await page.getByRole("button", { name: /Variables/ }).first().waitFor({ timeout: 20000 });
  if (!(await panel.isVisible().catch(() => false)))
    await page.getByRole("button", { name: /Variables/ }).first().click();
  await panel.waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const shadowRow = panel.locator('[data-test="synthetics-inherited-variable"]', { hasText: "SHADOW_URL" });
  ok("V3a shadowed name lists once in the union", (await shadowRow.count()) === 1);
  await shadowRow.locator("span.font-mono").hover();
  await page.waitForTimeout(700);
  const tip = await page.locator('[role="tooltip"], [data-radix-popper-content-wrapper]').last().innerText().catch(() => "");
  ok("V3b hover names the relation", tip.includes("overrides global"), tip.slice(0, 120));
  const gapBadges = await panel.locator('[data-test="synthetics-inherited-gap-badge"]').evaluateAll(
    (els, name) => els.filter((e) => e.closest("li")?.innerText.includes(name)).length,
    "SHADOW_URL",
  );
  ok("V3c a shadowed global is not a coverage gap", gapBadges === 0);
  await page.screenshot({ path: `${SHOTS}/v3-panel.png` });

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

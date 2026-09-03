// One-off driver: the Configure step's Environments card, end to end.
import { chromium } from "@playwright/test";

const UI = "http://localhost:8081";
const API = "http://localhost:5080/api/default/synthetics";
const CHECK_ID = "3ImfzhQbNPdKQU1jzYJXbfH9nt8";
const SHOTS = "/tmp/e2e-shots";
const auth = "Basic " + Buffer.from(`${process.env.E2E_EMAIL}:${process.env.E2E_PASS}`).toString("base64");
const results = [];
const ok = (name, cond, detail = "") => results.push({ name, cond: !!cond, detail });

async function apiEnvironments() {
  const r = await fetch(`${API}/${CHECK_ID}`, { headers: { Authorization: auth } });
  return (await r.json()).environments ?? [];
}

const before = await apiEnvironments();
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

try {
  await page.goto(`${UI}/web/login`);
  const internal = page.locator('[data-test="login-as-internal-user"]');
  if (await internal.isVisible({ timeout: 3000 }).catch(() => false)) await internal.click();
  await page.locator('[data-test="login-user-id"] input').fill(process.env.E2E_EMAIL);
  await page.locator('[data-test="login-password"] input').fill(process.env.E2E_PASS);
  await page.locator('[data-test="login-sign-in"]').click();
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 15000 });

  await page.goto(`${UI}/web/synthetics/edit/${CHECK_ID}?org_identifier=default&folder=default`);
  await page.getByRole("button", { name: /Add Step/ }).waitFor({ timeout: 20000 });
  // The stepper's Configure button is disabled on edit; the wizard advances
  // through the footer's Save & Continue.
  await page.getByRole("button", { name: /Save & Continue/ }).click();

  // The orchestrator's data-test overrides the card root's own via fallthrough.
  const card = page.locator('[data-test="synthetics-check-configure-environments"]');
  await card.waitFor({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/05-environments-card.png` });

  // C1: card content
  const cardText = await card.innerText();
  ok("C1a title present, caption removed", cardText.includes("Environments") && !cardText.includes("Runs once per environment"));
  ok("C1b lists stage_e2e / qa_e2e / Staging", ["stage_e2e", "qa_e2e", "Staging"].every((n) => cardText.includes(n)));

  // OCheckbox is headless: role="checkbox" + aria-checked, no native input.
  const box = (name) =>
    page
      .locator(`[data-test="synthetics-check-environments-checkbox-${name}"][role="checkbox"], [data-test="synthetics-check-environments-checkbox-${name}"] [role="checkbox"]`)
      .first();
  const isChecked = async (name) => (await box(name).getAttribute("aria-checked")) === "true";
  ok("C1c stage_e2e checked", await isChecked("stage_e2e"));
  ok("C1d qa_e2e checked", await isChecked("qa_e2e"));
  ok("C1e Staging unchecked", !(await isChecked("Staging")));

  // C2: toggle Staging on, save, API reflects three environments
  await box("Staging").click();
  await page.getByRole("button", { name: "Save & Exit" }).click();
  await page.waitForURL(/synthetics(?!\/edit)/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const after = await apiEnvironments();
  ok("C2a save added the third environment", after.length === before.length + 1, JSON.stringify(after));
  ok("C2b original two survived the round-trip", before.every((id) => after.includes(id)));
} catch (e) {
  ok("FATAL", false, String(e).slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/98-config-failure.png` }).catch(() => {});
} finally {
  await browser.close();
  // Leave the fixture as we found it.
  await fetch(`${API}/${CHECK_ID}`, { headers: { Authorization: auth } })
    .then((r) => r.json())
    .then((check) =>
      fetch(`${API}/${CHECK_ID}`, {
        method: "PUT",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ ...check, environments: before }),
      }),
    );
  const restored = await apiEnvironments();
  ok("C3 fixture restored", JSON.stringify(restored) === JSON.stringify(before));
}

let failed = 0;
for (const r of results) {
  if (!r.cond) failed++;
  console.log(`${r.cond ? "ok  " : "FAIL"}  ${r.name}${r.detail ? "  — " + r.detail : ""}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

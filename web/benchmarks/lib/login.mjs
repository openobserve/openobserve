import path from "node:path";
import { chromium } from "playwright";
import { AUTH } from "../config.mjs";
import { ensureDir, log, sleep } from "./util.mjs";

// Log in once against the served app and persist storageState so every later
// measurement (Lighthouse, axe, interaction) reuses the session. Mirrors the
// existing Playwright global-setup selectors (data-test based).
export async function login(appUrl, resultsDir) {
  if (!AUTH.email || !AUTH.password) {
    throw new Error(
      "Missing ZO_ROOT_USER_EMAIL / ZO_ROOT_USER_PASSWORD — set them in web/benchmarks/.env",
    );
  }
  ensureDir(resultsDir);
  const storagePath = path.join(resultsDir, "auth.json");

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1024 } });
  const page = await context.newPage();
  try {
    log("logging in…");
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await sleep(1500);

    // Current UI gates the internal form behind a "Login as internal user"
    // button; the Quasar baseline shows the form directly. Click the gate only
    // if it's present.
    const internal = page.locator('[data-test="login-as-internal-user"]');
    if ((await internal.count()) && (await internal.first().isVisible().catch(() => false))) {
      await internal.first().click();
      await sleep(800);
    }

    // Resilient across both UIs: wait for the password field, then fill by
    // data-test fast-path OR generic input type. Baseline uses `login-user-id`
    // / `login-password` (q-input wrappers → inner <input>); current uses the
    // `-field` suffix on the real input element.
    const password = page
      .locator(
        '[data-test="login-password-field"], [data-test="login-password"] input, input[type="password"]',
      )
      .first();
    await password.waitFor({ state: "visible", timeout: 20000 });

    const userId = page
      .locator(
        '[data-test="login-user-id-field"], [data-test="login-user-id"] input, input[type="email"]',
      )
      .first();
    await userId.fill(AUTH.email);
    await password.fill(AUTH.password);

    const signIn = page
      .locator('[data-test="login-sign-in"], button[type="submit"]')
      .first();
    await signIn.click();

    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    // Success = we left the login page (menu item is current-UI only, so don't
    // rely on it alone).
    const ok = await Promise.race([
      page
        .locator('[data-test="menu-link-/-item"]')
        .waitFor({ state: "visible", timeout: 20000 })
        .then(() => true)
        .catch(() => false),
      page
        .waitForURL((u) => !u.toString().includes("/login"), { timeout: 20000 })
        .then(() => true)
        .catch(() => false),
    ]);
    if (!ok && page.url().includes("/login")) {
      throw new Error(`login did not complete — still on ${page.url()}`);
    }
    await sleep(1000);

    await context.storageState({ path: storagePath });
    log("login OK, session saved");
    return storagePath;
  } finally {
    await context.close();
    await browser.close();
  }
}

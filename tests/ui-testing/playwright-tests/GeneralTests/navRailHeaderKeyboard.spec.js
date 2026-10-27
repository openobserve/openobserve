const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");

const SIZES = [
  { width: 1440, height: 900 },
  { width: 800, height: 600 },
];
const DIRS = ["ltr", "rtl"];

const ROW = '[data-test="header-language-submenu-trigger"]';
const LIST = '[data-test="language-dropdown-item"]';
const OPTION = '[data-test^="language-dropdown-item-"]';
const PROFILE = '[data-test="header-my-account-profile-icon"]';
const EN_OPTION = '[data-test="language-dropdown-item-en-us"]';
const LANGUAGE_COOKIE = "vue3-typescript-admin-languageKey";

async function setLanguageCookie(page, code) {
  const url = new URL(process.env.ZO_BASE_URL);
  await page.context().addCookies([
    { name: LANGUAGE_COOKIE, value: code, domain: url.hostname, path: "/" },
  ]);
}

const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement);

async function openProfileMenuByKeyboard(page) {
  await page.locator(PROFILE).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(ROW)).toBeVisible();
}

async function arrowToRow(page) {
  const row = page.locator(ROW);
  for (let i = 0; i < 8; i++) {
    if (await isFocused(row)) return;
    await page.keyboard.press("ArrowDown");
  }
  expect(await isFocused(row)).toBe(true);
}

// Keyboard semantics (haspopup/expanded, open keys, Up/Down, Escape, focus ring) are
// asserted by the component spec, web/src/components/Header.spec.ts "language row
// keyboard (AC-10)". Only what jsdom cannot see lives here: real viewport clipping of
// the rendered list, and the real page reload a language change performs.
test.describe("Nav rail: header Language row keyboard (AC-10)", () => {
  test.describe.configure({ mode: "serial" });

  for (const size of SIZES) {
    for (const dir of DIRS) {
      test(`language list is reachable and unclipped at ${size.width}x${size.height} ${dir}`, async ({
        page,
      }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await page.setViewportSize(size);
        await setLanguageCookie(page, dir === "rtl" ? "ar" : "en-us");
        await navigateToBase(page);
        expect(await page.evaluate(() => document.documentElement.dir || "ltr")).toBe(dir);

        testLogger.step("Open the profile menu by keyboard, arrow to the Language row and open the list");
        await openProfileMenuByKeyboard(page);
        await arrowToRow(page);
        await page.keyboard.press("Enter");
        await expect(page.locator(LIST)).toBeVisible();

        testLogger.step("Every option is visible or reachable by the menu scroll and hit-testable");
        const options = page.locator(OPTION);
        const count = await options.count();
        expect(count).toBeGreaterThan(10);
        for (let i = 0; i < count; i++) {
          const option = options.nth(i);
          await option.scrollIntoViewIfNeeded();
          const hit = await option.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!at && (at === el || el.contains(at));
          });
          expect(hit, `option ${i} is hit-testable`).toBe(true);
        }

        testLogger.step("Arrow to English and choose it with Enter: the page reloads in English");
        const english = page.locator(EN_OPTION);
        for (let i = 0; i < count && !(await isFocused(english)); i++) {
          await page.keyboard.press("ArrowDown");
        }
        expect(await isFocused(english)).toBe(true);
        const reloaded = page.waitForEvent("load");
        await page.keyboard.press("Enter");
        await reloaded;
        await expect(page.locator(PROFILE)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.dir || "ltr")).toBe("ltr");
      });
    }
  }
});

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
const THEME_ROW = '[data-test="menu-link-predefined-themes-item"]';
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

        testLogger.step("Open the profile menu by keyboard and arrow to the Language row");
        await openProfileMenuByKeyboard(page);
        await arrowToRow(page);
        const row = page.locator(ROW);
        await expect(row).toHaveAttribute("aria-haspopup", "menu");
        await expect(row).toHaveAttribute("aria-expanded", "false");

        testLogger.step("Focus style matches the sibling items");
        // ODropdownItem animates its colours over 150 ms; read after the transition has settled.
        await page.waitForTimeout(300);
        const rowBg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
        await page.keyboard.press("ArrowDown");
        const themeRow = page.locator(THEME_ROW);
        expect(await isFocused(themeRow)).toBe(true);
        await page.waitForTimeout(300);
        const siblingBg = await themeRow.evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(rowBg).toBe(siblingBg);
        await page.keyboard.press("ArrowUp");
        expect(await isFocused(row)).toBe(true);

        testLogger.step("Enter opens the list and focuses the selected language");
        await page.keyboard.press("Enter");
        await expect(page.locator(LIST)).toBeVisible();
        await expect(row).toHaveAttribute("aria-expanded", "true");
        const selected = page.locator(`${OPTION}.font-semibold`).first();
        expect(await isFocused(selected)).toBe(true);

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

        testLogger.step("Up and Down move between languages and stay in the list");
        await selected.focus();
        const selectedIndex = await options.evaluateAll((els) =>
          els.findIndex((el) => el === document.activeElement),
        );
        await page.keyboard.press("ArrowDown");
        const afterDown = await options.evaluateAll((els) =>
          els.findIndex((el) => el === document.activeElement),
        );
        expect(afterDown).toBe((selectedIndex + 1) % count);
        await page.keyboard.press("ArrowUp");
        expect(await isFocused(selected)).toBe(true);
        await expect(page.locator(LIST)).toBeVisible();

        testLogger.step("Escape closes the list, refocuses the row and leaves the menu open");
        await page.keyboard.press("Escape");
        await expect(page.locator(LIST)).toBeHidden();
        expect(await isFocused(row)).toBe(true);
        await expect(row).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator(THEME_ROW)).toBeVisible();

        testLogger.step("The inline-start arrow (toward the list) opens it too; the other arrow as well");
        await page.keyboard.press(dir === "rtl" ? "ArrowRight" : "ArrowLeft");
        await expect(page.locator(LIST)).toBeVisible();
        expect(await isFocused(selected)).toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.locator(LIST)).toBeHidden();
        await page.keyboard.press(dir === "rtl" ? "ArrowLeft" : "ArrowRight");
        await expect(page.locator(LIST)).toBeVisible();

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

        testLogger.step("The same choice works by mouse");
        await page.locator(PROFILE).click();
        await page.locator(ROW).click();
        await expect(page.locator(LIST)).toBeVisible();
        const mouseReload = page.waitForEvent("load");
        await page.locator(EN_OPTION).click();
        await mouseReload;
        await expect(page.locator(PROFILE)).toBeVisible();
      });
    }
  }
});

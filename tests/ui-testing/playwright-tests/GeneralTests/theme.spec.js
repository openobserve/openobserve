const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("App Theme Default (Light/Dark) testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    testLogger.info('Theme default test setup completed');
  });

  test("should default to light mode on a fresh load with no theme key", {
    tag: ['@theme-default', '@theme', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Clearing theme storage for a fresh light-default load');

    // Seed before navigation: bootstrapTheme() reads localStorage.theme
    // synchronously in main.ts, so a write after navigateToBase has no effect.
    await page.addInitScript(() => {
      localStorage.removeItem('theme');
      localStorage.removeItem('appliedLightThemeName');
      localStorage.removeItem('appliedDarkThemeName');
      localStorage.removeItem('appliedLightTheme');
      localStorage.removeItem('appliedDarkTheme');
    });
    await navigateToBase(page);
    await pm.themePage.expectProfileMenuVisible();
    testLogger.info('Layout shell mounted; asserting default light mode');

    await pm.themePage.expectLightMode();
    expect(await pm.themePage.getCurrentThemeFromStorage()).not.toBe('dark');
    testLogger.info('Default light mode verified');
  });

  test("should boot in dark mode when theme is seeded to 'dark' before app scripts run", {
    tag: ['@theme-default', '@theme', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info("Seeding theme='dark' before navigation");

    // Seed the exact literal "dark" before navigation so the first paint is dark.
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await navigateToBase(page);
    await pm.themePage.waitForDarkModeApplied();
    testLogger.info('Dark class applied on <html>');

    await pm.themePage.expectDarkMode();
    expect(await pm.themePage.getCurrentThemeFromStorage()).toBe('dark');
    testLogger.info('Dark default on first paint verified');
  });

  test("should fall back to light mode for a corrupt non-'dark' theme value", {
    tag: ['@theme-default', '@theme', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info("Seeding a corrupt theme value 'DARK' before navigation");

    // Strict === "dark" means "DARK" (and "1", "true", "") resolves to light.
    await page.addInitScript(() => localStorage.setItem('theme', 'DARK'));
    await navigateToBase(page);
    await pm.themePage.expectProfileMenuVisible();
    testLogger.info('Layout shell mounted; asserting corrupt value resolved to light');

    await pm.themePage.expectLightMode();
    testLogger.info('Corrupt theme value resolved to light mode');
  });
});

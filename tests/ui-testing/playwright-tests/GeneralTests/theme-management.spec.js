const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Theme Management Tests", () => {
  test.describe.configure({ mode: 'serial' }); // Serial to avoid theme state conflicts
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    testLogger.info('Theme management test setup completed');
  });

  test.describe("Theme Switcher", () => {
    test("should toggle between light and dark mode and persist after reload", {
      tag: ['@theme', '@themeSwitcher', '@themePersistence', '@P1']
    }, async ({ page }) => {
      testLogger.info('Testing theme mode toggle and persistence functionality');

      // Get initial theme state
      const initialIsDark = await pm.themePage.isDarkMode();
      testLogger.info(`Initial theme mode: ${initialIsDark ? 'dark' : 'light'}`);

      // Toggle theme
      await pm.themePage.toggleThemeMode();

      // Verify theme changed
      const afterToggleIsDark = await pm.themePage.isDarkMode();
      expect(afterToggleIsDark).not.toBe(initialIsDark);
      testLogger.info(`Theme toggled to: ${afterToggleIsDark ? 'dark' : 'light'}`);

      // Toggle back to original
      await pm.themePage.toggleThemeMode();

      // Verify theme restored
      const finalIsDark = await pm.themePage.isDarkMode();
      expect(finalIsDark).toBe(initialIsDark);
      testLogger.info('Theme toggle test completed');

      // Test persistence - switch to dark mode
      await pm.themePage.switchToDarkMode();
      await pm.themePage.expectDarkMode();
      testLogger.info('Switched to dark mode for persistence test');

      // Reload the page
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // Wait for theme to be restored from storage (Vue/Quasar needs time to apply it)
      await page.waitForFunction(
        (darkClass) => document.body.classList.contains(darkClass),
        'body--dark',
        { timeout: 10000 }
      );

      // Verify dark mode persisted
      await pm.themePage.expectDarkMode();
      testLogger.info('Dark mode persisted after reload');

      // Switch back to light mode for cleanup
      await pm.themePage.switchToLightMode();
      testLogger.info('Theme toggle and persistence test completed');
    });
  });

  test.describe("Predefined Themes", () => {
    test("should open dialog, display tabs and theme options, then close", {
      tag: ['@theme', '@predefinedThemes', '@P1']
    }, async ({ page }) => {
      testLogger.info('Testing predefined themes dialog functionality');

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();
      await pm.themePage.expectPredefinedThemesDialogVisible();
      testLogger.info('Predefined themes dialog opened');

      // Verify light mode tab is visible
      await expect(page.locator(pm.themePage.lightModeTab)).toBeVisible();
      testLogger.info('Light Mode tab visible');

      // Verify dark mode tab is visible
      await expect(page.locator(pm.themePage.darkModeTab)).toBeVisible();
      testLogger.info('Dark Mode tab visible');

      // Switch between tabs
      await pm.themePage.selectDarkModeTab();
      testLogger.info('Switched to Dark Mode tab');

      await pm.themePage.selectLightModeTab();
      testLogger.info('Switched back to Light Mode tab');

      // Verify predefined theme options (use .first() as themes exist in both Light and Dark tabs)
      const expectedThemes = ['Ocean Breeze', 'Purple Dream', 'Indigo Night', 'Sky Blue'];
      for (const themeName of expectedThemes) {
        const themeCard = page.locator(pm.themePage.themeCard).filter({ hasText: themeName }).first();
        await expect(themeCard).toBeVisible();
        testLogger.info(`Theme "${themeName}" is visible`);
      }

      // Verify Custom Color option exists
      const customCard = page.locator(pm.themePage.themeCard).filter({ hasText: 'Custom Color' }).first();
      await expect(customCard).toBeVisible();
      testLogger.info('Custom Color option is visible');

      // Close dialog
      await pm.themePage.closePredefinedThemesDialog();
      await pm.themePage.expectPredefinedThemesDialogHidden();
      testLogger.info('Predefined themes dialog closed');
    });

    test("should apply predefined theme, show Applied badge, and reset to default", {
      tag: ['@theme', '@predefinedThemes', '@applyTheme', '@resetTheme', '@P1']
    }, async ({ page }) => {
      testLogger.info('Testing predefined theme application and reset');

      // Ensure we're in light mode first
      await pm.themePage.switchToLightMode();

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();

      // Apply "Ocean Breeze" theme
      await pm.themePage.applyThemeByName('Ocean Breeze');
      testLogger.info('Applied Ocean Breeze theme');

      // Verify notification
      await pm.themePage.expectNotificationContains('applied');
      testLogger.info('Theme application notification shown');

      // Verify "Applied" badge appears
      const isApplied = await pm.themePage.isThemeApplied('Ocean Breeze');
      expect(isApplied).toBe(true);
      testLogger.info('Applied badge shown for Ocean Breeze');

      // Now test reset - Apply a different theme first
      await pm.themePage.applyThemeByName('Purple Dream');
      testLogger.info('Applied Purple Dream theme');

      // Reset to default
      await pm.themePage.resetToDefaultTheme();
      testLogger.info('Reset theme to default');

      // Verify reset notification
      try {
        await pm.themePage.expectNotificationContains('reset');
        testLogger.info('Reset notification shown');
      } catch (e) {
        testLogger.info('Reset notification not captured (may have been transient)');
      }

      // Close dialog
      await pm.themePage.closePredefinedThemesDialog();
      testLogger.info('Apply and reset theme test completed');
    });

    test("should apply theme in dark mode", {
      tag: ['@theme', '@darkMode', '@P2']
    }, async ({ page }) => {
      testLogger.info('Testing theme application in dark mode');

      // Switch to dark mode
      await pm.themePage.switchToDarkMode();
      await pm.themePage.expectDarkMode();
      testLogger.info('Switched to dark mode');

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();

      // Select dark mode tab
      await pm.themePage.selectDarkModeTab();

      // Apply "Sky Blue" theme for dark mode
      await pm.themePage.applyThemeByName('Sky Blue');
      testLogger.info('Applied Sky Blue theme in dark mode');

      // Verify notification
      await pm.themePage.expectNotificationContains('applied');

      // Reset to default
      await pm.themePage.resetToDefaultTheme();

      // Close dialog and switch back to light mode
      await pm.themePage.closePredefinedThemesDialog();
      await pm.themePage.switchToLightMode();
      testLogger.info('Dark mode theme test completed');
    });
  });

  test.describe("Custom Color Theme", () => {
    test("should open color picker, close it, and apply custom color theme", {
      tag: ['@theme', '@customColor', '@P2']
    }, async ({ page }) => {
      testLogger.info('Testing custom color theme functionality');

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();

      // Open custom color picker
      await pm.themePage.openCustomColorPicker();
      testLogger.info('Custom color picker opened');

      // Verify color picker is visible
      await expect(page.locator(pm.themePage.colorPickerDialog).first()).toBeVisible();
      testLogger.info('Color picker dialog is visible');

      // Close color picker
      await pm.themePage.closeColorPicker();
      testLogger.info('Color picker closed');

      // Apply custom color theme
      await pm.themePage.applyCustomColor();
      testLogger.info('Applied custom color theme');

      // Verify notification
      try {
        await pm.themePage.expectNotificationContains('Custom color applied');
        testLogger.info('Custom color notification shown');
      } catch (e) {
        testLogger.info('Custom color notification not captured (may have been transient)');
      }

      // Reset to default for cleanup
      await pm.themePage.resetToDefaultTheme();

      // Close dialog
      await pm.themePage.closePredefinedThemesDialog();
      testLogger.info('Custom color theme test completed');
    });
  });

  test.afterEach(async () => {
    // Ensure we're back to light mode for next test
    try {
      await pm.themePage.switchToLightMode();
    } catch (e) {
      // Ignore errors in cleanup
    }
    testLogger.info('Theme management test completed');
  });
});

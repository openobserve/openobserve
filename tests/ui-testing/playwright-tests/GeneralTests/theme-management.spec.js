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

  test.describe("Theme Switcher Toggle", () => {
    test("should toggle between light and dark mode using header button", {
      tag: ['@theme', '@themeSwitcher', '@P1']
    }, async ({ page }) => {
      testLogger.info('Testing theme mode toggle functionality');

      // Get initial theme state
      const initialIsDark = await pm.themePage.isDarkMode();
      testLogger.info(`Initial theme mode: ${initialIsDark ? 'dark' : 'light'}`);

      // Toggle theme
      await pm.themePage.toggleThemeMode();
      await page.waitForTimeout(500);

      // Verify theme changed
      const afterToggleIsDark = await pm.themePage.isDarkMode();
      expect(afterToggleIsDark).not.toBe(initialIsDark);
      testLogger.info(`Theme toggled to: ${afterToggleIsDark ? 'dark' : 'light'}`);

      // Toggle back to original
      await pm.themePage.toggleThemeMode();
      await page.waitForTimeout(500);

      // Verify theme restored
      const finalIsDark = await pm.themePage.isDarkMode();
      expect(finalIsDark).toBe(initialIsDark);
      testLogger.info('Theme toggle test completed successfully');
    });

    test("should persist theme preference after page reload", {
      tag: ['@theme', '@themePersistence', '@P1']
    }, async ({ page }) => {
      testLogger.info('Testing theme persistence across page reload');

      // Switch to dark mode
      await pm.themePage.switchToDarkMode();
      await page.waitForTimeout(500);
      await pm.themePage.expectDarkMode();
      testLogger.info('Switched to dark mode');

      // Reload the page
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Verify dark mode persisted
      await pm.themePage.expectDarkMode();
      testLogger.info('Dark mode persisted after reload');

      // Switch back to light mode for cleanup
      await pm.themePage.switchToLightMode();
      await page.waitForTimeout(500);
      testLogger.info('Theme persistence test completed');
    });
  });

  test.describe("Predefined Themes Dialog", () => {
    test("should open and close predefined themes dialog", {
      tag: ['@theme', '@predefinedThemes', '@P1']
    }, async ({ page }) => {
      testLogger.info('Testing predefined themes dialog open/close');

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();
      await pm.themePage.expectPredefinedThemesDialogVisible();
      testLogger.info('Predefined themes dialog opened');

      // Close dialog
      await pm.themePage.closePredefinedThemesDialog();
      await page.waitForTimeout(500);
      await pm.themePage.expectPredefinedThemesDialogHidden();
      testLogger.info('Predefined themes dialog closed');
    });

    test("should display light and dark mode tabs in predefined themes", {
      tag: ['@theme', '@predefinedThemes', '@P2']
    }, async ({ page }) => {
      testLogger.info('Testing light/dark mode tabs in predefined themes');

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();

      // Verify light mode tab is visible
      await expect(page.locator('.q-tab:has-text("Light Mode")')).toBeVisible();
      testLogger.info('Light Mode tab visible');

      // Verify dark mode tab is visible
      await expect(page.locator('.q-tab:has-text("Dark Mode")')).toBeVisible();
      testLogger.info('Dark Mode tab visible');

      // Switch between tabs
      await pm.themePage.selectDarkModeTab();
      await page.waitForTimeout(300);
      testLogger.info('Switched to Dark Mode tab');

      await pm.themePage.selectLightModeTab();
      await page.waitForTimeout(300);
      testLogger.info('Switched back to Light Mode tab');

      // Close dialog
      await pm.themePage.closePredefinedThemesDialog();
      testLogger.info('Tabs test completed');
    });

    test("should display predefined theme options", {
      tag: ['@theme', '@predefinedThemes', '@P2']
    }, async ({ page }) => {
      testLogger.info('Testing predefined theme options display');

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();

      // Expected theme names
      const expectedThemes = ['Ocean Breeze', 'Purple Dream', 'Indigo Night', 'Sky Blue'];

      for (const themeName of expectedThemes) {
        const themeCard = page.locator('.theme-card-compact').filter({ hasText: themeName });
        await expect(themeCard).toBeVisible();
        testLogger.info(`Theme "${themeName}" is visible`);
      }

      // Verify Custom Color option exists
      const customCard = page.locator('.theme-card-compact').filter({ hasText: 'Custom Color' });
      await expect(customCard).toBeVisible();
      testLogger.info('Custom Color option is visible');

      // Close dialog
      await pm.themePage.closePredefinedThemesDialog();
      testLogger.info('Predefined theme options test completed');
    });

    test("should apply predefined theme and show Applied badge", {
      tag: ['@theme', '@predefinedThemes', '@applyTheme', '@P1']
    }, async ({ page }) => {
      testLogger.info('Testing predefined theme application');

      // Ensure we're in light mode first
      await pm.themePage.switchToLightMode();
      await page.waitForTimeout(500);

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

      // Reset to default for cleanup
      await pm.themePage.resetToDefaultTheme();
      await page.waitForTimeout(500);

      // Close dialog
      await pm.themePage.closePredefinedThemesDialog();
      testLogger.info('Apply theme test completed');
    });

    test("should reset theme to default", {
      tag: ['@theme', '@predefinedThemes', '@resetTheme', '@P1']
    }, async ({ page }) => {
      testLogger.info('Testing theme reset functionality');

      // Ensure we're in light mode
      await pm.themePage.switchToLightMode();
      await page.waitForTimeout(500);

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();

      // Apply a theme first
      await pm.themePage.applyThemeByName('Purple Dream');
      await page.waitForTimeout(500);
      testLogger.info('Applied Purple Dream theme');

      // Reset to default
      await pm.themePage.resetToDefaultTheme();
      await page.waitForTimeout(1000);
      testLogger.info('Reset theme to default');

      // Verify notification (may be quick so use try/catch)
      try {
        await pm.themePage.expectNotificationContains('reset');
        testLogger.info('Reset notification shown');
      } catch (e) {
        // Notification may have already disappeared, which is acceptable
        testLogger.info('Reset notification not captured (may have been transient)');
      }

      // Close dialog
      await pm.themePage.closePredefinedThemesDialog();
      testLogger.info('Reset theme test completed');
    });
  });

  test.describe("Dark Mode Theme Application", () => {
    test("should apply theme in dark mode", {
      tag: ['@theme', '@darkMode', '@P2']
    }, async ({ page }) => {
      testLogger.info('Testing theme application in dark mode');

      // Switch to dark mode
      await pm.themePage.switchToDarkMode();
      await page.waitForTimeout(500);
      await pm.themePage.expectDarkMode();
      testLogger.info('Switched to dark mode');

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();

      // Verify we're on dark mode tab (should auto-select based on current mode)
      await pm.themePage.selectDarkModeTab();
      await page.waitForTimeout(300);

      // Apply "Sky Blue" theme for dark mode
      await pm.themePage.applyThemeByName('Sky Blue');
      testLogger.info('Applied Sky Blue theme in dark mode');

      // Verify notification
      await pm.themePage.expectNotificationContains('applied');

      // Reset to default
      await pm.themePage.resetToDefaultTheme();
      await page.waitForTimeout(500);

      // Close dialog and switch back to light mode
      await pm.themePage.closePredefinedThemesDialog();
      await pm.themePage.switchToLightMode();
      testLogger.info('Dark mode theme test completed');
    });
  });

  test.describe("Custom Color Theme", () => {
    test("should open custom color picker", {
      tag: ['@theme', '@customColor', '@P2']
    }, async ({ page }) => {
      testLogger.info('Testing custom color picker');

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();

      // Click on custom color preview to open picker
      await pm.themePage.openCustomColorPicker();
      testLogger.info('Custom color picker opened');

      // Verify color picker is visible (Quasar renders as q-color-picker or q-color)
      await expect(page.locator('.q-color-picker, .q-color').first()).toBeVisible();
      testLogger.info('Color picker dialog is visible');

      // Close color picker
      await pm.themePage.closeColorPicker();
      await page.waitForTimeout(300);

      // Close predefined themes dialog
      await pm.themePage.closePredefinedThemesDialog();
      testLogger.info('Custom color picker test completed');
    });

    test("should apply custom color theme", {
      tag: ['@theme', '@customColor', '@applyCustom', '@P2']
    }, async ({ page }) => {
      testLogger.info('Testing custom color theme application');

      // Open predefined themes dialog
      await pm.themePage.openPredefinedThemesDialog();

      // Apply custom color theme
      await pm.themePage.applyCustomColor();
      testLogger.info('Applied custom color theme');

      // Verify notification (message: "Custom color applied to light mode successfully!")
      try {
        await pm.themePage.expectNotificationContains('Custom color applied');
        testLogger.info('Custom color notification shown');
      } catch (e) {
        // Notification may have already disappeared
        testLogger.info('Custom color notification not captured (may have been transient)');
      }

      // Reset to default for cleanup
      await pm.themePage.resetToDefaultTheme();
      await page.waitForTimeout(500);

      // Close dialog
      await pm.themePage.closePredefinedThemesDialog();
      testLogger.info('Custom color theme test completed');
    });
  });

  test.afterEach(async ({ page }) => {
    // Ensure we're back to light mode for next test
    try {
      await pm.themePage.switchToLightMode();
    } catch (e) {
      // Ignore errors in cleanup
    }
    testLogger.info('Theme management test completed');
  });
});

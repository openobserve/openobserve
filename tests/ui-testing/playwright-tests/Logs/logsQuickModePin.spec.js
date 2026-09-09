const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");

test.describe("Logs Quick Mode Pin to Toolbar testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.logsPage.selectStream("e2e_automate");
    await pm.logsPage.clickRefreshButton();
    testLogger.info('Test setup completed');
  });

  test("should render the pinned Quick Mode toolbar toggle after pinning", {
    tag: ['@logs-quick-mode-pin', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Verifying pinning Quick Mode renders the toolbar toggle');

    // Establish a clean unpinned baseline (first load defaults to pinned)
    await pm.logsPage.clickQuickModePin();
    await pm.logsPage.expectQuickModePinnedToggleHidden();

    // Pin Quick Mode to the toolbar
    await pm.logsPage.clickQuickModePin();

    await pm.logsPage.expectQuickModePinnedToggleVisible();
    await expect(await pm.logsPage.getPinButtonColorState()).toBe(true);

    testLogger.info('Pin renders toolbar toggle — completed');
  });

  test("should unpin Quick Mode and remove the pinned toolbar toggle", {
    tag: ['@logs-quick-mode-pin', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Verifying unpinning Quick Mode removes the toolbar toggle');

    // Guard: default state is pinned (toolbar toggle visible)
    await pm.logsPage.expectQuickModePinnedToggleVisible();

    // Unpin Quick Mode
    await pm.logsPage.clickQuickModePin();

    await pm.logsPage.expectQuickModePinnedToggleHidden();
    await expect(await pm.logsPage.getPinButtonColorState()).toBe(false);

    testLogger.info('Unpin removes toolbar toggle — completed');
  });

  test("should persist the Quick Mode pin state across page reload", {
    tag: ['@logs-quick-mode-pin', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Verifying pin state persists across reload');

    // Guard: default state is pinned (toolbar toggle visible)
    await pm.logsPage.expectQuickModePinnedToggleVisible();

    // Unpin so a non-default value is persisted to localStorage
    await pm.logsPage.clickQuickModePin();
    await pm.logsPage.expectQuickModePinnedToggleHidden();

    // Reload and re-select the stream
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.selectStream("e2e_automate");

    // The unpinned state must survive the reload (default would be visible)
    await pm.logsPage.expectQuickModePinnedToggleHidden();

    testLogger.info('Pin state persisted across reload — completed');
  });

  test("should toggle Quick Mode using the pinned toolbar toggle", {
    tag: ['@logs-quick-mode-pin', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Verifying the pinned toolbar toggle flips Quick Mode');

    // Guard: default state is pinned (toolbar toggle visible)
    await pm.logsPage.expectQuickModePinnedToggleVisible();

    const initialState = await pm.logsPage.getQuickModePinnedToggleState();

    await pm.logsPage.clickQuickModePinnedToggle();

    await expect.poll(() => pm.logsPage.getQuickModePinnedToggleState()).toBe(!initialState);

    testLogger.info('Pinned toolbar toggle flips Quick Mode — completed');
  });

  test("should not toggle Quick Mode when clicking the pin button", {
    tag: ['@logs-quick-mode-pin', '@all', '@logs']
  }, async ({ page }) => {
    testLogger.info('Verifying the pin button does not toggle Quick Mode (decoupled controls)');

    // Guard: default state is pinned (toolbar toggle visible)
    await pm.logsPage.expectQuickModePinnedToggleVisible();

    const quickModeBefore = await pm.logsPage.getQuickModeState();

    // Click the pin button (unpin) — must NOT change Quick Mode
    await pm.logsPage.clickQuickModePin();

    // Guard: the pin click actually took effect (toolbar toggle removed)
    await pm.logsPage.expectQuickModePinnedToggleHidden();

    const quickModeAfter = await pm.logsPage.getQuickModeState();

    await expect(quickModeAfter).toBe(quickModeBefore);

    testLogger.info('Pin button did not toggle Quick Mode — completed');
  });
});

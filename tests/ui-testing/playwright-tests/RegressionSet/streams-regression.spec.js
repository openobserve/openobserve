const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTestData } = require('../utils/data-ingestion.js');

test.describe("Streams Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Post-authentication stabilization wait
    await page.waitForLoadState('networkidle');

    testLogger.info('Streams regression bug test setup completed');
  });

  test("should allow query expand icon to work after navigating from stream explorer (#9337)", {
    tag: ['@queryExpand', '@streamExplorer', '@regressionBugs', '@P0', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing query expand icon functionality after stream explorer navigation');

    // Data ingestion
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');

    // Navigate to streams page using logsPage method (same pattern as working tests)
    await pm.logsPage.clickStreamsMenuItem();
    await pm.logsPage.clickSearchStreamInput();
    await pm.logsPage.fillSearchStreamInput("e2e_automate");
    await page.waitForLoadState('networkidle'); // Wait for search results

    // Click explore button and wait for navigation to logs page
    await Promise.all([
      page.waitForURL('**/logs**', { timeout: 30000 }),
      pm.logsPage.clickExploreButton()
    ]);
    await page.waitForLoadState('networkidle');

    // Verify URL contains 'logs' to confirm navigation
    await pm.logsPage.expectUrlContainsLogs();
    testLogger.info('Navigated to logs page after stream explorer click');

    // Verify expand button exists after stream explorer navigation
    await pm.logsPage.expectQueryEditorFullScreenBtnVisible();
    testLogger.info('Query expand button found after stream explorer navigation');

    // Get initial expanded state
    const isInitiallyExpanded = await pm.logsPage.isQueryEditorExpanded();
    testLogger.debug('Query editor initial expanded state', { expanded: isInitiallyExpanded });

    // Toggle the expand button and verify state changed
    const { initialState, newState, toggled } = await pm.logsPage.toggleQueryEditorFullScreen();
    testLogger.debug('Query editor state after toggle', { initialState, newState, toggled });

    // The button should toggle the expanded state
    expect(toggled).toBe(true);
    testLogger.info(`Query expand icon test completed - button successfully ${newState ? 'expanded' : 'collapsed'} editor after stream explorer navigation`);
  });

  test.afterEach(async () => {
    testLogger.info('Streams regression test completed');
  });
});

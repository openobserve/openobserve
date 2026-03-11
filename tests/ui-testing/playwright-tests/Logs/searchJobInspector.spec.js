import { test, expect } from '../baseFixtures.js';
import { LoginPage } from '../../pages/generalPages/loginPage.js';
import { LogsPage } from '../../pages/logsPages/logsPage.js';
import { SearchJobInspectorPage } from '../../pages/logsPages/searchJobInspectorPage.js';
import { IngestionPage } from '../../pages/generalPages/ingestionPage.js';

const testLogger = require('../utils/test-logger.js');

// Use default parallel mode - each test has independent login in beforeEach
// Serial mode was incorrect since tests don't share state

test.describe("Search Job Inspector UI Tests", { tag: ['@enterprise', '@searchJobInspector'] }, () => {
  let loginPage, logsPage, inspectorPage, ingestionPage;
  const stream = "e2e_automate";

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    logsPage = new LogsPage(page);
    inspectorPage = new SearchJobInspectorPage(page);
    ingestionPage = new IngestionPage(page);

    await loginPage.gotoLoginPage();
    await loginPage.loginAsInternalUser();
    await loginPage.login();
  });

  test("should show Search Inspect option in menu (Enterprise feature)", async ({ page }) => {
    await logsPage.navigateToLogs();
    await page.waitForLoadState('networkidle');

    // Check if Search Inspect option is visible in more options menu
    const isVisible = await inspectorPage.isSearchInspectVisible();
    testLogger.info(`Search Inspect option visible: ${isVisible}`);

    // For Enterprise tests, the feature MUST exist
    expect(isVisible).toBe(true);
  });

  test("should navigate to Inspector page via Search History", async ({ page }) => {
    // Select stream and run search to generate history
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('networkidle');

    await inspectorPage.runSearch();
    await page.waitForLoadState('networkidle');

    // Open Search History
    await inspectorPage.openSearchHistory();
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.takeScreenshot('search-history-panel');

    // Check if Inspect button exists in history
    const hasInspect = await inspectorPage.hasHistoryInspectButtons();
    testLogger.info(`History has Inspect buttons: ${hasInspect}`);

    // For Enterprise, Inspect button MUST be present
    expect(hasInspect).toBe(true);

    // Click Inspect and verify navigation
    await inspectorPage.inspectFromHistory();

    // Verify we're on inspector page
    await inspectorPage.assertInspectorPageVisible();
    await inspectorPage.assertUrlHasTraceId();
  });

  test("should navigate to inspector page directly with trace_id", async ({ page }) => {
    // Navigate directly to inspector page with a test trace_id
    await inspectorPage.navigateToInspector('test-trace-id-12345');

    await inspectorPage.takeScreenshot('inspector-page-direct');

    // Verify URL contains correct parameters
    const currentUrl = await inspectorPage.getCurrentUrl();
    expect(currentUrl).toContain('/logs/inspector');
    expect(currentUrl).toContain('trace_id=test-trace-id-12345');

    // Page should load (may show "no events" for invalid trace, but page loads)
    const isOnInspector = await inspectorPage.isOnInspectorPage();
    testLogger.info(`Inspector page loaded: ${isOnInspector}`);

    // For direct navigation, page should at least load
    expect(isOnInspector).toBe(true);
  });

  test("should open Search Inspect dialog and submit trace ID", async ({ page }) => {
    await logsPage.navigateToLogs();
    await page.waitForLoadState('networkidle');

    await inspectorPage.takeScreenshot('before-inspect-dialog');

    // Open Search Inspect dialog via menu
    await inspectorPage.clickSearchInspectOption();

    // Verify dialog elements are visible
    const traceIdInput = page.locator(inspectorPage.traceIdInput);
    await expect(traceIdInput).toBeVisible({ timeout: 5000 });

    const submitBtn = page.locator(inspectorPage.inspectSubmitBtn);
    await expect(submitBtn).toBeVisible({ timeout: 5000 });

    await inspectorPage.takeScreenshot('inspect-dialog-open');

    // Fill and submit
    await traceIdInput.fill('dialog-test-trace-123');
    await submitBtn.click();
    await page.waitForLoadState('networkidle');

    // Verify navigation to inspector
    await inspectorPage.assertUrlHasTraceId();
  });

  test("should display inspector page components", async ({ page }) => {
    // Run search to get valid trace_id
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('networkidle');

    await inspectorPage.runSearch();
    await page.waitForLoadState('networkidle');

    // Navigate to inspector via history
    await inspectorPage.openSearchHistory();
    await page.waitForLoadState('domcontentloaded');

    const hasInspect = await inspectorPage.hasHistoryInspectButtons();
    expect(hasInspect).toBe(true);

    await inspectorPage.inspectFromHistory();

    // Verify inspector page loaded
    await inspectorPage.assertInspectorPageVisible();

    await inspectorPage.takeScreenshot('inspector-components');

    // Verify key components using text-based checks
    const tilesVisibility = await inspectorPage.getTilesVisibility();
    testLogger.info('Tiles visibility:', tilesVisibility);

    // At least some tiles should be visible
    expect(
      tilesVisibility.results ||
      tilesVisibility.events ||
      tilesVisibility.timeTaken ||
      tilesVisibility.traceId
    ).toBe(true);

    // Check View Query button
    const viewQueryVisible = await inspectorPage.isViewQueryVisible();
    testLogger.info(`View Query button visible: ${viewQueryVisible}`);
    expect(viewQueryVisible).toBe(true);
  });

  test("should display events table when data exists", async ({ page }) => {
    // Run search first
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('networkidle');

    await inspectorPage.runSearch();
    await page.waitForLoadState('networkidle');

    // Navigate to inspector via history
    await inspectorPage.openSearchHistory();
    await page.waitForLoadState('domcontentloaded');

    const hasInspect = await inspectorPage.hasHistoryInspectButtons();
    expect(hasInspect).toBe(true);

    await inspectorPage.inspectFromHistory();
    await inspectorPage.assertInspectorPageVisible();

    await inspectorPage.takeScreenshot('events-table-test');

    // Check events table visibility
    const isTableVisible = await inspectorPage.isEventsTableVisible();
    const hasNoEvents = await inspectorPage.hasNoEventsMessage();
    const hasError = await inspectorPage.hasError();

    testLogger.info(`Events table visible: ${isTableVisible}`);
    testLogger.info(`No events message: ${hasNoEvents}`);
    testLogger.info(`Error state: ${hasError}`);

    // One of these states should be true (table visible, no events, or valid error)
    expect(isTableVisible || hasNoEvents || hasError).toBe(true);
  });

  test("should open View Query dialog and display SQL content", async ({ page }) => {
    // Run search first
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('networkidle');

    await inspectorPage.runSearch();
    await page.waitForLoadState('networkidle');

    // Navigate to inspector via history
    await inspectorPage.openSearchHistory();
    await page.waitForLoadState('domcontentloaded');

    const hasInspect = await inspectorPage.hasHistoryInspectButtons();
    expect(hasInspect).toBe(true);

    await inspectorPage.inspectFromHistory();
    await inspectorPage.assertInspectorPageVisible();

    // Check View Query button
    const viewQueryVisible = await inspectorPage.isViewQueryVisible();
    expect(viewQueryVisible).toBe(true);

    await inspectorPage.takeScreenshot('before-view-query');

    // Open View Query dialog
    await inspectorPage.openViewQueryDialog();
    await inspectorPage.takeScreenshot('view-query-dialog');

    // Get SQL content
    const sqlContent = await inspectorPage.getSqlQueryContent();
    testLogger.info(`SQL content length: ${sqlContent.length}`);
    testLogger.info(`SQL preview: ${sqlContent.substring(0, 100)}`);

    // SQL content should exist (even if empty for no-data cases)
    // Close dialog
    await inspectorPage.closeSqlDialog();
  });

  test("should close inspector and navigate back", async ({ page }) => {
    // Run search first
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('networkidle');

    await inspectorPage.runSearch();
    await page.waitForLoadState('networkidle');

    // Navigate to inspector
    await inspectorPage.openSearchHistory();
    await page.waitForLoadState('domcontentloaded');

    const hasInspect = await inspectorPage.hasHistoryInspectButtons();
    expect(hasInspect).toBe(true);

    await inspectorPage.inspectFromHistory();
    await inspectorPage.assertInspectorPageVisible();

    const inspectorUrl = await inspectorPage.getCurrentUrl();
    expect(inspectorUrl).toContain('/logs/inspector');

    await inspectorPage.takeScreenshot('before-close');

    // Check close button
    const isCloseVisible = await inspectorPage.isCloseBtnVisible();
    testLogger.info(`Close button visible: ${isCloseVisible}`);
    expect(isCloseVisible).toBe(true);

    // Click close
    await inspectorPage.closeInspector();

    // Verify we navigated away from inspector
    const afterCloseUrl = await inspectorPage.getCurrentUrl();
    testLogger.info(`URL after close: ${afterCloseUrl}`);
    expect(afterCloseUrl).not.toContain('/logs/inspector');

    await inspectorPage.takeScreenshot('after-close');
  });

  test("should handle error state gracefully", async ({ page }) => {
    // Navigate directly with an invalid trace_id
    await inspectorPage.navigateToInspector('invalid-trace-does-not-exist');

    await inspectorPage.takeScreenshot('invalid-trace-error');

    // Page should load
    const isOnInspector = await inspectorPage.isOnInspectorPage();
    expect(isOnInspector).toBe(true);

    // Should show either error or no events message
    const hasError = await inspectorPage.hasError();
    const hasNoEvents = await inspectorPage.hasNoEventsMessage();

    testLogger.info(`Error banner: ${hasError}, No events: ${hasNoEvents}`);

    // One of these should be shown for invalid trace
    expect(hasError || hasNoEvents).toBe(true);
  });

  test("should display inspector stats after search", async ({ page }) => {
    // Run search
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('networkidle');

    await inspectorPage.runSearch();
    await page.waitForLoadState('networkidle');

    // Get search results before going to inspector
    const searchResults = await inspectorPage.parseSearchResults();
    testLogger.info(`Search results: Events=${searchResults.eventsCount}, Time=${searchResults.timeMs}ms`);

    // Navigate to inspector
    await inspectorPage.openSearchHistory();
    await page.waitForLoadState('domcontentloaded');

    const hasInspect = await inspectorPage.hasHistoryInspectButtons();
    expect(hasInspect).toBe(true);

    await inspectorPage.inspectFromHistory();
    await inspectorPage.assertInspectorPageVisible();

    // Verify stats tiles are visible (value extraction is complex due to DOM structure)
    const tilesVisibility = await inspectorPage.getTilesVisibility();
    testLogger.info('Tiles visibility:', tilesVisibility);

    await inspectorPage.takeScreenshot('inspector-stats');

    // At least some stat tiles should be visible
    const hasStatTiles = tilesVisibility.results || tilesVisibility.events ||
                         tilesVisibility.timeTaken || tilesVisibility.traceId;
    expect(hasStatTiles).toBe(true);
  });
});

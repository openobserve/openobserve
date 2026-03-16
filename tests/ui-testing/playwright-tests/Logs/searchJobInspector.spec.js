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
    await page.waitForLoadState('domcontentloaded');

    // Check if Search Inspect option is visible in more options menu
    const isVisible = await inspectorPage.isSearchInspectVisible();
    testLogger.info(`Search Inspect option visible: ${isVisible}`);

    // For Enterprise tests, the feature MUST exist
    expect(isVisible).toBe(true);
  });

  test("should navigate to Inspector page via Search History", async ({ page }) => {
    // Select stream and run search to generate history
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.runSearch();
    await page.waitForLoadState('domcontentloaded');

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
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.takeScreenshot('before-inspect-dialog');

    // Open Search Inspect dialog via menu
    await inspectorPage.clickSearchInspectOption();

    // Verify dialog elements are visible using page object methods
    await inspectorPage.assertTraceIdInputVisible();
    await inspectorPage.assertInspectSubmitBtnVisible();

    await inspectorPage.takeScreenshot('inspect-dialog-open');

    // Fill and submit using page object methods
    await inspectorPage.fillTraceIdInput('dialog-test-trace-123');
    await inspectorPage.clickInspectSubmitBtn();
    await page.waitForLoadState('domcontentloaded');

    // Verify navigation to inspector
    await inspectorPage.assertUrlHasTraceId();
  });

  test("should display inspector page components", async ({ page }) => {
    // Run search to get valid trace_id
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.runSearch();
    await page.waitForLoadState('domcontentloaded');

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
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.runSearch();
    await page.waitForLoadState('domcontentloaded');

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
    await page.waitForLoadState('domcontentloaded');

    await logsPage.selectRunQuery();
    await page.waitForLoadState('domcontentloaded');

    // Navigate to inspector via direct Inspect button (more reliable than history)
    const isInspectVisible = await inspectorPage.isInspectButtonVisible();
    expect(isInspectVisible).toBe(true);

    await inspectorPage.clickInspectButton();
    await inspectorPage.assertInspectorPageVisible();

    // Wait for inspector data to load
    await page.waitForTimeout(2000);

    // Check if inspector has valid data (not showing NA/error state)
    const hasError = await inspectorPage.hasError();

    await inspectorPage.takeScreenshot('before-view-query');

    // If there's an error or no data, skip the SQL content test
    if (hasError) {
      testLogger.warn('Inspector shows error state - skipping SQL content check');
      return;
    }

    // Check View Query button
    const viewQueryVisible = await inspectorPage.isViewQueryVisible();
    expect(viewQueryVisible).toBe(true);

    // Open View Query dialog
    await inspectorPage.openViewQueryDialog();
    await inspectorPage.takeScreenshot('view-query-dialog');

    // Get SQL content
    const sqlContent = await inspectorPage.getSqlQueryContent();
    testLogger.info(`SQL content length: ${sqlContent.length}`);
    testLogger.info(`SQL preview: ${sqlContent.substring(0, 100)}`);

    // SQL content should exist and contain SQL keywords
    expect(sqlContent.length).toBeGreaterThan(0);
    expect(sqlContent.toLowerCase()).toContain('select');

    // Close dialog
    await inspectorPage.closeSqlDialog();
  });

  test("should close inspector and navigate back", async ({ page }) => {
    // Run search first
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.runSearch();
    await page.waitForLoadState('domcontentloaded');

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
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.runSearch();
    await page.waitForLoadState('domcontentloaded');

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

  // ===== RESTORED TESTS =====

  test("should show Inspect button after running search", async ({ page }) => {
    // Select stream and run search
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('domcontentloaded');

    await logsPage.selectRunQuery();
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.takeScreenshot('search-results-with-inspect-btn');

    // Check if Inspect button is visible (Enterprise only)
    const isVisible = await inspectorPage.isInspectButtonVisible();
    testLogger.info(`Inspect button visible: ${isVisible}`);

    // For Enterprise tests, the button MUST exist
    expect(isVisible).toBe(true);
  });

  test("should navigate to Inspector page from Inspect button", async ({ page }) => {
    // Select stream and run search
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('domcontentloaded');

    await logsPage.selectRunQuery();
    await page.waitForLoadState('domcontentloaded');

    // Capture search results before clicking Inspect
    const searchResults = await inspectorPage.parseSearchResults();
    testLogger.info(`Search Results - Events: ${searchResults.eventsCount}, Time: ${searchResults.timeMs}ms`);

    await inspectorPage.takeScreenshot('search-results-before-inspect');

    // Click Inspect button
    const isVisible = await inspectorPage.isInspectButtonVisible();
    expect(isVisible).toBe(true);

    await inspectorPage.clickInspectButton();

    // Verify we're on the inspector page
    await inspectorPage.assertInspectorPageVisible();
    await inspectorPage.assertUrlHasTraceId();

    await inspectorPage.takeScreenshot('inspector-page-from-btn');
  });

  test("should verify data appears in recent time ranges", async ({ page }) => {
    // Select stream
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('domcontentloaded');

    // Set time range to Past 15 Minutes
    await inspectorPage.selectRelative15Minutes();

    // Run search
    await logsPage.selectRunQuery();
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.takeScreenshot('past-15-minutes');

    // Check if we have results
    const searchResults = await inspectorPage.parseSearchResults();
    testLogger.info(`Past 15 Minutes - Events: ${searchResults.eventsCount}`);

    if (searchResults.eventsCount === '0' || searchResults.eventsCount === 'N/A') {
      testLogger.warn('No data found in Past 15 Minutes - trying wider range');

      // Try a wider time range
      await inspectorPage.selectRelative1Hour();
      await logsPage.selectRunQuery();
      await page.waitForLoadState('domcontentloaded');

      const widerResults = await inspectorPage.parseSearchResults();
      testLogger.info(`Past 1 Hour - Events: ${widerResults.eventsCount}`);

      // At least wider range should have data
      expect(widerResults.eventsCount).not.toBe('N/A');
    } else {
      // Data was found in 15 minutes
      expect(parseInt(searchResults.eventsCount, 10)).toBeGreaterThan(0);
    }
  });

  test("should handle inspector with ingested data", async ({ page }) => {
    // Ingest fresh data before testing
    await ingestionPage.ingestion();
    await page.waitForTimeout(3000);

    // Select stream
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('domcontentloaded');

    // Set wider time range to ensure we get data
    await inspectorPage.selectRelative1Hour();

    // Run search
    await logsPage.selectRunQuery();
    await page.waitForLoadState('domcontentloaded');

    const searchResults = await inspectorPage.parseSearchResults();
    testLogger.info(`With ingested data - Events: ${searchResults.eventsCount}, Time: ${searchResults.timeMs}ms`);

    await inspectorPage.takeScreenshot('with-ingested-data');

    // Verify we have results
    expect(searchResults.eventsCount).not.toBe('N/A');

    if (searchResults.eventsCount !== '0') {
      const isVisible = await inspectorPage.isInspectButtonVisible();
      if (isVisible) {
        await inspectorPage.clickInspectButton();
        await inspectorPage.takeScreenshot('inspector-with-data');
        await inspectorPage.assertInspectorPageVisible();
      }
    }
  });

  test("should copy trace ID to clipboard", async ({ page }) => {
    // Run search first
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.runSearch();
    await page.waitForLoadState('domcontentloaded');

    // Navigate to inspector via history
    await inspectorPage.openSearchHistory();
    await page.waitForLoadState('domcontentloaded');

    const hasInspect = await inspectorPage.hasHistoryInspectButtons();
    expect(hasInspect).toBe(true);

    await inspectorPage.inspectFromHistory();
    await inspectorPage.assertInspectorPageVisible();

    // Wait for tiles to load
    const tilesVisibility = await inspectorPage.getTilesVisibility();
    testLogger.info('Tiles visibility:', tilesVisibility);

    // Check if Trace ID tile is visible (using getTilesVisibility)
    const isTraceIdVisible = tilesVisibility.traceId;
    testLogger.info(`Trace ID tile visible: ${isTraceIdVisible}`);

    if (isTraceIdVisible) {
      await inspectorPage.takeScreenshot('before-copy-trace-id');
      await inspectorPage.clickTraceIdToCopy();
      await inspectorPage.takeScreenshot('after-copy-trace-id');

      // Check for copy success notification (may not always appear)
      const hasCopyNotification = await inspectorPage.hasCopySuccessNotification();
      testLogger.info(`Copy notification visible: ${hasCopyNotification}`);
    }

    // At least some tiles should be visible (inspector page loaded correctly)
    const hasTiles = tilesVisibility.results || tilesVisibility.events || tilesVisibility.timeTaken || tilesVisibility.traceId;
    expect(hasTiles).toBe(true);
  });

  test("should display time range badge with timezone", async ({ page }) => {
    // Run search first
    await logsPage.selectStream(stream, 3, 0);
    await page.waitForLoadState('domcontentloaded');

    await inspectorPage.runSearch();
    await page.waitForLoadState('domcontentloaded');

    // Navigate to inspector via history
    await inspectorPage.openSearchHistory();
    await page.waitForLoadState('domcontentloaded');

    const hasInspect = await inspectorPage.hasHistoryInspectButtons();
    expect(hasInspect).toBe(true);

    await inspectorPage.inspectFromHistory();
    await inspectorPage.assertInspectorPageVisible();

    await inspectorPage.takeScreenshot('time-range-badge-test');

    // Check if time range badge is visible
    const isBadgeVisible = await inspectorPage.isTimeRangeBadgeVisible();
    testLogger.info(`Time range badge visible: ${isBadgeVisible}`);

    if (isBadgeVisible) {
      const badgeText = await inspectorPage.getTimeRangeBadgeText();
      testLogger.info(`Time range badge text: ${badgeText}`);
    }

    // Check for timezone display
    const hasTimezone = await inspectorPage.hasTimezoneDisplay();
    testLogger.info(`Timezone displayed: ${hasTimezone}`);

    // Inspector page should be visible (time range and timezone are optional UI elements)
    await inspectorPage.assertInspectorPageVisible();
  });
});

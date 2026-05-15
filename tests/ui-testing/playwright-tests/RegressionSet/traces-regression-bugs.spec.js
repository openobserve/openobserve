/**
 * Traces Regression Bugs — Batch 1
 *
 * Covers: #10743, #11580, #11217
 *
 * Tests run in PARALLEL.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTestData } = require('../utils/data-ingestion.js');

test.describe("Traces Regression Bugs — Batch 1", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Ingest data for traces
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');

    testLogger.info('Traces regression batch-1 setup completed');
  });

  // ==========================================================================
  // Bug #10743: Selected stream lost when navigating away and back to Traces
  // https://github.com/openobserve/openobserve/issues/10743
  // ==========================================================================
  test("Selected stream should persist when navigating away and returning to Traces", {
    tag: ['@bug-10743', '@P1', '@regression', '@tracesRegression', '@tracesRegressionNavigation']
  }, async ({ page }) => {
    testLogger.info('Test: Verify stream selection persists across navigation (Bug #10743)');

    // Navigate to traces and select a stream
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.isStreamSelectVisible();

    // Try selecting the stream with retry
    let streamSelected = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await pm.tracesPage.selectTraceStream('default');
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      const noStreamBefore = await pm.tracesPage.isNoStreamSelectedVisible();
      if (!noStreamBefore) {
        streamSelected = true;
        testLogger.info(`Stream selected on attempt ${attempt}`);
        break;
      }
      testLogger.info(`Attempt ${attempt}: stream still not selected, retrying...`);
    }

    if (!streamSelected) {
      testLogger.warn('Could not select stream on traces page — skipping navigation test');
      test.skip(true, 'Stream selection not available on traces page');
      return;
    }

    // Run a search to confirm stream is active
    await pm.tracesPage.runTraceSearch();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Navigate to logs page
    await pm.tracesPage.navigateToLogs();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Navigated to logs page');

    // Navigate back to traces
    await pm.tracesPage.navigateToTraces();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Navigated back to traces');

    // Verify stream selection persists by checking "no stream selected" is still not visible
    const noStreamAfter = await pm.tracesPage.isNoStreamSelectedVisible();
    testLogger.info(`"No stream selected" visible after navigation: ${noStreamAfter}`);

    // PRIMARY ASSERTION: Stream should still be active after navigating away and back
    expect(noStreamAfter,
      'Bug #10743: Stream selection should persist — "no stream selected" should not appear after navigation'
    ).toBeFalsy();

    // Secondary check: search bar should still be visible (indicates active stream context)
    const searchBarVisible = await pm.tracesPage.isSearchBarVisible();
    expect(searchBarVisible,
      'Bug #10743: Search bar should remain visible after navigation (stream context maintained)'
    ).toBeTruthy();
    testLogger.info('✓ PASSED: Stream selection persists across navigation');
  });

  // ==========================================================================
  // Bug #11580: PromQL selection persists after switching Metrics — Logs
  // https://github.com/openobserve/openobserve/issues/11580
  // ==========================================================================
  test("Query editor should not display PromQL after switching from metrics to logs", {
    tag: ['@bug-11580', '@P1', '@regression', '@tracesRegression', '@tracesRegressionQueryEditor']
  }, async ({ page }) => {
    testLogger.info('Test: Verify query editor resets after stream type switch (Bug #11580)');

    // Step 1: Navigate to metrics page and select a stream
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Navigated to metrics page');

    // Try to select stream and PromQL mode if available
    const promqlTab = pm.tracesPage.getPromQLTab();
    const promqlVisible = await promqlTab.isVisible({ timeout: 5000 }).catch(() => false);

    if (promqlVisible) {
      await promqlTab.click();
      await page.waitForTimeout(500);
      // Verify PromQL mode is actually active before navigating to logs
      const promqlActive = await promqlTab.getAttribute('data-state').then(s => s === 'on').catch(() => false);
      expect(promqlActive,
        'Bug #11580: PromQL tab must be active after clicking (premise for switching test)'
      ).toBe(true);
      testLogger.info('✓ PromQL mode is verified active');
      await page.waitForTimeout(500);
    } else {
      testLogger.warn('PromQL mode not available — cannot verify bug #11580 without PromQL state');
      test.skip(true, 'PromQL mode not available in current environment');
      return;
    }

    // Step 2: Switch to logs page
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('✓ Switched to logs page');

    // Select a stream on logs page to trigger query editor display
    await pm.logsPage.selectStream("e2e_automate");
    await page.waitForLoadState('domcontentloaded');

    // PRIMARY ASSERTION: Query editor should NOT show PromQL mode on logs page
    // Check that logs-specific query toggles are visible (not PromQL)
    const logToggles = await pm.tracesPage.isAnyLogsQueryToggleVisible();
    const logsToggleVisible = logToggles.quickMode || logToggles.sqlMode;
    testLogger.info(`Logs query toggles visible — quick: ${logToggles.quickMode}, sql: ${logToggles.sqlMode}`);

    expect(logsToggleVisible,
      'Bug #11580: Logs page should display its own query mode toggles, not PromQL from metrics'
    ).toBeTruthy();

    // Additional check: PromQL-specific elements should NOT be visible on logs page
    const promqlOnLogs = await pm.tracesPage.isPromQLTabVisible();
    expect(promqlOnLogs,
      'Bug #11580: PromQL elements should not persist on logs page after switching from metrics'
    ).toBeFalsy();

    testLogger.info('✓ PASSED: Query editor correctly reset after stream type switch');
  });

  // ==========================================================================
  // Bug #11217: Traces editor does not display text under suggestions when typing
  // https://github.com/openobserve/openobserve/issues/11217
  // ==========================================================================
  test("Trace query editor should display autocomplete suggestions when typing", {
    tag: ['@bug-11217', '@P1', '@regression', '@tracesRegression', '@tracesRegressionAutocomplete']
  }, async ({ page }) => {
    testLogger.info('Test: Verify autocomplete suggestions visible in trace editor (Bug #11217)');

    // Navigate to traces
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Switch to SQL mode to access the editor with autocomplete
    // Uses POM locator: validates against traces SearchBar data-test attributes
    const sqlToggle = page.locator(pm.tracesPage.sqlModeButton).first();
    if (await sqlToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sqlToggle.click();
      await page.waitForTimeout(500);
      testLogger.info('✓ Switched to SQL mode');
    }

    // Find the query editor using POM locator (.monaco-editor for traces)
    const queryEditor = page.locator(pm.tracesPage.queryEditor).first();

    if (!(await queryEditor.isVisible({ timeout: 5000 }).catch(() => false))) {
      testLogger.warn('Query editor not found — cannot verify bug #11217');
      test.skip(true, 'SQL query editor not available in this environment');
      return;
    }

    // Dismiss any open q-menu popups (e.g. from stream selection) that
    // would intercept pointer events on the Monaco editor
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Click the visible text surface to focus Monaco, then type
    await queryEditor.locator(pm.tracesPage.viewLines).first().click({ force: true });
    await page.waitForTimeout(300);
    await page.keyboard.type('select ', { delay: 50 });
    await page.waitForTimeout(500);

    // Explicitly trigger autocomplete suggestions (Ctrl+Space in Monaco)
    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(2000);

    // Check for autocomplete suggestion widget and editor content
    const suggestionsVisible = await pm.tracesPage.isSuggestionWidgetVisible();
    const editorContent = await pm.tracesPage.getQueryEditorContent();
    testLogger.info(`Suggestions widget: ${suggestionsVisible}, Editor content: "${editorContent?.trim()}"`);

    // Bug #11217 was that the editor displayed no text under suggestions.
    // The editor MUST accept keyboard input (text visible under/alongside suggestions).
    expect(editorContent && editorContent.trim().length > 0,
      'Bug #11217: Query editor must accept keyboard input and display text'
    ).toBeTruthy();

    // Additionally, the autocomplete suggestion widget must appear —
    // that is the specific regression #11217 describes.
    expect(suggestionsVisible,
      'Bug #11217: Autocomplete suggestion widget must appear when typing in the query editor'
    ).toBeTruthy();

    testLogger.info('✓ PASSED: Trace editor autocomplete verified');
  });

  test.afterEach(async () => {
    testLogger.info('Traces regression batch-1 test completed');
  });
});

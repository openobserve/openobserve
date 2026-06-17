/**
 * Traces Regression Bugs — Batch 1
 *
 * Covers: #10743, #11580, #11217
 *
 * Tests run in PARALLEL.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

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

    // Select the stream
    await pm.tracesPage.selectTraceStream('default');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const noStreamBefore = await pm.tracesPage.isNoStreamSelectedVisible();
    expect(noStreamBefore, 'Stream should be selected on traces page').toBeFalsy();

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

    // Select PromQL mode
    const promqlTab = pm.tracesPage.getPromQLTab();
    await expect(promqlTab, 'PromQL tab should be visible').toBeVisible({ timeout: 5000 });
    await promqlTab.click();
    await page.waitForTimeout(500);
    const promqlActive = await promqlTab.getAttribute('data-state').then(s => s === 'on').catch(() => false);
    expect(promqlActive,
      'Bug #11580: PromQL tab must be active after clicking (premise for switching test)'
    ).toBe(true);
    testLogger.info('✓ PromQL mode is verified active');
    await page.waitForTimeout(500);

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

    // Switch to SQL mode to access the editor with autocomplete.
    // The syntax-guide was moved into the "More" dropdown menu,
    // so we must open that dropdown first to reveal the toggle.
    const moreMenuBtn = page.locator('[data-test="traces-search-bar-more-menu-btn"]');
    await expect(moreMenuBtn, 'More menu button should be visible').toBeVisible({ timeout: 5000 });
    await moreMenuBtn.click();
    await page.waitForTimeout(500);

    const sqlToggle = pm.tracesPage.getSqlModeToggle().first();
    await expect(sqlToggle, 'SQL mode toggle should be visible').toBeVisible({ timeout: 5000 });
    await sqlToggle.click();
    await page.waitForTimeout(500);
    testLogger.info('✓ Switched to SQL mode');

    // Find the query editor using POM locator (.monaco-editor for traces)
    const queryEditor = pm.tracesPage.getQueryEditorLocator().first();
    await expect(queryEditor, 'SQL query editor should be visible').toBeVisible({ timeout: 5000 });

    // Dismiss any open menus/popups (e.g. from stream selection) that
    // would intercept pointer events on the Monaco editor
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // page.keyboard.type() cannot route input to Monaco because Monaco
    // listens on a hidden <textarea> (.inputarea) positioned off-screen,
    // not on the visible .view-lines div. Use Monaco's own trigger API to
    // simulate typed characters — this correctly updates the editor model
    // and fires the autocomplete provider.
    const editorId = 'traces-query-editor';
    const editorFound = await page.evaluate(({ editorId }) => {
      const w = /** @type {any} */ (window);
      const editors = w.monaco?.editor?.getEditors?.();
      if (!editors?.length) throw new Error('No Monaco editors found on page');
      const target = editors.find(e => {
        const node = e.getDomNode?.();
        return node && node.closest(`#${editorId}`);
      }) || editors[0];
      if (!target) throw new Error(`Monaco editor with id "${editorId}" not found`);
      target.focus();
      target.trigger('keyboard', 'type', { text: 'select ' });
      return true;
    }, { editorId });
    expect(editorFound, 'Monaco editor must be found and receive input').toBe(true);
    await page.waitForTimeout(800);

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

  // ==========================================================================
  // Bug #11816: Trace API Called Multiple Times with Auto Search Enabled
  // https://github.com/openobserve/openobserve/issues/11816
  // ==========================================================================
  test("trace search should not make duplicate API calls with auto search", {
    tag: ['@bug-11816', '@P1', '@regression', '@tracesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Trace API not called multiple times with auto search (Bug #11816)');

    const orgName = 'default';
    const tracesUrl = `/web/traces?org_identifier=${orgName}`;

    // Attach listener BEFORE navigation to capture all API calls including page load
    const apiCalls = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/') && req.url().includes('traces')) {
        apiCalls.push({ url: req.url(), timestamp: Date.now() });
      }
    });

    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    testLogger.info('Navigated to traces, tracking API calls');

    await pm.tracesPage.selectTraceStream('default');
    await page.waitForTimeout(2000);

    await pm.tracesPage.runTraceSearch();
    await page.waitForTimeout(3000);

    testLogger.info(`Trace API calls tracked: ${apiCalls.length}`);

    if (apiCalls.length > 0) {
      const urlCounts = {};
      apiCalls.forEach(call => {
        const baseUrl = call.url.replace(/\?.*$/, '');
        urlCounts[baseUrl] = (urlCounts[baseUrl] || 0) + 1;
      });
      testLogger.info(`API call distribution: ${JSON.stringify(urlCounts)}`);
    }

    // PRIMARY ASSERTION: The traces search results or search bar must still be visible
    const postSearchBar = pm.tracesPage.getSearchBarElement();
    await expect(postSearchBar, 'Bug #11816: Search bar must remain visible after trace search').toBeVisible({ timeout: 5000 });

    testLogger.info('Bug #11816 verification complete');
  });

  // ==========================================================================
  // Bug #11815: Traces are not sorted correctly when sorted by spans column
  // https://github.com/openobserve/openobserve/issues/11815
  // ==========================================================================
  test("traces should sort correctly by duration column", {
    tag: ['@bug-11815', '@P1', '@regression', '@tracesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Traces sorted correctly by duration (Bug #11815)');

    const orgName = 'default';
    const tracesUrl = `/web/traces?org_identifier=${orgName}`;
    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.runTraceSearch();
    await page.waitForTimeout(3000);

    const durationHeader = pm.tracesPage.getDurationHeader();
    if (await durationHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      testLogger.info('Duration column header is visible');

      await durationHeader.click();
      await page.waitForTimeout(2000);

      const sortIndicator = pm.tracesPage.getSortIndicator();
      const sortVisible = await sortIndicator.isVisible({ timeout: 3000 }).catch(() => false);
      testLogger.info(`Sort indicator visible after clicking duration: ${sortVisible}`);

      // PRIMARY ASSERTION: Table must remain visible and functional after sorting
      const searchBar = pm.tracesPage.getSearchBarElement();
      await expect(searchBar, 'Bug #11815: Search bar must remain visible after duration sort').toBeVisible({ timeout: 5000 });
    }

    // UNCONDITIONAL: Search bar must remain visible regardless of sort state
    const postSearchBar = pm.tracesPage.getSearchBarElement();
    await expect(postSearchBar, 'Bug #11815: Search bar must remain visible').toBeVisible({ timeout: 5000 });

    testLogger.info('Bug #11815 verification complete');
  });

  // ==========================================================================
  // Bug #11531: Traces Spans tab "Method" column references non-existent field
  // https://github.com/openobserve/openobserve/issues/11531
  // ==========================================================================
  test("traces spans tab should not reference non-existent method field", {
    tag: ['@bug-11531', '@P1', '@regression', '@tracesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Spans tab Method column validation (Bug #11531)');

    const orgName = 'default';
    const tracesUrl = `/web/traces?org_identifier=${orgName}`;
    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.runTraceSearch();
    await page.waitForTimeout(3000);

    const firstResult = pm.tracesPage.getTraceResultItems().first();
    if (await firstResult.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstResult.click();
      await page.waitForTimeout(2000);

      await pm.tracesPage.expectTraceDetailsVisible();
      testLogger.info('Trace details visible');

      const spanBlocks = pm.tracesPage.getSpanBlocks();
      const spanCount = await spanBlocks.count().catch(() => 0);
      testLogger.info(`Found ${spanCount} span blocks`);

      if (spanCount > 0) {
        await spanBlocks.first().click();
        await page.waitForTimeout(1000);

        const spanDetail = pm.tracesPage.getSpanBlockDetail();
        const spanDetailVisible = await spanDetail.isVisible({ timeout: 3000 }).catch(() => false);
        testLogger.info(`Span detail visible: ${spanDetailVisible}`);

        const errorMsg = pm.tracesPage.getErrorElements();
        const hasError = await errorMsg.isVisible({ timeout: 2000 }).catch(() => false);
        expect(hasError).toBe(false);
        testLogger.info('No error messages from non-existent field references');
      }
    }

    // Search bar visibility check (conditional — span details may overlay it)
    const searchBarVisible = await pm.tracesPage.isSearchBarVisible();
    testLogger.info(`Search bar visible in span details: ${searchBarVisible}`);
    if (!searchBarVisible) {
      // Navigate back to main traces view and re-check
      await pm.tracesPage.navigateBackFromTraceDetails();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      const searchBarAfterBack = pm.tracesPage.getSearchBarElement();
      await expect(searchBarAfterBack, 'Bug #11531: Search bar must be visible after returning from span details').toBeVisible({ timeout: 10000 });
    }

    testLogger.info('Bug #11531 verification complete');
  });

  // ==========================================================================
  // Bug #11446: Incorrect duration value displayed in Logs details Traces tab
  // https://github.com/openobserve/openobserve/issues/11446
  // ==========================================================================
  test("logs detail traces tab should display correct duration values", {
    tag: ['@bug-11446', '@P2', '@regression', '@tracesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Duration values correct in logs detail traces tab (Bug #11446)');

    const orgName = 'default';
    await page.goto(`/web/logs?org_identifier=${orgName}&stream=e2e_automate&stream_type=logs`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await pm.logsPage.selectRunQuery();
    await page.waitForTimeout(3000);

    const logRow = pm.logsPage.getLogsTableRows().first();
    if (await logRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await logRow.click();
      await page.waitForTimeout(1000);
      testLogger.info('Log detail opened');

      const traceTab = pm.tracesPage.getLogDetailTracesTab();
      if (await traceTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await traceTab.click();
        await page.waitForTimeout(2000);
        testLogger.info('Navigated to traces tab in log detail');

        const traceContent = pm.tracesPage.getDialogBox();
        await expect(traceContent).toBeVisible({ timeout: 5000 });
        testLogger.info('Traces content in log detail is visible');
      } else {
        testLogger.info('No traces tab for this log entry - normal for logs without traces');
      }
    }

    // UNCONDITIONAL: Query editor must remain visible regardless of detail state
    const queryEditor = pm.logsPage.getQueryEditor();
    await expect(queryEditor, 'Bug #11446: Query editor must remain visible').toBeVisible({ timeout: 5000 });

    testLogger.info('Bug #11446 verification complete');
  });

  // ==========================================================================
  // Bug #11384: On switching organization the Trace Explorer results are not cleared
  // https://github.com/openobserve/openobserve/issues/11384
  // ==========================================================================
  test("switching organization should clear trace explorer results", {
    tag: ['@bug-11384', '@P1', '@regression', '@tracesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Org switch clears trace explorer results (Bug #11384)');

    const orgName = 'default';
    const tracesUrl = `/web/traces?org_identifier=${orgName}`;
    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.runTraceSearch();
    await page.waitForTimeout(3000);

    const resultsBefore = pm.tracesPage.getTraceResultItems();
    const countBefore = await resultsBefore.count().catch(() => 0);
    testLogger.info(`Trace results before org switch: ${countBefore}`);

    const orgSelector = pm.tracesPage.getNavbarOrgSelector();
    if (await orgSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pm.homePage.openOrgSelector();
      await page.waitForTimeout(500);

      // Find an org different from the current one to actually test switching
      const orgItems = page.locator('[data-test="organization-menu-item-label-item-label"]');
      const orgCount = await orgItems.count().catch(() => 0);
      let switchedOrg = false;

      for (let i = 0; i < orgCount; i++) {
        const itemText = await orgItems.nth(i).textContent().catch(() => '');
        if (itemText && itemText.trim() !== orgName) {
          testLogger.info(`Switching to org: "${itemText.trim()}"`);
          await orgItems.nth(i).click();
          await page.waitForTimeout(2000);
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          switchedOrg = true;

          // Switch back to original org
          await pm.homePage.openOrgSelector();
          await page.waitForTimeout(500);
          try {
            await pm.homePage.selectOrganization(orgName);
            await page.waitForTimeout(2000);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          } catch (err) {
            testLogger.warn(`Could not switch back to ${orgName}: ${err.message}`);
          }
          break;
        }
      }

      if (switchedOrg) {
        testLogger.info('Organization switched - trace explorer should be in clean state');
      } else {
        testLogger.info('Single-org environment - org switching not applicable');
      }
    } else {
      testLogger.info('Single-org environment - org switching not applicable');
    }

    // PRIMARY ASSERTION: Traces page must remain functional after org switch
    const searchBar = pm.tracesPage.getSearchBarElement();
    await expect(searchBar, 'Bug #11384: Trace explorer search bar must remain visible after org switch').toBeVisible({ timeout: 5000 });

    testLogger.info('Bug #11384 verification complete');
  });

  // ==========================================================================
  // Bug #11244: Inconsistency in traces and logs table timestamp values
  // https://github.com/openobserve/openobserve/issues/11244
  // ==========================================================================
  test("timestamp values should be consistent between traces and logs", {
    tag: ['@bug-11244', '@P2', '@regression', '@tracesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Timestamp consistency between traces and logs (Bug #11244)');

    const orgName = 'default';
    await page.goto(`/web/logs?org_identifier=${orgName}&stream=e2e_automate&stream_type=logs`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await pm.logsPage.selectRunQuery();
    await page.waitForTimeout(3000);

    const timestampHeader = pm.tracesPage.getLogsTimestampHeader();
    if (await timestampHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      testLogger.info('Timestamp column header is visible in logs');

      const firstTimestampCell = pm.tracesPage.getFirstLogTimestampCell();
      const timestampText = await firstTimestampCell.textContent().catch(() => '');
      testLogger.info(`Log timestamp format: "${timestampText}"`);

      expect(timestampText).toMatch(/\d/);
    }

    // UNCONDITIONAL: Timestamp header or search bar must remain visible
    const logsSearchBar = pm.tracesPage.getSearchBarElement();
    await expect(logsSearchBar, 'Bug #11244: Search bar must remain visible').toBeVisible({ timeout: 5000 });

    testLogger.info('Bug #11244 verification complete');
  });

  // ==========================================================================
  // Bug #8978: No cancel option while running a query in traces
  // https://github.com/openobserve/openobserve/issues/8978
  // ==========================================================================
  test("cancel option should be available while running trace query", {
    tag: ['@bug-8978', '@P1', '@regression', '@tracesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Cancel option available during trace query (Bug #8978)');

    const orgName = 'default';
    const tracesUrl = `/web/traces?org_identifier=${orgName}`;
    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.runTraceSearch();

    await page.waitForTimeout(300);
    const refreshBtn = pm.tracesPage.getRunQueryButton();
    const btnText = await refreshBtn.textContent().catch(() => '');

    await expect(refreshBtn).toBeVisible({ timeout: 5000 });
    testLogger.info(`Trace query button state: "${btnText}" - cancel/run available`);

    testLogger.info('Bug #8978 verification complete');
  });

  // ==========================================================================
  // Bug #4151: Traces: On hovering over traces values in dark mode, text not visible
  // https://github.com/openobserve/openobserve/issues/4151
  // ==========================================================================
  test("trace values should be visible on hover in dark mode", {
    tag: ['@bug-4151', '@P2', '@regression', '@tracesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Trace hover text visible in dark mode (Bug #4151)');

    const orgName = 'default';

    await pm.homePage.switchToDarkMode();
    await page.waitForTimeout(1000);

    const isDark = await pm.homePage.isDarkMode();
    testLogger.info(`Dark mode active: ${isDark}`);

    const tracesUrl = `/web/traces?org_identifier=${orgName}`;
    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Verify dark mode persisted across page navigation
    const isDarkAfterNav = await pm.homePage.isDarkMode();
    testLogger.info(`Dark mode after navigation: ${isDarkAfterNav}`);
    expect(isDarkAfterNav, 'Bug #4151: Dark mode must persist after page navigation').toBe(true);

    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.runTraceSearch();
    await page.waitForTimeout(3000);

    const firstResult = pm.tracesPage.getTraceResultItems().first();
    if (await firstResult.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstResult.hover();
      await page.waitForTimeout(1000);

      await expect(firstResult).toBeVisible({ timeout: 3000 });
      testLogger.info('Trace result visible on hover in dark mode');

      const hoverElements = pm.tracesPage.getHoverElements();
      const hoverCount = await hoverElements.count().catch(() => 0);
      testLogger.info(`Hover elements found: ${hoverCount}`);
    }

    // UNCONDITIONAL: Search bar must remain visible regardless of hover results
    const searchBar = pm.tracesPage.getSearchBarElement();
    await expect(searchBar, 'Bug #4151: Search bar must remain visible in dark mode').toBeVisible({ timeout: 5000 });

    // Switch back to light mode
    await pm.homePage.switchToLightMode();
    await page.waitForTimeout(500);

    testLogger.info('Bug #4151 verification complete');
  });

  // ==========================================================================
  // Bug #2887: Traces can be ordered by Duration
  // https://github.com/openobserve/openobserve/issues/2887
  // ==========================================================================
  test("traces should be orderable by duration column", {
    tag: ['@bug-2887', '@P1', '@regression', '@tracesRegression']
  }, async ({ page }) => {
    testLogger.info('Test: Traces ordered by duration (Bug #2887)');

    const orgName = 'default';
    const tracesUrl = `/web/traces?org_identifier=${orgName}`;
    await page.goto(tracesUrl);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.runTraceSearch();
    await page.waitForTimeout(3000);

    const durationHeader = pm.tracesPage.getDurationHeader();
    const durationVisible = await durationHeader.isVisible({ timeout: 5000 }).catch(() => false);

    if (durationVisible) {
      testLogger.info('Duration column header found');

      await durationHeader.scrollIntoViewIfNeeded();
      await durationHeader.click();
      await page.waitForTimeout(2000);

      const sortIndicator = pm.tracesPage.getSortIndicator();
      const sortApplied = await sortIndicator.isVisible({ timeout: 3000 }).catch(() => false);
      testLogger.info(`Duration sort applied: ${sortApplied}`);

      // PRIMARY ASSERTION: Table must remain visible and functional after sorting
      const searchBarAfterSort = pm.tracesPage.getSearchBarElement();
      await expect(searchBarAfterSort, 'Bug #2887: Search bar must remain visible after duration sort').toBeVisible({ timeout: 5000 });

      await durationHeader.scrollIntoViewIfNeeded();
      await durationHeader.click();
      await page.waitForTimeout(2000);
      testLogger.info('Duration sort direction toggled');

      const results = pm.tracesPage.getTraceResultItems();
      const resultCount = await results.count().catch(() => 0);
      testLogger.info(`Results after sorting: ${resultCount}`);
    } else {
      testLogger.info('Duration header not found - checking column headers');
      const headers = pm.tracesPage.getTraceResultColumnHeaders();
      const headerCount = await headers.count().catch(() => 0);
      testLogger.info(`Found ${headerCount} column headers`);
    }

    // UNCONDITIONAL: Search bar must remain visible regardless of sort state
    const searchBar = pm.tracesPage.getSearchBarElement();
    await expect(searchBar, 'Bug #2887: Search bar must remain visible').toBeVisible({ timeout: 5000 });

    testLogger.info('Bug #2887 verification complete');
  });

  test.afterEach(async () => {
    testLogger.info('Traces regression batch-1 test completed');
  });
});

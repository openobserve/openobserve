/**
 * Traces Regression Bugs Test Suite
 *
 * This suite contains regression tests for traces-related bugs that have been fixed.
 * Each test verifies that a specific bug fix is working correctly.
 *
 * Tests run in PARALLEL for efficiency - setup/cleanup handled via hooks.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Traces Regression Bugs", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Navigate to traces page
    await pm.tracesPage.navigateToTraces();

    // Select the default stream as data is ingested for it only
    await pm.tracesPage.isStreamSelectVisible()
    await pm.tracesPage.selectTraceStream('default');
    await page.waitForTimeout(2000);

    testLogger.info('Traces regression test setup completed');
  });

  // ==========================================================================
  // Bug #10769: Traces UI: Column sorting support
  // https://github.com/openobserve/openobserve/issues/10769
  // ==========================================================================
  test("Trace columns should support sorting", {
    tag: ['@bug-10769', '@P1', '@regression', '@tracesRegression', '@sorting']
  }, async ({ page }) => {
    testLogger.info('Test: Verify trace column sorting (Bug #10769)');

    // Wait for traces page to be ready
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Try to run a search to get results
    const runBtn = pm.tracesPage.getRunQueryButton().first();
    if (await runBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await runBtn.click();
      // Wait for search results to load
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      testLogger.info('✓ Ran trace search');
    } else {
      testLogger.info('Run button not visible, checking existing results');
    }

    // Find column headers in the trace results table
    const columnHeaders = pm.tracesPage.getTraceResultColumnHeaders();
    const headerCount = await columnHeaders.count();
    testLogger.info(`Found ${headerCount} column headers`);

    // STRONG ASSERTION: Column headers should exist for sorting
    expect(headerCount, 'Bug #10769: Trace table should have column headers for sorting').toBeGreaterThan(0);

    // Try clicking the first sortable column (usually duration or timestamp)
    const durationHeader = pm.tracesPage.getDurationHeader().first();
    const timestampHeader = pm.tracesPage.getTimestampHeader().first();

    let sortedColumnFound = false;

    if (await durationHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await durationHeader.click();
      testLogger.info('✓ Clicked Duration column header');
      sortedColumnFound = true;

      // Check for sort indicator
      const sortIndicator = pm.tracesPage.getSortIndicator();
      const hasSortIndicator = await sortIndicator.count() > 0;
      testLogger.info(`Sort indicator visible: ${hasSortIndicator}`);

      // Click again to toggle sort direction
      await durationHeader.click();
      testLogger.info('✓ Toggled sort direction');
    } else if (await timestampHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
      await timestampHeader.click();
      testLogger.info('✓ Clicked Timestamp column header');
      sortedColumnFound = true;
    } else {
      // Click any visible header
      const firstHeader = columnHeaders.first();
      if (await firstHeader.isVisible()) {
        await firstHeader.click();
        testLogger.info('✓ Clicked first available column header');
        sortedColumnFound = true;
      }
    }

    // PRIMARY ASSERTION: Should be able to click at least one column header
    expect(sortedColumnFound, 'Bug #10769: Should be able to click column headers to enable sorting').toBe(true);

    testLogger.info('✓ PASSED: Column sorting test completed');
  });

  // ==========================================================================
  // Bug #9043: Trace pagination cursor resets when navigating back from trace details
  // https://github.com/openobserve/openobserve/issues/9043
  // ==========================================================================
  test("Pagination cursor should not reset after navigating back from trace details", {
    tag: ['@bug-9043', '@P1', '@regression', '@tracesRegression', '@pagination']
  }, async ({ page }) => {
    testLogger.info('Test: Verify pagination cursor persists after trace detail navigation (Bug #9043)');

    // Set a time range that will have enough traces
    await pm.tracesPage.setTimeRange('15m');
    testLogger.info('✓ Set time range to 15 minutes');

    // Run trace search
    const runBtn = pm.tracesPage.getRunQueryButton().first();
    if (await runBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await runBtn.click();
      testLogger.info('✓ Ran trace search');
    }

    // Wait for traces to load
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // STEP 1: Get initial trace count and capture trace IDs before navigation
    const initialTraceCount = await pm.tracesPage.getTraceCount();
    testLogger.info(`Initial trace count: ${initialTraceCount}`);

    // STRONG ASSERTION: We need at least some traces to test pagination
    // If no results, test will fail with meaningful error message
    expect(initialTraceCount, 'Bug #9043: Should have initial traces to test pagination (no trace results available for this time range)').toBeGreaterThan(0);

    // STEP 2: Click on first trace to open trace details
    await pm.tracesPage.clickFirstTraceResult();
    testLogger.info('✓ Clicked first trace to open details');

    // Wait for trace details to load (either sidebar, dialog, or inline view)
    const traceDetailsVisible = await pm.tracesPage.getTraceDetailsElements()
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (traceDetailsVisible) {
      testLogger.info('✓ Trace details opened successfully');
    } else {
      testLogger.info('Trace details may be displayed inline or differently');
    }

    // STEP 3: Navigate back from trace details
    await pm.tracesPage.navigateBackFromTraceDetails();
    testLogger.info('✓ Navigated back from trace details');

    // Wait for traces list to be visible again
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // STEP 4: Get trace count after navigation back
    const afterBackTraceCount = await pm.tracesPage.getTraceCount();
    testLogger.info(`Trace count after navigating back: ${afterBackTraceCount}`);

    // PRIMARY ASSERTION 1: Trace count should be preserved or similar after navigation
    // It should not drop to 0 or drastically change
    expect(afterBackTraceCount, 'Bug #9043: Trace count should be maintained after navigating back').toBeGreaterThan(0);
    testLogger.info('✓ Trace count maintained after navigation');

    // STEP 5: Check for duplicates in the trace list
    // If pagination cursor resets, we would see the same traces loaded again
    const afterBackTraceItems = pm.tracesPage.getTraceResultItems();
    const afterBackCount = await afterBackTraceItems.count();

    let afterBackTraceData = [];
    for (let i = 0; i < Math.min(afterBackCount, 20); i++) {
      const traceItem = afterBackTraceItems.nth(i);

      // Try to extract trace ID from data attributes first (most reliable)
      let traceId = await traceItem.getAttribute('data-trace-id').catch(() => null);

      if (!traceId) {
        // Fallback: look for trace_id in other data attributes
        const allAttrs = await traceItem.evaluate(el => {
          const attrs = {};
          for (const attr of el.attributes) {
            if (attr.name.includes('trace') || attr.name.includes('id')) {
              attrs[attr.name] = attr.value;
            }
          }
          return attrs;
        }).catch(() => ({}));

        // Find first attribute that looks like a trace ID (hex string 16-64 chars)
        for (const [name, value] of Object.entries(allAttrs)) {
          if (typeof value === 'string' && /^[a-f0-9]{16,64}$/i.test(value)) {
            traceId = value;
            testLogger.debug(`Found trace ID in attribute ${name}: ${value.substring(0, 16)}...`);
            break;
          }
        }
      }

      // If still no trace ID, try to extract from HTML content
      if (!traceId) {
        const itemHTML = await traceItem.innerHTML().catch(() => '');
        const traceIdMatch = itemHTML.match(/trace[_-]?id["\s:=]+([a-f0-9]{16,64})/i);
        traceId = traceIdMatch ? traceIdMatch[1] : null;
      }

      // Only use traces with valid IDs for duplicate detection
      // Text-based comparison is too unreliable for this test
      if (traceId) {
        afterBackTraceData.push({ index: i, id: traceId, text: traceId.substring(0, 16) + '...' });
      } else {
        testLogger.debug(`Trace at index ${i} has no extractable trace_id - skipping duplicate check for this entry`);
      }
    }
    testLogger.info(`Captured ${afterBackTraceData.length} trace identifiers with valid IDs (out of ${afterBackCount} total)`);

    // PRIMARY ASSERTION 2: No duplicate traces should be present
    // Duplicate detection is the core validation for Bug #9043 (pagination cursor reset)
    // If no trace IDs can be extracted, we cannot validate the bug fix - skip test to surface this in CI
    if (afterBackTraceData.length === 0) {
      testLogger.warn('⚠️  No trace IDs could be extracted from attributes or HTML');
      testLogger.warn('⚠️  Cannot validate duplicate detection for Bug #9043 (text-based comparison unreliable due to dynamic timestamps/durations)');
      testLogger.warn('⚠️  Skipping test - trace count validation alone is insufficient for Bug #9043');
      testLogger.info('To enable validation, ensure trace elements have data-trace-id attributes or trace IDs in HTML');
      test.skip(true, 'No extractable trace IDs - cannot validate Bug #9043 duplicate detection (core assertion)');
    }

    // Count duplicates by checking if the same trace identifier appears multiple times
    const traceCounts = new Map();
    afterBackTraceData.forEach(trace => {
      traceCounts.set(trace.id, (traceCounts.get(trace.id) || 0) + 1);
    });

    const duplicates = [];
    traceCounts.forEach((count, traceId) => {
      if (count > 1) {
        // Find sample trace with this ID
        const sample = afterBackTraceData.find(t => t.id === traceId);
        duplicates.push({
          id: traceId.substring(0, 50) + '...',
          count,
          sample: sample?.text || 'N/A'
        });
      }
    });

    testLogger.info(`Found ${duplicates.length} duplicate trace entries`);
    if (duplicates.length > 0) {
      testLogger.warn('Duplicates detected (same trace ID appears multiple times):', {
        duplicates: duplicates.slice(0, 3)
      });
    }

    // Bug #9043 caused pagination cursor to reset, loading the same traces again
    // Duplicates would show as same trace_id appearing multiple times in the results
    expect(duplicates.length, 'Bug #9043: Should not have duplicate traces after navigating back (cursor should not reset)').toBe(0);
    testLogger.info('✓ No duplicate traces detected - pagination cursor maintained correctly');

    // STEP 6: Verify that scrolling/pagination works correctly after navigation
    // Try to scroll the results container to trigger potential lazy loading
    const resultsContainer = pm.tracesPage.getResultsContainer();
    if (await resultsContainer.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Scroll to bottom to trigger pagination/infinite scroll if it exists
      const scrollSuccess = await resultsContainer.evaluate(el => {
        const prevScrollTop = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        return el.scrollTop > prevScrollTop; // Return true if scroll actually happened
      }).catch((error) => {
        testLogger.warn('Could not scroll results container - may not support scrolling', { error: error.message });
        return false;
      });

      if (scrollSuccess) {
        testLogger.info('✓ Scrolled results container to bottom');

        // Wait for potential lazy-load network response
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        testLogger.info('✓ Waited for lazy-load response');

        // Check trace count after scroll
        const afterScrollCount = await pm.tracesPage.getTraceCount();
        testLogger.info(`Trace count after scroll: ${afterScrollCount}`);

        // If pagination is working, count should be >= the previous count
        expect(afterScrollCount, 'Bug #9043: Trace count should not decrease after scrolling').toBeGreaterThanOrEqual(afterBackTraceCount);
      } else {
        testLogger.info('Container may not support scrolling - skipping scroll verification');
      }
    }

    testLogger.info('✓ PASSED: Pagination cursor persistence test completed');
  });

  // ==========================================================================
  // Bug #11689: Service Catalog: clearing search filter with cross icon blanks out the page
  // https://github.com/openobserve/openobserve/issues/11689
  // ==========================================================================
  test("Clearing search filter should not blank out Service Catalog table", {
    tag: ['@bug-11689', '@P0', '@regression', '@tracesRegression', '@serviceCatalog']
  }, async ({ page }) => {
    testLogger.info('Test: Verify clearing search filter does not blank Service Catalog (Bug #11689)');

    const scPage = pm.servicesCatalogPage;

    // Navigate to Service Catalog
    await scPage.clickServiceCatalogTab();
    await scPage.waitForLoad();

    // STRONG ASSERTION: Services should be loaded
    const initialCount = await scPage.getServiceCount();
    testLogger.info(`Initial service count: ${initialCount}`);
    expect(initialCount, 'Bug #11689: Service Catalog should have services loaded').toBeGreaterThan(0);

    // Type in the filter to trigger the clear button appearance
    await scPage.filterByServiceName('alert');
    testLogger.info('✓ Typed "alert" in search filter');

    // Click the actual Quasar clear/cross icon (this was the bug trigger — Quasar sets value to null)
    const clearClicked = await scPage.clickFilterClearButton();
    testLogger.info(clearClicked ? '✓ Clicked Quasar clear/cross icon' : 'Clear button not visible, used fill(\'\') fallback');

    // STRONG ASSERTION: Must click the actual Quasar clear icon — the fill('') fallback doesn't reproduce bug #11689
    expect(clearClicked, 'Bug #11689: Quasar clear icon must be clickable — fill(\'\') fallback does not exercise the regression').toBe(true);

    // PRIMARY ASSERTION: Table should NOT be blank after clearing
    const afterClearCount = await scPage.getServiceCount();
    testLogger.info(`Service count after clearing filter: ${afterClearCount}`);
    expect(afterClearCount, 'Bug #11689: Service count should be maintained after clearing filter (table should not go blank)').toBeGreaterThan(0);

    // SECONDARY ASSERTION: Table should still be visible
    const tableVisible = await scPage.isTableVisible();
    expect(tableVisible, 'Bug #11689: Services table should remain visible after clearing filter').toBe(true);

    testLogger.info('✓ PASSED: Service Catalog clear filter test completed');
  });

  // ==========================================================================
  // Bug #11687: String.replace $ pattern vulnerability in ServiceGraphNodeSidePanel
  // https://github.com/openobserve/openobserve/issues/11687
  // ==========================================================================
  test("Service graph node side panel should render without errors after $ pattern fix", {
    tag: ['@bug-11687', '@P0', '@regression', '@tracesRegression', '@serviceGraph']
  }, async ({ page }) => {
    testLogger.info('Test: Verify service graph side panel renders without errors (Bug #11687)');

    // Collect console errors from this point forward
    const consoleErrors = [];
    const errorHandler = msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    };
    page.on('console', errorHandler);

    // Navigate to Service Graph
    const sgPage = pm.serviceGraphPage;
    await sgPage.navigateToServiceGraph();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // STRONG ASSERTION: Service graph should be visible
    const graphVisible = await sgPage.isServiceGraphVisible();
    expect(graphVisible, 'Bug #11687: Service graph should be visible').toBe(true);
    testLogger.info('✓ Service graph loaded');

    // Click a node to open the side panel (triggers the .replace() code path)
    let nodeClicked = false;

    // Discover available nodes dynamically via API instead of hardcoded list
    const topology = await sgPage.getTopologyViaAPI();
    const nodes = topology.data?.nodes || topology.data?.data?.nodes || [];
    const nodeNames = nodes.map(n => n.label || n.id).filter(Boolean);

    for (const nodeName of nodeNames) {
      try {
        await sgPage.clickNodeByName(nodeName);
        testLogger.info(`✓ Clicked service node: ${nodeName}`);
        nodeClicked = true;
        break;
      } catch (e) {
        testLogger.debug(`Service node "${nodeName}" not found, trying next...`);
      }
    }

    if (!nodeClicked) {
      testLogger.warn(`No service nodes available to click from ${nodeNames.length} discovered nodes — skipping side panel verification`);
      page.removeListener('console', errorHandler);
      test.skip(true, 'No service nodes available to click — cannot verify #11687 side panel');
    }

    // PRIMARY ASSERTION: Side panel should be visible after node click
    const sidePanelVisible = await sgPage.isSidePanelVisible();
    expect(sidePanelVisible, 'Bug #11687: Side panel should be visible after clicking a service node').toBe(true);
    testLogger.info('✓ Side panel rendered successfully');

    // SECONDARY ASSERTION: No replace/trim related console errors
    page.removeListener('console', errorHandler);
    if (consoleErrors.length > 0) {
      testLogger.warn(`Console errors detected: ${consoleErrors.length}`, { errors: consoleErrors.slice(0, 5) });
    }
    const replaceErrors = consoleErrors.filter(e =>
      e.includes('.replace') || e.includes('replace is not a function')
    );
    expect(replaceErrors.length, 'Bug #11687: Should not have replace/null related console errors in side panel').toBe(0);

    testLogger.info('✓ PASSED: Service graph side panel $ pattern fix test completed');
  });

  test.afterEach(async () => {
    testLogger.info('Traces regression test completed');
  });
});

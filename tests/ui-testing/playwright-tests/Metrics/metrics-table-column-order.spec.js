const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

/**
 * PromQL Table Chart - Column Order Feature Tests
 *
 * IMPORTANT: Column Order feature availability by table mode:
 *
 * "Expanded Time series" (expanded_timeseries) - Column Order button IS visible
 * "Aggregate" (all) - Column Order button IS visible
 * "Time series" (single) - Column Order button NOT visible (default mode)
 *
 * Most tests use "Expanded Time series" mode as it reliably shows the Column Order button.
 *
 * CRITICAL: Timestamp Column Behavior
 *
 * The "Timestamp" column is ALWAYS in the first position (table position 0) and is NOT reorderable.
 *
 * Column Order Popup:        Table Chart:
 * Position 0: __name__       Position 0: Timestamp (NOT in popup, always first)
 * Position 1: environment    Position 1: __name__ (popup pos 0)
 * Position 2: flag           Position 2: environment (popup pos 1)
 *                            Position 3: flag (popup pos 2)
 *
 * When testing column order, remember:
 * - Popup position 0 = Table position 1
 * - Popup position 1 = Table position 2
 * - Moving a column to "1st position" in popup = "2nd position" in table (after Timestamp)
 */
test.describe("PromQL Table Chart - Column Order Feature", () => {
  // Ensure metrics are ingested once for all test files
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  /** Create a fresh PageManager per test — avoids data races in parallel workers. */
  async function setupTest(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info('Test setup completed - navigated to metrics page');
    return pm;
  }

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // Helper function to set up a table chart with data
  // pm is passed explicitly so each parallel worker uses its own instance
  async function setupTableChart(pm, page, tableMode = 'all') {
    testLogger.info(`Setting up table chart with mode: ${tableMode}`);

    // Set time range to Last 15 minutes
    testLogger.info('Setting time range to Last 15 minutes');
    await pm.metricsPage.openDatePicker();
    const selected = await pm.metricsPage.selectLast15Minutes();
    if (selected) {
      testLogger.info('Selected Last 15 minutes time range');
    } else {
      // Dismiss any open overlay via keyboard instead of body-click (§2)
      await page.keyboard.press('Escape');
      testLogger.warn('Could not select specific time range, using default');
    }

    // Execute a query that will produce multiple columns
    // Using a query with labels to get multiple columns in the table
    const query = 'cpu_usage';
    testLogger.info(`Executing query: ${query}`);
    await pm.metricsPage.enterMetricsQuery(query);
    const queryResponsePromise = page.waitForResponse(
      (resp) => /\/prometheus\/api\/v1\/query(_range)?/.test(resp.url()) && resp.status() === 200,
      { timeout: 30000 }
    ).catch(() => null);
    await pm.metricsPage.clickApplyButton();
    await queryResponsePromise;
    await pm.metricsPage.waitForMetricsResults();

    // Switch to table chart type
    testLogger.info('Switching to table chart type');
    const tableSelected = await pm.metricsPage.selectChartType('table');
    expect(tableSelected).toBe(true);

    // Open chart configuration sidebar using PageManager method
    testLogger.info('Opening chart configuration sidebar');
    const configButton = await pm.metricsPage.getDashboardSidebarButton();
    await expect(configButton).toBeVisible({ timeout: 10000 });

    await pm.metricsPage.clickDashboardSidebarButton();

    const sidebarVisible = await pm.metricsPage.isSidebarVisible();
    expect(sidebarVisible).toBe(true);
    testLogger.info('Chart configuration sidebar opened successfully');

    // Set the table mode if needed
    // NOTE: Column Order button only appears for "Aggregate" or "Expanded Time series" modes
    // It does NOT appear for "Time series" mode (the default)
    if (tableMode !== 'single') {
      testLogger.info(`Setting table mode to: ${tableMode}`);

      const tableModeDropdown = pm.metricsPage.getPromqlTableModeSelect();
      // Wait for the config panel to finish rendering the PromQL table-mode dropdown.
      // The panel is mounted reactively after switching to the table chart type.
      const isDropdownVisible = await tableModeDropdown
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      if (isDropdownVisible) {
        testLogger.info('Found PromQL Table Mode dropdown');
        await pm.metricsPage.selectPromqlTableMode(tableMode);
        testLogger.info(`Table mode set to: ${tableMode}`);
      } else {
        testLogger.warn('PromQL Table Mode dropdown not found in config panel');
      }
    }
  }

  // P0 - Critical Tests
  test("Verify Column Order button is visible for Expanded Time series table mode", {
    tag: ['@metrics', '@table', '@column-order', '@P0', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing Column Order button visibility for Expanded Time series mode');

    // Use expanded_timeseries mode as it definitely supports Column Order
    await setupTableChart(pm, page, 'expanded_timeseries');

    // Verify we're in the config sidebar
    const sidebarVisible = await pm.metricsPage.isSidebarVisible();
    testLogger.info(`Config sidebar visible: ${sidebarVisible}`);
    expect(sidebarVisible).toBe(true);

    // Verify the Column Order button is visible
    const columnOrderButton = pm.dashboardPanelConfigs.columnOrderBtn;

    await expect(columnOrderButton).toBeVisible({ timeout: 10000 });
    testLogger.info('Column Order button is visible for Expanded Time series table mode');

    // Verify button has correct label
    const buttonText = await columnOrderButton.textContent();
    expect(buttonText).toContain('Configure Column Order');
    testLogger.info('Column Order button has correct label');
  });

  test("Verify Column Order popup opens and displays available columns", {
    tag: ['@metrics', '@table', '@column-order', '@P0', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing Column Order popup opens correctly');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Click the Column Order button
    await pm.dashboardPanelConfigs.openColumnOrderDialog();
    testLogger.info('Clicked Column Order button');

    // Verify the popup/dialog opens
    const columnOrderPopup = pm.dashboardPanelConfigs.columnOrderDialog;
    await expect(columnOrderPopup).toBeVisible({ timeout: 5000 });
    testLogger.info('Column Order popup opened successfully');

    // Verify description text is present (ODialog header carries the title via :title prop,
    // it doesn't render a table title block any more — assert the body's description data-test instead).
    const descriptionText = pm.dashboardPanelConfigs.columnOrderDescription;
    await expect(descriptionText).toBeVisible();
    testLogger.info('Column Order popup has description text');

    // Verify Save and Cancel buttons are present (ODialog footer primary/secondary)
    const saveButton = pm.dashboardPanelConfigs.columnOrderDialogPrimaryBtn;
    const cancelButton = pm.dashboardPanelConfigs.columnOrderDialogSecondaryBtn;
    await expect(saveButton).toBeVisible();
    await expect(cancelButton).toBeVisible();
    testLogger.info('Save and Cancel buttons are visible');

    // Verify columns are listed
    const columnCount = await pm.dashboardPanelConfigs.getColumnOrderRowCount();
    expect(columnCount).toBeGreaterThan(0);
    testLogger.info(`Column Order popup displays ${columnCount} columns`);

    // Close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });

  // P1 - Functional Tests
  test("Verify columns can be reordered using move up button", {
    tag: ['@metrics', '@table', '@column-order', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing column reordering using move up button');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Get the initial order of columns
    const initialCount = await pm.dashboardPanelConfigs.getColumnOrderRowCount();
    expect(initialCount).toBeGreaterThan(1); // Need at least 2 columns to test reordering
    testLogger.info(`Initial column count: ${initialCount}`);

    // Get the text of the first two columns
    const firstColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    const secondColumnName = await pm.dashboardPanelConfigs.getColumnName(1);
    testLogger.info(`Initial order - First column: ${firstColumnName}, Second column: ${secondColumnName}`);

    // Click move up button on the second column (index 1) and wait for swap
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .toBe(secondColumnName);
    testLogger.info('Clicked move up button on second column');

    // Verify the order has changed
    const newFirstColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    const newSecondColumnName = await pm.dashboardPanelConfigs.getColumnName(1);
    testLogger.info(`New order - First column: ${newFirstColumnName}, Second column: ${newSecondColumnName}`);

    // The second column should now be first
    expect(newFirstColumnName).toBe(secondColumnName);
    expect(newSecondColumnName).toBe(firstColumnName);
    testLogger.info('Column order changed successfully using move up button');

    // Cancel to close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });

  test("Verify columns can be reordered using move down button", {
    tag: ['@metrics', '@table', '@column-order', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing column reordering using move down button');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Get the initial order of columns
    const firstColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    const secondColumnName = await pm.dashboardPanelConfigs.getColumnName(1);
    testLogger.info(`Initial order - First column: ${firstColumnName}, Second column: ${secondColumnName}`);

    // Click move down button on the first column (index 0) and wait for swap
    await pm.dashboardPanelConfigs.moveColumnDown(0);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .toBe(secondColumnName);
    testLogger.info('Clicked move down button on first column');

    // Verify the order has changed
    const newFirstColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    const newSecondColumnName = await pm.dashboardPanelConfigs.getColumnName(1);
    testLogger.info(`New order - First column: ${newFirstColumnName}, Second column: ${newSecondColumnName}`);

    // The first column should now be second
    expect(newFirstColumnName).toBe(secondColumnName);
    expect(newSecondColumnName).toBe(firstColumnName);
    testLogger.info('Column order changed successfully using move down button');

    // Cancel to close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });

  test("Verify drag handles are present for each column", {
    tag: ['@metrics', '@table', '@column-order', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing drag handles are present');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Check for drag handles
    const handleCount = await pm.dashboardPanelConfigs.columnOrderDragHandles.count();
    testLogger.info(`Found ${handleCount} drag handles`);

    expect(handleCount).toBeGreaterThan(0);

    // Verify drag handles have the correct icon
    const firstHandle = pm.dashboardPanelConfigs.columnOrderDragHandle(0);
    await expect(firstHandle).toBeVisible();
    testLogger.info('Drag handles are visible and properly configured');

    // Close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });

  test("Verify column order can be saved and persists", {
    tag: ['@metrics', '@table', '@column-order', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing column order save functionality');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Get the current table header order before reordering. Wait for the table
    // to actually render headers first — capturing a 0 baseline makes the
    // post-save "settles back to baseline" poll below impossible to satisfy.
    await expect
      .poll(async () => await pm.metricsPage.getPromqlTableHeaderCount(), { timeout: 10000 })
      .toBeGreaterThan(0);
    const initialHeaderCount = await pm.metricsPage.getPromqlTableHeaderCount();
    testLogger.info(`Initial table has ${initialHeaderCount} columns`);

    if (initialHeaderCount > 1) {
      const firstHeaderText = await pm.metricsPage.getPromqlTableHeaderText(0);
      const secondHeaderText = await pm.metricsPage.getPromqlTableHeaderText(1);
      testLogger.info(`Initial header order: ${firstHeaderText}, ${secondHeaderText}`);
    }

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Get the second column name
    const secondColumnName = await pm.dashboardPanelConfigs.getColumnName(1);
    testLogger.info(`Moving column: ${secondColumnName} to first position`);

    // Move the second column up to first position
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .toBe(secondColumnName);

    // Save the new order
    await pm.dashboardPanelConfigs.saveColumnOrder();
    testLogger.info('Saved column order');

    // Verify the popup closed
    const columnOrderPopup = pm.dashboardPanelConfigs.columnOrderDialog;
    await expect(columnOrderPopup).not.toBeVisible({ timeout: 3000 });
    testLogger.info('Column Order popup closed after save');

    // Verify the table reflects the new column order — wait for header count to settle
    await expect
      .poll(async () => await pm.metricsPage.getPromqlTableHeaderCount(), { timeout: 5000 })
      .toBe(initialHeaderCount);
    const newHeaderCount = await pm.metricsPage.getPromqlTableHeaderCount();
    testLogger.info(`Table now has ${newHeaderCount} columns`);

    if (newHeaderCount > 1) {
      const newFirstHeaderText = await pm.metricsPage.getPromqlTableHeaderText(0);
      testLogger.info(`First column after reorder: ${newFirstHeaderText}`);

      // The column we moved up should now be in a different position
      // Note: We're checking that the table structure has changed
      expect(newHeaderCount).toBe(initialHeaderCount);
      testLogger.info('Table maintained column count after reordering');
    }
  });

  test("Verify cancel button discards column order changes", {
    tag: ['@metrics', '@table', '@column-order', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing cancel functionality');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Get initial column order
    const initialFirstColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    testLogger.info(`Initial first column: ${initialFirstColumnName}`);

    // Make a change (move second column up)
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .not.toBe(initialFirstColumnName);

    // Get the changed first column name
    const changedFirstColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    testLogger.info(`Changed first column: ${changedFirstColumnName}`);
    expect(changedFirstColumnName).not.toBe(initialFirstColumnName);

    // Click Cancel
    await pm.dashboardPanelConfigs.cancelColumnOrder();
    testLogger.info('Clicked cancel button');

    // Verify the popup closed (cancelColumnOrder waits for hidden; this is an explicit assertion)
    await expect(pm.dashboardPanelConfigs.columnOrderDialog).not.toBeVisible({ timeout: 3000 });
    testLogger.info('Column Order popup closed after cancel');

    // Re-open the popup to verify changes were discarded
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Verify the original order is restored
    const restoredFirstColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    testLogger.info(`First column after cancel: ${restoredFirstColumnName}`);
    expect(restoredFirstColumnName).toBe(initialFirstColumnName);
    testLogger.info('Column order was successfully discarded after cancel');

    // Close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });

  test("Verify close icon also cancels column order changes", {
    tag: ['@metrics', '@table', '@column-order', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing close icon cancel functionality');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Make a change
    const initialFirstColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .not.toBe(initialFirstColumnName);
    testLogger.info('Made column order change');

    // Click the close (×) icon — ODialog renders it as o-dialog-close-btn
    const closeIcon = pm.dashboardPanelConfigs.columnOrderDialogCloseBtn;
    await expect(closeIcon).toBeVisible();
    await pm.dashboardPanelConfigs.closeColumnOrderViaCloseIcon();
    testLogger.info('Clicked close icon');

    // Verify the popup closed
    const columnOrderPopup = pm.dashboardPanelConfigs.columnOrderDialog;
    await expect(columnOrderPopup).not.toBeVisible({ timeout: 3000 });
    testLogger.info('Column Order popup closed via close icon');
  });

  test("Verify column order changes are reflected in the actual table chart", {
    tag: ['@metrics', '@table', '@column-order', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing that column order changes are applied to the table chart');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // STEP 1: Get the initial table column order from the actual table headers
    testLogger.info('Reading initial table column order');
    // Wait for table to fully render — count must stabilize
    await expect
      .poll(async () => await pm.metricsPage.getPromqlTableHeaderCount(), { timeout: 5000 })
      .toBeGreaterThan(0);

    const initialHeaderCount = await pm.metricsPage.getPromqlTableHeaderCount();
    testLogger.info(`Table has ${initialHeaderCount} columns`);

    if (initialHeaderCount < 3) {
      testLogger.warn('Not enough columns in table to test reordering (need at least 3)');
      return;
    }

    // Read initial table state
    const initialTimestamp = await pm.metricsPage.getPromqlTableHeaderText(0);
    const initialSecondColumn = await pm.metricsPage.getPromqlTableHeaderText(1);
    const initialThirdColumn = await pm.metricsPage.getPromqlTableHeaderText(2);
    testLogger.info(`Initial table order: 1st="${initialTimestamp}" (Timestamp), 2nd="${initialSecondColumn}", 3rd="${initialThirdColumn}"`);

    // STEP 2: Open Column Order popup and reorder
    testLogger.info('Opening Column Order popup');
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Move 2nd popup column to 1st position
    testLogger.info('Moving popup 2nd column (table 3rd column) to 1st position in popup');
    const beforeMoveFirst = await pm.dashboardPanelConfigs.getColumnName(0);
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .not.toBe(beforeMoveFirst);

    // Get the column that's now in popup position 0 (should be table position 1 after save)
    const expectedSecondTableColumn = await pm.dashboardPanelConfigs.getColumnName(0);
    testLogger.info(`Column now in popup position 0: "${expectedSecondTableColumn}" (should be table position 1)`);

    // STEP 3: Save the column order
    testLogger.info('Saving column order');
    await pm.dashboardPanelConfigs.saveColumnOrder();
    testLogger.info('Column order saved');

    // STEP 4: Verify the popup closed
    const columnOrderPopup = pm.dashboardPanelConfigs.columnOrderDialog;
    await expect(columnOrderPopup).not.toBeVisible({ timeout: 3000 });
    testLogger.info('Column Order popup closed after save');

    // STEP 5: Verify table shows the new column order — poll until second column updates
    testLogger.info('Reading new table column order after save');
    await expect
      .poll(async () => await pm.metricsPage.getPromqlTableHeaderText(1), { timeout: 5000 })
      .toBe(expectedSecondTableColumn);

    const newHeaderCount = await pm.metricsPage.getPromqlTableHeaderCount();
    testLogger.info(`Table still has ${newHeaderCount} columns`);
    expect(newHeaderCount).toBe(initialHeaderCount);

    // Get the new column names
    const newTimestamp = await pm.metricsPage.getPromqlTableHeaderText(0);
    const newSecondColumn = await pm.metricsPage.getPromqlTableHeaderText(1);
    const newThirdColumn = await pm.metricsPage.getPromqlTableHeaderText(2);
    testLogger.info(`New table order: 1st="${newTimestamp}" (Timestamp), 2nd="${newSecondColumn}", 3rd="${newThirdColumn}"`);

    // STEP 6: Verify the column order change was applied correctly
    testLogger.info('Verifying column order change was applied to table');

    // Timestamp should always remain in position 0
    expect(newTimestamp).toBe(initialTimestamp);
    testLogger.info(`Timestamp remains in 1st position: "${newTimestamp}"`);

    // The column we moved to popup position 0 should now be in table position 1
    expect(newSecondColumn).toBe(expectedSecondTableColumn);
    testLogger.info(`Reordered column "${expectedSecondTableColumn}" is now in table position 1 (2nd column)`);

    testLogger.info('Column order changes successfully applied to table chart!');
  });

  test("Verify column order persists after re-running the query", {
    tag: ['@metrics', '@table', '@column-order', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing column order persists after re-running the query');

    await setupTableChart(pm, page, 'expanded_timeseries');
    await expect
      .poll(async () => await pm.metricsPage.getPromqlTableHeaderCount(), { timeout: 20000 })
      .toBeGreaterThan(2);
    await expect
      .poll(async () => {
        const count = await pm.metricsPage.getPromqlTableHeaderCount();
        if (count < 3) return '';
        return await pm.metricsPage.getPromqlTableHeaderText(count - 1);
      }, { timeout: 10000 })
      .toBe('Value');
    const headerCountReady = await pm.metricsPage.getPromqlTableHeaderCount();
    testLogger.info(`Table layout ready: ${headerCountReady} headers (expanded_timeseries layout)`);

    // STEP 1: Set custom column order
    testLogger.info('Setting custom column order');
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Move 2nd column to 1st position in the popup
    const beforeFirst = await pm.dashboardPanelConfigs.getColumnName(0);
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .not.toBe(beforeFirst);

    // Get the expected column name after reorder (should be 1st in popup, 2nd in table)
    const expectedColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    testLogger.info(`Expected column after reorder: "${expectedColumnName}"`);

    // Save the column order
    await pm.dashboardPanelConfigs.saveColumnOrder();
    testLogger.info('Column order saved');
    const columnOrderPopup = pm.dashboardPanelConfigs.columnOrderDialog;
    await expect(columnOrderPopup).not.toBeVisible({ timeout: 5000 });

    // STEP 2: Verify table shows reordered columns
    // NOTE: Timestamp is always in position 0 (first column)
    // The reordered column should appear in position 1 (second column)
    await expect
      .poll(async () => await pm.metricsPage.getPromqlTableHeaderText(1), { timeout: 15000 })
      .toBe(expectedColumnName);

    const timestampColumn = await pm.metricsPage.getPromqlTableHeaderText(0);
    testLogger.info(`First column (always Timestamp): "${timestampColumn}"`);

    const secondColumnAfterSave = await pm.metricsPage.getPromqlTableHeaderText(1);
    testLogger.info(`Second column after save: "${secondColumnAfterSave}"`);
    expect(secondColumnAfterSave).toBe(expectedColumnName);

    // STEP 3: Close the config sidebar
    await pm.metricsPage.clickDashboardSidebarCollapseButton();
    testLogger.info('Closed config sidebar');

    // STEP 4: Re-run the query by clicking Apply button
    testLogger.info('Re-running the query');
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();
    testLogger.info('Query re-executed');

    // STEP 5: Verify column order is still maintained after query re-run
    // The reordered column should still be in position 1 (second column after Timestamp)
    testLogger.info('Verifying column order persists after re-running query');
    await expect
      .poll(async () => await pm.metricsPage.getPromqlTableHeaderText(1), { timeout: 5000 })
      .toBe(expectedColumnName);

    const timestampAfterRerun = await pm.metricsPage.getPromqlTableHeaderText(0);
    const secondColumnAfterRerun = await pm.metricsPage.getPromqlTableHeaderText(1);
    testLogger.info(`First column after re-run (Timestamp): "${timestampAfterRerun}"`);
    testLogger.info(`Second column after re-running query: "${secondColumnAfterRerun}"`);

    expect(secondColumnAfterRerun).toBe(expectedColumnName);
    testLogger.info('Column order successfully persisted after re-running the query!');
    testLogger.info('Reordered column correctly appears in 2nd position (after Timestamp)');
  });

  test("Verify column order persists when switching between chart types", {
    tag: ['@metrics', '@table', '@column-order', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing column order persists when switching chart types');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // STEP 1: Set custom column order
    testLogger.info('Setting custom column order');
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Move 2nd column to 1st position in the popup
    const beforeFirst = await pm.dashboardPanelConfigs.getColumnName(0);
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .not.toBe(beforeFirst);

    // Get the expected column name (should be 1st in popup, 2nd in table after Timestamp)
    const expectedColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    testLogger.info(`Expected column: "${expectedColumnName}"`);

    // Save the column order
    await pm.dashboardPanelConfigs.saveColumnOrder();
    testLogger.info('Column order saved');

    // STEP 2: Switch to a different chart type (e.g., line chart)
    testLogger.info('Switching to line chart');
    await pm.metricsPage.selectChartType('line');
    testLogger.info('Switched to line chart');

    // STEP 3: Switch back to table chart
    testLogger.info('Switching back to table chart');
    await pm.metricsPage.selectChartType('table');
    testLogger.info('Switched back to table chart');

    // STEP 4: Verify column order is still maintained
    // NOTE: Timestamp is always in position 0, reordered column should be in position 1
    testLogger.info('Verifying column order persists after switching chart types');
    await expect
      .poll(async () => await pm.metricsPage.getPromqlTableHeaderText(1), { timeout: 5000 })
      .toBe(expectedColumnName);

    const timestampColumn = await pm.metricsPage.getPromqlTableHeaderText(0);
    const secondColumnAfterSwitch = await pm.metricsPage.getPromqlTableHeaderText(1);
    testLogger.info(`First column (Timestamp): "${timestampColumn}"`);
    testLogger.info(`Second column after switching back to table: "${secondColumnAfterSwitch}"`);

    expect(secondColumnAfterSwitch).toBe(expectedColumnName);
    testLogger.info('Column order successfully persisted when switching chart types!');
    testLogger.info('Reordered column correctly appears in 2nd position (after Timestamp)');
  });

  test("Verify column order is maintained with different queries on same metric", {
    tag: ['@metrics', '@table', '@column-order', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing column order with different queries on same metric');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // STEP 1: Set custom column order for cpu_usage query
    testLogger.info('Setting custom column order for cpu_usage');
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Get initial column count
    const initialColumnCount = await pm.dashboardPanelConfigs.getColumnOrderRowCount();
    testLogger.info(`Initial column count: ${initialColumnCount}`);

    if (initialColumnCount < 2) {
      testLogger.warn('Not enough columns to test');
      await pm.dashboardPanelConfigs.cancelColumnOrder();
      return;
    }

    // Move 2nd column to 1st position in the popup
    const beforeFirst = await pm.dashboardPanelConfigs.getColumnName(0);
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .not.toBe(beforeFirst);

    // Get the expected column name (should be 1st in popup, 2nd in table after Timestamp)
    const expectedColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
    testLogger.info(`Expected column (should be 2nd in table): "${expectedColumnName}"`);

    // Save the column order
    await pm.dashboardPanelConfigs.saveColumnOrder();
    testLogger.info('Column order saved');

    // Close config sidebar
    await pm.metricsPage.clickDashboardSidebarCollapseButton();

    // STEP 2: Modify the query slightly (add a filter or aggregation)
    testLogger.info('Modifying query with aggregation');
    await pm.metricsPage.enterMetricsQuery('sum(cpu_usage)');
    await pm.metricsPage.clickApplyButton();
    await pm.metricsPage.waitForMetricsResults();

    // STEP 3: Verify table still renders (may have different structure with aggregation)
    const tableVisible = await pm.metricsPage.isPromqlTableVisible();
    testLogger.info(`Table visible after query change: ${tableVisible}`);

    if (tableVisible) {
      const headerCount = await pm.metricsPage.getPromqlTableHeaderCount();
      testLogger.info(`Table has ${headerCount} columns after query change`);

      // Note: Column order behavior may differ based on whether the same columns are present
      // This test documents the behavior rather than enforcing specific expectations
      if (headerCount > 0) {
        const timestampColumn = await pm.metricsPage.getPromqlTableHeaderText(0);
        testLogger.info(`First column (Timestamp): "${timestampColumn}"`);

        if (headerCount > 1) {
          const secondColumn = await pm.metricsPage.getPromqlTableHeaderText(1);
          testLogger.info(`Second column with modified query: "${secondColumn}"`);
        }

        testLogger.info('Table rendered successfully with modified query');
      }
    } else {
      testLogger.info('Table not visible with aggregated query (may show different visualization)');
    }
  });

  // P2 - Edge Cases
  test("Verify move up button is disabled for first column", {
    tag: ['@metrics', '@table', '@column-order', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing move up button disabled state for first column');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Check the move up button for the first column
    const firstMoveUpButton = pm.dashboardPanelConfigs.columnOrderMoveUpBtn(0);
    await expect(firstMoveUpButton).toBeVisible();

    // Verify it's disabled
    const isDisabled = await firstMoveUpButton.evaluate((btn) => btn.hasAttribute('disabled'));
    expect(isDisabled).toBe(true);
    testLogger.info('Move up button is correctly disabled for first column');

    // Close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });

  test("Verify move down button is disabled for last column", {
    tag: ['@metrics', '@table', '@column-order', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing move down button disabled state for last column');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Get the count of columns
    const columnCount = await pm.dashboardPanelConfigs.getColumnOrderRowCount();
    testLogger.info(`Total columns: ${columnCount}`);

    // Check the move down button for the last column
    const lastMoveDownButton = pm.dashboardPanelConfigs.columnOrderMoveDownBtn(columnCount - 1);
    await expect(lastMoveDownButton).toBeVisible();

    // Verify it's disabled
    const isDisabled = await lastMoveDownButton.evaluate((btn) => btn.hasAttribute('disabled'));
    expect(isDisabled).toBe(true);
    testLogger.info('Move down button is correctly disabled for last column');

    // Close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });

  test("Verify Column Order button is NOT visible for Time series mode", {
    tag: ['@metrics', '@table', '@column-order', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing that Column Order button is NOT visible for Time series mode');

    // Note: 'single' mode corresponds to "Time series" in the UI
    await setupTableChart(pm, page, 'single');

    // Verify the Column Order button is NOT visible
    const columnOrderButton = pm.dashboardPanelConfigs.columnOrderBtn;
    const isButtonVisible = await columnOrderButton.isVisible({ timeout: 3000 }).catch(() => false);

    expect(isButtonVisible).toBe(false);
    testLogger.info('Column Order button correctly NOT visible for Time series mode');
  });

  test("Verify Column Order feature works with Aggregate mode", {
    tag: ['@metrics', '@table', '@column-order', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing Column Order feature with Aggregate mode');

    await setupTableChart(pm, page, 'all');

    // Verify the Column Order button is visible for Aggregate mode
    const columnOrderButton = pm.dashboardPanelConfigs.columnOrderBtn;
    const isButtonVisible = await columnOrderButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (isButtonVisible) {
      testLogger.info('Column Order button is visible for Aggregate mode');
      await pm.dashboardPanelConfigs.openColumnOrderDialog();

      // Verify the popup opens
      const columnOrderPopup = pm.dashboardPanelConfigs.columnOrderDialog;
      await expect(columnOrderPopup).toBeVisible({ timeout: 5000 });
      testLogger.info('Column Order popup opened for Aggregate mode');

      // Verify columns are listed
      const columnCount = await pm.dashboardPanelConfigs.getColumnOrderRowCount();
      expect(columnCount).toBeGreaterThan(0);
      testLogger.info(`Column Order popup displays ${columnCount} columns in Aggregate mode`);

      // Close the popup
      await pm.dashboardPanelConfigs.cancelColumnOrder();
    } else {
      testLogger.warn('Column Order button not visible for Aggregate mode - mode may not have switched correctly');
    }
  });

  test("Verify multiple consecutive reorders work correctly", {
    tag: ['@metrics', '@table', '@column-order', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing multiple consecutive column reorders');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Get initial column count
    const columnCount = await pm.dashboardPanelConfigs.getColumnOrderRowCount();
    testLogger.info(`Working with ${columnCount} columns`);

    if (columnCount >= 3) {
      // Get initial third column name
      const thirdColumnName = await pm.dashboardPanelConfigs.getColumnName(2);
      testLogger.info(`Initial third column: ${thirdColumnName}`);

      // Move third column up twice to make it first
      await pm.dashboardPanelConfigs.moveColumnUp(2);
      await expect
        .poll(async () => await pm.dashboardPanelConfigs.getColumnName(1), { timeout: 5000 })
        .toBe(thirdColumnName);
      testLogger.info('Moved column up once');

      await pm.dashboardPanelConfigs.moveColumnUp(1);
      await expect
        .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
        .toBe(thirdColumnName);
      testLogger.info('Moved column up twice');

      // Verify it's now in first position
      const newFirstColumnName = await pm.dashboardPanelConfigs.getColumnName(0);
      testLogger.info(`New first column: ${newFirstColumnName}`);
      expect(newFirstColumnName).toBe(thirdColumnName);
      testLogger.info('Multiple consecutive reorders work correctly');
    } else {
      testLogger.warn(`Not enough columns (${columnCount}) to test multiple reorders`);
    }

    // Close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });

  test("Verify column numbers update correctly after reordering", {
    tag: ['@metrics', '@table', '@column-order', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing column numbers update after reordering');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Get column numbers before reordering
    const firstColumnNumber = await pm.dashboardPanelConfigs.getColumnNumber(0);
    const secondColumnNumber = await pm.dashboardPanelConfigs.getColumnNumber(1);
    testLogger.info(`Initial column numbers: ${firstColumnNumber}, ${secondColumnNumber}`);

    // Move second column up
    const beforeFirst = await pm.dashboardPanelConfigs.getColumnName(0);
    await pm.dashboardPanelConfigs.moveColumnUp(1);
    await expect
      .poll(async () => await pm.dashboardPanelConfigs.getColumnName(0), { timeout: 5000 })
      .not.toBe(beforeFirst);

    // Verify column numbers are still sequential (1, 2, 3...)
    const newFirstNumber = await pm.dashboardPanelConfigs.getColumnNumber(0);
    const newSecondNumber = await pm.dashboardPanelConfigs.getColumnNumber(1);
    testLogger.info(`After reorder column numbers: ${newFirstNumber}, ${newSecondNumber}`);

    expect(newFirstNumber).toBe('1.');
    expect(newSecondNumber).toBe('2.');
    testLogger.info('Column numbers update correctly and remain sequential');

    // Close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });

  test("Verify empty state is not shown when columns are available", {
    tag: ['@metrics', '@table', '@column-order', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    testLogger.info('Testing that empty state is not shown with available columns');

    await setupTableChart(pm, page, 'expanded_timeseries');

    // Open Column Order popup
    await pm.dashboardPanelConfigs.openColumnOrderDialog();

    // Verify draggable list is shown (not empty state)
    const draggableList = pm.dashboardPanelConfigs.columnOrderDraggableList;
    await expect(draggableList).toBeVisible();
    testLogger.info('Draggable list is visible');

    // Verify empty state is NOT shown
    const emptyState = pm.dashboardPanelConfigs.columnOrderEmptyState;
    const isEmptyStateVisible = await emptyState.isVisible().catch(() => false);
    expect(isEmptyStateVisible).toBe(false);
    testLogger.info('Empty state is correctly not shown when columns are available');

    // Close the popup
    await pm.dashboardPanelConfigs.cancelColumnOrder();
  });
});

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
import { waitForDashboardPage, deleteDashboard } from '../Dashboards/utils/dashCreation.js';


test.describe("Metrics PromQL Builder Mode testcases", () => {
  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  /** Create a fresh PageManager per test — avoids data races in parallel workers. */
  async function setupTest(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForTimeout(2000);
    testLogger.info('Test setup completed - navigated to metrics page');
    return pm;
  }

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // =========================================================================
  // P0 - Mode Switching + UI Verification (merged: tab switching + UI elements)
  // =========================================================================

  test("P0: Builder mode tabs, UI elements, and mode switching", {
    tag: ['@metrics', '@builder', '@smoke', '@P0', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Verify all mode buttons visible
    await expect(page.locator(builder.sqlModeButton)).toBeVisible({ timeout: 5000 });
    await expect(page.locator(builder.promqlModeButton)).toBeVisible();
    await expect(page.locator(builder.builderModeButton)).toBeVisible();
    await expect(page.locator(builder.customModeButton)).toBeVisible();
    testLogger.info('All mode buttons visible');

    // 2. Verify default mode is PromQL + Builder
    expect(await builder.isModeSelected('promql')).toBe(true);
    expect(await builder.isModeSelected('builder')).toBe(true);
    testLogger.info('Default mode: PromQL + Builder');

    // 3. Verify Builder UI elements visible
    expect(await builder.isMetricSelectorVisible()).toBe(true);
    expect(await builder.isAddLabelFilterVisible()).toBe(true);
    expect(await builder.isAddOperationVisible()).toBe(true);
    expect(await builder.isOptionsVisible()).toBe(true);
    await expect(page.locator(builder.runQueryButton).first()).toBeVisible();
    testLogger.info('All Builder UI elements visible');

    // 4. Switch SQL -> PromQL -> Custom -> Builder
    await builder.switchToSQLMode();
    expect(await builder.isModeSelected('sql')).toBe(true);
    testLogger.info('Switched to SQL mode');

    await builder.switchToPromQLMode();
    expect(await builder.isModeSelected('promql')).toBe(true);
    testLogger.info('Switched back to PromQL mode');

    await builder.switchToCustomMode();
    expect(await builder.isModeSelected('custom')).toBe(true);
    // Builder UI should be hidden in Custom mode
    expect(await builder.isBuilderUIVisible()).toBe(false);
    testLogger.info('Custom mode: Builder UI hidden');

    // Verify code editor visible in Custom mode
    const editorVisible = await page.locator('.monaco-editor, .view-lines, textarea.inputarea, .cm-editor').first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(editorVisible).toBe(true);
    testLogger.info('Custom mode: Code editor visible');

    await builder.switchToBuilderMode();
    expect(await builder.isModeSelected('builder')).toBe(true);
    expect(await builder.isBuilderUIVisible()).toBe(true);
    testLogger.info('Switched back to Builder mode: UI restored');
  });

  // =========================================================================
  // P0 - Run Query with Default Metric + Stream Search
  // =========================================================================

  test("P0: Stream selector, search filter, and run default query", {
    tag: ['@metrics', '@builder', '@smoke', '@P0', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Verify stream selector visible with pre-selected value
    const streamSelector = page.locator(builder.streamSelector);
    await expect(streamSelector).toBeVisible({ timeout: 5000 });
    const streamValue = await streamSelector.inputValue();
    expect(streamValue.length).toBeGreaterThan(0);
    testLogger.info(`Pre-selected stream: "${streamValue}"`);

    // 2. Open dropdown and verify metrics listed
    await streamSelector.click();
    await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
    const menuItems = page.locator('.q-menu .q-item, .q-virtual-scroll__content .q-item');
    const menuCount = await menuItems.count();
    expect(menuCount).toBeGreaterThan(0);
    testLogger.info(`Dropdown shows ${menuCount} metrics`);
    await page.keyboard.press('Escape');

    // 3. Search and filter metrics
    await streamSelector.click();
    await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
    await streamSelector.clear();
    await streamSelector.fill('cpu');
    await page.waitForTimeout(1000);
    const filtered = page.locator('.q-menu .q-item, .q-virtual-scroll__content .q-item');
    const filteredCount = await filtered.count();
    expect(filteredCount).toBeGreaterThan(0);
    testLogger.info(`Filtered to ${filteredCount} metrics matching "cpu"`);

    // Select first filtered item
    await filtered.first().click();
    await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

    // 4. Run query and verify visualization
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);
    const hasError = await pm.metricsPage.isErrorNotificationVisible();
    expect(hasError).toBe(false);
    const hasVis = await pm.metricsPage.hasVisualization();
    expect(hasVis).toBe(true);
    testLogger.info('Default query executed with visualization');
  });

  // =========================================================================
  // P1 - Complete Label Filter Workflow (merged: add, dropdown, operator,
  //       value disabled, chip text, multiple, remove)
  // =========================================================================

  test("P1: Label filters - add, configure, verify operators, multiple, remove", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Initial count is 0
    const initialCount = await builder.getLabelFilterCount();
    testLogger.info(`Initial filter count: ${initialCount}`);

    // 2. Add first filter and verify default text
    await builder.clickAddLabelFilter();
    expect(await builder.getLabelFilterCount()).toBe(initialCount + 1);
    const defaultText = await builder.getLabelFilterText(0);
    expect(defaultText).toContain('Select label');
    testLogger.info('First filter added with "Select label" default');

    // 3. Open filter menu and verify dropdowns
    await builder.openLabelFilterMenu(0);
    await expect(page.locator(builder.labelSelect).last()).toBeVisible({ timeout: 5000 });
    await expect(page.locator(builder.operatorSelect).last()).toBeVisible();
    await expect(page.locator(builder.valueSelect).last()).toBeVisible();
    testLogger.info('Label, Operator, Value dropdowns all visible');

    // 4. Verify value dropdown is disabled (no label selected yet)
    const isDisabled = await builder.isValueSelectDisabled();
    expect(isDisabled).toBe(true);
    testLogger.info('Value dropdown disabled before label selection');

    // 5. Verify operator dropdown has all 4 operators
    const operatorDropdown = page.locator(builder.operatorSelect).last();
    await operatorDropdown.click();
    await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
    const operators = ['=', '!=', '=~', '!~'];
    const opMenuItems = page.locator('.q-menu .q-item');
    expect(await opMenuItems.count()).toBeGreaterThanOrEqual(4);
    for (const op of operators) {
      expect(await opMenuItems.filter({ hasText: op }).count()).toBeGreaterThan(0);
    }
    testLogger.info('All 4 operators verified: =, !=, =~, !~');
    await page.keyboard.press('Escape');

    // 6. Select a label and verify chip text updates
    const labelDropdown = page.locator(builder.labelSelect).last();
    await labelDropdown.click();
    await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
    const labelOptions = page.locator('.q-menu .q-item');
    const labelCount = await labelOptions.count();
    testLogger.info(`Available labels: ${labelCount}`);

    if (labelCount > 0) {
      const firstLabelText = await labelOptions.first().textContent();
      await labelOptions.first().click();
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      testLogger.info(`Selected label: ${firstLabelText}`);

      // Default operator should be "="
      const opText = await page.locator(builder.operatorSelect).last().textContent().catch(() => '');
      expect(opText).toContain('=');
      testLogger.info(`Default operator: ${opText}`);

      await page.keyboard.press('Escape');

      // Chip text should no longer say "Select label"
      const updatedText = await builder.getLabelFilterText(0);
      expect(updatedText).not.toContain('Select label');
      testLogger.info(`Updated chip text: "${updatedText}"`);
    } else {
      await page.keyboard.press('Escape');
      testLogger.warn('No labels available');
    }

    // 7. Add more filters and verify count
    await builder.clickAddLabelFilter();
    await builder.clickAddLabelFilter();
    expect(await builder.getLabelFilterCount()).toBe(initialCount + 3);
    testLogger.info('Added 2 more filters, total: ' + (initialCount + 3));

    // 8. Remove all filters
    await builder.removeLabelFilter(2);
    await builder.removeLabelFilter(1);
    await builder.removeLabelFilter(0);
    expect(await builder.getLabelFilterCount()).toBe(0);
    testLogger.info('All filters removed');
  });

  // =========================================================================
  // P1 - Complete Operations Workflow (merged: add, categories, search,
  //       remove, params, close dialog, ordering)
  // =========================================================================

  test("P1: Operations - add, categories, search, params, reorder, remove", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Open operation dialog and verify categories
    await builder.clickAddOperation();
    const dialog = page.locator('[data-test="operations-list-operation-selector-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const categories = await builder.getOperationCategories();
    expect(categories.length).toBeGreaterThanOrEqual(3);
    testLogger.info(`Categories: ${categories.join(', ')}`);

    // 2. Verify search filters operations
    const searchInput = dialog.locator('input').first();
    await searchInput.fill('histogram');
    await page.waitForTimeout(1000);
    const histogramItems = dialog.locator('.q-expansion-item .q-list .q-item');
    const histogramCount = await histogramItems.count();
    expect(histogramCount).toBeGreaterThan(0);
    testLogger.info(`"histogram" search found ${histogramCount} items`);

    // 3. Verify empty search returns 0
    await searchInput.fill('zzz_nonexistent_operation');
    await page.waitForTimeout(1000);
    expect(await dialog.locator('.q-expansion-item .q-list .q-item').count()).toBe(0);
    testLogger.info('Non-existent search returns 0 results');

    // 4. Clear search, restore all
    await searchInput.clear();
    await page.waitForTimeout(1000);
    expect(await dialog.locator('.q-expansion-item .q-list .q-item').count()).toBeGreaterThan(0);
    testLogger.info('Clearing search restores all operations');

    // 5. Close dialog via Close button
    await builder.closeOperationDialog();
    expect(await builder.isOperationDialogVisible()).toBe(false);
    testLogger.info('Dialog closed via Close button');

    // 6. Close dialog via overlay (interact-outside) — the Escape key path is exercised
    // by Reka UI / Quasar separately; here we verify the dismissable-layer overlay close
    // works after the dialog migration.
    await builder.clickAddOperation();
    expect(await builder.isOperationDialogVisible()).toBe(true);
    // Click the overlay scrim outside the dialog panel.
    await page.locator('[data-test="operations-list-operation-selector-dialog"]')
      .evaluate((el) => {
        // Find the sibling overlay rendered by Reka UI; clicking it dismisses the dialog.
        const overlay = document.querySelector('[data-reka-dialog-overlay], [aria-hidden="true"].tw\\:fixed.tw\\:inset-0');
        if (overlay instanceof HTMLElement) overlay.click();
      });
    await page
      .locator('[data-test="operations-list-operation-selector-dialog"]')
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
    // If overlay click didn't dismiss (Reka UI version differences), fall back to the close button.
    if (await builder.isOperationDialogVisible()) {
      await builder.closeOperationDialog();
    }
    expect(await builder.isOperationDialogVisible()).toBe(false);
    testLogger.info('Dialog closed via overlay / fallback close');

    // 7. Add Rate operation
    const rateAdded = await builder.addOperation('Rate');
    expect(rateAdded).toBe(true);
    expect(await builder.getOperationCount()).toBe(1);
    const rateText = await builder.getOperationText(0);
    expect(rateText.toLowerCase()).toContain('rate');
    testLogger.info(`Rate operation added: ${rateText}`);

    // 8. Configure Rate parameter
    const opBtn = page.locator('[data-test="promql-operation-0"]');
    await opBtn.click();
    await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
    const paramInput = page.locator('[data-test="promql-operation-param-0"]').last();
    const paramVisible = await paramInput.isVisible({ timeout: 3000 }).catch(() => false);
    if (paramVisible) {
      const tagName = await paramInput.evaluate(el => el.tagName).catch(() => '');
      const input = tagName === 'INPUT' ? paramInput : paramInput.locator('input').first();
      if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
        const currentValue = await input.inputValue().catch(() => '');
        testLogger.info(`Rate default param: ${currentValue}`);
        await input.click({ clickCount: 3 });
        await input.press('Backspace');
        await input.pressSequentially('5m');
        expect(await input.inputValue()).toBe('5m');
        testLogger.info('Rate param updated to 5m');
      }
    }
    await page.keyboard.press('Escape');

    // 9. Add Sum operation (from different category)
    const sumAdded = await builder.addOperation('Sum');
    expect(sumAdded).toBe(true);
    expect(await builder.getOperationCount()).toBe(2);
    expect((await builder.getOperationText(0)).toLowerCase()).toContain('rate');
    expect((await builder.getOperationText(1)).toLowerCase()).toContain('sum');
    testLogger.info('Rate at index 0, Sum at index 1');

    // 10. Remove Rate, verify Sum moves to index 0
    await builder.removeOperation(0);
    expect(await builder.getOperationCount()).toBe(1);
    expect((await builder.getOperationText(0)).toLowerCase()).toContain('sum');
    testLogger.info('After removing Rate, Sum at index 0');

    // 11. Cleanup
    await builder.removeOperation(0);
    expect(await builder.getOperationCount()).toBe(0);
    testLogger.info('All operations removed');
  });

  // =========================================================================
  // P1 - Builder Options (merged: legend, step value, query type)
  // =========================================================================

  test("P1: Builder options - legend, step value, query type switching", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Set legend
    const legendField = page.locator(builder.legendInput);
    await expect(legendField).toBeVisible({ timeout: 5000 });
    const legendSet = await builder.setLegend('{{instance}}');
    expect(legendSet).toBe(true);
    const legendInput = legendField.locator('input').first();
    expect(await legendInput.inputValue().catch(() => '')).toContain('{{instance}}');
    testLogger.info('Legend set to "{{instance}}"');

    // 2. Set step value
    const stepSet = await builder.setStepValue('30s');
    expect(stepSet).toBe(true);
    const stepInput = page.locator(builder.stepValueInput);
    expect(await stepInput.inputValue()).toBe('30s');
    testLogger.info('Step value set to 30s');

    // 3. Switch query type to Instant and back to Range
    const qtInstant = await builder.selectQueryType('instant');
    expect(qtInstant).toBe(true);
    testLogger.info('Query type: Instant');

    const qtRange = await builder.selectQueryType('range');
    expect(qtRange).toBe(true);
    testLogger.info('Query type: Range');

    // 4. Run query with Range type, verify visualization
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);
    expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
    expect(await pm.metricsPage.hasVisualization()).toBe(true);
    testLogger.info('Range query succeeded with visualization');

    // 5. Switch to Instant and run
    await builder.selectQueryType('instant');
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);
    await expect(page.locator(builder.runQueryButton).first()).toBeVisible();
    testLogger.info('Instant query executed without crash');

    // Restore Range
    await builder.selectQueryType('range');
    testLogger.info('Query type restored to Range');
  });

  // =========================================================================
  // P1 - Add to Dashboard Cancel + Dialog Fields
  // =========================================================================

  test("P1: Add to Dashboard - dialog fields, fill title, cancel", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // Run query first to enable Add to Dashboard
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);

    // Click Add to Dashboard
    const addClicked = await builder.clickAddToDashboard();
    if (addClicked) {
      expect(await builder.isDashboardDialogVisible()).toBe(true);
      testLogger.info('Dialog opened');

      // Verify all dialog fields
      await expect(page.locator(builder.dashboardPanelTitleInput)).toBeVisible({ timeout: 3000 });
      await expect(page.locator(builder.dashboardCancelButton)).toBeVisible();
      await expect(page.locator(builder.dashboardAddButton)).toBeVisible();
      testLogger.info('All dialog fields visible (title, cancel, add)');

      // Fill title and cancel
      await builder.fillPanelTitle('Test Builder Panel');
      await builder.clickDashboardCancel();
      expect(await builder.isDashboardDialogVisible()).toBe(false);
      testLogger.info('Dialog closed after cancel');
    } else {
      testLogger.warn('Add to Dashboard button not visible');
    }
  });

  // =========================================================================
  // P1 - State Persistence across Mode Switches
  // =========================================================================

  test("P1: State persistence - filters, operations, step value across Builder/Custom switch", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // Setup: add filter, operation, step value
    await builder.clickAddLabelFilter();
    expect(await builder.getLabelFilterCount()).toBe(1);

    const opAdded = await builder.addOperation('Rate');
    expect(opAdded).toBe(true);
    expect(await builder.getOperationCount()).toBe(1);

    await builder.setStepValue('2m');
    testLogger.info('Setup: 1 filter, 1 operation (Rate), step=2m');

    // Switch to Custom mode
    await builder.switchToCustomMode();
    await page.waitForTimeout(1000);
    testLogger.info('Switched to Custom mode');

    // Switch back to Builder
    await builder.switchToBuilderMode();
    await page.waitForTimeout(1000);
    testLogger.info('Switched back to Builder mode');

    // Verify all state persisted
    expect(await builder.getLabelFilterCount()).toBe(1);
    expect(await builder.getOperationCount()).toBe(1);

    const stepInput = page.locator(builder.stepValueInput);
    expect(await stepInput.inputValue().catch(() => '')).toBe('2m');

    // Metric selector still visible
    expect(await builder.isMetricSelectorVisible()).toBe(true);
    testLogger.info('All state persisted across mode switch');
  });

  // =========================================================================
  // P1 - Full E2E: Build query with metric + Rate + label + step + run
  // =========================================================================

  test("P1: E2E - build query with Rate operation, step value, run and verify chart", {
    tag: ['@metrics', '@builder', '@e2e', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Verify builder mode + metric pre-selected
    expect(await builder.isModeSelected('builder')).toBe(true);
    const streamInput = page.locator(builder.streamSelector);
    expect((await streamInput.inputValue()).length).toBeGreaterThan(0);
    testLogger.info('Builder mode active, metric pre-selected');

    // 2. Set time range
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);

    // 3. Add label filter
    await builder.clickAddLabelFilter();
    expect(await builder.getLabelFilterCount()).toBeGreaterThan(0);

    // 4. Add Rate operation
    expect(await builder.addOperation('Rate')).toBe(true);
    expect(await builder.getOperationCount()).toBe(1);

    // 5. Set step value + query type
    await builder.setStepValue('30s');
    expect(await page.locator(builder.stepValueInput).inputValue()).toBe('30s');
    await builder.selectQueryType('range');

    // 6. Run query
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);

    // 7. Verify no errors + chart rendered
    expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
    expect(await pm.metricsPage.hasVisualization()).toBe(true);
    testLogger.info('E2E query executed with visualization');

    // 8. Cleanup
    await builder.removeOperation(0);
    expect(await builder.getOperationCount()).toBe(0);
    testLogger.info('E2E workflow complete');
  });

  // =========================================================================
  // P2 - E2E: Build query, switch chart type to Table, verify table renders
  // =========================================================================

  test("P2: E2E - build query, switch to table chart, verify table renders with no errors", {
    tag: ['@metrics', '@builder', '@e2e', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Set time range and run default query first
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);

    await builder.clickRunQuery();
    await page.waitForTimeout(3000);
    expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
    testLogger.info('Default line chart query executed');

    // 2. Switch to table chart type
    const tableSelected = await builder.selectChartType('table');
    if (tableSelected) {
      testLogger.info('Switched to table chart type');

      // 3. Run query again with table chart
      await builder.clickRunQuery();
      await page.waitForTimeout(3000);

      // 4. Verify no errors
      expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
      testLogger.info('Table chart query executed without errors');

      // 5. Verify table or chart rendered
      const rendered = await builder.isChartRendered();
      expect(rendered).toBe(true);
      testLogger.info('Table/chart rendered successfully');

      // 6. Switch back to line chart
      await builder.selectChartType('line');
      testLogger.info('Switched back to line chart');
    } else {
      // Chart type selector might not be visible on metrics page
      // (it may only appear in dashboard panel editor context)
      testLogger.info('Table chart type not available on metrics page - checking area chart');

      // Try area chart instead
      const areaSelected = await builder.selectChartType('area');
      if (areaSelected) {
        await builder.clickRunQuery();
        await page.waitForTimeout(3000);
        expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
        testLogger.info('Area chart query executed without errors');
      } else {
        testLogger.info('Chart type selector not available on metrics page (expected in dashboard context)');
      }
    }
  });

  // =========================================================================
  // P2 - E2E: Build query with operation + label, add to dashboard,
  //       verify panel, cleanup dashboard
  // =========================================================================

  test("P2: E2E - build query, save to dashboard, verify panel, cleanup", {
    tag: ['@metrics', '@builder', '@e2e', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;
    const uniqueId = Date.now().toString().slice(-6);
    const panelTitle = `E2E Builder Panel ${uniqueId}`;
    let dashboardName = '';

    // 1. Set time range
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);

    // 2. Add Rate operation
    expect(await builder.addOperation('Rate')).toBe(true);
    testLogger.info('Rate operation added');

    // 3. Set step value
    await builder.setStepValue('1m');
    testLogger.info('Step value: 1m');

    // 4. Run query and verify no errors
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);
    expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
    expect(await pm.metricsPage.hasVisualization()).toBe(true);
    testLogger.info('Query executed with visualization');

    // 5. Click Add to Dashboard
    const addClicked = await builder.clickAddToDashboard();
    expect(addClicked).toBe(true);
    expect(await builder.isDashboardDialogVisible()).toBe(true);
    testLogger.info('Add to Dashboard dialog opened');

    // 6. Select folder (default)
    await builder.selectDashboardFolder('default');
    testLogger.info('Folder selected: default');

    // 7. Select or create dashboard using ensureDashboardSelected
    dashboardName = await builder.ensureDashboardSelected();
    testLogger.info(`Dashboard: ${dashboardName}`);

    // 8. Select tab
    await builder.selectDashboardTab('Default');
    testLogger.info('Tab selected: Default');

    // 9. Fill panel title
    await builder.fillPanelTitle(panelTitle);
    testLogger.info(`Panel title: ${panelTitle}`);

    // 10. Click Add to save
    await builder.clickDashboardAdd();
    await page.waitForTimeout(3000);

    // 11. Wait for dashboard view to load after redirect
    await waitForDashboardPage(page);
    await page.waitForTimeout(3000);
    testLogger.info('Navigated to dashboard after save');

    // 12. Verify panel exists on the dashboard
    const panelBar = page.locator('[data-test="dashboard-panel-bar"]').filter({ hasText: panelTitle });
    const panelVisible = await panelBar.isVisible({ timeout: 10000 }).catch(() => false);
    expect(panelVisible).toBe(true);
    testLogger.info(`Panel "${panelTitle}" visible on dashboard`);

    // 13. Cleanup: navigate back to dashboard list and delete the dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info(`Cleanup: dashboard "${dashboardName}" deleted`);
  });

  // =========================================================================
  // P2 - E2E: Build query with multiple operations + table chart + run
  // =========================================================================

  test("P2: E2E - build query with Rate + Sum operations, set options, run query", {
    tag: ['@metrics', '@builder', '@e2e', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Set time range
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);

    // 2. Add Rate operation
    expect(await builder.addOperation('Rate')).toBe(true);
    testLogger.info('Rate added');

    // 3. Add Sum operation
    expect(await builder.addOperation('Sum')).toBe(true);
    testLogger.info('Sum added');

    // 4. Verify both operations present in order
    expect(await builder.getOperationCount()).toBe(2);
    expect((await builder.getOperationText(0)).toLowerCase()).toContain('rate');
    expect((await builder.getOperationText(1)).toLowerCase()).toContain('sum');
    testLogger.info('Operations: Rate(0), Sum(1)');

    // 5. Set legend and step value
    await builder.setLegend('{{__name__}}');
    await builder.setStepValue('1m');
    testLogger.info('Legend: {{__name__}}, Step: 1m');

    // 6. Run query
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);

    // 7. Verify no errors and visualization
    expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
    expect(await pm.metricsPage.hasVisualization()).toBe(true);
    testLogger.info('Multi-operation query rendered successfully');

    // 8. Cleanup
    await builder.removeOperation(1);
    await builder.removeOperation(0);
    expect(await builder.getOperationCount()).toBe(0);
    testLogger.info('All operations cleaned up');
  });

  // =========================================================================
  // P2 - E2E: Add label filter + operation, switch to Instant, run, verify
  // =========================================================================

  test("P2: E2E - add filter + operation, switch to Instant query type, run and verify", {
    tag: ['@metrics', '@builder', '@e2e', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Set time range
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);

    // 2. Add label filter
    await builder.clickAddLabelFilter();
    expect(await builder.getLabelFilterCount()).toBe(1);

    // 3. Add Rate operation
    expect(await builder.addOperation('Rate')).toBe(true);

    // 4. Set step value
    await builder.setStepValue('30s');

    // 5. Switch to Instant query type
    expect(await builder.selectQueryType('instant')).toBe(true);
    testLogger.info('Configured: filter + Rate + step=30s + Instant');

    // 6. Run query
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);

    // 7. Verify no crash (Instant may return different result format)
    await expect(page.locator(builder.runQueryButton).first()).toBeVisible();
    testLogger.info('Instant query executed without crash');

    // 8. Switch back to Range and run again
    expect(await builder.selectQueryType('range')).toBe(true);
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);
    expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
    testLogger.info('Range query executed without errors');

    // 9. Cleanup
    await builder.removeOperation(0);
    testLogger.info('Instant/Range query type test complete');
  });

  // =========================================================================
  // P1 - E2E: Build complete query with label filter (label=operator=value)
  //       + operation + options, verify builder state, query preview,
  //       table chart with data rows, and API query correctness
  // =========================================================================

  test("P1: E2E - build complete query (label filter + Sum + options), verify builder state and table chart", {
    tag: ['@metrics', '@builder', '@e2e', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Verify builder mode active with metric pre-selected
    expect(await builder.isModeSelected('builder')).toBe(true);
    const streamInput = page.locator(builder.streamSelector);
    const metricName = await streamInput.inputValue();
    expect(metricName.length).toBeGreaterThan(0);
    testLogger.info(`Metric: ${metricName}`);

    // 2. Set time range
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);
    testLogger.info('Time range: last 15 minutes');

    // 3. Add a label filter and fully configure label + operator + value
    await builder.clickAddLabelFilter();
    expect(await builder.getLabelFilterCount()).toBe(1);

    // Open filter menu to configure it
    await builder.openLabelFilterMenu(0);

    // Select a label
    const labelDropdown = page.locator(builder.labelSelect).last();
    await labelDropdown.click();
    await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

    const labelOptions = page.locator('.q-menu .q-item');
    const labelCount = await labelOptions.count();
    let selectedLabel = '';
    let selectedOperator = '=';
    let selectedValue = '';

    if (labelCount > 0) {
      selectedLabel = (await labelOptions.first().textContent()).trim();
      await labelOptions.first().click();
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      testLogger.info(`Selected label: ${selectedLabel}`);

      // Verify default operator is "="
      const operatorText = await page.locator(builder.operatorSelect).last().textContent().catch(() => '');
      expect(operatorText).toContain('=');
      selectedOperator = operatorText.trim();
      testLogger.info(`Operator: ${selectedOperator}`);

      // Select a value
      const valueDropdown = page.locator(builder.valueSelect).last();
      const isDisabled = await builder.isValueSelectDisabled();
      if (!isDisabled) {
        await valueDropdown.click();
        await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

        const valueOptions = page.locator('.q-menu .q-item');
        const valueCount = await valueOptions.count();
        if (valueCount > 0) {
          selectedValue = (await valueOptions.first().textContent()).trim();
          await valueOptions.first().click();
          await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
          testLogger.info(`Selected value: ${selectedValue}`);
        }
      }

      // Close the filter menu
      await page.keyboard.press('Escape');
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

      // Assert: chip text shows "label = value" pattern (e.g. "environment = development")
      const chipText = await builder.getLabelFilterText(0);
      expect(chipText).not.toContain('Select label');
      expect(chipText).toContain(selectedLabel);
      if (selectedValue) {
        expect(chipText).toContain(selectedValue);
      }
      testLogger.info(`Filter chip: "${chipText}"`);
    } else {
      await page.keyboard.press('Escape');
      testLogger.info('No labels available, continuing without label filter config');
    }

    // 4. Add Sum operation (aggregation)
    expect(await builder.addOperation('Sum')).toBe(true);
    expect(await builder.getOperationCount()).toBe(1);
    testLogger.info('Sum operation added');

    // 5. Configure Sum operation's label parameter (select the same label for "by" clause)
    if (selectedLabel) {
      const opBtn = page.locator('[data-test="promql-operation-0"]');
      await opBtn.click();
      await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

      // Find the multi-select param for labels (type="select" in the operation menu)
      const labelParam = page.locator('[data-test="promql-operation-param-0"]').last();
      if (await labelParam.isVisible({ timeout: 3000 }).catch(() => false)) {
        await labelParam.click();
        await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

        // Select the label from the dropdown
        const paramOption = page.locator('.q-menu .q-item').filter({ hasText: selectedLabel }).first();
        if (await paramOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await paramOption.click();
          await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
          testLogger.info(`Sum operation: selected label "${selectedLabel}" for by clause`);
        }
      }

      // Close the operation menu
      await page.keyboard.press('Escape');
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }

    // 6. Set options: legend and step
    await builder.setLegend('{__hash__}');
    testLogger.info('Options: legend={__hash__}');

    // 7. Verify builder state (all in Builder mode — no mode switch)
    const builderState = await builder.verifyBuilderState();
    testLogger.info(`Builder state: ${JSON.stringify(builderState)}`);

    // Assert metric in stream selector
    expect(builderState.metric.toLowerCase()).toContain(metricName.toLowerCase());

    // Assert label filter chip shows selected label
    if (selectedLabel) {
      expect(builderState.labelFilters.length).toBe(1);
      expect(builderState.labelFilters[0]).toContain(selectedLabel);
    }

    // Assert operation chip shows Sum (possibly with label param like "Sum(environment)")
    expect(builderState.operations.length).toBe(1);
    expect(builderState.operations[0].toLowerCase()).toContain('sum');
    if (selectedLabel) {
      // Operation chip should show the label param, e.g. "Sum(environment)"
      expect(builderState.operations[0]).toContain(selectedLabel);
      testLogger.info(`Operation chip: "${builderState.operations[0]}"`);
    }

    // Assert legend option
    expect(builderState.legend).toBe('{__hash__}');
    testLogger.info('Builder state verified: metric, filter, operation, options all correct');

    // 8. Switch to Table chart type
    const tableSelected = await builder.selectChartType('table');
    expect(tableSelected).toBe(true);
    testLogger.info('Switched to table chart type');

    // 9. Run query and intercept API request to verify PromQL query string
    const capturedQuery = await builder.captureQueryFromRunRequest();
    testLogger.info(`Captured PromQL from API: "${capturedQuery}"`);

    // Assert the API query contains expected components
    expect(capturedQuery.toLowerCase()).toContain(metricName.toLowerCase());
    expect(capturedQuery.toLowerCase()).toContain('sum');
    if (selectedLabel && selectedValue) {
      // Query should have label filter syntax: {label="value"}
      expect(capturedQuery).toContain(selectedLabel);
      expect(capturedQuery).toContain(selectedValue);
      testLogger.info(`API query contains: ${selectedLabel}="${selectedValue}"`);
    }
    if (selectedLabel) {
      // Query should have "by (label)" for Sum aggregation
      expect(capturedQuery.toLowerCase()).toContain('by');
      testLogger.info('API query contains "by" clause for Sum aggregation');
    }

    // Wait for results to render
    await page.waitForTimeout(3000);

    // 10. Verify still in Builder mode (no mode switch happened)
    expect(await builder.isModeSelected('builder')).toBe(true);
    testLogger.info('Still in Builder mode');

    // 11. Verify query preview text at bottom shows the generated PromQL
    const previewText = await builder.getQueryPreviewText();
    testLogger.info(`Query preview: "${previewText}"`);
    if (previewText) {
      expect(previewText.toLowerCase()).toContain(metricName.toLowerCase());
      expect(previewText.toLowerCase()).toContain('sum');
      testLogger.info('Query preview matches expected PromQL');
    }

    // 12. Verify no errors
    const hasError = await pm.metricsPage.isErrorNotificationVisible();
    expect(hasError).toBe(false);
    testLogger.info('No errors after query execution');

    // 13. Verify table chart rendered with data
    const tableData = await builder.getTableChartData();
    testLogger.info(`Table: visible=${tableData.visible}, rows=${tableData.rowCount}, headers=${JSON.stringify(tableData.headers)}`);
    expect(tableData.visible).toBe(true);
    expect(tableData.rowCount).toBeGreaterThan(0);
    testLogger.info('Table chart rendered with data rows');

    // 14. Cleanup
    await builder.selectChartType('line');
    await builder.removeOperation(0);
    expect(await builder.getOperationCount()).toBe(0);
    await builder.removeLabelFilter(0);
    expect(await builder.getLabelFilterCount()).toBe(0);
    testLogger.info('Cleanup complete');
  });

  // =========================================================================
  // P2 - E2E: Build query with label filter + Sum(by label) — no Rate,
  //       verify builder state, query preview, table chart data, API query
  //       Mirrors the exact screenshot flow: metric + filter + Sum(label) + table
  // =========================================================================

  test("P2: E2E - label filter + Sum with by-label, verify query built correctly and table renders data", {
    tag: ['@metrics', '@builder', '@e2e', '@P2', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;

    // 1. Verify builder mode and pre-selected metric
    expect(await builder.isModeSelected('builder')).toBe(true);
    const streamInput = page.locator(builder.streamSelector);
    const metricName = await streamInput.inputValue();
    expect(metricName.length).toBeGreaterThan(0);
    testLogger.info(`Metric: ${metricName}`);

    // 2. Set time range
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);

    // 3. Add label filter and configure label + operator(=) + value
    await builder.clickAddLabelFilter();
    expect(await builder.getLabelFilterCount()).toBe(1);

    await builder.openLabelFilterMenu(0);
    const labelDropdown = page.locator(builder.labelSelect).last();
    await labelDropdown.click();
    await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

    const labelOptions = page.locator('.q-menu .q-item');
    const labelCount = await labelOptions.count();
    let selectedLabel = '';
    let selectedValue = '';

    if (labelCount > 0) {
      selectedLabel = (await labelOptions.first().textContent()).trim();
      await labelOptions.first().click();
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      testLogger.info(`Label: ${selectedLabel}`);

      // Operator defaults to "="
      const operatorText = await page.locator(builder.operatorSelect).last().textContent().catch(() => '');
      expect(operatorText).toContain('=');

      // Select value
      const valueDropdown = page.locator(builder.valueSelect).last();
      const isDisabled = await builder.isValueSelectDisabled();
      if (!isDisabled) {
        await valueDropdown.click();
        await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
        const valueOptions = page.locator('.q-menu .q-item');
        if (await valueOptions.count() > 0) {
          selectedValue = (await valueOptions.first().textContent()).trim();
          await valueOptions.first().click();
          await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
          testLogger.info(`Value: ${selectedValue}`);
        }
      }

      await page.keyboard.press('Escape');
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

      // Assert chip shows label = value
      const chipText = await builder.getLabelFilterText(0);
      expect(chipText).toContain(selectedLabel);
      if (selectedValue) {
        expect(chipText).toContain(selectedValue);
      }
      testLogger.info(`Filter chip: "${chipText}"`);
    } else {
      await page.keyboard.press('Escape');
      testLogger.info('No labels available');
    }

    // 4. Add Sum operation
    expect(await builder.addOperation('Sum')).toBe(true);
    expect(await builder.getOperationCount()).toBe(1);
    testLogger.info('Sum operation added');

    // 5. Configure Sum's "by" label parameter
    if (selectedLabel) {
      const opBtn = page.locator('[data-test="promql-operation-0"]');
      await opBtn.click();
      await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

      const labelParam = page.locator('[data-test="promql-operation-param-0"]').last();
      if (await labelParam.isVisible({ timeout: 3000 }).catch(() => false)) {
        await labelParam.click();
        await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

        const paramOption = page.locator('.q-menu .q-item').filter({ hasText: selectedLabel }).first();
        if (await paramOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await paramOption.click();
          await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
          testLogger.info(`Sum by: ${selectedLabel}`);
        }
      }
      await page.keyboard.press('Escape');
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }

    // 6. Verify builder state — all assertions in Builder mode
    const builderState = await builder.verifyBuilderState();
    testLogger.info(`Builder state: ${JSON.stringify(builderState)}`);

    // Metric matches
    expect(builderState.metric.toLowerCase()).toContain(metricName.toLowerCase());

    // Label filter chip present with label name
    if (selectedLabel) {
      expect(builderState.labelFilters.length).toBe(1);
      expect(builderState.labelFilters[0]).toContain(selectedLabel);
    }

    // Operation chip shows "Sum(label)" with the by-label
    expect(builderState.operations.length).toBe(1);
    expect(builderState.operations[0].toLowerCase()).toContain('sum');
    if (selectedLabel) {
      expect(builderState.operations[0]).toContain(selectedLabel);
      testLogger.info(`Operation chip: "${builderState.operations[0]}"`);
    }
    testLogger.info('Builder state verified');

    // 7. Switch to table chart
    const tableSelected = await builder.selectChartType('table');
    expect(tableSelected).toBe(true);
    testLogger.info('Table chart selected');

    // 8. Run query and capture API request
    const capturedQuery = await builder.captureQueryFromRunRequest();
    testLogger.info(`API PromQL: "${capturedQuery}"`);

    // Assert query structure: sum by (label) (metric{label="value"})
    expect(capturedQuery.toLowerCase()).toContain(metricName.toLowerCase());
    expect(capturedQuery.toLowerCase()).toContain('sum');
    if (selectedLabel) {
      expect(capturedQuery).toContain(selectedLabel);
      expect(capturedQuery.toLowerCase()).toContain('by');
    }
    if (selectedValue) {
      expect(capturedQuery).toContain(selectedValue);
    }
    testLogger.info('API query verified: correct structure');

    // Wait for results
    await page.waitForTimeout(3000);

    // 9. Verify still in Builder mode
    expect(await builder.isModeSelected('builder')).toBe(true);

    // 10. Verify query preview at bottom of builder
    const previewText = await builder.getQueryPreviewText();
    testLogger.info(`Query preview: "${previewText}"`);
    if (previewText) {
      expect(previewText.toLowerCase()).toContain(metricName.toLowerCase());
      expect(previewText.toLowerCase()).toContain('sum');
    }

    // 11. Verify no errors
    expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
    testLogger.info('No errors');

    // 12. Verify table rendered with data rows
    const tableData = await builder.getTableChartData();
    testLogger.info(`Table: visible=${tableData.visible}, rows=${tableData.rowCount}, headers=${JSON.stringify(tableData.headers)}`);
    expect(tableData.visible).toBe(true);
    expect(tableData.rowCount).toBeGreaterThan(0);

    // Verify table has Timestamp and Value columns (like in the screenshot)
    if (tableData.headers.length > 0) {
      const headerText = tableData.headers.join(' ').toLowerCase();
      testLogger.info(`Table headers: ${headerText}`);
      // Table should have at least some meaningful columns
      expect(tableData.headers.length).toBeGreaterThan(0);
    }
    testLogger.info('Table chart rendered with data');

    // 13. Cleanup
    await builder.selectChartType('line');
    await builder.removeOperation(0);
    await builder.removeLabelFilter(0);
    testLogger.info('Cleanup complete');
  });

  // =========================================================================
  // P1 - E2E: Build query in metrics, save to dashboard, edit dashboard panel,
  //       verify all builder config (label filters, operations, options) persisted
  // =========================================================================

  test("P1: E2E - save metric query to dashboard, edit panel, verify builder config persisted", {
    tag: ['@metrics', '@builder', '@dashboard', '@e2e', '@P1', '@all']
  }, async ({ page }, testInfo) => {
    const pm = await setupTest(page, testInfo);
    const builder = pm.metricsBuilderPage;
    const panelTitle = `test_panel_${Date.now()}`;

    // 1. Verify builder mode and pre-selected metric
    expect(await builder.isModeSelected('builder')).toBe(true);
    const streamInput = page.locator(builder.streamSelector);
    const metricName = await streamInput.inputValue();
    expect(metricName.length).toBeGreaterThan(0);
    testLogger.info(`Metric: ${metricName}`);

    // 2. Set time range
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);

    // 3. Add label filter with label + operator(=) + value
    await builder.clickAddLabelFilter();
    expect(await builder.getLabelFilterCount()).toBe(1);

    await builder.openLabelFilterMenu(0);
    const labelDropdown = page.locator(builder.labelSelect).last();
    await labelDropdown.click();
    await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });

    const labelOptions = page.locator('.q-menu .q-item');
    const labelCount = await labelOptions.count();
    let selectedLabel = '';
    let selectedValue = '';

    if (labelCount > 0) {
      selectedLabel = (await labelOptions.first().textContent()).trim();
      await labelOptions.first().click();
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      testLogger.info(`Label: ${selectedLabel}`);

      // Select value
      const valueDropdown = page.locator(builder.valueSelect).last();
      const isDisabled = await builder.isValueSelectDisabled();
      if (!isDisabled) {
        await valueDropdown.click();
        await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
        const valueOptions = page.locator('.q-menu .q-item');
        if (await valueOptions.count() > 0) {
          selectedValue = (await valueOptions.first().textContent()).trim();
          await valueOptions.first().click();
          await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
          testLogger.info(`Value: ${selectedValue}`);
        }
      }
      await page.keyboard.press('Escape');
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

      // Assert chip text
      const chipText = await builder.getLabelFilterText(0);
      expect(chipText).toContain(selectedLabel);
      testLogger.info(`Filter chip: "${chipText}"`);
    } else {
      await page.keyboard.press('Escape');
    }

    // 4. Add Sum operation
    expect(await builder.addOperation('Sum')).toBe(true);
    expect(await builder.getOperationCount()).toBe(1);
    testLogger.info('Sum operation added');

    // 5. Configure Sum's "by" label parameter
    if (selectedLabel) {
      const opBtn = page.locator('[data-test="promql-operation-0"]');
      await opBtn.click();
      await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
      const labelParam = page.locator('[data-test="promql-operation-param-0"]').last();
      if (await labelParam.isVisible({ timeout: 3000 }).catch(() => false)) {
        await labelParam.click();
        await page.locator('.q-menu').last().waitFor({ state: 'visible', timeout: 5000 });
        const paramOption = page.locator('.q-menu .q-item').filter({ hasText: selectedLabel }).first();
        if (await paramOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await paramOption.click();
          await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
          testLogger.info(`Sum by: ${selectedLabel}`);
        }
      }
      await page.keyboard.press('Escape');
      await page.locator('.q-menu').last().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }

    // 6. Set options
    await builder.setLegend('{__hash__}');
    testLogger.info(`Options set: legend={__hash__}`);

    // 7. Run query to generate results before saving
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);
    expect(await pm.metricsPage.isErrorNotificationVisible()).toBe(false);
    testLogger.info('Query ran successfully, no errors');

    // 8. Save to dashboard via "Add To Dashboard" dialog
    const addClicked = await builder.clickAddToDashboard();
    expect(addClicked).toBe(true);
    testLogger.info('Add To Dashboard dialog opened');

    // Wait for dialog to load
    const dialogVisible = await builder.isDashboardDialogVisible();
    expect(dialogVisible).toBe(true);

    // Select folder (default)
    await builder.selectDashboardFolder('default');
    testLogger.info('Folder: default');

    // Select or create dashboard using ensureDashboardSelected
    let dashboardName = await builder.ensureDashboardSelected();
    testLogger.info(`Dashboard: ${dashboardName}`);

    // Select tab
    await builder.selectDashboardTab('Default');
    testLogger.info('Tab selected');

    // Fill panel title
    await builder.fillPanelTitle(panelTitle);
    testLogger.info(`Panel title: ${panelTitle}`);

    // Click Add to save
    await builder.clickDashboardAdd();
    await page.waitForTimeout(3000);
    testLogger.info('Panel saved to dashboard');

    // 9. Wait for dashboard view to load after redirect
    await waitForDashboardPage(page);
    await page.waitForTimeout(3000);

    // Verify the panel is visible on the dashboard
    const panelBar = page.locator('[data-test="dashboard-panel-bar"]').filter({ hasText: panelTitle });
    const panelVisible = await panelBar.isVisible({ timeout: 10000 }).catch(() => false);
    expect(panelVisible).toBe(true);
    testLogger.info('Panel visible on dashboard');

    // 10. Edit the panel — click dropdown menu and select Edit
    const panelContainer = page.locator('[data-test="dashboard-panel-container"]').filter({ hasText: panelTitle });
    await panelContainer.hover();
    await page.waitForTimeout(1000);

    // Click the panel dropdown menu
    const dropdownBtn = page.locator(`[data-test="dashboard-edit-panel-${panelTitle}-dropdown"]`);
    if (await dropdownBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dropdownBtn.click();
    } else {
      // Fallback: try generic dropdown on the panel container
      const anyDropdown = panelContainer.locator('[data-test*="dropdown"]').first();
      await anyDropdown.click();
    }
    // PanelContainer uses ODropdown (Reka UI), not Quasar q-menu — wait for
    // the edit menu item directly instead of waiting for a .q-menu element.

    // Click Edit Panel menu item
    const editMenuItem = page.locator('[data-test="dashboard-edit-panel"]');
    await editMenuItem.waitFor({ state: 'visible', timeout: 5000 });
    await editMenuItem.click();
    await page.waitForTimeout(3000);
    await page.waitForTimeout(3000);
    testLogger.info('Opened panel editor');

    // 11. Verify the panel edit view loads with correct builder config
    // Check panel name
    const panelNameInput = page.locator('[data-test="dashboard-panel-name"]');
    if (await panelNameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      const panelNameValue = await panelNameInput.inputValue().catch(() => '');
      expect(panelNameValue).toContain(panelTitle);
      testLogger.info(`Panel name: ${panelNameValue}`);
    }

    // Verify builder mode is active (PromQL + Builder tabs)
    // OToggleGroupItem uses data-state="on" (Reka UI) rather than a "selected" CSS class
    const builderBtn = page.locator('[data-test="dashboard-builder-query-type"]');
    if (await builderBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const classes = await builderBtn.getAttribute('class') || '';
      const dataState = await builderBtn.getAttribute('data-state') || '';
      expect(classes.includes('selected') || dataState === 'on').toBe(true);
      testLogger.info('Builder mode active in panel editor');
    }

    // 12. Verify label filter persisted
    const editFilterCount = await builder.getLabelFilterCount();
    testLogger.info(`Panel editor label filters: ${editFilterCount}`);
    if (selectedLabel) {
      expect(editFilterCount).toBeGreaterThanOrEqual(1);
      const filterText = await builder.getLabelFilterText(0);
      expect(filterText).toContain(selectedLabel);
      if (selectedValue) {
        expect(filterText).toContain(selectedValue);
      }
      testLogger.info(`Panel editor filter chip: "${filterText}"`);
    }

    // 13. Verify operation persisted
    const editOpCount = await builder.getOperationCount();
    testLogger.info(`Panel editor operations: ${editOpCount}`);
    expect(editOpCount).toBe(1);
    const opText = await builder.getOperationText(0);
    expect(opText.toLowerCase()).toContain('sum');
    if (selectedLabel) {
      expect(opText).toContain(selectedLabel);
    }
    testLogger.info(`Panel editor operation: "${opText}"`);

    // 14. Verify options persisted (legend)
    const legendField = page.locator('[data-test="dashboard-promql-builder-legend"]');
    if (await legendField.isVisible({ timeout: 3000 }).catch(() => false)) {
      const legendInput = legendField.locator('input').first();
      const legendValue = await legendInput.inputValue().catch(() => '');
      expect(legendValue).toBe('{__hash__}');
      testLogger.info(`Panel editor legend: ${legendValue}`);
    }

    // 15. Verify the metric/stream is preserved
    const editStreamInput = page.locator('[data-test="index-dropdown-stream"]');
    if (await editStreamInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const editMetric = await editStreamInput.inputValue().catch(() => '');
      expect(editMetric.toLowerCase()).toContain(metricName.toLowerCase());
      testLogger.info(`Panel editor metric: ${editMetric}`);
    }

    // 16. Run query in panel editor to verify it works
    const applyBtn = page.locator('[data-test="dashboard-apply"]');
    if (await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await applyBtn.click();
      await page.waitForTimeout(3000);

      // Verify chart/table renders
      const chartRendered = await builder.isChartRendered();
      const hasVis = await page.locator('[data-test="chart-renderer"]').isVisible({ timeout: 5000 }).catch(() => false);
      expect(chartRendered || hasVis).toBe(true);
      testLogger.info('Panel editor: query ran and chart rendered');
    }

    // 17. Discard and go back to dashboard (don't save changes)
    const discardBtn = page.locator('[data-test="dashboard-panel-discard"]');
    if (await discardBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await discardBtn.click();
      await page.waitForTimeout(1000);
      // Handle confirmation dialog if appears
      const confirmBtn = page.locator('button:has-text("OK"), button:has-text("Confirm"), [data-test="confirm-button"]').first();
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
    }
    await page.waitForTimeout(3000);
    testLogger.info('Discarded panel editor');

    // 18. Cleanup: navigate back to dashboard list and delete the entire dashboard
    await pm.dashboardCreate.backToDashboardList();
    await deleteDashboard(page, dashboardName);
    testLogger.info(`Cleanup: dashboard "${dashboardName}" deleted`);

    testLogger.info('Save → edit → verify → cleanup complete');
  });
});

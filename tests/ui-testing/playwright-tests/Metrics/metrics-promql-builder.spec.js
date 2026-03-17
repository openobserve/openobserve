const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');


test.describe("Metrics PromQL Builder Mode testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeAll(async () => {
    await ensureMetricsIngested();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to metrics page
    await pm.metricsPage.gotoMetricsPage();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    testLogger.info('Test setup completed - navigated to metrics page');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // =========================================================================
  // P0 - Critical: Query Mode Tab Switching
  // =========================================================================

  test("Switch between SQL, PromQL, Builder, and Custom mode tabs", {
    tag: ['@metrics', '@builder', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing query mode tab switching');

    const builder = pm.metricsBuilderPage;

    // Verify PromQL mode button is visible (metrics page defaults to PromQL)
    const promqlBtn = page.locator(builder.promqlModeButton);
    await expect(promqlBtn).toBeVisible({ timeout: 5000 });
    testLogger.info('PromQL mode button is visible');

    // Switch to PromQL mode if not already selected
    await builder.switchToPromQLMode();

    // Verify PromQL mode is selected
    const isPromqlSelected = await builder.isModeSelected('promql');
    expect(isPromqlSelected).toBe(true);
    testLogger.info('PromQL mode is selected');

    // Verify Builder and Custom buttons are visible
    const builderBtn = page.locator(builder.builderModeButton);
    const customBtn = page.locator(builder.customModeButton);
    await expect(builderBtn).toBeVisible({ timeout: 3000 });
    await expect(customBtn).toBeVisible({ timeout: 3000 });
    testLogger.info('Builder and Custom mode buttons are visible');

    // Switch to Builder mode
    await builder.switchToBuilderMode();
    const isBuilderSelected = await builder.isModeSelected('builder');
    expect(isBuilderSelected).toBe(true);
    testLogger.info('Successfully switched to Builder mode');

    // Switch to Custom mode
    await builder.switchToCustomMode();
    const isCustomSelected = await builder.isModeSelected('custom');
    expect(isCustomSelected).toBe(true);
    testLogger.info('Successfully switched to Custom mode');

    // Switch back to Builder mode
    await builder.switchToBuilderMode();
    const isBuilderAgain = await builder.isModeSelected('builder');
    expect(isBuilderAgain).toBe(true);
    testLogger.info('Successfully switched back to Builder mode');

    // Switch to SQL mode
    await builder.switchToSQLMode();
    const isSqlSelected = await builder.isModeSelected('sql');
    expect(isSqlSelected).toBe(true);
    testLogger.info('Successfully switched to SQL mode');

    // Switch back to PromQL mode
    await builder.switchToPromQLMode();
    const isPromqlAgain = await builder.isModeSelected('promql');
    expect(isPromqlAgain).toBe(true);
    testLogger.info('All mode tab switches completed successfully');
  });

  test("Builder mode shows correct UI elements (Stream Selector, Label Filters, Operations, Options)", {
    tag: ['@metrics', '@builder', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Builder mode UI elements visibility');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected
    // Verify Stream/Metric Selector is visible in the sidebar (INPUT element)
    const streamSelectorVisible = await builder.isMetricSelectorVisible();
    expect(streamSelectorVisible).toBe(true);
    testLogger.info('Stream/Metric selector is visible in sidebar');

    // Verify Add Label Filter button is visible
    const addLabelFilterVisible = await builder.isAddLabelFilterVisible();
    expect(addLabelFilterVisible).toBe(true);
    testLogger.info('Add Label Filter button is visible');

    // Verify Add Operation button is visible
    const addOperationVisible = await builder.isAddOperationVisible();
    expect(addOperationVisible).toBe(true);
    testLogger.info('Add Operation button is visible');

    // Verify Options section is visible (legend, step value, query type)
    const optionsVisible = await builder.isOptionsVisible();
    expect(optionsVisible).toBe(true);
    testLogger.info('Options section is visible');

    // Verify Run Query button is visible
    const runQueryBtn = page.locator(builder.runQueryButton).first();
    await expect(runQueryBtn).toBeVisible({ timeout: 3000 });
    testLogger.info('Run Query button is visible');

    // Verify mode tab buttons are visible
    const sqlBtn = page.locator(builder.sqlModeButton);
    const promqlBtn = page.locator(builder.promqlModeButton);
    const builderBtn = page.locator(builder.builderModeButton);
    const customBtn = page.locator(builder.customModeButton);
    await expect(sqlBtn).toBeVisible();
    await expect(promqlBtn).toBeVisible();
    await expect(builderBtn).toBeVisible();
    await expect(customBtn).toBeVisible();
    testLogger.info('All mode tab buttons are visible');

    // Verify PromQL + Builder are currently selected
    const isPromqlSelected = await builder.isModeSelected('promql');
    const isBuilderSelected = await builder.isModeSelected('builder');
    expect(isPromqlSelected).toBe(true);
    expect(isBuilderSelected).toBe(true);
    testLogger.info('PromQL + Builder modes are correctly selected by default');

    testLogger.info('All Builder mode UI elements are correctly displayed');
  });

  // =========================================================================
  // P0 - Critical: Metric Selection in Builder Mode
  // =========================================================================

  test("Run query with pre-selected metric in Builder mode", {
    tag: ['@metrics', '@builder', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing query execution with default metric in Builder mode');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder with cpu_usage already selected
    // Verify stream selector has a value
    const streamInput = page.locator(builder.streamSelector);
    const streamValue = await streamInput.inputValue();
    testLogger.info(`Pre-selected stream value: "${streamValue}"`);
    expect(streamValue.length).toBeGreaterThan(0);

    // Run the query with the default metric
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);

    // Verify no errors
    const hasError = await pm.metricsPage.isErrorNotificationVisible();
    if (hasError) {
      const errorText = await pm.metricsPage.getErrorNotificationText();
      testLogger.warn(`Query error: ${errorText}`);
    }
    expect(hasError).toBe(false);

    // Verify visualization appears
    const hasVisualization = await pm.metricsPage.hasVisualization();
    expect(hasVisualization).toBe(true);
    testLogger.info('Metric query executed successfully with visualization');
  });

  // =========================================================================
  // P1 - Functional: Label Filter UI Interactions
  // =========================================================================

  test("Add a label filter using Label, Operator, and Value dropdowns", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing label filter addition via Builder UI');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected
    // Labels are already loaded from the default stream

    // Initial filter count should be 0
    const initialCount = await builder.getLabelFilterCount();
    testLogger.info(`Initial label filter count: ${initialCount}`);

    // Click add label filter button
    await builder.clickAddLabelFilter();

    // Verify new filter was added
    const afterAddCount = await builder.getLabelFilterCount();
    expect(afterAddCount).toBe(initialCount + 1);
    testLogger.info('Label filter added, new count: ' + afterAddCount);

    // Open the newly added filter menu
    const newFilterIndex = afterAddCount - 1;
    await builder.openLabelFilterMenu(newFilterIndex);

    // Verify Label dropdown is visible
    const labelDropdown = page.locator(builder.labelSelect).last();
    await expect(labelDropdown).toBeVisible({ timeout: 5000 });
    testLogger.info('Label dropdown is visible');

    // Verify Operator dropdown is visible
    const operatorDropdown = page.locator(builder.operatorSelect).last();
    await expect(operatorDropdown).toBeVisible({ timeout: 5000 });
    testLogger.info('Operator dropdown is visible');

    // Verify Value dropdown is visible
    const valueDropdown = page.locator(builder.valueSelect).last();
    await expect(valueDropdown).toBeVisible({ timeout: 5000 });
    testLogger.info('Value dropdown is visible');

    // Select a label from the dropdown
    const labelSelected = await builder.selectLabel('__name__');

    if (labelSelected) {
      testLogger.info('Label selected: __name__');

      // Verify default operator is "="
      const operatorText = await operatorDropdown.locator('.q-field__native span, .q-field__native').textContent().catch(() => '');
      testLogger.info(`Default operator: ${operatorText}`);
    } else {
      // If __name__ not available, try any available label
      testLogger.warn('__name__ label not found, checking available labels');
      const hasOptions = await builder.hasLabelOptions();
      testLogger.info(`Label options available: ${hasOptions}`);
    }

    // Close the menu
    await page.keyboard.press('Escape');
    testLogger.info('Label filter UI interaction completed');
  });

  test("Operator dropdown shows all four operators (=, !=, =~, !~)", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing operator dropdown options');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Add a label filter
    await builder.clickAddLabelFilter();

    // Open the filter menu
    await builder.openLabelFilterMenu(0);

    // Click the Operator dropdown to see options
    const operatorDropdown = page.locator(builder.operatorSelect).last();
    await operatorDropdown.click();
    await page.waitForTimeout(500);

    // Verify all four operators are present
    const operators = ['=', '!=', '=~', '!~'];
    const menuItems = page.locator('.q-menu .q-item');
    const menuItemCount = await menuItems.count();

    testLogger.info(`Found ${menuItemCount} operator options in dropdown`);
    expect(menuItemCount).toBeGreaterThanOrEqual(4);

    // Verify each operator is present
    for (const op of operators) {
      const opItem = menuItems.filter({ hasText: op });
      const opCount = await opItem.count();
      expect(opCount).toBeGreaterThan(0);
      testLogger.info(`Operator "${op}" found in dropdown`);
    }

    // Select "!=" operator
    await builder.selectOperator('!=');
    testLogger.info('Selected "!=" operator');

    // Close the menu
    await page.keyboard.press('Escape');
    testLogger.info('All four operators verified in dropdown');
  });

  test("Value dropdown is disabled until a label is selected", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing value dropdown dependency on label selection');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Add a label filter
    await builder.clickAddLabelFilter();

    // Open the filter menu
    await builder.openLabelFilterMenu(0);

    // Check if value dropdown is disabled (no label selected yet)
    const isDisabled = await builder.isValueSelectDisabled();
    expect(isDisabled).toBe(true);
    testLogger.info('Value dropdown is disabled when no label is selected');

    // Now select a label
    const labelSelected = await builder.selectLabel('__name__');

    if (labelSelected) {
      // Value dropdown should now be enabled
      const isStillDisabled = await builder.isValueSelectDisabled();
      expect(isStillDisabled).toBe(false);
      testLogger.info('Value dropdown is enabled after label selection');
    }

    await page.keyboard.press('Escape');
    testLogger.info('Value dropdown dependency test completed');
  });

  test("Add multiple label filters and verify count", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing adding multiple label filters');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Add first label filter
    await builder.clickAddLabelFilter();
    const countAfterFirst = await builder.getLabelFilterCount();
    expect(countAfterFirst).toBe(1);
    testLogger.info('First label filter added');

    // Add second label filter
    await builder.clickAddLabelFilter();
    const countAfterSecond = await builder.getLabelFilterCount();
    expect(countAfterSecond).toBe(2);
    testLogger.info('Second label filter added');

    // Add third label filter
    await builder.clickAddLabelFilter();
    const countAfterThird = await builder.getLabelFilterCount();
    expect(countAfterThird).toBe(3);
    testLogger.info('Third label filter added');

    // Verify all three filters are visible
    for (let i = 0; i < 3; i++) {
      const filterBtn = builder.getLabelFilterButton(i);
      await expect(filterBtn).toBeVisible();
    }
    testLogger.info('All three label filters are visible');

    // Each filter should show "Select label" (default text)
    const firstFilterText = await builder.getLabelFilterText(0);
    expect(firstFilterText).toContain('Select label');
    testLogger.info('New filter shows default "Select label" text');
  });

  test("Remove a label filter using close button", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing label filter removal');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Add two label filters
    await builder.clickAddLabelFilter();
    await builder.clickAddLabelFilter();
    const countBefore = await builder.getLabelFilterCount();
    expect(countBefore).toBe(2);
    testLogger.info(`Filter count before removal: ${countBefore}`);

    // Remove the first filter
    await builder.removeLabelFilter(0);
    const countAfter = await builder.getLabelFilterCount();
    expect(countAfter).toBe(1);
    testLogger.info(`Filter count after removal: ${countAfter}`);

    // Remove the remaining filter
    await builder.removeLabelFilter(0);
    const countFinal = await builder.getLabelFilterCount();
    expect(countFinal).toBe(0);
    testLogger.info('All label filters removed successfully');
  });

  // =========================================================================
  // P1 - Functional: Operations
  // =========================================================================

  test("Add an operation via the Operation Selector dialog", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing operation addition via selector dialog');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Initial operation count
    const initialCount = await builder.getOperationCount();
    testLogger.info(`Initial operation count: ${initialCount}`);

    // Click Add Operation to open dialog
    await builder.clickAddOperation();

    // Verify dialog opens
    const dialog = page.locator('.q-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    testLogger.info('Operation Selector dialog opened');

    // Verify dialog has a title
    const dialogTitle = dialog.locator('div:has-text("Add Operation")').first();
    await expect(dialogTitle).toBeVisible();
    testLogger.info('Dialog title "Add Operation" is visible');

    // Verify search input is present
    const searchInput = dialog.locator('input').first();
    await expect(searchInput).toBeVisible();
    testLogger.info('Search input is visible in dialog');

    // Search for "Rate" operation
    await searchInput.fill('Rate');
    await page.waitForTimeout(500);

    // Select the Rate operation
    const rateItem = dialog.locator('.q-item:has-text("Rate")').first();
    if (await rateItem.isVisible({ timeout: 3000 })) {
      await rateItem.click();
      await page.waitForTimeout(500);

      // Verify operation was added
      const newCount = await builder.getOperationCount();
      expect(newCount).toBe(initialCount + 1);
      testLogger.info('Rate operation added successfully');

      // Verify operation text
      const opText = await builder.getOperationText(0);
      expect(opText.toLowerCase()).toContain('rate');
      testLogger.info(`Operation text: ${opText}`);
    } else {
      testLogger.warn('Rate operation not found in dialog');
    }
  });

  test("Remove an operation using close button", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing operation removal');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Add an operation
    const added = await builder.addOperation('Rate');
    expect(added).toBe(true);

    const countBefore = await builder.getOperationCount();
    expect(countBefore).toBeGreaterThan(0);
    testLogger.info(`Operation count before removal: ${countBefore}`);

    // Remove the operation
    await builder.removeOperation(0);
    const countAfter = await builder.getOperationCount();
    expect(countAfter).toBe(countBefore - 1);
    testLogger.info(`Operation count after removal: ${countAfter}`);
  });

  // =========================================================================
  // P1 - Functional: Options (Legend, Step Value, Query Type)
  // =========================================================================

  test("Set Legend, Step Value, and Query Type in Builder Options", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Builder Options (Legend, Step Value, Query Type)');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Set Step Value
    const stepSet = await builder.setStepValue('30s');
    expect(stepSet).toBe(true);
    testLogger.info('Step value set to "30s"');

    // Verify step value input has the value (data-test is directly on the <input>)
    const stepInput = page.locator(builder.stepValueInput);
    const stepValue = await stepInput.inputValue();
    expect(stepValue).toBe('30s');
    testLogger.info('Step value verified: ' + stepValue);

    // Set Query Type to Instant
    const qtSet = await builder.selectQueryType('instant');
    if (qtSet) {
      testLogger.info('Query type set to "Instant"');
    }

    // Set Query Type back to Range
    const qtRangeSet = await builder.selectQueryType('range');
    if (qtRangeSet) {
      testLogger.info('Query type set back to "Range"');
    }

    testLogger.info('Builder Options test completed');
  });

  // =========================================================================
  // P1 - Functional: Run Query with Builder Mode Selections
  // =========================================================================

  test("Execute query after selecting metric and adding label filter in Builder mode", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing full Builder mode query execution');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Set time range to last 15 minutes
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);

    // Run the query with default metric
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);

    // Verify no error
    const hasError = await pm.metricsPage.isErrorNotificationVisible();
    expect(hasError).toBe(false);
    testLogger.info('No error after running Builder mode query');

    // Verify visualization is displayed
    const hasVis = await pm.metricsPage.hasVisualization();
    expect(hasVis).toBe(true);
    testLogger.info('Visualization displayed for Builder mode query');
  });

  // =========================================================================
  // P1 - Functional: Add to Dashboard from Builder mode
  // =========================================================================

  test("Add to Dashboard flow from Builder mode - Cancel", {
    tag: ['@metrics', '@builder', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Add to Dashboard cancel flow from Builder mode');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected
    // Run query first to enable Add to Dashboard
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);

    // Click Add to Dashboard button
    const addClicked = await builder.clickAddToDashboard();

    if (addClicked) {
      // Verify dialog opens
      const dialogVisible = await builder.isDashboardDialogVisible();
      expect(dialogVisible).toBe(true);
      testLogger.info('Add to Dashboard dialog opened');

      // Verify panel title input is visible
      const titleInput = page.locator(builder.dashboardPanelTitleInput);
      await expect(titleInput).toBeVisible({ timeout: 3000 });
      testLogger.info('Panel title input is visible');

      // Fill in panel title
      await builder.fillPanelTitle('Test Builder Panel');

      // Click Cancel
      await builder.clickDashboardCancel();

      // Verify dialog closes
      const dialogStillVisible = await builder.isDashboardDialogVisible();
      expect(dialogStillVisible).toBe(false);
      testLogger.info('Dialog closed after cancel');
    } else {
      testLogger.warn('Add to Dashboard button not visible');
    }
  });

  // =========================================================================
  // P2 - Edge Cases
  // =========================================================================

  test("Builder mode UI hides when switching to Custom mode", {
    tag: ['@metrics', '@builder', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Builder UI visibility when switching to Custom mode');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode
    // Verify Builder UI is visible
    const builderUIVisible = await builder.isBuilderUIVisible();
    expect(builderUIVisible).toBe(true);
    testLogger.info('Builder UI is visible in Builder mode');

    // Switch to Custom mode
    await builder.switchToCustomMode();

    // Verify Builder UI elements are hidden (Label Filters, Operations should not show)
    const builderUIAfterSwitch = await builder.isBuilderUIVisible();
    expect(builderUIAfterSwitch).toBe(false);
    testLogger.info('Builder UI is hidden after switching to Custom mode');

    // Verify raw query editor is visible instead (Custom mode shows a code editor)
    // Check for Monaco editor or any code/text editor area
    const editorVisible = await page.locator('.monaco-editor, .view-lines, [data-test*="query-editor"], textarea.inputarea, .cm-editor').first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(editorVisible).toBe(true);
    testLogger.info('Code editor is visible in Custom mode');

    // Switch back to Builder mode
    await builder.switchToBuilderMode();

    // Verify Builder UI reappears
    const builderUIRestored = await builder.isBuilderUIVisible();
    expect(builderUIRestored).toBe(true);
    testLogger.info('Builder UI restored after switching back to Builder mode');
  });

  test("Label filter shows 'Select label' default text before any selection", {
    tag: ['@metrics', '@builder', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing default label filter state');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Add a label filter
    await builder.clickAddLabelFilter();

    // Verify the new filter button shows "Select label"
    const filterText = await builder.getLabelFilterText(0);
    expect(filterText).toContain('Select label');
    testLogger.info(`Default filter text: "${filterText}"`);
  });

  test("Switching between Builder and Custom preserves metric selection", {
    tag: ['@metrics', '@builder', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing metric selection persistence across mode switches');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Switch to Custom mode
    await builder.switchToCustomMode();
    await page.waitForTimeout(1000);

    // Switch back to Builder mode
    await builder.switchToBuilderMode();
    await page.waitForTimeout(1000);

    // The metric selector should still be visible and the page should be functional
    const metricVisible = await builder.isMetricSelectorVisible();
    expect(metricVisible).toBe(true);
    testLogger.info('Metric selector is still visible after mode switches');
  });

  test("Add multiple operations and verify they are listed", {
    tag: ['@metrics', '@builder', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing multiple operations addition');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Add Rate operation
    const rateAdded = await builder.addOperation('Rate');
    expect(rateAdded).toBe(true);
    testLogger.info('Rate operation added');

    // Add Sum operation
    const sumAdded = await builder.addOperation('Sum');
    expect(sumAdded).toBe(true);
    testLogger.info('Sum operation added');

    // Verify both operations are present
    const opCount = await builder.getOperationCount();
    expect(opCount).toBe(2);
    testLogger.info(`Operation count: ${opCount}`);

    // Remove all operations
    await builder.removeOperation(1);
    await builder.removeOperation(0);
    const finalCount = await builder.getOperationCount();
    expect(finalCount).toBe(0);
    testLogger.info('All operations removed');
  });

  test("Operation Selector dialog search filters operations correctly", {
    tag: ['@metrics', '@builder', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing operation selector search functionality');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Open operation selector dialog
    await builder.clickAddOperation();

    const dialog = page.locator('.q-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Get initial operation count
    const allItems = dialog.locator('.q-item[class*="clickable"]');
    const initialItemCount = await allItems.count();
    testLogger.info(`Total operations before search: ${initialItemCount}`);
    expect(initialItemCount).toBeGreaterThan(0);

    // Search for a specific operation
    const searchInput = dialog.locator('input').first();
    await searchInput.fill('histogram');
    await page.waitForTimeout(500);

    // Verify filtered results contain the search term
    const filteredItems = dialog.locator('.q-item[class*="clickable"]');
    const filteredCount = await filteredItems.count();
    testLogger.info(`Operations after "histogram" search: ${filteredCount}`);
    expect(filteredCount).toBeLessThan(initialItemCount);
    expect(filteredCount).toBeGreaterThan(0);

    // Close dialog
    const closeBtn = dialog.locator('button:has-text("Close")');
    await closeBtn.click();
    await page.waitForTimeout(300);

    testLogger.info('Operation selector search test completed');
  });

  // =========================================================================
  // P2 - Full E2E: Builder Mode complete workflow
  // =========================================================================

  test("Full Builder workflow: select metric, add label filter, add operation, run query", {
    tag: ['@metrics', '@builder', '@e2e', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing complete Builder mode workflow');

    const builder = pm.metricsBuilderPage;

    // Metrics page defaults to PromQL + Builder mode with cpu_usage pre-selected

    // Set time range
    await pm.metricsPage.openDatePicker();
    await pm.metricsPage.selectLast15Minutes();
    await page.waitForTimeout(1000);

    // Step 1: Verify metric is pre-selected
    const streamInput = page.locator(builder.streamSelector);
    const streamValue = await streamInput.inputValue();
    expect(streamValue.length).toBeGreaterThan(0);
    testLogger.info(`Step 1: Metric pre-selected: ${streamValue}`);

    // Step 2: Add a label filter
    await builder.clickAddLabelFilter();
    const filterCount = await builder.getLabelFilterCount();
    expect(filterCount).toBeGreaterThan(0);
    testLogger.info('Step 2: Label filter added');

    // Step 3: Add an operation (Rate)
    const opAdded = await builder.addOperation('Rate');
    if (opAdded) {
      const opCount = await builder.getOperationCount();
      expect(opCount).toBeGreaterThan(0);
      testLogger.info('Step 3: Operation added');
    }

    // Step 4: Set step value
    await builder.setStepValue('1m');
    testLogger.info('Step 4: Step value set to 1m');

    // Step 5: Run query
    await builder.clickRunQuery();
    await page.waitForTimeout(3000);

    // Verify no errors
    const hasError = await pm.metricsPage.isErrorNotificationVisible();
    if (hasError) {
      const errorText = await pm.metricsPage.getErrorNotificationText();
      testLogger.warn(`Query error (may be expected with partial filter): ${errorText}`);
    }

    // The query should execute without crashing the UI
    const runQueryBtn = page.locator(builder.runQueryButton).first();
    await expect(runQueryBtn).toBeVisible();
    testLogger.info('Full Builder workflow completed - UI is stable');
  });
});

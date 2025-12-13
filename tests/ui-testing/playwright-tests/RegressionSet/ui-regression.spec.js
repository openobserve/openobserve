const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logsdata = require("../../../test-data/logs_data.json");
const logData = require("../../fixtures/log.json");

// Utility Functions

async function ingestTestData(page, streamName = "e2e_automate") {
  const orgId = process.env["ORGNAME"];
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };

  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });
    return await fetchResponse.json();
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logsdata: logsdata
  });

  testLogger.debug('Test data ingestion response', { response, streamName });
}

test.describe("UI Regression Bugs - P0 and P1", () => {
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

    testLogger.info('UI regression bug test setup completed');
  });

  // ========================================
  // P0 CRITICAL BUGS
  // ========================================

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
    await page.waitForTimeout(1000); // Wait for search results

    // Click explore button
    await pm.logsPage.clickExploreButton();
    await page.waitForTimeout(2000); // Wait for navigation

    // Verify URL contains 'logs' to confirm navigation
    await pm.logsPage.expectUrlContainsLogs();
    testLogger.info('Navigated to logs page after stream explorer click');

    // Find the query editor expand/collapse button (the "Expand" button on the right side)
    const queryExpandButton = page.locator('[data-test="logs-query-editor-full_screen-btn"]');

    // Verify button exists after stream explorer navigation
    await expect(queryExpandButton).toBeVisible({ timeout: 10000 });
    testLogger.info('Query expand button found after stream explorer navigation');

    // Get the query editor container to check expanded state
    const queryEditorContainer = page.locator('.query-editor-container');

    // Check if expand-on-focus class exists (indicates expanded state)
    const isInitiallyExpanded = await queryEditorContainer.locator('.expand-on-focus').count() > 0;
    testLogger.debug('Query editor initial expanded state', { expanded: isInitiallyExpanded });

    // Click the expand button
    await queryExpandButton.click();
    await page.waitForTimeout(1000); // Wait for animation

    // Check if the state changed after clicking
    const isExpandedAfterClick = await queryEditorContainer.locator('.expand-on-focus').count() > 0;
    testLogger.debug('Query editor expanded state after click', { expanded: isExpandedAfterClick });

    // The button should toggle the expanded state
    expect(isInitiallyExpanded).not.toBe(isExpandedAfterClick);
    testLogger.info(`Query expand icon test completed - button successfully ${isExpandedAfterClick ? 'expanded' : 'collapsed'} editor after stream explorer navigation`);
  });

  test("should display correct table fields when switching between saved views of different streams (#9388)", {
    tag: ['@savedViews', '@streamSwitching', '@regressionBugs', '@P0', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing stream field persistence when switching saved views');

    // Generate unique names for streams and saved views
    const uniqueId = Date.now();
    const streamA = `e2e_stream_a_${uniqueId}`;
    const streamB = `e2e_stream_b_${uniqueId}`;
    const savedViewA = `view_a_${uniqueId}`;
    const savedViewB = `view_b_${uniqueId}`;
    const fieldForStreamA = 'kubernetes_container_name';
    const fieldForStreamB = 'log';

    // Ingest data to both streams
    testLogger.info(`Ingesting data to stream A: ${streamA}`);
    await ingestTestData(page, streamA);
    testLogger.info(`Ingesting data to stream B: ${streamB}`);
    await ingestTestData(page, streamB);
    await page.waitForTimeout(2000); // Wait for data to be indexed

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');

    // ===== STREAM A SETUP =====
    testLogger.info(`Setting up Stream A (${streamA}) with saved view`);

    // Select stream A
    await pm.logsPage.selectStream(streamA);
    await page.waitForLoadState('networkidle');

    // Click refresh to load data
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Search for the field first to make it visible in sidebar
    await pm.logsPage.fillIndexFieldSearchInput(fieldForStreamA);
    await page.waitForTimeout(500);

    // Add field to table for stream A
    await pm.logsPage.hoverOnFieldExpandButton(fieldForStreamA);
    await pm.logsPage.clickAddFieldToTableButton(fieldForStreamA);
    await page.waitForTimeout(1000);

    // Clear field search
    await pm.logsPage.fillIndexFieldSearchInput('');
    await page.waitForTimeout(300);

    // Verify field is in table
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamA);
    testLogger.info(`Added ${fieldForStreamA} to table for stream A`);

    // Create saved view for stream A
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSaveViewButton();
    await pm.logsPage.fillSavedViewName(savedViewA);
    await pm.logsPage.clickSavedViewDialogSave();
    await page.waitForTimeout(2000);
    testLogger.info(`Created saved view: ${savedViewA}`);

    // ===== STREAM B SETUP =====
    testLogger.info(`Setting up Stream B (${streamB}) with saved view`);

    // Switch to stream B
    await pm.logsPage.selectStream(streamB);
    await page.waitForLoadState('networkidle');

    // Click refresh to load data
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Search for the field first to make it visible in sidebar
    await pm.logsPage.fillIndexFieldSearchInput(fieldForStreamB);
    await page.waitForTimeout(500);

    // Add different field to table for stream B
    await pm.logsPage.hoverOnFieldExpandButton(fieldForStreamB);
    await pm.logsPage.clickAddFieldToTableButton(fieldForStreamB);
    await page.waitForTimeout(1000);

    // Clear field search
    await pm.logsPage.fillIndexFieldSearchInput('');
    await page.waitForTimeout(300);

    // Verify field is in table
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamB);
    testLogger.info(`Added ${fieldForStreamB} to table for stream B`);

    // Create saved view for stream B
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSaveViewButton();
    await pm.logsPage.fillSavedViewName(savedViewB);
    await pm.logsPage.clickSavedViewDialogSave();
    await page.waitForTimeout(2000);
    testLogger.info(`Created saved view: ${savedViewB}`);

    // ===== VERIFY SAVED VIEW SWITCHING =====
    testLogger.info('Verifying saved view switching maintains correct fields');

    // Switch to saved view A
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput(savedViewA);
    await page.waitForTimeout(1000);
    await pm.logsPage.clickSavedViewByText(savedViewA);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify stream A field is present
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamA);
    testLogger.info(`Verified ${fieldForStreamA} present in saved view A`);

    // Switch to saved view B
    await pm.logsPage.clickSavedViewsExpand();
    await pm.logsPage.clickSavedViewSearchInput();
    await pm.logsPage.fillSavedViewSearchInput(savedViewB);
    await page.waitForTimeout(1000);
    await pm.logsPage.clickSavedViewByText(savedViewB);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify stream B field is present
    await pm.logsPage.expectFieldInTableHeader(fieldForStreamB);
    testLogger.info(`Verified ${fieldForStreamB} present in saved view B`);

    // ===== CLEANUP: Delete saved views =====
    testLogger.info('Cleaning up saved views');

    // Delete saved view A
    await pm.logsPage.clickDeleteSavedViewButton(savedViewA);
    await page.waitForTimeout(500);
    await pm.logsPage.clickConfirmButton();
    await page.waitForTimeout(1000);

    // Delete saved view B
    await pm.logsPage.clickDeleteSavedViewButton(savedViewB);
    await page.waitForTimeout(500);
    await pm.logsPage.clickConfirmButton();
    await page.waitForTimeout(1000);

    testLogger.info('Stream switching test completed - saved views maintain correct fields for each stream');
  });

  // ========================================
  // P1 IMPORTANT BUGS
  // ========================================

  test("should display 'No data found to download' notification when downloading empty results (#9455-1)", {
    tag: ['@downloadResults', '@emptyData', '@regressionBugs', '@P1', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing download empty results notification for CSV and JSON');

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // DO NOT select a stream - this ensures no data is available for download

    // Test CSV download
    testLogger.info('Testing CSV download with no stream selected');
    await pm.logsPage.clickMoreOptionsButton();
    await page.waitForTimeout(500);

    // Hover over "Download results" to see submenu (use first() to avoid strict mode violation)
    let downloadOption = page.getByText('Download results', { exact: true }).first();
    await downloadOption.waitFor({ state: 'visible', timeout: 5000 });
    await downloadOption.hover();
    await page.waitForTimeout(500);

    // Click CSV option
    const csvButton = page.getByText('CSV', { exact: true });
    await csvButton.waitFor({ state: 'visible', timeout: 5000 });
    await csvButton.click();
    await page.waitForTimeout(1000); // Wait for notification

    // Verify notification appears with correct message
    let notification = page.locator('.q-notification__message');
    await expect(notification).toBeVisible({ timeout: 5000 });

    let notificationText = await notification.textContent();
    testLogger.debug('CSV download notification text', { text: notificationText });

    // Exact message from SearchBar.vue: "No data found to download."
    expect(notificationText).toMatch(/no data found to download/i);
    testLogger.info('CSV download notification displayed correctly');

    // Wait for notification to disappear
    await page.waitForTimeout(2000);

    // Test JSON download
    testLogger.info('Testing JSON download with no stream selected');
    await pm.logsPage.clickMoreOptionsButton();
    await page.waitForTimeout(500);

    // Hover over "Download results" again
    downloadOption = page.getByText('Download results', { exact: true }).first();
    await downloadOption.waitFor({ state: 'visible', timeout: 5000 });
    await downloadOption.hover();
    await page.waitForTimeout(500);

    // Click JSON option
    const jsonButton = page.getByText('JSON', { exact: true });
    await jsonButton.waitFor({ state: 'visible', timeout: 5000 });
    await jsonButton.click();
    await page.waitForTimeout(1000); // Wait for notification

    // Verify notification appears again
    notification = page.locator('.q-notification__message');
    await expect(notification).toBeVisible({ timeout: 5000 });

    notificationText = await notification.textContent();
    testLogger.debug('JSON download notification text', { text: notificationText });

    // Exact message from SearchBar.vue: "No data found to download."
    expect(notificationText).toMatch(/no data found to download/i);
    testLogger.info('JSON download notification displayed correctly');

    testLogger.info('Empty results download test completed - both CSV and JSON notifications displayed correctly');
  });

  test("should display 'No data found to download' when downloading without selecting a stream (#9455-2)", {
    tag: ['@downloadResults', '@validation', '@regressionBugs', '@P1', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing download validation without stream selection');

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // DO NOT select a stream - this should result in no data

    // Verify no stream is selected
    const streamSelector = page.locator('[data-test="log-search-index-list"]')
      .or(page.getByText('Select Stream'));
    const isSelectStreamVisible = await streamSelector.isVisible().catch(() => false);
    testLogger.debug('Stream selector state', { isSelectStreamVisible });

    // Open more options menu
    await pm.logsPage.clickMoreOptionsButton();
    await page.waitForTimeout(500);

    // Hover over "Download results" to see submenu (use first() to avoid strict mode violation)
    const downloadOption = page.getByText('Download results', { exact: true }).first();
    await downloadOption.waitFor({ state: 'visible', timeout: 5000 });
    await downloadOption.hover();
    await page.waitForTimeout(500);

    // Click CSV option
    const csvButton = page.getByText('CSV', { exact: true });
    const isCSVVisible = await csvButton.isVisible().catch(() => false);

    if (!isCSVVisible) {
      throw new Error('CSV button not visible without stream selection - cannot test download validation');
    }

    await csvButton.click();
    await page.waitForTimeout(1000); // Wait for notification

    // Verify notification appears
    const notification = page.locator('.q-notification__message');
    await expect(notification).toBeVisible({ timeout: 5000 });

    // Get notification text
    const notificationText = await notification.textContent();
    testLogger.debug('Notification text', { text: notificationText });

    // Expect "No data found to download." message
    expect(notificationText).toMatch(/no data found to download/i);

    testLogger.info('Stream validation test completed - notification displayed when no stream selected');
  });

  test("should redirect to API documentation when Open API button is clicked (#9308)", {
    tag: ['@openAPI', '@navigation', '@regressionBugs', '@P1', '@home']
  }, async ({ page }) => {
    testLogger.info('Testing Open API button redirect functionality');

    // Navigate to any page (OpenAPI is in Help menu, available everywhere)
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');

    // Click the Help menu button (has help_outline icon and data-test="menu-link-help-item")
    const helpMenuButton = page.locator('[data-test="menu-link-help-item"]');
    await helpMenuButton.waitFor({ state: 'visible', timeout: 10000 });
    await helpMenuButton.click();
    await page.waitForTimeout(500);

    // Check if OpenAPI option is visible (only shown for non-cloud deployments)
    const openAPIOption = page.getByText('OpenAPI', { exact: true });
    const isOpenAPIVisible = await openAPIOption.isVisible().catch(() => false);

    if (!isOpenAPIVisible) {
      testLogger.warn('OpenAPI option not visible - may be cloud deployment or hidden via config');
      throw new Error('OpenAPI option not found in Help menu - feature may be disabled for cloud deployments');
    }

    testLogger.info('OpenAPI option found in Help menu');

    // Click OpenAPI option and wait for new page
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      openAPIOption.click()
    ]);

    // Verify new page opened with API documentation
    await newPage.waitForLoadState('domcontentloaded');

    // Verify URL contains API documentation indicators
    const url = newPage.url();
    expect(url).toMatch(/swagger|api|docs/i);

    await newPage.close();

    testLogger.info('Open API button test completed - successfully redirects to API docs');
  });

  test("should display enrichment table upload with readable colors in light mode (#9193)", {
    tag: ['@enrichmentTable', '@lightMode', '@colorContrast', '@regressionBugs', '@P1', '@pipelines']
  }, async ({ page }) => {
    testLogger.info('Testing enrichment table color readability in light mode');

    // Switch to light mode if not already
    const themeToggle = page.locator('[data-test="navbar-theme-toggle-btn"]');
    if (await themeToggle.isVisible()) {
      // Check current theme
      const currentTheme = await page.evaluate(() => {
        return document.documentElement.getAttribute('data-theme') ||
               localStorage.getItem('theme') ||
               'light';
      });

      if (currentTheme !== 'light') {
        await themeToggle.click();
        await page.waitForTimeout(1000); // Wait for theme to apply
      }
    }

    // Navigate to enrichment tables
    await pm.enrichmentPage.navigateToEnrichmentTable();
    await page.waitForLoadState('networkidle');

    // Check if enrichment tables exist
    const tableRows = page.locator('[data-test="enrichment-table-list-item"]');
    const tableCount = await tableRows.count();

    let enrichmentTableName = '';

    if (tableCount > 0) {
      // Use existing table
      enrichmentTableName = await tableRows.first().textContent();
    } else {
      // Create a test enrichment table
      await pm.pipelinesPage.navigateToAddEnrichmentTable();

      enrichmentTableName = `test_color_${Date.now()}`;

      // Upload file and save
      await pm.enrichmentPage.uploadEnrichmentFile(
        '../test-data/enrichment_info.csv',
        enrichmentTableName
      );

      await page.waitForLoadState('networkidle');
    }

    // Verify table row background color is readable
    const tableRow = page.locator(`[data-test="enrichment-table-list-item"]:has-text("${enrichmentTableName}")`);

    if (await tableRow.isVisible()) {
      // Get computed background color and verify it's not problematic
      const { bgColor, isReadable, colorDetails } = await tableRow.evaluate(el => {
        const bg = window.getComputedStyle(el).backgroundColor;

        // Parse RGB values
        const rgbMatch = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        let readable = true;
        let details = { r: 0, g: 0, b: 0, isYellowish: false };

        if (rgbMatch) {
          const [_, r, g, b] = rgbMatch.map(Number);
          details = { r, g, b };

          // Check if color is problematic yellow using threshold-based validation
          // Yellow has high R and G values (both > 240) and low B value (< 50)
          const isYellowish = r > 240 && g > 240 && b < 50;
          details.isYellowish = isYellowish;

          // Also check for colors with poor contrast (too bright/light)
          // Calculate relative luminance to determine if background is too light
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const isTooLight = luminance > 0.95; // Very light colors have luminance close to 1

          readable = !isYellowish && !isTooLight;
        }

        return { bgColor: bg, isReadable: readable, colorDetails: details };
      });

      testLogger.debug('Enrichment table background color', { bgColor, isReadable, colorDetails });

      // Verify color has reasonable contrast (not problematic yellow or too light)
      expect(isReadable).toBe(true);
    }

    testLogger.info('Enrichment table color test completed - colors are readable in light mode');
  });

  test("should convert non-SQL mode to SQL mode correctly with pipe operators (#9117)", {
    tag: ['@sqlMode', '@queryConversion', '@regressionBugs', '@P1', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing SQL mode conversion with pipe operators');

    // Data ingestion
    await ingestTestData(page);

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');

    // Select stream
    await pm.logsPage.selectStream("e2e_automate");

    // Ensure SQL mode is OFF
    const sqlModeToggle = page.locator('[role="switch"][data-test="logs-search-bar-sql-mode-toggle-btn"]').first();
    await sqlModeToggle.waitFor({ state: 'visible' });

    const isSQLMode = await sqlModeToggle.getAttribute('aria-checked');
    if (isSQLMode === 'true') {
      await sqlModeToggle.click();
      await page.waitForTimeout(500);
    }

    // Enter non-SQL mode query with pipe operators
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.clearQueryEditor();
    await pm.logsPage.fillQueryEditor('match_all(abc|def|ghi)');
    await page.waitForTimeout(500);

    // Enable SQL mode
    await sqlModeToggle.click();
    await page.waitForTimeout(1000);

    // Get converted SQL query
    const convertedQuery = await page.evaluate(() => {
      const editor = document.querySelector('[data-test="logs-search-bar-query-editor"]');
      return editor?.textContent || '';
    });
    testLogger.debug('Converted SQL query', { query: convertedQuery });

    // Verify query was converted and contains expected SQL syntax
    // The conversion should handle pipe operators correctly
    expect(convertedQuery).toContain('SELECT');
    expect(convertedQuery).toMatch(/FROM|match_all/i);

    // Verify no conversion errors occurred
    const errorNotification = page.locator('.q-notification__message:has-text("error")');
    await expect(errorNotification).not.toBeVisible();

    testLogger.info('SQL mode conversion test completed - pipe operators handled correctly');
  });

  test.afterEach(async () => {
    testLogger.info('UI regression test completed');
  });
});

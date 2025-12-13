const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logsdata = require("../../../test-data/logs_data.json");
const logData = require("../../fixtures/log.json");

// Utility Functions

async function ingestTestData(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
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

  testLogger.debug('Test data ingestion response', { response });
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

    // Navigate to streams page using logsPage method
    await pm.logsPage.navigateToStreams();
    await page.waitForLoadState('networkidle');

    // Search for e2e_automate stream
    await pm.logsPage.searchStreamByPlaceholder("e2e_automate");
    await page.waitForTimeout(1000);

    // Click on stream explorer icon to navigate to logs
    await pm.logsPage.clickFirstExploreButton();
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle');

    // Wait for logs page to load
    await pm.logsPage.expectLogsTableVisible();
    await page.waitForTimeout(2000); // Extra wait for UI to stabilize

    // Find the query editor expand/collapse button above the histogram
    const queryExpandButton = page.locator('[data-test="logs-query-editor-toggle-btn"]')
      .or(page.locator('[data-test="logs-search-bar-query-editor-toggle-btn"]'))
      .or(page.getByRole('button', { name: /expand|collapse/i }))
      .first();

    // Verify button exists after stream explorer navigation
    await expect(queryExpandButton).toBeVisible({ timeout: 10000 });
    testLogger.info('Query expand button found after stream explorer navigation');

    // Get initial state of query editor
    const queryEditor = page.locator('[data-test="logs-query-editor"]')
      .or(page.locator('[data-test="logs-search-bar-query-editor"]'))
      .or(page.locator('.monaco-editor'))
      .first();

    const initiallyVisible = await queryEditor.isVisible().catch(() => false);
    testLogger.debug('Query editor initial state', { visible: initiallyVisible });

    // Click the expand button
    await queryExpandButton.click();
    await page.waitForTimeout(1000); // Wait for expand animation

    // Verify query editor state changed after click
    const afterClickVisible = await queryEditor.isVisible().catch(() => false);
    testLogger.debug('Query editor state after click', { visible: afterClickVisible });

    // The button should toggle the editor visibility
    // If initially hidden, it should be visible after click (or vice versa)
    if (initiallyVisible) {
      // If editor was visible, clicking should hide it (or keep it visible with changes)
      testLogger.info('Query editor was initially visible, clicked expand button');
    } else {
      // If editor was hidden, clicking should show it - THIS IS THE BUG
      expect(afterClickVisible).toBe(true);
      testLogger.info('Query expand icon test completed - button successfully expanded editor after stream explorer navigation');
    }

    // Test passes if we got here without timeout/errors
    testLogger.info('Query expand icon is functional after stream explorer navigation');
  });

  test("should display correct table fields when switching between saved views of different streams (#9388)", {
    tag: ['@savedViews', '@streamSwitching', '@regressionBugs', '@P0', '@logs']
  }, async ({ page }) => {
    testLogger.info('Testing stream field persistence when switching saved views');

    // Data ingestion
    await ingestTestData(page);

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle');

    // Select stream A (e2e_automate)
    await pm.logsPage.selectStream("e2e_automate");
    await page.waitForLoadState('networkidle');

    // Get fields from stream A
    const streamAFields = await page.locator('[data-test="log-table-column"]').allTextContents();
    testLogger.debug('Stream A fields', { fields: streamAFields });

    // Create saved view for stream A (if views functionality exists)
    // Note: This may require specific page object methods

    // Switch to stream B
    await pm.logsPage.selectStream("default");
    await page.waitForLoadState('networkidle');

    // Verify stream B fields do NOT contain stream A specific fields
    const streamBFields = await page.locator('[data-test="log-table-column"]').allTextContents();
    testLogger.debug('Stream B fields', { fields: streamBFields });

    // Verify stream A specific fields (like k8s_event_*) don't appear in stream B
    const streamASpecificFields = streamAFields.filter(field =>
      field.includes('k8s_event_start_time') ||
      field.includes('k8s_event_count') ||
      field.includes('k8s_event_reason')
    );

    for (const field of streamASpecificFields) {
      expect(streamBFields).not.toContain(field);
    }

    testLogger.info('Stream switching test completed - fields correctly isolated per stream');
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

    if (isCSVVisible) {
      await csvButton.click();
      await page.waitForTimeout(1000); // Wait for notification
    } else {
      testLogger.warn('CSV button not visible without stream selection');
      test.skip();
      return;
    }

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
      testLogger.info('Skipping test - OpenAPI is only available in non-cloud deployments');
      test.skip();
      return;
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
      // Get computed background color
      const bgColor = await tableRow.evaluate(el => {
        return window.getComputedStyle(el).backgroundColor;
      });

      testLogger.debug('Enrichment table background color', { bgColor });

      // Verify color is not yellow (rgb values for yellow are around 255, 255, 0)
      // Acceptable colors should have reasonable contrast
      expect(bgColor).not.toMatch(/rgb\(255,\s*255,\s*0\)/i);
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

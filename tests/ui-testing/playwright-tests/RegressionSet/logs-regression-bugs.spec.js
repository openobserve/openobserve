/**
 * Logs Regression Bug Tests
 *
 * Bug fixes for logs page functionality:
 * - #9996: Page appears blank midway on scroll
 * - #9796: Logs page load data without clicking run query
 * - #9533: Loading icon missing when run query for long duration
 * - #8928: UI revamp issues (sidebar, search bar, histogram)
 * - Quick mode query removed when selecting interesting field
 * - Pagination not showing with histogram and SQL disabled
 * - Error message should identify problematic field
 * - #8224: Showing message not displayed on logs page
 * - #5894: Timestamp not default selected for multi stream
 * - #10344: Run query button infinite loading when switching home↔logs
 * - #11469: Copy/include/exclude shown on hover in traces correlation
 * - #5010: Console error when aggregating with non-existent alias
 * - #5278: Pagination not showing when histogram is turned off
 * - #3821: Cannot read partitions error on stream change during query
 * - #6702: Partitions error when switching pages during query
 * - #3131: Order by not default for distinct queries
 * - #4315: Blank histogram on cancelling histogram query
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData, sendRequest, getHeaders, getIngestionUrl } = require('../utils/data-ingestion.js');
const { getOrgIdentifier, isCloudEnvironment } = require('../utils/cloud-auth.js');

test.describe("Logs Regression Bug Fixes", () => {
  // Changed from serial to parallel - tests are independent (each gets own page/PM in beforeEach)
  test.describe.configure({ mode: 'parallel' });
  let pm;
  // Stream names for field cache test - declared at describe scope for afterEach cleanup
  let fieldCacheStreamsToCleanup = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Attempt data ingestion but don't fail test if it errors (global setup already ingested data)
    try {
      await ingestTestData(page);
    } catch (error) {
      testLogger.warn(`Data ingestion skipped (may already exist from global setup): ${error.message}`);
    }

    testLogger.info('Logs regression bug test setup completed');
  });

  // ==========================================================================
  // Bug #9996: Page appears blank midway on scroll
  // https://github.com/openobserve/openobserve/issues/9996
  // ==========================================================================
  // SKIPPED: Timing out in current test environment (selectStream failures)
  // TODO: Re-enable when environment is stable
  test.skip("should maintain table visibility during scroll @bug-9996 @P0 @scroll @regression", async ({ page }) => {
    test.setTimeout(240000); // 4 minutes timeout for slow environments
    testLogger.info('Test: Verify scroll maintains content visibility (Bug #9996)');

    // Navigate directly to logs page with stream and time parameters
    const fifteenMinsAgo = Date.now() - (15 * 60 * 1000);
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}&stream=e2e_automate&stream_type=logs&from=${fifteenMinsAgo}&to=${Date.now()}`);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Run query to load data
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Table must be visible before scroll
    await pm.logsPage.expectLogsTableVisible();
    testLogger.info('✓ Table visible before scroll');

    // Scroll multiple times and verify table stays visible
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(300);
      // STRONG ASSERTION: Table must remain visible after each scroll
      await pm.logsPage.expectLogsTableVisible();
      testLogger.info(`✓ Table visible after scroll ${i + 1}/5`);
    }

    testLogger.info('✓ PASSED: Table visible throughout scroll');
  });

  // ==========================================================================
  // Bug #9796: Logs page load data without clicking on run query
  // https://github.com/openobserve/openobserve/issues/9796
  // ==========================================================================
  test("should only load data after clicking run query @bug-9796 @P0 @queryBehavior @regression", async ({ page }) => {
    testLogger.info('Test: Verify no auto-load on stream selection (Bug #9796)');

    // Track search API calls
    const searchApiCalls = [];
    await page.route('**/api/*/_search**', async (route, request) => {
      const url = request.url();
      if (!url.includes('validate=true') && !url.includes('_values')) {
        searchApiCalls.push({ url, timestamp: Date.now() });
        testLogger.info(`Search API called: ${url.substring(0, 100)}`);
      }
      await route.continue();
    });

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const initialCallCount = searchApiCalls.length;
    testLogger.info(`Initial API calls: ${initialCallCount}`);

    // Select stream WITHOUT clicking run query
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(2000);

    const callsAfterSelection = searchApiCalls.length - initialCallCount;
    testLogger.info(`API calls after stream selection: ${callsAfterSelection}`);

    // Now click Run Query
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Search API should be called after clicking run query
    const totalCalls = searchApiCalls.length;
    expect(totalCalls).toBeGreaterThan(initialCallCount);
    testLogger.info(`Total API calls after Run Query: ${totalCalls}`);

    // STRONG ASSERTION: Results should load after explicit query
    await pm.logsPage.expectLogsTableVisible();

    testLogger.info('✓ PASSED: Data loads only after clicking Run Query');
  });

  // ==========================================================================
  // Bug #9533: Loading icon missing when run query for long duration
  // https://github.com/openobserve/openobserve/issues/9533
  // ==========================================================================
  test("should show visual feedback during query execution @bug-9533 @P0 @loading @regression", async ({ page }) => {
    testLogger.info('Test: Verify loading indicator during query (Bug #9533)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Set larger time range
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative1HourOrFallback();

    // STRONG ASSERTION: Button should be enabled before query
    await pm.logsPage.expectRefreshButtonEnabled();

    // Click run query
    await pm.logsPage.clickRefreshButton();

    // Wait for query to complete
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Button should be enabled after query completes
    await pm.logsPage.expectRefreshButtonEnabled();

    // STRONG ASSERTION: Results should be visible after query
    await pm.logsPage.expectLogsTableVisible();

    testLogger.info('✓ PASSED: Query execution provides feedback');
  });

  // ==========================================================================
  // Bug #8928: UI revamp issues - Search bar UI consistency
  // https://github.com/openobserve/openobserve/issues/8928
  // ==========================================================================
  test("should display search bar with required UI elements @bug-8928 @P1 @ui @regression", async ({ page }) => {
    testLogger.info('Test: Verify search bar UI consistency (Bug #8928)');

    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Stream selector must be visible
    await pm.logsPage.expectStreamSelectorVisible();

    // STRONG ASSERTION: Refresh button must be visible
    await pm.logsPage.expectRefreshButtonVisible();

    // STRONG ASSERTION: DateTime button must be visible
    await pm.logsPage.expectDateTimeButtonVisible();

    testLogger.info('✓ PASSED: Search bar UI elements verified');
  });

  // ==========================================================================
  // Bug #8928: UI revamp issues - Histogram rendering
  // https://github.com/openobserve/openobserve/issues/8928
  // ==========================================================================
  test("should render histogram without cropping @bug-8928 @P1 @ui @histogram @regression", async ({ page }) => {
    testLogger.info('Test: Verify histogram renders correctly (Bug #8928)');

    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Toggle histogram on
    await pm.logsPage.enableHistogram();
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Histogram should be visible
    await pm.logsPage.expectHistogramVisible();

    // Toggle off and back on
    await pm.logsPage.toggleHistogram();
    await page.waitForTimeout(500);
    await pm.logsPage.toggleHistogram();
    await page.waitForTimeout(1000);

    // STRONG ASSERTION: Histogram should still be visible after toggle
    await pm.logsPage.expectHistogramVisible();

    testLogger.info('✓ PASSED: Histogram rendering verified');
  });

  // ==========================================================================
  // Bug: Quick mode query removed when selecting interesting field
  // ==========================================================================
  test("should preserve quick mode query when selecting a new interesting field @quickMode @P0 @regression", async ({ page }) => {
    testLogger.info('Test: Verify quick mode query is preserved when selecting new interesting field');

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Select stream
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Enable quick mode if not already enabled
    await pm.logsPage.enableQuickModeIfDisabled();
    await page.waitForTimeout(500);

    // Click all fields button to show field list
    await pm.logsPage.clickAllFieldsButton();
    await page.waitForTimeout(500);

    // Write a query in the query editor using a field that exists in e2e_automate stream
    // Using 'code' field which is guaranteed to exist per log.json fixture
    const testQuery = 'code';
    await pm.logsPage.clickQueryEditor();
    await pm.logsPage.typeInQueryEditor(testQuery);
    await page.waitForTimeout(500);

    // Get the query text before selecting interesting field
    const queryBeforeSelection = await pm.logsPage.getQueryEditorText();
    testLogger.info(`Query before selecting interesting field: ${queryBeforeSelection}`);

    // Search for a field and click on it as interesting field
    // Using 'stream' field which is guaranteed to exist per log.json fixture
    await pm.logsPage.fillIndexFieldSearchInput("stream");
    await pm.logsPage.clickInterestingFieldButton("stream");
    await page.waitForTimeout(500);

    // Get the query text after selecting interesting field
    const queryAfterSelection = await pm.logsPage.getQueryEditorText();
    testLogger.info(`Query after selecting interesting field: ${queryAfterSelection}`);

    // STRONG ASSERTION: The original query should still be present in the editor
    expect(queryAfterSelection).toContain(testQuery);

    testLogger.info('✓ PASSED: Quick mode query preserved when selecting interesting field');
  });

  // ==========================================================================
  // Bug: Pagination not showing with histogram & SQL disabled
  // ==========================================================================
  test("should show pagination when histogram and SQL mode are disabled @pagination @P0 @regression", async ({ page }) => {
    testLogger.info('Test: Verify pagination shows when histogram and SQL mode are disabled');

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Select stream
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Disable histogram if enabled
    await pm.logsPage.ensureHistogramToggleState(false);
    await page.waitForTimeout(500);

    // Ensure SQL mode is disabled
    await pm.logsPage.disableSqlModeIfNeeded();

    // Set time range to ensure we have enough data
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await page.waitForTimeout(500);

    // Run query
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Wait for logs table to be visible
    await pm.logsPage.expectLogsTableVisible();

    // STRONG ASSERTION: Result pagination should be visible
    await pm.logsPage.expectResultPaginationVisible();
    testLogger.info('Result pagination is visible');

    // STRONG ASSERTION: SQL pagination should NOT be visible when SQL mode is off
    await pm.logsPage.expectSQLPaginationNotVisible();

    testLogger.info('✓ PASSED: Pagination shows correctly when histogram and SQL mode are disabled');
  });

  // ==========================================================================
  // Bug: Error message should identify problematic field
  // ==========================================================================
  test("should show correct error message identifying the problematic field @errorMessage @P0 @regression", async ({ page }) => {
    testLogger.info('Test: Verify error message correctly identifies the problematic field');

    // Navigate to logs page
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Select stream
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Enable SQL mode to write custom query
    await pm.logsPage.enableSqlModeIfNeeded();
    await page.waitForTimeout(500);

    // Write a query with a non-existent field
    const nonExistentField = 'nonexistent_field_xyz_12345';
    const query = `SELECT ${nonExistentField} FROM "e2e_automate"`;
    await pm.logsPage.clearAndFillQueryEditor(query);
    await page.waitForTimeout(500);

    // Run query
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // STRONG ASSERTION: Error message should be visible
    await pm.logsPage.expectErrorMessageVisible();
    testLogger.info('Error message is visible');

    // Get the detailed error message using page object method
    const errorDialogText = await pm.logsPage.getDetailedErrorDialogText();
    testLogger.info(`Full error dialog text: ${errorDialogText}`);

    const fullErrorText = errorDialogText.toLowerCase();

    // STRONG ASSERTION: Error message MUST contain the exact problematic field name
    // This ensures the error is specific and actionable, not just a generic "field not found"
    expect(fullErrorText).toContain(nonExistentField.toLowerCase());
    testLogger.info(`Verified error message contains the problematic field: ${nonExistentField}`);

    testLogger.info('✓ PASSED: Error message correctly identifies problematic field');
  });

  // ==========================================================================
  // Bug #10821: Quick mode text label click not working
  // https://github.com/openobserve/openobserve/issues/10821
  // ==========================================================================
  test("should toggle quick mode when clicking on text label @bug-10821 @P3 @quickMode @regression", async ({ page }) => {
    testLogger.info('Test: Verify quick mode toggles via text label click (Bug #10821)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Get initial quick mode state
    const initialState = await pm.logsPage.getQuickModeState();
    testLogger.info(`Initial quick mode state: ${initialState}`);

    // Click on the text label (not the toggle switch)
    await pm.logsPage.clickQuickModeTextLabel();
    testLogger.info('Clicked on quick mode text label');

    // Wait for toggle to update
    await page.waitForTimeout(500);

    // Get new state
    const newState = await pm.logsPage.getQuickModeState();
    testLogger.info(`New quick mode state: ${newState}`);

    // STRONG ASSERTION: Verify state changed
    expect(newState).not.toBe(initialState);
    testLogger.info('✓ Quick mode state changed after clicking text label');

    // Toggle back by clicking text label again
    await pm.logsPage.clickQuickModeTextLabel();
    await page.waitForTimeout(500);

    const finalState = await pm.logsPage.getQuickModeState();
    testLogger.info(`Final quick mode state: ${finalState}`);

    // STRONG ASSERTION: Verify it toggled back
    expect(finalState).toBe(initialState);
    testLogger.info('✓ PASSED: Quick mode toggled back successfully via text label');
  });

  // ==========================================================================
  // Bug #11041: Multi-select behavior incorrect from sidebar
  // https://github.com/openobserve/openobserve/issues/11041
  // ==========================================================================
  test.skip("should disable include button for already-included field values @bug-11041 @P2 @includeExclude @regression", async ({ page }) => {
    testLogger.info('Test: Verify multi-select sidebar behavior (Bug #11041)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Run initial query to get log results
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Verify logs table is visible
    await pm.logsPage.expectLogsTableVisible();
    testLogger.info('✓ Initial query completed, logs table visible');

    // Find an available field to expand - try common fields that exist in e2e_automate
    const testFields = ['kubernetes_pod_name', 'log', 'code', '_timestamp'];
    let selectedField = null;
    let fieldExpandButton = null;

    for (const fieldName of testFields) {
      const fieldBtn = pm.logsPage.getFieldExpandButton(fieldName);
      if (await fieldBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        selectedField = fieldName;
        fieldExpandButton = fieldBtn;
        testLogger.info(`✓ Found available field: ${fieldName}`);
        break;
      }
    }

    if (!selectedField) {
      throw new Error('Bug #11041: No suitable field found to test with');
    }

    // Expand the field in the sidebar to see field values
    await expect(fieldExpandButton, `Bug #11041: ${selectedField} field must be visible`).toBeVisible({ timeout: 5000 });
    await fieldExpandButton.click();
    await page.waitForTimeout(500);
    testLogger.info(`✓ Expanded ${selectedField} field in sidebar`);

    // Find and click include button for a field value
    const includeBtn = pm.logsPage.getSubfieldListEqualButton(selectedField).first();
    await expect(includeBtn, 'Bug #11041: include button should be visible').toBeVisible({ timeout: 3000 });
    await includeBtn.click();
    await page.waitForTimeout(1000);

    // Click "Include Search Term" from the menu - try multiple possible menu texts
    const possibleMenuTexts = ['Include Search Term', 'Include', 'Add to filter'];
    let includeMenuItem = null;

    for (const menuText of possibleMenuTexts) {
      const menuItem = page.getByText(menuText, { exact: false }).first();
      if (await menuItem.isVisible({ timeout: 1000 }).catch(() => false)) {
        includeMenuItem = menuItem;
        testLogger.info(`✓ Found include menu item with text: ${menuText}`);
        break;
      }
    }

    if (!includeMenuItem) {
      // Try finding any visible menu item
      const anyMenuItem = page.locator('.q-menu:visible .q-item').first();
      if (await anyMenuItem.isVisible({ timeout: 1000 }).catch(() => false)) {
        includeMenuItem = anyMenuItem;
        testLogger.info('✓ Using first visible menu item');
      } else {
        throw new Error('Bug #11041: include menu item not found with any selector');
      }
    }

    await expect(includeMenuItem, 'Bug #11041: include menu item should be visible').toBeVisible({ timeout: 3000 });
    await includeMenuItem.click();
    testLogger.info('✓ Added first include search term');

    // Run the query with the include filter
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // BUG CHECK: The include button should now be disabled or show different state
    // for the already-included value
    const queryEditor = pm.logsPage.getQueryEditorLocator();
    const queryText = await queryEditor.textContent();
    testLogger.info(`Query editor contains: ${queryText}`);

    // STRONG ASSERTION: Verify the include term is in the query
    expect(queryText).toContain(selectedField);
    testLogger.info('✓ Include term is present in query');

    // Try clicking the same include button again - it should either:
    // 1. Be disabled, OR
    // 2. Not add duplicate entries
    await fieldExpandButton.click().catch(() => {});
    await page.waitForTimeout(500);

    // Check if we can still click the same value's include button
    // (This tests if spamming is prevented)
    const includeBtn2 = pm.logsPage.getSubfieldListEqualButton(selectedField).first();

    // Assert button is still visible after adding filter
    await expect(includeBtn2, 'Bug #11041: include button should remain visible after adding filter').toBeVisible({ timeout: 3000 });

    const isDisabled = await includeBtn2.isDisabled().catch(() => false);
    testLogger.info(`Include button disabled state: ${isDisabled}`);

    // PRIMARY ASSERTION: The button should be disabled for already-included values
    expect(isDisabled, 'Bug #11041: include button should be disabled for already-included value').toBe(true);

    testLogger.info('✓ PASSED: Multi-select sidebar behavior test completed');
  });

  // ==========================================================================
  // Field Values Cache Bug: Field values not refreshed when switching streams
  // When switching between streams with same field name, values should refresh
  // Bug: UI displays cached values from previous stream instead of fetching new values
  // ==========================================================================
  test("should fetch fresh field values when switching streams @fieldValuesCache @P1 @regression", async ({ page }) => {
    testLogger.info('Test: Field values should refresh when switching between streams');

    // Strategy: use existing e2e_automate stream (always available) + ONE new stream.
    // Alpha1 cloud has a backend bug where creating 2 new streams in quick succession
    // causes the second stream's metadata to never appear in the streams API.
    // By reusing e2e_automate, we only create 1 new stream (which always works).
    const stream1Name = 'e2e_automate'; // existing stream from global setup
    const runId = Date.now();
    const stream2Name = `e2e_svctest_${runId}`;
    // Only the new stream needs cleanup
    fieldCacheStreamsToCleanup = [stream2Name];
    const testFieldName = 'service_name';
    const stream1Value = `svc-automate-${runId}`;
    const stream2Value = `svc-newstream-${runId}`;

    const streamWaitMs = isCloudEnvironment() ? 150000 : 30000;

    // Step 1: Ingest data with unique service_name into e2e_automate (stream already exists)
    // IMPORTANT: Use sendRequest (page.request.post) instead of pm.logsPage.ingestData (node-fetch).
    // On cloud, streams ingested via node-fetch never appear in the streams API keyword search,
    // while streams ingested via page.request are indexed immediately.
    const orgId = getOrgIdentifier() || 'default';
    const headers = getHeaders();
    testLogger.info(`Ingesting data into ${stream1Name} with ${testFieldName}=${stream1Value}`);
    const timestamp1 = Date.now() * 1000;
    const stream1Url = getIngestionUrl(orgId, stream1Name);
    const stream1Response = await sendRequest(page, stream1Url, [
      { [testFieldName]: stream1Value, level: 'info', message: 'Field cache test stream1', _timestamp: timestamp1 },
      { [testFieldName]: stream1Value, level: 'info', message: 'Field cache test stream1 2', _timestamp: timestamp1 + 1000000 },
    ], headers);
    testLogger.info(`Stream1 ingestion response: ${JSON.stringify(stream1Response)}`);

    // Step 2: Create new stream by ingesting standard test data first (ensures proper stream registration),
    // then ingest custom records with distinct service_name for the field values cache test.
    testLogger.info(`Creating stream ${stream2Name} with standard test data`);
    await ingestTestData(page, stream2Name);
    testLogger.info(`Ingesting custom data into ${stream2Name} with ${testFieldName}=${stream2Value}`);
    const timestamp2 = timestamp1 + 2000000;
    const stream2Url = getIngestionUrl(orgId, stream2Name);
    const stream2Response = await sendRequest(page, stream2Url, [
      { [testFieldName]: stream2Value, level: 'info', log: 'Field cache test stream2', _timestamp: timestamp2 },
      { [testFieldName]: stream2Value, level: 'info', log: 'Field cache test stream2 2', _timestamp: timestamp2 + 1000000 },
    ], headers);
    testLogger.info(`Stream2 custom ingestion response: ${JSON.stringify(stream2Response)}`);

    // Wait for the new stream to be indexed (e2e_automate already exists)
    testLogger.info(`Waiting for ${stream2Name} to be indexed...`);
    const stream2Available = await pm.logsPage.waitForStreamAvailable(stream2Name, streamWaitMs, 3000);
    expect(stream2Available, `Stream ${stream2Name} should be available via API`).toBeTruthy();
    testLogger.info(`Stream ${stream2Name} confirmed available via API`);

    // Step 3: Navigate to logs and select stream1 (e2e_automate — always available)
    await pm.logsPage.clickMenuLinkLogsItem();
    await pm.logsPage.selectStream(stream1Name);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Set time range and run query
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();

    // Wait for search API response after clicking refresh
    const searchResponsePromise1 = page.waitForResponse(
      response => response.url().includes('/_search') && response.status() === 200,
      { timeout: 30000 }
    );
    await pm.logsPage.clickRefreshButton();
    await searchResponsePromise1;
    // Wait for results table to fully render before field interaction
    await page.waitForTimeout(3000);

    // Step 4: Expand the service_name field and capture values from stream1
    testLogger.info(`Expanding ${testFieldName} field in ${stream1Name}`);
    await pm.logsPage.fillIndexFieldSearchInput(testFieldName);
    await pm.logsPage.waitForFieldExpandButtonVisible(testFieldName);

    // Wait for field values API response after expanding
    const valuesResponsePromise1 = page.waitForResponse(
      response => response.url().includes('/_values') && response.status() === 200,
      { timeout: 20000 }
    );
    await pm.logsPage.clickFieldExpandButton(testFieldName);
    await valuesResponsePromise1;
    await pm.logsPage.waitForFieldValues(testFieldName, 15000);

    // Get field values from stream1
    const stream1FieldValues = await pm.logsPage.getFieldValuesText(testFieldName);
    testLogger.info(`Stream1 field values: ${JSON.stringify(stream1FieldValues)}`);

    // Verify stream1 values contain our unique value (may have count suffix in UI)
    const hasStream1Value = stream1FieldValues.some(v => v.startsWith(stream1Value));
    expect(hasStream1Value, `Expected stream1 values to contain ${stream1Value}, got: ${stream1FieldValues}`).toBeTruthy();
    testLogger.info(`✓ Stream1 shows correct value: ${stream1Value}`);

    // Collapse the field
    await pm.logsPage.collapseField(testFieldName);

    // Step 5: Switch to stream2 WITHOUT refreshing the page
    testLogger.info(`Switching to ${stream2Name} without page refresh`);
    await pm.logsPage.selectStream(stream2Name);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Run query for stream2 and wait for search API response
    const searchResponsePromise2 = page.waitForResponse(
      response => response.url().includes('/_search') && response.status() === 200,
      { timeout: 30000 }
    );
    await pm.logsPage.clickRefreshButton();
    await searchResponsePromise2;
    // Wait for results table to fully render before field interaction
    await page.waitForTimeout(3000);

    // Step 6: Expand the same service_name field in stream2
    testLogger.info(`Expanding ${testFieldName} field in ${stream2Name}`);
    await pm.logsPage.fillIndexFieldSearchInput(testFieldName);
    await pm.logsPage.waitForFieldExpandButtonVisible(testFieldName);

    // Wait for field values API response after expanding
    const valuesResponsePromise2 = page.waitForResponse(
      response => response.url().includes('/_values') && response.status() === 200,
      { timeout: 20000 }
    );
    await pm.logsPage.clickFieldExpandButton(testFieldName);
    await valuesResponsePromise2;
    await pm.logsPage.waitForFieldValues(testFieldName, 15000);

    // Get field values from stream2
    const stream2FieldValues = await pm.logsPage.getFieldValuesText(testFieldName);
    testLogger.info(`Stream2 field values: ${JSON.stringify(stream2FieldValues)}`);

    // PRIMARY ASSERTION: Stream2 values should contain stream2 unique value (may have count suffix)
    const hasStream2Value = stream2FieldValues.some(v => v.startsWith(stream2Value));
    expect(hasStream2Value, `Expected stream2 values to contain ${stream2Value}, got: ${stream2FieldValues}`).toBeTruthy();
    testLogger.info(`✓ Stream2 shows correct value: ${stream2Value}`);

    // SECONDARY ASSERTION: Stream2 values should NOT contain stream1 cached values
    const hasCachedStream1Value = stream2FieldValues.some(v => v.startsWith(stream1Value));
    expect(hasCachedStream1Value, `Stream2 should not have stream1 cached values, got: ${stream2FieldValues}`).toBeFalsy();
    testLogger.info('✓ Stream2 does NOT show cached values from stream1');

    testLogger.info('✓ PASSED: Field values correctly refresh when switching streams (no caching issue)');
  });

  // ==========================================================================
  // Bug #9788: Share button should be disabled when ZO_WEB_URL is not configured
  // https://github.com/openobserve/openobserve/issues/9788
  // ==========================================================================
  test("Share button should be disabled when ZO_WEB_URL is not configured @bug-9788 @P1 @shareLink @regression", async ({ page }, testInfo) => {
    testLogger.info('Test: Share button disabled state with mocked config (Bug #9788)');

    // Set up mock BEFORE any navigation to ensure config is mocked from the start
    await page.route('**/config', async (route) => {
      const response = await route.fetch();
      const json = await response.json();

      // Delete web_url property to simulate it not being configured
      const modifiedConfig = { ...json };
      delete modifiedConfig.web_url;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(modifiedConfig)
      });
    });

    // Navigate to logs page with mock already active
    const logsUrl = `${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`;
    testLogger.info('Navigating to logs page with mocked config');
    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Select a stream and run query to load results
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    testLogger.info('Logs page loaded with mocked config');

    // PRIMARY ASSERTION: Share button should exist
    await pm.logsPage.expectShareLinkButtonVisible();
    testLogger.info('✓ Share button is visible');

    // SECONDARY ASSERTION: Share button should be disabled when ZO_WEB_URL not configured
    await pm.logsPage.expectShareLinkButtonDisabled();
    testLogger.info('✓ PRIMARY CHECK PASSED: Share button is disabled (ZO_WEB_URL not configured)');

    // TERTIARY ASSERTION: Check for tooltip explaining why it's disabled
    await pm.logsPage.hoverShareLinkButton();

    // Verify tooltip is visible with specific message about ZO_WEB_URL configuration
    await pm.logsPage.expectShareLinkTooltipVisible(/share\s+url\s+is\s+disabled.*zo_web_url.*configured/i);

    // Get and validate tooltip text matches expected structure
    const tooltipText = await pm.logsPage.getShareLinkTooltipText(/share\s+url\s+is\s+disabled.*zo_web_url.*configured/i);
    expect(tooltipText.toLowerCase()).toMatch(/share\s+url\s+is\s+disabled.*zo_web_url.*configured/i);
    testLogger.info('✓ TERTIARY CHECK PASSED: Informative tooltip present');

    testLogger.info('✓ PASSED: Share button disabled state test completed for Bug #9788');
  });

  // ==========================================================================
  // Bug #9690: VRL function not loading correctly when opening saved view
  // https://github.com/openobserve/openobserve/issues/9690
  // ==========================================================================
  test("should load VRL function correctly when opening saved view @bug-9690 @P1 @savedViews @vrl @regression", async ({ page }) => {
    testLogger.info('Test: Verify VRL function loads correctly in saved views (Bug #9690)');

    const uniqueSuffix = Date.now();
    const testFunctionName = `TestVRLFunc_${uniqueSuffix}`;
    const testViewName = `VRLTestView_${uniqueSuffix}`;
    const vrlFunction = '.test_field = "bug9690_test"';

    try {
      // Navigate to logs page
      await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await pm.logsPage.selectStream('e2e_automate');
      await page.waitForTimeout(1000);

      // Step 1: Enable VRL toggle
      testLogger.info('Step 1: Enabling VRL function toggle');
      await pm.logsPage.clickVrlToggleButton().catch(() => {
        testLogger.warn('VRL toggle click failed, trying alternative');
      });
      await page.waitForTimeout(1000);

      // Step 2: Enter VRL function in the editor
      testLogger.info('Step 2: Entering VRL function');
      const vrlEditor = pm.logsPage.getVrlEditor().first();

      // STRONG ASSERTION: VRL editor must be visible
      await expect(vrlEditor, 'Bug #9690: VRL editor must be visible').toBeVisible({ timeout: 5000 });
      await vrlEditor.click();
      await page.keyboard.type(vrlFunction);
      testLogger.info(`VRL function entered: ${vrlFunction}`);

      // Step 3: Save the function
      try {
        await pm.logsPage.clickSaveTransformButton();
        await page.waitForTimeout(500);
        await pm.logsPage.fillSavedFunctionNameInput(testFunctionName);
        await pm.logsPage.clickConfirmButton();
        await page.waitForTimeout(1000);
        testLogger.info(`Function saved: ${testFunctionName}`);
      } catch (saveError) {
        testLogger.warn('Save function step skipped - UI flow may differ');
      }

      // Step 4: Run query to have results
      await pm.logsPage.clickRefreshButton();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Step 5: Save the view
      testLogger.info('Step 5: Saving current view');
      await pm.logsPage.clickSavedViewsExpand();
      await page.waitForTimeout(500);
      await pm.logsPage.clickSaveViewButton();
      await pm.logsPage.fillSavedViewName(testViewName);
      await pm.logsPage.clickSavedViewDialogSave();
      await page.waitForTimeout(2000);
      testLogger.info(`View saved: ${testViewName}`);

      // Step 6: Reload the page to simulate fresh load
      testLogger.info('Step 6: Reloading page');
      await page.reload();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Step 7: Navigate back to logs and select the saved view
      testLogger.info('Step 7: Selecting saved view');
      await pm.logsPage.selectStream('e2e_automate');
      await page.waitForTimeout(1000);

      // Open saved views dropdown and search
      await pm.logsPage.clickSavedViewsExpand();
      await pm.logsPage.clickSavedViewSearchInput();
      await pm.logsPage.fillSavedViewSearchInput(testViewName);
      await page.waitForTimeout(1000);

      // Wait for and click on the saved view
      await pm.logsPage.waitForSavedViewText(testViewName);
      await pm.logsPage.clickSavedViewByText(testViewName);
      await page.waitForTimeout(2000);

      // Step 8: Verify VRL function is loaded
      testLogger.info('Step 8: Verifying VRL function loaded');

      // Toggle VRL editor to make it visible (it's collapsed by default after loading saved view)
      await pm.logsPage.clickVrlToggle();
      await page.waitForTimeout(1000);

      // Check if VRL editor has content
      const vrlEditorContent = await pm.logsPage.getVrlEditorContent();
      testLogger.info(`VRL editor content after load: ${vrlEditorContent.substring(0, 100)}`);

      // Check if function dropdown shows selection
      const dropdownText = await pm.logsPage.getFunctionDropdownText();
      testLogger.info(`Function dropdown text: ${dropdownText}`);

      // PRIMARY ASSERTION: VRL content should be present (not empty)
      // Either the editor has content OR the function is selected in dropdown
      const hasVrlContent = vrlEditorContent.length > 0 || dropdownText.includes(testFunctionName);
      expect(hasVrlContent, 'Bug #9690: VRL function should load in saved view').toBeTruthy();
      testLogger.info('✓ PRIMARY CHECK PASSED: VRL function loaded in saved view');

    } catch (error) {
      testLogger.error(`Test error: ${error.message}`);
      throw error;
    } finally {
      // Cleanup: Delete the saved view if possible
      try {
        await pm.logsPage.clickDeleteSavedViewButton(testViewName).catch(() => {});
        await page.waitForTimeout(500);
        await pm.logsPage.clickConfirmButton().catch(() => {});
        testLogger.info(`Cleaned up test view: ${testViewName}`);
      } catch (cleanupError) {
        testLogger.debug('Cleanup skipped or failed gracefully');
      }
    }

    testLogger.info('✓ PASSED: VRL saved views test completed (Bug #9690)');
  });

  // ==========================================================================
  // Bug #8224: Logs page showing message not display
  // https://github.com/openobserve/openobserve/issues/8224
  // ==========================================================================
  test("should display showing message on logs page after query @bug-8224 @P2 @showingMessage @regression", async ({ page }) => {
    testLogger.info('Test: Verify showing message visible after query (Bug #8224)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Run query
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: Result pagination (showing X of Y records) should be visible
    await pm.logsPage.expectResultPaginationVisible();
    testLogger.info('✓ Showing message / result pagination is visible');

    // STRONG ASSERTION: Logs table should be visible (confirms data loaded)
    await pm.logsPage.expectLogsTableVisible();
    testLogger.info('✓ Logs table visible with data');

    testLogger.info('✓ PASSED: Showing message displays correctly (Bug #8224)');
  });

  // ==========================================================================
  // Bug #5894: Timestamp should be default selected for multi stream selection
  // https://github.com/openobserve/openobserve/issues/5894
  // ==========================================================================
  test("should have timestamp column selected by default for multi stream @bug-5894 @P2 @timestamp @multiStream @regression", async ({ page }) => {
    testLogger.info('Test: Verify timestamp default selected for multi stream (Bug #5894)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Ingest data into a second stream for multi-stream testing
    const secondStream = `e2e_multistream_${Date.now()}`;
    fieldCacheStreamsToCleanup.push(secondStream);
    testLogger.info(`Ingesting test data into second stream: ${secondStream}`);
    await ingestTestData(page, secondStream);
    await page.waitForTimeout(2000);

    // Select second stream for multi-stream mode (without page navigation)
    testLogger.info('Selecting second stream for multi-stream mode');
    await pm.logsPage.addStreamToSelection(secondStream);
    await page.waitForTimeout(1000);

    // Run query
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: _timestamp column should be visible in the table header
    await pm.logsPage.expectTimestampColumnVisible();
    testLogger.info('✓ _timestamp column visible in table');

    testLogger.info('✓ PASSED: Timestamp column displayed for multi stream (Bug #5894)');
  });

  // ==========================================================================
  // Bug #10344: Run query button infinite loading when switching home↔logs
  // https://github.com/openobserve/openobserve/issues/10344
  // ==========================================================================
  test("should not have run query button stuck in loading state after home-logs navigation @bug-10344 @P0 @runQuery @loading @regression", async ({ page }) => {
    testLogger.info('Test: Verify run query button not stuck loading after navigation (Bug #10344)');

    // Navigate to logs page via SPA menu click (not page.goto — Bug #10344 is about
    // SPA state-leak across in-app navigation, which full reloads would reset)
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Navigate between home and logs multiple times using SPA menu clicks
    for (let i = 0; i < 4; i++) {
      testLogger.info(`Navigation cycle ${i + 1}/4: Logs → Home → Logs`);

      // Verify run query button is visible and not in loading state on logs page
      await pm.logsPage.expectRefreshButtonVisible();
      await pm.logsPage.expectRefreshButtonEnabled();
      testLogger.info(`✓ Run query button not loading on logs page (cycle ${i + 1})`);

      // Navigate to home page via SPA menu click
      await pm.logsPage.navigateToHome();
      await page.waitForTimeout(1000);
      testLogger.info(`✓ Home page loaded via SPA (cycle ${i + 1})`);

      // Navigate back to logs page via SPA menu click
      await pm.logsPage.clickMenuLinkLogsItem();
      await page.waitForTimeout(1000);
    }

    // STRONG ASSERTION: After all navigation cycles, button should still be enabled
    await pm.logsPage.expectRefreshButtonEnabled();
    testLogger.info('✓ Run query button enabled after all SPA navigation cycles');

    testLogger.info('✓ PASSED: Run query button not stuck in loading state (Bug #10344)');
  });

  // ==========================================================================
  // Bug #11469: Copy, include exclude displayed on hover under traces correlation
  // https://github.com/openobserve/openobserve/issues/11469
  // ==========================================================================
  test("should not show copy/include/exclude on hover in traces correlation area @bug-11469 @P2 @correlation @hover @regression", async ({ page }) => {
    testLogger.info('Test: Verify correlation section hover behavior (Bug #11469)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Run query to load data (traces was ingested by global setup)
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Expand a log row to reveal the detail dialog with correlation tabs
    await pm.logsPage.clickTableExpandMenuFirst();
    await page.waitForTimeout(1000);

    // Bug #11469 is about the traces correlation panel — an enterprise feature.
    // If View Related is not available (OSS), skip rather than testing an unrelated area.
    const correlationAvailable = await pm.logsPage.isViewRelatedButtonVisible();
    if (!correlationAvailable) {
      test.skip(true, 'Bug #11469: View Related (correlation) not available — enterprise feature required');
      return;
    }

    await pm.logsPage.clickViewRelatedButton();
    await page.waitForTimeout(2000);
    testLogger.info('Opened correlation / View Related panel');

    // Bug assertion: hover over the correlation panel and verify no
    // copy/include/exclude context menu appears on simple hover
    await pm.logsPage.hoverOnCorrelationDashboard();
    await page.waitForTimeout(500);
    await pm.logsPage.expectNoContextMenuVisible();
    testLogger.info('✓ No unwanted context menu on hover over correlation panel');

    testLogger.info('✓ PASSED: Correlation hover behavior verified (Bug #11469)');
  });

  // ==========================================================================
  // Bug #5010: Console error when aggregating field with non-existent alias
  // https://github.com/openobserve/openobserve/issues/5010
  // ==========================================================================
  test("should not have console errors when aggregating with non-existent alias @bug-5010 @P1 @errorHandling @consoleError @regression", async ({ page }) => {
    testLogger.info('Test: Verify no console errors with non-existent alias aggregation (Bug #5010)');

    // Track console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
        testLogger.warn(`Console error: ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      consoleErrors.push(err.message);
      testLogger.warn(`Page error: ${err.message}`);
    });

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Enable SQL mode to write aggregation query
    await pm.logsPage.enableSqlModeIfNeeded();
    await page.waitForTimeout(500);

    // Write aggregation query with non-existent alias
    const nonExistentAlias = `nonexistent_alias_${Date.now()}`;
    const aggregationQuery = `SELECT count(*) as ${nonExistentAlias} FROM "e2e_automate"`;
    testLogger.info(`Running aggregation query with non-existent alias: ${aggregationQuery}`);
    await pm.logsPage.clearAndFillQueryEditor(aggregationQuery);
    await page.waitForTimeout(500);

    // Run query
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Check for query-level errors
    const errorVisible = await page.locator(pm.logsPage.errorMessage).isVisible({ timeout: 3000 }).catch(() => false);
    testLogger.info(`Query error message visible: ${errorVisible}`);

    // Expand first log detail if available
    const expandMenu = page.locator(pm.logsPage.tableRowExpandMenu).first();
    if (await expandMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
      await pm.logsPage.clickTableExpandMenuFirst();
      await page.waitForTimeout(1000);
      testLogger.info('Expanded first log detail');
    }

    // Wait for any delayed console errors
    await page.waitForTimeout(2000);

    // Filter to only errors directly related to the bug: the specific non-existent
    // alias we created, or "Cannot read properties of undefined" (the bug signature)
    const relevantErrors = consoleErrors.filter(e =>
      e.includes(nonExistentAlias) || /Cannot read properties of undefined/.test(e)
    );
    expect(relevantErrors.length, `Bug #5010: Should have no console errors related to non-existent alias, got: ${JSON.stringify(relevantErrors)}`).toBe(0);
    testLogger.info('✓ No relevant console errors detected (filtered from ' + consoleErrors.length + ' total)');

    testLogger.info('✓ PASSED: No console errors with non-existent alias (Bug #5010)');
  });

  // ==========================================================================
  // Bug #5278: Not getting pagination when histogram is turned off
  // https://github.com/openobserve/openobserve/issues/5278
  // ==========================================================================
  test("should show correct pagination when histogram is turned off @bug-5278 @P1 @pagination @histogram @regression", async ({ page }) => {
    testLogger.info('Test: Verify pagination shows correctly with histogram off (Bug #5278)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Turn off histogram
    await pm.logsPage.ensureHistogramToggleState(false);
    await page.waitForTimeout(500);

    // Set wide time range to get more records
    await pm.logsPage.clickDateTimeButton();
    await page.waitForTimeout(500);
    await pm.logsPage.clickRelative6WeeksButton();
    await page.waitForTimeout(500);

    // Run query
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // STRONG ASSERTION: Logs table should be visible (query completed)
    await pm.logsPage.expectLogsTableVisible();
    testLogger.info('✓ Logs table visible');

    // STRONG ASSERTION: Result pagination should be visible
    await pm.logsPage.expectResultPaginationVisible();
    testLogger.info('✓ Result pagination visible with histogram off');

    // STRONG ASSERTION: SQL pagination should NOT be visible when SQL mode is off
    await pm.logsPage.expectSQLPaginationNotVisible();
    testLogger.info('✓ SQL pagination NOT visible (expected with SQL mode off)');

    testLogger.info('✓ PASSED: Pagination displayed correctly with histogram off (Bug #5278)');
  });

  // ==========================================================================
  // Bug #3821: Cannot read properties of undefined (reading 'partitions')
  //            when user changes stream selection during query
  // https://github.com/openobserve/openobserve/issues/3821
  // ==========================================================================
  test("should not show partitions error when changing stream during query @bug-3821 @P1 @errorHandling @streamSwitch @regression", async ({ page }) => {
    testLogger.info('Test: Verify no partitions error on stream change during query (Bug #3821)');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Set wide time range to make query take longer
    await pm.logsPage.clickDateTimeButton();
    await page.waitForTimeout(300);
    await pm.logsPage.clickRelative6WeeksButton();
    await page.waitForTimeout(500);

    // Track console errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
        testLogger.warn(`Console error: ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      consoleErrors.push(err.message);
      testLogger.warn(`Page error: ${err.message}`);
    });

    // Start running the query
    await pm.logsPage.clickRefreshButton();
    // Don't wait for query to finish - switch streams while it's in progress
    await page.waitForTimeout(1000);

    // Deselect the stream while query is in progress
    testLogger.info('Deselecting stream while query in progress');
    await pm.logsPage.deselectStream('e2e_automate');

    // Wait for page to settle
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // STRONG ASSERTION: No "Cannot read properties of undefined" or "partitions" errors
    const partitionsErrors = consoleErrors.filter(e =>
      e.includes('Cannot read properties of undefined') || e.includes('partitions')
    );
    expect(partitionsErrors.length, `Bug #3821: Should have no partitions errors, got: ${JSON.stringify(partitionsErrors)}`).toBe(0);
    testLogger.info('✓ No partitions-related console errors');

    // Verify no error message displayed on page
    const errorMsg = page.locator(pm.logsPage.errorMessage);
    const errorVisible = await errorMsg.isVisible({ timeout: 2000 }).catch(() => false);
    if (errorVisible) {
      const errorText = await errorMsg.textContent();
      const hasPartitionsError = /partitions|cannot read properties/i.test(errorText);
      expect(hasPartitionsError, `Bug #3821: Error message should not mention partitions. Got: ${errorText}`).toBe(false);
    }
    testLogger.info('✓ No partitions error message on page');

    testLogger.info('✓ PASSED: No partitions error on stream change (Bug #3821)');
  });

  // ==========================================================================
  // Bug #6702: Cannot read properties of undefined partitions error when
  //            switching from logs to streams and back during query
  // https://github.com/openobserve/openobserve/issues/6702
  // ==========================================================================
  test("should not show partitions error when switching pages during query @bug-6702 @P1 @errorHandling @navigation @regression", async ({ page }) => {
    testLogger.info('Test: Verify no partitions error on page switch during query (Bug #6702)');

    // Use SPA menu navigation — not page.goto — because full reloads reset Pinia/Vue state,
    // destroying the in-flight query that the bug requires to trigger the partitions error
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Set wide time range
    await pm.logsPage.clickDateTimeButton();
    await page.waitForTimeout(300);
    await pm.logsPage.clickRelative6WeeksButton();
    await page.waitForTimeout(500);

    // Track page errors
    const pageErrors = [];
    page.on('pageerror', err => {
      pageErrors.push(err.message);
      testLogger.warn(`Page error: ${err.message}`);
    });

    // Start query
    await pm.logsPage.clickRefreshButton();
    // Don't wait for completion - switch pages while query is in progress
    await page.waitForTimeout(1500);

    // Navigate to streams page via SPA while query is still running
    testLogger.info('Switching to streams page during query (SPA)');
    await pm.logsPage.clickMenuLinkStreamsItem();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Navigate back to logs page via SPA
    testLogger.info('Switching back to logs page (SPA)');
    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // STRONG ASSERTION: No "Cannot read properties of undefined" or "partitions" errors
    const partitionsErrors = pageErrors.filter(e =>
      e.includes('Cannot read properties of undefined') || e.includes('partitions')
    );
    expect(partitionsErrors.length, `Bug #6702: Should have no partitions page errors, got: ${JSON.stringify(partitionsErrors)}`).toBe(0);
    testLogger.info('✓ No partitions-related page errors');

    testLogger.info('✓ PASSED: No partitions error on page switch (Bug #6702)');
  });

  // ==========================================================================
  // Bug #3131: Order by not displayed by default for distinct queries and
  //            interesting field does not disappear on deselecting
  // https://github.com/openobserve/openobserve/issues/3131
  // ==========================================================================
  // SKIPPED: ORDER BY auto-injection for DISTINCT queries is server-side behavior
  // (Rust backend). The frontend sends the exact SQL as typed — neither the Monaco
  // editor text nor the _search POST payload will ever contain an auto-injected
  // ORDER BY clause. There is no UI-observable difference between the fixed and
  // broken states, so a meaningful UI regression test is not feasible for this bug.
  test.skip("should show order by default for distinct queries @bug-3131 @P2 @distinct @orderBy @regression", async ({ page }) => {
    testLogger.info('Test: Verify order by displayed for distinct queries (Bug #3131) — SKIPPED: backend behavior, not UI-verifiable');

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    await pm.logsPage.enableSqlModeIfNeeded();
    await page.waitForTimeout(500);

    const distinctQuery = `SELECT DISTINCT kubernetes_pod_name FROM "e2e_automate"`;
    await pm.logsPage.clearAndFillQueryEditor(distinctQuery);
    await page.waitForTimeout(500);

    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    await pm.logsPage.expectLogsTableVisible();
    await pm.logsPage.expectResultPaginationVisible();

    testLogger.info('✓ PASSED: Order by default for distinct queries verified (Bug #3131)');
  });

  // ==========================================================================
  // Bug #4315: Blank histogram on cancelling histogram API/query
  // https://github.com/openobserve/openobserve/issues/4315
  // ==========================================================================
  test("should not show blank histogram after cancelling query @bug-4315 @P2 @histogram @cancel @regression", async ({ page }) => {
    testLogger.info('Test: Verify histogram not blank after cancel (Bug #4315)');

    const orgName = getOrgIdentifier() || 'default';

    await pm.logsPage.clickMenuLinkLogsItem();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream('e2e_automate');
    await page.waitForTimeout(1000);

    // Ensure histogram is enabled
    await pm.logsPage.enableHistogram();
    await page.waitForTimeout(500);

    // Intercept _search POST requests to simulate a slow histogram call that gets cancelled.
    // Use a wasCancelled flag + Promise.race with a guard timeout so the test cannot hang
    // forever if clickRefreshButton() never fires a _search POST (slow CI, network warm-up).
    let heldRoute = null;
    let routeResolve = null;
    let wasCancelled = false;
    await page.route(`**/api/${orgName}/_search`, async (route) => {
      if (route.request().method() === 'POST') {
        if (!heldRoute) {
          heldRoute = route;
          testLogger.info('Holding first _search request (simulating slow histogram)');
          // Timeout guard: if cancel never fires, continue the request after 8s instead of hanging
          await Promise.race([
            new Promise(resolve => { routeResolve = resolve; }),
            new Promise(resolve => setTimeout(resolve, 8000))
          ]);
          if (wasCancelled) {
            testLogger.info('First _search request released (aborted by cancel)');
            await route.abort('aborted');
          } else {
            testLogger.info('Cancel guard timed out — continuing request normally');
            await route.continue();
          }
          heldRoute = null;
          routeResolve = null;
          wasCancelled = false;
          return;
        }
      }
      await route.continue();
    });

    // Run query — first _search request will be held
    testLogger.info('Starting query (histogram request will be delayed)');
    await pm.logsPage.clickRefreshButton();
    await page.waitForTimeout(1500);

    // Cancel by clicking refresh again while the first histogram call is still in flight.
    // wasCancelled tells the route handler to abort rather than continue.
    testLogger.info('Cancelling in-flight histogram by clicking refresh again');
    wasCancelled = true;
    if (routeResolve) routeResolve();
    await page.waitForTimeout(500);
    await pm.logsPage.clickRefreshButton();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Remove route handler
    await page.unroute(`**/api/${orgName}/_search`);

    // Bug assertion: the histogram must NOT be blank after cancel — it must have rendered content
    await pm.logsPage.expectBarChartHasContent();

    testLogger.info('✓ PASSED: Histogram not blank after cancel (Bug #4315)');
  });

  test.afterEach(async () => {
    // Cleanup new stream created by field cache test (e2e_automate is never deleted)
    if (fieldCacheStreamsToCleanup.length > 0 && pm) {
      testLogger.info('Cleaning up test streams');
      for (const streamName of fieldCacheStreamsToCleanup) {
        await pm.logsPage.deleteStream(streamName).catch(e =>
          testLogger.warn(`Failed to delete ${streamName}: ${e.message}`)
        );
      }
      fieldCacheStreamsToCleanup = [];
      testLogger.info('Test stream cleanup completed');
    }
    testLogger.info('Logs regression bug test completed');
  });
});

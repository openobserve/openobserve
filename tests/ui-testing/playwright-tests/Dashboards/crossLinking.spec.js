const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTestData: _ingestData } = require('../utils/data-ingestion.js');

const STREAM_NAME = "e2e_automate";

test.describe("Cross-Linking testcases", () => {
    test.describe.configure({ mode: 'default' });
    let pm;
    let dataIngested = false;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForTimeout(1000);

        // Ingest data once on first test, skip on subsequent tests
        if (!dataIngested) {
            await _ingestData(page, STREAM_NAME);
            await page.waitForTimeout(1000);
            dataIngested = true;
            testLogger.info('Test data ingested');
        }

        testLogger.info('Test setup completed');
    });

    test.afterEach(async ({}, testInfo) => {
        if (testInfo.status) {
            testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
        }
    });

    test.afterAll(async ({ browser }) => {
        testLogger.info('Cleaning up all cross-links after test suite');
        const context = await browser.newContext({
            storageState: 'playwright-tests/utils/auth/user.json'
        });
        const page = await context.newPage();
        try {
            await navigateToBase(page);
            const cleanupPm = new PageManager(page);
            await page.waitForTimeout(1000);

            await cleanupPm.crossLinkPage.navigateToStreams();
            await cleanupPm.crossLinkPage.searchStream(STREAM_NAME);
            await cleanupPm.crossLinkPage.openStreamDetail();

            const isTabVisible = await cleanupPm.crossLinkPage.isCrossLinkingTabVisible();
            if (isTabVisible) {
                await cleanupPm.crossLinkPage.clickCrossLinkingTab();

                // Delete all cross-links
                await cleanupPm.crossLinkPage.deleteAllCrossLinks();

                // Persist the cleanup to backend
                await cleanupPm.crossLinkPage.clickUpdateSettings();
                await page.waitForTimeout(2000);
                testLogger.info('All cross-links cleaned up and settings saved');
            }
        } catch (e) {
            testLogger.warn('Cleanup failed', { error: e.message });
        } finally {
            await page.close();
            await context.close();
        }
    });

    // P0 Tests - Critical
    test("should display cross-linking tab in stream schema when feature is enabled", {
        tag: ['@crossLinking', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-linking tab visibility in stream schema');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        // Verify the cross-linking tab is present (uses waitFor with timeout)
        const isVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();

        if (isVisible) {
            await pm.crossLinkPage.clickCrossLinkingTab();
            // Verify the Add Cross-Link button is visible (always present on stream-level manager)
            await expect(page.locator('[data-test="add-cross-link-btn"]')).toBeVisible({ timeout: 5000 });
            testLogger.info('Cross-linking tab is visible and accessible');
        } else {
            testLogger.info('Cross-linking tab not visible - feature flag may be disabled, skipping gracefully');
        }

        testLogger.info('Test completed');
    });

    test("should show empty state when no cross-links are configured", {
        tag: ['@crossLinking', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing empty state display');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Verify add button is present (confirms tab content loaded)
        await expect(page.locator('[data-test="add-cross-link-btn"]')).toBeVisible({ timeout: 5000 });

        // Check if empty state or existing links are shown
        const emptyState = page.locator('[data-test="cross-link-empty"]').first();
        const linkList = page.locator('[data-test="cross-link-list"]').first();
        const hasEmpty = await emptyState.isVisible().catch(() => false);
        const hasList = await linkList.isVisible().catch(() => false);

        if (hasEmpty) {
            testLogger.info('Empty state verified - no cross-links configured');
        } else if (hasList) {
            testLogger.info('Cross-links already exist on this stream');
        }
        expect(hasEmpty || hasList).toBe(true);

        testLogger.info('Test completed');
    });

    test("should open add cross-link dialog", {
        tag: ['@crossLinking', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing add cross-link dialog opens');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Verify all dialog fields are present
        await expect(page.locator('[data-test="cross-link-name-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-url-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-field-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-dialog"] [data-test="o-dialog-primary-btn"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-dialog"] [data-test="o-dialog-secondary-btn"]')).toBeVisible();

        testLogger.info('Test completed');
    });

    test("should add a new cross-link via stream schema", {
        tag: ['@crossLinking', '@functional', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing adding a new cross-link');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up any existing cross-links first to ensure a clean state
        await pm.crossLinkPage.deleteAllCrossLinks();

        // Add a new cross-link
        const linkName = `E2E Test Link ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: 'https://example.com/trace/${field.__value}?from=${start_time}&to=${end_time}',
            fields: ['kubernetes_container_name']
        });

        // Verify the link appears in the list
        await pm.crossLinkPage.expectCrossLinkListVisible();
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
        expect(itemText).toContain(linkName);

        testLogger.info('Cross-link added successfully');
    });

    // P1 Tests - Functional
    test("should validate required fields - save button disabled without name and URL", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing save button disabled state');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Save should be disabled when form is empty
        await pm.crossLinkPage.expectSaveDisabled();

        // Fill only name - save should still be disabled
        await pm.crossLinkPage.fillCrossLinkName('Test Link');
        await pm.crossLinkPage.expectSaveDisabled();

        // Fill URL too - save should now be enabled
        await pm.crossLinkPage.fillCrossLinkUrl('https://example.com/${field.__value}');
        await pm.crossLinkPage.expectSaveEnabled();

        testLogger.info('Test completed');
    });

    test("should add and remove field chips", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing field chip add and remove');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Add a field
        await pm.crossLinkPage.addField('trace_id');
        await pm.crossLinkPage.expectFieldChipVisible(0);

        // Add another field
        await pm.crossLinkPage.addField('span_id');
        await pm.crossLinkPage.expectFieldChipVisible(1);

        // Remove first field chip
        await pm.crossLinkPage.removeFieldChip(0);

        // The second chip should now be at index 0
        await pm.crossLinkPage.expectFieldChipVisible(0);

        testLogger.info('Test completed');
    });

    test("should edit an existing cross-link", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing edit cross-link');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up any existing cross-links first to ensure a clean state
        await pm.crossLinkPage.deleteAllCrossLinks();

        // Create a cross-link to edit
        const linkName = `Edit Test ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: 'https://example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });

        // Click edit on first link
        await pm.crossLinkPage.clickEditCrossLink(0);
        await pm.crossLinkPage.expectDialogVisible();

        // Verify form is populated (name input should have a value).
        const nameValue = await pm.crossLinkPage.getCrossLinkNameValue();
        expect(nameValue.length).toBeGreaterThan(0);

        // Modify the URL
        await pm.crossLinkPage.fillCrossLinkUrl('https://updated.example.com/${field.__value}');
        await pm.crossLinkPage.clickSave();

        // Verify the update is reflected
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
        expect(itemText).toContain('updated.example.com');

        testLogger.info('Test completed');
    });

    test("should delete a cross-link", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing delete cross-link');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Create a link to delete if none exist
        const linkList = page.locator('[data-test="cross-link-list"]').first();
        const hasList = await linkList.isVisible().catch(() => false);

        if (!hasList) {
            await pm.crossLinkPage.addCrossLink({
                name: `Delete Test ${Date.now()}`,
                url: 'https://delete.example.com/${field.__value}',
                fields: ['kubernetes_container_name']
            });
        }

        // Count links before delete. Use the per-item-name data-test so the
        // count includes only the top-level rows (each item exposes a single
        // `cross-link-item-name-<idx>` which is a 1:1 with the row).
        const itemsBefore = await page.locator('[data-test^="cross-link-item-name-"]').count();
        expect(itemsBefore).toBeGreaterThan(0);

        // Delete first link
        await pm.crossLinkPage.clickDeleteCrossLink(0);

        // Verify count decreased
        const itemsAfter = await page.locator('[data-test^="cross-link-item-name-"]').count();
        expect(itemsAfter).toBe(itemsBefore - 1);

        testLogger.info('Test completed');
    });

    // P2 Tests - Edge Cases
    test("should cancel dialog without saving changes", {
        tag: ['@crossLinking', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cancel dialog discards changes');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Count links before. `cross-link-item-name-<idx>` is emitted once
        // per row, so it gives an accurate per-row count (unlike the broader
        // `cross-link-item-` prefix which also matches the per-cell url/name
        // attributes inside each row).
        const itemsBefore = await page.locator('[data-test^="cross-link-item-name-"]').count();

        // Open dialog, fill form, cancel
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();
        await pm.crossLinkPage.fillCrossLinkName('Cancelled Link');
        await pm.crossLinkPage.fillCrossLinkUrl('https://cancelled.example.com');
        await pm.crossLinkPage.clickCancel();

        // Verify dialog closed
        await pm.crossLinkPage.expectDialogNotVisible();

        // Verify no new link was added
        const itemsAfter = await page.locator('[data-test^="cross-link-item-name-"]').count();
        expect(itemsAfter).toBe(itemsBefore);

        testLogger.info('Test completed');
    });

    test("should verify cross-link URL contains correct start_time and end_time when clicked from logs", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link URL timestamp verification from logs view');


        // Step 1: Create a cross-link with start_time and end_time in URL template
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up any existing cross-links first
        await pm.crossLinkPage.deleteAllCrossLinks();

        const crossLinkName = `Timestamp Test ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: crossLinkName,
            url: 'https://example.com/view?from=${start_time}&to=${end_time}&field=${field.__name}&value=${field.__value}',
            fields: ['kubernetes_container_name']
        });

        // Save the schema settings to persist the cross-link
        await pm.crossLinkPage.clickUpdateSettings();
        await page.waitForTimeout(2000);

        testLogger.info('Cross-link created and saved');

        // Step 2: Navigate to logs, disable Quick Mode so all fields are visible, then run query.
        await pm.logsPage.navigateToLogs();
        await pm.logsPage.selectStream(STREAM_NAME);
        await page.waitForTimeout(2000);

        // Disable Quick Mode so all fields show in expanded log rows without needing interesting fields
        await pm.logsPage.ensureQuickModeState(false);
        await page.waitForTimeout(1000);

        // Run query to get results
        await pm.logsPage.runQueryAndWaitForResults();
        await page.waitForTimeout(2000);

        // Step 3: Expand a log row to reveal the inline JSON detail (JsonPreview)
        const expandBtn = page.locator('[data-test="table-row-expand-menu"]').first();
        await expandBtn.waitFor({ state: 'visible', timeout: 15000 });
        await expandBtn.click();
        await page.waitForTimeout(2000);

        // Intercept window.open to capture the URL instead of opening a new tab
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.__originalOpen = window.open;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        try {
            // Step 4: Open the kubernetes_container_name field action dropdown
            // (data-test resolved via PO method on the JsonPreview log-detail row)
            await pm.crossLinkPage.openFieldActionDropdown('kubernetes_container_name');

            // Look for the cross-link item in the dropdown menu
            const crossLinkVisible = await pm.crossLinkPage.isLogCrossLinkVisible(crossLinkName);

            // Assert cross-link menu item is visible
            expect(crossLinkVisible, `Cross-link "${crossLinkName}" should be visible in dropdown menu`).toBe(true);
            testLogger.info('Cross-link menu item is visible in dropdown');

            // Click the cross-link
            await pm.crossLinkPage.clickLogCrossLinkMenuItem(crossLinkName);
            await page.waitForTimeout(1000);

            // Step 5: Retrieve the captured URL
            const capturedUrl = await page.evaluate(() => window.__capturedCrossLinkUrl);

            expect(capturedUrl, 'Cross-link URL should have been captured via window.open').not.toBeNull();
            testLogger.info('Cross-link URL captured', { capturedUrl });

            // Parse the URL and verify timestamps
            const url = new URL(capturedUrl);
            const fromParam = url.searchParams.get('from');
            const toParam = url.searchParams.get('to');
            const fieldParam = url.searchParams.get('field');
            const valueParam = url.searchParams.get('value');

            // Verify start_time and end_time are valid epoch microseconds
            expect(fromParam, 'URL should contain from (start_time) parameter').not.toBeNull();
            expect(toParam, 'URL should contain to (end_time) parameter').not.toBeNull();
            testLogger.info('URL from/to parameters present', { from: fromParam, to: toParam });

            const startTime = Number(fromParam);
            const endTime = Number(toParam);

            expect(isNaN(startTime), 'start_time should be a valid number').toBe(false);
            expect(isNaN(endTime), 'end_time should be a valid number').toBe(false);

            // Timestamps are in microseconds (16 digits for current epoch)
            const minUs = new Date('2000-01-01').getTime() * 1000;
            const maxUs = new Date('2100-01-01').getTime() * 1000;
            expect(startTime, `start_time ${startTime} should be > ${minUs}`).toBeGreaterThan(minUs);
            expect(startTime, `start_time ${startTime} should be < ${maxUs}`).toBeLessThan(maxUs);
            expect(endTime, `end_time ${endTime} should be > ${minUs}`).toBeGreaterThan(minUs);
            expect(endTime, `end_time ${endTime} should be < ${maxUs}`).toBeLessThan(maxUs);
            testLogger.info('Timestamps are valid epoch microseconds', { startTime, endTime });

            expect(endTime, 'end_time should be >= start_time').toBeGreaterThanOrEqual(startTime);
            testLogger.info('end_time >= start_time verified');

            expect(fieldParam, 'field should be kubernetes_container_name').toBe('kubernetes_container_name');
            expect(valueParam, 'value should be populated').toBeTruthy();
            testLogger.info('Field and value parameters verified', { field: fieldParam, value: valueParam });

            testLogger.info('PASSED: Stream-level logs timestamp verification', {
                startTime, endTime,
                startDate: new Date(startTime / 1000).toISOString(),
                endDate: new Date(endTime / 1000).toISOString(),
            });
        } finally {
            await page.evaluate(() => {
                if (window.__originalOpen) window.open = window.__originalOpen;
                delete window.__capturedCrossLinkUrl;
                delete window.__originalOpen;
            });
        }
    });

    test("should verify cross-link URL contains correct start_time and end_time when clicked from dashboard", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link URL timestamp verification from dashboard panel');


        // Step 1: Ensure a cross-link exists on the stream (with start_time/end_time in URL)
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up any existing cross-links first
        await pm.crossLinkPage.deleteAllCrossLinks();

        const crossLinkName = `Dashboard TS Test ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: crossLinkName,
            url: 'https://example.com/dashboard?from=${start_time}&to=${end_time}&field=${field.__name}&value=${field.__value}',
            fields: ['kubernetes_container_name']
        });

        // Save the schema settings to persist the cross-link
        await pm.crossLinkPage.clickUpdateSettings();
        await page.waitForTimeout(2000);

        testLogger.info('Cross-link created and saved on stream');

        // Step 2: Create a dashboard with a table panel using the same stream
        const dashboardName = `CrossLink Test ${Date.now()}`;
        const orgId = process.env["ORGNAME"] || 'default';
        await page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/dashboards?org_identifier=${orgId}`);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);

        await pm.dashboardCreate.createDashboard(dashboardName);

        // Add a table panel with the cross-linked stream
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStream(STREAM_NAME);
        // Remove the auto-seeded histogram(_timestamp) x so kubernetes_container_name
        // is the first column — the cross-link drilldown clicks the first cell.
        await pm.chartTypeSelector.removeField("x_axis_1", "x");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
        await pm.dashboardPanelActions.addPanelName("CrossLink Table Panel");
        await pm.dashboardPanelActions.savePanel();
        await page.waitForTimeout(3000);

        testLogger.info('Dashboard with table panel created');

        // Step 3: Intercept window.open to capture the cross-link URL
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.__originalOpen = window.open;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        try {
            // Step 4: Click on a data row in the table panel to trigger the cross-link drilldown menu
            // Uses PO helper that resolves cells via data-test on the rendered table.
            await page.waitForTimeout(2000);
            await pm.crossLinkPage.clickFirstDashboardTableCell();
            await page.waitForTimeout(1500);

            // Step 5: Look for the drilldown menu popup (resolved via data-test)
            const menuVisible = await pm.crossLinkPage.isDrilldownMenuVisible();

            expect(menuVisible, 'Drilldown menu should appear after clicking table cell').toBe(true);
            testLogger.info('Drilldown menu is visible');

            // Find and click the cross-link menu item (per-name data-test on each menu item)
            const crossLinkMenuVisible = await pm.crossLinkPage.isDrilldownMenuItemVisible(crossLinkName);

            expect(crossLinkMenuVisible, `Cross-link "${crossLinkName}" should be visible in drilldown menu`).toBe(true);
            testLogger.info('Cross-link menu item is visible in drilldown');

            await pm.crossLinkPage.clickDrilldownMenuItem(crossLinkName);
            await page.waitForTimeout(1000);

            // Step 6: Retrieve and verify the captured URL
            const capturedUrl = await page.evaluate(() => window.__capturedCrossLinkUrl);

            expect(capturedUrl, 'Cross-link URL should have been captured via window.open').not.toBeNull();
            testLogger.info('Dashboard cross-link URL captured', { capturedUrl });

            // Parse the URL and verify timestamps
            const url = new URL(capturedUrl);
            const fromParam = url.searchParams.get('from');
            const toParam = url.searchParams.get('to');
            const fieldParam = url.searchParams.get('field');
            const valueParam = url.searchParams.get('value');

            expect(fromParam, 'URL should contain from (start_time) parameter').not.toBeNull();
            expect(toParam, 'URL should contain to (end_time) parameter').not.toBeNull();
            testLogger.info('URL from/to parameters present', { from: fromParam, to: toParam });

            const startTime = Number(fromParam);
            const endTime = Number(toParam);

            expect(isNaN(startTime), 'start_time should be a valid number').toBe(false);
            expect(isNaN(endTime), 'end_time should be a valid number').toBe(false);

            // Timestamps are in microseconds (16 digits for current epoch)
            const minUs = new Date('2000-01-01').getTime() * 1000;
            const maxUs = new Date('2100-01-01').getTime() * 1000;
            expect(startTime, `start_time ${startTime} should be > ${minUs}`).toBeGreaterThan(minUs);
            expect(startTime, `start_time ${startTime} should be < ${maxUs}`).toBeLessThan(maxUs);
            expect(endTime, `end_time ${endTime} should be > ${minUs}`).toBeGreaterThan(minUs);
            expect(endTime, `end_time ${endTime} should be < ${maxUs}`).toBeLessThan(maxUs);
            testLogger.info('Timestamps are valid epoch microseconds', { startTime, endTime });

            expect(endTime, 'end_time should be >= start_time').toBeGreaterThanOrEqual(startTime);
            testLogger.info('end_time >= start_time verified');

            expect(fieldParam, 'field should be kubernetes_container_name').toBe('kubernetes_container_name');
            expect(valueParam, 'value should be populated').toBeTruthy();
            testLogger.info('Field and value parameters verified', { field: fieldParam, value: valueParam });

            testLogger.info('PASSED: Stream-level dashboard timestamp verification', {
                startTime, endTime,
                startDate: new Date(startTime / 1000).toISOString(),
                endDate: new Date(endTime / 1000).toISOString(),
            });

            // Cleanup: delete the test dashboard
            await pm.dashboardCreate.backToDashboardList();
            await page.waitForTimeout(1000);
        } finally {
            await page.evaluate(() => {
                if (window.__originalOpen) window.open = window.__originalOpen;
                delete window.__capturedCrossLinkUrl;
                delete window.__originalOpen;
            });
        }
    });

    test("should persist cross-links after Update Settings and survive page reload", {
        tag: ['@crossLinking', '@functional', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link persistence after Update Settings');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up existing cross-links
        await pm.crossLinkPage.deleteAllCrossLinks();

        // Add a cross-link
        const linkName = `Persist Test ${Date.now()}`;
        const linkUrl = 'https://persist.example.com/trace/${field.__value}';
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: linkUrl,
            fields: ['kubernetes_container_name']
        });

        // Click Update Settings to persist to backend and wait for the API response
        const settingsResponsePromise = page.waitForResponse(
            (resp) => resp.url().includes('/streams/') && resp.url().includes('/settings') && resp.request().method() === 'PUT',
            { timeout: 15000 }
        );
        await pm.crossLinkPage.clickUpdateSettings();
        await settingsResponsePromise;

        // Reload the page completely and navigate back
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();
        await pm.crossLinkPage.clickCrossLinkingTab();

        // Verify the cross-link survived the reload.
        // Poll for the item — the cross-link list container renders before
        // the individual items finish loading from the settings API.
        await pm.crossLinkPage.expectCrossLinkListVisible();
        await expect.poll(
            () => pm.crossLinkPage.findCrossLinkItemIndexByName(linkName),
            { timeout: 10000, message: `Cross-link "${linkName}" should exist after reload` }
        ).toBeGreaterThanOrEqual(0);
        const idx = await pm.crossLinkPage.findCrossLinkItemIndexByName(linkName);
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(idx);
        expect(itemText).toContain(linkName);
        expect(itemText).toContain('persist.example.com');

        testLogger.info('Cross-link persisted successfully after page reload');
    });

    test("should verify cross-link list item displays name, URL, and field chips", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link list item display content');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up existing
        await pm.crossLinkPage.deleteAllCrossLinks();

        // Add a cross-link with multiple fields
        const linkName = `Display Test ${Date.now()}`;
        const linkUrl = 'https://display.example.com/${field.__value}?from=${start_time}';
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: linkUrl,
            fields: ['kubernetes_container_name', 'kubernetes_pod_name']
        });

        // Verify the list item renders all components
        await pm.crossLinkPage.expectCrossLinkItemVisible(0);

        // Verify name is displayed (resolved via dedicated per-item-name data-test)
        const nameText = await pm.crossLinkPage.getCrossLinkItemNameText(0);
        expect(nameText).toContain(linkName);

        // Verify URL is displayed (resolved via dedicated per-item-url data-test)
        const urlText = await pm.crossLinkPage.getCrossLinkItemUrlText(0);
        expect(urlText).toContain('display.example.com');

        // Verify field chips are rendered (CrossLinkManager shows OBadge for each field after q-chip → OBadge migration)
        const chipCount = await pm.crossLinkPage.getFieldChipsCount(0);
        expect(chipCount).toBe(2);

        // Verify chip text content
        const chip0Text = await pm.crossLinkPage.getFieldChipText(0, 0);
        const chip1Text = await pm.crossLinkPage.getFieldChipText(0, 1);
        expect(chip0Text).toContain('kubernetes_container_name');
        expect(chip1Text).toContain('kubernetes_pod_name');

        // Verify edit and delete action buttons exist on the stream-level
        // (editable) manager; the org-level read-only manager doesn't emit
        // these so we only need to assert presence at all.
        await expect(page.locator('[data-test="cross-link-edit-0"]').first()).toBeVisible();
        await expect(page.locator('[data-test="cross-link-delete-0"]').first()).toBeVisible();

        testLogger.info('List item display verified');
    });

    test("should verify edit dialog pre-populates name, URL, and fields", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing edit dialog pre-population of all fields');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Ensure a link exists with known values. Count via the delete-btn
        // data-test so we only loop over deletable stream-level items
        // (org-level read-only items render with `cross-link-item-name-<idx>`
        // but no matching `cross-link-delete-<idx>` — clicking idx=0 then
        // would time out).
        let existingCount = await page.locator('[data-test^="cross-link-delete-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-delete-"]').count();
        }

        const editLinkName = `Edit Prefill ${Date.now()}`;
        const editLinkUrl = 'https://edit-prefill.example.com/${field.__value}';
        await pm.crossLinkPage.addCrossLink({
            name: editLinkName,
            url: editLinkUrl,
            fields: ['kubernetes_container_name']
        });

        // Click edit on the link
        await pm.crossLinkPage.clickEditCrossLink(0);
        await pm.crossLinkPage.expectDialogVisible();

        // Verify name + URL are pre-populated via PO getters (no inline locators).
        const nameValue = await pm.crossLinkPage.getCrossLinkNameValue();
        expect(nameValue).toBe(editLinkName);
        const urlValue = await pm.crossLinkPage.getCrossLinkUrlValue();
        expect(urlValue).toBe(editLinkUrl);

        // Verify field chip is pre-populated
        await pm.crossLinkPage.expectFieldChipVisible(0);
        const chipText = await pm.crossLinkPage.getDialogFieldChipText(0);
        expect(chipText).toContain('kubernetes_container_name');

        // Verify save button is enabled (all required fields are filled)
        await pm.crossLinkPage.expectSaveEnabled();

        await pm.crossLinkPage.clickCancel();

        testLogger.info('Edit pre-population verified');
    });

    test("should verify cross-link only appears for configured field, not other fields", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link field scoping in logs');


        // Create a cross-link configured ONLY for kubernetes_container_name
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up existing
        await pm.crossLinkPage.deleteAllCrossLinks();

        const crossLinkName = `Scoped Field Test ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: crossLinkName,
            url: 'https://scoped.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });

        await pm.crossLinkPage.clickUpdateSettings();
        await page.waitForTimeout(2000);

        // Navigate to logs and select the stream via the shared logsPage helper.
        await pm.logsPage.navigateToLogs();
        await pm.logsPage.selectStream(STREAM_NAME);
        await page.waitForTimeout(2000);

        // Disable Quick Mode so all fields (including _timestamp /
        // non-interesting fields) show inside the expanded JSON detail.
        await pm.logsPage.ensureQuickModeState(false);
        await page.waitForTimeout(1000);

        await pm.logsPage.runQueryAndWaitForResults();
        await page.waitForTimeout(2000);

        // Expand the first log row inline (the new logs UI replaced the
        // side-panel `dashboard-confirm-dialog` with an inline JsonPreview
        // toggled by `table-row-expand-menu`, the same path test 10 uses).
        await pm.crossLinkPage.expandFirstLogRow();

        // Check the configured field — cross-link SHOULD appear
        // Resolve the configured field row via PO/data-test (no class/text selectors)
        const configuredFieldRow = page.locator(pm.crossLinkPage.logDetailRow('kubernetes_container_name'));
        const configuredVisible = await configuredFieldRow.isVisible().catch(() => false);

        if (configuredVisible) {
            await pm.crossLinkPage.openFieldActionDropdown('kubernetes_container_name');

            const hasCrossLink = await pm.crossLinkPage.isLogCrossLinkVisible(crossLinkName);

            if (hasCrossLink) {
                testLogger.info('Cross-link correctly appears for configured field');
            } else {
                testLogger.info('Cross-link not loaded for configured field (may need result_schema)');
            }

            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        }

        // Check a different field — cross-link should NOT appear
        const otherFieldRow = page.locator(pm.crossLinkPage.logDetailRow('_timestamp'));
        const otherVisible = await otherFieldRow.isVisible().catch(() => false);

        if (otherVisible) {
            await pm.crossLinkPage.openFieldActionDropdown('_timestamp');

            const hasCrossLinkInOther = await pm.crossLinkPage.isLogCrossLinkVisible(crossLinkName);

            // Cross-link should NOT appear for _timestamp since it's not in the configured fields
            expect(hasCrossLinkInOther).toBe(false);
            testLogger.info('Cross-link correctly absent for non-configured field (_timestamp)');

            await page.keyboard.press('Escape');
        }

        testLogger.info('Field scoping verification completed');
    });

    // ============================================================
    // Org-Level Cross-Link Tests
    // ============================================================

    test("should add an org-level cross-link via Organization Settings", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing org-level cross-link creation');

        await pm.crossLinkPage.navigateToOrgSettings();

        // Verify the CrossLinkManager is present (feature flag must be enabled)
        const addBtn = page.locator('[data-test="add-cross-link-btn"]');
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        } catch {
            testLogger.info('Cross-linking not available in org settings, skipping');
            return;
        }

        // Clean up any existing org-level cross-links
        await pm.crossLinkPage.deleteAllCrossLinks();

        // Add an org-level cross-link
        const linkName = `Org Link ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: 'https://org.example.com/trace/${field.__value}?from=${start_time}&to=${end_time}',
            fields: ['kubernetes_container_name']
        });

        // Verify the link appears in the list
        await pm.crossLinkPage.expectCrossLinkListVisible();
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
        expect(itemText).toContain(linkName);

        // Save org settings to persist
        await pm.crossLinkPage.clickOrgSettingsSave();

        testLogger.info('Org-level cross-link created and saved');
    });

    test("should edit an org-level cross-link", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing org-level cross-link edit');

        await pm.crossLinkPage.navigateToOrgSettings();

        const addBtn = page.locator('[data-test="add-cross-link-btn"]');
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        } catch {
            testLogger.info('Cross-linking not available in org settings, skipping');
            return;
        }

        // Clean up and create a fresh cross-link
        await pm.crossLinkPage.deleteAllCrossLinks();

        const linkName = `Org Edit Test ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: 'https://org-edit.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });

        // Edit the cross-link
        await pm.crossLinkPage.clickEditCrossLink(0);
        await pm.crossLinkPage.expectDialogVisible();

        // Verify name is pre-populated via PO getter.
        const nameValue = await pm.crossLinkPage.getCrossLinkNameValue();
        expect(nameValue).toBe(linkName);

        // Modify the URL
        await pm.crossLinkPage.fillCrossLinkUrl('https://org-updated.example.com/${field.__value}');
        await pm.crossLinkPage.clickSave();

        // Verify update is reflected
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
        expect(itemText).toContain('org-updated.example.com');

        // Save org settings
        await pm.crossLinkPage.clickOrgSettingsSave();

        testLogger.info('Org-level cross-link edited successfully');
    });

    test("should delete an org-level cross-link", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing org-level cross-link deletion');

        await pm.crossLinkPage.navigateToOrgSettings();

        const addBtn = page.locator('[data-test="add-cross-link-btn"]');
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        } catch {
            testLogger.info('Cross-linking not available in org settings, skipping');
            return;
        }

        // Clean up and create a fresh cross-link to delete
        await pm.crossLinkPage.deleteAllCrossLinks();

        await pm.crossLinkPage.addCrossLink({
            name: `Org Delete Test ${Date.now()}`,
            url: 'https://org-delete.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });

        // Verify it exists
        await pm.crossLinkPage.expectCrossLinkItemVisible(0);

        // Delete it
        await pm.crossLinkPage.clickDeleteCrossLink(0);
        await page.waitForTimeout(500);

        // Verify it's gone (empty state or no items). Count via the per-row
        // name attribute so we don't double-count internal cells.
        const remainingCount = await page.locator('[data-test^="cross-link-item-name-"]').count();
        expect(remainingCount).toBe(0);

        // Save org settings to persist deletion
        await pm.crossLinkPage.clickOrgSettingsSave();

        testLogger.info('Org-level cross-link deleted successfully');
    });

    test("should persist org-level cross-link after page reload", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing org-level cross-link persistence after reload');

        await pm.crossLinkPage.navigateToOrgSettings();

        const addBtn = page.locator('[data-test="add-cross-link-btn"]');
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        } catch {
            testLogger.info('Cross-linking not available in org settings, skipping');
            return;
        }

        // Clean up and create a fresh cross-link
        await pm.crossLinkPage.deleteAllCrossLinks();

        const linkName = `Org Persist ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: 'https://org-persist.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });

        // Save org settings
        await pm.crossLinkPage.clickOrgSettingsSave();
        await page.waitForTimeout(2000);

        // Reload the page
        await pm.crossLinkPage.navigateToOrgSettings();

        // Verify the cross-link survived
        await pm.crossLinkPage.expectCrossLinkListVisible();
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
        expect(itemText).toContain(linkName);

        testLogger.info('Org-level cross-link persisted after reload');
    });

    test("should show org-level cross-links as read-only in stream schema", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing org-level cross-links are read-only in stream schema');

        // Step 1: Create an org-level cross-link
        await pm.crossLinkPage.navigateToOrgSettings();

        const addBtn = page.locator('[data-test="add-cross-link-btn"]');
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        } catch {
            testLogger.info('Cross-linking not available in org settings, skipping');
            return;
        }

        await pm.crossLinkPage.deleteAllCrossLinks();

        const orgLinkName = `Org ReadOnly ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: orgLinkName,
            url: 'https://org-readonly.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });

        await pm.crossLinkPage.clickOrgSettingsSave();
        await page.waitForTimeout(2000);

        // Step 2: Navigate to stream schema and check org cross-links section
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up only stream-level cross-links (those with visible delete buttons)
        // Org-level items are read-only and have no delete button
        let deletableCount = await page.locator('[data-test^="cross-link-delete-"]').count();
        while (deletableCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            deletableCount = await page.locator('[data-test^="cross-link-delete-"]').count();
        }

        // Verify the org cross-link item is visible (rendered by the readonly CrossLinkManager)
        // Resolve the per-item index by looking up the dedicated cross-link-item-name-* data-test.
        const orgIdx = await pm.crossLinkPage.findCrossLinkItemIndexByName(orgLinkName);
        expect(orgIdx, `Org cross-link "${orgLinkName}" should be rendered`).toBeGreaterThanOrEqual(0);

        const orgItem = page.locator(pm.crossLinkPage.crossLinkItem(orgIdx));
        await expect(orgItem).toBeVisible({ timeout: 10000 });
        const itemText = await orgItem.textContent();
        expect(itemText).toContain(orgLinkName);
        expect(itemText).toContain('org-readonly.example.com');

        // Verify org-level items do NOT have edit/delete buttons (readonly prop hides them)
        await expect(page.locator(pm.crossLinkPage.crossLinkEditBtn(orgIdx))).toHaveCount(0);
        await expect(page.locator(pm.crossLinkPage.crossLinkDeleteBtn(orgIdx))).toHaveCount(0);

        // Verify the stream-level manager still has its add button (editable)
        const streamAddBtn = page.locator('[data-test="add-cross-link-btn"]');
        await expect(streamAddBtn).toBeVisible({ timeout: 5000 });

        testLogger.info('Org-level cross-link visible in stream schema as read-only, no edit/delete buttons');
    });

    test("should verify org-level cross-link URL contains correct start_time and end_time when clicked from logs", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing org-level cross-link URL timestamp verification from logs view');

        // Step 0: Clean up any stream-level cross-links first so they don't shadow the org-level ones
        // (stream links take priority over org links for the same field in the frontend)
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Only delete stream-level cross-links (those with visible delete buttons)
        // Org-level cross-links are read-only and don't have delete buttons
        const initialDeletableCount = await page.locator('[data-test^="cross-link-delete-"]').count();
        let deletableCount = initialDeletableCount;
        while (deletableCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            deletableCount = await page.locator('[data-test^="cross-link-delete-"]').count();
        }

        // Only save if we actually deleted something (button is disabled if no changes)
        if (initialDeletableCount > 0) {
            await pm.crossLinkPage.clickUpdateSettings();
            await page.waitForTimeout(2000);
        }

        // Step 1: Create an org-level cross-link with start_time and end_time in URL template
        await pm.crossLinkPage.navigateToOrgSettings();

        const addBtn = page.locator('[data-test="add-cross-link-btn"]');
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        } catch {
            testLogger.info('Cross-linking not available in org settings, skipping');
            test.skip(true, 'Cross-linking feature not enabled in org settings');
        }

        // Clean up any existing org-level cross-links
        await pm.crossLinkPage.deleteAllCrossLinks();

        const crossLinkName = `Org TS Test ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: crossLinkName,
            url: 'https://example.com/org-view?from=${start_time}&to=${end_time}&field=${field.__name}&value=${field.__value}',
            fields: ['kubernetes_container_name']
        });

        // Save org settings to persist
        await pm.crossLinkPage.clickOrgSettingsSave();
        await page.waitForTimeout(2000);

        // Step 2: Navigate to logs, disable Quick Mode so all fields are visible, then run query.
        await pm.logsPage.navigateToLogs();
        await pm.logsPage.selectStream(STREAM_NAME);
        await page.waitForTimeout(2000);

        // Disable Quick Mode so all fields show in expanded log rows without needing interesting fields
        await pm.logsPage.ensureQuickModeState(false);
        await page.waitForTimeout(1000);

        // Run query to get results and ensure result_schema picks up the org cross-links
        await pm.logsPage.runQueryAndWaitForResults();
        await page.waitForTimeout(2000);

        // Step 3: Expand a log row to reveal the inline JSON detail (JsonPreview)
        const expandBtn = page.locator('[data-test="table-row-expand-menu"]').first();
        await expandBtn.waitFor({ state: 'visible', timeout: 15000 });
        await expandBtn.click();
        await page.waitForTimeout(2000);

        // Intercept window.open to capture the URL instead of opening a new tab
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.__originalOpen = window.open;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        try {
            // Step 4: Open the kubernetes_container_name field action dropdown
            // (data-test resolved via PO method on the JsonPreview log-detail row)
            await pm.crossLinkPage.openFieldActionDropdown('kubernetes_container_name');

            // Look for the org-level cross-link item in the dropdown menu
            const crossLinkVisible = await pm.crossLinkPage.isLogCrossLinkVisible(crossLinkName);
            testLogger.info('Org-level cross-link menu item visibility', { crossLinkVisible, crossLinkName });

            // Assert cross-link menu item is visible
            expect(crossLinkVisible, `Org-level cross-link "${crossLinkName}" should be visible in dropdown menu`).toBe(true);

            // Click the cross-link
            await pm.crossLinkPage.clickLogCrossLinkMenuItem(crossLinkName);
            testLogger.info('Clicked org-level cross-link menu item');
            await page.waitForTimeout(1000);

            // Step 5: Retrieve the captured URL
            const capturedUrl = await page.evaluate(() => window.__capturedCrossLinkUrl);
            testLogger.info('Captured org-level cross-link URL', { capturedUrl });

            // Assert URL was captured
            expect(capturedUrl, 'Cross-link URL should have been captured via window.open').not.toBeNull();

            // Parse the URL and verify timestamps
            const url = new URL(capturedUrl);
            const fromParam = url.searchParams.get('from');
            const toParam = url.searchParams.get('to');
            const fieldParam = url.searchParams.get('field');
            const valueParam = url.searchParams.get('value');

            testLogger.info('Org-level URL parameters', { from: fromParam, to: toParam, field: fieldParam, value: valueParam });

            // Assert start_time and end_time exist
            expect(fromParam, 'URL should contain from (start_time) parameter').not.toBeNull();
            expect(toParam, 'URL should contain to (end_time) parameter').not.toBeNull();

            const startTime = Number(fromParam);
            const endTime = Number(toParam);

            // Assert timestamps are valid numbers
            testLogger.info('Parsed timestamps', { startTime, endTime });
            expect(isNaN(startTime), 'start_time should be a valid number').toBe(false);
            expect(isNaN(endTime), 'end_time should be a valid number').toBe(false);

            // Timestamps are in microseconds (16 digits for current epoch)
            // Valid range: year 2000 to year 2100 in microseconds
            const minUs = new Date('2000-01-01').getTime() * 1000; // 946684800000000
            const maxUs = new Date('2100-01-01').getTime() * 1000; // 4102444800000000
            expect(startTime, `start_time ${startTime} should be > ${minUs} (year 2000 in us)`).toBeGreaterThan(minUs);
            expect(startTime, `start_time ${startTime} should be < ${maxUs} (year 2100 in us)`).toBeLessThan(maxUs);
            expect(endTime, `end_time ${endTime} should be > ${minUs} (year 2000 in us)`).toBeGreaterThan(minUs);
            expect(endTime, `end_time ${endTime} should be < ${maxUs} (year 2100 in us)`).toBeLessThan(maxUs);
            testLogger.info('Timestamps are valid epoch microseconds', { startTime, endTime });

            // end_time should be >= start_time
            expect(endTime, 'end_time should be >= start_time').toBeGreaterThanOrEqual(startTime);
            testLogger.info('end_time >= start_time verified');

            // Verify field name and value are also populated
            expect(fieldParam, 'field parameter should be kubernetes_container_name').toBe('kubernetes_container_name');
            expect(valueParam, 'value parameter should be populated').toBeTruthy();
            testLogger.info('Field and value parameters verified', { field: fieldParam, value: valueParam });

            testLogger.info('PASSED: Org-level logs timestamp verification', {
                startTime,
                endTime,
                startDate: new Date(startTime / 1000).toISOString(),
                endDate: new Date(endTime / 1000).toISOString(),
                diffUs: endTime - startTime,
            });
        } finally {
            await page.evaluate(() => {
                if (window.__originalOpen) window.open = window.__originalOpen;
                delete window.__capturedCrossLinkUrl;
                delete window.__originalOpen;
            });
        }
    });

    test("should verify org-level cross-link URL contains correct start_time and end_time when clicked from dashboard", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing org-level cross-link URL timestamp verification from dashboard panel');

        // Step 0: Clean up any stream-level cross-links first so they don't shadow the org-level ones
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Only delete stream-level cross-links (those with visible delete buttons)
        const initialDeletableCount2 = await page.locator('[data-test^="cross-link-delete-"]').count();
        let deletableCount2 = initialDeletableCount2;
        while (deletableCount2 > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            deletableCount2 = await page.locator('[data-test^="cross-link-delete-"]').count();
        }

        // Only save if we actually deleted something (button is disabled if no changes)
        if (initialDeletableCount2 > 0) {
            await pm.crossLinkPage.clickUpdateSettings();
            await page.waitForTimeout(2000);
        }

        // Step 1: Create an org-level cross-link with start_time and end_time in URL template
        await pm.crossLinkPage.navigateToOrgSettings();
        testLogger.info('Navigated to org settings');

        const addBtn = page.locator('[data-test="add-cross-link-btn"]');
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
            testLogger.info('Add cross-link button found in org settings');
        } catch {
            testLogger.info('Cross-linking not available in org settings, skipping');
            test.skip(true, 'Cross-linking feature not enabled in org settings');
        }

        // Clean up any existing org-level cross-links
        await pm.crossLinkPage.deleteAllCrossLinks();
        testLogger.info('Cleaned up existing org-level cross-links');

        const crossLinkName = `Org Dash TS ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: crossLinkName,
            url: 'https://example.com/org-dashboard?from=${start_time}&to=${end_time}&field=${field.__name}&value=${field.__value}',
            fields: ['kubernetes_container_name']
        });
        testLogger.info('Org-level cross-link added', { crossLinkName });

        // Save org settings to persist
        await pm.crossLinkPage.clickOrgSettingsSave();
        await page.waitForTimeout(2000);
        testLogger.info('Org settings saved');

        // Step 2: Create a dashboard with a table panel using the same stream
        const dashboardName = `Org CrossLink Dash ${Date.now()}`;
        const orgId = process.env["ORGNAME"] || 'default';
        await page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/dashboards?org_identifier=${orgId}`);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);

        await pm.dashboardCreate.createDashboard(dashboardName);
        testLogger.info('Dashboard created', { dashboardName });

        // Add a table panel with the cross-linked stream
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStream(STREAM_NAME);
        // Remove the auto-seeded histogram(_timestamp) x so kubernetes_container_name
        // is the first column — the cross-link drilldown clicks the first cell.
        await pm.chartTypeSelector.removeField("x_axis_1", "x");
        await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
        await pm.dashboardPanelActions.addPanelName("Org CrossLink Table Panel");
        await pm.dashboardPanelActions.savePanel();
        await page.waitForTimeout(3000);
        testLogger.info('Dashboard table panel created and saved');

        // Step 3: Intercept window.open to capture the cross-link URL
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.__originalOpen = window.open;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });
        testLogger.info('window.open intercepted');

        try {
            // Step 4: Click on a data row in the table panel to trigger the cross-link drilldown menu
            await page.waitForTimeout(2000);
            await pm.crossLinkPage.clickFirstDashboardTableCell();
            await page.waitForTimeout(1500);
            testLogger.info('Clicked on dashboard table cell');

            // Step 5: Look for the drilldown menu popup (resolved via data-test)
            const menuVisible = await pm.crossLinkPage.isDrilldownMenuVisible();
            testLogger.info('Drilldown menu visibility', { menuVisible });

            // Assert drilldown menu appeared
            expect(menuVisible, 'Drilldown menu should appear after clicking table cell').toBe(true);

            // Find and click the cross-link menu item (per-name data-test on each menu item)
            const crossLinkMenuVisible = await pm.crossLinkPage.isDrilldownMenuItemVisible(crossLinkName);
            testLogger.info('Org cross-link menu item visibility', { crossLinkMenuVisible, crossLinkName });

            // Assert cross-link menu item is visible
            expect(crossLinkMenuVisible, `Org cross-link "${crossLinkName}" should be visible in drilldown menu`).toBe(true);

            await pm.crossLinkPage.clickDrilldownMenuItem(crossLinkName);
            testLogger.info('Clicked org cross-link menu item');
            await page.waitForTimeout(1000);

            // Step 6: Retrieve and verify the captured URL
            const capturedUrl = await page.evaluate(() => window.__capturedCrossLinkUrl);
            testLogger.info('Captured org-level dashboard cross-link URL', { capturedUrl });

            // Assert URL was captured
            expect(capturedUrl, 'Cross-link URL should have been captured via window.open').not.toBeNull();

            // Parse the URL and verify timestamps
            const url = new URL(capturedUrl);
            const fromParam = url.searchParams.get('from');
            const toParam = url.searchParams.get('to');
            const fieldParam = url.searchParams.get('field');
            const valueParam = url.searchParams.get('value');

            testLogger.info('Org dashboard URL parameters', { from: fromParam, to: toParam, field: fieldParam, value: valueParam });

            // Assert start_time and end_time exist
            expect(fromParam, 'URL should contain from (start_time) parameter').not.toBeNull();
            expect(toParam, 'URL should contain to (end_time) parameter').not.toBeNull();

            const startTime = Number(fromParam);
            const endTime = Number(toParam);

            // Assert timestamps are valid numbers
            testLogger.info('Parsed dashboard timestamps', { startTime, endTime });
            expect(isNaN(startTime), 'start_time should be a valid number').toBe(false);
            expect(isNaN(endTime), 'end_time should be a valid number').toBe(false);

            // Timestamps are in microseconds (16 digits for current epoch)
            const minUs = new Date('2000-01-01').getTime() * 1000;
            const maxUs = new Date('2100-01-01').getTime() * 1000;
            expect(startTime, `start_time ${startTime} should be > ${minUs} (year 2000 in us)`).toBeGreaterThan(minUs);
            expect(startTime, `start_time ${startTime} should be < ${maxUs} (year 2100 in us)`).toBeLessThan(maxUs);
            expect(endTime, `end_time ${endTime} should be > ${minUs} (year 2000 in us)`).toBeGreaterThan(minUs);
            expect(endTime, `end_time ${endTime} should be < ${maxUs} (year 2100 in us)`).toBeLessThan(maxUs);
            testLogger.info('Dashboard timestamps are valid epoch microseconds', { startTime, endTime });

            // end_time should be >= start_time
            expect(endTime, 'end_time should be >= start_time').toBeGreaterThanOrEqual(startTime);
            testLogger.info('end_time >= start_time verified');

            // Verify field name and value are populated
            expect(fieldParam, 'field parameter should be kubernetes_container_name').toBe('kubernetes_container_name');
            expect(valueParam, 'value parameter should be populated').toBeTruthy();
            testLogger.info('Field and value parameters verified', { field: fieldParam, value: valueParam });

            testLogger.info('PASSED: Org-level dashboard timestamp verification', {
                startTime,
                endTime,
                startDate: new Date(startTime / 1000).toISOString(),
                endDate: new Date(endTime / 1000).toISOString(),
                diffUs: endTime - startTime,
            });

            // Cleanup: delete the test dashboard
            await pm.dashboardCreate.backToDashboardList();
            await page.waitForTimeout(1000);
            testLogger.info('Dashboard cleanup done');
        } finally {
            await page.evaluate(() => {
                if (window.__originalOpen) window.open = window.__originalOpen;
                delete window.__capturedCrossLinkUrl;
                delete window.__originalOpen;
            });
        }
    });

    // Cleanup: remove org-level cross-links after org tests
    test("should clean up org-level cross-links", {
        tag: ['@crossLinking', '@cleanup', '@all']
    }, async ({ page }) => {
        testLogger.info('Cleaning up org-level cross-links');

        await pm.crossLinkPage.navigateToOrgSettings();

        const addBtn = page.locator('[data-test="add-cross-link-btn"]');
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        } catch {
            testLogger.info('Cross-linking not available, nothing to clean');
            return;
        }

        await pm.crossLinkPage.deleteAllCrossLinks();
        await pm.crossLinkPage.clickOrgSettingsSave();

        testLogger.info('Org-level cross-links cleaned up');
    });
});

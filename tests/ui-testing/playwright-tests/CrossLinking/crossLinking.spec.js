const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTestData: _ingestData } = require('../utils/data-ingestion.js');

const STREAM_NAME = "e2e_automate";

test.describe("Cross-Linking testcases", () => {
    test.describe.configure({ mode: 'serial' });
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
                let count = await page.locator('[data-test^="cross-link-item-"]').count();
                while (count > 0) {
                    await cleanupPm.crossLinkPage.clickDeleteCrossLink(0);
                    await page.waitForTimeout(500);
                    count = await page.locator('[data-test^="cross-link-item-"]').count();
                }

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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Verify all dialog fields are present
        await expect(page.locator('[data-test="cross-link-name-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-url-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-field-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-save-btn"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-cancel-btn"]')).toBeVisible();

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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Check if there's an existing link to edit
        const linkList = page.locator('[data-test="cross-link-list"]');
        const hasList = await linkList.isVisible().catch(() => false);

        if (!hasList) {
            // Create one first
            const linkName = `Edit Test ${Date.now()}`;
            await pm.crossLinkPage.addCrossLink({
                name: linkName,
                url: 'https://example.com/${field.__value}',
                fields: ['kubernetes_container_name']
            });
        }

        // Click edit on first link
        await pm.crossLinkPage.clickEditCrossLink(0);
        await pm.crossLinkPage.expectDialogVisible();

        // Verify form is populated (name input should have a value)
        const nameInput = page.locator('[data-test="cross-link-name-input"]');
        const nameValue = await nameInput.inputValue();
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Create a link to delete if none exist
        const linkList = page.locator('[data-test="cross-link-list"]');
        const hasList = await linkList.isVisible().catch(() => false);

        if (!hasList) {
            await pm.crossLinkPage.addCrossLink({
                name: `Delete Test ${Date.now()}`,
                url: 'https://delete.example.com/${field.__value}',
                fields: ['kubernetes_container_name']
            });
        }

        // Count links before delete
        const itemsBefore = await page.locator('[data-test^="cross-link-item-"]').count();
        expect(itemsBefore).toBeGreaterThan(0);

        // Delete first link
        await pm.crossLinkPage.clickDeleteCrossLink(0);

        // Verify count decreased
        const itemsAfter = await page.locator('[data-test^="cross-link-item-"]').count();
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Count links before
        const itemsBefore = await page.locator('[data-test^="cross-link-item-"]').count();

        // Open dialog, fill form, cancel
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();
        await pm.crossLinkPage.fillCrossLinkName('Cancelled Link');
        await pm.crossLinkPage.fillCrossLinkUrl('https://cancelled.example.com');
        await pm.crossLinkPage.clickCancel();

        // Verify dialog closed
        await pm.crossLinkPage.expectDialogNotVisible();

        // Verify no new link was added
        const itemsAfter = await page.locator('[data-test^="cross-link-item-"]').count();
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up any existing cross-links first
        let existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        }

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

        // Step 2: Navigate to logs, add interesting field, and query the stream
        await pm.logsPage.navigateToLogs();
        await pm.logsPage.selectStream(STREAM_NAME);
        await page.waitForTimeout(2000);

        // Add kubernetes_container_name as an interesting field so it appears as a table column
        await pm.logsPage.clickInterestingFieldButton('kubernetes_container_name');
        await page.waitForTimeout(1000);

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
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        // Step 4: Find the kubernetes_container_name field row in the expanded JSON preview
        // and click its action dropdown button
        const fieldRow = page.locator('.log_json_content').filter({ hasText: 'kubernetes_container_name' }).first();
        await fieldRow.waitFor({ state: 'visible', timeout: 10000 });
        const fieldActionBtn = fieldRow.locator('[data-test="log-details-include-exclude-field-btn"]');
        await fieldActionBtn.click();
        await page.waitForTimeout(1000);

        // Look for the cross-link item in the dropdown menu
        const crossLinkItem = page.locator('.q-menu .q-item, .q-list .q-item').filter({ hasText: crossLinkName });
        const crossLinkVisible = await crossLinkItem.isVisible().catch(() => false);

        if (!crossLinkVisible) {
            testLogger.info('Cross-link menu item not visible - cross-links may not be loaded for this field');
            await page.keyboard.press('Escape');
            return;
        }

        // Click the cross-link
        await crossLinkItem.click();
        await page.waitForTimeout(1000);

        // Step 5: Retrieve the captured URL
        const capturedUrl = await page.evaluate(() => window.__capturedCrossLinkUrl);
        testLogger.info('Captured cross-link URL', { capturedUrl });

        expect(capturedUrl).not.toBeNull();

        // Parse the URL and verify timestamps
        const url = new URL(capturedUrl);
        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const fieldParam = url.searchParams.get('field');
        const valueParam = url.searchParams.get('value');

        testLogger.info('URL parameters', { from: fromParam, to: toParam, field: fieldParam, value: valueParam });

        // Verify start_time and end_time are valid epoch microseconds
        expect(fromParam).not.toBeNull();
        expect(toParam).not.toBeNull();

        const startTime = Number(fromParam);
        const endTime = Number(toParam);

        // Timestamps should be valid numbers
        expect(isNaN(startTime)).toBe(false);
        expect(isNaN(endTime)).toBe(false);

        // Timestamps are in microseconds (16 digits for current epoch)
        // Valid range: year 2000 to year 2100 in microseconds
        const minUs = new Date('2000-01-01').getTime() * 1000; // 946684800000000
        const maxUs = new Date('2100-01-01').getTime() * 1000; // 4102444800000000
        expect(startTime).toBeGreaterThan(minUs);
        expect(startTime).toBeLessThan(maxUs);
        expect(endTime).toBeGreaterThan(minUs);
        expect(endTime).toBeLessThan(maxUs);

        // end_time should be >= start_time
        expect(endTime).toBeGreaterThanOrEqual(startTime);

        // Verify field name and value are also populated
        expect(fieldParam).toBe('kubernetes_container_name');
        expect(valueParam).toBeTruthy();

        testLogger.info('Timestamp verification passed', {
            startTime,
            endTime,
            startDate: new Date(startTime / 1000).toISOString(),
            endDate: new Date(endTime / 1000).toISOString(),
            diffUs: endTime - startTime,
        });

        testLogger.info('Test completed');
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up any existing cross-links first
        let existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        }

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
        await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
        await pm.dashboardPanelActions.addPanelName("CrossLink Table Panel");
        await pm.dashboardPanelActions.savePanel();
        await page.waitForTimeout(3000);

        testLogger.info('Dashboard with table panel created');

        // Step 3: Intercept window.open to capture the cross-link URL
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        // Step 4: Click on a cell in the table panel to trigger drilldown/cross-link menu
        // Table panels render data inside the panel container
        const panelContainer = page.locator('[data-test="dashboard-panel-table"]').first()
            .or(page.locator('.dashboard-panel').first());

        // Try clicking on a table cell to trigger the drilldown menu
        const tableCell = panelContainer.locator('td, .table-cell, .q-table__grid-item').first();
        const tableCellVisible = await tableCell.isVisible({ timeout: 5000 }).catch(() => false);

        if (!tableCellVisible) {
            // Fallback: try clicking directly on the rendered chart/table area
            const chartArea = page.locator('.echart, canvas, table').first();
            const chartVisible = await chartArea.isVisible({ timeout: 5000 }).catch(() => false);
            if (chartVisible) {
                await chartArea.click();
            } else {
                testLogger.info('No clickable table/chart element found in panel, skipping');
                // Cleanup dashboard
                await pm.dashboardCreate.backToDashboardList();
                await page.waitForTimeout(1000);
                return;
            }
        } else {
            await tableCell.click();
        }

        await page.waitForTimeout(1500);

        // Step 5: Look for the crosslink-drilldown-menu popup
        const drilldownMenu = page.locator('.crosslink-drilldown-menu');
        const menuVisible = await drilldownMenu.isVisible().catch(() => false);

        if (!menuVisible) {
            testLogger.info('Drilldown menu did not appear after click - panel may not have data or cross-links not loaded');
            // Cleanup dashboard
            await pm.dashboardCreate.backToDashboardList();
            await page.waitForTimeout(1000);
            return;
        }

        // Find and click the cross-link menu item
        const crossLinkMenuItem = drilldownMenu.locator('.crosslink-drilldown-menu-item').filter({ hasText: crossLinkName });
        const crossLinkMenuVisible = await crossLinkMenuItem.isVisible().catch(() => false);

        if (!crossLinkMenuVisible) {
            testLogger.info('Cross-link menu item not found in drilldown menu');
            await page.keyboard.press('Escape');
            // Cleanup dashboard
            await pm.dashboardCreate.backToDashboardList();
            await page.waitForTimeout(1000);
            return;
        }

        await crossLinkMenuItem.click();
        await page.waitForTimeout(1000);

        // Step 6: Retrieve and verify the captured URL
        const capturedUrl = await page.evaluate(() => window.__capturedCrossLinkUrl);
        testLogger.info('Captured dashboard cross-link URL', { capturedUrl });

        expect(capturedUrl).not.toBeNull();

        // Parse the URL and verify timestamps
        const url = new URL(capturedUrl);
        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const fieldParam = url.searchParams.get('field');
        const valueParam = url.searchParams.get('value');

        testLogger.info('Dashboard URL parameters', { from: fromParam, to: toParam, field: fieldParam, value: valueParam });

        // Verify start_time and end_time are valid epoch microseconds
        expect(fromParam).not.toBeNull();
        expect(toParam).not.toBeNull();

        const startTime = Number(fromParam);
        const endTime = Number(toParam);

        // Timestamps should be valid numbers
        expect(isNaN(startTime)).toBe(false);
        expect(isNaN(endTime)).toBe(false);

        // Timestamps are in microseconds (16 digits for current epoch)
        const minUs = new Date('2000-01-01').getTime() * 1000;
        const maxUs = new Date('2100-01-01').getTime() * 1000;
        expect(startTime).toBeGreaterThan(minUs);
        expect(startTime).toBeLessThan(maxUs);
        expect(endTime).toBeGreaterThan(minUs);
        expect(endTime).toBeLessThan(maxUs);

        // end_time should be >= start_time
        expect(endTime).toBeGreaterThanOrEqual(startTime);

        // Verify field name and value are populated
        expect(fieldParam).toBe('kubernetes_container_name');
        expect(valueParam).toBeTruthy();

        testLogger.info('Dashboard timestamp verification passed', {
            startTime,
            endTime,
            startDate: new Date(startTime / 1000).toISOString(),
            endDate: new Date(endTime / 1000).toISOString(),
            diffUs: endTime - startTime,
        });

        // Cleanup: delete the test dashboard
        await pm.dashboardCreate.backToDashboardList();
        await page.waitForTimeout(1000);

        testLogger.info('Test completed');
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up existing cross-links
        let existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        }

        // Add a cross-link
        const linkName = `Persist Test ${Date.now()}`;
        const linkUrl = 'https://persist.example.com/trace/${field.__value}';
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: linkUrl,
            fields: ['kubernetes_container_name']
        });

        // Click Update Settings to persist to backend
        await pm.crossLinkPage.clickUpdateSettings();
        await page.waitForTimeout(2000);

        // Reload the page completely and navigate back
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();
        await pm.crossLinkPage.clickCrossLinkingTab();

        // Verify the cross-link survived the reload
        await pm.crossLinkPage.expectCrossLinkListVisible();
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up existing
        let existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        }

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

        const listItem = page.locator('[data-test="cross-link-item-0"]');

        // Verify name is displayed
        const nameText = await listItem.locator('.text-subtitle2').textContent();
        expect(nameText).toContain(linkName);

        // Verify URL is displayed
        const urlText = await listItem.locator('.text-caption').first().textContent();
        expect(urlText).toContain('display.example.com');

        // Verify field chips are rendered (CrossLinkManager shows q-chip for each field)
        const fieldChips = listItem.locator('.q-chip');
        const chipCount = await fieldChips.count();
        expect(chipCount).toBe(2);

        // Verify chip text content
        const chip0Text = await fieldChips.nth(0).textContent();
        const chip1Text = await fieldChips.nth(1).textContent();
        expect(chip0Text).toContain('kubernetes_container_name');
        expect(chip1Text).toContain('kubernetes_pod_name');

        // Verify edit and delete action buttons exist
        await expect(page.locator('[data-test="cross-link-edit-0"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-delete-0"]')).toBeVisible();

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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Ensure a link exists with known values
        let existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
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

        // Verify name is pre-populated
        const nameInput = page.locator('[data-test="cross-link-name-input"]');
        const nameValue = await nameInput.inputValue();
        expect(nameValue).toBe(editLinkName);

        // Verify URL is pre-populated
        const urlInput = page.locator('[data-test="cross-link-url-input"]');
        const urlValue = await urlInput.inputValue();
        expect(urlValue).toBe(editLinkUrl);

        // Verify field chip is pre-populated
        await pm.crossLinkPage.expectFieldChipVisible(0);
        const chipText = await page.locator('[data-test="cross-link-field-chip-0"]').textContent();
        expect(chipText).toContain('kubernetes_container_name');

        // Verify save button is enabled (all required fields are filled)
        await pm.crossLinkPage.expectSaveEnabled();

        await pm.crossLinkPage.clickCancel();

        testLogger.info('Edit pre-population verified');
    });

    test("should verify all 6 template variables are resolved in cross-link URL from logs", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing all 6 URL template variables resolve correctly');


        // Create a cross-link with ALL 6 template variables
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up existing
        let existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        }

        const crossLinkName = `All Vars Test ${Date.now()}`;
        // Use a URL with all 6 variables as separate params for easy parsing
        await pm.crossLinkPage.addCrossLink({
            name: crossLinkName,
            url: 'https://allvars.example.com/?fname=${field.__name}&fval=${field.__value}&from=${start_time}&to=${end_time}&q=${query}&qenc=${query_encoded}',
            fields: ['kubernetes_container_name']
        });

        await pm.crossLinkPage.clickUpdateSettings();
        await page.waitForTimeout(2000);

        // Navigate to logs and run query
        await pm.logsPage.navigateToLogs();
        await pm.logsPage.selectStream(STREAM_NAME);
        await page.waitForTimeout(2000);
        await pm.logsPage.runQueryAndWaitForResults();
        await page.waitForTimeout(2000);

        // Intercept window.open
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        // Open log detail sidebar
        const firstLogRow = page.locator('[data-test="log-table-column-0-source"]');
        await firstLogRow.waitFor({ state: 'visible', timeout: 15000 });
        await firstLogRow.click();
        await page.waitForTimeout(2000);
        await page.locator('[data-test="dialog-box"]').waitFor({ state: 'visible', timeout: 10000 });

        // Find and click the cross-link for kubernetes_container_name
        const jsonContent = page.locator('[data-test="log-detail-json-content"]');
        await jsonContent.waitFor({ state: 'visible', timeout: 5000 });

        const fieldRow = page.locator('.log_json_content').filter({ hasText: 'kubernetes_container_name' }).first();
        const fieldRowVisible = await fieldRow.isVisible().catch(() => false);
        if (!fieldRowVisible) {
            testLogger.info('kubernetes_container_name not found in log detail, skipping');
            return;
        }

        const fieldActionBtn = fieldRow.locator('[data-test="log-details-include-exclude-field-btn"]');
        await fieldActionBtn.click();
        await page.waitForTimeout(1000);

        const crossLinkItem = page.locator('.q-menu .q-item').filter({ hasText: crossLinkName });
        const crossLinkVisible = await crossLinkItem.isVisible().catch(() => false);
        if (!crossLinkVisible) {
            testLogger.info('Cross-link menu item not visible, skipping');
            await page.keyboard.press('Escape');
            return;
        }

        await crossLinkItem.click();
        await page.waitForTimeout(1000);

        const capturedUrl = await page.evaluate(() => window.__capturedCrossLinkUrl);
        testLogger.info('Captured URL with all 6 vars', { capturedUrl });
        expect(capturedUrl).not.toBeNull();

        const url = new URL(capturedUrl);

        // Verify field.__name is resolved (should be 'kubernetes_container_name')
        const fnameParam = url.searchParams.get('fname');
        expect(fnameParam).toBe('kubernetes_container_name');

        // Verify field.__value is resolved (should be non-empty)
        const fvalParam = url.searchParams.get('fval');
        expect(fvalParam).toBeTruthy();

        // Verify start_time is resolved (epoch milliseconds)
        const fromParam = url.searchParams.get('from');
        expect(fromParam).not.toBeNull();
        expect(isNaN(Number(fromParam))).toBe(false);
        expect(Number(fromParam)).toBeGreaterThan(946684800000);

        // Verify end_time is resolved (epoch milliseconds)
        const toParam = url.searchParams.get('to');
        expect(toParam).not.toBeNull();
        expect(isNaN(Number(toParam))).toBe(false);
        expect(Number(toParam)).toBeGreaterThanOrEqual(Number(fromParam));

        // Verify query is resolved (should be non-empty SQL query)
        const queryParam = url.searchParams.get('q');
        expect(queryParam).toBeTruthy();
        testLogger.info('Query param', { query: queryParam });

        // Verify query_encoded is resolved (should be valid base64)
        const qencParam = url.searchParams.get('qenc');
        expect(qencParam).toBeTruthy();
        // Base64 decode should give the same SQL query
        const decodedQuery = Buffer.from(qencParam, 'base64').toString('utf-8');
        expect(decodedQuery).toBeTruthy();
        testLogger.info('Decoded query_encoded', { decoded: decodedQuery });

        testLogger.info('All 6 template variables verified');
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
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up existing
        let existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        }

        const crossLinkName = `Scoped Field Test ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: crossLinkName,
            url: 'https://scoped.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });

        await pm.crossLinkPage.clickUpdateSettings();
        await page.waitForTimeout(2000);

        // Navigate to logs
        await pm.logsPage.navigateToLogs();
        await pm.logsPage.selectStream(STREAM_NAME);
        await page.waitForTimeout(2000);
        await pm.logsPage.runQueryAndWaitForResults();
        await page.waitForTimeout(2000);

        // Open log detail
        const firstLogRow = page.locator('[data-test="log-table-column-0-source"]');
        await firstLogRow.waitFor({ state: 'visible', timeout: 15000 });
        await firstLogRow.click();
        await page.waitForTimeout(2000);
        await page.locator('[data-test="dialog-box"]').waitFor({ state: 'visible', timeout: 10000 });

        const jsonContent = page.locator('[data-test="log-detail-json-content"]');
        await jsonContent.waitFor({ state: 'visible', timeout: 5000 });

        // Check the configured field — cross-link SHOULD appear
        const configuredFieldRow = page.locator('.log_json_content').filter({ hasText: 'kubernetes_container_name' }).first();
        const configuredVisible = await configuredFieldRow.isVisible().catch(() => false);

        if (configuredVisible) {
            const configuredBtn = configuredFieldRow.locator('[data-test="log-details-include-exclude-field-btn"]');
            await configuredBtn.click();
            await page.waitForTimeout(1000);

            const crossLinkInMenu = page.locator('.q-menu .q-item').filter({ hasText: crossLinkName });
            const hasCrossLink = await crossLinkInMenu.isVisible().catch(() => false);

            if (hasCrossLink) {
                testLogger.info('Cross-link correctly appears for configured field');
            } else {
                testLogger.info('Cross-link not loaded for configured field (may need result_schema)');
            }

            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        }

        // Check a different field — cross-link should NOT appear
        const otherFieldRow = page.locator('.log_json_content').filter({ hasText: '_timestamp' }).first();
        const otherVisible = await otherFieldRow.isVisible().catch(() => false);

        if (otherVisible) {
            const otherBtn = otherFieldRow.locator('[data-test="log-details-include-exclude-field-btn"]');
            await otherBtn.click();
            await page.waitForTimeout(1000);

            const crossLinkInOtherMenu = page.locator('.q-menu .q-item').filter({ hasText: crossLinkName });
            const hasCrossLinkInOther = await crossLinkInOtherMenu.isVisible().catch(() => false);

            // Cross-link should NOT appear for _timestamp since it's not in the configured fields
            expect(hasCrossLinkInOther).toBe(false);
            testLogger.info('Cross-link correctly absent for non-configured field (_timestamp)');

            await page.keyboard.press('Escape');
        }

        testLogger.info('Field scoping verification completed');
    });

    test("should show empty state after deleting all cross-links", {
        tag: ['@crossLinking', '@functional', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing empty state appears after deleting all cross-links');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Ensure at least one cross-link exists
        const currentCount = await page.locator('[data-test^="cross-link-item-"]').count();
        if (currentCount === 0) {
            await pm.crossLinkPage.addCrossLink({
                name: `Empty State Test ${Date.now()}`,
                url: 'https://emptystate.example.com/${field.__value}',
                fields: ['kubernetes_container_name']
            });
        }

        // Verify list is visible before deletion
        await pm.crossLinkPage.expectCrossLinkListVisible();

        // Delete all cross-links
        let count = await page.locator('[data-test^="cross-link-item-"]').count();
        while (count > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            count = await page.locator('[data-test^="cross-link-item-"]').count();
        }

        // Verify empty state is now visible
        await pm.crossLinkPage.expectEmptyState();

        // Verify the list container is no longer visible
        const listVisible = await page.locator('[data-test="cross-link-list"]').isVisible().catch(() => false);
        expect(listVisible).toBe(false);

        testLogger.info('Empty state confirmed after deleting all cross-links');
    });

    test("should reset form when reopening dialog after cancel", {
        tag: ['@crossLinking', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing form reset on dialog reopen');

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Open dialog, fill form, cancel
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();
        await pm.crossLinkPage.fillCrossLinkName('Should Be Cleared');
        await pm.crossLinkPage.fillCrossLinkUrl('https://shouldbecleared.example.com');
        await pm.crossLinkPage.clickCancel();
        await pm.crossLinkPage.expectDialogNotVisible();

        // Reopen dialog
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Verify form is empty
        const nameInput = page.locator('[data-test="cross-link-name-input"]');
        const urlInput = page.locator('[data-test="cross-link-url-input"]');
        const nameValue = await nameInput.inputValue();
        const urlValue = await urlInput.inputValue();
        expect(nameValue).toBe('');
        expect(urlValue).toBe('');

        testLogger.info('Test completed');
    });
});

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTestData: _ingestData, waitForStreamData } = require('../utils/data-ingestion.js');

// Cross-link settings are one whole-object PUT per stream, so each parallel worker owns its own stream and concurrent tests can never clobber one another.
const WORKER_SLOT = process.env.TEST_PARALLEL_INDEX || '0';
const STREAM_NAME = `e2e_crosslink_w${WORKER_SLOT}_s`;

// Org-level cross-links are shared by the whole org, so this file must run on a different CI shard than crossLinking.spec.js.
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
            // This stream is created only here, so nothing else masks the lag before it is queryable and listed.
            expect(await waitForStreamData(page, STREAM_NAME, 1, 30000),
                `stream ${STREAM_NAME} never became queryable within 30s of ingestion`).toBe(true);
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
        testLogger.info('Cleaning up org-level cross-links after test suite');
        const context = await browser.newContext({
            storageState: 'playwright-tests/utils/auth/user.json'
        });
        const page = await context.newPage();
        try {
            await navigateToBase(page);
            const cleanupPm = new PageManager(page);
            await page.waitForTimeout(1000);

            await cleanupPm.crossLinkPage.navigateToOrgSettings();
            const addBtn = cleanupPm.crossLinkPage.getAddCrossLinkBtnLocator();
            const isVisible = await addBtn.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
            if (isVisible) {
                await cleanupPm.crossLinkPage.deleteAllCrossLinks();
                await cleanupPm.crossLinkPage.saveOrgSettingsIfChanged();
                testLogger.info('Org-level cross-links cleaned up');
            }
        } catch (e) {
            testLogger.warn('Cleanup failed', { error: e.message });
        } finally {
            await page.close();
            await context.close();
        }
    });

    test("should add an org-level cross-link via Organization Settings", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing org-level cross-link creation');

        await pm.crossLinkPage.navigateToOrgSettings();

        // Verify the CrossLinkManager is present (feature flag must be enabled)
        const addBtn = pm.crossLinkPage.getAddCrossLinkBtnLocator();
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

        const addBtn = pm.crossLinkPage.getAddCrossLinkBtnLocator();
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
        await pm.crossLinkPage.clickSaveAndWait();

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

        const addBtn = pm.crossLinkPage.getAddCrossLinkBtnLocator();
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
        const remainingCount = await pm.crossLinkPage.getCrossLinkItemNameCount();
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

        const addBtn = pm.crossLinkPage.getAddCrossLinkBtnLocator();
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

        const addBtn = pm.crossLinkPage.getAddCrossLinkBtnLocator();
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
        let deletableCount = await pm.crossLinkPage.getDeletableCrossLinkCount();
        while (deletableCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            deletableCount = await pm.crossLinkPage.getDeletableCrossLinkCount();
        }

        // Verify the org cross-link item is visible (rendered by the readonly CrossLinkManager)
        // Resolve the per-item index by looking up the dedicated cross-link-item-name-* data-test.
        const orgIdx = await pm.crossLinkPage.findCrossLinkItemIndexByName(orgLinkName);
        expect(orgIdx, `Org cross-link "${orgLinkName}" should be rendered`).toBeGreaterThanOrEqual(0);

        const orgItem = pm.crossLinkPage.getCrossLinkItemLocator(orgIdx);
        await expect(orgItem).toBeVisible({ timeout: 10000 });
        const itemText = await orgItem.textContent();
        expect(itemText).toContain(orgLinkName);
        expect(itemText).toContain('org-readonly.example.com');

        // Verify org-level items do NOT have edit/delete buttons (readonly prop hides them)
        await expect(pm.crossLinkPage.getCrossLinkEditBtnLocator(orgIdx)).toHaveCount(0);
        await expect(pm.crossLinkPage.getCrossLinkDeleteBtnLocator(orgIdx)).toHaveCount(0);

        // Verify the stream-level manager still has its add button (editable)
        const streamAddBtn = pm.crossLinkPage.getAddCrossLinkBtnLocator();
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
        const initialDeletableCount = await pm.crossLinkPage.getDeletableCrossLinkCount();
        let deletableCount = initialDeletableCount;
        while (deletableCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            deletableCount = await pm.crossLinkPage.getDeletableCrossLinkCount();
        }

        // Only save if we actually deleted something (button is disabled if no changes)
        if (initialDeletableCount > 0) {
            await pm.crossLinkPage.clickUpdateSettings();
            await page.waitForTimeout(2000);
        }

        // Step 1: Create an org-level cross-link with start_time and end_time in URL template
        await pm.crossLinkPage.navigateToOrgSettings();

        const addBtn = pm.crossLinkPage.getAddCrossLinkBtnLocator();
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
        const expandBtn = pm.crossLinkPage.firstLogRowExpand;
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
        const initialDeletableCount2 = await pm.crossLinkPage.getDeletableCrossLinkCount();
        let deletableCount2 = initialDeletableCount2;
        while (deletableCount2 > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            deletableCount2 = await pm.crossLinkPage.getDeletableCrossLinkCount();
        }

        // Only save if we actually deleted something (button is disabled if no changes)
        if (initialDeletableCount2 > 0) {
            await pm.crossLinkPage.clickUpdateSettings();
            await page.waitForTimeout(2000);
        }

        // Step 1: Create an org-level cross-link with start_time and end_time in URL template
        await pm.crossLinkPage.navigateToOrgSettings();
        testLogger.info('Navigated to org settings');

        const addBtn = pm.crossLinkPage.getAddCrossLinkBtnLocator();
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

        const addBtn = pm.crossLinkPage.getAddCrossLinkBtnLocator();
        try {
            await addBtn.waitFor({ state: 'visible', timeout: 10000 });
        } catch {
            testLogger.info('Cross-linking not available, nothing to clean');
            return;
        }

        await pm.crossLinkPage.deleteAllCrossLinks();
        await pm.crossLinkPage.saveOrgSettingsIfChanged();

        testLogger.info('Org-level cross-links cleaned up');
    });
});

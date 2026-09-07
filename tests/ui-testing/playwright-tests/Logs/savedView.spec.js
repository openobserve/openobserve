/**
 * Logs Saved View Apply on Build Tab E2E Tests
 *
 * Feature: saved-view-apply (BuildQueryPage restore when a saved view is applied)
 *
 * When a view is saved while the Logs Build tab is active, the exact builder
 * state (X/Y fields, chart type, custom-query flag + SQL) is captured as
 * `data.buildData`. Applying that view must restore that exact state — not
 * re-derive it from the current logs query.
 *
 * This spec verifies both restore paths:
 * 1. onMounted path — apply a build-tab view while on the Logs tab → Build tab
 *    mounts and restores the saved state.
 * 2. watcher path (the diff) — apply a view while already on the Build tab →
 *    the builder re-initializes in place (no remount).
 *
 * @tags @saved-view-apply @logs @all
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Saved view names use the "streamslog" prefix so the global cleanup spec
// (cleanup.spec.js → apiCleanup.cleanupSavedViews) removes any leftovers.
const SAVED_VIEW_PREFIX = 'streamslog_savedviewapply_';

function uniqueViewName() {
    const randomId = Math.random().toString(36).substring(2, 8);
    return `${SAVED_VIEW_PREFIX}${randomId}`;
}

/**
 * Run the current query by clicking refresh and waiting for the search response.
 */
async function runQuery(pm) {
    const searchPromise = pm.page
        .waitForResponse(
            (response) => response.url().includes('/_search') && response.status() === 200,
            { timeout: 60000 }
        )
        .catch(() => {});

    await pm.logsPage.clickRefreshButton();
    await searchPromise;
}

test.describe('Logs Saved View Apply on Build Tab testcases', () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;
    let createdViews = [];

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        createdViews = [];

        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await pm.logsPage.selectStream('e2e_automate');
        await runQuery(pm);

        testLogger.info('Saved view apply test setup completed');
    });

    test.afterEach(async () => {
        // Best-effort cleanup of saved views created by this test. Deletion is not
        // part of the assertion; failures are logged and ignored so a cleanup
        // hiccup never fails a test.
        if (!pm) {
            return;
        }
        for (const viewName of createdViews) {
            try {
                await pm.logsPage.clickDeleteSavedViewButton(viewName);
                await pm.logsPage.clickConfirmButton();
                testLogger.info(`Cleaned up saved view: ${viewName}`);
            } catch (error) {
                testLogger.warn('Saved view cleanup failed (leftover will be removed by cleanup.spec.js)', {
                    viewName,
                    error: error.message,
                });
            }
        }
        createdViews = [];
    });

    // ============================================================================
    // P0 — Critical path
    // ============================================================================

    test('Applying a build-tab saved view restores builder state (onMounted path)', {
        tag: ['@saved-view-apply', '@all', '@logs', '@P0'],
    }, async ({ page }) => {
        testLogger.info('Testing save → apply → restore cycle from the Logs tab (onMounted path)');

        const viewName = uniqueViewName();
        createdViews.push(viewName);

        // Ensure a deterministic default builder state (SQL ON + empty query)
        await pm.logsPage.enableSqlModeIfNeeded();
        await pm.logsPage.setQueryEditorContent('');
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Configure a non-default builder state: add a field to X + line chart
        await pm.logsPage.addFieldToXAxis('log');
        await pm.logsPage.selectChartType('line');
        await pm.logsPage.verifyChartTypeSelected('line');

        // Save the view while on the Build tab
        await pm.logsPage.clickSaveViewButton();
        await pm.logsPage.fillSavedViewName(viewName);
        await pm.logsPage.clickSavedViewDialogSave();

        // Switch back to Logs so the apply exercises the onMounted (remount) path
        await pm.logsPage.clickLogsToggle();

        // Apply the saved view
        await pm.logsPage.clickSavedViewsExpand();
        await pm.logsPage.fillSavedViewSearchInput(viewName);
        await pm.logsPage.clickSavedViewByTitle(viewName);

        // Build tab auto-opens on apply and restores the saved state
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.expectBuildTabActive();
        await pm.logsPage.expectApplySuccessNotification(viewName);

        // Saved (non-default) chart type is restored, not re-derived (default would be bar)
        await pm.logsPage.verifyChartTypeSelected('line');
        // Saved X-axis field (the added 'log' field) is restored alongside the default
        await pm.logsPage.expectXAxisItemVisible('x_axis_2');
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('Applying a build-tab saved view restores builder state - PASSED');
    });

    test('Applying a saved view while already on the Build tab re-initializes the builder (watcher path)', {
        tag: ['@saved-view-apply', '@all', '@logs', '@P0'],
    }, async ({ page }) => {
        testLogger.info('Testing watcher path: apply while the Build tab is already mounted');

        const viewA = uniqueViewName();
        const viewB = uniqueViewName();
        createdViews.push(viewA, viewB);

        await pm.logsPage.enableSqlModeIfNeeded();
        await pm.logsPage.setQueryEditorContent('');
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Save viewA with a line chart
        await pm.logsPage.selectChartType('line');
        await pm.logsPage.verifyChartTypeSelected('line');
        await pm.logsPage.clickSaveViewButton();
        await pm.logsPage.fillSavedViewName(viewA);
        await pm.logsPage.clickSavedViewDialogSave();

        // Save viewB with a bar chart (still on the Build tab — no remount)
        await pm.logsPage.selectChartType('bar');
        await pm.logsPage.verifyChartTypeSelected('bar');
        await pm.logsPage.clickSaveViewButton();
        await pm.logsPage.fillSavedViewName(viewB);
        await pm.logsPage.clickSavedViewDialogSave();

        // Apply viewA while still on the Build tab → watcher re-initializes to line
        await pm.logsPage.clickSavedViewsExpand();
        await pm.logsPage.fillSavedViewSearchInput(viewA);
        await pm.logsPage.clickSavedViewByTitle(viewA);
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.verifyChartTypeSelected('line');

        // Apply viewB while still on the Build tab → watcher re-initializes to bar
        await pm.logsPage.clickSavedViewsExpand();
        await pm.logsPage.fillSavedViewSearchInput(viewB);
        await pm.logsPage.clickSavedViewByTitle(viewB);
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Watcher path re-initializes the mounted Build tab - PASSED');
    });

    // ============================================================================
    // P1 — Important variations
    // ============================================================================

    test('Custom-query saved view restores to Custom mode + table chart', {
        tag: ['@saved-view-apply', '@all', '@logs', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Testing custom-query saved view restore');

        const viewName = uniqueViewName();
        createdViews.push(viewName);

        await pm.logsPage.enableSqlModeIfNeeded();
        await pm.logsPage.setQueryEditorContent('');
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Switch to Custom query mode (auto-selects a table chart)
        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectCustomModeSelected();

        // Save the custom-query view
        await pm.logsPage.clickSaveViewButton();
        await pm.logsPage.fillSavedViewName(viewName);
        await pm.logsPage.clickSavedViewDialogSave();

        // Switch to Logs, then apply the view (onMounted path)
        await pm.logsPage.clickLogsToggle();
        await pm.logsPage.clickSavedViewsExpand();
        await pm.logsPage.fillSavedViewSearchInput(viewName);
        await pm.logsPage.clickSavedViewByTitle(viewName);

        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.expectApplySuccessNotification(viewName);

        // Restored to Custom mode with a table chart (not a re-parsed builder query)
        await pm.logsPage.expectCustomModeSelected();
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Custom-query saved view restores to Custom mode + table chart - PASSED');
    });

    test('View saved without buildData (Logs-tab save) applies without breaking Build tab', {
        tag: ['@saved-view-apply', '@all', '@logs', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Testing a Logs-tab (no buildData) saved view applies cleanly');

        const viewName = uniqueViewName();
        createdViews.push(viewName);

        // Save a view from the Logs tab (never enter the Build tab)
        await pm.logsPage.enableSqlModeIfNeeded();
        const query = 'SELECT histogram(_timestamp) as "x_axis_1", count(*) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await pm.logsPage.setQueryEditorContent(query);
        await runQuery(pm);

        await pm.logsPage.clickSaveViewButton();
        await pm.logsPage.fillSavedViewName(viewName);
        await pm.logsPage.clickSavedViewDialogSave();

        // Apply the view and confirm it applies
        await pm.logsPage.clickSavedViewsExpand();
        await pm.logsPage.fillSavedViewSearchInput(viewName);
        await pm.logsPage.clickSavedViewByTitle(viewName);
        await pm.logsPage.expectApplySuccessNotification(viewName);

        // Switch to Build tab: builder re-derives from the logs query without error
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Logs-tab saved view applies without breaking Build tab - PASSED');
    });

    // ============================================================================
    // P2 — Edge cases
    // ============================================================================

    test('One-shot semantics: toggling away and back re-derives instead of re-restoring', {
        tag: ['@saved-view-apply', '@all', '@logs', '@P2'],
    }, async ({ page }) => {
        testLogger.info('Testing savedBuildConfig one-shot consumption');

        const viewName = uniqueViewName();
        createdViews.push(viewName);

        await pm.logsPage.enableSqlModeIfNeeded();
        await pm.logsPage.setQueryEditorContent('');
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Save a build view with a non-default chart (line)
        await pm.logsPage.selectChartType('line');
        await pm.logsPage.verifyChartTypeSelected('line');
        await pm.logsPage.clickSaveViewButton();
        await pm.logsPage.fillSavedViewName(viewName);
        await pm.logsPage.clickSavedViewDialogSave();

        // Switch to Logs, then apply → Build tab restores 'line'
        await pm.logsPage.clickLogsToggle();
        await pm.logsPage.clickSavedViewsExpand();
        await pm.logsPage.fillSavedViewSearchInput(viewName);
        await pm.logsPage.clickSavedViewByTitle(viewName);
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.verifyChartTypeSelected('line');

        // Toggle Logs → Build (remount, no new apply): savedBuildConfig is now null,
        // so the builder re-derives from the logs query (histogram → bar, not line)
        await pm.logsPage.clickLogsToggle();
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.verifyChartTypeSelected('line', false);

        testLogger.info('One-shot semantics verified - PASSED');
    });
});

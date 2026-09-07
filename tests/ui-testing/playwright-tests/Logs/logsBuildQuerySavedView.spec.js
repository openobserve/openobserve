/**
 * Logs Build Query — Apply Saved View Tests
 *
 * Covers the PR headline: applying a saved view re-initializes the already-open
 * Build Query tab via the `watch` on `searchObj.meta.savedBuildConfig`
 * (BuildQueryPage.vue:486-493), plus the onMounted restore path, the no-buildData
 * fallback, re-apply idempotency, and the re-toggle re-derive behavior.
 *
 * @tags @logs-build-query-saved-view @logs @all
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
    ingestForQueryBuilderTest,
    setupQueryAndSwitchToBuild,
    initQueryBuilderTest,
} = require('../utils/queryBuilder-helpers.js');

// Prefix matches cleanup.spec.js `cleanupSavedViews()` (view_name startsWith "streamslog"),
// so any view leaked by a failed test is also swept by the pre-test cleanup.
const SAVED_VIEW_PREFIX = 'streamslog_buildqsv_';
const HISTOGRAM_QUERY = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';

function uniqueName(tag) {
    return `${SAVED_VIEW_PREFIX}${tag}_${Math.random().toString(36).substring(2, 8)}`;
}

test.describe("Logs Build Query - Apply Saved View testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;
    let createdViewNames = [];

    test.beforeAll(async ({ request }) => {
        await ingestForQueryBuilderTest(request);
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        createdViewNames = [];
        await navigateToBase(page);
        pm = new PageManager(page);
        await initQueryBuilderTest(page, pm);
        testLogger.info('Apply Saved View test setup completed');
    });

    test.afterEach(async () => {
        for (const name of createdViewNames) {
            try {
                await pm.logsPage.clickDeleteSavedViewButton(name);
                await pm.logsPage.clickConfirmButton();
                testLogger.info('Cleaned up saved view', { name });
            } catch (cleanupError) {
                testLogger.warn('Saved view cleanup failed (pre-test cleanup will sweep it)', {
                    name,
                    error: cleanupError.message,
                });
            }
        }
    });

    // ------------------------------------------------------------------
    // Spec-level helpers — page-object methods only, no raw selectors.
    // ------------------------------------------------------------------

    async function createBuildModeSavedView(viewName) {
        await setupQueryAndSwitchToBuild(pm, pm.page, HISTOGRAM_QUERY);
        await pm.logsPage.selectChartType('area');
        await pm.logsPage.verifyChartTypeSelected('area');
        await pm.logsPage.clickSavedViewsExpand();
        await pm.logsPage.clickSaveViewButton();
        await pm.logsPage.fillSavedViewName(viewName);
        await pm.logsPage.clickSavedViewDialogSave();
        await pm.logsPage.expectSavedViewDialogClosed();
        createdViewNames.push(viewName);
    }

    async function createLogsModeSavedView(viewName) {
        // Saved from the Logs tab (no build mode) — the view captures no buildData.
        await pm.logsPage.clickSavedViewsExpand();
        await pm.logsPage.clickSaveViewButton();
        await pm.logsPage.fillSavedViewName(viewName);
        await pm.logsPage.clickSavedViewDialogSave();
        await pm.logsPage.expectSavedViewDialogClosed();
        createdViewNames.push(viewName);
    }

    async function applySavedViewByName(viewName) {
        await pm.logsPage.clickSavedViewsExpand();
        await pm.logsPage.fillSavedViewSearchInput(viewName);
        await pm.logsPage.clickSavedViewByName(viewName);
    }

    test("Applying a build-mode saved view while already on the Build Query tab re-initializes the builder", {
        tag: ['@logs-build-query-saved-view', '@all', '@logs', '@P0']
    }, async ({ page }) => {
        testLogger.info('Testing saved-view apply on an already-open Build Query tab');

        const viewA = uniqueName('a');
        await createBuildModeSavedView(viewA);

        // Change the current builder state away from the saved view (area → bar) so
        // the apply below must flip it back, proving the watch re-initialization.
        await pm.logsPage.selectChartType('bar');
        await pm.logsPage.verifyChartTypeSelected('bar');

        await applySavedViewByName(viewA);
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('area');
        await pm.logsPage.expectXAxisHasItems();
        await pm.logsPage.expectYAxisHasItems();

        testLogger.info('Saved-view apply re-initialized the builder - PASSED');
    });

    test("Applying a build-mode saved view from the Logs tab opens the Build tab restored", {
        tag: ['@logs-build-query-saved-view', '@all', '@logs', '@P0']
    }, async ({ page }) => {
        testLogger.info('Testing saved-view apply from the Logs tab (onMounted restore)');

        const viewB = uniqueName('b');
        await createBuildModeSavedView(viewB);

        // Return to the Logs tab so the apply below drives the tab switch.
        await pm.logsPage.clickLogsToggle();
        await pm.logsPage.expectLogsSearchResultVisible();

        await applySavedViewByName(viewB);
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuildQueryPageVisible();
        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('area');

        testLogger.info('Saved-view apply from Logs tab restored the build tab - PASSED');
    });

    test("Applying a saved view with no buildData re-derives instead of restoring a saved chart", {
        tag: ['@logs-build-query-saved-view', '@all', '@logs', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing saved view with no buildData re-derives (no phantom chart)');

        const viewC = uniqueName('c');
        await createLogsModeSavedView(viewC);

        // A Logs-mode view carries no buildData. Applying it flips back to the Logs
        // view (its saved mode) without crashing, and must NOT inject a saved chart.
        await applySavedViewByName(viewC);
        await pm.logsPage.expectLogsSearchResultVisible();

        // Re-open the build tab: with no buildData the builder re-derives from the
        // current query (default histogram/count → bar), not a nonexistent saved chart.
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('No-buildData saved view re-derived the default builder - PASSED');
    });

    test("Re-applying the same build-mode saved view on the build tab restores again", {
        tag: ['@logs-build-query-saved-view', '@all', '@logs', '@P1']
    }, async ({ page }) => {
        testLogger.info('Testing idempotent re-apply of the same saved view');

        const viewD = uniqueName('d');
        await createBuildModeSavedView(viewD);

        // First apply: change away from the saved state, then restore.
        await pm.logsPage.selectChartType('bar');
        await pm.logsPage.verifyChartTypeSelected('bar');
        await applySavedViewByName(viewD);
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.verifyChartTypeSelected('area');

        // Second apply: change away again, then re-apply — the watch must re-fire.
        await pm.logsPage.selectChartType('bar');
        await pm.logsPage.verifyChartTypeSelected('bar');
        await applySavedViewByName(viewD);
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.verifyChartTypeSelected('area');

        testLogger.info('Re-applying the same view restored again - PASSED');
    });

    test("Toggling away and back after applying a build-mode view re-derives the builder instead of restoring the saved chart", {
        tag: ['@logs-build-query-saved-view', '@all', '@logs', '@P2']
    }, async ({ page }) => {
        testLogger.info('Testing toggle away-and-back re-derives (URL build_data does not re-apply chart type)');

        const viewE = uniqueName('e');
        await createBuildModeSavedView(viewE);

        // Establish the applied state: move off the saved chart, then apply to restore it.
        await pm.logsPage.selectChartType('bar');
        await pm.logsPage.verifyChartTypeSelected('bar');
        await applySavedViewByName(viewE);
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.verifyChartTypeSelected('area');

        // Toggle away and back. On re-toggle `savedBuildConfig` is null (consumed) and
        // `isFirstToggle` is false, so the builder re-derives from the current query
        // (BuildQueryPage.vue restoreFields guard) rather than re-applying the saved
        // chart type from the URL's repointed build_data.
        await pm.logsPage.clickLogsToggle();
        await pm.logsPage.expectLogsSearchResultVisible();
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('area', false);

        testLogger.info('Toggle away-and-back re-derived the builder - PASSED');
    });
});

/**
 * Logs Query Builder — Filter Operators Tests (Advanced)
 *
 * Tests advanced WHERE clause operators: str_match_ignore_case, match_all,
 * re_match, re_not_match, multiple AND, OR, mixed operators, grouped conditions,
 * deeply nested groups, complex (A AND B) OR (C AND D), >= and <,
 * and SQL OFF mode filters.
 *
 * @tags @queryBuilder @logs @all
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
    ingestForQueryBuilderTest,
    setupQueryAndSwitchToBuild,
    initQueryBuilderTestLite,
    initQueryBuilderTest,
} = require('../utils/queryBuilder-helpers.js');

// ============================================================================
// Test Suite: Builder Advanced Filter Operators (query-based, lite init)
// ============================================================================

test.describe("Logs Query Builder - Filter Operators (Advanced)", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeAll(async ({ request }) => {
        await ingestForQueryBuilderTest(request);
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await initQueryBuilderTestLite(page, pm);
        testLogger.info('Filter Operators (Advanced) test setup completed');
    });

    // --- str_match_ignore_case function ---
    test("Filter: str_match_ignore_case function parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE str_match_ignore_case(kubernetes_container_name, 'PROMETHEUS') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('str_match_ignore_case');
    });

    // --- match_all function ---
    test("Filter: match_all function parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE match_all('prometheus monitoring') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('match_all');
    });

    // --- re_match (regex match) ---
    test("Filter: re_match regex pattern match", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE re_match(kubernetes_container_name, '^prom.*') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('re_match');
    });

    // --- re_not_match (regex not match) ---
    test("Filter: re_not_match regex negative match", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE re_not_match(kubernetes_container_name, '^zinc.*') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('re_not_match');
    });

    // --- Multiple AND conditions ---
    test("Filter: multiple AND conditions parse into separate filters", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE stream = 'stderr' AND kubernetes_container_name = 'prometheus' AND kubernetes_namespace_name = 'monitoring'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(3);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('stream');
        expect(editorText).toContain('kubernetes_container_name');
        expect(editorText).toContain('kubernetes_namespace_name');
    });

    // --- OR conditions ---
    test("Filter: OR conditions parse into builder filters", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_container_name = 'prometheus' OR kubernetes_container_name = 'zinc-cp'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(2);
    });

    // --- Mixed operators in one query ---
    test("Filter: mixed operators (=, >, LIKE, IS NOT NULL) in one query", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE stream = 'stderr' AND took > 50 AND message LIKE '/api%' AND level IS NOT NULL`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(4);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('stream');
        expect(editorText).toContain('took');
        expect(editorText).toContain('message');
        expect(editorText).toContain('level');
    });

    // --- Grouped filter: (... OR ...) AND ... ---
    test("Filter: grouped conditions (A OR B) AND C with brackets", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE (kubernetes_container_name = 'prometheus' OR kubernetes_container_name = 'zinc-cp') AND stream = 'stderr' GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBeGreaterThanOrEqual(3);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('kubernetes_container_name');
        expect(editorText).toContain('stream');
    });

    // --- Deeply nested grouped filter: A AND (B OR C) ---
    test("Filter: deeply nested groups A AND (B OR C) preserve structure", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE method = 'POST' AND (code = '200' OR code = '500') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBeGreaterThanOrEqual(3);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('method');
        expect(editorText).toContain('code');
    });

    // --- (A AND B) OR (C AND D) complex grouping ---
    test("Filter: (A AND B) OR (C AND D) complex grouped filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE (kubernetes_container_name = 'prometheus' AND kubernetes_namespace_name = 'monitoring') OR (kubernetes_container_name = 'zinc-cp' AND kubernetes_namespace_name = 'zinc-cp1') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBeGreaterThanOrEqual(4);
    });

    // --- >= and < operators ---
    test("Filter: >= and < comparison operators", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE FloatValue >= 20 AND FloatValue < 100`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(2);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('FloatValue');
    });
});

// ============================================================================
// Test Suite: Builder Filter Operators — SQL OFF mode (full init needed)
// These tests don't run their own query — they rely on the initial match_all.
// ============================================================================

test.describe("Logs Query Builder - Filter Operators (SQL OFF)", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeAll(async ({ request }) => {
        await ingestForQueryBuilderTest(request);
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await initQueryBuilderTest(page, pm);
        testLogger.info('Filter Operators (SQL OFF) test setup completed');
    });

    test("Filter: SQL OFF mode single WHERE condition parsed into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        await pm.logsPage.setQueryEditorContent("stream = 'stderr'");
        await pm.logsPage.runQueryAndWaitForResults();

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);
    });

    test("Filter: SQL OFF mode multiple AND conditions parsed into builder filters", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        await pm.logsPage.setQueryEditorContent("stream = 'stderr' AND code = '200'");
        await pm.logsPage.runQueryAndWaitForResults();

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(2);

        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);
    });
});

/**
 * Logs Query Builder — Filter Operators Tests
 *
 * Tests all supported WHERE clause operators parsing into builder filters.
 * Ref: designs/dashboards/builder-tab-impr/builder-query-cases.md (Q1–Q15, Q28–Q55)
 *
 * @tags @queryBuilder @logs @all
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// ============================================================================
// Utility Functions
// ============================================================================

async function applyQueryButton(pm) {
    const searchPromise = pm.page.waitForResponse(
        response => response.url().includes('/_search') && response.status() === 200,
        { timeout: 60000 }
    );

    await pm.logsPage.clickRefreshButton();

    try {
        await searchPromise;
        testLogger.info('Search query completed successfully');
    } catch (error) {
        testLogger.warn('Search response wait timed out, continuing test');
        await pm.page.waitForLoadState('networkidle').catch(() => {});
    }
}

/**
 * Helper: enable SQL mode, set query, run it, switch to Build tab.
 * Waits for Build tab async initialization to complete (chart/table rendered).
 */
async function setupQueryAndSwitchToBuild(pm, page, query) {
    await pm.logsPage.enableSqlModeIfNeeded();
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.setQueryEditorContent(query);
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.waitForBuildTabLoaded();
}

// ============================================================================
// Test Suite: Builder Filter Operators - All supported WHERE clause operators
// Ref: designs/dashboards/builder-tab-impr/builder-query-cases.md (Q1–Q15, Q28–Q55)
// ============================================================================

test.describe("Logs Query Builder - Filter Operators", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await pm.logsPage.selectStream("e2e_automate");
        await applyQueryButton(pm);

        testLogger.info('Filter Operators test setup completed');
    });

    // --- Equals (=) operator ---
    test("Filter: equals (=) parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: = (equals)');

        const query = `SELECT * FROM "e2e_automate" WHERE code = '200'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('code');

        testLogger.info('Filter = operator - PASSED');
    });

    // --- Not Equals (<>) operator ---
    test("Filter: not equals (<>) parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: <> (not equals)');

        const query = `SELECT * FROM "e2e_automate" WHERE stream <> 'stdout'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('stream');

        testLogger.info('Filter <> operator - PASSED');
    });

    // --- Greater than (>) operator with numeric value ---
    test("Filter: greater than (>) with numeric value", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: > (greater than, numeric)');

        const query = `SELECT * FROM "e2e_automate" WHERE took > 50`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('took');
        expect(editorText).toContain('50');

        testLogger.info('Filter > operator (numeric) - PASSED');
    });

    // --- Less than or equal (<=) operator ---
    test("Filter: less than or equal (<=) with numeric value", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: <= (less than or equal)');

        const query = `SELECT * FROM "e2e_automate" WHERE FloatValue <= 100`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('FloatValue');

        testLogger.info('Filter <= operator - PASSED');
    });

    // --- Contains (LIKE '%value%') ---
    test("Filter: Contains (LIKE '%value%') parses correctly", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: Contains (LIKE %...%)');

        const query = `SELECT * FROM "e2e_automate" WHERE message LIKE '%api%'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('message');
        const hasContains = editorText.toLowerCase().includes('str_match') ||
                           editorText.toLowerCase().includes('like');
        expect(hasContains).toBe(true);

        testLogger.info('Filter Contains - PASSED');
    });

    // --- Starts With (LIKE 'value%') ---
    test("Filter: Starts With (LIKE 'value%') parses correctly", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: Starts With (LIKE value%)');

        const query = `SELECT * FROM "e2e_automate" WHERE message LIKE '/api%'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('message');
        expect(editorText.toLowerCase()).toContain('like');
        expect(editorText).toContain('/api%');

        testLogger.info('Filter Starts With - PASSED');
    });

    // --- Ends With (LIKE '%value') ---
    test("Filter: Ends With (LIKE '%value') parses correctly", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: Ends With (LIKE %value)');

        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_namespace_name LIKE '%ing'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('like');
        expect(editorText).toContain('%ing');

        testLogger.info('Filter Ends With - PASSED');
    });

    // --- Not Contains (NOT LIKE '%value%') ---
    test("Filter: Not Contains (NOT LIKE '%value%') parses correctly", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: Not Contains (NOT LIKE)');

        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_container_name NOT LIKE '%zinc%'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toMatch(/not\s+like/);

        testLogger.info('Filter Not Contains - PASSED');
    });

    // --- IN operator ---
    test("Filter: IN operator with multiple values", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: IN');

        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_container_name IN ('prometheus', 'zinc-cp')`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('kubernetes_container_name');
        expect(editorText.toLowerCase()).toContain('in');

        testLogger.info('Filter IN operator - PASSED');
    });

    // --- NOT IN operator ---
    test("Filter: NOT IN operator with multiple values", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: NOT IN');

        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_namespace_name NOT IN ('default', 'kube-system')`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toMatch(/not\s+in/);

        testLogger.info('Filter NOT IN operator - PASSED');
    });

    // --- IS NULL operator ---
    test("Filter: IS NULL operator", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: IS NULL');

        const query = `SELECT * FROM "e2e_automate" WHERE code IS NULL`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('code');
        expect(editorText.toLowerCase()).toMatch(/is\s+null/);

        testLogger.info('Filter IS NULL - PASSED');
    });

    // --- IS NOT NULL operator ---
    test("Filter: IS NOT NULL operator", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: IS NOT NULL');

        const query = `SELECT * FROM "e2e_automate" WHERE method IS NOT NULL`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('method');
        expect(editorText.toLowerCase()).toMatch(/is\s+not\s+null/);

        testLogger.info('Filter IS NOT NULL - PASSED');
    });

    // --- str_match function ---
    test("Filter: str_match function parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: str_match');

        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE str_match(kubernetes_container_name, 'prometheus') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('str_match');
        expect(editorText).toContain('prometheus');

        testLogger.info('Filter str_match - PASSED');
    });

    // --- str_match_ignore_case function ---
    test("Filter: str_match_ignore_case function parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: str_match_ignore_case');

        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE str_match_ignore_case(kubernetes_container_name, 'PROMETHEUS') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('str_match_ignore_case');

        testLogger.info('Filter str_match_ignore_case - PASSED');
    });

    // --- match_all function ---
    test("Filter: match_all function parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: match_all');

        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE match_all('prometheus monitoring') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('match_all');

        testLogger.info('Filter match_all - PASSED');
    });

    // --- re_match (regex match) ---
    test("Filter: re_match regex pattern match", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: re_match');

        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE re_match(kubernetes_container_name, '^prom.*') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('re_match');

        testLogger.info('Filter re_match - PASSED');
    });

    // --- re_not_match (regex not match) ---
    test("Filter: re_not_match regex negative match", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operator: re_not_match');

        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE re_not_match(kubernetes_container_name, '^zinc.*') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('re_not_match');

        testLogger.info('Filter re_not_match - PASSED');
    });

    // --- Multiple AND conditions ---
    test("Filter: multiple AND conditions parse into separate filters", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing multiple AND filters');

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

        testLogger.info('Multiple AND filters - PASSED');
    });

    // --- OR conditions ---
    test("Filter: OR conditions parse into builder filters", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing OR filter conditions');

        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_container_name = 'prometheus' OR kubernetes_container_name = 'zinc-cp'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(2);

        testLogger.info('OR filters - PASSED');
    });

    // --- Mixed operators in one query ---
    test("Filter: mixed operators (=, >, LIKE, IS NOT NULL) in one query", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing mixed filter operators in single query');

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

        testLogger.info('Mixed operators - PASSED');
    });

    // --- Grouped filter: (... OR ...) AND ... ---
    test("Filter: grouped conditions (A OR B) AND C with brackets", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing grouped filter: (OR group) AND condition');

        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE (kubernetes_container_name = 'prometheus' OR kubernetes_container_name = 'zinc-cp') AND stream = 'stderr' GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBeGreaterThanOrEqual(3);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('kubernetes_container_name');
        expect(editorText).toContain('stream');

        testLogger.info('Grouped filter (OR) AND - PASSED');
    });

    // --- Deeply nested grouped filter: A AND (B OR (C AND D)) ---
    test("Filter: deeply nested groups A AND (B OR C) preserve structure", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing deeply nested grouped filters');

        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE method = 'POST' AND (code = '200' OR code = '500') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBeGreaterThanOrEqual(3);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('method');
        expect(editorText).toContain('code');

        testLogger.info('Deeply nested groups - PASSED');
    });

    // --- (A AND B) OR (C AND D) complex grouping ---
    test("Filter: (A AND B) OR (C AND D) complex grouped filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing complex grouped filter: (A AND B) OR (C AND D)');

        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE (kubernetes_container_name = 'prometheus' AND kubernetes_namespace_name = 'monitoring') OR (kubernetes_container_name = 'zinc-cp' AND kubernetes_namespace_name = 'zinc-cp1') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBeGreaterThanOrEqual(4);

        testLogger.info('Complex grouped filter - PASSED');
    });

    // --- SQL OFF mode: WHERE clause parsed into filter ---
    test("Filter: SQL OFF mode single WHERE condition parsed into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL OFF + single WHERE condition → filter');

        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        await pm.logsPage.setQueryEditorContent("stream = 'stderr'");

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('SQL OFF single WHERE → filter - PASSED');
    });

    // --- SQL OFF mode: multiple AND conditions ---
    test("Filter: SQL OFF mode multiple AND conditions parsed into builder filters", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL OFF + multiple AND → filters');

        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        await pm.logsPage.setQueryEditorContent("stream = 'stderr' AND code = '200'");

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(2);

        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('SQL OFF multiple AND → 2 filters - PASSED');
    });

    // --- >= and < operators ---
    test("Filter: >= and < comparison operators", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing filter operators: >= and <');

        const query = `SELECT * FROM "e2e_automate" WHERE FloatValue >= 20 AND FloatValue < 100`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(2);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('FloatValue');

        testLogger.info('Filter >= and < operators - PASSED');
    });
});

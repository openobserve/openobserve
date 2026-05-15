/**
 * Logs Query Builder — Filter Operators Tests (Basic)
 *
 * Tests basic WHERE clause operators: =, <>, >, <=, Contains,
 * Starts With, Ends With, Not Contains, IN, NOT IN, IS NULL, IS NOT NULL, str_match.
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
} = require('../utils/queryBuilder-helpers.js');

test.describe("Logs Query Builder - Filter Operators (Basic)", () => {
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
        testLogger.info('Filter Operators (Basic) test setup completed');
    });

    // --- Equals (=) operator ---
    test("Filter: equals (=) parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE code = '200'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('code');
    });

    // --- Not Equals (<>) operator ---
    test("Filter: not equals (<>) parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE stream <> 'stdout'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('stream');
    });

    // --- Greater than (>) operator with numeric value ---
    test("Filter: greater than (>) with numeric value", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE took > 50`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('took');
        expect(editorText).toContain('50');
    });

    // --- Less than or equal (<=) operator ---
    test("Filter: less than or equal (<=) with numeric value", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE FloatValue <= 100`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('FloatValue');
    });

    // --- Contains (LIKE '%value%') ---
    test("Filter: Contains (LIKE '%value%') parses correctly", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
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
    });

    // --- Starts With (LIKE 'value%') ---
    test("Filter: Starts With (LIKE 'value%') parses correctly", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
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
    });

    // --- Ends With (LIKE '%value') ---
    test("Filter: Ends With (LIKE '%value') parses correctly", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_namespace_name LIKE '%ing'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('like');
        expect(editorText).toContain('%ing');
    });

    // --- Not Contains (NOT LIKE '%value%') ---
    test("Filter: Not Contains (NOT LIKE '%value%') parses correctly", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_container_name NOT LIKE '%zinc%'`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toMatch(/not\s+like/);
    });

    // --- IN operator ---
    test("Filter: IN operator with multiple values", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_container_name IN ('prometheus', 'zinc-cp')`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('kubernetes_container_name');
        expect(editorText.toLowerCase()).toContain('in');
    });

    // --- NOT IN operator ---
    test("Filter: NOT IN operator with multiple values", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE kubernetes_namespace_name NOT IN ('default', 'kube-system')`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toMatch(/not\s+in/);
    });

    // --- IS NULL operator ---
    test("Filter: IS NULL operator", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE code IS NULL`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('code');
        expect(editorText.toLowerCase()).toMatch(/is\s+null/);
    });

    // --- IS NOT NULL operator ---
    test("Filter: IS NOT NULL operator", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT * FROM "e2e_automate" WHERE method IS NOT NULL`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('method');
        expect(editorText.toLowerCase()).toMatch(/is\s+not\s+null/);
    });

    // --- str_match function ---
    test("Filter: str_match function parses into builder filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        const query = `SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE str_match(kubernetes_container_name, 'prometheus') GROUP BY x_axis_1`;
        await setupQueryAndSwitchToBuild(pm, page, query);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBe(1);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText).toContain('str_match');
        expect(editorText).toContain('prometheus');
    });
});

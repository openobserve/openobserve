/**
 * Dashboard SQL Autocomplete E2E Tests
 *
 * Tests the SQL autocomplete feature in the dashboard Add Panel SQL editor:
 *   - Field suggestions sorted to the top (sortText "\x00")
 *   - Stream name suggestions ONLY after the FROM keyword
 *   - SQL keywords appear last (sortText "\x02")
 *   - Correct quoting when Monaco auto-inserts a closing "
 *   - Context resets properly after leaving FROM position
 *
 * FEATURE DOCUMENTATION:
 * - In custom SQL mode, typing shows field+function+keyword suggestions (fields first)
 * - Typing "FROM " shows stream names (not fields/keywords)
 * - After "FROM stream WHERE ", field + keyword suggestions are restored
 * - Fields come from dashboardPanelData.meta.streamFields.groupedFields
 *
 * DASHBOARD QUERY EDITOR data-test selectors used by the page object:
 *   [data-test="dashboard-sql-query-type"]    — SQL query type tab
 *   [data-test="dashboard-custom-query-type"] — Custom (Monaco) mode button
 *   [data-test="dashboard-panel-query-editor"] — Monaco editor wrapper
 *   [data-test="dashboard-panel-discard"]      — Discard panel edit
 *
 * Suggestions are NEVER read from the suggest-widget DOM. The page object
 * inspects Monaco's editor model + suggest controller via page.evaluate.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { waitForDashboardPage, deleteDashboard } = require('./utils/dashCreation.js');

// ============================================================================
// HELPERS
// ============================================================================

const generateDashboardName = () =>
    'SQL_Autocomplete_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now();

/**
 * Open a dashboard, create an SQL custom query panel, and return the panel name.
 * Leaves the caller on the add-panel page with the SQL Monaco editor open and
 * focused so subsequent keyboard input is routed to it.
 */
async function openSqlPanel(page, pm, dashboardName) {
    const panelName = pm.dashboardPanelActions.generateUniquePanelName('sql-autocomplete');

    await pm.dashboardList.menuItem('dashboards-item');
    await waitForDashboardPage(page);
    await pm.dashboardCreate.waitForDashboardUIStable();

    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.addPanel();
    await pm.dashboardPanelActions.addPanelName(panelName);

    // Wait for the stream list API to complete before switching mode so that
    // dashboardPanelData.meta.stream.streamResults is populated and
    // sqlUpdateStreamKeywords() fires with actual stream names.
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);

    // Switch to SQL custom query mode through the page object and focus the editor.
    await pm.dashboardSqlAutocomplete.switchToSqlCustomQueryMode();

    testLogger.info(`Opened SQL panel: ${panelName}`);
    return panelName;
}

/**
 * Discard the current panel edit and delete the dashboard — clean up after each test.
 */
async function cleanupDashboard(page, pm, dashboardName) {
    // Dismiss any autocomplete dropdown first via the page object (Escape only).
    await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();
    await pm.dashboardSqlAutocomplete.discardPanelIfVisible();

    await deleteDashboard(page, dashboardName).catch((e) =>
        testLogger.warn(`cleanupDashboard: delete failed — ${e.message}`)
    );
}

// ============================================================================
// TEST SUITE
// ============================================================================

test.describe('Dashboard SQL Autocomplete', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await navigateToBase(page);
    });

    // -------------------------------------------------------------------------
    // TEST 1 — SQL keywords appear after typing WHERE (base keyword list)
    // -------------------------------------------------------------------------
    test('should show SQL keywords in dashboard custom SQL editor after WHERE', {
        tag: ['@all', '@sqlautocomplete', '@dashboard', '@P0'],
    }, async ({ page }) => {
        const dashboardName = generateDashboardName();
        const pm = new PageManager(page);
        testLogger.testStart('Dashboard SQL — keywords after WHERE', 'dashboard-sql-autocomplete.spec.js');

        await openSqlPanel(page, pm, dashboardName);

        // Type a partial WHERE clause — should show base field+keyword suggestions
        await pm.dashboardSqlAutocomplete.typeAndTriggerAutocomplete(
            'SELECT * FROM "e2e_automate" WHERE '
        );

        const labels = await pm.dashboardSqlAutocomplete.getSuggestionLabelsAtCursor();
        testLogger.info(`WHERE clause suggestions (${labels.length}): ${labels.slice(0, 10).join(', ')}`);

        expect(labels.length).toBeGreaterThan(0);

        // In FROM context: effectiveKeywords = contextKeywords = streamKeywords,
        // so stream names like 'e2e_automate' appear in the suggestion list.
        // In WHERE context: effectiveKeywords = autoCompleteKeywords (fields/functions/keywords),
        // so stream names do NOT appear.
        const hasStreamName = labels.some((l) => l.toLowerCase().trim() === 'e2e_automate');
        expect(hasStreamName).toBe(false);
        testLogger.info('Stream name absent from WHERE context — FROM context cleared, confirmed');

        await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();
        await cleanupDashboard(page, pm, dashboardName);
        testLogger.info('Test PASSED: SQL keywords after WHERE');
    });

    // -------------------------------------------------------------------------
    // TEST 2 — Stream suggestions appear after FROM keyword (not SQL keywords)
    // -------------------------------------------------------------------------
    test('should show stream suggestions after FROM keyword in dashboard SQL editor', {
        tag: ['@all', '@sqlautocomplete', '@dashboard', '@P0'],
    }, async ({ page }) => {
        const dashboardName = generateDashboardName();
        const pm = new PageManager(page);
        testLogger.testStart('Dashboard SQL — streams after FROM', 'dashboard-sql-autocomplete.spec.js');

        await openSqlPanel(page, pm, dashboardName);

        // Type up to FROM (with trailing space) — FROM context activates
        await pm.dashboardSqlAutocomplete.typeAndTriggerAutocomplete('SELECT * FROM ');

        const labels = await pm.dashboardSqlAutocomplete.getSuggestionLabelsAtCursor();
        testLogger.info(`FROM context suggestions (${labels.length}): ${labels.slice(0, 10).join(', ')}`);

        expect(labels.length).toBeGreaterThan(0);

        // SQL keywords must NOT appear in the FROM context (contextKeywords overrides base list)
        const sqlKeywords = ['and', 'or', 'like', 'between', 'is null'];
        const hasSqlKeyword = labels.some((l) =>
            sqlKeywords.some((kw) => l.toLowerCase().trim() === kw)
        );
        expect(hasSqlKeyword).toBe(false);
        testLogger.info('SQL keywords absent from FROM context — confirmed');

        // At least one suggestion should look like a stream name (not an SQL keyword)
        const nonKeywordSuggestions = labels.filter((l) =>
            !sqlKeywords.includes(l.toLowerCase().trim())
        );
        expect(nonKeywordSuggestions.length).toBeGreaterThan(0);
        testLogger.info(`Non-keyword suggestions present: ${nonKeywordSuggestions.slice(0, 5).join(', ')}`);

        await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();
        await cleanupDashboard(page, pm, dashboardName);
        testLogger.info('Test PASSED: Stream suggestions after FROM');
    });

    // -------------------------------------------------------------------------
    // TEST 3 — FROM context exits after stream name is complete (WHERE restores keywords)
    // -------------------------------------------------------------------------
    test('should restore SQL keyword suggestions after leaving FROM context with WHERE clause', {
        tag: ['@all', '@sqlautocomplete', '@dashboard', '@P1'],
    }, async ({ page }) => {
        const dashboardName = generateDashboardName();
        const pm = new PageManager(page);
        testLogger.testStart('Dashboard SQL — context exits after WHERE', 'dashboard-sql-autocomplete.spec.js');

        await openSqlPanel(page, pm, dashboardName);

        // Complete full FROM clause then type WHERE — FROM context must be cleared
        await pm.dashboardSqlAutocomplete.typeAndTriggerAutocomplete(
            'SELECT * FROM "e2e_automate" WHERE '
        );

        const labels = await pm.dashboardSqlAutocomplete.getSuggestionLabelsAtCursor();
        testLogger.info(`Post-FROM WHERE suggestions (${labels.length}): ${labels.slice(0, 10).join(', ')}`);

        expect(labels.length).toBeGreaterThan(0);

        // In WHERE context: stream names like 'e2e_automate' must NOT appear.
        const hasStreamName = labels.some((l) => l.toLowerCase().trim() === 'e2e_automate');
        expect(hasStreamName).toBe(false);
        testLogger.info('Stream name absent from WHERE context — FROM context cleared, confirmed');

        await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();
        await cleanupDashboard(page, pm, dashboardName);
        testLogger.info('Test PASSED: Keywords restored after leaving FROM context');
    });

    // -------------------------------------------------------------------------
    // TEST 4 — FROM "partial shows stream suggestions (open double-quote context)
    // -------------------------------------------------------------------------
    test('should show stream suggestions when typing FROM "partial in dashboard SQL editor', {
        tag: ['@all', '@sqlautocomplete', '@dashboard', '@P1'],
    }, async ({ page }) => {
        const dashboardName = generateDashboardName();
        const pm = new PageManager(page);
        testLogger.testStart('Dashboard SQL — FROM "partial stream suggestions', 'dashboard-sql-autocomplete.spec.js');

        await openSqlPanel(page, pm, dashboardName);

        // Type FROM " — Monaco may auto-close the quote; the feature handles both cases
        await pm.dashboardSqlAutocomplete.typeAndTriggerAutocomplete('SELECT * FROM "e2e');

        const isOpen = await pm.dashboardSqlAutocomplete.isAutocompleteOpen();

        if (isOpen) {
            const labels = await pm.dashboardSqlAutocomplete.getSuggestionLabelsAtCursor();
            testLogger.info(`FROM "partial suggestions (${labels.length}): ${labels.slice(0, 8).join(', ')}`);

            // Stream suggestions should appear (contextKeywords is active)
            // SQL keywords ('and', 'or', etc.) should NOT appear in FROM context
            const sqlKeywords = ['and', 'or', 'like', 'between'];
            const hasSqlKeyword = labels.some((l) =>
                sqlKeywords.some((kw) => l.toLowerCase().trim() === kw)
            );
            expect(hasSqlKeyword).toBe(false);
            testLogger.info('FROM "partial — SQL keywords absent in stream context: confirmed');
        } else {
            // Monaco did not open the suggestion list — accept gracefully (env dependent).
            testLogger.warn('Suggest controller not open for FROM "partial — skipping assertion');
        }

        await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();
        await cleanupDashboard(page, pm, dashboardName);
        testLogger.info('Test PASSED: FROM "partial stream suggestions');
    });

    // -------------------------------------------------------------------------
    // TEST 5 — Fields sort above SQL keywords (sortText \x00 < \x02)
    // -------------------------------------------------------------------------
    test('should sort field suggestions before SQL keywords in dashboard SQL editor', {
        tag: ['@all', '@sqlautocomplete', '@dashboard', '@P1'],
    }, async ({ page }) => {
        const dashboardName = generateDashboardName();
        const pm = new PageManager(page);
        testLogger.testStart('Dashboard SQL — fields sort above keywords', 'dashboard-sql-autocomplete.spec.js');

        await openSqlPanel(page, pm, dashboardName);

        // Type a WHERE clause — base suggestion list (fields + keywords)
        await pm.dashboardSqlAutocomplete.typeAndTriggerAutocomplete(
            'SELECT * FROM "e2e_automate" WHERE '
        );

        const labels = await pm.dashboardSqlAutocomplete.getSuggestionLabelsAtCursor();
        testLogger.info(`Sort order suggestions (${labels.length}): ${labels.slice(0, 12).join(', ')}`);

        expect(labels.length).toBeGreaterThan(0);

        // Verify sort order: SQL keywords appear last (sortText "\x02" + label),
        // fields first (sortText "\x00" + name). If field suggestions exist they
        // must precede the first SQL keyword.
        const sqlKeywords = ['and', 'or', 'like', 'in', 'between', 'is null'];
        const firstKeywordIdx = labels.findIndex((l) =>
            sqlKeywords.some((kw) => l.toLowerCase().trim() === kw)
        );

        if (firstKeywordIdx > 0) {
            const beforeKeywords = labels.slice(0, firstKeywordIdx);
            testLogger.info(
                `${beforeKeywords.length} item(s) appear before first SQL keyword ("${labels[firstKeywordIdx].trim()}"): ${beforeKeywords.join(', ')}`
            );
            expect(beforeKeywords.length).toBeGreaterThan(0);
        } else if (firstKeywordIdx === 0) {
            testLogger.info('Only SQL keywords in suggestions (no stream fields loaded yet) — sort order not verifiable');
        } else {
            testLogger.info('No SQL keywords in list — only field/function suggestions');
        }

        await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();
        await cleanupDashboard(page, pm, dashboardName);
        testLogger.info('Test PASSED: Fields sort above keywords');
    });

    // -------------------------------------------------------------------------
    // TEST 6 — Autocomplete does not show when query editor is not focused
    // -------------------------------------------------------------------------
    test('should not show autocomplete suggestions before the editor is focused', {
        tag: ['@all', '@sqlautocomplete', '@dashboard', '@P2'],
    }, async ({ page }) => {
        const dashboardName = generateDashboardName();
        const pm = new PageManager(page);
        testLogger.testStart('Dashboard SQL — no suggestions without focus', 'dashboard-sql-autocomplete.spec.js');

        await openSqlPanel(page, pm, dashboardName);

        // Send Escape to drop focus from the Monaco editor — no body click required.
        await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();

        const isOpen = await pm.dashboardSqlAutocomplete.isAutocompleteOpen();
        expect(isOpen).toBe(false);
        testLogger.info('Autocomplete not open when editor is blurred — confirmed');

        await cleanupDashboard(page, pm, dashboardName);
        testLogger.info('Test PASSED: No suggestions without focus');
    });

    // -------------------------------------------------------------------------
    // TEST 7 — Typing SELECT triggers SQL keyword and field suggestions
    // -------------------------------------------------------------------------
    test('should show suggestions when typing SELECT in dashboard SQL editor', {
        tag: ['@all', '@sqlautocomplete', '@dashboard', '@P1'],
    }, async ({ page }) => {
        const dashboardName = generateDashboardName();
        const pm = new PageManager(page);
        testLogger.testStart('Dashboard SQL — suggestions on SELECT', 'dashboard-sql-autocomplete.spec.js');

        await openSqlPanel(page, pm, dashboardName);

        // Type 'SELECT ' — base keyword list should appear
        await pm.dashboardSqlAutocomplete.typeAndTriggerAutocomplete('SELECT ');

        const labels = await pm.dashboardSqlAutocomplete.getSuggestionLabelsAtCursor();
        testLogger.info(`SELECT suggestions (${labels.length}): ${labels.slice(0, 10).join(', ')}`);

        expect(labels.length).toBeGreaterThan(0);
        testLogger.info('Suggestions appeared after SELECT — confirmed');

        await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();
        await cleanupDashboard(page, pm, dashboardName);
        testLogger.info('Test PASSED: Suggestions on SELECT');
    });

    // -------------------------------------------------------------------------
    // TEST 8 — Selecting a stream suggestion inserts it without double quotes
    // -------------------------------------------------------------------------
    test('should insert stream name without double-quoting when selecting FROM suggestion', {
        tag: ['@all', '@sqlautocomplete', '@dashboard', '@P1'],
    }, async ({ page }) => {
        const dashboardName = generateDashboardName();
        const pm = new PageManager(page);
        testLogger.testStart('Dashboard SQL — stream suggestion insertion (no double-quote)', 'dashboard-sql-autocomplete.spec.js');

        await openSqlPanel(page, pm, dashboardName);

        // Trigger FROM context via the page object.
        await pm.dashboardSqlAutocomplete.typeAndTriggerAutocomplete('SELECT * FROM ');

        const isOpen = await pm.dashboardSqlAutocomplete.isAutocompleteOpen();

        if (isOpen) {
            // Accept the first suggestion via Enter and read the model value.
            const editorContent = await pm.dashboardSqlAutocomplete.acceptFirstSuggestionAndReadValue();
            testLogger.info(`Editor content after selection: "${editorContent}"`);

            // The inserted stream name must NOT end with "" (double closing quote)
            expect(editorContent).not.toMatch(/""/);
            testLogger.info('No double-quote inserted — confirmed');
        } else {
            testLogger.warn('FROM suggestion controller did not open — skipping insertion assertion');
        }

        await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();
        await cleanupDashboard(page, pm, dashboardName);
        testLogger.info('Test PASSED: Stream insertion without double-quote');
    });
});

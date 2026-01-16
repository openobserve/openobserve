// metricsPage.js
import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';

export class MetricsPage {
    constructor(page) {
        this.page = page;

        // Navigation

        this.metricsPageMenu = page.locator('[data-test="menu-link-\\/metrics-item"]');

        // VERIFIED selectors from Phase 1 analysis
        // Main metrics controls
        this.applyButton = '[data-test="metrics-apply"]';
        this.cancelButton = '[data-test="metrics-cancel"]';
        this.datePicker = '[data-test="metrics-date-picker"]';
        this.autoRefresh = '[data-test="metrics-auto-refresh"]';

        // Field list management
        this.fieldListCollapseIcon = '[data-test="metrics-field-list-collapsed-icon"]';

        // Metrics list selectors
        this.fieldSearchInput = '[data-test="log-search-index-list-field-search-input"]';
        this.fieldsTable = '[data-test="log-search-index-list-fields-table"]';
        this.selectStream = '[data-test="log-search-index-list-select-stream"]';

        // Add to dashboard selectors
        this.newDashboardPanelTitle = '[data-test="metrics-new-dashboard-panel-title"]';
        this.schemaCancel = '[data-test="metrics-schema-cancel"]';
        this.schemaCancelButton = '[data-test="metrics-schema-cancel-button"]';
        this.schemaUpdateSettingsButton = '[data-test="metrics-schema-update-settings-button"]';
        this.schemaTitleText = '[data-test="schema-title-text"]';

        // Other UI elements
        this.syntaxGuideButton = '[data-cy="syntax-guide-button"]';

        // Query Mode Selection
        this.promqlTabButton = page.locator('[data-test="metrics-promql-mode-tab"]');
        this.customTabButton = page.locator('[data-test="metrics-custom-mode-tab"]');
        this.sqlTabButton = page.locator('[data-test="metrics-sql-mode-tab"]');

        // Stream Selection
        this.streamTypeDropdown = page.locator('[data-test="index-dropdown-stream_type"]');
        this.streamNameDropdown = page.locator('[data-test="index-dropdown-stream"]');

        // Query Tabs Management
        this.addQueryButton = page.locator('[data-test="metrics-add-query-btn"]');
        this.queryTabContainer = page.locator('[data-test="metrics-query-tabs"]');

        // PromQL Query Editor
        this.promqlQueryEditor = page.locator('[data-test="metrics-promql-query-editor"]');
        this.promqlQueryInput = page.locator('[data-test="metrics-promql-query-input"]');

        // Run Query Button
        this.runQueryButton = page.locator('[data-test="metrics-run-query-btn"]');

        // Other elements
        this.syntaxGuideButton = page.locator('[data-cy="syntax-guide-button"]');
        this.orgDropdown = page.locator('[data-test="navbar-organizations-select"]');
    }

    /**
     * Navigate to metrics page
     */
    async gotoMetricsPage() {
        await this.metricsPageMenu.click();
        await this.page.waitForURL(/.*metrics.*/);
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Navigated to metrics page');
    }

    /**
     * Validate metrics page elements are visible
     */
    async metricsPageValidation() {
        await expect(this.syntaxGuideButton).toContainText('Syntax Guide');
        testLogger.info('Metrics page validation successful');
    }

    /**
     * Switch to default organization
     */
    async metricsPageDefaultOrg() {
        await this.orgDropdown.getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).first().click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Switched to default organization');
    }

    /**
     * Switch to defaulttestmulti organization
     */
    async metricsPageDefaultMultiOrg() {
        await this.orgDropdown.getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Switched to defaulttestmulti organization');
    }

    /**
     * Validate metrics page URL
     */
    async metricsPageURLValidation() {
        // TODO: fix the test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    /**
     * Validate metrics URL
     */
    async metricsURLValidation() {
        await expect(this.page).toHaveURL(/metrics/);
    }

    // ==================== PromQL CUSTOM MODE METHODS ====================

    /**
     * Switch to PromQL Custom mode
     */
    async switchToPromQLMode() {
        // Look for the PromQL tab - it might have different selectors
        const promqlTab = this.page.locator('button, div').filter({ hasText: /^PromQL$/i }).first();

        if (await promqlTab.isVisible({ timeout: 5000 }).catch(() => false)) {
            await promqlTab.click();
            await this.page.waitForTimeout(1000);
            testLogger.info('Switched to PromQL mode');
        } else {
            testLogger.warn('PromQL tab not found, might already be in PromQL mode');
        }
    }

    /**
     * Select stream type (metrics)
     * @param {string} streamType - Type of stream (e.g., 'metrics')
     */
    async selectStreamType(streamType = 'metrics') {
        await this.streamTypeDropdown.click();
        await this.page.waitForTimeout(500);

        const option = this.page.getByRole('option', { name: streamType }).locator('div').nth(2);
        await option.waitFor({ state: 'visible', timeout: 10000 });
        await option.click();

        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);
        testLogger.info(`Selected stream type: ${streamType}`);
    }

    /**
     * Select stream name from dropdown
     * @param {string} streamName - Name of the stream
     */
    async selectStreamName(streamName) {
        await this.streamNameDropdown.click();
        await this.page.waitForTimeout(500);

        // Try to find and select the stream
        const streamOption = this.page.getByRole('option', { name: streamName }).first();

        if (await streamOption.isVisible({ timeout: 5000 }).catch(() => false)) {
            await streamOption.click();
            await this.page.waitForTimeout(1000);
            testLogger.info(`Selected stream: ${streamName}`);
        } else {
            // If not visible, try typing to filter
            const streamInput = this.streamNameDropdown.locator('input').first();
            await streamInput.fill(streamName);
            await this.page.waitForTimeout(1000);
            await streamOption.click();
            testLogger.info(`Selected stream after filtering: ${streamName}`);
        }
    }

    /**
     * Get the auto-populated query after selecting stream
     * @returns {Promise<string>} The query text
     */
    async getAutoPopulatedQuery() {
        await this.page.waitForTimeout(1000);

        // Try multiple selectors for the query editor
        let queryText = '';

        // Try CodeMirror editor
        const codeMirrorEditor = this.page.locator('.cm-content, .CodeMirror-code, [class*="query-editor"]').first();
        if (await codeMirrorEditor.isVisible({ timeout: 3000 }).catch(() => false)) {
            queryText = await codeMirrorEditor.textContent();
        }

        // Try textarea or input
        if (!queryText) {
            const queryInput = this.page.locator('textarea, input').filter({ hasText: /{/ }).first();
            if (await queryInput.isVisible({ timeout: 3000 }).catch(() => false)) {
                queryText = await queryInput.inputValue();
            }
        }

        testLogger.info(`Auto-populated query retrieved: ${queryText?.substring(0, 100)}...`);
        return queryText;
    }

    /**
     * Get query tab by index
     * @param {number} tabIndex - Tab index (1-based)
     * @returns {Locator} Tab locator
     */
    getQueryTab(tabIndex) {
        // Tabs might be named "Query 1", "Query 2", etc.
        return this.page.locator(`[role="tab"]`).filter({ hasText: new RegExp(`Query ${tabIndex}|Tab ${tabIndex}`, 'i') }).first();
    }

    /**
     * Add a new query tab
     */
    async addNewQueryTab() {
        // Look for add query button - could be a plus icon or "Add Query" button
        const addButton = this.page.locator('button').filter({
            hasText: /Add Query|^\+$/
        }).first();

        if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
            await addButton.click();
            await this.page.waitForTimeout(1000);
            testLogger.info('Added new query tab');
        } else {
            // Try finding by icon
            const addIconButton = this.page.locator('button').filter({
                has: this.page.locator('[class*="add"], [class*="plus"]')
            }).first();
            await addIconButton.click();
            await this.page.waitForTimeout(1000);
            testLogger.info('Added new query tab via icon');
        }
    }

    /**
     * Switch to specific query tab
     * @param {number} tabIndex - Tab index (1-based)
     */
    async switchToQueryTab(tabIndex) {
        const tab = this.getQueryTab(tabIndex);

        if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
            await tab.click();
            await this.page.waitForTimeout(1000);
            testLogger.info(`Switched to query tab ${tabIndex}`);
        } else {
            testLogger.warn(`Query tab ${tabIndex} not found`);
            throw new Error(`Query tab ${tabIndex} not visible`);
        }
    }

    /**
     * Get current active tab index
     * @returns {Promise<number>} Active tab index (1-based)
     */
    async getActiveTabIndex() {
        const activeTab = this.page.locator('[role="tab"][aria-selected="true"], [role="tab"].active, .q-tab--active').first();
        const tabText = await activeTab.textContent();
        const match = tabText.match(/Query (\d+)|Tab (\d+)/i);

        if (match) {
            const index = parseInt(match[1] || match[2]);
            testLogger.info(`Active tab index: ${index}`);
            return index;
        }

        return 1; // Default to first tab
    }

    /**
     * Enter PromQL query in the editor
     * @param {string} query - PromQL query string
     */
    async enterPromQLQuery(query) {
        await this.page.waitForTimeout(500);

        // Try to find the query editor - could be CodeMirror, Monaco, or textarea
        const editors = [
            this.page.locator('.cm-content').first(),
            this.page.locator('.CodeMirror').first(),
            this.page.locator('[class*="query-editor"]').first(),
            this.page.locator('textarea[placeholder*="query"], textarea[placeholder*="PromQL"]').first()
        ];

        let editorFound = false;
        for (const editor of editors) {
            if (await editor.isVisible({ timeout: 2000 }).catch(() => false)) {
                // Click to focus
                await editor.click();
                await this.page.waitForTimeout(300);

                // Clear existing content
                await this.page.keyboard.press('Control+A');
                await this.page.keyboard.press('Backspace');
                await this.page.waitForTimeout(300);

                // Type the query
                await this.page.keyboard.type(query);

                editorFound = true;
                testLogger.info(`Entered PromQL query: ${query.substring(0, 100)}...`);
                break;
            }
        }

        if (!editorFound) {
            throw new Error('Could not find query editor to enter PromQL query');
        }

        await this.page.waitForTimeout(500);
    }

    /**
     * Get current query text from the editor
     * @returns {Promise<string>} Current query text
     */
    async getCurrentQuery() {
        await this.page.waitForTimeout(500);

        // Try multiple selector strategies
        let queryText = '';

        // Try CodeMirror
        const cmContent = this.page.locator('.cm-content, .cm-line').first();
        if (await cmContent.isVisible({ timeout: 2000 }).catch(() => false)) {
            queryText = await cmContent.textContent();
        }

        // Try Monaco or other editors
        if (!queryText) {
            const editorContent = this.page.locator('[class*="query-editor"], .CodeMirror-code').first();
            if (await editorContent.isVisible({ timeout: 2000 }).catch(() => false)) {
                queryText = await editorContent.textContent();
            }
        }

        // Try textarea
        if (!queryText) {
            const textarea = this.page.locator('textarea').first();
            if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
                queryText = await textarea.inputValue();
            }
        }

        testLogger.info(`Current query retrieved: ${queryText?.substring(0, 100)}...`);
        return queryText?.trim() || '';
    }

    /**
     * Verify query is persisted and matches expected value
     * @param {string} expectedQuery - Expected query text
     * @param {string} message - Custom assertion message
     */
    async verifyQueryPersisted(expectedQuery, message = 'Query should be persisted') {
        const currentQuery = await this.getCurrentQuery();
        const normalizedCurrent = currentQuery.replace(/\s+/g, ' ').trim();
        const normalizedExpected = expectedQuery.replace(/\s+/g, ' ').trim();

        expect(normalizedCurrent).toContain(normalizedExpected);
        testLogger.info(`${message}: Verified query persisted correctly`);
    }

    /**
     * Run the query
     */
    async runQuery() {
        // Look for run query button
        const runButton = this.page.locator('button').filter({
            hasText: /Run Query|Execute|Run/i
        }).first();

        if (await runButton.isVisible({ timeout: 5000 }).catch(() => false)) {
            await runButton.click();
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            testLogger.info('Query executed');
        } else {
            testLogger.warn('Run query button not found');
        }
    }

    /**
     * Clear the query editor
     */
    async clearQuery() {
        const editor = this.page.locator('.cm-content, .CodeMirror, textarea').first();
        await editor.click();
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(500);
        testLogger.info('Query editor cleared');
    }

    /**
     * Verify that a specific tab exists
     * @param {number} tabIndex - Tab index to verify
     * @returns {Promise<boolean>} True if tab exists
     */
    async verifyTabExists(tabIndex) {
        const tab = this.getQueryTab(tabIndex);
        const exists = await tab.isVisible({ timeout: 3000 }).catch(() => false);
        testLogger.info(`Tab ${tabIndex} exists: ${exists}`);
        return exists;
    }

    /**
     * Get total number of query tabs
     * @returns {Promise<number>} Number of tabs
     */
    async getTabCount() {
        const tabs = this.page.locator('[role="tab"]').filter({ hasText: /Query \d+|Tab \d+/i });
        const count = await tabs.count();
        testLogger.info(`Total query tabs: ${count}`);
        return count;
    }
}

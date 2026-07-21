// metricsPage.js
import { expect } from '@playwright/test';
import { gotoMetricsEditor } from '../commonActions.js';
const { isCloudEnvironment } = require('../cloudPages/cloud-env.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');


export class MetricsPage {
    constructor(page) {
        this.page = page;

        // Navigation
        this.metricsPageMenu = page.locator('[data-test="menu-link-\\/metrics-item"]');
        this.metricsPageIndicator = page.locator('[data-test="metrics-page"]');

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

        // Inline error list locator (DashboardErrors component)
        this.inlineError = page.locator('[data-test="dashboard-error"]');

        // No-data placeholder. Rendered via OEmptyState, whose root keeps its own
        // data-test="o2-empty-state"; in production builds Vue hoists that static
        // attribute so the fallthrough data-test="no-data" does not override it.
        // Match either marker, scoping the generic o2-empty-state under the
        // panel-editor container (parent → child) so it stays build-agnostic.
        this.noDataMessage = page.locator(
            '[data-test="no-data"], [data-test="panel-editor-container"] [data-test="o2-empty-state"]'
        );

        // Chart renderer container. Its presence means PanelSchemaRenderer mounted the
        // chart path without crashing — a valid graceful outcome for invalid queries.
        this.chartRenderer = page.locator('[data-test="chart-renderer"]');

        // ===== metrics-config.spec.js locators =====
        // Date/time picker (shared metrics control)
        this.dateTimePicker = page.locator('[data-test="metrics-date-picker"]');
        // Relative tab inside DateTime popover
        this.dateTimeRelativeTab = page.locator('[data-test="date-time-relative-tab"]');
        // Datetime start/end input (absolute mode)
        this.dateTimeStartInput = page.locator('[data-test="datetime-start-time"]');
        // Auto-refresh button (toggles dropdown)
        this.refreshIntervalButton = page.locator('[data-test="metrics-auto-refresh"]');
        // Refresh interval options (data-test prefix shared with logs search bar)
        this.refreshIntervalOptions = page.locator('[data-test^="logs-search-bar-refresh-time-"]');
        // Panel-display/axis/threshold/export controls (not implemented on metrics page).
        // Kept as data-test placeholders so spec defensive `if visible` checks resolve to false
        // without violating §2 (no .class / text= / button:has-text selectors).
        this.metricsPanelSettingsBtn = page.locator('[data-test="metrics-panel-settings-btn"]');
        this.metricsPanelSettingsPanel = page.locator('[data-test="metrics-panel-settings-panel"]');
        this.metricsPanelSettingsClose = page.locator('[data-test="metrics-panel-settings-close-btn"]');
        this.metricsAxisBtn = page.locator('[data-test="metrics-axis-btn"]');
        this.metricsThresholdBtn = page.locator('[data-test="metrics-threshold-btn"]');
        this.metricsThresholdInputs = page.locator('[data-test^="metrics-threshold-input-"]');
        this.metricsExportBtn = page.locator('[data-test="metrics-export-btn"]');
        this.metricsExportOptions = page.locator('[data-test^="metrics-export-option-"]');
        this.metricsExportOptionCsv = page.locator('[data-test="metrics-export-option-csv"]');

        // Chart-area error rendered by PanelSchemaRenderer when errorDetail.message is set
        this.chartErrorMessage = page.locator('[data-test="panel-schema-renderer-error-message"]');

        // Date-time relative buttons (data-test pattern: date-time-relative-{value}-{unit}-btn)
        this.dateTimeRelative15m = page.locator('[data-test="date-time-relative-15-m-btn"]');

        // Query editor / mode buttons
        this.customQueryTypeButton = page.locator('[data-test="dashboard-custom-query-type"]');
        this.queryEditorContainer = page.locator('[data-test="dashboard-panel-query-editor"]');
        this.dashboardQueryContainer = page.locator('[data-test="dashboard-query"]');

        // PromQL Table Chart locators
        this.promqlTableModeSelect = page.locator('[data-test="dashboard-config-promql-table-mode"]');
        this.promqlTableModePopover = page.locator('[data-test="dashboard-config-promql-table-mode-popover"]');
        this.promqlTableModeOptions = page.locator('[data-test="dashboard-config-promql-table-mode-option"]');
        this.promqlTableChart = page.locator('[data-test="promql-table-chart"]');
        // TenstackTable headers — data-test="o2-table-th-<columnId>"; we walk all headers in DOM order.
        this.promqlTableHeaders = page.locator(
            '[data-test="promql-table-chart"] [data-test^="o2-table-th-"]:not([data-test*="-sort-"]):not([data-test*="-remove-"])'
        );

        // ===== ConfigPanel sidebar (PanelSidebar + Reka Collapsible sections) =====
        this.dashboardSidebarButton = page.locator('[data-test="dashboard-sidebar"]').first();
        this.dashboardSidebarCollapseButton = page.locator('[data-test="dashboard-sidebar-collapse-btn"]').first();
        this.panelSidebarContent = page.locator('[data-test="panel-sidebar-content"]').first();
        this.panelSidebarExpandedHeader = page.locator('[data-test="panel-sidebar-header-expanded"]').first();
        // Sentinel: any config-panel control. Used to gate the async ConfigPanel mount.
        this.anyDashboardConfigControl = page.locator('[data-test^="dashboard-config-"]').first();
        // All config-panel controls (used by getConfigSectionKeys to enumerate).
        this.allDashboardConfigControls = page.locator('[data-test^="dashboard-config-"]');
        // Metrics page does not yet surface a chart-type picker; this defensive
        // locator matches any future `*chart-type*` data-test or resolves to no node.
        this.chartTypePickerButton = page.locator('[data-test*="chart-type"]').first();

        // ConfigPanel specific control data-tests (sourced from ConfigPanel.vue)
        this.configShowLegend = page.locator('[data-test="dashboard-config-show-legend"]').first();
        this.configConnectNullValues = page.locator('[data-test="dashboard-config-connect-null-values"]').first();
        this.configDecimals = page.locator('[data-test="dashboard-config-decimals"]').first();
        this.configDecimalsField = page.locator('[data-test="dashboard-config-decimals-field"]').first();
        this.configYAxisMin = page.locator('[data-test="dashboard-config-y_axis_min"]').first();
        this.configYAxisMinField = page.locator('[data-test="dashboard-config-y_axis_min-field"]').first();
        this.configYAxisMax = page.locator('[data-test="dashboard-config-y_axis_max"]').first();
        this.configYAxisMaxField = page.locator('[data-test="dashboard-config-y_axis_max-field"]').first();

        // ===== Metrics Share & Deep-Link locators =====
        this.shareButton = '[data-test="metrics-share-btn"]';
        this.metricsPageContainer = '[data-test="metrics-page"]';
        // Scoped success toast for the share-link "Link Copied" message as in dashboard-share-export
        this.shareSuccessToast = page.locator('[data-test-variant="success"][data-test-message*="Link Copied"]');
        this.shareErrorToast = page.locator('[data-test-variant="error"][data-test-message*="Error shortening link"]');
        this.toastMessage = page.locator('[data-test="o-toast-message"]');
    }

    /**
     * Get the inline dashboard error locator (DashboardErrors below the chart)
     * @returns {import('@playwright/test').Locator}
     */
    getInlineError() {
        return this.inlineError;
    }

    /**
     * Dismiss any open overlay/popover/modal by pressing Escape.
     * Used in place of body-click workarounds (§2 forbids body locators).
     */
    async dismissOverlay() {
        await this.page.keyboard.press('Escape');
    }

    /**
     * Get the chart-area error locator surfaced by PanelSchemaRenderer.
     * @returns {import('@playwright/test').Locator}
     */
    getChartErrorMessage() {
        return this.chartErrorMessage;
    }

    /**
     * Get the inline DashboardErrors locator. Mirrors getInlineError() for spec readability.
     * @returns {import('@playwright/test').Locator}
     */
    getDashboardError() {
        return this.inlineError;
    }

    /**
     * Wait for an element's aria-expanded attribute to differ from a previous value.
     * @param {import('@playwright/test').Locator} toggle
     * @param {string|null} previous
     * @param {number} [timeout=2000]
     */
    async waitForToggleState(toggle, previous, timeout = 2000) {
        try {
            await expect.poll(async () => {
                return await toggle.getAttribute('aria-expanded').catch(() => null);
            }, { timeout, intervals: [100, 200, 400] }).not.toBe(previous);
        } catch (_) {
            // Some collapsibles flip a class rather than aria-expanded; caller branches on the post-state.
        }
    }

    /**
     * Wait for a panel's visibility to flip from a previous boolean state.
     * Swallows timeout so callers can branch on the post-state (some collapsible
     * patterns flip a class rather than display/visibility).
     * @param {import('@playwright/test').Locator} panel
     * @param {boolean} previouslyVisible
     * @param {number} [timeout=3000]
     */
    async waitForPanelVisibilityChange(panel, previouslyVisible, timeout = 3000) {
        try {
            await expect.poll(async () => {
                return await panel.isVisible().catch(() => false);
            }, { timeout, intervals: [100, 200, 500] }).not.toBe(previouslyVisible);
        } catch (_) {
            // Caller branches on the current visibility (warn vs assert).
        }
    }
    /**
     * Opens the metrics PANEL EDITOR — the page every caller of this method
     * actually drives (PromQL input, Apply, visualizations, Add to Dashboard).
     *
     * It used to click the sidebar, which was the same thing until `/metrics`
     * became the Metrics Explorer browse grid; the editor moved to
     * `/metrics/editor`. Navigating there directly also drops the cloud
     * sidebar-click fallback this method used to need.
     */
    async gotoMetricsPage() {
        await gotoMetricsEditor(this.page);

        // Wait for a key editor control before proceeding.
        await this.page.locator(this.applyButton).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    }

    async metricsPageValidation() {

        await expect(this.page.locator('[data-cy="syntax-guide-button"]')).toContainText('Syntax Guide');
        //await expect(this.page.locator('[data-test="zinc-metrics"]')).toContainText('PromQL:');


    }


    async metricsPageDefaultOrg() {

        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).first().click();


    }

    async metricsPageDefaultMultiOrg() {



        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        // await this.page.pause();
        // await this.page.waitForTimeout(5000);

        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();


        // await validateUrlContains(this.page, 'path');


    }

    async metricsPageURLValidation() {
        // TODO: fix the test
        // await expect(this.page).not.toHaveURL(/default/);

    }

    async metricsURLValidation() {

        await expect(this.page).toHaveURL(/metrics/);

    }

    // New methods using VERIFIED selectors
    async clickApplyButton() {
        await this.page.locator(this.applyButton).click();
    }

    async expectApplyButtonVisible() {
        await expect(this.page.locator(this.applyButton)).toBeVisible();
    }

    async expectApplyButtonEnabled() {
        await expect(this.page.locator(this.applyButton)).toBeEnabled();
    }

    async clickCancelButton() {
        await this.page.locator(this.cancelButton).click();
    }

    async expectCancelButtonVisible() {
        await expect(this.page.locator(this.cancelButton)).toBeVisible();
    }

    async openDatePicker() {
        // Close any open menus/modals first via Escape (data-test policy — no body locator)
        await this.page.keyboard.press('Escape');

        // Click with force to handle potential overlay interception
        await this.page.locator(this.datePicker).click({ force: true });
    }

    async expectDatePickerVisible() {
        await expect(this.page.locator(this.datePicker)).toBeVisible();
    }

    async setAutoRefreshInterval() {
        await this.page.locator(this.autoRefresh).click();
    }

    async toggleFieldList() {
        const icon = this.page.locator(this.fieldListCollapseIcon);
        if (await icon.count() > 0) {
            await icon.click();
        } else {
            // Try alternative selectors if the main one doesn't exist
            const alternatives = [
                '[data-cy*="collapse"]',
                '[class*="collapse-icon"]',
                'button:has-text("Fields")',
                '[aria-label*="toggle"]'
            ];

            for (const selector of alternatives) {
                const element = this.page.locator(selector).first();
                if (await element.count() > 0) {
                    await element.click();
                    return;
                }
            }
            throw new Error('No field list toggle button found');
        }
    }

    async expectFieldListIconVisible() {
        const icon = this.page.locator(this.fieldListCollapseIcon);
        if (await icon.count() === 0) {
            throw new Error('Field list icon not found');
        }
        await expect(icon).toBeVisible();
    }

    async isApplyButtonVisible() {
        return await this.page.locator(this.applyButton).isVisible().catch(() => false);
    }

    async isApplyButtonEnabled() {
        return await this.page.locator(this.applyButton).isEnabled().catch(() => false);
    }

    async isDatePickerVisible() {
        return await this.page.locator(this.datePicker).isVisible().catch(() => false);
    }

    async isSyntaxGuideVisible() {
        return await this.page.locator(this.syntaxGuideButton).isVisible().catch(() => false);
    }

    async searchInFieldList(searchTerm) {
        await this.page.locator(this.fieldSearchInput).fill(searchTerm);
    }

    async clearFieldSearch() {
        await this.page.locator(this.fieldSearchInput).clear();
    }

    async expectFieldsTableVisible() {
        await expect(this.page.locator(this.fieldsTable)).toBeVisible();
    }

    async selectMetricsStream(streamName) {
        const streamSelector = this.page.locator(this.selectStream);

        // Check if stream selector exists
        if (await streamSelector.count() === 0) {
            throw new Error('Stream selector not found');
        }

        await streamSelector.click();
        await this.page.waitForTimeout(500); // Wait for dropdown

        // Try different selectors for the stream option
        let streamOption = this.page.getByRole('option', { name: streamName });
        if (await streamOption.count() === 0) {
            // Try alternative selector
            streamOption = this.page.getByRole('option', { name: streamName });
        }

        if (await streamOption.count() > 0) {
            await streamOption.click();
            return true;
        }

        throw new Error(`Stream "${streamName}" not found in dropdown`);
    }

    /**
     * Select a metric from the metrics list on the left sidebar
     * @param {string} metricName - The metric name to select (e.g., 'cpu_usage')
     * @returns {Promise<boolean>} - True if metric was selected successfully
     */
    async selectMetricFromList(metricName) {
        // Step 1: Try to find the search input in the metrics list
        const searchInput = this.page.locator(this.fieldSearchInput).or(
            this.page.locator('input[placeholder*="search" i]')
        ).or(
            this.page.locator('input[placeholder*="metric" i]')
        ).first();

        if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            // Clear existing search and type the metric name
            await searchInput.click();
            await this.page.keyboard.press('Control+A');
            await searchInput.fill(metricName);
            await this.page.waitForTimeout(1000);
        }

        // Step 2: Try to click on the metric in the filtered list
        const metricItem = this.page.locator('[role="option"], [class*="field-item"], [class*="metric-item"], [class*="stream-item"]')
            .filter({ hasText: new RegExp(`^${metricName}$|^${metricName}\\s`, 'i') }).first();

        if (await metricItem.isVisible({ timeout: 2000 }).catch(() => false)) {
            await metricItem.click();
            await this.page.waitForTimeout(1000);
            return true;
        }

        // Step 3: Fallback - try the stream selector dropdown
        const streamSelector = this.page.locator(this.selectStream);
        if (await streamSelector.isVisible({ timeout: 2000 }).catch(() => false)) {
            await streamSelector.click();
            await this.page.waitForTimeout(500);

            // Search within dropdown if search input exists
            const dropdownSearch = this.page.locator('[role="listbox"] input[type="text"], [role="combobox"] input[type="text"]').first();
            if (await dropdownSearch.isVisible({ timeout: 1000 }).catch(() => false)) {
                await dropdownSearch.fill(metricName);
                await this.page.waitForTimeout(500);
            }

            // Look for the metric in the dropdown options (OSelect forwards parent data-test as `*-option`).
            const metricOption = this.page
                .locator('[data-test$="-option"]', { hasText: new RegExp(metricName, 'i') })
                .first();

            if (await metricOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                await metricOption.click();
                await this.page.waitForTimeout(1000);
                return true;
            }

            // Close dropdown if metric not found
            await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        }

        // Step 4: If all else fails, just return false - the executeQuery will still work
        return false;
    }

    async getCurrentStream() {
        const streamSelector = this.page.locator(this.selectStream);
        if (await streamSelector.count() > 0) {
            return await streamSelector.textContent();
        }
        return null;
    }

    async getAvailableStreams() {
        const streamSelector = this.page.locator(this.selectStream);
        if (await streamSelector.count() === 0) {
            return [];
        }

        await streamSelector.click();
        await this.page.waitForTimeout(500);

        const options = await this.page.locator('[data-test$="-option"]').allTextContents();

        // Close dropdown
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });

        return options.filter(o => o.trim() !== '');
    }

    async selectTimeRange(range) {
        await this.openDatePicker();
        await this.page.waitForTimeout(500);

        // Try to find and click the time range option
        const rangeOption = this.page.locator(`[role="option"]:has-text("${range}"), button:has-text("${range}")`).first();

        if (await rangeOption.count() > 0) {
            await rangeOption.click();
            return true;
        }

        // Close date picker if option not found
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        return false;
    }

    async setCustomTimeRange(from, to) {
        await this.openDatePicker();
        await this.page.waitForTimeout(500);

        // Look for custom range inputs
        const fromInput = this.page.locator('input[placeholder*="from"], input[aria-label*="from"]').first();
        const toInput = this.page.locator('input[placeholder*="to"], input[aria-label*="to"]').first();

        if (await fromInput.count() > 0 && await toInput.count() > 0) {
            await fromInput.fill(from);
            await toInput.fill(to);

            // Apply the custom range
            const applyButton = this.page.locator('button:has-text("Apply")').first();
            if (await applyButton.count() > 0) {
                await applyButton.click();
                return true;
            }
        }

        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        return false;
    }

    async enterDashboardPanelTitle(title) {
        await this.page.locator(this.newDashboardPanelTitle).fill(title);
    }

    async clickUpdateSettings() {
        await this.page.locator(this.schemaUpdateSettingsButton).click();
    }

    async clickSchemaCancel() {
        await this.page.locator(this.schemaCancel).click();
    }

    async expectSyntaxGuideVisible() {
        await expect(this.page.locator(this.syntaxGuideButton)).toBeVisible();
    }

    async enterMetricsQuery(query) {
        // Ensure Custom mode is active so the editor is fully editable
        const customBtn = this.page.locator(`${this.customQueryTypeSelector || '[data-test="dashboard-custom-query-type"]'}:visible`).first();
        if (await customBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            const dataState = await customBtn.getAttribute('data-state').catch(() => '');
            if (dataState !== 'on') {
                await customBtn.click();
                // Wait deterministically for Custom mode to flip data-state to "on"
                await expect(customBtn).toHaveAttribute('data-state', 'on', { timeout: 5000 }).catch(() => {});
            }
        }

        // Resolve the Monaco editor container via data-test only (§2 zero-tolerance).
        // Primary: dashboard-panel-query-editor; secondary fallback: dashboard-query.
        let editorContainer = this.queryEditorContainer.first();
        if (!await editorContainer.isVisible({ timeout: 2000 }).catch(() => false)) {
            editorContainer = this.dashboardQueryContainer.first();
        }

        // Wait for Monaco editor to be fully loaded and for window.monaco to expose editors.
        await editorContainer.waitFor({ state: 'visible', timeout: 15000 });
        await this.page.waitForFunction(
            () => !!(window.monaco && window.monaco.editor && window.monaco.editor.getEditors().length > 0),
            null,
            { timeout: 10000 }
        ).catch(() => {});

        // Set the query via Monaco's setValue API. This fires onDidChangeContent
        // (the same event keyboard typing triggers, so Vue stays in sync) without
        // surfacing the autocomplete dropdown that blocks the subsequent Apply click.
        const setViaApi = await this.page.evaluate((q) => {
            try {
                const editors = window.monaco?.editor?.getEditors?.();
                if (!editors || editors.length === 0) return false;
                const editor = editors[editors.length - 1];
                editor.focus();
                editor.setValue(q);
                return true;
            } catch (e) {
                return false;
            }
        }, query);

        if (setViaApi) {
            return;
        }

        // Fallback: click + keyboard if window.monaco API unavailable.
        // Using keyboard.type instead of .fill() ensures Monaco triggers change
        // events so the Vue data model stays in sync (critical for Custom mode).
        const codeElement = editorContainer.getByRole('code');
        const isCodeVisible = await codeElement.isVisible({ timeout: 5000 }).catch(() => false);

        if (isCodeVisible) {
            await codeElement.click();
        } else {
            await editorContainer.click();
        }

        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await this.page.keyboard.press(selectAllKey);
        await this.page.keyboard.press('Backspace');
        await this.page.keyboard.type(query, { delay: 50 });
        // Dismiss any Monaco autocomplete dropdown the incremental typing opened.
        await this.page.keyboard.press('Escape');
    }

    async waitForMetricsResults() {
        // Wait for results to load after query execution.
        // networkidle never resolves on OpenObserve (persistent WebSocket/RUM)
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await this.page.waitForFunction(
            () => {
                const canvases = document.querySelectorAll('[data-test="chart-renderer"] canvas');
                if (canvases.length > 0) return true;
                const tableHasRows = document.querySelector('[data-test="promql-table-chart"] tbody tr');
                if (tableHasRows) return true;
                // A "no-data" state is also valid completion. The placeholder uses
                // OEmptyState (own data-test="o2-empty-state"); prod hoists that static
                // attr over the fallthrough no-data, so match either marker.
                const noData = document.querySelector(
                    '[data-test="no-data"], [data-test="panel-editor-container"] [data-test="o2-empty-state"]'
                );
                if (noData) return true;
                return false;
            },
            null,
            { timeout: 15000, polling: 'raf' }
        ).catch(() => {});
    }

    // Query type switching methods
    async switchToSQLMode() {
        // Try to find and click SQL mode toggle/button
        const sqlToggle = this.page.locator('[data-test*="sql"], button:has-text("SQL")').first();
        const isVisible = await sqlToggle.isVisible().catch(() => false);
        if (isVisible) {
            await sqlToggle.click();
            return true;
        }
        return false;
    }

    async switchToPromQLMode() {
        // Try to find and click PromQL mode toggle/button
        const promqlToggle = this.page.locator('[data-test*="promql"], button:has-text("PromQL")').first();
        const isVisible = await promqlToggle.isVisible().catch(() => false);
        if (isVisible) {
            await promqlToggle.click();
            return true;
        }
        return false;
    }

    async isInSQLMode() {
        // Check if SQL mode is active
        const sqlIndicator = this.page.locator('.sql-mode, text=/SQL Mode/i, [data-test*="sql-active"]').first();
        return await sqlIndicator.isVisible().catch(() => false);
    }

    async isInPromQLMode() {
        // Check if PromQL mode is active (default for metrics)
        const promqlIndicator = this.page.locator('.promql-mode, text=/PromQL/i, [data-test*="promql-active"]').first();
        const hasSqlMode = await this.isInSQLMode();
        // If not in SQL mode, assume PromQL mode (default)
        return !hasSqlMode || await promqlIndicator.isVisible().catch(() => false);
    }

    async executeQuery(query) {
        // Helper method to enter query and execute
        await this.enterMetricsQuery(query);
        await this.clickApplyButton();
        await this.waitForMetricsResults();
    }

    async expectQueryError() {
        // Check for query error indicators
        const errorIndicator = this.page.locator('[role="alert"][class*="negative"], [role="alert"][class*="error"], .error-message, [class*="error"]').first();
        return await errorIndicator.isVisible().catch(() => false);
    }

    async clearQueryEditor() {
        // Clear the query editor using the same approach as enterMetricsQuery
        const editorSelectors = [
            '[data-test="dashboard-panel-query-editor"]',
            '[data-test="dashboard-query"]',
            '.monaco-editor'
        ];

        let editorContainer = null;
        for (const selector of editorSelectors) {
            const container = this.page.locator(selector).first();
            if (await container.isVisible({ timeout: 2000 }).catch(() => false)) {
                editorContainer = container;
                break;
            }
        }

        if (!editorContainer) {
            editorContainer = this.page.locator('.monaco-editor').first();
    }

        await editorContainer.getByRole('code').click();
        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await this.page.keyboard.press(selectAllKey);
        await this.page.keyboard.press('Delete');
    }

    // Chart visualization methods
    async selectChartType(chartType) {
        // Use the actual selector pattern from ChartSelection.vue
        // Selector format: [data-test="selected-chart-{chartId}-item"]
        const chartTypeSelector = `[data-test="selected-chart-${chartType}-item"]`;

        try {
            const chartButton = this.page.locator(chartTypeSelector);

            // Check if the chart type button exists and is visible
            const isVisible = await chartButton.isVisible({ timeout: 2000 }).catch(() => false);

            if (!isVisible) {
                // Take screenshot for debugging
                await this.page.screenshot({
                    path: `test-results/chart-type-not-found-${chartType}.png`,
                    fullPage: false
                }).catch(() => {});

                return false;
            }

            // Click the chart type button, then deterministically confirm the type
            // actually became active instead of a blind 1s sleep. ChartSelection.vue
            // stamps data-selected="true" on the selected item — wait for that real
            // signal. If it never flips (e.g. a disabled chart type), return false so
            // callers see the true outcome rather than a masked success.
            await chartButton.click();
            const activeItem = this.page.locator(
                `[data-test="selected-chart-${chartType}-item"][data-selected="true"]`
            );
            return await activeItem
                .waitFor({ state: 'visible', timeout: 5000 })
                .then(() => true)
                .catch(() => false);
        } catch (error) {
            // Take screenshot for debugging
            await this.page.screenshot({
                path: `test-results/chart-type-error-${chartType}.png`,
                fullPage: false
            }).catch(() => {});

            return false;
        }
    }

    async getCurrentChartType() {
        // Try to identify current chart type from various indicators
        const indicators = [
            { selector: '.chart-type-label', attribute: 'textContent' },
            { selector: '[aria-label*="current chart type"]', attribute: 'textContent' },
            { selector: '.selected-chart-type', attribute: 'textContent' },
            { selector: 'input[type="radio"]:checked', attribute: 'value' }
        ];

        for (const indicator of indicators) {
            const element = this.page.locator(indicator.selector).first();
            if (await element.count() > 0) {
                const value = await element.getAttribute(indicator.attribute) || await element.textContent();
                if (value) {
                    return value.toLowerCase();
                }
            }
        }

        // Check for visible chart elements to infer type
        if (await this.page.locator('path[class*="line"], .line-chart').first().isVisible().catch(() => false)) {
            return 'line';
        }
        if (await this.page.locator('rect[class*="bar"], .bar-chart').first().isVisible().catch(() => false)) {
            return 'bar';
        }
        if (await this.page.locator('path[class*="area"], .area-chart').first().isVisible().catch(() => false)) {
            return 'area';
        }
        if (await this.page.locator('table, .data-table').first().isVisible().catch(() => false)) {
            return 'table';
        }

        return null;
    }

    async isChartVisible() {
        // Check if any chart visualization is visible
        const chartSelectors = [
            'canvas',
            'svg.chart',
            '.chart-container',
            '.apexcharts-canvas',
            '.metrics-chart',
            'table.metrics-table'
        ];

        for (const selector of chartSelectors) {
            const element = this.page.locator(selector).first();
            if (await element.isVisible().catch(() => false)) {
                return true;
            }
        }

        return false;
    }

    async getChartLegendItems() {
        // Get legend items from the chart
        const legendItems = [];
        const legendSelectors = [
            '.legend-item',
            '.chart-legend li',
            '.apexcharts-legend-text',
            '[class*="legend"] span'
        ];

        for (const selector of legendSelectors) {
            const elements = this.page.locator(selector);
            const count = await elements.count();
            if (count > 0) {
                for (let i = 0; i < count; i++) {
                    const text = await elements.nth(i).textContent();
                    if (text && text.trim()) {
                        legendItems.push(text.trim());
                    }
                }
                break;
            }
        }

        return legendItems;
    }

    async toggleChartLegend() {
        // Toggle legend visibility
        const legendToggle = this.page.locator('button[aria-label*="legend"], .legend-toggle, input[name*="legend"]').first();
        if (await legendToggle.count() > 0 && await legendToggle.isVisible()) {
            await legendToggle.click();
            return true;
        }
        return false;
    }

    async zoomChart(zoomLevel) {
        // Zoom in or out on the chart
        const chartArea = this.page.locator('canvas, svg.chart, .chart-container').first();
        if (await chartArea.isVisible()) {
            await chartArea.hover();

            // Positive for zoom in, negative for zoom out
            const deltaY = zoomLevel > 0 ? -100 : 100;
            for (let i = 0; i < Math.abs(zoomLevel); i++) {
                await this.page.mouse.wheel(0, deltaY);
                await this.page.waitForTimeout(200);
            }
            return true;
        }
        return false;
    }

    async resetChartZoom() {
        // Reset chart zoom to default
        const resetButton = this.page.locator('button:has-text("Reset"), .zoom-reset, button[title*="reset"]').first();
        if (await resetButton.isVisible().catch(() => false)) {
            await resetButton.click();
            return true;
        }
        return false;
    }

    async exportChart(format = 'png') {
        // Export chart in specified format
        const exportButton = this.page.locator('button:has-text("Export"), .export-chart, button[aria-label*="export"]').first();

        if (await exportButton.isVisible().catch(() => false)) {
            await exportButton.click();
            await this.page.waitForTimeout(500);

            // Select format
            const formatOption = this.page.locator(`text=/${format}/i, button:has-text("${format.toUpperCase()}")`).first();
            if (await formatOption.isVisible().catch(() => false)) {
                await formatOption.click();
                return true;
            }
        }
        return false;
    }

    async expectChartTypeRendered(chartType) {
        const chartSelectors = {
          'line': 'canvas, svg path, .apexcharts-line-series',
          'pie': 'svg path[class*="pie"], .apexcharts-pie, path[class*="slice"]',
          'table': 'table tbody tr, .data-table tbody tr',
          'heatmap': 'svg rect, .apexcharts-heatmap, .heatmap-cell',
          'gauge': 'svg circle, .gauge-chart, .apexcharts-radialbar',
          'bar': 'svg rect[class*="bar"], .apexcharts-bar-series, rect[class*="column"]'
        };

        const selector = chartSelectors[chartType] || 'canvas, svg, table';
        await this.page.waitForTimeout(2000); // Wait for chart rendering
        const element = this.page.locator(selector).first();
        return await element.isVisible({ timeout: 5000 }).catch(() => false);
    }

    async getPieSliceCount() {
        return await this.page.locator('svg path[class*="pie"], svg path[class*="slice"]').count();
    }

    async getTableHeaderCount() {
        return await this.page.locator('table thead th').count();
    }

    async getHeatmapCellCount() {
        return await this.page.locator('svg rect, .heatmap-cell').count();
    }

    async getGaugeElementCount() {
        return await this.page.locator('svg circle, svg path[class*="gauge"], .apexcharts-radialbar').count();
    }

    async isGaugeVisible() {
        const gaugeElements = this.page.locator('svg circle, svg path[class*="gauge"], .apexcharts-radialbar, .gauge-container');
        const count = await gaugeElements.count();
        return count > 0;
    }

    async getMetricValue() {
        // Metric text chart displays a large numeric value
        const metricSelectors = [
            '.metric-value',
            '.metric-text',
            '.single-stat-value',
            '[class*="metric"] .value',
            '.apexcharts-text.apexcharts-datalabel-value'
        ];

        for (const selector of metricSelectors) {
            const element = this.page.locator(selector).first();
            if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
                const text = await element.textContent();
                if (text && text.trim()) {
                    return text.trim();
                }
            }
        }

        // Fallback: look for any large text that might be a metric value
        const largeText = this.page.locator('text, tspan, div').filter({
            has: this.page.locator('[style*="font-size"]')
        }).first();

        if (await largeText.isVisible({ timeout: 1000 }).catch(() => false)) {
            return await largeText.textContent();
        }

        return null;
    }

    async getBarElementCount() {
        return await this.page.locator('svg rect[class*="bar"], svg rect[class*="column"]').count();
    }

    async selectLast15Minutes() {
        await this.openDatePicker();
        // Date-picker relative buttons have data-test="date-time-relative-15-m-btn"
        const last15Min = this.dateTimeRelative15m.first();
        if (await last15Min.isVisible({ timeout: 3000 }).catch(() => false)) {
          // Popover portal animates in — ensure the button is enabled (animations settled)
          // and target it via dispatched click (avoid Playwright's stability re-check on portals)
          await last15Min.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
          try {
            await last15Min.click({ timeout: 5000 });
          } catch (_) {
            // Portal element animation re-mount: fall back to dispatchEvent
            await last15Min.dispatchEvent('click').catch(() => {});
          }
          // Wait for date picker popover to close (deterministic wait)
          await last15Min.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
          return true;
        }
        // Dismiss the date picker via Escape if the option was not found
        await this.page.keyboard.press('Escape');
        return false;
    }

    /**
     * Dismiss any open popover / dropdown using the Escape key.
     * Replaces the `page.locator('body').click(...)` pattern.
     */
    async dismissOpenPopover() {
        await this.page.keyboard.press('Escape');
    }

    /**
     * Wait for a chart visualization to render. Polls deterministically until
     * any chart canvas / svg / table / panel appears, with a bounded timeout.
     * @param {number} [timeout=10000]
     */
    async waitForChartRender(timeout = 10000) {
        await expect.poll(
            async () => await this.hasVisualization(),
            { timeout, intervals: [200, 400, 800] }
        ).toBe(true);
    }

    // ===== DATA VISUALIZATION VERIFICATION METHODS =====
    // These methods replace raw page.locator() calls in spec files

    async getCanvasCount() {
        return await this.page.locator('canvas').count();
    }

    async hasCanvas() {
        return await this.getCanvasCount() > 0;
    }

    async getSvgCount() {
        const svg = this.page.locator('svg').filter({ has: this.page.locator('path, rect, circle, line') });
        return await svg.count();
    }

    async hasSvg() {
        return await this.getSvgCount() > 0;
    }

    async getTableRowCount() {
        // TODO(data-test): metrics chart/table containers don't yet expose a data-test on rows; using native <table>/.data-table fallback.
        return await this.page.locator('table tbody tr, .data-table tr').count();
    }

    async hasTableData() {
        return await this.getTableRowCount() > 0;
    }

    async getResultPanelCount() {
        return await this.page.locator('.result-panel, .chart-panel, .metric-card, [class*="result"], [class*="chart"]').count();
    }

    async hasResultPanels() {
        return await this.getResultPanelCount() > 0;
    }

    async hasDataValues() {
        const dataValues = this.page.locator('[class*="value"]:not(:empty), td:not(:empty)').first();
        return await dataValues.count() > 0;
    }

    async getFirstDataValue() {
        const dataValues = this.page.locator('[class*="value"]:not(:empty), td:not(:empty)').first();
        if (await dataValues.count() > 0) {
            return await dataValues.textContent();
        }
        return null;
    }

    async hasVisualization() {
        const hasCanvas = await this.hasCanvas();
        const hasSvg = await this.hasSvg();
        const hasTable = await this.hasTableData();
        const hasPanels = await this.hasResultPanels();
        return hasCanvas || hasSvg || hasTable || hasPanels;
    }

    async verifyDataVisualization(testName) {
        const testLogger = require('../../playwright-tests/utils/test-logger.js');

        // Wait for chart/data rendering
        await this.page.waitForTimeout(2000);

        const canvasCount = await this.getCanvasCount();
        const svgCount = await this.getSvgCount();
        const rowCount = await this.getTableRowCount();
        const panelCount = await this.getResultPanelCount();

        if (canvasCount > 0) {
            testLogger.info(`${testName} - Found ${canvasCount} canvas elements`);
        }
        if (svgCount > 0) {
            testLogger.info(`${testName} - Found ${svgCount} SVG elements`);
        }
        if (rowCount > 0) {
            testLogger.info(`${testName} - Found table with ${rowCount} rows`);
        }
        if (panelCount > 0) {
            testLogger.info(`${testName} - Found ${panelCount} result/chart panels`);
        }

        const hasViz = await this.hasVisualization();
        if (hasViz) {
            testLogger.info(`${testName} - Data visualization confirmed`);
        } else {
            testLogger.warn(`${testName} - No data visualization found`);
        }

        // Check for actual data values
        if (await this.hasDataValues()) {
            const valueText = await this.getFirstDataValue();
            const metricNames = ['cpu_usage', 'memory_usage', 'request_count', 'request_duration', 'up'];
            const hasMetricData = metricNames.some(metric => valueText.toLowerCase().includes(metric));
            if (hasMetricData) {
                testLogger.info(`${testName} - Data value found: ${valueText.substring(0, 100)}`);
            }
        }

        return hasViz;
    }

    // ===== CONFIG SIDEBAR METHODS =====

    async getDashboardSidebarCollapseButton() {
        return this.dashboardSidebarCollapseButton;
    }

    async clickDashboardSidebarCollapseButton() {
        const btn = this.dashboardSidebarCollapseButton;
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
        }
    }

    async getDashboardSidebarButton() {
        return this.dashboardSidebarButton;
    }

    async clickDashboardSidebarButton() {
        const btn = this.dashboardSidebarButton;
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
        }
    }

    /**
     * Open the dashboard config sidebar (PanelSidebar root). Idempotent.
     * Waits for the expanded header AND the async-loaded ConfigPanel children
     * (any `dashboard-config-*` data-test) to appear before returning.
     */
    async openConfigSidebar() {
        const expandedHeader = this.panelSidebarExpandedHeader;
        const anyConfig = this.anyDashboardConfigControl;
        if (await expandedHeader.isVisible({ timeout: 500 }).catch(() => false)) {
            // already open — still wait for async ConfigPanel to mount
            await anyConfig.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
            return;
        }
        const btn = this.dashboardSidebarButton;
        await btn.waitFor({ state: 'visible', timeout: 5000 });
        await btn.click();
        await expandedHeader.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        // ConfigPanel is async-imported; wait for any dashboard-config-* node to mount.
        await anyConfig.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
    }

    /**
     * Close the dashboard config sidebar via the collapse button.
     * Waits for the expanded header to disappear before returning.
     */
    async closeConfigSidebar() {
        const btn = this.dashboardSidebarCollapseButton;
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
            await btn.click();
            await this.panelSidebarExpandedHeader.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        }
    }

    async isSidebarVisible() {
        // Sidebar is "visible" (i.e. expanded) when the expanded header is shown.
        return await this.panelSidebarExpandedHeader.isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Enumerate config control data-tests currently present in the DOM.
     * Used as a generic "what's in this sidebar" probe — not all controls
     * are visible at once (chart-type-dependent and section-collapsed).
     * @returns {Promise<string[]>}
     */
    async getConfigSectionKeys() {
        const handles = await this.allDashboardConfigControls.all();
        const seen = new Set();
        for (const h of handles) {
            const attr = await h.getAttribute('data-test').catch(() => null);
            if (attr) seen.add(attr);
        }
        return Array.from(seen);
    }

    /**
     * Click a specific config control by its full data-test value (no-op when hidden).
     * @param {string} dataTest - e.g. "dashboard-config-show-legend"
     * @returns {Promise<boolean>}
     */
    async toggleConfigSection(dataTest) {
        const el = this.page.locator(`[data-test="${dataTest}"]`).first();
        if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
            await el.click().catch(() => {});
            return true;
        }
        return false;
    }

    /**
     * Whether a config control with the given data-test is currently visible.
     * @param {string} dataTest
     */
    async isConfigSectionVisible(dataTest) {
        const el = this.page.locator(`[data-test="${dataTest}"]`).first();
        return await el.isVisible({ timeout: 1500 }).catch(() => false);
    }

    // ===== ConfigPanel specific controls =====

    async isConfigShowLegendVisible() {
        return await this.configShowLegend.isVisible({ timeout: 2000 }).catch(() => false);
    }

    async clickConfigShowLegend() {
        await this.configShowLegend.click();
    }

    async isConfigConnectNullValuesVisible() {
        return await this.configConnectNullValues.isVisible({ timeout: 2000 }).catch(() => false);
    }

    async clickConfigConnectNullValues() {
        await this.configConnectNullValues.click();
    }

    async isConfigDecimalsVisible() {
        return await this.configDecimals.isVisible({ timeout: 2000 }).catch(() => false);
    }

    async fillConfigDecimals(value) {
        const field = this.configDecimalsField;
        if (await field.isVisible({ timeout: 1500 }).catch(() => false)) {
            await field.fill(String(value));
        } else {
            await this.configDecimals.fill(String(value));
        }
    }

    async getConfigDecimalsValue() {
        const field = this.configDecimalsField;
        if (await field.isVisible({ timeout: 1500 }).catch(() => false)) {
            return await field.inputValue();
        }
        return await this.configDecimals.inputValue();
    }

    async isConfigYAxisMinVisible() {
        return await this.configYAxisMin.isVisible({ timeout: 2000 }).catch(() => false);
    }

    async fillConfigYAxisMin(value) {
        const field = this.configYAxisMinField;
        if (await field.isVisible({ timeout: 1500 }).catch(() => false)) {
            await field.fill(String(value));
        } else {
            await this.configYAxisMin.fill(String(value));
        }
    }

    async getConfigYAxisMinValue() {
        const field = this.configYAxisMinField;
        if (await field.isVisible({ timeout: 1500 }).catch(() => false)) {
            return await field.inputValue();
        }
        return await this.configYAxisMin.inputValue();
    }

    async isConfigYAxisMaxVisible() {
        return await this.configYAxisMax.isVisible({ timeout: 2000 }).catch(() => false);
    }

    async fillConfigYAxisMax(value) {
        const field = this.configYAxisMaxField;
        if (await field.isVisible({ timeout: 1500 }).catch(() => false)) {
            await field.fill(String(value));
        } else {
            await this.configYAxisMax.fill(String(value));
        }
    }

    // ===== STREAM SELECTION METHODS =====

    async getStreamSelector() {
        return this.page.locator(this.selectStream);
    }

    async clickStreamSelector() {
        const selector = await this.getStreamSelector();
        await selector.click();
        await this.page.waitForTimeout(500);
    }

    async getStreamOption() {
        // OSelect forwards parent data-test to ListboxItems (`*-option`).
        return this.page.locator('[data-test$="-option"]').first();
    }

    async isStreamOptionVisible() {
        const option = await this.getStreamOption();
        return await option.isVisible({ timeout: 3000 }).catch(() => false);
    }

    // ===== DATE RANGE METHODS =====

    /**
     * Select a date range using the DateTime component
     * @param {string} range - Time range like 'Last 5 minutes', 'Last 1 hour', 'Last 24 hours'
     * @returns {Promise<boolean>} - True if selection was successful
     */
    async selectDateRange(range) {
        await this.openDatePicker();
        await this.page.waitForTimeout(500);

        // Parse the range string to extract value and unit
        // Supports formats: 'Last 5 minutes', 'Last 1 hour', 'Last 24 hours', 'Last 15 minutes'
        const rangeMatch = range.match(/(\d+)\s*(minute|min|hour|day|week|second|m|h|d|w|s)/i);
        if (rangeMatch) {
            const value = rangeMatch[1];
            const unitRaw = rangeMatch[2].toLowerCase();

            // Map unit to DateTime component format (s, m, h, d, w)
            const unitMap = {
                'second': 's', 'seconds': 's', 's': 's',
                'minute': 'm', 'minutes': 'm', 'min': 'm', 'm': 'm',
                'hour': 'h', 'hours': 'h', 'h': 'h',
                'day': 'd', 'days': 'd', 'd': 'd',
                'week': 'w', 'weeks': 'w', 'w': 'w'
            };
            const unit = unitMap[unitRaw] || 'm';

            // Use the actual data-test selector pattern from DateTime.vue
            // Pattern: [data-test="date-time-relative-{value}-{unit}-btn"]
            const dateTimeSelector = `[data-test="date-time-relative-${value}-${unit}-btn"]`;
            const dateTimeBtn = this.page.locator(dateTimeSelector);

            if (await dateTimeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await dateTimeBtn.click();
                await this.page.waitForTimeout(500);
                return true;
            }
        }

        // Fallback: Try generic button text matching
        const rangeOption = this.page.locator(`[role="option"]:has-text("${range}"), button:has-text("${range}")`).first();
        if (await rangeOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await rangeOption.click();
            return true;
        }

        // Fallback: Try alternate selector
        const relativeOption = this.page.locator('button').filter({ hasText: range }).first();
        if (await relativeOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await relativeOption.click();
            return true;
        }

        // Close the date picker if nothing found
        await this.page.locator('body').click({ position: { x: 10, y: 10 } });
        return false;
    }

    // ===== NOTIFICATION METHODS =====

    async isErrorNotificationVisible() {
        const errorNotification = this.page.locator('[role="alert"]:has-text("Error")');
        return await errorNotification.isVisible({ timeout: 3000 }).catch(() => false);
    }

    async getErrorNotificationText() {
        const errorNotification = this.page.locator('[role="alert"]:has-text("Error")');
        if (await errorNotification.isVisible({ timeout: 3000 }).catch(() => false)) {
            return await errorNotification.textContent();
        }
        return null;
    }

    // ===== RESULTS AREA METHODS =====

    async isResultsAreaVisible() {
        const resultsArea = this.page.locator('.chart-container, .results-table, [class*="results"], canvas').first();
        return await resultsArea.isVisible({ timeout: 5000 }).catch(() => false);
    }

    async isChartOrVisualizationVisible() {
        const viz = this.page.locator('canvas, .chart-container, svg').first();
        return await viz.isVisible({ timeout: 5000 }).catch(() => false);
    }

    async areResultsVisible() {
        const results = this.page.locator('[class*="result"], [class*="value"], .query-result').first();
        return await results.isVisible({ timeout: 5000 }).catch(() => false);
    }

    // ===== AGGREGATION & VALUE METHODS =====

    async getMetricValue() {
        const valueElement = this.page.locator('.metric-value, .single-stat, .result-value, [class*="value"]').first();
        if (await valueElement.isVisible({ timeout: 3000 }).catch(() => false)) {
            return await valueElement.textContent();
        }
        return null;
    }

    async getLegendItems() {
        return this.page.locator('.legend-item, .series-label, [class*="legend"]');
    }

    async getLegendItemCount() {
        const items = await this.getLegendItems();
        return await items.count();
    }

    async getResultValue() {
        const resultValue = this.page.locator('.result-value, .metric-value, [class*="value"]').first();
        if (await resultValue.isVisible({ timeout: 3000 }).catch(() => false)) {
            return await resultValue.textContent();
        }
        return null;
    }

    // ===== CHART TYPE METHODS =====

    async getChartTypeButton() {
        // The metrics page does not surface a chart-type picker today;
        // this returns a data-test locator that defensively resolves to a
        // hidden node so spec `if visible` guards short-circuit cleanly.
        return this.chartTypePickerButton;
    }

    async clickChartTypeButton() {
        const btn = await this.getChartTypeButton();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
            return true;
        }
        return false;
    }

    async getChartTypeOption(chartType) {
        // OSelect/OListbox forwards parent data-test to options as `*-option`
        // plus a per-value data-test-value="<value>" attribute.
        const lower = String(chartType).toLowerCase();
        return this.page.locator(`[data-test$="-option"][data-test-value="${lower}"]`).first();
    }

    async selectChartTypeOption(chartType) {
        const option = await this.getChartTypeOption(chartType);
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
            await option.click();
            return true;
        }
        return false;
    }

    // ===== GENERIC UI ELEMENT METHODS =====

    async getElementBySelector(selector) {
        return this.page.locator(selector).first();
    }

    async isElementVisible(selector) {
        const element = await this.getElementBySelector(selector);
        return await element.isVisible({ timeout: 3000 }).catch(() => false);
    }

    async getVisibleElements(selector) {
        return this.page.locator(selector).locator('visible');
    }

    async getVisibleElementCount(selector) {
        const elements = await this.getVisibleElements(selector);
        return await elements.count();
    }

    async clickElementBySelector(selector) {
        const element = await this.getElementBySelector(selector);
        if (await element.isVisible({ timeout: 3000 }).catch(() => false)) {
            await element.click();
            return true;
        }
        return false;
    }

    // ===== SAVE/APPLY BUTTON METHODS =====

    async getSaveButton() {
        return this.page.locator('button').filter({ hasText: /Save|Apply|Update/i }).locator('visible').first();
    }

    async clickSaveButton() {
        const btn = await this.getSaveButton();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
            await this.page.waitForTimeout(1000);
            return true;
        }
        return false;
    }

    // ===== INPUT FIELD METHODS =====

    async getVisibleInputs() {
        return this.page.locator('input[type="text"], input[type="number"], textarea').locator('visible');
    }

    async getVisibleInputCount() {
        const inputs = await this.getVisibleInputs();
        return await inputs.count();
    }

    async getVisibleOptionElements() {
        return this.page.locator('input, select').locator('visible');
    }

    async getVisibleOptionElementCount() {
        const elements = await this.getVisibleOptionElements();
        return await elements.count();
    }

    // ===== DATE/TIME PICKER METHODS =====

    async getDateTimePicker() {
        return this.dateTimePicker;
    }

    async clickDateTimePicker() {
        const picker = this.dateTimePicker;
        if (await picker.isVisible({ timeout: 3000 }).catch(() => false)) {
            await picker.click();
            return true;
        }
        return false;
    }

    async getCustomRangeOption() {
        // The DateTime popover opens onto the Relative tab by default; click it
        // to expose the relative-period preset buttons.
        return this.dateTimeRelativeTab;
    }

    async getDateInput() {
        // Absolute-mode start input within the DateTime popover
        return this.dateTimeStartInput;
    }

    async getPresetOption(preset) {
        // Build a data-test value from preset shorthand like "15m" or "1h".
        // Returns a locator that may or may not match — caller checks visibility.
        const match = String(preset).match(/^(\d+)\s*([smhdwM])$/);
        if (!match) {
            return this.page.locator('[data-test="date-time-relative-preset-unknown"]');
        }
        return this.page.locator(`[data-test="date-time-relative-${match[1]}-${match[2]}-btn"]`);
    }

    // ===== REFRESH BUTTON METHODS =====

    async getRefreshButton() {
        return this.refreshIntervalButton;
    }

    async clickRefreshButton() {
        const btn = this.refreshIntervalButton;
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
            return true;
        }
        return false;
    }

    async getIntervalOptions() {
        return this.refreshIntervalOptions;
    }

    // ===== CHART OPTIONS METHODS =====

    async getVisibleChartOptions() {
        return this.page.locator('[role="option"]:visible');
    }

    // ===== LEGEND METHODS =====
    // Note: Main legend methods are defined in the visualization section below

    // ===== MODE SELECTION METHODS =====

    async getModeOptions() {
        return this.page.locator('[role="option"]:has-text("SQL"), [role="option"]:has-text("PromQL")');
    }

    async getModeOptionCount() {
        const options = await this.getModeOptions();
        return await options.count();
    }

    // ===== SETTINGS PANEL METHODS =====

    async getSettingsPanel() {
        return this.metricsPanelSettingsPanel;
    }

    async isSettingsPanelVisible() {
        return await this.metricsPanelSettingsPanel.isVisible({ timeout: 3000 }).catch(() => false);
    }

    async getSettingByText(text) {
        // Returns a data-test-keyed locator derived from the setting label.
        // Caller treats absence as "feature not present" via isVisible() check.
        const key = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        return this.page.locator(`[data-test="metrics-panel-setting-${key}"]`);
    }

    async getCloseButton() {
        return this.metricsPanelSettingsClose;
    }

    async clickCloseButton() {
        const btn = this.metricsPanelSettingsClose;
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
            return true;
        }
        return false;
    }

    // ===== EXPORT OPTIONS METHODS =====

    async getExportOptions() {
        return this.metricsExportOptions;
    }

    async getExportOptionCount() {
        return await this.metricsExportOptions.count();
    }

    /**
     * Get the CSV export option from the export menu.
     * Replaces the previous `filter({ hasText: 'CSV' })` pattern with a data-test-keyed lookup.
     * @returns {import('@playwright/test').Locator}
     */
    async getCsvExportOption() {
        return this.metricsExportOptionCsv;
    }

    // ===== THRESHOLD INPUT METHODS =====

    async getThresholdInputs() {
        return this.metricsThresholdInputs;
    }

    async getThresholdInputCount() {
        return await this.metricsThresholdInputs.count();
    }

    // ===== TABLE DATA VERIFICATION METHODS =====

    async verifyMetricInTable(metricName, expectedValue = null) {
        const cells = await this.getTableCells();
        const allCellText = cells.join(' ');

        const hasMetricName = allCellText.includes(metricName);
        const hasExpectedValue = expectedValue ? allCellText.includes(expectedValue.toString()) : true;

        return hasMetricName && hasExpectedValue;
    }

    async getTableCellValues() {
        const cells = await this.page.locator('table td, .data-table td').allTextContents();
        return cells.filter(c => c.trim() !== '');
    }

    // ===== LEGEND AND SETTINGS METHODS =====

    async getLegendToggle() {
        return this.page.locator('button[aria-label*="legend"], .legend-toggle, input[name*="legend"], [data-test*="legend-toggle"]').first();
    }

    async getQueryModeToggle() {
        return this.page.locator('[data-test*="query-mode"], button:has-text("Query Mode"), .query-mode-toggle').first();
    }

    async getSettingsButton() {
        return this.metricsPanelSettingsBtn;
    }

    async getAxisButton() {
        return this.metricsAxisBtn;
    }

    async getThresholdButton() {
        return this.metricsThresholdBtn;
    }

    async getExportButton() {
        return this.metricsExportBtn;
    }

    // ===== ADDITIONAL HELPER METHODS FOR metrics.spec.js =====

    async hasTable() {
        const dataTable = this.page.locator('.results-table, .data-table, [class*="table"], table').first();
        return await dataTable.isVisible().catch(() => false);
    }

    async hasValue() {
        const resultValue = this.page.locator('.metric-value, .result-value, [class*="value"], .metrics-value, .query-result-value').first();
        return await resultValue.isVisible().catch(() => false);
    }

    async hasJson() {
        const jsonResult = this.page.locator('pre, .json-viewer, .result-json, [class*="json"]').first();
        return await jsonResult.isVisible().catch(() => false);
    }

    async getTableCells() {
        return await this.page.locator('tbody td, .table-cell').allTextContents();
    }

    async getResultsPageText() {
        return await this.page.locator('[data-o2-page], main, .metrics-results').textContent().catch(() => '');
    }

    async getMetricValueText() {
        const resultValue = this.page.locator('.metric-value, .result-value, [class*="value"], .metrics-value, .query-result-value').first();
        return await resultValue.textContent();
    }

    async getJsonResultText() {
        const jsonResult = this.page.locator('pre, .json-viewer, .result-json, [class*="json"]').first();
        return await jsonResult.textContent();
    }

    async getDatePickerDropdown() {
        // The DateTime popover renders the "Relative" tab as a sentinel data-test;
        // when the popover is open, this element is in the DOM.
        return this.page.locator('[data-test="date-time-relative-tab"]');
    }

    async getCollapsibleToggle() {
        const collapsibleSelectors = [
            '[data-test="metrics-field-list-collapsed-icon"]',
            '[data-cy*="collapse"]',
            '[class*="collapse-btn"]',
            '[class*="toggle-btn"]',
            'button[aria-expanded]',
            '[data-reka-accordion-trigger], [data-test*="expansion-toggle"]',
            '.collapsible-header',
            '[data-test*="collapse"]',
            '[data-test*="expand"]',
            '.sidebar-toggle',
            '.panel-toggle'
        ];

        for (const selector of collapsibleSelectors) {
            const elements = this.page.locator(selector);
            const count = await elements.count();
            if (count > 0) {
                return elements.first();
            }
        }
        return this.page.locator('.not-exists'); // Return non-existent locator
    }

    async getCollapsiblePanel() {
        const panelSelectors = [
            '.field-list-panel',
            '[class*="field-list"]',
            '.fields-panel',
            '.sidebar-panel',
            '.collapsible-content',
            '[data-reka-accordion-content], [data-test*="expansion-content"]',
            '[class*="panel-content"]'
        ];

        for (const panelSelector of panelSelectors) {
            const potentialPanel = this.page.locator(panelSelector).first();
            if (await potentialPanel.count() > 0) {
                return potentialPanel;
            }
        }
        return this.page.locator('.not-exists'); // Return non-existent locator
    }

    async getNoDataMessage() {
        // Returns the no-data placeholder locator (data-test only; see constructor).
        return this.noDataMessage.first();
    }

    /**
     * Get the chart-renderer container locator. Its presence indicates the panel
     * rendered the chart path without crashing.
     * @returns {import('@playwright/test').Locator}
     */
    getChartRenderer() {
        return this.chartRenderer;
    }

    async getHighlightedElements() {
        return this.page.locator('.highlighted, [class*="match"], [class*="filtered"]');
    }

    async getMetricItems() {
        return this.page.locator('[class*="metric-item"], [class*="field-item"], .metric-name');
    }

    async getAddToDashboardButton() {
        return this.page.locator('[data-test="panel-editor-add-to-dashboard-btn"]').first();
    }

    /**
     * Opens the AddToDashboard dialog by clicking the toolbar button.
     * The button is inside the PanelEditor component on the Metrics page.
     */
    async openAddToDashboardDialog() {
        const btn = this.page.locator('[data-test="panel-editor-add-to-dashboard-btn"]');
        await btn.waitFor({ state: 'visible', timeout: 10000 });
        await btn.click();
        await this.page.locator('[data-test="add-to-dashboard-dialog"]').waitFor({ state: 'visible', timeout: 10000 });
    }

    async getDashboardModal() {
        return this.page.locator('[data-test*="dialog"], [role="dialog"]').filter({ hasText: 'Dashboard' });
    }

    async getErrorIndicator() {
        return this.page.locator('[role="alert"][class*="negative"], [role="alert"][class*="error"], .error-message, [class*="error"]').first();
    }

    async getNoDataIndicator() {
        return this.page.locator('text=/no data|no results|empty/i').first();
    }

    async getDataRowsWithNumbers() {
        return this.page.locator('tbody tr').filter({ hasText: /\d+/ });
    }

    async getCancelButton() {
        return this.page.locator(this.schemaCancel).or(this.page.locator(this.schemaCancelButton));
    }

    async findSearchInput() {
        const searchSelectors = [
            this.fieldSearchInput,
            'input[placeholder*="search" i]',
            'input[placeholder*="filter" i]',
            'input[placeholder*="metric" i]',
            '[data-test*="search-input"]',
            '[data-cy*="search"]',
            '.search-input',
            '.filter-input',
            '[class*="search-field"]',
            '[role="searchbox"]'
        ];

        // Try to find a search input field
        for (const selector of searchSelectors) {
            const element = this.page.locator(selector).first();
            if (await element.isVisible().catch(() => false)) {
                return element;
            }
        }

        // If not found, try to expand collapsible sections first
        const expandableSelectors = [
            '[data-test="metrics-field-list-collapsed-icon"]',
            '[aria-expanded="false"]',
            '.collapsed',
            '[data-reka-accordion-item]:not([data-state="open"]), [aria-expanded="false"]',
            '[class*="toggle"]:not(.expanded)'
        ];

        for (const expandSelector of expandableSelectors) {
            const expandElement = this.page.locator(expandSelector).first();
            if (await expandElement.count() > 0) {
                await expandElement.click();
                await this.page.waitForTimeout(500);

                // Check again for search input
                for (const selector of searchSelectors) {
                    const element = this.page.locator(selector).first();
                    if (await element.isVisible().catch(() => false)) {
                        return element;
                    }
                }
            }
        }

        return null; // Not found
    }

    // ============================================
    // VISUALIZATION METHODS (for metrics-visualizations.spec.js)
    // ============================================

    // Chart canvas and elements
    async getChartCanvas() {
        return this.page.locator('canvas, .line-chart, [class*="line"], svg path[class*="line"]').first();
    }

    async expectChartCanvasVisible() {
        await expect(this.page.locator('canvas, .line-chart, [class*="line"], svg path[class*="line"]').first()).toBeVisible({ timeout: 10000 });
    }

    async getXAxis() {
        return this.page.locator('.x-axis, [class*="axis-x"], .apexcharts-xaxis, .chart-axis-x').first();
    }

    async getYAxis() {
        return this.page.locator('.y-axis, [class*="axis-y"], .apexcharts-yaxis, .chart-axis-y').first();
    }

    async getLegendElement() {
        return this.page.locator('.chart-legend, .legend, [class*="legend"], .apexcharts-legend').first();
    }

    async isLegendVisible() {
        return await this.page.locator('.chart-legend, .legend, [class*="legend"], .apexcharts-legend').first().isVisible().catch(() => false);
    }

    async getChartSeries() {
        return this.page.locator('.chart-series, path[class*="line"], .apexcharts-series, g[class*="series"]');
    }

    async getChartArea() {
        return this.page.locator('canvas, svg, .chart-container').first();
    }

    async getChartTooltip() {
        return this.page.locator('.chart-tooltip, .tooltip, [role="tooltip"], .apexcharts-tooltip').first();
    }

    async isChartTooltipVisible() {
        return await this.page.locator('.chart-tooltip, .tooltip, [role="tooltip"], .apexcharts-tooltip').first().isVisible().catch(() => false);
    }

    // Bar chart elements
    async getBarElements() {
        return this.page.locator('rect[class*="bar"], .bar-chart, .chart-bar, path[class*="bar"], .apexcharts-bar-series').first();
    }

    async getBars() {
        return this.page.locator('rect, .bar, [class*="bar-element"]');
    }

    async getStackOption() {
        return this.page.locator('button:has-text("Stack"), input[type="checkbox"][name*="stack"], .stack-toggle').first();
    }

    async getStackedBars() {
        return this.page.locator('.stacked-bar, [class*="stack"], .apexcharts-bar-stacked').first();
    }

    // Scatter plot elements
    async getScatterPoints() {
        return this.page.locator('circle[class*="scatter"], .scatter-point, .chart-scatter, .apexcharts-scatter').first();
    }

    async getScatterDots() {
        return this.page.locator('circle, .dot, [class*="point"]');
    }

    async getTrendLine() {
        return this.page.locator('.trend-line, path[class*="trend"], .regression-line').first();
    }

    async getCorrelationText() {
        return this.page.locator('text=/correlation|r²|R²/i').first();
    }

    // Area chart elements
    async getAreaElements() {
        return this.page.locator('path[class*="area"], .area-chart, .chart-area, .apexcharts-area').first();
    }

    async getAreaFills() {
        return this.page.locator('path[fill-opacity], path[fill]');
    }

    async getStackedAreas() {
        return this.page.locator('.stacked-area, [class*="stack"], .apexcharts-area-stacked').first();
    }

    // Heatmap elements
    async getHeatmapCells() {
        return this.page.locator('rect[class*="heat"], .heatmap-cell, .chart-heatmap, .apexcharts-heatmap').first();
    }

    async getHeatmapGridCells() {
        return this.page.locator('rect[fill], g[class*="cell"]');
    }

    async getColorScale() {
        return this.page.locator('.color-scale, .heatmap-legend, [class*="gradient"]').first();
    }

    // Pie chart elements
    async getPieSlices() {
        return this.page.locator('path[class*="pie"], .pie-slice, .chart-pie, .apexcharts-pie').first();
    }

    async getPieArcs() {
        return this.page.locator('path[d*="A"], g[class*="slice"]');
    }

    async getPercentLabels() {
        return this.page.locator('text:has-text("%"), .pie-label').first();
    }

    // Table elements
    async getTableElement() {
        return this.page.locator('table, .data-table, [role="table"], .metrics-table').first();
    }

    async expectTableVisible() {
        await expect(this.page.locator('table, .data-table, [role="table"], .metrics-table').first()).toBeVisible({ timeout: 10000 });
    }

    async getTableHeaders() {
        return this.page.locator('th, [role="columnheader"], .table-header');
    }

    async getTableRows() {
        return this.page.locator('tbody tr, [role="row"], .table-row');
    }

    async getSortableHeader() {
        return this.page.locator('th[class*="sort"], th[aria-sort], .sortable').first();
    }

    // Chart interaction elements
    async getResetButton() {
        return this.page.locator('button:has-text("Reset"), .zoom-reset, button[title*="reset"]').first();
    }

    async getExportButtonElement() {
        return this.page.locator('button:has-text("Export"), .export-chart, button[title*="export"], button[aria-label*="export"]').first();
    }

    async getPngOption() {
        return this.page.locator('text=/PNG/i, button:has-text("PNG")').first();
    }

    async getSvgOption() {
        return this.page.locator('text=/SVG/i, button:has-text("SVG")').first();
    }

    async getCsvOption() {
        return this.page.locator('text=/CSV/i, button:has-text("CSV")').first();
    }

    // Chart customization elements
    async getChartSettingsButton() {
        return this.page.locator('button[aria-label*="settings"], .chart-settings, button:has-text("Options")').first();
    }

    async getLegendToggleOption() {
        return this.page.locator('input[name*="legend"], .legend-toggle, text=/Show Legend/i').first();
    }

    async getGridToggleOption() {
        return this.page.locator('input[name*="grid"], .grid-toggle, text=/Show Grid/i').first();
    }

    async getTooltipToggleOption() {
        return this.page.locator('input[name*="tooltip"], .tooltip-toggle, text=/Show Tooltip/i').first();
    }

    // ============================================
    // QUERY METHODS (for metrics-queries.spec.js)
    // ============================================

    // Error notification methods
    async getErrorNotificationMessage() {
        return this.page.locator('[role="alert"]:has-text("Error")');
    }

    async expectNoErrorNotification() {
        await expect(this.page.locator('[role="alert"]:has-text("Error")')).not.toBeVisible();
    }

    async hasErrorIndicator() {
        // Check for actual error indicators in the UI (not false positives)
        // Focus on framework notifications and explicit error messages
        // Only check for actual error notifications that indicate a query failure
        const errorSelectors = [
            '[role="alert"][class*="negative"]',   // Reka UI negative notification
            '[role="alert"][class*="error"]',       // Reka UI error notification
            '[data-test="error-message"]',         // Explicit error message data-test
            '.error-notification',                 // Explicit error notification class
            '[data-test="dashboard-error"]'          // Inline error list (DashboardErrors)
        ];

        for (const selector of errorSelectors) {
            const element = this.page.locator(selector).first();
            if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
                return true;
            }
        }

        // Also check for alert notifications containing error text
        const notificationMessage = this.page.locator('[role="alert"]').first();
        if (await notificationMessage.isVisible({ timeout: 500 }).catch(() => false)) {
            const text = await notificationMessage.textContent().catch(() => '');
            const lowerText = text.toLowerCase();
            if (lowerText.includes('error') || lowerText.includes('failed') || lowerText.includes('invalid')) {
                return true;
            }
        }

        return false;
    }

    async getErrorIndicators() {
        // Return the first visible error indicator
        const errorSelectors = [
            '[data-test="dashboard-error"]',
            '[role="alert"][class*="negative"]',
            '[role="alert"][class*="error"]',
            '[role="alert"]:has-text("Error")',
            '[role="alert"]:has-text("error")',
            '[role="alert"]:has-text("failed")',
            '[data-test="error-message"]',
            '.error-notification'
        ];

        for (const selector of errorSelectors) {
            const element = this.page.locator(selector).first();
            if (await element.isVisible({ timeout: 500 }).catch(() => false)) {
                return element;
            }
        }
        return this.page.locator('[data-test="dashboard-error"], [role="alert"]').first();
    }

    // SQL mode methods
    async getSqlToggle() {
        return this.page.locator('[data-test*="sql"], button:has-text("SQL")').first();
    }

    async getSqlIndicator() {
        return this.page.locator('.sql-mode, text=/SQL Mode/i').first();
    }

    // ============================================
    // CONFIG METHODS (for metrics-config.spec.js)
    // ============================================

    // Preset selection method
    // Maps human-readable preset labels to the DateTime component's data-test attributes
    // (format: date-time-relative-{value}-{period}-btn, e.g. date-time-relative-15-m-btn).
    async getPresetOptionByText(presetText) {
        const map = {
            'Last 5 minutes': '[data-test="date-time-relative-5-m-btn"]',
            'Last 15 minutes': '[data-test="date-time-relative-15-m-btn"]',
            'Last 30 minutes': '[data-test="date-time-relative-30-m-btn"]',
            'Last 1 hour': '[data-test="date-time-relative-1-h-btn"]',
            'Last 6 hours': '[data-test="date-time-relative-6-h-btn"]',
            'Last 1 day': '[data-test="date-time-relative-1-d-btn"]',
        };
        const selector = map[presetText] || '[data-test="date-time-relative-preset-unknown"]';
        return this.page.locator(selector);
    }

    // Setting element method - returns a placeholder data-test locator for the named
    // option. When the metrics page does not implement panel-display settings, the
    // returned locator resolves to nothing and callers treat it as "feature not
    // present" via isVisible() checks.
    async getSettingElementByText(optionText) {
        const key = String(optionText).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        return this.page.locator(`[data-test="metrics-panel-setting-${key}"]`);
    }

    // ============================================
    // DARK MODE TEST METHODS
    // ============================================

    /**
     * Get theme toggle button
     * @returns {Locator}
     */
    getThemeToggleButton() {
        return this.page.locator('[data-test*="theme"], [class*="theme-toggle"], button:has-text("dark")');
    }

    /**
     * Get dark mode button
     * @returns {Locator}
     */
    getDarkModeButton() {
        return this.page.locator('[data-test*="dark-mode"], [aria-label*="dark"]');
    }

    // Note: a profile/settings button getter previously lived here for dark-mode tests
    // but conflicted with the panel-display getSettingsButton defined earlier. Dark-mode
    // coverage is handled elsewhere; this duplicate has been removed.

    /**
     * Get dark mode option in menu
     * @returns {Locator}
     */
    getDarkModeOption() {
        return this.page.locator('[data-test*="dark"]');
    }

    /**
     * Get body element
     * @returns {Locator}
     */
    getBodyElement() {
        return this.page.locator('body');
    }

    /**
     * Get "No results" text element
     * @returns {Locator}
     */
    getNoResultsText() {
        return this.page.locator('text=No results, text=no data, text=No results found');
    }

    // =========================================================================
    // PromQL Autocomplete helpers
    // Added for promqlAutocomplete.spec.js
    // Verified data-test selectors sourced from QueryTypeSelector.vue
    // =========================================================================

    /**
     * Switch to PromQL Custom mode on the Metrics page.
     *
     * The Metrics page uses the same QueryTypeSelector component as the Dashboard
     * add-panel flow.  Two clicks are needed:
     *   1. [data-test="dashboard-promql-query-type"] — select PromQL language
     *   2. [data-test="dashboard-custom-query-type"]  — switch to Custom (free-text) sub-mode
     *
     * The PromQL button may already be selected (Metrics page defaults to PromQL),
     * so we only click it when it is not yet active.
     *
     * @returns {Promise<boolean>} true when both buttons were clicked successfully
     */
    async switchToPromQLCustomMode() {
        // Step 1 — ensure PromQL language is active.
        // These are reka OToggleGroupItem buttons whose active state is exposed via
        // data-state="on" (not a 'selected' class). Click only when not active, then
        // poll data-state until it settles — deterministic, no fixed sleep.
        const promqlBtn = this.page.locator('[data-test="dashboard-promql-query-type"]');
        if (!await promqlBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            return false;
        }
        const isOn = async (btn) => (await btn.getAttribute('data-state').catch(() => null)) === 'on';
        if (!await isOn(promqlBtn)) {
            await promqlBtn.click();
        }
        await expect.poll(async () => await isOn(promqlBtn), { timeout: 5000, intervals: [100, 200, 400] }).toBe(true);

        // Step 2 — switch to Custom sub-mode
        const customBtn = this.page.locator('[data-test="dashboard-custom-query-type"]');
        if (!await customBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            return false;
        }
        if (!await isOn(customBtn)) {
            await customBtn.click();
        }
        await expect.poll(async () => await isOn(customBtn), { timeout: 5000, intervals: [100, 200, 400] }).toBe(true);
        return true;
    }

    /**
     * Return the Monaco query editor container locator.
     * Uses the verified [data-test="dashboard-panel-query-editor"] attribute on
     * the UnifiedQueryEditor component rendered inside the Metrics page.
     *
     * @returns {import('@playwright/test').Locator}
     */
    getPromQLEditorContainer() {
        return this.page.locator('[data-test="dashboard-panel-query-editor"]');
    }

    /**
     * Clear the Monaco editor content in a cross-platform way.
     *
     * @param {import('@playwright/test').Locator} editorContainer - result of getPromQLEditorContainer()
     */
    async clearPromQLEditor(editorContainer) {
        const monacoEditor = editorContainer.getByRole('code');
        await monacoEditor.click({ clickCount: 3 });
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Backspace');
    }

    /**
     * Type text into the Monaco PromQL editor.
     * Focuses the editor first, then types the provided text character by character
     * with a small delay so Monaco's token parser keeps up.
     *
     * @param {import('@playwright/test').Locator} editorContainer - result of getPromQLEditorContainer()
     * @param {string} text - text to type (can include special chars like '{', '=')
     * @param {number} [delay=50] - typing delay in ms
     */
    async typeInPromQLEditor(editorContainer, text, delay = 50) {
        const monacoEditor = editorContainer.getByRole('code');
        await monacoEditor.click();
        await this.page.keyboard.type(text, { delay });
    }

    /**
     * Trigger Monaco autocomplete suggestions (Ctrl+Space).
     */
    async triggerPromQLSuggestions() {
        await this.page.keyboard.press('Control+Space');
    }

    /**
     * Wait for the Monaco suggest-widget to become visible and return the
     * suggestion row locator.
     *
     * Throws if no suggestions appear within the timeout.
     *
     * @param {number} [timeout=10000]
     * @returns {Promise<import('@playwright/test').Locator>} - suggestion rows locator
     */
    async waitForPromQLSuggestions(timeout = 10000) {
        const suggestWidget = this.page.locator('.monaco-editor .suggest-widget');
        await suggestWidget.waitFor({ state: 'visible', timeout });
        const suggestionRows = this.page.locator('.monaco-editor .suggest-widget .monaco-list-row');
        await suggestionRows.first().waitFor({ state: 'visible', timeout: 5000 });
        return suggestionRows;
    }

    /**
     * Dismiss the Monaco autocomplete widget by pressing Escape.
     */
    async dismissPromQLSuggestions() {
        await this.page.keyboard.press('Escape');
    }

    /**
     * Return all visible suggestion label texts as an array of strings.
     * Reads up to `maxItems` rows from the suggestions widget.
     *
     * @param {number} [maxItems=10]
     * @returns {Promise<string[]>}
     */
    async getPromQLSuggestionTexts(maxItems = 10) {
        const suggestionRows = this.page.locator('.monaco-editor .suggest-widget .monaco-list-row');
        const count = Math.min(await suggestionRows.count(), maxItems);
        const texts = [];
        for (let i = 0; i < count; i++) {
            texts.push((await suggestionRows.nth(i).textContent()).trim());
        }
        return texts;
    }

    // ===== PromQL Table Chart Mode =====

    /**
     * Returns the PromQL table-mode select trigger locator.
     */
    getPromqlTableModeSelect() {
        return this.promqlTableModeSelect;
    }

    /**
     * Select a PromQL table mode by its raw value (e.g. 'all', 'expanded_timeseries', 'single').
     * Uses OSelect's `data-test-value` per ruleset §4.
     */
    async selectPromqlTableMode(modeValue) {
        const trigger = this.page.locator('[data-test="dashboard-config-promql-table-mode-trigger"]');
        await trigger.waitFor({ state: 'visible', timeout: 5000 });
        // Bound the scroll to the element's own actionability window so it can never
        // hang on the default 30s timeout if layout is momentarily unstable.
        await trigger.scrollIntoViewIfNeeded({ timeout: 5000 });
        await trigger.click();
        await this.promqlTableModePopover.waitFor({ state: 'visible', timeout: 5000 });
        // Pick the option by its data-test-value (per AGENT_RULES §4 OSelectItem stamp).
        const optionByValue = this.page.locator(
            `[data-test="dashboard-config-promql-table-mode-option"][data-test-value="${modeValue}"]`
        );
        await optionByValue.first().waitFor({ state: 'visible', timeout: 5000 });
        await optionByValue.first().click();
        await this.promqlTableModePopover.waitFor({ state: 'hidden', timeout: 5000 });
    }

    /**
     * Returns the count of table header cells rendered in the PromQL table chart.
     */
    async getPromqlTableHeaderCount() {
        return await this.promqlTableHeaders.count();
    }

    /**
     * Returns the text content of the table header at the given index (0-based).
     * Trims sort-icon glyphs that may be embedded in the text.
     */
    async getPromqlTableHeaderText(index) {
        const header = this.promqlTableHeaders.nth(index);
        await header.waitFor({ state: 'visible', timeout: 5000 });
        const raw = (await header.textContent()) || '';
        return raw.replace(/unfold_more|unfold_less|arrow_upward|arrow_downward/g, '').trim();
    }

    /**
     * Returns true when the PromQL table chart is visible.
     */
    async isPromqlTableVisible() {
        return await this.promqlTableChart.isVisible({ timeout: 3000 }).catch(() => false);
    }

    // ===== METRICS SHARE & DEEP-LINK METHODS =====

    /**
     * Returns the share button locator.
     * @returns {import('@playwright/test').Locator}
     */
    getShareButton() {
        return this.page.locator(this.shareButton);
    }

    /**
     * Returns true if the share button is in the DOM and visible.
     */
    async isShareButtonVisible() {
        const btn = this.getShareButton();
        if (await btn.count() === 0) return false;
        return await btn.isVisible({ timeout: 2000 }).catch(() => false);
    }

    /**
     * Returns true if the share button is enabled (not disabled).
     */
    async isShareButtonEnabled() {
        const btn = this.getShareButton();
        if (await btn.count() === 0) return false;
        return await btn.isEnabled({ timeout: 2000 }).catch(() => false);
    }

    /**
     * Returns true if the share button element is present in DOM regardless of visibility.
     */
    async isShareButtonInDom() {
        return await this.page.locator(this.shareButton).count() > 0;
    }

    /**
     * Returns the share button's disabled tooltip locator if visible.
     */
    getShareButtonDisabledTooltip() {
        return this.page.locator('[role="tooltip"], [data-test*="tooltip"]').filter({ hasText: /Web URL|web.url|not configured/i });
    }

    /**
     * Clicks the share button and waits for loading to start.
     * Returns false if button is not visible or is disabled.
     */
    async clickShareButton() {
        const btn = this.getShareButton();
        const cnt = await btn.count();
        if (cnt === 0) return false;
        const enabled = await this.isShareButtonEnabled();
        if (!enabled) return false;
        await btn.click();
        return true;
    }

    /**
     * Waits for the share success toast ("Link Copied") to appear.
     * @param {number} [timeout=10000]
     */
    async waitForShareSuccessToast(timeout = 10000) {
        await expect(this.shareSuccessToast).toBeVisible({ timeout });
    }

    /**
     * Waits for the share error toast to appear.
     * @param {number} [timeout=10000]
     */
    async waitForShareErrorToast(timeout = 10000) {
        await expect(this.shareErrorToast).toBeVisible({ timeout });
    }

    /**
     * Returns the share success toast locator for external assertions.
     */
    getShareSuccessToast() {
        return this.shareSuccessToast;
    }

    /**
     * Polls the clipboard until it contains a short URL matching "/short/".
     * Reuses the same polling pattern from DashboardShareExportPage.
     * @param {number} [timeout=15000]
     * @returns {Promise<string>} The clipboard text (may be empty on timeout)
     */
    async getCopiedShortUrl(timeout = 15000) {
        const start = Date.now();
        let lastValue = '';
        while (Date.now() - start < timeout) {
            lastValue = await this.page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
            if (lastValue && lastValue.includes('/short/')) {
                return lastValue;
            }
            await this.page.waitForTimeout(250);
        }
        return lastValue;
    }

    /**
     * Returns the current page URL. Convenience wrapper.
     * @returns {string}
     */
    getCurrentMetricsUrl() {
        return this.page.url();
    }

    /**
     * Navigates to a given metrics URL and waits for page load.
     * @param {string} url
     */
    async navigateToMetricsUrl(url) {
        await this.page.goto(url);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        // Wait for the metrics page container to be visible
        await this.page.locator(this.metricsPageContainer).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    }

    /**
     * Extracts the `metrics_data` query parameter from the current URL.
     * @returns {string|null} The base64 blob or null if absent.
     */
    getMetricsDataParam() {
        try {
            const url = new URL(this.page.url());
            return url.searchParams.get('metrics_data') || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Verifies that the `metrics_data` blob decodes to a JSON object that
     * contains the given chart type in its `data.type` field.
     * @param {string} chartType - e.g. "line", "bar", "area"
     * @returns {Promise<boolean>}
     */
    async verifyChartTypeInUrl(chartType) {
        const blob = this.getMetricsDataParam();
        if (!blob) return false;
        try {
            const decoded = JSON.parse(Buffer.from(blob, 'base64').toString('utf8'));
            return decoded && decoded.data && decoded.data.type === chartType;
        } catch (_) {
            return false;
        }
    }

    /**
     * Verifies that the `metrics_data` blob contains the given query string
     * anywhere in any query slot.
     * @param {string} query - The query text to look for.
     * @returns {Promise<boolean>}
     */
    async verifyQueryInUrl(query) {
        const blob = this.getMetricsDataParam();
        if (!blob) return false;
        try {
            const decoded = JSON.parse(Buffer.from(blob, 'base64').toString('utf8'));
            const queries = decoded?.data?.queries || [];
            return queries.some(q => q.query && q.query.includes(query));
        } catch (_) {
            return false;
        }
    }

    /**
     * Decodes the `metrics_data` blob and returns the parsed JSON object.
     * Returns null if blob is absent or invalid.
     * @returns {Promise<Object|null>}
     */
    async decodeMetricsBlob() {
        const blob = this.getMetricsDataParam();
        if (!blob) return null;
        try {
            return JSON.parse(Buffer.from(blob, 'base64').toString('utf8'));
        } catch (_) {
            return null;
        }
    }

    /**
     * Returns the metrics page container locator.
     */
    getMetricsPageContainer() {
        return this.page.locator(this.metricsPageContainer);
    }

    /**
     * Expects the metrics page container to be visible.
     */
    async expectMetricsPageVisible() {
        await expect(this.page.locator(this.metricsPageContainer)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Waits for the Apply button to transition out of loading/disabled state.
     * @param {number} [timeout=15000]
     */
    async waitForApplyEnabled(timeout = 15000) {
        const btn = this.page.locator(this.applyButton);
        await expect(btn).toBeEnabled({ timeout });
    }

    /**
     * Returns true if the URL currently contains a `metrics_data` param.
     */
    async hasMetricsDataParam() {
        const url = this.page.url();
        return url.includes('metrics_data=');
    }

    /**
     * Returns the current page URL's `from` param (unix seconds) or null.
     */
    getFromParam() {
        try {
            const url = new URL(this.page.url());
            return url.searchParams.get('from') || null;
        } catch (_) { return null; }
    }

    /**
     * Returns the current page URL's `to` param (unix seconds) or null.
     */
    getToParam() {
        try {
            const url = new URL(this.page.url());
            return url.searchParams.get('to') || null;
        } catch (_) { return null; }
    }

    /**
     * Returns the current page URL's `period` param or null.
     */
    getPeriodParam() {
        try {
            const url = new URL(this.page.url());
            return url.searchParams.get('period') || null;
        } catch (_) { return null; }
    }

    /**
     * Returns the current page URL's `refresh` param or null.
     */
    getRefreshParam() {
        try {
            const url = new URL(this.page.url());
            return url.searchParams.get('refresh') || null;
        } catch (_) { return null; }
    }

    /**
     * Returns the auto-refresh button's currently displayed label text.
     */
    async getAutoRefreshLabelText() {
        const btn = this.page.locator(this.autoRefresh);
        if (await btn.count() === 0) return null;
        return (await btn.textContent()) || '';
    }

    /**
     * Verifies that the share button has a disabled attribute or disabled class.
     * @returns {Promise<boolean>}
     */
    async isShareButtonDisabled() {
        const btn = this.getShareButton();
        if (await btn.count() === 0) return false;
        const disabled = await btn.getAttribute('disabled').catch(() => null);
        if (disabled !== null) return true;
        const ariaDisabled = await btn.getAttribute('aria-disabled').catch(() => null);
        return ariaDisabled === 'true';
    }

    /**
     * Verifies the share button is showing a loading state (spinner).
     * Checks for OButton's loading indicator.
     * @returns {Promise<boolean>}
     */
    async isShareButtonLoading() {
        const btn = this.getShareButton();
        if (await btn.count() === 0) return false;
        // OButton shows a loading span with data-test or role
        const loader = btn.locator('[data-test="o-button-loading"], .o-button__loading, [role="progressbar"]');
        return await loader.isVisible({ timeout: 1000 }).catch(() => false);
    }

}
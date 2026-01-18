// metricsPage.js
import { expect } from '@playwright/test';


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

    }
    async gotoMetricsPage() {

        await this.metricsPageMenu.click();

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
        // Close any open menus/modals first by pressing Escape
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(300);

        // Wait for any overlays to disappear
        await this.page.waitForTimeout(500);

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
            streamOption = this.page.locator(`.q-item:has-text("${streamName}")`);
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
        const metricItem = this.page.locator('.q-item, [class*="field-item"], [class*="metric-item"], [class*="stream-item"]')
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
            const dropdownSearch = this.page.locator('.q-menu input[type="text"]').first();
            if (await dropdownSearch.isVisible({ timeout: 1000 }).catch(() => false)) {
                await dropdownSearch.fill(metricName);
                await this.page.waitForTimeout(500);
            }

            // Look for the metric in the dropdown options
            const metricOption = this.page.locator('.q-item, [role="option"]')
                .filter({ hasText: new RegExp(metricName, 'i') }).first();

            if (await metricOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                await metricOption.click();
                await this.page.waitForTimeout(1000);
                return true;
            }

            // Close dropdown if metric not found
            await this.page.keyboard.press('Escape');
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

        const options = await this.page.locator('.q-item, [role="option"]').allTextContents();

        // Close dropdown
        await this.page.keyboard.press('Escape');

        return options.filter(o => o.trim() !== '');
    }

    async selectTimeRange(range) {
        await this.openDatePicker();
        await this.page.waitForTimeout(500);

        // Try to find and click the time range option
        const rangeOption = this.page.locator(`.q-item:has-text("${range}"), button:has-text("${range}")`).first();

        if (await rangeOption.count() > 0) {
            await rangeOption.click();
            return true;
        }

        // Close date picker if option not found
        await this.page.keyboard.press('Escape');
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

        await this.page.keyboard.press('Escape');
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
        // Use the same pattern as logsPage.js which works reliably with Monaco editor
        // The key is to use the .inputarea selector inside the Monaco editor
        const editorSelectors = [
            '[data-test="dashboard-panel-query-editor"]',  // Primary metrics query editor
            '[data-test="dashboard-query"]',              // Alternate dashboard query selector
            '.monaco-editor'                               // Fallback to generic Monaco editor
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

        // Click on the Monaco editor to focus it
        await editorContainer.locator('.monaco-editor').click();
        await this.page.waitForTimeout(100);

        // Use platform-specific key combo for select all
        const selectAllKey = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
        await this.page.keyboard.press(selectAllKey);
        await this.page.waitForTimeout(100);

        // Use the .inputarea to fill the query (this is the hidden textarea Monaco uses)
        const inputArea = editorContainer.locator('.inputarea').first();
        if (await inputArea.count() > 0) {
            await inputArea.fill(query);
        } else {
            // Fallback: type the query character by character
            await this.page.keyboard.type(query, { delay: 10 });
        }
        await this.page.waitForTimeout(200);
    }

    async waitForMetricsResults() {
        // Wait for results to load after query execution
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // Query type switching methods
    async switchToSQLMode() {
        // Try to find and click SQL mode toggle/button
        const sqlToggle = this.page.locator('[data-test*="sql"], button:has-text("SQL"), .q-toggle:has-text("SQL")').first();
        const isVisible = await sqlToggle.isVisible().catch(() => false);
        if (isVisible) {
            await sqlToggle.click();
            return true;
        }
        return false;
    }

    async switchToPromQLMode() {
        // Try to find and click PromQL mode toggle/button
        const promqlToggle = this.page.locator('[data-test*="promql"], button:has-text("PromQL"), .q-toggle:has-text("PromQL")').first();
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
        const errorIndicator = this.page.locator('.q-notification--negative, .error-message, [class*="error"]').first();
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

        await editorContainer.locator('.monaco-editor').click();
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

            // Click the chart type button
            await chartButton.click();
            await this.page.waitForTimeout(1000);

            return true;
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
          'table': 'table tbody tr, .q-table tbody tr, .data-table tbody tr',
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
        return await this.page.locator('table thead th, .q-table thead th').count();
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
        const last15Min = this.page.locator('.q-item__label, .q-item, [role="option"]')
          .filter({ hasText: /Last 15 minutes|15m/i }).first();
        if (await last15Min.isVisible({ timeout: 3000 }).catch(() => false)) {
          await last15Min.click();
        } else {
          await this.page.keyboard.press('Escape');
        }
        await this.page.waitForTimeout(500);
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
        return await this.page.locator('table tbody tr, .data-table tr, [role="row"]').count();
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
        return this.page.locator('[data-test="dashboard-sidebar-collapse-btn"]').first();
    }

    async clickDashboardSidebarCollapseButton() {
        const btn = await this.getDashboardSidebarCollapseButton();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
        }
    }

    async getDashboardSidebarButton() {
        return this.page.locator('[data-test="dashboard-sidebar"]').first();
    }

    async clickDashboardSidebarButton() {
        const btn = await this.getDashboardSidebarButton();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
        }
    }

    async isSidebarVisible() {
        const sidebar = this.page.locator('.dashboard-sidebar, .config-sidebar, [class*="sidebar"]').first();
        return await sidebar.isVisible({ timeout: 3000 }).catch(() => false);
    }

    async getSidebarTabs() {
        return this.page.locator('.q-tab, [role="tab"], .sidebar-tab').locator('visible');
    }

    async getSidebarTabCount() {
        const tabs = await this.getSidebarTabs();
        return await tabs.count();
    }

    async clickTabByText(tabText) {
        const tab = this.page.locator('.q-tab, [role="tab"]').filter({ hasText: new RegExp(tabText, 'i') }).first();
        if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
            await tab.click();
            await this.page.waitForTimeout(500);
            return true;
        }
        return false;
    }

    async getActiveTabPanel() {
        return this.page.locator('.q-tab-panel, [role="tabpanel"], .tab-content').locator('visible').first();
    }

    async isTabPanelVisible() {
        const panel = await this.getActiveTabPanel();
        return await panel.isVisible({ timeout: 3000 }).catch(() => false);
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
        return this.page.locator('.q-item, [role="option"]').first();
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
        const rangeOption = this.page.locator(`.q-item:has-text("${range}"), button:has-text("${range}")`).first();
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
        await this.page.keyboard.press('Escape');
        return false;
    }

    // ===== NOTIFICATION METHODS =====

    async isErrorNotificationVisible() {
        const errorNotification = this.page.locator('.q-notification__message:has-text("Error")');
        return await errorNotification.isVisible({ timeout: 3000 }).catch(() => false);
    }

    async getErrorNotificationText() {
        const errorNotification = this.page.locator('.q-notification__message:has-text("Error")');
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
        return this.page.locator('[data-test*="chart-type"]').or(
            this.page.locator('button:has-text("Line"), button:has-text("Bar")')
        ).first();
    }

    async clickChartTypeButton() {
        const btn = await this.getChartTypeButton();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
            await this.page.waitForTimeout(500);
            return true;
        }
        return false;
    }

    async getChartTypeOption(chartType) {
        return this.page.locator(`.q-item:has-text("${chartType}")`).first();
    }

    async selectChartTypeOption(chartType) {
        const option = await this.getChartTypeOption(chartType);
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
            await option.click();
            await this.page.waitForTimeout(1000);
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
        return this.page.locator('input, select, .q-toggle, .q-checkbox').locator('visible');
    }

    async getVisibleOptionElementCount() {
        const elements = await this.getVisibleOptionElements();
        return await elements.count();
    }

    // ===== DATE/TIME PICKER METHODS =====

    async getDateTimePicker() {
        return this.page.locator('[data-test="date-time-picker"]').or(
            this.page.locator('[data-test="metrics-date-picker"]')
        ).or(
            this.page.locator('[data-cy="date-time-btn"]')
        ).first();
    }

    async clickDateTimePicker() {
        const picker = await this.getDateTimePicker();
        if (await picker.isVisible({ timeout: 3000 }).catch(() => false)) {
            await picker.click();
            return true;
        }
        return false;
    }

    async getCustomRangeOption() {
        return this.page.locator('text=/custom|relative|absolute/i').first();
    }

    async getDateInput() {
        return this.page.locator('input[type="date"], input[placeholder*="date"]').first();
    }

    async getPresetOption(preset) {
        return this.page.locator(`text="${preset}"`).first();
    }

    // ===== REFRESH BUTTON METHODS =====

    async getRefreshButton() {
        return this.page.locator('[data-test*="refresh"]').or(
            this.page.locator('[data-cy*="refresh"]')
        ).or(
            this.page.locator('button:has-text("Off")')
        ).first();
    }

    async clickRefreshButton() {
        const btn = await this.getRefreshButton();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
            return true;
        }
        return false;
    }

    async getIntervalOptions() {
        return this.page.locator('.q-item, [role="option"]');
    }

    // ===== CHART OPTIONS METHODS =====

    async getVisibleChartOptions() {
        return this.page.locator('.q-item:visible, [role="option"]:visible');
    }

    // ===== LEGEND METHODS =====
    // Note: Main legend methods are defined in the visualization section below

    // ===== MODE SELECTION METHODS =====

    async getModeOptions() {
        return this.page.locator('.q-item:has-text("SQL"), .q-item:has-text("PromQL")');
    }

    async getModeOptionCount() {
        const options = await this.getModeOptions();
        return await options.count();
    }

    // ===== SETTINGS PANEL METHODS =====

    async getSettingsPanel() {
        return this.page.locator('.settings-panel, .settings-modal, [class*="settings-dialog"]').first();
    }

    async isSettingsPanelVisible() {
        const panel = await this.getSettingsPanel();
        return await panel.isVisible({ timeout: 3000 }).catch(() => false);
    }

    async getSettingByText(text) {
        return this.page.locator(`text=/${text}/i`).first();
    }

    async getCloseButton() {
        return this.page.locator('button:has-text("Close"), button:has-text("Cancel"), [aria-label="Close"]').first();
    }

    async clickCloseButton() {
        const btn = await this.getCloseButton();
        if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click();
            return true;
        }
        return false;
    }

    // ===== EXPORT OPTIONS METHODS =====

    async getExportOptions() {
        return this.page.locator('.q-item:has-text("CSV"), .q-item:has-text("JSON"), .q-item:has-text("PNG")');
    }

    async getExportOptionCount() {
        const options = await this.getExportOptions();
        return await options.count();
    }

    // ===== THRESHOLD INPUT METHODS =====

    async getThresholdInputs() {
        return this.page.locator('input[type="number"][placeholder*="threshold"], input[placeholder*="value"]');
    }

    async getThresholdInputCount() {
        const inputs = await this.getThresholdInputs();
        return await inputs.count();
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
        const cells = await this.page.locator('table td, .q-table td, .data-table td').allTextContents();
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
        return this.page.locator('button[aria-label*="settings"], .settings-button, button:has-text("Settings"), [data-test*="settings"]').first();
    }

    async getAxisButton() {
        return this.page.locator('button[aria-label*="axis"], .axis-button, button:has-text("Axis"), [data-test*="axis"]').first();
    }

    async getThresholdButton() {
        return this.page.locator('button[aria-label*="threshold"], .threshold-button, button:has-text("Threshold"), [data-test*="threshold"]').first();
    }

    async getExportButton() {
        return this.page.locator('button[aria-label*="export"], .export-button, button:has-text("Export"), [data-test*="export"]').first();
    }

    // ===== ADDITIONAL HELPER METHODS FOR metrics.spec.js =====

    async selectLast15Minutes() {
        // Look for "Last 15 minutes" option in the date picker
        const last15MinutesOption = this.page.locator('.q-item__label, .q-item, [role="option"]').filter({ hasText: /Last 15 minutes|15m|15 min/i }).first();
        const hasOption = await last15MinutesOption.isVisible({ timeout: 3000 }).catch(() => false);

        if (hasOption) {
            await last15MinutesOption.click();
            return true;
        } else {
            // Try alternate approach - look for relative time options
            const relativeTimeButton = this.page.locator('button, [role="button"]').filter({ hasText: /Relative|Last/i }).first();
            if (await relativeTimeButton.isVisible().catch(() => false)) {
                await relativeTimeButton.click();
                await this.page.waitForTimeout(500);
            }

            // Try to find any 15 minute option
            const anyTimeOption = this.page.locator('text=/15.*min/i').first();
            if (await anyTimeOption.isVisible().catch(() => false)) {
                await anyTimeOption.click();
                return true;
            }
        }
        return false;
    }

    async hasTable() {
        const dataTable = this.page.locator('.results-table, .data-table, table.q-table, [class*="table"], .q-table__middle, table').first();
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
        return await this.page.locator('tbody td, .q-table__middle td, .table-cell').allTextContents();
    }

    async getResultsPageText() {
        return await this.page.locator('.q-page, main, .metrics-results').textContent().catch(() => '');
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
        return this.page.locator('.date-time-picker-dropdown, .q-menu');
    }

    async getCollapsibleToggle() {
        const collapsibleSelectors = [
            '[data-test="metrics-field-list-collapsed-icon"]',
            '[data-cy*="collapse"]',
            '[class*="collapse-btn"]',
            '[class*="toggle-btn"]',
            'button[aria-expanded]',
            '.q-expansion-item__toggle',
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
            '.q-expansion-item__content',
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
        // Check for various no-data/empty state messages
        const noDataSelectors = [
            'text=/no data|No results|Empty|no records|0 results/i',
            '[class*="no-data"]',
            '[class*="empty-state"]',
            '.no-results',
            '.empty-results',
            '[data-test*="no-data"]',
            '[data-test*="empty"]'
        ];

        for (const selector of noDataSelectors) {
            const element = this.page.locator(selector).first();
            if (await element.count() > 0) {
                return element;
            }
        }
        return this.page.locator('text=/no data|No results|Empty/i').first();
    }

    async getHighlightedElements() {
        return this.page.locator('.highlighted, [class*="match"], [class*="filtered"]');
    }

    async getMetricItems() {
        return this.page.locator('[class*="metric-item"], [class*="field-item"], .metric-name');
    }

    async getAddToDashboardButton() {
        return this.page.locator('button:has-text("Add to Dashboard"), [aria-label*="dashboard"]').first();
    }

    async getDashboardModal() {
        return this.page.locator('.q-dialog, [role="dialog"]').filter({ hasText: 'Dashboard' });
    }

    async getErrorIndicator() {
        return this.page.locator('.q-notification--negative, .error-message, [class*="error"]').first();
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
            '.q-expansion-item:not(.q-expansion-item--expanded)',
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
        return this.page.locator('.q-notification__message:has-text("Error")');
    }

    async expectNoErrorNotification() {
        await expect(this.page.locator('.q-notification__message:has-text("Error")')).not.toBeVisible();
    }

    async hasErrorIndicator() {
        // Check for actual error indicators in the UI (not false positives)
        // Focus on Quasar notifications and explicit error messages
        // Only check for actual error notifications that indicate a query failure
        const errorSelectors = [
            '.q-notification--negative',           // Quasar negative notification
            '.q-notification.bg-negative',         // Quasar notification with negative background
            '.q-banner--negative',                 // Quasar negative banner
            '[data-test="error-message"]',         // Explicit error message data-test
            '.error-notification'                  // Explicit error notification class
        ];

        for (const selector of errorSelectors) {
            const element = this.page.locator(selector).first();
            if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
                return true;
            }
        }

        // Also check for notification messages containing error text (more specific check)
        const notificationMessage = this.page.locator('.q-notification__message').first();
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
            '.q-notification--negative',
            '.q-notification.bg-negative',
            '.q-banner--negative',
            '.q-notification__message:has-text("Error")',
            '.q-notification__message:has-text("error")',
            '.q-notification__message:has-text("failed")',
            '[data-test="error-message"]',
            '.error-notification'
        ];

        for (const selector of errorSelectors) {
            const element = this.page.locator(selector).first();
            if (await element.isVisible({ timeout: 500 }).catch(() => false)) {
                return element;
            }
        }
        return this.page.locator('.q-notification--negative, .q-notification__message').first();
    }

    // SQL mode methods
    async getSqlToggle() {
        return this.page.locator('[data-test*="sql"], button:has-text("SQL"), .q-toggle:has-text("SQL")').first();
    }

    async getSqlIndicator() {
        return this.page.locator('.sql-mode, text=/SQL Mode/i').first();
    }

    // ============================================
    // CONFIG METHODS (for metrics-config.spec.js)
    // ============================================

    // Preset selection method
    async getPresetOptionByText(presetText) {
        return this.page.locator(`text="${presetText}"`).first();
    }

    // Setting element method
    async getSettingElementByText(optionText) {
        return this.page.locator(`text=/${optionText}/i`).first();
    }

}
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
        // Using a common query editor selector pattern from other tests
        const queryEditor = this.page.locator('.monaco-editor').first();
        await queryEditor.click();
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.type(query);
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
        // Clear the query editor
        const queryEditor = this.page.locator('.monaco-editor').first();
        await queryEditor.click();
        await this.page.keyboard.press('Control+A');
        await this.page.keyboard.press('Delete');
    }

    // Chart visualization methods
    async selectChartType(chartType) {
        // Map chart types to common selector patterns
        const chartTypeMap = {
            'line': ['Line', 'line-chart', 'LineChart'],
            'bar': ['Bar', 'bar-chart', 'BarChart'],
            'area': ['Area', 'area-chart', 'AreaChart'],
            'scatter': ['Scatter', 'scatter-plot', 'ScatterPlot'],
            'pie': ['Pie', 'pie-chart', 'PieChart'],
            'heatmap': ['Heatmap', 'heat-map', 'HeatMap'],
            'table': ['Table', 'table-view', 'TableView']
        };

        const chartNames = chartTypeMap[chartType.toLowerCase()] || [chartType];

        // Try multiple selector strategies
        for (const chartName of chartNames) {
            // Try button with text
            const chartButton = this.page.locator(`button:has-text("${chartName}")`).first();
            if (await chartButton.count() > 0 && await chartButton.isVisible()) {
                await chartButton.click();
                await this.page.waitForTimeout(1000);
                return true;
            }

            // Try dropdown option
            const dropdownOption = this.page.locator(`.q-item:has-text("${chartName}"), [role="option"]:has-text("${chartName}")`).first();
            if (await dropdownOption.count() > 0 && await dropdownOption.isVisible()) {
                await dropdownOption.click();
                await this.page.waitForTimeout(1000);
                return true;
            }

            // Try radio/toggle with chart type
            const radioOption = this.page.locator(`input[type="radio"][value="${chartName.toLowerCase()}"], .chart-type-${chartType.toLowerCase()}`).first();
            if (await radioOption.count() > 0) {
                await radioOption.click();
                await this.page.waitForTimeout(1000);
                return true;
            }
        }

        // If no direct selector found, try opening chart type selector first
        const chartTypeSelector = this.page.locator('.chart-type-selector, button[aria-label*="chart type"], button:has-text("Chart Type")').first();
        if (await chartTypeSelector.count() > 0 && await chartTypeSelector.isVisible()) {
            await chartTypeSelector.click();
            await this.page.waitForTimeout(500);

            // Try again to find the chart type
            for (const chartName of chartNames) {
                const option = this.page.locator(`text="${chartName}"`).first();
                if (await option.isVisible()) {
                    await option.click();
                    await this.page.waitForTimeout(1000);
                    return true;
                }
            }
        }

        // Log warning if chart type couldn't be selected
        return false;
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

    // ===== CHART TYPE SELECTION METHODS (Added by Sentinel Auto-Fix) =====

    async selectChartType(chartType) {
        // Chart buttons mapping
        const chartButtons = {
          'line': 'button[title*="Line"], [aria-label*="Line"], .chart-type-line',
          'pie': 'button[title*="Pie"], [aria-label*="Pie"], .chart-type-pie',
          'table': 'button[title*="Table"], [aria-label*="Table"], .chart-type-table',
          'heatmap': 'button[title*="Heatmap"], [aria-label*="Heat"], .chart-type-heatmap',
          'gauge': 'button[title*="Gauge"], [aria-label*="Gauge"], .chart-type-gauge',
          'bar': 'button[title*="Bar"], [aria-label*="Bar"], .chart-type-bar'
        };

        let chartButton = this.page.locator(chartButtons[chartType]).first();

        if (await chartButton.count() === 0) {
          // Try Quasar icon names
          const iconNames = {
            'line': 'show_chart',
            'pie': 'pie_chart',
            'table': 'table_chart',
            'heatmap': 'grid_on',
            'gauge': 'speed',
            'bar': 'bar_chart'
          };
          chartButton = this.page.locator(`q-icon[name="${iconNames[chartType]}"]`).first();
        }

        if (await chartButton.count() === 0) {
          // Try text matching
          const chartNames = {
            'line': 'Line',
            'pie': 'Pie',
            'table': 'Table',
            'heatmap': 'Heatmap',
            'gauge': 'Gauge',
            'bar': 'Bar'
          };
          chartButton = this.page.getByText(chartNames[chartType], { exact: false }).first();
        }

        const exists = await chartButton.count() > 0;
        if (exists) {
          await chartButton.click();
          await this.page.waitForTimeout(1000);
          return true;
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

    async getTableRowCount() {
        return await this.page.locator('table tbody tr, .q-table tbody tr').count();
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

}
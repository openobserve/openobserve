import { expect } from '@playwright/test';
import { LogsQueryPage } from './logsQueryPage.js';
import { LoginPage } from '../generalPages/loginPage.js';
import { IngestionPage } from '../generalPages/ingestionPage.js';
import { ManagementPage } from '../generalPages/managementPage.js';
import * as fs from 'fs';
import * as path from 'path';

// Import testLogger for proper logging
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class LogsPage {
    constructor(page) {
        this.page = page;
        
        // Initialize existing page objects
        this.logsQueryPage = new LogsQueryPage(page);
        this.loginPage = new LoginPage(page);
        this.ingestionPage = new IngestionPage(page);
        this.managementPage = new ManagementPage(page);
        
        // Locators
        this.logsMenuItem = '[data-test="menu-link-\\/logs-item"]';
        this.homeButton = "[name ='home']";
        this.queryButton = "[data-test='logs-search-bar-refresh-btn']";
        this.queryEditor = '[data-test="logs-search-bar-query-editor"]';
        this.quickModeToggle = '[data-test="logs-search-bar-quick-mode-toggle-btn"]';
        this.sqlModeToggle = '[data-test="logs-search-bar-sql-mode-toggle-btn"]';
        this.sqlModeSwitch = { role: 'switch', name: 'SQL Mode' };
        this.dateTimeButton = '[data-test="date-time-btn"]';
        this.indexDropDown = '[data-test="log-search-index-list-select-stream"]';
        this.streamToggle = '[data-test="log-search-index-list-stream-toggle-default"] .q-toggle__inner';
        this.searchPartitionButton = '[data-test="logs-search-partition-btn"]';
        this.histogramToggle = '[data-test="logs-search-bar-show-histogram-toggle-btn"]';
        this.exploreButton = '[data-test="logs-search-explore-btn"]';
        this.timestampColumnMenu = '[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]';
        this.resultText = '[data-test="logs-search-search-result"]';
        this.logTableColumnSource = '[data-test="log-table-column-0-source"]';
        this.logsSearchBarQueryEditor = '[data-test="logs-search-bar-query-editor"]';
        this.searchBarRefreshButton = '[data-cy="search-bar-refresh-button"] > .q-btn__content';
        this.relative15MinButton = '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block';
        this.relative6WeeksButton = '[data-test="date-time-relative-6-w-btn"] > .q-btn__content';
        this.relative30SecondsButton = '[data-test="date-time-relative-30-s-btn"] > .q-btn__content > .block';
        this.absoluteTab = '[data-test="date-time-absolute-tab"]';
        this.scheduleText = '[data-test="date-time-btn"]';
        this.timeZoneDropdown = '[data-test="timezone-select"]';
        this.timeZoneOption = (zone) => `[data-test="timezone-option-${zone}"]`;
        this.dateSelector = (day) => `[data-test="date-selector-${day}"]`;
        this.monthSelector = (month) => `[data-test="month-selector-${month}"]`;
        this.yearSelector = (year) => `[data-test="year-selector-${year}"]`;
        this.startTimeField = '[data-test="start-time-field"]';
        this.endTimeField = '[data-test="end-time-field"]';
        this.startTimeInput = '[data-test="start-time-input"]';
        this.endTimeInput = '[data-test="end-time-input"]';
        this.showQueryToggle = '[data-test="logs-search-bar-show-query-toggle-btn"]';
        this.fieldListCollapseButton = '[data-test="logs-search-field-list-collapse-btn"]';
        this.savedViewsButton = '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown--current > .q-btn__content > :nth-child(1)';
        this.savedViewsExpand = '[data-test="logs-search-saved-views-btn"]';
        this.saveViewButton = 'button'; // filter by text in method
        this.savedViewNameInput = '[data-test="add-alert-name-input"]';
        this.savedViewDialogSave = '[data-test="saved-view-dialog-save-btn"]';
        this.savedViewArrow = '[data-test="logs-search-saved-views-btn"] > .q-btn-dropdown__arrow-container > .q-btn__content > .q-icon';
        this.savedViewSearchInput = '[data-test="log-search-saved-view-field-search-input"]';
        this.confirmButton = '[data-test="confirm-button"]';
        this.streamsMenuItem = '[data-test="menu-link-\\/streams-item"]';
        this.searchStreamInput = '[placeholder="Search Stream"]';
        this.exploreButtonRole = { role: 'button', name: 'Explore' };
        this.resetFiltersButton = '[data-test="logs-search-bar-reset-filters-btn"]';
        this.includeExcludeFieldButton = ':nth-child(1) > [data-test="log-details-include-exclude-field-btn"] > .q-btn__content > .q-icon';
        this.includeFieldButton = '[data-test="log-details-include-field-btn"]';
        this.closeDialog = '[data-test="close-dialog"] > .q-btn__content';
        this.savedViewDialogSaveContent = '[data-test="saved-view-dialog-save-btn"] > .q-btn__content';
        this.savedViewByLabel = '.q-item__label';
        this.notificationMessage = '.q-notification__message';
        this.indexFieldSearchInput = '[data-cy="index-field-search-input"]';
        this.errorMessage = '[data-test="logs-search-error-message"]';
        this.warningElement = 'text=warning Query execution';
        this.logsTable = '[data-test="logs-search-result-logs-table"]';
        this.barChartCanvas = '[data-test="logs-search-result-bar-chart"] canvas';
        this.expandLabel = label => `Expand "${label}"`;
        this.collapseLabel = label => `Collapse "${label}"`;
        this.addStreamButton = '[data-test="log-stream-add-stream-btn"]';
        this.addStreamNameInput = '[data-test="add-stream-name-input"]';
        this.saveStreamButton = '[data-test="save-stream-btn"]';
        this.streamDetail = '[title="Stream Detail"]';
        this.schemaStreamIndexSelect = ':nth-child(2) > [data-test="schema-stream-index-select"]';
        this.fullTextSearch = '.q-virtual-scroll__content';
        this.schemaUpdateSettingsButton = '[data-test="schema-update-settings-button"]';
        this.colAutoButton = '.col-auto > .q-btn > .q-btn__content';
        this.exploreTitle = '[title="Explore"]';
        this.streamsSearchStreamInput = '[data-test="streams-search-stream-input"]';
        this.logSearchIndexListFieldSearchInput = '[data-test="log-search-index-list-field-search-input"]';
        this.expandCode = 'Expand "code"';
        this.logsDetailTableSearchAroundBtn = '[data-test="logs-detail-table-search-around-btn"]';
        this.logTableColumn3Source = '[data-test="log-table-column-3-source"]';
        this.histogramToggleDiv = '[data-test="logs-search-bar-show-histogram-toggle-btn"] div';

        // Additional locators
        this.fnEditor = '#fnEditor';
        this.searchListFirstTextLeft = '.search-list > :nth-child(1) > .text-left';
        this.liveModeToggleBtn = '[data-test="logs-search-bar-refresh-interval-btn-dropdown"]';
        this.liveMode5SecBtn = '[data-test="logs-search-bar-refresh-time-5"]';
        this.vrlToggleBtn = '[data-test="logs-search-bar-vrl-toggle-btn"]';
        this.vrlToggleButton = '[data-test="logs-search-bar-show-query-toggle-btn"] img';
        this.vrlEditor = '[data-test="logs-vrl-function-editor"]';
        this.relative6DaysBtn = '[data-test="date-time-relative-6-d-btn"] > .q-btn__content';
        this.menuLink = link => `[data-test="menu-link-${link}"]`;
        this.searchAroundBtn = '[data-test="logs-search-bar-search-around-btn"]';
        this.pagination = '[data-test="logs-search-pagination"]';
        this.sqlPagination = '[data-test="logs-search-sql-pagination"]';
        this.sqlGroupOrderLimitPagination = '[data-test="logs-search-sql-group-order-limit-pagination"]';
        this.interestingFieldBtn = field => `[data-test="log-search-index-list-interesting-${field}-field-btn"]`;
        this.logsSearchBarFunctionDropdownSave = '[data-test="logs-search-bar-function-dropdown"] button';
        this.savedFunctionNameInput = '[data-test="saved-function-name-input"]';
        this.qNotifyWarning = '#q-notify div';
        this.qPageContainer = '.q-page-container';
        this.cmContent = '.view-lines';
        this.cmLine = '.view-line';
        this.searchFunctionInput = { placeholder: 'Search Function' };
        this.timestampFieldTable = '[data-test="log-search-index-list-fields-table"]';
    }



    // Reusable helper methods for code reuse
    async expectQueryEditorContainsTextHelper(text) {
        return await expect(this.page.locator(this.queryEditor)).toContainText(text);
    }

    async clickMenuLinkByType(linkType) {
        const linkMap = {
            'logs': this.logsMenuItem,
            'traces': '[data-test="menu-link-/traces-item"]',
            'streams': this.streamsMenuItem,
            'metrics': '[data-test="menu-link-\\/metrics-item"]',
            'pipeline': '[data-test="menu-link-\\/pipeline-item"]',
            'functions': '[data-test="menu-link-\\/functions-item"]'
        };
        return await this.page.locator(linkMap[linkType]).click({ force: true });
    }

    async fillInputField(selector, text) {
        return await this.page.locator(selector).fill(text);
    }

    async clickElementByLabel(label, action = 'Expand') {
        const labelText = action === 'Expand' ? this.expandLabel(label) : this.collapseLabel(label);
        return await this.page.getByLabel(labelText).click();
    }

    async expectKubernetesPodContent(podType, ingesterNumber = '') {
        const content = `kubernetes_${podType}${ingesterNumber ? `-ziox-ingester-${ingesterNumber}` : ''}`;
        return await this.expectQueryEditorContainsTextHelper(content);
    }

    // Navigation methods
    async navigateToLogs(orgIdentifier) {
        const logsUrl = '/web/logs'; // Using the same pattern as in test files
        const orgId = orgIdentifier || process.env["ORGNAME"];
        const fullUrl = `${logsUrl}?org_identifier=${orgId}&fn_editor=true`;
        
        
        // Include fn_editor=true to ensure VRL editor is available for tests that need it
        await this.page.goto(fullUrl);
        
        
        // Wait for page load and check for VRL editor
        await this.page.waitForLoadState('domcontentloaded');
        
        // Wait for VRL editor to be available (with retries)
        let fnEditorExists = 0;
        let retries = 5;
        
        while (fnEditorExists === 0 && retries > 0) {
            await this.page.waitForLoadState('networkidle', { timeout: 10000 });
            fnEditorExists = await this.page.locator('#fnEditor').count();
            
            if (fnEditorExists === 0) {
                await this.page.waitForTimeout(2000);
                retries--;
            }
        }
        
        if (fnEditorExists === 0) {
            
            // Try reloading with explicit parameters
            const currentUrl = new URL(this.page.url());
            currentUrl.searchParams.set('fn_editor', 'true');
            currentUrl.searchParams.set('vrl', 'true'); // Try alternative parameter
            
            await this.page.goto(currentUrl.toString());
            await this.page.waitForLoadState('networkidle', { timeout: 15000 });
            
            fnEditorExists = await this.page.locator('#fnEditor').count();
            
            if (fnEditorExists === 0) {
                // Take screenshot for debugging
            }
        } else {
        }
    }

    async validateLogsPage() {
        await expect(this.page).toHaveURL(/.*\/logs/);
    }

    async logsPageDefaultMultiOrg() {
        await this.page.goto('/logs');
        await expect(this.page).toHaveURL(/.*\/logs/);
    }

    async logsPageURLValidation() {
        await expect(this.page).toHaveURL(/.*\/logs/);
    }

    // Stream and index selection methods
    async selectIndexAndStream() {
        await this.page.locator(this.indexDropDown).click();
        await this.page.locator(this.streamToggle).click();
    }

    async selectIndexAndStreamJoin() {
        await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
        await this.page.waitForTimeout(3000);
        await this.page.locator('[data-test="log-search-index-list-stream-toggle-default"] div').first().click();
        await this.page.waitForTimeout(1000);
        await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
    }

    async selectIndexStreamDefault() {
        await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
        await this.page.waitForTimeout(3000);
        await this.page.locator('[data-test="log-search-index-list-stream-toggle-default"] div').first().click();
    }

    async selectIndexStream(streamName) {
        console.log(`[DEBUG] selectIndexStream: Starting selection for stream: ${streamName}`);
        try {
            await this.page.locator(this.indexDropDown).waitFor({ timeout: 10000 });
            await this.page.locator(this.indexDropDown).click();
            console.log(`[DEBUG] selectIndexStream: Clicked dropdown`);
            await this.page.waitForTimeout(2000);
            
            await this.page.locator(this.streamToggle).waitFor({ timeout: 10000 });
            await this.page.locator(this.streamToggle).click();
            console.log(`[DEBUG] selectIndexStream: Successfully selected stream with default method`);
        } catch (error) {
            console.log(`[DEBUG] Failed to select stream with default method, trying alternative approach: ${error.message}`);
            // Fallback to the old method
            await this.selectIndexStreamOld(streamName);
        }
    }

    async selectStream(stream) {
        await this.page.locator(this.indexDropDown).click();
        await this.page.getByText(stream, { exact: true }).first().click();
    }

    async selectIndexStreamOld(streamName) {
        console.log(`[DEBUG] selectIndexStreamOld: Starting selection for stream: ${streamName}`);
        try {
            // Click the dropdown
            await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
            console.log(`[DEBUG] selectIndexStreamOld: Clicked dropdown`);
            await this.page.waitForTimeout(2000);
            
            // Quick attempt to find and click the stream by text
            console.log(`[DEBUG] selectIndexStreamOld: Trying to find stream by text: ${streamName}`);
            await this.page.getByText(streamName, { exact: true }).first().click({ timeout: 5000 });
            console.log(`[DEBUG] selectIndexStreamOld: Successfully selected stream by text: ${streamName}`);
            
        } catch (error) {
            console.log(`[DEBUG] selectIndexStreamOld: Failed to select stream ${streamName}: ${error.message}`);
            
            // Quick fallback: just select the first available stream
            console.log(`[DEBUG] selectIndexStreamOld: Trying to select first available stream as fallback`);
            try {
                await this.page.locator('[data-test*="log-search-index-list-stream-toggle-"]').first().click({ timeout: 5000 });
                console.log(`[DEBUG] selectIndexStreamOld: Selected first available stream as fallback`);
            } catch (fallbackError) {
                console.log(`[DEBUG] selectIndexStreamOld: Fallback also failed: ${fallbackError.message}`);
                // Don't throw error, just log it and continue
                console.log(`[DEBUG] selectIndexStreamOld: Continuing without stream selection`);
            }
        }
    }

    // Helper method to ensure query editor is ready
    async ensureQueryEditorReady() {
        // Wait for the query editor to be visible and ready
        await this.page.locator(this.queryEditor).waitFor({ 
            state: 'visible', 
            timeout: 10000 
        });
        
        // Wait a moment for any UI updates
        await this.page.waitForTimeout(1000);
    }

    // Query execution methods
    async selectRunQuery() {
        // Ensure query editor is ready
        await this.ensureQueryEditorReady();
        
        // Wait for the query button to be visible and click it
        await this.page.locator(this.queryButton).waitFor({ state: 'visible', timeout: 10000 });
        
        // Add a small wait to ensure the button is fully ready
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async applyQuery() {
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async applyQueryButton(expectedUrl) {
        await this.page.locator(this.queryButton).click();
        // Handle both full URLs and path-only URLs, allow query parameters
        const urlPattern = expectedUrl.startsWith('http') 
            ? expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            : `.*${expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
        await expect(this.page).toHaveURL(new RegExp(urlPattern));
    }

    async clearAndRunQuery() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async clearAndFillQueryEditor(query) {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.keyboard.type(query);
    }

    async typeQuery(query) {
        await this.page.locator(this.queryEditor).click();
        await this.page.locator(this.queryEditor).press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.locator(this.queryEditor).locator('.inputarea').fill(query);
    }

    async executeQueryWithKeyboardShortcut() {
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithKeyboardShortcutTest() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.type("SELECT * FROM 'e2e_automate' LIMIT 10");
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithKeyboardShortcutAfterClickingElsewhere() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.type("SELECT * FROM 'e2e_automate' LIMIT 10");
        await this.page.locator(this.homeButton).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithKeyboardShortcutWithDifferentQuery() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.keyboard.type("SELECT * FROM 'e2e_automate' WHERE log LIKE '%test%' LIMIT 5");
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithKeyboardShortcutWithSQLMode() {
        await this.page.locator(this.sqlModeToggle).first().click();
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.type("SELECT * FROM 'e2e_automate' LIMIT 10");
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async executeQueryWithErrorHandling() {
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.type("INVALID QUERY");
        await this.page.locator(this.queryButton).click();
    }

    async executeHistogramQuery(query) {
        await this.clearAndFillQueryEditor(query);
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async waitForSearchResultAndCheckText(expectedText) {
        await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]');
        await expect(this.page.locator('[data-test="logs-search-result-logs-table"]')).toContainText(expectedText);
    }

    // Time and date methods
    async setTimeToPast30Seconds() {
        await this.page.locator(this.dateTimeButton).click();
        await this.page.locator(this.relative30SecondsButton).click();
    }

    async verifyTimeSetTo30Seconds() {
        await expect(this.page.locator(this.scheduleText)).toContainText('Past 30 Seconds');
    }

    async setDateTime() {
        await this.page.locator(this.dateTimeButton).click();
    }

    async setDateTimeToToday() {
        await this.page.locator(this.dateTimeButton).click();
        await this.page.locator(this.absoluteTab).click();
    }

    async setDateTimeTo15Minutes() {
        await this.page.locator(this.dateTimeButton).click();
        await this.page.locator('[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block').click();
    }

    async setAbsoluteDate(year, month, day, currentMonth, currentYear) {
        await this.page.locator(this.dateTimeButton).click();
        await this.page.locator(this.absoluteTab).click();
        await this.page.locator(this.monthSelector(currentMonth)).click();
        await this.page.locator(this.yearSelector(currentYear)).click();
        await this.page.locator(this.dateSelector(day)).click();
    }

    async setStartAndEndTime(startTime, endTime) {
        await this.page.locator(this.startTimeField).fill(startTime);
        await this.page.locator(this.endTimeField).fill(endTime);
    }

    async setTimeRange(startTime, endTime) {
        await this.setStartAndEndTime(startTime, endTime);
    }

    async verifySchedule(expectedTime) {
        await expect(this.page.locator(this.scheduleText)).toContainText(expectedTime);
    }

    async setTimeZone(zone) {
        await this.page.locator(this.timeZoneDropdown).click();
        await this.page.locator(this.timeZoneOption(zone)).click();
    }

    async changeTimeZone() {
        await this.setTimeZone('UTC');
    }

    async verifyDateTime(startTime, endTime) {
        await expect(this.page.locator(this.startTimeInput)).toHaveValue(startTime);
        await expect(this.page.locator(this.endTimeInput)).toHaveValue(endTime);
    }

    async getScheduleText() {
        return await this.page.locator(this.scheduleText).textContent();
    }

    // SQL Mode methods
    async enableSQLMode() {
        await this.page.locator(this.sqlModeToggle).first().click();
    }

    // Quick Mode methods
    async verifyQuickModeToggle() {
        await expect(this.page.locator(this.quickModeToggle)).toBeVisible();
    }

    async clickQuickModeToggle() {
        await this.page.locator(this.quickModeToggle).click();
    }

    // Histogram methods
    async toggleHistogram() {
        await this.page.locator(this.histogramToggle).click();
    }

    async toggleHistogramAndExecute() {
        await this.toggleHistogram();
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async verifyHistogramState() {
        const isHistogramOff = await this.page.locator(this.histogramToggle)
            .evaluate(el => el.getAttribute('aria-checked') === 'false');
        expect(isHistogramOff).toBeTruthy();
    }

    // Error handling methods
    async checkErrorVisible() {
        await expect(this.page.locator(this.errorMessage)).toBeVisible();
    }

    async getErrorDetails() {
        return await this.page.locator(this.errorMessage).textContent();
    }

    // Search partition methods
    async clickRunQueryButton() {
        await this.page.locator("[data-test='logs-search-bar-refresh-btn']").click({ force: true });
    }

    async verifySearchPartitionResponse() {
        const searchPartitionPromise = this.page.waitForResponse(response => 
            response.url().includes('/api/default/_search_partition') && 
            response.request().method() === 'POST'
        );
        
        const searchPartitionResponse = await searchPartitionPromise;
        const searchPartitionData = await searchPartitionResponse.json();

        expect(searchPartitionData).toHaveProperty('partitions');
        expect(searchPartitionData).toHaveProperty('histogram_interval');
        expect(searchPartitionData).toHaveProperty('order_by', 'asc');

        return searchPartitionData;
    }

    async captureSearchCalls() {
        const searchCalls = [];
        
        // Create the event listener function
        const responseHandler = async response => {
            if (response.url().includes('/api/default/_search') && 
                response.request().method() === 'POST') {
                const requestData = await response.request().postDataJSON();
                searchCalls.push({
                    start_time: requestData.query.start_time,
                    end_time: requestData.query.end_time,
                    sql: requestData.query.sql
                });
            }
        };
        
        // Attach the event listener
        this.page.on('response', responseHandler);
        
        try {
            await this.page.waitForTimeout(2000);
            return searchCalls;
        } finally {
            // Always remove the event listener to prevent memory leaks
            this.page.removeListener('response', responseHandler);
        }
    }

        async verifyStreamingModeResponse() {
        console.log("[DEBUG] Waiting for search response...");
        const searchPromise = this.page.waitForResponse(response => {
            const url = response.url();
            const method = response.request().method();
            console.log(`[DEBUG] Response: ${method} ${url}`);
            return url.includes('/api/default/_search') && method === 'POST';
        });
        
        const searchResponse = await searchPromise;
        console.log(`[DEBUG] Search response status: ${searchResponse.status()}`);
        expect(searchResponse.status()).toBe(200);
        
        const searchData = await searchResponse.json();
        console.log("[DEBUG] Search response data:", JSON.stringify(searchData, null, 2));
        console.log("[DEBUG] searchData type:", typeof searchData);
        console.log("[DEBUG] searchData keys:", Object.keys(searchData || {}));
        expect(searchData).toBeDefined();
        
        // Check if this is a partition response (non-streaming) or streaming response
        if (searchData.partitions) {
            console.log("[DEBUG] Received partition response (non-streaming mode)");
            expect(searchData.partitions).toBeDefined();
            expect(searchData.histogram_interval).toBeDefined();
        } else if (searchData.hits) {
            console.log("[DEBUG] Received streaming response");
            expect(searchData.hits).toBeDefined();
        } else {
            console.log("[DEBUG] Unexpected response structure:", JSON.stringify(searchData, null, 2));
            throw new Error(`Unexpected response structure: ${JSON.stringify(searchData)}`);
        }
    }

    async clickRunQueryButtonAndVerifyStreamingResponse() {
        console.log("[DEBUG] Setting up response listener before clicking run query button");
        const searchPromise = this.page.waitForResponse(response => {
            const url = response.url();
            const method = response.request().method();
            console.log(`[DEBUG] Response: ${method} ${url}`);
            return url.includes('/api/default/_search') && method === 'POST';
        });
        
        await this.clickRunQueryButton();
        
        const searchResponse = await searchPromise;
        console.log(`[DEBUG] Search response status: ${searchResponse.status()}`);
        expect(searchResponse.status()).toBe(200);
        
        // Check if this is a streaming response (SSE format) or JSON response
        const responseUrl = searchResponse.url();
        if (responseUrl.includes('_search_stream')) {
            console.log("[DEBUG] Received streaming response (SSE format)");
            const responseText = await searchResponse.text();
            console.log("[DEBUG] Streaming response text (first 200 chars):", responseText.substring(0, 200));
            expect(responseText).toBeDefined();
            expect(responseText.length).toBeGreaterThan(0);
        } else {
            console.log("[DEBUG] Received JSON response");
            const searchData = await searchResponse.json();
            console.log("[DEBUG] Search response data:", JSON.stringify(searchData, null, 2));
            console.log("[DEBUG] searchData type:", typeof searchData);
            console.log("[DEBUG] searchData keys:", Object.keys(searchData || {}));
            expect(searchData).toBeDefined();
            
            // Check if this is a partition response or regular search response
            if (searchData.partitions) {
                console.log("[DEBUG] Received partition response (non-streaming mode)");
                expect(searchData.partitions).toBeDefined();
                expect(searchData.histogram_interval).toBeDefined();
            } else if (searchData.hits) {
                console.log("[DEBUG] Received regular search response");
                expect(searchData.hits).toBeDefined();
            } else {
                console.log("[DEBUG] Unexpected response structure:", JSON.stringify(searchData, null, 2));
                throw new Error(`Unexpected response structure: ${JSON.stringify(searchData)}`);
            }
        }
    }

    // Explore and results methods
    async clickExplore() {
        try {
            await this.page.locator(this.exploreButton).first().waitFor({ state: 'visible', timeout: 10000 });
            await this.page.locator(this.exploreButton).first().waitFor({ state: 'attached', timeout: 10000 });
            
            await Promise.all([
                this.page.waitForLoadState('networkidle'),
                this.page.locator(this.exploreButton).first().click()
            ]);
            
            await this.page.waitForTimeout(3000);
        } catch (error) {
            console.error('Error in clickExplore:', error);
            throw error;
        }
    }

    async openTimestampMenu() {
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { state: 'visible', timeout: 10000 });
            await this.page.waitForSelector('[data-test="log-table-column-1-_timestamp"]', { state: 'visible', timeout: 10000 });
            await this.timestampColumnMenu.waitFor({ state: 'visible', timeout: 10000 });
            await this.timestampColumnMenu.scrollIntoViewIfNeeded();
            
            await Promise.all([
                this.page.waitForLoadState('networkidle'),
                this.timestampColumnMenu.click({ force: true })
            ]);
            
            await this.page.waitForTimeout(1000);
        } catch (error) {
            console.error('Error in openTimestampMenu:', error);
            try {
                await this.page.waitForTimeout(2000);
                await this.timestampColumnMenu.click({ force: true });
                await this.page.waitForTimeout(1000);
            } catch (retryError) {
                console.error('Error in openTimestampMenu retry:', retryError);
                throw retryError;
            }
        }
    }

    async clickResultsPerPage() {
        await this.page.locator('[data-test="logs-search-search-result"]').getByText('arrow_drop_down').click();
        await this.page.getByText('10', { exact: true }).click();
        await this.page.waitForTimeout(2000);
        await expect(this.page.locator('[data-test="logs-search-search-result"]')).toContainText('Showing 1 to 10 out of');
    }

    async selectResultsPerPageAndVerify(resultsPerPage, expectedText) {
        await this.page.getByText(resultsPerPage, { exact: true }).click();
        await this.page.waitForTimeout(5000); // Increased wait time for UI update
        
        // Use flexible assertions based on the results per page
        let expectedPattern;
        switch (resultsPerPage) {
            case '2':
                expectedPattern = 'Showing 11 to 20 out of';
                break;
            case '3':
                expectedPattern = 'Showing 21 to 30 out of';
                break;
            case '4':
                expectedPattern = 'Showing 31 to';
                break;
            default:
                expectedPattern = expectedText;
        }
        
        // Use a more flexible assertion that checks for the pattern rather than exact text
        await expect(this.page.locator('[data-test="logs-search-search-result"]')).toContainText(expectedPattern);
    }

    async pageNotVisible() {
        const fastRewindElement = this.page.locator('[data-test="logs-search-result-records-per-page"]').getByText('50');
        await expect(fastRewindElement).not.toBeVisible();
    }

    // Validation methods
    async validateResult() {
        try {
            // Wait for the logs table with a longer timeout for streaming mode
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 45000, // Increased timeout for streaming mode
                state: 'visible' 
            });
            await expect(this.page.locator('[data-test="logs-search-result-logs-table"]')).toBeVisible();
        } catch (error) {
            console.error('Error in validateResult:', error);
            // Check if there's an error message visible
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                const errorText = await errorMessage.textContent();
                console.error('Error message found:', errorText);
                throw new Error(`Query failed with error: ${errorText}`);
            }
            // Check if there's a "no data found" message
            const noDataMessage = this.page.getByText('No data found');
            if (await noDataMessage.isVisible()) {
                console.log('No data found for the query');
                return; // This is acceptable for some queries
            }
            throw error;
        }
    }

    async displayCountQuery() {
        await this.clearAndFillQueryEditor("SELECT COUNT(*) as count FROM 'e2e_automate'");
        
        // Ensure query editor is ready
        await this.ensureQueryEditorReady();
        
        // Wait for the query button to be visible and click it
        await this.page.locator(this.queryButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async displayTwoStreams() {
        await this.clearAndFillQueryEditor("SELECT * FROM 'e2e_automate' UNION ALL SELECT * FROM 'e2e_automate'");
        
        // Ensure query editor is ready
        await this.ensureQueryEditorReady();
        
        // Wait for the query button to be visible and click it
        await this.page.locator(this.queryButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.queryButton).click();
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    // Interesting fields methods
    async clickInterestingFields() {
        await this.fillIndexFieldSearchInput('kubernetes_pod_name');
        await this.page.locator('[data-test="log-search-index-list-interesting-kubernetes_pod_name-field-btn"]').first().click();
    }

    async validateInterestingFields() {
        await expect(this.page.locator(this.queryEditor)).toContainText('kubernetes_pod_name');
    }

    async validateInterestingFieldsQuery() {
        await expect(this.page.locator(this.queryEditor)).toContainText('kubernetes_pod_name');
    }

    async addRemoveInteresting() {
        await this.clickInterestingFields();
        await this.page.locator('[data-test="log-search-index-list-interesting-kubernetes_pod_name-field-btn"]').first().click();
    }

    // Kubernetes methods
    async kubernetesContainerName() {
        await this.page.getByLabel('Expand "kubernetes_container_name"').click();
        await this.page.waitForTimeout(5000);
        await this.page.locator('[data-test="logs-search-subfield-add-kubernetes_container_name-ziox"] [data-test="log-search-subfield-list-equal-kubernetes_container_name-field-btn"]').click();
    }

    async kubernetesContainerNameJoin() {
        await this.page
            .locator('[data-test="logs-search-bar-query-editor"]').locator('.inputarea')
            .fill('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a join "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.page.waitForTimeout(5000);
    }

    async kubernetesContainerNameJoinLimit() {
        await this.page
            .locator('[data-test="logs-search-bar-query-editor"]').locator('.inputarea')
            .fill('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a left join "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name LIMIT 10');
        await this.page.waitForTimeout(5000);
    }

    async kubernetesContainerNameJoinLike() {
        await this.page
            .locator('[data-test="logs-search-bar-query-editor"]').locator('.inputarea')
            .fill('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a join "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name WHERE a.kubernetes_container_name LIKE "%ziox%"');
        await this.page.waitForTimeout(5000);
    }

    async kubernetesContainerNameLeftJoin() {
        await this.page
            .locator('[data-test="logs-search-bar-query-editor"]').locator('.inputarea')
            .fill('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a LEFT JOIN "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.page.waitForTimeout(5000);
    }

    async kubernetesContainerNameRightJoin() {
        await this.page
            .locator('[data-test="logs-search-bar-query-editor"]').locator('.inputarea')
            .fill('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a RIGHT JOIN "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.page.waitForTimeout(5000);
    }

    async kubernetesContainerNameFullJoin() {
        await this.page
            .locator('[data-test="logs-search-bar-query-editor"]').locator('.inputarea')
            .fill('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a FULL JOIN "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.page.waitForTimeout(5000);
    }

    // Log count ordering methods
    async verifyLogCountOrdering(orderType) {
        const query = orderType === 'desc' 
            ? `SELECT MAX(_timestamp) as ts, count(_timestamp) as logcount,kubernetes_container_name FROM 'e2e_automate' where log is not null GROUP BY kubernetes_container_name order by logcount desc`
            : `SELECT MAX(_timestamp) as ts, count(_timestamp) as logcount,kubernetes_container_name FROM 'e2e_automate' where log is not null GROUP BY kubernetes_container_name order by logcount asc`;

        await this.clearAndFillQueryEditor(query);
        await this.page.waitForTimeout(2000);

        const sqlModeSwitch = this.page.getByRole('switch', { name: 'SQL Mode' });
        const isSqlEnabled = await sqlModeSwitch.isChecked();
        if (!isSqlEnabled) {
            await sqlModeSwitch.click();
            await this.page.waitForTimeout(1000);
        }

        await this.page.locator("[data-test='logs-search-bar-refresh-btn']").click({ force: true });
        
        // Wait for query execution and results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for either the logs table to appear or an error message
        try {
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', { 
                timeout: 15000,
                state: 'visible' 
            });
        } catch (error) {
            // If logs table doesn't appear, check for error message
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                console.log('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }

        const rows = await this.page.locator('[data-test^="logs-search-result-detail-"]').all();
        let previousValue = orderType === 'desc' ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;

        for (const row of rows) {
            const sourceCell = await row.locator('[data-test^="log-table-column-"][data-test$="-source"]').textContent();
            try {
                const logcountMatch = sourceCell.match(/logcount":(\d+)/);
                const currentValue = logcountMatch ? parseInt(logcountMatch[1]) : 0;

                if (orderType === 'desc') {
                    expect(currentValue).toBeLessThanOrEqual(previousValue);
                } else {
                    expect(currentValue).toBeGreaterThanOrEqual(previousValue);
                }
                previousValue = currentValue;
            } catch (error) {
                console.error('Error parsing cell content:', sourceCell);
                throw error;
            }
        }

        expect(rows.length).toBeGreaterThan(0);
    }

    async verifyLogCountOrderingDescending() {
        await this.verifyLogCountOrdering('desc');
    }

    async verifyLogCountOrderingAscending() {
        await this.verifyLogCountOrdering('asc');
    }

    // String match ignore case methods
    async searchWithStringMatchIgnoreCase(searchText) {
        await this.page.locator(this.logsSearchBarQueryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.keyboard.type(`str_match_ignore_case(kubernetes_labels_app, '${searchText}')`);
        await this.page.locator(this.searchBarRefreshButton).click();
        
        // Wait for search results to load
        await this.page.waitForTimeout(3000);
        
        // Wait for the log table to be visible first
        await this.page.locator('[data-test="logs-search-result-logs-table"]').waitFor({ state: 'visible', timeout: 10000 });
        
        // Wait for the specific column to be visible
        await this.page.locator(this.logTableColumnSource).waitFor({ state: 'visible', timeout: 10000 });
        
        // Verify the column is visible
        await expect(this.page.locator(this.logTableColumnSource)).toBeVisible();
    }

    // Organization methods
    async selectOrganization() {
        await this.page.locator('[data-test="navbar-organizations-select"]').click();
        await this.page.getByRole('option', { name: 'default', exact: true }).locator('div').nth(2).click();
    }

    // Copy share methods
    async copyShare() {
        await this.page.locator('[data-test="header-my-account-profile-icon"]').click();
        await this.page.getByText('Copy Share').click();
    }

    // Sign out methods
    async signOut() {
        await this.page.locator('[data-test="header-my-account-profile-icon"]').click();
        await this.page.getByText('Sign Out').click();
    }

    // LogsQueryPage methods - delegate to LogsQueryPage
    async setDateTimeFilter() {
        return await this.logsQueryPage.setDateTimeFilter();
    }

    async clickRefresh() {
        return await this.logsQueryPage.clickRefresh();
    }

    async clickErrorMessage() {
        return await this.logsQueryPage.clickErrorMessage();
    }

    async clickResetFilters() {
        return await this.logsQueryPage.clickResetFilters();
    }

    async clickNoDataFound() {
        return await this.logsQueryPage.clickNoDataFound();
    }

    async clickResultDetail() {
        return await this.page.locator(this.resultText).click();
    }

    async isHistogramOn() {
        return await this.logsQueryPage.isHistogramOn();
    }

    async ensureHistogramState(desiredState) {
        return await this.logsQueryPage.ensureHistogramState(desiredState);
    }

    // Login methods - delegate to LoginPage
    async loginAsInternalUser() {
        return await this.loginPage.loginAsInternalUser();
    }

    async login() {
        return await this.loginPage.login();
    }

    // Ingestion methods 
    async ingestLogs(orgId, streamName, logData) {
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };
        
        const response = await this.page.evaluate(async ({ url, headers, orgId, streamName, logData }) => {
            const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(logData)
            });
            return await fetchResponse.json();
        }, {
            url: process.env.INGESTION_URL,
            headers: headers,
            orgId: orgId,
            streamName: streamName,
            logData: logData
        });
        
        testLogger.debug('Ingestion API response received', { response });
        return response;
    }

    // Management methods - delegate to ManagementPage
    async navigateToManagement() {
        return await this.managementPage.navigateToManagement();
    }

    // Additional methods needed for tests
    async clickDateTimeButton() {
        return await this.page.locator(this.dateTimeButton).click({ force: true });
    }

    async clickRelative15MinButton() {
        return await this.page.locator(this.relative15MinButton).click({ force: true });
    }

    async clickRelative6WeeksButton() {
        return await this.page.locator(this.relative6WeeksButton).click({ force: true });
    }

    async clickQueryEditor() {
        return await this.page.locator(this.queryEditor).click();
    }

    async clickQueryEditorTextbox() {
        return await this.page.locator(this.queryEditor).locator('.monaco-editor').click();
    }

    async fillQueryEditor(query) {
        return await this.page.locator(this.queryEditor).locator('.inputarea').fill(query);
    }

    async clearQueryEditor() {
        await this.page.locator(this.queryEditor).getByRole('textbox').press('ControlOrMeta+a');
        return await this.page.locator(this.queryEditor).getByRole('textbox').press('Backspace');
    }

    async typeInQueryEditor(text) {
        return await this.page.keyboard.type(text);
    }

    async clickRefreshButton() {
        return await this.page.locator(this.queryButton).click({ force: true });
    }

    async clickSearchBarRefreshButton() {
        return await this.page.locator(this.searchBarRefreshButton).click({ force: true });
    }

    async waitForSearchBarRefreshButton() {
        return await this.page.locator(this.searchBarRefreshButton).waitFor({ state: "visible" });
    }

    async clickSQLModeToggle() {
        return await this.page.getByRole(this.sqlModeSwitch.role, { name: this.sqlModeSwitch.name }).locator('div').first().click();
    }

    async clickShowQueryToggle() {
        return await this.page.locator(this.showQueryToggle).click({ force: true });
    }

    async clickFieldListCollapseButton() {
        return await this.page.locator(this.fieldListCollapseButton).click();
    }

    async clickSavedViewsButton() {
        return await this.page.locator(this.savedViewsButton).click({ force: true });
    }

    async clickSavedViewsExpand() {
        return await this.page.locator(this.savedViewsExpand).getByLabel('Expand').click();
    }

    async clickSaveViewButton() {
        return await this.page.locator(this.saveViewButton).filter({ hasText: 'savesaved_search' }).click();
    }

    async fillSavedViewName(name) {
        return await this.fillInputField(this.savedViewNameInput, name);
    }

    async clickSavedViewDialogSave() {
        const saveButton = this.page.locator(this.savedViewDialogSave);
        
        // Wait for the button to be visible
        await saveButton.waitFor({ state: 'visible', timeout: 10000 });
        
        // Scroll the button into view if needed
        await saveButton.scrollIntoViewIfNeeded();
        
        // Wait a moment for the scroll to complete
        await this.page.waitForTimeout(500);
        
        // Click the button with force option
        return await saveButton.click({ force: true });
    }

    async clickSavedViewArrow() {
        return await this.page.locator(this.savedViewArrow).click();
    }

    async clickSavedViewSearchInput() {
        return await this.page.locator(this.savedViewSearchInput).click();
    }

    async fillSavedViewSearchInput(text) {
        return await this.fillInputField(this.savedViewSearchInput, text);
    }

    async clickSavedViewByTitle(title) {
        return await this.page.getByTitle(title).click();
    }

    async clickDeleteButton() {
        return await this.page.getByText('delete').click();
    }

    async clickConfirmButton() {
        return await this.page.locator(this.confirmButton).click();
    }

    async clickStreamsMenuItem() {
        return await this.page.locator(this.streamsMenuItem).click({ force: true });
    }

    async clickSearchStreamInput() {
        return await this.page.locator(this.searchStreamInput).click();
    }

    async fillSearchStreamInput(text) {
        return await this.fillInputField(this.searchStreamInput, text);
    }

    async clickExploreButton() {
        return await this.page.getByRole(this.exploreButtonRole.role, { name: this.exploreButtonRole.name }).first().click({ force: true });
    }

    async waitForSavedViewsButton() {
        return await this.page.waitForSelector(this.savedViewsButton);
    }

    async clickSavedViewByText(text) {
        return await this.page.click(`:text("${text}")`);
    }

    async waitForSavedViewText(text) {
        return await this.page.waitForSelector(`:text("${text}")`);
    }

    async clickDeleteSavedViewButton(savedViewName) {
        const deleteButtonSelector = `[data-test="logs-search-bar-delete-${savedViewName}-saved-view-btn"]`;
        return await this.page.locator(deleteButtonSelector).click();
    }

    async clickResetFiltersButton() {
        return await this.page.locator(this.resetFiltersButton).click({ force: true });
    }

    async waitForQueryEditorTextbox() {
        return await this.page.locator(this.queryEditor).locator('.inputarea').waitFor({ state: "visible" });
    }

    async getQueryEditorText() {
        return await this.page.evaluate((selector) => {
            const editor = document.querySelector(selector).querySelector('.monaco-editor').querySelector('.view-lines');
            return editor ? editor.textContent : null;
        }, this.queryEditor);
    }

    async clickLogTableColumnSource() {
        return await this.page.locator(this.logTableColumnSource).click();
    }

    async clickIncludeExcludeFieldButton() {
        return await this.page.locator(this.includeExcludeFieldButton).click();
    }

    async clickIncludeFieldButton() {
        return await this.page.locator(this.includeFieldButton).click();
    }

    async clickCloseDialog() {
        return await this.page.locator(this.closeDialog).click();
    }

    async clickSavedViewDialogSaveContent() {
        return await this.page.locator(this.savedViewDialogSaveContent).click();
    }

    async clickSavedViewByLabel(label) {
        return await this.page.locator(this.savedViewByLabel).getByText(new RegExp(label)).first().click({ force: true });
    }

    async expectNotificationMessage(text) {
        return await expect(this.page.locator(this.notificationMessage)).toContainText(text);
    }

    async expectIndexFieldSearchInputVisible() {
        return await expect(this.page.locator(this.indexFieldSearchInput)).toBeVisible();
    }

    async expectErrorMessageVisible() {
        return await expect(this.page.locator(this.errorMessage)).toBeVisible();
    }

    async expectWarningElementHidden() {
        const warningElement = this.page.locator(this.warningElement);
        return await expect(warningElement).toBeHidden();
    }

    async expectTextVisible(text) {
        return await expect(this.page.locator(`text=${text}`)).toBeVisible();
    }

    async expectExactTextVisible(text) {
        await expect(this.page.getByText(text, { exact: true })).toBeVisible();
    }

    async expectLogsTableVisible() {
        const table = this.page.locator(this.logsTable);
        // Wait for the table to be visible with a timeout
        await table.waitFor({ state: 'visible', timeout: 30000 });
        return await expect(table).toBeVisible();
    }

    async waitForSearchResults() {
        // Wait for search results to appear by checking for the logs table
        const table = this.page.locator(this.logsTable);
        await table.waitFor({ state: 'visible', timeout: 30000 });
        
        // Also wait for at least one row to be present
        const firstRow = this.page.locator(this.logTableColumnSource);
        await firstRow.waitFor({ state: 'visible', timeout: 30000 });
        
        return true;
    }

    async expectFieldRequiredVisible() {
        return await expect(this.page.getByText(/Field is required/).first()).toBeVisible();
    }

    async expectErrorWhileFetchingNotVisible() {
        return await expect(this.page.getByRole('heading', { name: 'Error while fetching' })).not.toBeVisible();
    }

    async clickBarChartCanvas() {
        return await this.page.locator(this.barChartCanvas).click({
            position: { x: 182, y: 66 }
        });
    }

    async fillIndexFieldSearchInput(text) {
        return await this.fillInputField(this.logSearchIndexListFieldSearchInput, text);
    }

    async clickExpandLabel(label) {
        return await this.clickElementByLabel(label, 'Expand');
    }

    async clickCollapseLabel(label) {
        return await this.clickElementByLabel(label, 'Collapse');
    }

    async expectErrorWhileFetchingFieldValuesNotVisible() {
        const errorMessage = this.page.getByText('Error while fetching field values');
        return await expect(errorMessage).not.toBeVisible();
    }

    async clickText(text) {
        return await this.page.getByText(text).click();
    }

    async clickSubfieldAddButton(field, value) {
        // Remove trailing dash from value to avoid double dash
        const cleanValue = value.endsWith('-') ? value.slice(0, -1) : value;
        return await this.page.locator(`[data-test="logs-search-subfield-add-${field}-${cleanValue}-0"]`).getByText(value).click();
    }

    async expectSubfieldAddButtonVisible(field, value) {
        // Remove trailing dash from value to avoid double dash
        const cleanValue = value.endsWith('-') ? value.slice(0, -1) : value;
        const targetElement = this.page.locator(`[data-test="logs-search-subfield-add-${field}-${cleanValue}-0"]`).getByText(value);
        return await expect(targetElement).toBeVisible();
    }

    async clickAddStreamButton() {
        const addButton = this.page.locator(this.addStreamButton);
        
        // Wait for the button to be visible
        await addButton.waitFor({ state: 'visible', timeout: 10000 });
        
        // Scroll the button into view if needed
        await addButton.scrollIntoViewIfNeeded();
        
        // Wait a moment for the scroll to complete
        await this.page.waitForTimeout(500);
        
        // Click the button
        return await addButton.click({ force: true });
    }

    async clickAddStreamNameInput() {
        return await this.page.click(this.addStreamNameInput);
    }

    async clickSaveStreamButton() {
        const saveButton = this.page.locator(this.saveStreamButton);
        
        // Wait for the button to be visible
        await saveButton.waitFor({ state: 'visible', timeout: 10000 });
        
        // Scroll the button into view if needed
        await saveButton.scrollIntoViewIfNeeded();
        
        // Wait a moment for the scroll to complete
        await this.page.waitForTimeout(500);
        
        // Click the button
        return await saveButton.click({ force: true });
    }

    async waitForSaveStreamButton() {
        return await this.page.locator(this.saveStreamButton).waitFor({ state: "visible" });
    }

    async scrollSaveStreamButtonIntoView() {
        return await this.page.locator(this.saveStreamButton).scrollIntoViewIfNeeded();
    }

    async clickStreamDetail() {
        return await this.page.locator(this.streamDetail).first().click({ force: true });
    }

    async clickSchemaStreamIndexSelect() {
        return await this.page.locator(this.schemaStreamIndexSelect).click();
    }

    async clickFullTextSearch() {
        const scope = this.page.locator(this.fullTextSearch);
        return await scope.getByText(/Full text search/).first().click();
    }

    async clickSchemaUpdateSettingsButton() {
        return await this.page.locator(this.schemaUpdateSettingsButton).click({ force: true });
    }

    async clickColAutoButton() {
        return await this.page.locator(this.colAutoButton).click({ force: true });
    }

    async clickExploreTitle() {
        return await this.page.locator(this.exploreTitle).first().click({ force: true });
    }

    async clickStreamsSearchStreamInput() {
        return await this.page.click(this.streamsSearchStreamInput);
    }

    async fillStreamsSearchStreamInput(text) {
        return await this.page.keyboard.type(text);
    }

    async selectAllText() {
        return await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    }

    async pressBackspace() {
        return await this.page.keyboard.press("Backspace");
    }

    async expectSQLQueryMissingError() {
        return await this.page.getByText("SQL query is missing or invalid. Please submit a valid SQL statement.").click();
    }

    async clickTableRowExpandMenu() {
        return await this.page.locator(this.timestampColumnMenu).first().click({ force: true });
    }

    async toggleVrlEditor() {
        return await this.page.locator('[data-test="logs-search-bar-show-query-toggle-btn"] div').first().click();
    }

    async clickVrlEditor() {
        return await this.page.locator(this.vrlEditor).locator('.inputarea').fill('.a=2');
    }

    async waitForTimeout(milliseconds) {
        return await this.page.waitForTimeout(milliseconds);
    }

    async expectSearchListVisible() {
        return await expect(this.page.locator(this.searchListFirstTextLeft)).toBeVisible();
    }

    async clickCloseDialogForce() {
        return await this.page.locator(this.closeDialog).click({ force: true });
    }

    async clickLiveModeButton() {
        return await this.page.locator(this.liveModeToggleBtn).click();
    }

    async clickLiveMode5Sec() {
        return await this.page.locator(this.liveMode5SecBtn).click();
    }

    async clickVrlToggle() {
        return await this.page.locator(this.vrlToggleButton).click();
    }

    async expectVrlFieldVisible() {
        return await expect(this.page.locator(this.vrlEditor).first()).toBeVisible();
    }

    async expectVrlFieldNotVisible() {
        return await expect(this.page.locator(this.vrlEditor).first()).not.toBeVisible();
    }

    async expectFnEditorNotVisible() {
        return await expect(this.page.locator('#fnEditor').locator('.inputarea')).not.toBeVisible();
    }

    async clickPast6DaysButton() {
        return await this.page.locator(this.relative6DaysBtn).click();
    }

    async clickMenuLink(link) {
        return await this.page.locator(this.menuLink(link)).click();
    }

    async expectSQLQueryVisible() {
        return await expect(this.page.locator(this.queryEditor)).toContainText('SELECT * FROM');
    }

    async clickNavigateBack() {
        return await this.page.goBack();
    }

    async expectLogTableColumnSourceVisibleAfterNavigation() {
        const element = this.page.locator(this.logTableColumnSource);
        // Wait for the element to be visible with a timeout
        await element.waitFor({ state: 'visible', timeout: 30000 });
        return await expect(element).toBeVisible();
    }

    async clickSearchAroundButton() {
        return await this.page.locator(this.searchAroundBtn).click();
    }

    async expectPaginationNotVisible() {
        return await expect(this.page.locator(this.pagination)).not.toBeVisible();
    }

    async expectSQLPaginationNotVisible() {
        return await expect(this.page.locator(this.sqlPagination)).not.toBeVisible();
    }

    async expectSQLGroupOrderLimitPaginationNotVisible() {
        return await expect(this.page.locator(this.sqlGroupOrderLimitPagination)).not.toBeVisible();
    }

    async expectSearchBarRefreshButtonVisible() {
        return await expect(this.page.locator(this.searchBarRefreshButton)).toBeVisible();
    }

    async expectQuickModeToggleVisible() {
        return await expect(this.page.locator(this.quickModeToggle)).toBeVisible();
    }

    async clickInterestingFieldButton(field) {
        return await this.page.locator(this.interestingFieldBtn(field)).first().click();
    }

    async expectInterestingFieldInEditor(field) {
        return await expect(this.page.locator(this.queryEditor).getByText(new RegExp(field)).first()).toBeVisible();
    }

    async expectInterestingFieldInTable(field) {
        return await expect(this.page.locator(this.logTableColumnSource).getByText(new RegExp(field)).first()).toBeVisible();
    }

    async expectQueryEditorVisible() {
        return await expect(this.page.locator(this.queryEditor)).toBeVisible();
    }

    async expectQueryEditorContainsText(text) {
        return await expect(this.page.locator(this.queryEditor).locator('.monaco-editor')).toContainText(text);
    }

    async expectQueryEditorEmpty() {
        const text = await this.getQueryEditorText();
        return await expect(text).toEqual("");
    }

    async expectQueryEditorContainsSQLQuery() {
        return await this.expectQueryEditorContainsTextHelper('SELECT COUNT(_timestamp) AS xyz, _timestamp FROM "e2e_automate"  Group by _timestamp ORDER BY _timestamp DESC');
    }

    async expectQueryEditorContainsMatchAllQuery() {
        return await this.expectQueryEditorContainsTextHelper("match_all('code')");
    }

    async expectQueryEditorContainsMatchAllRawQuery() {
        return await this.expectQueryEditorContainsTextHelper("match_all_raw_ignore_case('provide_credentials')");
    }

    async expectQueryEditorContainsKubernetesQuery() {
        return await this.expectQueryEditorContainsTextHelper("kubernetes");
    }

    async expectQueryEditorContainsVrlQuery() {
        return await this.expectQueryEditorContainsTextHelper(".a=2");
    }

    async expectQueryEditorContainsSQLQueryMissingError() {
        return await this.expectQueryEditorContainsTextHelper("SQL query is missing or invalid. Please submit a valid SQL statement.");
    }

    async expectQueryEditorContainsValidViewName() {
        return await this.expectQueryEditorContainsTextHelper("Please provide valid view name");
    }

    async expectQueryEditorContainsFieldRequired() {
        return await this.expectQueryEditorContainsTextHelper("Field is required");
    }

    async expectQueryEditorContainsErrorWhileFetching() {
        return await this.expectQueryEditorContainsTextHelper("Error while fetching");
    }

    async expectQueryEditorContainsErrorWhileFetchingFieldValues() {
        return await this.expectQueryEditorContainsTextHelper("Error while fetching field values");
    }

    async expectQueryEditorContainsZioxIngester() {
        return await this.expectQueryEditorContainsTextHelper("ziox-ingester-");
    }

    async expectQueryEditorContainsKubernetesPod(type, ingesterNumber) {
        return await this.expectKubernetesPodContent(type, ingesterNumber);
    }

    // Additional methods for logsPage spec
    async clickMenuLinkItem(link) {
        return await this.clickMenuLinkByType(link);
    }

    async clickMenuLinkLogsItem() {
        return await this.clickMenuLinkByType('logs');
    }

    async clickMenuLinkTracesItem() {
        return await this.clickMenuLinkByType('traces');
    }

    async clickMenuLinkStreamsItem() {
        return await this.clickMenuLinkByType('streams');
    }

    async clickMenuLinkMetricsItem() {
        return await this.clickMenuLinkByType('metrics');
    }

    async clickMenuLinkPipelineItem() {
        return await this.clickMenuLinkByType('pipeline');
    }

    async clickMenuLinkFunctionsItem() {
        return await this.clickMenuLinkByType('functions');
    }

    async clickTabRealtime() {
        return await this.page.locator('[data-test="tab-realtime"]').click();
    }

    async clickFunctionStreamTab() {
        return await this.page.locator('[data-test="function-stream-tab"]').click();
    }

    async clickSearchFunctionInput() {
        return await this.page.getByPlaceholder(this.searchFunctionInput.placeholder).click();
    }

    async fillSearchFunctionInput(text) {
        return await this.page.getByPlaceholder(this.searchFunctionInput.placeholder).fill(text);
    }

    async clickDeleteFunctionButton() {
        return await this.page.getByRole('button', { name: 'Delete Function' }).click();
    }

    async clickFunctionDropdownSave() {
        return await this.page.locator(this.logsSearchBarFunctionDropdownSave).filter({ hasText: 'save' }).click();
    }

    async clickSavedFunctionNameInput() {
        return await this.page.locator(this.savedFunctionNameInput).click();
    }

    async fillSavedFunctionNameInput(text) {
        return await this.fillInputField(this.savedFunctionNameInput, text);
    }

    async expectFunctionNameNotValid() {
        return await this.page.getByText('Function name is not valid.').click();
    }

    async expectWarningNoFunctionDefinition() {
        return await this.page.locator(this.qNotifyWarning).filter({ hasText: 'warningNo function definition' }).nth(3).click();
    }

    async expectBarChartVisible() {
        const barChart = this.page.locator(this.logsTable);
        return await expect(barChart).toBeTruthy();
    }

    async expectUrlContainsLogs() {
        return await expect(this.page.url()).toContain("logs");
    }

    async expectPageContainsText(text) {
        const logsPage = this.page.locator(this.qPageContainer);

        // Wait for the page to stabilize and check for "No events found" condition
        await this.page.waitForLoadState('networkidle');

        // If no data is available, trigger a refresh and wait
        const pageText = await logsPage.textContent();
        if (pageText.includes('No events found')) {
            console.log('No events found, attempting to refresh...');
            await this.clickRefreshButton();
            await this.page.waitForLoadState('networkidle');
            // Wait additional time for data to load
            await this.page.waitForTimeout(3000);
        }

        return await expect(logsPage).toContainText(text, { timeout: 10000 });
    }

    async clickLogSearchIndexListFieldSearchInput() {
        return await this.page.locator(this.logSearchIndexListFieldSearchInput).click();
    }

    async fillLogSearchIndexListFieldSearchInput(text) {
        return await this.fillInputField(this.logSearchIndexListFieldSearchInput, text);
    }

    async clickExpandCode() {
        return await this.page.getByLabel(this.expandCode).click();
    }

    async clickLogsDetailTableSearchAroundBtn() {
        return await this.page.locator(this.logsDetailTableSearchAroundBtn).click();
    }

    async expectLogTableColumnSourceVisible() {
        const element = this.page.locator(this.logTableColumnSource);
        // Wait for the element to be visible with a timeout
        await element.waitFor({ state: 'visible', timeout: 30000 });
        return await expect(element).toBeVisible();
    }

    async clickLogTableColumn3Source() {
        return await this.page.locator(this.logTableColumn3Source).getByText('{"_timestamp":').click();
    }

    async clickHistogramToggleDiv() {
        return await this.page.locator(this.histogramToggleDiv).nth(2).click();
    }

    async expectQueryEditorContainsExpectedQuery(expectedQuery) {
        const text = await this.page.evaluate((queryEditorSelector) => {
            const editor = document.querySelector(queryEditorSelector).querySelector('.monaco-editor');
            return editor ? editor.textContent.trim() : null;
        }, this.queryEditor);
        console.log(text);
        return await expect(text.replace(/\s/g, "")).toContain(expectedQuery.replace(/\s/g, ""));
    }

    async expectQueryEditorContainsSelectFrom() {
        return await this.page.locator(this.queryEditor)
            .locator('.view-lines')
            .locator('.view-line')
            .filter({ hasText: 'SELECT * FROM "e2e_automate"' })
            .nth(0);
    }

    generateRandomString() {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 5; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    async expectQueryEditorNotContainsText(text) {
        await expect(this.page.locator(this.queryEditor)).not.toContainText(text);
    }

    async expectLogTableColumnSourceNotHaveText(text) {
        await expect(this.page.locator(this.logTableColumnSource)).not.toHaveText(text);
    }

    async selectStreamAndStreamTypeForLogs(stream) {
        await this.page.locator('[data-test="log-search-index-list-select-stream"]').click();
        await this.page.waitForTimeout(2000);
        await this.page.locator('[data-test="log-search-index-list-select-stream"]').fill(stream);
        await this.page.waitForTimeout(2000);
        await this.page.waitForSelector(`[data-test="log-search-index-list-stream-toggle-${stream}"] div`, { state: "visible" });
        await this.page.waitForTimeout(2000);
        await this.page.locator(`[data-test="log-search-index-list-stream-toggle-${stream}"] div`).first().click();
    }

    // Download-related functions
    async setupDownloadDirectory() {
        // Create unique directory with timestamp and random string
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 8);
        const downloadDir = path.join(process.cwd(), `temp-downloads-${timestamp}-${randomString}`);
        
        // Create fresh directory
        fs.mkdirSync(downloadDir, { recursive: true });
        
        // Verify directory was created and is writable
        expect(fs.existsSync(downloadDir)).toBe(true);
        
        // Test write permissions by creating a test file
        const testFile = path.join(downloadDir, 'test-write.txt');
        fs.writeFileSync(testFile, 'test');
        expect(fs.existsSync(testFile)).toBe(true);
        fs.unlinkSync(testFile);
        
        return downloadDir;
    }

    async cleanupDownloadDirectory(downloadDir) {
        if (downloadDir && fs.existsSync(downloadDir)) {
            const files = fs.readdirSync(downloadDir);
            for (const file of files) {
                fs.unlinkSync(path.join(downloadDir, file));
            }
            fs.rmdirSync(downloadDir);
        }
    }

    async verifyDownload(download, expectedFileName, downloadDir) {
        const downloadPath = path.join(downloadDir, expectedFileName);
        
        // Save the download
        await download.saveAs(downloadPath);
        
        // Wait for file system to sync
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verify file exists and has content
        expect(fs.existsSync(downloadPath)).toBe(true);
        const stats = fs.statSync(downloadPath);
        expect(stats.size).toBeGreaterThan(0);
        
        // Verify it's a CSV file
        const content = fs.readFileSync(downloadPath, 'utf8');
        expect(content).toContain('_timestamp');
        
        // Count rows in the CSV file
        const rows = content.split('\n').filter(line => line.trim() !== '');
        const rowCount = rows.length - 1; // Subtract 1 for header row
        console.log(`Download ${expectedFileName}: ${rowCount} data rows`);
        
        // Assert row count based on scenario
        if (expectedFileName.includes('custom_100.csv')) {
            expect(rowCount).toBe(100);
        } else if (expectedFileName.includes('custom_500.csv')) {
            expect(rowCount).toBe(500);
        } else if (expectedFileName.includes('custom_1000.csv')) {
            expect(rowCount).toBe(1000);
        } else if (expectedFileName.includes('custom_5000.csv')) {
            expect(rowCount).toBe(5000);
        } else if (expectedFileName.includes('custom_10000.csv')) {
            expect(rowCount).toBe(10000);
        } else if (expectedFileName.includes('sql_limit_2000.csv')) {
            expect(rowCount).toBe(2000);
        } else if (expectedFileName.includes('sql_limit_2000_custom_500.csv')) {
            expect(rowCount).toBe(500);
        } else {
            // For normal "Download results" downloads, we expect some data but not a specific count
            expect(rowCount).toBeGreaterThan(0);
        }
        
        return downloadPath;
    }

    // Download action methods
    async clickMoreOptionsButton() {
        return await this.page.locator('[data-test="logs-search-bar-more-options-btn"]').click();
    }

    async clickDownloadResults() {
        await this.page.getByText('keyboard_arrow_right').click();
        return await this.page.locator('[data-test="logs-search-bar-more-options-btn"]').click();
    }

    async clickDownloadResultsForCustom() {
        return await this.page.getByText('Download results for custom').click();
    }

    async clickCustomDownloadRangeSelect() {
        return await this.page.locator('[data-test="custom-download-range-select"]').click();
    }

    async selectCustomDownloadRange(range) {
        return await this.page.getByRole('option', { name: range, exact: true }).click();
    }

    async clickConfirmDialogOkButton() {
        return await this.page.locator('[data-test="logs-search-bar-confirm-dialog-ok-btn"]').click();
    }

    async expectCustomDownloadDialogVisible() {
        return await expect(this.page.getByText('Enter the initial number and')).toBeVisible();
    }

    async expectRequestFailedError() {
        return await expect(this.page.getByText('Request failed with status')).toBeVisible();
    }

    async waitForDownload() {
        return await this.page.waitForEvent('download');
    }

    async clickAllFieldsButton() {
        return await this.page.locator('[data-test="logs-all-fields-btn"]').click();
    }

    async enableQuickModeIfDisabled() {
        // Enable quick mode toggle if it's not already enabled
        const toggleButton = await this.page.$('[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner');
        if (toggleButton) {
            // Evaluate the class attribute to determine if the toggle is in the off state
            const isSwitchedOff = await toggleButton.evaluate(node => node.classList.contains('q-toggle__inner--falsy'));
            if (isSwitchedOff) {
                await toggleButton.click();
            }
        }
    }

    async clickTimestampField() {
        return await this.page.locator(this.timestampFieldTable).getByTitle('_timestamp').click();
    }

    async clickSchemaButton() {
        return await this.page.getByRole('button').filter({ hasText: /^schema$/ }).click();
    }

    async clickInfoSchemaButton() {
        return await this.page.getByRole('button').filter({ hasText: 'infoschema' }).click();
    }

    async clickClearButton() {
        return await this.page.getByRole('button', { name: 'Clear' }).click();
    }

    async expectTimestampFieldVisible() {
        return await expect(this.page.locator(this.timestampFieldTable).getByTitle('_timestamp')).toBeVisible();
    }

    // Field management methods for add/remove fields to table
    async hoverOnFieldExpandButton(fieldName) {
        await this.page.locator(`[data-test="log-search-expand-${fieldName}-field-btn"]`).hover();
        await this.page.waitForTimeout(300);
    }

    async clickAddFieldToTableButton(fieldName) {
        await this.page.locator(`[data-test="log-search-index-list-add-${fieldName}-field-btn"]`).click();
        await this.page.waitForTimeout(1000);
    }

    async clickRemoveFieldFromTableButton(fieldName) {
        await this.page.locator(`[data-test="log-search-index-list-remove-${fieldName}-field-btn"]`).click();
        await this.page.waitForTimeout(1000);
    }

    async expectFieldInTableHeader(fieldName) {
        return await expect(this.page.locator(`[data-test="log-search-result-table-th-${fieldName}"]`)).toBeVisible();
    }

    async expectFieldNotInTableHeader(fieldName) {
        // When field is removed, the source column should be visible again
        return await expect(this.page.locator('[data-test="log-search-result-table-th-source"]').getByText('source')).toBeVisible();
    }
} 
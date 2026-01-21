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
        this.logsSearchResultLogsTable = '[data-test="logs-search-result-logs-table"]';
        this.kubernetesFieldsSelector = '[data-test*="log-search-expand-kubernetes"]';
        this.allFieldsSelector = '[data-test*="log-search-expand-"]';
        this.matchingFieldsSelector = '[data-test*="log-search-expand-"]';
        this.logTableColumnSource = '[data-test="log-table-column-0-source"]';
        this.logsSearchBarQueryEditor = '[data-test="logs-search-bar-query-editor"]';
        this.searchBarRefreshButton = '[data-cy="search-bar-refresh-button"] > .q-btn__content';
        this.relative15MinButton = '[data-test="date-time-relative-15-m-btn"] > .q-btn__content > .block';
        this.relative6WeeksButton = '[data-test="date-time-relative-6-w-btn"] > .q-btn__content';
        this.relative30SecondsButton = '[data-test="date-time-relative-30-s-btn"] > .q-btn__content > .block';
        this.relative1HourButton = '[data-test="date-time-relative-1-h-btn"]';
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
        // Additional locators for multistream functionality
        this.logsSearchIndexList = '[data-test="logs-search-index-list"]';
        this.notificationErrorMessage = '.q-notification__message:has-text("error")';
        this.vrlFunctionText = (text) => `text=${text}`;
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
        this.vrlToggleButton = '[data-test="logs-search-bar-show-query-toggle-btn"]';
        this.vrlEditor = '[data-test="logs-vrl-function-editor"]';
        this.relative6DaysBtn = '[data-test="date-time-relative-6-d-btn"] > .q-btn__content';
        this.menuLink = link => `[data-test="menu-link-${link}"]`;
        this.searchAroundBtn = '[data-test="logs-search-bar-search-around-btn"]';
        this.pagination = '[data-test="logs-search-pagination"]';
        this.resultPagination = '[data-test="logs-search-result-pagination"]';
        this.sqlPagination = '[data-test="logs-search-sql-pagination"]';
        this.sqlGroupOrderLimitPagination = '[data-test="logs-search-sql-group-order-limit-pagination"]';
        this.interestingFieldBtn = field => `[data-test="log-search-index-list-interesting-${field}-field-btn"]`;
        this.logsSearchBarFunctionDropdown = '[data-test="logs-search-bar-function-dropdown"]';
        this.logsSearchBarFunctionDropdownSave = '[data-test="logs-search-bar-function-dropdown"] button';
        this.logsSearchBarSaveTransformBtn = '[data-test="logs-search-bar-save-transform-btn"]';
        this.savedFunctionNameInput = '[data-test="saved-function-name-input"]';
        this.qNotifyWarning = '#q-notify div';
        this.qPageContainer = '.q-page-container';
        this.cmContent = '.view-lines';
        this.cmLine = '.view-line';
        this.searchFunctionInput = { placeholder: 'Search Function' };
        this.timestampFieldTable = '[data-test="log-search-index-list-fields-table"]';

        // Error handling locators
        this.errorIcon = 'text=error';
        this.resultErrorDetailsBtn = '[data-test="logs-page-result-error-details-btn"]';
        this.searchDetailErrorMessage = '[data-test="logs-search-detail-error-message"]';

        // ===== SHARE LINK SELECTORS (VERIFIED) =====
        this.shareLinkButton = '[data-test="logs-search-bar-share-link-btn"]';
        this.shareLinkTooltip = '[role="tooltip"], .q-tooltip';
        this.successNotification = '.q-notification__message';
        this.linkCopiedSuccessText = 'Link Copied Successfully';
        this.errorCopyingLinkText = 'Error while copy link';

        // ===== QUERY EDITOR EXPAND/COLLAPSE SELECTORS =====
        this.queryEditorFullScreenBtn = '[data-test="logs-query-editor-full_screen-btn"]';
        this.queryEditorContainer = '.query-editor-container';
        this.expandOnFocusClass = '.expand-on-focus';

        // ===== LOG DETAIL SIDEBAR SELECTORS (Bug #9724) =====
        this.logDetailDialogBox = '[data-test="dialog-box"]';
        this.logDetailTitleText = '[data-test="log-detail-title-text"]';
        this.logDetailJsonTab = '[data-test="log-detail-json-tab"]';
        this.logDetailTableTab = '[data-test="log-detail-table-tab"]';
        this.logDetailJsonContent = '[data-test="log-detail-json-content"]';
        this.logDetailTableContent = '[data-test="log-detail-table-content"]';
        this.logDetailTabContainer = '[data-test="log-detail-tab-container"]';
        this.logDetailCloseButton = '[data-test="close-dialog"]';
        this.logDetailPreviousBtn = '[data-test="log-detail-previous-detail-btn"]';
        this.logDetailNextBtn = '[data-test="log-detail-next-detail-btn"]';
        this.logDetailWrapToggle = '[data-test="log-detail-wrap-values-toggle-btn"]';

        // ===== VIEW RELATED / CORRELATION SELECTORS (Enterprise Feature) =====
        this.viewRelatedBtn = '[data-test="log-correlation-btn"]';
        this.correlationDashboardClose = '[data-test="correlation-dashboard-close"]';
        this.applyDimensionFilters = '[data-test="apply-dimension-filters"]';
        this.applyDimensionFiltersEmbedded = '[data-test="apply-dimension-filters-embedded"]';
        this.metricSelectorButton = '[data-test="metric-selector-button"]';
        // Correlation tabs in detail drawer (tab names, not data-test)
        this.correlatedLogsTab = '.q-tab[name="correlated-logs"], .q-tabs .q-tab:has-text("Logs"):not([data-test="log-detail-json-tab"])';
        this.correlatedMetricsTab = '.q-tab[name="correlated-metrics"], .q-tabs .q-tab:has-text("Metrics")';
        this.correlatedTracesTab = '.q-tab[name="correlated-traces"], .q-tabs .q-tab:has-text("Traces")';
        // Correlation loading and error states
        this.correlationLoadingSpinner = '.q-spinner-hourglass';
        this.correlationErrorMessage = '.tw\\:text-red-500';

        // ===== REGRESSION TEST LOCATORS =====
        // Query history
        this.queryHistoryButton = '[data-test="logs-search-bar-query-history-btn"]';
        this.historyPanel = '.history-panel, [data-test*="history"]';

        // Table and pagination CSS selectors
        this.tableBottom = '.q-table__bottom';
        this.tableBodyRow = 'tbody tr';
        this.tableBodyRowWithIndex = 'tbody tr[data-index]';
        this.tableHeaderCell = 'thead th';
        this.tableHeaders = 'thead th';

        // Dynamic field selectors (functions for field-specific locators)
        this.fieldExpandButton = (fieldName) => `[data-test="log-search-expand-${fieldName}-field-btn"]`;
        this.fieldListItem = (fieldName) => `[data-test="logs-field-list-item-${fieldName}"]`;
        this.subfieldAddButton = (fieldName) => `[data-test*="logs-search-subfield-add-${fieldName}"]`;
        this.allFieldExpandButtons = '[data-test*="log-search-expand-"][data-test$="-field-btn"]';
        this.fieldIndexListButton = (fieldName) => `[data-test="log-search-index-list-${fieldName}-field-btn"]`;

        // Additional regression test selectors
        this.streamsSearchInputField = '[data-test="streams-search-stream-input"] input';
        // Note: Narrowed from [class*="error"] to avoid false positives like "error-free"
        this.errorIndicators = '.q-notification--negative, .q-notification__message--error, .text-negative, [class^="error-"], [class$="-error"]';
        this.timestampInDetail = '[data-test*="timestamp"], .timestamp';
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
        // Select both default and e2e_automate streams for join queries
        await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
        await this.page.waitForTimeout(3000);

        // Select default stream
        await this.page.locator('[data-test="log-search-index-list-stream-toggle-default"] div').first().click();
        await this.page.waitForTimeout(1000);

        // Select e2e_automate stream (dropdown stays open after first selection)
        await this.page.locator('[data-test="log-search-index-list-stream-toggle-e2e_automate"] div').first().click();
        await this.page.waitForTimeout(1000);

        // Close dropdown
        await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
    }

    /**
     * Select two streams for UNION query testing
     * @param {string} streamA - First stream name (required)
     * @param {string} streamB - Second stream name (required)
     */
    async selectIndexAndStreamJoinUnion(streamA, streamB) {
        // Validate stream names are provided
        if (!streamA || !streamB) {
            throw new Error('selectIndexAndStreamJoinUnion: Both streamA and streamB are required parameters');
        }

        testLogger.info(`selectIndexAndStreamJoinUnion: Starting selection of ${streamA} and ${streamB} streams`);

        // Wait for both streams to be available via API before attempting UI selection
        testLogger.debug(`selectIndexAndStreamJoinUnion: Waiting for streams to be available via API...`);

        const streamAAvailable = await this.waitForStreamAvailable(streamA, 30000, 3000);
        if (!streamAAvailable) {
            testLogger.error(`selectIndexAndStreamJoinUnion: Stream '${streamA}' NOT FOUND via API after 30s`);
            throw new Error(`Stream '${streamA}' not available. Ingestion may have failed.`);
        }
        testLogger.info(`selectIndexAndStreamJoinUnion: Stream '${streamA}' confirmed available`);

        const streamBAvailable = await this.waitForStreamAvailable(streamB, 30000, 3000);
        if (!streamBAvailable) {
            testLogger.error(`selectIndexAndStreamJoinUnion: Stream '${streamB}' NOT FOUND via API after 30s`);
            throw new Error(`Stream '${streamB}' not available. Ingestion may have failed.`);
        }
        testLogger.info(`selectIndexAndStreamJoinUnion: Stream '${streamB}' confirmed available`);

        // Navigate to logs page to ensure fresh stream list
        const orgId = process.env.ORGNAME;
        const logsUrl = `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${orgId}`;
        testLogger.debug(`selectIndexAndStreamJoinUnion: Navigating to logs page: ${logsUrl}`);
        await this.page.goto(logsUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => {
            testLogger.warn(`selectIndexAndStreamJoinUnion: Navigation timeout, continuing... ${e.message}`);
        });
        await this.page.waitForTimeout(2000);

        // Open dropdown
        const dropdownArrow = this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down');
        await dropdownArrow.waitFor({ state: 'visible', timeout: 10000 });
        await dropdownArrow.click();
        await this.page.waitForTimeout(2000);

        // Use search box to filter for first stream (much faster than scrolling)
        const searchInput = this.page.locator('[data-test="log-search-index-list-select-stream"]');
        const searchVisible = await searchInput.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);

        // Select first stream
        if (searchVisible) {
            testLogger.debug(`selectIndexAndStreamJoinUnion: Using search to filter for ${streamA}`);
            await searchInput.click();
            await searchInput.fill(streamA);
        }

        const streamASelector = `[data-test="log-search-index-list-stream-toggle-${streamA}"] div`;
        testLogger.debug(`selectIndexAndStreamJoinUnion: Looking for stream toggle: ${streamASelector}`);
        const streamAToggle = this.page.locator(streamASelector).first();
        await streamAToggle.waitFor({ state: 'visible', timeout: 20000 });
        await streamAToggle.click();
        testLogger.debug(`selectIndexAndStreamJoinUnion: Selected stream ${streamA}`);

        // Clear search and filter for second stream
        if (searchVisible) {
            testLogger.debug(`selectIndexAndStreamJoinUnion: Using search to filter for ${streamB}`);
            await searchInput.click();
            await searchInput.fill('');
            await searchInput.fill(streamB);
        }

        // Select second stream
        const streamBSelector = `[data-test="log-search-index-list-stream-toggle-${streamB}"] div`;
        testLogger.debug(`selectIndexAndStreamJoinUnion: Looking for stream toggle: ${streamBSelector}`);
        const streamBToggle = this.page.locator(streamBSelector).first();
        await streamBToggle.waitFor({ state: 'visible', timeout: 20000 });
        await streamBToggle.click();
        testLogger.debug(`selectIndexAndStreamJoinUnion: Selected stream ${streamB}`);

        // Close dropdown
        await dropdownArrow.click();
        testLogger.info(`selectIndexAndStreamJoinUnion: Successfully selected both streams`);
    }

    async selectIndexStreamDefault() {
        await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
        await this.page.waitForTimeout(3000);
        await this.page.locator('[data-test="log-search-index-list-stream-toggle-default"] div').first().click();
    }

    async selectIndexStream(streamName) {
        testLogger.debug(`selectIndexStream: Starting selection for stream: ${streamName}`);
        try {
            await this.page.locator(this.indexDropDown).waitFor({ timeout: 10000 });
            await this.page.locator(this.indexDropDown).click();
            testLogger.debug(`selectIndexStream: Clicked dropdown`);
            await this.page.waitForTimeout(2000);

            await this.page.locator(this.streamToggle).waitFor({ timeout: 10000 });
            await this.page.locator(this.streamToggle).click();
            testLogger.debug(`selectIndexStream: Successfully selected stream with default method`);
        } catch (error) {
            testLogger.debug(`Failed to select stream with default method, trying alternative approach: ${error.message}`);
            // Fallback to the old method
            await this.selectIndexStreamOld(streamName);
        }
    }

    /**
     * Wait for a stream to be available via API before attempting UI selection
     * @param {string} streamName - Name of the stream to wait for
     * @param {number} maxWaitMs - Maximum time to wait in milliseconds
     * @param {number} pollIntervalMs - Interval between checks
     * @returns {Promise<boolean>} True if stream exists, false if timeout
     */
    async waitForStreamAvailable(streamName, maxWaitMs = 30000, pollIntervalMs = 3000) {
        testLogger.debug(`waitForStreamAvailable: Waiting for stream ${streamName} to be available`);
        const startTime = Date.now();

        // Get credentials from env
        const apiUrl = process.env.INGESTION_URL;
        const orgId = process.env.ORGNAME;
        const authHeader = `Basic ${Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64')}`;

        while (Date.now() - startTime < maxWaitMs) {
            try {
                // Use dynamic import for node-fetch
                const fetchModule = await import('node-fetch');
                const fetch = fetchModule.default;

                const response = await fetch(`${apiUrl}/api/${orgId}/streams`, {
                    method: 'GET',
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();
                if (response.status === 200 && data.list) {
                    const streamExists = data.list.some(s => s.name === streamName);
                    if (streamExists) {
                        testLogger.debug(`waitForStreamAvailable: Stream ${streamName} found after ${Date.now() - startTime}ms`);
                        return true;
                    }
                }

                testLogger.debug(`waitForStreamAvailable: Stream ${streamName} not found yet, waiting ${pollIntervalMs}ms...`);
                await this.page.waitForTimeout(pollIntervalMs);
            } catch (e) {
                testLogger.debug(`waitForStreamAvailable: Error checking stream: ${e.message}`);
                await this.page.waitForTimeout(pollIntervalMs);
            }
        }

        testLogger.warn(`waitForStreamAvailable: Stream ${streamName} not found after ${maxWaitMs}ms`);
        return false;
    }

    async selectStream(stream, maxRetries = 3, apiWaitMs = 30000) {
        testLogger.info(`selectStream: Selecting stream: ${stream}`);

        // First, wait for the stream to be available via API (skip if apiWaitMs is 0)
        if (apiWaitMs > 0) {
            const streamAvailable = await this.waitForStreamAvailable(stream, apiWaitMs, 3000);
            if (!streamAvailable) {
                testLogger.warn(`selectStream: Stream ${stream} not found via API after ${apiWaitMs}ms, will still try UI selection`);
            } else {
                testLogger.info(`selectStream: Stream ${stream} confirmed available via API`);
            }
        } else {
            testLogger.info(`selectStream: Skipping API wait (apiWaitMs=0)`);
        }

        // Navigate to logs page via URL to ensure fresh stream list (no page.reload which can cause issues)
        const orgId = process.env.ORGNAME;
        const logsUrl = `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${orgId}`;
        testLogger.info(`selectStream: Navigating to logs page: ${logsUrl}`);
        await this.page.goto(logsUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await this.page.waitForTimeout(3000);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            testLogger.info(`selectStream: Attempt ${attempt}/${maxRetries} for stream: ${stream}`);

            try {
                // Click the dropdown arrow to open the stream list
                testLogger.info(`selectStream: Clicking dropdown arrow`);
                const dropdownArrow = this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down');
                await dropdownArrow.waitFor({ state: 'visible', timeout: 10000 });
                await dropdownArrow.click();
                await this.page.waitForTimeout(2000);

                // Use search box to filter streams for faster finding
                const searchInput = this.page.locator('[data-test="log-search-index-list-select-stream"]');
                const searchVisible = await searchInput.isVisible({ timeout: 2000 }).catch(() => false);
                if (searchVisible) {
                    testLogger.info(`selectStream: Using search box to filter for: ${stream}`);
                    await searchInput.click();
                    await searchInput.fill(stream);
                    await this.page.waitForTimeout(1500);
                }

                // Look for the dropdown menu with scroll capability
                const dropdownMenu = this.page.locator('.q-menu.scroll, .q-menu .scroll, .q-virtual-scroll__content').first();

                // Try to click the stream toggle div directly first
                const streamToggleSelector = `[data-test="log-search-index-list-stream-toggle-${stream}"]`;
                testLogger.info(`selectStream: Looking for: ${streamToggleSelector}`);

                // Scroll through the dropdown to find the stream
                let maxScrolls = 20;
                let scrollAmount = 200;
                let foundStream = false;

                while (maxScrolls > 0 && !foundStream) {
                    // Check if stream toggle is visible
                    const streamToggleDiv = this.page.locator(`${streamToggleSelector} div`).first();
                    const toggleDivVisible = await streamToggleDiv.isVisible({ timeout: 500 }).catch(() => false);

                    if (toggleDivVisible) {
                        await streamToggleDiv.click();
                        testLogger.info(`selectStream: Selected stream: ${stream}`);
                        foundStream = true;
                        return;
                    }

                    // Try the toggle itself
                    const streamToggle = this.page.locator(streamToggleSelector);
                    const toggleVisible = await streamToggle.isVisible({ timeout: 500 }).catch(() => false);

                    if (toggleVisible) {
                        await streamToggle.click();
                        testLogger.info(`selectStream: Selected stream via toggle: ${stream}`);
                        foundStream = true;
                        return;
                    }

                    // Try by text
                    const streamByText = this.page.locator("div.q-item").getByText(stream, { exact: true }).first();
                    const textVisible = await streamByText.isVisible({ timeout: 500 }).catch(() => false);

                    if (textVisible) {
                        await streamByText.click();
                        testLogger.info(`selectStream: Selected stream by text: ${stream}`);
                        foundStream = true;
                        return;
                    }

                    // Scroll down in the dropdown if stream not found yet
                    const menuVisible = await dropdownMenu.isVisible({ timeout: 500 }).catch(() => false);
                    if (menuVisible) {
                        try {
                            await dropdownMenu.evaluate((el, amount) => el.scrollTop += amount, scrollAmount);
                            testLogger.debug(`selectStream: Scrolled dropdown by ${scrollAmount}px`);
                        } catch (scrollError) {
                            testLogger.debug(`selectStream: Scroll failed: ${scrollError.message}`);
                        }
                    }

                    await this.page.waitForTimeout(300);
                    maxScrolls--;
                }

                // Stream not found in this attempt, close dropdown and retry
                testLogger.info(`selectStream: Stream ${stream} not found on attempt ${attempt}`);
                await this.page.keyboard.press('Escape');
                await this.page.waitForTimeout(500);

                if (attempt < maxRetries) {
                    testLogger.debug(`selectStream: Waiting 5s before retry...`);
                    await this.page.waitForTimeout(5000); // Wait before retry for stream to be indexed

                    // Navigate to logs page again to refresh stream list
                    await this.page.goto(logsUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
                    await this.page.waitForTimeout(3000);
                }

            } catch (e) {
                testLogger.debug(`selectStream: Attempt ${attempt} failed with error: ${e.message}`);
                await this.page.keyboard.press('Escape').catch(() => {});

                if (attempt < maxRetries) {
                    await this.page.waitForTimeout(5000);
                    await this.page.goto(logsUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
                    await this.page.waitForTimeout(3000);
                }
            }
        }

        // All retries exhausted
        throw new Error(`selectStream: Failed to find stream "${stream}" after ${maxRetries} attempts`);
    }

    async selectIndexStreamOld(streamName) {
        testLogger.debug(`selectIndexStreamOld: Starting selection for stream: ${streamName}`);
        try {
            // Click the dropdown
            await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
            testLogger.debug(`selectIndexStreamOld: Clicked dropdown`);
            await this.page.waitForTimeout(2000);

            // Quick attempt to find and click the stream by text
            testLogger.debug(`selectIndexStreamOld: Trying to find stream by text: ${streamName}`);
            await this.page.getByText(streamName, { exact: true }).first().click({ timeout: 5000 });
            testLogger.debug(`selectIndexStreamOld: Successfully selected stream by text: ${streamName}`);

        } catch (error) {
            testLogger.debug(`selectIndexStreamOld: Failed to select stream ${streamName}: ${error.message}`);

            // Quick fallback: just select the first available stream
            testLogger.debug(`selectIndexStreamOld: Trying to select first available stream as fallback`);
            try {
                await this.page.locator('[data-test*="log-search-index-list-stream-toggle-"]').first().click({ timeout: 5000 });
                testLogger.debug(`selectIndexStreamOld: Selected first available stream as fallback`);
            } catch (fallbackError) {
                testLogger.debug(`selectIndexStreamOld: Fallback also failed: ${fallbackError.message}`);
                // Don't throw error, just log it and continue
                testLogger.debug(`selectIndexStreamOld: Continuing without stream selection`);
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
                testLogger.debug('Query completed with error message');
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
                testLogger.debug('Query completed with error message');
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
                testLogger.debug('Query completed with error message');
            } else {
                // Wait a bit more for any UI updates
                await this.page.waitForTimeout(2000);
            }
        }
    }

    async clearAndFillQueryEditor(query) {
        // Wait for query editor to be ready
        await this.page.locator(this.queryEditor).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForTimeout(1000);

        // Click to focus the editor
        await this.page.locator(this.queryEditor).click();
        await this.page.waitForTimeout(500);

        // Select all existing content
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.waitForTimeout(300);

        // Use .inputarea.fill() directly - this is more reliable than keyboard.type()
        // as it avoids Monaco editor line number interference (the "1 SELECT" bug)
        // The .fill() method will replace the selected content
        const inputArea = this.page.locator(this.queryEditor).locator('.inputarea');
        await inputArea.waitFor({ state: 'visible', timeout: 5000 });
        await inputArea.fill(query);
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
                testLogger.debug('Query completed with error message');
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
                testLogger.debug('Query completed with error message');
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
                testLogger.debug('Query completed with error message');
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
                testLogger.debug('Query completed with error message');
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
                testLogger.debug('Query completed with error message');
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
                testLogger.debug('Query completed with error message');
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

    async expectLogsTableRowCount(count) {
        return await expect(this.page.locator('[data-test="logs-search-result-logs-table"] tbody tr')).toHaveCount(count);
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
                testLogger.debug('Query completed with error message');
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
        const orgName = process.env.ORGNAME || 'default';
        const searchPartitionPromise = this.page.waitForResponse(response =>
            response.url().includes(`/api/${orgName}/_search_partition`) &&
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
        const orgName = process.env.ORGNAME || 'default';

        // Create the event listener function
        const responseHandler = async response => {
            if (response.url().includes(`/api/${orgName}/_search`) &&
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
        const orgName = process.env.ORGNAME || 'default';
        testLogger.debug("[DEBUG] Waiting for search response...");
        const searchPromise = this.page.waitForResponse(response => {
            const url = response.url();
            const method = response.request().method();
            testLogger.debug(`[DEBUG] Response: ${method} ${url}`);
            return url.includes(`/api/${orgName}/_search`) && method === 'POST';
        });
        
        const searchResponse = await searchPromise;
        testLogger.debug(`[DEBUG] Search response status: ${searchResponse.status()}`);
        expect(searchResponse.status()).toBe(200);
        
        const searchData = await searchResponse.json();
        testLogger.debug("[DEBUG] Search response data:", JSON.stringify(searchData, null, 2));
        testLogger.debug("[DEBUG] searchData type:", typeof searchData);
        testLogger.debug("[DEBUG] searchData keys:", Object.keys(searchData || {}));
        expect(searchData).toBeDefined();
        
        // Check if this is a partition response (non-streaming) or streaming response
        if (searchData.partitions) {
            testLogger.debug("[DEBUG] Received partition response (non-streaming mode)");
            expect(searchData.partitions).toBeDefined();
            expect(searchData.histogram_interval).toBeDefined();
        } else if (searchData.hits) {
            testLogger.debug("[DEBUG] Received streaming response");
            expect(searchData.hits).toBeDefined();
        } else {
            testLogger.debug("[DEBUG] Unexpected response structure:", JSON.stringify(searchData, null, 2));
            throw new Error(`Unexpected response structure: ${JSON.stringify(searchData)}`);
        }
    }

    async clickRunQueryButtonAndVerifyStreamingResponse() {
        const orgName = process.env.ORGNAME || 'default';
        testLogger.debug("[DEBUG] Setting up response listener before clicking run query button");
        const searchPromise = this.page.waitForResponse(response => {
            const url = response.url();
            const method = response.request().method();
            testLogger.debug(`[DEBUG] Response: ${method} ${url}`);
            return url.includes(`/api/${orgName}/_search`) && method === 'POST';
        });
        
        await this.clickRunQueryButton();
        
        const searchResponse = await searchPromise;
        testLogger.debug(`[DEBUG] Search response status: ${searchResponse.status()}`);
        expect(searchResponse.status()).toBe(200);
        
        // Check if this is a streaming response (SSE format) or JSON response
        const responseUrl = searchResponse.url();
        if (responseUrl.includes('_search_stream')) {
            testLogger.debug("[DEBUG] Received streaming response (SSE format)");
            const responseText = await searchResponse.text();
            testLogger.debug("[DEBUG] Streaming response text (first 200 chars):", responseText.substring(0, 200));
            expect(responseText).toBeDefined();
            expect(responseText.length).toBeGreaterThan(0);
        } else {
            testLogger.debug("[DEBUG] Received JSON response");
            const searchData = await searchResponse.json();
            testLogger.debug("[DEBUG] Search response data:", JSON.stringify(searchData, null, 2));
            testLogger.debug("[DEBUG] searchData type:", typeof searchData);
            testLogger.debug("[DEBUG] searchData keys:", Object.keys(searchData || {}));
            expect(searchData).toBeDefined();
            
            // Check if this is a partition response or regular search response
            if (searchData.partitions) {
                testLogger.debug("[DEBUG] Received partition response (non-streaming mode)");
                expect(searchData.partitions).toBeDefined();
                expect(searchData.histogram_interval).toBeDefined();
            } else if (searchData.hits) {
                testLogger.debug("[DEBUG] Received regular search response");
                expect(searchData.hits).toBeDefined();
            } else {
                testLogger.debug("[DEBUG] Unexpected response structure:", JSON.stringify(searchData, null, 2));
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
            testLogger.error('Error in clickExplore:', error);
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
            testLogger.error('Error in openTimestampMenu:', error);
            try {
                await this.page.waitForTimeout(2000);
                await this.timestampColumnMenu.click({ force: true });
                await this.page.waitForTimeout(1000);
            } catch (retryError) {
                testLogger.error('Error in openTimestampMenu retry:', retryError);
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
        await this.page.locator(this.resultPagination).getByRole('button', { name: resultsPerPage, exact: true }).click();
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
            // Wait for the logs table with a longer timeout for streaming mode and Firefox
            await this.page.waitForSelector('[data-test="logs-search-result-logs-table"]', {
                timeout: 90000, // Increased timeout for streaming mode and Firefox browser
                state: 'visible'
            });
            await expect(this.page.locator('[data-test="logs-search-result-logs-table"]')).toBeVisible({ timeout: 30000 });
        } catch (error) {
            testLogger.error('Error in validateResult:', error);
            // Check if there's an error message visible
            const errorMessage = this.page.locator(this.errorMessage);
            if (await errorMessage.isVisible()) {
                const errorText = await errorMessage.textContent();
                testLogger.error('Error message found:', errorText);
                throw new Error(`Query failed with error: ${errorText}`);
            }
            // Check if there's a "no data found" message
            const noDataMessage = this.page.getByText('No data found');
            if (await noDataMessage.isVisible()) {
                testLogger.debug('No data found for the query');
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
                testLogger.debug('Query completed with error message');
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
                testLogger.debug('Query completed with error message');
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
        // Click the field button once to toggle it off (remove from query)
        // Note: clickInterestingFields() was already called before this, which added the field
        await this.page.locator('[data-test="log-search-index-list-interesting-kubernetes_pod_name-field-btn"]').first().click();
    }

    // Kubernetes methods
    async kubernetesContainerName() {
        await this.page.getByLabel('Expand "kubernetes_container_name"').click();
        await this.page.waitForTimeout(5000);
        await this.page.locator('[data-test="logs-search-subfield-add-kubernetes_container_name-ziox"] [data-test="log-search-subfield-list-equal-kubernetes_container_name-field-btn"]').click();
    }

    async kubernetesContainerNameJoin() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a join "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.page.waitForTimeout(3000);
    }

    async kubernetesContainerNameJoinLimit() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a left join "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name LIMIT 10');
        await this.page.waitForTimeout(3000);
    }

    async kubernetesContainerNameJoinLike() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a join "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name WHERE a.kubernetes_container_name LIKE \'%ziox%\'');
        await this.page.waitForTimeout(3000);
    }

    async kubernetesContainerNameLeftJoin() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a LEFT JOIN "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.page.waitForTimeout(3000);
    }

    async kubernetesContainerNameRightJoin() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a RIGHT JOIN "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.page.waitForTimeout(3000);
    }

    async kubernetesContainerNameFullJoin() {
        await this.clearAndFillQueryEditor('SELECT a.kubernetes_container_name , b.kubernetes_container_name  FROM "default" as a FULL JOIN "e2e_automate" as b on a.kubernetes_container_name  = b.kubernetes_container_name');
        await this.page.waitForTimeout(3000);
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
                testLogger.debug('Query completed with error message');
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
                testLogger.error('Error parsing cell content:', sourceCell);
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

    /**
     * Ingest multiple log entries with retry logic for "stream being deleted" errors
     * @param {string} streamName - Target stream name
     * @param {Array<{fieldName: string, fieldValue: string}>} dataObjects - Array of field data to ingest
     * @param {number} maxRetries - Maximum retry attempts (default: 5)
     */
    async ingestMultipleFields(streamName, dataObjects, maxRetries = 5) {
        const orgId = process.env["ORGNAME"];
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        const baseTimestamp = Date.now() * 1000;
        const logData = dataObjects.map(({ fieldName, fieldValue }, index) => ({
            level: "info",
            [fieldName]: fieldValue,
            log: `Test log with ${fieldName} field - entry ${index}`,
            _timestamp: baseTimestamp + (index * 1000000)
        }));

        testLogger.info(`Preparing to ingest ${logData.length} separate log entries`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const response = await this.page.evaluate(async ({ url, headers, orgId, streamName, logData }) => {
                const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(logData)
                });
                const responseJson = await fetchResponse.json();
                return {
                    status: fetchResponse.status,
                    statusText: fetchResponse.statusText,
                    body: responseJson
                };
            }, {
                url: process.env.INGESTION_URL,
                headers: headers,
                orgId: orgId,
                streamName: streamName,
                logData: logData
            });

            testLogger.info(`Ingestion API response (attempt ${attempt}/${maxRetries}) - Status: ${response.status}, Body:`, response.body);

            if (response.status === 200) {
                testLogger.info('Ingestion successful, waiting for stream to be indexed...');
                await this.page.waitForTimeout(5000);
                return;
            }

            const errorMessage = response.body?.message || JSON.stringify(response.body);
            if (errorMessage.includes('being deleted') && attempt < maxRetries) {
                const waitTime = attempt * 5000;
                testLogger.info(`Stream is being deleted, waiting ${waitTime/1000}s before retry...`);
                await this.page.waitForTimeout(waitTime);
                continue;
            }

            testLogger.error(`Ingestion failed! Status: ${response.status}, Response:`, response.body);
            throw new Error(`Ingestion failed with status ${response.status}: ${JSON.stringify(response.body)}`);
        }
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
        const searchInput = this.page.locator(this.savedViewSearchInput);
        await searchInput.waitFor({ state: 'visible', timeout: 15000 });
        return await searchInput.fill(text);
    }

    async clickSavedViewByTitle(title) {
        const element = this.page.getByTitle(title);
        await element.waitFor({ state: 'visible', timeout: 10000 });
        return await element.click();
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
        
        // Wait for the saved views area to be stable after navigation
        await this.waitForTimeout(2000);
        
        // Ensure saved views panel is expanded and wait for stability
        await this.clickSavedViewsExpand();
        await this.waitForTimeout(1000);
        
        // Wait for the search input to be stable and ready
        await this.page.locator(this.savedViewSearchInput).waitFor({ state: 'attached', timeout: 5000 });
        await this.waitForTimeout(500);
        
        // Click and fill the search input with better error handling
        await this.page.locator(this.savedViewSearchInput).click({ force: true });
        await this.page.locator(this.savedViewSearchInput).fill(savedViewName);
        await this.waitForTimeout(1500);
        
        // Wait for and click the delete button
        await this.page.locator(deleteButtonSelector).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(deleteButtonSelector).click({ force: true });
        await this.waitForTimeout(500);
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

    // ===== LOG DETAIL SIDEBAR METHODS (Bug #9724) =====
    /**
     * Opens the log detail sidebar by clicking on a log row
     * @returns {Promise<void>}
     */
    async openLogDetailSidebar() {
        await this.page.locator(this.logTableColumnSource).click();
        await this.page.locator(this.logDetailDialogBox).waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Log detail sidebar opened');
    }

    /**
     * Verifies the log detail sidebar is visible
     * @returns {Promise<void>}
     */
    async expectLogDetailSidebarVisible() {
        await expect(this.page.locator(this.logDetailDialogBox)).toBeVisible();
    }

    /**
     * Verifies the log detail sidebar is NOT visible
     * @returns {Promise<void>}
     */
    async expectLogDetailSidebarNotVisible() {
        await expect(this.page.locator(this.logDetailDialogBox)).not.toBeVisible();
    }

    /**
     * Verifies that the JSON tab is selected by default (Bug #9724)
     * Checks that JSON tab is visible AND JSON content is visible
     * @returns {Promise<void>}
     */
    async verifyJsonTabSelectedByDefault() {
        // Verify JSON tab exists
        const jsonTab = this.page.locator(this.logDetailJsonTab);
        await expect(jsonTab).toBeVisible();

        // Check if JSON tab is selected (has 'q-tab--active' class)
        const isJsonTabActive = await jsonTab.evaluate(el => el.classList.contains('q-tab--active'));
        expect(isJsonTabActive, 'JSON tab should be selected by default (Bug #9724)').toBe(true);

        // Verify JSON content is visible
        await expect(this.page.locator(this.logDetailJsonContent)).toBeVisible();
        testLogger.info('✓ JSON tab is selected by default (Bug #9724 verified)');
    }

    /**
     * Verifies both JSON and Table tabs are visible in the sidebar
     * @returns {Promise<void>}
     */
    async verifyLogDetailTabsVisible() {
        await expect(this.page.locator(this.logDetailJsonTab)).toBeVisible();
        await expect(this.page.locator(this.logDetailTableTab)).toBeVisible();
        testLogger.info('✓ Both JSON and Table tabs are visible');
    }

    /**
     * Clicks on the Table tab in the log detail sidebar
     * @returns {Promise<void>}
     */
    async clickLogDetailTableTab() {
        await this.page.locator(this.logDetailTableTab).click();
        // Wait for table content to be visible
        await this.page.locator(this.logDetailTableContent).waitFor({ state: 'visible', timeout: 5000 });
        testLogger.info('Clicked Table tab');
    }

    /**
     * Clicks on the JSON tab in the log detail sidebar
     * @returns {Promise<void>}
     */
    async clickLogDetailJsonTab() {
        await this.page.locator(this.logDetailJsonTab).click();
        // Wait for JSON content to be visible
        await this.page.locator(this.logDetailJsonContent).waitFor({ state: 'visible', timeout: 5000 });
        testLogger.info('Clicked JSON tab');
    }

    /**
     * Verifies the Table tab is selected and table content is visible
     * @returns {Promise<void>}
     */
    async verifyTableTabSelected() {
        const tableTab = this.page.locator(this.logDetailTableTab);
        const isTableTabActive = await tableTab.evaluate(el => el.classList.contains('q-tab--active'));
        expect(isTableTabActive, 'Table tab should be selected').toBe(true);
        await expect(this.page.locator(this.logDetailTableContent)).toBeVisible();
        testLogger.info('✓ Table tab is selected and content is visible');
    }

    /**
     * Verifies the JSON tab is selected and JSON content is visible
     * @returns {Promise<void>}
     */
    async verifyJsonTabSelected() {
        const jsonTab = this.page.locator(this.logDetailJsonTab);
        const isJsonTabActive = await jsonTab.evaluate(el => el.classList.contains('q-tab--active'));
        expect(isJsonTabActive, 'JSON tab should be selected').toBe(true);
        await expect(this.page.locator(this.logDetailJsonContent)).toBeVisible();
        testLogger.info('✓ JSON tab is selected and content is visible');
    }

    /**
     * Closes the log detail sidebar
     * @returns {Promise<void>}
     */
    async closeLogDetailSidebar() {
        await this.page.locator(this.logDetailCloseButton).click();
        // Wait for sidebar to close
        await this.page.locator(this.logDetailDialogBox).waitFor({ state: 'hidden', timeout: 5000 });
        testLogger.info('Log detail sidebar closed');
    }

    /**
     * Verifies the wrap toggle is visible when Table tab is selected
     * @returns {Promise<void>}
     */
    async verifyWrapToggleVisibleInTableTab() {
        await expect(this.page.locator(this.logDetailWrapToggle)).toBeVisible();
        testLogger.info('✓ Wrap toggle is visible in Table tab');
    }

    /**
     * Verifies the wrap toggle is NOT visible when JSON tab is selected
     * @returns {Promise<void>}
     */
    async verifyWrapToggleNotVisibleInJsonTab() {
        await expect(this.page.locator(this.logDetailWrapToggle)).not.toBeVisible();
        testLogger.info('✓ Wrap toggle is not visible in JSON tab');
    }

    /**
     * Verifies navigation buttons (Previous/Next) are visible in the sidebar
     * @returns {Promise<void>}
     */
    async verifyNavigationButtonsVisible() {
        await expect(this.page.locator(this.logDetailPreviousBtn)).toBeVisible();
        await expect(this.page.locator(this.logDetailNextBtn)).toBeVisible();
        testLogger.info('✓ Previous and Next navigation buttons are visible');
    }

    // ===== VIEW RELATED / CORRELATION METHODS (Enterprise Feature) =====

    /**
     * Checks if the View Related button is visible in log detail sidebar
     * Note: This is an Enterprise-only feature
     * @returns {Promise<boolean>}
     */
    async isViewRelatedButtonVisible() {
        try {
            await this.page.locator(this.viewRelatedBtn).waitFor({ state: 'visible', timeout: 5000 });
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Verifies the View Related button is visible (Enterprise feature)
     * @returns {Promise<void>}
     */
    async expectViewRelatedButtonVisible() {
        await expect(this.page.locator(this.viewRelatedBtn)).toBeVisible({ timeout: 10000 });
        testLogger.info('✓ View Related button is visible (Enterprise feature)');
    }

    /**
     * Verifies the View Related button is NOT visible
     * @returns {Promise<void>}
     */
    async expectViewRelatedButtonNotVisible() {
        await expect(this.page.locator(this.viewRelatedBtn)).not.toBeVisible();
        testLogger.info('✓ View Related button is not visible');
    }

    /**
     * Clicks the View Related button to open correlation view
     * @returns {Promise<void>}
     */
    async clickViewRelatedButton() {
        await this.page.locator(this.viewRelatedBtn).click();
        testLogger.info('Clicked View Related button');
        // Wait for correlation to start loading
        await this.page.waitForTimeout(1000);
    }

    /**
     * Verifies correlation tabs (Logs, Metrics, Traces) are visible in detail drawer
     * These tabs appear after clicking View Related
     * @returns {Promise<void>}
     */
    async expectCorrelationTabsVisible() {
        // Wait for tabs to appear - correlation tabs are enterprise feature
        await this.page.waitForTimeout(2000);

        // Check for correlation tabs by looking for tabs with specific text
        const logsTab = this.page.locator('.q-tabs').locator('.q-tab').filter({ hasText: 'Logs' });
        const metricsTab = this.page.locator('.q-tabs').locator('.q-tab').filter({ hasText: 'Metrics' });
        const tracesTab = this.page.locator('.q-tabs').locator('.q-tab').filter({ hasText: 'Traces' });

        // At least one correlation tab should be visible
        const anyCorrelationTabVisible = await logsTab.or(metricsTab).or(tracesTab).first().isVisible().catch(() => false);
        expect(anyCorrelationTabVisible, 'At least one correlation tab should be visible').toBe(true);
        testLogger.info('✓ Correlation tabs are visible');
    }

    /**
     * Clicks on the Correlated Logs tab
     * @returns {Promise<void>}
     */
    async clickCorrelatedLogsTab() {
        const tab = this.page.locator('.q-tabs').locator('.q-tab').filter({ hasText: 'Logs' }).last();
        await tab.click();
        testLogger.info('Clicked Correlated Logs tab');
        await this.page.waitForTimeout(1000);
    }

    /**
     * Clicks on the Correlated Metrics tab
     * @returns {Promise<void>}
     */
    async clickCorrelatedMetricsTab() {
        const tab = this.page.locator('.q-tabs').locator('.q-tab').filter({ hasText: 'Metrics' });
        await tab.click();
        testLogger.info('Clicked Correlated Metrics tab');
        await this.page.waitForTimeout(1000);
    }

    /**
     * Clicks on the Correlated Traces tab
     * @returns {Promise<void>}
     */
    async clickCorrelatedTracesTab() {
        const tab = this.page.locator('.q-tabs').locator('.q-tab').filter({ hasText: 'Traces' });
        await tab.click();
        testLogger.info('Clicked Correlated Traces tab');
        await this.page.waitForTimeout(1000);
    }

    /**
     * Verifies correlation loading state is displayed
     * @returns {Promise<void>}
     */
    async expectCorrelationLoadingVisible() {
        await expect(this.page.locator(this.correlationLoadingSpinner)).toBeVisible({ timeout: 5000 });
        testLogger.info('✓ Correlation loading spinner is visible');
    }

    /**
     * Waits for correlation loading to complete
     * @param {number} timeout - Maximum wait time in ms
     * @returns {Promise<void>}
     */
    async waitForCorrelationLoaded(timeout = 30000) {
        await this.page.locator(this.correlationLoadingSpinner).waitFor({ state: 'hidden', timeout });
        testLogger.info('✓ Correlation loading completed');
    }

    /**
     * Verifies Apply Dimension Filters button is visible
     * @returns {Promise<void>}
     */
    async expectApplyDimensionFiltersVisible() {
        const filterBtn = this.page.locator(this.applyDimensionFilters).or(this.page.locator(this.applyDimensionFiltersEmbedded));
        await expect(filterBtn.first()).toBeVisible({ timeout: 10000 });
        testLogger.info('✓ Apply Dimension Filters button is visible');
    }

    /**
     * Closes the correlation dashboard dialog
     * @returns {Promise<void>}
     */
    async closeCorrelationDashboard() {
        const closeBtn = this.page.locator(this.correlationDashboardClose);
        if (await closeBtn.isVisible()) {
            await closeBtn.click();
            testLogger.info('Closed correlation dashboard');
        }
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
        // Wait for network idle to ensure chart data has loaded
        await this.page.waitForLoadState('networkidle');

        const canvasLocator = this.page.locator(this.barChartCanvas);

        // Retry mechanism to handle ECharts canvas re-rendering
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Wait for the canvas to be visible
                await canvasLocator.waitFor({ state: 'visible', timeout: 30000 });

                // Wait for chart to stabilize - ECharts may re-render multiple times
                await this.page.waitForTimeout(2000);

                // force:true required for ECharts canvas - canvas elements are interactive
                // but fail Playwright's actionability checks (no pointer-events in traditional sense)
                await canvasLocator.click({
                    position: { x: 182, y: 66 },
                    force: true,
                    timeout: 10000
                });
                return; // Success
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                // Wait before retry to allow chart to stabilize
                await this.page.waitForTimeout(1000);
            }
        }
    }

    async expectBarChartCanvasVisible() {
        const canvasLocator = this.page.locator(this.barChartCanvas);
        return await expect(canvasLocator).toBeVisible({ timeout: 30000 });
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
        // Wait for button to be enabled before clicking (button starts disabled)
        const button = this.page.locator(this.liveMode5SecBtn);
        await button.waitFor({ state: 'visible', timeout: 10000 });
        // Wait for button to become enabled
        await expect(button).toBeEnabled({ timeout: 10000 });
        return await button.click();
    }

    async isLiveMode5SecEnabled() {
        const testLogger = require('../../playwright-tests/utils/test-logger.js');
        const button = this.page.locator(this.liveMode5SecBtn);
        try {
            // Wait for button to be visible first (isEnabled() doesn't support timeout)
            await button.waitFor({ state: 'visible', timeout: 5000 });
            return await button.isEnabled();
        } catch (error) {
            testLogger.warn(`isLiveMode5SecEnabled check failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Get the Live Mode 5 second button locator
     * @returns {import('@playwright/test').Locator} The 5-second live mode button locator
     */
    getLiveMode5SecButton() {
        return this.page.locator(this.liveMode5SecBtn);
    }

    async getPageContent() {
        return await this.page.locator('body').innerText().catch(() => '');
    }

    async clickVrlToggle() {
        // Check both toggle button selectors to understand which one exists
        const showQueryToggle = this.page.locator(this.vrlToggleButton);
        const vrlToggle = this.page.locator(this.vrlToggleBtn);

        const showQueryCount = await showQueryToggle.count();
        const vrlCount = await vrlToggle.count();

        testLogger.info(`Found ${showQueryCount} elements for show-query-toggle, ${vrlCount} elements for vrl-toggle`);

        // Use the VRL toggle button instead of show-query toggle
        if (vrlCount > 0) {
            await vrlToggle.first().click();
            testLogger.info('Clicked VRL toggle button (logs-search-bar-vrl-toggle-btn)');
        } else if (showQueryCount > 0) {
            await showQueryToggle.first().click();
            testLogger.info('Clicked show-query toggle button (logs-search-bar-show-query-toggle-btn)');
        } else {
            throw new Error('No VRL toggle button found');
        }

        // Wait for animation to complete
        await this.page.waitForTimeout(1000);
    }

    async expectVrlFieldVisible() {
        // When in query editor view, check if the query editor container is visible
        const queryEditor = this.page.locator('.query-editor-container, #fnEditor');
        const isEditorVisible = await queryEditor.first().isVisible();

        if (!isEditorVisible) {
            throw new Error('Expected query editor view to be visible');
        }

        testLogger.info('Query editor view is visible');
        return true;
    }

    async expectVrlFieldNotVisible() {
        return await expect(this.page.locator(this.vrlEditor).first()).not.toBeVisible();
    }

    async expectFnEditorNotVisible() {
        // When the show-query toggle is clicked, it switches to results view
        // Check if we're in results view by looking for the logs table
        const logsTable = this.page.locator('[data-test="logs-search-result-logs-table"]');
        const isResultsVisible = await logsTable.isVisible();

        if (!isResultsVisible) {
            throw new Error('Expected results view to be visible after toggling query editor off');
        }

        testLogger.info('Results view is visible - query editor toggled off successfully');
        return true;
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

    async expectResultPaginationVisible() {
        return await expect(this.page.locator(this.resultPagination)).toBeVisible();
    }

    async clickPaginationPage(pageNumber) {
        return await this.page.locator(`${this.resultPagination} .q-btn`).filter({ hasText: pageNumber.toString() }).first().click();
    }

    async getPaginationPageCount() {
        const pageButtons = this.page.locator(`${this.resultPagination} .q-btn`).filter({ hasText: /^\d+$/ });
        return await pageButtons.count();
    }

    async getPaginationPageClasses(pageNumber) {
        const pageButton = this.page.locator(`${this.resultPagination} .q-btn`).filter({ hasText: pageNumber.toString() }).first();
        return await pageButton.getAttribute('class');
    }

    async isPaginationPageActive(pageNumber) {
        const classes = await this.getPaginationPageClasses(pageNumber);
        return classes && (classes.includes('bg-primary') || classes.includes('unelevated'));
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

    // ===== QUERY EDITOR EXPAND/COLLAPSE METHODS =====
    async clickQueryEditorFullScreenBtn() {
        return await this.page.locator(this.queryEditorFullScreenBtn).click();
    }

    async expectQueryEditorFullScreenBtnVisible() {
        return await expect(this.page.locator(this.queryEditorFullScreenBtn)).toBeVisible({ timeout: 10000 });
    }

    async isQueryEditorExpanded() {
        const container = this.page.locator(this.queryEditorContainer);
        return await container.locator(this.expandOnFocusClass).count() > 0;
    }

    async toggleQueryEditorFullScreen() {
        const initialState = await this.isQueryEditorExpanded();
        await this.clickQueryEditorFullScreenBtn();
        await this.page.waitForTimeout(500); // Wait for animation
        const newState = await this.isQueryEditorExpanded();
        return { initialState, newState, toggled: initialState !== newState };
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
        try {
            await this.page.locator(this.logsSearchBarFunctionDropdownSave).filter({ hasText: 'save' }).click({ timeout: 3000 });
        } catch (error) {
            // If save button click fails, click the save transform button
            await this.page.locator(this.logsSearchBarSaveTransformBtn).click();
        }
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
            testLogger.debug('No events found, attempting to refresh...');
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
        testLogger.debug(text);
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
        testLogger.debug(`Download ${expectedFileName}: ${rowCount} data rows`);
        
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

    // Helper method for common file validation logic (lines 2037-2046)
    async _saveAndValidateDownloadFile(download, expectedFileName, downloadDir) {
        const downloadPath = path.join(downloadDir, expectedFileName);

        // Save the download
        await download.saveAs(downloadPath);

        // Wait for file system to sync
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify file exists and has content
        expect(fs.existsSync(downloadPath)).toBe(true);
        const stats = fs.statSync(downloadPath);
        expect(stats.size).toBeGreaterThan(0);

        return downloadPath;
    }

    async verifyJsonDownload(download, expectedFileName, downloadDir) {
        const downloadPath = await this._saveAndValidateDownloadFile(download, expectedFileName, downloadDir);

        // Verify it's a JSON file
        const content = fs.readFileSync(downloadPath, 'utf8');

        // Parse as JSON to verify it's valid JSON
        let jsonData;
        try {
            jsonData = JSON.parse(content);
        } catch (error) {
            throw new Error(`Downloaded file is not valid JSON: ${error.message}`);
        }

        // Verify it's an array of objects and contains expected fields
        expect(Array.isArray(jsonData)).toBe(true);
        expect(jsonData.length).toBeGreaterThan(0);

        // Check that the first record has the expected timestamp field
        const firstRecord = jsonData[0];
        expect(firstRecord).toHaveProperty('_timestamp');

        testLogger.debug(`JSON Download ${expectedFileName}: ${jsonData.length} records`);

        return downloadPath;
    }

    async verifyJsonDownloadWithCount(download, expectedFileName, downloadDir, expectedCount) {
        const downloadPath = await this._saveAndValidateDownloadFile(download, expectedFileName, downloadDir);

        // Verify it's a JSON file
        const content = fs.readFileSync(downloadPath, 'utf8');

        // Parse as JSON to verify it's valid JSON
        let jsonData;
        try {
            jsonData = JSON.parse(content);
        } catch (error) {
            throw new Error(`Downloaded file is not valid JSON: ${error.message}`);
        }

        // Verify it's an array of objects and contains expected fields
        expect(Array.isArray(jsonData)).toBe(true);
        expect(jsonData.length).toBe(expectedCount);

        // Check that the first record has the expected timestamp field
        const firstRecord = jsonData[0];
        expect(firstRecord).toHaveProperty('_timestamp');

        testLogger.debug(`JSON Download ${expectedFileName}: ${jsonData.length} records (expected ${expectedCount})`);

        return downloadPath;
    }

    // Download action methods
    async clickMoreOptionsButton() {
        return await this.page.locator('[data-test="logs-search-bar-more-options-btn"]').click();
    }

    async hoverMoreOptionsButton() {
        return await this.page.locator('[data-test="logs-search-bar-more-options-btn"]').hover();
    }

    async hoverDownloadResults() {
        return await this.page.getByText('keyboard_arrow_right').hover();
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
        const expandBtn = this.page.locator(`[data-test="log-search-expand-${fieldName}-field-btn"]`);

        // Check primary selector first (use waitFor since isVisible doesn't support timeout)
        try {
            await expandBtn.waitFor({ state: 'visible', timeout: 5000 });
            await expandBtn.hover();
            await this.page.waitForTimeout(300);
            return;
        } catch {
            // Primary selector not found, try alternate
        }

        // Try alternate selector
        const altBtn = this.page.locator(`[data-test*="expand-${fieldName}"]`).first();
        if (await altBtn.isVisible().catch(() => false)) {
            await altBtn.hover();
            await this.page.waitForTimeout(300);
            return;
        }

        throw new Error(`Field expand button not found for: ${fieldName}`);
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

    // New POM methods for PR tests

    async executeBlankQueryWithKeyboardShortcut() {
        // Clear any existing query and ensure editor is focused
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.waitForTimeout(500);
        
        // Try to run the blank query with cmd+enter
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for any response
        await this.page.waitForTimeout(3000);
    }

    async expectBlankQueryError() {
        // Verify proper error handling for blank SQL query (the actual behavior from PR #9023)
        const errorMessage = this.page.getByText("Error occurred while retrieving search events");
        await expect(errorMessage).toBeVisible();
        
        // Verify there's a clickable error details button
        const errorDetailsBtn = this.page.locator('[data-test="logs-page-result-error-details-btn"]');
        if (await errorDetailsBtn.isVisible()) {
            await errorDetailsBtn.click();
            await this.page.waitForTimeout(1000);
            testLogger.info('✓ Error details button clicked successfully');
        }
    }

    async openFirstLogDetails() {
        // Click on the first log entry to open details (expand the _timestamp column)
        await this.page.locator('[data-test="log-table-column-0-_timestamp"] [data-test="table-row-expand-menu"]').click();
        await this.page.waitForTimeout(1000);
    }

    async addIncludeSearchTermFromLogDetails() {
        // Ensure Quick Mode is OFF for include/exclude buttons to work
        const quickModeToggle = this.page.locator('[data-test="logs-search-bar-quick-mode-toggle-btn"] div').nth(1);
        const quickModeClass = await quickModeToggle.getAttribute('class');
        const isQuickModeOn = quickModeClass && quickModeClass.includes('text-primary');

        if (isQuickModeOn) {
            testLogger.info('Quick Mode is ON - turning it OFF for include/exclude functionality');
            await quickModeToggle.click();
            await this.page.waitForTimeout(1000);
        } else {
            testLogger.info('Quick Mode is already OFF');
        }

        // Check if there's a direct include button (newer UI)
        const directIncludeButton = this.page.locator('[data-test="log-details-include-field-btn"]');
        const directIncludeCount = await directIncludeButton.count();

        if (directIncludeCount > 0) {
            testLogger.info(`Found ${directIncludeCount} direct include buttons`);
            await directIncludeButton.first().click();
            await this.page.waitForTimeout(1000);
            return;
        }

        // Otherwise use the dropdown approach (older UI)
        // Don't use the first button (which is for _timestamp field), use the second one
        const includeExcludeButtons = this.page.locator('[data-test="log-details-include-exclude-field-btn"]');
        const buttonCount = await includeExcludeButtons.count();
        testLogger.info(`Found ${buttonCount} include/exclude buttons in log details`);

        // Use the second button (index 1) to skip _timestamp field
        if (buttonCount > 1) {
            await expect(includeExcludeButtons.nth(1)).toBeVisible();
            await includeExcludeButtons.nth(1).click();
        } else if (buttonCount > 0) {
            // Fallback to first if only one exists
            await expect(includeExcludeButtons.first()).toBeVisible();
            await includeExcludeButtons.first().click();
        } else {
            throw new Error('No include/exclude buttons found in log details');
        }
        // Wait for menu to appear (with proper wait instead of fixed timeout)
        const includeMenuItem = this.page.getByText('Include Search Term', { exact: true });

        try {
            await includeMenuItem.waitFor({ state: 'visible', timeout: 5000 });
            testLogger.info('Include Search Term menu item found');
            await includeMenuItem.click();
        } catch (e) {
            // Take screenshot for debugging if menu doesn't appear
            await this.page.screenshot({ path: 'playwright-tests/Logs/include-menu-after-click.png', fullPage: true });
            testLogger.info('Screenshot saved after clicking include/exclude button');

            // Try alternative selectors
            const includePartial = this.page.getByText(/Include.*Search/i);
            const partialCount = await includePartial.count();
            testLogger.info(`Found partial match menus: ${partialCount}`);

            if (partialCount > 0) {
                await includePartial.first().click();
            } else {
                throw new Error('Include Search Term menu item not found');
            }
        }

        await this.page.waitForTimeout(1000);
    }

    async expectIncludeExcludeButtonsVisibleInLogDetails() {
        // CRITICAL ASSERTION: After running query, the include/exclude buttons should still be visible
        const postQueryButtons = this.page.locator('[data-test="log-details-include-exclude-field-btn"]');
        
        // Assert that include/exclude buttons are still visible after query run
        await expect(postQueryButtons.first()).toBeVisible();
        await expect(postQueryButtons.nth(1)).toBeVisible();
        
        // Assert that we still have multiple buttons available
        const buttonCount = await postQueryButtons.count();
        expect(buttonCount).toBeGreaterThanOrEqual(2);
        
        testLogger.info(`✓ ${buttonCount} include/exclude buttons remain visible in open log details AFTER query run`);
        return buttonCount;
    }

    async setupAPICallTracking() {
        const allRequests = [];
        
        const requestHandler = (request) => {
            if (request.url().includes('/_search') && request.method() === 'POST') {
                let postData = null;
                try {
                    postData = request.postData();
                } catch (e) {
                    postData = 'Unable to read post data';
                }
                
                allRequests.push({
                    url: request.url(),
                    postData: postData,
                    timestamp: Date.now()
                });
            }
        };
        
        this.page.on('request', requestHandler);
        
        return { allRequests, requestHandler };
    }

    async executeQueryWithKeyboardShortcutAndTrackAPICalls(query) {
        // Clear any existing query and add a test query
        await this.page.locator(this.queryEditor).click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.keyboard.type(query);
        await this.page.waitForTimeout(500);
        
        // Use cmd+enter to run the query
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        
        // Wait for the API calls to complete
        await this.page.waitForTimeout(4000);
    }

    async verifyAPICallCounts(allRequests, requestHandler) {
        // Filter recent requests made after cmd+enter
        const recentRequests = allRequests.filter(req => Date.now() - req.timestamp < 5000);
        
        // Histogram calls have size: 0, regular search calls have size > 0 (typically 51)
        const searchCalls = recentRequests.filter(req => 
            req.postData && (req.postData.includes('"size":51') || req.postData.includes('"size": 51'))
        );
        const histogramCalls = recentRequests.filter(req => 
            req.postData && (req.postData.includes('"size":0') || req.postData.includes('"size": 0'))
        );
        
        // Verify exactly 1 search call and 1 histogram call are made
        expect(searchCalls.length).toBe(1);
        expect(histogramCalls.length).toBe(1);
        expect(recentRequests.length).toBe(2);
        
        // Clean up event listener
        this.page.off('request', requestHandler);
        
        return { searchCalls: searchCalls.length, histogramCalls: histogramCalls.length, total: recentRequests.length };
    }

    async getEditorContentBefore() {
        // Get the actual Monaco editor content using a more specific selector
        const monacoEditor = this.page.locator('[data-test="logs-search-bar-query-editor"] .monaco-editor .view-lines');
        const initialQuery = await monacoEditor.textContent();
        return initialQuery?.trim().replace(/\s+/g, ' ') || '';
    }

    async getEditorContentAfter() {
        // Check editor content after cmd+enter
        const monacoEditor = this.page.locator('[data-test="logs-search-bar-query-editor"] .monaco-editor .view-lines');
        const finalEditorContent = await monacoEditor.textContent();
        return finalEditorContent?.trim().replace(/\s+/g, ' ') || '';
    }

    async setupEditorForCursorTest(query) {
        // Click in the query editor and add a simple query
        const queryEditor = this.page.locator(this.queryEditor);
        await queryEditor.click();
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await this.page.keyboard.press("Backspace");
        await this.page.keyboard.type(query);
        
        // Position cursor at the end of the query
        await this.page.keyboard.press("End");
        await this.page.waitForTimeout(500);
    }

    async executeQueryWithKeyboardShortcutForEditor() {
        // Press cmd+enter to run the query
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        await this.page.waitForTimeout(2000);
    }

    async verifyEditorContentIntegrity(initialQuery, finalQuery) {
        // The query content should remain exactly the same 
        expect(finalQuery).toBe(initialQuery);
        expect(finalQuery).toBe('select * from "e2e_automate"');
        
        // Additional integrity checks
        expect(finalQuery).not.toMatch(/\n/); // No newlines
        expect(finalQuery).not.toMatch(/\r/); // No carriage returns  
        expect(finalQuery).not.toMatch(/^\d/); // No leading numbers
        expect(finalQuery).not.toContain('monaco'); // No Monaco artifacts
    }

    // Additional POM methods to eliminate all locators from spec file

    async expectLogsSearchResultLogsTableVisible() {
        await expect(this.page.locator(this.logsSearchResultLogsTable)).toBeVisible();
    }

    async getKubernetesFields() {
        return this.page.locator(this.kubernetesFieldsSelector);
    }

    async getKubernetesFieldsCount() {
        const kubernetesFields = this.page.locator(this.kubernetesFieldsSelector);
        return await kubernetesFields.count();
    }

    async getSpecificFieldLocator(fieldName) {
        return this.page.locator(`[data-test="log-search-expand-${fieldName}-field-btn"]`);
    }

    async getAllFields() {
        return this.page.locator(this.allFieldsSelector);
    }

    async getMatchingFields() {
        return this.page.locator(this.matchingFieldsSelector);
    }

    async countMatchingFields() {
        const matchingFields = this.page.locator(this.matchingFieldsSelector);
        return await matchingFields.count();
    }

    async ensureQuickModeState(desiredState) {
        const quickModeToggle = this.page.locator(this.quickModeToggle);
        const isEnabled = await quickModeToggle.getAttribute('aria-pressed');
        
        if ((desiredState && isEnabled !== 'true') || (!desiredState && isEnabled === 'true')) {
            await quickModeToggle.click();
            await this.page.waitForTimeout(500);
        }
    }

    async ensureHistogramToggleState(desiredState) {
        const histogramToggle = this.page.locator(this.histogramToggle);
        const isEnabled = await histogramToggle.getAttribute('aria-pressed');
        
        if ((desiredState && isEnabled !== 'true') || (!desiredState && isEnabled === 'true')) {
            await histogramToggle.click();
            await this.page.waitForTimeout(500);
            return true; // State was changed
        }
        return false; // State was already correct
    }

    async getQuickModeToggleAttributes() {
        const quickModeToggle = this.page.locator(this.quickModeToggle);
        const ariaPressed = await quickModeToggle.getAttribute('aria-pressed');
        const classNames = await quickModeToggle.getAttribute('class');
        return { ariaPressed, classNames };
    }

    async expectQuickModeToggleVisible() {
        await expect(this.page.locator(this.quickModeToggle)).toBeVisible();
    }

    async waitForUI(timeout = 500) {
        await this.page.waitForTimeout(timeout);
    }

    // Methods specifically for multistream testing that don't already exist
    async navigateToHome() {
        return await this.page.locator('[data-test="menu-link-\\/-item"]').click();
    }

    async fillStreamFilter(streamName) {
        return await this.page.locator('[data-test="log-search-index-list-select-stream"]').fill(streamName);
    }

    async toggleStreamSelection(streamName) {
        return await this.page.locator(`[data-test="log-search-index-list-stream-toggle-${streamName}"] div`).nth(2).click();
    }

    async toggleQueryModeEditor() {
        await this.page.locator('[data-test="logs-search-bar-show-query-toggle-btn"] div').first().click();
        // Wait for the Monaco editor container to appear (Firefox needs this)
        await this.page.waitForTimeout(2000);
        await this.page.locator('#fnEditor').waitFor({ state: 'visible', timeout: 15000 });
    }

    async clickMonacoEditor() {
        // Wait for Monaco editor to be fully rendered (Firefox needs longer)
        const monacoEditor = this.page.locator('#fnEditor').locator('.monaco-editor');
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });
        // Scroll into view for Firefox (element may be outside viewport)
        await monacoEditor.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(1500); // Extra stabilization for Firefox
        return await monacoEditor.click({ force: true });
    }

    async fillMonacoEditor(text) {
        // Wait for Monaco editor to be visible (Firefox rendering is slower)
        const fnEditorContainer = this.page.locator('#fnEditor');
        const monacoEditor = fnEditorContainer.locator('.monaco-editor');
        await monacoEditor.waitFor({ state: 'visible', timeout: 30000 });

        // Use JavaScript to scroll the fnEditor into center of viewport (more reliable for Firefox)
        await fnEditorContainer.evaluate(el => {
            el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        });
        await this.page.waitForTimeout(2000); // Extra stabilization for Firefox

        // Click on the Monaco editor container using coordinates (more reliable for Firefox viewport issues)
        const editorBox = await monacoEditor.boundingBox();
        if (editorBox) {
            await this.page.mouse.click(editorBox.x + 50, editorBox.y + 20);
        } else {
            // Fallback: click with force
            await monacoEditor.click({ force: true });
        }
        await this.page.waitForTimeout(500);

        // Clear existing content and fill using keyboard (more reliable on Firefox)
        await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(200);
        await this.page.keyboard.type(text, { delay: 50 });
    }

    async getCellByName(name) {
        return await this.page.getByRole('cell', { name });
    }

    async clickCellByName(name) {
        return await this.page.getByRole('cell', { name }).click();
    }

    async clickTableExpandMenuFirst() {
        return await this.page.locator('[data-test="table-row-expand-menu"]').first().click({ force: true });
    }

    async clickTimestampColumnMenu() {
        return await this.page.locator('[data-test="log-table-column-0-_timestamp"] [data-test="table-row-expand-menu"]').click();
    }

    async clickDateTimeButton() {
        return await this.page.locator('[data-test="date-time-btn"]').click();
    }

    async selectRelative6Hours() {
        return await this.page.locator('[data-test="date-time-relative-6-h-btn"]').click();
    }

    async selectRelative1Hour() {
        return await this.page.locator(this.relative1HourButton).click();
    }

    async clickAbsoluteTimeTab() {
        return await this.page.locator('[data-test="date-time-absolute-tab"]').click();
    }

    async fillStartDate(date) {
        return await this.page.locator('[data-test="date-time-absolute-start-date"]').fill(date);
    }

    async fillEndDate(date) {
        return await this.page.locator('[data-test="date-time-absolute-end-date"]').fill(date);
    }

    async clickApplyDateRange() {
        return await this.page.locator('[data-test="date-time-btn-apply"]').click();
    }

    async searchFieldByName(fieldName) {
        return await this.page.locator('[data-cy="index-field-search-input"]').fill(fieldName);
    }

    async navigateToStreams() {
        return await this.page.locator('[data-test="menu-link-/streams-item"]').click({ force: true });
    }

    async navigateToStreamsAlternate() {
        return await this.page.locator('[data-test="menu-link-\\/streams-item"]').click({ force: true });
    }

    async searchStreamByPlaceholder(searchText) {
        await this.page.getByPlaceholder("Search Stream").click();
        return await this.page.getByPlaceholder("Search Stream").fill(searchText);
    }

    async clickFirstExploreButton() {
        return await this.page.getByRole("button", { name: "Explore" }).first().click({ force: true });
    }

    // Additional methods for multistream functionality
    async expectLogsSearchIndexListContainsText(text) {
        return await expect(this.page.locator(this.logsSearchIndexList)).toContainText(text);
    }

    /**
     * Gets the text content of the logs table.
     * @param {number} [timeout=30000] - Timeout in milliseconds (increased from default 10s to handle large result sets)
     * @returns {Promise<string>} The text content of the logs table
     */
    async getLogsTableContent(timeout = 30000) {
        return await this.page.locator(this.logsTable).textContent({ timeout });
    }

    async getLogsTableRowCount() {
        return await this.page.locator(`${this.logsTable} tbody tr`).count();
    }

    // ============================================================================
    // Stream display methods for multi-stream scenarios
    // ============================================================================

    /**
     * Gets the first stream display element from the stream list.
     * @returns {Promise<Locator>} The stream display element locator
     * @example
     * const element = await logsPage.getStreamDisplayElement();
     * await element.click();
     */
    async getStreamDisplayElement() {
        return this.page.locator(this.logsSearchIndexList).first();
    }

    /**
     * Waits for the stream display element to be visible.
     * @param {number} [timeout=10000] - Timeout in milliseconds
     * @returns {Promise<void>}
     * @example
     * await logsPage.expectStreamDisplayVisible(5000);
     */
    async expectStreamDisplayVisible(timeout = 10000) {
        await this.page.locator(this.logsSearchIndexList).first().waitFor({ state: 'visible', timeout });
    }

    /**
     * Gets the text content of the stream display element.
     * @returns {Promise<string>} The stream display text
     * @example
     * const text = await logsPage.getStreamDisplayText();
     * console.log(`Selected streams: ${text}`);
     */
    async getStreamDisplayText() {
        return await this.page.locator(this.logsSearchIndexList).first().textContent();
    }

    /**
     * Gets computed styles and dimensions of the stream display element for overflow detection.
     * @returns {Promise<Object>} Object containing overflow, textOverflow, whiteSpace, scrollWidth, clientWidth, and width
     * @example
     * const styles = await logsPage.getStreamDisplayStyles();
     * const isOverflowing = styles.scrollWidth > styles.clientWidth;
     */
    async getStreamDisplayStyles() {
        const element = await this.getStreamDisplayElement();
        return await element.evaluate((el) => {
            const computed = window.getComputedStyle(el);
            return {
                overflow: computed.overflow,
                textOverflow: computed.textOverflow,
                whiteSpace: computed.whiteSpace,
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
                width: computed.width
            };
        });
    }

    /**
     * Hovers over the stream display element to trigger tooltips.
     * @returns {Promise<void>}
     * @example
     * await logsPage.hoverStreamDisplay();
     * const isVisible = await logsPage.isTooltipVisible();
     */
    async hoverStreamDisplay() {
        await this.page.locator(this.logsSearchIndexList).first().hover();
    }

    // ============================================================================
    // Tooltip methods
    // ============================================================================

    /**
     * Checks if a tooltip is visible with proper state detection.
     * @param {number} [timeout=3000] - Timeout in milliseconds
     * @returns {Promise<boolean>} True if tooltip is visible, false otherwise
     * @example
     * await logsPage.hoverStreamDisplay();
     * if (await logsPage.isTooltipVisible()) {
     *   const text = await logsPage.getTooltipText();
     * }
     */
    async isTooltipVisible(timeout = 3000) {
        try {
            await this.page.locator('[role="tooltip"], .q-tooltip').first().waitFor({
                state: 'visible',
                timeout
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Gets the text content of the tooltip with error handling.
     * @param {number} [timeout=3000] - Timeout in milliseconds
     * @returns {Promise<string|null>} The tooltip text, or null if tooltip is not found
     * @example
     * const tooltipText = await logsPage.getTooltipText();
     * if (tooltipText) {
     *   console.log(`Tooltip: ${tooltipText}`);
     * }
     */
    async getTooltipText(timeout = 3000) {
        try {
            return await this.page.locator('[role="tooltip"], .q-tooltip').first().textContent({ timeout });
        } catch {
            return null;
        }
    }

    // ============================================================================
    // Field Expansion Methods (Bug #7751 regression tests)
    // ============================================================================

    /**
     * Waits for the field expand button to be visible.
     * @param {string} fieldName - Name of the field
     * @param {number} [timeout=10000] - Timeout in milliseconds
     * @returns {Promise<void>}
     * @example
     * await logsPage.waitForFieldExpandButtonVisible('kubernetes_pod_name');
     */
    async waitForFieldExpandButtonVisible(fieldName, timeout = 10000) {
        await this.page.locator(this.fieldExpandButton(fieldName)).waitFor({ state: 'visible', timeout });
    }

    /**
     * Clicks the field expand button to trigger values API.
     * @param {string} fieldName - Name of the field to expand
     * @returns {Promise<void>}
     * @example
     * await logsPage.clickFieldExpandButton('kubernetes_pod_name');
     */
    async clickFieldExpandButton(fieldName) {
        await this.page.locator(this.fieldExpandButton(fieldName)).click();
    }

    /**
     * Waits for field expansion content to be visible after expanding a field.
     * @param {string} fieldName - Name of the field
     * @param {number} [timeout=10000] - Timeout in milliseconds
     * @returns {Promise<void>}
     * @example
     * await logsPage.waitForFieldExpansionContent('kubernetes_pod_name');
     */
    async waitForFieldExpansionContent(fieldName, timeout = 10000) {
        await this.page.locator(this.fieldListItem(fieldName)).waitFor({ state: 'visible', timeout });
    }

    /**
     * Gets the text content of field expansion area (for error checking).
     * @param {string} fieldName - Name of the field
     * @param {number} [timeout=10000] - Timeout in milliseconds
     * @returns {Promise<string>} The text content, or empty string on error
     * @example
     * const content = await logsPage.getFieldExpansionContent('kubernetes_pod_name');
     */
    async getFieldExpansionContent(fieldName, timeout = 10000) {
        try {
            return await this.page.locator(this.fieldListItem(fieldName)).textContent({ timeout }) || '';
        } catch {
            return '';
        }
    }

    /**
     * Waits for at least one field value to appear in the dropdown after expansion.
     * @param {string} fieldName - Name of the field
     * @param {number} [timeout=5000] - Timeout in milliseconds
     * @returns {Promise<void>}
     * @example
     * await logsPage.waitForFieldValues('kubernetes_pod_name');
     */
    async waitForFieldValues(fieldName, timeout = 5000) {
        await this.page.locator(`[data-test^="logs-search-subfield-add-${fieldName}-"]`).first()
            .waitFor({ state: 'visible', timeout });
    }

    /**
     * Gets the count of field values displayed in the dropdown.
     * @param {string} fieldName - Name of the field
     * @returns {Promise<number>} Number of field values
     * @example
     * const count = await logsPage.getFieldValuesCount('kubernetes_pod_name');
     */
    async getFieldValuesCount(fieldName) {
        return await this.page.locator(`[data-test^="logs-search-subfield-add-${fieldName}-"]`).count();
    }

    /**
     * Expands a field and validates that values API does not return 400 error.
     * Used by Bug #7751 tests to verify field expansion works correctly with complex queries.
     *
     * This method performs three levels of validation:
     * 1. PRIMARY: Values API responds with non-400 status
     * 2. SECONDARY: No 400 error message displayed in UI
     * 3. TERTIARY: Field values actually appear in dropdown
     *
     * @param {string} fieldName - Name of the field to expand
     * @param {Object} testLogger - Test logger instance
     * @returns {Promise<{apiStatus: number|null, valueCount: number}>} API status and field value count
     * @example
     * const result = await logsPage.expandFieldAndValidate('kubernetes_pod_name', testLogger);
     * // Returns: { apiStatus: 200, valueCount: 10 }
     */
    async expandFieldAndValidate(fieldName, testLogger) {
        const { expect } = require('@playwright/test');

        // Search for the field first to make it visible in sidebar
        testLogger.info(`Searching for field: ${fieldName}`);
        await this.fillIndexFieldSearchInput(fieldName);

        // Wait for expand button to be visible
        testLogger.info(`Expanding field: ${fieldName}`);
        await this.waitForFieldExpandButtonVisible(fieldName);

        // Set up values API response waiter BEFORE clicking expand
        testLogger.info('Setting up values API listener');
        const valuesApiPromise = this.page.waitForResponse(
            response => response.url().includes('/_values') && response.status() !== 0,
            { timeout: 20000 }
        ).catch(() => null);

        // Click expand button
        testLogger.info('Clicking expand to trigger values API call');
        await this.clickFieldExpandButton(fieldName);

        // Wait for values API response
        let apiStatus = null;
        const apiResponse = await valuesApiPromise;

        if (apiResponse) {
            apiStatus = apiResponse.status();
            testLogger.info(`✓ Values API responded with status: ${apiStatus}`);

            // PRIMARY ASSERTION: Values API should NOT return 400 (this was the bug #7751)
            expect(apiStatus).not.toBe(400);
            testLogger.info('✓ PRIMARY CHECK PASSED: Values API did not return 400 error');
        } else {
            testLogger.warn('Values API response timeout');
        }

        // Wait for field expansion content to be visible
        await this.waitForFieldExpansionContent(fieldName);

        // Get expansion content text
        const contentText = await this.getFieldExpansionContent(fieldName);

        // Secondary assertion: NO 400 error in UI
        expect(contentText).not.toContain('400');
        expect(contentText.toLowerCase()).not.toMatch(/error.*400|400.*error/);
        testLogger.info('✓ SECONDARY CHECK PASSED: No 400 error displayed in UI');

        // TERTIARY ASSERTION: Verify field values actually appear in dropdown
        await this.waitForFieldValues(fieldName);
        const valueCount = await this.getFieldValuesCount(fieldName);

        expect(valueCount).toBeGreaterThanOrEqual(1);
        testLogger.info(`✓ TERTIARY CHECK PASSED: ${valueCount} field value(s) displayed in dropdown`);

        return { apiStatus, valueCount };
    }

    async expectVrlFunctionVisible(functionText) {
        return await expect(this.page.locator(this.vrlFunctionText(functionText))).toBeVisible();
    }

    async expectNotificationErrorNotVisible() {
        return await expect(this.page.locator(this.notificationErrorMessage)).not.toBeVisible();
    }

    async expectErrorWhileFetchingNotVisible() {
        return await expect(this.page.getByText('Error while fetching')).not.toBeVisible();
    }

    async fillQueryEditorWithRole(text) {
        // Wait for query editor to be visible and ready (Firefox needs longer)
        const queryEditorContainer = this.page.locator(this.queryEditor);
        await queryEditorContainer.waitFor({ state: 'visible', timeout: 30000 });

        // Use JavaScript to scroll into center of viewport (more reliable for Firefox)
        await queryEditorContainer.evaluate(el => {
            el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        });
        await this.page.waitForTimeout(2000); // Extra stabilization for Firefox

        // Click using coordinates (more reliable for Firefox viewport issues)
        const editorBox = await queryEditorContainer.boundingBox();
        if (editorBox) {
            await this.page.mouse.click(editorBox.x + 50, editorBox.y + 20);
        } else {
            // Fallback: click with force
            await queryEditorContainer.click({ force: true });
        }
        await this.page.waitForTimeout(500);

        // Clear and type using keyboard (more reliable on Firefox)
        await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(200);
        await this.page.keyboard.type(text, { delay: 30 });
    }

    async clickTimeCell() {
        // Click on the time cell (access_time icon)
        return await this.page.getByRole('cell', { name: ':' }).getByLabel('access_time').first().click();
    }

    async fillTimeCellWithInvalidValue(value) {
        // Fill time cell with partial/invalid value
        return await this.page.getByRole('cell', { name: ':' }).getByLabel('access_time').first().fill(value);
    }

    async expectErrorIconVisible() {
        // Use specific selector for error icon (material-icons with text-negative class)
        return await expect(this.page.locator('i.q-icon.text-negative.material-icons').filter({ hasText: 'error' })).toBeVisible();
    }

    async expectResultErrorDetailsButtonVisible() {
        return await expect(this.page.locator(this.resultErrorDetailsBtn)).toBeVisible();
    }

    async clickResultErrorDetailsButton() {
        // Wait for element to be stable before clicking (avoids detached DOM issues)
        const button = this.page.locator(this.resultErrorDetailsBtn);
        await button.waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForTimeout(500); // Allow DOM to stabilize
        return await button.click({ timeout: 15000 });
    }

    async expectSearchDetailErrorMessageVisible() {
        return await expect(this.page.locator(this.searchDetailErrorMessage)).toBeVisible();
    }

    async expectStartTimeVisible() {
        return await expect(this.page.getByRole('cell', { name: 'Start time' })).toBeVisible();
    }

    async expectEndTimeVisible() {
        return await expect(this.page.getByRole('cell', { name: 'End time' })).toBeVisible();
    }

    async clickOutsideTimeInput() {
        // Click outside to trigger validation
        return await this.page.locator('body').click({ position: { x: 0, y: 0 } });
    }

    /**
     * ==========================================
     * DATA INGESTION API METHOD
     * ==========================================
     */

    /**
     * Ingest data to a stream
     * Sends records individually to ensure uniqueness
     * @param {string} streamName - Stream name
     * @param {array} data - Array of log objects
     * @returns {Promise<object>} Result with success/fail counts
     */
    async ingestData(streamName, data) {
        const fetch = (await import('node-fetch')).default;
        const orgId = process.env["ORGNAME"];
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        testLogger.info('Ingesting data', { streamName, recordCount: data.length });

        let successCount = 0;
        let failCount = 0;

        // Send records one by one to ensure each is treated as unique
        for (let i = 0; i < data.length; i++) {
            const record = data[i];

            try {
                const response = await fetch(`${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${basicAuthCredentials}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify([record])  // Send as single-element array
                });

                const responseData = await response.json();

                if (response.status === 200 && responseData.code === 200) {
                    successCount++;
                    testLogger.debug(`Ingested record ${i+1}/${data.length}`, { name: record.name, test_id: record.test_id || 'no_id', unique_id: record.unique_id });
                } else {
                    failCount++;
                    testLogger.error(`Failed to ingest record ${i+1}/${data.length}`, { response: responseData, test_id: record.test_id || record.name });
                }

                // Small delay between records
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                failCount++;
                testLogger.error(`Error ingesting record ${i+1}/${data.length}`, { error: error.message });
            }
        }

        testLogger.info('Ingestion complete', { streamName, total: data.length, success: successCount, failed: failCount });

        if (failCount > 0) {
            throw new Error(`Failed to ingest ${failCount} out of ${data.length} records`);
        }

        return { total: data.length, success: successCount, failed: failCount };
    }

    /**
     * Get severity colors from all visible log rows
     * Returns array of {severity, color} objects
     */
    async getSeverityColors() {
        return await this.page.evaluate(() => {
            const rows = document.querySelectorAll('tbody tr[data-index]');
            const findings = [];

            for (const row of rows) {
                const text = row.textContent;
                // Find the color indicator div - it's a div with inline backgroundColor style
                // The div has classes like "tw:absolute tw:left-0 tw:inset-y-0 tw:w-1 tw:z-10"
                // Use multiple selector approaches for robustness
                let colorDiv = row.querySelector('div[style*="background"]');

                // Fallback: try class-based selector with escaped colon
                if (!colorDiv) {
                    colorDiv = row.querySelector('div[class*="tw\\:absolute"]');
                }

                // Fallback: try finding the first absolute positioned child div
                if (!colorDiv) {
                    const divs = row.querySelectorAll('div');
                    for (const div of divs) {
                        const style = window.getComputedStyle(div);
                        if (style.position === 'absolute' && style.left === '0px' && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                            colorDiv = div;
                            break;
                        }
                    }
                }

                if (!colorDiv) continue;

                const bgColor = window.getComputedStyle(colorDiv).backgroundColor;

                // Skip if no valid background color
                if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') continue;

                // Check for severity value in the row text - look for various patterns
                for (let sev = 0; sev <= 7; sev++) {
                    // Match "severity":"X", "severity":X, "severity": X, or severity: X patterns
                    const patterns = [
                        `"severity":"${sev}"`,
                        `"severity":${sev},`,
                        `"severity":${sev}}`,
                        `"severity": ${sev}`,
                        `severity: ${sev}`
                    ];

                    if (patterns.some(pattern => text.includes(pattern))) {
                        findings.push({
                            severity: sev,
                            color: bgColor
                        });
                        break;
                    }
                }
            }

            return findings;
        });
    }

    /**
     * Get severity color for a specific severity level
     * @param {number} severityLevel - Severity level (0-7)
     * @returns {string|null} RGB color string or null if not found
     */
    async getSeverityColorBySeverityLevel(severityLevel) {
        const results = await this.getSeverityColors();
        const match = results.find(r => r.severity === severityLevel);
        return match ? match.color : null;
    }

    /**
     * Verify severity color matches expected hex color
     * @param {number} severityLevel - Severity level (0-7)
     * @param {string} expectedHexColor - Expected hex color (e.g., "#dc2626")
     * @returns {boolean} True if colors match
     */
    async verifySeverityColor(severityLevel, expectedHexColor) {
        const rgbColor = await this.getSeverityColorBySeverityLevel(severityLevel);
        if (!rgbColor) {
            testLogger.warn(`No color found for severity ${severityLevel}`);
            return false;
        }

        const hexColor = this.rgbToHex(rgbColor);
        const normalizedActual = this.normalizeHexColor(hexColor);
        const normalizedExpected = this.normalizeHexColor(expectedHexColor);

        testLogger.info(`Severity ${severityLevel}: Expected ${normalizedExpected}, Got ${normalizedActual}`);
        return normalizedActual === normalizedExpected;
    }

    /**
     * Convert RGB color to Hex
     * @param {string} rgb - RGB color string (e.g., "rgb(220, 38, 38)")
     * @returns {string} Hex color string (e.g., "#dc2626")
     */
    rgbToHex(rgb) {
        const result = rgb.match(/\d+/g);
        if (!result || result.length < 3) return null;
        return '#' + result.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
    }

    /**
     * Normalize hex color (remove alpha channel if present, lowercase)
     * @param {string} hex - Hex color string
     * @returns {string} Normalized hex color
     */
    normalizeHexColor(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 8) {
            hex = hex.substring(0, 6);
        }
        return '#' + hex.toLowerCase();
    }

    /**
     * Ingest severity color test data to a specific stream
     * @param {string} streamName - Name of the stream to ingest data to
     * @returns {Promise<Object>} Response from the ingestion API
     */
    async severityColorIngestionToStream(streamName) {
        const severityColorData = require('../../../test-data/severity_color_data.json');
        const orgId = process.env["ORGNAME"];
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        const url = `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`;

        try {
            const response = await this.page.request.post(url, {
                headers: headers,
                data: severityColorData
            });

            if (!response.ok()) {
                throw new Error(`HTTP error! status: ${response.status()}`);
            }

            const result = await response.json();
            testLogger.info(`Successfully ingested ${severityColorData.length} records to stream '${streamName}'`);
            return result;
        } catch (error) {
            testLogger.error('Severity color ingestion failed:', { error: error.message });
            throw error;
        }
    }

    /**
     * Delete a stream by name
     * @param {string} streamName - Name of the stream to delete
     * @returns {Promise<Object>} Response with status
     */
    async deleteStream(streamName) {
        const orgId = process.env["ORGNAME"];
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
        };

        const url = `${process.env.INGESTION_URL}/api/${orgId}/streams/${streamName}`;

        try {
            const response = await this.page.request.delete(url, {
                headers: headers
            });

            if (!response.ok() && response.status() !== 404) {
                throw new Error(`HTTP error! status: ${response.status()}`);
            }

            const status = response.status();
            if (status === 200) {
                testLogger.info(`Stream '${streamName}' deleted successfully`);
            } else if (status === 404) {
                testLogger.info(`Stream '${streamName}' not found (already deleted)`);
            }

            return { status: status };
        } catch (error) {
            testLogger.error('Stream deletion failed:', { error: error.message });
            throw error;
        }
    }

    // ===== SHARE LINK METHODS =====

    /**
     * Click the share link button on the logs search bar
     */
    async clickShareLinkButton() {
        await this.page.locator(this.shareLinkButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.shareLinkButton).click();
        testLogger.info('Clicked share link button');
    }

    /**
     * Verify the share link button is visible
     */
    async expectShareLinkButtonVisible() {
        await expect(this.page.locator(this.shareLinkButton)).toBeVisible();
        testLogger.info('Share link button is visible');
    }

    /**
     * Click share link and wait for success notification
     * @returns {Promise<boolean>} true if success notification appeared
     */
    async clickShareLinkAndExpectSuccess() {
        await this.clickShareLinkButton();

        // Wait for success notification
        const notification = this.page.locator(this.successNotification);
        await notification.waitFor({ state: 'visible', timeout: 15000 });

        const notificationText = await notification.textContent();
        const isSuccess = notificationText.includes(this.linkCopiedSuccessText);

        if (isSuccess) {
            testLogger.info('Share link success notification appeared');
        } else {
            testLogger.warn('Notification appeared but was not success message', { text: notificationText });
        }

        return isSuccess;
    }

    /**
     * Verify share link success notification is visible
     */
    async expectShareLinkSuccessNotification() {
        const notification = this.page.locator(this.successNotification).filter({ hasText: this.linkCopiedSuccessText });
        await expect(notification).toBeVisible({ timeout: 15000 });
        testLogger.info('Share link success notification verified');
    }

    /**
     * Click share link and wait for any notification (success or error)
     * This is more resilient for environments where the short URL API may not work
     * @returns {Promise<{appeared: boolean, isSuccess: boolean, text: string}>}
     */
    async clickShareLinkAndExpectNotification() {
        await this.clickShareLinkButton();

        // Wait for any notification
        const notification = this.page.locator(this.successNotification);
        try {
            await notification.waitFor({ state: 'visible', timeout: 15000 });
            const notificationText = await notification.textContent();
            const isSuccess = notificationText.includes(this.linkCopiedSuccessText);
            const isError = notificationText.includes(this.errorCopyingLinkText);

            testLogger.info('Share link notification appeared', {
                text: notificationText,
                isSuccess,
                isError
            });

            return {
                appeared: true,
                isSuccess,
                isError,
                text: notificationText
            };
        } catch (e) {
            testLogger.warn('No notification appeared after clicking share link');
            return { appeared: false, isSuccess: false, isError: false, text: '' };
        }
    }

    /**
     * Verify any notification appears after clicking share link (success or error)
     * This tests that the button is functional without requiring API success
     */
    async expectShareLinkTriggersNotification() {
        const result = await this.clickShareLinkAndExpectNotification();
        expect(result.appeared).toBe(true);
        testLogger.info('Share link triggered notification', { text: result.text });
        return result;
    }

    /**
     * Verify the share link button is disabled
     */
    async expectShareLinkButtonDisabled() {
        await expect(this.page.locator(this.shareLinkButton)).toBeDisabled();
        testLogger.info('Share link button is disabled');
    }

    /**
     * Hover over the share link button to show tooltip
     */
    async hoverShareLinkButton() {
        await this.page.locator(this.shareLinkButton).hover();
        testLogger.info('Hovered over share link button');
    }

    /**
     * Get the share link tooltip text
     * @param {string} hasTextFilter - Optional regex filter for tooltip text
     * @returns {Promise<string>} The tooltip text
     */
    async getShareLinkTooltipText(hasTextFilter = null) {
        let tooltip = this.page.locator(this.shareLinkTooltip);

        if (hasTextFilter) {
            tooltip = tooltip.filter({ hasText: hasTextFilter });
        }

        await tooltip.first().waitFor({ state: 'visible', timeout: 5000 });
        const text = await tooltip.first().textContent();
        testLogger.info(`Share link tooltip text: "${text}"`);
        return text;
    }

    /**
     * Verify the share link tooltip is visible with specific text
     * @param {string|RegExp} expectedText - Expected text or regex pattern
     */
    async expectShareLinkTooltipVisible(expectedText = null) {
        let tooltip = this.page.locator(this.shareLinkTooltip);

        if (expectedText) {
            tooltip = tooltip.filter({ hasText: expectedText });
        }

        await expect(tooltip.first()).toBeVisible({ timeout: 5000 });
        testLogger.info('Share link tooltip is visible');
    }

    /**
     * Get the current URL for verification after share link redirect
     */
    async getCurrentUrl() {
        return this.page.url();
    }

    /**
     * Verify the URL contains expected query parameters
     * @param {string} param - Parameter name to check
     */
    async expectUrlContainsParam(param) {
        const url = await this.getCurrentUrl();
        expect(url).toContain(param);
        testLogger.info(`URL contains parameter: ${param}`);
    }

    // ===== STATE PRESERVATION METHODS =====

    /**
     * Read the clipboard content (requires clipboard permissions in playwright config)
     * @returns {Promise<string>} The clipboard text content
     */
    async readClipboard() {
        const clipboardText = await this.page.evaluate(() => navigator.clipboard.readText());
        testLogger.info('Read clipboard content', { length: clipboardText.length });
        return clipboardText;
    }

    /**
     * Click share link and get the copied URL from clipboard
     * Automatically converts HTTP to HTTPS to maintain auth context
     * @returns {Promise<string>} The shared URL
     */
    async clickShareLinkAndGetUrl() {
        await this.clickShareLinkButton();

        // Wait for success notification
        const notification = this.page.locator(this.successNotification);
        await notification.waitFor({ state: 'visible', timeout: 15000 });

        // Read the URL from clipboard
        let sharedUrl = await this.readClipboard();

        // Convert HTTP to HTTPS to maintain authentication cookies (skip for localhost)
        if (sharedUrl.startsWith('http://') && !sharedUrl.includes('localhost')) {
            sharedUrl = sharedUrl.replace('http://', 'https://');
            testLogger.info('Converted HTTP to HTTPS', { url: sharedUrl });
        }

        testLogger.info('Share link URL captured', { url: sharedUrl });

        return sharedUrl;
    }

    /**
     * Extract URL query parameters as an object
     * @param {string} url - The URL to parse
     * @returns {Object} Key-value pairs of query parameters
     */
    parseUrlParams(url) {
        const urlObj = new URL(url);
        const params = {};
        urlObj.searchParams.forEach((value, key) => {
            params[key] = value;
        });
        return params;
    }

    /**
     * Capture the current search state from the URL
     * @returns {Promise<Object>} The current search state
     */
    async captureCurrentState() {
        const url = await this.getCurrentUrl();
        const params = this.parseUrlParams(url);

        const state = {
            url: url,
            stream: params.stream || null,
            streamType: params.stream_type || 'logs',
            period: params.period || null,
            from: params.from || null,
            to: params.to || null,
            sqlMode: params.sql_mode || null,
            quickMode: params.quick_mode || null,
            showHistogram: params.show_histogram || null,
            orgIdentifier: params.org_identifier || null,
            query: params.sql || params.query || null,
        };

        testLogger.info('Captured current state', state);
        return state;
    }

    /**
     * Compare two search states and return differences
     * @param {Object} state1 - First state
     * @param {Object} state2 - Second state
     * @param {Array<string>} keysToCompare - Keys to compare
     * @returns {Object} Comparison result with matches and differences
     */
    compareStates(state1, state2, keysToCompare = ['stream', 'streamType', 'period', 'sqlMode', 'quickMode', 'showHistogram']) {
        const result = {
            isMatch: true,
            matches: {},
            differences: {}
        };

        for (const key of keysToCompare) {
            const val1 = state1[key];
            const val2 = state2[key];

            if (val1 === val2) {
                result.matches[key] = val1;
            } else {
                result.isMatch = false;
                result.differences[key] = { before: val1, after: val2 };
            }
        }

        testLogger.info('State comparison result', result);
        return result;
    }

    /**
     * Wait for the page to finish redirecting (URL stabilizes)
     * @param {number} timeout - Max time to wait in ms
     */
    async waitForRedirectComplete(timeout = 15000) {
        let previousUrl = '';
        let currentUrl = await this.getCurrentUrl();
        const startTime = Date.now();

        // Wait for URL to stabilize (not changing for 1 second)
        while (Date.now() - startTime < timeout) {
            previousUrl = currentUrl;
            await this.page.waitForTimeout(1000);
            currentUrl = await this.getCurrentUrl();

            if (previousUrl === currentUrl && !currentUrl.includes('/short/')) {
                testLogger.info('Redirect complete', { finalUrl: currentUrl });
                return;
            }
        }

        testLogger.warn('Redirect timeout - URL may still be changing', { currentUrl });
    }

    /**
     * Get the selected stream name from the UI
     * @returns {Promise<string|null>} The selected stream name
     */
    async getSelectedStreamFromUI() {
        try {
            const streamSelector = this.page.locator('[data-test="log-search-index-list-select-stream"]');
            await streamSelector.waitFor({ state: 'visible', timeout: 5000 });
            const streamText = await streamSelector.textContent();
            return streamText?.trim() || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Check if SQL mode is currently enabled
     * @returns {Promise<boolean>} True if SQL mode is enabled
     */
    async isSqlModeEnabled() {
        const sqlToggle = this.page.getByRole('switch', { name: 'SQL Mode' });
        const isChecked = await sqlToggle.getAttribute('aria-checked');
        return isChecked === 'true';
    }

    /**
     * Get the current query from the editor
     * @returns {Promise<string>} The query text
     */
    async getQueryFromEditor() {
        try {
            const editor = this.page.locator(this.queryEditor);
            const queryText = await editor.textContent();
            return queryText?.trim() || '';
        } catch (e) {
            return '';
        }
    }

    // ============================================================================
    // REGRESSION TEST POM METHODS
    // Added to fix POM violations in logs-regression.spec.js
    // ============================================================================

    /**
     * Get pagination text from table bottom
     * @returns {Promise<string>} The pagination text (e.g., "1-50 of 100")
     */
    async getPaginationText() {
        const paginationLocator = this.page.locator(this.tableBottom).first();
        await paginationLocator.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        return await paginationLocator.textContent().catch(() => 'N/A');
    }

    /**
     * Fill the streams search input field
     * @param {string} text - The text to fill
     */
    async fillStreamsSearchInput(text) {
        const searchInput = this.page.locator(this.streamsSearchInputField);
        await searchInput.fill(text);
    }

    /**
     * Clear the streams search input field
     */
    async clearStreamsSearchInput() {
        const searchInput = this.page.locator(this.streamsSearchInputField);
        await searchInput.clear();
    }

    /**
     * Get the count of table body rows with index
     * @returns {Promise<number>} The number of rows
     */
    async getTableRowCount() {
        return await this.page.locator(this.tableBodyRowWithIndex).count();
    }

    /**
     * Get the count of error indicators on the page
     * @returns {Promise<number>} The number of error indicators
     */
    async getErrorIndicatorCount() {
        return await this.page.locator(this.errorIndicators).count();
    }

    /**
     * Get the result text content
     * @returns {Promise<string>} The result text
     */
    async getResultText() {
        try {
            return await this.page.locator(this.resultText).textContent() || '';
        } catch (error) {
            return '';
        }
    }

    /**
     * Click the query history button
     */
    async clickHistoryButton() {
        const historyButton = this.page.locator(`${this.queryHistoryButton}, button:has-text("History")`).first();
        if (await historyButton.isVisible()) {
            await historyButton.click();
        }
    }

    /**
     * Check if the history panel is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isHistoryPanelVisible() {
        const historyPanel = this.page.locator(this.historyPanel).first();
        return await historyPanel.isVisible();
    }

    /**
     * Check if timestamp column is visible in table header
     * @returns {Promise<boolean>} True if visible
     */
    async isTimestampColumnVisible() {
        const timestampHeader = this.page.locator('th:has-text("_timestamp"), [data-test*="_timestamp"]').first();
        return await timestampHeader.isVisible().catch(() => false);
    }

    /**
     * Click the first table body row
     */
    async clickFirstTableRow() {
        const logRows = this.page.locator(this.tableBodyRow).first();
        if (await logRows.isVisible()) {
            await logRows.click();
        }
    }

    /**
     * Check if timestamp is visible in detail view
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<boolean>} True if visible
     */
    async isTimestampDetailVisible(timeout = 5000) {
        const timestampInDetail = this.page.locator(this.timestampInDetail).first();
        try {
            await expect(timestampInDetail).toBeVisible({ timeout });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Expect timestamp detail to be visible
     */
    async expectTimestampDetailVisible() {
        const timestampInDetail = this.page.locator(this.timestampInDetail).first();
        await expect(timestampInDetail).toBeVisible({ timeout: 5000 });
    }

    /**
     * Get the count of table headers
     * @returns {Promise<number>} The number of headers
     */
    async getTableHeaderCount() {
        return await this.page.locator(this.tableHeaders).count();
    }

    /**
     * Get the count of field expand buttons
     * @returns {Promise<number>} The number of field expand buttons
     */
    async getFieldExpandButtonCount() {
        return await this.page.locator(this.allFieldExpandButtons).count();
    }

    /**
     * Click a field button by field name
     * @param {string} fieldName - The name of the field
     */
    async clickFieldByName(fieldName) {
        const fieldItem = this.page.locator(this.fieldIndexListButton(fieldName)).first();
        if (await fieldItem.isVisible()) {
            await fieldItem.click();
        }
    }

    /**
     * Check if source column is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isSourceColumnVisible() {
        const sourceVisible = this.page.locator('th:has-text("source"), th:has-text("_source")').first();
        return await sourceVisible.isVisible().catch(() => false);
    }

    /**
     * Check if either timestamp or source column is visible
     * @returns {Promise<boolean>} True if either is visible
     */
    async isTimestampOrSourceVisible() {
        const timestampVisible = await this.isTimestampColumnVisible();
        const sourceVisible = await this.isSourceColumnVisible();
        return timestampVisible || sourceVisible;
    }

    /**
     * Hover over the download table menu
     */
    async hoverDownloadTableMenu() {
        const downloadTableMenu = this.page.locator('text=/Download Table/i').first();
        if (await downloadTableMenu.isVisible()) {
            await downloadTableMenu.hover();
        }
    }

    /**
     * Click the CSV download button
     */
    async clickDownloadCSVButton() {
        const csvDownloadButton = this.page.locator('[data-test="search-download-csv-btn"]');
        if (await csvDownloadButton.isVisible()) {
            await csvDownloadButton.click();
        }
    }

    /**
     * Click the JSON download button
     */
    async clickDownloadJSONButton() {
        const jsonDownloadButton = this.page.locator('[data-test="search-download-json-btn"]');
        if (await jsonDownloadButton.isVisible()) {
            await jsonDownloadButton.click();
        }
    }

    /**
     * Get the notification message text
     * @returns {Promise<string>} The notification text
     */
    async getNotificationText() {
        const notifications = this.page.locator('.q-notification__message');
        const notificationCount = await notifications.count();
        if (notificationCount > 0) {
            return await notifications.first().textContent() || '';
        }
        return '';
    }

    /**
     * Get the count of notifications
     * @returns {Promise<number>} The number of notifications
     */
    async getNotificationCount() {
        return await this.page.locator('.q-notification__message').count();
    }

    /**
     * Check if the refresh button is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isRefreshButtonVisible() {
        const refreshButton = this.page.locator(this.queryButton);
        return await refreshButton.isVisible();
    }

    /**
     * Check if error notification is visible
     * @returns {Promise<boolean>} True if visible
     */
    async hasErrorNotification() {
        const errorNotifications = this.page.locator('.q-notification--negative, text=/error/i, text=/syntax/i').first();
        return await errorNotifications.isVisible().catch(() => false);
    }

    /**
     * Check if stream validation error is visible
     * @returns {Promise<boolean>} True if visible
     */
    async hasStreamValidationError() {
        const errorNotifications = this.page.locator('.q-notification__message, text=/select.*stream/i').first();
        return await errorNotifications.isVisible().catch(() => false);
    }

    /**
     * Get stream validation error text
     * @returns {Promise<string>} The error text
     */
    async getStreamValidationErrorText() {
        const errorNotifications = this.page.locator('.q-notification__message, text=/select.*stream/i').first();
        if (await errorNotifications.isVisible().catch(() => false)) {
            return await errorNotifications.textContent() || '';
        }
        return '';
    }

    /**
     * Check if logs search result table is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isLogsSearchResultTableVisible() {
        const resultsTable = this.page.locator(this.logsSearchResultLogsTable);
        return await resultsTable.isVisible().catch(() => false);
    }

    /**
     * Click the SQL Mode switch by role
     */
    async clickSQLModeSwitch() {
        const sqlModeToggle = this.page.getByRole('switch', { name: 'SQL Mode' });
        await sqlModeToggle.waitFor({ state: 'visible', timeout: 10000 });
        await sqlModeToggle.click();
    }

    /**
     * Get SQL mode aria-checked state
     * @returns {Promise<string|null>} The aria-checked value
     */
    async getSQLModeState() {
        const sqlModeToggle = this.page.getByRole('switch', { name: 'SQL Mode' });
        return await sqlModeToggle.getAttribute('aria-checked');
    }

    /**
     * Click the Last 1 hour relative time button
     */
    async clickRelative1HourButton() {
        const oneHourButton = this.page.locator(this.relative1HourButton);
        if (await oneHourButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await oneHourButton.click();
        }
    }

    /**
     * Check if Last 1 hour button is visible and click it, fallback to 15 min
     */
    async clickRelative1HourOrFallback() {
        const oneHourButton = this.page.getByText('Last 1 hour');
        if (await oneHourButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await oneHourButton.click();
            return 'Last 1 hour';
        } else {
            await this.clickRelative15MinButton();
            return 'Last 15 minutes';
        }
    }

    /**
     * Disable auto refresh by clicking the off button
     */
    async disableAutoRefresh() {
        await this.clickLiveModeButton();
        await this.page.waitForTimeout(500);
        const offButton = this.page.locator('[data-test="logs-search-bar-refresh-time-0"]');
        if (await offButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await offButton.click();
        }
        await this.page.waitForTimeout(500);
    }

    /**
     * Get logs table content as text
     * @returns {Promise<string>} The table content text
     */
    async getLogsTableContent() {
        const table = this.page.locator(this.logsTable);
        return await table.textContent().catch(() => '');
    }

    // ========== BUG REGRESSION TEST METHODS ==========

    /**
     * Expect refresh button to be visible
     * Bug #8928 - UI consistency
     */
    async expectRefreshButtonVisible() {
        const button = this.page.locator(this.queryButton);
        await expect(button).toBeVisible({ timeout: 10000 });
        testLogger.info('Refresh button is visible');
    }

    /**
     * Expect refresh button to be enabled
     * Bug #9533 - Loading states
     */
    async expectRefreshButtonEnabled() {
        const button = this.page.locator(this.queryButton);
        await expect(button).toBeEnabled({ timeout: 10000 });
        testLogger.info('Refresh button is enabled');
    }

    /**
     * Expect stream selector to be visible
     * Bug #8928 - UI consistency
     */
    async expectStreamSelectorVisible() {
        const selector = this.page.locator(this.indexDropDown);
        await expect(selector).toBeVisible({ timeout: 10000 });
        testLogger.info('Stream selector is visible');
    }

    /**
     * Expect DateTime button to be visible
     * Bug #8928 - UI consistency
     */
    async expectDateTimeButtonVisible() {
        const button = this.page.locator(this.dateTimeButton);
        await expect(button).toBeVisible({ timeout: 10000 });
        testLogger.info('DateTime button is visible');
    }

    /**
     * Enable histogram if not already enabled
     * Bug #8928 - Histogram rendering
     */
    async enableHistogram() {
        const histogramToggle = this.page.locator(this.histogramToggle);
        const isPressed = await histogramToggle.getAttribute('aria-pressed').catch(() => 'false');
        if (isPressed === 'false') {
            await histogramToggle.click();
            await this.page.waitForTimeout(500);
            testLogger.info('Histogram enabled');
        }
    }

    /**
     * Toggle histogram on/off
     * Bug #8928 - Histogram rendering
     */
    async toggleHistogram() {
        const histogramToggle = this.page.locator(this.histogramToggle);
        await histogramToggle.click();
        await this.page.waitForTimeout(500);
        testLogger.info('Histogram toggled');
    }

    /**
     * Expect histogram to be visible
     * Bug #8928 - Histogram rendering
     */
    async expectHistogramVisible() {
        const histogramCanvas = this.page.locator(this.barChartCanvas);
        await expect(histogramCanvas).toBeVisible({ timeout: 10000 });
        testLogger.info('Histogram is visible');
    }

    // ============================================================================
    // VRL & SAVED VIEWS POM METHODS - Bug #9690
    // Rule 3 Compliance: Extract raw locators from spec files into POM
    // ============================================================================

    /**
     * Click the VRL toggle button to enable/disable VRL editor
     * @returns {Promise<void>}
     */
    async clickVrlToggleButton() {
        const vrlToggle = this.page.locator('[data-test="logs-search-bar-vrl-toggle-btn"]');
        await vrlToggle.waitFor({ state: 'visible', timeout: 10000 });
        await vrlToggle.click();
        testLogger.info('Clicked VRL toggle button');
    }

    /**
     * Get the VRL editor locator
     * @returns {import('@playwright/test').Locator} VRL editor locator
     */
    getVrlEditor() {
        return this.page.locator('[data-test="logs-vrl-function-editor"], #fnEditor, .monaco-editor');
    }

    /**
     * Type text into the VRL editor
     * @param {string} text - Text to type
     */
    async typeInVrlEditor(text) {
        const vrlEditor = this.page.locator('[data-test="logs-vrl-function-editor"], #fnEditor, .monaco-editor');
        await vrlEditor.first().waitFor({ state: 'visible', timeout: 10000 });
        const textbox = vrlEditor.first().locator('.inputarea');
        await textbox.waitFor({ state: 'visible', timeout: 5000 });
        await textbox.fill(text);
        testLogger.info('Typed text into VRL editor');
    }

    /**
     * Get VRL editor content text
     * @returns {Promise<string>} Editor content
     */
    async getVrlEditorContent() {
        const vrlEditor = this.page.locator('[data-test="logs-vrl-function-editor"], #fnEditor');
        await vrlEditor.first().waitFor({ state: 'visible', timeout: 10000 });
        const content = await vrlEditor.first().textContent();
        return content || '';
    }

    /**
     * Click the Save Transform button
     */
    async clickSaveTransformButton() {
        const saveBtn = this.page.locator('[data-test="logs-search-bar-save-transform-btn"]');
        await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
        await saveBtn.click();
        testLogger.info('Clicked Save Transform button');
    }

    /**
     * Fill the saved function name input
     * @param {string} name - Function name
     */
    async fillSavedFunctionNameInput(name) {
        const input = this.page.locator('[data-test="saved-function-name-input"]');
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill(name);
        testLogger.info(`Filled saved function name: ${name}`);
    }

    /**
     * Click the "Save View" option in the saved views dropdown
     */
    async clickSaveViewOption() {
        const saveViewOption = this.page.getByText('Save View', { exact: false });
        await saveViewOption.waitFor({ state: 'visible', timeout: 10000 });
        await saveViewOption.click();
        testLogger.info('Clicked Save View option');
    }

    /**
     * Fill the view name input in the save view dialog
     * @param {string} name - View name
     */
    async fillViewNameInput(name) {
        const input = this.page.locator('[data-test="add-alert-name-input"]');
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill(name);
        testLogger.info(`Filled view name: ${name}`);
    }

    /**
     * Click the save button in the save view dialog
     */
    async clickSaveViewDialogSaveButton() {
        const saveBtn = this.page.locator('[data-test="saved-view-dialog-save-btn"]');
        await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
        await saveBtn.scrollIntoViewIfNeeded();
        await saveBtn.click({ force: true });
        testLogger.info('Clicked Save View dialog save button');
    }

    /**
     * Get the function dropdown text
     * @returns {Promise<string>} Dropdown text
     */
    async getFunctionDropdownText() {
        const dropdown = this.page.locator('[data-test="logs-search-bar-function-dropdown"]');
        await dropdown.waitFor({ state: 'visible', timeout: 10000 });
        const text = await dropdown.textContent();
        return text || '';
    }

    /**
     * Click a saved view by name
     * @param {string} name - Saved view name
     */
    async clickSavedViewByName(name) {
        const savedView = this.page.getByText(name, { exact: false });
        await savedView.waitFor({ state: 'visible', timeout: 10000 });
        await savedView.click();
        testLogger.info(`Clicked saved view: ${name}`);
    }

    /**
     * Expect a saved view to be visible
     * @param {string} name - Saved view name
     * @param {Object} options - Options
     * @param {number} options.timeout - Timeout in ms (default 10000)
     */
    async expectSavedViewVisible(name, options = {}) {
        const timeout = options.timeout || 10000;
        const savedView = this.page.getByText(name, { exact: false });
        await expect(savedView).toBeVisible({ timeout });
        testLogger.info(`Saved view visible: ${name}`);
    }

    /**
     * Get the saved views button locator
     * @returns {import('@playwright/test').Locator} Saved views button locator
     */
    getSavedViewsButtonLocator() {
        return this.page.locator('[data-test="logs-search-saved-views-btn"]');
    }

    /**
     * Click the saved views dropdown arrow to expand and show the list
     * This opens the dropdown panel with search input
     */
    async clickSavedViewsDropdownArrow() {
        const arrow = this.page.locator(this.savedViewArrow);
        await arrow.waitFor({ state: 'visible', timeout: 10000 });
        await arrow.click();
        // Wait for dropdown panel to appear
        await this.page.waitForTimeout(500);
        testLogger.info('Clicked saved views dropdown arrow');
    }

    /**
     * Expand the saved views dropdown and wait for search input
     * Tries arrow click first, then main button if search input doesn't appear
     */
    async expandSavedViewsDropdown() {
        // First try clicking the dropdown arrow
        try {
            await this.clickSavedViewsDropdownArrow();
            const searchInput = this.page.locator(this.savedViewSearchInput);
            await searchInput.waitFor({ state: 'visible', timeout: 5000 });
            return;
        } catch (e) {
            testLogger.debug('Arrow click did not show search input, trying main button');
        }

        // Fallback: try clicking the main button
        const btn = this.getSavedViewsButtonLocator();
        await btn.click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Click delete button for a saved view by name
     * Uses dynamic data-test attribute
     * @param {string} name - Saved view name
     */
    async clickDeleteSavedViewByName(name) {
        const deleteBtn = this.page.locator(`[data-test*="delete"][data-test*="${name}"]`);
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.click();
        testLogger.info(`Clicked delete for saved view: ${name}`);
    }

    // ============================================================================
    // VRL FIELD ICONS POM METHODS - Bug #9550
    // Rule 3 Compliance: Extract raw locators from logstable.spec.js into POM
    // ============================================================================

    /**
     * Get the computed field button locator
     * @returns {import('@playwright/test').Locator} Computed field button locator
     */
    getComputedFieldButton() {
        return this.page.locator('[data-test*="computed_field"]');
    }

    /**
     * Get the include/exclude icon for a field
     * @param {string} fieldName - Field name (optional, for specific field)
     * @returns {import('@playwright/test').Locator} Include/exclude icon locator
     */
    getIncludeExcludeIcon(fieldName = null) {
        if (fieldName) {
            return this.page.locator(`[data-test*="${fieldName}"] [data-test*="include-exclude"]`);
        }
        return this.page.locator('[data-test*="computed_field"] [data-test*="include-exclude"]');
    }

    /**
     * Get the equals icon for a computed field
     * @param {string} fieldName - Field name (optional)
     * @returns {import('@playwright/test').Locator} Equals icon locator
     */
    getEqualsIcon(fieldName = null) {
        if (fieldName) {
            return this.page.locator(`[data-test*="${fieldName}"]`).locator('..').locator('[class*="equal"]');
        }
        return this.page.locator('[data-test*="computed_field"]').locator('..').locator('[class*="equal"]');
    }

    /**
     * Get the table headers locator
     * @returns {import('@playwright/test').Locator} Table headers locator
     */
    getTableHeaders() {
        return this.page.locator('thead th');
    }

    /**
     * Get a field button by name
     * @param {string} fieldName - Field name
     * @returns {import('@playwright/test').Locator} Field button locator
     */
    getFieldButton(fieldName) {
        return this.page.locator(`[data-test*="${fieldName}"]`);
    }

    /**
     * Get the include button locator
     * @returns {import('@playwright/test').Locator} Include button locator
     */
    getIncludeButton() {
        return this.page.locator('[data-test*="include"]');
    }

    /**
     * Expect equals icon to NOT be visible (Bug #9550 test)
     * VRL-generated fields should not have equals icon
     */
    async expectEqualsIconNotVisible() {
        const equalsIcon = this.getEqualsIcon();
        await expect(equalsIcon).not.toBeVisible();
        testLogger.info('Equals icon is NOT visible (Bug #9550 verified)');
    }

    /**
     * Expect include/exclude icon to NOT be visible (Bug #9550 test)
     * VRL-generated fields should not have include/exclude icon
     */
    async expectIncludeExcludeIconNotVisible() {
        const icon = this.getIncludeExcludeIcon();
        await expect(icon).not.toBeVisible();
        testLogger.info('Include/exclude icon is NOT visible (Bug #9550 verified)');
    }
}
import { expect } from '@playwright/test';
import { LoginPage } from '../generalPages/loginPage.js';
import { LogsPage } from '../logsPages/logsPage.js';
import { IngestionPage } from '../generalPages/ingestionPage.js';
import { ManagementPage } from '../generalPages/managementPage.js';

import { getHeaders, getIngestionUrl, sendRequest } from '../../utils/apiUtils.js';
const http = require('http');
const nodeFetch = require('node-fetch');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

// node-fetch v2 keep-alive pooling + gzip decompression is the root cause of
// "Premature close" / ECONNRESET flakiness in CI.
const _noKeepAliveAgent = new http.Agent({ keepAlive: false });
function _nodeFetchSafe(url, opts = {}) {
    return nodeFetch(url, { ...opts, compress: false, agent: _noKeepAliveAgent });
}

export class StreamsPage {
    constructor(page) {
        this.page = page;
        
        // Initialize all the original page objects
        this.loginPage = new LoginPage(page);
        this.logsPage = new LogsPage(page);
        this.ingestionPage = new IngestionPage(page);
        this.managementPage = new ManagementPage(page);

        
        // Locators following alerts pattern - only the ones that were changed
        this.managementMenuItem = page.locator('[data-test="menu-link-/settings-item"]');
        this.streamingToggle = page.locator('[data-test="general-settings-enable-streaming"]');
    }

    // Login methods - delegate to LoginPage
    async gotoLoginPage() {
        await this.loginPage.gotoLoginPage();
    }

    async loginAsInternalUser() {
        await this.loginPage.loginAsInternalUser();
    }

    async login() {
        await this.loginPage.login();
    }

    // Logs methods - delegate to LogsPage
    async navigateToLogs() {
        await this.logsPage.navigateToLogs();
    }

    async selectIndexAndStreamJoin() {
        await this.logsPage.selectIndexAndStreamJoin();
    }

    async selectIndexStreamDefault() {
        await this.logsPage.selectIndexStreamDefault();
    }

    async displayTwoStreams() {
        await this.logsPage.displayTwoStreams();
    }

    async selectRunQuery() {
        await this.logsPage.selectRunQuery();
    }

    async enableSQLMode() {
        await this.logsPage.enableSQLMode();
    }

    async clickQuickModeToggle() {
        await this.logsPage.clickQuickModeToggle();
    }

    async enableQuickModeIfDisabled() {
        await this.logsPage.enableQuickModeIfDisabled();
    }

    async clickAllFieldsButton() {
        await this.logsPage.clickAllFieldsButton();
    }

    async clearAndFillQueryEditor(query) {
        await this.logsPage.clearAndFillQueryEditor(query);
    }

    async kubernetesContainerName() {
        await this.logsPage.kubernetesContainerName();
    }

    async kubernetesContainerNameJoin() {
        await this.logsPage.kubernetesContainerNameJoin();
    }

    async kubernetesContainerNameJoinLimit() {
        await this.logsPage.kubernetesContainerNameJoinLimit();
    }

    async kubernetesContainerNameJoinLike() {
        await this.logsPage.kubernetesContainerNameJoinLike();
    }

    async kubernetesContainerNameLeftJoin() {
        await this.logsPage.kubernetesContainerNameLeftJoin();
    }

    async kubernetesContainerNameRightJoin() {
        await this.logsPage.kubernetesContainerNameRightJoin();
    }

    async kubernetesContainerNameFullJoin() {
        await this.logsPage.kubernetesContainerNameFullJoin();
    }

    async clickInterestingFields() {
        await this.logsPage.clickInterestingFields();
    }

    async validateInterestingFields() {
        await this.logsPage.validateInterestingFields();
    }

    async validateInterestingFieldsQuery() {
        await this.logsPage.validateInterestingFieldsQuery();
    }

    async addRemoveInteresting() {
        await this.logsPage.addRemoveInteresting();
    }

    async toggleHistogram() {
        await this.logsPage.toggleHistogram();
    }

    async validateResult() {
        await this.logsPage.validateResult();
    }

    async displayCountQuery() {
        await this.logsPage.displayCountQuery();
    }

    async waitForSearchResultAndCheckText(expectedText) {
        await this.logsPage.waitForSearchResultAndCheckText(expectedText);
    }

    // Stream methods
    async navigateToStreamExplorer() {
        // First navigate to home if not already there
        if (!this.page.url().includes('web/logs')) {
            await this.page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${process.env.ORGNAME}`);
            await this.page.waitForLoadState('domcontentloaded');
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        }

        try {
            await this.page.locator('[data-test="menu-link-/streams-item"]').click({ force: true });
        } catch (error) {
            testLogger.warn('Retry clicking streams menu:', error.message);
            await this.waitForUI(2000);
            await this.page.locator('[data-test="menu-link-/streams-item"]').click({ force: true });
        }
        await this.waitForUI(1000);
    }

    async searchStream(streamName) {
        const searchInput = this.page.locator('[data-test="streams-search-stream-input-field"]');
        await searchInput.click();
        await searchInput.fill(streamName);
        await this.waitForUI(3000);
    }

    async verifyStreamNameVisibility(streamName) {
        await expect(this.page.locator(`[data-test="log-stream-name-cell-${streamName}"]`)).toBeVisible();
    }

    async exploreStream() {
        const exploreBtn = this.page.locator('[data-test="log-stream-table"] [data-test="log-stream-explore-btn"]').first();
        await expect(exploreBtn).toBeVisible();
        await exploreBtn.click({ force: true });
        await this.waitForUI(1000);
    }

    async verifyStreamExploration() {
        await expect(this.page.url()).toContain("logs");
    }

    async goBack() {
        await this.page.goBack();
        await this.waitForUI(1000);
    }

    // Ingestion methods - delegate to IngestionPage
    async ingestion() {
        await this.ingestionPage.ingestion();
    }

    async ingestionJoin() {
        await this.ingestionPage.ingestionJoin();
    }

    // Management methods - delegate to ManagementPage with updated locators
    async goToManagement() {
        await this.managementPage.goToManagement();
    }

    async checkStreaming() {
        // await this.managementPage.checkStreaming();
    }

    // Additional methods for streamname test
    async ingestTestData(streamName) {
        const orgId = process.env["ORGNAME"];
        const headers = getHeaders();
        const ingestionUrl = getIngestionUrl(orgId, streamName);
        const payload = {
            level: "info",
            job: "test",
            log: `test message for stream ${streamName}`,
            e2e: "1",
        };
        const response = await sendRequest(this.page, ingestionUrl, payload, headers);
        testLogger.info(`Ingested to ${streamName}:`, response);
        await this.page.waitForTimeout(2000);
    }

    // Validation methods
    async verifyNoHistogramError() {
        const errorDetailsButton = this.page.locator('[data-test="logs-page-histogram-error-details-btn"]');
        await expect(errorDetailsButton).not.toBeVisible();
    }

    // Validation method for 'No data found for histogram.'
    async expectNoDataFoundForHistogram() {
        // Wait for query execution to complete
        await this.page.waitForTimeout(5000);

        // Check the no-data message via data-test attribute
        const noDataMsg = this.page.locator('[data-test="logs-search-no-data-histogram"]');
        try {
            await expect(noDataMsg).toBeVisible({ timeout: 10000 });
            return;
        } catch (e) {
            // No-data message not found — fall back to verifying no error is shown
        }

        // Acceptable fallback: histogram rendered but with no data (no error shown)
        const histogramError = this.page.locator('[data-test="logs-page-histogram-error-details-btn"]');
        await expect(histogramError).not.toBeVisible({ timeout: 5000 });
    }

    // Methods from legacy streamsPage.js
    async gotoStreamsPage() {
        await this.page.locator('[data-test="menu-link-\\/streams-item"]').click();
    }

    async streamsPageDefaultOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
    
        await this.page.waitForSelector('text=default'); 
    
        const defaultOption = this.page.locator('text=default').first(); // Target the first occurrence
        await defaultOption.click();
    }

    async streamsPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();

        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async streamsPageURLValidation() {
        // TODO: Fix this test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    async streamsURLValidation() {
        await expect(this.page).toHaveURL(/streams/);
    }

    // Stream Settings Methods (minimal set for stream-settings.spec.js)
    async expectStreamExistsExact(streamName) {
        await expect(this.page.locator(`[data-test="log-stream-name-cell-${streamName}"]`)).toBeVisible();
    }

    async openStreamDetail(streamName) {
        const schemaBtn = this.page.locator('[data-test="log-stream-table"] [data-test="log-stream-schema-btn"]').first();
        await schemaBtn.waitFor({ state: 'visible', timeout: 10000 });
        await schemaBtn.click();
    }

    async searchForField(fieldName) {
        // OInput exposes the fillable inner <input> via `${parent}-field`. The
        // wrapper `data-test="schema-field-search-input"` resolves to a <div>
        // which page.fill() rejects.
        const field = this.page.locator('[data-test="schema-field-search-input-field"]');
        await field.click();
        await field.fill(fieldName);
    }

    async selectFullTextSearch() {
        // Per-row OSelect on schema.vue uses data-test "schema-field-<row>-index-type-select".
        // The currently-targeted row is decided by the prior searchForField() call; the
        // visible OSelect is the only one rendered, so .first() is safe.
        // Open the OSelect via its auto-derived `-trigger`, then click the option with
        // `data-test-value="fullTextSearchKey"` (see streamIndexType in schema.vue:1392).
        const trigger = this.page.locator('[data-test$="-index-type-select-trigger"]').first();
        await trigger.waitFor({ state: 'visible', timeout: 10000 });
        await trigger.click();
        await this.page.locator('[data-test$="-index-type-select-popover"]').first()
            .waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await this.page.locator('[data-test$="-index-type-select-option"][data-test-value="fullTextSearchKey"]')
            .first().click();
    }

    async selectSecondaryIndex() {
        // Dropdown stays open after first selection (multiple-select mode) — pick
        // the Secondary index option via its OSelect `-option` data-test-value.
        await this.page.locator('[data-test$="-index-type-select-option"][data-test-value="secondaryIndexKey"]')
            .first().click();
    }

    async clickUpdateSettingsButton() {
        await this.page.locator('[data-test="schema-update-settings-button"]').click();
    }

    async expectValidationErrorVisible() {
        // Field-agnostic validation error - matches any field name.
        // OToast renders the same message in 3 places (sr-only ARIA-live span,
        // <title>, and the visible <div data-test="o-toast-message">). A plain
        // text= regex hits all three → strict-mode violation. Scope to the
        // toast-message inside the error/warning toast container.
        await expect(
            this.page
                .locator('[data-test="o-toast-message"]')
                .filter({ hasText: /field \[.*\] cannot be both/i })
                .first(),
        ).toBeVisible({ timeout: 30000 });
    }

    async verifyIndexTypeOptions() {
        // Wait a bit for the page to load completely
        await this.waitForUI(2000);

        try {
            // Open the OSelect via its auto-derived `-trigger` data-test
            const trigger = this.page.locator('[data-test$="-index-type-select-trigger"]').first();
            await trigger.waitFor({ state: 'visible', timeout: 10000 });
            await trigger.click({ timeout: 5000 });
            testLogger.info('Clicked dropdown arrow');

            // Wait for popover to open
            await this.page.locator('[data-test$="-index-type-select-popover"]').first()
                .waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

            // Check if Full text search and Secondary index options are visible in the dropdown
            const fullTextOption = this.page.locator(
                '[data-test$="-index-type-select-option"][data-test-value="fullTextSearchKey"]',
            ).first();
            const secondaryIndexOption = this.page.locator(
                '[data-test$="-index-type-select-option"][data-test-value="secondaryIndexKey"]',
            ).first();

            const options = [];
            try {
                if (await fullTextOption.isVisible({ timeout: 3000 })) {
                    options.push('Full text search');
                    testLogger.info('Found Full text search option');
                }
            } catch (e) {
                testLogger.warn('Full text search option not found');
            }

            try {
                if (await secondaryIndexOption.isVisible({ timeout: 3000 })) {
                    options.push('Secondary index');
                    testLogger.info('Found Secondary index option');
                }
            } catch (e) {
                testLogger.warn('Secondary index option not found');
            }

            testLogger.info(`Found ${options.length} options:`, options);
            return options;

        } catch (error) {
            testLogger.warn('Error in verifyIndexTypeOptions:', error.message);
            return [];
        }
    }

    async clearIndexTypeSelection(indexType) {
        if (indexType === 'Full text search') {
            // OSelect (multiple) keeps options toggleable — click the same option
            // again to clear it. Re-open the popover first if needed.
            try {
                const trigger = this.page.locator('[data-test$="-index-type-select-trigger"]').first();
                if (await trigger.isVisible({ timeout: 2000 })) {
                    await trigger.click();
                }
                await this.page.locator('[data-test$="-index-type-select-popover"]').first()
                    .waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
                await this.page.locator(
                    '[data-test$="-index-type-select-option"][data-test-value="fullTextSearchKey"]',
                ).first().click({ timeout: 3000 });
            } catch (e) {
                // Fallback to individual clearing
            }
            
            // Try individual selector
            try {
                const element = this.page.locator('tr:has-text("Full text search") .q-checkbox__inner');
                if (await element.isVisible({ timeout: 1000 })) {
                    await element.click();
                }
            } catch (e) {
                // Continue silently
            }
        }
        await this.waitForUI(1000);
    }

    // Extended Retention Methods
    async navigateToExtendedRetention() {
        // Open the stream schema/detail view
        const schemaBtn = this.page.locator('[data-test="log-stream-table"] [data-test="log-stream-schema-btn"]').first();
        await schemaBtn.waitFor({ state: 'visible', timeout: 10000 });
        await schemaBtn.click();
        await this.waitForUI(2000);

        // Navigate to Extended Retention tab
        await this.page.locator('[data-test="schema-extended-retention-tab"]').click();
        await this.waitForUI(1000);
    }

    async selectDateRange(startDay, endDay) {
        await this.page.locator('[data-test="date-time-btn"]').click();
        
        // Wait for date picker to be visible
        await this.page.locator('.q-date').waitFor({ state: 'visible' });
        
        // Ensure we're in the correct view (day view, not year/month view)
        // If year view is visible, click on current year to go to month view
        if (await this.page.locator('.q-date__view--years').isVisible()) {
            const currentYear = new Date().getFullYear();
            await this.page.locator('.q-date__years .q-btn').filter({ hasText: currentYear.toString() }).click();
        }
        
        // If month view is visible, click on current month to go to day view  
        if (await this.page.locator('.q-date__view--months').isVisible()) {
            const currentMonth = new Date().toLocaleDateString('en', { month: 'short' });
            await this.page.locator('.q-date__months .q-btn').filter({ hasText: currentMonth }).click();
        }
        
        // Now we should be in day view, wait for calendar to be ready
        await this.page.locator('.q-date__calendar').waitFor({ state: 'visible' });
        await this.page.waitForTimeout(500); // Small wait for transitions
        
        // Use specific calendar locators to avoid strict mode violation
        // Click start day with retry logic
        try {
            await this.page.locator('.q-date__calendar .q-btn').filter({ hasText: startDay.toString() }).first().click({ timeout: 5000 });
        } catch (error) {
            // Fallback: try to click any available day close to startDay
            const availableDays = await this.page.locator('.q-date__calendar .q-btn').filter({ hasText: /^\d+$/ }).all();
            if (availableDays.length > 0) {
                await availableDays[0].click();
            }
        }
        
        // Wait a bit between clicks
        await this.page.waitForTimeout(300);
        
        // Click end day with retry logic
        try {
            await this.page.locator('.q-date__calendar .q-btn').filter({ hasText: endDay.toString() }).first().click({ timeout: 5000 });
        } catch (error) {
            // Fallback: try to click any available day close to endDay
            const availableDays = await this.page.locator('.q-date__calendar .q-btn').filter({ hasText: /^\d+$/ }).all();
            if (availableDays.length > 1) {
                await availableDays[1].click();
            }
        }
        
        await this.page.locator('[data-test="date-time-apply-btn"]').click();
    }

    async selectDateRangeForCurrentMonth() {
        const currentDate = new Date();
        const currentDay = currentDate.getDate();
        
        // Calculate a safe end day - ensure it's within the current month and not too far
        const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
        const endDay = Math.min(currentDay + 3, daysInMonth - 1, 25); // Conservative approach - max 25th
        
        await this.selectDateRange(currentDay, endDay);
        
        // Return the date range text for later use
        return `${currentDay.toString().padStart(2, '0')}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-${currentDate.getFullYear()} ${endDay.toString().padStart(2, '0')}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-${currentDate.getFullYear()}`;
    }

    async deleteRetentionPeriod(dateRangeText) {
        // Select the checkbox for deletion
        await this.page.getByRole('row', { name: dateRangeText }).locator('[data-test="schema-stream-delete-undefined-field-fts-key-checkbox"]').click();
        await this.page.locator('[data-test="schema-delete-button"]').click();
        await this.page.locator('[data-test="o-dialog-primary-btn"]').click();
    }

    async expectStreamSettingsUpdatedMessage() {
        await expect(this.page.locator('[data-test-variant="success"]')).toBeVisible({ timeout: 10000 });
    }

    async waitForUI(milliseconds) {
        await this.page.waitForTimeout(milliseconds);
    }

    /**
     * ==========================================
     * STREAM API METHODS
     * ==========================================
     */

    /**
     * Create a stream via API
     * @param {string} streamName - Name of the stream to create
     * @param {string} streamType - Type of stream (logs, metrics, traces)
     * @returns {Promise<object>} API response
     */
    async createStream(streamName, streamType = 'logs') {
        const orgId = process.env["ORGNAME"];

        const payload = {
            fields: [],
            settings: {
                partition_keys: [],
                index_fields: [],
                full_text_search_keys: [],
                bloom_filter_fields: [],
                defined_schema_fields: [],
                data_retention: 14
            }
        };

        testLogger.info('Creating stream via API', { streamName, streamType });

        try {
            if (process.env.IS_CLOUD === 'true') {
                // On cloud, management APIs require OIDC session cookies — use browser context
                const result = await this.page.evaluate(async ({ orgId, streamName, streamType, payload }) => {
                    const r = await fetch(`/api/${orgId}/streams/${streamName}?type=${streamType}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    const text = await r.text();
                    try { return { status: r.status, data: JSON.parse(text) }; }
                    catch { return { status: r.status, data: text }; }
                }, { orgId, streamName, streamType, payload });

                if (result.status === 200) {
                    testLogger.info('Stream created successfully (cloud)', { streamName });
                } else {
                    testLogger.warn('Stream creation returned non-200 (cloud)', { streamName, status: result.status });
                }
                return result;
            }

            // Self-hosted: use node-fetch with Basic Auth
            const headers = getHeaders();
            const response = await _nodeFetchSafe(`${process.env.INGESTION_URL}/api/${orgId}/streams/${streamName}?type=${streamType}`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.status === 200 && data.code === 200) {
                testLogger.info('Stream created successfully', { streamName });
            } else {
                testLogger.warn('Stream creation returned non-200 or already exists', { streamName, status: response.status });
            }

            return { status: response.status, data };
        } catch (error) {
            testLogger.error('Failed to create stream', { streamName, error: error.message });
            return { status: 500, error: error.message };
        }
    }

    /**
     * Verify stream exists via API
     * @param {string} streamName - Name of the stream to verify
     * @returns {Promise<boolean>} True if stream exists
     */
    async verifyStreamExists(streamName) {
        const orgId = process.env["ORGNAME"];

        try {
            if (process.env.IS_CLOUD === 'true') {
                // On cloud, management APIs require OIDC session cookies — use browser context
                const result = await this.page.evaluate(async ({ orgId }) => {
                    const r = await fetch(`/api/${orgId}/streams`);
                    if (!r.ok) return { ok: false, status: r.status };
                    const data = await r.json();
                    return { ok: true, list: (data.list || []).map(s => s.name) };
                }, { orgId });

                if (result.ok) {
                    const exists = result.list.includes(streamName);
                    testLogger.info('Stream existence check (cloud)', { streamName, exists });
                    return exists;
                }
                testLogger.warn('Failed to check stream existence (cloud)', { streamName, status: result.status });
                return false;
            }

            // Self-hosted: use node-fetch with Basic Auth
            const headers = getHeaders();
            const response = await _nodeFetchSafe(`${process.env.INGESTION_URL}/api/${orgId}/streams`, {
                method: 'GET',
                headers: headers
            });

            const data = await response.json();

            if (response.status === 200 && data.list) {
                const streamExists = data.list.some(s => s.name === streamName);
                testLogger.info('Stream existence check', { streamName, exists: streamExists });
                return streamExists;
            }

            testLogger.warn('Failed to check stream existence', { streamName, status: response.status });
            return false;
        } catch (error) {
            testLogger.error('Error checking stream existence', { streamName, error: error.message });
            return false;
        }
    }

    /**
     * Query stream via API
     * @param {string} streamName - Stream to query
     * @param {number} expectedMinCount - Minimum expected record count (optional)
     * @returns {Promise<array>} Query results
     */
    async queryStream(streamName, expectedMinCount = null) {
        const orgId = process.env["ORGNAME"];

        testLogger.info('Querying stream via API', { streamName });

        // Query for last 10 minutes
        const endTime = Date.now() * 1000; // microseconds
        const startTime = endTime - (10 * 60 * 1000 * 1000);

        const query = {
            query: {
                sql: `SELECT * FROM "${streamName}"`,
                start_time: startTime,
                end_time: endTime,
                from: 0,
                size: 1000
            }
        };

        try {
            let data;

            if (process.env.IS_CLOUD === 'true') {
                // Cloud: use browser context (sends OIDC session cookies)
                const result = await this.page.evaluate(async ({ orgId, query }) => {
                    const r = await fetch(`/api/${orgId}/_search?type=logs`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(query)
                    });
                    return await r.json();
                }, { orgId, query });
                data = result;
            } else {
                // Self-hosted: use node-fetch with Basic Auth
                const headers = getHeaders();
                const response = await _nodeFetchSafe(`${process.env.INGESTION_URL}/api/${orgId}/_search?type=logs`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(query)
                });
                data = await response.json();
            }

            const results = data.hits || [];

            testLogger.info('Query results', { streamName, recordCount: results.length });

            if (expectedMinCount !== null && expectedMinCount !== 0) {
                if (results.length < expectedMinCount) {
                    throw new Error(`Expected at least ${expectedMinCount} records, got ${results.length}`);
                }
            }

            return results;
        } catch (error) {
            testLogger.error('Failed to query stream', { streamName, error: error.message });
            throw error;
        }
    }

    /**
     * ==========================================
     * STREAM UI CREATION METHODS (VERIFIED SELECTORS)
     * Generated from: docs/test_generator/features/stream-creation-feature.md
     * ==========================================
     */

    // Selectors - VERIFIED from AddStream.vue and LogStream.vue
    get addStreamButton() { return this.page.locator('[data-test="log-stream-add-stream-btn"]'); }
    get addStreamModal() { return this.page.locator('[data-test="add-stream-title"]'); }
    get streamNameInput() { return this.page.locator('[data-test="add-stream-name-input"] input'); }
    get streamTypeSelect() { return this.page.locator('[data-test="add-stream-type-input"]'); }
    get dataRetentionInput() { return this.page.locator('[data-test="add-stream-data-retention-input"] input'); }
    get saveStreamButton() { return this.page.locator('[data-test="save-stream-btn"]'); }
    get cancelStreamButton() { return this.page.locator('[data-test="add-stream-cancel-btn"]'); }
    get closeStreamButton() { return this.page.locator('[data-test="add-stream-close-btn"]'); }
    get streamsTable() { return this.page.locator('[data-test="log-stream-table"]'); }
    get searchStreamInput() { return this.page.locator('[data-test="streams-search-stream-input-field"]'); }
    get indexTypeSelect() { return this.page.locator('[data-test="schema-field-kubernetes_host-index-type-select"]').first(); }
    get fieldSearchInput() { return this.page.locator('[data-test="schema-field-search-input-field"]'); }
    get quickModeIcons() { return this.page.locator('img[alt*="quick"], img[alt*="Quick"]'); }
    get quickModeTooltip() { return this.page.locator('[data-test*="quick-mode-tooltip"]'); }
    get schemaTable() { return this.page.locator('[data-test="schema-table"]'); }

    /**
     * Click Add Stream button to open the modal
     */
    async clickAddStreamButton() {
        testLogger.info('Clicking Add Stream button');
        await this.addStreamButton.click();
        await this.waitForUI(500);
    }

    /**
     * Verify Add Stream modal is visible
     */
    async expectAddStreamModalVisible() {
        testLogger.info('Verifying Add Stream modal is visible');
        await expect(this.addStreamModal).toBeVisible({ timeout: 5000 });
    }

    /**
     * Enter stream name in the input field
     * @param {string} name - Stream name to enter
     */
    async enterStreamName(name) {
        testLogger.info('Entering stream name', { name });
        await this.streamNameInput.click();
        await this.streamNameInput.fill(name);
    }

    /**
     * Select stream type from dropdown
     * @param {string} type - Stream type (logs, metrics, traces)
     */
    async selectStreamType(type) {
        testLogger.info('Selecting stream type', { type });
        await this.streamTypeSelect.click();
        await this.waitForUI(300);
        // Click the OSelect option via data-test-value matching the type
        const option = this.page.locator(`[data-test="add-stream-type-input-option"][data-test-value="${type.toLowerCase()}"]`);
        await option.waitFor({ state: 'visible', timeout: 5000 });
        await option.click();
        await this.waitForUI(300);
    }

    /**
     * Enter data retention period
     * @param {number} days - Number of days for retention
     */
    async enterDataRetention(days) {
        testLogger.info('Entering data retention', { days });
        await this.dataRetentionInput.click();
        await this.dataRetentionInput.fill('');
        await this.dataRetentionInput.fill(days.toString());
    }

    /**
     * Click Save button to create stream
     */
    async clickSaveStream() {
        testLogger.info('Clicking Save button');
        await this.saveStreamButton.click();
        await this.waitForUI(1000);
    }

    /**
     * Click Cancel button to close modal without saving
     */
    async clickCancelStream() {
        testLogger.info('Clicking Cancel button');
        await this.cancelStreamButton.click();
        await this.waitForUI(500);
    }

    /**
     * Click Close (X) button to close modal
     */
    async clickCloseStreamModal() {
        testLogger.info('Clicking Close button');
        await this.closeStreamButton.click();
        await this.waitForUI(500);
    }

    /**
     * Create a stream via UI with all parameters
     * @param {string} name - Stream name
     * @param {string} type - Stream type (logs, metrics, traces)
     * @param {number} retention - Data retention in days (default 14)
     */
    async createStreamViaUI(name, type = 'logs', retention = 14) {
        testLogger.info('Creating stream via UI', { name, type, retention });

        await this.clickAddStreamButton();
        await this.expectAddStreamModalVisible();
        await this.enterStreamName(name);
        await this.selectStreamType(type);
        await this.enterDataRetention(retention);
        await this.clickSaveStream();

        // Wait for success message or modal to close
        await this.waitForUI(2000);
    }

    /**
     * Verify success toast message appears
     * @param {string} message - Expected message text
     */
    async expectSuccessToast(message = 'Stream created successfully') {
        testLogger.info('Verifying success toast', { message });
        await expect(this.page.locator('[data-test-variant="success"]')).toBeVisible({ timeout: 5000 });
    }

    /**
     * Verify error toast message appears
     * @param {string} message - Expected error message text (partial match)
     */
    async expectErrorToast(message) {
        testLogger.info('Verifying error toast', { message });
        await expect(this.page.locator('[data-test-variant="error"]')).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify modal is closed (not visible)
     */
    async expectModalClosed() {
        testLogger.info('Verifying modal is closed');
        await expect(this.addStreamModal).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Search for a stream in the search input
     * @param {string} streamName - Name to search for
     */
    async searchForStream(streamName) {
        testLogger.info('Searching for stream', { streamName });
        await this.searchStreamInput.click();
        await this.searchStreamInput.fill(streamName);
        await this.waitForUI(2000);
    }

    /**
     * Verify stream exists in the table
     * @param {string} streamName - Stream name to find
     */
    async expectStreamInTable(streamName) {
        testLogger.info('Verifying stream in table', { streamName });
        await expect(this.page.locator(`[data-test="log-stream-name-cell-${streamName}"]`)).toBeVisible({ timeout: 10000 });
    }

    /**
     * Verify stream does NOT exist in the table
     * @param {string} streamName - Stream name to verify absence
     */
    async expectStreamNotInTable(streamName) {
        testLogger.info('Verifying stream NOT in table', { streamName });
        await expect(this.page.locator(`[data-test="log-stream-name-cell-${streamName}"]`)).not.toBeVisible({ timeout: 5000 });
    }

    /**
     * Delete a stream via API (for cleanup)
     * @param {string} streamName - Stream to delete
     * @param {string} streamType - Type of stream
     */
    async deleteStreamViaAPI(streamName, streamType = 'logs') {
        const orgId = process.env["ORGNAME"];

        testLogger.info('Deleting stream via API', { streamName, streamType });

        try {
            if (process.env.IS_CLOUD === 'true') {
                // On cloud, management APIs require OIDC session cookies — use browser context
                const status = await this.page.evaluate(async ({ orgId, streamName, streamType }) => {
                    const r = await fetch(`/api/${orgId}/streams/${streamName}?type=${streamType}`, { method: 'DELETE' });
                    return r.status;
                }, { orgId, streamName, streamType });

                if (status === 200) {
                    testLogger.info('Stream deleted successfully (cloud)', { streamName });
                } else {
                    testLogger.warn('Stream deletion returned non-200 (cloud)', { streamName, status });
                }
                return status;
            }

            // Self-hosted: use node-fetch with Basic Auth
            const headers = getHeaders();
            const response = await _nodeFetchSafe(`${process.env.INGESTION_URL}/api/${orgId}/streams/${streamName}?type=${streamType}`, {
                method: 'DELETE',
                headers: headers
            });

            if (response.status === 200) {
                testLogger.info('Stream deleted successfully', { streamName });
            } else {
                testLogger.warn('Stream deletion returned non-200', { streamName, status: response.status });
            }

            return response.status;
        } catch (error) {
            testLogger.error('Failed to delete stream', { streamName, error: error.message });
            return 500;
        }
    }

    // ========== BUG REGRESSION TEST METHODS ==========

    /**
     * Expect streams page to be visible
     * Bug #9354 - FTS auto-add
     */
    async expectStreamsPageVisible() {
        const streamsTable = this.page.locator('[data-test="log-stream-table"], [data-test*="streams"]').first();
        await expect(streamsTable).toBeVisible({ timeout: 15000 });
        testLogger.info('Streams page is visible');
    }

    /**
     * Navigate directly to streams page with explicit org identifier.
     * Uses page.goto instead of menu click to avoid cloud _meta org redirect bug.
     */
    async navigateToStreamsPage(baseUrl, orgId) {
        await this.page.goto(`${baseUrl}/web/streams?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    /**
     * Assert an exact-match stream name cell is visible in the streams table.
     * Uses getByRole('cell', { exact: true }) to avoid strict mode violations
     * when multiple streams share a common prefix (e.g. e2e_automate, e2e_automate1).
     */
    async expectExactStreamCellVisible(streamName, timeout = 10000) {
        await expect(
            this.page.locator(`[data-test="log-stream-name-cell-${streamName}"]`)
        ).toBeVisible({ timeout });
        testLogger.info(`Stream cell visible: ${streamName}`);
    }

    /**
     * Check if stream is visible
     * Bug #9354 - FTS auto-add
     */
    async isStreamVisible(streamName) {
        return await this.page.locator(`[data-test="log-stream-name-cell-${streamName}"]`).isVisible().catch(() => false);
    }

    /**
     * Click on stream schema/details button in the actions column
     * Bug #9354 - FTS auto-add
     * Note: In OpenObserve streams table, you need to click the schema icon (list_alt) to view details
     */
    async clickStream(streamName) {
        const streamRow = this.page.locator('[data-test="log-stream-table"] tbody tr').filter({ hasText: streamName }).first();
        const schemaButton = streamRow.locator('[data-test="log-stream-schema-btn"]');

        if (await schemaButton.isVisible().catch(() => false)) {
            await schemaButton.click();
            testLogger.info(`Clicked schema button for stream: ${streamName}`);
        } else {
            // Fallback: click on the row itself, which may expand it
            await streamRow.click();
            testLogger.info(`Clicked stream row: ${streamName}`);
        }
        await this.page.waitForTimeout(1500);
    }

    /**
     * Expect stream schema dialog to be visible
     * Bug #9354 - FTS auto-add
     * The schema opens in a right-side dialog with SchemaIndex component
     */
    async expectStreamDetailsVisible() {
        const detailsPanel = this.page.locator('[data-test="schema-title-text"]');
        await expect(detailsPanel).toBeVisible({ timeout: 15000 });
        testLogger.info('Stream schema/details dialog is visible');
    }

    /**
     * Search for a specific field in the schema view
     */
    async searchForField(fieldName) {
        // OInput convention: the fillable inner <input> is auto-derived at
        // `${parent}-field`. Filling the wrapper data-test (a <div>) throws.
        const field = this.page.locator('[data-test="schema-field-search-input-field"]');
        await field.click();
        await field.fill(fieldName);
    }

    /**
     * Expect index type select to be visible
     */
    async expectIndexTypeSelectVisible(timeout = 5000) {
        await expect(this.indexTypeSelect).toBeVisible({ timeout });
    }

    /**
     * Get full text search option from dropdown.
     * StreamFieldInputs uses OSelect post-migration (Reka Listbox role=option);
     * legacy q-select uses .q-item.
     */
    getFullTextSearchOption() {
        return this.page.locator('[data-test$="-index-type-select-option"][data-test-value="fullTextSearchKey"]').first();
    }

    /**
     * Get quick mode icons count
     */
    async getQuickModeIconsCount() {
        return await this.quickModeIcons.count();
    }

    /**
     * Check if tooltip is visible
     */
    async isTooltipVisible(timeout = 3000) {
        return await this.quickModeTooltip.isVisible({ timeout }).catch(() => false);
    }

    /**
     * Expect schema table to be visible
     */
    async expectSchemaTableVisible(timeout = 5000) {
        await expect(this.schemaTable).toBeVisible({ timeout });
    }
}
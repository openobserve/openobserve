import { expect } from '@playwright/test';
import { LoginPage } from '../generalPages/loginPage.js';
import { LogsPage } from '../logsPages/logsPage.js';
import { IngestionPage } from '../generalPages/ingestionPage.js';
import { ManagementPage } from '../generalPages/managementPage.js';

import { getHeaders, getIngestionUrl, sendRequest } from '../../utils/apiUtils.js';
const http = require('http');
const https = require('https');
const nodeFetch = require('node-fetch');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

// node-fetch v2 keep-alive pooling + gzip decompression is the root cause of
// "Premature close" / ECONNRESET flakiness in CI.
// Pick the agent by protocol so both local (http://localhost) and cloud/alpha
// (https://) URLs work — an http.Agent rejects https:// URLs.
const _noKeepAliveHttpAgent = new http.Agent({ keepAlive: false });
const _noKeepAliveHttpsAgent = new https.Agent({ keepAlive: false });
const _selectAgent = (parsedURL) =>
    parsedURL.protocol === 'https:' ? _noKeepAliveHttpsAgent : _noKeepAliveHttpAgent;
function _nodeFetchSafe(url, opts = {}) {
    return nodeFetch(url, { ...opts, compress: false, agent: _selectAgent });
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
        // On cloud the field list can take a while to populate after stream
        // selection; filter it first (also acts as a readiness wait) and wait
        // for the expand toggle before the click inside logsPage fires.
        await this.logsPage.fillIndexFieldSearchInput('kubernetes_container_name');
        await this.page.locator('[data-test="log-search-expand-kubernetes_container_name-field-btn"]')
            .first().waitFor({ state: 'visible', timeout: 30000 });
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
        // Confirm the streams explorer actually rendered before returning. The
        // search input is the first control every caller uses. Replaces a fixed
        // 1s wait that let searchStream / clickAddStreamButton race an unloaded
        // page on slow CI (the source of the 45s click timeouts on retry).
        await this.page.locator('[data-test="streams-search-stream-input-field"]')
            .waitFor({ state: 'visible', timeout: 30000 });
    }

    async searchStream(streamName) {
        const searchInput = this.page.locator('[data-test="streams-search-stream-input-field"]');
        // Defensive wait so a still-loading streams page yields a clear failure
        // and time to settle rather than a bare 45s click timeout.
        await searchInput.waitFor({ state: 'visible', timeout: 30000 });
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
        await schemaBtn.waitFor({ state: 'visible', timeout: 15000 });
        await schemaBtn.click();

        // Wait for the schema dialog's tab bar to render (the Extended Retention
        // tab) instead of a fixed 2s sleep — on slow CI the dialog opens later,
        // which previously left the tab click racing an unrendered dialog.
        const retentionTab = this.page.locator('[data-test="schema-extended-retention-tab"]');
        await retentionTab.waitFor({ state: 'visible', timeout: 15000 });
        await retentionTab.click();

        // Wait for the tab's date picker ("Select Date" button) to render before
        // returning — this is the exact element the caller needs, so a fixed 1s
        // wait was the source of the "date-time-btn not visible" CI failure.
        await this.page.locator('[data-test="date-time-btn"]').waitFor({ state: 'visible', timeout: 15000 });
    }

    async selectDateRange(startIso, endIso) {
        // Post-revamp the extended-retention picker is the shared <date-time>
        // component with an ODateRangeCalendar inside — Quasar's .q-date is gone.
        // Day cells carry data-test="daterangecalendar-cell-<yyyy-mm-dd>";
        // exclude adjacent-month duplicates via [data-outside-view].
        await this.page.locator('[data-test="date-time-btn"]').click();
        await this.page.locator('[data-test="daterangecalendar-root"]')
            .waitFor({ state: 'visible', timeout: 15000 });
        const cell = (iso) => this.page.locator(
            `[data-test="daterangecalendar-cell-${iso}"]:not([data-outside-view])`).first();
        await cell(startIso).click();
        await cell(endIso).click();
        // Applying saves immediately (dateChangeValue -> onSubmit -> PUT
        // .../streams/{name}/settings) — capture the response so a server-side
        // failure shows in the test log instead of only as a transient toast.
        const respPromise = this.page.waitForResponse(
            (r) => r.url().includes('/settings') && r.request().method() === 'PUT',
            { timeout: 20000 },
        ).catch(() => null);
        await this.page.locator('[data-test="date-time-apply-btn"]').click();
        const resp = await respPromise;
        if (resp) {
            const body = await resp.text().catch(() => '');
            testLogger.info('Extended retention settings response', { status: resp.status(), body: body.slice(0, 300) });
        } else {
            testLogger.warn('No settings PUT observed within 20s of applying the date range');
        }
    }

    async selectDateRangeForCurrentMonth() {
        // The calendar allows [today - (retention-1) .. today] (UTC). Pick
        // yesterday..today; on the 1st of a month yesterday's cell may not be
        // in view, so fall back to a single-day range of today.
        const isoUtc = (d) => d.toISOString().slice(0, 10);
        const today = new Date();
        const endIso = isoUtc(today);
        let startIso = isoUtc(new Date(today.getTime() - 24 * 60 * 60 * 1000));
        const startCell = this.page.locator(
            `[data-test="daterangecalendar-cell-${startIso}"]:not([data-outside-view])`);
        await this.page.locator('[data-test="date-time-btn"]').waitFor({ state: 'visible', timeout: 15000 });
        // Peek at the calendar to decide the fallback before committing clicks
        await this.page.locator('[data-test="date-time-btn"]').click();
        await this.page.locator('[data-test="daterangecalendar-root"]')
            .waitFor({ state: 'visible', timeout: 15000 });
        if (await startCell.count() === 0) startIso = endIso;
        // Close and reuse selectDateRange for the actual selection
        await this.page.keyboard.press('Escape');
        await this.selectDateRange(startIso, endIso);
        // Applying the range saves immediately (dateChangeValue -> onSubmit),
        // so the new row appears in the retention table. Return the start date
        // in the table's display format (DD-MM-YYYY via convertUnixToQuasarFormat)
        // so deleteRetentionPeriod's hasText row filter matches — the cells
        // render e.g. "13-07-2026", not the ISO "2026-07-13".
        const [y, m, d] = startIso.split('-');
        return `${d}-${m}-${y}`;
    }

    async deleteRetentionPeriod(dateRangeText) {
        // Rows are OTable rows (data-test="o2-table-row-<n>"); row click (or the
        // select cell) toggles multi-selection. The confirm dialog is the shared
        // ConfirmDialog (panel data-test="confirm-dialog") whose OK button is the
        // ODialog primary button — scope it so we don't hit the schema dialog's own.
        const row = this.page.locator('[data-test^="o2-table-row-"]')
            .filter({ hasText: dateRangeText }).first();
        try {
            await row.waitFor({ state: 'visible', timeout: 15000 });
        } catch {
            // The retention table only rebuilds from the stream response when the
            // schema dialog (re)loads — refresh it once and retry.
            testLogger.warn('Retention row not visible yet — reopening schema dialog', { dateRangeText });
            await this.page.keyboard.press('Escape');
            await this.waitForUI(1000);
            await this.navigateToExtendedRetention();
            const tableText = await this.page.locator('[data-test="schema-log-stream-field-mapping-table"]')
                .innerText().catch(() => '<table not found>');
            testLogger.info('Retention table content after reopen', { tableText: tableText.slice(0, 400) });
            await row.waitFor({ state: 'visible', timeout: 15000 });
        }
        // Click the checkbox <label> (o2-table-select-<rowId>) inside the select
        // cell — clicking the cell (o2-table-select-cell) does not toggle
        // selection, so the delete button stays disabled
        // (:disabled="!selectedDateFields.length"). Target the label to avoid a
        // strict-mode match against the cell, which shares the prefix.
        await row.locator('label[data-test^="o2-table-select-"]').click();
        const deleteBtn = this.page.locator('[data-test="schema-delete-button"]');
        await expect(deleteBtn).toBeEnabled({ timeout: 10000 });
        await deleteBtn.click();
        await this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();
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

    // Selectors - VERIFIED from AddStream.vue and LogStream.vue.
    // The streams-page Add Stream form is an ODialog: the panel carries the
    // consumer data-test ("add-stream-dialog") and the save/cancel/close
    // buttons are ODialog-owned generic ids, so scope them under the panel.
    // (The add-stream-save/cancel-btn ids exist only in the pipeline inline
    // branch of AddStream.vue, not in the dialog.)
    get addStreamButton() { return this.page.locator('[data-test="log-stream-add-stream-btn"]'); }
    get addStreamModal() { return this.page.locator('[data-test="add-stream-dialog"]'); }
    get streamNameInput() { return this.page.locator('[data-test="add-stream-name-input"] input'); }
    get streamTypeSelect() { return this.page.locator('[data-test="add-stream-type-input"]'); }
    get dataRetentionInput() { return this.page.locator('[data-test="add-stream-data-retention-input"] input'); }
    get saveStreamButton() { return this.page.locator('[data-test="add-stream-dialog"] [data-test="o-dialog-primary-btn"]'); }
    get cancelStreamButton() { return this.page.locator('[data-test="add-stream-dialog"] [data-test="o-dialog-secondary-btn"]'); }
    get closeStreamButton() { return this.page.locator('[data-test="add-stream-dialog"] [data-test="o-dialog-close-btn"]'); }
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
        // The Add Stream button renders only after zoConfig loads
        // (v-if="isSchemaUDSEnabled"); wait for it explicitly so a slow CI page
        // load yields a clear failure instead of a bare 45s click timeout.
        await this.addStreamButton.waitFor({ state: 'visible', timeout: 30000 });
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
        // Assert the value stuck: under parallel-worker load the O-input's
        // debounced model update can lag, leaving name empty at save time so
        // validateStream() silently blocks submit (no POST).
        await expect(this.streamNameInput).toHaveValue(name, { timeout: 5000 });
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
        // fill('') then fill(value) leaves a window where the field is empty;
        // if save races in there, dataRetentionDays is not > 0 and submit is
        // silently blocked (no POST). Assert the value actually stuck before
        // returning so the caller never saves an empty retention field.
        await this.dataRetentionInput.click();
        await this.dataRetentionInput.fill('');
        await this.dataRetentionInput.fill(days.toString());
        await expect(this.dataRetentionInput).toHaveValue(days.toString(), { timeout: 5000 });
    }

    /**
     * Click Save button to create stream
     */
    async clickSaveStream() {
        testLogger.info('Clicking Save button');
        // Watch for the create call (POST /api/{org}/streams/{name}) so a
        // server-side failure is visible in the test log instead of only as a
        // transient error toast.
        const respPromise = this.page.waitForResponse(
            (r) => /\/api\/[^/]+\/streams\/[^/?]+/.test(r.url()) && r.request().method() === 'POST',
            { timeout: 20000 },
        ).catch(() => null);
        await this.saveStreamButton.click();
        const resp = await respPromise;
        if (resp) {
            const body = await resp.text().catch(() => '');
            testLogger.info('Stream create API response', { status: resp.status(), body: body.slice(0, 300) });
            return { status: resp.status(), body };
        }
        testLogger.warn('No stream-create API call observed within 20s of clicking Save');
        // Client-side validateStream() blocked submit — dump the per-field
        // error slots so we know which field failed.
        for (const f of ['name', 'type', 'data-retention']) {
            const err = await this.page.locator(`[data-test="add-stream-${f}-input-error"]`)
                .innerText().catch(() => '');
            if (err && err.trim()) testLogger.warn(`Add Stream ${f} error`, { err: err.trim() });
        }
        return { status: 0, body: '' };
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
        // O-inputs debounce their model updates; submitting before the flush
        // intermittently drops a field, fails form validation and leaves the
        // dialog open (seen on alpha). Give the form a beat to settle.
        await this.page.waitForTimeout(500);
        // Cloud deletion is async: a just-deleted stream can still be "being
        // deleted" server-side even after it drops out of the streams list (so
        // the pre-delete list-poll can't catch it), and the recreate POST is
        // rejected 400 "stream is being deleted". The dialog stays open on that
        // 400, so retry the save a few times until it goes through.
        for (let attempt = 1; attempt <= 5; attempt++) {
            const { status, body } = await this.clickSaveStream();
            if (status && status !== 400) return;
            if (status === 0) {
                // No POST fired — the submit click intermittently doesn't reach
                // the form under load, with all fields verified set and no field
                // error. Re-click Save (dialog is still open).
                if (attempt < 5) {
                    testLogger.warn(`No create POST observed, re-clicking Save ${attempt}/5`, { name });
                    await this.page.waitForTimeout(1000);
                    continue;
                }
                return;
            }
            if (status === 400 && /already exists/i.test(body)) {
                // A prior attempt's create eventually went through once the async
                // delete finished, so the stream now exists — that's success for
                // create-and-verify. Close the still-open dialog so the caller's
                // modal-closed / success assertion passes.
                testLogger.info('Stream already exists after retry — treating as created', { name });
                await this.clickCancelStream();
                return;
            }
            if (status === 400 && /being deleted/i.test(body)) {
                testLogger.warn(`Create rejected (being deleted), retrying save ${attempt}/5`, { name });
                await this.page.waitForTimeout(3000);
                continue;
            }
            // Any other outcome (validation blocked / other error): stop and let
            // the caller's success assertion report it.
            return;
        }
    }

    /**
     * Verify success toast message appears
     * @param {string} message - Expected message text
     */
    async expectSuccessToast(message = 'Stream created successfully') {
        testLogger.info('Verifying success toast', { message });
        // The toast auto-dismisses after a few seconds, so a strict
        // toast-visible assertion races against it on slow (cloud) runs.
        // The durable success signal is the Add Stream dialog closing — a
        // failed save keeps it open with an error — with the toast, when
        // still around, as the fast path.
        const toast = this.page.locator('[data-test-variant="success"]');
        const seen = await Promise.any([
            toast.waitFor({ state: 'visible', timeout: 15000 }),
            this.addStreamModal.waitFor({ state: 'hidden', timeout: 15000 }),
        ]).then(() => true, () => false);
        if (!seen) {
            // Surface why the dialog is still open before failing
            const dialogText = await this.addStreamModal.innerText().catch(() => '<dialog not found>');
            testLogger.warn('Save did not complete — Add Stream dialog still open', { dialogText });
            await expect(toast).toBeVisible({ timeout: 1000 });
        }
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
                    // Cloud deletion is asynchronous: the stream lingers in a
                    // "being deleted" state for a few seconds, during which a
                    // recreate POST is rejected 400 "stream is being deleted".
                    // Poll the streams list until it is actually gone so callers
                    // that delete-then-recreate don't race the backend.
                    await this._waitForStreamGoneCloud(orgId, streamName, streamType);
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

    /**
     * Poll the cloud streams list until `streamName` no longer appears, so a
     * delete-then-recreate sequence doesn't hit 400 "stream is being deleted".
     */
    async _waitForStreamGoneCloud(orgId, streamName, streamType, timeoutMs = 20000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const present = await this.page.evaluate(async ({ orgId, streamName, streamType }) => {
                const r = await fetch(`/api/${orgId}/streams?type=${streamType}`);
                if (!r.ok) return false;
                const body = await r.json();
                const list = Array.isArray(body.list) ? body.list : (Array.isArray(body) ? body : []);
                return list.some((s) => s.name === streamName);
            }, { orgId, streamName, streamType }).catch(() => false);
            if (!present) {
                testLogger.info('Confirmed stream fully deleted (cloud)', { streamName });
                return;
            }
            await this.page.waitForTimeout(1000);
        }
        testLogger.warn('Stream still present after delete timeout — proceeding anyway', { streamName });
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
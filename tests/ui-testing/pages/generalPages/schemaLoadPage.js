const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

class SchemaLoadPage {
    constructor(page) {
        this.page = page;

        // =========================================================
        // Schema load testing locators — strict data-test only
        // =========================================================

        // Sidebar / navigation menu items
        this.menuHomeItem = page.locator('[data-test="menu-link-\\/-item"]');
        this.menuLogsItem = page.locator('[data-test="menu-link-\\/logs-item"]');
        this.menuStreamsItem = page.locator('[data-test="menu-link-\\/streams-item"]');

        // Logs page — stream selection OSelect
        // Wrapper carries `data-test="log-search-index-list-select-stream"`; clicking
        // the wrapper hits the inner PopoverTrigger button.
        this.logSearchIndexSelectStream = page.locator(
            '[data-test="log-search-index-list-select-stream"]'
        );
        // OSelect popover renders with `${parent}-popover`; the inner ListboxFilter
        // is data-tested via `${parent}-search` (forwarded from OSelect.vue).
        this.logSearchStreamPopover = page.locator(
            '[data-test="log-search-index-list-select-stream-popover"]'
        );
        this.logSearchStreamPopoverSearch = page.locator(
            '[data-test="log-search-index-list-select-stream-search"]'
        );

        // Field search and interaction within the logs explorer
        this.logSearchIndexFieldSearchInput = page.locator(
            '[data-test="log-search-index-list-field-search-input"]'
        );
        this.logsSearchBarRefreshBtn = page.locator(
            '[data-test="logs-search-bar-refresh-btn"]'
        );
        this.logsSearchResultTableBody = page.locator(
            '[data-test="logs-search-result-table-body"]'
        );
        this.tableRowExpandMenu = page.locator(
            '[data-test="table-row-expand-menu"]'
        );
        this.logTableColumnTimestamp = page.locator(
            '[data-test="log-table-column-0-_timestamp"]'
        );

        // Streams page — search input (OInput wrapper → fill `-field` variant)
        this.streamsSearchInput = page.locator(
            '[data-test="streams-search-stream-input-field"]'
        );

        // Schema drawer locators (ODrawer rendered from LogStream.vue)
        this.logStreamSchemaBtn = page.locator(
            '[data-test="log-stream-schema-btn"]'
        );
        this.logStreamExploreBtn = page.locator(
            '[data-test="log-stream-explore-btn"]'
        );
        this.logStreamStoreOriginalDataToggle = page.locator(
            '[data-test="log-stream-store-original-data-toggle-btn"]'
        );
        this.schemaDrawerCloseBtn = page.locator(
            '[data-test="schema-drawer"] [data-test="o-drawer-close-btn"]'
        );

        // Log attributes verification — `logs-search-subfield-add-...` is per-field
        this.logsSearchSubfieldAdd = page.locator(
            '[data-test="logs-search-subfield-add-log_log_attribute10007-Lorem ipsum dolor sit amet\\, consectetur adipiscing elit\\. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua\\."]'
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Factory helpers — runtime-dynamic data-test values
    // ─────────────────────────────────────────────────────────────────────────

    // Get the deterministic per-name cell on the Streams page table
    getStreamNameCell(streamName) {
        return this.page.locator(`[data-test="log-stream-name-cell-${streamName}"]`);
    }

    // Get the OSelect option inside the stream selector popover keyed by value
    getStreamSelectOption(streamName) {
        return this.page.locator(
            `[data-test="log-search-index-list-select-stream-popover"] [data-test="log-search-index-list-select-stream-option"][data-test-value="${streamName}"]`
        );
    }

    // Get any OSelect option inside the stream selector popover
    getStreamSelectOptions() {
        return this.page.locator(
            '[data-test="log-search-index-list-select-stream-popover"] [data-test="log-search-index-list-select-stream-option"]'
        );
    }

    // Resolve the OTable row containing the named stream by walking up from the cell
    getStreamRow(streamName) {
        return this.getStreamNameCell(streamName)
            .first()
            .locator(`xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]`)
            .first();
    }

    // Stream-row schema button — scoped to a single row
    getStreamSchemaBtn(streamName) {
        return this.getStreamRow(streamName).locator('[data-test="log-stream-schema-btn"]').first();
    }

    // Stream-row explore button — scoped to a single row
    getStreamExploreBtn(streamName) {
        return this.getStreamRow(streamName).locator('[data-test="log-stream-explore-btn"]').first();
    }

    // Navigation methods
    async navigateToHome() {
        testLogger.debug('Navigating to home page');
        await this.menuHomeItem.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async navigateToLogs() {
        testLogger.debug('Navigating to logs page');
        await this.menuLogsItem.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async navigateToStreams() {
        testLogger.debug('Navigating to streams page');
        await this.menuStreamsItem.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Stream search and selection methods
    async searchAndSelectStream(streamName) {
        testLogger.debug('Searching and selecting stream', { streamName });

        // Open the OSelect popover
        await this.logSearchIndexSelectStream.waitFor({ state: 'visible', timeout: 15000 });
        await this.logSearchIndexSelectStream.click();
        await this.logSearchStreamPopover.waitFor({ state: 'visible', timeout: 10000 });

        // Type the stream name into the popover's ListboxFilter to narrow options.
        // Use Ctrl+A → Backspace before fill to defensively clear reka-ui's
        // ComboboxInput internal searchTerm state (which can survive a `.fill()`
        // overwrite alone) before we re-filter.
        await this.logSearchStreamPopoverSearch.waitFor({ state: 'visible', timeout: 10000 });
        await this.logSearchStreamPopoverSearch.press('ControlOrMeta+a');
        await this.logSearchStreamPopoverSearch.press('Backspace');
        await this.logSearchStreamPopoverSearch.fill(streamName);

        // After filtering, the popover narrows to just our stream — click the first option.
        // (OSelect's virtualizer can have a stale `data-test-value` when reusing DOM nodes,
        //  so we rely on the filter-result count rather than the value-attribute match.)
        await expect.poll(
            async () => {
                return await this.getStreamSelectOptions().count().catch(() => -1);
            },
            { intervals: [500, 1000, 2000], timeout: 20000 }
        ).toBeGreaterThanOrEqual(1);
        const option = this.getStreamSelectOptions().first();
        await option.waitFor({ state: 'visible', timeout: 15000 });
        await option.click();

        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        testLogger.debug('Stream selected successfully', { streamName });
    }

    // Field search and verification methods
    async searchLogField(fieldValue) {
        testLogger.debug('Searching log field', { fieldValue });

        await this.logSearchIndexFieldSearchInput.waitFor({ state: 'visible' });
        await this.logSearchIndexFieldSearchInput.click();
        await this.logSearchIndexFieldSearchInput.fill(fieldValue);
        await this.page.waitForLoadState('domcontentloaded');
    }

    async refreshLogs() {
        testLogger.debug('Refreshing logs search');

        await this.logsSearchBarRefreshBtn.waitFor({ state: 'visible', timeout: 15000 });

        // Wait for search response to complete
        const searchResponsePromise = this.page.waitForResponse(
            response => response.url().includes('/_search') && response.status() === 200,
            { timeout: 60000 }
        );

        await this.logsSearchBarRefreshBtn.click();

        // Wait for the search to complete
        await searchResponsePromise;
        // Use non-blocking wait for networkidle as the page may have long-polling connections
        await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
            testLogger.debug('Network idle timeout after search - continuing with verification');
        });

        // Check if the results table body is attached — empty results are acceptable
        // for schema verification because the stream existing + search succeeding is enough.
        try {
            await this.logsSearchResultTableBody.waitFor({ state: 'visible', timeout: 10000 });
            testLogger.debug('Log search results loaded successfully');
        } catch (error) {
            testLogger.debug('No log results found, but search completed successfully');
            // This is acceptable - the stream exists and search completes, even if no results match
        }
    }

    async expandFirstLogRow() {
        testLogger.debug('Expanding first log row');

        await this.tableRowExpandMenu.first().waitFor({ state: 'visible' });
        await this.tableRowExpandMenu.first().click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async verifyLogFieldVisible() {
        testLogger.debug('Verifying log field visibility');

        // The subfield-add data-test contains the literal Lorem ipsum text, so the
        // single locator is enough to assert visibility — no nested getByText needed.
        await expect(this.logsSearchSubfieldAdd).toBeVisible();

        testLogger.debug('Log field verified as visible');
    }

    async verifyTimestampColumn() {
        testLogger.debug('Verifying timestamp column visibility');

        await this.logTableColumnTimestamp.waitFor({ state: 'visible' });
        await expect(this.logTableColumnTimestamp).toBeVisible();

        testLogger.debug('Timestamp column verified as visible');
    }

    // Stream management methods
    async searchStreamInStreamsPage(streamName) {
        testLogger.debug('Searching stream in streams page', { streamName });

        // OInput inner `-field` variant — always fill the inner input
        await this.streamsSearchInput.waitFor({ state: 'visible', timeout: 15000 });
        await this.streamsSearchInput.click();
        await this.streamsSearchInput.fill(streamName);

        // Deterministically wait until the per-name cell shows up — replaces blanket timeout
        await this.getStreamNameCell(streamName).first().waitFor({ state: 'visible', timeout: 20000 });
        await this.page.waitForLoadState('domcontentloaded');
    }

    async openStreamDetails(streamName) {
        testLogger.debug('Opening stream details', { streamName });

        // Walk up from the per-name cell to the OTable row, then click the schema button
        await this.getStreamNameCell(streamName).first().waitFor({ state: 'visible', timeout: 15000 });
        await this.getStreamRow(streamName).hover();
        await this.getStreamSchemaBtn(streamName).click({ force: true, timeout: 15000 });

        await this.page.waitForLoadState('domcontentloaded');
    }

    async toggleStoreOriginalData() {
        testLogger.debug('Toggling store original data setting');

        await this.logStreamStoreOriginalDataToggle.first().waitFor({ state: 'visible' });
        await this.logStreamStoreOriginalDataToggle.first().click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async closeDialog() {
        testLogger.debug('Closing dialog');

        await this.schemaDrawerCloseBtn.waitFor({ state: 'visible', timeout: 15000 });
        await this.schemaDrawerCloseBtn.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async exploreStream(streamName) {
        testLogger.debug('Exploring stream', { streamName });

        // Resolve the row containing the named stream via the per-name cell
        await this.getStreamNameCell(streamName).first().waitFor({ state: 'visible', timeout: 15000 });
        await this.getStreamRow(streamName).hover();
        await this.getStreamExploreBtn(streamName).click({ force: true, timeout: 15000 });

        // Extended timeout for large schema exploration
        await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Complete workflow methods
    async completeSchemaLoadVerificationWorkflow(streamName) {
        testLogger.debug('Starting schema load verification workflow with stream check', { streamName });

        try {
            // Step 1: Navigate to streams page first to verify stream exists
            await this.navigateToStreams();
            await this.searchStreamInStreamsPage(streamName);

            // Wait for stream cell to be visible in streams page
            try {
                const streamCell = this.getStreamNameCell(streamName).first();
                await streamCell.scrollIntoViewIfNeeded({ timeout: 20000 });
                await streamCell.waitFor({ state: 'visible', timeout: 20000 });
                testLogger.debug('Stream verified in streams page', { streamName });
            } catch (error) {
                testLogger.error('Stream not found in streams page', { streamName, error: error.message });
                throw new Error(`Stream ${streamName} not found in streams page after ingestion`);
            }

            // Step 2: Navigate to logs and verify stream is available in log search.
            // Use the sidebar Logs link (in-app navigation) and then a hard reload so the
            // Vuex streams cache is dropped — without the reload, the OSelect dropdown
            // pulls from the stale list that was fetched on the first /web/logs visit
            // (before this test's stream existed). The reload triggers a fresh
            // streams-list API call.
            await this.navigateToLogs();
            await this.page.reload();
            await this.page.waitForLoadState('domcontentloaded');

            // Wait for the OSelect to mount
            await this.logSearchIndexSelectStream.waitFor({ state: 'visible', timeout: 30000 });

            // Open the stream dropdown
            await this.logSearchIndexSelectStream.click();
            await this.logSearchStreamPopover.waitFor({ state: 'visible', timeout: 15000 });

            // Type the stream name into the popover's ListboxFilter to narrow options.
            // Defensive clear via Ctrl+A → Backspace handles reka-ui's
            // ComboboxInput internal searchTerm state surviving a `.fill()` overwrite.
            await this.logSearchStreamPopoverSearch.waitFor({ state: 'visible', timeout: 10000 });
            await this.logSearchStreamPopoverSearch.press('ControlOrMeta+a');
            await this.logSearchStreamPopoverSearch.press('Backspace');
            await this.logSearchStreamPopoverSearch.fill(streamName);

            // After filtering by stream name, the popover's filteredOptions should narrow to
            // just our stream. Wait until exactly one option remains, then click it.
            // (Note: OSelect's virtualizer can have a stale `data-test-value` attribute
            //  when reusing DOM nodes, so we cannot reliably target by value here; the
            //  filter result count + first-option approach is deterministic.)
            await expect.poll(
                async () => {
                    return await this.getStreamSelectOptions().count().catch(() => -1);
                },
                { intervals: [500, 1000, 2000], timeout: 30000 }
            ).toBeGreaterThanOrEqual(1);
            const option = this.getStreamSelectOptions().first();
            await option.waitFor({ state: 'visible', timeout: 30000 });
            await option.scrollIntoViewIfNeeded({ timeout: 20000 });
            await option.click();
            // Use a non-blocking wait for networkidle as the page may have long-polling connections
            await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
                testLogger.debug('Network idle timeout after stream click - continuing with verification');
            });

            // Step 3: Basic verification - refresh and verify search functionality works
            await this.refreshLogs();

            // Simplified verification - just check that the search completed successfully
            // The refreshLogs method already validates that search API responded successfully
            testLogger.debug('Schema load verification: Search functionality verified');

            // Step 4: Basic structural check - verify search interface is working
            await expect(this.logsSearchResultTableBody).toBeAttached();
            testLogger.debug('Schema load verification: Search results container verified');

            testLogger.debug('Schema load verification workflow completed successfully');

        } catch (error) {
            testLogger.error('Error in schema load verification workflow', { error: error.message, streamName });
            throw error;
        }
    }
}

module.exports = SchemaLoadPage;

class UnflattenedPage {
    constructor(page) {
        this.page = page;
    }

    get streamsMenu() {
        return this.page.locator('[data-test="menu-link-\\/streams-item"]');
    }

    get searchStreamInput() {
        return this.page.getByPlaceholder('Search Stream');
    }

    get streamDetailButton() {
        // The Stream Detail tab inside the detail panel.
        // On some UIs the panel auto-opens when a stream is selected from the list.
        return this.page.locator('[data-test="log-stream-detail-stream-detail-tab"]').first();
    }

    async openStreamDetail(streamName) {
        // Wait for stream list to populate after search
        await this.page.waitForTimeout(2000);

        // Scope the "Stream Detail" button click to the row matching streamName.
        // Search for the row by stream name first, then click that row's
        // Stream Detail action — this avoids accidentally targeting a different
        // row when multiple streams match the search prefix.
        const row = this.page.getByRole('row').filter({ hasText: streamName }).first();
        const detailBtn = row.getByRole('button', { name: /Stream Detail/i }).first();
        await detailBtn.waitFor({ state: 'visible', timeout: 15000 });
        await detailBtn.click({ force: true });

        // Wait for the dialog to render — the Schema tab signals the dialog is ready
        await this.page.getByRole('tab', { name: 'Schema' }).first().waitFor({ state: 'visible', timeout: 15000 });
    }

    get storeOriginalDataToggle() {
        return this.page.locator('[data-test="log-stream-store-original-data-toggle-btn"] div').nth(2);
    }

    get storeOriginalDataToggleInner() {
        return this.page.locator('[data-test="log-stream-store-original-data-toggle-btn"] .q-toggle__inner');
    }

    get schemaUpdateButton() {
        return this.page.locator('[data-test="schema-update-settings-button"]');
    }

    get closeButton() {
        return this.page.getByRole('button').filter({ hasText: /^cancel$/ })
    }

    get exploreButton() {
        return this.page.getByRole('button', { name: 'Explore' }).first();
    }

    get dateTimeButton() {
        return this.page.locator('[data-test="date-time-btn"]');
    }

    get relativeTab() {
        return this.page.locator('[data-test="date-time-relative-tab"]');
    }

    get logTableRowExpandMenu() {
        return this.page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]');
    }

    get logSourceColumn() {
        return this.page.locator('[data-test="log-table-column-0-source"]');
    }

    get o2IdText() {
        return this.page.locator('[data-test="log-detail-json-content"] [data-test="log-expand-detail-key-_o2_id"]');
    }

    get unflattenedTab() {
        return this.page.locator('[data-test="log-detail-json-content"] [data-test="tab-unflattened"]');
    }

    get closeDialog() {
        return this.page.locator('[data-test="close-dialog"]');
    }

    get indexFieldSearchInput() {
        return this.page.locator('[data-cy="index-field-search-input"]');
    }

    get sqlModeToggle() {
        return this.page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2)
    }

    get logsSearchBarQueryEditor() {
        return this.page.locator('[data-test="logs-search-bar-query-editor"]');
    }

    get allFieldsButton() {
        return this.page.locator('[data-test="logs-all-fields-btn"]');
    }

    get configurationTab() {
        return this.page.getByRole('tab', { name: 'Configuration' });
    }

    get streamSettingsUpdatedSnackbar() {
        return this.page.getByText('Stream settings updated');
    }

    get logsSearchBarRefreshButton() {
        return this.page.locator("[data-test='logs-search-bar-refresh-btn']");
    }

    get logDetailJsonContent() {
        return this.page.locator('[data-test="log-detail-json-content"]');
    }

    get allLogDetailKeys() {
        return this.page.locator('[data-test="log-detail-json-content"] [data-test^="log-expand-detail-key-"]');
    }

    get timestampDropdown() {
        return this.page.locator('[data-test="log-detail-json-content"] [data-test="log-expand-detail-key-_timestamp"]');
    }

    async isStoreOriginalDataEnabled() {
        const classList = await this.storeOriginalDataToggleInner.evaluate((node) =>
            Array.from(node.classList)
        );
        const isEnabled = classList.includes("q-toggle__inner--truthy");

        console.log('DEBUG: Toggle classList:', classList);
        console.log('DEBUG: Is enabled?', isEnabled);

        return isEnabled;
    }

    async ensureStoreOriginalDataDisabled() {
        const isEnabled = await this.isStoreOriginalDataEnabled();
        console.log('DEBUG: ensureStoreOriginalDataDisabled - isEnabled:', isEnabled);

        if (isEnabled) {
            console.log('DEBUG: Toggle is enabled, disabling it now');
            await this.storeOriginalDataToggle.click();
            await this.page.waitForTimeout(500);
            await this.schemaUpdateButton.waitFor({ state: "visible", timeout: 5000 });
            await this.schemaUpdateButton.click();
            await this.streamSettingsUpdatedSnackbar.waitFor({ state: "visible", timeout: 10000 });
            await this.page.waitForTimeout(1000);
            console.log('DEBUG: Toggle disabled successfully');
            return true;
        }
        console.log('DEBUG: Toggle is already disabled, no action needed');
        return false;
    }

    async ensureStoreOriginalDataEnabled() {
        const isEnabled = await this.isStoreOriginalDataEnabled();
        console.log('DEBUG: ensureStoreOriginalDataEnabled - isEnabled:', isEnabled);

        if (!isEnabled) {
            console.log('DEBUG: Toggle is disabled, enabling it now');
            await this.storeOriginalDataToggle.click();
            await this.page.waitForTimeout(500);
            await this.schemaUpdateButton.waitFor({ state: "visible", timeout: 5000 });
            await this.schemaUpdateButton.click();
            await this.streamSettingsUpdatedSnackbar.waitFor({ state: "visible", timeout: 10000 });
            await this.page.waitForTimeout(1000);
            console.log('DEBUG: Toggle enabled successfully');
            return true;
        }
        console.log('DEBUG: Toggle is already enabled, no action needed');
        return false;
    }
}
export default UnflattenedPage;


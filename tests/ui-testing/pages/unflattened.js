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
        return this.page.getByRole('button', { name: 'Stream Detail' }).first();
    }

    get storeOriginalDataToggle() {
        return this.page.locator('[data-test="log-stream-store-original-data-toggle-btn"] div').nth(2);
    }

    get schemaUpdateButton() {
        return this.page.locator('[data-test="schema-update-settings-button"]');
    }

    get closeButton() {
        return this.page.locator('button').filter({ hasText: 'close' });
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
        return this.page.locator('[data-test="log-detail-json-content"] [data-test="log-expand-detail-key-_o2_id-text"]');
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
}
export default UnflattenedPage;


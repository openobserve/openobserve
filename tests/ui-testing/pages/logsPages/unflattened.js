import { expect } from '@playwright/test';

class UnflattenedPage {
    constructor(page) {
        this.page = page;

        // Sidebar / navigation
        this.streamsMenu = page.locator('[data-test="menu-link-\\/streams-item"]');

        // Streams list (LogStream.vue)
        // OInput inner native input — always target the `-field` variant for fill
        this.searchStreamInput = page.locator('[data-test="streams-search-stream-input-field"]');

        // Schema dialog (schema.vue)
        this.configurationTab = page.locator('[data-test="schema-configuration-tab"]');
        // Store Original Data toggle wrapper — OSwitch renders an inner button with data-state="checked|unchecked"
        this.storeOriginalDataToggle = page.locator('[data-test="log-stream-store-original-data-toggle-btn"]');
        this.storeOriginalDataToggleInner = page.locator('[data-test="log-stream-store-original-data-toggle-btn"] [data-state]');
        this.schemaUpdateButton = page.locator('[data-test="schema-update-settings-button"]');
        this.closeButton = page.locator('[data-test="schema-cancel-button"]').first();
        // OToast success message body
        this.streamSettingsUpdatedSnackbar = page.locator('[data-test="o-toast-message"]');

        // Logs explorer
        this.dateTimeButton = page.locator('[data-test="date-time-btn"]');
        this.relativeTab = page.locator('[data-test="date-time-relative-tab"]');
        this.logTableRowExpandMenu = page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]');
        this.logSourceColumn = page.locator('[data-test="log-table-column-0-source"]');
        this.o2IdText = page.locator('[data-test="log-detail-json-content"] [data-test="log-expand-detail-key-_o2_id"]');
        this.unflattenedTab = page.locator('[data-test="log-detail-json-content"] [data-test="tab-unflattened"]');
        this.closeDialog = page.locator('[data-test="logs-search-result-detail-dialog"] [data-test="o-drawer-close-btn"]');
        // OFieldList inner search input — scope under the logs index list to avoid
        // collision with the dashboard panel-editor field list also on the page.
        this.indexFieldSearchInput = page.locator('[data-test="logs-search-index-list"] [data-test="o-field-list-search-field"]');
        this.sqlModeToggle = page.locator('[data-test="logs-search-bar-sql-mode-toggle-btn"]');
        this.logsSearchBarQueryEditor = page.locator('[data-test="logs-search-bar-query-editor"]');
        // FieldListPagination receives data-test-prefix="logs-page" from IndexList.vue,
        // so the rendered data-test is `${prefix}-all-fields-btn`.
        this.allFieldsButton = page.locator('[data-test="logs-page-all-fields-btn"]');
        this.logsSearchBarRefreshButton = page.locator('[data-test="logs-search-bar-refresh-btn"]');
        this.logDetailJsonContent = page.locator('[data-test="log-detail-json-content"]');
        this.allLogDetailKeys = page.locator('[data-test="log-detail-json-content"] [data-test^="log-expand-detail-key-"]');
        this.timestampDropdown = page.locator('[data-test="log-detail-json-content"] [data-test="log-expand-detail-key-_timestamp"]');
        // Explore action on the streams table row — when only one row is filtered, .first() is deterministic
        this.exploreButton = page.locator('[data-test="log-stream-explore-btn"]').first();
    }

    /**
     * Open the stream schema/detail dialog for the named stream from the
     * Streams list. Walks up from the per-name name cell (deterministic
     * data-test) to the OTable row, hovers to reveal the action buttons,
     * then clicks the schema button.
     */
    async openStreamDetail(streamName) {
        // Wait for stream list to populate after search
        await this.page.waitForTimeout(2000);

        // Resolve the row containing the named stream via the per-name cell data-test,
        // then walk up the DOM to the OTable row (data-test^="o2-table-row-").
        const nameCell = this.page.locator(`[data-test="log-stream-name-cell-${streamName}"]`).first();
        const row = nameCell.locator(`xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]`).first();

        // The schema button is hidden until the row is hovered.
        // Hover first to make it visible, then click with force as a fallback.
        await row.hover();
        const detailBtn = row.locator('[data-test="log-stream-schema-btn"]').first();
        await detailBtn.click({ force: true, timeout: 15000 });

        // Wait for the dialog to render — the Schema settings tab signals the dialog is ready
        await this.page.locator('[data-test="schema-settings-tab"]').first().waitFor({ state: 'visible', timeout: 15000 });
    }

    async isStoreOriginalDataEnabled() {
        // OSwitch exposes `data-state="checked"` when ON, `"unchecked"` when OFF.
        await this.storeOriginalDataToggleInner.first().waitFor({ state: 'visible', timeout: 10000 });
        const state = await this.storeOriginalDataToggleInner.first().getAttribute('data-state');
        const isEnabled = state === 'checked';

        console.log('DEBUG: Toggle data-state:', state);
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

    async clickInterestingFieldButton(fieldName) {
        // Scope under the logs index list to avoid potential collision with the
        // dashboard panel-editor field list (which also exposes interesting-field
        // controls in some layouts).
        const btn = this.page
            .locator(`[data-test="logs-search-index-list"] [data-test="log-search-index-list-interesting-${fieldName}-field-btn"]`)
            .first();
        await btn.waitFor({ state: 'visible' });
        // Force-click: an adjacent tooltip icon path intermittently intercepts
        // pointer events at the moment of click; force bypasses the overlay.
        await btn.click({ force: true });
    }

    async expectQueryEditorContainsText(textOrRegex) {
        await this.logsSearchBarQueryEditor.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        await expect(this.logsSearchBarQueryEditor).toContainText(textOrRegex, { timeout: 10000 });
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

    /**
     * Open the log detail drawer for the row at index `rowIndex` (0-based, as
     * rendered by the virtualized table).  Expands the row via its expand
     * button and then opens the source column to render the JSON detail.
     */
    async openLogRowDetail(rowIndex) {
        const expandBtn = this.page.locator(
            `[data-test="log-table-column-${rowIndex}-_timestamp"] [data-test="table-row-expand-menu"]`
        );
        await expandBtn.waitFor({ state: 'visible', timeout: 15000 });
        await expandBtn.click();
        const sourceCell = this.page.locator(`[data-test="log-table-column-${rowIndex}-source"]`);
        await sourceCell.waitFor({ state: 'visible', timeout: 15000 });
        await sourceCell.click();
        // Wait for the detail drawer to be open — deterministic on drawer state.
        await this.page
            .locator('[data-test="logs-search-result-detail-dialog"][data-state="open"]')
            .waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Close the log detail drawer if it is open. Uses Escape as the fallback
     * when the close button is intercepted by an overlay.
     */
    async closeLogDetailDrawerIfOpen() {
        const detailDialog = this.page.locator(
            '[data-test="logs-search-result-detail-dialog"][data-state="open"]'
        );
        if (await detailDialog.isVisible().catch(() => false)) {
            await this.closeDialog.click().catch(async () => {
                await this.page.keyboard.press('Escape');
            });
            await detailDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        }
    }

    /**
     * Iterate through the first `maxRows` log rows and return the index of the
     * first row whose detail contains the `_o2_id` field.  Leaves the detail
     * drawer OPEN on the matching row so the caller can continue interacting
     * with the `_o2_id` element.  Returns -1 if no row in the range contains
     * `_o2_id`.
     */
    async findRowWithO2Id(maxRows = 5) {
        for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
            const expandBtn = this.page.locator(
                `[data-test="log-table-column-${rowIndex}-_timestamp"] [data-test="table-row-expand-menu"]`
            );
            // Stop if the row doesn't exist (table shorter than maxRows).
            if (!(await expandBtn.isVisible().catch(() => false))) {
                break;
            }
            await this.openLogRowDetail(rowIndex);
            // Probe for _o2_id with a short timeout — rows that pre-date the
            // schema change won't have it.
            const found = await this.o2IdText
                .waitFor({ state: 'visible', timeout: 3000 })
                .then(() => true)
                .catch(() => false);
            if (found) {
                return rowIndex;
            }
            await this.closeLogDetailDrawerIfOpen();
        }
        return -1;
    }
}
export default UnflattenedPage;

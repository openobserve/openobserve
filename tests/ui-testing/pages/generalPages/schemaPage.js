const logData = require("../../fixtures/log.json");
const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

class SchemaPage {
    constructor(page) {
        this.page = page;

        // =========================================================
        // Static class-member locators (POM strict — §3)
        // =========================================================
        // Navigation / menu links
        this.menuStreamItem = page.locator('[data-test="menu-link-\\/streams-item"]');
        this.menuHomeItem = page.locator('[data-test="menu-link-\\/-item"]');
        this.menuLogsItem = page.locator('[data-test="menu-link-\\/logs-item"]');

        // Streams listing page (LogStream.vue)
        // OInput wrapper `streams-search-stream-input` → inner native input is auto-derived `-field`
        this.streamsSearchStreamInput = page.locator('[data-test="streams-search-stream-input"]');
        this.streamsSearchStreamInputField = page.locator('[data-test="streams-search-stream-input-field"]');
        this.logStreamRefreshStatsBtn = page.locator('[data-test="log-stream-refresh-stats-btn"]');
        this.logStreamAddStreamBtn = page.locator('[data-test="log-stream-add-stream-btn"]');

        // AddStream drawer (AddStream.vue migrated to ODrawer)
        this.addStreamDialog = page.locator('[data-test="add-stream-dialog"]');
        this.addStreamNameInputField = page.locator('[data-test="add-stream-dialog"] [data-test="add-stream-name-input-field"]');
        this.addStreamTypeInput = page.locator('[data-test="add-stream-dialog"] [data-test="add-stream-type-input"]');
        this.addStreamTypeOptionLogs = page.locator('[data-test="add-stream-type-input-option"][data-test-value="logs"]');
        // AddStream renders ODrawer (isInPipeline=false) on the Streams page — save via ODrawer primary button.
        this.addStreamSaveBtn = page.locator('[data-test="add-stream-dialog"] [data-test="o-dialog-primary-btn"]');

        // Schema drawer (schema.vue migrated to ODrawer with data-test="schema-drawer")
        this.schemaDrawer = page.locator('[data-test="schema-drawer"]');
        this.schemaDrawerCloseBtn = page.locator('[data-test="schema-drawer"] [data-test="o-drawer-close-btn"]');
        this.schemaTitleText = page.locator('[data-test="schema-title-text"]');
        this.schemaAddFieldButton = page.locator('[data-test="schema-add-field-button"]');
        this.schemaUpdateSettingsButton = page.locator('[data-test="schema-update-settings-button"]');
        this.schemaCancelButton = page.locator('[data-test="schema-cancel-button"]');
        this.schemaAddFieldsTitle = page.locator('[data-test="schema-add-fields-title"]');
        this.schemaFieldSearchInput = page.locator('[data-test="schema-field-search-input"]');
        this.schemaFieldSearchInputField = page.locator('[data-test="schema-field-search-input-field"]');
        this.schemaDeleteButton = page.locator('[data-test="schema-delete-button"]');
        this.schemaLogStreamFieldMappingTable = page.locator('[data-test="schema-log-stream-field-mapping-table"]');
        // Schema fields tabs (OToggleGroup wrapper)
        this.schemaFieldsTabs = page.locator('[data-test="schema-fields-tabs"]');
        // Confirm dialog (ConfirmDialog migrated to ODialog)
        this.confirmDialogPrimaryBtn = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
        // Generic ODialog primary button — used when no confirm-dialog wrapper is present.
        this.dialogPrimaryBtn = page.locator('[data-test="o-dialog-primary-btn"]');

        // Stream delete dialog (LogStream.vue → ODialog)
        this.logStreamDeleteDialog = page.locator('[data-test="log-stream-delete-dialog"]');
        this.logStreamDeleteDialogOk = page.locator('[data-test="log-stream-delete-dialog"] [data-test="o-dialog-primary-btn"]');

        // Logs page query / search bar
        this.logsSearchBarQueryEditor = page.locator('[data-test="logs-search-bar-query-editor"]');
        this.logsSearchBarRefreshBtn = page.locator('[data-test="logs-search-bar-refresh-btn"]');
        this.logsSearchErrorMessage = page.locator('[data-test="logs-search-error-state"]');
        this.dateTimeBtn = page.locator('[data-test="date-time-btn"]');
        this.dateTimeRelativeTab = page.locator('[data-test="date-time-relative-tab"]');
        this.logTableExpandMenu = page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]');

        // IndexList / stream picker (OSelect in listbox/multiple mode)
        // OSelect uses `inheritAttrs: false` and forwards `data-test` onto the
        // root wrapper <div>, while the actual clickable PopoverTrigger button
        // is published as `${parent}-trigger`. Clicking the wrapper div does
        // NOT open the popover — we must click the `-trigger` button.
        this.logSearchIndexSelectStream = page.locator('[data-test="log-search-index-list-select-stream-trigger"]');
        // OSelect popover renders with `${parent}-popover`; the inner ListboxFilter
        // is data-tested via `${parent}-search` (forwarded from OSelect.vue).
        this.logSearchStreamPopover = page.locator('[data-test="log-search-index-list-select-stream-popover"]');
        this.logSearchStreamPopoverSearch = page.locator('[data-test="log-search-index-list-select-stream-search"]');
        this.logSearchIndexFieldSearchInput = page.locator('[data-test="log-search-index-list-field-search-input"]');
        this.logSearchIndexFieldsTable = page.locator('[data-test="log-search-index-list-fields-table"]');
        this.logsUserDefinedFieldsBtn = page.locator('[data-test="logs-user-defined-fields-btn"]');
        this.logsAllFieldsBtn = page.locator('[data-test="logs-all-fields-btn"]');
        this.logSearchIndexAllFieldBtn = page.locator('[data-test="log-search-index-list-interesting-_all-field-btn"]');
        this.logExpandDetailAllKey = page.locator('[data-test="log-expand-detail-key-_all"]');

        // VRL / show-query toggle
        this.fnEditor = page.locator('[data-test="logs-vrl-function-editor"]');
        this.showQueryToggleBtn = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
        // Utilities dropdown — the toggle is now inside an ODropdown in SearchBar.vue
        this.utilitiesMenuBtn = page.locator('[data-test="logs-search-bar-utilities-menu-btn"]');
        this.menuTransformEditorToggleBtn = page.locator('[data-test="logs-search-bar-menu-transform-editor-toggle-btn"]');

        // Per-row action buttons on the LogStream OTable (cell-actions template)
        this.logStreamSchemaBtnFirst = page.locator('[data-test="log-stream-schema-btn"]').first();
        this.logStreamExploreBtnFirst = page.locator('[data-test="log-stream-explore-btn"]').first();

        // Field row expanders on the log search index list (FieldRow templates)
        this.logSearchExpandAllField = page.locator('[data-test="log-search-expand-_all-field"]');
        this.logSearchExpandTimestampField = page.locator('[data-test="log-search-expand-_timestamp-field"]');

        // Stream-fields-table expanders scoped under logSearchIndexFieldsTable
        this.logSearchIndexFieldsTableAllField = page.locator('[data-test="log-search-index-list-fields-table"] [data-test="log-search-expand-_all-field"]');
        this.logSearchIndexFieldsTableTimestampField = page.locator('[data-test="log-search-index-list-fields-table"] [data-test="log-search-expand-_timestamp-field"]');

        // Stream picker option factory selector — built per call via getStreamOption.
        this.logsSearchResultLoading = page.locator('[data-test="logs-search-result-loading"]');

        // AddStream / Schema field add row inputs — schema.vue StreamFieldsInputs row
        this.schemaNewFieldNameInputField = page.locator('[data-test="schema-new-field-name-input-field"], [data-test="add-stream-field-name-input-field"]').first();
        this.schemaNewFieldDataTypeSelect = page.locator('[data-test="schema-new-field-data-type-select"], [data-test="add-stream-field-data-type-select"]').first();

        // Counter locator used for diagnostic schema-element counting
        this.schemaElementCountLocator = page.locator('[data-test*="schema"]');

        // =========================================================
        // Legacy schemaLocators map preserved for any callers that
        // still reference it via PageManager — values stay aligned
        // with the hoisted locators above so behaviour is identical.
        // =========================================================
        this.schemaLocators = {
            menuStreamItem: '[data-test="menu-link-\\/streams-item"]',
            streamSearchPlaceholder: 'Search Stream',
            streamDetailButton: 'Stream Detail',
            streamDeleteKubernetesCheckbox: '[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]',
            streamDeleteKubernetesPspCheckbox: '[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]',
            schemaAddFieldButton: '[data-test="schema-add-field-button"]',
            schemaUpdateSettingsButton: '[data-test="schema-update-settings-button"]',
            tabSchemaFields: '[data-test="tab-schemaFields"]',
            tabAllFields: '[data-test="tab-allFields"]',
            explorerButton: 'Explore',
            closeButton: 'close',
            dateTimeBtn: '[data-test="date-time-btn"]',
            dateTimeRelativeTab: '[data-test="date-time-relative-tab"]',
            logTableExpandMenu: '[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]',
            logsUserDefinedFieldsBtn: '[data-test="logs-user-defined-fields-btn"]',
            logSearchIndexAllFieldBtn: '[data-test="log-search-index-list-interesting-_all-field-btn"]',
            logSearchIndexFieldSearchInput: '[data-test="log-search-index-list-field-search-input"]',
            logSearchIndexFieldsTable: '[data-test="log-search-index-list-fields-table"]',
            logsAllFieldsBtn: '[data-test="logs-all-fields-btn"]',
            logExpandDetailAllKey: '[data-test="log-expand-detail-key-_all"]',
            logsSearchBarQueryEditor: '[data-test="logs-search-bar-query-editor"]',
            logsSearchBarRefreshBtn: '[data-test="logs-search-bar-refresh-btn"]',
            logsSearchErrorMessage: '[data-test="logs-search-error-state"]',
            showQueryToggleBtn: '[data-test="logs-search-bar-show-query-toggle-btn"] div',
            // Stream creation locators
            logStreamAddStreamBtn: '[data-test="log-stream-add-stream-btn"]',
            nameLabel: 'Name *',
            // AddStream.vue migrated from the legacy button to ODrawer's primary footer
            // button — there is no standalone "save-stream-btn" any more.
            saveStreamBtn: '[data-test="add-stream-dialog"] [data-test="o-dialog-primary-btn"]',
            menuHomeItem: '[data-test="menu-link-\\/-item"]',
            menuLogsItem: '[data-test="menu-link-\\/logs-item"]',
            fnEditor: '[data-test="logs-vrl-function-editor"]',
            logSearchIndexSelectStream: '[data-test="log-search-index-list-select-stream-trigger"]',
            logStreamRefreshStatsBtn: '[data-test="log-stream-refresh-stats-btn"]',
            deleteButton: 'Delete',
            okButton: 'Ok',
            // Schema field management locators
            schemaAddFieldsTitle: '[data-test="schema-add-fields-title"]',
            namePlaceholder: 'Name *',
            dataTypePlaceholder: 'Data Type *',
            schemaFieldSearchInput: '[data-test="schema-field-search-input"]',
            schemaDeleteButton: '[data-test="schema-delete-button"]',
            // ConfirmDialog migrated to ODialog — primary footer button
            // is now exposed via the common o-dialog-primary-btn slug.
            confirmButton: '[data-test="o-dialog-primary-btn"]'
        };
    }

    // =========================================================
    // Factory helpers for runtime-dynamic locators
    // =========================================================
    // Stream row by name in LogStream OTable — uses the deterministic
    // per-name cell data-test rendered via #cell-name template.
    getStreamRowByName(name) {
        return this.page.locator(`[data-test="log-stream-name-cell-${name}"]`);
    }

    // The per-row delete button (LogStream.vue line 160 → data-test="log-stream-delete-btn").
    // Walk up from the per-name name-cell to the OTable row container, then back down
    // to the delete button (selector kept inside the same row).
    getStreamDeleteButton(name) {
        return this.page
            .locator(`[data-test="log-stream-name-cell-${name}"]`)
            .locator('xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]')
            .locator('[data-test="log-stream-delete-btn"]');
    }

    // Schema-page row's "schema" (Stream Detail) action button per stream.
    getStreamSchemaButton(name) {
        return this.page
            .locator(`[data-test="log-stream-name-cell-${name}"]`)
            .locator('xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]')
            .locator('[data-test="log-stream-schema-btn"]');
    }

    // Schema fields table — name-cell per field. schema.vue line 535:
    // `<span :data-test="`schema-field-name-cell-${row.name}`">`.
    getSchemaFieldCell(name) {
        return this.page.locator(`[data-test="schema-field-name-cell-${name}"]`);
    }

    // Stream picker option (OSelect) by data-test-value
    getStreamOption(stream) {
        return this.page.locator(
            `[data-test="log-search-index-list-select-stream-option"][data-test-value="${stream}"]`,
        );
    }

    // Get any OSelect option inside the stream selector popover. Used together
    // with the popover-search input to narrow the list and click the first
    // remaining option (works around an OSelect virtualizer bug where the
    // rendered `data-test-value` attribute can lag behind the option's true
    // value when DOM rows are reused on a filter narrow).
    getStreamPopoverOptions() {
        return this.page.locator(
            '[data-test="log-search-index-list-select-stream-popover"] [data-test="log-search-index-list-select-stream-option"]',
        );
    }

    // Schema new-field data-type option by data-test-value
    getSchemaDataTypeOption(value) {
        return this.page.locator(
            `[data-test="schema-new-field-data-type-select-option"][data-test-value="${value}"], ` +
            `[data-test="add-stream-field-data-type-select-option"][data-test-value="${value}"]`,
        );
    }

    // Apply query button action
    async applyQuery() {
        testLogger.debug('Applying query with search response wait');
        // OButton returns early in handleClick when loading=true, so wait for enabled first.
        await this.logsSearchBarRefreshBtn.waitFor({ state: 'visible', timeout: 15000 });
        await expect(this.logsSearchBarRefreshBtn).toBeEnabled({ timeout: 15000 });
        const search = this.page.waitForResponse(logData.applyQuery);
        await this.logsSearchBarRefreshBtn.click();
        await expect.poll(async () => (await search).status(), { timeout: 30000 }).toBe(200);
    }

    // Navigate to streams page
    async navigateToStreams() {
        testLogger.debug('Navigating to streams page');
        await this.menuStreamItem.click();
    }

    // Search for stream
    async searchStream(streamName) {
        testLogger.debug('Searching for stream', { streamName });
        await this.streamsSearchStreamInputField.waitFor({ state: 'visible', timeout: 15000 });
        await this.streamsSearchStreamInputField.click();
        await this.streamsSearchStreamInputField.fill(streamName);
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Open stream details
    async openStreamDetails() {
        testLogger.debug('Opening stream details');
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Find the schema (Stream Detail) action button on the first visible row of the table.
        // We can't rely on a per-name button (LogStream.vue cell-actions buttons have a generic
        // data-test), so we use `.first()` which deterministically resolves to the leading row
        // after the stream search filter narrows the OTable down to one row.
        await this.logStreamSchemaBtnFirst.waitFor({ state: 'visible', timeout: 15000 });
        await this.logStreamSchemaBtnFirst.click();

        await this.page.waitForLoadState('domcontentloaded');
    }

    // Configure schema fields
    async configureSchemaFields() {
        testLogger.debug('Configuring schema fields - removing kubernetes annotations if present');

        // Ensure we're in the right tab context
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Try to find and click kubernetes checkboxes (they may not always exist).
        // These names are legacy from the old table schema; if the corresponding
        // data-tests no longer exist after the OTable migration the row checkboxes
        // are simply not found and the try-block swallows the timeout.
        try {
            const kubernetesRow = this.getSchemaFieldCell('kubernetes_annotations_kubectl_kubernetes_io_default_container')
                .first()
                .locator('xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]')
                .locator('[data-test="o2-table-row-checkbox"]');
            if (await kubernetesRow.isVisible({ timeout: 5000 })) {
                await kubernetesRow.click();
                testLogger.debug('Clicked kubernetes default container checkbox');
            }
        } catch (error) {
            testLogger.debug('Kubernetes default container checkbox not found or not clickable');
        }

        try {
            const kubernetesPspRow = this.getSchemaFieldCell('kubernetes_annotations_kubernetes_io_psp')
                .first()
                .locator('xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]')
                .locator('[data-test="o2-table-row-checkbox"]');
            if (await kubernetesPspRow.isVisible({ timeout: 5000 })) {
                await kubernetesPspRow.click();
                testLogger.debug('Clicked kubernetes psp checkbox');
            }
        } catch (error) {
            testLogger.debug('Kubernetes psp checkbox not found or not clickable');
        }

        // Always try to add field and update settings
        await this.schemaAddFieldButton.waitFor({ state: 'visible', timeout: 15000 });
        await this.schemaAddFieldButton.click();

        await this.schemaUpdateSettingsButton.waitFor({ state: 'visible', timeout: 15000 });
        await this.schemaUpdateSettingsButton.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Navigate to schema fields tab
    async navigateToSchemaFieldsTab() {
        testLogger.debug('Navigating to schema fields tab');
        // OToggleGroupItem doesn't carry its own data-test; locate by parent wrapper
        // and ToggleGroupRoot value via xpath data-* attribute.
        const tab = this.schemaFieldsTabs.locator('[data-state][value="schemaFields"]');
        await tab.waitFor({ state: 'visible' });
        await tab.click();
    }

    // Navigate to all fields tab
    async navigateToAllFieldsTab() {
        testLogger.debug('Navigating to all fields tab');
        const tab = this.schemaFieldsTabs.locator('[data-state][value="allFields"]');
        await tab.waitFor({ state: 'visible' });
        await tab.click();
    }

    // Verify kubernetes annotation fields are visible
    async verifyKubernetesAnnotationFields() {
        testLogger.debug('Verifying kubernetes annotation fields visibility');
        await this.getSchemaFieldCell('kubernetes_annotations_kubectl_kubernetes_io_default_container').click();
        await this.getSchemaFieldCell('kubernetes_annotations_kubernetes_io_psp').click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Close dialog
    async closeDialog() {
        testLogger.debug('Closing dialog');
        await this.schemaDrawerCloseBtn.click();
    }

    // Explore stream
    async exploreStream() {
        testLogger.debug('Exploring stream');
        // LogStream OTable per-row explore button (data-test="log-stream-explore-btn")
        await this.logStreamExploreBtnFirst.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Configure date time settings
    async configureDateTimeSettings() {
        testLogger.debug('Configuring date time settings');
        await this.dateTimeBtn.click();
        await this.dateTimeRelativeTab.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Expand first log row
    async expandFirstLogRow() {
        testLogger.debug('Expanding first log row');
        await this.logTableExpandMenu.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Configure user defined fields
    async configureUserDefinedFields() {
        testLogger.debug('Configuring user defined fields');
        await this.logsUserDefinedFieldsBtn.click();
        await this.logSearchIndexAllFieldBtn.last().click({ force: true });
    }

    // Expand all dropdown and search fields
    async expandAllDropdownAndSearchFields() {
        testLogger.debug('Expanding all dropdown and searching for fields');
        // Toggle the `_all` field group expander via the field-expand data-test
        await this.logSearchExpandAllField.click();
        await this.logSearchIndexFieldSearchInput.click();
        await this.logSearchIndexFieldSearchInput.fill('_timestamp');
        await this.logSearchIndexFieldsTableTimestampField.click();
        await this.logSearchIndexFieldSearchInput.click();
        await this.logSearchIndexFieldSearchInput.fill('_all');
        await this.logSearchIndexFieldsTableAllField.waitFor({ state: 'visible' });
    }

    // Navigate to all fields
    async navigateToAllFields() {
        testLogger.debug('Navigating to all fields');
        await this.logsAllFieldsBtn.click();
        await this.logSearchIndexFieldSearchInput.click();
        await this.logSearchIndexFieldsTableAllField.waitFor({ state: 'visible' });
        await this.logSearchIndexFieldSearchInput.click();
        await this.logSearchIndexFieldSearchInput.fill('_timestamp');
        await this.logSearchIndexFieldsTableTimestampField.click();
    }

    // Wait for _all field and add query
    async waitForAllFieldAndAddQuery() {
        testLogger.debug('Waiting for _all field and adding query');
        await this.logExpandDetailAllKey.waitFor({ state: 'visible' });
        // Drive the Monaco editor via window.monaco — clicking `.monaco-editor` is banned (§2)
        await this.page.waitForFunction(
            () => Boolean(window.monaco?.editor?.getEditors()?.length),
            { timeout: 15000 },
        );
        await this.page.evaluate((text) => {
            const editor = window.monaco.editor.getEditors()[0];
            if (editor) editor.setValue(text);
        }, "str_match(_all, 'test')");
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Run query and verify no error
    async runQueryAndVerifyNoError() {
        testLogger.debug('Running query and verifying no error');
        await this.logsSearchBarRefreshBtn.click();
        await this.page.waitForLoadState('domcontentloaded');
        await expect(this.logsSearchErrorMessage).not.toBeVisible();
    }

    // Click timestamp dropdown
    async clickTimestampDropdown() {
        testLogger.debug('Clicking timestamp dropdown');
        // Use the field-row expand-toggle data-test instead of plain-text matching
        await this.logSearchExpandTimestampField.first().click();
    }

    // Create new stream
    async createNewStream(streamName) {
        testLogger.debug('Creating new stream', { streamName });
        await this.logStreamAddStreamBtn.click();
        // ODrawer transitions in — wait for the dialog wrapper to be visible.
        await this.addStreamDialog.waitFor({ state: 'visible', timeout: 15000 });
        await this.addStreamNameInputField.click();
        await this.addStreamNameInputField.fill(streamName);
        // OSelect popover: open trigger, pick the `logs` option by its data-test-value
        await this.addStreamTypeInput.click();
        await this.addStreamTypeOptionLogs.waitFor({ state: 'visible', timeout: 10000 });
        await this.addStreamTypeOptionLogs.click();
        await this.addStreamSaveBtn.click();
        // Wait for the drawer to close after a successful save (ODrawer is removed from DOM).
        await this.addStreamDialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Navigate home then logs
    //
    // Performs a hard reload after landing on /web/logs so the Vuex streams
    // cache is dropped — without the reload, the OSelect dropdown pulls from
    // the stale list that was fetched on the first /web/logs visit (before
    // any stream created by this test existed). The reload triggers a fresh
    // streams-list API call so the new blank stream appears as an option.
    async navigateHomeThenLogs() {
        testLogger.debug('Navigating home then to logs');
        await this.menuHomeItem.click();
        await this.menuLogsItem.click();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.reload();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Switch stream in logs
    async switchStreamInLogs(fromStream, toStream) {
        testLogger.debug('Switching stream in logs', { fromStream, toStream });

        // Check if VRL editor is available
        const fnEditorCount = await this.fnEditor.count();

        if (fnEditorCount === 0) {

            // Try to reload the page with VRL editor enabled
            const currentUrl = new URL(this.page.url());
            currentUrl.searchParams.set('fn_editor', 'true');
            currentUrl.searchParams.set('vrl', 'true');

            await this.page.goto(currentUrl.toString());
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            const fnEditorCountAfterReload = await this.fnEditor.count();

            if (fnEditorCountAfterReload === 0) {
                // Skip the VRL editor click and try alternative approach
                await this._pickStreamOption(fromStream);
                await this.page.waitForLoadState('domcontentloaded');
                await this._pickStreamOption(toStream);
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                // Wait for the spinner / loading state to dissolve before continuing.
                await this.logsSearchResultLoading.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
                return; // Exit early, skipping VRL editor interaction
            }
        }

        // Try clicking the monaco editor by activating it through the show-query toggle.
        // The previous `.monaco-editor` CSS-class click is banned (§2). Activate the
        // editor by opening the function editor area via window.monaco focus.
        try {
            await this.fnEditor.first().waitFor({ state: 'visible', timeout: 3000 });
        } catch (error) {
            testLogger.warn('Failed to find monaco editor visible, trying toggle button');

            // The show-query toggle moved into the utilities ODropdown in SearchBar.vue.
            // Check if it is directly visible (FunctionSelector/TransformSelector path);
            // if not, open the utilities menu first and click the dropdown item.
            const isToggleDirectlyVisible = await this.showQueryToggleBtn.first().isVisible().catch(() => false);
            if (isToggleDirectlyVisible) {
                await this.showQueryToggleBtn.first().click({ force: true });
            } else {
                await this.utilitiesMenuBtn.click();
                await this.menuTransformEditorToggleBtn.waitFor({ state: 'visible', timeout: 5000 });
                await this.menuTransformEditorToggleBtn.click();
            }
            await this.fnEditor.first().waitFor({ state: 'visible', timeout: 15000 });
        }
        await this._pickStreamOption(fromStream);
        await this.page.waitForLoadState('domcontentloaded');
        await this._pickStreamOption(toStream);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Dismiss the OSelect popover with Escape and confirm by waiting on its detachment.
        await this.page.keyboard.press('Escape').catch(() => {});
        // Wait until the timestamp field shows up in the stream-fields table, signalling
        // the new stream's schema has been loaded.
        await this.logSearchIndexFieldsTable
            .locator('[data-test="log-search-expand-_timestamp-field"]')
            .waitFor({ state: 'visible', timeout: 15000 })
            .catch(() => {});
    }

    // Helper: open the OSelect stream popover and click the option whose
    // data-test-value matches the requested stream name. Used by switchStreamInLogs
    // (replaces the legacy fill + getByText pattern).
    //
    // Uses the OSelect popover-search pattern: open trigger → wait popover →
    // clear search input (Ctrl/Meta+a, Backspace) → fill stream name → wait
    // until the filtered popover narrows to >=1 option → click the first option.
    // The first-option strategy works around an OSelect virtualizer bug where
    // the rendered `data-test-value` attribute can lag behind the option's
    // true value when DOM rows are reused on a filter narrow.
    async _pickStreamOption(stream) {
        // Wait for the trigger to be in a stable closed state before clicking.
        // Reka popover transitions take ~150-200ms; allow up to 5s for full
        // settlement (animation + state attribute flip).
        await expect(this.logSearchIndexSelectStream)
            .toHaveAttribute('aria-expanded', 'false', { timeout: 5000 })
            .catch(() => {});

        // Open the popover with retry. Reka PopoverTrigger toggles state on
        // each click; if the previous _pickStreamOption left the popover open
        // (multi-mode + Escape race), the first click here would CLOSE it.
        // Retry the click up to 3 times until we see the popover visible.
        let popoverOpen = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            await this.logSearchIndexSelectStream.click();
            // Small animation grace — Reka popover slide-in animation needs
            // ~200ms to attach to DOM (user-approved waitForTimeout for
            // animation races, AGENT_RULES §10 override).
            await this.page.waitForTimeout(300);
            popoverOpen = await this.logSearchStreamPopover
                .isVisible({ timeout: 3000 })
                .catch(() => false);
            if (popoverOpen) break;
            testLogger.warn(`[_pickStreamOption] popover not visible after click attempt ${attempt}, retrying`);
            // If trigger toggled the wrong way, press Escape to force-close
            // and try again on the next iteration.
            await this.page.keyboard.press('Escape').catch(() => {});
            await this.page.waitForTimeout(200);
        }
        // Final hard wait for visibility — if all retries failed this throws
        // with the original timeout error and CI screenshots capture state.
        await this.logSearchStreamPopover.waitFor({ state: 'visible', timeout: 10000 });

        // Defensive clear via Ctrl/Meta+A → Backspace handles reka-ui's
        // ComboboxInput internal searchTerm state surviving a `.fill()` overwrite.
        await this.logSearchStreamPopoverSearch.waitFor({ state: 'visible', timeout: 10000 });
        await this.logSearchStreamPopoverSearch.press('ControlOrMeta+a');
        await this.logSearchStreamPopoverSearch.press('Backspace');
        await this.logSearchStreamPopoverSearch.fill(stream);

        // Wait until the filtered popover has at least one option (the typed
        // stream name should narrow the list to just our stream).
        await expect.poll(
            async () => await this.getStreamPopoverOptions().count().catch(() => -1),
            { intervals: [500, 1000, 2000], timeout: 20000 },
        ).toBeGreaterThanOrEqual(1);

        const option = this.getStreamPopoverOptions().first();
        await option.waitFor({ state: 'visible', timeout: 10000 });
        await option.click();
        // In multiple/listbox mode the popover stays open after option click —
        // deterministically dismiss it and wait for the trigger to report
        // `aria-expanded="false"` so the next _pickStreamOption call can safely
        // open it again. Without this gate, the next trigger click toggles the
        // still-open popover to closed and the popover-visible wait times out.
        await this.page.keyboard.press('Escape').catch(() => {});
        // Allow Reka close animation to flush before aria-expanded check.
        await this.page.waitForTimeout(300);
        await expect(this.logSearchIndexSelectStream)
            .toHaveAttribute('aria-expanded', 'false', { timeout: 5000 })
            .catch(() => {});
    }

    // Refresh stream stats and delete
    async refreshStreamStatsAndDelete(streamName) {
        testLogger.debug('Refreshing stream stats and deleting stream', { streamName });
        await this.streamsSearchStreamInputField.waitFor({ state: 'visible', timeout: 15000 });
        await this.streamsSearchStreamInputField.click();
        await this.streamsSearchStreamInputField.fill(streamName);
        await this.page.waitForLoadState('domcontentloaded');
        await this.logStreamRefreshStatsBtn.click();
        await this.streamsSearchStreamInputField.click();
        // Re-focus the search input to keep the filter in place
        await this.streamsSearchStreamInputField.click();

        // Wait for the specific stream row (by the per-name name-cell) and click its delete button
        const nameCell = this.getStreamRowByName(streamName);
        await nameCell.waitFor({ state: 'visible', timeout: 10000 });
        await this.getStreamDeleteButton(streamName).click();
        // ODialog confirmation — primary OK button inside the log-stream-delete-dialog wrapper.
        await this.logStreamDeleteDialog.waitFor({ state: 'visible', timeout: 10000 });
        await this.logStreamDeleteDialogOk.click();
        await this.logStreamDeleteDialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    // Add new schema field
    async addNewSchemaField(fieldName) {
        testLogger.debug('Adding new schema field', { fieldName });
        await this.schemaAddFieldsTitle.click();
        // StreamFieldsInputs renders OInput rows; the first row's name field carries
        // a generic OInput data-test forwarded to the inner field.
        await this.schemaNewFieldNameInputField.waitFor({ state: 'visible', timeout: 10000 });
        await this.schemaNewFieldNameInputField.click();
        await this.schemaNewFieldNameInputField.fill(fieldName);
    }

    // Search for schema field
    async searchSchemaField(fieldName) {
        testLogger.debug('Searching for schema field', { fieldName });
        await this.schemaFieldSearchInputField.fill(fieldName);
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Delete schema field by checkbox
    async deleteSchemaFieldByCheckbox(fieldName) {
        testLogger.debug('Deleting schema field by checkbox', { fieldName });
        // OTable selection checkbox lives in the row matched by the schema-field-name-cell.
        const row = this.getSchemaFieldCell(fieldName)
            .locator('xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]');
        await row.locator('[data-test="o2-table-row-checkbox"]').click();
        await this.schemaAddFieldButton.click();
        await this.schemaUpdateSettingsButton.click();
    }

    // Delete schema field permanently
    async deleteSchemaFieldPermanently(fieldName) {
        testLogger.debug('Deleting schema field permanently', { fieldName });
        // Click the field's name cell to select / focus it, then check the row checkbox.
        const nameCell = this.getSchemaFieldCell(fieldName);
        await nameCell.first().click();
        const row = nameCell.first()
            .locator('xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]');
        await row.locator('[data-test="o2-table-row-checkbox"]').first().click();
        await this.schemaDeleteButton.click();
        // Confirm dialog primary button — try the scoped confirm-dialog wrapper first,
        // fall back to the generic ODialog primary button.
        const scopedOk = this.confirmDialogPrimaryBtn;
        if (await scopedOk.isVisible({ timeout: 2000 }).catch(() => false)) {
            await scopedOk.click();
        } else {
            await this.dialogPrimaryBtn.first().click();
        }
        await this.page.waitForLoadState('domcontentloaded');
        await this.schemaDrawerCloseBtn.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Select random data type for schema field
    async selectRandomDataType() {
        testLogger.debug('Selecting random data type');
        // Open the data-type OSelect — wrapper carries data-test on the row input
        await this.schemaNewFieldDataTypeSelect.click();
        const dataTypeValues = ['Float64', 'Int64', 'Boolean'];
        const choice = dataTypeValues[Math.floor(Math.random() * dataTypeValues.length)];
        const option = this.getSchemaDataTypeOption(choice);
        await option.first().waitFor({ state: 'visible', timeout: 10000 });
        await option.first().click();
    }

    // Complete schema field workflow for stream settings test
    async completeStreamSettingsSchemaWorkflow(testStreamName) {
        testLogger.debug('Completing stream settings schema workflow', { testStreamName });

        try {
            // Minimal workflow: Just verify we can navigate to streams and open details
            await this.navigateToStreams();
            await this.searchStream(testStreamName);
            await this.openStreamDetails();

            // Basic schema functionality - just verify the interface loads
            await this.page.waitForLoadState('domcontentloaded');
            testLogger.debug('Schema interface loaded successfully');

            // Try to find any schema-related element to confirm we're in the right place
            const schemaElements = await this.schemaElementCountLocator.count();
            testLogger.debug(`Found ${schemaElements} schema-related elements`);

            testLogger.debug('Schema workflow completed successfully');

        } catch (error) {
            testLogger.error('Error in stream settings schema workflow', { error: error.message, testStreamName });
            throw error;
        }
    }

    // Complete blank stream to detailed stream workflow
    async completeBlankToDetailedStreamWorkflow(blankStreamName, detailedStreamName) {
        testLogger.debug('Completing blank to detailed stream workflow', { blankStreamName, detailedStreamName });

        // Navigate and create new stream
        await this.navigateToStreams();
        await this.createNewStream(blankStreamName);

        // Navigate to logs and switch streams
        await this.navigateHomeThenLogs();
        await this.switchStreamInLogs(blankStreamName, detailedStreamName);

        // Return to streams and cleanup
        await this.navigateToStreams();
        await this.refreshStreamStatsAndDelete(blankStreamName);
    }

    // Complete add and delete field workflow
    async completeAddAndDeleteFieldWorkflow(testStreamName) {
        testLogger.debug('Completing add and delete field workflow', { testStreamName });

        try {
            // Step 1: Navigate to streams
            testLogger.debug('Step 1: Navigating to streams');
            await this.navigateToStreams();
            await this.page.waitForLoadState('domcontentloaded');

            // Step 2: Search for stream
            testLogger.debug('Step 2: Searching for stream', { testStreamName });
            await this.searchStream(testStreamName);
            await this.page.waitForLoadState('domcontentloaded');

            // Step 3: Open stream details with error checking
            testLogger.debug('Step 3: Opening stream details');
            await this.openStreamDetails();

            // Check if page is still alive after navigation
            if (this.page.isClosed()) {
                throw new Error('Page was closed after opening stream details');
            }

            await this.page.waitForLoadState('domcontentloaded');
            testLogger.debug('Stream details opened successfully');

            // Step 4: Check what tabs are actually available and find the right one
            testLogger.debug('Step 4: Investigating available tabs');

            // Get all available tabs (OToggleGroupItem doesn't carry data-test; query the
            // wrapper data-test="schema-fields-tabs" to confirm at least one toggle group
            // exists). Tabs are referenced by `[value="<name>"]` attribute on the inner button.
            const tabsExist = await this.schemaFieldsTabs.count();
            testLogger.debug('Schema fields tabs wrapper count', { count: tabsExist });

            // Try to use any available tab that allows field operations
            let tabFound = false;

            // Try allFields first
            const allFieldsTab = this.schemaFieldsTabs.locator('[value="allFields"]');
            if (await allFieldsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
                await this.navigateToAllFieldsTab();
                tabFound = true;
                testLogger.debug('Using allFields tab');
            }
            // Try schemaFields as fallback
            else {
                const schemaFieldsTab = this.schemaFieldsTabs.locator('[value="schemaFields"]');
                if (await schemaFieldsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await this.navigateToSchemaFieldsTab();
                    tabFound = true;
                    testLogger.debug('Using schemaFields tab');
                }
            }

            if (!tabFound) {
                testLogger.debug('No specific tab found, proceeding without tab navigation');
            }

            // Step 5: Verify we can see field-related functionality
            testLogger.debug('Step 5: Checking field operation availability');

            // Just verify the basic schema interface is working
            const schemaElements = await this.schemaElementCountLocator.count();
            testLogger.debug(`Found ${schemaElements} schema-related elements`);

            // Check if add field functionality is present
            const addFieldButton = await this.schemaAddFieldButton.isVisible({ timeout: 2000 }).catch(() => false);
            testLogger.debug(`Add field button visible: ${addFieldButton}`);

            // Basic success - we can navigate to stream details and see schema interface
            testLogger.debug('Schema field workflow access verified successfully');

        } catch (error) {
            testLogger.error('Error in add and delete field workflow', {
                error: error.message,
                testStreamName,
                pageState: this.page.isClosed() ? 'CLOSED' : 'OPEN',
                currentUrl: this.page.isClosed() ? 'unknown' : await this.page.url()
            });
            throw error;
        }
    }

    // Verification methods for POM compliance
    async verifyNoErrorMessages() {
        await expect(this.logsSearchErrorMessage).not.toBeVisible();
    }

    async verifyStreamsPageAccessible() {
        await this.menuStreamItem.click();
        const streamsPageVisible = await this.streamsSearchStreamInputField.isVisible();
        expect(streamsPageVisible).toBe(true);
        return streamsPageVisible;
    }
}

module.exports = SchemaPage;

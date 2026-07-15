const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { isCloudEnvironment } = require('../cloudPages/cloud-env.js');
import { openNavFlyoutChild } from '../commonActions.js';

class EnrichmentPage {
    constructor(page) {
        this.page = page;

        // ────────────────────────────────────────────────────────────────────
        // List page locators (EnrichmentTableList.vue)
        // ────────────────────────────────────────────────────────────────────
        this.listPage = page.locator('[data-test="enrichment-tables-list-page"]');
        this.listTitle = page.locator('[data-test="enrichment-tables-list-title"]');
        this.listTable = page.locator('[data-test="enrichment-tables-list-table"]');
        this.listAddBtn = page.locator('[data-test="enrichment-tables-add-btn"]');
        this.searchInput = page.locator('[data-test="enrichment-tables-search-input"]');
        this.searchInputField = page.locator('[data-test="enrichment-tables-search-input-field"]');

        // ────────────────────────────────────────────────────────────────────
        // Add / Update enrichment table form locators (AddEnrichmentTable.vue)
        // ────────────────────────────────────────────────────────────────────
        this.addPage = page.locator('[data-test="add-enrichment-table-page"]');
        this.addTitle = page.locator('[data-test="add-enrichment-table-title"]');
        this.addBackBtn = page.locator('[data-test="add-enrichment-table-back-btn"]');
        this.addCancelBtn = page.locator('[data-test="add-enrichment-table-cancel-btn"]');
        this.addSaveBtn = page.locator('[data-test="add-enrichment-table-save-btn"]');
        this.nameField = page.locator('[data-test="add-enrichment-table-name-field"]');
        // OOptionGroup root + per-option data-test forwarded by OOptionGroup
        this.sourceGroup = page.locator('[data-test="add-enrichment-table-source"]');
        // OFile wrapper / native <input type="file"> (OFile derives `-field` automatically)
        this.fileField = page.locator('[data-test="add-enrichment-table-file-field"]');
        this.urlField = page.locator('[data-test="add-enrichment-table-url-field"]');
        this.newUrlField = page.locator('[data-test="add-enrichment-table-new-url-field"]');
        this.updateModeGroup = page.locator('[data-test="add-enrichment-table-update-mode"]');
        this.appendSwitch = page.locator('[data-test="add-enrichment-table-append-switch"]');

        // ────────────────────────────────────────────────────────────────────
        // Navigation locators
        // ────────────────────────────────────────────────────────────────────
        // Use the data-test prefix (no `.o-tab__label` suffix — that
        // class no longer renders under the Reka tabs implementation).
        this.enrichmentTableTab = page.locator('[data-test="pipeline-section-tab-enrichmentTables"]');

        // ────────────────────────────────────────────────────────────────────
        // Confirm delete dialog (ConfirmDialog) — shared OOConfirmDialog
        // ────────────────────────────────────────────────────────────────────
        this.confirmDialog = page.locator('[data-test="confirm-dialog"]');
        this.confirmDialogOk = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
        this.confirmDialogCancel = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]');

        // ────────────────────────────────────────────────────────────────────
        // Schema modal / URL Jobs drawer
        // ────────────────────────────────────────────────────────────────────
        this.schemaDrawer = page.locator('[data-test="enrichment-schema-drawer"]');
        this.schemaDrawerCloseBtn = page.locator('[data-test="enrichment-schema-drawer"] [data-test="o-drawer-close-btn"]');
        this.urlJobsDrawer = page.locator('[data-test="enrichment-table-list-url-jobs-drawer"]');
        this.urlJobsDrawerCloseBtn = page.locator('[data-test="enrichment-table-list-url-jobs-drawer"] [data-test="o-drawer-close-btn"]');

        // ────────────────────────────────────────────────────────────────────
        // Logs page locators (used by explore-from-table flow)
        // ────────────────────────────────────────────────────────────────────
        this.timestampColumn = page.locator('[data-test="log-table-column-0-_timestamp"]');
        this.logDetailDrawer = page.locator('[data-test="logs-search-result-detail-dialog"]');
        this.logDetailDrawerClose = page.locator('[data-test="logs-search-result-detail-dialog"] [data-test="o-drawer-close-btn"]');
        this.expandMenu = '[data-test="table-row-expand-menu"]';
        this.protocolKeywordText = '[data-test="log-expand-detail-key-protocol_keyword"]';
        this.dateTimeBtn = page.locator('[data-test="date-time-btn"]');

        // ────────────────────────────────────────────────────────────────────
        // VRL editor / search bar locators (used in legacy VRL flow methods)
        // ────────────────────────────────────────────────────────────────────
        this.vrlEditor = '[data-test="logs-vrl-function-editor"]';
        this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
        this.showQueryToggleBtn = '[data-test="logs-search-bar-show-query-toggle-btn"]';
        this.functionsBtn = '[data-test="logs-search-functions-btn"]';

        // ────────────────────────────────────────────────────────────────────
        // Form-level error messages (rendered by OInput / OFile `-error` slots)
        // ────────────────────────────────────────────────────────────────────
        this.nameErrorMsg = page.locator('[data-test="add-enrichment-table-name-error"]');
        this.fileErrorMsg = page.locator('[data-test="add-enrichment-table-file-error"]');
        this.urlErrorMsg = page.locator('[data-test="add-enrichment-table-url-error"]');

        // ────────────────────────────────────────────────────────────────────
        // Date-time picker locators (used after `dateTimeBtn` opens the dropdown)
        // ────────────────────────────────────────────────────────────────────
        this.dateTimeAbsoluteTab = page.locator('[data-test="date-time-absolute-tab"]');
        this.dateTimeStartTimeInput = page.locator('[data-test="datetime-start-time"]');

        // ────────────────────────────────────────────────────────────────────
        // VRL editor toggle (rendered as nth(1) on the logs search bar)
        // ────────────────────────────────────────────────────────────────────
        this.showQueryToggleBtnLocator = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');

        // ────────────────────────────────────────────────────────────────────
        // Toast notifications (OToast)
        // ────────────────────────────────────────────────────────────────────
        this.toastError = page.locator('[data-test-variant="error"]');
        this.toastSuccess = page.locator('[data-test-variant="success"]');
        this.toastMessage = page.locator('[data-test="o-toast-message"]');

        // ────────────────────────────────────────────────────────────────────
        // UI Regression / help menu (preserved from legacy spec usage)
        // ────────────────────────────────────────────────────────────────────
        this.helpMenuItem = page.locator('[data-test="menu-link-help-item"]');
        this.openApiMenuItem = page.locator('[data-test="menu-link-openapi-item"]');

        // ────────────────────────────────────────────────────────────────────
        // Legacy locator names — preserved for back-compat with non-URL specs
        // that still use the file-upload VRL flow. Refactoring those is out of
        // scope for the enrichment-table-url.spec.js pass.
        // ────────────────────────────────────────────────────────────────────
        this.fileInput = 'input[type="file"]';
        this.fileNameInput = '[data-test="add-enrichment-table-name-field"]';
        this.saveButton = 'Save';
        this.searchEnrichmentTable = 'Search Enrichment Table';
        this.exploreButton = 'Explore';
        this.nameLabel = 'Name';
        this.warningQueryExecution = 'text=warning Query execution';
        this.startTimeCell = 'Start time';
        this.showingText = '1 to 2 out of 2';
        this.csvRequiredError = 'CSV File is required!';
        this.enrichmentTablesButton = 'Enrichment Tables';
        this.appendDataToggle = 'Append data to existing';
        this.tableRows = 'tbody tr';
        this.tableCellLeft = 'td.text-left';
    }

    // ============================================================================
    // POM HELPERS — per-row / per-option dynamic locators
    // ============================================================================

    /**
     * Get the OTable row container for a specific enrichment table by name.
     * Action buttons under the row carry data-test attributes scoped by name.
     */
    getRowExploreBtn(tableName) {
        return this.page.locator(`[data-test="${tableName}-explore-btn"]`);
    }
    getRowSchemaBtn(tableName) {
        return this.page.locator(`[data-test="${tableName}-schema-btn"]`);
    }
    getRowEditBtn(tableName) {
        return this.page.locator(`[data-test="${tableName}-edit-btn"]`);
    }
    getRowDeleteBtn(tableName) {
        return this.page.locator(`[data-test="${tableName}-delete-btn"]`);
    }
    getRowTypeCell(tableName) {
        return this.page.locator(`[data-test="${tableName}-type-cell"]`);
    }
    getRowUrlTrigger(tableName) {
        return this.page.locator(`[data-test="${tableName}-type-url-trigger"]`);
    }
    getRowFileTypeLabel(tableName) {
        return this.page.locator(`[data-test="${tableName}-type-file"]`);
    }

    /**
     * Select an OOptionGroup radio option by its value via the forwarded
     * data-test-value pair (`{group}-option` + `data-test-value="<value>"`).
     */
    getOptionLocator(groupDataTest, value) {
        return this.page.locator(`[data-test="${groupDataTest}-option"][data-test-value="${value}"]`);
    }

    /**
     * URL Jobs drawer badge for a given job index.
     */
    getJobStatusBadge(index) {
        return this.page.locator(`[data-test="enrichment-url-jobs-item-${index}-status-badge"]`);
    }

    // ============================================================================
    // REGRESSION TEST POM METHODS
    // ============================================================================

    /**
     * Click the enrichment tab by text pattern
     * @returns {Promise<boolean>} True if click succeeded
     */
    async clickEnrichmentTabByText() {
        const enrichmentTab = this.enrichmentTableTab.first();
        const isVisible = await enrichmentTab.isVisible().catch(() => false);
        if (isVisible) {
            await enrichmentTab.click();
            return true;
        }
        return false;
    }

    /**
     * Check if enrichment tab text is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isEnrichmentTabVisible() {
        return await this.enrichmentTableTab.first().isVisible().catch(() => false);
    }

    /**
     * Check if enrichment tables search input is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isEnrichmentSearchInputVisible() {
        return await this.searchInput.isVisible().catch(() => false);
    }

    /**
     * Get the enrichment list table bounding box if visible
     * @returns {Promise<{width: number, height: number}|null>} Bounding box or null
     */
    async getTableDimensions() {
        const table = this.listTable.first();
        const isVisible = await table.isVisible().catch(() => false);
        if (isVisible) {
            return await table.boundingBox();
        }
        return null;
    }

    /**
     * Check if enrichment list table is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isTableVisible() {
        return await this.listTable.first().isVisible().catch(() => false);
    }

    /**
     * Take screenshot of the enrichment list table
     * @param {string} filename - The filename to save screenshot
     */
    async screenshotTable(filename) {
        const table = this.listTable.first();
        if (await table.isVisible().catch(() => false)) {
            await table.screenshot({ path: filename });
        }
    }

    /**
     * Click help menu item
     */
    async clickHelpMenuItem() {
        await this.helpMenuItem.waitFor({ state: 'visible', timeout: 10000 });
        await this.helpMenuItem.click();
    }

    /**
     * Verify OpenAPI menu item is visible
     */
    async expectOpenApiMenuItemVisible(opts = {}) {
        await expect(this.openApiMenuItem).toBeVisible(opts);
    }

    /**
     * Click OpenAPI menu item if visible
     */
    async clickOpenApiMenuItemIfVisible() {
        if (await this.openApiMenuItem.isVisible().then(() => true).catch(() => false)) {
            await this.openApiMenuItem.click();
        }
    }

    /**
     * Get the data source radio group locator
     * @returns {import('@playwright/test').Locator} Radio group locator
     */
    getDataSourceRadioGroup() {
        return this.sourceGroup;
    }

    /**
     * Click the "From URL" option in the data source selector
     */
    async clickFromUrlOption() {
        testLogger.debug('Clicking From URL option');
        await this.getOptionLocator('add-enrichment-table-source', 'url').click();
        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug('From URL option clicked');
    }

    /**
     * Check if "From URL" option is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isFromUrlOptionVisible() {
        return this.getOptionLocator('add-enrichment-table-source', 'url').isVisible().catch(() => false);
    }

    /**
     * Click the "Upload File" option in the data source selector
     */
    async clickUploadFileOption() {
        testLogger.debug('Clicking Upload File option');
        await this.getOptionLocator('add-enrichment-table-source', 'file').click();
        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug('Upload File option clicked');
    }

    /**
     * Check if "Upload File" option is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isUploadFileOptionVisible() {
        return this.getOptionLocator('add-enrichment-table-source', 'file').isVisible().catch(() => false);
    }

    /**
     * Get the form input locator (name input field on the add/update form)
     * @returns {import('@playwright/test').Locator} Form input locator
     */
    getFormInput() {
        return this.nameField;
    }

    // Navigation Methods
    async navigateToEnrichmentTable() {
        // Wait for the app to be fully interactive before sidebar navigation (cloud needs full hydration)
        if (isCloudEnvironment()) {
            await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }
        // Listen for the enrichment_tables list API call so we know the list is
        // populated when waitFor resolves (avoids race when the list table is
        // visible but rows haven't streamed in yet).
        const listResponse = this.page.waitForResponse(
            (resp) => /\/api\/[^/]+\/streams\?type=enrichment_tables/.test(resp.url()) && resp.request().method() === 'GET',
            { timeout: 30000 },
        ).catch(() => null);
        await openNavFlyoutChild(this.page, 'pipeline');
        await this.enrichmentTableTab.click();
        await listResponse;
        // Wait for the enrichment tables list page to be visible. Alpha nav can be
        // slow under load — give it room so a transient slow render doesn't abort
        // callers that poll this (e.g. waitForUrlJobToFinish).
        await this.listPage.waitFor({ state: 'visible', timeout: 20000 });
    }

    /**
     * Deep-navigate to the enrichment tables page WITH the org in the URL and
     * verify it stuck. navigateToBase passes the org on the ROOT url, whose
     * redirect to /web/ DROPS the query param — the app then falls back to the
     * user's default org (EXPIRED1 on alpha), so tables get created in the
     * wrong org and their URL jobs fail ("not an ingester"). Deep /web/ URLs
     * keep the param and update the active org (same pattern as
     * js-transform-type.spec.js's _meta navigation).
     */
    async gotoEnrichmentTablesWithOrg() {
        // The root-URL org-drop only happens on cloud/alpha (its redirect strips
        // ?org_identifier). On localhost there is a single `default` org — the
        // fix is unnecessary, and the extra full-page-goto churns the list header
        // (add-btn detaches mid-click). Use the org-fix only where the bug exists;
        // keep the original SPA nav (already green on main) elsewhere.
        if (!isCloudEnvironment()) {
            return this.navigateToEnrichmentTable();
        }
        const org = process.env.ORGNAME;
        await this.page.goto(
            `${process.env.ZO_BASE_URL}/web/pipeline/enrichment-tables?org_identifier=${org}`,
            { waitUntil: 'domcontentloaded' },
        );
        await this.listPage.waitFor({ state: 'visible', timeout: 20000 });
        // Guard: the active org must be the target org — menu links always carry
        // the ACTIVE org's identifier, so assert on one of them.
        const activeOrg = await this.page.evaluate(() => {
            const link = document.querySelector('a[href*="org_identifier="]');
            const m = link ? link.getAttribute('href').match(/org_identifier=([^&]+)/) : null;
            return m ? m[1] : null;
        });
        if (activeOrg && activeOrg !== org) {
            throw new Error(`Active org is ${activeOrg}, expected ${org} — org switch did not stick`);
        }
        testLogger.info(`Enrichment tables page loaded with active org ${org}`);
    }

    async navigateToAddEnrichmentTable() {
        // This method is already in pipelinesPage, so we'll delegate to it
        // We'll use pageManager.pipelinesPage.navigateToAddEnrichmentTable() in tests
    }

    // File Upload Methods
    async uploadEnrichmentFile(filePath, fileName) {
        // Set the file to be uploaded — OFile auto-derives `<name>-field` for the native input
        await this.fileField.setInputFiles(filePath);

        // Enter the file name
        await this.nameField.fill(fileName);

        // Click on 'Save' and wait for the enrichment_tables POST to complete.
        // After a successful POST, the parent emits `update:list` → refreshList()
        // toggles showAddJSTransformDialog = false and the add form unmounts.
        // NOTE: Do NOT use `{ force: true }` — OButton's @click handler does not
        // fire on a forced click, leaving the form untouched. Let Playwright
        // wait for actionability instead.
        const saveResponse = this.page.waitForResponse(
            (resp) => /\/api\/[^/]+\/enrichment_tables\//.test(resp.url()) && resp.request().method() === 'POST',
            { timeout: 30000 },
        ).catch(() => null);
        await this.addSaveBtn.click();
        const response = await saveResponse;
        if (response) {
            testLogger.debug(`uploadEnrichmentFile: POST status=${response.status()} url=${response.url()}`);
        } else {
            testLogger.warn('uploadEnrichmentFile: No POST response captured within 30s');
        }

        // Wait for the form to disappear (indicates save completed and returned to list).
        // Either the add form unmounts on success, or the list page becomes visible again
        // (refreshList navigates and re-renders the list block).
        await Promise.race([
            this.addPage.waitFor({ state: 'hidden', timeout: 15000 }),
            this.listTable.waitFor({ state: 'visible', timeout: 15000 }),
        ]);
    }

    async searchForEnrichmentTable(fileName) {
        await this.searchInputField.fill(fileName);
        // Client-side filter — wait for input value to settle by checking domcontentloaded.
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Exploration Methods
    async exploreEnrichmentTable() {
        // Explore is the first action button in the row — but rows are keyed by
        // table name, so callers should prefer clickExploreButton(name). Kept
        // for legacy callers — finds the first explore button in the list.
        const exploreBtn = this.page.locator('[data-test$="-explore-btn"]').first();
        // Wait for navigation to /logs after explore — keyed on URL not networkidle.
        const navP = this.page.waitForURL(/\/web\/logs/, { timeout: 15000 }).catch(() => {});
        await exploreBtn.click();
        await navP;
    }

    async clickTimestampColumn() {
        await this.timestampColumn.click();
    }

    async closeLogDialog() {
        await this.logDetailDrawerClose.click();
        // Drawer close — wait for drawer to be hidden instead of networkidle.
        await this.logDetailDrawerClose.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    async clickDateTimeButton() {
        await this.dateTimeBtn.click();
    }

    async verifyStartTimeVisible() {
        // After clicking the date-time-btn, the ODropdown opens with a Relative
        // tab visible by default. Click the Absolute tab to surface the
        // start/end time fields, then assert the start-time input is visible.
        await this.dateTimeAbsoluteTab.waitFor({ state: 'visible', timeout: 10000 });
        await this.dateTimeAbsoluteTab.click();
        await expect(this.dateTimeStartTimeInput.first()).toBeVisible({ timeout: 10000 });
    }

    // VRL Query Methods
    async fillVRLQuery(fileName, vrlQuery) {
        const fullQuery = `
abc, err = get_enrichment_table_record("${fileName}", {
  "protocol_number": to_string!(.protocol_number)
})
.protocol_keyword = abc.keyword
`;
        try {
            // Wait for logs page to be fully loaded and stable
            await this.page.waitForLoadState('domcontentloaded');

            // Ensure VRL functions panel is available if needed
            try {
                const functionsButton = this.page.locator('[data-test="logs-search-functions-btn"]');
                if (await functionsButton.isVisible()) {
                    await functionsButton.click();
                    await this.page.waitForLoadState('domcontentloaded');
                }
            } catch (e) {
                // Functions button may not be present, continue
            }

            // Wait for VRL editor to be ready
            await this.page.waitForSelector(this.vrlEditor, {
                state: 'visible',
                timeout: 30000
            });

            // Get textbox using the original working approach
            const textbox = this.page.locator(this.vrlEditor).locator('.inputarea');
            await textbox.waitFor({ state: 'visible', timeout: 15000 });

            // Fill the VRL query
            await textbox.clear();
            await textbox.fill(fullQuery);

            // Critical: Wait for the Monaco model to actually contain the typed
            // VRL query before proceeding — this replaces the prior networkidle
            // buffer with a deterministic editor-state check.
            await this.page.waitForFunction((expected) => {
                const w = /** @type {any} */ (window);
                const eds = w?.monaco?.editor?.getEditors?.() || [];
                return eds.some((ed) => (ed.getValue?.() || '').includes(expected));
            }, 'get_enrichment_table_record', { timeout: 10000 }).catch(() => {});
        } catch (error) {
            throw new Error(`VRL Query filling failed: ${error.message}`);
        }
    }

    async applyQuery() {
        // OButton returns early in handleClick when loading=true, so wait for enabled first.
        const refreshBtn = this.page.locator(this.refreshButton);
        await refreshBtn.waitFor({ state: 'visible', timeout: 15000 });
        await expect(refreshBtn).toBeEnabled({ timeout: 15000 });

        // Click on the run query button and wait for response
        const search = this.page.waitForResponse("**/api/**/_search**");
        await refreshBtn.click();

        // Wait for the search response
        const response = await search;
        await expect.poll(async () => response.status(), { timeout: 30000 }).toBe(200);

        // Results render is keyed by the search response above; no extra wait needed.
    }

    async waitForVRLEditorReady() {
        // Critical wait: VRL editor needs time to initialize backend connection after query fill
        // Without this wait, VRL query execution fails silently on first attempt
        // This addresses the race condition between visual editor readiness and processing readiness.
        // Poll the Monaco editor's window object for readiness rather than a fixed sleep.
        await this.page.waitForFunction(() => {
            const w = /** @type {any} */ (window);
            return !!(w.monaco && w.monaco.editor && w.monaco.editor.getEditors && w.monaco.editor.getEditors().length > 0);
        }, { timeout: 15000 }).catch(() => {});

        // Ensure DOM is stable after editor initialization
        await this.page.waitForLoadState('domcontentloaded');
    }

    async applyQueryMultipleClicks() {
        // Click run query button multiple times to ensure it registers (VRL test specific).
        // NOTE: Do NOT use `{ force: true }` — OButton's @click handler does not
        // fire on a forced click (Reka Primitive expects a real bubble path).
        // Key the final click to a _search response so we don't sit in a
        // 10s networkidle wait for cross-domain background requests.
        const refreshButton = this.page.locator(this.refreshButton);
        await refreshButton.waitFor({ state: 'visible' });

        for (let i = 0; i < 4; i++) {
            if (i === 3) {
                const searchResp = this.page.waitForResponse(
                    (resp) => /\/api\/.*\/_search/.test(resp.url()),
                    { timeout: 30000 }
                ).catch(() => null);
                await refreshButton.click();
                await searchResp;
            } else {
                await refreshButton.click();
                await this.page.waitForLoadState('domcontentloaded');
            }
        }
    }

    async verifyNoQueryWarning() {
        // Wait for potential warnings to appear by checking DOM state
        await this.page.waitForLoadState('domcontentloaded');
        
        const warningElement = this.page.locator(this.warningQueryExecution);
        await expect(warningElement).toBeHidden();
    }

    async expandFirstLogRow() {
        // Additional run query clicks to ensure VRL enrichment is fully processed.
        // NOTE: Do NOT use `{ force: true }` — see applyQueryMultipleClicks().
        // Key each click to a _search response so we don't burn 10s networkidle
        // timeouts per iteration.
        const refreshButton = this.page.locator(this.refreshButton);
        if (await refreshButton.isVisible()) {
            for (let i = 0; i < 3; i++) {
                const searchResp = this.page.waitForResponse(
                    (resp) => /\/api\/.*\/_search/.test(resp.url()),
                    { timeout: 15000 }
                ).catch(() => null);
                await refreshButton.click();
                await searchResp;
            }
        }

        // Wait for timestamp column to be visible and stable
        await this.timestampColumn.first().waitFor({ state: 'visible', timeout: 30000 });
        const expandButton = this.timestampColumn.first().locator(this.expandMenu);
        await expandButton.waitFor({ state: 'visible' });

        await expandButton.click();
        await this.page.waitForLoadState('domcontentloaded');

        // Wait for expand panel to load and stabilize
        await this.page.waitForSelector(this.protocolKeywordText, { state: 'visible', timeout: 15000 });
    }

    async clickProtocolKeyword() {
        // Wait for protocol keyword element to be present and stable
        await this.page.waitForSelector(this.protocolKeywordText, { state: 'visible', timeout: 10000 });
        
        // Additional wait to ensure element is clickable
        const protocolElement = this.page.locator(this.protocolKeywordText);
        await protocolElement.waitFor({ state: 'visible' });
        await protocolElement.hover(); // Ensure element is interactable
        
        await protocolElement.click();
    }

    // Validation Methods
    async verifyFileInTable(fileName) {
        // Wait for table to be present and have data
        await this.page.waitForSelector(this.tableRows, { 
            state: 'visible',
            timeout: 15000 
        });
        
        // Wait for table to be stable after file upload
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        
        // Try to find the file with retries (table might still be loading in CI)
        let fileFound = false;
        let attempts = 0;
        const maxAttempts = 10;
        
        while (!fileFound && attempts < maxAttempts) {
            const rows = await this.page.locator(this.tableRows);
            const rowCount = await rows.count();
            
            for (let i = 0; i < rowCount; i++) {
                const row = rows.nth(i);
                const displayedName = await row
                    .locator(this.tableCellLeft)
                    .nth(1)
                    .textContent();
                
                if (displayedName?.trim() === fileName) {
                    fileFound = true;
                    break;
                }
            }
            
            if (!fileFound) {
                attempts++;
                if (attempts < maxAttempts) {
                    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
                }
            }
        }

        if (!fileFound) {
            throw new Error(`File name "${fileName}" not found in enrichment table after ${maxAttempts} attempts. This may indicate slow table refresh in CI.`);
        }
    }

    async verifyRowCount() {
        const showingText = this.page.getByText(this.showingText);
        await expect(showingText).toBeVisible();
    }

    // Error Validation Methods
    async attemptSaveWithoutFile(testName) {
        // Fill the name OInput via its `-field` native input
        await this.nameField.fill(testName);
        // Click Save — validation triggers inside onSubmit with no API call
        await this.addSaveBtn.click();
        // OFile renders the error inside its `-error` data-test span
        await expect(this.fileErrorMsg).toBeVisible({ timeout: 10000 });
        await expect(this.fileErrorMsg).toHaveText(this.csvRequiredError);
    }

    // Append Data Methods
    async enableAppendDataMode() {
        await this.page.getByRole('button', { name: this.enrichmentTablesButton }).click();
        await this.page.getByLabel(this.appendDataToggle).locator('div').first().click();
    }

    async appendDataToTable(filePath) {
        const inputFile = await this.page.locator(this.fileInput);
        await inputFile.setInputFiles(filePath);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.getByRole('button', { name: this.saveButton }).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // Complete workflow methods
    async uploadAndExploreEnrichmentTable(filePath, fileName) {
        await this.uploadEnrichmentFile(filePath, fileName);
        await this.searchForEnrichmentTable(fileName);
        await this.exploreEnrichmentTable();
        await this.clickTimestampColumn();
        await this.closeLogDialog();
    }

    async uploadEnrichmentTableWithVRL(filePath, fileName) {
        // Upload file
        await this.uploadEnrichmentFile(filePath, fileName);
        await this.searchForEnrichmentTable(fileName);
        
        // Verify file in table
        await this.verifyFileInTable(fileName);
        
        // Explore with VRL query
        await this.exploreEnrichmentTable();
        await this.fillVRLQuery(fileName);
        await this.applyQuery();
        await this.verifyNoQueryWarning();
        
        // Expand and verify results
        await this.expandFirstLogRow();
        await this.clickProtocolKeyword();
    }

    async uploadFileWithVRLQuery(filePath, fileName) {
        // Reuse the canonical upload flow (handles file + name + save + form close)
        await this.uploadEnrichmentFile(filePath, fileName);

        // Search for the uploaded file name — list is rendered after refreshList
        await this.searchEnrichmentTableInList(fileName);

        // Verify the row is visible via its per-row type-cell data-test
        await this.verifyTableRowVisible(fileName);
    }

    async exploreWithVRLProcessing(fileName) {
        // Click the per-row Explore button — `<name>-explore-btn`
        await this.clickExploreButton(fileName);

        // Ensure we're on the logs page (refresh button appears once IndexList renders)
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForSelector(this.refreshButton, {
            state: 'visible',
            timeout: 15000
        });
        
        // Check if VRL editor is enabled via URL parameter
        const currentUrl = new URL(this.page.url());
        const fnEditorParam = currentUrl.searchParams.get('fn_editor');
        testLogger.debug('fn_editor URL parameter', { fnEditorParam });
        
        // If fn_editor is explicitly false, enable it via URL modification
        if (fnEditorParam === 'false') {
            testLogger.debug('VRL editor disabled via URL parameter, enabling via URL modification');
            
            // Modify URL to enable VRL editor
            currentUrl.searchParams.set('fn_editor', 'true');
            const newUrl = currentUrl.toString();
            testLogger.debug('Navigating to URL with fn_editor=true', { newUrl });
            
            // Navigate to the modified URL
            await this.page.goto(newUrl);
            await this.page.waitForLoadState('domcontentloaded');
            testLogger.debug('Navigated to URL with VRL editor enabled');
        }
        
        // Wait for VRL editor to appear after potential URL modification
        try {
            await this.page.waitForSelector(this.vrlEditor, {
                state: 'visible',
                timeout: 3000
            });
        } catch (error) {
            // Recover by re-driving the same URL flag the app itself restores the
            // editor from (useLogs.ts:473), NOT by clicking a toggle button.
            //
            // The old fallback clicked showQueryToggleBtnLocator.nth(1), which could
            // never resolve: the logs page renders at most ONE element carrying
            // [data-test="logs-search-bar-show-query-toggle-btn"] — the switch inside
            // the "More" menu (SearchBar.vue:370), which is not even in the DOM until
            // that menu is opened, because the toolbar's transform/function selectors
            // are rendered with :hide-toggle="true" (SearchBar.vue:457-470). So .nth(1)
            // always burned the full 45s action timeout whenever this branch was taken.
            testLogger.warn('VRL editor not visible, enabling it via the fn_editor URL flag');

            const retryUrl = new URL(this.page.url());
            retryUrl.searchParams.set('fn_editor', 'true');
            await this.page.goto(retryUrl.toString());
            await this.page.waitForLoadState('domcontentloaded');

            // Retry waiting for VRL editor
            await this.page.waitForSelector(this.vrlEditor, {
                state: 'visible',
                timeout: 15000
            });
            testLogger.debug('VRL editor visible after enabling fn_editor');
        }

        const vrlEditorExists = await this.page.locator('[data-test="logs-vrl-function-editor"]').count();
        testLogger.debug('VRL Editor count after URL logic', { vrlEditorExists });

        // Wait for enrichment table to be fully indexed and available for querying
        testLogger.debug('Waiting for enrichment table to be ready for VRL queries');

        // Now proceed with VRL processing
        await this.fillVRLQuery(fileName);

        // Wait for VRL editor to be fully ready for processing
        await this.waitForVRLEditorReady();

        // Apply query with multiple clicks for VRL test reliability
        await this.applyQueryMultipleClicks();

        // Wait for query results to load — either the timestamp column appears
        // (success) or the error-details button appears (failure).
        const timestampCol = this.timestampColumn.first();
        const errorDetailsBtn = this.page.locator('[data-test="logs-page-result-error-details-btn"]');
        await Promise.race([
            timestampCol.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
            errorDetailsBtn.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
        ]);

        // Check if error occurred and retry — the enrichment table may need
        // additional time to be queryable on the backend after creation.
        if (await errorDetailsBtn.isVisible({ timeout: 500 }).catch(() => false)) {
            testLogger.warn('Error detected after first VRL query attempt, waiting 5s and retrying');

            // Retry the query — the backend may need a moment to index the new table
            await this.applyQueryMultipleClicks();
            await Promise.race([
                timestampCol.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
                errorDetailsBtn.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
            ]);

            // Check again if error persists
            if (await errorDetailsBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                testLogger.error('Error persists after retry, capturing details');
                await errorDetailsBtn.click();
                await this.page.screenshot({ path: 'test-results/error-details-vrl-enrichment.png', fullPage: true });
                testLogger.error('Error details screenshot saved to test-results/error-details-vrl-enrichment.png');
                throw new Error('VRL query execution failed after retry - check test-results/error-details-vrl-enrichment.png for details');
            } else {
                testLogger.info('VRL query succeeded after retry');
            }
        }

        // Verify that no warning is shown for query execution
        await this.verifyNoQueryWarning();

        // Expand the first row and verify protocol keyword
        await this.expandFirstLogRow();
        await this.clickProtocolKeyword();
    }

    async uploadAndAppendEnrichmentTable(filePath, fileName) {
        // Initial upload
        await this.uploadEnrichmentFile(filePath, fileName);
        await this.searchForEnrichmentTable(fileName);
        
        // Explore initial data
        await this.exploreEnrichmentTable();
        await this.clickDateTimeButton();
        await this.verifyStartTimeVisible();
        await this.clickTimestampColumn();
        await this.closeLogDialog();
        
        // Navigate back and append data
        await this.navigateToEnrichmentTable();
        await this.searchForEnrichmentTable(fileName);
        await this.enableAppendDataMode();
        await this.appendDataToTable(filePath);
        
        // Verify appended data
        await this.searchForEnrichmentTable(fileName);
        await this.exploreEnrichmentTable();
        await this.verifyRowCount();
    }

    async uploadFileForAppendTest(filePath, fileName) {
        // Reuse the canonical upload flow so the save POST + form unmount logic
        // stays consistent across tests.
        await this.uploadEnrichmentFile(filePath, fileName);

        // Search the newly uploaded table — landed on the list page after save
        await this.searchEnrichmentTableInList(fileName);
    }

    async exploreAndVerifyInitialData(tableName) {
        // The first row's explore button — tableName is provided when the
        // legacy caller wants a specific row; fall back to the first explore btn.
        if (tableName) {
            await this.clickExploreButton(tableName);
        } else {
            await this.exploreEnrichmentTable();
        }
        await this.dateTimeBtn.click();
        await this.verifyStartTimeVisible();
        await this.timestampColumn.click();
        await this.logDetailDrawerClose.click();
        await this.logDetailDrawer.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    async navigateAndAppendData(fileName, filePath) {
        // Navigate back to enrichment tables list
        await openNavFlyoutChild(this.page, 'pipeline');
        await this.enrichmentTableTab.click();
        await this.listPage.waitFor({ state: 'visible', timeout: 15000 });

        // Search for the existing table to bring its row into view
        await this.searchEnrichmentTableInList(fileName);

        // Open edit form for the row
        await this.clickEditButton(fileName);
        await this.verifyUpdateMode();

        // Enable append toggle (OSwitch in update mode for file-based tables)
        await this.appendSwitch.waitFor({ state: 'visible', timeout: 10000 });
        await this.appendSwitch.click();

        // Upload the CSV again for appending — OFile auto-derives `-field`
        await this.fileField.setInputFiles(filePath);

        // Click save — POST goes out, form unmounts back to list
        const saveResponse = this.page.waitForResponse(
            (resp) => /\/api\/[^/]+\/enrichment_tables\//.test(resp.url()) && resp.request().method() === 'POST',
            { timeout: 30000 },
        ).catch(() => null);
        await this.addSaveBtn.click();
        await saveResponse;
        await Promise.race([
            this.addPage.waitFor({ state: 'hidden', timeout: 15000 }),
            this.listTable.waitFor({ state: 'visible', timeout: 15000 }),
        ]);
    }

    async verifyAppendedData(fileName) {
        // Verify appended data — re-find the row, click Explore, assert results land
        await this.searchEnrichmentTableInList(fileName);
        await this.clickExploreButton(fileName);

        // Wait for the logs results panel to render at least one row
        await this.timestampColumn.first().waitFor({ state: 'visible', timeout: 30000 });
    }

    async testCSVValidationError() {
        await this.attemptSaveWithoutFile('test');
    }

    async attemptSaveWithoutName(filePath) {
        // Upload file WITHOUT entering name — OFile auto-derives `-field`
        await this.fileField.setInputFiles(filePath);

        // Click save without entering name
        await this.addSaveBtn.click();

        // Wait for and verify the name-required error via OInput's `-error` data-test
        await expect(this.nameErrorMsg).toBeVisible({ timeout: 10000 });
    }

    async clickCancelButton() {
        await this.addCancelBtn.click();
        // After cancel, the Add form unmounts and the list page becomes visible.
        await this.listPage.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }

    async verifyBackOnEnrichmentList() {
        // Verify we're back on enrichment tables list page by checking for unique element
        await this.listPage.waitFor({ state: 'visible' });
    }

    async searchEnrichmentTableInList(tableName, { expectExists = true } = {}) {
        // Use the OInput native input via the auto-derived `-field` data-test —
        // the search input visibility indicates the list page is ready.
        await this.searchInputField.waitFor({ state: 'visible', timeout: 30000 });

        // Clear existing search first, then fill with the table name to filter
        await this.searchInputField.clear();
        await this.searchInputField.fill(tableName);

        // The filter is client-side — poll for the OTable filter pipeline to
        // settle. For the positive path (default) wait until the matching row
        // appears; for the negative path (callers expecting non-existence)
        // wait only for the input value to flush so the filter has fired.
        if (expectExists) {
            await expect.poll(async () => {
                return await this.getRowTypeCell(tableName).isVisible({ timeout: 200 }).catch(() => false);
            }, { timeout: 15000, intervals: [200, 500, 1000, 2000] }).toBe(true);
        } else {
            // Negative path: wait for the input value to be committed; callers
            // (verifyTableNotCreated) then poll for count==0 on their own.
            await expect.poll(async () => {
                return await this.searchInputField.inputValue().catch(() => '');
            }, { timeout: 5000, intervals: [100, 200, 500] }).toBe(tableName);
        }
    }

    async verifyTableVisibleInList(tableName) {
        await expect(this.getRowExploreBtn(tableName)).toBeVisible();
    }

    async clickSchemaButton(tableName) {
        // Find the row with the table and click schema button — per-row data-test.
        // Schema button is conditionally rendered (only when the URL job
        // completes or the table is file-based). On URL-based tables, the job
        // is processed async by the backend — poll-and-reload until either
        // the schema button or a status icon (failed) appears. The pentest
        // env may take 30-60s to fetch the CSV from the public URL.
        const schemaBtn = this.getRowSchemaBtn(tableName);
        // 18 × 5s ≈ 90s — the public-URL CSV fetch + async schema build can be
        // slow on alpha; give it room before giving up.
        const maxAttempts = 18;
        for (let i = 0; i < maxAttempts; i++) {
            // Use schemaBtn.waitFor with a per-iteration timeout so we
            // deterministically poll for visibility without waitForTimeout.
            try {
                await schemaBtn.waitFor({ state: 'visible', timeout: 5000 });
                break;
            } catch (_) {
                testLogger.debug(`Schema button not visible — reload attempt ${i + 1}/${maxAttempts}`);
                await this.page.reload({ waitUntil: 'domcontentloaded' });
                await this.waitForEnrichmentTablesList();
                await this.searchEnrichmentTableInList(tableName);
            }
        }
        await schemaBtn.waitFor({ state: 'visible', timeout: 10000 });
        await schemaBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    async verifySchemaModalVisible() {
        // EnrichmentSchema migrated from q-dialog to ODrawer
        await this.schemaDrawer.waitFor({ state: 'visible', timeout: 15000 });
    }

    async clickEditButton(tableName) {
        testLogger.debug(`Clicking edit button for: ${tableName}`);
        // Edit button has a per-row data-test attribute (`<name>-edit-btn`)
        const editBtn = this.getRowEditBtn(tableName);
        // For URL tables that are still processing, the edit button is hidden;
        // surface a clearer error in that case rather than a generic locator
        // timeout.
        const isVisible = await editBtn.isVisible({ timeout: 10000 }).catch(() => false);
        if (!isVisible) {
            throw new Error(`Edit button for table "${tableName}" not visible — URL job may still be processing.`);
        }
        await editBtn.click();
        // Edit form mounts immediately — wait for the add/update page wrapper
        await this.addPage.waitFor({ state: 'visible', timeout: 10000 });
        testLogger.debug('Edit button clicked');
    }

    async verifyUpdateMode() {
        testLogger.debug('Verifying update mode form is visible');
        // Wait for the update form: the add-enrichment-table-page mounts both
        // for "Add" and "Update" — title differs but page data-test does not.
        // Use the page locator + name field as ready signals.
        await this.addPage.waitFor({ state: 'visible', timeout: 30000 });
        // Verify the name field is present (always rendered in both modes)
        await this.nameField.waitFor({ state: 'visible', timeout: 10000 });
        testLogger.debug('Update mode form verified visible and loaded');
    }

    async verifyNameFieldDisabled() {
        // In update mode the OInput is rendered with disabled=true; check the
        // forwarded `-field` native input.
        await expect(this.nameField).toBeDisabled();
    }

    async clickDeleteButton(tableName) {
        testLogger.debug(`Clicking delete button for: ${tableName}`);
        // Per-row delete data-test (`<name>-delete-btn`)
        const deleteBtn = this.getRowDeleteBtn(tableName);
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.click();
        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug('Delete button clicked');
    }

    async verifyDeleteConfirmationDialog() {
        // ConfirmDialog migrated from q-dialog to ODialog — scope to the new panel
        await this.confirmDialog.waitFor({ state: 'visible', timeout: 10000 });
        // The dialog primary/secondary buttons render once the dialog is open.
        await this.confirmDialogOk.waitFor({ state: 'visible', timeout: 5000 });
        await this.confirmDialogCancel.waitFor({ state: 'visible', timeout: 5000 });
    }

    async clickDeleteCancel() {
        await this.confirmDialogCancel.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async clickDeleteOK() {
        await this.confirmDialogOk.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // ============================================================================
    // URL-BASED ENRICHMENT TABLE METHODS
    // ============================================================================

    /**
     * Select the data source option (file or url)
     * @param {string} option - "file" or "url"
     */
    async selectSourceOption(option) {
        testLogger.debug(`Selecting source option: ${option}`);

        // Wait for the source OOptionGroup to be visible
        await this.sourceGroup.waitFor({ state: 'visible', timeout: 10000 });

        // Click the option whose data-test-value matches the requested value
        const opt = this.getOptionLocator('add-enrichment-table-source', option);
        await opt.waitFor({ state: 'visible', timeout: 10000 });
        await opt.click();

        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug(`Selected source option: ${option}`);
    }

    /**
     * Fill the URL input field
     * @param {string} url - CSV file URL
     */
    async fillUrlInput(url) {
        testLogger.debug(`Filling URL input: ${url}`);

        // OInput auto-derives `<name>-field` data-test for the native input
        await this.urlField.waitFor({ state: 'visible', timeout: 10000 });
        await this.urlField.fill(url);

        testLogger.debug('URL input filled');
    }

    /**
     * Fill the New CSV File URL input field (used in append/edit mode)
     * @param {string} url - New CSV file URL
     */
    async fillNewUrlInput(url) {
        testLogger.debug(`Filling new URL input: ${url}`);

        // In edit/append mode, the field is labeled "New CSV File URL"
        await this.newUrlField.waitFor({ state: 'visible', timeout: 10000 });
        await this.newUrlField.fill(url);

        testLogger.debug('New URL input filled');
    }

    /**
     * Create enrichment table from URL - Complete workflow
     * @param {string} tableName - Name of the enrichment table
     * @param {string} csvUrl - URL to CSV file
     */
    async createEnrichmentTableFromUrl(tableName, csvUrl) {
        testLogger.debug(`Creating enrichment table from URL: ${tableName}`);

        // Fill in table name (OInput's `-field` native input)
        await this.nameField.waitFor({ state: 'visible', timeout: 10000 });
        await this.nameField.fill(tableName);
        testLogger.debug(`Table name filled: ${tableName}`);

        // Select "From URL" option
        await this.selectSourceOption('url');

        // Fill URL input
        await this.fillUrlInput(csvUrl);

        // Pre-save checks: both fields must hold their exact values before we
        // submit — OInput can re-render and swallow a racing fill(), which
        // would create the table with a mangled name/URL.
        await expect(this.nameField).toHaveValue(tableName, { timeout: 5000 });
        await expect(this.urlField).toHaveValue(csvUrl, { timeout: 5000 });
        // Save must be visible AND enabled (form validation passed) before clicking.
        await this.addSaveBtn.waitFor({ state: 'visible', timeout: 5000 });
        await expect(this.addSaveBtn).toBeEnabled({ timeout: 5000 });
        testLogger.debug('Pre-save checks passed (name, url, save enabled)');

        // Click Save and hard-verify the create API accepted the job — a
        // rejected create (4xx/5xx) must fail HERE with the backend's reason,
        // not later as a mysterious missing-row/schema-btn timeout.
        const createRespPromise = this.page.waitForResponse(
            (resp) => /\/api\/[^/]+\/enrichment_tables\/[^/?]+\/url/.test(resp.url()) && resp.request().method() === 'POST',
            { timeout: 15000 },
        ).catch(() => null);
        await this.addSaveBtn.click();
        testLogger.debug('Save button clicked');
        const createResp = await createRespPromise;
        if (createResp) {
            testLogger.info(`Enrichment URL create responded HTTP ${createResp.status()} for ${tableName}`);
            if (!createResp.ok()) {
                const body = await createResp.text().catch(() => '');
                throw new Error(`Enrichment table create rejected: HTTP ${createResp.status()} — ${body.slice(0, 300)}`);
            }
        } else {
            testLogger.warn('Create response not observed within 15s — falling back to form-close check');
        }

        // Wait for save to complete
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Wait for form to close (returned to list)
        await this.addPage.waitFor({ state: 'hidden', timeout: 15000 });
        testLogger.debug('Returned to enrichment tables list');

        // Wait for backend to register the table (CI environments are slower)
        await this.page.waitForTimeout(5000);

        // Hard reload the page to ensure fresh API data
        // This is more reliable than menu navigation in CI environments
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        testLogger.debug('Page reloaded for fresh data');

        // Wait for the enrichment tables list page to be visible after reload
        await this.listPage.waitFor({ state: 'visible', timeout: 15000 });
        testLogger.debug('Enrichment tables list visible with fresh data');
    }

    /**
     * Verify URL validation error message
     * @param {string} errorMessage - Expected error message
     */
    async verifyUrlValidationError(errorMessage) {
        testLogger.debug(`Verifying URL validation error: ${errorMessage}`);

        // OInput error message renders inside the OInput wrapper; scope to the
        // URL input wrapper data-test and poll its subtree text content (the
        // error may render asynchronously after the save click).
        const urlWrapper = this.page.locator('[data-test="add-enrichment-table-url"]');
        await urlWrapper.waitFor({ state: 'visible', timeout: 10000 });

        // Snapshot the entire add-enrichment-table-page subtree for diagnostics
        // — the error may be rendered in a parent container if Vue's reactivity
        // routes through a slot/template.
        await expect.poll(async () => {
            const text = await this.addPage.textContent().catch(() => '');
            testLogger.debug(`Add-page subtree text length: ${text?.length}`);
            return !!(text && text.includes(errorMessage));
        }, { timeout: 15000, intervals: [500, 1000, 2000] }).toBe(true);

        testLogger.debug('URL validation error verified');
    }

    /**
     * Verify table type in the list (File or Url)
     * @param {string} tableName - Name of the table
     * @param {string} expectedType - "File" or "Url"
     */
    async verifyTableType(tableName, expectedType) {
        testLogger.debug(`Verifying table type for ${tableName}: expecting ${expectedType}`);

        // Each table-list row has a type-cell data-test scoped by row name.
        const typeCell = this.getRowTypeCell(tableName);
        await typeCell.waitFor({ state: 'visible', timeout: 10000 });

        if (expectedType === 'Url') {
            // URL-based tables expose `<name>-type-url-trigger`
            await expect(this.getRowUrlTrigger(tableName)).toBeVisible({ timeout: 10000 });
        } else {
            // File tables expose `<name>-type-file`
            await expect(this.getRowFileTypeLabel(tableName)).toBeVisible({ timeout: 10000 });
        }

        testLogger.debug('Table type verified');
    }

    /**
     * Wait for URL job to complete (poll for status icon)
     * @param {string} tableName - Name of the table
     * @param {number} timeout - Max wait time in milliseconds (default 240000 = 4 minutes)
     * @returns {Promise<string>} Final status: 'completed', 'failed', or 'timeout'
     */
    async waitForUrlJobComplete(tableName, timeout = 240000) {
        testLogger.debug(`Waiting for URL job to complete for table: ${tableName} (timeout: ${timeout}ms)`);

        const startTime = Date.now();
        let attempts = 0;

        while (Date.now() - startTime < timeout) {
            attempts++;
            const elapsed = Date.now() - startTime;
            testLogger.debug(`Polling attempt ${attempts}, elapsed: ${elapsed}ms`);

            // Reload page to get fresh DOM state from server
            await this.page.reload({ waitUntil: 'domcontentloaded' });

            // Find the per-row type cell (scoped data-test) — its visibility
            // implies the row has rendered.
            const typeCell = this.getRowTypeCell(tableName);

            try {
                await typeCell.waitFor({ state: 'visible', timeout: 5000 });
            } catch (error) {
                testLogger.warn(`Row not found for table ${tableName}, attempt ${attempts}`);
                await this.page.waitForTimeout(5000);
                continue;
            }

            // Status icons are rendered as <OIcon name="…"> inside the type cell.
            // OIcon emits its kebab-case `name` attribute on the rendered svg.
            // Check completed first, then failed, then in-flight states.
            const completedIcon = typeCell.locator('[name="check-circle"]');
            if (await completedIcon.isVisible().catch(() => false)) {
                testLogger.info(`URL job completed for ${tableName} after ${elapsed}ms (${attempts} attempts)`);
                return 'completed';
            }

            // Check for failed icon (red warning)
            const failedIcon = typeCell.locator('[name="warning"]');
            if (await failedIcon.isVisible().catch(() => false)) {
                testLogger.error(`URL job failed for ${tableName} after ${elapsed}ms (${attempts} attempts)`);
                return 'failed';
            }

            // Check for processing icon (blue sync with animation)
            const processingIcon = typeCell.locator('[name="sync"]');
            if (await processingIcon.isVisible().catch(() => false)) {
                testLogger.debug(`URL job still processing for ${tableName}...`);
                await this.page.waitForTimeout(5000);
                continue;
            }

            // Check for pending icon (grey schedule)
            const pendingIcon = typeCell.locator('[name="schedule"]');
            if (await pendingIcon.isVisible().catch(() => false)) {
                testLogger.debug(`URL job pending for ${tableName}...`);
                await this.page.waitForTimeout(5000);
                continue;
            }

            // If no icon found, wait and retry
            testLogger.debug(`No status icon found, retrying...`);
            await this.page.waitForTimeout(5000);
        }

        testLogger.error(`URL job timeout for ${tableName} after ${timeout}ms (${attempts} attempts)`);
        return 'timeout';
    }

    /**
     * Verify URL job status icon in table list
     * @param {string} tableName - Name of the table
     * @param {string} expectedStatus - 'completed', 'processing', 'failed', or 'pending'
     */
    async verifyUrlJobStatus(tableName, expectedStatus) {
        testLogger.debug(`Verifying URL job status for ${tableName}: expecting ${expectedStatus}`);

        const typeCell = this.getRowTypeCell(tableName);
        await typeCell.waitFor({ state: 'visible', timeout: 10000 });

        let iconLocator;
        switch (expectedStatus) {
            case 'completed':
                iconLocator = typeCell.locator('[name="check-circle"]');
                break;
            case 'processing':
                iconLocator = typeCell.locator('[name="sync"]');
                break;
            case 'failed':
                iconLocator = typeCell.locator('[name="warning"]');
                break;
            case 'pending':
                iconLocator = typeCell.locator('[name="schedule"]');
                break;
            default:
                throw new Error(`Unknown status: ${expectedStatus}`);
        }

        await expect(iconLocator).toBeVisible();
        testLogger.debug(`URL job status verified: ${expectedStatus}`);
    }

    /**
     * Select update mode for URL-based tables
     * @param {string} mode - "reload", "append", "replace_failed", or "replace"
     */
    async selectUpdateMode(mode) {
        testLogger.debug(`Selecting update mode: ${mode}`);

        // Wait for form to fully load - the update mode options may take time to render in CI
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // First, ensure we're on the Update form (page data-test mounts for both
        // Add + Update modes; the OOptionGroup for update mode only renders for
        // URL-based tables in edit mode).
        await this.addPage.waitFor({ state: 'visible', timeout: 30000 });
        testLogger.debug('Update form page visible');

        // Wait for the update mode OOptionGroup to render
        await this.updateModeGroup.waitFor({ state: 'visible', timeout: 30000 });

        // The AddEnrichmentTable component declares updateModeOptions with
        // values: 'reload', 'append', 'replace_failed', 'replace'. Map the
        // legacy camelCase 'replaceFailed' alias used by older callers.
        const valueMap = {
            reload: 'reload',
            append: 'append',
            replaceFailed: 'replace_failed',
            replace_failed: 'replace_failed',
            replace: 'replace',
        };
        const value = valueMap[mode];
        if (!value) {
            throw new Error(`Unknown update mode: ${mode}`);
        }

        const opt = this.getOptionLocator('add-enrichment-table-update-mode', value);
        await opt.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await opt.waitFor({ state: 'visible', timeout: 10000 });
        await opt.click();

        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug(`Update mode selected: ${mode} (value=${value})`);
    }

    /**
     * Cancel enrichment table form (create or update)
     */
    async cancelEnrichmentTableForm() {
        testLogger.debug('Canceling enrichment table form');

        await this.addCancelBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        testLogger.debug('Form canceled');
    }

    /**
     * Verify table is visible in the list after creation
     * @param {string} tableName - Name of the table to verify
     */
    async verifyTableInList(tableName) {
        testLogger.debug(`Verifying table ${tableName} is visible in list`);

        // Search for the table first
        await this.searchEnrichmentTableInList(tableName);

        // Verify table row is visible
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await expect(row).toBeVisible();

        testLogger.debug(`Table ${tableName} verified in list`);
    }

    /**
     * Attempt to save enrichment table with invalid URL
     * @param {string} tableName - Name of the table
     * @param {string} invalidUrl - Invalid URL to test
     */
    async attemptSaveWithInvalidUrl(tableName, invalidUrl) {
        testLogger.debug(`Attempting to save with invalid URL: ${invalidUrl}`);

        // Fill name (OInput `-field` native input)
        await this.nameField.fill(tableName);

        // Select "From URL"
        await this.selectSourceOption('url');

        // Fill invalid URL — explicitly blur to flush the v-model update
        await this.fillUrlInput(invalidUrl);
        await this.urlField.blur();
        await this.page.waitForTimeout(300);

        // Attempt to save (no force — let Playwright wait for actionability)
        await this.addSaveBtn.click();

        // Wait for validation error to appear
        await this.page.waitForTimeout(1000);

        testLogger.debug('Save attempted with invalid URL');
    }

    /**
     * Toggle source selection between file and URL
     */
    async toggleSourceSelection() {
        testLogger.debug('Toggling source selection');

        // Determine which option is currently selected via Reka's data-state
        const urlOpt = this.getOptionLocator('add-enrichment-table-source', 'url');
        const fileOpt = this.getOptionLocator('add-enrichment-table-source', 'file');

        // Reka RadioGroupItem exposes data-state="checked" on the inner radio;
        // walk into the label to find the checked radio.
        const urlChecked = await urlOpt.locator('[data-state="checked"]').isVisible({ timeout: 1000 }).catch(() => false);

        if (urlChecked) {
            // Currently URL, switch to File
            await fileOpt.click();
            testLogger.debug('Toggled from URL to File');
        } else {
            // Currently File, switch to URL
            await urlOpt.click();
            testLogger.debug('Toggled from File to URL');
        }

        await this.page.waitForLoadState('domcontentloaded');
    }

    /**
     * Verify table row is visible in list
     * @param {string} tableName - Name of the table
     */
    async verifyTableRowVisible(tableName) {
        testLogger.debug(`Verifying table row visible: ${tableName}`);

        // Row visibility is signalled by the row's type-cell (always rendered)
        await expect(this.getRowTypeCell(tableName)).toBeVisible({ timeout: 20000 });

        testLogger.debug('Table row verified visible');
    }

    /**
     * Fill name input field (for custom form filling)
     * @param {string} name - Name to fill
     */
    async fillNameInput(name) {
        testLogger.debug(`Filling name input: ${name}`);

        await this.nameField.waitFor({ state: 'visible', timeout: 10000 });
        await this.nameField.fill(name);

        testLogger.debug('Name input filled');
    }

    /**
     * Verify no data message or empty table
     * @param {string} tableName - Table name to check doesn't exist
     */
    async verifyTableNotCreated(tableName) {
        testLogger.debug(`Verifying table ${tableName} was NOT created`);

        // After search filters down to a non-existent table, the row's type-cell
        // (`${tableName}-type-cell`) should not be present. Poll briefly for the
        // OTable filter pipeline to settle, then assert zero matching rows.
        const tableRow = this.getRowTypeCell(tableName);
        await expect.poll(async () => {
            return await tableRow.count();
        }, { timeout: 5000, intervals: [200, 500, 1000] }).toBe(0);

        testLogger.debug('Verified table does not exist');
    }

    /**
     * Verify table row is hidden after deletion
     * @param {string} tableName - Name of deleted table
     */
    async verifyTableRowHidden(tableName) {
        testLogger.debug(`Verifying table row hidden: ${tableName}`);

        // Wait for the row to be removed — toBeHidden waits up to its timeout
        await expect(this.getRowTypeCell(tableName)).toBeHidden({ timeout: 10000 });

        testLogger.debug('Table row verified hidden');
    }

    /**
     * Expect URL input to be visible
     */
    async expectUrlInputVisible() {
        testLogger.debug('Verifying URL input is visible');

        await expect(this.urlField).toBeVisible();

        testLogger.debug('URL input verified visible');
    }

    /**
     * Expect file input to be visible
     */
    async expectFileInputVisible() {
        testLogger.debug('Verifying file input is visible');

        await expect(this.fileField).toBeVisible();

        testLogger.debug('File input verified visible');
    }

    /**
     * Save update mode changes
     */
    async saveUpdateMode() {
        testLogger.debug('Saving update mode changes');

        await this.addSaveBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Wait for form to close (returned to list)
        await this.addPage.waitFor({ state: 'hidden', timeout: 15000 });
        testLogger.debug('Returned to enrichment tables list');

        // Wait for backend to process the update (CI environments are slower)
        await this.page.waitForTimeout(3000);

        // Reload page to ensure fresh data
        await this.page.reload({ waitUntil: 'domcontentloaded' });

        // Wait for the enrichment tables list to be visible after reload
        await this.listPage.waitFor({ state: 'visible', timeout: 15000 });

        testLogger.debug('Update mode saved and page refreshed');
    }

    // ============================================================================
    // EXPLORE / LOGS NAVIGATION METHODS
    // ============================================================================

    /**
     * Click explore button for a specific table
     * @param {string} tableName - Name of the table
     */
    async clickExploreButton(tableName) {
        testLogger.debug(`Clicking explore button for: ${tableName}`);

        const exploreBtn = this.page.locator(`[data-test="${tableName}-explore-btn"]`);
        await exploreBtn.waitFor({ state: 'visible', timeout: 30000 });
        await exploreBtn.click();

        testLogger.debug('Explore button clicked');
    }

    /**
     * Wait for navigation to logs page with enrichment tables stream
     */
    async waitForLogsPageNavigation() {
        testLogger.debug('Waiting for logs page navigation');

        await this.page.waitForURL(/.*logs.*stream_type=enrichment_tables.*/);
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        testLogger.debug('Navigated to logs page');
    }

    /**
     * Click the first log row in the results table
     */
    async clickFirstLogRow() {
        testLogger.debug('Clicking first log row');

        const firstLogRow = this.page.locator('[data-test="log-table-column-0-_timestamp"]').first();
        await firstLogRow.waitFor({ state: 'visible', timeout: 30000 });
        await firstLogRow.click();

        testLogger.debug('First log row clicked');
    }

    /**
     * Verify log detail panel is visible after clicking a row
     */
    async verifyLogDetailPanelVisible() {
        testLogger.debug('Verifying log detail panel is visible');

        // The log detail panel renders inside the logs search-result detail
        // drawer (`logs-search-result-detail-dialog`) or as the standalone
        // json-content element (`log-detail-json-content`). Either signal
        // confirms the panel is visible.
        const drawerVisible = await this.logDetailDrawer.isVisible({ timeout: 1000 }).catch(() => false);
        if (drawerVisible) {
            await expect(this.logDetailDrawer).toBeVisible({ timeout: 10000 });
        } else {
            const jsonContent = this.page.locator('[data-test="log-detail-json-content"]').first();
            await expect(jsonContent).toBeVisible({ timeout: 10000 });
        }

        testLogger.debug('Log detail panel verified visible');
    }

    /**
     * Close any open dialogs/modals.
     *
     * The logs row-detail panel was migrated from q-dialog to an ODrawer
     * (SearchResult.vue → `logs-search-result-detail-dialog`). Reka UI's
     * escape-key-down only fires when focus is inside the drawer, but
     * ODrawer's handleOpenAutoFocus prevents the default focus move and the
     * detail drawer has no form input or primary button to auto-focus —
     * so pressing Escape from the page does nothing and the overlay
     * intercepts subsequent clicks. Click ODrawer's built-in close
     * button (data-test="o-drawer-close-btn") instead, and wait for the drawer
     * to fully unmount before continuing.
     */
    async closeAnyOpenDialogs() {
        testLogger.debug('Closing any open dialogs');

        const closeBtn = this.logDetailDrawerClose.first();

        if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await closeBtn.click();
            await this.logDetailDrawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        } else {
            // Fallback for other dialogs — try ODialog close button; if no
            // overlay close button exists, press Escape (allowed per §2).
            const dialogClose = this.page.locator('[data-test="o-dialog-close-btn"]').first();
            if (await dialogClose.isVisible({ timeout: 1000 }).catch(() => false)) {
                await dialogClose.click();
            } else {
                await this.page.keyboard.press('Escape');
            }
        }
        await this.page.waitForTimeout(500);

        testLogger.debug('Dialogs closed');
    }

    // ============================================================================
    // SCHEMA MODAL METHODS
    // ============================================================================

    /**
     * Verify schema columns are displayed in the modal
     * @param {string[]} expectedColumns - Array of expected column names
     */
    async verifySchemaColumns(expectedColumns) {
        testLogger.debug(`Verifying schema columns: ${expectedColumns.join(', ')}`);

        // EnrichmentSchema exposes `schema-stream-title-text` and a schema
        // field-mapping table data-test. Wait for the drawer body and verify
        // each expected column appears inside the mapping table via its row
        // data-test pattern.
        await this.schemaDrawer.waitFor({ state: 'visible', timeout: 10000 });
        const mappingTable = this.page.locator('[data-test="schema-log-stream-field-mapping-table"]');
        await mappingTable.waitFor({ state: 'visible', timeout: 10000 });

        // Each expected column is rendered as a row whose data-test starts with
        // a known schema-field-* prefix. We can't text-match per §2, but we can
        // assert the mapping table is populated and rely on the test author to
        // assert specific data-test values where needed.
        for (const column of expectedColumns) {
            const columnDataTest = mappingTable.locator(`[data-test*="${column}"]`).first();
            await expect(columnDataTest).toBeVisible({ timeout: 5000 });
        }

        testLogger.debug('Schema columns verified');
    }

    /**
     * Close the schema modal
     */
    async closeSchemaModal() {
        testLogger.debug('Closing schema modal');

        const closeBtn = this.schemaDrawerCloseBtn;
        if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await closeBtn.click();
        } else {
            // Fallback: ODialog close button (schema was previously a dialog)
            const dialogClose = this.page.locator('[data-test="o-dialog-close-btn"]').first();
            if (await dialogClose.isVisible({ timeout: 1000 }).catch(() => false)) {
                await dialogClose.click();
            } else {
                await this.page.keyboard.press('Escape');
            }
        }
        await this.page.waitForTimeout(500);

        testLogger.debug('Schema modal closed');
    }

    // ============================================================================
    // VALIDATION ERROR METHODS
    // ============================================================================

    /**
     * Verify empty URL validation error
     */
    async verifyEmptyUrlError() {
        testLogger.debug('Verifying empty URL error');

        // The OInput URL field renders its error inside the URL wrapper. The
        // exact copy varies; assert the wrapper enters the error state by
        // checking that error text exists within the wrapper subtree.
        const urlWrapper = this.page.locator('[data-test="add-enrichment-table-url"]');
        await urlWrapper.waitFor({ state: 'visible', timeout: 10000 });
        const hasError = await urlWrapper.evaluate((el) => {
            const text = el.textContent || '';
            return /url is required|please enter.*url|url cannot be empty|required/i.test(text);
        });
        expect(hasError).toBe(true);

        testLogger.debug('Empty URL error verified');
    }

    /**
     * Verify duplicate table name error
     */
    async verifyDuplicateNameError() {
        testLogger.debug('Verifying duplicate name error');

        // The duplicate-name error surfaces either as an OToast notification
        // (`o-toast-error` / `o-toast-message`) or as an inline error on the
        // name OInput wrapper. Accept either.
        const toastVisible = await this.toastError.first().isVisible({ timeout: 5000 }).catch(() => false);
        if (toastVisible) {
            testLogger.debug('Duplicate name error verified via OToast');
            return;
        }
        const toastMsg = await this.toastMessage.first().isVisible({ timeout: 1000 }).catch(() => false);
        if (toastMsg) {
            testLogger.debug('Duplicate name error verified via toast message');
            return;
        }
        // Fallback: inline error on the name field wrapper
        const nameWrapper = this.page.locator('[data-test="add-enrichment-table-name"]');
        const hasInline = await nameWrapper.evaluate((el) => {
            const text = el.textContent || '';
            return /already exists|duplicate|exists/i.test(text);
        }).catch(() => false);
        expect(hasInline).toBe(true);

        testLogger.debug('Duplicate name error verified');
    }

    /**
     * Attempt to save with empty URL
     * @param {string} tableName - Name of the table
     */
    async attemptSaveWithEmptyUrl(tableName) {
        testLogger.debug(`Attempting to save with empty URL: ${tableName}`);

        // Fill in table name (OInput `-field` native input)
        await this.nameField.fill(tableName);

        // Select URL option
        await this.selectSourceOption('url');

        // Don't fill URL - leave it empty

        // Click Save
        await this.addSaveBtn.click();

        testLogger.debug('Attempted save with empty URL');
    }

    // ============================================================================
    // URL COUNT AND DISPLAY METHODS
    // ============================================================================

    /**
     * Verify URL count in the table list
     * @param {string} tableName - Name of the table
     * @param {number} expectedCount - Expected number of URLs
     */
    async verifyUrlCount(tableName, expectedCount) {
        testLogger.debug(`Verifying URL count for ${tableName}: expecting ${expectedCount}`);

        // The URL trigger span is rendered only for URL-based tables — assert
        // its visibility. Counts >1 render the count inline; we verify the
        // row's URL trigger contains the expected count by walking textContent.
        const urlTrigger = this.getRowUrlTrigger(tableName);
        await expect(urlTrigger).toBeVisible({ timeout: 10000 });

        if (expectedCount > 1) {
            const text = await urlTrigger.textContent();
            expect(text).toContain(`(${expectedCount})`);
        }

        testLogger.debug(`URL count verified: ${expectedCount}`);
    }

    /**
     * Verify existing URLs are displayed in edit mode
     * @param {string} expectedUrl - Expected URL to be shown
     */
    async verifyExistingUrlInEditMode(expectedUrl) {
        testLogger.debug(`Verifying existing URL in edit mode: ${expectedUrl}`);

        // The existing-URLs block is rendered inside the add/update page when
        // editing a URL-based table. Assert the page is showing edit mode and
        // that the expected URL string appears in the page subtree.
        await this.addPage.waitFor({ state: 'visible', timeout: 10000 });
        const hasUrl = await this.addPage.evaluate((el, expected) => {
            return (el.textContent || '').includes(expected);
        }, expectedUrl);
        expect(hasUrl).toBe(true);

        testLogger.debug('Existing URL verified');
    }

    /**
     * Verify existing URLs count in edit mode
     * @param {number} expectedCount - Expected number of existing URLs
     */
    async verifyExistingUrlsCount(expectedCount) {
        testLogger.debug(`Verifying existing URLs count: ${expectedCount}`);

        // The header "Existing URLs (N)" is rendered inside the add-page; check
        // its presence via textContent on the page wrapper.
        await this.addPage.waitFor({ state: 'visible', timeout: 10000 });
        const hasCount = await this.addPage.evaluate((el, n) => {
            return (el.textContent || '').includes(`Existing URLs (${n})`);
        }, expectedCount);
        expect(hasCount).toBe(true);

        testLogger.debug(`Existing URLs count verified: ${expectedCount}`);
    }

    // ============================================================================
    // POM COMPLIANCE METHODS - Extracted from spec file raw selectors
    // ============================================================================

    /**
     * Click the Save button on enrichment table form
     */
    async clickSaveButton() {
        testLogger.debug('Clicking Save button');
        await this.addSaveBtn.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        testLogger.debug('Save button clicked');
    }

    /**
     * Wait for the Add Enrichment Table form to close
     * @param {number} timeout - Timeout in milliseconds (default 15000)
     * @returns {Promise<boolean>} True if form closed, false if still visible
     */
    async waitForAddFormToClose(timeout = 15000) {
        testLogger.debug('Waiting for Add Enrichment Table form to close');
        const formHidden = await this.addPage.waitFor({ state: 'hidden', timeout }).then(() => true).catch(() => false);
        testLogger.debug(`Form closed: ${formHidden}`);
        return formHidden;
    }

    /**
     * Check for error notification and return its text if visible
     * @returns {Promise<{hasError: boolean, errorText: string|null}>}
     */
    async checkForErrorNotification() {
        testLogger.debug('Checking for error notification');
        // OToast surfaces transient errors with `o-toast-error` / `o-toast-message`
        const errorNotification = this.toastError;
        const hasError = await errorNotification.first().isVisible({ timeout: 5000 }).catch(() => false);

        if (hasError) {
            const errorText = await errorNotification.first().textContent();
            testLogger.debug(`Error notification found: ${errorText}`);
            return { hasError: true, errorText };
        }
        // Also check generic toast message panel (covers default + error variants)
        const hasMsg = await this.toastMessage.first().isVisible({ timeout: 1000 }).catch(() => false);
        if (hasMsg) {
            const errorText = await this.toastMessage.first().textContent();
            testLogger.debug(`Toast message found: ${errorText}`);
            return { hasError: true, errorText };
        }

        testLogger.debug('No error notification found');
        return { hasError: false, errorText: null };
    }

    /**
     * Navigate back from form - handles Cancel button visibility check
     * If Cancel button is visible, clicks it; otherwise navigates to enrichment table list
     * Handles race condition where form may auto-close after error notification
     */
    async navigateBackFromFormIfNeeded() {
        testLogger.debug('Navigating back from form');

        // Wait briefly for any auto-close behavior to complete
        await this.page.waitForTimeout(1000);

        const isCancelVisible = await this.addCancelBtn.isVisible({ timeout: 3000 }).catch(() => false);

        if (isCancelVisible) {
            try {
                // Use click with shorter timeout and handle detachment gracefully
                await this.addCancelBtn.click({ timeout: 5000 });
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                testLogger.debug('Clicked Cancel button to navigate back');
            } catch (clickError) {
                // Element may have been detached (form auto-closed) - this is okay
                if (clickError.message.includes('detached') || clickError.message.includes('Target closed')) {
                    testLogger.debug('Cancel button detached (form auto-closed) - navigating to list');
                    await this.navigateToEnrichmentTable();
                } else {
                    throw clickError;
                }
            }
        } else {
            await this.navigateToEnrichmentTable();
            testLogger.debug('Form already closed, navigated to enrichment tables list');
        }
    }

    /**
     * Wait for Enrichment Tables list to be visible
     * @param {number} timeout - Timeout in milliseconds (default 15000)
     */
    async waitForEnrichmentTablesList(timeout = 15000) {
        testLogger.debug('Waiting for Enrichment Tables list');
        await this.listPage.waitFor({ state: 'visible', timeout });
        testLogger.debug('Enrichment Tables list is visible');
    }

    /**
     * Search for table with retry logic (for CI environments)
     * @param {string} tableName - Name of table to search
     * @param {number} maxAttempts - Maximum number of retry attempts (default 5)
     * @returns {Promise<{found: boolean, row: any}>}
     */
    async searchTableWithRetry(tableName, maxAttempts = 5) {
        testLogger.debug(`Searching for table with retry: ${tableName}`);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            testLogger.info(`Searching for table - attempt ${attempt}/${maxAttempts}`);

            // Clear search and search again — OInput's `-field` native input
            await this.searchInputField.clear();
            await this.page.waitForTimeout(1000);
            await this.searchInputField.fill(tableName);
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await this.page.waitForTimeout(2000);

            // Visibility is signalled by the per-row type cell data-test
            const row = this.getRowTypeCell(tableName);
            const isVisible = await row.isVisible({ timeout: 10000 }).catch(() => false);

            if (isVisible) {
                testLogger.info('Table found in list');
                return { found: true, row };
            }

            if (attempt < maxAttempts) {
                testLogger.info('Table not found yet, waiting and retrying...');
                await this.page.waitForTimeout(5000);
                await this.page.reload({ waitUntil: 'domcontentloaded' });
                await this.waitForEnrichmentTablesList();
            }
        }

        testLogger.warn(`Table ${tableName} not found after ${maxAttempts} attempts`);
        return { found: false, row: null };
    }

    /**
     * Take debug screenshot
     * @param {string} filename - Screenshot filename (without path)
     */
    async takeDebugScreenshot(filename) {
        testLogger.debug(`Taking debug screenshot: ${filename}`);
        await this.page.screenshot({ path: `test-results/${filename}`, fullPage: true });
        testLogger.debug(`Screenshot saved to test-results/${filename}`);
    }

    // ============================================================================
    // URL JOBS DIALOG METHODS
    // ============================================================================

    /**
     * Click on the URL status icon in the table row to open URL Jobs dialog
     * @param {string} tableName - Name of the table
     */
    async clickUrlStatusIcon(tableName) {
        testLogger.debug(`Clicking URL status icon for: ${tableName}`);
        // The Vue template has @click="showUrlJobsDialog" on two elements:
        // 1. <span class="cursor-pointer"> containing "Url" text (always present for URL tables)
        //    — now exposed as `${name}-type-url-trigger`
        // 2. <OIcon name="warning" class="cursor-pointer"> (only when job failed)
        // Prefer the URL trigger span which always carries @click.
        const urlTrigger = this.getRowUrlTrigger(tableName);
        const isVisible = await urlTrigger.isVisible({ timeout: 10000 }).catch(() => false);
        if (isVisible) {
            await urlTrigger.click();
        } else {
            // Fallback: click any OIcon (warning/check-circle) inside the type cell
            const typeCell = this.getRowTypeCell(tableName);
            await typeCell.waitFor({ state: 'visible', timeout: 10000 });
            const statusIcon = typeCell.locator('[name="warning"], [name="check-circle"]').first();
            await statusIcon.click();
        }

        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug('URL status icon clicked');
    }

    /**
     * Wait for URL Jobs dialog to open
     * @param {string} tableName - Expected table name in dialog title
     */
    async waitForUrlJobsDialog(tableName) {
        testLogger.debug(`Waiting for URL Jobs dialog for: ${tableName}`);

        // Wait for the drawer container to open. The title contains the table
        // name; we assert the drawer wrapper is visible and the title text
        // appears inside it via textContent check.
        await this.urlJobsDrawer.waitFor({ state: 'visible', timeout: 15000 });
        const hasTitle = await this.urlJobsDrawer.evaluate((el, name) => {
            return (el.textContent || '').includes(`URL Jobs for ${name}`);
        }, tableName);
        expect(hasTitle).toBe(true);

        testLogger.debug('URL Jobs dialog is visible');
    }

    /**
     * Verify a job shows failed status in URL Jobs dialog
     */
    async verifyJobFailed() {
        testLogger.debug('Verifying job failed');

        // Job items expose `enrichment-url-jobs-item-<i>-status-badge` with
        // data-test-value="<status>". A failed job carries data-test-value="failed".
        const failedBadge = this.urlJobsDrawer.locator('[data-test*="-status-badge"][data-test-value="failed"]').first();
        await expect(failedBadge).toBeVisible({ timeout: 10000 });

        testLogger.debug('Job failed status verified');
    }

    /**
     * Verify URL Jobs dialog shows a specific error message
     * @param {RegExp|string} errorPattern - Error message pattern to look for
     */
    async verifyJobError(errorPattern) {
        testLogger.debug(`Verifying job error matches: ${errorPattern}`);

        // Failed job items expose `enrichment-url-jobs-item-<i>-error` with the
        // failure message — check at least one error block contains the pattern.
        const errorBlocks = this.urlJobsDrawer.locator('[data-test*="-error"]');
        const count = await errorBlocks.count();
        let matched = false;
        for (let i = 0; i < count; i++) {
            const text = await errorBlocks.nth(i).textContent();
            if (text && (typeof errorPattern === 'string' ? text.includes(errorPattern) : errorPattern.test(text))) {
                matched = true;
                break;
            }
        }
        expect(matched).toBe(true);

        testLogger.debug('Job error verified');
    }

    /**
     * Verify a job shows completed status
     */
    async verifyJobCompleted() {
        testLogger.debug('Verifying job completed');

        // Look for the completed badge via data-test-value="completed"
        const completedBadge = this.urlJobsDrawer.locator('[data-test*="-status-badge"][data-test-value="completed"]').first();
        await expect(completedBadge).toBeVisible({ timeout: 10000 });

        testLogger.debug('Job completed status verified');
    }

    /**
     * Close the URL Jobs dialog
     */
    async closeUrlJobsDialog() {
        testLogger.debug('Closing URL Jobs dialog');

        // URL Jobs migrated from q-dialog to ODrawer — use the o-drawer close button
        const closeBtn = this.urlJobsDrawerCloseBtn.first();
        if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await closeBtn.click();
        } else {
            const dialogClose = this.page.locator('[data-test="o-dialog-close-btn"]').first();
            if (await dialogClose.isVisible({ timeout: 1000 }).catch(() => false)) {
                await dialogClose.click();
            } else {
                await this.page.keyboard.press('Escape');
            }
        }

        await this.page.waitForTimeout(500);
        testLogger.debug('URL Jobs dialog closed');
    }

    /**
     * Wait for URL job to show failed status (with retry for async processing)
     * @param {string} tableName - Name of the table
     * @param {number} maxWaitTime - Maximum wait time in ms (default 60000 = 1 min)
     * @returns {Promise<{found: boolean, elapsedTime: number}>} Object with found status and elapsed time
     */
    async waitForUrlJobFailed(tableName, maxWaitTime = 60000) {
        testLogger.info(`Waiting for URL job to fail for: ${tableName} (max ${maxWaitTime / 1000}s)`);
        const startTime = Date.now();
        let attemptCount = 0;

        while (Date.now() - startTime < maxWaitTime) {
            attemptCount++;
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            // Reload to get fresh status
            await this.page.reload({ waitUntil: 'domcontentloaded' });
            await this.waitForEnrichmentTablesList();
            await this.searchEnrichmentTableInList(tableName);

            // Failed icon: <OIcon name="warning"> inside the row's type-cell
            const warningIcon = this.getRowTypeCell(tableName).locator('[name="warning"]');

            if (await warningIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
                testLogger.info(`Failed status icon found after ${elapsed}s (attempt ${attemptCount})`);
                return { found: true, elapsedTime: elapsed };
            }

            testLogger.debug(`Job still processing - attempt ${attemptCount}, elapsed ${elapsed}s`);
            await this.page.waitForTimeout(5000);
        }

        const totalElapsed = Math.round((Date.now() - startTime) / 1000);
        testLogger.warn(`Timeout waiting for job to fail after ${totalElapsed}s (${attemptCount} attempts)`);
        return { found: false, elapsedTime: totalElapsed };
    }

    /**
     * Replace URL in existing enrichment table (in edit mode)
     * @param {string} newUrl - URL to replace with
     */
    async replaceUrlInEditMode(newUrl) {
        testLogger.debug(`Replacing URL in edit mode: ${newUrl}`);

        // Select "Replace all URLs" mode
        await this.selectUpdateMode('replace');

        // Wait for URL input to appear
        await this.page.waitForTimeout(1000);

        // Fill the new URL input
        await this.fillNewUrlInput(newUrl);

        testLogger.debug('URL replaced in edit mode');
    }

    /**
     * Add a URL in edit mode - simplified version that finds any visible URL input
     * Use this when update mode radio buttons aren't available
     * @param {string} newUrl - URL to add
     */
    async addUrlInEditMode(newUrl) {
        testLogger.debug(`Adding URL in edit mode: ${newUrl}`);

        // Wait for update form to be ready
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(2000);

        // In edit/append mode the URL input is `add-enrichment-table-new-url-field`
        await this.fillNewUrlInput(newUrl);

        testLogger.debug('URL added in edit mode');
    }

    // ============================================================================
    // SCHEMA MISMATCH TEST POM METHODS
    // ============================================================================

    /**
     * Count action buttons visible in the row (Explore / Schema / Edit / Delete).
     * Each carries a `${tableName}-<role>-btn` data-test attribute.
     */
    async getTableRowButtonCount(tableName) {
        testLogger.debug(`Getting button count for: ${tableName}`);
        const roleSuffixes = ['explore-btn', 'schema-btn', 'edit-btn', 'delete-btn'];
        let buttonCount = 0;
        for (const suffix of roleSuffixes) {
            const btn = this.page.locator(`[data-test="${tableName}-${suffix}"]`);
            if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
                buttonCount += await btn.count();
            }
        }
        testLogger.debug(`Button count for ${tableName}: ${buttonCount}`);
        return buttonCount;
    }

    /**
     * Check if warning icon is visible in the Type cell for a table
     * @param {string} tableName - Name of the table
     * @returns {Promise<boolean>} True if warning icon is visible
     */
    async isWarningIconVisibleInRow(tableName) {
        testLogger.debug(`Checking warning icon for: ${tableName}`);
        const warningIcon = this.getRowTypeCell(tableName).locator('[name="warning"]');
        const isVisible = await warningIcon.isVisible({ timeout: 2000 }).catch(() => false);
        testLogger.debug(`Warning icon visible: ${isVisible}`);
        return isVisible;
    }

    /**
     * Wait for URL job to complete (either success with buttons or failure with warning icon)
     * @param {string} tableName - Name of the table
     * @param {number} maxAttempts - Maximum number of polling attempts (default 12)
     * @param {number} pollInterval - Time between polls in ms (default 5000)
     * @returns {Promise<{completed: boolean, hasFailed: boolean, buttonCount: number}>}
     */
    /**
     * Read the authoritative aggregate URL-job status for a table straight from
     * the backend status API (same source the UI uses), avoiding races where the
     * row buttons briefly mis-render during the processing->completed transition.
     * @returns {Promise<'completed'|'failed'|'processing'|'pending'|null>}
     */
    async getUrlJobStatus(tableName) {
        return await this.page.evaluate(async (name) => {
            const org = new URLSearchParams(location.search).get('org_identifier');
            if (!org) return null;
            try {
                const r = await fetch(`/api/${org}/enrichment_tables/status`, { credentials: 'include' });
                if (!r.ok) return null;
                const j = await r.json();
                const data = j.data || j;
                const entry = data[name];
                if (!entry) return null;
                const jobs = Array.isArray(entry) ? entry : [entry];
                if (jobs.some((x) => x.status === 'failed')) return 'failed';
                if (jobs.some((x) => x.status === 'processing')) return 'processing';
                if (jobs.some((x) => x.status === 'pending')) return 'pending';
                if (jobs.length && jobs.every((x) => x.status === 'completed')) return 'completed';
                return 'pending';
            } catch (e) {
                return null;
            }
        }, tableName);
    }

    /**
     * Re-execute a failed URL job with its stored URL — the product's own
     * "reload / retry failed jobs" action (AddEnrichmentTable.vue reload mode:
     * url='', retry=true, replace_failed=false). Used to ride out transient
     * backend URL-fetch blips (the fetch itself is external, and the backend
     * already retries 3x internally before marking a job failed).
     * @returns {Promise<number|null>} HTTP status of the reload request
     */
    async reloadFailedUrlJob(tableName) {
        return await this.page.evaluate(async (name) => {
            const org = new URLSearchParams(location.search).get('org_identifier');
            if (!org) return null;
            try {
                const r = await fetch(
                    `/api/${org}/enrichment_tables/${name}/url?append=false&resume=false&retry=true`,
                    {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: '', replace_failed: false }),
                    },
                );
                return r.status;
            } catch (e) {
                return null;
            }
        }, tableName);
    }

    async waitForUrlJobToFinish(tableName, maxAttempts = 15, pollInterval = 5000, retryOnFailure = false, maxFailureRetries = 3) {
        let failureRetries = 0;
        testLogger.info(`Waiting for URL job to finish: ${tableName} (max ${maxAttempts} attempts)`);

        for (let i = 0; i < maxAttempts; i++) {
            await this.page.waitForTimeout(pollInterval);
            // Dismiss any open form first (after Save the edit form stays open),
            // then navigate explicitly to guarantee we're on the enrichment list.
            // A transient slow nav/render on one poll must not abort the whole
            // wait — swallow it and retry on the next iteration.
            try {
                await this.navigateBackFromFormIfNeeded();
                await this.navigateToEnrichmentTable();
                await this.searchEnrichmentTableInList(tableName);
            } catch (navErr) {
                testLogger.debug(`Poll ${i + 1}/${maxAttempts}: nav/search transient error, retrying — ${navErr.message}`);
                continue;
            }

            // Authoritative decision from the backend status API (same source the
            // UI uses). This removes the old `buttonCount >= 2` false-positive
            // (a FAILED job shows edit+delete = 2 buttons) AND any button-render
            // race during the processing->completed transition.
            const apiStatus = await this.getUrlJobStatus(tableName);
            if (apiStatus === 'completed') {
                const buttonCount = await this.getTableRowButtonCount(tableName);
                testLogger.info(`Job completed (status API) - ${buttonCount} buttons - attempt ${i + 1}`);
                return { completed: true, hasFailed: false, buttonCount };
            }
            if (apiStatus === 'failed') {
                // Surface the backend error_message + job URL in the test log —
                // without this a failed job only shows up as a downstream
                // selector timeout, which is misleading to triage.
                try {
                    const detail = await this.page.evaluate(async (name) => {
                        const org = new URLSearchParams(location.search).get('org_identifier');
                        const r = await fetch(`/api/${org}/enrichment_tables/status`, { credentials: 'include' });
                        const j = await r.json(); const d = j.data || j; const e = d[name];
                        const jobs = Array.isArray(e) ? e : [e];
                        return jobs.map((x) => ({ status: x.status, url: x.url, err: x.error_message, retries: x.retry_count }));
                    }, tableName);
                    testLogger.info(`URL-job failure detail for ${tableName}: ${JSON.stringify(detail)}`);
                } catch (e) { /* logging only */ }
                // Transient backend URL-fetch failure: re-execute the job (product's
                // own reload/retry) and keep polling, rather than failing the test on
                // an external blip. Only when the caller opts in (e.g. the schema-view
                // test); tests that EXPECT a failure (schema-mismatch) pass retryOnFailure=false.
                if (retryOnFailure && failureRetries < maxFailureRetries) {
                    failureRetries += 1;
                    const rc = await this.reloadFailedUrlJob(tableName);
                    testLogger.info(`Job failed - reload-retry ${failureRetries}/${maxFailureRetries} (reload HTTP ${rc}) - attempt ${i + 1}`);
                    continue;
                }
                testLogger.info(`Job failed (status API) after ${failureRetries} reload-retries - attempt ${i + 1}`);
                return { completed: true, hasFailed: true, buttonCount: 0 };
            }
            if (apiStatus === 'processing' || apiStatus === 'pending') {
                testLogger.info(`Job ${apiStatus} (status API) - attempt ${i + 1}/${maxAttempts}`);
                continue;
            }

            // API unreachable/unknown — fall back to button-state inference:
            //   completed -> explore+schema+edit+delete; failed -> edit+delete; processing -> delete
            const schemaVisible = await this.getRowSchemaBtn(tableName).isVisible({ timeout: 1000 }).catch(() => false);
            if (schemaVisible) {
                const buttonCount = await this.getTableRowButtonCount(tableName);
                testLogger.info(`Job completed (schema btn visible) - ${buttonCount} buttons - attempt ${i + 1}`);
                return { completed: true, hasFailed: false, buttonCount };
            }
            const hasWarningIcon = await this.isWarningIconVisibleInRow(tableName);
            const editVisible = await this.getRowEditBtn(tableName).isVisible({ timeout: 500 }).catch(() => false);
            if (hasWarningIcon || editVisible) {
                testLogger.info(`Job failed (fallback: warning=${hasWarningIcon}, edit-only) - attempt ${i + 1}`);
                return { completed: true, hasFailed: true, buttonCount: editVisible ? 2 : 0 };
            }

            testLogger.info(`Waiting for job (processing/pending) - attempt ${i + 1}/${maxAttempts}`);
        }

        testLogger.warn(`Job did not complete within ${maxAttempts} attempts`);
        return { completed: false, hasFailed: false, buttonCount: 0 };
    }

    /**
     * Check if job status dialog is visible
     * @returns {Promise<boolean>} True if dialog is visible
     */
    async isJobsDialogVisible() {
        return await this.urlJobsDrawer.isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Get job status from the URL Jobs dialog
     * @returns {Promise<{status: 'failed'|'completed'|'unknown', hasFailed: boolean, hasCompleted: boolean}>}
     */
    async getJobStatusFromDialog() {
        testLogger.debug('Getting job status from dialog');

        // Each job badge in the drawer carries `enrichment-url-jobs-item-<i>-status-badge`
        // with a data-test-value="<status>" attribute. Use the data-test-value
        // attribute predicate to pick the failed/completed badges deterministically.
        const failedBadge = this.urlJobsDrawer.locator('[data-test*="-status-badge"][data-test-value="failed"]').first();
        const completedBadge = this.urlJobsDrawer.locator('[data-test*="-status-badge"][data-test-value="completed"]').first();

        const hasFailed = await failedBadge.isVisible({ timeout: 5000 }).catch(() => false);
        const hasCompleted = await completedBadge.isVisible({ timeout: 2000 }).catch(() => false);

        let status = 'unknown';
        if (hasFailed) status = 'failed';
        else if (hasCompleted) status = 'completed';

        testLogger.debug(`Job status: ${status} (failed: ${hasFailed}, completed: ${hasCompleted})`);
        return { status, hasFailed, hasCompleted };
    }

    /**
     * Check if schema-related error message is visible in dialog
     * @returns {Promise<boolean>} True if schema error message is visible
     */
    async isSchemaErrorVisibleInDialog() {
        testLogger.debug('Checking for schema error in dialog');

        // Walk the drawer subtree for any element matching schema/column/mismatch
        // via textContent — purely scoped to data-test attributes.
        const hasError = await this.urlJobsDrawer.evaluate((el) => {
            const text = el.textContent || '';
            return /schema|column|mismatch/i.test(text);
        }).catch(() => false);
        testLogger.debug(`Schema error visible: ${hasError}`);
        return hasError;
    }

    /**
     * Verify any job status badge is visible in dialog
     */
    async verifyAnyJobStatusBadgeVisible() {
        testLogger.debug('Verifying any job status badge is visible');
        const anyBadge = this.urlJobsDrawer.locator('[data-test*="-status-badge"]').first();
        await expect(anyBadge).toBeVisible({ timeout: 10000 });
        testLogger.debug('Job status badge verified visible');
    }

    /**
     * Delete an enrichment table if it exists (for test cleanup)
     * @param {string} tableName - Name of the table to delete
     * @returns {Promise<{deleted: boolean, reason: 'deleted'|'not_found'|'deletion_failed', error?: string}>}
     */
    async deleteTableIfExists(tableName) {
        testLogger.debug(`Attempting to delete table if exists: ${tableName}`);

        try {
            // Navigate to enrichment tables list
            await this.navigateToEnrichmentTable();
            await this.waitForEnrichmentTablesList();

            // Search for the table — OInput's `-field` native input
            await this.searchInputField.clear();
            await this.searchInputField.fill(tableName);
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await this.page.waitForTimeout(1000);

            // Check if table exists (per-row type-cell data-test)
            const isVisible = await this.getRowTypeCell(tableName).isVisible({ timeout: 3000 }).catch(() => false);

            if (!isVisible) {
                testLogger.debug(`Table ${tableName} not found - nothing to delete`);
                return { deleted: false, reason: 'not_found' };
            }

            // Delete the table
            await this.clickDeleteButton(tableName);
            await this.verifyDeleteConfirmationDialog();
            await this.clickDeleteOK();
            await this.verifyTableRowHidden(tableName);

            testLogger.info(`Table ${tableName} deleted successfully`);
            return { deleted: true, reason: 'deleted' };
        } catch (error) {
            testLogger.error(`Failed to delete table ${tableName}: ${error.message}`);
            return { deleted: false, reason: 'deletion_failed', error: error.message };
        }
    }

    /**
     * Set the file input for file upload enrichment
     * @param {string} filePath - Path to the CSV file to upload
     */
    async setFileInput(filePath) {
        testLogger.debug(`Setting file input: ${filePath}`);
        const inputFile = this.page.locator(this.fileInput);
        await inputFile.setInputFiles(filePath);
        testLogger.debug('File input set');
    }
}

module.exports = { EnrichmentPage };
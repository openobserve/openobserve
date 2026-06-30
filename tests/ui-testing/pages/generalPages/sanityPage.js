import { expect } from '@playwright/test';
const { waitUtils } = require('../../playwright-tests/utils/wait-helpers.js');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
const MonacoEditorHelper = require('../../playwright-tests/utils/MonacoEditorHelper.js');
import { openNavFlyoutChild } from '../commonActions.js';

export class SanityPage {
    constructor(page) {
        this.page = page;

        // ============================================================
        // Quick Mode / Fields / Query Editor locators
        // ============================================================
        this.quickModeToggleButton = page.locator('[data-test="logs-search-bar-quick-mode-toggle-btn"]');
        this.allFieldsButton = page.locator('[data-test="logs-all-fields-btn"]');
        this.interestingJobFieldButton = page.locator('[data-test="log-search-index-list-interesting-job-field-btn"]');
        this.sqlModeToggleButton = page.locator('[data-test="logs-search-bar-sql-mode-toggle-btn"]');
        this.queryEditor = page.locator('[data-test="logs-search-bar-query-editor"]');

        // ============================================================
        // Search and Refresh locators
        // ============================================================
        this.refreshButton = page.locator('[data-test="logs-search-bar-refresh-btn"]');
        this.utilitiesMenuButton = page.locator('[data-test="logs-search-bar-utilities-menu-btn"]');
        this.resetFiltersButton = page.locator('[data-test="logs-search-bar-reset-filters-btn"]');
        this.searchResultTitle = page.locator('[data-test="logs-search-result-title"]');
        this.searchResultPagination = page.locator('[data-test="logs-search-result-pagination"]');
        this.searchResultLogsTable = page.locator('[data-test="logs-search-result-logs-table"]');

        // ============================================================
        // Pagination and Results locators
        // ============================================================
        // With the FTS default-column feature the first result cell may be the
        // generic "source" column OR an FTS column (e.g. body/message/log), so
        // target whichever first-row cell is rendered. A click on any cell
        // bubbles to the row handler that opens the detail dialog.
        this.resultColumnSource = page.locator('[data-test^="log-table-column-0-"]').first();
        this.closeDialog = page.locator('[data-test="logs-search-result-detail-dialog"] [data-test="o-drawer-close-btn"]');

        // ============================================================
        // Histogram locators
        // ============================================================
        this.histogramToggleButton = page.locator('[data-test="logs-search-bar-show-histogram-toggle-btn"]');
        this.histogramCanvas = page.locator('[data-test="logs-search-result-bar-chart"] canvas');
        this.histogramBarChart = page.locator('[data-test="logs-search-result-bar-chart"]');

        // ============================================================
        // Saved View / Function dialog locators
        // ============================================================
        // Saved view dialog (SearchBar.vue:1654) and saved function dialog (SearchBar.vue:1703) were migrated
        // from q-dialog to ODialog. The legacy shared data-test "saved-view-dialog-save-btn" no longer exists;
        // each dialog now exposes its own ODialog primary button. The dialogs are mutually exclusive at runtime.
        this.savedViewDialogSave = page.locator('[data-test="search-bar-store-state-saved-view-dialog"] [data-test="o-dialog-primary-btn"], [data-test="search-bar-store-state-saved-function-dialog"] [data-test="o-dialog-primary-btn"]');
        // After ConfirmDialog migrated to ODialog, the OK button no longer
        // carries a "confirm-button" data-test. The ODialog primary footer
        // button surfaces as "o-dialog-primary-btn" inside the open dialog.
        this.confirmDialogPrimary = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
        // Generic ODialog primary button (used for force-delete style flows where the
        // confirm dialog wrapper data-test differs).
        this.openDialogPrimary = page.locator('[data-test="o-dialog-primary-btn"]:visible').first();

        // ============================================================
        // Function locators (SearchBar VRL editor section)
        // ============================================================
        // TransformSelector save button (when actions are enabled)
        this.functionSaveButton = page.locator('[data-test="logs-search-bar-save-transform-btn"]');
        // FunctionSelector save button (when actions are disabled)
        this.functionSaveButtonNew = page.locator('[data-test="logs-search-bar-save-function-btn"]');
        this.functionSaveButtonAlternate = page.locator('[data-test="logs-search-bar-function-dropdown"]');
        this.vrlToggleButton = page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
        this.fnEditor = page.locator('[data-test="logs-vrl-function-editor"]');
        this.fnEditorInputArea = page.locator('[data-test="logs-vrl-function-editor"] [data-test="logs-vrl-function-editor-inputarea"]');
        this.savedFunctionNameInput = page.locator('[data-test="saved-function-name-input"]');
        this.savedFunctionNameInputField = page.locator('[data-test="saved-function-name-input-field"]');

        // ============================================================
        // Menu Navigation locators
        // ============================================================
        this.realtimeTab = page.locator('[data-test="tab-realtime"]');
        this.streamPipelinesTab = page.locator('[data-test="pipeline-section-tab-streamPipelines"]');
        this.functionStreamTab = page.locator('[data-test="pipeline-section-tab-functions"]');
        this.dashboardsMenuItem = page.locator('[data-test="menu-link-\\/dashboards-item"]');
        this.streamsMenuItem = page.locator('[data-test="menu-link-\\/streams-item"]');
        this.homeMenuItem = page.locator('[data-test="menu-link-\\/-item"]');

        // ============================================================
        // Dashboard Folder locators
        // ============================================================
        this.dashboardSearch = page.locator('[data-test="dashboard-search"]');
        this.newFolderButton = page.locator('[data-test="dashboard-new-folder-btn"]');
        // dashboard-folder-add-name is an OFormInput wrapper; fill the auto-generated `-field` variant.
        this.folderAddNameField = page.locator('[data-test="dashboard-folder-add-name-field"]');
        // AddFolder.vue now uses ODrawer's primary footer button — there is
        // no standalone "dashboard-folder-add-save" element after migration.
        this.folderAddSave = page.locator('[data-test="dashboard-folder-dialog"] [data-test="o-dialog-primary-btn"]');
        this.deleteFolderIcon = page.locator('[data-test="dashboard-delete-folder-icon"]');

        // ============================================================
        // Stream locators
        // ============================================================
        this.addStreamButton = page.locator('[data-test="log-stream-add-stream-btn"]');
        // data-test moved onto OInput in AddStream.vue so the native input is `-field`.
        this.streamNameInputField = page.locator('[data-test="add-stream-name-input-field"]');
        this.streamTypeDropdown = page.locator('[data-test="add-stream-type-input"]');
        this.streamTypeLogsOption = page.locator('[data-test="add-stream-type-input-option"][data-test-value="logs"]');
        // AddStream.vue uses ODrawer (isInPipeline=false on the Streams page).
        // The save action is the ODrawer built-in primary footer button.
        this.saveStreamButton = page.locator('[data-test="add-stream-dialog"] [data-test="o-dialog-primary-btn"]');
        // Stream search input on Streams page; OInput auto-generates `-field` variant.
        this.searchStreamInputField = page.locator('[data-test="streams-search-stream-input-field"]');
        // Stream delete button per row (data-test added in LogStream.vue this pass).
        this.streamDeleteFirstRowBtn = page.locator('[data-test="log-stream-delete-btn"]').first();
        // Stream delete confirmation dialog primary button.
        this.streamDeleteDialogPrimary = page.locator('[data-test="log-stream-delete-dialog"] [data-test="o-dialog-primary-btn"]');

        // ============================================================
        // Function list page locators
        // ============================================================
        this.functionListSearchInputField = page.locator('[data-test="functions-list-search-input-field"]');
        this.functionListAddButton = page.locator('[data-test="function-list-add-function-btn"]');
        this.functionListDeleteFirstBtn = page.locator('[data-test="function-list-delete-function-btn"]').first();
        this.addFunctionNameInputField = page.locator('[data-test="add-function-name-input-field"]');
        this.addFunctionSaveBtn = page.locator('[data-test="add-function-save-btn"]');

        // ============================================================
        // Settings locators
        // ============================================================
        this.settingsMenuItem = page.locator('[data-test="menu-link-/settings-item"]');
        // general-settings-tab data-test added in settings/index.vue this pass.
        this.generalSettingsTab = page.locator('button[data-test="general-settings-tab"]');
        // OInput auto-generates `-field` for the native input.
        this.scrapeIntervalInputField = page.locator('[data-test="general-settings-scrape-interval-field"]');
        this.settingsSaveButton = page.locator('[data-test="dashboard-add-submit"]');

        // ============================================================
        // Stream Stats locators
        // ============================================================
        this.refreshStatsButton = page.locator('[data-test="log-stream-refresh-stats-btn"]');
        this.firstStreamRow = page.locator('[data-test="o2-table-row-0"]');

        // ============================================================
        // Schema Pagination locators
        // ============================================================
        this.schemaLastPageButton = page.locator('[data-test="logs-page-fields-list-pagination-lastpage-button"]');
        this.schemaFirstPageButton = page.locator('[data-test="logs-page-fields-list-pagination-firstpage-button"]');
        this.schemaPage2Button = page.locator('[data-test="logs-page-fields-list-pagination-page-2-button"]');
        this.schemaPage3Button = page.locator('[data-test="logs-page-fields-list-pagination-page-3-button"]');
        this.schemaPage4Button = page.locator('[data-test="logs-page-fields-list-pagination-page-4-button"]');
        // OSelect (multiple) renders the wrapper div with the consumer-supplied
        // data-test and the clickable PopoverTrigger as `${parent}-trigger`.
        // Click the `-trigger` to actually open the popover.
        this.streamSelectDropdown = page.locator('[data-test="log-search-index-list-select-stream-trigger"]');
        this.e2eAutomateStreamOption = page.locator('[data-test="log-search-index-list-select-stream-option"][data-test-value="e2e_automate"]');

        // ============================================================
        // Advanced Histogram / Timestamp locators
        // ============================================================
        this.timestampColumn = page.locator('[data-test="log-table-column-1-_timestamp"]');
        this.timestampExpandMenu = page.locator('[data-test="log-table-column-0-_timestamp"] [data-test="table-row-expand-menu"]');

        // ============================================================
        // Toast locators (used for success / error verification)
        // ============================================================
        this.toastSuccess = page.locator('[data-test-variant="success"]');

        // ============================================================
        // Per-name factory helpers (runtime-dynamic, return Locator)
        // ============================================================
        // Function row name cell by function name.
        this.getFunctionRowCellByName = (name) =>
            page.locator(`[data-test="function-list-name-cell-${name}"]`);
        // Dashboard folder tab name by folder name.
        this.getDashboardFolderTabByName = (name) =>
            page.locator(`[data-test="dashboard-folder-tab-name-${name}"]`);
        // Per-folder more-icon (walks ancestor by data-test prefix — §2 approved xpath).
        this.getDashboardFolderMoreIconByName = (name) =>
            page.locator(
                `xpath=//*[@data-test="dashboard-folder-tab-name-${name}"]/ancestor::*[starts-with(@data-test,'dashboard-folder-tab-')]//*[@data-test="dashboard-more-icon"]`,
            );
        // Stream row name cell by stream name.
        this.getStreamNameCellByName = (name) =>
            page.locator(`[data-test="log-stream-name-cell-${name}"]`);
    }

    // ================================================================
    // Quick Mode Methods
    // ================================================================
    async verifyQuickModeToggleVisible() {
        await expect(this.quickModeToggleButton).toBeVisible({ timeout: 30000 });
    }

    // ================================================================
    // Refresh Button Methods
    // ================================================================
    async clickRefreshButton() {
        const logData = require('../../../fixtures/log.json');
        const { expect } = require('@playwright/test');

        // Wait for API response
        const searchPromise = this.page.waitHelpers.waitForApiResponse(logData.applyQuery, {
            description: 'logs search query',
            timeout: 30000
        });

        // Click refresh button with proper waits
        await this.page.waitHelpers.waitForElementClickable(this.refreshButton, {
            description: 'logs search refresh button'
        });

        await this.refreshButton.click({ force: true });

        // Verify successful response
        const response = await searchPromise;
        expect(response.status()).toBe(200);
    }

    // ================================================================
    // Pagination Methods
    // ================================================================
    async displayResultTextAndPagination() {
        const searchPromise = this.page.waitForResponse(resp => resp.url().includes('/_search'), { timeout: 30000 });
        await this.refreshButton.click();
        await searchPromise;

        await expect(this.searchResultTitle).toContainText(/1 to/, { timeout: 15000 });

        try {
            await expect(this.searchResultPagination).toBeVisible({ timeout: 10000 });
        } catch (error) {
            testLogger.warn('Pagination element not found, retrying with refresh button click');
            await this.refreshButton.click();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await expect(this.searchResultPagination).toBeVisible({ timeout: 10000 });
        }
    }

    // ================================================================
    // Histogram Methods
    // ================================================================
    async clickHistogramToggle() {
        // Histogram has an inline toolbar button at normal viewport widths
        // (data-test="logs-search-bar-histogram-btn"). It moves into the
        // utilities ("More") menu only at narrow viewports (shouldMoveButtonsToMenu).
        const inlineBtn = this.page.locator('[data-test="logs-search-bar-histogram-btn"]');
        const isInline = await inlineBtn.isVisible({ timeout: 1000 }).catch(() => false);
        if (isInline) {
            await inlineBtn.click();
            return;
        }
        // Narrow-viewport fallback: open utilities menu and click the menu item.
        const menuHistogramBtn = this.page.locator('[data-test="logs-search-bar-menu-histogram-btn"]');
        const isMenuItemVisible = await menuHistogramBtn.isVisible({ timeout: 500 }).catch(() => false);
        if (!isMenuItemVisible) {
            await this.utilitiesMenuButton.click();
            await menuHistogramBtn.waitFor({ state: 'visible', timeout: 5000 });
        }
        await menuHistogramBtn.click();
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(100);
    }

    // Returns true when the histogram OSwitch is currently ON.
    // OSwitch surfaces its state via a nested `role="switch"` element carrying
    // `aria-checked="true|false"`. At normal viewport widths the histogram button
    // is inline; at narrow widths it lives inside the utilities menu.
    async isHistogramOn() {
        // Check the inline histogram button first (normal viewport).
        const inlineBtn = this.page.locator('[data-test="logs-search-bar-histogram-btn"]');
        const isInline = await inlineBtn.isVisible({ timeout: 1000 }).catch(() => false);
        if (isInline) {
            const switchControl = inlineBtn.locator('[role="switch"]');
            const aria = await switchControl.getAttribute('aria-checked');
            return aria === 'true';
        }
        // Narrow-viewport fallback: read state from the menu item OSwitch.
        const menuHistogramBtn = this.page.locator('[data-test="logs-search-bar-menu-histogram-btn"]');
        const isMenuItemVisible = await menuHistogramBtn.isVisible({ timeout: 500 }).catch(() => false);
        if (!isMenuItemVisible) {
            await this.utilitiesMenuButton.click();
            await this.histogramToggleButton.waitFor({ state: 'visible', timeout: 5000 });
        }
        const switchControl = this.histogramToggleButton.locator('[role="switch"]');
        const aria = await switchControl.getAttribute('aria-checked');
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(100);
        return aria === 'true';
    }

    // Ensure the histogram toggle is ON before tests that expect the chart to render.
    // After the UX revamp, histogram defaults to OFF when a stream is selected via the
    // index-list dropdown (only direct ?stream=... URL navigation auto-enables it), so
    // PO methods that assume the chart is visible must turn it on explicitly.
    async ensureHistogramOn() {
        if (!(await this.isHistogramOn())) {
            await this.clickHistogramToggle();
            // Re-open menu to verify the switch is now on (dropdown closed after the toggle click)
            if (!(await this.isHistogramOn())) {
                throw new Error('Failed to enable histogram toggle');
            }
        }
    }

    async toggleHistogramOffAndOn() {
        await this.clickHistogramToggle();
        await this.searchResultTitle.click();
        expect(
            await this.histogramBarChart.isVisible()
        ).toBe(false);
        await this.clickHistogramToggle();
        await expect(this.histogramBarChart).toBeVisible({ timeout: 15000 });
    }

    // ================================================================
    // SQL Mode helpers
    // ================================================================

    /**
     * Enable SQL mode. The SQL mode toggle was removed from the UI; the app now
     * auto-detects SQL mode when the query editor contains both "select" and "from".
     * This helper types a minimal SELECT query to trigger that auto-detection.
     * Callers that subsequently call MonacoEditorHelper.setContent() will overwrite
     * this query — SQL mode stays active because the replacement also contains SELECT.
     */
    async _clickSqlModeToggle() {
        await expect(this.queryEditor).toBeVisible({ timeout: 10000 });
        const monacoHelper = new MonacoEditorHelper(this.page);
        await monacoHelper.setContent(this.queryEditor, 'SELECT * FROM "e2e_automate"');
        await this.page.waitForTimeout(200);
    }

    // ================================================================
    // Query Limit Methods
    // ================================================================
    async displayLimitedResults() {
        const initialSearchPromise = this.page.waitForResponse(resp => resp.url().includes('/_search'), { timeout: 30000 });
        await this.refreshButton.click();
        await initialSearchPromise;

        await this._clickSqlModeToggle();

        await expect(this.queryEditor).toBeVisible({ timeout: 10000 });

        // Use MonacoEditorHelper to replace editor content via keyboard events.
        // .fill() on Monaco's .inputarea appends instead of replacing, producing an
        // invalid concatenated query that causes the server to abort the stream.
        const monacoHelper = new MonacoEditorHelper(this.page);
        await monacoHelper.setContent(this.queryEditor, 'SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');

        const limitSearchPromise = this.page.waitForResponse(resp => resp.url().includes('/_search'), { timeout: 30000 });
        await this.refreshButton.click({ force: true });
        await limitSearchPromise;

        await expect(this.searchResultTitle).toContainText(/1 to 5/, { timeout: 15000 });

        // Reset filters button is now directly on the toolbar
        await this.resetFiltersButton.click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // ================================================================
    // Function Methods
    // ================================================================
    async createAndDeleteFunction(functionName) {
        await this.refreshButton.click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Ensure VRL function editor pane is visible.
        // The toggle is an OSwitch inside the "More" utilities dropdown — open the menu first.
        if (!(await this.fnEditor.first().isVisible().catch(() => false))) {
            const transformEditorMenuItem = this.page.locator('[data-test="logs-search-bar-menu-transform-editor-toggle-btn"]');
            const isMenuItemVisible = await transformEditorMenuItem.isVisible({ timeout: 500 }).catch(() => false);
            if (!isMenuItemVisible) {
                await this.utilitiesMenuButton.click();
                await transformEditorMenuItem.waitFor({ state: 'visible', timeout: 5000 });
            }
            await transformEditorMenuItem.click();
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(100);
        }

        await expect(this.fnEditor.first()).toBeVisible({ timeout: 10000 });
        await this.page.waitForLoadState('domcontentloaded');
        await this.fnEditor.first().click({ force: true });

        // Type into the Monaco editor via keyboard after focusing it.
        await this.fnEditor.first().click({ force: true });
        await this.page.keyboard.type('.a=2');
        // Wait for editor content to register before save attempt.
        await expect(this.fnEditor.first()).toBeVisible();

        // Try clicking the Save button with fallback strategies
        // Note: The app uses different selectors based on whether actions are enabled:
        // - TransformSelector (actions enabled): logs-search-bar-save-transform-btn
        // - FunctionSelector (actions disabled): logs-search-bar-save-function-btn

        // First attempt: Click TransformSelector save button (actions enabled)
        try {
          testLogger.info('Attempting to click TransformSelector save button');
          await this.functionSaveButton.click({ timeout: 5000 });
          await this.savedFunctionNameInput.waitFor({ state: 'visible', timeout: 3000 });
          testLogger.info('TransformSelector save button click succeeded');
        } catch (error) {
          testLogger.warn('TransformSelector save button not found, trying FunctionSelector');

          // Second attempt: Click FunctionSelector save button (actions disabled)
          try {
            await this.functionSaveButtonNew.click({ timeout: 5000 });
            await this.savedFunctionNameInput.waitFor({ state: 'visible', timeout: 3000 });
            testLogger.info('FunctionSelector save button click succeeded');
          } catch (functionSelectorError) {
            testLogger.warn('FunctionSelector save button also failed, trying dropdown fallback');

            // Third attempt: Try alternate locator (button inside dropdown)
            try {
              await this.functionSaveButtonAlternate.click();
              await this.savedFunctionNameInput.waitFor({ state: 'visible', timeout: 3000 });
              testLogger.info('Dropdown fallback save button click succeeded');
            } catch (alternateError) {
              testLogger.error('All save button attempts failed');
              throw new Error('Failed to open function save dialog using all available locators (TransformSelector, FunctionSelector, and dropdown)');
            }
          }
        }

        // The saved-function-name-input wraps an OInput → fill the auto-generated `-field`.
        const nameField = this.savedFunctionNameInputField;
        await nameField.click();
        await nameField.fill(functionName);
        await this.savedViewDialogSave.click();
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        await openNavFlyoutChild(this.page, 'pipeline');
        await this.realtimeTab.click();
        await this.functionStreamTab.click();

        await this.functionListSearchInputField.waitFor({ state: 'visible', timeout: 10000 });
        await this.functionListSearchInputField.fill(functionName);

        // Wait for the matching row to appear before clicking delete.
        const functionRowCell = this.getFunctionRowCellByName(functionName);
        await expect(functionRowCell).toBeVisible({ timeout: 10000 });

        await this.functionListDeleteFirstBtn.click();
        await this.confirmDialogPrimary.click();
    }

    async createFunctionViaFunctionsPage() {
        // Generate unique function name with 4-digit alphanumeric suffix
        const generateSuffix = () => {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            let suffix = '';
            for (let i = 0; i < 4; i++) {
                suffix += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return suffix;
        };

        const uniqueFunctionName = `sanitytest_${generateSuffix()}`;

        await openNavFlyoutChild(this.page, 'pipeline');
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await this.streamPipelinesTab.click();
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await this.realtimeTab.click();
        await this.functionStreamTab.click();

        await this.functionListAddButton.waitFor({ state: 'visible', timeout: 10000 });
        await this.functionListAddButton.click();

        await this.addFunctionNameInputField.waitFor({ state: 'visible', timeout: 10000 });
        await this.addFunctionNameInputField.click();
        await this.addFunctionNameInputField.fill(uniqueFunctionName);

        // Drive the Monaco VRL editor via keyboard input — Monaco's setValue does not
        // always propagate through the unified-query-editor's debounced @update:query
        // pipeline (the parent's formData.function stays empty), so click → type instead.
        await this.fnEditor.first().waitFor({ state: 'visible', timeout: 15000 });
        await this.page.waitForFunction(() => {
            return typeof window !== 'undefined'
                && window.monaco
                && window.monaco.editor
                && window.monaco.editor.getEditors().length > 0;
        }, { timeout: 15000 });
        await this.page.waitForFunction(() => {
            const vrlContainer = document.querySelector('[data-test="logs-vrl-function-editor"]');
            if (!vrlContainer) return false;
            const editors = window.monaco.editor.getEditors();
            return editors.some(ed => vrlContainer.contains(ed.getDomNode()));
        }, { timeout: 15000 });
        // Drive the VRL editor via real keyboard input — this dispatches the same
        // DOM input events the user generates, which Monaco's input handler routes
        // through onDidChangeModelContent → debounced emit("update:query") in the
        // parent UnifiedQueryEditor. executeEdits writes the model directly and
        // can race the debounced emit, leaving formData.function empty at save.
        await this.fnEditor.first().click({ force: true });
        await this.page.waitForFunction(() => {
            const vrlContainer = document.querySelector('[data-test="logs-vrl-function-editor"]');
            const editors = window.monaco.editor.getEditors();
            const targetEditor = editors.find(ed => vrlContainer && vrlContainer.contains(ed.getDomNode()));
            return targetEditor && targetEditor.hasTextFocus && targetEditor.hasTextFocus();
        }, { timeout: 5000 }).catch(() => {});
        await this.page.keyboard.type('.sanity=1');
        // Wait for the editor model to actually contain the typed text.
        await this.page.waitForFunction(() => {
            const editors = window.monaco.editor.getEditors();
            const vrlContainer = document.querySelector('[data-test="logs-vrl-function-editor"]');
            const targetEditor = editors.find(ed => vrlContainer && vrlContainer.contains(ed.getDomNode())) || editors[0];
            return targetEditor && targetEditor.getValue().includes('.sanity=1');
        }, { timeout: 5000 });
        // The CodeQueryEditor debounces `update:query` by 500ms. The keyboard.type call
        // queues per-char events; the debounced emit fires 500ms after the LAST char.
        // To make this deterministic, poll the time-since-last-mutation against the
        // debounce window: wait until the editor value has been stable for >600ms.
        await this.page.waitForFunction(() => {
            const editors = window.monaco.editor.getEditors();
            const vrlContainer = document.querySelector('[data-test="logs-vrl-function-editor"]');
            const targetEditor = editors.find(ed => vrlContainer && vrlContainer.contains(ed.getDomNode())) || editors[0];
            if (!targetEditor) return false;
            // Cache initial value + timestamp on the window object for the polling helper.
            const v = targetEditor.getValue();
            const w = /** @type {any} */ (window);
            if (w.__vrlLastValue !== v) {
                w.__vrlLastValue = v;
                w.__vrlLastChangedAt = Date.now();
                return false;
            }
            return Date.now() - w.__vrlLastChangedAt > 600;
        }, { timeout: 5000 });

        // Use the specific data-test selector for the save button to avoid
        // ambiguity with other "Save" labelled buttons on the page.
        const apiResponsePromise = this.page.waitForResponse(
            resp => resp.url().includes('/api/') && resp.url().endsWith('/functions') && resp.request().method() === 'POST',
            { timeout: 30000 }
        ).catch((err) => { testLogger.info(`createFunctionViaFunctionsPage: POST never settled: ${err.message}`); return null; });
        await this.addFunctionSaveBtn.click();
        const apiResp = await apiResponsePromise;
        if (apiResp) {
            testLogger.info(`createFunctionViaFunctionsPage: POST status=${apiResp.status()}, url=${apiResp.url()}`);
            try {
                const reqBody = apiResp.request().postData();
                testLogger.info(`createFunctionViaFunctionsPage: POST body=${reqBody}`);
                const respBody = await apiResp.text();
                testLogger.info(`createFunctionViaFunctionsPage: POST resp=${respBody.substring(0, 500)}`);
            } catch (e) {
                testLogger.info(`createFunctionViaFunctionsPage: could not read body: ${e.message}`);
            }
        } else {
            testLogger.info('createFunctionViaFunctionsPage: POST not detected');
        }

        // Wait for the success toast — fired by AddFunction.onSubmit's .then() right
        // alongside emit("update:list"), which the parent FunctionList listens to in
        // order to flip showAddJSTransformDialog=false and re-render the list view.
        // The toast is the most deterministic signal that the save chain completed.
        await expect(this.toastSuccess.first()).toBeVisible({ timeout: 15000 });

        // Wait for the search input on the function list to be back in view, indicating
        // we navigated back from the AddFunction form to the list.
        await this.functionListSearchInputField.waitFor({ state: 'visible', timeout: 30000 });
        await this.functionListSearchInputField.fill(uniqueFunctionName);

        // Wait for the matching row to appear before clicking delete.
        const functionRowCell = this.getFunctionRowCellByName(uniqueFunctionName);
        await expect(functionRowCell).toBeVisible({ timeout: 10000 });

        await this.functionListDeleteFirstBtn.click();
        await this.confirmDialogPrimary.click();
        // Verify deletion via success toast (instead of legacy getByText click).
        await expect(this.toastSuccess.first()).toBeVisible({ timeout: 10000 });
    }

    // ================================================================
    // Dashboard Folder Methods
    // ================================================================
    async createAndDeleteFolder(folderName) {
        await this.dashboardsMenuItem.click();
        await this.dashboardsMenuItem.click();
        await this.page.waitForLoadState('domcontentloaded');

        await this.dashboardSearch.waitFor({ state: 'visible', timeout: 15000 });
        await this.dashboardSearch.click();
        await this.newFolderButton.click();
        await this.folderAddNameField.waitFor({ state: 'visible', timeout: 10000 });
        await this.folderAddNameField.fill(folderName);
        await this.folderAddSave.click();

        // Confirm the folder tab appears with the given name.
        const folderTabName = this.getDashboardFolderTabByName(folderName);
        await expect(folderTabName).toBeVisible({ timeout: 15000 });
        await folderTabName.click();

        await this.page.waitForLoadState('domcontentloaded');

        // Open the per-folder dropdown via its more-icon (scoped to this folder's tab).
        const folderMoreIcon = this.getDashboardFolderMoreIconByName(folderName);
        await folderMoreIcon.click();
        await this.deleteFolderIcon.click({ force: true });
        // ConfirmDialog renders an ODialog with data-test="confirm-dialog"; its primary
        // footer button surfaces as "o-dialog-primary-btn" inside the open dialog.
        // Use the generic locator to avoid timing issues with the scoped ancestor query.
        await this.openDialogPrimary.waitFor({ state: 'visible', timeout: 15000 });
        await this.openDialogPrimary.click();

        await expect(this.toastSuccess.first()).toBeVisible({ timeout: 10000 });
    }

    // ================================================================
    // Stream Methods
    // ================================================================
    async createAndDeleteStream() {
        // Generate unique stream name with 4-digit alphanumeric suffix
        const generateSuffix = () => {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            let suffix = '';
            for (let i = 0; i < 4; i++) {
                suffix += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return suffix;
        };

        const uniqueStreamName = `sanitylogstream_${generateSuffix()}`;

        await this.streamsMenuItem.click();
        await this.page.waitForLoadState('domcontentloaded');

        await this.addStreamButton.waitFor({ state: 'visible', timeout: 15000 });
        await this.addStreamButton.click();

        // The OInput inside add-stream-name-input is the native input.
        await this.streamNameInputField.waitFor({ state: 'visible', timeout: 10000 });
        await this.streamNameInputField.fill(uniqueStreamName);

        // Open stream type OSelect and pick Logs.
        await this.streamTypeDropdown.click();
        await this.streamTypeLogsOption.click();

        await this.saveStreamButton.click();
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

        // Wait for AddStream drawer to fully dismiss before interacting with the table.
        // The drawer uses a portal + closing animation; if it's still in the DOM it can
        // intercept clicks meant for table rows below it.
        await this.page.waitHelpers.waitForElementHidden('[data-test="add-stream-dialog"]', {
            timeout: 15000,
            description: 'add-stream-dialog to be dismissed'
        }).catch(() => {});

        // Extra settle to let the closing animation complete and any getLogStream() refresh
        // API call (triggered by streamAdded) finish before we interact with the table.
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Search for the newly created stream by name.
        await this.searchStreamInputField.fill(uniqueStreamName);
        await this.page.waitForLoadState('domcontentloaded');

        // Wait for the stream to appear — also confirms creation was successful.
        const streamNameCell = this.getStreamNameCellByName(uniqueStreamName);
        await expect(streamNameCell).toBeVisible({ timeout: 15000 });

        // Extra networkidle ensures the list has fully settled before we click delete.
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Give the UI a moment to fully settle after filtering — the delete button may not
        // register clicks immediately after the list re-renders from the search filter.
        await this.page.waitForTimeout(1500);

        // Click the per-row delete button.
        await this.streamDeleteFirstRowBtn.click();

        // Confirm via any visible primary dialog button (ODialog teleports content to body,
        // so scope to visible buttons to pick up the confirmation regardless of dialog wrapper).
        const confirmBtn = this.page.locator('[data-test="o-dialog-primary-btn"]:visible').first();
        await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
        await confirmBtn.click();

        // Wait for the delete to settle.
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Verify deletion via search: the stream must no longer appear in filtered results.
        await expect(streamNameCell).toBeHidden({ timeout: 15000 });
    }

    // ================================================================
    // Result Summary Methods
    // ================================================================
    async displayPaginationAfterResultSummary() {
        const searchPromise = this.page.waitForResponse(resp => resp.url().includes('/_search'), { timeout: 30000 });
        await this.refreshButton.click();
        await searchPromise;

        await expect(this.resultColumnSource).toBeVisible({ timeout: 15000 });
        await this.resultColumnSource.click();

        await expect(this.closeDialog).toBeVisible({ timeout: 10000 });
        await this.closeDialog.click();

        const paginationVisible = await this.searchResultPagination.isVisible({ timeout: 5000 }).catch(() => false);
        if (!paginationVisible) {
            await this.refreshButton.click();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            const retryVisible = await this.searchResultPagination.isVisible({ timeout: 5000 }).catch(() => false);
            if (!retryVisible) {
                throw new Error('Pagination not visible after clicking result summary and retrying run query');
            }
        }
    }

    // ================================================================
    // Settings Management Methods
    // ================================================================
    async changeSettingsSuccessfully() {
        await this.settingsMenuItem.click();
        await this.generalSettingsTab.waitFor({ state: 'visible', timeout: 15000 });
        await this.generalSettingsTab.click();
        await this.scrapeIntervalInputField.waitFor({ state: 'visible', timeout: 15000 });
        await this.scrapeIntervalInputField.fill('16');
        await this.settingsSaveButton.click();
        // Verify success toast appeared.
        await expect(this.toastSuccess.first()).toBeVisible({ timeout: 15000 });
    }

    // ================================================================
    // Stream Stats Methods
    // ================================================================
    async displayResultsOnRefreshStats() {
        await this.streamsMenuItem.click();
        await this.refreshStatsButton.click();
        await this.page.reload();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        // Click the first stream row indicator (was the "01" cell in the legacy q-table).
        await this.firstStreamRow.waitFor({ state: 'visible', timeout: 15000 });
        await this.firstStreamRow.click();
    }

    // ================================================================
    // Schema Pagination Methods
    // ================================================================
    async ingest70FieldsData() {
        testLogger.step('Ingesting 70 fields data for schema pagination test');

        const orgId = getOrgIdentifier();
        const streamName = "e2e_automate";

        // Read the 70 fields JSON data
        const fs = require('fs');
        const path = require('path');
        const data70Fields = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../../../test-data/70_fields.json'), 'utf8')
        );

        testLogger.debug(`Ingesting data with ${Object.keys(data70Fields[0]).length} fields`);

        const headers = {
            ...getAuthHeaders(),
            "Content-Type": "application/json",
        };

        const response = await fetch(
            `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
            {
                method: "POST",
                headers: headers,
                body: JSON.stringify(data70Fields),
            }
        );

        try {
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                await response.json();
                testLogger.info(`70 fields data ingestion status: ${response.status}`);
            } else {
                const textData = await response.text();
                testLogger.warn(`Ingestion response is not JSON: ${textData}`);
            }
        } catch (error) {
            testLogger.error(`Failed to parse JSON response: ${error.message}`);
            throw error;
        }

        await waitUtils.smartWait(this.page, 3000, 'data indexing after 70 fields ingestion');
        testLogger.info('70 fields data ingestion completed');
    }

    async displayPaginationForSchema() {
        testLogger.step('Testing schema pagination with 70 fields');

        // Ingest 70 fields data. Stream is already selected from beforeEach — no reload needed.
        await this.ingest70FieldsData();

        // Refresh to pick up the new schema fields in the field list
        testLogger.info('Refreshing to load field data with 70+ fields');
        await this.page.waitHelpers.waitForElementClickable(this.refreshButton, {
            description: 'refresh button for schema pagination'
        });
        await this.refreshButton.click({ timeout: 10000 });
        await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});

        // Wait for pagination to be visible (wait for the first page button as indicator)
        testLogger.debug('Waiting for schema pagination to be visible');
        await this.page.waitHelpers.waitForElementVisible(this.schemaFirstPageButton, {
            description: 'schema pagination first page button',
            timeout: 30000
        });
        testLogger.debug('Schema pagination is now visible');

        // Verify last page button is visible
        testLogger.debug('Verifying schema last page button is visible');
        await this.page.waitHelpers.waitForElementVisible(this.schemaLastPageButton, {
            description: 'schema pagination last page button'
        });
        testLogger.info('Schema last page button verified as visible');

        // Click page 2 button
        testLogger.debug('Navigating to page 2 of schema fields');
        await this.page.waitHelpers.waitForElementClickable(this.schemaPage2Button, {
            description: 'schema pagination page 2 button'
        });
        await this.schemaPage2Button.click({ timeout: 10000 });

        // Click page 3 button
        testLogger.debug('Navigating to page 3 of schema fields');
        await this.page.waitHelpers.waitForElementClickable(this.schemaPage3Button, {
            description: 'schema pagination page 3 button'
        });
        await this.schemaPage3Button.click({ timeout: 10000 });

        // Click page 4 button
        testLogger.debug('Navigating to page 4 of schema fields');
        await this.page.waitHelpers.waitForElementClickable(this.schemaPage4Button, {
            description: 'schema pagination page 4 button'
        });
        await this.schemaPage4Button.click({ timeout: 10000 });

        // Click first page button
        testLogger.debug('Navigating back to first page of schema fields');
        await this.page.waitHelpers.waitForElementClickable(this.schemaFirstPageButton, {
            description: 'schema pagination first page button'
        });
        await this.schemaFirstPageButton.click({ timeout: 10000 });

        testLogger.info('Schema pagination test completed successfully');
    }

    // ================================================================
    // Advanced Histogram Methods
    // ================================================================
    async displayPaginationWhenHistogramOffWithResult() {
        // First, ensure data is loaded by clicking the refresh button
        await expect(this.refreshButton).toBeVisible({ timeout: 15000 });
        await expect(this.refreshButton).toBeEnabled({ timeout: 10000 });

        const searchPromise = this.page.waitForResponse(resp => resp.url().includes('/_search'), { timeout: 30000 });
        await this.refreshButton.click({ timeout: 10000 });
        await searchPromise;

        // Turn off histogram (now inside utilities hamburger menu)
        await this.clickHistogramToggle();

        // Click on result column with error handling
        try {
            await expect(this.resultColumnSource).toBeVisible({ timeout: 15000 });
            await this.resultColumnSource.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Result column click failed, retrying:', error.message);
            await this.resultColumnSource.click({ timeout: 10000 });
        }

        // Close dialog with error handling
        try {
            await expect(this.closeDialog).toBeVisible({ timeout: 15000 });
            await this.closeDialog.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Close dialog click failed, retrying:', error.message);
            await this.closeDialog.click({ timeout: 10000 });
        }

        // Check if pagination is visible, if not click run query again
        const paginationVisible = await this.searchResultPagination.isVisible({ timeout: 5000 }).catch(() => false);
        if (!paginationVisible) {
            await this.refreshButton.click();
            await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
            const retryVisible = await this.searchResultPagination.isVisible({ timeout: 5000 }).catch(() => false);
            if (!retryVisible) {
                throw new Error('Pagination not visible after histogram off and retrying run query');
            }
        }
    }

    async displayPaginationWhenOnlySQLWithResult() {
        // Turn off histogram (now inside utilities hamburger menu)
        await this.clickHistogramToggle();

        // Enable SQL mode
        await this._clickSqlModeToggle();

        // Click run query button
        const sqlSearchPromise = this.page.waitForResponse(resp => resp.url().includes('/_search'), { timeout: 30000 });
        await this.refreshButton.click();
        await sqlSearchPromise;

        // Click on result column
        await expect(this.timestampColumn).toBeVisible({ timeout: 15000 });
        await this.timestampColumn.click();

        // Close dialog
        await expect(this.closeDialog).toBeVisible({ timeout: 15000 });
        await this.closeDialog.click();

        // Check if pagination is visible, if not click run query again
        const paginationVisible = await this.searchResultPagination.isVisible({ timeout: 5000 }).catch(() => false);
        if (!paginationVisible) {
            await this.refreshButton.click();
            await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
            const retryVisible = await this.searchResultPagination.isVisible({ timeout: 5000 }).catch(() => false);
            if (!retryVisible) {
                throw new Error('Pagination not visible after SQL mode on and retrying run query');
            }
        }
    }

    async displayHistogramInSQLMode() {
        // First, ensure data is loaded by clicking the refresh button
        await expect(this.refreshButton).toBeVisible({ timeout: 15000 });
        await expect(this.refreshButton).toBeEnabled({ timeout: 10000 });

        // After the UX revamp, histogram defaults to OFF when a stream is selected via the
        // index-list dropdown (selectStream flow). The chart canvas only mounts when the
        // OSwitch is ON, so flip it before triggering the search so the histogram payload is
        // requested as part of the run-query call.
        await this.ensureHistogramOn();

        try {
            await this.refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
        } catch (error) {
            console.warn('Initial refresh button click failed, retrying:', error.message);
            await this.refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
        }

        // Wait for canvas to be ready and visible (should now be there after data load)
        await expect(this.histogramCanvas).toBeVisible({ timeout: 15000 });
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // First canvas click with error handling
        try {
            await this.histogramCanvas.click({
                position: { x: 182, y: 66 },
                timeout: 10000
            });
        } catch (error) {
            console.warn('First canvas click failed, retrying after wait:', error.message);
            await this.histogramCanvas.click({
                position: { x: 182, y: 66 },
                timeout: 10000
            });
        }

        // Enable SQL mode with error handling
        try {
            await this._clickSqlModeToggle();
        } catch (error) {
            console.warn('SQL mode switch failed, retrying:', error.message);
            await this._clickSqlModeToggle();
        }

        // Click refresh button with waits
        await expect(this.refreshButton).toBeVisible({ timeout: 15000 });
        await expect(this.refreshButton).toBeEnabled({ timeout: 10000 });

        try {
            await this.refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
        } catch (error) {
            console.warn('Refresh button click failed, retrying:', error.message);
            await this.refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
        }

        // Wait for canvas to be ready again after refresh
        await expect(this.histogramCanvas).toBeVisible({ timeout: 15000 });

        // Second canvas click with error handling
        try {
            await this.histogramCanvas.click({
                position: { x: 182, y: 66 },
                timeout: 10000
            });
        } catch (error) {
            console.warn('Second canvas click failed, continuing anyway:', error.message);
        }
    }

    async displayResultsWhenSQLHistogramOnWithStreamSelection() {

        // Navigate to home first
        await expect(this.homeMenuItem).toBeVisible({ timeout: 15000 });

        await this.homeMenuItem.click();
        await this.page.waitForLoadState('domcontentloaded');

        // Use proper logs navigation that includes VRL editor
        const currentUrl = new URL(this.page.url());
        const orgId = currentUrl.searchParams.get('org_identifier') || 'default';
        const logsUrl = `/web/logs?org_identifier=${orgId}&fn_editor=true`;

        await this.page.goto(logsUrl);
        await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

        // Select the e2e_automate stream before proceeding via the OSelect option.
        try {
            await this.streamSelectDropdown.waitFor({ timeout: 10000 });
            await this.streamSelectDropdown.click();
            await this.e2eAutomateStreamOption.first().click({ timeout: 5000 });
        } catch (error) {
            // Stream may already be selected from beforeEach; proceed.
        }

        // Wait for stream selection to complete
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Check if VRL editor is visible, if not click the toggle
        const isFnEditorVisible = await this.fnEditor.first().isVisible();

        if (!isFnEditorVisible) {
            // Toggle is inside the "More" utilities dropdown — open menu first.
            const transformEditorMenuItem = this.page.locator('[data-test="logs-search-bar-menu-transform-editor-toggle-btn"]');
            const isMenuItemVisible = await transformEditorMenuItem.isVisible({ timeout: 500 }).catch(() => false);
            if (!isMenuItemVisible) {
                await this.utilitiesMenuButton.click();
                await transformEditorMenuItem.waitFor({ state: 'visible', timeout: 5000 });
            }
            await transformEditorMenuItem.click();
            await this.page.keyboard.press('Escape');

            // Wait for VRL editor to appear after toggle
            await expect(this.fnEditor.first()).toBeVisible({ timeout: 15000 });
        }

        // Verify VRL editor is now available
        const fnEditorCount = await this.fnEditor.count();
        if (fnEditorCount === 0) {
            throw new Error('SQL+Histogram test: VRL editor not found after toggle');
        }

        // Enable SQL mode with error handling
        try {
            await this._clickSqlModeToggle();
        } catch (error) {
            console.warn('SQL mode switch click failed, retrying:', error.message);
            await this._clickSqlModeToggle();
        }

        // Wait for query editor to be ready, then drive content via MonacoEditorHelper.
        await expect(this.queryEditor).toBeVisible({ timeout: 15000 });
        const monacoHelper = new MonacoEditorHelper(this.page);
        await monacoHelper.setContent(this.queryEditor, 'SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
        await this.page.waitForLoadState('domcontentloaded');

        // Click refresh button with robust waits
        await expect(this.refreshButton).toBeVisible({ timeout: 15000 });
        await expect(this.refreshButton).toBeEnabled({ timeout: 10000 });

        try {
            await this.refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
        } catch (error) {
            console.warn('Refresh button click failed, retrying:', error.message);
            await this.refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
        }

        // Wait for search results to load before looking for timestamp menu
        await expect(this.searchResultLogsTable).toBeVisible({ timeout: 20000 });

        // Click timestamp expand menu with error handling
        await expect(this.timestampExpandMenu).toBeVisible({ timeout: 15000 });

        try {
            await this.timestampExpandMenu.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Timestamp expand menu click failed, retrying:', error.message);
            await this.timestampExpandMenu.click({ timeout: 10000 });
        }
    }
}

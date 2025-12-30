import { expect } from '@playwright/test';
const { waitUtils } = require('../../playwright-tests/utils/wait-helpers.js');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SanityPage {
    constructor(page) {
        this.page = page;
        
        // Quick Mode locators
        this.quickModeToggleButton = '[data-test="logs-search-bar-quick-mode-toggle-btn"]';
        this.quickModeToggleInner = '[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner';
        
        // Fields and Query Editor locators
        this.allFieldsButton = '[data-test="logs-all-fields-btn"]';
        this.fieldSearchInput = '[data-cy="index-field-search-input"]';
        this.interestingJobFieldButton = '[data-test="log-search-index-list-interesting-job-field-btn"]';
        this.sqlModeSwitch = { role: 'switch', name: 'SQL Mode' };
        this.queryEditor = '[data-test="logs-search-bar-query-editor"]';
        this.queryEditorContent = '[data-test="logs-search-bar-query-editor"]';
        
        // Search and Refresh locators
        this.refreshButton = '[data-test="logs-search-bar-refresh-btn"]';
        this.resetFiltersButton = '[data-test="logs-search-bar-reset-filters-btn"]';
        
        // Pagination and Results locators
        this.resultColumnSource = '[data-test="log-table-column-0-source"]';
        this.closeDialog = '[data-test="close-dialog"]';
        
        // Histogram locators
        this.histogramToggleButton = '[data-test="logs-search-bar-show-histogram-toggle-btn"]';
        this.histogramToggleDiv = '[data-test="logs-search-bar-show-histogram-toggle-btn"] div';
        
        // Saved Search locators
        this.saveSearchButton = 'button';
        this.alertNameInput = '[data-test="add-alert-name-input"]';
        this.savedViewDialogSave = '[data-test="saved-view-dialog-save-btn"]';
        this.savedViewsButton = '[data-test="logs-search-saved-views-btn"]';
        this.savedViewSearchInput = '[data-test="log-search-saved-view-field-search-input"]';
        this.confirmButton = '[data-test="confirm-button"]';
        
        // Function locators
        this.functionDropdown = '[data-test="logs-search-bar-function-dropdown"]';
        this.functionSaveButton = '[data-test="logs-search-bar-save-transform-btn"]';
        this.functionSaveButtonAlternate = '[data-test="logs-search-bar-function-dropdown"]';
        this.fnEditor = '#fnEditor';
        this.savedFunctionNameInput = '[data-test="saved-function-name-input"]';
        
        // Menu Navigation locators
        this.pipelineMenuItem = '[data-test="menu-link-\\/pipeline-item"]';
        this.realtimeTab = '[data-test="tab-realtime"]';
        this.streamPipelinesTab = '[data-test="stream-pipelines-tab"]';
        this.functionStreamTab = '[data-test="function-stream-tab"]';
        this.dashboardsMenuItem = '[data-test="menu-link-\\/dashboards-item"]';
        this.streamsMenuItem = '[data-test="menu-link-\\/streams-item"]';
        
        // Dashboard Folder locators
        this.dashboardSearch = '[data-test="dashboard-search"]';
        this.newFolderButton = '[data-test="dashboard-new-folder-btn"]';
        this.folderAddName = '[data-test="dashboard-folder-add-name"]';
        this.folderAddSave = '[data-test="dashboard-folder-add-save"]';
        this.dashboardMoreIcon = '[data-test="dashboard-more-icon"]';
        this.deleteFolderIcon = '[data-test="dashboard-delete-folder-icon"]';
        
        // Stream locators
        this.addStreamButton = '[data-test="log-stream-add-stream-btn"]';
        this.streamNameInput = 'label:has-text("Name *") + input, input[aria-label="Name *"], [data-test="add-stream-name-input"]';
        this.streamTypeDropdown = '[data-test="add-stream-type-input"]';
        this.saveStreamButton = '[data-test="save-stream-btn"]';
        this.searchStreamInput = '[placeholder="Search Stream"]';
        this.deleteButton = { role: 'button', name: 'Delete' };
        
        // VRL Function Editor locators
        this.vrlFunctionEditor = '[data-test="logs-vrl-function-editor"]';
        this.vrlEditorContent = '[data-test="logs-vrl-function-editor"] .inputarea';
        
        // Generic locators
        this.searchFunctionInput = '[placeholder="Search Function"]';
        this.createNewFunctionButton = { role: 'button', name: 'New function' };
        this.nameLabel = { label: 'Name' };
        this.saveButton = { role: 'button', name: 'Save' };
        
        // Settings locators (sanity2 specific)
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.generalSettingsTab = { role: 'tab', name: 'General Settings' };
        this.scrapeIntervalInput = '[data-test="general-settings-scrape-interval"]';
        this.dashboardSubmitButton = '[data-test="dashboard-add-submit"]';
        
        // Stream Stats locators (sanity2 specific)
        this.refreshStatsButton = '[data-test="log-stream-refresh-stats-btn"]';
        this.streamCellButton = { role: 'cell', name: '01' };
        
        // Schema Pagination locators (sanity2 specific)
        this.schemaLastPageButton = '[data-test="logs-page-fields-list-pagination-lastpage-button"]';
        this.schemaFirstPageButton = '[data-test="logs-page-fields-list-pagination-firstpage-button"]';
        this.schemaPage2Button = '[data-test="logs-page-fields-list-pagination-page-2-button"]';
        this.schemaPage3Button = '[data-test="logs-page-fields-list-pagination-page-3-button"]';
        this.schemaPage4Button = '[data-test="logs-page-fields-list-pagination-page-4-button"]';
        this.schemaPaginationText = 'fast_rewind12fast_forward';
        this.streamSelectDropdown = '[data-test="log-search-index-list-select-stream"]';
        this.fieldsListContainer = '[data-test="log-search-index-list"]';
        
        // Advanced Histogram locators (sanity2 specific)
        this.histogramCanvas = '[data-test="logs-search-result-bar-chart"] canvas';
        this.timestampColumn = '[data-test="log-table-column-1-_timestamp"]';
        this.timestampExpandMenu = '[data-test="log-table-column-0-_timestamp"] [data-test="table-row-expand-menu"]';
    }

    // Quick Mode Methods
    async verifyQuickModeToggleVisible() {
        await expect(this.page.locator(this.quickModeToggleButton)).toBeVisible({ timeout: 30000 });
    }

    async clickInterestingFieldsAndDisplayQuery() {
        // Get the toggle button element
        const toggleButton = this.page.locator(this.quickModeToggleInner);
        await expect(toggleButton).toBeVisible({ timeout: 10000 });

        // Check if toggle is off and click if needed
        const isSwitchedOff = await toggleButton.evaluate((node) =>
            node.classList.contains("q-toggle__inner--falsy")
        );

        if (isSwitchedOff) {
            await toggleButton.click();
        }

        await this.page.locator(this.allFieldsButton).click();
        
        const fieldSearchInput = this.page.locator(this.fieldSearchInput);
        await expect(fieldSearchInput).toBeVisible({ timeout: 10000 });
        await fieldSearchInput.fill("job");
        
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.locator(this.interestingJobFieldButton).first().click();
        await this.page.getByRole(this.sqlModeSwitch.role, { name: this.sqlModeSwitch.name }).locator('div').nth(2).click();
        
        await expect(
            this.page.locator(this.queryEditor).getByText(/job/).first()
        ).toBeVisible({ timeout: 10000 });
    }

    // Refresh Button Methods  
    async clickRefreshButton() {
        const logData = require('../../../fixtures/log.json');
        const { expect } = require('@playwright/test');
        
        // Wait for API response
        const searchPromise = this.page.waitHelpers.waitForApiResponse(logData.applyQuery, {
            description: 'logs search query',
            timeout: 30000
        });
        
        // Click refresh button with proper waits
        const refreshButton = this.page.locator(this.refreshButton);
        await this.page.waitHelpers.waitForElementClickable(refreshButton, {
            description: 'logs search refresh button'
        });
        
        await refreshButton.click({ force: true });
        
        // Verify successful response
        const response = await searchPromise;
        expect(response.status()).toBe(200);
    }

    // Pagination Methods
    async displayResultTextAndPagination() {
        await this.page.locator(this.refreshButton).click();
        await this.page.waitForLoadState('networkidle');

        await expect(this.page.getByText("Showing 1 to 50")).toBeVisible({ timeout: 15000 });
        await this.page.waitForTimeout(1000);

        try {
            await expect(this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down")).toBeVisible({ timeout: 10000 });
        } catch (error) {
            testLogger.warn('Pagination element not found, retrying with refresh button click');
            await this.page.locator(this.refreshButton).click();
            await this.page.waitForLoadState('networkidle');
            await expect(this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down")).toBeVisible({ timeout: 10000 });
        }
    }

    // Histogram Methods
    async toggleHistogramOffAndOn() {
        await this.page.locator(this.histogramToggleButton).click();
        await this.page.getByText("Showing 1").click();
        expect(
            await this.page.locator('[data-test="logs-search-result-bar-chart"]').isVisible()
        ).toBe(false);
        await this.page.locator(this.histogramToggleDiv).nth(2).click();
        await this.page.waitForTimeout(2000);
        await expect(this.page.getByRole('heading', { name: 'No data found for histogram.' })).toBeVisible();
    }

    // Saved Search Methods
    async createAndDeleteSavedSearch(savedViewName) {
        await this.page.locator(this.saveSearchButton).filter({ hasText: "savesaved_search" }).click();
        
        await this.page.locator(this.alertNameInput).click();
        await this.page.locator(this.alertNameInput).fill(savedViewName);
        
        await this.page.locator(this.savedViewDialogSave).click();
        
        await this.page.locator(this.savedViewsButton).getByLabel("Expand").click();
        
        await this.page.locator(this.savedViewSearchInput).click();
        await this.page.locator(this.savedViewSearchInput).fill(savedViewName);
        
        await this.page.getByText(savedViewName).first().click();
        
        await this.page.locator(this.savedViewsButton).getByLabel("Expand").click();
        await this.page.locator(this.savedViewSearchInput).click();
        await this.page.locator(this.savedViewSearchInput).fill(savedViewName);
        await this.page.getByText("favorite_border").first().click();
        
        await this.page.getByText("Favorite Views").click();
        await this.page.getByLabel('Clear').first().click();
        await this.page.getByLabel("Collapse").click();
        
        await this.page.locator(this.savedViewsButton).getByLabel("Expand").click();
        await this.page.locator('[data-test="log-search-saved-view-favorite-list-fields-table"] div').filter({ hasText: "Favorite Views" }).nth(1).click();
        
        await this.page.locator(this.savedViewSearchInput).click();
        await this.page.locator(this.savedViewSearchInput).fill(savedViewName);
        
        const deleteButton = this.page.locator(`[data-test="logs-search-bar-delete-${savedViewName}-saved-view-btn"]`);
        
        try {
            await this.page.waitForLoadState('domcontentloaded');
            await deleteButton.click({ timeout: 15000 });
        } catch (error) {
            try {
                await deleteButton.click({ force: true, timeout: 10000 });
            } catch (forceError) {
                const box = await deleteButton.boundingBox();
                if (box) {
                    await this.page.mouse.click(box.x + box.width/2, box.y + box.height/2);
                } else {
                    throw forceError;
                }
            }
        }
        
        await this.page.waitForLoadState('domcontentloaded');
        await waitUtils.smartWait(this.page, 2000, 'Dialog stabilization');
        
        const confirmButton = this.page.locator(this.confirmButton);
        
        await expect(confirmButton).toBeVisible({ timeout: 10000 });
        await expect(confirmButton).toBeEnabled({ timeout: 5000 });
        await this.page.waitForLoadState('domcontentloaded');
        
        try {
            await confirmButton.click({ timeout: 15000 });
        } catch (normalError) {
            try {
                await confirmButton.click({ force: true, timeout: 10000 });
            } catch (forceError) {
                const box = await confirmButton.boundingBox();
                if (box) {
                    await this.page.mouse.click(box.x + box.width/2, box.y + box.height/2);
                } else {
                    throw forceError;
                }
            }
        }
    }

    // Query Limit Methods
    async displayLimitedResults() {
        await this.page.locator(this.refreshButton).click();
        await this.page.waitForLoadState('networkidle');
        
        await this.page.getByRole(this.sqlModeSwitch.role, { name: this.sqlModeSwitch.name }).locator('div').nth(2).click();
        
        const queryEditor = this.page.locator(this.queryEditorContent);
        await expect(queryEditor).toBeVisible({ timeout: 10000 });
        
        await queryEditor.locator('.monaco-editor').click();
        await queryEditor.locator('.inputarea').fill('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
        
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.locator(this.refreshButton).click({ force: true });
        
        await expect(this.page.getByText(/Showing 1 to 5/)).toBeVisible({ timeout: 15000 });
        
        await this.page.locator(this.resetFiltersButton).click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    // Function Methods
    async createAndDeleteFunction(functionName) {
        await this.page.locator(this.refreshButton).click();
        await this.page.waitForLoadState('networkidle');
        
        const fnEditor = this.page.locator(this.fnEditor);

        // Check if VRL editor is visible, if not try to enable it via toggle
        if (await fnEditor.count() === 0) {
            const vrlToggle = this.page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');

            if (await vrlToggle.count() > 0 && await vrlToggle.isVisible()) {
                await vrlToggle.locator('div').nth(2).click({ force: true });
                await this.page.waitForTimeout(1000);
                await this.page.waitForLoadState('domcontentloaded');
            }
        }

        const fnEditorTextbox = this.page.locator(this.fnEditor).locator('.monaco-editor');

        try {
            await expect(fnEditorTextbox).toBeVisible({ timeout: 5000 });
            await this.page.waitForLoadState('domcontentloaded');
            await fnEditorTextbox.click({ force: true });
        } catch (error) {
            // Monaco editor not visible, try clicking toggle button
            testLogger.warn('Monaco editor not visible, trying toggle button');
            const vrlToggle = this.page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
            if (await vrlToggle.count() > 0) {
                await vrlToggle.locator('div').nth(1).click({ force: true });
                await this.page.waitForTimeout(1000);

                // Retry clicking monaco editor
                await expect(fnEditorTextbox).toBeVisible({ timeout: 10000 });
                await fnEditorTextbox.click({ force: true });
            } else {
                // Fallback to any monaco editor
                const cmContent = this.page.locator('.monaco-editor').first();
                if (await cmContent.count() > 0) {
                    await cmContent.click({ force: true });
                } else {
                    throw error;
                }
            }
        }
        
        await this.page.locator(this.fnEditor).locator(".inputarea").fill(".a=2");
        await waitUtils.smartWait(this.page, 1000, 'VRL editor content stabilization');

        // Wait for 3 seconds before attempting to click save button
        await this.page.waitForTimeout(3000);

        // Try clicking the Save button with fallback strategies
        let saveDialogVisible = false;

        // First attempt: Click primary save button
        try {
          testLogger.info('Attempting to click primary function save button');
          await this.page.locator(this.functionSaveButton).click({ timeout: 10000 });
          await this.page.locator(this.savedFunctionNameInput).waitFor({ state: 'visible', timeout: 3000 });
          saveDialogVisible = true;
          testLogger.info('Primary save button click succeeded');
        } catch (error) {
          testLogger.warn('Primary save button click failed, trying alternate locator');

          // Second attempt: Try alternate locator (button inside dropdown)
          try {
            await this.page.locator(this.functionSaveButtonAlternate).getByRole('button').filter({ hasText: 'save' }).click();
            await this.page.locator(this.savedFunctionNameInput).waitFor({ state: 'visible', timeout: 3000 });
            saveDialogVisible = true;
            testLogger.info('Alternate save button click succeeded');
          } catch (alternateError) {
            testLogger.error('Both save button attempts failed');
            throw new Error('Failed to open function save dialog using primary and alternate locators');
          }
        }
        
        await this.page.locator(this.savedFunctionNameInput).click();
        await this.page.locator(this.savedFunctionNameInput).fill(functionName);
        await this.page.locator(this.savedViewDialogSave).click();
        await this.page.waitForLoadState('networkidle', { timeout: 5000 });
        
        await this.page.locator(this.pipelineMenuItem).click();
        await this.page.locator(this.realtimeTab).click();
        await this.page.locator(this.functionStreamTab).click();
        
        await this.page.getByPlaceholder("Search Function").click();
        await this.page.getByPlaceholder("Search Function").fill(functionName);
        await this.page.getByRole("button", { name: "Delete Function" }).click();
        await this.page.locator(this.confirmButton).click();
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

        await this.page.locator(this.pipelineMenuItem).click();
        await this.page.waitForLoadState('networkidle', { timeout: 5000 });
        await this.page.waitForTimeout(500);
        await this.page.locator(this.streamPipelinesTab).click();
        await this.page.waitForLoadState('networkidle', { timeout: 5000 });
        await this.page.waitForTimeout(500);
        await this.page.locator(this.realtimeTab).click();
        await this.page.waitForTimeout(500);
        await this.page.locator(this.functionStreamTab).click();
        await this.page.waitForTimeout(500);

        await this.page.getByRole(this.createNewFunctionButton.role, { name: this.createNewFunctionButton.name }).click();
        await this.page.getByLabel(this.nameLabel.label).click();
        await this.page.getByLabel(this.nameLabel.label).fill(uniqueFunctionName);
        
        await this.page.locator(this.vrlFunctionEditor).click();
        await this.page.locator(this.vrlEditorContent).fill("sanity=1");
        await this.page.locator(this.vrlFunctionEditor).getByText("sanity=").click();
        await this.page.locator(this.vrlEditorContent).press("ArrowLeft");
        await this.page.locator(this.vrlEditorContent).press("ArrowLeft");
        await this.page.locator(this.vrlEditorContent).press("ArrowLeft");
        await this.page.locator(this.vrlEditorContent).press("ArrowLeft");
        await this.page.locator(this.vrlEditorContent).fill(".sanity=1");
        
        await this.page.getByRole(this.saveButton.role, { name: this.saveButton.name }).click();

        await this.page.getByPlaceholder("Search Function").click();
        await this.page.getByPlaceholder("Search Function").fill(uniqueFunctionName);
        await this.page.getByRole("button", { name: "Delete Function" }).click();
        await this.page.locator(this.confirmButton).click();
        await this.page.getByText("Function deleted").click();
    }

    // Dashboard Folder Methods
    async createAndDeleteFolder(folderName) {
        await this.page.locator(this.dashboardsMenuItem).click();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(2000);

        await this.page.locator(this.dashboardSearch).click();
        await this.page.locator(this.newFolderButton).click();
        await this.page.waitForTimeout(2000);
        await this.page.locator(this.folderAddName).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForTimeout(1000);
        await this.page.locator(this.folderAddName).fill(folderName);
        await this.page.waitForTimeout(1000);
        await this.page.locator(this.folderAddSave).click();
        await this.page.waitForTimeout(2000);

        await expect(this.page.getByText(folderName)).toBeVisible({ timeout: 10000 });
        await this.page.getByText(folderName).click();
        await this.page.waitForTimeout(2000);

        await this.page.waitForLoadState('domcontentloaded');
        
        await this.page.locator(`[data-test^="dashboard-folder-tab"]:has-text("${folderName}") [data-test="dashboard-more-icon"]`).click();
        await this.page.locator(this.deleteFolderIcon).click({ force: true });
        await this.page.waitForTimeout(2000);
        await this.page.locator(this.confirmButton).click();

        await expect(this.page.getByText("Folder deleted successfully")).toBeVisible({ timeout: 10000 });
    }

    // Stream Methods
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
        
        await this.page.locator(this.streamsMenuItem).click();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(2000);

        await this.page.locator(this.addStreamButton).click();
        await this.page.waitForTimeout(2000);
        await this.page.getByLabel("Name *").waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForTimeout(2000);
        await this.page.getByLabel("Name *").fill(uniqueStreamName);
        
        await this.page.locator(this.streamTypeDropdown).getByText("arrow_drop_down").click();
        await this.page.getByRole("option", { name: "Logs" }).click();
        
        await this.page.locator(this.saveStreamButton).click();
        await this.page.waitForLoadState('networkidle');
        
        // Handle success notification dismissal (text might vary or auto-dismiss)
        const successMessages = [
            "Stream created successfully",
            "Stream created",
            "Success"
        ];
        
        for (const message of successMessages) {
            try {
                await this.page.getByText(message).click({ timeout: 3000 });
                break;
            } catch {
                // Continue to next message variant
            }
        }
        
        // Ensure any lingering dialogs are dismissed
        await this.page.waitHelpers.waitForElementHidden('.q-dialog', {
            timeout: 5000,
            description: 'success dialog to be dismissed'
        }).catch(() => {
            // No dialog present, continue
        });
        
        await this.page.waitForLoadState('domcontentloaded');
        
        const isBackOnStreamsList = await this.page.locator(this.addStreamButton).isVisible({ timeout: 10000 });
        if (isBackOnStreamsList) {
            // Stream creation successful
        } else {
            // Check for error notifications
            const notifications = this.page.locator('.q-notification__message');
            const notificationCount = await notifications.count();
            if (notificationCount > 0) {
                for (let i = 0; i < notificationCount; i++) {
                    const text = await notifications.nth(i).textContent();
                    console.warn(`Error notification: ${text}`);
                }
            }
        }
        
        // Navigate to streams page if needed
        if (!isBackOnStreamsList) {
            await this.page.locator(this.streamsMenuItem).click();
            await this.page.waitForLoadState('domcontentloaded');
        }
        
        await this.page.getByPlaceholder("Search Stream").fill(uniqueStreamName);
        await this.page.waitForLoadState('domcontentloaded');
        
        // Wait for search to yield results - wait for the specific stream to appear in results
        await expect(this.page.getByText(uniqueStreamName)).toBeVisible({ timeout: 10000 });
        
        // Use framework's proper wait helpers to ensure no dialogs interfere
        await this.page.waitHelpers.waitForElementHidden('.q-dialog__backdrop', {
            timeout: 5000,
            description: 'dialog backdrop to be dismissed'
        }).catch(() => {
            // No backdrop present, continue
        });
        
        // Wait for search results to load using proper wait
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        // Click delete button for the specific stream using first() to handle search results
        await this.page.getByRole("button", { name: "Delete" }).first().click();
        await this.page.waitForTimeout(2000);
        
        // Wait for and click confirmation dialog button - try different variations
        const confirmButtonVariants = ["Ok", "OK", "Delete", "Confirm", "Yes"];
        let confirmClicked = false;
        
        for (const buttonText of confirmButtonVariants) {
            try {
                await expect(this.page.getByRole("button", { name: buttonText })).toBeVisible({ timeout: 3000 });
                await this.page.getByRole("button", { name: buttonText }).click();
                confirmClicked = true;
                break;
            } catch {
                // Try next button variant
            }
        }
        
        if (!confirmClicked) {
            throw new Error('No confirmation dialog button found with variants: ' + confirmButtonVariants.join(', '));
        }

        await this.page.waitForLoadState('networkidle');

        // Verify stream was deleted - search should return no results
        await this.page.getByPlaceholder("Search Stream").clear();
        await this.page.getByPlaceholder("Search Stream").fill(uniqueStreamName);
        await this.page.waitForTimeout(1000);

        const streamStillExists = await this.page.getByText(uniqueStreamName).isVisible({ timeout: 3000 }).catch(() => false);
        if (streamStillExists) {
            throw new Error(`Stream ${uniqueStreamName} was not deleted successfully`);
        }
    }

    // Result Summary Methods
    async displayPaginationAfterResultSummary() {
        await this.page.locator(this.refreshButton).click();
        await this.page.waitForLoadState('networkidle');
        
        await expect(this.page.locator(this.resultColumnSource)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.resultColumnSource).click();
        
        await expect(this.page.locator(this.closeDialog)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.closeDialog).click();
        await this.page.waitForTimeout(2000);

        const paginationVisible = await this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down").isVisible({ timeout: 5000 }).catch(() => false);
        if (!paginationVisible) {
            await this.page.locator(this.refreshButton).click();
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            const retryVisible = await this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down").isVisible({ timeout: 5000 }).catch(() => false);
            if (!retryVisible) {
                throw new Error('Pagination not visible after clicking result summary and retrying run query');
            }
        }
    }

    // Sanity2-Specific Methods

    // Settings Management Methods
    async changeSettingsSuccessfully() {
        await waitUtils.smartWait(this.page, 2000, 'pre-settings navigation wait');
        await this.page.locator(this.settingsMenuItem).click();
        await waitUtils.smartWait(this.page, 2000, 'settings page load');
        await this.page.getByRole(this.generalSettingsTab.role, { name: this.generalSettingsTab.name }).click();
        await this.page.locator(this.scrapeIntervalInput).fill("16");
        await this.page.locator(this.dashboardSubmitButton).click();
        await this.page.getByText("Organization settings updated").click();
    }

    // Stream Stats Methods
    async displayResultsOnRefreshStats() {
        await this.page.locator(this.streamsMenuItem).click();
        await this.page.locator(this.refreshStatsButton).click();
        await this.page.reload();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle');
        await this.page.getByRole(this.streamCellButton.role, { name: this.streamCellButton.name, exact: true }).click();
    }

    // Schema Pagination Methods
    async ingest70FieldsData() {
        testLogger.step('Ingesting 70 fields data for schema pagination test');

        const orgId = process.env["ORGNAME"];
        const streamName = "e2e_automate";
        const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');

        // Read the 70 fields JSON data
        const fs = require('fs');
        const path = require('path');
        const data70Fields = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../../../test-data/70_fields.json'), 'utf8')
        );

        testLogger.debug(`Ingesting data with ${Object.keys(data70Fields[0]).length} fields`);

        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        const fetchResponse = await fetch(
            `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
            {
                method: "POST",
                headers: headers,
                body: JSON.stringify(data70Fields),
            }
        );

        try {
            const response = await fetchResponse;
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const jsonData = await response.json();
                testLogger.info(`70 fields data ingestion status: ${response.status}`);
            } else {
                const textData = await response.text();
                testLogger.warn(`Ingestion response is not JSON: ${textData}`);
            }
        } catch (error) {
            testLogger.error(`Failed to parse JSON response: ${error.message}`);
            throw error;
        }

        // Wait for data to be indexed using smart wait
        await waitUtils.smartWait(this.page, 3000, 'data indexing after 70 fields ingestion');
        testLogger.info('70 fields data ingestion completed');
    }

    async displayPaginationForSchema() {
        testLogger.step('Testing schema pagination with 70 fields');

        // Ingest 70 fields data first to ensure pagination is available
        await this.ingest70FieldsData();

        // Reload the page to load the new data
        testLogger.debug('Reloading page to refresh schema');
        await this.page.reload();
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle');

        // Select stream again after reload using the search-and-filter approach
        testLogger.debug('Selecting e2e_automate stream after reload');
        const streamSelectInput = this.page.locator(this.streamSelectDropdown);
        await this.page.waitHelpers.waitForElementVisible(streamSelectInput, {
            description: 'stream select input after reload',
            timeout: 15000
        });

        // Click the input to open/focus the dropdown
        await streamSelectInput.click();
        // Wait for any stream toggle to appear (indicates dropdown has opened and populated)
        // Using data-test attribute with starts-with selector for robustness
        await this.page.waitForSelector('[data-test^="log-search-index-list-stream-toggle-"]', { state: 'visible', timeout: 10000 });

        // Fill the input to filter streams - this is critical for finding the stream quickly
        await streamSelectInput.fill('e2e_automate');

        // Wait for the specific stream toggle to become visible after filtering (condition-based wait)
        const streamToggleSelector = '[data-test="log-search-index-list-stream-toggle-e2e_automate"]';
        try {
            await this.page.waitForSelector(`${streamToggleSelector} div`, { state: 'visible', timeout: 10000 });
            await this.page.locator(`${streamToggleSelector} div`).first().click();
            testLogger.info('Stream e2e_automate selected successfully via toggle');
        } catch (error) {
            testLogger.warn(`First stream selection method failed: ${error.message}, trying alternate approaches`);
            // Try clicking the toggle itself
            try {
                await this.page.locator(streamToggleSelector).click({ timeout: 5000 });
                testLogger.info('Stream selected via toggle element');
            } catch (toggleError) {
                // Last resort: try by text
                try {
                    await this.page.getByText('e2e_automate', { exact: true }).first().click({ timeout: 5000 });
                    testLogger.info('Stream selected via text');
                } catch (textError) {
                    testLogger.error(`Stream selection failed after reload: ${textError.message}`);
                    throw new Error('Failed to select e2e_automate stream - pagination test cannot proceed');
                }
            }
        }

        // Clear the filter input to prevent state persistence issues for subsequent operations
        await streamSelectInput.clear();

        // Wait for stream selection to complete
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });

        // Ensure data is loaded by clicking the refresh button
        testLogger.debug('Refreshing to load data with 70 fields');
        const refreshButton = this.page.locator(this.refreshButton);
        await this.page.waitHelpers.waitForElementClickable(refreshButton, {
            description: 'refresh button for schema pagination'
        });

        await refreshButton.click({ timeout: 10000 });
        await this.page.waitForLoadState('networkidle', { timeout: 25000 });

        // Wait for pagination to be visible (wait for the first page button as indicator)
        testLogger.debug('Waiting for schema pagination to be visible');
        const firstPageBtn = this.page.locator(this.schemaFirstPageButton);
        await this.page.waitHelpers.waitForElementVisible(firstPageBtn, {
            description: 'schema pagination first page button',
            timeout: 30000
        });
        testLogger.debug('Schema pagination is now visible');

        // Verify last page button is visible
        testLogger.debug('Verifying schema last page button is visible');
        const lastPageButton = this.page.locator(this.schemaLastPageButton);
        await this.page.waitHelpers.waitForElementVisible(lastPageButton, {
            description: 'schema pagination last page button'
        });
        testLogger.info('Schema last page button verified as visible');

        // Click page 2 button
        testLogger.debug('Navigating to page 2 of schema fields');
        const page2Button = this.page.locator(this.schemaPage2Button);
        await this.page.waitHelpers.waitForElementClickable(page2Button, {
            description: 'schema pagination page 2 button'
        });
        await page2Button.click({ timeout: 10000 });

        // Click page 3 button
        testLogger.debug('Navigating to page 3 of schema fields');
        const page3Button = this.page.locator(this.schemaPage3Button);
        await this.page.waitHelpers.waitForElementClickable(page3Button, {
            description: 'schema pagination page 3 button'
        });
        await page3Button.click({ timeout: 10000 });

        // Click page 4 button
        testLogger.debug('Navigating to page 4 of schema fields');
        const page4Button = this.page.locator(this.schemaPage4Button);
        await this.page.waitHelpers.waitForElementClickable(page4Button, {
            description: 'schema pagination page 4 button'
        });
        await page4Button.click({ timeout: 10000 });

        // Click first page button
        testLogger.debug('Navigating back to first page of schema fields');
        const firstPageButton = this.page.locator(this.schemaFirstPageButton);
        await this.page.waitHelpers.waitForElementClickable(firstPageButton, {
            description: 'schema pagination first page button'
        });
        await firstPageButton.click({ timeout: 10000 });

        testLogger.info('Schema pagination test completed successfully');
    }

    // Advanced Histogram Methods
    async displayPaginationWhenHistogramOffWithResult() {
        // First, ensure data is loaded by clicking the refresh button
        const refreshButton = this.page.locator(this.refreshButton);
        await expect(refreshButton).toBeVisible({ timeout: 15000 });
        await expect(refreshButton).toBeEnabled({ timeout: 10000 });
        
        try {
            await refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
            await this.page.waitForTimeout(2000);
        } catch (error) {
            console.warn('Refresh button click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
            await this.page.waitForTimeout(2000);
        }

        // Turn off histogram with error handling
        try {
            const histogramToggle = this.page.locator(this.histogramToggleDiv).nth(2);
            await expect(histogramToggle).toBeVisible({ timeout: 15000 });
            await histogramToggle.click({ timeout: 10000 });
            await this.page.waitForTimeout(1000); // Brief wait for toggle effect
        } catch (error) {
            console.warn('Histogram toggle click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await this.page.locator(this.histogramToggleDiv).nth(2).click({ timeout: 10000 });
        }
        
        // Click on result column with error handling
        try {
            const resultColumn = this.page.locator(this.resultColumnSource);
            await expect(resultColumn).toBeVisible({ timeout: 15000 });
            await resultColumn.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Result column click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await this.page.locator(this.resultColumnSource).click({ timeout: 10000 });
        }

        await this.page.waitForTimeout(2000);

        // Close dialog with error handling
        try {
            const closeDialogButton = this.page.locator(this.closeDialog);
            await expect(closeDialogButton).toBeVisible({ timeout: 15000 });
            await closeDialogButton.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Close dialog click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await this.page.locator(this.closeDialog).click({ timeout: 10000 });
        }

        await this.page.waitForTimeout(2000);

        // Check if pagination is visible, if not click run query again
        const paginationVisible = await this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down").isVisible({ timeout: 5000 }).catch(() => false);
        if (!paginationVisible) {
            await this.page.locator(this.refreshButton).click();
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
            await this.page.waitForTimeout(2000);
            const retryVisible = await this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down").isVisible({ timeout: 5000 }).catch(() => false);
            if (!retryVisible) {
                throw new Error('Pagination not visible after histogram off and retrying run query');
            }
        }
    }

    async displayPaginationWhenOnlySQLWithResult() {
        // Turn off histogram
        await this.page.locator(this.histogramToggleDiv).nth(2).click();
        await this.page.waitForTimeout(1000);

        // Enable SQL mode
        await this.page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2).click();
        await this.page.waitForTimeout(1000);

        // Click run query button
        await this.page.locator(this.refreshButton).click();
        await this.page.waitForLoadState('networkidle', { timeout: 25000 });
        await this.page.waitForTimeout(2000);

        // Click on result column
        await this.page.locator(this.timestampColumn).click();
        await this.page.waitForTimeout(2000);

        // Close dialog
        await this.page.locator(this.closeDialog).click();
        await this.page.waitForTimeout(2000);

        // Check if pagination is visible, if not click run query again
        const paginationVisible = await this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down").isVisible({ timeout: 5000 }).catch(() => false);
        if (!paginationVisible) {
            await this.page.locator(this.refreshButton).click();
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
            await this.page.waitForTimeout(2000);
            const retryVisible = await this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down").isVisible({ timeout: 5000 }).catch(() => false);
            if (!retryVisible) {
                throw new Error('Pagination not visible after SQL mode on and retrying run query');
            }
        }
    }

    async displayHistogramInSQLMode() {
        // First, ensure data is loaded by clicking the refresh button
        const initialRefreshButton = this.page.locator(this.refreshButton);
        await expect(initialRefreshButton).toBeVisible({ timeout: 15000 });
        await expect(initialRefreshButton).toBeEnabled({ timeout: 10000 });
        
        try {
            await initialRefreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
        } catch (error) {
            console.warn('Initial refresh button click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await initialRefreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
        }
        
        // Wait for canvas to be ready and visible (should now be there after data load)
        await expect(this.page.locator(this.histogramCanvas)).toBeVisible({ timeout: 15000 });
        await this.page.waitForLoadState('networkidle');
        
        // First canvas click with error handling
        try {
            await this.page.locator(this.histogramCanvas).click({
                position: { x: 182, y: 66 },
                timeout: 10000
            });
        } catch (error) {
            console.warn('First canvas click failed, retrying after wait:', error.message);
            await this.page.waitForTimeout(2000);
            await this.page.locator(this.histogramCanvas).click({
                position: { x: 182, y: 66 },
                timeout: 10000
            });
        }
        
        // Enable SQL mode with error handling
        const sqlModeSwitch = this.page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2);
        await expect(sqlModeSwitch).toBeVisible({ timeout: 15000 });
        
        try {
            await sqlModeSwitch.click({ timeout: 10000 });
        } catch (error) {
            console.warn('SQL mode switch failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await sqlModeSwitch.click({ timeout: 10000 });
        }
        
        // Click refresh button with waits
        const refreshButton = this.page.locator(this.refreshButton);
        await expect(refreshButton).toBeVisible({ timeout: 15000 });
        await expect(refreshButton).toBeEnabled({ timeout: 10000 });
        
        try {
            await refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
        } catch (error) {
            console.warn('Refresh button click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
        }

        await expect(
            this.page.getByRole("heading", { name: "Error while fetching" })
        ).not.toBeVisible();
        
        // Wait for canvas to be ready again after refresh
        await expect(this.page.locator(this.histogramCanvas)).toBeVisible({ timeout: 15000 });
        
        // Second canvas click with error handling
        try {
            await this.page.locator(this.histogramCanvas).click({
                position: { x: 182, y: 66 },
                timeout: 10000
            });
        } catch (error) {
            console.warn('Second canvas click failed, continuing anyway:', error.message);
        }
    }

    async displayResultsWhenSQLHistogramOnWithStreamSelection() {
        
        // Navigate to home first
        await expect(this.page.locator('[data-test="menu-link-\\/-item"]')).toBeVisible({ timeout: 15000 });
        
        await this.page.locator('[data-test="menu-link-\\/-item"]').click();
        await this.page.waitForLoadState('domcontentloaded');
        
        // Use proper logs navigation that includes VRL editor
        const currentUrl = new URL(this.page.url());
        const orgId = currentUrl.searchParams.get('org_identifier') || 'default';
        const logsUrl = `/web/logs?org_identifier=${orgId}&fn_editor=true`;
        
        await this.page.goto(logsUrl);
        await this.page.waitForLoadState('networkidle', { timeout: 20000 });
        
        // Select the e2e_automate stream before proceeding
        try {
            await this.page.locator('[data-test="log-search-index-list-select-stream"]').waitFor({ timeout: 10000 });
            await this.page.locator('[data-test="log-search-index-list-select-stream"]').click();
            await this.page.waitForTimeout(2000);
            
            // Try to select e2e_automate stream
            await this.page.getByText('e2e_automate', { exact: true }).first().click({ timeout: 5000 });
        } catch (error) {
            try {
                await this.page.locator('[data-test="log-search-index-list-stream-toggle-e2e_automate"] .q-toggle__inner').click({ timeout: 5000 });
            } catch (toggleError) {
                // Stream selection failed, continuing anyway
            }
        }
        
        // Wait for stream selection to complete
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        
        // Check if VRL editor is visible, if not click the toggle
        const fnEditor = this.page.locator('#fnEditor');
        const isFnEditorVisible = await fnEditor.isVisible();
        
        if (!isFnEditorVisible) {
            // Click VRL toggle button only if editor is not displayed
            await this.page.locator('[data-test="logs-search-bar-show-query-toggle-btn"] div').nth(2).click();
            
            // Wait for VRL editor to appear after toggle
            await expect(fnEditor).toBeVisible({ timeout: 15000 });
        }
        
        // Verify VRL editor is now available
        const fnEditorCount = await this.page.locator('#fnEditor').count();
        if (fnEditorCount === 0) {
            throw new Error('SQL+Histogram test: VRL editor (#fnEditor) not found after toggle');
        }
        
        // Enable SQL mode with error handling
        const sqlModeSwitch = this.page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2);
        await expect(sqlModeSwitch).toBeVisible({ timeout: 15000 });

        try {
            await sqlModeSwitch.click({ timeout: 10000 });
            await this.page.waitForTimeout(1000); // Brief wait for mode switch
        } catch (error) {
            console.warn('SQL mode switch click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await sqlModeSwitch.click({ timeout: 10000 });
        }

        // Wait for query editor to be ready
        const queryEditor = this.page.locator(this.queryEditorContent);
        await expect(queryEditor).toBeVisible({ timeout: 15000 });

        await queryEditor.locator('.monaco-editor').click();
        await queryEditor.locator('.inputarea').fill('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(1000);

        // Click refresh button with robust waits
        const refreshButton = this.page.locator(this.refreshButton);
        await expect(refreshButton).toBeVisible({ timeout: 15000 });
        await expect(refreshButton).toBeEnabled({ timeout: 10000 });
        
        try {
            await refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
            await this.page.waitForTimeout(2000);
        } catch (error) {
            console.warn('Refresh button click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
            await this.page.waitForTimeout(2000);
        }

        // Wait for search results to load before looking for timestamp menu
        await expect(this.page.locator('[data-test="logs-search-result-logs-table"]')).toBeVisible({ timeout: 20000 });
        
        // Click timestamp expand menu with error handling
        const timestampMenu = this.page.locator(this.timestampExpandMenu);
        await expect(timestampMenu).toBeVisible({ timeout: 15000 });
        
        try {
            await timestampMenu.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Timestamp expand menu click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await timestampMenu.click({ timeout: 10000 });
        }
    }
}
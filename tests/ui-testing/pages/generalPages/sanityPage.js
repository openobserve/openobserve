import { expect } from '@playwright/test';

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
        this.queryEditorContent = '[data-test="logs-search-bar-query-editor"] .cm-content';
        
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
        this.saveButton = 'button';
        this.alertNameInput = '[data-test="add-alert-name-input"]';
        this.savedViewDialogSave = '[data-test="saved-view-dialog-save-btn"]';
        this.savedViewsButton = '[data-test="logs-search-saved-views-btn"]';
        this.savedViewSearchInput = '[data-test="log-search-saved-view-field-search-input"]';
        this.confirmButton = '[data-test="confirm-button"]';
        
        // Function locators
        this.functionDropdown = '[data-test="logs-search-bar-function-dropdown"] button';
        this.fnEditor = '#fnEditor';
        this.savedFunctionNameInput = '[data-test="saved-function-name-input"]';
        
        // Menu Navigation locators
        this.pipelineMenuItem = '[data-test="menu-link-\\/pipeline-item"]';
        this.realtimeTab = '[data-test="tab-realtime"]';
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
        this.vrlEditorContent = '[data-test="logs-vrl-function-editor"] .cm-content';
        
        // Generic locators
        this.searchFunctionInput = '[placeholder="Search Function"]';
        this.createNewFunctionButton = { role: 'button', name: 'Create new function' };
        this.nameLabel = { label: 'Name' };
        this.saveButton = { role: 'button', name: 'Save' };
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

    // Pagination Methods
    async displayResultTextAndPagination() {
        await this.page.locator(this.refreshButton).click();
        await this.page.waitForLoadState('networkidle');
        
        await expect(this.page.getByText("Showing 1 to 50")).toBeVisible({ timeout: 15000 });
        await expect(this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down")).toBeVisible({ timeout: 10000 });
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
        await this.page.locator(this.saveButton).filter({ hasText: "savesaved_search" }).click();
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
        await this.page.locator('[data-test="log-search-saved-view-favorite-list-fields-table"] div')
            .filter({ hasText: "Favorite Views" }).nth(1).click();
        await this.page.locator(this.savedViewSearchInput).click();
        await this.page.locator(this.savedViewSearchInput).fill(savedViewName);
        
        const deleteButtonSelector = `[data-test="logs-search-bar-delete-${savedViewName}-saved-view-btn"]`;
        await this.page.locator(deleteButtonSelector).click();
        await this.page.locator(this.confirmButton).click();
    }

    // Query Limit Methods
    async displayLimitedResults() {
        await this.page.locator(this.refreshButton).click();
        await this.page.waitForLoadState('networkidle');
        
        await this.page.getByRole(this.sqlModeSwitch.role, { name: this.sqlModeSwitch.name }).locator('div').nth(2).click();
        
        const queryEditor = this.page.locator(this.queryEditorContent);
        await expect(queryEditor).toBeVisible({ timeout: 10000 });
        
        await queryEditor.click();
        await queryEditor.fill('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
        
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
        
        await this.page.locator(this.functionDropdown).filter({ hasText: "save" }).click();
        await this.page.locator(this.fnEditor).getByRole('textbox').click();
        await this.page.locator(this.fnEditor).locator(".cm-content").fill(".a=2");
        await this.page.waitForTimeout(1000);
        
        await this.page.locator(this.functionDropdown).filter({ hasText: "save" }).click();
        await this.page.locator(this.savedFunctionNameInput).click();
        await this.page.locator(this.savedFunctionNameInput).fill(functionName);
        await this.page.locator(this.savedViewDialogSave).click();
        await this.page.waitForTimeout(2000);
        
        await this.page.locator(this.pipelineMenuItem).click();
        await this.page.locator(this.realtimeTab).click();
        await this.page.locator(this.functionStreamTab).click();
        
        await this.page.getByPlaceholder("Search Function").click();
        await this.page.getByPlaceholder("Search Function").fill(functionName);
        await this.page.getByRole("button", { name: "Delete Function" }).click();
        await this.page.locator(this.confirmButton).click();
    }

    async createFunctionViaFunctionsPage() {
        await this.page.locator(this.pipelineMenuItem).click();
        await this.page.locator(this.realtimeTab).click();
        await this.page.locator(this.functionStreamTab).click();
        
        await this.page.getByRole(this.createNewFunctionButton.role, { name: this.createNewFunctionButton.name }).click();
        await this.page.getByLabel(this.nameLabel.label).click();
        await this.page.getByLabel(this.nameLabel.label).fill("sanitytest");
        
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
        await this.page.getByPlaceholder("Search Function").fill("sanity");
        await this.page.getByRole("button", { name: "Delete Function" }).click();
        await this.page.locator(this.confirmButton).click();
        await this.page.getByText("Function deleted").click();
    }

    // Dashboard Folder Methods
    async createAndDeleteFolder(folderName) {
        await this.page.locator(this.dashboardsMenuItem).click();
        await this.page.waitForLoadState('domcontentloaded');
        
        await this.page.locator(this.dashboardSearch).click();
        await this.page.locator(this.newFolderButton).click();
        
        await expect(this.page.locator(this.folderAddName)).toBeVisible({ timeout: 10000 });
        await this.page.locator(this.folderAddName).fill(folderName);
        await this.page.locator(this.folderAddSave).click();
        
        await expect(this.page.getByText(folderName)).toBeVisible({ timeout: 10000 });
        await this.page.getByText(folderName).click();
        
        await this.page.waitForLoadState('domcontentloaded');
        
        await this.page.locator(`[data-test^="dashboard-folder-tab"]:has-text("${folderName}") [data-test="dashboard-more-icon"]`).click();
        await this.page.locator(this.deleteFolderIcon).click({ force: true });
        await this.page.locator(this.confirmButton).click();

        await expect(this.page.getByText("Folder deleted successfully")).toBeVisible({ timeout: 10000 });
    }

    // Stream Methods
    async createAndDeleteStream() {
        await this.page.locator(this.streamsMenuItem).click();
        await this.page.waitForLoadState('domcontentloaded');
        
        await this.page.locator(this.addStreamButton).click();
        
        await expect(this.page.getByLabel("Name *")).toBeVisible({ timeout: 10000 });
        await this.page.getByLabel("Name *").fill("sanitylogstream");
        
        await this.page.locator(this.streamTypeDropdown).getByText("arrow_drop_down").click();
        await this.page.getByRole("option", { name: "Logs" }).click();
        
        await this.page.locator(this.saveStreamButton).click();
        await this.page.waitForLoadState('networkidle');
        
        const isBackOnStreamsList = await this.page.locator(this.addStreamButton).isVisible({ timeout: 5000 });
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
        
        await this.page.getByPlaceholder("Search Stream").fill("sanitylogstream");
        await this.page.waitForLoadState('domcontentloaded');
        
        const deleteButtons = this.page.getByRole(this.deleteButton.role, { name: this.deleteButton.name });
        const deleteButtonCount = await deleteButtons.count();
        
        if (deleteButtonCount > 0) {
            const deleteButton = deleteButtons.first();
            await expect(deleteButton).toBeVisible({ timeout: 5000 });
            await deleteButton.click({ force: true });
            
            const deleteConfirmButton = this.page.getByRole(this.deleteButton.role, { name: this.deleteButton.name });
            await expect(deleteConfirmButton).toBeVisible({ timeout: 5000 });
            await deleteConfirmButton.click({ force: true });
            
            await this.page.waitForLoadState('networkidle');
            
            // Verify stream deletion
            await this.page.getByPlaceholder("Search Stream").clear();
            await this.page.getByPlaceholder("Search Stream").fill("sanitylogstream");
            await this.page.waitForLoadState('domcontentloaded');
            
            const streamNameInTable = this.page.getByText("sanitylogstream");
            const streamExists = await streamNameInTable.isVisible({ timeout: 3000 }).catch(() => false);
            
            if (streamExists) {
                throw new Error('Stream deletion failed - stream still exists');
            }
            
            const noDataMessage = this.page.getByText(/No data found|No results|No streams/i);
            const hasNoDataMessage = await noDataMessage.isVisible({ timeout: 2000 }).catch(() => false);
            
            if (hasNoDataMessage) {
                console.log('Deletion verified - no streams found');
            }
        } else {
            throw new Error('Stream creation failed - no streams available for deletion');
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
        
        await expect(this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down")).toBeVisible({ timeout: 10000 });
    }
}
import { expect } from '@playwright/test';
const { waitUtils } = require('../../playwright-tests/utils/wait-helpers.js');

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
        this.saveSearchButton = 'button';
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
        
        // Settings locators (sanity2 specific)
        this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
        this.generalSettingsTab = { role: 'tab', name: 'General Settings' };
        this.scrapeIntervalInput = { label: 'Scrape Interval (In Seconds) *' };
        this.dashboardSubmitButton = '[data-test="dashboard-add-submit"]';
        
        // Stream Stats locators (sanity2 specific)
        this.refreshStatsButton = '[data-test="log-stream-refresh-stats-btn"]';
        this.streamCellButton = { role: 'cell', name: '01' };
        
        // Schema Pagination locators (sanity2 specific)
        this.schemaNextPageButton = '[data-test="logs-page-fields-list-pagination-nextpage-button"]';
        this.schemaPrevPageButton = '[data-test="logs-page-fields-list-pagination-previouspage-button"]';
        this.schemaPaginationText = 'fast_rewind1/2fast_forward';
        
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
        console.log(`🔍 SAVED SEARCH DEBUG: Starting test with savedViewName: ${savedViewName}`);
        console.log(`🔍 SAVED SEARCH DEBUG: Current URL: ${this.page.url()}`);
        console.log(`🔍 SAVED SEARCH DEBUG: Page title: ${await this.page.title()}`);
        
        console.log('🔍 SAVED SEARCH DEBUG: Step 1 - Clicking save search button');
        const saveSearchButton = this.page.locator(this.saveSearchButton).filter({ hasText: "savesaved_search" });
        console.log(`🔍 SAVED SEARCH DEBUG: Save button selector: ${this.saveSearchButton}`);
        console.log(`🔍 SAVED SEARCH DEBUG: Save button count: ${await saveSearchButton.count()}`);
        console.log(`🔍 SAVED SEARCH DEBUG: Save button visible: ${await saveSearchButton.isVisible()}`);
        await saveSearchButton.click();
        console.log('🔍 SAVED SEARCH DEBUG: Step 1 COMPLETE');
        
        console.log('🔍 SAVED SEARCH DEBUG: Step 2 - Filling alert name');
        const alertNameInput = this.page.locator(this.alertNameInput);
        console.log(`🔍 SAVED SEARCH DEBUG: Alert input visible: ${await alertNameInput.isVisible()}`);
        await alertNameInput.click();
        await alertNameInput.fill(savedViewName);
        console.log('🔍 SAVED SEARCH DEBUG: Step 2 COMPLETE');
        
        console.log('🔍 SAVED SEARCH DEBUG: Step 3 - Saving dialog');
        const dialogSaveBtn = this.page.locator(this.savedViewDialogSave);
        console.log(`🔍 SAVED SEARCH DEBUG: Dialog save button visible: ${await dialogSaveBtn.isVisible()}`);
        await dialogSaveBtn.click();
        console.log('🔍 SAVED SEARCH DEBUG: Step 3 COMPLETE');
        
        console.log('🔍 SAVED SEARCH DEBUG: Step 4-12 - Complex workflow steps');
        await this.page.locator(this.savedViewsButton).getByLabel("Expand").click();
        console.log('🔍 SAVED SEARCH DEBUG: Expanded saved views');
        
        await this.page.locator(this.savedViewSearchInput).click();
        await this.page.locator(this.savedViewSearchInput).fill(savedViewName);
        console.log(`🔍 SAVED SEARCH DEBUG: Filled search with: ${savedViewName}`);
        
        await this.page.getByText(savedViewName).first().click();
        console.log('🔍 SAVED SEARCH DEBUG: Clicked saved view');
        
        await this.page.locator(this.savedViewsButton).getByLabel("Expand").click();
        await this.page.locator(this.savedViewSearchInput).click();
        await this.page.locator(this.savedViewSearchInput).fill(savedViewName);
        await this.page.getByText("favorite_border").first().click();
        console.log('🔍 SAVED SEARCH DEBUG: Clicked favorite border');
        
        await this.page.getByText("Favorite Views").click();
        await this.page.getByLabel('Clear').first().click();
        await this.page.getByLabel("Collapse").click();
        console.log('🔍 SAVED SEARCH DEBUG: Completed favorite workflow');
        
        console.log('🔍 SAVED SEARCH DEBUG: Step 13 - Final expand and navigation');
        await this.page.locator(this.savedViewsButton).getByLabel("Expand").click();
        const favoriteTable = this.page.locator('[data-test="log-search-saved-view-favorite-list-fields-table"] div').filter({ hasText: "Favorite Views" }).nth(1);
        console.log(`🔍 SAVED SEARCH DEBUG: Favorite table visible: ${await favoriteTable.isVisible()}`);
        await favoriteTable.click();
        
        await this.page.locator(this.savedViewSearchInput).click();
        await this.page.locator(this.savedViewSearchInput).fill(savedViewName);
        console.log('🔍 SAVED SEARCH DEBUG: Step 13 COMPLETE');
        
        console.log('🔍 SAVED SEARCH DEBUG: Step 14 - CRITICAL DELETE STEP');
        const deleteButtonSelector = `[data-test="logs-search-bar-delete-${savedViewName}-saved-view-btn"]`;
        console.log(`🔍 SAVED SEARCH DEBUG: Delete button selector: ${deleteButtonSelector}`);
        const deleteButton = this.page.locator(deleteButtonSelector);
        console.log(`🔍 SAVED SEARCH DEBUG: Delete button count: ${await deleteButton.count()}`);
        console.log(`🔍 SAVED SEARCH DEBUG: Delete button visible: ${await deleteButton.isVisible()}`);
        
        if (await deleteButton.count() === 0) {
            console.log('🔍 SAVED SEARCH DEBUG: ERROR - Delete button not found! Taking screenshot of current state...');
            console.log(`🔍 SAVED SEARCH DEBUG: All elements with data-test containing 'delete': ${await this.page.locator('[data-test*="delete"]').count()}`);
            const allDeleteButtons = this.page.locator('[data-test*="delete"]');
            for (let i = 0; i < await allDeleteButtons.count(); i++) {
                const btn = allDeleteButtons.nth(i);
                console.log(`🔍 SAVED SEARCH DEBUG: Delete button ${i}: ${await btn.getAttribute('data-test')}, visible: ${await btn.isVisible()}`);
            }
        }
        
        try {
            // First attempt with stability wait
            await this.page.waitForLoadState('domcontentloaded');
            await deleteButton.click({ timeout: 15000 });
            console.log('🔍 SAVED SEARCH DEBUG: Step 14 COMPLETE - Delete clicked (normal)');
        } catch (error) {
            console.log(`🔍 SAVED SEARCH DEBUG: Delete click failed, trying force click: ${error.message}`);
            try {
                await deleteButton.click({ force: true, timeout: 10000 });
                console.log('🔍 SAVED SEARCH DEBUG: Step 14 COMPLETE - Delete clicked (force)');
            } catch (forceError) {
                console.log(`🔍 SAVED SEARCH DEBUG: Force click also failed: ${forceError.message}`);
                // Try clicking by coordinates as last resort
                const box = await deleteButton.boundingBox();
                if (box) {
                    await this.page.mouse.click(box.x + box.width/2, box.y + box.height/2);
                    console.log('🔍 SAVED SEARCH DEBUG: Step 14 COMPLETE - Delete clicked (mouse coordinates)');
                } else {
                    throw forceError;
                }
            }
        }
        
        // Wait for confirm dialog to fully render and stabilize
        console.log('🔍 SAVED SEARCH DEBUG: Waiting for confirm dialog to stabilize...');
        await this.page.waitForLoadState('domcontentloaded');
        await waitUtils.smartWait(this.page, 2000, 'Dialog stabilization');
        
        console.log('🔍 SAVED SEARCH DEBUG: Step 15 - CRITICAL CONFIRM DIALOG STEP');
        const confirmButton = this.page.locator(this.confirmButton);
        console.log(`🔍 SAVED SEARCH DEBUG: Confirm button selector: ${this.confirmButton}`);
        console.log(`🔍 SAVED SEARCH DEBUG: Confirm button count immediately after delete: ${await confirmButton.count()}`);
        console.log(`🔍 SAVED SEARCH DEBUG: Confirm button visible immediately after delete: ${await confirmButton.isVisible()}`);
        
        // Check for any dialogs on page
        const allDialogs = this.page.locator('.q-dialog, [role="dialog"], .modal');
        console.log(`🔍 SAVED SEARCH DEBUG: All dialogs count: ${await allDialogs.count()}`);
        for (let i = 0; i < await allDialogs.count(); i++) {
            const dialog = allDialogs.nth(i);
            console.log(`🔍 SAVED SEARCH DEBUG: Dialog ${i}: visible=${await dialog.isVisible()}, class=${await dialog.getAttribute('class')}`);
        }
        
        // Check for all buttons in any dialogs
        const allButtons = this.page.locator('button');
        console.log(`🔍 SAVED SEARCH DEBUG: All buttons count: ${await allButtons.count()}`);
        const confirmButtons = this.page.locator('button:has-text("Ok"), button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")');
        console.log(`🔍 SAVED SEARCH DEBUG: Potential confirm buttons count: ${await confirmButtons.count()}`);
        
        try {
            console.log('🔍 SAVED SEARCH DEBUG: Waiting for confirm button visibility...');
            await expect(confirmButton).toBeVisible({ timeout: 10000 });
            console.log('🔍 SAVED SEARCH DEBUG: Confirm button is visible');
            
            console.log('🔍 SAVED SEARCH DEBUG: Waiting for confirm button enabled state...');
            await expect(confirmButton).toBeEnabled({ timeout: 5000 });
            console.log('🔍 SAVED SEARCH DEBUG: Confirm button is enabled');
            
            console.log('🔍 SAVED SEARCH DEBUG: Waiting for DOM stability...');
            await this.page.waitForLoadState('domcontentloaded');
            console.log('🔍 SAVED SEARCH DEBUG: DOM is stable');
            
            // Final pre-click check
            console.log(`🔍 SAVED SEARCH DEBUG: PRE-CLICK - Count: ${await confirmButton.count()}, Visible: ${await confirmButton.isVisible()}, Enabled: ${await confirmButton.isEnabled()}`);
            console.log(`🔍 SAVED SEARCH DEBUG: PRE-CLICK - Button text: ${await confirmButton.textContent()}`);
            
            // Robust confirm button clicking with multiple strategies
            try {
                await confirmButton.click({ timeout: 15000 });
                console.log('🔍 SAVED SEARCH DEBUG: Step 15 COMPLETE - Confirm button clicked (normal)');
            } catch (normalError) {
                console.log(`🔍 SAVED SEARCH DEBUG: Normal confirm click failed: ${normalError.message}`);
                try {
                    // Force click as backup
                    await confirmButton.click({ force: true, timeout: 10000 });
                    console.log('🔍 SAVED SEARCH DEBUG: Step 15 COMPLETE - Confirm button clicked (force)');
                } catch (forceError) {
                    console.log(`🔍 SAVED SEARCH DEBUG: Force confirm click failed: ${forceError.message}`);
                    // Mouse coordinates as last resort
                    const box = await confirmButton.boundingBox();
                    if (box) {
                        await this.page.mouse.click(box.x + box.width/2, box.y + box.height/2);
                        console.log('🔍 SAVED SEARCH DEBUG: Step 15 COMPLETE - Confirm button clicked (mouse coordinates)');
                    } else {
                        throw forceError;
                    }
                }
            }
            
        } catch (error) {
            console.log(`🔍 SAVED SEARCH DEBUG: CRITICAL ERROR in confirm dialog: ${error.message}`);
            console.log(`🔍 SAVED SEARCH DEBUG: Current URL during error: ${this.page.url()}`);
            console.log(`🔍 SAVED SEARCH DEBUG: Page title during error: ${await this.page.title()}`);
            console.log(`🔍 SAVED SEARCH DEBUG: Confirm button final state - Count: ${await confirmButton.count()}, Visible: ${await confirmButton.isVisible()}`);
            
            // Try alternative confirm buttons
            console.log('🔍 SAVED SEARCH DEBUG: Trying alternative confirm button selectors...');
            const altButtons = ['[data-test="confirm-button"]', 'button:has-text("OK")', 'button:has-text("Confirm")', '.q-btn:has-text("OK")'];
            for (const selector of altButtons) {
                const altBtn = this.page.locator(selector);
                console.log(`🔍 SAVED SEARCH DEBUG: Alt button ${selector}: count=${await altBtn.count()}, visible=${await altBtn.isVisible()}`);
            }
            
            throw error;
        }
        
        console.log('🔍 SAVED SEARCH DEBUG: TEST COMPLETED SUCCESSFULLY');
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
        console.log(`🔍 FUNCTION DEBUG: Starting function test with name: ${functionName}`);
        console.log(`🔍 FUNCTION DEBUG: Current URL: ${this.page.url()}`);
        console.log(`🔍 FUNCTION DEBUG: Page title: ${await this.page.title()}`);
        
        console.log('🔍 FUNCTION DEBUG: Step 1 - Initial refresh');
        await this.page.locator(this.refreshButton).click();
        await this.page.waitForLoadState('networkidle');
        console.log('🔍 FUNCTION DEBUG: Step 1 COMPLETE - Page refreshed');
        
        console.log('🔍 FUNCTION DEBUG: Step 2 - CRITICAL FUNCTION DROPDOWN CLICK');
        const functionDropdown = this.page.locator(this.functionDropdown).filter({ hasText: "save" });
        console.log(`🔍 FUNCTION DEBUG: Function dropdown selector: ${this.functionDropdown}`);
        console.log(`🔍 FUNCTION DEBUG: Function dropdown count: ${await functionDropdown.count()}`);
        console.log(`🔍 FUNCTION DEBUG: Function dropdown visible: ${await functionDropdown.isVisible()}`);
        console.log(`🔍 FUNCTION DEBUG: Function dropdown enabled: ${await functionDropdown.isEnabled()}`);
        
        if (await functionDropdown.count() === 0) {
            console.log('🔍 FUNCTION DEBUG: ERROR - Function dropdown not found!');
            const allDropdowns = this.page.locator('[data-test*="dropdown"], select, .dropdown');
            console.log(`🔍 FUNCTION DEBUG: All potential dropdowns count: ${await allDropdowns.count()}`);
            for (let i = 0; i < await allDropdowns.count(); i++) {
                const dd = allDropdowns.nth(i);
                console.log(`🔍 FUNCTION DEBUG: Dropdown ${i}: class=${await dd.getAttribute('class')}, data-test=${await dd.getAttribute('data-test')}, visible=${await dd.isVisible()}`);
            }
        }
        
        await functionDropdown.click();
        console.log('🔍 FUNCTION DEBUG: Step 2 COMPLETE - Function dropdown clicked');
        
        console.log('🔍 FUNCTION DEBUG: Step 3 - CRITICAL VRL EDITOR CHECK');
        console.log(`🔍 FUNCTION DEBUG: VRL editor selector: ${this.fnEditor}`);
        
        // Check if VRL editor container exists
        const fnEditor = this.page.locator(this.fnEditor);
        console.log(`🔍 FUNCTION DEBUG: VRL editor container count: ${await fnEditor.count()}`);
        console.log(`🔍 FUNCTION DEBUG: VRL editor container visible: ${await fnEditor.isVisible()}`);
        
        if (await fnEditor.count() === 0) {
            console.log('🔍 FUNCTION DEBUG: ERROR - VRL editor container not found!');
            console.log('🔍 FUNCTION DEBUG: Checking for alternative editor selectors...');
            const altSelectors = ['#fnEditor', '.fn-editor', '[data-test*="editor"]', '.monaco-editor', '.cm-editor'];
            for (const selector of altSelectors) {
                const altEditor = this.page.locator(selector);
                const count = await altEditor.count();
                console.log(`🔍 FUNCTION DEBUG: Alt selector ${selector}: count=${count}`);
                
                // Handle multiple matches by checking each one individually
                if (count > 0) {
                    if (count === 1) {
                        console.log(`🔍 FUNCTION DEBUG: Alt selector ${selector}: visible=${await altEditor.isVisible()}`);
                    } else {
                        console.log(`🔍 FUNCTION DEBUG: Alt selector ${selector}: multiple matches (${count}), checking each:`);
                        for (let i = 0; i < count; i++) {
                            const element = altEditor.nth(i);
                            try {
                                console.log(`🔍 FUNCTION DEBUG: Alt selector ${selector}[${i}]: visible=${await element.isVisible()}, data-test=${await element.getAttribute('data-test')}`);
                            } catch (error) {
                                console.log(`🔍 FUNCTION DEBUG: Alt selector ${selector}[${i}]: error checking visibility - ${error.message}`);
                            }
                        }
                    }
                }
            }
            
            // Check current page state
            console.log('🔍 FUNCTION DEBUG: Checking if VRL toggle needs to be clicked...');
            const vrlToggle = this.page.locator('[data-test="logs-search-bar-show-query-toggle-btn"]');
            console.log(`🔍 FUNCTION DEBUG: VRL toggle count: ${await vrlToggle.count()}, visible: ${await vrlToggle.isVisible()}`);
            
            if (await vrlToggle.count() > 0 && await vrlToggle.isVisible()) {
                console.log('🔍 FUNCTION DEBUG: Clicking VRL toggle to show editor...');
                await vrlToggle.locator('div').nth(2).click();
                await this.page.waitForLoadState('domcontentloaded');
                console.log(`🔍 FUNCTION DEBUG: After toggle - VRL editor count: ${await fnEditor.count()}, visible: ${await fnEditor.isVisible()}`);
            }
        }
        
        // Check for textbox within editor
        const fnEditorTextbox = this.page.locator(this.fnEditor).getByRole('textbox');
        console.log(`🔍 FUNCTION DEBUG: VRL textbox count: ${await fnEditorTextbox.count()}`);
        console.log(`🔍 FUNCTION DEBUG: VRL textbox visible: ${await fnEditorTextbox.isVisible()}`);
        
        if (await fnEditorTextbox.count() === 0) {
            console.log('🔍 FUNCTION DEBUG: ERROR - VRL textbox not found within editor!');
            console.log('🔍 FUNCTION DEBUG: Checking all textboxes on page...');
            const allTextboxes = this.page.locator('input[type="text"], textarea, [role="textbox"]');
            console.log(`🔍 FUNCTION DEBUG: All textboxes count: ${await allTextboxes.count()}`);
            for (let i = 0; i < Math.min(5, await allTextboxes.count()); i++) {
                const textbox = allTextboxes.nth(i);
                console.log(`🔍 FUNCTION DEBUG: Textbox ${i}: visible=${await textbox.isVisible()}, placeholder=${await textbox.getAttribute('placeholder')}, class=${await textbox.getAttribute('class')}`);
            }
            
            // Check for CodeMirror editor
            const cmContent = this.page.locator('.cm-content, .cm-editor .cm-content');
            console.log(`🔍 FUNCTION DEBUG: CodeMirror content count: ${await cmContent.count()}, visible: ${await cmContent.isVisible()}`);
        }
        
        try {
            console.log('🔍 FUNCTION DEBUG: Waiting for VRL textbox to be visible...');
            await expect(fnEditorTextbox).toBeVisible({ timeout: 15000 });
            console.log('🔍 FUNCTION DEBUG: VRL textbox is visible');
            
            console.log('🔍 FUNCTION DEBUG: Waiting for VRL textbox to be editable...');
            await expect(fnEditorTextbox).toBeEditable({ timeout: 10000 });
            console.log('🔍 FUNCTION DEBUG: VRL textbox is editable');
            
            console.log('🔍 FUNCTION DEBUG: Waiting for DOM stability...');
            await this.page.waitForLoadState('domcontentloaded');
            console.log('🔍 FUNCTION DEBUG: DOM is stable');
            
            console.log('🔍 FUNCTION DEBUG: Clicking VRL textbox...');
            await fnEditorTextbox.click();
            console.log('🔍 FUNCTION DEBUG: Step 3 COMPLETE - VRL editor ready and clicked');
            
        } catch (error) {
            console.log(`🔍 FUNCTION DEBUG: CRITICAL ERROR - VRL editor not available: ${error.message}`);
            console.log(`🔍 FUNCTION DEBUG: Final state - Editor count: ${await fnEditor.count()}, visible: ${await fnEditor.isVisible()}`);
            console.log(`🔍 FUNCTION DEBUG: Final state - Textbox count: ${await fnEditorTextbox.count()}, visible: ${await fnEditorTextbox.isVisible()}`);
            console.log(`🔍 FUNCTION DEBUG: Page URL during error: ${this.page.url()}`);
            
            // Take final screenshot of state
            console.log('🔍 FUNCTION DEBUG: Attempting to find any working editor alternative...');
            const cmContent = this.page.locator('.cm-content').first();
            if (await cmContent.count() > 0) {
                console.log('🔍 FUNCTION DEBUG: Found CodeMirror content, attempting to use it...');
                await cmContent.click();
                console.log('🔍 FUNCTION DEBUG: CodeMirror content clicked as fallback');
            } else {
                throw error;
            }
        }
        await this.page.locator(this.fnEditor).locator(".cm-content").fill(".a=2");
        await waitUtils.smartWait(this.page, 1000, 'VRL editor content stabilization');
        
        await this.page.locator(this.functionDropdown).filter({ hasText: "save" }).click();
        
        // Wait for save dialog to appear using multiple wait strategies
        try {
          // First try waiting for the element to be attached to DOM
          await this.page.locator(this.savedFunctionNameInput).waitFor({ state: 'attached', timeout: 3000 });
          // Then wait for it to be visible  
          await this.page.locator(this.savedFunctionNameInput).waitFor({ state: 'visible', timeout: 3000 });
        } catch (error) {
          // If dialog doesn't appear, try clicking save again
          await this.page.locator(this.functionDropdown).filter({ hasText: "save" }).click();
          await this.page.locator(this.savedFunctionNameInput).waitFor({ state: 'visible', timeout: 5000 });
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
        
        await this.page.locator(this.addStreamButton).click();
        
        await expect(this.page.getByLabel("Name *")).toBeVisible({ timeout: 10000 });
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
        
        // Click delete button for the specific stream using first() to handle search results
        await this.page.getByRole("button", { name: "Delete" }).first().click();
        
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

    // Sanity2-Specific Methods

    // Settings Management Methods
    async changeSettingsSuccessfully() {
        await waitUtils.smartWait(this.page, 2000, 'pre-settings navigation wait');
        await this.page.locator(this.settingsMenuItem).click();
        await waitUtils.smartWait(this.page, 2000, 'settings page load');
        await this.page.getByText("General SettingsScrape").click();
        await this.page.getByRole(this.generalSettingsTab.role, { name: this.generalSettingsTab.name }).click();
        await this.page.getByLabel(this.scrapeIntervalInput.label).fill("16");
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
    async displayPaginationForSchema() {
        // First, ensure data is loaded by clicking the refresh button
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
        
        // Wait and click on the pagination dropdown with error handling
        try {
            const paginationDropdown = this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down");
            await expect(paginationDropdown).toBeVisible({ timeout: 15000 });
            await paginationDropdown.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Pagination dropdown click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down").click({ timeout: 10000 });
        }
        
        // Click on schema pagination text with error handling
        try {
            const schemaPaginationText = this.page.getByText(this.schemaPaginationText);
            await expect(schemaPaginationText).toBeVisible({ timeout: 15000 });
            await schemaPaginationText.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Schema pagination text click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await this.page.getByText(this.schemaPaginationText).click({ timeout: 10000 });
        }
        
        // Click next page button with error handling
        try {
            const nextPageButton = this.page.locator(this.schemaNextPageButton);
            await expect(nextPageButton).toBeVisible({ timeout: 15000 });
            await expect(nextPageButton).toBeEnabled({ timeout: 10000 });
            await nextPageButton.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Next page button click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await this.page.locator(this.schemaNextPageButton).click({ timeout: 10000 });
        }
        
        // Click previous page button with error handling
        try {
            const prevPageButton = this.page.locator(this.schemaPrevPageButton);
            await expect(prevPageButton).toBeVisible({ timeout: 15000 });
            await expect(prevPageButton).toBeEnabled({ timeout: 10000 });
            await prevPageButton.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Previous page button click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await this.page.locator(this.schemaPrevPageButton).click({ timeout: 10000 });
        }
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
        } catch (error) {
            console.warn('Refresh button click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await refreshButton.click({ timeout: 10000 });
            await this.page.waitForLoadState('networkidle', { timeout: 25000 });
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
        
        // Click on pagination with error handling
        try {
            const paginationElement = this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down");
            await expect(paginationElement).toBeVisible({ timeout: 15000 });
            await paginationElement.click({ timeout: 10000 });
        } catch (error) {
            console.warn('Pagination element click failed, retrying:', error.message);
            await this.page.waitForTimeout(2000);
            await this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down").click({ timeout: 10000 });
        }
    }

    async displayPaginationWhenOnlySQLWithResult() {
        await this.page.locator(this.histogramToggleDiv).nth(2).click();
        await this.page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2).click();
        await this.page.locator(this.refreshButton).click();
        await this.page.locator(this.timestampColumn).click();
        await this.page.locator(this.closeDialog).click();
        await this.page.getByText("fast_rewind12345fast_forward50arrow_drop_down").click();
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
        
        // Wait for SQL editor to be ready
        const sqlEditor = this.page.locator('#fnEditor').getByRole('textbox');
        await expect(sqlEditor).toBeVisible({ timeout: 15000 });
        
        await expect(sqlEditor).toBeEditable({ timeout: 10000 });
        
        await sqlEditor.click();
        
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
        
        // Fill SQL query into the editor
        await sqlEditor.fill('SELECT * FROM "e2e_automate" ORDER BY _timestamp DESC limit 5');
        await this.page.waitForLoadState('domcontentloaded');
        
        // Click refresh button with robust waits
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
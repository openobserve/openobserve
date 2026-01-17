const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

class EnrichmentPage {
    constructor(page) {
        this.page = page;
        
        // File upload and enrichment table locators
        this.fileInput = 'input[type="file"]';
        this.fileNameInput = '.q-input > .q-field__inner > .q-field__control';
        this.saveButton = 'Save';
        this.searchEnrichmentTable = 'Search Enrichment Table';
        this.exploreButton = 'Explore';
        this.nameLabel = 'Name';
        
        // Navigation locators
        this.pipelineMenuItem = '[data-test="menu-link-\\/pipeline-item"]';
        this.enrichmentTableTab = '[data-test="function-enrichment-table-tab"]';
        this.enrichmentTablesSearchInput = '[data-test="enrichment-tables-search-input"]';
        
        // Logs table locators
        this.timestampColumn = '[data-test="log-table-column-0-_timestamp"]';
        this.closeDialog = '[data-test="close-dialog"]';
        this.expandMenu = '[data-test="table-row-expand-menu"]';
        this.protocolKeywordText = '[data-test="log-expand-detail-key-protocol_keyword"]';
        this.dateTimeBtn = '[data-test="date-time-btn"]';
        
        // VRL editor locator
        this.vrlEditor = '#fnEditor';
        this.refreshButton = "[data-test='logs-search-bar-refresh-btn']";
        this.showQueryToggleBtn = '[data-test="logs-search-bar-show-query-toggle-btn"] div';
        
        // Table and validation locators
        this.tableRows = 'tbody tr';
        this.tableCellLeft = 'td.text-left';
        this.warningQueryExecution = 'text=warning Query execution';
        this.startTimeCell = 'Start time';
        this.showingText = 'Showing 1 to 2 out of 2';
        this.csvRequiredError = 'CSV File is required!';
        
        // Append data locators
        this.enrichmentTablesButton = 'Enrichment Tables';
        this.appendDataToggle = 'Append data to existing';

        // UI Regression locators
        this.enrichmentTabText = 'text=/enrichment.*table/i';
        this.quasarTable = '.o2-quasar-table';
        this.helpMenuItem = '[data-test="menu-link-help-item"]';
        this.openApiMenuItem = 'text=/openapi/i';

        // URL-based enrichment table locators
        this.sourceRadioGroup = '.q-option-group'; // Source selector: Upload File / From URL
        this.urlInputField = 'label:has-text("CSV File URL") + .q-field__control .q-field__native'; // URL input field
        this.updateModeRadioGroup = 'text=/Update Mode/i'; // Update mode selector
        this.urlListContainer = 'text=/Existing URLs/i'; // Container showing URL list with statuses
        this.addEnrichmentTableTitle = 'text=/Add Enrichment Table/i';
        this.updateEnrichmentTableTitle = 'text=/Update Enrichment Table/i';
    }

    // ============================================================================
    // REGRESSION TEST POM METHODS
    // ============================================================================

    /**
     * Click the enrichment tab by text pattern
     * @returns {Promise<boolean>} True if click succeeded
     */
    async clickEnrichmentTabByText() {
        const enrichmentTab = this.page.locator(this.enrichmentTabText).first();
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
        const enrichmentTab = this.page.locator(this.enrichmentTabText).first();
        return await enrichmentTab.isVisible().catch(() => false);
    }

    /**
     * Check if enrichment tables search input is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isEnrichmentSearchInputVisible() {
        const searchInput = this.page.locator(this.enrichmentTablesSearchInput);
        return await searchInput.isVisible().catch(() => false);
    }

    /**
     * Get the quasar table bounding box if visible
     * @returns {Promise<{width: number, height: number}|null>} Bounding box or null
     */
    async getQuasarTableDimensions() {
        const table = this.page.locator(this.quasarTable).first();
        const isVisible = await table.isVisible().catch(() => false);
        if (isVisible) {
            return await table.boundingBox();
        }
        return null;
    }

    /**
     * Check if quasar table is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isQuasarTableVisible() {
        const table = this.page.locator(this.quasarTable).first();
        return await table.isVisible().catch(() => false);
    }

    /**
     * Take screenshot of quasar table
     * @param {string} filename - The filename to save screenshot
     */
    async screenshotQuasarTable(filename) {
        const table = this.page.locator(this.quasarTable).first();
        if (await table.isVisible().catch(() => false)) {
            await table.screenshot({ path: filename });
        }
    }

    /**
     * Click help menu item
     */
    async clickHelpMenuItem() {
        const helpButton = this.page.locator(this.helpMenuItem);
        await helpButton.waitFor({ state: 'visible', timeout: 10000 });
        await helpButton.click();
    }

    /**
     * Click OpenAPI menu item if visible
     * @returns {Promise<boolean>} True if click succeeded
     */
    async clickOpenApiMenuItemIfVisible() {
        const openApiMenuItem = this.page.locator(this.openApiMenuItem).first();
        const isVisible = await openApiMenuItem.isVisible().catch(() => false);
        if (isVisible) {
            await openApiMenuItem.click();
            return true;
        }
        return false;
    }

    /**
     * Check if OpenAPI menu item is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isOpenApiMenuItemVisible() {
        const openApiMenuItem = this.page.locator(this.openApiMenuItem).first();
        return await openApiMenuItem.isVisible().catch(() => false);
    }

    // Navigation Methods
    async navigateToEnrichmentTable() {
        await this.page.locator(this.pipelineMenuItem).click();
        await this.page.locator(this.enrichmentTableTab).click();
        await this.page.waitForLoadState('networkidle');
        // Wait for the enrichment tables list to be visible
        await this.page.locator('.q-table__title').filter({ hasText: 'Enrichment Tables' }).waitFor({ state: 'visible', timeout: 10000 });
    }

    async navigateToAddEnrichmentTable() {
        // This method is already in pipelinesPage, so we'll delegate to it
        // We'll use pageManager.pipelinesPage.navigateToAddEnrichmentTable() in tests
    }

    // File Upload Methods
    async uploadEnrichmentFile(filePath, fileName) {
        // Set the file to be uploaded
        const inputFile = await this.page.locator(this.fileInput);
        await inputFile.setInputFiles(filePath);

        // Enter the file name
        await this.page.fill(this.fileNameInput, fileName);

        // Click on 'Save'
        await this.page.getByText(this.saveButton).click({ force: true });
        await this.page.waitForLoadState('networkidle');

        // Wait for the form to disappear (indicates save completed and returned to list)
        await this.page.getByText('Add Enrichment Table').waitFor({ state: 'hidden', timeout: 15000 });

        // Additional wait for page to stabilize
        await this.page.waitForTimeout(2000);
    }

    async searchForEnrichmentTable(fileName) {
        await this.page.getByPlaceholder(this.searchEnrichmentTable).fill(fileName);
        await this.page.waitForLoadState('networkidle');
    }

    // Exploration Methods
    async exploreEnrichmentTable() {
        await this.page.getByRole('button', { name: this.exploreButton }).click();
        await this.page.waitForLoadState('networkidle');
    }

    async clickTimestampColumn() {
        await this.page.locator(this.timestampColumn).click();
    }

    async closeLogDialog() {
        await this.page.locator(this.closeDialog).click();
        await this.page.waitForLoadState('networkidle');
    }

    async clickDateTimeButton() {
        await this.page.locator(this.dateTimeBtn).click();
    }

    async verifyStartTimeVisible() {
        await expect(this.page.getByRole('cell', { name: this.startTimeCell })).toBeVisible();
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
            await this.page.waitForLoadState('networkidle', { timeout: 30000 });
            
            // Wait for VRL editor to be fully initialized (addressing the race condition)
            // The original working code had a 3-second wait after "Explore" click for editor initialization
            await this.page.waitForLoadState('networkidle', { timeout: 15000 });
            
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
            
            // Critical: Wait for VRL query validation and processing before proceeding
            // The VRL editor needs time to parse and validate the query syntax
            await this.page.waitForLoadState('domcontentloaded');
            await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch (error) {
            throw new Error(`VRL Query filling failed: ${error.message}`);
        }
    }

    async applyQuery() {
        // Wait for refresh button to be ready
        await this.page.waitForSelector(this.refreshButton, { state: 'visible' });
        await this.page.waitForLoadState('networkidle');
        
        // Click on the run query button and wait for response
        const search = this.page.waitForResponse("**/api/**/_search**");
        await this.page.locator(this.refreshButton).click({ force: true });
        
        // Wait for the search response
        const response = await search;
        await expect.poll(async () => response.status()).toBe(200);
        
        // Wait for results to render and process
        await this.page.waitForLoadState('networkidle', { timeout: 5000 });
    }

    async waitForVRLEditorReady() {
        // Critical wait: VRL editor needs time to initialize backend connection after query fill
        // Without this wait, VRL query execution fails silently on first attempt
        // This addresses the race condition between visual editor readiness and processing readiness
        await this.page.waitForTimeout(3000);
        
        // Ensure DOM is stable after editor initialization
        await this.page.waitForLoadState('domcontentloaded');
    }

    async applyQueryMultipleClicks() {
        // Click run query button multiple times to ensure it registers (VRL test specific)
        const refreshButton = this.page.locator(this.refreshButton);
        await refreshButton.waitFor({ state: 'visible' });
        
        for (let i = 0; i < 4; i++) {
            await refreshButton.click({ force: true });
            if (i < 3) { // Wait between clicks except after last click
                await this.page.waitForLoadState('domcontentloaded');
                await this.page.waitForLoadState('networkidle', { timeout: 1000 });
            }
        }
        
        // Wait for query execution to complete
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    }

    async verifyNoQueryWarning() {
        // Wait for potential warnings to appear by checking DOM state
        await this.page.waitForLoadState('domcontentloaded');
        
        const warningElement = this.page.locator(this.warningQueryExecution);
        await expect(warningElement).toBeHidden();
    }

    async expandFirstLogRow() {
        await this.page.waitForLoadState('networkidle', { timeout: 60000 });
        await this.page.waitForTimeout(1000);

        // Additional run query clicks to ensure VRL enrichment is fully processed
        const refreshButton = this.page.locator(this.refreshButton);
        if (await refreshButton.isVisible()) {
            for (let i = 0; i < 3; i++) {
                await refreshButton.click({ force: true });
                await this.page.waitForLoadState('domcontentloaded');
                await this.page.waitForTimeout(2000);
                await this.page.waitForLoadState('networkidle', { timeout: 10000 });
            }
        }
        
        // Wait for timestamp column to be visible and stable
        await this.page.waitForSelector(this.timestampColumn, { state: 'visible' });
        const expandButton = this.page.locator(this.timestampColumn).locator(this.expandMenu);
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
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        
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
                    await this.page.waitForLoadState('networkidle', { timeout: 5000 });
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
        await this.page.getByLabel(this.nameLabel).fill(testName);
        await this.page.getByRole('button', { name: this.saveButton }).click();
        await this.page.getByText(this.csvRequiredError).click();
    }

    // Append Data Methods
    async enableAppendDataMode() {
        await this.page.getByRole('button', { name: this.enrichmentTablesButton }).click();
        await this.page.getByLabel(this.appendDataToggle).locator('div').first().click();
    }

    async appendDataToTable(filePath) {
        const inputFile = await this.page.locator(this.fileInput);
        await inputFile.setInputFiles(filePath);
        await this.page.waitForLoadState('networkidle');
        await this.page.getByRole('button', { name: this.saveButton }).click();
        await this.page.waitForLoadState('networkidle');
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
        // Set the file to be uploaded
        const inputFile = await this.page.locator(this.fileInput);
        await inputFile.setInputFiles(filePath);

        // Enter the file name
        await this.page.fill(this.fileNameInput, fileName);

        // Click on 'Save'
        await this.page.getByText(this.saveButton).click({ force: true });
        await this.page.waitForLoadState('networkidle');

        // Search for the uploaded file name
        await this.page.getByPlaceholder(this.searchEnrichmentTable).fill(fileName);
        await this.page.waitForLoadState('networkidle');

        // Verify the file name in the enrichment table
        await this.verifyFileInTable(fileName);
    }

    async exploreWithVRLProcessing(fileName) {
        // Explore the file with VRL query
        await this.page.getByRole("button", { name: this.exploreButton }).waitFor({ state: 'visible' });
        
        // Wait for navigation response before clicking
        const navigationPromise = this.page.waitForLoadState('networkidle', { timeout: 30000 });
        await this.page.getByRole("button", { name: this.exploreButton }).click();
        await navigationPromise;
        
        // Ensure we're on the logs page with additional wait
        await this.page.waitForLoadState('domcontentloaded');
        // Wait for VRL editor initialization to complete
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        
        // Verify we're on the correct page before proceeding
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
            await this.page.waitForLoadState('networkidle');
            testLogger.debug('Navigated to URL with VRL editor enabled');
        }
        
        // Wait for VRL editor to appear after potential URL modification
        try {
            await this.page.waitForSelector(this.vrlEditor, {
                state: 'visible',
                timeout: 3000
            });
        } catch (error) {
            testLogger.warn('VRL editor not visible, clicking show query toggle button');

            // Click the show query toggle button to reveal the VRL editor
            await this.page.locator(this.showQueryToggleBtn).nth(1).click({ force: true });
            await this.page.waitForTimeout(1000);

            // Retry waiting for VRL editor
            await this.page.waitForSelector(this.vrlEditor, {
                state: 'visible',
                timeout: 10000
            });
            testLogger.debug('VRL editor visible after clicking toggle button');
        }
        
        const vrlEditorExists = await this.page.locator('#fnEditor').count();
        testLogger.debug('VRL Editor count after URL logic', { vrlEditorExists });

        // Wait for enrichment table to be fully indexed and available for querying
        testLogger.debug('Waiting for enrichment table to be ready for VRL queries');
        await this.page.waitForTimeout(5000);

        // Now proceed with VRL processing
        await this.fillVRLQuery(fileName);

        // Wait for VRL editor to be fully ready for processing
        await this.waitForVRLEditorReady();

        // Apply query with multiple clicks for VRL test reliability
        await this.applyQueryMultipleClicks();

        // Wait for query results to load
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        await this.page.waitForTimeout(2000);

        // Check if error occurred and retry with additional wait
        const errorDetailsBtn = this.page.locator('[data-test="logs-page-result-error-details-btn"]');
        if (await errorDetailsBtn.isVisible()) {
            testLogger.warn('Error detected after first VRL query attempt, waiting 5s and retrying');

            // Wait additional 5 seconds for enrichment table to be fully ready
            await this.page.waitForTimeout(5000);

            // Retry the query
            await this.applyQueryMultipleClicks();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 });
            await this.page.waitForTimeout(2000);

            // Check again if error persists
            if (await errorDetailsBtn.isVisible()) {
                testLogger.error('Error persists after retry, capturing details');
                await errorDetailsBtn.click();
                await this.page.waitForTimeout(1000);
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
        // First upload step
        const inputFile = await this.page.locator(this.fileInput);
        await inputFile.setInputFiles(filePath);

        // Enter the file name
        await this.page.fill(this.fileNameInput, fileName);

        // Click on 'Save'
        await this.page.getByText(this.saveButton).click({ force: true });
        await this.page.waitForLoadState('networkidle');
        
        // Search and explore the uploaded table
        await this.page.getByPlaceholder(this.searchEnrichmentTable).fill(fileName);
        await this.page.waitForLoadState('networkidle');
    }

    async exploreAndVerifyInitialData() {
        await this.page.getByRole("button", { name: this.exploreButton }).click();
        await this.page.locator(this.dateTimeBtn).click();
        await expect(this.page.getByRole('cell', { name: this.startTimeCell })).toBeVisible();
        await this.page.locator(this.timestampColumn).click();
        await this.page.locator(this.closeDialog).click();
        await this.page.waitForLoadState('networkidle');
    }

    async navigateAndAppendData(fileName, filePath) {
        // Navigate to append data to the existing enrichment table
        await this.page.locator(this.pipelineMenuItem).click();
        await this.page.locator(this.enrichmentTableTab).click();
        await this.page.getByPlaceholder(this.searchEnrichmentTable).fill(fileName);
        await this.page.getByRole("button", { name: this.enrichmentTablesButton }).click();

        // Select the append toggle
        await this.page.getByLabel(this.appendDataToggle).locator("div").first().click();

        // Upload the CSV again for appending
        const inputFile = await this.page.locator(this.fileInput);
        await inputFile.setInputFiles(filePath);
        await this.page.waitForLoadState('networkidle');
        await this.page.getByRole('button', { name: this.saveButton }).click();
        await this.page.waitForLoadState('networkidle');
    }

    async verifyAppendedData(fileName) {
        // Verify appended data
        await this.page.getByPlaceholder(this.searchEnrichmentTable).fill(fileName);
        await this.page.waitForLoadState('networkidle');
        await this.page.getByRole("button", { name: this.exploreButton }).click();

        // Verify row count increased
        const showingText = this.page.getByText(this.showingText);
        await expect(showingText).toBeVisible();
    }

    async testCSVValidationError() {
        await this.attemptSaveWithoutFile('test');
    }

    async attemptSaveWithoutName(filePath) {
        // Upload file WITHOUT entering name
        const inputFile = await this.page.locator(this.fileInput);
        await inputFile.setInputFiles(filePath);

        // Click save without entering name
        await this.page.getByRole('button', { name: this.saveButton }).click();

        // Wait for and verify error message
        await this.page.getByText('Field is required!').waitFor({ state: 'visible' });
    }

    async clickCancelButton() {
        await this.page.getByRole('button', { name: 'Cancel' }).click();
        await this.page.waitForLoadState('networkidle');
    }

    async verifyBackOnEnrichmentList() {
        // Verify we're back on enrichment tables list page by checking for unique element
        await this.page.locator('.q-table__title').filter({ hasText: 'Enrichment Tables' }).waitFor({ state: 'visible' });
    }

    async searchEnrichmentTableInList(tableName) {
        // Wait for page to stabilize
        await this.page.waitForLoadState('networkidle');

        // Use getByPlaceholder which works reliably with Quasar q-input components
        // Directly wait for search input instead of title - search input visibility indicates page is ready
        const searchInput = this.page.getByPlaceholder(/search enrichment table/i);
        await searchInput.waitFor({ state: 'visible', timeout: 30000 });

        // Clear existing search first
        await searchInput.clear();
        await this.page.waitForTimeout(500);

        // Fill the search input with table name to filter results
        await searchInput.fill(tableName);
        await this.page.waitForLoadState('networkidle');

        // Wait for search to process
        await this.page.waitForTimeout(1000);
    }

    async verifyTableVisibleInList(tableName) {
        const exploreBtn = this.page.locator(`[data-test="${tableName}-explore-btn"]`);
        await expect(exploreBtn).toBeVisible();
    }

    async clickSchemaButton(tableName) {
        // Find the row with the table and click schema button (2nd button, list_alt icon)
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        // Buttons order: Explore (0), Schema (1), Edit (2), Delete (3)
        await row.locator('button').nth(1).click();
        await this.page.waitForLoadState('networkidle');
    }

    async verifySchemaModalVisible() {
        await this.page.locator('[data-test="schema-title-text"]').waitFor({ state: 'visible' });
    }

    async clickEditButton(tableName) {
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        // Buttons order: Explore (0), Schema (1), Edit (2), Delete (3)
        await row.locator('button').nth(2).click();
        await this.page.waitForLoadState('networkidle');
    }

    async verifyUpdateMode() {
        await this.page.getByText('Update Enrichment Table').waitFor({ state: 'visible' });
    }

    async verifyNameFieldDisabled() {
        const nameInput = this.page.locator(this.fileNameInput);
        // Check if the input is disabled using Playwright's built-in method
        await expect(nameInput).toBeDisabled();
    }

    async clickDeleteButton(tableName) {
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        // Buttons order: Explore (0), Schema (1), Edit (2), Delete (3)
        await row.locator('button').nth(3).click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async verifyDeleteConfirmationDialog() {
        // Use more specific selector to avoid duplicate text - look for the dialog container
        await this.page.locator('.q-dialog').getByText('Delete Enrichment Table', { exact: true }).first().waitFor({ state: 'visible' });
        await this.page.getByText('Are you sure you want to delete enrichment table?').waitFor({ state: 'visible' });
    }

    async clickDeleteCancel() {
        await this.page.getByRole('button', { name: 'Cancel' }).click();
        await this.page.waitForLoadState('domcontentloaded');
    }

    async clickDeleteOK() {
        await this.page.getByRole('button', { name: 'OK' }).click();
        await this.page.waitForLoadState('networkidle');
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

        // Wait for the radio group to be visible
        const radioGroup = this.page.locator('.q-option-group').first();
        await radioGroup.waitFor({ state: 'visible', timeout: 10000 });

        // Click the appropriate radio button by label text
        if (option === 'url') {
            await this.page.getByText('From URL', { exact: true }).click();
        } else {
            await this.page.getByText('Upload File', { exact: true }).click();
        }

        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug(`Selected source option: ${option}`);
    }

    /**
     * Fill the URL input field
     * @param {string} url - CSV file URL
     */
    async fillUrlInput(url) {
        testLogger.debug(`Filling URL input: ${url}`);

        // Wait for URL input to be visible - use label locator for specificity to avoid AI assistant conflict
        const urlInput = this.page.locator('label:has-text("CSV File URL")').locator('..').locator('input[aria-label="CSV File URL"]');

        await urlInput.waitFor({ state: 'visible', timeout: 10000 });
        await urlInput.fill(url);

        testLogger.debug('URL input filled');
    }

    /**
     * Create enrichment table from URL - Complete workflow
     * @param {string} tableName - Name of the enrichment table
     * @param {string} csvUrl - URL to CSV file
     */
    async createEnrichmentTableFromUrl(tableName, csvUrl) {
        testLogger.debug(`Creating enrichment table from URL: ${tableName}`);

        // Fill in table name
        const nameInput = this.page.locator('.q-field__native').first();
        await nameInput.waitFor({ state: 'visible', timeout: 10000 });
        await nameInput.fill(tableName);
        testLogger.debug(`Table name filled: ${tableName}`);

        // Select "From URL" option
        await this.selectSourceOption('url');

        // Fill URL input
        await this.fillUrlInput(csvUrl);

        // Click Save button (wait for it to be actionable)
        await this.page.getByRole('button', { name: 'Save' }).click();
        testLogger.debug('Save button clicked');

        // Wait for save to complete
        await this.page.waitForLoadState('networkidle');

        // Wait for form to close (returned to list)
        await this.page.locator(this.addEnrichmentTableTitle).waitFor({ state: 'hidden', timeout: 15000 });
        testLogger.debug('Returned to enrichment tables list');

        // Wait for backend to register the table (CI environments are slower)
        await this.page.waitForTimeout(5000);

        // Hard reload the page to ensure fresh API data
        // This is more reliable than menu navigation in CI environments
        await this.page.reload({ waitUntil: 'networkidle' });
        testLogger.debug('Page reloaded for fresh data');

        // Wait for the enrichment tables list to be visible after reload
        await this.page.locator('.q-table__title').filter({ hasText: 'Enrichment Tables' }).waitFor({ state: 'visible', timeout: 15000 });
        testLogger.debug('Enrichment tables list visible with fresh data');
    }

    /**
     * Verify URL validation error message
     * @param {string} errorMessage - Expected error message
     */
    async verifyUrlValidationError(errorMessage) {
        testLogger.debug(`Verifying URL validation error: ${errorMessage}`);

        const errorLocator = this.page.getByText(errorMessage);
        await expect(errorLocator).toBeVisible();

        testLogger.debug('URL validation error verified');
    }

    /**
     * Verify table type in the list (File or Url)
     * @param {string} tableName - Name of the table
     * @param {string} expectedType - "File" or "Url"
     */
    async verifyTableType(tableName, expectedType) {
        testLogger.debug(`Verifying table type for ${tableName}: expecting ${expectedType}`);

        // Find the row with the table name
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await row.waitFor({ state: 'visible', timeout: 10000 });

        // Get the "Type" column text - it's the 3rd text-left column (index 2)
        const typeCell = row.locator('td.text-left').nth(2);
        const typeText = await typeCell.textContent();

        testLogger.debug(`Table type text: ${typeText}`);

        if (expectedType === 'Url') {
            // URL-based tables show "Url (N)" format or just "Url"
            expect(typeText).toMatch(/Url(\s*\(\d+\))?/i);
        } else {
            expect(typeText).toContain(expectedType);
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
        let currentStatus = 'processing';
        let attempts = 0;

        while (Date.now() - startTime < timeout) {
            attempts++;
            const elapsed = Date.now() - startTime;
            testLogger.debug(`Polling attempt ${attempts}, elapsed: ${elapsed}ms`);

            // Reload page to get fresh DOM state from server
            await this.page.reload({ waitUntil: 'networkidle' });

            // Find the row with table name
            const row = this.page.locator('tbody tr').filter({ hasText: tableName });

            try {
                await row.waitFor({ state: 'visible', timeout: 5000 });
            } catch (error) {
                testLogger.warn(`Row not found for table ${tableName}, attempt ${attempts}`);
                await this.page.waitForTimeout(5000);
                continue;
            }

            // Check for status icons in the Type column (3rd column)
            const typeCell = row.locator('td').nth(2);

            // Check for completed icon (green check)
            const completedIcon = typeCell.locator('[name="check_circle"]');
            if (await completedIcon.isVisible().catch(() => false)) {
                currentStatus = 'completed';
                testLogger.info(`URL job completed for ${tableName} after ${elapsed}ms (${attempts} attempts)`);
                return 'completed';
            }

            // Check for failed icon (red warning)
            const failedIcon = typeCell.locator('[name="warning"]');
            if (await failedIcon.isVisible().catch(() => false)) {
                currentStatus = 'failed';
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

        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await row.waitFor({ state: 'visible', timeout: 10000 });

        const typeCell = row.locator('td').nth(2);

        let iconLocator;
        switch (expectedStatus) {
            case 'completed':
                iconLocator = typeCell.locator('[name="check_circle"]');
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

        // Wait for update mode radio group to be visible
        await this.page.locator('text=/Update Mode/i').waitFor({ state: 'visible', timeout: 10000 });

        // Click the appropriate mode
        switch (mode) {
            case 'reload':
                await this.page.getByText('Reload', { exact: true }).click();
                break;
            case 'append':
                await this.page.getByText('Append', { exact: true }).click();
                break;
            case 'replace_failed':
                await this.page.getByText('Replace Failed URL', { exact: true }).click();
                break;
            case 'replace':
                await this.page.getByText('Replace', { exact: true }).click();
                break;
            default:
                throw new Error(`Unknown update mode: ${mode}`);
        }

        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug(`Update mode selected: ${mode}`);
    }

    /**
     * Cancel enrichment table form (create or update)
     */
    async cancelEnrichmentTableForm() {
        testLogger.debug('Canceling enrichment table form');

        await this.page.getByRole('button', { name: 'Cancel' }).click();
        await this.page.waitForLoadState('networkidle');

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

        // Fill name
        const nameInput = this.page.locator('.q-field__native').first();
        await nameInput.fill(tableName);

        // Select "From URL"
        await this.selectSourceOption('url');

        // Fill invalid URL
        await this.fillUrlInput(invalidUrl);

        // Attempt to save
        await this.page.getByRole('button', { name: 'Save' }).click({ force: true });

        // Wait for validation error to appear
        await this.page.waitForTimeout(1000);

        testLogger.debug('Save attempted with invalid URL');
    }

    /**
     * Toggle source selection between file and URL
     */
    async toggleSourceSelection() {
        testLogger.debug('Toggling source selection');

        // Check current selection
        const urlRadio = this.page.getByText('From URL', { exact: true });
        const fileRadio = this.page.getByText('Upload File', { exact: true });

        // Toggle to opposite
        if (await urlRadio.locator('..').locator('.q-radio__inner--truthy').isVisible().catch(() => false)) {
            // Currently URL, switch to File
            await fileRadio.click();
            testLogger.debug('Toggled from URL to File');
        } else {
            // Currently File, switch to URL
            await urlRadio.click();
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

        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await expect(row).toBeVisible({ timeout: 20000 });

        testLogger.debug('Table row verified visible');
    }

    /**
     * Fill name input field (for custom form filling)
     * @param {string} name - Name to fill
     */
    async fillNameInput(name) {
        testLogger.debug(`Filling name input: ${name}`);

        const nameInput = this.page.locator('.q-field__native').first();
        await nameInput.fill(name);

        testLogger.debug('Name input filled');
    }

    /**
     * Verify no data message or empty table
     * @param {string} tableName - Table name to check doesn't exist
     */
    async verifyTableNotCreated(tableName) {
        testLogger.debug(`Verifying table ${tableName} was NOT created`);

        const noDataMessage = this.page.getByText(/no data available/i);
        const isNoDataVisible = await noDataMessage.isVisible().catch(() => false);

        if (!isNoDataVisible) {
            // If no "no data" message, verify the table name is NOT in the list
            const tableRow = this.page.locator('tbody tr').filter({ hasText: tableName });
            const rowCount = await tableRow.count();
            expect(rowCount).toBe(0);
        }

        testLogger.debug('Verified table does not exist');
    }

    /**
     * Verify table row is hidden after deletion
     * @param {string} tableName - Name of deleted table
     */
    async verifyTableRowHidden(tableName) {
        testLogger.debug(`Verifying table row hidden: ${tableName}`);

        // Wait a moment for deletion to process
        await this.page.waitForTimeout(2000);

        const tableRow = this.page.locator('tbody tr').filter({ hasText: tableName });
        await expect(tableRow).toBeHidden();

        testLogger.debug('Table row verified hidden');
    }

    /**
     * Expect URL input to be visible
     */
    async expectUrlInputVisible() {
        testLogger.debug('Verifying URL input is visible');

        const urlInput = this.page.locator('input[placeholder*="http"]');
        await expect(urlInput).toBeVisible();

        testLogger.debug('URL input verified visible');
    }

    /**
     * Expect file input to be visible
     */
    async expectFileInputVisible() {
        testLogger.debug('Verifying file input is visible');

        const fileInput = this.page.locator('input[type="file"]');
        await expect(fileInput).toBeVisible();

        testLogger.debug('File input verified visible');
    }

    /**
     * Save update mode changes
     */
    async saveUpdateMode() {
        testLogger.debug('Saving update mode changes');

        await this.page.getByRole('button', { name: 'Save' }).click();
        await this.page.waitForLoadState('networkidle');

        testLogger.debug('Update mode saved');
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
        await this.page.waitForLoadState('networkidle');

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

        const logDetailPanel = this.page.locator('.log-detail-container, [data-test="log-detail-json-content"], .q-expansion-item--expanded');
        await expect(logDetailPanel.first()).toBeVisible({ timeout: 10000 });

        testLogger.debug('Log detail panel verified visible');
    }

    /**
     * Close any open dialogs/modals by pressing Escape
     */
    async closeAnyOpenDialogs() {
        testLogger.debug('Closing any open dialogs');

        // Press Escape to close any open dialogs/modals
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);

        testLogger.debug('Dialogs closed');
    }
}

module.exports = { EnrichmentPage };
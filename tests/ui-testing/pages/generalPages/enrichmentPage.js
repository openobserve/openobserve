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

    /**
     * Expect OpenAPI menu item to be visible (fails test if not visible)
     * Rule 5 compliant - no graceful skipping
     * @param {Object} options - Options object
     * @param {number} options.timeout - Timeout in milliseconds (default 10000)
     */
    async expectOpenApiMenuItemVisible(options = {}) {
        const timeout = options.timeout || 10000;
        testLogger.info('Verifying OpenAPI menu item is visible');
        const openApiMenuItem = this.page.locator(this.openApiMenuItem).first();
        await expect(openApiMenuItem).toBeVisible({ timeout });
        testLogger.info('OpenAPI menu item verified visible');
    }

    /**
     * Get the data source radio group locator
     * @returns {import('@playwright/test').Locator} Radio group locator
     */
    getDataSourceRadioGroup() {
        return this.page.locator(this.sourceRadioGroup);
    }

    /**
     * Click the "From URL" option in the data source selector
     */
    async clickFromUrlOption() {
        testLogger.debug('Clicking From URL option');
        await this.page.getByText('From URL', { exact: true }).click();
        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug('From URL option clicked');
    }

    /**
     * Check if "From URL" option is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isFromUrlOptionVisible() {
        return this.page.getByText('From URL', { exact: true }).isVisible().catch(() => false);
    }

    /**
     * Click the "Upload File" option in the data source selector
     */
    async clickUploadFileOption() {
        testLogger.debug('Clicking Upload File option');
        await this.page.getByText('Upload File', { exact: true }).click();
        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug('Upload File option clicked');
    }

    /**
     * Check if "Upload File" option is visible
     * @returns {Promise<boolean>} True if visible
     */
    async isUploadFileOptionVisible() {
        return this.page.getByText('Upload File', { exact: true }).isVisible().catch(() => false);
    }

    /**
     * Get the form input locator (first native input field)
     * @returns {import('@playwright/test').Locator} Form input locator
     */
    getFormInput() {
        return this.page.locator('.q-field__native').first();
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
        // Look for schema modal/dialog with schema content
        const schemaModal = this.page.locator('.q-dialog').filter({ hasText: /schema|field|type/i });
        await schemaModal.waitFor({ state: 'visible', timeout: 15000 });
    }

    async clickEditButton(tableName) {
        testLogger.debug(`Clicking edit button for: ${tableName}`);
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await row.waitFor({ state: 'visible', timeout: 10000 });

        // Find edit button - it's the second-to-last button (before delete)
        // For file tables: Explore (0), Schema (1), Edit (2), Delete (3)
        // For URL tables: Edit (0), Delete (1)
        const buttons = row.locator('button');
        const buttonCount = await buttons.count();
        testLogger.debug(`Found ${buttonCount} buttons in row`);

        // Bounds check: need at least 2 buttons (edit + delete)
        if (buttonCount < 2) {
            throw new Error(`Expected at least 2 buttons in row for table "${tableName}", found ${buttonCount}. Job may still be processing.`);
        }

        // Edit button is always second-to-last (before delete)
        const editBtnIndex = buttonCount - 2;
        const editBtn = buttons.nth(editBtnIndex);
        await editBtn.waitFor({ state: 'visible', timeout: 10000 });
        await editBtn.click();
        await this.page.waitForLoadState('networkidle');
        // Wait for edit form to start loading
        await this.page.waitForTimeout(1000);
        testLogger.debug('Edit button clicked');
    }

    async verifyUpdateMode() {
        testLogger.debug('Verifying update mode form is visible');
        // Wait for the update form with longer timeout for CI environments
        await this.page.getByText('Update Enrichment Table').waitFor({ state: 'visible', timeout: 30000 });
        // Wait for form to fully load
        await this.page.waitForLoadState('networkidle');
        // Additional wait for form elements to render (radio buttons, inputs, etc.)
        await this.page.waitForTimeout(3000);
        // Verify at least one form element is present (Name field or radio group)
        const formElement = this.page.locator('.q-field, .q-option-group, .q-radio').first();
        await formElement.waitFor({ state: 'visible', timeout: 10000 });
        testLogger.debug('Update mode form verified visible and loaded');
    }

    async verifyNameFieldDisabled() {
        const nameInput = this.page.locator(this.fileNameInput);
        // Check if the input is disabled using Playwright's built-in method
        await expect(nameInput).toBeDisabled();
    }

    async clickDeleteButton(tableName) {
        testLogger.debug(`Clicking delete button for: ${tableName}`);
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await row.waitFor({ state: 'visible', timeout: 10000 });

        // Delete button is always the last button in the row
        // For file tables: Explore (0), Schema (1), Edit (2), Delete (3)
        // For URL tables: Edit (0), Delete (1)
        const buttons = row.locator('button');
        const buttonCount = await buttons.count();
        testLogger.debug(`Found ${buttonCount} buttons in row`);

        // Bounds check: need at least 1 button (delete)
        if (buttonCount < 1) {
            throw new Error(`Expected at least 1 button in row for table "${tableName}", found ${buttonCount}. Job may still be processing.`);
        }

        // Delete is always the last button
        const deleteBtn = buttons.nth(buttonCount - 1);
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.click();
        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug('Delete button clicked');
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
     * Fill the New CSV File URL input field (used in append/edit mode)
     * @param {string} url - New CSV file URL
     */
    async fillNewUrlInput(url) {
        testLogger.debug(`Filling new URL input: ${url}`);

        // In edit/append mode, the field is labeled "New CSV File URL"
        const newUrlInput = this.page.getByPlaceholder('https://example.com/data.csv');

        await newUrlInput.waitFor({ state: 'visible', timeout: 10000 });
        await newUrlInput.fill(url);

        testLogger.debug('New URL input filled');
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

        // Wait for form to fully load - the update mode options may take time to render in CI
        await this.page.waitForLoadState('networkidle');

        // First, ensure we're on the Update form (wait for title with longer timeout for CI)
        const updateTitle = this.page.getByText('Update Enrichment Table');
        await updateTitle.waitFor({ state: 'visible', timeout: 30000 });
        testLogger.debug('Update form title visible');

        // Wait for option group or radio elements to appear (CI renders slower)
        const optionGroupIndicators = [
            '.q-option-group',
            '.q-radio',
            '[role="radiogroup"]',
            'text=/Update Mode/i'
        ];

        let formReady = false;
        for (let waitAttempt = 1; waitAttempt <= 6 && !formReady; waitAttempt++) {
            testLogger.debug(`Waiting for form elements - attempt ${waitAttempt}/6`);

            for (const indicator of optionGroupIndicators) {
                const locator = this.page.locator(indicator).first();
                if (await locator.isVisible({ timeout: 2000 }).catch(() => false)) {
                    formReady = true;
                    testLogger.debug(`Form element found: ${indicator}`);
                    break;
                }
            }

            if (!formReady) {
                await this.page.waitForTimeout(2000);
            }
        }

        // Scroll the dialog content to ensure all elements are visible
        const dialogContent = this.page.locator('.q-dialog .q-card, .q-dialog__inner');
        await dialogContent.first().evaluate(el => {
            el.scrollTop = 0;
            // Scroll down slowly to trigger any lazy loading
            const scrollHeight = el.scrollHeight;
            el.scrollTop = scrollHeight / 2;
        }).catch(() => {});
        await this.page.waitForTimeout(1000);

        // Try multiple selector strategies for the update mode options
        const modeSelectors = {
            reload: [
                'Reload existing URLs',
                'Reload existing',
                'Reload',
                'Re-process existing URLs',
                'Re-process'
            ],
            append: [
                'Add new URL',
                'Add URL',
                'Append URL',
                'Append'
            ],
            replace: [
                'Replace all URLs',
                'Replace all',
                'Replace URLs',
                'Replace'
            ]
        };

        const selectors = modeSelectors[mode];
        if (!selectors) {
            throw new Error(`Unknown update mode: ${mode}`);
        }

        // Try each selector until one works - with multiple attempts
        let clicked = false;
        for (let attempt = 1; attempt <= 5 && !clicked; attempt++) {
            testLogger.debug(`Attempt ${attempt} to find update mode option for: ${mode}`);

            for (const selector of selectors) {
                const locator = this.page.getByText(selector, { exact: false });
                try {
                    // Try to scroll into view first
                    await locator.first().scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});

                    const isVisible = await locator.first().isVisible({ timeout: 3000 }).catch(() => false);
                    if (isVisible) {
                        await locator.first().click();
                        clicked = true;
                        testLogger.debug(`Clicked update mode option: ${selector}`);
                        break;
                    }
                } catch {
                    continue;
                }
            }

            if (!clicked && attempt < 5) {
                // Wait and retry
                await this.page.waitForTimeout(3000);
                // Try scrolling to bottom to reveal options
                await dialogContent.first().evaluate(el => {
                    el.scrollTop = el.scrollHeight;
                }).catch(() => {});
            }
        }

        if (!clicked) {
            // Log visible text in the form for debugging
            const formText = await this.page.locator('.q-dialog, .q-card').first().textContent().catch(() => 'Unable to get form text');
            testLogger.error(`Form content: ${formText}`);

            // Count all radio-like elements
            const radioButtons = this.page.locator('.q-radio, [role="radio"], input[type="radio"]');
            const count = await radioButtons.count();
            testLogger.error(`Found ${count} radio elements in form`);

            // Take screenshot for debugging
            await this.page.screenshot({ path: 'test-results/update-mode-debug.png', fullPage: true });

            throw new Error(`Could not find update mode option for: ${mode}. Tried selectors: ${selectors.join(', ')}. Found ${count} radio elements. Check screenshot at test-results/update-mode-debug.png`);
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

        // Wait for form to close (returned to list)
        await this.page.locator(this.updateEnrichmentTableTitle).waitFor({ state: 'hidden', timeout: 15000 });
        testLogger.debug('Returned to enrichment tables list');

        // Wait for backend to process the update (CI environments are slower)
        await this.page.waitForTimeout(3000);

        // Reload page to ensure fresh data
        await this.page.reload({ waitUntil: 'networkidle' });

        // Wait for the enrichment tables list to be visible after reload
        await this.page.locator('.q-table__title').filter({ hasText: 'Enrichment Tables' }).waitFor({ state: 'visible', timeout: 15000 });

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

    // ============================================================================
    // SCHEMA MODAL METHODS
    // ============================================================================

    /**
     * Verify schema columns are displayed in the modal
     * @param {string[]} expectedColumns - Array of expected column names
     */
    async verifySchemaColumns(expectedColumns) {
        testLogger.debug(`Verifying schema columns: ${expectedColumns.join(', ')}`);

        // Wait for schema modal to be visible
        await this.page.locator('[data-test="schema-title-text"]').waitFor({ state: 'visible', timeout: 10000 });

        // Verify each expected column is present
        for (const column of expectedColumns) {
            const columnLocator = this.page.locator('.schema-container, .q-table').getByText(column, { exact: false });
            await expect(columnLocator.first()).toBeVisible({ timeout: 5000 });
        }

        testLogger.debug('Schema columns verified');
    }

    /**
     * Close the schema modal
     */
    async closeSchemaModal() {
        testLogger.debug('Closing schema modal');

        await this.page.keyboard.press('Escape');
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

        const errorLocator = this.page.getByText(/URL is required|Please enter.*URL|URL cannot be empty/i);
        await expect(errorLocator.first()).toBeVisible({ timeout: 10000 });

        testLogger.debug('Empty URL error verified');
    }

    /**
     * Verify duplicate table name error
     */
    async verifyDuplicateNameError() {
        testLogger.debug('Verifying duplicate name error');

        // Look for error notification/banner with duplicate name message
        // The error message may vary - try multiple patterns
        const errorPatterns = [
            /already exists/i,
            /duplicate/i,
            /name.*taken/i,
            /table.*exists/i,
            /enrichment.*exists/i
        ];

        let errorFound = false;
        for (const pattern of errorPatterns) {
            const errorLocator = this.page.locator('.q-notification__message, .q-banner, [role="alert"], .text-negative').filter({
                hasText: pattern
            });
            if (await errorLocator.first().isVisible({ timeout: 3000 }).catch(() => false)) {
                errorFound = true;
                break;
            }
        }

        if (!errorFound) {
            // Fallback: check for any notification that appeared
            const anyNotification = this.page.locator('.q-notification');
            await expect(anyNotification.first()).toBeVisible({ timeout: 15000 });
        }

        testLogger.debug('Duplicate name error verified');
    }

    /**
     * Attempt to save with empty URL
     * @param {string} tableName - Name of the table
     */
    async attemptSaveWithEmptyUrl(tableName) {
        testLogger.debug(`Attempting to save with empty URL: ${tableName}`);

        // Fill in table name
        const nameInput = this.page.locator('.q-field__native').first();
        await nameInput.fill(tableName);

        // Select URL option
        await this.selectSourceOption('url');

        // Don't fill URL - leave it empty

        // Click Save
        await this.page.getByRole('button', { name: 'Save' }).click();

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

        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await row.waitFor({ state: 'visible', timeout: 10000 });

        // Look for "Url (N)" pattern in the Type column
        // For count of 1, UI might just show "Url" without the count
        if (expectedCount === 1) {
            // Try both patterns: "Url (1)" or just "Url"
            const urlCountText = row.getByText('Url (1)');
            const urlOnlyText = row.locator('td').filter({ hasText: /^Url$/ });

            const hasUrlCount = await urlCountText.isVisible({ timeout: 3000 }).catch(() => false);
            const hasUrlOnly = await urlOnlyText.isVisible({ timeout: 3000 }).catch(() => false);

            if (!hasUrlCount && !hasUrlOnly) {
                // Fallback: verify it's a Url type table
                const urlType = row.getByText(/Url/);
                await expect(urlType.first()).toBeVisible({ timeout: 10000 });
            }
        } else {
            const urlCountText = `Url (${expectedCount})`;
            const typeCell = row.getByText(urlCountText);
            await expect(typeCell).toBeVisible({ timeout: 10000 });
        }

        testLogger.debug(`URL count verified: ${expectedCount}`);
    }

    /**
     * Verify existing URLs are displayed in edit mode
     * @param {string} expectedUrl - Expected URL to be shown
     */
    async verifyExistingUrlInEditMode(expectedUrl) {
        testLogger.debug(`Verifying existing URL in edit mode: ${expectedUrl}`);

        // Look for the "Existing URLs (N)" header specifically
        const existingUrlsHeader = this.page.getByText(/^Existing URLs \(\d+\)$/);
        await existingUrlsHeader.waitFor({ state: 'visible', timeout: 10000 });

        // Verify the URL is displayed somewhere on the page
        const urlLocator = this.page.getByText(expectedUrl, { exact: false });
        await expect(urlLocator.first()).toBeVisible({ timeout: 5000 });

        testLogger.debug('Existing URL verified');
    }

    /**
     * Verify existing URLs count in edit mode
     * @param {number} expectedCount - Expected number of existing URLs
     */
    async verifyExistingUrlsCount(expectedCount) {
        testLogger.debug(`Verifying existing URLs count: ${expectedCount}`);

        // Look for "Existing URLs (N)" text
        const existingUrlsText = this.page.getByText(`Existing URLs (${expectedCount})`);
        await expect(existingUrlsText).toBeVisible({ timeout: 10000 });

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
        await this.page.getByRole('button', { name: 'Save' }).click();
        await this.page.waitForLoadState('networkidle');
        testLogger.debug('Save button clicked');
    }

    /**
     * Wait for the Add Enrichment Table form to close
     * @param {number} timeout - Timeout in milliseconds (default 15000)
     * @returns {Promise<boolean>} True if form closed, false if still visible
     */
    async waitForAddFormToClose(timeout = 15000) {
        testLogger.debug('Waiting for Add Enrichment Table form to close');
        const formTitle = this.page.getByText('Add Enrichment Table');
        const formHidden = await formTitle.waitFor({ state: 'hidden', timeout }).then(() => true).catch(() => false);
        testLogger.debug(`Form closed: ${formHidden}`);
        return formHidden;
    }

    /**
     * Check for error notification and return its text if visible
     * @returns {Promise<{hasError: boolean, errorText: string|null}>}
     */
    async checkForErrorNotification() {
        testLogger.debug('Checking for error notification');
        const errorNotification = this.page.locator('.q-notification__message, .q-banner, [role="alert"]');
        const hasError = await errorNotification.first().isVisible({ timeout: 5000 }).catch(() => false);

        if (hasError) {
            const errorText = await errorNotification.first().textContent();
            testLogger.debug(`Error notification found: ${errorText}`);
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

        const cancelBtn = this.page.getByRole('button', { name: 'Cancel' });
        const isCancelVisible = await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false);

        if (isCancelVisible) {
            try {
                // Use click with shorter timeout and handle detachment gracefully
                await cancelBtn.click({ timeout: 5000 });
                await this.page.waitForLoadState('networkidle');
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
        await this.page.locator('.q-table__title').filter({ hasText: 'Enrichment Tables' }).waitFor({ state: 'visible', timeout });
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

            // Clear search and search again
            const searchInput = this.page.getByPlaceholder(/search enrichment table/i);
            await searchInput.clear();
            await this.page.waitForTimeout(1000);
            await searchInput.fill(tableName);
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);

            // Use isVisible with catch instead of expect to avoid race condition
            const row = this.page.locator('tbody tr').filter({ hasText: tableName });
            const isVisible = await row.isVisible({ timeout: 10000 }).catch(() => false);

            if (isVisible) {
                testLogger.info('Table found in list');
                return { found: true, row };
            }

            if (attempt < maxAttempts) {
                testLogger.info('Table not found yet, waiting and retrying...');
                await this.page.waitForTimeout(5000);
                await this.page.reload({ waitUntil: 'networkidle' });
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
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await row.waitFor({ state: 'visible', timeout: 10000 });

        // Find the Type cell that contains "Url" text and click the icon next to it
        // The icon can be: clock (processing), warning (failed), check_circle (completed)
        const typeCell = row.locator('td').filter({ hasText: 'Url' });
        await typeCell.waitFor({ state: 'visible', timeout: 10000 });

        // Click on the icon within the Type cell
        const statusIcon = typeCell.locator('i, .q-icon, svg').first();
        if (await statusIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
            await statusIcon.click();
        } else {
            // Fallback: click on the cell itself
            testLogger.debug('No icon found, clicking on Type cell');
            await typeCell.click();
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

        // Wait for dialog with title "URL Jobs for <tableName>"
        const dialogTitle = this.page.getByText(`URL Jobs for ${tableName}`);
        await dialogTitle.waitFor({ state: 'visible', timeout: 15000 });

        testLogger.debug('URL Jobs dialog is visible');
    }

    /**
     * Verify a job shows failed status in URL Jobs dialog
     */
    async verifyJobFailed() {
        testLogger.debug('Verifying job failed');

        // Look for the failed badge (use first() to avoid strict mode violation)
        const failedBadge = this.page.locator('.q-dialog .q-badge').filter({ hasText: 'failed' }).first();
        await expect(failedBadge).toBeVisible({ timeout: 10000 });

        testLogger.debug('Job failed status verified');
    }

    /**
     * Verify URL Jobs dialog shows a specific error message
     * @param {RegExp|string} errorPattern - Error message pattern to look for
     */
    async verifyJobError(errorPattern) {
        testLogger.debug(`Verifying job error matches: ${errorPattern}`);

        const errorMessage = this.page.locator('.q-dialog').getByText(errorPattern);
        await expect(errorMessage.first()).toBeVisible({ timeout: 10000 });

        testLogger.debug('Job error verified');
    }

    /**
     * Verify a job shows completed status
     */
    async verifyJobCompleted() {
        testLogger.debug('Verifying job completed');

        // Look for the completed badge
        const completedBadge = this.page.locator('.q-dialog').getByText('completed');
        await expect(completedBadge).toBeVisible({ timeout: 10000 });

        testLogger.debug('Job completed status verified');
    }

    /**
     * Close the URL Jobs dialog
     */
    async closeUrlJobsDialog() {
        testLogger.debug('Closing URL Jobs dialog');

        // Try clicking X button, fallback to pressing Escape
        const closeBtn = this.page.locator('.q-dialog [aria-label="Close"], .q-dialog .q-btn--flat').first();
        if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await closeBtn.click();
        } else {
            await this.page.keyboard.press('Escape');
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
            await this.page.reload({ waitUntil: 'networkidle' });
            await this.waitForEnrichmentTablesList();
            await this.searchEnrichmentTableInList(tableName);

            // Check for red/warning icon in the row - look in the Type cell (contains "Url")
            const row = this.page.locator('tbody tr').filter({ hasText: tableName });
            const typeCell = row.locator('td').filter({ hasText: 'Url' });
            const warningIcon = typeCell.locator('[class*="warning"], [style*="red"], .text-negative');

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
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);

        // Try multiple strategies to find and fill the URL input
        const urlInputSelectors = [
            'input[placeholder*="http"]',
            'input[aria-label*="URL"]',
            'input[aria-label*="url"]',
            '.q-field__native[type="text"]'
        ];

        let inputFilled = false;
        for (const selector of urlInputSelectors) {
            const inputs = this.page.locator(selector);
            const count = await inputs.count();
            testLogger.debug(`Found ${count} inputs matching: ${selector}`);

            for (let i = 0; i < count; i++) {
                const input = inputs.nth(i);
                if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
                    // Check if it's empty or a URL field
                    const value = await input.inputValue().catch(() => '');
                    const placeholder = await input.getAttribute('placeholder').catch(() => '');

                    if (placeholder?.includes('http') || value === '' || value.startsWith('http')) {
                        await input.clear();
                        await input.fill(newUrl);
                        inputFilled = true;
                        testLogger.debug(`Filled URL in input: ${selector} (index ${i})`);
                        break;
                    }
                }
            }
            if (inputFilled) break;
        }

        if (!inputFilled) {
            // Fallback: try fillNewUrlInput
            testLogger.debug('Fallback: trying fillNewUrlInput');
            await this.fillNewUrlInput(newUrl);
        }

        testLogger.debug('URL added in edit mode');
    }

    // ============================================================================
    // SCHEMA MISMATCH TEST POM METHODS
    // ============================================================================

    /**
     * Get button count in table row (used to check if job is done processing)
     * @param {string} tableName - Name of the table
     * @returns {Promise<number>} Number of buttons in the row
     */
    async getTableRowButtonCount(tableName) {
        testLogger.debug(`Getting button count for: ${tableName}`);
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        const buttonCount = await row.locator('button').count();
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
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        const warningIcon = row.locator('td').filter({ hasText: 'Url' }).locator('[class*="warning"], .text-negative, .text-red');
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
    async waitForUrlJobToFinish(tableName, maxAttempts = 12, pollInterval = 5000) {
        testLogger.info(`Waiting for URL job to finish: ${tableName} (max ${maxAttempts} attempts)`);

        for (let i = 0; i < maxAttempts; i++) {
            await this.page.waitForTimeout(pollInterval);
            await this.page.reload({ waitUntil: 'networkidle' });
            await this.waitForEnrichmentTablesList();
            await this.searchEnrichmentTableInList(tableName);

            // Check for warning icon (failed job)
            const hasWarningIcon = await this.isWarningIconVisibleInRow(tableName);
            if (hasWarningIcon) {
                testLogger.info(`Job failed (warning icon visible) - attempt ${i + 1}`);
                return { completed: true, hasFailed: true, buttonCount: 0 };
            }

            // Check button count as indicator job is done
            const buttonCount = await this.getTableRowButtonCount(tableName);
            if (buttonCount >= 2) {
                testLogger.info(`Job finished - ${buttonCount} buttons visible`);
                return { completed: true, hasFailed: false, buttonCount };
            }

            testLogger.info(`Waiting for job - attempt ${i + 1}/${maxAttempts} (${buttonCount} buttons visible)`);
        }

        testLogger.warn(`Job did not complete within ${maxAttempts} attempts`);
        return { completed: false, hasFailed: false, buttonCount: 0 };
    }

    /**
     * Check if job status dialog is visible
     * @returns {Promise<boolean>} True if dialog is visible
     */
    async isJobsDialogVisible() {
        const dialog = this.page.locator('.q-dialog');
        return await dialog.isVisible({ timeout: 3000 }).catch(() => false);
    }

    /**
     * Get job status from the URL Jobs dialog
     * @returns {Promise<{status: 'failed'|'completed'|'unknown', hasFailed: boolean, hasCompleted: boolean}>}
     */
    async getJobStatusFromDialog() {
        testLogger.debug('Getting job status from dialog');
        const dialog = this.page.locator('.q-dialog');

        const failedBadge = dialog.locator('.q-badge').filter({ hasText: /failed/i }).first();
        const completedBadge = dialog.locator('.q-badge').filter({ hasText: /completed/i }).first();

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
        const dialog = this.page.locator('.q-dialog');
        const errorText = dialog.locator('text=/schema|column|mismatch/i');
        const isVisible = await errorText.first().isVisible({ timeout: 3000 }).catch(() => false);
        testLogger.debug(`Schema error visible: ${isVisible}`);
        return isVisible;
    }

    /**
     * Verify any job status badge is visible in dialog
     */
    async verifyAnyJobStatusBadgeVisible() {
        testLogger.debug('Verifying any job status badge is visible');
        const dialog = this.page.locator('.q-dialog');
        const anyBadge = dialog.locator('.q-badge').first();
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

            // Search for the table
            const searchInput = this.page.getByPlaceholder(/search enrichment table/i);
            await searchInput.clear();
            await searchInput.fill(tableName);
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(1000);

            // Check if table exists
            const row = this.page.locator('tbody tr').filter({ hasText: tableName });
            const isVisible = await row.isVisible({ timeout: 3000 }).catch(() => false);

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
}

module.exports = { EnrichmentPage };
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

        // Fill the search input with table name to filter results
        await searchInput.fill(tableName);
        await this.page.waitForLoadState('networkidle');

        // Wait for filtered results to appear - look for table row containing the searched name
        const tableRow = this.page.locator('tbody tr').filter({ hasText: tableName });
        await tableRow.first().waitFor({ state: 'visible', timeout: 15000 });
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

    // ==================== URL Enrichment Table Methods ====================

    async clickAddEnrichmentTableButton() {
        await this.page.getByRole('button', { name: 'Add Enrichment Table' }).click();
        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug('Clicked Add Enrichment Table button');
    }

    async fillTableName(tableName) {
        await this.page.locator('[data-test="add-enrichment-table-name-input"]').fill(tableName);
        testLogger.debug('Filled table name', { tableName });
    }

    async selectFromUrlOption() {
        await this.page.getByText('From URL').click();
        await this.page.waitForTimeout(500);
        testLogger.debug('Selected From URL option');
    }

    async selectUploadFileOption() {
        await this.page.getByText('Upload File').click();
        await this.page.waitForTimeout(500);
        testLogger.debug('Selected Upload File option');
    }

    async fillUrl(url) {
        await this.page.locator('[data-test="enrichment-table-url-input"]').fill(url);
        testLogger.debug('Filled URL', { url });
    }

    async clickSave() {
        await this.page.getByRole('button', { name: 'Save' }).click();
        await this.page.waitForTimeout(1000);
        testLogger.debug('Clicked Save button');
    }

    async clickCancel() {
        await this.page.getByRole('button', { name: 'Cancel' }).click();
        await this.page.waitForLoadState('domcontentloaded');
        testLogger.debug('Clicked Cancel button');
    }

    async expectValidationError(message) {
        await expect(this.page.getByText(message)).toBeVisible();
        testLogger.debug('Validation error verified', { message });
    }

    async createEnrichmentTableFromUrl(tableName, url) {
        testLogger.info('Creating enrichment table from URL', { tableName, url });

        await this.clickAddEnrichmentTableButton();
        await this.fillTableName(tableName);
        await this.selectFromUrlOption();
        await this.fillUrl(url);
        await this.clickSave();

        // Wait for background job to complete
        await this.waitForBackgroundJob(tableName);

        testLogger.info('Enrichment table created from URL', { tableName });
    }

    async waitForBackgroundJob(tableName, timeoutMs = 60000) {
        testLogger.info('Waiting for background job to complete', { tableName, timeoutMs });

        const startTime = Date.now();
        let completed = false;

        while (!completed && (Date.now() - startTime) < timeoutMs) {
            await this.page.waitForTimeout(3000);

            // Check if table appears in list and doesn't have "Processing" status
            const row = this.page.locator('tbody tr').filter({ hasText: tableName });
            const isVisible = await row.count() > 0;

            if (isVisible) {
                // Check if there's a processing indicator
                const hasProcessing = await row.getByText(/processing|loading/i).count() > 0;
                if (!hasProcessing) {
                    completed = true;
                    testLogger.info('Background job completed', { tableName });
                }
            }
        }

        if (!completed) {
            testLogger.warn('Background job did not complete within timeout', { tableName, timeoutMs });
        }
    }

    async verifyTableVisibleInList(tableName) {
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await expect(row).toBeVisible();
        testLogger.debug('Table visible in list', { tableName });
    }

    async expectTableHasType(tableName, type) {
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await expect(row.getByText(type, { exact: false })).toBeVisible();
        testLogger.debug('Table has expected type', { tableName, type });
    }

    async expectTableInList(tableName) {
        await this.verifyTableVisibleInList(tableName);
    }

    async expectTableNotInList(tableName) {
        const row = this.page.locator('tbody tr').filter({ hasText: tableName });
        await expect(row).not.toBeVisible();
        testLogger.debug('Table not in list', { tableName });
    }

    async deleteEnrichmentTableBulk(tableName) {
        testLogger.info('Deleting enrichment table', { tableName });
        await this.clickDeleteButton(tableName);
        await this.verifyDeleteConfirmationDialog();
        await this.clickDeleteOK();
        await this.page.waitForTimeout(1000);
        testLogger.info('Enrichment table deleted', { tableName });
    }

    async deleteEnrichmentTable(tableName) {
        await this.deleteEnrichmentTableBulk(tableName);
    }

    async searchEnrichmentTable(searchText) {
        await this.page.locator('[data-test="enrichment-tables-search-input"]').fill(searchText);
        await this.page.waitForTimeout(1000);
        testLogger.debug('Searched enrichment table', { searchText });
    }

    async selectReplaceFailedMode() {
        await this.page.getByLabel('Replace Failed').check();
        await this.page.waitForTimeout(500);
        testLogger.debug('Selected Replace Failed mode');
    }

    async updateEnrichmentTableReload(tableName, newUrl) {
        testLogger.info('Updating enrichment table - Reload mode', { tableName, newUrl });

        await this.clickEditButton(tableName);
        await this.verifyUpdateMode();

        // Clear and fill new URL
        await this.page.locator('[data-test="enrichment-table-url-input"]').clear();
        await this.fillUrl(newUrl);

        // Select Reload option (default)
        await this.page.getByLabel('Reload').check();

        await this.clickSave();
        await this.waitForBackgroundJob(tableName);

        testLogger.info('Enrichment table updated - Reload mode', { tableName });
    }

    async updateEnrichmentTableAppend(tableName, newUrl) {
        testLogger.info('Updating enrichment table - Append mode', { tableName, newUrl });

        await this.clickEditButton(tableName);
        await this.verifyUpdateMode();

        // Clear and fill new URL
        await this.page.locator('[data-test="enrichment-table-url-input"]').clear();
        await this.fillUrl(newUrl);

        // Select Append option
        await this.page.getByLabel('Append').check();

        await this.clickSave();
        await this.waitForBackgroundJob(tableName);

        testLogger.info('Enrichment table updated - Append mode', { tableName });
    }

    async updateEnrichmentTableReplaceAll(tableName, newUrl) {
        testLogger.info('Updating enrichment table - Replace All mode', { tableName, newUrl });

        await this.clickEditButton(tableName);
        await this.verifyUpdateMode();

        // Clear and fill new URL
        await this.page.locator('[data-test="enrichment-table-url-input"]').clear();
        await this.fillUrl(newUrl);

        // Select Replace All option
        await this.page.getByLabel('Replace All').check();

        await this.clickSave();
        await this.waitForBackgroundJob(tableName);

        testLogger.info('Enrichment table updated - Replace All mode', { tableName });
    }

    async expectUrlInputVisible() {
        await expect(this.page.locator('[data-test="enrichment-table-url-input"]')).toBeVisible();
        testLogger.debug('URL input is visible');
    }

    async expectUrlInputHidden() {
        await expect(this.page.locator('[data-test="enrichment-table-url-input"]')).not.toBeVisible();
        testLogger.debug('URL input is hidden');
    }
}

module.exports = { EnrichmentPage };
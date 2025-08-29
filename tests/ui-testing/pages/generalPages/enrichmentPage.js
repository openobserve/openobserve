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
        
        // Logs table locators
        this.timestampColumn = '[data-test="log-table-column-0-_timestamp"]';
        this.closeDialog = '[data-test="close-dialog"]';
        this.expandMenu = '[data-test="table-row-expand-menu"]';
        this.protocolKeywordText = '[data-test="log-expand-detail-key-protocol_keyword-text"]';
        this.dateTimeBtn = '[data-test="date-time-btn"]';
        
        // VRL editor locator
        this.vrlEditor = '#fnEditor';
        this.refreshButton = "[data-test='logs-search-bar-refresh-btn']";
        
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
    }

    // Navigation Methods
    async navigateToEnrichmentTable() {
        await this.page.locator(this.pipelineMenuItem).click();
        await this.page.locator(this.enrichmentTableTab).click();
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
            const textbox = this.page.locator(this.vrlEditor).getByRole('textbox');
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
        await this.page.waitForLoadState('networkidle');
        
        // Additional run query clicks to ensure VRL enrichment is fully processed
        const refreshButton = this.page.locator(this.refreshButton);
        if (await refreshButton.isVisible()) {
            for (let i = 0; i < 3; i++) {
                await refreshButton.click({ force: true });
                await this.page.waitForLoadState('domcontentloaded');
                await this.page.waitForLoadState('networkidle', { timeout: 2000 });
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
        await this.page.waitForSelector(this.vrlEditor, { 
            state: 'visible',
            timeout: 15000 
        });
        
        const vrlEditorExists = await this.page.locator('#fnEditor').count();
        testLogger.debug('VRL Editor count after URL logic', { vrlEditorExists });
        
        // Now proceed with VRL processing
        await this.fillVRLQuery(fileName);

        // Wait for VRL editor to be fully ready for processing
        await this.waitForVRLEditorReady();

        // Apply query with multiple clicks for VRL test reliability
        await this.applyQueryMultipleClicks();

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
}

module.exports = { EnrichmentPage };
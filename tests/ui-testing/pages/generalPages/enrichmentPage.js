const { expect } = require('@playwright/test');

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
        
        // VRL editor locators (with fallback options)
        this.vrlEditor = '#fnEditor';
        this.vrlEditorFallback = '[data-test="logs-vrl-function-editor"]';
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
            console.log('🔍 Starting VRL editor initialization');
            console.log('📍 Current URL:', await this.page.url());
            
            // Wait for logs page to be fully loaded (matching original working approach)
            await this.page.waitForLoadState('domcontentloaded');
            console.log('✅ DOM content loaded');
            
            await this.page.waitForLoadState('networkidle', { timeout: 30000 });
            console.log('✅ Network idle achieved');
            
            // Give extra time for VRL editor initialization in CI (like original 3s timeout)
            await this.page.waitForTimeout(5000);
            console.log('✅ Waited 5s for editor initialization');
            
            // Check what elements are available
            const allIds = await this.page.locator('*[id]').evaluateAll(
                elements => elements.map(el => ({ id: el.id, visible: el.offsetParent !== null })).filter(item => item.id)
            );
            console.log('📋 Available element IDs:', allIds);
            
            // Try to click functions button if it exists to ensure VRL panel is open
            try {
                const functionsButton = this.page.locator('[data-test="logs-search-functions-btn"]');
                const isVisible = await functionsButton.isVisible();
                console.log('🔘 Functions button visible:', isVisible);
                if (isVisible) {
                    await functionsButton.click();
                    console.log('✅ Functions button clicked');
                    await this.page.waitForTimeout(2000);
                }
            } catch (e) {
                console.log('⚠️ Functions button not found or error:', e.message);
            }
            
            // Try primary VRL editor selector first
            let activeVrlEditor = this.vrlEditor;
            let editorCount = await this.page.locator(this.vrlEditor).count();
            console.log('📝 Primary fnEditor (#fnEditor) elements found:', editorCount);
            
            // If primary editor not found, try fallback selector
            if (editorCount === 0) {
                console.log('🔄 Trying fallback VRL editor selector...');
                editorCount = await this.page.locator(this.vrlEditorFallback).count();
                console.log('📝 Fallback VRL editor elements found:', editorCount);
                
                if (editorCount > 0) {
                    activeVrlEditor = this.vrlEditorFallback;
                    console.log('✅ Using fallback VRL editor selector');
                } else {
                    // Both selectors failed - provide debugging info
                    await this.page.screenshot({ path: 'debug-no-vrl-editor.png', fullPage: true });
                    const pageContent = await this.page.content();
                    console.log('❌ No VRL editor found with either selector');
                    console.log('📄 Page content contains "editor":', pageContent.includes('editor'));
                    console.log('📄 Page content contains "function":', pageContent.includes('function'));
                    console.log('📄 Page content contains "vrl":', pageContent.includes('vrl'));
                    throw new Error('VRL editor not found with either selector (#fnEditor or [data-test="logs-vrl-function-editor"]). VRL features may be disabled in CI environment.');
                }
            }
            
            // Check if selected editor is visible
            const editorVisible = await this.page.locator(activeVrlEditor).isVisible();
            console.log('👁️ Selected VRL editor visible:', editorVisible);
            
            // Wait for VRL editor to be visible
            console.log('⏳ Waiting for VRL editor to become visible...');
            await this.page.waitForSelector(activeVrlEditor, { 
                state: 'visible',
                timeout: 45000 
            });
            console.log('✅ VRL editor is now visible');
            
            // Wait for the textbox inside the editor to be interactive
            const textbox = this.page.locator(activeVrlEditor).getByRole('textbox');
            await textbox.waitFor({ 
                state: 'visible',
                timeout: 15000 
            });
            console.log('✅ Editor textbox is ready');
            
            // Clear any existing content and fill new query
            await textbox.clear();
            await textbox.fill(fullQuery);
            
            // Wait for editor to process the input
            await this.page.waitForLoadState('domcontentloaded');
            await this.page.waitForTimeout(500); // Allow VRL syntax highlighting
        } catch (error) {
            console.error('VRL Query filling failed:', error.message);
            // Take a screenshot for debugging
            await this.page.screenshot({ 
                path: `debug-vrl-error-${Date.now()}.png`,
                fullPage: true 
            });
            throw error;
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
        
        // Additional wait for results to render
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(1000); // Small wait for VRL processing
    }

    async verifyNoQueryWarning() {
        // Wait a moment for any potential warnings to appear
        await this.page.waitForTimeout(1000);
        
        const warningElement = this.page.locator(this.warningQueryExecution);
        await expect(warningElement).toBeHidden();
    }

    async expandFirstLogRow() {
        await this.page.waitForLoadState('networkidle');
        
        // Wait for timestamp column to be visible and stable
        await this.page.waitForSelector(this.timestampColumn, { state: 'visible' });
        const expandButton = this.page.locator(this.timestampColumn).locator(this.expandMenu);
        await expandButton.waitFor({ state: 'visible' });
        
        await expandButton.click();
        await this.page.waitForLoadState('domcontentloaded');
        
        // Wait for expand panel to load
        await this.page.waitForTimeout(500);
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
        console.log(`🔍 Looking for file: ${fileName}`);
        
        // Wait for table to be present and have data
        await this.page.waitForSelector(this.tableRows, { 
            state: 'visible',
            timeout: 15000 
        });
        
        // Allow time for table to refresh after file upload (CI needs more time)
        await this.page.waitForTimeout(3000);
        
        // Try to find the file with retries (table might still be loading in CI)
        let fileFound = false;
        let attempts = 0;
        const maxAttempts = 10; // 10 attempts with 2s intervals = 20s total
        
        while (!fileFound && attempts < maxAttempts) {
            const rows = await this.page.locator(this.tableRows);
            const rowCount = await rows.count();
            console.log(`📊 Table has ${rowCount} rows (attempt ${attempts + 1}/${maxAttempts})`);
            
            for (let i = 0; i < rowCount; i++) {
                const row = rows.nth(i);
                const displayedName = await row
                    .locator(this.tableCellLeft)
                    .nth(1)
                    .textContent();
                
                console.log(`🔎 Row ${i + 1}: "${displayedName?.trim()}"`);
                
                if (displayedName?.trim() === fileName) {
                    fileFound = true;
                    console.log(`✅ File found in table: ${displayedName}`);
                    break;
                }
            }
            
            if (!fileFound) {
                attempts++;
                if (attempts < maxAttempts) {
                    console.log(`⏳ File not found yet, waiting 2s before retry...`);
                    await this.page.waitForTimeout(2000);
                }
            }
        }

        if (!fileFound) {
            throw new Error(`File name "${fileName}" not found in enrichment table after ${maxAttempts} attempts (${maxAttempts * 2} seconds). This may indicate slow table refresh in CI.`);
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

    async testCSVValidationError() {
        await this.attemptSaveWithoutFile('test');
    }
}

module.exports = { EnrichmentPage };
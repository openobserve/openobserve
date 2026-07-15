
import { expect } from '@playwright/test';
import { openNavFlyoutChild } from '../commonActions.js';


export class PipelinesEP {
    constructor(page) {
        this.page = page;

        this.functionStreamTab = '[data-test="pipeline-section-tab-functions"]';
        this.createFunctionToggle = page.locator('[data-test="create-function-toggle"] div').nth(2);
        this.createFunctionButton = this.page.locator('[data-test="function-list-add-function-btn"]');
        // OInput: outer wrapper has data-test="foo"; inner native <input> has data-test="foo-field".
        // Use the -field suffix for fill() and waitFor({ state: 'attached' }) + force: true.
        this.functionNameInput = '[data-test="add-function-name-input-field"]';
        this.saveFunctionButton = '[data-test="add-function-save-btn"]';
        this.logsSearchField = '[data-test="logs-vrl-function-editor"]';
        this.logsSearchFieldCollapseButton = '[data-test="logs-search-field-list-collapse-btn"]';
        this.streamPipelinesTab = '[data-test="pipeline-section-tab-streamPipelines"]';
        this.importPipelineButton = '[data-test="pipeline-list-import-pipeline-btn"]';
        this.importJsonUrlTab = '[data-test="tab-import_json_url"]';
        this.importCancelButton = '[data-test="pipeline-import-cancel-btn"]';
        this.pipelineListTitle = '[data-test="pipeline-list-page"]';
        this.importJsonButton = '[data-test="pipeline-import-json-btn"]';
        this.pipelineImportUrlInput = '[data-test="pipeline-import-url-input-field"]';
        this.pipelineImportNameInput = '[data-test="pipeline-import-name-input-field"]';
        this.pipelineImportErrorDestinationFunctionNameInput = '[data-test="pipeline-import-error-0-1"] [data-test="pipeline-import-destination-function-name-input"]';
        this.pipelineImportErrorDestinationFunctionNameInput2 = '[data-test="pipeline-import-error-0-2"] [data-test="pipeline-import-destination-function-name-input"]';
        this.pipelineMoreOptionsButton = (name) => `[data-test="pipeline-list-${name}-more-options"]`;
        // Note: Export and Delete are now in the more options menu (three-dot menu)
        this.confirmButton = '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
        this.fileInput = page.locator('input[type="file"]');
        this.sourceStreamNameInput = '[data-test="pipeline-import-source-stream-name-input"]';
        this.destinationFunctionNameInput = '[data-test="pipeline-import-destination-function-name-input"]';
        this.destinationStreamTypeInput = '[data-test="pipeline-import-destination-stream-type-input"]';
        // Stream picker is OSelect (Reka Listbox) post-migration.
        this.menuScroll = '[data-test$="-popover"], [role="listbox"]';
        this.menuItem = '[data-test$="-option"]';
        this.virtualScrollContent = '[data-test$="-popover"] [role="listitem"]';
        // OToast: the message text lives in [data-test="o-toast-message"]; the toast <li> root
        // gets a dynamic id like [data-test="o-toast-1"]. The prefix selector [data-test^="o-toast-"]
        // matches both and causes strict mode violations — use the specific message selector.
        this.notifyContainer = '[data-test="o-toast-message"]';
        this.monacoViewLines = '.view-lines';
    }

    async gotoPipelinesPageEP() {
        await openNavFlyoutChild(this.page, 'pipeline');
    }

    async goToHomePage() {
        const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
        const org = process.env.ORGNAME || 'default';
        await this.page.goto(`${baseUrl}/web/?org_identifier=${org}`);
    }

    async waitForPipelineInList(name) {
        await this.page.locator(this.pipelineMoreOptionsButton(name)).waitFor({ state: 'visible', timeout: 30000 });
    }

    /**
     * Verify that a scheduled pipeline displays the cron expression in the Frequency column
     * Bug fix: Cron expression used to not display in the list
     * @param {string} name - Pipeline name
     */
    async expectScheduledPipelineCronDisplayed(name) {
        // Find the row containing this pipeline by its more-options button
        const row = this.page.locator(`tr:has([data-test="pipeline-list-${name}-more-options"])`);
        await row.waitFor({ state: 'visible', timeout: 10000 });

        // Find the Frequency column index dynamically by header text
        // This is more resilient than hardcoding nth(5) which breaks if columns change
        const headerCells = this.page.locator('thead th, thead td');
        const headerCount = await headerCells.count();
        let frequencyColumnIndex = -1;

        for (let i = 0; i < headerCount; i++) {
            const headerText = await headerCells.nth(i).textContent();
            if (headerText && headerText.toLowerCase().includes('frequency')) {
                frequencyColumnIndex = i;
                break;
            }
        }

        // Fallback to column 5 if header not found (maintains backwards compatibility)
        if (frequencyColumnIndex === -1) {
            frequencyColumnIndex = 5;
        }

        const frequencyCell = row.locator('td').nth(frequencyColumnIndex);
        const frequencyText = await frequencyCell.textContent();

        // Verify cron expression is displayed (not blank or "--")
        expect(frequencyText.trim()).not.toBe('');
        expect(frequencyText.trim()).not.toBe('--');
        // Cron expressions typically contain spaces and asterisks (e.g., "10 56 * * *")
        expect(frequencyText.trim()).toMatch(/[\d\s\*]+/);
    }

    async openFunctionStreamTab() {

        await this.page.waitForSelector(this.functionStreamTab);
        await this.page.locator(this.functionStreamTab).click();
    }

    async setMonacoEditorValue(vrlCode) {
        // Wait for the Monaco view-lines to appear inside the correct editor container.
        // Scoping to [data-test="logs-vrl-function-editor"] avoids clicking the wrong editor
        // when multiple Monaco instances are on the page.
        const viewLines = this.page.locator(`${this.logsSearchField} .view-lines`).first();
        await viewLines.waitFor({ state: 'visible', timeout: 15000 });
        await viewLines.click();
        await this.page.waitForTimeout(200);
        // Select all existing content and replace with the new VRL code
        await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await this.page.keyboard.type(vrlCode, { delay: 50 });
        // Wait for CodeQueryEditor's 500ms onDidChangeModelContent debounce to fire
        // update:query so that formData.function is updated before we click save.
        await this.page.waitForTimeout(600);
    }

    async _fillFunctionName(functionName) {
        // OInput renders the wrapper div with data-test="foo" and the inner <input>
        // with data-test="foo-field". The inner input is a controlled input (:value binding).
        // Clicking the outer wrapper focuses the inner input; then keyboard.type() dispatches
        // proper input events that Vue's reactive system picks up correctly.
        const wrapper = this.page.locator('[data-test="add-function-name-input"]');
        await wrapper.waitFor({ state: 'visible', timeout: 15000 });
        await wrapper.click();
        await this.page.waitForTimeout(200);
        await this.page.keyboard.type(functionName, { delay: 30 });
    }

    async createFunction(functionName, vrlCode) {
        await this.createFunctionButton.waitFor({ state: 'visible' });
        await this.createFunctionButton.click();
        await this._fillFunctionName(functionName);
        await this.setMonacoEditorValue(vrlCode);
        await this.page.locator(this.saveFunctionButton).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.locator(this.saveFunctionButton).click();
        await expect(
            this.page.locator(this.notifyContainer).filter({ hasText: 'Function saved successfully' }).first()
        ).toBeVisible({ timeout: 15000 });
        await this.createFunctionButton.waitFor({ state: 'visible', timeout: 10000 });
    }

    async createFirstFunction(functionName) {
        await this.createFunction(functionName, '.a=41');
    }

    async createSecondFunction(functionName) {
        await this.createFunction(functionName, '.test=2');
    }



    async importPipeline() {
        // Wait for the button to be visible
        await this.page.locator(this.importPipelineButton).waitFor({ state: 'visible' });
        // Click the button
        await this.page.locator(this.importPipelineButton).click();
    }

    async cancelImportPipeline() {
        await this.page.locator(this.importCancelButton).waitFor({ state: 'visible' });
        await this.page.locator(this.importCancelButton).click();
        await this.page.locator(this.pipelineListTitle).waitFor({ state: 'visible' });
    }

    async setFileInput(filePath) {
        await this.fileInput.setInputFiles(filePath);
    }

    async importPipelineJson(url) {
        await this.page.locator(this.importJsonUrlTab).waitFor({ state: 'visible' });
        await this.page.locator(this.importJsonUrlTab).click();
        // OInput inner native <input>: use attached + force
        const urlField = this.page.locator(this.pipelineImportUrlInput);
        await urlField.waitFor({ state: 'attached', timeout: 10000 });
        await urlField.fill(url, { force: true });
    }


    async fillPipelineDetails(name, functionName1, functionName2) {
        // OInput inner native <input>: use attached + force
        const nameField = this.page.locator(this.pipelineImportNameInput);
        await nameField.waitFor({ state: 'attached', timeout: 10000 });
        await nameField.fill(name, { force: true });

        // Check if stream dropdown exists using specific data-test attribute (more reliable than positional indexes)
        const streamDropdownExists = await this.page.locator(this.sourceStreamNameInput)
            .waitFor({ state: 'visible', timeout: 3000 })
            .then(() => true)
            .catch(() => false);

        if (streamDropdownExists) {
            // Stream dropdown is visible - need to select a stream first
            const streamDropdown = this.page.locator(this.sourceStreamNameInput);

            // Click to open the dropdown and activate input mode
            await streamDropdown.click();

            // Wait for dropdown menu to appear (dropdown renders in a portal)
            const dropdownMenu = this.page.locator(this.menuScroll);
            await dropdownMenu.waitFor({ state: 'visible', timeout: 10000 });

            // Wait for options to load
            await this.page.waitForTimeout(500);

            // Try to find e2e_automate stream - use OSelect search input to filter
            const searchInput = this.page.locator('[data-test="pipeline-import-source-stream-name-input-search"]');
            const searchVisible = await searchInput.isVisible().catch(() => false);
            if (searchVisible) {
                await searchInput.fill('e2e');
            }
            await this.page.waitForTimeout(1000);

            // Look for the stream option in the dropdown
            let streamOption = this.page.locator(this.menuItem).filter({ hasText: 'e2e_automate' }).first();
            let optionFound = await streamOption.isVisible().catch(() => false);

            // If not found with filter, clear and try scrolling
            if (!optionFound) {
                // Clear the filter by selecting all and deleting
                await this.page.keyboard.press('Control+a');
                await this.page.keyboard.press('Backspace');
                await this.page.waitForTimeout(500);

                // Scroll through virtual list to find the stream
                const scrollContainer = this.page.locator(this.virtualScrollContent);
                const hasVirtualScroll = await scrollContainer.count() > 0;

                if (hasVirtualScroll) {
                    // Scroll down to find e2e_automate in virtual list
                    for (let i = 0; i < 20 && !optionFound; i++) {
                        await dropdownMenu.evaluate(el => el.scrollTop += 200);
                        await this.page.waitForTimeout(200);
                        optionFound = await streamOption.isVisible().catch(() => false);
                    }
                }
            }

            // Click the stream option
            await streamOption.waitFor({ state: 'visible', timeout: 10000 });
            await streamOption.click();

            // Wait for dropdown to close
            await this.page.waitForTimeout(1000);
        }

        // Find all function dropdowns using specific data-test attribute
        const functionDropdowns = this.page.locator(this.destinationFunctionNameInput);
        const functionCount = await functionDropdowns.count();

        // Fill function dropdowns in order
        const functionNames = [functionName1, functionName2];
        for (let i = 0; i < Math.min(functionCount, functionNames.length); i++) {
            const dropdown = functionDropdowns.nth(i);

            // Click to open the dropdown
            await dropdown.waitFor({ state: 'visible', timeout: 5000 });
            await dropdown.click();

            // Wait for dropdown to open
            await this.page.waitForTimeout(500);

            // Select the function (use exact match to avoid partial matches like 'first5' matching 'first587')
            const option = this.page.locator('[data-test="pipeline-import-destination-function-name-input-option"]', { hasText: new RegExp(`^${functionNames[i]}$`, 'i') }).first();
            try {
                await option.scrollIntoViewIfNeeded({ timeout: 3000 });
            } catch (error) {
                // If scroll fails, wait a bit for dropdown to populate
                await this.page.waitForTimeout(1000);
            }
            await option.waitFor({ state: 'visible', timeout: 10000 });
            await option.click();

            // Wait for dropdown to close before moving to next
            await this.page.waitForTimeout(1000);
        }
    }


    async importJsonButtonPipeline() {
        await this.page.locator(this.importJsonButton).waitFor({ state: 'visible' });
        await this.page.locator(this.importJsonButton).click();
    }

    async downloadPipeline(name) {
        // ODropdownItem has data-test="pipeline-list-{name}-export-action" (not a generic -option)
        const moreOptionsButton = this.page.locator(this.pipelineMoreOptionsButton(name));
        await moreOptionsButton.waitFor({ state: 'visible', timeout: 60000 });
        await moreOptionsButton.click();

        const exportItem = this.page.locator(`[data-test="pipeline-list-${name}-export-action"]`);
        await exportItem.waitFor({ state: 'visible', timeout: 5000 });
        await exportItem.click();
    }

    async deletePipeline(name) {
        // ODropdownItem has data-test="pipeline-list-{name}-delete-pipeline" (not a generic -option)
        const moreOptionsButton = this.page.locator(this.pipelineMoreOptionsButton(name));
        await moreOptionsButton.waitFor({ state: 'visible' });
        await moreOptionsButton.click();

        const deleteItem = this.page.locator(`[data-test="pipeline-list-${name}-delete-pipeline"]`);
        await deleteItem.waitFor({ state: 'visible', timeout: 5000 });
        await deleteItem.click();
        await this.page.locator(this.confirmButton).waitFor({ state: 'visible' });
        await this.page.locator(this.confirmButton).click();
    }

    async validateTextMessage(text) {
        await expect(
            this.page.locator(this.notifyContainer).filter({ hasText: text }).first()
        ).toBeVisible({ timeout: 10000 });
    }

    async fillScheduledPipelineDetails(name, functionName, remoteDestination) {
        // OInput inner native <input>: use attached + force
        const nameField = this.page.locator(this.pipelineImportNameInput);
        await nameField.waitFor({ state: 'attached', timeout: 10000 });
        await nameField.fill(name, { force: true });
        await this.page.locator(this.destinationFunctionNameInput).click();

        // Wait for dropdown to open
        await this.page.waitForTimeout(1000);

        // Wait for dropdown menu to be visible
        const dropdownMenu = this.page.locator(this.menuScroll);
        await dropdownMenu.waitFor({ state: 'visible', timeout: 5000 });

        // Scroll through the virtual scroll dropdown to find the option
        let functionOptionVisible = false;
        let scrollAttempts = 0;
        const maxScrollAttempts = 50;

        while (!functionOptionVisible && scrollAttempts < maxScrollAttempts) {
            // Check if option is visible
            const functionOption = this.page.locator('[data-test$="-option"]', { hasText: new RegExp(`^${functionName}$`, 'i') }).first();
            functionOptionVisible = await functionOption.isVisible().catch(() => false);

            if (!functionOptionVisible) {
                // Scroll down in the dropdown
                await dropdownMenu.evaluate(menu => {
                    menu.scrollTop += 200;
                });
                await this.page.waitForTimeout(100);
                scrollAttempts++;
            } else {
                await functionOption.click();
                break;
            }
        }

        if (!functionOptionVisible) {
            throw new Error(`Could not find option: ${functionName} after ${maxScrollAttempts} scroll attempts`);
        }

        await this.page.locator(this.destinationStreamTypeInput).click();

        // Wait for dropdown to open
        await this.page.waitForTimeout(1000);

        // Wait for dropdown menu to be visible
        const destinationDropdown = this.page.locator(this.menuScroll);
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });

        // Scroll through the virtual scroll dropdown to find the destination option
        let destinationOptionVisible = false;
        let destinationScrollAttempts = 0;
        const maxDestinationScrollAttempts = 50;

        while (!destinationOptionVisible && destinationScrollAttempts < maxDestinationScrollAttempts) {
            // Check if option is visible
            const destinationOption = this.page.locator('[data-test$="-option"]', { hasText: new RegExp(`^${remoteDestination}$`, 'i') }).first();
            destinationOptionVisible = await destinationOption.isVisible().catch(() => false);

            if (!destinationOptionVisible) {
                // Scroll down in the dropdown
                await destinationDropdown.evaluate(menu => {
                    menu.scrollTop += 200;
                });
                await this.page.waitForTimeout(100);
                destinationScrollAttempts++;
            } else {
                await destinationOption.click();
                break;
            }
        }

        if (!destinationOptionVisible) {
            throw new Error(`Could not find destination option: ${remoteDestination} after ${maxDestinationScrollAttempts} scroll attempts`);
        }

    }

}


import { expect } from '@playwright/test';


export class PipelinesEP {
    constructor(page) {
        this.page = page;

        this.pipelinesMenu = page.locator('[data-test="menu-link-\\/pipeline-item"]');
        this.functionStreamTab = '[data-test="function-stream-tab"]';
        this.createFunctionToggle = page.locator('[data-test="create-function-toggle"] div').nth(2);
        this.createFunctionButton = this.page.getByRole('button', { name: 'New function' });
        this.functionNameInput = '[data-test="add-function-name-input"]';
        this.saveFunctionButton = '[data-test="add-function-save-btn"]';
        this.logsSearchField = '[data-test="logs-vrl-function-editor"]';
        this.logsSearchFieldCollapseButton = '[data-test="logs-search-field-list-collapse-btn"]';
        this.streamPipelinesTab = '[data-test="stream-pipelines-tab"]';
        this.importPipelineButton = '[data-test="pipeline-list-import-pipeline-btn"]';
        this.importJsonUrlTab = '[data-test="tab-import_json_url"]';
        this.importCancelButton = '[data-test="pipeline-import-cancel-btn"]';
        this.pipelineListTitle = '[data-test="pipeline-list-title"]';
        this.importJsonButton = '[data-test="pipeline-import-json-btn"]';
        this.pipelineImportUrlInput = '[data-test="pipeline-import-url-input"]';
        this.pipelineImportNameInput = '[data-test="pipeline-import-name-input"]';
        this.pipelineImportErrorDestinationFunctionNameInput = '[data-test="pipeline-import-error-0-1"] [data-test="pipeline-import-destination-function-name-input"]';
        this.pipelineImportErrorDestinationFunctionNameInput2 = '[data-test="pipeline-import-error-0-2"] [data-test="pipeline-import-destination-function-name-input"]';
        this.pipelineMoreOptionsButton = (name) => `[data-test="pipeline-list-${name}-more-options"]`;
        // Note: Export and Delete are now in the more options menu (three-dot menu)
        this.confirmButton = '[data-test="confirm-button"]';
        this.fileInput = page.locator('input[type="file"]');
    }

    async gotoPipelinesPageEP() {
        await this.pipelinesMenu.click();
}

    async openFunctionStreamTab() {

        await this.page.waitForSelector(this.functionStreamTab);
        await this.page.locator(this.functionStreamTab).click();
    }

    async createFirstFunction(functionName) {
       // Wait for the button to be visible
       await this.createFunctionButton.waitFor({ state: 'visible' });
       // Click the button
       await this.createFunctionButton.click();
        await this.page.locator(this.functionNameInput).waitFor({ state: 'visible' });
        await this.page.locator(this.functionNameInput).click();
        await this.page.locator(this.functionNameInput).fill(functionName);
        // Wait for the logs search field to be visible and enabled
        await this.page.locator(this.logsSearchField).getByRole('textbox').waitFor({ state: 'visible' });

        await this.page.locator('.view-lines').first().click();
        // Type the function text with a delay to ensure each character registers
        await this.page.keyboard.type(".a=41", { delay: 100 });
        await this.page.keyboard.press("Enter");
        await this.page.keyboard.type(".", { delay: 100 });
        // Check if the required text is present in the editor
        await this.page.getByText(".a=41 .");

        await this.page.locator(this.saveFunctionButton).click();
        await this.page.waitForTimeout(2000);

    }

    async createSecondFunction(functionName) {
        // Wait for the button to be visible
        await this.createFunctionButton.waitFor({ state: 'visible' });
        // Click the button
        await this.createFunctionButton.click();
         await this.page.locator(this.functionNameInput).waitFor({ state: 'visible' });
         await this.page.locator(this.functionNameInput).click();
         await this.page.locator(this.functionNameInput).fill(functionName);
         // Wait for the logs search field to be visible and enabled
        await this.page.locator(this.logsSearchField).getByRole('textbox').waitFor({ state: 'visible' });
         await this.page.locator('.view-lines').first().click();
         // Type the function text with a delay to ensure each character registers
         await this.page.keyboard.type(".test=2", { delay: 100 });
         await this.page.keyboard.press("Enter");
         await this.page.keyboard.type(".", { delay: 100 });
         // Check if the required text is present in the editor
         await this.page.getByText(".test=2 .");

         await this.page.locator(this.saveFunctionButton).click();
         await this.page.waitForTimeout(2000);

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
        await expect(this.page.locator(this.pipelineListTitle)).toContainText('Pipelines');
    }

    async setFileInput(filePath) {
        await this.fileInput.setInputFiles(filePath);
    }

    async importPipelineJson(url) {
        await this.page.locator(this.importJsonUrlTab).waitFor({ state: 'visible' });
        await this.page.locator(this.importJsonUrlTab).click();
        await this.page.locator(this.pipelineImportUrlInput).waitFor({ state: 'visible' });
        await this.page.locator(this.pipelineImportUrlInput).click();
        await this.page.locator(this.pipelineImportUrlInput).fill(url);

    }


    async fillPipelineDetails(name, functionName1, functionName2) {
        // Wait for the name input field to be visible and then click and fill it
        await this.page.locator(this.pipelineImportNameInput).waitFor({ state: 'visible' });
        await this.page.locator(this.pipelineImportNameInput).click();
        await this.page.locator(this.pipelineImportNameInput).fill(name);

        // Check if stream dropdown exists using specific data-test attribute (more reliable than positional indexes)
        const streamDropdownExists = await this.page.locator('[data-test="pipeline-import-source-stream-name-input"]')
            .waitFor({ state: 'visible', timeout: 3000 })
            .then(() => true)
            .catch(() => false);

        if (streamDropdownExists) {
            // Stream dropdown is visible - need to select a stream first
            const streamDropdown = this.page.locator('[data-test="pipeline-import-source-stream-name-input"]');

            // Click to open the dropdown and activate input mode
            await streamDropdown.click();

            // Wait for dropdown menu to appear (Quasar renders dropdown in a portal)
            const dropdownMenu = this.page.locator('.q-menu.scroll');
            await dropdownMenu.waitFor({ state: 'visible', timeout: 10000 });

            // Wait for options to load
            await this.page.waitForTimeout(500);

            // Try to find e2e_automate stream - it might be in a virtual scroll list
            // First, try typing to filter (this triggers the q-select's filter)
            await this.page.keyboard.type('e2e', { delay: 50 });
            await this.page.waitForTimeout(1000);

            // Look for the stream option in the dropdown
            let streamOption = this.page.locator('.q-menu .q-item').filter({ hasText: 'e2e_automate' }).first();
            let optionFound = await streamOption.isVisible().catch(() => false);

            // If not found with filter, clear and try scrolling
            if (!optionFound) {
                // Clear the filter by selecting all and deleting
                await this.page.keyboard.press('Control+a');
                await this.page.keyboard.press('Backspace');
                await this.page.waitForTimeout(500);

                // Scroll through virtual list to find the stream
                const scrollContainer = this.page.locator('.q-menu.scroll .q-virtual-scroll__content');
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
        const functionDropdowns = this.page.locator('[data-test="pipeline-import-destination-function-name-input"]');
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
            const option = this.page.getByRole('option', { name: functionNames[i], exact: true });
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
        // Click on more options (three-dot menu) then export
        const moreOptionsButton = this.page.locator(
          `[data-test="pipeline-list-${name}-more-options"]`
        );

        // Wait for the element to be visible and enabled before clicking
        try {
            await moreOptionsButton.waitFor({ state: 'visible', timeout: 60000 });
        } catch (error) {
            console.error(`Pipeline more options button not visible: ${error.message}`);
            throw new Error(`Pipeline more options button not visible for: ${name}`);
        }

        // Click the more options button to open the menu
        await moreOptionsButton.click();
        await this.page.waitForTimeout(500);

        // Click export option in the menu (Quasar q-item)
        await this.page.locator('.q-menu .q-item').filter({ hasText: 'Export' }).click();
        console.log(`Clicked on the export pipeline button for pipeline: ${name}`);
    }



    async deletePipeline(name) {
        // Click on more options (three-dot menu) then delete
        const moreOptionsButton = this.page.locator(
          `[data-test="pipeline-list-${name}-more-options"]`
        );
        await moreOptionsButton.waitFor({ state: "visible" });
        await moreOptionsButton.click();
        await this.page.waitForTimeout(500);
        // Click delete option in the menu (Quasar q-item)
        await this.page.locator('.q-menu .q-item').filter({ hasText: 'Delete' }).click();
        await this.page.locator(this.confirmButton).waitFor({ state: 'visible' });
        await this.page.locator(this.confirmButton).click();
    }

    async validateTextMessage(text) {
        await expect(this.page.locator('#q-notify')).toContainText(text);
    }

    async fillScheduledPipelineDetails(name, functionName, remoteDestination) {

        await this.page.locator('[data-test="pipeline-import-name-input"]').click();
        await this.page.locator('[data-test="pipeline-import-name-input"]').fill(name);
        await this.page.locator('[data-test="pipeline-import-destination-function-name-input"]').click();

        // Wait for dropdown to open
        await this.page.waitForTimeout(1000);

        // Wait for dropdown menu to be visible
        const dropdownMenu = this.page.locator('.q-menu.scroll');
        await dropdownMenu.waitFor({ state: 'visible', timeout: 5000 });

        // Scroll through the virtual scroll dropdown to find the option
        let functionOptionVisible = false;
        let scrollAttempts = 0;
        const maxScrollAttempts = 50;

        while (!functionOptionVisible && scrollAttempts < maxScrollAttempts) {
            // Check if option is visible
            const functionOption = this.page.getByText(functionName, { exact: true });
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

        await this.page.locator('[data-test="pipeline-import-destination-stream-type-input"]').click();

        // Wait for dropdown to open
        await this.page.waitForTimeout(1000);

        // Wait for dropdown menu to be visible
        const destinationDropdown = this.page.locator('.q-menu.scroll');
        await destinationDropdown.waitFor({ state: 'visible', timeout: 5000 });

        // Scroll through the virtual scroll dropdown to find the destination option
        let destinationOptionVisible = false;
        let destinationScrollAttempts = 0;
        const maxDestinationScrollAttempts = 50;

        while (!destinationOptionVisible && destinationScrollAttempts < maxDestinationScrollAttempts) {
            // Check if option is visible
            const destinationOption = this.page.getByRole('option', { name: remoteDestination });
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

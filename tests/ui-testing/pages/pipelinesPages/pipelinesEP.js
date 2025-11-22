
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
        this.pipelineExportPipelineButton = (name) => `[data-test="pipeline-list-${name}-export-pipeline"]`;
        this.pipelineDeleteButton = '[data-test="pipeline-list-re1-delete-pipeline"]';
        this.confirmButton = '[data-test="confirm-button"]';
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

        // Wait for the first function name input field to be visible before clicking
        await this.page.locator(this.pipelineImportErrorDestinationFunctionNameInput).waitFor({ state: 'visible' });
        await this.page.locator(this.pipelineImportErrorDestinationFunctionNameInput).click();

        // Wait for dropdown to open and scroll to find the option
        await this.page.waitForTimeout(1000);

        // Try to find and scroll to the first function option
        const option1 = this.page.getByRole('option', { name: functionName1 });
        try {
            await option1.scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch (error) {
            // If scroll fails, wait a bit more for the dropdown to populate
            await this.page.waitForTimeout(2000);
        }

        await option1.waitFor({ state: 'visible', timeout: 10000 });
        await option1.locator('div').nth(2).click();

        // Wait for the second function name input field to be visible before clicking
        await this.page.locator(this.pipelineImportErrorDestinationFunctionNameInput2).waitFor({ state: 'visible' });
        await this.page.locator(this.pipelineImportErrorDestinationFunctionNameInput2).click();

        // Wait for dropdown to open and scroll to find the second option
        await this.page.waitForTimeout(1000);

        // Try to find and scroll to the second function option
        const option2 = this.page.getByRole('option', { name: functionName2 });
        try {
            await option2.scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch (error) {
            // If scroll fails, wait a bit more for the dropdown to populate
            await this.page.waitForTimeout(2000);
        }

        await option2.waitFor({ state: 'visible', timeout: 10000 });
        await option2.click();
    }


    async importJsonButtonPipeline() {
        await this.page.locator(this.importJsonButton).waitFor({ state: 'visible' });
        await this.page.locator(this.importJsonButton).click();
    }

    async downloadPipeline(name) {
        const pipelineExportButton = this.page.locator(`[data-test="pipeline-list-${name}-export-pipeline"]`);

        // Wait for the element to be visible and enabled before clicking
        try {
            await pipelineExportButton.waitFor({ state: 'visible', timeout: 60000 }); // Increase timeout if necessary
        } catch (error) {
            console.error(`Pipeline export button not visible: ${error.message}`);
            throw new Error(`Pipeline export button not visible for: ${name}`);
        }

        // Check if the button is enabled
        const isEnabled = await pipelineExportButton.isEnabled();
        if (!isEnabled) {
            throw new Error(`Pipeline export button is not enabled for: ${name}`);
        }

        // Click the button to start the download
        await pipelineExportButton.click();
        console.log(`Clicked on the export pipeline button for pipeline: ${name}`);


    }



    async deletePipeline(name) {

        await this.page.locator(`[data-test="pipeline-list-${name}-delete-pipeline"]`).click();
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

        // Wait for dropdown to open and scroll to find the function
        await this.page.waitForTimeout(1000);

        // Try to find and scroll to the function option
        const functionOption = this.page.getByText(functionName);
        try {
            await functionOption.scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch (error) {
            // If scroll fails, wait a bit more for the dropdown to populate
            await this.page.waitForTimeout(2000);
        }

        await functionOption.waitFor({ state: 'visible', timeout: 10000 });
        await functionOption.click();

        await this.page.locator('[data-test="pipeline-import-destination-stream-type-input"]').click();
        await this.page.getByRole('option', { name: remoteDestination }).click();

    }

}

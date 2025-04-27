// pipelinesPage.js
import { expect } from '@playwright/test';


export class PipelinesPage {
    constructor(page) {
        this.page = page;
        this.pipelinesPageMenu = page.locator('[data-test="menu-link-\\/pipeline-item"]');
        this.functionStreamTab = '[data-test="function-stream-tab"]';
        this.createFunctionToggle = page.locator('[data-test="create-function-toggle"] div').nth(2);
        this.createFunctionButton = { role: 'button', name: 'Create new function' };
        this.createFunctionButton = this.page.getByRole('button', { name: 'Create new function' });
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

    async gotoPipelinesPage() {
            await this.pipelinesPageMenu.click();
    }


    async pipelinesPageDefaultOrg() {

        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).click();


    }

    async pipelinesPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();    
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async pipelinesPageURLValidation() {
     await expect(this.page).toHaveURL(/defaulttestmulti/);
    }

    async pipelinesURLValidation() {
      await expect(this.page).toHaveURL(/pipeline/);
    }

    async openFunctionStreamTab() {
       
        await this.page.waitForSelector(this.functionStreamTab);
        await this.page.waitForTimeout(5000);
        await this.page.locator(this.functionStreamTab).click();
    }

    async toggleCreateFunction() {
        await this.page.locator(this.createFunctionToggle).waitForSelector();
        await this.createFunctionToggle.click();
    }
    
    async enterFunctionName(name) {
        await this.functionNameInput.fill(name);
      }
    async createFirstFunction(functionName) {
       // Wait for the button to be visible
       await this.createFunctionButton.waitFor({ state: 'visible' });
       // Click the button
       await this.createFunctionButton.click();
        await this.page.locator(this.functionNameInput).waitFor({ state: 'visible' });
        await this.page.locator(this.functionNameInput).click();
        await this.page.locator(this.functionNameInput).fill(functionName);
        await this.page.waitForTimeout(2000);
        await this.page.locator(this.logsSearchField).locator(".view-lines").click();
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
         await this.page.waitForTimeout(2000);
         await this.page.locator(this.logsSearchField).locator(".view-lines").click();
         // Type the function text with a delay to ensure each character registers
         await this.page.keyboard.type(".test=2", { delay: 100 });
         await this.page.keyboard.press("Enter");
         await this.page.keyboard.type(".", { delay: 100 });
         // Check if the required text is present in the editor
         await this.page.getByText(".test=2 .");
 
         await this.page.locator(this.saveFunctionButton).click();
         await this.page.waitForTimeout(2000);
         
     }

    async collapseLogsSearchField() {
        await this.page.locator(this.logsSearchFieldCollapseButton).waitFor({ state: 'visible' });
        await this.page.locator(this.logsSearchFieldCollapseButton).click();
    }

    async openStreamPipelinesTab() {
        await this.page.locator(this.streamPipelinesTab).waitFor({ state: 'visible' });
        await this.page.locator(this.streamPipelinesTab).click();
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

        await this.page.locator(this.pipelineImportNameInput).click();
        await this.page.locator(this.pipelineImportNameInput).fill(name);
        await this.page.locator(this.pipelineImportErrorDestinationFunctionNameInput).click();
        await this.page.getByRole('option', { name: functionName1 }).locator('div').nth(2).click();
        await this.page.locator(this.pipelineImportErrorDestinationFunctionNameInput2).click();
        await this.page.getByRole('option', { name: functionName2 }).click();
        
    }

    async importJsonButtonPipeline() {
        await this.page.locator(this.importJsonButton).waitFor({ state: 'visible' });
        await this.page.locator(this.importJsonButton).click();
    }

    async downloadPipeline(name) {
        const pipelineLocator = this.page.locator(`[data-test="pipeline-list-${name}-export-pipeline"]`);
    
        // Wait for the element to be visible and enabled before clicking
        try {
            await pipelineLocator.waitFor({ state: 'visible', timeout: 60000 }); // Increase timeout if necessary
        } catch (error) {
            console.error(`Pipeline button not visible: ${error.message}`);
            throw new Error(`Pipeline button not visible for: ${name}`);
        }
    
        // Check if the button is enabled
        const isEnabled = await pipelineLocator.isEnabled();
        if (!isEnabled) {
            throw new Error(`Pipeline button is not enabled for: ${name}`);
        }
    
        // Click the button to start the download
        await pipelineLocator.click();
        console.log(`Clicked on the download button for pipeline: ${name}`);
    
    
    }
    
    

    async deletePipeline(name) {

        await this.page.locator(`[data-test="pipeline-list-${name}-delete-pipeline"]`).click();
        await this.page.locator(this.confirmButton).waitFor({ state: 'visible' });
        await this.page.locator(this.confirmButton).click();
    }

    async validateTextMessage(text) {
        await expect(this.page.locator('#q-notify')).toContainText(text);
    }


}
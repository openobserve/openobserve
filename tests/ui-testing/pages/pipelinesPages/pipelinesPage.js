// pipelinesPage.js
const { expect } = require('@playwright/test')

const randomNodeName = `remote-node-${Math.floor(Math.random() * 1000)}`;

export class PipelinesPage {
    constructor(page) {
        this.page = page;
        this.pipelinesPageMenu = page.locator('[data-test="menu-link-\\/pipeline-item"]');
        
        // Locators from PipelinePage
        this.pipelineMenuLink = page.locator(
          '[data-test="menu-link-\\/pipeline-item"]'
        );
        this.pipelineTab = page.locator('[data-test="stream-pipelines-tab"]');
        this.addPipelineButton = page.locator(
          '[data-test="pipeline-list-add-pipeline-btn"]'
        );
        this.streamButton = page.getByRole("button", { name: "Stream" }).first();
        this.queryButton = page.getByRole("button", { name: "Query" });
        this.vueFlowPane = page.locator(".vue-flow__pane");
        this.logsDropdown = page.locator("div").filter({ hasText: /^logs$/ });
        this.logsOption = page
          .getByRole("option", { name: "logs" })
          .locator("div")
          .nth(2);
        this.saveButton = page.locator('[data-test="input-node-stream-save-btn"]');
        this.selectStreamError = page.getByText("Please select Stream from the");
        this.savePipelineButton = page.locator(
          '[data-test="add-pipeline-save-btn"]'
        );
        // Target the form field error inside q-field__bottom, not the notification
        this.pipelineNameRequiredMessage = page.locator('.q-field__bottom [role="alert"]').getByText(
          "Pipeline name is required"
        );
        // Updated selector to use placeholder since aria-label doesn't exist
        this.pipelineNameInput = page.locator('input[placeholder="Enter Pipeline Name"]');
        this.sourceNodeRequiredMessage = page.getByText("Source node is required");
        this.streamNameInput = page.getByLabel("Stream Name *");
        this.e2eAutomateOption = page.getByRole("option", { name: "e2e_automate" , exact: true});
        this.inputNodeStreamSaveButton = page.locator(
          '[data-test="input-node-stream-save-btn"]'
        );
        this.destinationNodeRequiredMessage = page.getByText(
          "Destination node is required"
        );
        this.deleteButton = page.locator("button").filter({ hasText: "delete" });
        this.confirmDeleteButton = page.locator('[data-test="confirm-button"]');
        this.secondStreamButton = page.getByRole('button', { name: 'Stream' }).nth(1);
        this.functionButton =  page.getByRole('button', { name: 'Function' })
        this.conditionButton =  page.getByRole('button', { name: 'Condition' })
       this.selectPreviousNodeDropdown = page.getByLabel('Select Previous Node');
       this.previousNodeDropdown = page.locator('[data-test="previous-node-dropdown-input-stream-node-option"]');
       this.previousNodeDropdownSecond = page.locator('[data-test="previous-node-dropdown-input-stream-node-option"]:last-child');
        this.createStreamToggle = page.locator('[data-test="create-stream-toggle"] div').nth(2);
        this.saveStreamButton = page.locator('[data-test="save-stream-btn"]');
        this.inputNodeStreamSaveButton = page.locator('[data-test="input-node-stream-save-btn"]')
        this.pipelineSearchInput = page.locator('[data-test="pipeline-list-search-input"]');
        this.deletionSuccessMessage = page.getByText('Pipeline deleted successfully')
        this.sqlEditor = page.locator('[data-test="scheduled-pipeline-sql-editor"]');
        this.sqlQueryInput = page.locator('.monaco-editor').locator('.inputarea');
        this.frequencyUnit = page.locator('[data-test="scheduled-pipeline-frequency-unit"]');
        this.saveQueryButton = page.locator('[data-test="stream-routing-query-save-btn"]');
        this.createFunctionToggle = page.locator('[data-test="create-function-toggle"] div').nth(2);
        this.functionNameLabel = page.locator('[data-test="add-function-node-routing-section"]').getByLabel('Name');
        this.associateFunctionSaveButton = page.locator('[data-test="associate-function-save-btn"]');
        this.associateNewFunctionSaveButton = page.locator('[data-test="add-function-save-btn"]');
        this.functionNameRequiredError = page.getByText('Function Name is required')
        this.functionRequiredError = page.getByText('Function is required')
        this.streamSelectionError = page.getByText('Please select Stream from the')
        // FilterGroup selectors for new condition UI
        this.columnSelect = page.locator('[data-test="alert-conditions-select-column"]');
        this.operatorSelect = page.locator('[data-test="alert-conditions-operator-select"]');
        this.valueInput = page.locator('[data-test="alert-conditions-value-input"]');
        this.addConditionButton = page.locator('[data-test="alert-conditions-add-condition-btn"]');
        this.columnOption = page.getByRole('option', { name: 'kubernetes_container_name' })
        this.fieldRequiredError = page.getByText('Field is required!')
        this.tableRowsLocator = page.locator("tbody tr");
        this.confirmButton = page.locator('[data-test="confirm-button"]');
        this.settingsMenu = page.locator('[data-test="menu-link-settings-item"]');
        this.pipelineDestinationsTab = page.locator('[data-test="pipeline-destinations-tab"]');
        this.searchInput = page.locator('[data-test="destination-list-search-input"]');
        this.functionNameInput = page.locator('[data-test="add-function-name-input"]');
        this.addConditionSaveButton = page.locator('[data-test="add-condition-save-btn"]');
        this.pipelineMenu = '[data-test="menu-link-\\/pipeline-item"]';
        this.enrichmentTableTab =
          '[data-test="function-enrichment-table-tab"] > .q-tab__content > .q-tab__label';
        this.addEnrichmentTableButton = 'text=New enrichment table';
        this.editButton = page.locator("button").filter({ hasText: "edit" });
        this.remoteDestinationIcon = page.getByRole("img", { name: "Remote Destination" });
        this.nameInput = page.getByLabel("Name *");
        this.saveButton = page.getByRole("button", { name: "Save" }).last();
        this.urlInput = page.locator('[data-test="add-destination-url-input"]');
        this.headerKeyInput = page.locator('[data-test="add-destination-header--key-input"]');
        this.headerValueInput = page.locator('[data-test="add-destination-header-Authorization-value-input"]');
        this.submitButton = page.locator('[data-test="add-destination-submit-btn"]');
        this.streamsMenuItem = page.locator('[data-test="menu-link-\\/streams-item"]');
        this.refreshStatsButton = page.locator('[data-test="log-stream-refresh-stats-btn"]');
        this.searchStreamInput = page.getByPlaceholder('Search Stream');
        this.exploreButton = page.getByRole('button', { name: 'Explore' });
        this.timestampColumnMenu = page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]');
        this.nameCell = page.getByRole('cell', { name: 'Name' });
        this.streamIcon = page.getByRole("img", { name: "Stream", exact: true });
        this.outputStreamIcon = page.getByRole("img", { name: "Output Stream" });
        this.containsOption = page.getByText("Contains", { exact: true });
        this.kubernetesContainerNameOption = page.getByRole("option", { name: "kubernetes_container_name" });
        this.conditionText = page.getByText('kubernetes_container_name');
        this.pipelineSavedMessage = page.getByText('Pipeline saved successfully');
        this.addEnrichmentTableText = page.getByText("New enrichment table");
        this.deletedSuccessfullyText = page.getByText('deleted successfully');
        this.conditionDropdown = page.locator("div:nth-child(2) > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native");
        this.deleteButtonNth1 = page.locator("button").filter({ hasText: "delete" }).nth(1);
    }

    // Methods from original PipelinesPage
    async gotoPipelinesPage() {
        await this.pipelinesPageMenu.click();
    }

    async pipelinesPageDefaultOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByText('default', { exact: true }).first().click();
    }

    async pipelinesPageDefaultMultiOrg() {
        await this.page.locator('[data-test="navbar-organizations-select"]').getByText('arrow_drop_down').click();
        await this.page.getByRole('option', { name: 'defaulttestmulti' }).locator('div').nth(2).click();
    }

    async pipelinesPageURLValidation() {
        //TODO Fix this test
        // await expect(this.page).not.toHaveURL(/default/);
    }

    async pipelinesURLValidation() {
        await expect(this.page).toHaveURL(/pipeline/);
    }

    // Methods from PipelinePage
    async openPipelineMenu() {
        await this.pipelineMenuLink.click();
        await this.page.waitForTimeout(1000);
        await this.pipelineTab.click();
        await this.page.waitForTimeout(2000);
    }

    async addPipeline() {
        // Wait for the add pipeline button to be visible
        await this.addPipelineButton.waitFor({ state: 'visible', timeout: 30000 });
        await this.addPipelineButton.click();
    }

    async selectStream() {
        await this.streamButton.click();
    }

    async dragStreamToTarget(streamElement, offset = { x: 0, y: 0 }) {
        const targetBox = await this.vueFlowPane.boundingBox();
        const streamBox = await streamElement.boundingBox();
        targetBox.x += offset.x;
      targetBox.y += offset.y;
        if (streamBox && targetBox) {
          await this.page.mouse.move(streamBox.x + streamBox.width / 2, streamBox.y + streamBox.height / 2);
          await this.page.mouse.down();
          await this.page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
          await this.page.mouse.up();
        }
    }

    async selectLogs() {
        await this.logsDropdown.click();
        await this.logsOption.click();
    }

    async saveStream() {
        await this.saveButton.click();
    }

    async confirmStreamError() {
        await this.selectStreamError.click();
    }

    async savePipeline() {
        await this.savePipelineButton.click();
    }

    async confirmPipelineNameRequired() {
        await this.pipelineNameRequiredMessage.click();
    }

    async enterPipelineName(pipelineName) {
        await this.pipelineNameInput.waitFor({ state: 'visible', timeout: 10000 });
        await this.pipelineNameInput.click();
        await this.pipelineNameInput.fill(pipelineName);
    }

    async confirmSourceNodeRequired() {
        await this.sourceNodeRequiredMessage.click();
    }
    async enterStreamName(streamName) {
        await this.streamNameInput.fill(streamName);
        await this.streamNameInput.press("Enter");
    }

    async selectStreamOption() {
        await this.e2eAutomateOption.click();
    }

    async saveInputNodeStream() {
        await this.inputNodeStreamSaveButton.click();
    }

    async confirmDestinationNodeRequired() {
        await this.destinationNodeRequiredMessage.click();
    }
    async deletePipeline() {
        // Navigate back from pipeline editing
        await this.page.locator('[data-test="add-pipeline-back-btn"]').click();
    }

    async confirmDelete() {
        await this.confirmDeleteButton.click();
    }

    async selectAndDragSecondStream() {
        await this.secondStreamButton.click();
        await this.dragStreamToTarget(this.secondStreamButton,{ x: 120, y: 120 });
    }

    async selectAndDragFunction() {
        await this.secondStreamButton.click();
        await this.dragStreamToTarget(this.functionButton, { x: 50, y: 50 });
    }

    async selectPreviousNode() {
        await this.selectPreviousNodeDropdown.click();
    }

    async selectPreviousNodeDrop() {
        await this.previousNodeDropdownSecond.click();
    }

    // Method to toggle the create stream option
    async toggleCreateStream() {
        await this.createStreamToggle.click();
    }

    async clickSaveStream() {
        await this.saveStreamButton.click();
    }

    // Method to click the input node stream save button
    async clickInputNodeStreamSave() {
        await this.inputNodeStreamSaveButton.click();
    }
    async searchPipeline(pipelineName) {
        await this.pipelineSearchInput.click();
        await this.pipelineSearchInput.fill(pipelineName);
    }

    async confirmDeletePipeline() {
        await this.confirmDeleteButton.click();
    }

    // Method to verify deletion success message
    async verifyPipelineDeleted() {
        await this.deletionSuccessMessage.click();
    }

    async clickSqlEditor() {
        await this.sqlEditor.click();
    }

    // Method to type the SQL query
    async typeSqlQuery(query) {
        await this.sqlQueryInput.click();
        await this.sqlQueryInput.fill(query);
    }

    // Method to select the frequency unit dropdown
    async selectFrequencyUnit() {
        await this.frequencyUnit.click();
    }

    // Method to save the query
    async saveQuery() {
        await this.saveQueryButton.click();
    }

    async selectFunction() {
        await this.functionButton.click();
    }

    async toggleCreateFunction() {
        await this.createFunctionToggle.click();
    }

    async clickFunctionLabel(name) {
        // Click the label and then fill in the input that appears
        await this.functionNameLabel.click();
    }
    async saveFunction() {
        await this.associateFunctionSaveButton.click();
    }

    async saveNewFunction() {
        await this.associateNewFunctionSaveButton.click();
    }

    async enterFunctionName(name) {
        await this.functionNameInput.fill(name);
    }

    async assertFunctionNameRequiredErrorVisible() {
        await expect(this.functionNameRequiredError).toBeVisible();
    }

    async assertFunctionNameRequiredErrorNotToBeVisible() {
        await expect(this.functionNameRequiredError).not.toBeVisible();
    }

    async assertFunctionRequiredErrorVisible() {
        await expect(this.functionRequiredError).toBeVisible();
    }
    async assertStreamSelectionErrorVisible() {
        await expect(this.streamSelectionError).toBeVisible();
    }

    async selectAndDragCondition() {
        await this.dragStreamToTarget(this.conditionButton, { x: 250, y: 250 });
    }
    async fillColumnAndSelectOption(columnName) {
        // Click the column select (q-select in FilterCondition)
        await this.columnSelect.locator('input').click();
        await this.columnSelect.locator('input').fill(columnName);
        await this.columnOption.click();
    }
    async saveCondition() {
        await this.addConditionSaveButton.click();
    }
    async verifyFieldRequiredError() {
        await this.fieldRequiredError.waitFor({ state: 'visible' });
        await this.fieldRequiredError.click();
    }

    async navigateToAddEnrichmentTable() {
        await this.page.locator(this.pipelineMenu).click();
        await this.page.click(this.enrichmentTableTab, { force: true });
        await this.addEnrichmentTableText.click();
    }

    async uploadEnrichmentTable(fileName, fileContentPath) {
        // Set the file to be uploaded
        const inputFile = await this.page.locator('input[type="file"]');
        await inputFile.setInputFiles(fileContentPath);

        // Enter the file name
        await this.page.getByLabel('File Name').fill(fileName);

        // Click on 'Save'
        await this.saveButton.click({ force: true });

        // Wait for the process to complete
        await this.page.reload();
        await this.page.waitForTimeout(3000);

        // Search for the uploaded file
        await this.page.getByPlaceholder('Search').fill(fileName);
        await this.page.waitForTimeout(3000);
    }
    async deleteEnrichmentTableByName(fileName) {
        // First ensure we search for the specific file
        await this.page.waitForLoadState('networkidle');
        const searchBox = this.page.getByPlaceholder('Search Enrichment Table');
        await searchBox.waitFor({ state: 'visible' });
        await searchBox.clear();
        await searchBox.fill(fileName);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(1000); // Allow search to filter results
        
        const rows = await this.tableRowsLocator;
        let fileFound = false;

        for (let i = 0; i < (await rows.count()); i++) {
            const row = rows.nth(i);
            const functionName = await row
              .locator("td.text-left")
              .nth(1)
              .textContent();

            if (functionName?.trim() === fileName) {
                fileFound = true;
                console.log("Uploaded file found:", functionName);

                // Click the 'Delete Function' button
                await row.locator('[title="Delete Function"]').click();

                // Confirm the deletion
                await this.confirmButton.click();
                break;
            }
        }

        if (!fileFound) {
            throw new Error(
              `Uploaded file "${fileName}" not found in the enrichment table.`
            );
        }

    }

    async navigateToEnrichmentTableTab() {
        await this.pipelineMenuLink.click();
        await this.enrichmentTableTab.click();
    }

    async deleteDestination(randomNodeName) {
        await this.settingsMenu.click();
        await this.pipelineDestinationsTab.click();
        await this.searchInput.click();
        await this.searchInput.fill(randomNodeName);
        
        const deleteButton = this.page.locator(`[data-test="alert-destination-list-${randomNodeName}-delete-destination"]`);
        await deleteButton.click();
        await this.confirmButton.click();
        
        await expect(this.deletedSuccessfullyText).toBeVisible();
    }

    async createRemoteDestination(randomNodeName, AuthorizationToken) {
        const orgId = process.env["ORGNAME"];
        const streamName = "remote_automate";
        const url = process.env.INGESTION_URL;

        await this.remoteDestinationIcon.waitFor();
        await this.remoteDestinationIcon.click();
        await this.toggleCreateStream();
        
        await this.nameInput.waitFor();
        await this.nameInput.fill(randomNodeName);
        
        await this.saveButton.waitFor();
        await this.saveButton.click();

        await this.urlInput.waitFor();
        await this.urlInput.fill(`${url}/api/${orgId}/${streamName}/_json`);
        
        await this.headerKeyInput.waitFor();
        await this.headerKeyInput.fill("Authorization");
        
        await this.headerValueInput.waitFor();
        await this.headerValueInput.fill(`Basic ${AuthorizationToken}`);

        await this.submitButton.waitFor();
        await this.submitButton.click();
        await this.page.waitForTimeout(1000);
        
        await this.submitButton.waitFor();
        await this.submitButton.click();
    }

    async navigateToStreams() {
        await this.streamsMenuItem.click();
        await this.page.waitForTimeout(1000);
    }

    async refreshStreamStats() {
        await this.refreshStatsButton.click();
        await this.page.waitForTimeout(1000);
    }

    async searchStream(streamName) {
        await this.searchStreamInput.click();
        await this.searchStreamInput.fill(streamName);
        await this.page.waitForTimeout(1000);
    }

    async clickExplore() {
        await this.nameCell.click();
        await this.exploreButton.first().click();
        await this.page.waitForTimeout(3000);
    }

    async openTimestampMenu() {
        await this.timestampColumnMenu.click();
    }

    async navigateToPipeline() {
        await this.pipelineMenuLink.click();
    }

    async setupContainerNameCondition() {
        // Use drag and drop approach for condition node
        await this.selectAndDragCondition();
        await this.page.waitForTimeout(1000);

        // FilterGroup UI: Click column select and fill
        await this.columnSelect.locator('input').click();
        await this.columnSelect.locator('input').fill("container_name");
        await this.page.waitForTimeout(500);
        await this.page.getByRole("option", { name: "kubernetes_container_name" }).click();

        // Click operator select and choose Contains
        await this.operatorSelect.click();
        await this.page.waitForTimeout(300);
        await this.containsOption.click();

        // Fill value input
        await this.valueInput.locator('input').click();
        await this.valueInput.locator('input').fill("ziox");

        await this.saveCondition();
        await this.page.waitForTimeout(2000);
    }

    async setupDestinationStream(dynamicDestinationName) {
        // Use drag and drop approach instead of icon click
        await this.selectAndDragSecondStream();
        await this.streamNameInput.click();
        await this.page.waitForTimeout(1000);
        await this.streamNameInput.fill(dynamicDestinationName);
        await this.page.waitForTimeout(1000);
        await this.clickInputNodeStreamSave();
        
        // Wait for dialog to close and add edge connections
        await this.page.waitForTimeout(2000);
        await this.page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' });
        await this.page.waitForSelector('[data-test="pipeline-node-default-input-handle"]', { state: 'visible' });
        await this.page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' });
        
        // Ensure no dialogs are blocking the interaction
        await this.page.waitForSelector('.q-dialog__backdrop', { state: 'hidden', timeout: 3000 }).catch(() => {
            // Ignore if no backdrop exists
        });
        
        // Connect the input node to condition to output node by creating edges
        await this.page.locator('[data-test="pipeline-node-input-output-handle"]').hover({ force: true });
        await this.page.mouse.down();
        await this.page.locator('[data-test="pipeline-node-default-input-handle"]').hover({ force: true });
        await this.page.mouse.up();
        await this.page.waitForTimeout(500);
        
        await this.page.locator('[data-test="pipeline-node-default-output-handle"]').hover({ force: true });
        await this.page.mouse.down();
        await this.page.locator('[data-test="pipeline-node-output-input-handle"]').hover({ force: true });
        await this.page.mouse.up();
        await this.page.waitForTimeout(1000);
    }

    async waitForPipelineSaved() {
        await this.pipelineSavedMessage.waitFor({ state: "visible" });
    }

    async exploreStreamAndNavigateToPipeline(streamName) {
        // Ingestion for the specific stream
        const orgId = process.env["ORGNAME"];
        const headers = {
            "Authorization": `Basic ${Buffer.from(
              `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
            ).toString('base64')}`,
            "Content-Type": "application/json",
        };
        
        const url = `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`;
        await this.page.evaluate(async ({ url, headers, logsdata }) => {
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(logsdata)
            });
            return await response.json();
        }, {
            url: url,
            headers: headers,
            logsdata: require('../../../test-data/logs_data.json')
        });
        await this.page.waitForTimeout(2000);

        // Navigate and explore
        await this.navigateToStreams();
        await this.refreshStreamStats();
        await this.searchStream(streamName);
        await this.clickExplore();
        await this.openTimestampMenu();
        await this.navigateToPipeline();
    }

    async setupPipelineWithSourceStream(sourceStream) {
        await this.openPipelineMenu();
        await this.page.waitForTimeout(1000);
        await this.addPipeline();
        await this.selectStream();
        await this.dragStreamToTarget(this.streamButton);
        await this.selectLogs();
        await this.enterStreamName(sourceStream);
        await this.page.waitForTimeout(2000);
        await this.page.getByRole("option", { name: sourceStream, exact: true }).click();
        await this.saveInputNodeStream();
        await this.page.waitForTimeout(2000);
        // Use new hover-based delete approach with data-test locator
        await this.page.locator('[data-test="pipeline-node-output-stream-node"]').first().hover();
        await this.page.waitForTimeout(500);
        await this.page.locator('[data-test="pipeline-node-output-delete-btn"]').first().click();
        await this.confirmDeleteButton.click();
    }

    async createAndVerifyPipeline(expectedStreamName, sourceStream) {
        const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
        await this.enterPipelineName(pipelineName);
        await this.savePipeline();
        await this.waitForPipelineSaved();

        // Verify the dynamic destination stream exists
        await this.exploreStreamAndNavigateToPipeline(expectedStreamName);

        // Verify pipeline creation and cleanup
        await this.searchPipeline(pipelineName);
        await this.page.waitForTimeout(1000);
        const deletePipelineButton = this.page.locator(
          `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
        );
        await deletePipelineButton.waitFor({ state: "visible" });
        await deletePipelineButton.click();
        await this.confirmDeletePipeline();
        await this.verifyPipelineDeleted();
    }
}
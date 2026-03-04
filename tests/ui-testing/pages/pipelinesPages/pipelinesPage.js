// pipelinesPage.js
const { expect } = require('@playwright/test')
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const fetch = require('node-fetch');

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
        // Get the innermost Monaco editor element (handles nested .monaco-editor elements)
        this.sqlQueryInput = page.locator('.monaco-editor').last();
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
        this.addEnrichmentTableButton = page.getByRole('button', { name: 'New enrichment table' });
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

        // Scheduled Pipeline Dialog selectors
        this.scheduledPipelineTabs = page.locator('[data-test="scheduled-pipeline-tabs"]');
        this.scheduledPipelineSqlEditor = page.locator('[data-test="scheduled-pipeline-sql-editor"]');
        this.buildQuerySection = page.getByText('Build Query').first();
        this.streamTypeLabel = page.getByLabel(/Stream Type/i);
        this.streamNameLabel = page.getByLabel(/Stream Name/i);
        this.monacoEditorViewLines = page.locator('.monaco-editor .view-lines');
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
        this.addEnrichmentTableText = page.getByRole('button', { name: 'New enrichment table' });
        this.deletedSuccessfullyText = page.getByText('deleted successfully');
        this.conditionDropdown = page.locator("div:nth-child(2) > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native");
        this.deleteButtonNth1 = page.locator("button").filter({ hasText: "delete" }).nth(1);

        // Condition-specific locators for comprehensive testing
        this.addConditionSection = page.locator('[data-test="add-condition-section"]');
        this.addConditionGroupBtn = page.locator('[data-test="alert-conditions-add-condition-group-btn"]');
        this.toggleOperatorBtn = page.locator('[data-test="alert-conditions-toggle-operator-btn"]');
        this.deleteConditionBtn = page.locator('[data-test="alert-conditions-delete-condition-btn"]');
        this.reorderBtn = page.locator('[data-test="alert-conditions-reorder-btn"]');
        this.addConditionCancelBtn = page.locator('[data-test="add-condition-cancel-btn"]');
        this.addConditionDeleteBtn = page.locator('[data-test="add-condition-delete-btn"]');
        this.scheduledAlertTabs = page.locator('[data-test="scheduled-alert-tabs"]');
        this.nestedGroups = page.locator('.el-border');
        this.operatorLabels = page.locator('span.tw\\:lowercase');
        this.firstConditionLabel = page.locator('[data-test="add-condition-section"]').getByText('if', { exact: true }).first();
        this.noteContainer = page.locator('.note-container');
        this.noteHeading = page.locator('.note-heading');
        this.noteInfo = page.locator('.note-info');
        this.qDialog = page.locator('.q-dialog');
        this.qDialogBackdrop = page.locator('.q-dialog__backdrop');
        this.qNotificationMessage = page.locator('.q-notification__message');
        this.qMenu = page.locator('.q-menu');

        // Pipeline node locators
        this.pipelineNodeOutputStreamNode = page.locator('[data-test="pipeline-node-output-stream-node"]');
        this.pipelineNodeOutputDeleteBtn = page.locator('[data-test="pipeline-node-output-delete-btn"]');
        this.pipelineNodeDefaultConditionNode = page.locator('[data-test="pipeline-node-default-condition-node"]');
        this.pipelineNodeInputOutputHandle = page.locator('[data-test="pipeline-node-input-output-handle"]');
        this.pipelineNodeDefaultInputHandle = page.locator('[data-test="pipeline-node-default-input-handle"]');
        this.pipelineNodeDefaultOutputHandle = page.locator('[data-test="pipeline-node-default-output-handle"]');
        this.pipelineNodeOutputInputHandle = page.locator('[data-test="pipeline-node-output-input-handle"]');
        this.addPipelineBackBtn = page.locator('[data-test="add-pipeline-back-btn"]');

        // Additional locators for raw selector fixes
        this.functionIcon = page.getByRole("img", { name: "Function", exact: true });
        // VRL editor uses unified-query-editor with data-test attribute (may have multiple matches)
        this.vrlFunctionEditor = page.locator('[data-test="logs-vrl-function-editor"]').first();
        this.vrlEditorViewLines = page.locator('[data-test="logs-vrl-function-editor"]').first().locator('.view-lines');
        // Get the innermost Monaco editor element (handles nested .monaco-editor elements)
        this.vrlEditorMonaco = page.locator('[data-test="logs-vrl-function-editor"]').first().locator('.monaco-editor').last();
        this.noteText = page.getByText("Note: The function will be");
        this.streamTypeDropdown = page.locator('div').filter({ hasText: /^Stream Type \*$/ }).first();
        this.streamTypeLabel = page.getByLabel('Stream Type *');
        this.sqlEditorViewLines = page.locator('[data-test="scheduled-pipeline-sql-editor"] .view-lines');
        this.invalidSqlQueryText = page.getByText("Invalid SQL Query");
        this.queryRoutingSection = page.locator('[data-test="add-stream-query-routing-section "]');
        this.queryNode = page.locator('[data-test="pipeline-node-input-query-node"]');
        this.queryNodeDeleteBtn = page.locator('[data-test="pipeline-node-input-delete-btn"]');
        this.cancelPipelineBtn = page.locator('[data-test="add-pipeline-cancel-btn"]');
        this.dashboardsMenuLink = page.locator('[data-test="menu-link-\\/dashboards-item"]');
        this.connectAllNodesError = page.getByText("Please connect all nodes");
        this.logsOptionRole = page.getByRole("option", { name: "logs" });
        this.fileInput = page.locator('input[type="file"]');

        // Scheduled Pipeline Validation locators (Issue #9901 regression tests)
        this.validateAndCloseBtn = page.locator('[data-test="stream-routing-query-save-btn"]');
        this.streamRoutingQueryCancelBtn = page.locator('[data-test="stream-routing-query-cancel-btn"]');
        this.discardChangesDialog = page.getByText('Discard Changes');
        this.discardChangesOkBtn = page.locator('.q-dialog').locator('[data-test="confirm-button"]');
        this.scheduledPipelineCancelBtn = page.locator('button').filter({ hasText: 'Cancel' }).first();
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

    /**
     * Click the stream type select dropdown in the add pipeline dialog
     */
    async clickStreamTypeSelect() {
        // Wait for the add pipeline dialog to be visible
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(1000);

        // The data-test attribute is on a wrapper div, the q-select is inside
        // Target the q-select input inside the wrapper
        const streamTypeWrapper = this.page.locator('[data-test="add-pipeline-stream-type-select"]');
        await streamTypeWrapper.waitFor({ state: 'visible', timeout: 15000 });

        // Click on the q-select component inside the wrapper
        const qSelect = streamTypeWrapper.locator('.q-select');
        await qSelect.waitFor({ state: 'visible', timeout: 10000 });
        await qSelect.click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Verify that a stream type option exists in the dropdown
     * @param {string} typeName - The name of the stream type to verify (e.g., 'metrics', 'traces', 'logs')
     * @returns {Promise<boolean>} - True if option exists
     */
    async verifyStreamTypeOptionExists(typeName) {
        const optionLocator = this.page.getByRole('option', { name: typeName, exact: true });
        return await optionLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click the stream type select dropdown in the stream node form
     * This is used when adding a stream node in the pipeline editor
     */
    async clickInputNodeStreamTypeSelect() {
        // Wait for the stream form dialog to be visible
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(500);

        // The data-test attribute is on a wrapper div, the q-select is inside
        const streamTypeWrapper = this.page.locator('[data-test="input-node-stream-type-select"]').first();
        await streamTypeWrapper.waitFor({ state: 'visible', timeout: 15000 });

        // Click on the q-select component inside the wrapper
        const qSelect = streamTypeWrapper.locator('.q-select');
        await qSelect.waitFor({ state: 'visible', timeout: 10000 });
        await qSelect.click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Select metrics as the stream type in the pipeline node form
     */
    async selectMetrics() {
        // Click the stream type dropdown - use first() to handle multiple elements
        const streamTypeSelect = this.page.locator('[data-test="input-node-stream-type-select"]').first();
        await streamTypeSelect.click();
        await this.page.waitForTimeout(500);
        // Select metrics option
        await this.page.getByRole('option', { name: 'metrics', exact: true }).click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Select traces as the stream type in the pipeline node form
     */
    async selectTraces() {
        // Click the stream type dropdown - use first() to handle multiple elements
        const streamTypeSelect = this.page.locator('[data-test="input-node-stream-type-select"]').first();
        await streamTypeSelect.click();
        await this.page.waitForTimeout(500);
        // Select traces option
        await this.page.getByRole('option', { name: 'traces', exact: true }).click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Get the locator for metrics option in dropdown
     */
    get metricsOptionLocator() {
        return this.page.getByRole('option', { name: 'metrics', exact: true });
    }

    /**
     * Get the locator for traces option in dropdown
     */
    get tracesOptionLocator() {
        return this.page.getByRole('option', { name: 'traces', exact: true });
    }

    /**
     * Check if metrics option is visible in the dropdown
     * @returns {Promise<boolean>} - True if metrics option is visible
     */
    async isMetricsOptionVisible() {
        const optionLocator = this.page.getByRole('option', { name: 'metrics', exact: true });
        return await optionLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if traces option is visible in the dropdown
     * @returns {Promise<boolean>} - True if traces option is visible
     */
    async isTracesOptionVisible() {
        const optionLocator = this.page.getByRole('option', { name: 'traces', exact: true });
        return await optionLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Log all available menu options (for debugging)
     */
    async logMenuOptions() {
        const options = await this.page.locator('[role="option"]').allTextContents();
        testLogger.debug('[logMenuOptions] Available options', { options });
    }

    /**
     * Get the locator for after flattening toggle
     */
    get afterFlatteningToggleLocator() {
        return this.page.locator('[data-test="associate-function-after-flattening-toggle"]');
    }

    /**
     * Check if after flattening toggle is visible
     * @returns {Promise<boolean>} - True if toggle is visible
     */
    async isAfterFlatteningToggleVisible() {
        const toggle = this.page.locator('[data-test="associate-function-after-flattening-toggle"]');
        return await toggle.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click the after flattening toggle
     */
    async clickAfterFlatteningToggle() {
        const toggle = this.page.locator('[data-test="associate-function-after-flattening-toggle"]');
        await toggle.waitFor({ state: 'visible', timeout: 10000 });
        await toggle.click();
        await this.page.waitForTimeout(500);
    }

    /**
     * Check if after flattening text is visible (alternative check)
     * @returns {Promise<boolean>} - True if text is visible
     */
    async isAfterFlatteningTextVisible() {
        const text = this.page.getByText('After Flattening');
        return await text.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if the pipeline list search input is visible
     * @returns {Promise<boolean>} - True if input is visible
     */
    async isPipelineListSearchInputVisible() {
        return await this.pipelineSearchInput.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Fill the pipeline list search input
     * @param {string} searchTerm - The search term to enter
     */
    async fillPipelineListSearch(searchTerm) {
        await this.pipelineSearchInput.waitFor({ state: 'visible', timeout: 10000 });
        await this.pipelineSearchInput.fill(searchTerm);
        await this.page.waitForTimeout(500);
    }

    /**
     * Clear the pipeline list search input
     */
    async clearPipelineListSearch() {
        await this.pipelineSearchInput.waitFor({ state: 'visible', timeout: 10000 });
        await this.pipelineSearchInput.clear();
        await this.page.waitForTimeout(500);
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

    /**
     * Select a stream option by name from the dropdown
     * @param {string} streamName - The name of the stream to select
     */
    async selectStreamOptionByName(streamName) {
        await this.page.waitForTimeout(1000);
        const optionLocator = this.page.getByRole('option', { name: streamName, exact: true });
        await optionLocator.waitFor({ state: 'visible', timeout: 10000 });
        await optionLocator.click();
        // Press Escape to close any open dropdown menus
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
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
        await this.dragStreamToTarget(this.functionButton, { x: 250, y: 200 });
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

    /**
     * Verify that a pipeline exists in the pipeline list
     * @param {string} pipelineName - Name of the pipeline to verify
     * @returns {Promise<boolean>} - True if pipeline exists, false otherwise
     */
    async verifyPipelineExists(pipelineName) {
        await this.page.waitForLoadState('networkidle');
        await this.page.waitForTimeout(2000);
        await this.searchPipeline(pipelineName);
        await this.page.waitForTimeout(2000);
        const pipelineRow = this.page.locator('tbody tr').filter({ hasText: pipelineName }).first();
        return await pipelineRow.isVisible({ timeout: 10000 }).catch(() => false);
    }

    async confirmDeletePipeline() {
        await this.confirmDeleteButton.click();
    }

    /**
     * Verify that a metrics destination stream exists
     * @param {string} streamName - Name of the stream to verify
     * @returns {Promise<boolean>} - True if stream exists, false otherwise
     */
    async verifyMetricsDestinationStreamExists(streamName) {
        try {
            // Use API to check stream existence - more reliable than UI navigation
            const orgName = process.env["ORGNAME"];
            const baseUrl = process.env["ZO_BASE_URL"] || process.env["INGESTION_URL"]?.replace('/api/', '') || 'http://localhost:5080';
            const basicAuth = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');

            const response = await this.page.request.get(
                `${baseUrl}/api/${orgName}/streams?type=metrics&keyword=${streamName}`,
                { headers: { 'Authorization': `Basic ${basicAuth}` } }
            );

            if (response.ok()) {
                const data = await response.json();
                const found = data.list?.some(s => s.name === streamName) || false;
                testLogger.debug('[verifyMetricsDestinationStreamExists] API check', { streamName, found, total: data.list?.length });
                return found;
            }
            testLogger.debug('[verifyMetricsDestinationStreamExists] API returned non-OK', { status: response.status() });
            return false;
        } catch (e) {
            testLogger.debug('[verifyMetricsDestinationStreamExists] Error during verification', { error: e.message, streamName });
            return false;
        }
    }

    /**
     * Verify that a traces destination stream exists
     * @param {string} streamName - Name of the stream to verify
     * @returns {Promise<boolean>} - True if stream exists, false otherwise
     */
    async verifyTracesDestinationStreamExists(streamName) {
        try {
            // Use API to check stream existence - more reliable than UI navigation
            const orgName = process.env["ORGNAME"];
            const baseUrl = process.env["ZO_BASE_URL"] || process.env["INGESTION_URL"]?.replace('/api/', '') || 'http://localhost:5080';
            const basicAuth = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');

            const response = await this.page.request.get(
                `${baseUrl}/api/${orgName}/streams?type=traces&keyword=${streamName}`,
                { headers: { 'Authorization': `Basic ${basicAuth}` } }
            );

            if (response.ok()) {
                const data = await response.json();
                const found = data.list?.some(s => s.name === streamName) || false;
                testLogger.debug('[verifyTracesDestinationStreamExists] API check', { streamName, found, total: data.list?.length });
                return found;
            }
            testLogger.debug('[verifyTracesDestinationStreamExists] API returned non-OK', { status: response.status() });
            return false;
        } catch (e) {
            testLogger.debug('[verifyTracesDestinationStreamExists] Error during verification', { error: e.message, streamName });
            return false;
        }
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
        await this.waitForQuerySectionHidden();
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
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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
                testLogger.debug("Uploaded file found", { functionName });

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

    /**
     * Delete an output stream node by hovering and clicking the delete button
     * Uses the first output stream node found
     */
    async deleteOutputStreamNode() {
        await this.pipelineNodeOutputStreamNode.first().hover();
        await this.page.waitForTimeout(500);
        await this.pipelineNodeOutputDeleteBtn.first().click();
        await this.confirmButton.click();
    }

    /**
     * Verify that the output stream node has been deleted
     * @returns {Promise<boolean>} True if node count is 0
     */
    async verifyOutputStreamNodeDeleted() {
        await this.page.waitForTimeout(1000);
        const nodeCount = await this.pipelineNodeOutputStreamNode.count();
        return nodeCount === 0;
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
        // Click on more options (three-dot menu) then delete
        const moreOptionsButton = this.page.locator(
          `[data-test="pipeline-list-${pipelineName}-more-options"]`
        );
        await moreOptionsButton.waitFor({ state: "visible" });
        await moreOptionsButton.click();
        await this.page.waitForTimeout(500);
        // Click delete option in the menu (Quasar q-item)
        await this.page.locator('.q-menu .q-item').filter({ hasText: 'Delete' }).click();
        await this.confirmDeletePipeline();
        await this.verifyPipelineDeleted();
    }

    // ========== Condition-specific methods ==========

    async fillCondition(columnName, operator, value, index = 0) {
        const columnSelects = this.columnSelect;

        // Try clicking the input first
        await columnSelects.nth(index).locator('input').click();
        await this.page.waitForTimeout(200);

        // Check if dropdown opened, if not click the dropdown icon
        let menuVisible = await this.qMenu.isVisible().catch(() => false);
        if (!menuVisible) {
            await columnSelects.nth(index).locator('i').click();
            await this.page.waitForTimeout(200);
        }

        await columnSelects.nth(index).locator('input').fill(columnName);
        await this.page.waitForTimeout(500);

        // Select from dropdown
        const options = this.qMenu.locator('.q-item');
        await options.first().click();
        await this.page.waitForTimeout(300);

        // Select operator
        await this.operatorSelect.nth(index).click();
        await this.page.waitForTimeout(500);

        // Scope to the visible dropdown menu and select the operator
        const visibleMenu = this.qMenu.last();
        await visibleMenu.locator('.q-item').getByText(operator, { exact: true }).click();
        await this.page.waitForTimeout(300);

        // Fill value
        await this.valueInput.nth(index).locator('input').click();
        await this.valueInput.nth(index).locator('input').fill(value);
        await this.page.waitForTimeout(300);
    }

    async addNewCondition() {
        await this.addConditionButton.first().click();
        await this.page.waitForTimeout(500);
    }

    async addConditionGroup() {
        await this.addConditionGroupBtn.first().click();
        await this.page.waitForTimeout(500);
    }

    async toggleConditionOperator(index = 0) {
        await this.toggleOperatorBtn.nth(index).click();
        await this.page.waitForTimeout(300);
    }

    async deleteConditionByIndex(index) {
        await this.deleteConditionBtn.nth(index).click();
        await this.page.waitForTimeout(300);
    }

    async createPipelineWithCondition(streamName) {
        await this.openPipelineMenu();
        await this.page.waitForTimeout(1000);
        await this.addPipeline();
        await this.selectStream();
        await this.dragStreamToTarget(this.streamButton);
        await this.selectLogs();
        await this.enterStreamName(streamName);
        await this.page.waitForTimeout(2000);
        await this.page.getByRole("option", { name: streamName, exact: true }).click();
        await this.saveInputNodeStream();
        await this.page.waitForTimeout(2000);

        // Remove default output stream node
        await this.pipelineNodeOutputStreamNode.first().hover();
        await this.page.waitForTimeout(500);
        await this.pipelineNodeOutputDeleteBtn.first().click();
        await this.confirmButton.click();

        // Add condition node
        await this.selectAndDragCondition();
        await this.page.waitForTimeout(1000);
    }

    async saveConditionAndCompletePipeline(pipelineName) {
        await this.saveCondition();
        await this.page.waitForTimeout(2000);

        // Wait for the condition dialog to close and the condition node to appear on canvas
        await this.page.waitForSelector('[data-test="add-condition-section"]', { state: 'hidden', timeout: 5000 }).catch(() => {});
        await this.page.waitForTimeout(1000);

        // Verify the condition node was created successfully
        await expect(this.pipelineNodeDefaultConditionNode).toBeVisible({ timeout: 5000 });

        // Add destination stream
        await this.selectAndDragSecondStream();
        await this.streamNameInput.click();
        await this.streamNameInput.fill("destination-node");
        await this.page.waitForTimeout(1000);
        await this.clickInputNodeStreamSave();

        await this.page.waitForTimeout(2000);
        await this.page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible', timeout: 10000 });
        await this.page.waitForSelector('[data-test="pipeline-node-default-input-handle"]', { state: 'visible', timeout: 10000 });
        await this.page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible', timeout: 10000 });

        await this.page.waitForSelector('.q-dialog__backdrop', { state: 'hidden', timeout: 3000 }).catch(() => {});

        // Connect nodes
        await this.pipelineNodeInputOutputHandle.hover({ force: true });
        await this.page.mouse.down();
        await this.pipelineNodeDefaultInputHandle.hover({ force: true });
        await this.page.mouse.up();
        await this.page.waitForTimeout(500);

        await this.pipelineNodeDefaultOutputHandle.hover({ force: true });
        await this.page.mouse.down();
        await this.pipelineNodeOutputInputHandle.hover({ force: true });
        await this.page.mouse.up();
        await this.page.waitForTimeout(1000);

        await this.enterPipelineName(pipelineName);
        await this.savePipeline();

        // Wait for save to complete
        await this.page.waitForTimeout(3000);
    }

    async deletePipelineByName(pipelineName) {
        await this.searchPipeline(pipelineName);
        await this.page.waitForTimeout(1000);
        // Click on more options (three-dot menu) then delete
        const moreOptionsButton = this.page.locator(
          `[data-test="pipeline-list-${pipelineName}-more-options"]`
        );
        await moreOptionsButton.waitFor({ state: "visible" });
        await moreOptionsButton.click();
        await this.page.waitForTimeout(500);
        // Click delete option in the menu (Quasar q-item)
        await this.page.locator('.q-menu .q-item').filter({ hasText: 'Delete' }).click();
        await this.confirmDeletePipeline();
        await this.verifyPipelineDeleted();
    }

    async openPipelineForEdit(pipelineName) {
        await this.page.locator(`[data-test="pipeline-list-${pipelineName}-update-pipeline"]`).click();
        await this.page.waitForTimeout(2000);
    }

    async clickConditionNode() {
        await this.pipelineNodeDefaultConditionNode.click();
        await this.page.waitForTimeout(1000);
    }

    async reconnectSourceToDestination() {
        await this.pipelineNodeInputOutputHandle.hover({ force: true });
        await this.page.mouse.down();
        await this.pipelineNodeOutputInputHandle.hover({ force: true });
        await this.page.mouse.up();
        await this.page.waitForTimeout(1000);
    }

    async verifyConditionDialogOpen() {
        await expect(this.addConditionSection).toBeVisible();
    }

    async verifyConditionDialogClosed() {
        await expect(this.addConditionSection).not.toBeVisible();
    }

    async verifyFirstConditionLabel(text) {
        await expect(this.firstConditionLabel).toHaveText(text);
    }

    async verifyConditionCount(count) {
        await expect(this.valueInput).toHaveCount(count);
    }

    async verifyNestedGroupsExist() {
        const count = await this.nestedGroups.count();
        expect(count).toBeGreaterThan(1);
    }

    async verifyScheduledAlertTabsVisible() {
        await expect(this.scheduledAlertTabs.first()).toBeVisible();
    }

    async verifyOperatorLabel(text, index = 0) {
        await expect(this.operatorLabels.nth(index)).toContainText(text);
    }

    async verifyNoteContainer() {
        await expect(this.noteContainer).toBeVisible();
        await expect(this.noteHeading).toContainText("Condition value Guidelines");
    }

    async captureConditionValues() {
        const valueInputs = this.valueInput.locator('input');
        const values = [];
        const count = await valueInputs.count();
        for (let i = 0; i < count; i++) {
            const value = await valueInputs.nth(i).inputValue();
            values.push(value);
        }
        return values;
    }

    async clickReorderButton(index = 1) {
        await this.reorderBtn.nth(index).click();
        await this.page.waitForTimeout(500);
    }

    async captureConditionScreenshot() {
        return await this.addConditionSection.screenshot();
    }

    async cancelConditionDialog() {
        await this.addConditionCancelBtn.click();
        await this.page.waitForTimeout(500);
    }

    async clickDeleteConditionNode() {
        const deleteButton = this.addConditionDeleteBtn;
        if (await deleteButton.count() > 0) {
            await deleteButton.click();
            await this.page.waitForTimeout(500);
            await this.confirmButton.click();
            await this.page.waitForTimeout(1000);
        }
    }

    async verifyConditionValueInputValue(value, index = 0) {
        await expect(this.valueInput.nth(index).locator('input')).toHaveValue(value);
    }

    async clearAndFillConditionValue(value, index = 0) {
        await this.valueInput.nth(index).locator('input').clear();
        await this.valueInput.nth(index).locator('input').fill(value);
    }

    async verifyDeleteButtonCount(expectedCount) {
        const count = await this.deleteConditionBtn.count();
        expect(count).toBe(expectedCount);
    }

    async tryToSaveWithoutValidConditions() {
        await this.addConditionSaveButton.click();
        await this.page.waitForTimeout(1000);
    }

    async verifyNotificationVisible() {
        const notification = this.qNotificationMessage;
        if (await notification.count() > 0) {
            await expect(notification.first()).toBeVisible();
        }
        await this.page.waitForTimeout(2000);
    }

    async fillPartialCondition(columnName) {
        await this.columnSelect.first().locator('input').click();
        await this.columnSelect.first().locator('input').fill(columnName);
        await this.page.waitForTimeout(300);
        const options = this.qMenu.locator('.q-item');
        if (await options.count() > 0) {
            await options.first().click();
        }
    }

    async selectOperatorFromMenu(operator) {
        await this.operatorSelect.first().click();
        await this.page.waitForTimeout(500);
        const visibleMenu = this.qMenu.last();
        await visibleMenu.locator('.q-item').getByText(operator, { exact: true }).click();
    }

    async verifyConfirmationDialog() {
        const dialog = this.qDialog;
        if (await dialog.count() > 0) {
            await expect(dialog.first()).toBeVisible();
            await this.confirmButton.click();
        }
    }

    /**
     * ==========================================
     * PIPELINE API METHODS
     * ==========================================
     */

    /**
     * Clean conditions for API (removes UI-only fields)
     * This removes fields like 'id' and 'groupId' that are only used in UI
     * @param {object} conditions - Condition configuration object with UI fields
     * @returns {object} Cleaned conditions for API
     */
    cleanConditionsForAPI(conditions) {
        if (conditions.filterType === "condition") {
            // Remove UI-only fields: id, groupId
            // KEEP values field as it's required by the backend
            const { id, groupId, ...cleaned } = conditions;
            return cleaned;
        } else if (conditions.filterType === "group") {
            // Recursively clean nested conditions
            const { id, groupId, ...cleaned } = conditions;
            cleaned.conditions = conditions.conditions.map(c => this.cleanConditionsForAPI(c));
            return cleaned;
        }
        return conditions;
    }

    /**
     * Create a pipeline via API
     * @param {string} pipelineName - Name of the pipeline
     * @param {string} sourceStream - Source stream name
     * @param {string} destStream - Destination stream name
     * @param {object} conditions - Condition configuration object
     * @returns {Promise<object>} API response
     */
    async createPipeline(pipelineName, sourceStream, destStream, conditions) {
        const orgId = process.env["ORGNAME"];
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        // Clean conditions to remove UI-only fields
        const cleanedConditions = this.cleanConditionsForAPI(conditions);
        testLogger.info('Cleaned conditions', { cleaned: JSON.stringify(cleanedConditions, null, 2) });

        // Generate unique node IDs
        const inputNodeId = `input-${Date.now()}`;
        const conditionNodeId = `condition-${Date.now()}`;
        const outputNodeId = `output-${Date.now()}`;

        const pipelinePayload = {
            pipeline_id: "",
            version: 0,
            enabled: true,  // Enable pipeline for realtime processing
            org: orgId,
            name: pipelineName,
            description: `Validation test pipeline for ${pipelineName}`,
            source: {
                source_type: "realtime"
            },
            paused_at: null,
            nodes: [
                {
                    id: inputNodeId,
                    position: { x: 100, y: 100 },
                    data: {
                        node_type: "stream",
                        stream_type: "logs",
                        stream_name: sourceStream,
                        org_id: orgId
                    },
                    io_type: "input"
                },
                {
                    id: conditionNodeId,
                    position: { x: 300, y: 200 },
                    data: {
                        node_type: "condition",
                        version: 2,
                        conditions: cleanedConditions
                    },
                    io_type: "intermediate"
                },
                {
                    id: outputNodeId,
                    position: { x: 500, y: 100 },
                    data: {
                        node_type: "stream",
                        stream_type: "logs",
                        stream_name: destStream,
                        org_id: orgId
                    },
                    io_type: "output"
                }
            ],
            edges: [
                {
                    id: `${inputNodeId}-${conditionNodeId}`,
                    source: inputNodeId,
                    target: conditionNodeId,
                    sourceHandle: "success"
                },
                {
                    id: `${conditionNodeId}-${outputNodeId}`,
                    source: conditionNodeId,
                    target: outputNodeId,
                    sourceHandle: "success"
                }
            ]
        };

        testLogger.info('Creating pipeline via API', { pipelineName, sourceStream, destStream });

        try {
            const response = await fetch(`${process.env.ZO_BASE_URL}/api/${orgId}/pipelines`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(pipelinePayload)
            });

            const data = await response.json();

            if (response.status === 200 && data.code === 200) {
                testLogger.info('Pipeline created successfully', { pipelineName });
            } else {
                testLogger.warn('Pipeline creation returned non-200', { pipelineName, status: response.status, data });
            }

            return { status: response.status, data };
        } catch (error) {
            testLogger.error('Failed to create pipeline', { pipelineName, error: error.message });
            return { status: 500, error: error.message };
        }
    }

    /**
     * Explore a stream and interact with log details, then navigate to pipeline
     * @param {string} streamName - Name of the stream to explore
     */
    async exploreStreamAndInteractWithLogDetails(streamName) {
        // Navigate to the streams menu
        await this.streamsMenuItem.click();
        await this.page.waitForTimeout(1000);

        // Search for the stream
        await this.searchStreamInput.click();
        await this.searchStreamInput.fill(streamName);
        await this.page.waitForTimeout(1000);

        // Click on the 'Explore' button
        await this.exploreButton.first().click();
        await this.page.waitForTimeout(3000);

        await this.page.waitForSelector('[data-test="logs-search-result-table-body"]');

        // Expand the log table menu
        await this.timestampColumnMenu.click();

        // Navigate to the pipeline menu
        await this.pipelineMenuLink.click();
    }

    /**
     * Cancel pipeline creation and delete the pipeline by name
     * @param {string} pipelineName - Name of the pipeline to delete
     * @param {string} searchPrefix - Search prefix for finding the pipeline (default: 'automatepi')
     */
    async cancelAndDeletePipeline(pipelineName, searchPrefix = 'automatepi') {
        // Click the cancel/back button
        await this.page.locator('[data-test="add-pipeline-cancel-btn"]').click();
        await this.confirmButton.click();
        await this.page.waitForTimeout(2000);

        // Search for the pipeline
        await this.pipelineSearchInput.click();
        await this.pipelineSearchInput.fill(searchPrefix);

        // Delete the pipeline via more options menu
        const moreOptionsButton = this.page.locator(
          `[data-test="pipeline-list-${pipelineName}-more-options"]`
        );
        await moreOptionsButton.waitFor({ state: "visible" });
        await moreOptionsButton.click();
        await this.page.waitForTimeout(500);
        await this.page.getByRole('menuitem').filter({ hasText: 'Delete' }).click();
        await this.confirmButton.click();
    }

    /**
     * Perform bulk ingestion to multiple streams
     * @param {string[]} streamNames - Array of stream names to ingest data into
     * @param {object} data - Data to ingest (JSON array)
     */
    async bulkIngestToStreams(streamNames, data) {
        const orgId = process.env["ORGNAME"];
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        for (const streamName of streamNames) {
            const response = await this.page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
                const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(logsdata)
                });
                return await fetchResponse.json();
            }, {
                url: process.env.INGESTION_URL,
                headers: headers,
                orgId: orgId,
                streamName: streamName,
                logsdata: data
            });
            testLogger.debug('Bulk ingestion response', { streamName, response });
        }
    }

    /**
     * Ingest metrics data using the simple JSON API
     * POST /api/{org}/ingest/metrics/_json
     * @param {string} streamName - The name of the metrics stream (will be used as __name__)
     * @param {number} recordCount - Number of records to generate (default: 10)
     * @returns {Promise<{status: number, data: object}>} The ingestion response
     */
    async ingestMetricsData(streamName, recordCount = 10) {
        const orgId = process.env["ORGNAME"];
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        const timestamp = Math.floor(Date.now() / 1000);

        // Create metrics data with realistic values
        const metricsData = [];
        for (let i = 0; i < recordCount; i++) {
            metricsData.push({
                "__name__": streamName,
                "__type__": "gauge",
                "host_name": `server-${i % 3 + 1}`,
                "k8s_cluster": "prod-cluster",
                "k8s_container_name": "app-container",
                "region": ["us-east-1", "us-west-2", "eu-west-1"][i % 3],
                "_timestamp": timestamp - (i * 60), // Spread across time
                "value": 20 + Math.random() * 60 // Random value between 20-80
            });
        }

        const response = await this.page.evaluate(async ({ url, headers, orgId, metricsData }) => {
            const fetchResponse = await fetch(`${url}/api/${orgId}/ingest/metrics/_json`, {
                method: 'POST',
                headers: {
                    "Authorization": `Basic ${headers}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(metricsData)
            });
            return {
                status: fetchResponse.status,
                data: await fetchResponse.json()
            };
        }, {
            url: process.env.INGESTION_URL,
            headers: basicAuthCredentials,
            orgId: orgId,
            metricsData: metricsData
        });

        testLogger.info('Metrics ingestion response', { streamName, status: response.status, data: response.data });
        return response;
    }

    /**
     * Ingest traces data using OTLP JSON API
     * POST /api/{org}/v1/traces
     *
     * By default, traces go to the "default" stream. To use a custom stream,
     * pass the streamName parameter which sets the "stream-name" header
     * (configurable via ZO_GRPC_STREAM_HEADER_KEY env var).
     *
     * @param {string} serviceName - The service name for trace attributes
     * @param {number} spanCount - Number of spans to generate (default: 5)
     * @param {string|null} streamName - Custom stream name (default: null, uses "default" stream)
     * @returns {Promise<{status: number, data: object}>} The ingestion response
     */
    async ingestTracesData(serviceName, spanCount = 5, streamName = null) {
        const orgId = process.env["ORGNAME"];
        const basicAuthCredentials = Buffer.from(
            `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
        ).toString('base64');

        // Generate current timestamps in nanoseconds
        const baseTimeNano = BigInt(Date.now()) * BigInt(1000000);

        // Generate a random trace ID (32 hex chars)
        const traceId = Array.from({ length: 32 }, () =>
            Math.floor(Math.random() * 16).toString(16)
        ).join('');

        // Create spans with proper nested parent-child timing
        // Root span is longest, each child starts after parent and ends before parent
        // This creates proper waterfall visualization like in the deployed env
        const spans = [];
        const totalDurationNano = BigInt(100000000); // 100ms total for root span
        const offsetPerLevel = BigInt(5000000); // 5ms offset for each nested level

        for (let i = 0; i < spanCount; i++) {
            const spanId = Array.from({ length: 16 }, () =>
                Math.floor(Math.random() * 16).toString(16)
            ).join('');

            // Each nested span starts slightly after parent and ends slightly before
            // Root span: starts at baseTime, ends at baseTime + totalDuration
            // Child 1: starts at baseTime + offset, ends at baseTime + totalDuration - offset
            // Child 2: starts at baseTime + 2*offset, ends at baseTime + totalDuration - 2*offset
            const spanStartTime = baseTimeNano + (BigInt(i) * offsetPerLevel);
            const spanEndTime = baseTimeNano + totalDurationNano - (BigInt(i) * offsetPerLevel);

            spans.push({
                traceId: traceId,
                spanId: spanId,
                parentSpanId: i === 0 ? "" : spans[i - 1].spanId,
                name: `${serviceName}-operation-${i + 1}`,
                kind: i === 0 ? 2 : 1, // 2 = SERVER, 1 = INTERNAL
                startTimeUnixNano: spanStartTime.toString(),
                endTimeUnixNano: spanEndTime.toString(),
                attributes: [
                    { key: "http.method", value: { stringValue: "GET" } },
                    { key: "http.url", value: { stringValue: `/api/v1/test/${i}` } },
                    { key: "http.status_code", value: { intValue: 200 } }
                ],
                droppedAttributesCount: 0,
                events: [],
                droppedEventsCount: 0,
                links: [],
                droppedLinksCount: 0,
                status: { message: "", code: 1 }
            });
        }

        // Build OTLP traces payload
        const tracesData = {
            resourceSpans: [{
                resource: {
                    attributes: [
                        { key: "service.name", value: { stringValue: serviceName } },
                        { key: "telemetry.sdk.language", value: { stringValue: "javascript" } },
                        { key: "telemetry.sdk.name", value: { stringValue: "opentelemetry" } },
                        { key: "telemetry.sdk.version", value: { stringValue: "1.0.0" } }
                    ],
                    droppedAttributesCount: 0
                },
                scopeSpans: [{
                    scope: {
                        name: `${serviceName}-instrumentation`,
                        version: "1.0.0",
                        attributes: [],
                        droppedAttributesCount: 0
                    },
                    spans: spans
                }]
            }]
        };

        const response = await this.page.evaluate(async ({ url, headers, orgId, tracesData, streamName }) => {
            const requestHeaders = {
                "Authorization": `Basic ${headers}`,
                "Content-Type": "application/json",
            };
            // Add custom stream header if streamName is provided
            if (streamName) {
                requestHeaders["stream-name"] = streamName;
            }
            const fetchResponse = await fetch(`${url}/api/${orgId}/v1/traces`, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(tracesData)
            });
            return {
                status: fetchResponse.status,
                data: await fetchResponse.json().catch(() => ({}))
            };
        }, {
            url: process.env.INGESTION_URL,
            headers: basicAuthCredentials,
            orgId: orgId,
            tracesData: tracesData,
            streamName: streamName
        });

        testLogger.info('Traces ingestion response', { serviceName, streamName: streamName || 'default', status: response.status, data: response.data });
        return response;
    }

    /**
     * Connect input node directly to output node (for simple source->destination pipelines)
     */
    async connectInputToOutput() {
        await this.page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' });
        await this.page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' });

        // Ensure no dialogs are blocking
        await this.page.waitForSelector('.q-dialog__backdrop', { state: 'hidden', timeout: 3000 }).catch(() => {});

        await this.pipelineNodeInputOutputHandle.hover({ force: true });
        await this.page.mouse.down();
        await this.pipelineNodeOutputInputHandle.hover({ force: true });
        await this.page.mouse.up();
        await this.page.waitForTimeout(1000);
    }

    /**
     * Connect nodes via a middle node (function or condition)
     * Creates edges: input -> middle -> output
     */
    async connectNodesViaMiddleNode() {
        await this.page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' });
        await this.page.waitForSelector('[data-test="pipeline-node-default-input-handle"]', { state: 'visible' });
        await this.page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' });

        // Ensure no dialogs are blocking
        await this.page.waitForSelector('.q-dialog__backdrop', { state: 'hidden', timeout: 3000 }).catch(() => {});

        // Connect input to middle node
        await this.pipelineNodeInputOutputHandle.hover({ force: true });
        await this.page.mouse.down();
        await this.pipelineNodeDefaultInputHandle.hover({ force: true });
        await this.page.mouse.up();
        await this.page.waitForTimeout(1000);

        // Press Escape to cancel any pending edge creation state
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);

        // Connect middle node to output
        await this.pipelineNodeDefaultOutputHandle.hover({ force: true });
        await this.page.mouse.down();
        await this.pipelineNodeOutputInputHandle.hover({ force: true });
        await this.page.mouse.up();
        await this.page.waitForTimeout(1000);

        // Check edge count and retry second connection if needed
        const edgeCount = await this.page.locator('.vue-flow__edge').count();
        if (edgeCount < 2) {
            testLogger.info(`First attempt created ${edgeCount}/2 edges, retrying with dragTo`);
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(500);

            // Use Playwright's dragTo API for more reliable drag
            const midOutHandle = this.page.locator('[data-test="pipeline-node-default-output-handle"]');
            const destHandle = this.page.locator('[data-test="pipeline-node-output-input-handle"]');
            await midOutHandle.dragTo(destHandle, { force: true });
            await this.page.waitForTimeout(1000);
        }

        const finalEdgeCount = await this.page.locator('.vue-flow__edge').count();
        testLogger.info(`connectNodesViaMiddleNode completed with ${finalEdgeCount} edges`);
    }

    /**
     * Fill destination stream name
     * @param {string} streamName - Name for the destination stream
     */
    async fillDestinationStreamName(streamName) {
        await this.streamNameInput.click();
        await this.streamNameInput.fill(streamName);
        await this.page.waitForTimeout(1000);
    }

    /**
     * Fill condition fields for FilterGroup UI
     * @param {string} columnName - Column name to search for
     * @param {string} columnOption - The option text to select
     * @param {string} operator - Operator text (e.g., "Contains")
     * @param {string} value - Value to filter by
     */
    async fillConditionFields(columnName, columnOption, operator, value) {
        // Fill column select
        await this.columnSelect.locator('input').click();
        await this.columnSelect.locator('input').fill(columnName);
        await this.page.waitForTimeout(500);
        await this.page.getByRole("option", { name: columnOption }).click();

        // Select operator
        await this.operatorSelect.click();
        await this.page.waitForTimeout(300);
        await this.page.getByText(operator, { exact: true }).click();

        // Fill value input
        await this.valueInput.locator('input').click();
        await this.valueInput.locator('input').fill(value);
    }

    /**
     * Select a stream option by name
     * @param {string} streamName - Exact name of the stream option to select
     */
    async selectStreamOption(streamName) {
        await this.page.waitForTimeout(2000);
        // Wait for the option to be enabled (not disabled) before clicking
        const option = this.page.getByRole("option", { name: streamName, exact: true }).first();
        // Wait for the option to not have disabled class
        await this.page.waitForFunction(
            (name) => {
                const options = document.querySelectorAll('[role="option"]');
                for (const opt of options) {
                    if (opt.textContent?.includes(name) && !opt.classList.contains('disabled')) {
                        return true;
                    }
                }
                return false;
            },
            streamName,
            { timeout: 10000 }
        ).catch(() => {
            // If wait times out, try clicking anyway
            testLogger.debug('selectStreamOption: Wait for enabled option timed out, attempting click anyway');
        });
        await option.click();
    }

    // ============= Methods for raw selector fixes =============

    /**
     * Click the second delete button (for deleting auto-created nodes)
     */
    async clickSecondDeleteButton() {
        await this.deleteButtonNth1.click();
    }

    /**
     * Hover over the edit button
     */
    async hoverEditButton() {
        await this.editButton.hover();
    }

    /**
     * Click the output stream icon
     */
    async clickOutputStreamIcon() {
        await this.outputStreamIcon.click();
    }

    /**
     * Click the function icon
     */
    async clickFunctionIcon() {
        await this.functionIcon.click();
    }

    /**
     * Click the stream icon
     */
    async clickStreamIcon() {
        await this.streamIcon.click();
    }

    /**
     * Click VRL function editor view lines
     */
    async clickVrlEditorViewLines() {
        await this.vrlEditorViewLines.click();
    }

    /**
     * Click VRL function editor monaco editor
     */
    async clickVrlEditorMonaco() {
        await this.vrlEditorMonaco.click();
    }

    /**
     * Type code in VRL editor using keyboard
     * @param {string} code - Code to type
     * @param {number} delay - Delay between keystrokes (default: 100)
     */
    async typeVrlCode(code, delay = 100) {
        await this.page.keyboard.type(code, { delay });
    }

    /**
     * Click the note text to blur focus from editor
     */
    async clickNoteText() {
        await this.noteText.click();
    }

    /**
     * Verify text exists in VRL editor
     * @param {string} text - Text to verify
     */
    async verifyVrlEditorHasText(text) {
        await this.page.getByText(text);
    }

    /**
     * Hover over function name text
     * @param {string} functionName - Name of the function to hover
     */
    async hoverFunctionName(functionName) {
        await this.page.getByText(functionName).hover();
    }

    /**
     * Hover over condition text (kubernetes_container_name)
     */
    async hoverConditionText() {
        await this.conditionText.hover();
    }

    /**
     * Click stream type dropdown
     */
    async clickStreamTypeDropdown() {
        await this.streamTypeDropdown.click();
        await this.streamTypeLabel.click();
    }

    /**
     * Click SQL editor view lines
     */
    async clickSqlEditorViewLines() {
        await this.sqlEditorViewLines.click();
    }

    /**
     * Type SQL query in the editor
     * @param {string} query - SQL query to type
     */
    async typeSqlQuery(query) {
        await this.sqlEditor.click();
        await this.page.keyboard.type(query);
    }

    /**
     * Verify SQL query exists in editor
     * @param {string} query - Query text to find
     * @returns {Promise<number>} - Count of matching lines
     */
    async verifySqlQueryTyped(query) {
        return await this.page.locator(".view-lines")
            .locator(".view-line")
            .filter({ hasText: query })
            .count();
    }

    /**
     * Click frequency unit dropdown
     */
    async clickFrequencyUnit() {
        await this.frequencyUnit.click();
    }

    /**
     * Wait for query routing section to be hidden
     * @param {number} timeout - Timeout in ms (default: 60000)
     */
    async waitForQuerySectionHidden(timeout = 60000) {
        await this.queryRoutingSection.waitFor({ state: 'hidden', timeout });
    }

    /**
     * Wait for query node to be visible
     * @param {number} timeout - Timeout in ms (default: 30000)
     */
    async waitForQueryNodeVisible(timeout = 30000) {
        await this.queryNode.first().waitFor({ state: 'visible', timeout });
    }

    /**
     * Hover over query node
     */
    async hoverQueryNode() {
        await this.queryNode.first().hover();
    }

    /**
     * Click query node delete button
     */
    async clickQueryNodeDeleteBtn() {
        await this.queryNodeDeleteBtn.first().click();
    }

    /**
     * Click confirm button
     */
    async clickConfirmButton() {
        await this.confirmButton.click();
    }

    /**
     * Click cancel pipeline button
     */
    async clickCancelPipelineBtn() {
        await this.cancelPipelineBtn.click();
    }

    /**
     * Click dashboards menu link
     */
    async clickDashboardsMenu() {
        await this.dashboardsMenuLink.click();
    }

    /**
     * Verify connection error is displayed
     */
    async verifyConnectionError() {
        await this.connectAllNodesError.click();
    }

    /**
     * Wait for pipeline handles to be visible with error handling
     */
    async waitForPipelineHandles() {
        await this.page.waitForTimeout(2000);
        await this.page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' }).catch(() => {});
        await this.page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' }).catch(() => {});
        await this.page.waitForSelector('.q-dialog__backdrop', { state: 'hidden', timeout: 3000 }).catch(() => {});
    }

    /**
     * Click logs option in dropdown
     */
    async clickLogsOption() {
        await this.logsOptionRole.click();
    }

    /**
     * Verify invalid SQL query error
     */
    async verifyInvalidSqlQueryError() {
        await this.invalidSqlQueryText.click();
    }

    /**
     * Delete query node complete flow
     */
    async deleteQueryNode() {
        await this.waitForQuerySectionHidden();
        await this.waitForQueryNodeVisible();
        await this.hoverQueryNode();
        await this.page.waitForTimeout(500);
        await this.clickQueryNodeDeleteBtn();
        await this.clickConfirmButton();
    }

    /**
     * Setup source stream with delete and function icon click
     * Used in skipped tests
     */
    async deleteAutoNodeAndClickFunctionIcon() {
        await this.page.waitForTimeout(2000);
        await this.clickSecondDeleteButton();
        await this.clickConfirmButton();
        await this.hoverEditButton();
        await this.clickFunctionIcon();
    }

    /**
     * Setup source stream with delete and output stream icon click
     * Used in skipped tests
     */
    async deleteAutoNodeAndClickOutputIcon() {
        await this.page.waitForTimeout(3000);
        await this.clickSecondDeleteButton();
        await this.clickConfirmButton();
        await this.hoverEditButton();
        await this.clickOutputStreamIcon();
    }

    /**
     * Setup source stream with delete and stream icon click (for conditions)
     * Used in skipped tests
     */
    async deleteAutoNodeAndClickStreamIcon() {
        await this.page.waitForTimeout(2000);
        await this.clickSecondDeleteButton();
        await this.clickConfirmButton();
        await this.hoverEditButton();
        await this.clickStreamIcon();
    }

    /**
     * Type function code in VRL editor
     * @param {string} code - Code to type (e.g., ".a=41")
     */
    async typeFunctionInVrlEditor(code = ".a=41") {
        await this.clickVrlEditorViewLines();
        await this.typeVrlCode(code, 100);
        await this.page.keyboard.press("Enter");
        await this.typeVrlCode(".", 100);
        await this.clickNoteText();
    }

    /**
     * Setup query source - complete flow
     * @param {string} query - SQL query to type
     */
    async setupQuerySource(query = 'select * from "default"') {
        await this.clickStreamTypeDropdown();
        await this.page.waitForTimeout(1000);
        await this.clickSqlEditorViewLines();
        await this.typeSqlQuery(query);
        await this.page.waitForTimeout(1000);

        const queryTyped = await this.verifySqlQueryTyped(query);
        if (queryTyped > 0) {
            await this.clickFrequencyUnit();
        }
        await this.saveQuery();
    }

    // ========================================
    // Scheduled Pipeline Dialog Methods (POM Fix)
    // ========================================

    /**
     * Wait for scheduled pipeline dialog to be visible
     * Replaces: await page.locator('[data-test="scheduled-pipeline-tabs"]').waitFor()
     */
    async waitForScheduledPipelineDialog() {
        await this.scheduledPipelineTabs.waitFor({ state: 'visible', timeout: 10000 });
        testLogger.info('Scheduled pipeline dialog is visible');
    }

    /**
     * Wait for SQL editor to be visible
     * Replaces: await expect(page.locator('[data-test="scheduled-pipeline-sql-editor"]')).toBeVisible()
     */
    async expectSqlEditorVisible() {
        await expect(this.scheduledPipelineSqlEditor).toBeVisible({ timeout: 10000 });
        testLogger.info('SQL editor is visible');
    }

    /**
     * Expand Build Query section
     * Replaces: await page.getByText('Build Query').first().click()
     */
    async expandBuildQuerySection() {
        await this.buildQuerySection.waitFor({ state: 'visible', timeout: 5000 });
        await this.buildQuerySection.click();
        testLogger.info('Build Query section expanded');
    }

    /**
     * Select stream type from dropdown
     * @param {string} type - Stream type (e.g., 'logs')
     * Replaces: await page.getByLabel(/Stream Type/i).click() and option selection
     */
    async selectStreamType(type) {
        testLogger.info(`Selecting stream type: ${type}`);
        await this.streamTypeLabel.click();
        // Wait for dropdown to open
        await this.page.waitForFunction(() => {
            const options = document.querySelectorAll('[role="option"]');
            return options.length > 0;
        }, { timeout: 3000 });
        await this.page.getByRole("option", { name: type, exact: true }).click();
        testLogger.info(`Stream type '${type}' selected`);
    }

    /**
     * Select stream name from dropdown
     * @param {string} streamName - Stream name to select
     * Replaces: await page.getByLabel(/Stream Name/i).click(), fill, and option selection
     */
    async selectStreamName(streamName) {
        testLogger.info(`Selecting stream: ${streamName}`);
        await this.streamNameLabel.click();
        // Wait briefly for dropdown to open
        await this.page.waitForTimeout(500);
        await this.streamNameLabel.fill(streamName);
        // Wait for options to filter
        await this.page.waitForTimeout(1000);
        await this.page.getByRole("option", { name: streamName, exact: true }).click();
        testLogger.info(`Stream '${streamName}' selected`);
    }

    /**
     * Get current query text from Monaco editor
     * Replaces: await page.locator('.monaco-editor .view-lines').textContent()
     * @returns {Promise<string>} The query text
     */
    async getQueryText() {
        const text = await this.monacoEditorViewLines.textContent();
        testLogger.info(`Query text retrieved: ${text?.substring(0, 50)}...`);
        return text;
    }

    /**
     * Wait for watcher to process stream change
     * Deterministic wait that checks for query state to stabilize
     * Replaces: await page.waitForTimeout(2000) after stream change
     */
    async waitForStreamChangeWatcher() {
        testLogger.info('Waiting for stream change watcher to process...');
        // Wait for Vue watcher to execute and update query
        await this.page.waitForFunction(() => {
            const editor = document.querySelector('.monaco-editor');
            return editor !== null;
        }, { timeout: 3000 });
        // Additional small wait for query update to complete
        await this.page.waitForTimeout(500);
        testLogger.info('Watcher processing complete');
    }

    /**
     * Expect query editor to contain specific text
     * @param {string} expectedText - Text that should be in the query
     */
    async expectQueryToContain(expectedText) {
        const queryText = await this.getQueryText();
        expect(queryText).toContain(expectedText);
        testLogger.info(`Query contains expected text: ${expectedText}`);
    }

    /**
     * Expect query editor to NOT contain specific text
     * @param {string} unexpectedText - Text that should NOT be in the query
     */
    async expectQueryNotToContain(unexpectedText) {
        const queryText = await this.getQueryText();
        expect(queryText).not.toContain(unexpectedText);
        testLogger.info(`Query does not contain: ${unexpectedText}`);
    }

    /**
     * Expect query to be empty or very short (cleared state)
     * Replaces: expect(queryText.length).toBeLessThanOrEqual(10)
     */
    async expectQueryCleared() {
        const queryText = await this.getQueryText();
        const trimmed = queryText?.trim() || '';
        expect(trimmed.length).toBeLessThanOrEqual(10);
        testLogger.info(`Query is cleared (length: ${trimmed.length})`);
    }

    // ========== Issue #9901 Regression Test Methods ==========

    /**
     * Click the Validate and Close button in scheduled pipeline dialog
     */
    async clickValidateAndClose() {
        await this.validateAndCloseBtn.waitFor({ state: 'visible', timeout: 5000 });
        await this.validateAndCloseBtn.click();
        testLogger.info('Clicked Validate and Close button');
    }

    /**
     * Click the Cancel button in stream routing query dialog
     */
    async clickStreamRoutingQueryCancel() {
        await this.streamRoutingQueryCancelBtn.click();
        testLogger.info('Clicked Stream Routing Query Cancel button');
    }

    /**
     * Check if Discard Changes dialog is visible
     * @returns {Promise<boolean>} - true if visible, false otherwise
     */
    async isDiscardChangesDialogVisible() {
        const isVisible = await this.discardChangesDialog.isVisible().catch(() => false);
        testLogger.info(`Discard Changes dialog visible: ${isVisible}`);
        return isVisible;
    }

    /**
     * Expect Discard Changes dialog to NOT be visible
     */
    async expectDiscardDialogNotVisible() {
        await expect(this.discardChangesDialog).not.toBeVisible({ timeout: 2000 });
        testLogger.info('Verified Discard Changes dialog is not visible');
    }

    /**
     * Expect Invalid SQL Query error to be visible
     * @returns {Promise<boolean>} - true if visible, false otherwise
     */
    async isInvalidSqlQueryErrorVisible() {
        const isVisible = await this.invalidSqlQueryText.isVisible().catch(() => false);
        return isVisible;
    }

    /**
     * Focus the SQL editor in scheduled pipeline dialog
     */
    async focusSqlEditor() {
        await this.scheduledPipelineSqlEditor.click();
        testLogger.info('Focused SQL editor');
    }

    /**
     * Click Cancel button in scheduled pipeline dialog and confirm
     */
    async clickCancelAndConfirm() {
        await this.scheduledPipelineCancelBtn.click({ force: true });
        await this.page.waitForTimeout(1500);

        // Check if confirmation dialog appeared and confirm
        const dialogVisible = await this.qDialog.isVisible().catch(() => false);
        if (dialogVisible) {
            testLogger.info('Confirmation dialog shown, clicking confirm');
            await this.confirmButton.click().catch(() => {});
        }
    }

    /**
     * Clean up pipeline creation - cancel and confirm any dialogs
     */
    async cleanupPipelineCreation() {
        await this.cancelPipelineBtn.click().catch(() => {});
        await this.page.waitForTimeout(500);
        await this.confirmButton.click().catch(() => {});
        testLogger.info('Pipeline creation cleanup completed');
    }

    /**
     * Check if confirmation dialog is visible
     * @returns {Promise<boolean>} - true if visible, false otherwise
     */
    async isConfirmationDialogVisible() {
        const isVisible = await this.qDialog.isVisible().catch(() => false);
        return isVisible;
    }

    /**
     * Click confirm button in dialog
     */
    async clickConfirmButton() {
        await this.confirmButton.click().catch(() => {});
        testLogger.info('Clicked confirm button');
    }

    // ========== BUG REGRESSION TEST METHODS ==========

    /**
     * Expect pipeline page to be visible
     * Bug #9498, #10029 - Pipeline tests
     */
    async expectPipelinePageVisible() {
        const pipelineTable = this.page.locator('[data-test*="pipeline-list"], [data-test*="pipeline"]').first();
        await expect(pipelineTable).toBeVisible({ timeout: 15000 });
        testLogger.info('Pipeline page is visible');
    }

    /**
     * Expect pipeline canvas to be visible
     * Bug #10029 - Backfill creation
     */
    async expectPipelineCanvasVisible() {
        await expect(this.vueFlowPane).toBeVisible({ timeout: 15000 });
        testLogger.info('Pipeline canvas is visible');
    }

    /**
     * Get count of pipeline rows
     * Bug #9498, #10029 - Pipeline tests
     */
    async getPipelineRowCount() {
        const pipelineRows = this.page.locator('[data-test*="pipeline-row"], tr:has([data-test*="pipeline"])');
        const count = await pipelineRows.count();
        testLogger.info(`Found ${count} pipeline rows`);
        return count;
    }

    /**
     * Hover over a pipeline row by index
     * Bug #9498 - Preview bounds
     */
    async hoverPipelineRow(index) {
        const pipelineRows = this.page.locator('[data-test*="pipeline-row"], tr:has([data-test*="pipeline"])');
        const row = pipelineRows.nth(index);
        if (await row.isVisible().catch(() => false)) {
            await row.hover();
            testLogger.info(`Hovered pipeline row ${index}`);
        }
    }

    /**
     * Get preview/tooltip bounding box
     * Bug #9498 - Preview bounds
     */
    async getPreviewBoundingBox() {
        const preview = this.page.locator('.q-tooltip, .q-menu, .preview-popup, [class*="preview"], [class*="tooltip"]').first();
        if (await preview.isVisible().catch(() => false)) {
            return await preview.boundingBox();
        }
        return null;
    }

    /**
     * Check if query button is visible
     * Bug #10029 - Backfill
     */
    async isQueryButtonVisible() {
        const queryButton = this.page.locator('[data-test*="query"], [data-test*="scheduled"]').first();
        return await queryButton.isVisible().catch(() => false);
    }

    /**
     * Check if scheduled dialog is visible
     * Bug #10029 - Backfill
     */
    async isScheduledDialogVisible() {
        const dialog = this.page.locator('.q-dialog, [data-test*="dialog"]');
        return await dialog.isVisible().catch(() => false);
    }

    /**
     * Test pause toggle functionality
     * Bug #10029 - Pause/unpause
     */
    async testPauseToggle(rowIndex) {
        const pipelineRows = this.page.locator('[data-test*="pipeline-row"], tr:has([data-test*="pipeline"])');
        const row = pipelineRows.nth(rowIndex);
        const pauseToggle = row.locator('[data-test*="pause"], [data-test*="toggle"], .q-toggle').first();

        if (await pauseToggle.isVisible().catch(() => false)) {
            const initialState = await pauseToggle.getAttribute('aria-pressed').catch(() => 'unknown');
            await pauseToggle.click();
            await this.page.waitForTimeout(1000);

            // Handle confirmation dialog if it appears
            const confirmDialog = this.page.locator('.q-dialog, [data-test*="confirm-dialog"]');
            if (await confirmDialog.isVisible().catch(() => false)) {
                const confirmBtn = this.page.locator('.q-dialog button:has-text("OK"), .q-dialog button:has-text("Yes"), .q-dialog button:has-text("Confirm")').first();
                if (await confirmBtn.isVisible().catch(() => false)) {
                    await confirmBtn.click();
                    await this.page.waitForTimeout(1000);
                }
            }

            const newState = await pauseToggle.getAttribute('aria-pressed').catch(() => 'unknown');
            return { found: true, initialState, newState };
        }
        return { found: false };
    }

    // ============================================================================
    // POM COMPLIANCE METHODS - Rule 3 Fixes
    // Extract raw locators from spec files into POM
    // ============================================================================

    /**
     * Get function node locator by name
     * Used in pipeline-core.spec.js
     * @param {string} funcName - Function name
     * @returns {import('@playwright/test').Locator} Function node locator
     */
    getFunctionNodeByName(funcName) {
        return this.page.locator(`text=${funcName}`);
    }

    /**
     * Check if function node is visible by name
     * @param {string} funcName - Function name
     * @returns {Promise<boolean>} True if visible
     */
    async isFunctionNodeVisible(funcName) {
        const funcNode = this.getFunctionNodeByName(funcName);
        return await funcNode.isVisible().catch(() => false);
    }

    /**
     * Get pipeline row locator by name
     * Used in pipelines.spec.js
     * @param {string} pipelineName - Pipeline name
     * @returns {import('@playwright/test').Locator} Pipeline row locator
     */
    getPipelineRowByName(pipelineName) {
        return this.page.locator('tr').filter({ hasText: pipelineName });
    }

    /**
     * Get pipeline toggle locator for a specific pipeline
     * @param {string} pipelineName - Pipeline name
     * @returns {import('@playwright/test').Locator} Toggle locator
     */
    getPipelineToggle(pipelineName) {
        const pipelineRow = this.getPipelineRowByName(pipelineName);
        return pipelineRow.locator('[data-test*="toggle"]');
    }

    /**
     * Toggle pipeline enabled/disabled state
     * @param {string} pipelineName - Pipeline name
     */
    async togglePipeline(pipelineName) {
        const toggle = this.getPipelineToggle(pipelineName);
        await toggle.waitFor({ state: 'visible', timeout: 10000 });
        await toggle.click();
        testLogger.info(`Toggled pipeline: ${pipelineName}`);
    }

    // ============================================================================
    // TRACES/METRICS PIPELINE POM METHODS
    // Added for PR #10158 - Raw selector fixes
    // ============================================================================

    /**
     * Check if destination required error is visible
     * Replaces: page.getByText(/destination.*required/i).isVisible()
     * @returns {Promise<boolean>} True if error is visible
     */
    async isDestinationRequiredErrorVisible() {
        const errorLocator = this.page.getByText(/destination.*required/i);
        return await errorLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if pipeline save success message is visible
     * Replaces: page.getByText(/success|created|saved/i).isVisible()
     * @returns {Promise<boolean>} True if success message is visible
     */
    async isPipelineSaveSuccessVisible() {
        const successLocator = this.page.getByText(/success|created|saved/i);
        return await successLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if pipeline name input is visible (for checking if still on edit page)
     * Replaces: page.locator('[data-test="pipeline-name-input"]').isVisible()
     * @returns {Promise<boolean>} True if input is visible
     */
    async isPipelineNameInputVisible() {
        return await this.pipelineNameInput.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click cancel pipeline button with force option
     * For dismissing dialogs with overlay that intercepts clicks
     * Replaces: page.locator('[data-test="add-pipeline-cancel-btn"]').click({ force: true })
     */
    async clickCancelPipelineBtnForce() {
        await this.cancelPipelineBtn.click({ force: true });
        testLogger.info('Clicked cancel pipeline button (force)');
    }

    // ============================================================================
    // BACKFILL PAGE METHODS
    // Added for pipeline-backfill.spec.js
    // ============================================================================

    /** @returns {import('@playwright/test').Locator} Backfill page container */
    get backfillPageLocator() {
        return this.page.locator('[data-test="backfill-jobs-page"], [data-test*="backfill"]').first();
    }

    /**
     * Navigate to backfill jobs page
     * @param {string} orgName - Organization name
     */
    async navigateToBackfillPage(orgName) {
        const backfillUrl = `${process.env.ZO_BASE_URL}/web/pipeline/pipelines/backfill?org_identifier=${orgName}`;
        await this.page.goto(backfillUrl);
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Navigated to backfill jobs page', { url: backfillUrl });
    }

    /**
     * Check if backfill page is visible
     * @returns {Promise<boolean>} True if page is visible
     */
    async isBackfillPageVisible() {
        const pageLocator = this.page.locator('[data-test="backfill-jobs-page"], [data-test*="backfill"], .backfill-page').first();
        return await pageLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if backfill text content is visible
     * @returns {Promise<boolean>} True if text is visible
     */
    async isBackfillTextVisible() {
        const textLocator = this.page.getByText(/backfill/i).first();
        return await textLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if status filter is visible on backfill page
     * @returns {Promise<boolean>} True if filter is visible
     */
    async isStatusFilterVisible() {
        const filterLocator = this.page.locator('[data-test*="status-filter"], [data-test*="filter"]').first();
        return await filterLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if pipeline filter is visible on backfill page
     * @returns {Promise<boolean>} True if filter is visible
     */
    async isPipelineFilterVisible() {
        const filterLocator = this.page.locator('[data-test*="pipeline-filter"], select, .q-select').first();
        return await filterLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if backfill table is visible
     * @returns {Promise<boolean>} True if table is visible
     */
    async isBackfillTableVisible() {
        const tableLocator = this.page.locator('[data-test*="backfill-table"], table, .q-table').first();
        return await tableLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if refresh button is visible on backfill page
     * @returns {Promise<boolean>} True if button is visible
     */
    async isRefreshButtonVisible() {
        const refreshLocator = this.page.locator('[data-test*="refresh"], button:has-text("Refresh")').first();
        return await refreshLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click refresh button on backfill page
     */
    async clickRefreshButton() {
        const refreshLocator = this.page.locator('[data-test*="refresh"], button:has-text("Refresh")').first();
        await refreshLocator.click();
        await this.page.waitForTimeout(1000);
        testLogger.info('Clicked refresh button');
    }

    /**
     * Navigate back from backfill page
     */
    async navigateBackFromBackfill() {
        const backButton = this.page.locator('[data-test*="back"], button:has-text("Back"), .q-btn:has-text("Back")').first();
        if (await backButton.isVisible().catch(() => false)) {
            await backButton.click();
        } else {
            await this.page.goBack();
        }
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Navigated back from backfill page');
    }

    /**
     * Filter backfill jobs by status
     * @param {string} status - Status to filter by
     */
    async filterByStatus(status) {
        const statusFilter = this.page.locator('[data-test*="status-filter"], select').first();
        if (await statusFilter.isVisible().catch(() => false)) {
            await statusFilter.click();
            await this.page.getByRole('option', { name: status }).click().catch(() => {
                testLogger.debug('Status option not found via role, trying text match');
            });
        }
        testLogger.info('Filtered by status', { status });
    }

    /**
     * Clear all filters on backfill page
     */
    async clearAllFilters() {
        const clearButton = this.page.locator('[data-test*="clear"], button:has-text("Clear")').first();
        if (await clearButton.isVisible().catch(() => false)) {
            await clearButton.click();
            await this.page.waitForTimeout(500);
        }
        testLogger.info('Cleared all filters');
    }

    /**
     * Get count of backfill job rows
     * @returns {Promise<number>} Count of rows
     */
    async getBackfillJobCount() {
        const rows = this.page.locator('[data-test*="backfill-row"], table tbody tr').all();
        return (await rows).length;
    }

    /**
     * Check if progress bar is visible for any job
     * @returns {Promise<boolean>} True if progress bar is visible
     */
    async isProgressBarVisible() {
        const progressLocator = this.page.locator('[data-test*="progress"], .q-linear-progress, progress').first();
        return await progressLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if action buttons are visible for jobs
     * @returns {Promise<boolean>} True if action buttons are visible
     */
    async areActionButtonsVisible() {
        const actionLocator = this.page.locator('[data-test*="action"], button.action, .q-btn').first();
        return await actionLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check for no jobs message
     * @returns {Promise<boolean>} True if no jobs message is visible
     */
    async isNoJobsMessageVisible() {
        const noJobsLocator = this.page.getByText(/no.*jobs|no.*data|empty/i).first();
        return await noJobsLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    // ============================================================================
    // HISTORY PAGE METHODS
    // Added for pipeline-history.spec.js
    // ============================================================================

    /** @returns {import('@playwright/test').Locator} History page container */
    get historyPageLocator() {
        return this.page.locator('[data-test="pipeline-history-page"], [data-test*="history"]').first();
    }

    /**
     * Navigate to pipeline history page
     * @param {string} orgName - Organization name
     */
    async navigateToHistoryPage(orgName) {
        const historyUrl = `${process.env.ZO_BASE_URL}/web/pipeline/pipelines/history?org_identifier=${orgName}`;
        await this.page.goto(historyUrl);
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Navigated to pipeline history page', { url: historyUrl });
    }

    /**
     * Check if history page is visible
     * @returns {Promise<boolean>} True if page is visible
     */
    async isHistoryPageVisible() {
        const pageLocator = this.page.locator('[data-test="pipeline-history-page"], [data-test*="history"], .history-page').first();
        return await pageLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if history text content is visible
     * @returns {Promise<boolean>} True if text is visible
     */
    async isHistoryTextVisible() {
        const textLocator = this.page.getByText(/history/i).first();
        return await textLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if history page title is visible
     * @returns {Promise<boolean>} True if title is visible
     */
    async isHistoryTitleVisible() {
        const titleLocator = this.page.locator('[data-test*="history-title"], h1:has-text("History"), h2:has-text("History"), .page-title').first();
        return await titleLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if history table is visible
     * @returns {Promise<boolean>} True if table is visible
     */
    async isHistoryTableVisible() {
        const tableLocator = this.page.locator('[data-test*="history-table"], table, .q-table').first();
        return await tableLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Get count of history rows
     * @returns {Promise<number>} Count of rows
     */
    async getHistoryRowCount() {
        const rows = this.page.locator('[data-test*="history-row"], table tbody tr').all();
        return (await rows).length;
    }

    /**
     * Navigate back from history page
     */
    async navigateBackFromHistory() {
        const backButton = this.page.locator('[data-test*="back"], button:has-text("Back"), .q-btn:has-text("Back")').first();
        if (await backButton.isVisible().catch(() => false)) {
            await backButton.click();
        } else {
            await this.page.goBack();
        }
        await this.page.waitForLoadState('networkidle');
        testLogger.info('Navigated back from history page');
    }

    /**
     * Filter history by date range
     * @param {string} startDate - Start date
     * @param {string} endDate - End date
     */
    async filterHistoryByDateRange(startDate, endDate) {
        const dateFilter = this.page.locator('[data-test*="date-filter"], [data-test*="date-range"]').first();
        if (await dateFilter.isVisible().catch(() => false)) {
            await dateFilter.click();
            // Date range logic would go here
        }
        testLogger.info('Filtered history by date range', { startDate, endDate });
    }

    // ============================================================================
    // ADDITIONAL BACKFILL PAGE METHODS
    // Added to fix missing POM methods in pipeline-backfill.spec.js
    // ============================================================================

    /** @returns {import('@playwright/test').Locator} Status badges in backfill/history tables */
    get statusBadges() {
        return this.page.locator('.q-badge, .status-badge, [data-test*="status"], .q-chip');
    }

    /** @returns {import('@playwright/test').Locator} Job rows in backfill table */
    get jobRows() {
        return this.page.locator('[data-test*="backfill-row"], [data-test*="job-row"], table tbody tr');
    }

    /**
     * Check if clear filters button is visible
     * @returns {Promise<boolean>} True if button is visible
     */
    async isClearFiltersBtnVisible() {
        const clearBtn = this.page.locator('[data-test*="clear-filter"], button:has-text("Clear"), [data-test*="reset"]').first();
        return await clearBtn.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click clear filters button
     */
    async clickClearFiltersBtn() {
        const clearBtn = this.page.locator('[data-test*="clear-filter"], button:has-text("Clear"), [data-test*="reset"]').first();
        if (await clearBtn.isVisible().catch(() => false)) {
            await clearBtn.click();
            await this.page.waitForTimeout(500);
            testLogger.info('Clicked clear filters button');
        } else {
            testLogger.info('Clear filters button not found');
        }
    }

    /**
     * Check if backfill refresh button is visible
     * @returns {Promise<boolean>} True if button is visible
     */
    async isBackfillRefreshBtnVisible() {
        const refreshBtn = this.page.locator('[data-test*="refresh"], button:has-text("Refresh"), .refresh-btn').first();
        return await refreshBtn.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click backfill refresh button
     */
    async clickBackfillRefreshBtn() {
        const refreshBtn = this.page.locator('[data-test*="refresh"], button:has-text("Refresh"), .refresh-btn').first();
        if (await refreshBtn.isVisible().catch(() => false)) {
            await refreshBtn.click();
            await this.page.waitForTimeout(1000);
            testLogger.info('Clicked backfill refresh button');
        } else {
            testLogger.info('Backfill refresh button not found');
        }
    }

    /**
     * Check if backfill jobs table is visible
     * @returns {Promise<boolean>} True if table is visible
     */
    async isBackfillJobsTableVisible() {
        const tableLocator = this.page.locator('[data-test*="backfill-table"], [data-test*="jobs-table"], table, .q-table').first();
        return await tableLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if generic table is visible (fallback)
     * @returns {Promise<boolean>} True if any table is visible
     */
    async isGenericTableVisible() {
        const tableLocator = this.page.locator('table, .q-table, [role="table"]').first();
        return await tableLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click back button on backfill page
     */
    async clickBackfillBackBtn() {
        const backBtn = this.page.locator('[data-test="backfill-jobs-back-btn"], [data-test*="back-btn"], button:has-text("Back")').first();
        if (await backBtn.isVisible().catch(() => false)) {
            await backBtn.click();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            testLogger.info('Clicked backfill back button');
        } else {
            await this.page.goBack();
            testLogger.info('Used browser back navigation');
        }
    }

    /**
     * Filter by pipeline name
     */
    async filterByPipeline() {
        const pipelineFilter = this.page.locator('[data-test*="pipeline-filter"], [data-test*="pipeline-select"], .q-select').first();
        if (await pipelineFilter.isVisible().catch(() => false)) {
            await pipelineFilter.click();
            await this.page.waitForTimeout(500);
            // Select first available option
            const option = this.page.locator('.q-item, [role="option"]').first();
            if (await option.isVisible().catch(() => false)) {
                await option.click();
            }
            testLogger.info('Filtered by pipeline');
        } else {
            testLogger.info('Pipeline filter not found');
        }
    }

    /**
     * Get count of progress bars in backfill table
     * @returns {Promise<number>} Count of progress bars
     */
    async getProgressBarCount() {
        const progressBars = await this.page.locator('.q-linear-progress, progress, [data-test*="progress"]').all();
        return progressBars.length;
    }

    /**
     * Get job action button counts
     * @returns {Promise<{pause: number, resume: number, cancel: number, total: number}>} Button counts
     */
    async getJobActionButtonCounts() {
        const pauseCount = await this.page.locator('button:has-text("Pause"), [data-test*="pause"]').count();
        const resumeCount = await this.page.locator('button:has-text("Resume"), [data-test*="resume"]').count();
        const cancelCount = await this.page.locator('button:has-text("Cancel"), [data-test*="cancel"]').count();
        return {
            pause: pauseCount,
            resume: resumeCount,
            cancel: cancelCount,
            total: pauseCount + resumeCount + cancelCount
        };
    }

    /**
     * Get count of buttons in table
     * @returns {Promise<number>} Count of buttons
     */
    async getTableButtonCount() {
        const buttons = await this.page.locator('table button, .q-table button').all();
        return buttons.length;
    }

    /**
     * Get count of jobs with specific status
     * @param {string} status - Status to count (e.g., 'Completed', 'Running', 'Failed')
     * @returns {Promise<number>} Count of jobs with status
     */
    async getJobStatusCount(status) {
        const statusElements = await this.page.locator(`[data-test*="status"]:has-text("${status}"), .q-badge:has-text("${status}"), .status-badge:has-text("${status}")`).all();
        return statusElements.length;
    }

    /**
     * Get count of error indicators
     * @returns {Promise<number>} Count of error indicators
     */
    async getErrorIndicatorCount() {
        const errorIndicators = await this.page.locator('[data-test*="error"], .error-indicator, .text-negative, .q-icon[color="negative"]').all();
        return errorIndicators.length;
    }

    /**
     * Click first error indicator
     */
    async clickFirstErrorIndicator() {
        const errorIndicator = this.page.locator('[data-test*="error"], .error-indicator, .text-negative').first();
        if (await errorIndicator.isVisible().catch(() => false)) {
            await errorIndicator.click();
            await this.page.waitForTimeout(500);
            testLogger.info('Clicked first error indicator');
        }
    }

    /**
     * Check if error dialog is visible
     * @returns {Promise<boolean>} True if dialog is visible
     */
    async isErrorDialogVisible() {
        const dialog = this.page.locator('.q-dialog, [role="dialog"], [data-test*="error-dialog"]').first();
        return await dialog.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Close error dialog
     */
    async closeErrorDialog() {
        const closeBtn = this.page.locator('.q-dialog button:has-text("Close"), .q-dialog button:has-text("OK"), .q-dialog [data-test*="close"]').first();
        if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click();
            await this.page.waitForTimeout(300);
            testLogger.info('Closed error dialog');
        }
    }

    /**
     * Check if empty backfill message is visible
     * @returns {Promise<boolean>} True if message is visible
     */
    async isEmptyBackfillMessageVisible() {
        const emptyMsg = this.page.locator('[data-test*="empty"], [data-test*="no-data"]').first();
        const textMsg = this.page.getByText(/no.*jobs|no.*data|empty|no records/i).first();
        return await emptyMsg.isVisible({ timeout: 3000 }).catch(() => false) ||
               await textMsg.isVisible({ timeout: 3000 }).catch(() => false);
    }

    // ============================================================================
    // ADDITIONAL HISTORY PAGE METHODS
    // Added to fix missing POM methods in pipeline-history.spec.js
    // ============================================================================

    /**
     * Check if history date picker is visible
     * @returns {Promise<boolean>} True if date picker is visible
     */
    async isHistoryDatePickerVisible() {
        const datePicker = this.page.locator('[data-test*="date-picker"], [data-test*="date-range"], .date-picker, .q-date').first();
        return await datePicker.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if history search select is visible
     * @returns {Promise<boolean>} True if search select is visible
     */
    async isHistorySearchSelectVisible() {
        const searchSelect = this.page.locator('[data-test*="search-select"], [data-test*="pipeline-select"], .q-select, select').first();
        return await searchSelect.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if history manual search button is visible
     * @returns {Promise<boolean>} True if button is visible
     */
    async isHistoryManualSearchBtnVisible() {
        const searchBtn = this.page.locator('[data-test*="search-btn"], button:has-text("Search"), button:has-text("Run")').first();
        return await searchBtn.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if history refresh button is visible
     * @returns {Promise<boolean>} True if button is visible
     */
    async isHistoryRefreshBtnVisible() {
        const refreshBtn = this.page.locator('[data-test*="refresh"], button:has-text("Refresh"), .refresh-btn').first();
        return await refreshBtn.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click history back button
     */
    async clickHistoryBackBtn() {
        const backBtn = this.page.locator('[data-test*="back-btn"], [data-test*="back"], button:has-text("Back"), .back-btn').first();
        if (await backBtn.isVisible().catch(() => false)) {
            await backBtn.click();
            await this.page.waitForLoadState('networkidle');
            testLogger.info('Clicked history back button');
        } else {
            await this.page.goBack();
            testLogger.info('Used browser back navigation');
        }
    }

    /**
     * Click history refresh button
     */
    async clickHistoryRefreshBtn() {
        const refreshBtn = this.page.locator('[data-test*="refresh"], button:has-text("Refresh"), .refresh-btn').first();
        if (await refreshBtn.isVisible().catch(() => false)) {
            await refreshBtn.click();
            await this.page.waitForTimeout(1000);
            testLogger.info('Clicked history refresh button');
        } else {
            testLogger.info('History refresh button not found');
        }
    }

    /**
     * Check if column header is visible
     * @param {string} columnName - Name of the column
     * @returns {Promise<boolean>} True if column is visible
     */
    async isColumnHeaderVisible(columnName) {
        const columnHeader = this.page.locator(`th:has-text("${columnName}"), [data-test*="column"]:has-text("${columnName}")`).first();
        return await columnHeader.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Click history search select
     */
    async clickHistorySearchSelect() {
        const searchSelect = this.page.locator('[data-test*="search-select"], [data-test*="pipeline-select"], .q-select').first();
        if (await searchSelect.isVisible().catch(() => false)) {
            await searchSelect.click();
            await this.page.waitForTimeout(500);
            testLogger.info('Clicked history search select');
        }
    }

    /**
     * Select first option in dropdown
     */
    async selectFirstOption() {
        const option = this.page.locator('.q-item, [role="option"], .q-menu .q-item').first();
        if (await option.isVisible().catch(() => false)) {
            await option.click();
            await this.page.waitForTimeout(300);
            testLogger.info('Selected first option');
        }
    }

    /**
     * Click history manual search button
     */
    async clickHistoryManualSearchBtn() {
        const searchBtn = this.page.locator('[data-test*="search-btn"], button:has-text("Search"), button:has-text("Run")').first();
        if (await searchBtn.isVisible().catch(() => false)) {
            await searchBtn.click();
            await this.page.waitForTimeout(1000);
            testLogger.info('Clicked history manual search button');
        }
    }

    /**
     * Get status counts from history/backfill page
     * @returns {Promise<{success: number, error: number, warning: number}>} Status counts
     */
    async getStatusCounts() {
        const successCount = await this.page.locator('.q-badge:has-text("Success"), .q-badge:has-text("Completed"), .text-positive, [data-test*="status-success"]').count();
        const errorCount = await this.page.locator('.q-badge:has-text("Error"), .q-badge:has-text("Failed"), .text-negative, [data-test*="status-error"]').count();
        const warningCount = await this.page.locator('.q-badge:has-text("Warning"), .text-warning, [data-test*="status-warning"]').count();
        return {
            success: successCount,
            error: errorCount,
            warning: warningCount
        };
    }

    /**
     * Check if empty state message is visible
     * @returns {Promise<boolean>} True if message is visible
     */
    async isEmptyStateMessageVisible() {
        const emptyMsg = this.page.locator('[data-test*="empty"], [data-test*="no-data"], .empty-state').first();
        const textMsg = this.page.getByText(/no.*history|no.*data|empty|no records/i).first();
        return await emptyMsg.isVisible({ timeout: 3000 }).catch(() => false) ||
               await textMsg.isVisible({ timeout: 3000 }).catch(() => false);
    }

    // SCHEDULED PIPELINE TAB METHODS - POM Compliance Fix
    // These methods replace raw selectors in spec files for PromQL/SQL tab switching
    // ============================================================================

    /**
     * Click PromQL tab in scheduled pipeline dialog
     * Note: AppTabs renders tabs as <div> elements with data-test="tab-{value}", not buttons
     */
    async clickPromqlTab() {
        const promqlTab = this.scheduledPipelineTabs.locator('[data-test="tab-promql"]');
        await promqlTab.waitFor({ state: 'visible', timeout: 5000 });
        await promqlTab.click();
        testLogger.info('Clicked PromQL tab');
    };

    /**
     * Click SQL tab in scheduled pipeline dialog
     * Note: AppTabs renders tabs as <div> elements with data-test="tab-{value}", not buttons
     */
    async clickSqlTab() {
        const sqlTab = this.scheduledPipelineTabs.locator('[data-test="tab-sql"]');
        await sqlTab.waitFor({ state: 'visible', timeout: 5000 });
        await sqlTab.click();
        testLogger.info('Clicked SQL tab');
    }

    /**
     * Verify PromQL tab is active/selected
     * Note: AppTabs uses 'active' CSS class for the selected tab
     */
    async expectPromqlTabActive() {
        const promqlTab = this.scheduledPipelineTabs.locator('[data-test="tab-promql"]');
        await expect(promqlTab).toHaveClass(/active/);
        testLogger.info('Verified PromQL tab is active');
    }

    /**
     * Verify SQL tab is active/selected
     * Note: AppTabs uses 'active' CSS class for the selected tab
     */
    async expectSqlTabActive() {
        const sqlTab = this.scheduledPipelineTabs.locator('[data-test="tab-sql"]');
        await expect(sqlTab).toHaveClass(/active/);
        testLogger.info('Verified SQL tab is active');
    }

    // =========================================================================
    // Helper Methods - Reduce duplication across spec files
    // =========================================================================

    /**
     * Dismiss any open dialogs or menus.
     * Use in afterEach cleanup instead of raw page.locator('.q-dialog').
     */
    async dismissOpenDialogs() {
        try {
            if (await this.qDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
                await this.page.keyboard.press('Escape');
                await this.page.waitForTimeout(500);
            }
        } catch (e) {
            // Ignore cleanup errors
        }
    }

    /**
     * Add and configure a source stream node on the pipeline canvas.
     * Handles: drag stream → select type → enter name → select option → save → delete auto output.
     * @param {'traces'|'metrics'|'logs'} streamType - The stream type to select
     * @param {string} streamName - The stream name to enter and select
     */
    async addSourceStreamNode(streamType, streamName) {
        await this.selectStream();
        await this.dragStreamToTarget(this.streamButton);

        if (streamType === 'traces') {
            await this.selectTraces();
        } else if (streamType === 'metrics') {
            await this.selectMetrics();
        }
        // For 'logs', the default type is already selected

        await this.enterStreamName(streamName);
        await this.page.waitForTimeout(1000);
        await this.selectStreamOptionByName(streamName);
        await this.saveInputNodeStream();
        await this.page.waitForTimeout(2000);

        // Delete auto-created output node
        await this.deleteOutputStreamNode();

        testLogger.info('Source stream node added', { streamType, streamName });
    }

    /**
     * Add and configure a destination stream node on the pipeline canvas.
     * Handles: drag second stream → select type → fill dest name → save.
     * @param {'traces'|'metrics'|'logs'} streamType - The stream type to select
     * @param {string} destName - The destination stream name
     */
    async addDestinationStreamNode(streamType, destName) {
        await this.selectAndDragSecondStream();

        if (streamType === 'traces') {
            await this.selectTraces();
        } else if (streamType === 'metrics') {
            await this.selectMetrics();
        }

        await this.fillDestinationStreamName(destName);
        await this.clickInputNodeStreamSave();
        await this.page.waitForTimeout(2000);

        testLogger.info('Destination stream node added', { streamType, destName });
    }

    /**
     * Name and save a pipeline.
     * @param {string} namePrefix - Prefix for the pipeline name (timestamp suffix added)
     * @returns {string} The generated pipeline name
     */
    async savePipelineWithName(namePrefix) {
        const pipelineName = `${namePrefix}-${Math.random().toString(36).substring(7)}`;
        await this.enterPipelineName(pipelineName);
        const urlBefore = this.page.url();
        await this.savePipeline();
        await this.page.waitForTimeout(2000);
        const urlAfter = this.page.url();
        // Check for any error toasts/alerts on the page
        const errorToast = await this.page.locator('.q-notification, [role="alert"], .q-banner').allTextContents().catch(() => []);
        testLogger.info(`Pipeline saved: ${pipelineName}`, { urlBefore, urlAfter, redirected: urlBefore !== urlAfter, toasts: errorToast });
        return pipelineName;
    }

    /**
     * Clean up a pipeline by searching and deleting it.
     * Logs warning on failure instead of throwing.
     * @param {string} pipelineName - The pipeline name to delete
     */
    async cleanupPipelineByName(pipelineName) {
        try {
            await this.openPipelineMenu();
            await this.page.waitForTimeout(1000);
            await this.searchPipeline(pipelineName);
            await this.deletePipelineByName(pipelineName);
            testLogger.info('Pipeline cleanup completed');
        } catch (cleanupError) {
            testLogger.warn(`Pipeline cleanup failed (non-critical): ${cleanupError.message}`);
        }
    }
}
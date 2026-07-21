// Copyright 2026 OpenObserve Inc.

const testLogger = require('../../playwright-tests/utils/test-logger.js');
import { openNavFlyoutChild } from '../commonActions.js';

export class PipelinesFormValidationPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── Import Pipeline page ──────────────────────────────────────────────
        // BaseImport renders with test-prefix="pipeline" so:
        // pipeline-import-json-file-input — file upload input
        // pipeline-import-json-btn        — Import button (disabled when no file)
        // pipeline-import-cancel-btn      — Cancel / Back button
        // pipeline-import-tabs            — tab selector (url / file)
        this.importPipelineFileInput   = '[data-test="pipeline-import-json-file-input"]';
        this.importPipelineImportBtn   = '[data-test="pipeline-import-json-btn"]';
        this.importPipelineCancelBtn   = '[data-test="pipeline-import-cancel-btn"]';

        // ── CreateBackfillJobDialog ───────────────────────────────────────────
        // The dialog is an ODrawer with data-test="create-backfill-job-dialog"
        // ODrawer primary / secondary buttons follow the o-drawer-* convention
        this.backfillDrawer              = '[data-test="create-backfill-job-dialog"]';
        this.backfillPrimaryBtn          = '[data-test="create-backfill-job-dialog"] [data-test="o-drawer-primary-btn"]';
        this.backfillSecondaryBtn        = '[data-test="create-backfill-job-dialog"] [data-test="o-drawer-secondary-btn"]';

        // Time range picker — data-test="time-range-picker"
        this.timeRangePicker             = '[data-test="time-range-picker"]';

        // Inline time-range validation message (rendered when start/end are <= 0)
        // The validation <div> lives directly in the template with no data-test;
        // we locate it by its sibling context inside the drawer.
        this.timeRangeError              = '[data-test="create-backfill-job-dialog"] .text-red-600';

        // Advanced options section
        this.advancedOptionsSection      = '[data-test="advanced-options-section"]';

        // OInput fields — OInput auto-generates -field (native input) and -error
        this.chunkPeriodInputField       = '[data-test="chunk-period-input-field"]';
        this.chunkPeriodInputError       = '[data-test="chunk-period-input-error"]';
        this.delayBetweenChunksField     = '[data-test="delay-between-chunks-input-field"]';
        this.delayBetweenChunksError     = '[data-test="delay-between-chunks-input-error"]';

        // Delete-before-backfill checkbox
        this.deleteBeforeBackfillChk     = '[data-test="delete-before-backfill-checkbox"]';

        // Confirmation dialog (ODialog) for delete-before-backfill
        this.deleteConfirmDialog         = '[data-test="create-backfill-job-delete-confirmation-dialog"]';
        this.deleteConfirmPrimaryBtn     = '[data-test="create-backfill-job-delete-confirmation-dialog"] [data-test="o-dialog-primary-btn"]';
        this.deleteConfirmSecondaryBtn   = '[data-test="create-backfill-job-delete-confirmation-dialog"] [data-test="o-dialog-secondary-btn"]';

        // Toast notifications
        this.toastError                  = '[data-test-variant="error"]';
        this.toastSuccess                = '[data-test-variant="success"]';

        // Pipeline list / tab selectors
        this.pipelineScheduledTab        = '[data-test="pipeline-section-tab-scheduledPipelines"]';
        this.pipelineListBackfillBtn     = '[data-test="pipeline-list-backfill-btn"]';

        // ── LLM Evaluation node ───────────────────────────────────────────────
        this.llmEvalNameField            = '[data-test="llm-evaluation-node-name-input-field"]';
        this.llmEvalNameError            = '[data-test="llm-evaluation-node-name-input-error"]';
        this.llmEvalSpanIdentifierPopover = '[data-test="llm-evaluation-span-identifier-select-popover"]';
        this.llmEvalSpanIdentifierError  = '[data-test="llm-evaluation-span-identifier-select-error"]';
        this.llmEvalTemplatePopover      = '[data-test="llm-evaluation-template-select-popover"]';
        this.llmEvalTemplateError        = '[data-test="llm-evaluation-template-select-error"]';
        this.llmEvalEnableSamplingToggle = '[data-test="llm-evaluation-enable-sampling-toggle"]';
        this.llmEvalSamplingRateField    = '[data-test="llm-evaluation-sampling-rate-input-field"]';
        this.associateFunctionSaveBtn    = '[data-test="associate-function-drawer"] [data-test="o-drawer-primary-btn"]';

        // ── Associate Function node ───────────────────────────────────────────
        this.associateFunctionDrawer         = '[data-test="associate-function-drawer"]';
        this.associateFunctionSelectPopover  = '[data-test="associate-function-select-function-input-popover"]';
        this.associateFunctionSelectError    = '[data-test="associate-function-select-function-input-error"]';
        this.createFunctionToggle            = '[data-test="create-function-toggle"]';
        this.associateFunctionAfterFlattening = '[data-test="associate-function-after-flattening-toggle"]';

        // ── Create Destination form ───────────────────────────────────────────
        this.addDestinationNameField     = '[data-test="add-destination-name-input-field"]';
        this.addDestinationNameError     = '[data-test="add-destination-name-input-error"]';
        this.addDestinationUrlField      = '[data-test="add-destination-url-input-field"]';
        this.addDestinationUrlError      = '[data-test="add-destination-url-input-error"]';
        this.destinationTypeCardHttp     = '[data-test="destination-type-card-http"]';
        this.step1ContinueBtn            = '[data-test="step1-continue-btn"]';
        this.addDestinationSubmitBtn     = '[data-test="add-destination-submit-btn"]';
        this.addDestinationCancelBtn     = '[data-test="add-destination-cancel-btn"]';

        // ── Edit Backfill Job dialog ──────────────────────────────────────────
        this.editBackfillJobDialog       = '[data-test="edit-backfill-job-dialog"]';
        this.editChunkPeriodField        = '[data-test="chunk-period-input-field"]';
        this.editChunkPeriodError        = '[data-test="chunk-period-input-error"]';
        this.editDelayBetweenChunksField = '[data-test="delay-between-chunks-input-field"]';
        this.editDelayBetweenChunksError = '[data-test="delay-between-chunks-input-error"]';

        // ── Pipeline Stream node (Stream.vue) ─────────────────────────────────
        this.streamNodeDrawer     = '[data-test="input-node-stream-drawer"]';
        this.streamNodeTypeSelect = '[data-test="input-node-stream-type-select"]';
        this.streamNodeNameSelect = '[data-test="input-node-stream-name-select"]';
        this.createStreamToggle   = '[data-test="create-stream-toggle"]';
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    async navigateToPipelines() {
        testLogger.info('Navigating to Pipelines page');
        await openNavFlyoutChild(this.page, 'pipeline');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    async navigateToImportPipeline() {
        testLogger.info('Navigating to Import Pipeline page');
        await this.navigateToPipelines();
        // The import pipeline page is typically reached via a route/button; navigate directly
        const orgId = process.env['ORGNAME'] || 'default';
        const baseUrl = process.env['ZO_BASE_URL'] || 'http://localhost:5080';
        await this.page.goto(`${baseUrl}/web/pipeline/pipelines/import?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ── Import Pipeline helpers ───────────────────────────────────────────────

    async waitForImportPage() {
        testLogger.info('Waiting for Import Pipeline page to be visible');
        await this.page.locator(this.importPipelineImportBtn).waitFor({ state: 'visible', timeout: 15000 });
    }

    async getImportButtonState() {
        return await this.page.locator(this.importPipelineImportBtn).isDisabled();
    }

    async uploadPipelineFile(filePath) {
        testLogger.info('Uploading pipeline file', { filePath });
        // OFile wraps a hidden native <input type="file"> — target it directly
        const nativeInput = this.page.locator(`${this.importPipelineFileInput} input[type="file"]`);
        await nativeInput.setInputFiles(filePath);
    }

    async clickImportButton() {
        testLogger.info('Clicking Import button');
        await this.page.locator(this.importPipelineImportBtn).click();
    }

    async clickCancelButton() {
        testLogger.info('Clicking Cancel button on Import Pipeline page');
        await this.page.locator(this.importPipelineCancelBtn).click();
    }

    // ── CreateBackfillJobDialog helpers ──────────────────────────────────────

    async waitForBackfillDrawer() {
        testLogger.info('Waiting for Create Backfill Job drawer to be visible');
        await this.page.locator(this.backfillDrawer).waitFor({ state: 'visible', timeout: 15000 });
    }

    async clickCreateBackfillJob() {
        testLogger.info('Clicking Create Backfill Job primary button');
        await this.page.locator(this.backfillPrimaryBtn).click();
    }

    async clickCancelBackfillJob() {
        testLogger.info('Clicking Cancel on Create Backfill Job drawer');
        await this.page.locator(this.backfillSecondaryBtn).click();
    }

    async expandAdvancedOptions() {
        testLogger.info('Expanding Advanced Options section');
        const section = this.page.locator(this.advancedOptionsSection);
        await section.waitFor({ state: 'visible', timeout: 10000 });
        await section.click();
    }

    async fillChunkPeriod(value) {
        testLogger.info('Filling chunk period input', { value });
        await this.page.locator(this.chunkPeriodInputField).fill(String(value));
    }

    async fillDelayBetweenChunks(value) {
        testLogger.info('Filling delay between chunks input', { value });
        await this.page.locator(this.delayBetweenChunksField).fill(String(value));
    }

    async isTimeRangeErrorVisible() {
        return await this.page.locator(this.timeRangeError).isVisible();
    }

    async isBackfillDrawerClosed() {
        return await this.page.locator(this.backfillDrawer).isHidden();
    }

    async waitForDeleteConfirmDialog() {
        testLogger.info('Waiting for delete confirmation dialog');
        await this.page.locator(this.deleteConfirmDialog).waitFor({ state: 'visible', timeout: 10000 });
    }

    async confirmDelete() {
        testLogger.info('Confirming delete in confirmation dialog');
        await this.page.locator(this.deleteConfirmPrimaryBtn).click();
    }

    async cancelDelete() {
        testLogger.info('Cancelling delete in confirmation dialog');
        await this.page.locator(this.deleteConfirmSecondaryBtn).click();
    }

    // ── Locator getters (no raw page.locator() calls in spec files) ──────────

    getBackfillDrawerLocator() {
        return this.page.locator(this.backfillDrawer);
    }

    getBackfillSecondaryBtnLocator() {
        return this.page.locator(this.backfillSecondaryBtn);
    }

    getTimeRangeErrorLocator() {
        return this.page.locator(this.timeRangeError);
    }

    getToastErrorLocator() {
        return this.page.locator(this.toastError);
    }

    getChunkPeriodInputErrorLocator() {
        return this.page.locator(this.chunkPeriodInputError);
    }

    getDelayBetweenChunksErrorLocator() {
        return this.page.locator(this.delayBetweenChunksError);
    }

    getDeleteBeforeBackfillChkLocator() {
        return this.page.locator(this.deleteBeforeBackfillChk);
    }

    getDeleteConfirmDialogIrreversibleTextLocator() {
        return this.page.locator(this.backfillDrawer).locator('text=Irreversible Data Deletion');
    }

    getImportPipelineImportBtnLocator() {
        return this.page.locator(this.importPipelineImportBtn);
    }

    getPipelineScheduledTabLocator() {
        return this.page.locator(this.pipelineScheduledTab);
    }

    getPipelineListBackfillBtnLocator() {
        return this.page.locator(this.pipelineListBackfillBtn);
    }

    // ── LLM Evaluation getters ────────────────────────────────────────────────

    getLlmEvalNameFieldLocator() {
        return this.page.locator(this.llmEvalNameField);
    }

    getLlmEvalNameErrorLocator() {
        return this.page.locator(this.llmEvalNameError);
    }

    getLlmEvalSpanIdentifierPopoverLocator() {
        return this.page.locator(this.llmEvalSpanIdentifierPopover);
    }

    getLlmEvalSpanIdentifierErrorLocator() {
        return this.page.locator(this.llmEvalSpanIdentifierError);
    }

    getLlmEvalTemplatePopoverLocator() {
        return this.page.locator(this.llmEvalTemplatePopover);
    }

    getLlmEvalTemplateErrorLocator() {
        return this.page.locator(this.llmEvalTemplateError);
    }

    getLlmEvalEnableSamplingToggleLocator() {
        return this.page.locator(this.llmEvalEnableSamplingToggle);
    }

    getLlmEvalSamplingRateFieldLocator() {
        return this.page.locator(this.llmEvalSamplingRateField);
    }

    getAssociateFunctionSaveBtnLocator() {
        return this.page.locator(this.associateFunctionSaveBtn);
    }

    // ── Associate Function getters ────────────────────────────────────────────

    getAssociateFunctionDrawerLocator() {
        return this.page.locator(this.associateFunctionDrawer);
    }

    getAssociateFunctionSelectPopoverLocator() {
        return this.page.locator(this.associateFunctionSelectPopover);
    }

    getAssociateFunctionSelectErrorLocator() {
        return this.page.locator(this.associateFunctionSelectError);
    }

    getCreateFunctionToggleLocator() {
        return this.page.locator(this.createFunctionToggle);
    }

    getAssociateFunctionAfterFlatteningLocator() {
        return this.page.locator(this.associateFunctionAfterFlattening);
    }

    // ── Create Destination getters ────────────────────────────────────────────

    getAddDestinationNameFieldLocator() {
        return this.page.locator(this.addDestinationNameField);
    }

    getAddDestinationNameErrorLocator() {
        return this.page.locator(this.addDestinationNameError);
    }

    getAddDestinationUrlFieldLocator() {
        return this.page.locator(this.addDestinationUrlField);
    }

    getAddDestinationUrlErrorLocator() {
        return this.page.locator(this.addDestinationUrlError);
    }

    getDestinationTypeCardHttpLocator() {
        return this.page.locator(this.destinationTypeCardHttp);
    }

    getStep1ContinueBtnLocator() {
        return this.page.locator(this.step1ContinueBtn);
    }

    getAddDestinationSubmitBtnLocator() {
        return this.page.locator(this.addDestinationSubmitBtn);
    }

    getAddDestinationCancelBtnLocator() {
        return this.page.locator(this.addDestinationCancelBtn);
    }

    // ── Edit Backfill Job getters ─────────────────────────────────────────────

    getEditBackfillJobDialogLocator() {
        return this.page.locator(this.editBackfillJobDialog);
    }

    getEditChunkPeriodFieldLocator() {
        return this.page.locator(this.editChunkPeriodField);
    }

    getEditChunkPeriodErrorLocator() {
        return this.page.locator(this.editChunkPeriodError);
    }

    getEditDelayBetweenChunksFieldLocator() {
        return this.page.locator(this.editDelayBetweenChunksField);
    }

    getEditDelayBetweenChunksErrorLocator() {
        return this.page.locator(this.editDelayBetweenChunksError);
    }

    // ── Pipeline Stream node getters ─────────────────────────────────────────

    getStreamNodeDrawerLocator()     { return this.page.locator(this.streamNodeDrawer); }
    getStreamNodeTypeSelectLocator() { return this.page.locator(this.streamNodeTypeSelect).first(); }
    getStreamNodeNameSelectLocator() { return this.page.locator(this.streamNodeNameSelect); }
    getCreateStreamToggleLocator()   { return this.page.locator(this.createStreamToggle); }

    // ── LLM Evaluation action helpers ─────────────────────────────────────────

    async fillLlmEvalName(value) {
        testLogger.info('Filling LLM Evaluation node name', { value });
        await this.page.locator(this.llmEvalNameField).fill(String(value));
    }

    async clearLlmEvalName() {
        testLogger.info('Clearing LLM Evaluation node name field');
        await this.page.locator(this.llmEvalNameField).fill('');
    }

    async clickLlmEvalEnableSamplingToggle() {
        testLogger.info('Clicking LLM Evaluation enable sampling toggle');
        await this.page.locator(this.llmEvalEnableSamplingToggle).click();
    }

    // ── Associate Function action helpers ─────────────────────────────────────

    async clickAssociateFunctionSelectPopover() {
        testLogger.info('Opening Associate Function select popover');
        await this.page.locator(this.associateFunctionSelectPopover).click();
    }

    async clickCreateFunctionToggle() {
        testLogger.info('Clicking create-function toggle');
        await this.page.locator(this.createFunctionToggle).click();
    }

    // ── Create Destination action helpers ─────────────────────────────────────

    async fillAddDestinationName(value) {
        testLogger.info('Filling destination name', { value });
        await this.page.locator(this.addDestinationNameField).fill(String(value));
    }

    async fillAddDestinationUrl(value) {
        testLogger.info('Filling destination URL', { value });
        await this.page.locator(this.addDestinationUrlField).fill(String(value));
    }

    async clickStep1ContinueBtn() {
        testLogger.info('Clicking Step 1 Continue button');
        await this.page.locator(this.step1ContinueBtn).click();
    }

    async clickAddDestinationCancelBtn() {
        testLogger.info('Clicking Add Destination Cancel button');
        await this.page.locator(this.addDestinationCancelBtn).click();
    }

    async navigateToAddDestination() {
        testLogger.info('Navigating to Add Destination page');
        const orgId = process.env['ORGNAME'] || 'default';
        const baseUrl = process.env['ZO_BASE_URL'] || 'http://localhost:5080';
        // PipelinesDestinationList lives at /web/settings/pipeline_destinations.
        // Passing ?action=add triggers editDestination(null) in onMounted → shows CreateDestinationForm.
        await this.page.goto(`${baseUrl}/web/settings/pipeline_destinations?action=add&org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    // ── Edit Backfill Job action helpers ──────────────────────────────────────

    async fillEditChunkPeriod(value) {
        testLogger.info('Filling edit backfill chunk period', { value });
        const field = this.page.locator(this.editChunkPeriodField);
        await field.fill(String(value));
    }

    async clearEditChunkPeriod() {
        testLogger.info('Clearing edit backfill chunk period field');
        const field = this.page.locator(this.editChunkPeriodField);
        await field.fill('');
    }

    // ── Environment-detection helpers (for conditional skips) ─────────────────

    /**
     * Tries every edit-pipeline button in the list, opens the pipeline editor,
     * and looks for an LLM Evaluation canvas node.  If found, clicks the node
     * to open its form section and returns true.  Returns false if no such node
     * is found across all listed pipelines.
     */
    async openFirstLlmEvalNode() {
        testLogger.info('Searching for a pipeline with an LLM Evaluation node');
        await this.navigateToPipelines();
        const editBtns = this.page.locator('[data-test$="-update-pipeline"]');
        const count = await editBtns.count();
        for (let i = 0; i < count; i++) {
            await this.navigateToPipelines();
            const btns = this.page.locator('[data-test$="-update-pipeline"]');
            // Shared org-wide list — other parallel files mutate it while we scan. Skip
            // this index if the list shrank past it rather than hanging on a missing row.
            if (i >= await btns.count()) break;
            const target = btns.nth(i);
            if (!(await target.isVisible({ timeout: 5000 }).catch(() => false))) continue;
            await target.click();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            const llmNode = this.page.locator('[data-test$="-llm-evaluation-node"]').first();
            if (await llmNode.isVisible({ timeout: 3000 }).catch(() => false)) {
                await llmNode.click();
                const nameField = this.page.locator(this.llmEvalNameField);
                if (await nameField.isVisible({ timeout: 5000 }).catch(() => false)) {
                    testLogger.info('LLM Evaluation node opened successfully');
                    return true;
                }
            }
        }
        testLogger.warn('No pipeline with LLM Evaluation node found');
        return false;
    }

    /**
     * Tries every edit-pipeline button in the list, opens the editor, and looks
     * for an Associate Function drawer.  If found, returns true.
     */
    async openFirstAssociateFunctionNode() {
        testLogger.info('Searching for a pipeline with an Associate Function node');
        await this.navigateToPipelines();
        const editBtns = this.page.locator('[data-test$="-update-pipeline"]');
        const count = await editBtns.count();
        for (let i = 0; i < count; i++) {
            await this.navigateToPipelines();
            const btns = this.page.locator('[data-test$="-update-pipeline"]');
            // The pipeline list is shared org-wide, so other parallel test files create
            // and delete rows while we scan. Re-check the current row count and skip this
            // index if the list has shrunk past it, instead of clicking a row that no
            // longer exists (which would hang until the 45s action timeout and flake).
            if (i >= await btns.count()) break;
            const target = btns.nth(i);
            if (!(await target.isVisible({ timeout: 5000 }).catch(() => false))) continue;
            await target.click();
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            // Function nodes have a click target on the node header area
            const funcNode = this.page.locator('[data-test$="-function-node"]').first();
            if (await funcNode.isVisible({ timeout: 3000 }).catch(() => false)) {
                await funcNode.click();
                const drawer = this.page.locator(this.associateFunctionDrawer);
                if (await drawer.isVisible({ timeout: 5000 }).catch(() => false)) {
                    testLogger.info('Associate Function drawer opened successfully');
                    return true;
                }
            }
        }
        testLogger.warn('No pipeline with Associate Function node found');
        return false;
    }

    /**
     * Navigates to the backfill jobs list and clicks the Edit button on the
     * first job found.  Returns true if the Edit Backfill Job dialog is visible.
     */
    async openFirstEditBackfillJob() {
        testLogger.info('Navigating to backfill jobs list');
        await this.navigateToPipelines();
        // The backfill button is enterprise-only — check visibility
        const backfillBtn = this.page.locator('[data-test="pipeline-list-backfill-btn"]');
        if (!(await backfillBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
            // Try overflow menu
            const overflowBtn = this.page.locator('[data-test="pipeline-list-overflow-menu-btn"]');
            if (await overflowBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await overflowBtn.click();
                const menuBackfillBtn = this.page.locator('[data-test="pipeline-list-menu-backfill-btn"]');
                if (!(await menuBackfillBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
                    testLogger.warn('Backfill button not found – not enterprise?');
                    return false;
                }
                await menuBackfillBtn.click();
            } else {
                testLogger.warn('Backfill button not accessible');
                return false;
            }
        } else {
            await backfillBtn.click();
        }
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        const editBtn = this.page.locator('[data-test="edit-job-btn"]').first();
        if (!(await editBtn.isVisible({ timeout: 8000 }).catch(() => false))) {
            testLogger.warn('No backfill jobs found in list');
            return false;
        }
        await editBtn.click();
        const dialog = this.page.locator(this.editBackfillJobDialog);
        if (!(await dialog.isVisible({ timeout: 5000 }).catch(() => false))) {
            testLogger.warn('Edit Backfill Job dialog did not open');
            return false;
        }
        testLogger.info('Edit Backfill Job dialog opened successfully');
        return true;
    }
}

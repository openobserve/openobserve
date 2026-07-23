// pipelinesPage.js
const http = require('http');
const https = require('https');
const { expect } = require('@playwright/test')
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const fetch = require('node-fetch');
const { getAuthHeaders } = require('../../playwright-tests/utils/cloud-auth.js');
import { openNavFlyoutChild } from '../commonActions.js';

const randomNodeName = `remote-node-${Math.floor(Math.random() * 1000)}`;

// HTTP agent that never pools connections. node-fetch v2 keep-alive pooling
// is the primary cause of "Premature close" / ECONNRESET flakiness in CI.
// Pick the agent by protocol so both local (http://localhost) and cloud/alpha
// (https://) URLs work — an http.Agent rejects https:// URLs.
const noKeepAliveHttpAgent = new http.Agent({ keepAlive: false });
const noKeepAliveHttpsAgent = new https.Agent({ keepAlive: false });
const selectAgent = (parsedURL) =>
    parsedURL.protocol === 'https:' ? noKeepAliveHttpsAgent : noKeepAliveHttpAgent;

/**
 * Perform a fetch, retrying on transient network errors.
 *
 * Uses keepAlive: false agent + compress: false to prevent the node-fetch v2
 * Gunzip "Premature close" / ECONNRESET flakiness that can survive retries
 * when every connection attempt hits a pooled dead socket.
 *
 * @param {string} url - Request URL
 * @param {object} options - fetch options
 * @param {number} maxRetries - Number of additional attempts after the first (default: 3)
 * @returns {Promise<Response>} The fetch response (only network errors are retried)
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
    const requestOpts = {
        ...options,
        compress: false,
        agent: selectAgent,
    };
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, requestOpts);
            // A 5xx is a transient backend blip, not a client error — alpha returns
            // 503 Service Unavailable / 502 Bad Gateway on ingestion during load spikes,
            // and a bare fetch treats those as a "successful" response so the caller threw
            // on the first one (pipelines:180 hard-failed on a run with 4x 503 + 1x 502).
            // Retry 5xx with backoff like a network error; a persistent 5xx still returns
            // after maxRetries and the caller throws — nothing is masked.
            if (response.status >= 500 && attempt < maxRetries) {
                const backoffMs = 800 * (attempt + 1);
                testLogger.warn('Transient 5xx from ingestion, retrying', { url, status: response.status, attempt: attempt + 1, maxRetries, backoffMs });
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
                continue;
            }
            return response;
        } catch (err) {
            const message = String(err && err.message ? err.message : err);
            const isTransient = /premature close|ECONNRESET|socket hang up|network|EPIPE|other side closed/i.test(message);
            if (!isTransient || attempt === maxRetries) {
                throw err;
            }
            const backoffMs = 500 * (attempt + 1);
            testLogger.warn('Transient fetch error, retrying ingestion', { url, attempt: attempt + 1, maxRetries, error: message, backoffMs });
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
    }
}

export class PipelinesPage {
    constructor(page) {
        this.page = page;
        // Locators from PipelinePage
        this.pipelineTab = page.locator('[data-test="pipeline-section-tab-streamPipelines"]');
        this.addPipelineButton = page.locator(
          '[data-test="pipeline-list-add-pipeline-btn"]'
        );
        this.streamButton = page.locator('[data-test="pipeline-node-sidebar-stream-input-btn"]');
        this.queryButton = page.locator('[data-test="pipeline-node-sidebar-query-input-btn"]');
        this.vueFlowPane = page.locator(".vue-flow__pane");
        // Stream-type OSelect inside the input-node form (Stream.vue). Clicking
        // the wrapper opens the OSelect popover with `*-option` items.
        this.inputNodeStreamTypeSelect = page.locator('[data-test="input-node-stream-type-select"]').first();
        // OSelect popover for the input-node stream-type select. Per the OSelect
        // convention (§4) the popover/options pick up `<parentDataTest>-popover`
        // and `<parentDataTest>-option` data-test attributes.
        this.inputNodeStreamTypePopover = page.locator('[data-test="input-node-stream-type-select-popover"]');
        // Per-value `logs` option inside the stream-type OSelect popover.
        this.inputNodeStreamTypeLogsOption = page.locator(
          '[data-test="input-node-stream-type-select-option"][data-test-value="logs"]'
        );
        this.logsDropdown = page.locator("div").filter({ hasText: /^logs$/ });
        this.logsOption = page
          .getByRole("option", { name: "logs" })
          .locator("div")
          .nth(2);
        this.saveButton = page.locator(
          '[data-test="input-node-stream-drawer"] [data-test="o-drawer-primary-btn"]'
        );
        // Error message shown when saving the input/output stream node without
        // selecting a stream. The OSelect on Stream.vue exposes the
        // `:error-message="streamNameError"` via its auto-derived
        // `${parent}-error` data-test (set on the wrapper `data-test`).
        this.selectStreamError = page.locator(
          '[data-test="input-node-stream-name-select-error"]'
        ).first();
        this.savePipelineButton = page.locator(
          '[data-test="add-pipeline-save-btn"]'
        );
        // Pipeline name required error — PipelineEditor's OInput. OInput
        // renders the error inside the auto-derived `${parent}-error` element.
        this.pipelineNameRequiredMessage = page.locator(
          '[data-test="pipeline-editor-name-input-error"]'
        ).first();
        // Pipeline name OInput - auto-derived `-field` for the native input.
        this.pipelineNameInput = page.locator('[data-test="pipeline-editor-name-input-field"]');
        // Source/destination node required errors are toasts in PipelineEditor.
        // OToast emits `data-test="o-toast-default"` (no variant) with the
        // message on `data-test-message`. Match the message attribute prefix.
        this.sourceNodeRequiredMessage = page.locator(
          '[data-test-message="Source node is required"]'
        );
        // Stream-name OSelect search input — auto-derived `-search` data-test
        // when searchable=true (see OSelect.vue listbox branch).
        this.streamNameInput = page.locator('[data-test="input-node-stream-name-select-search"]');
        // Stream-name OSelect option for `e2e_automate` — auto-derived from
        // parent data-test as `<parent>-option` + per-value `data-test-value`.
        this.e2eAutomateOption = page.locator(
          '[data-test="input-node-stream-name-select-option"][data-test-value="e2e_automate"]'
        );
        this.inputNodeStreamSaveButton = page.locator(
          '[data-test="input-node-stream-drawer"] [data-test="o-drawer-primary-btn"]'
        );
        this.destinationNodeRequiredMessage = page.locator(
          '[data-test-message="Destination node is required"]'
        );
        this.deleteButton = page.locator("button").filter({ hasText: "delete" });
        this.confirmDeleteButton = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
        this.secondStreamButton = page.locator('[data-test="pipeline-node-sidebar-stream-output-btn"]');
        this.functionButton = page.locator('[data-test="pipeline-node-sidebar-function-default-btn"]');
        this.conditionButton = page.locator('[data-test="pipeline-node-sidebar-condition-default-btn"]');
       this.selectPreviousNodeDropdown = page.getByLabel('Select Previous Node');
       this.previousNodeDropdown = page.locator('[data-test="previous-node-dropdown-input-stream-node-option"]');
       this.previousNodeDropdownSecond = page.locator('[data-test="previous-node-dropdown-input-stream-node-option"]:last-child');
        this.createStreamToggle = page.locator('[data-test="create-stream-toggle"]');
        this.saveStreamButton = page.locator('[data-test="save-stream-btn"]');
        this.inputNodeStreamSaveButton = page.locator(
          '[data-test="input-node-stream-drawer"] [data-test="o-drawer-primary-btn"]'
        );
        this.pipelineSearchInput = page.locator('[data-test="pipeline-list-search-input"]');
        // OInput inner native input — `.fill()` MUST target the `-field`
        // variant per §4 (the wrapper isn't the input).
        this.pipelineSearchInputField = page.locator('[data-test="pipeline-list-search-input-field"]');
        this.deletionSuccessMessage = page.locator('[data-test-message="Pipeline deleted successfully"]')
        this.sqlEditor = page.locator('[data-test="scheduled-pipeline-sql-editor"]');
        // Get the innermost Monaco editor element (handles nested .monaco-editor elements)
        this.sqlQueryInput = page.locator('.monaco-editor').last();
        this.frequencyUnit = page.locator('[data-test="scheduled-pipeline-frequency-unit"]');
        this.saveQueryButton = page.locator('[data-test="stream-routing-query-save-btn"]');
        this.createFunctionToggle = page.locator('[data-test="create-function-toggle"]');
        this.functionNameLabel = page.locator('[data-test="add-function-node-routing-section"]').getByLabel('Name');
        this.associateFunctionSaveButton = page.locator('[data-test="associate-function-drawer"] [data-test="o-drawer-primary-btn"]');
        this.associateNewFunctionSaveButton = page.locator('[data-test="add-function-save-btn"]');
        // AddFunction's name field is an OInput — when the form is submitted
        // empty, OInput renders the "Field is required!" message inside the
        // auto-derived `${parent}-error` element with `data-test-error-text`.
        this.functionNameRequiredError = page.locator(
          '[data-test="add-function-name-input-error"]'
        );
        this.functionRequiredError = page.locator(
          '[data-test-message="Function is required"]'
        );
        // Stream-selection error — `selectStreamError` (above) already covers
        // the OSelect-error case via the routing-section role=alert. Keep
        // `streamSelectionError` as an alias of that for backwards-compat
        // with existing PO callers.
        this.streamSelectionError = this.selectStreamError;
        // FilterGroup selectors for new condition UI.
        // Post-OSelect migration the inner OSelect/OInput emits its OWN data-test
        // (forwarded from the wrapper) so auto-derived `-trigger`, `-popover`,
        // `-search`, `-option`, and `-field` data-tests exist alongside the wrapper.
        this.columnSelect = page.locator('[data-test="alert-conditions-select-column"]');
        this.columnSelectTrigger = page.locator('[data-test="alert-conditions-select-column-trigger"]');
        this.columnSelectPopover = page.locator('[data-test="alert-conditions-select-column-popover"]');
        this.columnSelectSearch = page.locator('[data-test="alert-conditions-select-column-search"]');
        this.columnSelectFirstOption = page.locator('[data-test="alert-conditions-select-column-option"]').first();
        this.operatorSelect = page.locator('[data-test="alert-conditions-operator-select"]');
        this.operatorSelectTrigger = page.locator('[data-test="alert-conditions-operator-select-trigger"]');
        this.operatorSelectPopover = page.locator('[data-test="alert-conditions-operator-select-popover"]');
        this.valueInput = page.locator('[data-test="alert-conditions-value-input"]');
        // OInput inner native input (-field) — must `.fill()` the field variant per §4.
        this.valueInputField = page.locator('[data-test="alert-conditions-value-input-field"]');
        this.addConditionButton = page.locator('[data-test="alert-conditions-add-condition-btn"]');
        // Per-name OSelect option (works across both FilterCondition.vue and FieldsInput.vue
        // because the inner OSelect now emits the parent data-test, so options stamp
        // `alert-conditions-select-column-option` with `data-test-value="<col>"`).
        this.columnOptionByName = (name) => page.locator(
            `[data-test="alert-conditions-select-column-option"][data-test-value="${name}"]`,
        ).first();
        this.columnOption = page.getByRole('option', { name: 'kubernetes_container_name' })
        // OSelect renders its `:error-message` inside a `<span>` with
        // `data-test="${parent}-error"` (auto-derived from the wrapper data-test).
        this.fieldRequiredError = page.locator('[data-test="associate-function-select-function-input-error"]');
        // Condition node's "Please add at least one condition" validation error.
        // The OForm migration replaced the old imperative toast with inline schema
        // validation (Condition.schema.ts superRefine), rendered as a form-level
        // error div `data-test="add-condition-error"` in Condition.vue.
        this.conditionRequiredToast = page.locator(
          '[data-test="add-condition-error"]'
        );
        this.tableRowsLocator = page.locator("tbody tr");
        this.confirmButton = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
        this.settingsMenu = page.locator('[data-test="menu-link-\\/settings-item"]');
        this.pipelineDestinationsTab = page.locator('button[data-test="pipeline-destinations-tab"]');
        // "Add Destination" button in the pipeline destinations list
        this.destinationListAddBtn = page.locator('[data-test="pipeline-destination-list-add-btn"]');
        // Destination type selection cards (prefix match — use .first() to avoid strict-mode violations)
        this.destinationTypeCard = page.locator('[data-test^="destination-type-card-"]');
        this.searchInput = page.locator('[data-test="destination-list-search-input"]');
        // OToast notifications — data-test-variant is emitted by OToastProvider
        this.toastError = page.locator('[data-test-variant="error"]');
        this.toastSuccess = page.locator('[data-test-variant="success"]');
        this.functionNameInput = page.locator('[data-test="add-function-name-input"]');
        this.functionNameInputField = page.locator('[data-test="add-function-name-input-field"]');
        this.addConditionSaveButton = page.locator('[data-test="add-condition-drawer"] [data-test="o-drawer-primary-btn"]');
        this.enrichmentTableTab = '[data-test="pipeline-section-tab-enrichmentTables"]';
        // Added data-test "enrichment-tables-add-btn" on the New Enrichment
        // Table OButton — prefer the data-test locator; fall back to the
        // legacy getByRole locator for older specs still using the old PO copy.
        this.addEnrichmentTableButton = page.locator('[data-test="enrichment-tables-add-btn"]');
        // Enrichment tables list — OInput search field (auto-derived `-field` data-test)
        this.enrichmentSearchField = page.locator('[data-test="enrichment-tables-search-input-field"]');
        // Add / Update Enrichment Table form root
        this.addEnrichmentTablePage = page.locator('[data-test="add-enrichment-table-page"]');
        // Enrichment table tab locator (data-test prefix; the tab is rendered by
        // OToggleGroup under the Functions section).
        this.enrichmentTableTabLocator = page.locator('[data-test="pipeline-section-tab-enrichmentTables"]');
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
        this.pipelineSavedMessage = page.locator('[data-test-message="Pipeline saved successfully"]');
        this.addEnrichmentTableText = page.locator('[data-test="enrichment-tables-add-btn"]');
        this.deletedSuccessfullyText = page.locator('[data-test-message*="deleted successfully"]');
        this.conditionDropdown = page.locator("div:nth-child(2) > div:nth-child(2) input");
        this.deleteButtonNth1 = page.locator("button").filter({ hasText: "delete" }).nth(1);

        // Condition-specific locators for comprehensive testing
        this.addConditionSection = page.locator('[data-test="add-condition-section"]');
        this.addConditionGroupBtn = page.locator('[data-test="alert-conditions-add-condition-group-btn"]');
        this.toggleOperatorBtn = page.locator('[data-test="alert-conditions-toggle-operator-btn"]');
        this.deleteConditionBtn = page.locator('[data-test="alert-conditions-delete-condition-btn"]');
        this.reorderBtn = page.locator('[data-test="alert-conditions-reorder-btn"]');
        this.addConditionCancelBtn = page.locator('[data-test="add-condition-drawer"] [data-test="o-drawer-secondary-btn"]');
        this.addConditionDeleteBtn = page.locator('[data-test="add-condition-drawer"] [data-test="o-drawer-neutral-btn"]');
        this.scheduledAlertTabs = page.locator('[data-test="scheduled-alert-tabs"]');
        this.nestedGroups = page.locator('.el-border');
        this.operatorLabels = page.locator('span.tw\\:lowercase');
        this.firstConditionLabel = page.locator('[data-test="add-condition-section"]').getByText('if', { exact: true }).first();
        this.noteContainer = page.locator('[data-test="add-condition-note-container"]');
        this.noteHeading = page.locator('[data-test="add-condition-note-heading"]');
        this.noteInfo = page.locator('[data-test="add-condition-note-info"]');
        this.qDialog = page.locator('[data-test*="dialog"]');
        this.qDialogBackdrop = page.locator('[role="dialog"]');
        this.qNotificationMessage = page.locator('[role="alert"]');
        this.qMenu = page.locator('[data-test$="-popover"], [role="menu"]');

        // Pipeline node locators
        this.pipelineNodeOutputStreamNode = page.locator('[data-test="pipeline-node-output-stream-node"]');
        this.pipelineNodeOutputDeleteBtn = page.locator('[data-test="pipeline-node-output-delete-btn"]');
        this.pipelineNodeDefaultConditionNode = page.locator('[data-test="pipeline-node-default-condition-node"]');
        this.pipelineNodeInputOutputHandle = page.locator('[data-test="pipeline-node-input-output-handle"]');
        this.pipelineNodeDefaultInputHandle = page.locator('[data-test="pipeline-node-default-input-handle"]');
        this.pipelineNodeDefaultOutputHandle = page.locator('[data-test="pipeline-node-default-output-handle"]');
        this.pipelineNodeOutputInputHandle = page.locator('[data-test="pipeline-node-output-input-handle"]');
        this.addPipelineBackBtn = page.locator('[data-test="add-pipeline-back-btn"]');
        // Backfill jobs list locators — error indicator per row + error dialog.
        this.backfillErrorIndicatorBtn = page.locator('[data-test="error-indicator-btn"]');
        this.backfillErrorDialog = page.locator('[data-test="backfill-jobs-list-error-dialog"]');

        // Additional locators for raw selector fixes
        this.functionIcon = page.getByRole("img", { name: "Function", exact: true });
        // VRL editor uses unified-query-editor with data-test attribute (may have multiple matches)
        this.vrlFunctionEditor = page.locator('[data-test="logs-vrl-function-editor"]').first();
        this.vrlEditorViewLines = page.locator('[data-test="logs-vrl-function-editor"]').first().locator('.view-lines');
        // Get the innermost Monaco editor element (handles nested .monaco-editor elements)
        this.vrlEditorMonaco = page.locator('[data-test="logs-vrl-function-editor"]').first().locator('.monaco-editor').last();
        this.noteText = page.getByText("Note: The function will be");
        // Scheduled-pipeline stream-type OSelect — wrapper and auto-derived
        // `-trigger` / `-popover` / `-option` data-tests (added on
        // ScheduledPipeline.vue per AGENT_RULES §6).
        this.streamTypeDropdown = page.locator('[data-test="scheduled-pipeline-stream-type-select"]');
        this.streamTypeDropdownTrigger = page.locator('[data-test="scheduled-pipeline-stream-type-select-trigger"]');
        this.streamTypeDropdownPopover = page.locator('[data-test="scheduled-pipeline-stream-type-select-popover"]');
        this.streamTypeLabel = page.getByLabel('Stream Type *');
        // Scheduled-pipeline stream-name OSelect — searchable=true (default),
        // so auto-derived `-trigger`, `-popover`, `-search`, and `-option`
        // data-tests are available alongside the wrapper.
        this.scheduledStreamNameSelect = page.locator('[data-test="scheduled-pipeline-stream-name-select"]');
        this.scheduledStreamNameSelectTrigger = page.locator('[data-test="scheduled-pipeline-stream-name-select-trigger"]');
        this.scheduledStreamNameSelectPopover = page.locator('[data-test="scheduled-pipeline-stream-name-select-popover"]');
        this.scheduledStreamNameSelectSearch = page.locator('[data-test="scheduled-pipeline-stream-name-select-search"]');
        this.scheduledStreamNameOptionByValue = (name) => page.locator(
            `[data-test="scheduled-pipeline-stream-name-select-option"][data-test-value="${name}"]`,
        ).first();
        this.sqlEditorViewLines = page.locator('[data-test="scheduled-pipeline-sql-editor"] .view-lines');
        this.invalidSqlQueryText = page.getByText("Invalid SQL Query");
        this.queryRoutingSection = page.locator('[data-test="add-stream-query-routing-section "]');
        this.queryNode = page.locator('[data-test="pipeline-node-input-query-node"]');
        this.queryNodeDeleteBtn = page.locator('[data-test="pipeline-node-input-delete-btn"]');
        this.cancelPipelineBtn = page.locator('[data-test="add-pipeline-cancel-btn"]');
        this.dashboardsMenuLink = page.locator('[data-test="menu-link-\\/dashboards-item"]');
        // PipelineEditor emits a toast "Please connect all nodes before saving"
        // when the user clicks Save without joining nodes. OToast renders it via
        // `data-test-message` on its root.
        this.connectAllNodesError = page.locator(
          '[data-test-message="Please connect all nodes before saving"]'
        ).first();
        this.logsOptionRole = page.getByRole("option", { name: "logs" });
        this.fileInput = page.locator('input[type="file"]');

        // Scheduled Pipeline Validation locators (Issue #9901 regression tests)
        this.validateAndCloseBtn = page.locator('[data-test="stream-routing-query-save-btn"]');
        this.streamRoutingQueryCancelBtn = page.locator('[data-test="stream-routing-query-cancel-btn"]');
        this.discardChangesDialog = page.locator('[data-test="confirm-dialog"]');
        this.discardChangesOkBtn = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
        // Secondary (Cancel/Dismiss) button in the unsaved-changes confirm dialog.
        this.discardChangesCancelBtn = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]');
        this.scheduledPipelineCancelBtn = page.locator('button').filter({ hasText: 'Cancel' }).first();

        // Bug #11498 - Run Query button (in scheduled pipeline dialog)
        // Use text filter to distinguish from the SearchBar's identical data-test selector
        this.runQueryButton = page.locator('[data-test="logs-search-bar-refresh-btn"]').filter({ hasText: 'Run Query' });
    }

    // Methods from original PipelinesPage
    async gotoPipelinesPage() {
        await openNavFlyoutChild(this.page, 'pipeline');
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
        // Navigate straight to the pipeline list via goto — deterministic and fast.
        // The left-nav flyout (openNavFlyoutChild) is a hover-reveal that self-closes on
        // settle and, under concurrent cloud load, burns up to ~30s retrying to open
        // before its goto-fallback even fires. A heavy condition test calls this twice,
        // and that wasted time tipped pipeline-conditions:82 over the 180s test timeout
        // (validated against alpha at --workers=5). The flyout adds no coverage here — we
        // only need to land on the pipeline list page — so skip it. goto is already the
        // proven fallback path; promoting it to primary removes the flake source.
        // (Auth is safe: with the stored session, a goto to a list route boots the SPA
        // with the existing token — unlike a reload of the unsaved /pipelines/add editor,
        // which re-triggers the Dex callback.)
        if (!(await this.page.locator('[data-test="pipeline-list-page"]')
            .isVisible({ timeout: 3000 }).catch(() => false))) {
            await this.page.goto(
                `${process.env.ZO_BASE_URL}/web/pipeline/pipelines?org_identifier=${process.env["ORGNAME"]}`
            );
            await this.page.locator('[data-test="pipeline-list-page"]')
                .waitFor({ state: 'visible', timeout: 30000 });
        }
        // Ensure the Stream Pipelines section tab is selected. Wait for it to render
        // before clicking so the click never races the page mount.
        await this.pipelineTab.waitFor({ state: 'visible', timeout: 15000 });
        await this.pipelineTab.click();
    }

    async addPipeline() {
        // Wait for the add pipeline button to be visible.
        await this.addPipelineButton.waitFor({ state: 'visible', timeout: 15000 });
        await this.addPipelineButton.click();
        // Confirm the editor actually mounted: the NodeSidebar's stream-input button is the
        // first thing every pipeline flow needs (selectStream/dragStreamToTarget). Under
        // concurrent cloud load the route change + VueFlow/NodeSidebar mount can lag, or the
        // add click can be dropped before navigation starts. If the button hasn't rendered
        // and we're still on the list page (add button still visible), re-click to re-trigger
        // navigation. This is NON-DESTRUCTIVE — no page.reload(): a reload here trips the
        // editor's onBeforeRouteLeave unsaved-changes guard, bounces off the editor route,
        // and stalls every downstream test (regressed the shard to 18 failed).
        for (let attempt = 1; attempt <= 3; attempt++) {
            if (await this.streamButton.isVisible({ timeout: 15000 }).catch(() => false)) {
                return;
            }
            if (await this.addPipelineButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await this.addPipelineButton.click().catch(() => {});
            }
        }
        await this.streamButton.waitFor({ state: 'visible', timeout: 15000 });
    }

    async selectStream() {
        // addPipeline() already confirms the editor + NodeSidebar mounted; just synchronise
        // on the button being actionable before clicking (no reload — see addPipeline note).
        await this.streamButton.waitFor({ state: 'visible', timeout: 30000 });
        await this.streamButton.click();
    }

    /**
     * The node rail now starts COLLAPSED (toggled from the canvas control
     * stack), so its buttons are not in the DOM until it is opened. Every
     * palette interaction has to go through here first.
     */
    async ensureNodePaletteOpen() {
        const rail = this.page.locator('[data-test="pipeline-node-sidebar"]');
        if (await rail.isVisible().catch(() => false)) return;
        await this.page.locator('[data-test="pipeline-node-sidebar-collapse-btn"]').click();
        await rail.waitFor({ state: 'visible' });
    }

    async dragStreamToTarget(streamElement, offset = { x: 0, y: 0 }) {
        await this.ensureNodePaletteOpen();
        // The pipeline NodeSidebar uses HTML5 `@dragstart` (draggable="true"),
        // and the canvas's `@drop` reads `pipelineObj.draggedNode` set in
        // `onDragStart`. Playwright's `mouse.move/down/up` does NOT dispatch
        // HTML5 drag events. We dispatch the full HTML5 drag sequence
        // (dragstart → dragover → drop) directly via DOM APIs using
        // `page.evaluate`, sharing a single DataTransfer instance so the
        // source's `event.dataTransfer.setData` and the drop's `clientX/Y`
        // both flow through to useDnD.ts:onDrop.
        const targetBox = await this.vueFlowPane.boundingBox();
        const streamBox = await streamElement.boundingBox();
        if (!streamBox || !targetBox) return;
        const sourceX = streamBox.x + streamBox.width / 2;
        const sourceY = streamBox.y + streamBox.height / 2;
        const targetX = targetBox.x + targetBox.width / 2 + offset.x;
        const targetY = targetBox.y + targetBox.height / 2 + offset.y;
        // Resolve elements via DOM coordinates so we don't introduce
        // non-data-test selectors here.
        await this.page.evaluate(
            ({ sx, sy, tx, ty }) => {
                const sourceEl = document.elementFromPoint(sx, sy);
                const targetEl = document.elementFromPoint(tx, ty);
                if (!sourceEl || !targetEl) return;
                // Walk up from sourceEl to find the [draggable=true] ancestor
                let dragEl = sourceEl;
                while (dragEl && dragEl !== document.body) {
                    if (dragEl.getAttribute && dragEl.getAttribute('draggable') === 'true') break;
                    dragEl = dragEl.parentElement;
                }
                if (!dragEl) dragEl = sourceEl;
                const dt = new DataTransfer();
                dragEl.dispatchEvent(new DragEvent('dragstart', {
                    bubbles: true, cancelable: true, dataTransfer: dt,
                    clientX: sx, clientY: sy,
                }));
                targetEl.dispatchEvent(new DragEvent('dragenter', {
                    bubbles: true, cancelable: true, dataTransfer: dt,
                    clientX: tx, clientY: ty,
                }));
                targetEl.dispatchEvent(new DragEvent('dragover', {
                    bubbles: true, cancelable: true, dataTransfer: dt,
                    clientX: tx, clientY: ty,
                }));
                targetEl.dispatchEvent(new DragEvent('drop', {
                    bubbles: true, cancelable: true, dataTransfer: dt,
                    clientX: tx, clientY: ty,
                }));
                dragEl.dispatchEvent(new DragEvent('dragend', {
                    bubbles: true, cancelable: true, dataTransfer: dt,
                    clientX: tx, clientY: ty,
                }));
            },
            { sx: sourceX, sy: sourceY, tx: targetX, ty: targetY }
        );
        // Wait for whichever node form the drop opened to render:
        //   Stream    -> add-stream-input-stream-routing-section (Stream.vue)
        //   Query     -> add-stream-query-routing-section        (Query.vue)
        //   Condition -> add-condition-section                   (Condition.vue)
        //   Function  -> associate-function-drawer               (AssociateFunction.vue)
        // Previously this waited only on the stream selector, so EVERY query/condition/
        // function drag burned the full 10s timeout before the .catch(). Racing all four
        // (`:visible` so .first() only considers the one open dialog) lets each drag
        // resolve on its own form in ~1s.
        await this.page.locator(
            '[data-test="add-stream-input-stream-routing-section"]:visible, ' +
            '[data-test="add-stream-query-routing-section"]:visible, ' +
            '[data-test="add-condition-section"]:visible, ' +
            '[data-test="associate-function-drawer"]:visible'
        )
            .first()
            .waitFor({ state: 'visible', timeout: 10000 })
            .catch(() => {});
    }

    async selectLogs() {
        // Open the input-node stream-type OSelect. Stream-type uses the
        // non-listbox SelectRoot branch (searchable=false, plain string opts),
        // so there is no `<parent>-trigger` data-test. Click the wrapper.
        await this.inputNodeStreamTypeSelect.waitFor({ state: 'visible', timeout: 15000 });
        await this.inputNodeStreamTypeSelect.click();
        // Wait for the OSelect popover to appear (data-test forwarded from parent).
        await this.inputNodeStreamTypePopover.first().waitFor({ state: 'visible', timeout: 10000 });
        // Pick the `logs` option — OSelectItem forwards parent data-test plus a
        // per-value `data-test-value` (see OSelectItem.vue source mod).
        await this.inputNodeStreamTypeLogsOption.first().waitFor({ state: 'visible', timeout: 10000 });
        await this.inputNodeStreamTypeLogsOption.first().click();
    }

    /**
     * Click the stream type select dropdown in the add pipeline dialog
     */
    async clickStreamTypeSelect() {
        // Wait for the add pipeline dialog to be visible
        await this.page.waitForLoadState('networkidle').catch(() => {});
        await this.page.waitForTimeout(1000);

        // The data-test attribute is on a wrapper div, the select trigger is inside
        // Target the select trigger inside the wrapper
        const streamTypeWrapper = this.page.locator('[data-test="add-pipeline-stream-type-select"]');
        await streamTypeWrapper.waitFor({ state: 'visible', timeout: 15000 });

        // Click on the select trigger inside the wrapper
        const streamTypeSelect = streamTypeWrapper.locator('[role="combobox"]');
        await streamTypeSelect.waitFor({ state: 'visible', timeout: 10000 });
        await streamTypeSelect.click();
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
        await this.page.waitForLoadState('networkidle').catch(() => {});
        await this.page.waitForTimeout(500);

        // Post-OSelect-migration contract (§4): the wrapper div carries the data-test;
        // OSelect auto-derives a `-trigger` data-test for the inner PopoverTrigger.
        // Prefer the explicit `-trigger`; fall back to the wrapper for backwards compat.
        const trigger = this.page.locator('[data-test="input-node-stream-type-select-trigger"]').first();
        const wrapper = this.page.locator('[data-test="input-node-stream-type-select"]').first();
        if (await trigger.count() > 0) {
            await trigger.waitFor({ state: 'visible', timeout: 15000 });
            await trigger.click();
        } else {
            await wrapper.waitFor({ state: 'visible', timeout: 15000 });
            await wrapper.click();
        }
        await this.page.locator('[data-test="input-node-stream-type-select-popover"]')
            .waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }

    /**
     * Select metrics as the stream type in the pipeline node form
     */
    async selectMetrics() {
        // Open the OSelect popover for the input-node stream-type select.
        await this.inputNodeStreamTypeSelect.waitFor({ state: 'visible', timeout: 15000 });
        await this.inputNodeStreamTypeSelect.click();
        await this.inputNodeStreamTypePopover.first().waitFor({ state: 'visible', timeout: 10000 });
        // Pick the `metrics` option — OSelectItem stamps `data-test-value`.
        const metricsOption = this.page.locator(
            '[data-test="input-node-stream-type-select-option"][data-test-value="metrics"]'
        ).first();
        await metricsOption.waitFor({ state: 'visible', timeout: 10000 });
        await metricsOption.click();
    }

    /**
     * Select traces as the stream type in the pipeline node form
     */
    async selectTraces() {
        // Open the OSelect popover for the input-node stream-type select.
        await this.inputNodeStreamTypeSelect.waitFor({ state: 'visible', timeout: 15000 });
        await this.inputNodeStreamTypeSelect.click();
        await this.inputNodeStreamTypePopover.first().waitFor({ state: 'visible', timeout: 10000 });
        // Pick the `traces` option — OSelectItem auto-derives the parent
        // data-test, so each option stamps `<parent>-option` with `data-test-value`.
        const tracesOption = this.page.locator(
            '[data-test="input-node-stream-type-select-option"][data-test-value="traces"]'
        ).first();
        await tracesOption.waitFor({ state: 'visible', timeout: 10000 });
        await tracesOption.click();
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
        // OSelect now forwards parent data-test to ListboxItem (`*-option`); we
        // grab any option-like node with a data-test ending in `-option`.
        const options = await this.page.locator('[data-test$="-option"]').allTextContents();
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
        await this.pipelineSearchInputField.waitFor({ state: 'visible', timeout: 10000 });
        await this.pipelineSearchInputField.fill(searchTerm);
        await expect(this.pipelineSearchInputField).toHaveValue(searchTerm, { timeout: 5000 });
    }

    /**
     * Clear the pipeline list search input
     */
    async clearPipelineListSearch() {
        await this.pipelineSearchInputField.waitFor({ state: 'visible', timeout: 10000 });
        await this.pipelineSearchInputField.clear();
        await this.page.waitForTimeout(500);
    }

    async saveStream() {
        await this.saveButton.click();
    }

    async confirmStreamError() {
        await expect(this.selectStreamError.first()).toBeVisible({ timeout: 10000 });
    }

    async savePipeline() {
        await this.savePipelineButton.click();
    }

    async confirmPipelineNameRequired() {
        await expect(this.pipelineNameRequiredMessage.first()).toBeVisible({ timeout: 10000 });
    }

    async enterPipelineName(pipelineName) {
        await this.page.locator('[data-test="add-stream-input-stream-routing-section"]')
            .first()
            .waitFor({ state: 'detached', timeout: 10000 })
            .catch(() => {});
        await this.pipelineNameInput.waitFor({ state: 'visible', timeout: 10000 });
        await this.pipelineNameInput.click();
        await this.pipelineNameInput.fill(pipelineName);
    }

    async confirmSourceNodeRequired() {
        await expect(this.sourceNodeRequiredMessage.first()).toBeVisible({ timeout: 10000 });
    }
    async enterStreamName(streamName) {
        // The stream-name OSelect (searchable=true) renders the search input
        // only when its popover is open. Click the wrapper first to open it,
        // then fill the `-search` field.
        const wrapper = this.page.locator('[data-test="input-node-stream-name-select"]').first();
        const popoverOpen = await this.streamNameInput.isVisible().catch(() => false);
        if (!popoverOpen) {
            await wrapper.waitFor({ state: 'visible', timeout: 15000 });
            await wrapper.click();
            await this.streamNameInput.waitFor({ state: 'visible', timeout: 10000 });
        }
        // Use Ctrl+A/Backspace before fill to clear any existing search term —
        // matches the OSelect popover search convention from AGENT_RULES.
        await this.streamNameInput.click();
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Backspace');
        await this.streamNameInput.fill(streamName);
    }

    /**
     * Select a stream option by name from the dropdown
     * @param {string} streamName - The name of the stream to select
     */
    async selectStreamOptionByName(streamName) {
        // OSelect emits `<parent>-option` data-test + a per-value
        // `data-test-value` for every ListboxItem. Match by value to avoid
        // the prefix collision that a substring or role-name match would
        // produce (e.g. "e2e_automate" vs "e2e_automate3").
        const optionLocator = this.page.locator(
            `[data-test="input-node-stream-name-select-option"][data-test-value="${streamName}"]`
        ).first();
        await optionLocator.waitFor({ state: 'visible', timeout: 15000 });
        await optionLocator.click({ force: true });
        await this.page.locator('[data-test="input-node-stream-name-select-popover"]')
            .waitFor({ state: 'hidden', timeout: 5000 })
            .catch(() => {});
    }

    async saveInputNodeStream() {
        await this.page.locator('[data-test="input-node-stream-name-select-popover"]')
            .waitFor({ state: 'detached', timeout: 5000 })
            .catch(() => {});
        await this.inputNodeStreamSaveButton.waitFor({ state: 'visible', timeout: 15000 });
        await this.inputNodeStreamSaveButton.click();
    }

    async confirmDestinationNodeRequired() {
        await expect(this.destinationNodeRequiredMessage.first()).toBeVisible({ timeout: 10000 });
    }
    async deletePipeline() {
        // Navigate back from pipeline editing
        await this.page.locator('[data-test="add-pipeline-back-btn"]').click();
    }

    async confirmDelete() {
        await this.confirmDeleteButton.click();
    }

    async selectAndDragSecondStream() {
        await this.dragStreamToTarget(this.secondStreamButton, { x: 120, y: 120 });
    }

    async selectAndDragFunction() {
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
        // If the stream-name popover is still open (Enter path in fillDestinationStreamName),
        // wait for it to detach. It will close via interactOutside when the save button receives
        // the pointerdown event. The .catch keeps this non-blocking if already detached.
        await this.page.locator('[data-test="input-node-stream-name-select-popover"]')
            .waitFor({ state: 'detached', timeout: 5000 })
            .catch(() => {});
        await this.inputNodeStreamSaveButton.waitFor({ state: 'visible', timeout: 15000 });
        await this.inputNodeStreamSaveButton.click();
    }
    async searchPipeline(pipelineName) {
        await this.pipelineSearchInputField.waitFor({ state: 'visible', timeout: 10000 });
        await this.pipelineSearchInputField.click();
        await this.pipelineSearchInputField.fill(pipelineName);
    }

    /**
     * Verify that a pipeline exists in the pipeline list
     * @param {string} pipelineName - Name of the pipeline to verify
     * @returns {Promise<boolean>} - True if pipeline exists, false otherwise
     */
    async verifyPipelineExists(pipelineName) {
        await this.page.waitForLoadState('networkidle').catch(() => {});
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
        await this.deletionSuccessMessage.waitFor({ state: 'visible' });
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
        await this.functionNameInputField.fill(name);
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
        // Click the column select in FilterCondition
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

    async verifyConditionRequiredError() {
        // Saving a condition node with no valid condition fails the OForm schema
        // (conditionSchema superRefine), which surfaces the "Please add at least
        // one condition" message inline as `data-test="add-condition-error"`
        // (no toast is emitted anymore).
        await this.conditionRequiredToast.first().waitFor({ state: 'visible', timeout: 10000 });
    }

    async navigateToAddEnrichmentTable() {
        // Land directly on the enrichment-tables LIST page instead of the old
        // two-hop route (flyout → pipelines list → click the
        // `pipeline-section-tab-enrichmentTables` OTab). That tab lives in the
        // pipelines page header (PipelineSectionTabs, rendered in AppPageHeader's
        // #tabs slot) and only mounts once that page has fully rendered — so on
        // cloud a slow/missed flyout nav left the tab locator unattached and the
        // blind `force` click timed out at 45s (systematic across every test).
        // `enrichmentTables` has its own left-nav flyout child, so navigate
        // straight to its list page and skip the fragile section-tab hop.
        const enrichmentListUrlRe = /\/pipeline\/enrichment-tables/;
        const listPage = this.page.locator('[data-test="enrichment-tables-list-page"]');

        // Prefer SPA nav via the direct flyout child; fall back to a hard goto
        // if the hover-driven flyout click misses (same recovery pattern as
        // enrichmentPage.gotoEnrichmentTablesWithOrg).
        try {
            await openNavFlyoutChild(this.page, 'enrichment');
            await this.page.waitForURL(enrichmentListUrlRe, { timeout: 15000 });
        } catch (navError) {
            testLogger.warn('Enrichment flyout nav missed — falling back to direct goto', {
                error: navError.message,
            });
            let org = process.env.ORGNAME;
            try {
                org = new URL(this.page.url()).searchParams.get('org_identifier') || org;
            } catch { /* about:blank etc. — keep ORGNAME fallback */ }
            await this.page.goto(
                `${process.env.ZO_BASE_URL}/web/pipeline/enrichment-tables?org_identifier=${org}`,
                { waitUntil: 'domcontentloaded' },
            );
            await this.page.waitForURL(enrichmentListUrlRe, { timeout: 15000 });
        }

        // Wait for the list page container, then settle+retry the Add-button
        // click. The OButton in the AppPageHeader #actions slot can detach
        // mid-render while the list hydrates (documented add-btn detach race),
        // so re-resolve the locator and tolerate a transient detach. Short-circuit
        // if a prior attempt already opened the form (the Add button is v-if'd
        // out once the form mounts, so re-asserting its visibility would loop).
        await listPage.waitFor({ state: 'visible', timeout: 20000 });
        await expect(async () => {
            if (await this.addEnrichmentTablePage.isVisible().catch(() => false)) return;
            await expect(this.addEnrichmentTableText).toBeVisible({ timeout: 5000 });
            await this.addEnrichmentTableText.click({ timeout: 5000 });
            await expect(this.addEnrichmentTablePage).toBeVisible({ timeout: 10000 });
        }).toPass({ timeout: 45000 });
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
    // Per-row factory helpers for enrichment table rows (data-test scoped by name)
    getEnrichmentRowTypeCell(name) {
        return this.page.locator(`[data-test="${name}-type-cell"]`);
    }
    getEnrichmentRowDeleteBtn(name) {
        return this.page.locator(`[data-test="${name}-delete-btn"]`);
    }

    async deleteEnrichmentTableByName(fileName) {
        // Wait for the enrichment tables list page to be ready
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        // Use the OInput search via its auto-derived `-field` native input
        await this.enrichmentSearchField.waitFor({ state: 'visible', timeout: 30000 });
        await this.enrichmentSearchField.clear();
        await this.enrichmentSearchField.fill(fileName);

        // Poll for the row's type-cell — the list may still be loading from
        // the backend, especially after a navigation. The OTable filter is
        // client-side so once the row arrives, the filter shows it immediately.
        const typeCell = this.getEnrichmentRowTypeCell(fileName);
        let visible = false;
        for (let attempt = 0; attempt < 3 && !visible; attempt++) {
            visible = await typeCell.isVisible({ timeout: 10000 }).catch(() => false);
            if (!visible) {
                // Re-issue the search; the list may have just hydrated
                await this.enrichmentSearchField.clear();
                await this.enrichmentSearchField.fill(fileName);
            }
        }
        if (!visible) {
            throw new Error(
              `Uploaded file "${fileName}" not found in the enrichment table.`
            );
        }
        testLogger.debug("Uploaded file found", { functionName: fileName });

        // Click the per-row delete button — `<name>-delete-btn`
        const deleteBtn = this.getEnrichmentRowDeleteBtn(fileName);
        await deleteBtn.waitFor({ state: 'visible', timeout: 10000 });
        await deleteBtn.click();

        // Confirm the deletion via the confirm dialog's primary button
        await this.confirmButton.waitFor({ state: 'visible', timeout: 10000 });
        await this.confirmButton.click();

        // Wait for the row to actually disappear from the list
        await typeCell.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    }

    async navigateToEnrichmentTableTab() {
        await openNavFlyoutChild(this.page, 'pipeline');
        await this.page.locator(this.enrichmentTableTab).click();
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
        // `menu-link-/streams-item` is the "Data" nav group tile: it both opens a
        // hover flyout and navigates. A plain click can register as the hover-open
        // (flyout appears, page stays blank) without navigating — the same flyout
        // race that hit openPipelineMenu. Confirm the streams page rendered; if not,
        // navigate directly. A blind 1s wait previously let refreshStreamStats() fire
        // against a page that had not loaded.
        await this.streamsMenuItem.click();
        const onStreamsPage = await this.page.locator('[data-test="log-stream-table"]')
            .waitFor({ state: 'visible', timeout: 15000 })
            .then(() => true)
            .catch(() => false);
        if (!onStreamsPage) {
            await this.page.goto(
                `${process.env.ZO_BASE_URL}/web/streams?org_identifier=${process.env["ORGNAME"]}`
            );
            await this.page.locator('[data-test="log-stream-table"]')
                .waitFor({ state: 'visible', timeout: 30000 });
        }
    }

    async refreshStreamStats() {
        // The refresh button is an OButton with :loading bound to the stream-stats
        // fetch; while loading it is rendered disabled. Clicking during that window
        // makes Playwright wait on actionability and time out at 45s under CI load
        // (the pipeline-dynamic flake). Wait for it to settle (visible + enabled)
        // before clicking.
        await this.refreshStatsButton.waitFor({ state: 'visible', timeout: 30000 });
        await expect(this.refreshStatsButton).toBeEnabled({ timeout: 30000 });
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
        // The destination-stream data ingested by exploreStreamAndNavigateToPipeline
        // may not be indexed yet when the logs explorer first renders (indexing
        // latency is high on loaded envs), so the first row can be absent and a bare
        // click dead-waits the full 45s action timeout (the pipeline-core:56 flake
        // once navigation stopped failing earlier). Re-run the query until a row
        // appears instead of clicking into an empty table.
        const runQueryBtn = this.page.locator('[data-test="logs-search-bar-refresh-btn"]');
        // ~10 attempts (~120s) not 6 (~78s): on a contended alpha the destination stream's
        // first row routinely lands past 90s (pipeline-dynamic 72/97/113 flake at this step).
        // Comfortably inside the 5-min CI test timeout.
        for (let attempt = 1; attempt <= 10; attempt++) {
            if (await this.timestampColumnMenu.isVisible({ timeout: 9000 }).catch(() => false)) {
                break;
            }
            // Re-trigger the search so newly-indexed rows are picked up.
            await runQueryBtn.first().click({ timeout: 5000 }).catch(() => {});
            await this.page.waitForTimeout(3000);
        }
        await this.timestampColumnMenu.waitFor({ state: 'visible', timeout: 20000 });
        await this.timestampColumnMenu.click();
    }

    async navigateToPipeline() {
        await openNavFlyoutChild(this.page, 'pipeline');
    }

    async setupContainerNameCondition() {
        // Use drag and drop approach for condition node
        await this.selectAndDragCondition();
        await this.page.waitForTimeout(1000);

        // FilterGroup UI: open the column OSelect via its `-trigger`, type into the
        // `-search` filter, and pick the auto-derived `-option` with data-test-value.
        if (await this.columnSelectTrigger.count() > 0) {
            await this.columnSelectTrigger.first().click();
        } else {
            await this.columnSelect.first().click();
        }
        await this.columnSelectPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        if (await this.columnSelectSearch.count() > 0) {
            await this.columnSelectSearch.first().fill('container_name');
        }
        await this.columnOptionByName('kubernetes_container_name').waitFor({ state: 'visible', timeout: 10000 });
        await this.columnOptionByName('kubernetes_container_name').click();

        // Click operator select via its trigger and choose Contains via option locator.
        if (await this.operatorSelectTrigger.count() > 0) {
            await this.operatorSelectTrigger.first().click();
        } else {
            await this.operatorSelect.first().click();
        }
        await this.operatorSelectPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await this.page.locator('[data-test="alert-conditions-operator-select-option"][data-test-value="Contains"]')
            .first().click();

        // Fill value via OInput `-field` inner native input (the wrapper is a div).
        await this.valueInputField.first().click();
        await this.valueInputField.first().fill('ziox');

        await this.saveCondition();
        await this.page.waitForTimeout(2000);
    }

    async setupDestinationStream(dynamicDestinationName) {
        // Use drag and drop approach instead of icon click
        await this.selectAndDragSecondStream();
        // Open the stream-name OSelect via its trigger and fill the `-search` input.
        await this.fillDestinationStreamName(dynamicDestinationName);
        await this.clickInputNodeStreamSave();
        
        // Wait for dialog to close and add edge connections
        await this.page.waitForTimeout(2000);
        await this.page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' });
        await this.page.waitForSelector('[data-test="pipeline-node-default-input-handle"]', { state: 'visible' });
        await this.page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' });
        
        // Ensure no dialogs are blocking the interaction
        await this.page.waitForSelector('[role="dialog"]:not(:visible)', { state: 'hidden', timeout: 3000 }).catch(() => {
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
        let saved = false;
        await Promise.race([
            this.pipelineSavedMessage.waitFor({ state: 'visible', timeout: 15000 })
                .then(() => { saved = true; })
                .catch(() => null),
            this.page.waitForURL(/\/pipeline\/pipelines(\?|$)/, { timeout: 15000 })
                .then(() => { saved = true; })
                .catch(() => null),
        ]);
        expect(saved, 'Pipeline save timed out — neither success toast nor URL transition to /pipeline/pipelines was observed within 15 s').toBe(true);
    }

    async exploreStreamAndNavigateToPipeline(streamName) {
        // Ingestion for the specific stream
        const orgId = process.env["ORGNAME"];
        const headers = getAuthHeaders();

        const baseUrl = (process.env.INGESTION_URL || '').replace(/\/$/, '');
        const url = `${baseUrl}/api/${orgId}/${streamName}/_json`;
        const fetchResponse = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(require('../../../test-data/logs_data.json'))
        });
        if (!fetchResponse.ok) {
            throw new Error(`Ingestion failed for stream ${streamName}: ${fetchResponse.status} ${fetchResponse.statusText}`);
        }
        testLogger.info('Stream ingestion response', { streamName, status: fetchResponse.status });
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
        await this.selectStreamOptionByName(sourceStream);
        await this.saveInputNodeStream();
        // Delete auto-created output stream node
        await this.pipelineNodeOutputStreamNode.first().waitFor({ state: 'visible' });
        await this.pipelineNodeOutputStreamNode.first().hover();
        await this.pipelineNodeOutputDeleteBtn.first().waitFor({ state: 'visible' });
        await this.pipelineNodeOutputDeleteBtn.first().click();
        await this.confirmDeleteButton.click();
    }

    async createAndVerifyPipeline(expectedStreamName, sourceStream) {
        const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
        await this.enterPipelineName(pipelineName);
        await this.savePipeline();
        await this.waitForPipelineSaved();

        // Verify the dynamic destination stream exists. This navigates via
        // Streams → Explore → Pipelines, so we need to wait for the pipelines
        // list API to return at least once before our search has any data to
        // filter against.
        const listApiResponse = this.page.waitForResponse(
            (resp) => /\/api\/[^/]+\/pipelines(\?|$)/.test(resp.url()) && resp.request().method() === 'GET' && resp.status() === 200,
            { timeout: 20000 }
        ).catch(() => null);
        await this.exploreStreamAndNavigateToPipeline(expectedStreamName);
        await listApiResponse;

        await this.waitForPipelineListSettled();

        // Verify pipeline creation and cleanup
        await this.searchPipeline(pipelineName);
        await this.page.waitForTimeout(1000);

        // Delete is inside the more-options dropdown (not inline in the row).
        // Use the edit button as the visibility sentinel since it is always inline.
        const editBtn = this.page.locator(`[data-test="pipeline-list-${pipelineName}-update-pipeline"]`);
        const found = await editBtn.isVisible({ timeout: 15000 }).catch(() => false);
        if (!found) {
            testLogger.info(`createAndVerifyPipeline: pipeline ${pipelineName} not in list, polling with reload`);
            await expect.poll(async () => {
                const reloadApi = this.page.waitForResponse(
                    (resp) => /\/api\/[^/]+\/pipelines(\?|$)/.test(resp.url()) && resp.request().method() === 'GET' && resp.status() === 200,
                    { timeout: 20000 }
                ).catch(() => null);
                await this.page.reload().catch(() => {});
                await reloadApi;
                const allTab = this.page.locator('[data-test="tab-all"]');
                if (await allTab.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await allTab.click().catch(() => {});
                }
                await this.waitForPipelineListSettled(15000);
                await this.pipelineSearchInputField.waitFor({ state: 'visible', timeout: 10000 });
                await this.pipelineSearchInputField.fill('');
                await this.searchPipeline(pipelineName);
                return await editBtn.isVisible({ timeout: 2000 }).catch(() => false);
            }, {
                intervals: [2000, 3000, 5000, 5000, 10000, 10000, 15000],
                timeout: 180000,
            }).toBe(true);
        }
        await this.openMoreOptionsAndClickDelete(pipelineName);
        await this.confirmDeletePipeline();
        await this.verifyPipelineDeleted();
    }

    /**
     * Wait for the pipeline-list table to reach a settled state — either
     * at least one pipeline row has rendered, or the empty-state (no-data-
     * message) has appeared. This avoids the read-after-write race where
     * the test races the GET /api/<org>/pipelines response and filters an
     * unloaded table to zero rows, hiding the freshly-created pipeline.
     *
     * Gates on three orthogonal signals so we are robust to any one of them
     * being temporarily missing (skeleton mid-flight, virtualised row not
     * yet stamped with a delete-btn data-test, etc.):
     *   - a row with a `-delete-pipeline` data-test, OR
     *   - the empty-state `no-data-message`, OR
     *   - the OTable pagination footer "Showing X - Y" / "No data available"
     *     (matches the reportsPage settle pattern that proved stable in CI).
     */
    async waitForPipelineListSettled(timeout = 30000) {
        await this.page.waitForFunction(() => {
            const table = document.querySelector('[data-test="pipeline-list-table"]');
            if (!table) return false;
            // Use the edit button (always inline in the row) as the settled signal.
            // Delete moved into the more-options dropdown and is not in the DOM until opened.
            const hasRow = !!table.querySelector('[data-test^="pipeline-list-"][data-test$="-update-pipeline"]');
            const hasEmpty = !!table.querySelector('[data-test="no-data-message"]');
            const text = table.textContent || '';
            const hasFooter = /Showing \d+ - \d+/.test(text) || text.includes('No data available');
            return hasRow || hasEmpty || hasFooter;
        }, { timeout }).catch(() => {});
    }

    /**
     * Return a locator for the per-row delete action. Delete lives inside the
     * more-options dropdown — callers must open that menu before this locator
     * is visible.
     * @param {string} pipelineName - Pipeline name
     * @returns {import('@playwright/test').Locator}
     */
    pipelineDeleteBtn(pipelineName) {
        return this.page.locator(
            `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
        );
    }

    /**
     * Open the more-options dropdown for a pipeline row, then click Delete and
     * wait for the confirmation dialog.
     * @param {string} pipelineName - Pipeline name
     */
    async openMoreOptionsAndClickDelete(pipelineName) {
        const moreOptions = this.page.locator(
            `[data-test="pipeline-list-${pipelineName}-more-options"]`
        );
        await moreOptions.waitFor({ state: 'visible', timeout: 15000 });
        await moreOptions.click();
        const deleteItem = this.pipelineDeleteBtn(pipelineName);
        await deleteItem.waitFor({ state: 'visible', timeout: 5000 });
        await deleteItem.click();
    }

    // ========== Condition-specific methods ==========

    async fillCondition(columnName, operator, value, index = 0) {
        // Post-OSelect migration: open the column OSelect via its `-trigger` (the
        // PopoverTrigger button), narrow the virtualised list via the `-search`
        // input, and pick the `-option` whose `data-test-value` matches columnName.
        const triggers = this.columnSelectTrigger;
        const wrappers = this.columnSelect;
        const trigCount = await triggers.count();
        if (trigCount > 0) {
            await triggers.nth(index).click();
        } else {
            await wrappers.nth(index).click();
        }
        await this.columnSelectPopover.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        const searchCount = await this.columnSelectSearch.count();
        if (searchCount > 0) {
            await this.columnSelectSearch.first().fill(columnName);
        }
        await this.columnOptionByName(columnName).waitFor({ state: 'visible', timeout: 10000 });
        await this.columnOptionByName(columnName).click();
        await this.page.waitForTimeout(300);

        // Operator OSelect — same pattern.
        const opTriggers = this.operatorSelectTrigger;
        const opTrigCount = await opTriggers.count();
        if (opTrigCount > 0) {
            await opTriggers.nth(index).click();
        } else {
            await this.operatorSelect.nth(index).click();
        }
        await this.operatorSelectPopover.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await this.page.locator(
            `[data-test="alert-conditions-operator-select-option"][data-test-value="${operator}"]`,
        ).first().click();
        await this.page.waitForTimeout(300);

        // Fill value via OInput `-field` inner native input.
        await this.valueInputField.nth(index).click();
        await this.valueInputField.nth(index).fill(value);
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
        await this.selectStreamOptionByName(streamName);
        await this.saveInputNodeStream();

        // Remove default output stream node
        await this.pipelineNodeOutputStreamNode.first().waitFor({ state: 'visible' });
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

        // Add destination stream — use the open-popover-then-fill helper.
        await this.selectAndDragSecondStream();
        await this.fillDestinationStreamName("destination-node");
        await this.clickInputNodeStreamSave();

        await this.page.waitForTimeout(2000);
        await this.page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible', timeout: 10000 });
        await this.page.waitForSelector('[data-test="pipeline-node-default-input-handle"]', { state: 'visible', timeout: 10000 });
        await this.page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible', timeout: 10000 });

        await this.page.waitForSelector('[role="dialog"]:not(:visible)', { state: 'hidden', timeout: 3000 }).catch(() => {});

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
        // Use the edit button (always inline) as the row-visibility sentinel.
        // Delete is inside the more-options dropdown and is not in the DOM until opened.
        const editBtn = this.page.locator(`[data-test="pipeline-list-${pipelineName}-update-pipeline"]`);

        // Apply the search filter up front so the initial visibility check works
        // even when the unfiltered list spans many pipelines and the target row
        // is off-screen or on a virtual page.
        await this.pipelineSearchInputField.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        await this.pipelineSearchInputField.fill('').catch(() => {});
        await this.searchPipeline(pipelineName);

        // First quick check — when the row is already in the list we skip
        // the heavier poll-with-reload loop below entirely.
        const initialVisible = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
        if (!initialVisible) {
            // Per-pipeline propagation in CI can be slow (cross-cluster, search
            // re-index, etc.). Match the reportsPage.pauseReport budget (180s,
            // escalating intervals) instead of a 3-attempt cap that timed out.
            testLogger.info(`deletePipelineByName: pipeline ${pipelineName} not visible, polling list with reload`);
            await expect.poll(async () => {
                const apiPromise = this.page.waitForResponse(
                    (resp) => /\/api\/[^/]+\/pipelines(\?|$)/.test(resp.url()) && resp.request().method() === 'GET' && resp.status() === 200,
                    { timeout: 15000 }
                ).catch(() => null);
                await this.page.reload().catch(() => {});
                await apiPromise;

                // Ensure we're on the "all" tab so realtime + scheduled pipelines
                // are both visible regardless of any previous tab selection.
                const allTab = this.page.locator('[data-test="tab-all"]');
                if (await allTab.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await allTab.click().catch(() => {});
                }

                // Wait for at least one pipeline row so we know the table rendered
                // its data — search against an empty table never surfaces our row.
                const anyRow = this.page.locator('[data-test^="pipeline-list-"][data-test$="-update-pipeline"]').first();
                await anyRow.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

                // Clear and re-fill the search filter.
                await this.pipelineSearchInputField.waitFor({ state: 'visible', timeout: 10000 });
                await this.pipelineSearchInputField.fill('');
                // Wait for full list to restore after clearing the filter
                await anyRow.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                await this.searchPipeline(pipelineName);

                return await editBtn.isVisible({ timeout: 2000 }).catch(() => false);
            }, {
                intervals: [2000, 3000, 5000, 5000, 10000, 10000, 15000],
                timeout: 180000,
            }).toBe(true);
        }
        await this.openMoreOptionsAndClickDelete(pipelineName);
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
        // Saving without a valid condition surfaces the OForm schema error inline
        // (`data-test="add-condition-error"`), not a `[role="alert"]` notification.
        // The old `[role="alert"]` locator now matches Monaco's hidden a11y alert
        // (`class="monaco-alert" data-aria-hidden="true"`), so assert the real error.
        await this.conditionRequiredToast.first().waitFor({ state: 'visible', timeout: 10000 });
    }

    async fillPartialCondition(columnName) {
        // OSelect: click trigger to open, then type in the search input
        await this.columnSelectTrigger.first().click();
        await this.columnSelectSearch.waitFor({ state: 'visible' });
        await this.columnSelectSearch.fill(columnName);
        await this.columnSelectFirstOption.waitFor({ state: 'visible' });
        await this.columnSelectFirstOption.click();
        // Wait specifically for the column popover to detach (named popover only —
        // do NOT press Escape, which would close the topmost dismissable layer
        // (the conditions dialog itself, making the operator trigger disappear).
        await this.page.locator('[data-test="alert-conditions-select-column-popover"]')
            .waitFor({ state: 'hidden', timeout: 5000 })
            .catch(() => {});
    }

    async selectOperatorFromMenu(operator) {
        // Defensive: wait for the operator trigger to be in the DOM (the conditions
        // form may still be settling after the column was filled).
        await this.operatorSelectTrigger.first().waitFor({ state: 'visible', timeout: 15000 });
        await this.operatorSelectTrigger.first().click();
        const option = this.page.locator(`[data-test="alert-conditions-operator-select-option"][data-test-value="${operator}"]`).first();
        await option.waitFor({ state: 'visible' });
        await option.click();
        // Wait for the operator popover specifically (not via Escape, which would
        // close the conditions dialog).
        await this.page.locator('[data-test="alert-conditions-operator-select-popover"]')
            .waitFor({ state: 'hidden', timeout: 5000 })
            .catch(() => {});
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
            if (process.env.IS_CLOUD === 'true') {
                // Cloud: use browser context (sends OIDC session cookies)
                const result = await this.page.evaluate(async ({ orgId, payload }) => {
                    const r = await fetch(`/api/${orgId}/pipelines`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const data = await r.json();
                    return { status: r.status, data };
                }, { orgId, payload: pipelinePayload });

                if (result.status === 200 && result.data.code === 200) {
                    testLogger.info('Pipeline created successfully', { pipelineName });
                } else {
                    testLogger.warn('Pipeline creation returned non-200', { pipelineName, status: result.status, data: result.data });
                }
                return result;
            }

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
        await openNavFlyoutChild(this.page, 'pipeline');
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
        const headers = getAuthHeaders();
        const baseUrl = (process.env.INGESTION_URL || '').replace(/\/$/, '');

        for (const streamName of streamNames) {
            const url = `${baseUrl}/api/${orgId}/${streamName}/_json`;
            const fetchResponse = await fetchWithRetry(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(data)
            });
            if (!fetchResponse.ok) {
                throw new Error(`Bulk ingestion failed for stream ${streamName}: ${fetchResponse.status} ${fetchResponse.statusText}`);
            }
            const response = await fetchResponse.json();
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
        const headers = getAuthHeaders();

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

        const baseUrl = (process.env.INGESTION_URL || '').replace(/\/$/, '');
        const url = `${baseUrl}/api/${orgId}/ingest/metrics/_json`;
        const fetchResponse = await fetchWithRetry(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(metricsData)
        });
        if (!fetchResponse.ok) {
            throw new Error(`Metrics ingestion failed for ${streamName}: ${fetchResponse.status} ${fetchResponse.statusText}`);
        }
        const response = {
            status: fetchResponse.status,
            data: await fetchResponse.json()
        };

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
        const authHeaders = getAuthHeaders();

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

        const baseUrl = (process.env.INGESTION_URL || '').replace(/\/$/, '');
        const requestHeaders = { ...authHeaders };
        if (streamName) {
            requestHeaders["stream-name"] = streamName;
        }
        const fetchResponse = await fetchWithRetry(`${baseUrl}/api/${orgId}/v1/traces`, {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify(tracesData)
        });
        if (!fetchResponse.ok) {
            throw new Error(`Traces ingestion failed for ${serviceName}: ${fetchResponse.status} ${fetchResponse.statusText}`);
        }
        const response = {
            status: fetchResponse.status,
            data: await fetchResponse.json().catch(() => ({}))
        };

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
        await this.page.waitForSelector('[role="dialog"]:not(:visible)', { state: 'hidden', timeout: 3000 }).catch(() => {});

        // Give VueFlow time to finish laying out nodes after any preceding form close
        await this.page.waitForTimeout(2000);

        await this.pipelineNodeInputOutputHandle.hover({ force: true });
        await this.page.mouse.down();
        await this.pipelineNodeOutputInputHandle.hover({ force: true });
        await this.page.mouse.up();
        await this.page.waitForTimeout(1000);

        // Verify edge was created; retry once if not
        const edgeCount = await this.page.locator('.vue-flow__edge').count();
        if (edgeCount < 1) {
            testLogger.info('connectInputToOutput: no edge after first attempt, retrying');
            await this.page.keyboard.press('Escape');
            await this.page.waitForTimeout(500);
            await this.pipelineNodeInputOutputHandle.hover({ force: true });
            await this.page.mouse.down();
            await this.pipelineNodeOutputInputHandle.hover({ force: true });
            await this.page.mouse.up();
            await this.page.waitForTimeout(1000);
        }
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
        await this.page.waitForSelector('[role="dialog"]:not(:visible)', { state: 'hidden', timeout: 3000 }).catch(() => {});

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
        // The stream-name OSelect (searchable=true, creatable for output nodes)
        // renders the `-search` input only when its popover is open. Click the
        // wrapper trigger first to open it, then fill the search input. After
        // typing, the matching option (existing or created) must be clicked or
        // committed via Enter to register the model value.
        const wrapper = this.page.locator('[data-test="input-node-stream-name-select"]').first();
        const trigger = this.page.locator('[data-test="input-node-stream-name-select-trigger"]').first();
        const popover = this.page.locator('[data-test="input-node-stream-name-select-popover"]').first();
        const searchOpen = await this.streamNameInput.isVisible().catch(() => false);
        if (!searchOpen) {
            if (await trigger.count() > 0) {
                await trigger.waitFor({ state: 'visible', timeout: 15000 });
                await trigger.click();
            } else {
                await wrapper.waitFor({ state: 'visible', timeout: 15000 });
                await wrapper.click();
            }
            await this.streamNameInput.waitFor({ state: 'visible', timeout: 10000 });
        }
        await this.streamNameInput.click();
        await this.streamNameInput.fill(streamName);
        // Try matching option first; if none, the creatable OSelect commits via Enter.
        const matchingOption = this.page.locator(
            `[data-test="input-node-stream-name-select-option"][data-test-value="${streamName}"]`,
        ).first();
        const optionVisible = await matchingOption.isVisible({ timeout: 2000 }).catch(() => false);
        if (optionVisible) {
            await matchingOption.click();
        } else {
            await this.streamNameInput.press('Enter');
        }
        // Wait for the popover to close if it was dismissed by an option click.
        // For newly created names (Enter path), the popover stays open; the save
        // button click will close it via interactOutside — do NOT press Escape
        // here, as that would also trigger the ODrawer's escape handler and
        // prematurely close the drawer.
        await popover.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    }

    /**
     * Fill condition fields for FilterGroup UI
     * @param {string} columnName - Column name to search for
     * @param {string} columnOption - The option text to select
     * @param {string} operator - Operator text (e.g., "Contains")
     * @param {string} value - Value to filter by
     */
    async fillConditionFields(columnName, columnOption, operator, value) {
        // Open column OSelect via its `-trigger` and pick the option whose
        // `data-test-value` matches `columnOption`. Filter the virtualised list
        // by typing into the `-search` input first when present.
        if (await this.columnSelectTrigger.count() > 0) {
            await this.columnSelectTrigger.first().click();
        } else {
            await this.columnSelect.first().click();
        }
        await this.columnSelectPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        if (await this.columnSelectSearch.count() > 0) {
            await this.columnSelectSearch.first().fill(columnName);
        }
        await this.columnOptionByName(columnOption).waitFor({ state: 'visible', timeout: 10000 });
        await this.columnOptionByName(columnOption).click();

        // Operator OSelect — open via `-trigger`, pick by `-option` data-test-value.
        if (await this.operatorSelectTrigger.count() > 0) {
            await this.operatorSelectTrigger.first().click();
        } else {
            await this.operatorSelect.first().click();
        }
        await this.operatorSelectPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await this.page.locator(
            `[data-test="alert-conditions-operator-select-option"][data-test-value="${operator}"]`,
        ).first().click();

        // Fill value via OInput `-field` inner native input.
        await this.valueInputField.first().click();
        await this.valueInputField.first().fill(value);
    }

    /**
     * Select a stream option by name
     * @param {string} streamName - Exact name of the stream option to select
     */
    async selectStreamOption(streamName) {
        // When no name is supplied, fall back to the default e2e_automate
        // option locator stored on the PO (legacy spec calls used no-arg).
        if (!streamName) {
            await this.e2eAutomateOption.waitFor({ state: 'visible', timeout: 15000 });
            await this.e2eAutomateOption.click();
            return;
        }
        // OSelect now forwards parent data-test to ListboxItems
        // (`<parent>-option`) and stamps a per-value `data-test-value`. Match
        // by value to avoid the substring match that an earlier hasText
        // approach used (which collided with overlapping prefixes like
        // `e2e_automate` vs `e2e_automate3`).
        const option = this.page
            .locator(`[data-test$="-option"][data-test-value="${streamName}"]`)
            .first();
        await option.waitFor({ state: 'visible', timeout: 15000 });
        // Wait for the option to be enabled (not disabled) before clicking —
        // pipeline source streams that are already in use are rendered
        // disabled.
        await this.page.waitForFunction(
            (name) => {
                const opt = document.querySelector(
                    `[data-test$="-option"][data-test-value="${name}"]`,
                );
                return !!opt && opt.getAttribute('aria-disabled') !== 'true';
            },
            streamName,
            { timeout: 10000 },
        ).catch(() => {
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
        // Open the scheduled-pipeline stream-type OSelect via its `-trigger`
        // (PopoverTrigger button); fall back to the wrapper for backwards compat.
        if (await this.streamTypeDropdownTrigger.count() > 0) {
            await this.streamTypeDropdownTrigger.first().click();
        } else {
            await this.streamTypeDropdown.first().click();
        }
        await this.streamTypeDropdownPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
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
    async waitForQueryNodeVisible(timeout = 45000) {
        // 45s (was 30s): under sustained full-shard load the query node's canvas render
        // lags past 30s after saveQuery (pipelines:180 hard-failed on cloud but passes
        // solo — a heavy-load render lag, not a missing node). Matches the CI actionTimeout.
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
        await this.connectAllNodesError.waitFor({ state: 'visible', timeout: 10000 });
    }

    /**
     * Wait for pipeline handles to be visible with error handling
     */
    async waitForPipelineHandles() {
        await this.page.waitForTimeout(2000);
        await this.page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' }).catch(() => {});
        await this.page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' }).catch(() => {});
        await this.page.waitForSelector('[role="dialog"]:not(:visible)', { state: 'hidden', timeout: 3000 }).catch(() => {});
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
        // Open via the OSelect trigger (data-test) added on ScheduledPipeline.vue
        // and pick the option with the matching `data-test-value`.
        if (await this.streamTypeDropdownTrigger.count() > 0) {
            await this.streamTypeDropdownTrigger.first().click();
        } else {
            await this.streamTypeDropdown.first().click();
        }
        await this.streamTypeDropdownPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await this.page.locator(
            `[data-test="scheduled-pipeline-stream-type-select-option"][data-test-value="${type}"]`,
        ).first().click();
        testLogger.info(`Stream type '${type}' selected`);
    }

    /**
     * Select stream name from dropdown
     * @param {string} streamName - Stream name to select
     * Drives the scheduled-pipeline stream-name OSelect via its auto-derived
     * `-trigger` / `-search` / `-option` data-tests (popover-search pattern).
     */
    async selectStreamName(streamName) {
        testLogger.info(`Selecting stream: ${streamName}`);
        // Two pipeline forms expose a stream-name OSelect with different data-tests:
        //   - ScheduledPipeline.vue → "scheduled-pipeline-stream-name-select*"
        //   - Stream.vue (input/realtime/metrics/traces) → "input-node-stream-name-select*"
        // Detect which form is currently open and route accordingly.
        const scheduledTrigger = this.scheduledStreamNameSelectTrigger;
        const inputNodeWrapper = this.page.locator('[data-test="input-node-stream-name-select"]').first();

        const scheduledVisible = await scheduledTrigger.isVisible().catch(() => false);
        if (scheduledVisible) {
            await scheduledTrigger.click();
            await this.scheduledStreamNameSelectPopover.waitFor({ state: 'visible', timeout: 10000 });
            await this.scheduledStreamNameSelectSearch.waitFor({ state: 'visible', timeout: 10000 });
            await this.scheduledStreamNameSelectSearch.fill(streamName);
            const option = this.scheduledStreamNameOptionByValue(streamName);
            await option.waitFor({ state: 'visible', timeout: 10000 });
            await option.click();
        } else {
            // input-node form path — open popover by clicking wrapper, fill search,
            // click value-matched option, then ensure popper closes (defends against
            // the next Save click being intercepted by virtual-list row).
            await inputNodeWrapper.waitFor({ state: 'visible', timeout: 15000 });
            await this.enterStreamName(streamName);
            await this.selectStreamOptionByName(streamName);
        }
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
        const preview = this.page.locator('[role="tooltip"], [role="menu"], .preview-popup, [class*="preview"], [class*="tooltip"]').first();
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
        const dialog = this.page.locator('[data-test*="dialog"]');
        return await dialog.isVisible().catch(() => false);
    }

    /**
     * Test pause toggle functionality
     * Bug #10029 - Pause/unpause
     */
    async testPauseToggle(rowIndex) {
        const pipelineRows = this.page.locator('[data-test*="pipeline-row"], tr:has([data-test*="pipeline"])');
        const row = pipelineRows.nth(rowIndex);
        const pauseToggle = row.locator('[data-test*="pause"], [data-test*="toggle"]').first();

        if (await pauseToggle.isVisible().catch(() => false)) {
            const initialState = await pauseToggle.getAttribute('aria-pressed').catch(() => 'unknown');
            await pauseToggle.click();
            await this.page.waitForTimeout(1000);

            // Handle confirmation dialog if it appears
            const confirmDialog = this.page.locator('[data-test*="confirm-dialog"], [data-test*="dialog"]');
            if (await confirmDialog.isVisible().catch(() => false)) {
                const confirmBtn = this.page.locator('[data-test="o-dialog-primary-btn"]').first();
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
     * Resolves via the row's update-pipeline button (per-row data-test), then
     * walks up to the nearest table-row container via XPath ancestor with a
     * `data-test` prefix — keeps the selector data-test-only (§2).
     * @param {string} pipelineName - Pipeline name
     * @returns {import('@playwright/test').Locator} Pipeline row locator
     */
    getPipelineRowByName(pipelineName) {
        return this.page
            .locator(`[data-test="pipeline-list-${pipelineName}-update-pipeline"]`)
            .locator(`xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]`)
            .first();
    }

    /**
     * Get pipeline toggle (pause/start) locator for a specific pipeline.
     * The pause/start OButton is rendered directly in the row (first action button)
     * and is always visible — no dropdown needed.
     * @param {string} pipelineName - Pipeline name
     * @returns {import('@playwright/test').Locator} Toggle locator
     */
    getPipelineToggle(pipelineName) {
        return this.page.locator(
            `[data-test="pipeline-list-${pipelineName}-pause-start-action"]`
        );
    }

    /**
     * Alias for getPipelineToggle — pause/start OButton is inline in the row.
     * @param {string} pipelineName - Pipeline name
     * @returns {import('@playwright/test').Locator} Enable/disable button locator
     */
    getPipelineEnableDisableButton(pipelineName) {
        return this.page.locator(
            `[data-test="pipeline-list-${pipelineName}-pause-start-action"]`
        );
    }

    /**
     * Return the pause/start toggle locator after waiting for it to be visible.
     * No dropdown needs to be opened — the button is always inline in the row.
     * @param {string} pipelineName - Pipeline name
     * @returns {Promise<import('@playwright/test').Locator>} Locator for the pause/start button
     */
    async openPipelineRowMenuAndGetToggle(pipelineName) {
        const toggle = this.getPipelineToggle(pipelineName);
        await toggle.waitFor({ state: 'visible', timeout: 15000 });
        return toggle;
    }

    /**
     * Toggle pipeline enabled/disabled state via the inline pause/start button.
     * @param {string} pipelineName - Pipeline name
     */
    async togglePipeline(pipelineName) {
        const toggle = this.getPipelineToggle(pipelineName);
        await toggle.waitFor({ state: 'visible', timeout: 15000 });
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
        await this.page.waitForLoadState('networkidle').catch(() => {});
        // Wait for the Teleport target AND the page content to fully mount.
        // BackfillJobsList renders both the teleported filters (#o2-page-actions)
        // and the main page wrapper. Waiting for the page wrapper ensures the
        // component is fully mounted before we check for teleported elements.
        await this.page.locator('[data-test="pipeline-detail-actions"]').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
        await this.page.locator('[data-test="backfill-jobs-list-page"]').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
        // Give Vue time to complete the Teleport render cycle
        await this.page.waitForTimeout(500);
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
        const filterLocator = this.page.locator('[data-test="status-filter"]').first();
        return await filterLocator.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    }

    /**
     * Check if pipeline filter is visible on backfill page
     * @returns {Promise<boolean>} True if filter is visible
     */
    async isPipelineFilterVisible() {
        const filterLocator = this.page.locator('[data-test="pipeline-filter"]').first();
        return await filterLocator.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    }

    /**
     * Check if backfill table is visible
     * @returns {Promise<boolean>} True if table is visible
     */
    async isBackfillTableVisible() {
        const tableLocator = this.page.locator('[data-test*="backfill-table"], table').first();
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
        const backButton = this.page.locator('[data-test*="back"], button:has-text("Back")').first();
        if (await backButton.isVisible().catch(() => false)) {
            await backButton.click();
        } else {
            await this.page.goBack();
        }
        await this.page.waitForLoadState('networkidle').catch(() => {});
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
        const progressLocator = this.page.locator('[data-test*="progress"], progress').first();
        return await progressLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if action buttons are visible for jobs
     * @returns {Promise<boolean>} True if action buttons are visible
     */
    async areActionButtonsVisible() {
        const actionLocator = this.page.locator('[data-test*="action"], button.action, button[data-o2-btn]').first();
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
        await this.page.waitForLoadState('networkidle').catch(() => {});
        // Wait for the shell header (#o2-page-actions Teleport target) and the
        // page container to mount, then wait for the first Teleported control
        // to be visible — that confirms the defer Teleport cycle is complete.
        await this.page.locator('[data-test="pipeline-detail-actions"]').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
        await this.page.locator('[data-test="pipeline-history-page"]').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
        await this.page.locator('[data-test="pipeline-history-refresh-btn"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
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
        const tableLocator = this.page.locator('[data-test*="history-table"], table').first();
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
        const backButton = this.page.locator('[data-test*="back"], button:has-text("Back")').first();
        if (await backButton.isVisible().catch(() => false)) {
            await backButton.click();
        } else {
            await this.page.goBack();
        }
        await this.page.waitForLoadState('networkidle').catch(() => {});
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

    /** @returns {import('@playwright/test').Locator} Status badges in pipeline-history table */
    get statusBadges() {
        // PipelineHistory.vue stamps `data-test="pipeline-history-status-badge"`
        // on every row's OBadge (plus a per-row `data-test-status` value).
        return this.page.locator('[data-test="pipeline-history-status-badge"]');
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
        const clearBtn = this.page.locator('[data-test="clear-filters-btn"]').first();
        return await clearBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
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
        const refreshBtn = this.page.locator('[data-test="refresh-btn"]').first();
        return await refreshBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
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
        const tableLocator = this.page.locator('[data-test*="backfill-table"], [data-test*="jobs-table"], table').first();
        return await tableLocator.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if generic table is visible (fallback)
     * @returns {Promise<boolean>} True if any table is visible
     */
    async isGenericTableVisible() {
        // TODO(data-test): backfill/jobs/generic tables don't yet expose a data-test
        // root in their source components — keeping native <table> fallback
        // until added in web/src/components/pipeline/ and shared table components.
        const tableLocator = this.page.locator('table').first();
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
        const pipelineFilter = this.page.locator('[data-test*="pipeline-filter"], [data-test*="pipeline-select"]').first();
        if (await pipelineFilter.isVisible().catch(() => false)) {
            await pipelineFilter.click();
            await this.page.waitForTimeout(500);
            // Select first available option
            const option = this.page.locator('[role="option"]').first();
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
        const progressBars = await this.page.locator('[data-test*="progress"], progress').all();
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
        const buttons = await this.page.locator('table button').all();
        return buttons.length;
    }

    /**
     * Get count of jobs with specific status
     * @param {string} status - Status to count (e.g., 'Completed', 'Running', 'Failed')
     * @returns {Promise<number>} Count of jobs with status
     */
    async getJobStatusCount(status) {
        const statusElements = await this.page.locator(`[data-test*="status"]:has-text("${status}"), [data-test*="badge"]:has-text("${status}"), .status-badge:has-text("${status}")`).all();
        return statusElements.length;
    }

    /**
     * Get count of error indicators
     * @returns {Promise<number>} Count of error indicators
     */
    async getErrorIndicatorCount() {
        // Backfill rows render `data-test="error-indicator-btn"` per failed row.
        return await this.backfillErrorIndicatorBtn.count();
    }

    /**
     * Click first error indicator
     */
    async clickFirstErrorIndicator() {
        const errorIndicator = this.backfillErrorIndicatorBtn.first();
        if (await errorIndicator.isVisible().catch(() => false)) {
            await errorIndicator.click();
            await this.backfillErrorDialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
            testLogger.info('Clicked first error indicator');
        }
    }

    /**
     * Check if error dialog is visible
     * @returns {Promise<boolean>} True if dialog is visible
     */
    async isErrorDialogVisible() {
        return await this.backfillErrorDialog.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Close error dialog
     */
    async closeErrorDialog() {
        // BackfillJobsList wires the dialog's primary button to close. The
        // o-dialog-primary-btn lives inside the dialog data-test wrapper.
        const closeBtn = this.backfillErrorDialog.locator('[data-test="o-dialog-primary-btn"]').first();
        if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click();
            await this.backfillErrorDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
        const datePicker = this.page.locator('[data-test="pipeline-history-date-picker"]').first();
        return await datePicker.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    }

    /**
     * Check if history search select is visible
     * @returns {Promise<boolean>} True if search select is visible
     */
    async isHistorySearchSelectVisible() {
        const searchSelect = this.page.locator('[data-test="pipeline-history-search-select"]').first();
        return await searchSelect.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    }

    /**
     * Check if history manual search button is visible
     * @returns {Promise<boolean>} True if button is visible
     */
    async isHistoryManualSearchBtnVisible() {
        // The history page has no dedicated "Search/Run" button — the refresh
        // button (pipeline-history-refresh-btn) is the manual trigger to
        // re-fetch history after changing filters. Map the concept to that button.
        const refreshBtn = this.page.locator('[data-test="pipeline-history-refresh-btn"]').first();
        return await refreshBtn.isVisible({ timeout: 5000 }).catch(() => false);
    }

    /**
     * Check if history refresh button is visible
     * @returns {Promise<boolean>} True if button is visible
     */
    async isHistoryRefreshBtnVisible() {
        const refreshBtn = this.page.locator('[data-test="pipeline-history-refresh-btn"]').first();
        return await refreshBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    }

    /**
     * Click history back button
     */
    async clickHistoryBackBtn() {
        const backBtn = this.page.locator('[data-test*="back-btn"], [data-test*="back"], button:has-text("Back"), .back-btn').first();
        if (await backBtn.isVisible().catch(() => false)) {
            await backBtn.click();
            await this.page.waitForLoadState('networkidle').catch(() => {});
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
        const searchSelect = this.page.locator('[data-test="pipeline-history-search-select"]').first();
        if (await searchSelect.isVisible().catch(() => false)) {
            await searchSelect.click();
            // Wait for the OSelect popover to open
            await this.page.locator('[data-test="pipeline-history-search-select-popover"]')
                .waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
            testLogger.info('Clicked history search select');
        }
    }

    /**
     * Select first option in dropdown
     */
    async selectFirstOption() {
        // OSelect options are stamped with data-test="${parent}-option" per §4 conventions.
        const option = this.page.locator('[data-test="pipeline-history-search-select-option"]').first();
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
            await option.click();
            testLogger.info('Selected first option');
        }
    }

    /**
     * Click history manual search button
     */
    async clickHistoryManualSearchBtn() {
        // The history page has no dedicated search button — refresh re-fetches history.
        const refreshBtn = this.page.locator('[data-test="pipeline-history-refresh-btn"]').first();
        if (await refreshBtn.isVisible().catch(() => false)) {
            await refreshBtn.click();
            testLogger.info('Clicked history manual search button (refresh)');
        }
    }

    /**
     * Get status counts from history/backfill page
     * @returns {Promise<{success: number, error: number, warning: number}>} Status counts
     */
    async getStatusCounts() {
        // Each status badge stamps `data-test-status="<status>"` (lowercased).
        // Backend TriggerDataStatus enum (usage.rs) defines exactly four values:
        //   completed | failed | condition_not_satisfied | skipped
        // getStatusVariant() in PipelineHistory.vue maps them to badge variants.
        const successCount = await this.page.locator(
            '[data-test="pipeline-history-status-badge"][data-test-status="completed"], ' +
            '[data-test="pipeline-history-status-badge"][data-test-status="success"], ' +
            '[data-test="pipeline-history-status-badge"][data-test-status="ok"]'
        ).count();
        const errorCount = await this.page.locator(
            '[data-test="pipeline-history-status-badge"][data-test-status="failed"], ' +
            '[data-test="pipeline-history-status-badge"][data-test-status="error"]'
        ).count();
        const warningCount = await this.page.locator(
            '[data-test="pipeline-history-status-badge"][data-test-status="warning"]'
        ).count();
        const skippedCount = await this.page.locator(
            '[data-test="pipeline-history-status-badge"][data-test-status="condition_not_satisfied"], ' +
            '[data-test="pipeline-history-status-badge"][data-test-status="skipped"]'
        ).count();
        return {
            success: successCount,
            error: errorCount,
            warning: warningCount,
            skipped: skippedCount,
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
     * Use in afterEach cleanup instead of a raw dialog locator.
     */
    async dismissOpenDialogs() {
        try {
            if (await this.qDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
                await this.page.locator('body').click({ position: { x: 10, y: 10 } });
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
        // TODO(data-test): notification toasts and banners; using role="alert" which covers both Reka and legacy patterns.
        const errorToast = await this.page.locator('[role="alert"]').allTextContents().catch(() => []);
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

    // ========== Bug #11498: Run Query Disabled State ==========

    /**
     * Check if the Run Query button is disabled (no stream selected)
     * @returns {Promise<boolean>} True if button is disabled
     */
    async isRunQueryDisabled() {
        await this.runQueryButton.waitFor({ state: 'visible', timeout: 5000 });
        const isDisabled = await this.runQueryButton.isDisabled();
        testLogger.info(`Run Query disabled state: ${isDisabled}`);
        return isDisabled;
    }

    /**
     * Check if the Run Query button is enabled (stream selected)
     * @returns {Promise<boolean>} True if button is enabled
     */
    async isRunQueryEnabled() {
        await this.runQueryButton.waitFor({ state: 'visible', timeout: 5000 });
        const isDisabled = await this.runQueryButton.isDisabled();
        testLogger.info(`Run Query enabled state: ${!isDisabled}`);
        return !isDisabled;
    }

    /**
     * Expect Run Query button to be disabled
     */
    async expectRunQueryDisabled() {
        await this.runQueryButton.waitFor({ state: 'visible', timeout: 5000 });
        await expect(this.runQueryButton).toBeDisabled({ timeout: 3000 });
        testLogger.info('✅ Run Query button is disabled as expected');
    }

    /**
     * Expect Run Query button to be enabled
     */
    async expectRunQueryEnabled() {
        await this.runQueryButton.waitFor({ state: 'visible', timeout: 5000 });
        await expect(this.runQueryButton).toBeEnabled({ timeout: 3000 });
        testLogger.info('✅ Run Query button is enabled as expected');
    }

}

// Copyright 2026 OpenObserve Inc.

const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class AlertsFormValidationPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // ── Navigation ──────────────────────────────────────────────────────────
    this.settingsMenuItem = '[data-test="menu-link-\\/settings-item"]';
    this.destinationsTab  = '[data-test="alert-destinations-tab"]';
    this.templatesTab     = '[data-test="alert-templates-tab"]';

    // ── Destinations list ────────────────────────────────────────────────────
    this.addDestinationBtn = '[data-test="alert-destination-list-add-alert-btn"]';
    this.addDestinationTitle = '[data-test="add-destination-title"]';

    // ── Prebuilt destination selector ────────────────────────────────────────
    // The PrebuiltDestinationSelector renders one card per type. We click the
    // "Custom" card to enter the custom/webhook flow that exposes Name + URL.
    this.prebuiltDestinationSelector = '[data-test="prebuilt-destination-selector"]';
    // Generic "Custom" tile within the selector (text-based, kept as comment;
    // real interaction uses selectCustomDestinationType helper)

    // ── AddDestination — name field ──────────────────────────────────────────
    // OInput data-test="add-destination-name-input" generates:
    //   -field  → native <input> (fill)
    //   -error  → error message span
    this.destNameInputField = '[data-test="add-destination-name-input-field"]';
    this.destNameError      = '[data-test="add-destination-name-input-error"]';

    // ── AddDestination — template select (custom webhook) ───────────────────
    // OSelect data-test="add-destination-template-select" generates:
    //   -popover → dropdown panel
    //   -error   → error message span
    this.destTemplateSelectError = '[data-test="add-destination-template-select-error"]';

    // ── AddDestination — URL field ───────────────────────────────────────────
    // OInput data-test="add-destination-url-input" generates -field / -error
    this.destUrlInputField = '[data-test="add-destination-url-input-field"]';
    this.destUrlError      = '[data-test="add-destination-url-input-error"]';

    // ── AddDestination — action buttons ─────────────────────────────────────
    this.destSubmitBtn = '[data-test="add-destination-submit-btn"]';
    this.destCancelBtn = '[data-test="add-destination-cancel-btn"]';

    // ── AddDestination — tabs (custom type selection) ────────────────────────
    this.destTabsContainer = '[data-test="add-destination-tabs"]';

    // ── Prebuilt form — Slack webhook URL field ──────────────────────────────
    // OInput data-test="slack-webhook-url-input" generates -field / -error
    this.slackWebhookField = '[data-test="slack-webhook-url-input-field"]';
    this.slackWebhookError = '[data-test="slack-webhook-url-input-error"]';

    // ── Templates list ───────────────────────────────────────────────────────
    this.addTemplateBtn   = '[data-test="alert-template-list-add-template-btn"]';
    this.addTemplateTitle = '[data-test="add-template-title"]';

    // ── AddTemplate — name field ─────────────────────────────────────────────
    // OInput data-test="add-template-name-input" generates -field / -error
    this.templateNameInputField = '[data-test="add-template-name-input-field"]';
    this.templateNameError      = '[data-test="add-template-name-input-error"]';

    // ── AddTemplate — body editor (data-test on the wrapper div) ────────────
    this.templateBodyEditorTitle = '[data-test="add-template-body-input-title"]';
    this.templateBodyEditor      = '[data-test="template-body-editor"]';

    // ── AddTemplate — action buttons ─────────────────────────────────────────
    this.templateSubmitBtn = '[data-test="add-template-submit-btn"]';
    this.templateCancelBtn = '[data-test="add-template-cancel-btn"]';

    // ── ImportAlert ───────────────────────────────────────────────────────────
    // The Import button on the Alerts list page
    this.alertImportBtn         = '[data-test="alert-list-import-alert-btn"]';
    // BaseImport shared buttons (test-prefix="alert")
    this.alertImportJsonBtn     = '[data-test="alert-import-json-btn"]';
    this.alertImportJsonFileTab = '[data-test="tab-import_json_file"]';
    this.alertImportFileInput   = '[data-test="alert-import-json-file-input"]';

    // ── ImportDestination ─────────────────────────────────────────────────────
    // The Import button on the Destinations list page
    this.destinationImportBtn     = '[data-test="destination-import"]';
    // BaseImport shared buttons (test-prefix="destination")
    this.destImportJsonBtn        = '[data-test="destination-import-json-btn"]';
    this.destImportJsonFileTab    = '[data-test="tab-import_json_file"]';
    this.destImportFileInput      = '[data-test="destination-import-json-file-input"]';

    // ── Toast messages ────────────────────────────────────────────────────────
    this.toastError   = '[data-test-variant="error"]';
    this.toastSuccess = '[data-test-variant="success"]';
    this.toastMessage = '[data-test="o-toast-message"]';

    // ── Alert wizard — navigation ─────────────────────────────────────────────
    // Add Alert button on the Alerts list page
    this.alertListAddBtn = '[data-test="alert-list-add-alert-btn"]';
    // Wizard "Next" button (step 1 → step 2)
    this.alertWizardNextBtn = '[data-test="alert-wizard-next-btn"]';

    // ── AlertSettings (step 3 of alert wizard) ───────────────────────────────
    this.alertSettingsSilenceDuration = '[data-test="alert-settings-silence-duration-input-field"]';
    this.alertSettingsSilenceError    = '[data-test="alert-settings-silence-duration-input-error"]';
    this.alertDestinationsSelect      = '[data-test="alert-destinations-select-popover"]';
    this.alertRefreshDestinationsBtn  = '[data-test="alert-settings-refresh-destinations-btn"]';

    // ── QueryConfig (step 2 of alert wizard) ─────────────────────────────────
    this.queryModeCustomTab           = '[data-test="query-mode-custom"]';
    this.queryModeSqlTab              = '[data-test="query-mode-sql"]';
    this.queryModePromqlTab           = '[data-test="query-mode-promql"]';
    this.alertTriggerOperatorSelect   = '[data-test="alert-trigger-operator-select"]';
    this.alertTriggerThresholdInput   = '[data-test="alert-trigger-threshold-input-field"]';
    this.alertTriggerThresholdError   = '[data-test="alert-trigger-threshold-input-error"]';

    // ── Alert wizard step 1 stream selectors ─────────────────────────────────
    this.wizardStreamTypeDropdown     = '[data-test="add-alert-stream-type-select-dropdown"]';
    this.wizardStreamNameDropdown     = '[data-test="add-alert-stream-name-select-dropdown"]';

    // ── FilterCondition — condition row elements ──────────────────────────────
    // AND/OR toggle button
    this.filterConditionToggleOperatorBtn = '[data-test="alert-conditions-toggle-operator-btn"]';
    // Column selector: OSelect → open via -popover, error via -error
    this.filterConditionColumnPopover = '[data-test="alert-conditions-select-column-popover"]';
    this.filterConditionColumnError   = '[data-test="alert-conditions-select-column-error"]';
    // Operator selector: OSelect → open via -popover, error via -error
    this.filterConditionOperatorPopover = '[data-test="alert-conditions-operator-select-popover"]';
    this.filterConditionOperatorError   = '[data-test="alert-conditions-operator-select-error"]';
    // Value input: OInput → fill via -field, error via -error
    this.filterConditionValueField = '[data-test="alert-conditions-value-input-field"]';
    this.filterConditionValueError = '[data-test="alert-conditions-value-input-error"]';

    // ── FieldsInput — condition management buttons ─────────────────────────────
    // FieldsInput.vue wraps condition rows; same alert-conditions-* namespace
    // Initial "Add" button shown when no conditions exist
    this.fieldsInputAddBtn         = '[data-test="alert-conditions-add-btn"]';
    // Per-row Add / Delete buttons (inside each condition row)
    this.fieldsInputAddConditionBtn    = '[data-test="alert-conditions-add-condition-btn"]';
    this.fieldsInputDeleteConditionBtn = '[data-test="alert-conditions-delete-condition-btn"]';
    // Row wrapper (1-indexed): data-test="alert-conditions-${index+1}"
    // Use getFieldsInputRowLocator(index) below (0-based → selector is index+1)
  }

  // ── Navigation helpers ─────────────────────────────────────────────────────

  async navigateToAlertsList() {
    testLogger.info('Navigating to Alerts list page');
    const alertsMenuLink = '[data-test="menu-link-\\/alerts-item"]';
    await this.page.locator(alertsMenuLink).waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator(alertsMenuLink).click();
  }

  async navigateToDestinations() {
    testLogger.info('Navigating to Settings > Destinations');
    await this.page.locator(this.settingsMenuItem).click();
    await this.page.locator(this.destinationsTab).waitFor({ state: 'visible', timeout: 15000 });
    await this.page.locator(this.destinationsTab).click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async navigateToTemplates() {
    testLogger.info('Navigating to Settings > Templates');
    await this.page.locator(this.settingsMenuItem).click();
    await this.page.locator(this.templatesTab).waitFor({ state: 'visible', timeout: 15000 });
    await this.page.locator(this.templatesTab).click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  // ── AddDestination helpers ─────────────────────────────────────────────────

  /**
   * Opens the Add Destination drawer and selects the "Custom" type so that
   * the webhook / name / URL fields become visible.
   */
  async openAddDestinationCustom() {
    testLogger.info('Opening Add Destination form (Custom type)');
    await this.page.locator(this.addDestinationBtn).click();
    await this.page.locator(this.addDestinationTitle).waitFor({ state: 'visible', timeout: 10000 });

    // Select "Custom" destination type from the prebuilt selector
    await this.selectCustomDestinationType();
  }

  /**
   * Clicks the Custom tile inside the PrebuiltDestinationSelector.
   */
  async selectCustomDestinationType() {
    testLogger.info('Selecting Custom destination type');
    // The selector renders tiles with a data-test on each option card.
    // The Custom card text is "Custom"; we use getByText scoped to the selector.
    const selector = this.page.locator(this.prebuiltDestinationSelector);
    await selector.waitFor({ state: 'visible', timeout: 10000 });
    // The card renders t('alerts.customDestination') = "Custom Destination"
    await selector.locator('[data-test="destination-type-card"][data-type="custom"]').click();
    // After selecting Custom, the tabs + name + URL inputs should appear
    await this.page.locator(this.destTabsContainer).waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Opens Add Destination and selects Slack so the prebuilt webhook URL field appears.
   */
  async openAddDestinationSlack() {
    testLogger.info('Opening Add Destination form (Slack type)');
    await this.page.locator(this.addDestinationBtn).click();
    await this.page.locator(this.addDestinationTitle).waitFor({ state: 'visible', timeout: 10000 });

    const selector = this.page.locator(this.prebuiltDestinationSelector);
    await selector.waitFor({ state: 'visible', timeout: 10000 });
    await selector.getByText('Slack', { exact: false }).first().click();
    await this.page.locator(this.slackWebhookField).waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickDestinationSubmit() {
    testLogger.info('Clicking destination submit button');
    await this.page.locator(this.destSubmitBtn).click();
  }

  async fillDestinationName(name) {
    testLogger.info('Filling destination name', { name });
    await this.page.locator(this.destNameInputField).fill(name);
  }

  async fillDestinationUrl(url) {
    testLogger.info('Filling destination URL', { url });
    await this.page.locator(this.destUrlInputField).fill(url);
  }

  async fillSlackWebhookUrl(url) {
    testLogger.info('Filling Slack webhook URL', { url });
    await this.page.locator(this.slackWebhookField).fill(url);
  }

  async waitForDestinationNameError() {
    await this.page.locator(this.destNameError).waitFor({ state: 'visible', timeout: 5000 });
  }

  async waitForDestinationUrlError() {
    await this.page.locator(this.destUrlError).waitFor({ state: 'visible', timeout: 5000 });
  }

  async waitForSlackWebhookError() {
    await this.page.locator(this.slackWebhookError).waitFor({ state: 'visible', timeout: 5000 });
  }

  // ── AddTemplate helpers ────────────────────────────────────────────────────

  async openAddTemplate() {
    testLogger.info('Opening Add Template form');
    await this.page.locator(this.addTemplateBtn).click();
    await this.page.locator(this.addTemplateTitle).waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickTemplateSubmit() {
    testLogger.info('Clicking template submit button');
    await this.page.locator(this.templateSubmitBtn).click();
  }

  async fillTemplateName(name) {
    testLogger.info('Filling template name', { name });
    await this.page.locator(this.templateNameInputField).fill(name);
  }

  async fillTemplateBodyViaEditor(content) {
    testLogger.info('Filling template body via Monaco editor');
    // Monaco editor — click to focus, then select-all and type
    const editor = this.page.locator(this.templateBodyEditor);
    await editor.click();
    await this.page.keyboard.press('Control+a');
    await this.page.keyboard.type(content);
  }

  async waitForTemplateNameError() {
    await this.page.locator(this.templateNameError).waitFor({ state: 'visible', timeout: 5000 });
  }

  // ── ImportAlert helpers ────────────────────────────────────────────────────

  async openImportAlert() {
    testLogger.info('Opening Import Alert page');
    await this.page.locator(this.alertImportBtn).waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator(this.alertImportBtn).click();
    // Wait for the BaseImport component to render the import button
    await this.page.locator(this.alertImportJsonBtn).waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickAlertImportSubmit() {
    testLogger.info('Clicking Alert import submit button');
    await this.page.locator(this.alertImportJsonBtn).click();
  }

  async switchToAlertFileTab() {
    testLogger.info('Switching to file import tab (Alert)');
    await this.page.locator(this.alertImportJsonFileTab).click();
    await this.page.locator(this.alertImportFileInput).waitFor({ state: 'visible', timeout: 5000 });
  }

  // ── ImportDestination helpers ──────────────────────────────────────────────

  async openImportDestination() {
    testLogger.info('Opening Import Destination page');
    await this.page.locator(this.destinationImportBtn).waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator(this.destinationImportBtn).click();
    await this.page.locator(this.destImportJsonBtn).waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickDestinationImportSubmit() {
    testLogger.info('Clicking Destination import submit button');
    await this.page.locator(this.destImportJsonBtn).click();
  }

  async switchToDestinationFileTab() {
    testLogger.info('Switching to file import tab (Destination)');
    await this.page.locator(this.destImportJsonFileTab).click();
    await this.page.locator(this.destImportFileInput).waitFor({ state: 'visible', timeout: 5000 });
  }

  // ── Locator getters ────────────────────────────────────────────────────────

  getDestNameErrorLocator()           { return this.page.locator(this.destNameError); }
  getDestUrlErrorLocator()            { return this.page.locator(this.destUrlError); }
  getDestTemplateSelectErrorLocator() { return this.page.locator(this.destTemplateSelectError); }
  getDestNameInputFieldLocator()      { return this.page.locator(this.destNameInputField); }
  getSlackWebhookErrorLocator()       { return this.page.locator(this.slackWebhookError); }
  getTemplateNameErrorLocator()       { return this.page.locator(this.templateNameError); }
  getToastSuccessLocator()            { return this.page.locator(this.toastSuccess); }
  getToastErrorLocator()              { return this.page.locator(this.toastError); }
  getAlertImportJsonBtnLocator()      { return this.page.locator(this.alertImportJsonBtn); }
  getDestImportJsonBtnLocator()       { return this.page.locator(this.destImportJsonBtn); }

  // ── AlertSettings locator getters ────────────────────────────────────────
  getAlertSettingsSilenceDurationLocator() { return this.page.locator(this.alertSettingsSilenceDuration); }
  getAlertSettingsSilenceErrorLocator()    { return this.page.locator(this.alertSettingsSilenceError); }
  getAlertDestinationsSelectLocator()      { return this.page.locator(this.alertDestinationsSelect); }
  getAlertRefreshDestinationsBtnLocator()  { return this.page.locator(this.alertRefreshDestinationsBtn); }

  // ── QueryConfig locator getters ───────────────────────────────────────────
  getQueryModeCustomTabLocator()           { return this.page.locator(this.queryModeCustomTab); }
  getQueryModeSqlTabLocator()              { return this.page.locator(this.queryModeSqlTab); }
  getQueryModePromqlTabLocator()           { return this.page.locator(this.queryModePromqlTab); }
  getAlertTriggerOperatorSelectLocator()   { return this.page.locator(this.alertTriggerOperatorSelect); }
  getAlertTriggerThresholdInputLocator()   { return this.page.locator(this.alertTriggerThresholdInput); }
  getAlertTriggerThresholdErrorLocator()   { return this.page.locator(this.alertTriggerThresholdError); }

  // ── Alert wizard step 1 stream selector getters ───────────────────────────
  getWizardStreamTypeDropdownLocator()     { return this.page.locator(this.wizardStreamTypeDropdown); }
  getWizardStreamNameDropdownLocator()     { return this.page.locator(this.wizardStreamNameDropdown); }

  // ── FilterCondition locator getters ───────────────────────────────────────
  getFilterConditionToggleOperatorBtnLocator() { return this.page.locator(this.filterConditionToggleOperatorBtn); }
  getFilterConditionColumnPopoverLocator()     { return this.page.locator(this.filterConditionColumnPopover); }
  getFilterConditionColumnErrorLocator()       { return this.page.locator(this.filterConditionColumnError); }
  getFilterConditionOperatorPopoverLocator()   { return this.page.locator(this.filterConditionOperatorPopover); }
  getFilterConditionOperatorErrorLocator()     { return this.page.locator(this.filterConditionOperatorError); }
  getFilterConditionValueFieldLocator()        { return this.page.locator(this.filterConditionValueField); }
  getFilterConditionValueErrorLocator()        { return this.page.locator(this.filterConditionValueError); }

  // ── FieldsInput locator getters ───────────────────────────────────────────
  getFieldsInputAddBtnLocator()            { return this.page.locator(this.fieldsInputAddBtn); }
  getFieldsInputAddConditionBtnLocator()   { return this.page.locator(this.fieldsInputAddConditionBtn); }
  getFieldsInputDeleteConditionBtnLocator(){ return this.page.locator(this.fieldsInputDeleteConditionBtn); }
  // 0-based index — selector uses 1-based (index+1)
  getFieldsInputRowLocator(index)          { return this.page.locator(`[data-test="alert-conditions-${index + 1}"]`); }

  // ── Alert wizard helpers ───────────────────────────────────────────────────

  /**
   * Navigates to the Alerts list and opens the Add Alert wizard.
   */
  async openAddAlertWizard() {
    testLogger.info('Opening Add Alert wizard');
    await this.navigateToAlertsList();
    await this.page.locator(this.alertListAddBtn).waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator(this.alertListAddBtn).click();
  }

  /**
   * Clicks the Next button in the alert wizard to advance from step 1 to step 2.
   */
  async clickWizardNext() {
    testLogger.info('Clicking wizard Next button');
    await this.page.locator(this.alertWizardNextBtn).waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator(this.alertWizardNextBtn).click();
  }

  /**
   * Clicks the AND/OR toggle operator button in a FilterCondition row.
   */
  async clickFilterConditionToggleOperator() {
    testLogger.info('Clicking FilterCondition AND/OR toggle button');
    await this.page.locator(this.filterConditionToggleOperatorBtn).waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator(this.filterConditionToggleOperatorBtn).click();
  }

  async selectWizardStreamType(typeLabel) {
    testLogger.info('Selecting alert wizard stream type: ' + typeLabel);
    await this.page.locator(this.wizardStreamTypeDropdown).click();
    await this.page.getByRole('option', { name: typeLabel, exact: true }).click();
  }

  async selectWizardStreamName(streamName) {
    testLogger.info('Selecting alert wizard stream name: ' + streamName);
    await this.page.locator(this.wizardStreamNameDropdown).click();
    await this.page.getByRole('option', { name: streamName, exact: true }).click();
  }

  /**
   * Opens the column selector popover in a FilterCondition row.
   */
  async openFilterConditionColumnPopover() {
    testLogger.info('Opening FilterCondition column selector popover');
    await this.page.locator(this.filterConditionColumnPopover).waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator(this.filterConditionColumnPopover).click();
  }
}

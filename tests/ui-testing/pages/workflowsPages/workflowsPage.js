// Workflows (v1) page object — OpenObserve Enterprise "Workflows" feature.
// Feature: event(alert_fired) -> action(remote/pipeline destination), optional Condition/Function nodes.
// Selectors reconciled against merged main (web/src/components/workflows/*, 2026-07-21). See
// tests/ui-testing/MD_Files/features/workflows/ for the full test plan + findings (K9/K10 etc).
// IMPORTANT — O2 component data-test pattern: OInput/OSelect/OTable render the consumer's
// data-test on a NON-interactive wrapper (the <OInput data-test="x"> value lands on a <div>).
// The fillable <input>/<textarea> is exposed as `x-field`; OTable's container is `o2-table-root`.
// Always target the inner element for fill()/type(), never the wrapper.
// The canvas node-interaction selectors (palette-*, workflow-node-*) ARE present in merged
// markup and sit on the live path of the build-and-configure specs — not parked fixmes.
//
// Known quirks baked in here:
//   K9 — the editor Save button has a tooltip overlay that intercepts pointer events; we click it
//        via evaluate() to bypass the interception.
//   K10 — the workflows list GET is slow (~16-20s); readiness/list helpers use generous timeouts.

const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
const MonacoEditorHelper = require('../../playwright-tests/utils/MonacoEditorHelper.js');

const LIST_TIMEOUT_MS = 45000;   // K10: list load is slow
const DRAWER_TIMEOUT_MS = 15000;

// Availability is a property of the build, not of a test — probe it once per worker.
let workflowsEnabled;

class WorkflowsPage {
  constructor(page) {
    this.page = page;
    // Header / list
    this.addBtn = '[data-test="workflow-list-add-btn"]';
    // OInput puts the consumer data-test on a NON-interactive wrapper; the real <input> is
    // exposed as `<name>-field`. For list readiness use the component-owned page container
    // `workflows-list-page` (present + visible on the list route regardless of OTable version
    // and before the slow list GET settles) rather than an OTable-internal container, which
    // differs across builds (o2-table-root vs o2-table / forwarded workflow-list-table).
    this.searchInput = '[data-test="workflow-list-search-input-field"]';
    this.listTable = '[data-test="workflows-list-page"]';
    // Editor
    this.editorPage = '[data-test="workflow-editor-page"]';
    // Name and description are inline-edited titles (OInlineEdit): a display
    // trigger swaps to an input on click, then commits (Enter/blur) back to the
    // read-only value span. -trigger opens, -input edits, -value reads.
    this.nameTrigger = '[data-test="workflow-editor-name-trigger"]';
    this.nameInput = '[data-test="workflow-editor-name-input"]';
    this.nameValue = '[data-test="workflow-editor-name-value"]';
    this.descTrigger = '[data-test="workflow-editor-description-trigger"]';
    this.descInput = '[data-test="workflow-editor-description-input"]';
    // Workflow single-screen function editor: the AddFunction body is ALWAYS
    // visible below the associate-function select (FunctionPicker's `createButton`
    // mode), so there is no "Create New" toggle. Save routes through the icon
    // button next to the select, then a saved-function dialog collects a name and
    // creates the function via the backend (which is where invalid JS surfaces).
    this.nodeFunctionSaveBtn = '[data-test="wf-function-save-btn"]';
    this.nodeFunctionNameInput = '[data-test="wf-saved-function-name-input-field"]';
    this.saveBtn = '[data-test="workflow-editor-save"]';
    this.publishBtn = '[data-test="workflow-editor-publish"]';
    this.testBtn = '[data-test="workflow-editor-test"]';
    this.cancelBtn = '[data-test="workflow-editor-cancel"]';
    this.backBtn = '[data-test="workflow-editor-back"]';
    // Docked palette (the reliable click-to-append add path). NOTE: the rail is
    // COLLAPSED by default — open it via the canvas control stack
    // ([data-test="workflow-palette-collapse-btn"]) before using these.
    // Pattern: workflow-palette-<key>-<ioType>-btn (destination=output, condition/function=default).
    this.paletteCondition = '[data-test="workflow-palette-condition-default-btn"]';
    this.paletteFunction = '[data-test="workflow-palette-function-default-btn"]';
    this.paletteDestination = '[data-test="workflow-palette-destination-output-btn"]';
    // Trigger node (delete only visible on node hover). The hover-`+` add-out
    // button no longer exists — clicking the node's SOURCE HANDLE opens the step
    // picker instead.
    this.triggerNode = '[data-test="workflow-node-workflow_trigger"]';
    this.triggerDelete = '[data-test="workflow-node-workflow_trigger-delete-btn"]';
    // Empty-canvas scaffold's trigger card -> trigger picker. The editor no
    // longer pre-places an Alert Trigger on create; on a fresh /add the canvas
    // renders a two-slot scaffold (workflow-flow-start-scaffold) and the trigger
    // card is `workflow-flow-start-trigger`. `workflow-flow-start-node` is only
    // the fallback when a step exists but the trigger was deleted.
    this.startNode = '[data-test="workflow-flow-start-trigger"]';
    // Trigger-picker items are keyed by TRIGGER KIND (alert_fired, incident_event) —
    // the picker offers one row per enabled kind (all of node_type workflow_trigger).
    this.stepTriggerFor = (kind = 'alert_fired') => `[data-test="workflow-step-${kind}"]`;
    // Step picker dialog (source-handle path); options keyed by node_type
    this.stepCondition = '[data-test="workflow-step-condition"]';
    this.stepFunction = '[data-test="workflow-step-function"]';
    this.stepDestination = '[data-test="workflow-step-destination"]';
    // Node config drawer is an ODialog (not the legacy O2 drawer) — buttons/close
    // are `o-dialog-*`, and the panel commits config on close (there is no primary
    // "Save" button in the footer; drawer close === save). An overlay
    // (o-dialog-overlay) intercepts canvas clicks while the dialog is open.
    this.nodeDrawer = '[data-test="workflow-node-drawer"]';
    this.drawerClose = '[data-test="o-dialog-close-btn"]';
    this.drawerPrimary = '[data-test="o-dialog-primary-btn"]';
    this.drawerSecondary = '[data-test="o-dialog-secondary-btn"]';
    // Destination picker (inside node drawer). OSelect/OToggle put the consumer data-test on a
    // wrapper div; the interactive element is the `-trigger`/`-btn` child — use those to click.
    this.destPicker = '[data-test="destination-picker"]';
    this.destPickerCreateToggle = '[data-test="destination-picker-create-toggle-btn"]';
    this.destPickerSelectTrigger = '[data-test="destination-picker-select-trigger"]';
    this.destPickerSelectPopover = '[data-test="destination-picker-select-popover"]';
    // Inline "create destination" wizard: step 1 choose-type card + continue, step 2 connection.
    this.destTypeCard = (t) => `[data-test="destination-type-card-${t}"]`;
    this.destStep1Continue = '[data-test="step1-continue-btn"]';
    this.destNameField = '[data-test="add-destination-name-input-field"]';
    this.destUrlField = '[data-test="add-destination-url-input-field"]';
    this.destSubmitBtn = '[data-test="add-destination-submit-btn"]';
    // Post-save "link to alerts" dialog (ODialog): Skip = secondary button.
    this.linkAlertsDialog = '[data-test="workflow-link-alerts-dialog"]';
    this.dialogSecondary = '[data-test="o-dialog-secondary-btn"]';
    // Trigger config panel — a READ-ONLY payload reference, no config to save.
    // Kinds with `commonMetaKeys` (incidents) render a SPLIT view: a variant
    // OSelect plus common/event-specific blocks. Kinds without (alerts) render a
    // single combined block. `no-extras` replaces the specific block when an
    // event_type adds nothing (e.g. `created`, whose extras are {}).
    // Canvas chrome + per-node selectors. Node-scoped ones are factories (same
    // pattern as stepTriggerFor/destTypeCard) because they key on node_type / name.
    this.dialogOverlay = '[data-test="o-dialog-overlay"]';
    this.palette = '[data-test="workflow-palette"]';
    this.paletteCollapseBtn = '[data-test="workflow-palette-collapse-btn"]';
    this.nodeFor = (t) => `[data-test="workflow-node-${t}"]`;
    this.nodeTestOkFor = (t) => `[data-test="workflow-node-${t}-test-ok"]`;
    this.nodeTestErrorFor = (t) => `[data-test="workflow-node-${t}-test-error"]`;
    this.listRowPrefixFor = (n) => `[data-test^="workflow-list-${n}-"]`;
    this.listRowActionFor = (n, a) => `[data-test="workflow-list-${n}-${a}"]`;
    // NDV output pane — on a successful destination send this holds the sink's
    // response body, which is what makes delivery assertable.
    this.ndvOutput = '[data-test="workflow-ndv-output"]';
    // Test-run drawer. Still a real ODrawer (WorkflowTestDialog.vue) — only the NODE
    // config panel became an ODialog — so its buttons stay `o-drawer-*`.
    this.testDrawer = '[data-test="workflow-test-drawer"]';
    this.testDrawerPrimary = '[data-test="workflow-test-drawer"] [data-test="o-drawer-primary-btn"]';
    // Workflow function code editor (QuickJS/JavaScript), shared with the Functions page.
    this.functionEditor = '[data-test="logs-vrl-function-editor"]';
    // Warning toast — how a blocked Publish reports itself, since it never reaches the network.
    this.warningToast = '[data-test^="o-toast-"][data-test-variant="warning"]';
    this.anyToast = '[role="alert"], .q-notification__message';
    this.confirmButton =
      '[data-test$="-confirm-button"], [data-test="dlg-primary"], button:has-text("OK"), button:has-text("Delete")';
    // Destination header rows are keyed by the header's CURRENT key, so these are
    // functions rather than constants — a blank row answers to the empty-key form.
    this.destHeaderKeyField = (key = '') => `[data-test="add-destination-header-${key}-key-input-field"]`;
    this.destHeaderValueField = (key = '') => `[data-test="add-destination-header-${key}-value-input-field"]`;
    this.triggerBody = '[data-test="workflow-trigger-body"]';
    this.triggerStructure = '[data-test="workflow-trigger-structure"]';
    this.triggerVariantTrigger = '[data-test="workflow-trigger-sample-variant-trigger"]';
    this.triggerVariantOption = '[data-test="workflow-trigger-sample-variant-option"]';
    this.triggerCommonStructure = '[data-test="workflow-trigger-common-structure"]';
    this.triggerSpecificStructure = '[data-test="workflow-trigger-specific-structure"]';
    this.triggerNoExtras = '[data-test="workflow-trigger-no-extras"]';
    // Condition node body + the shared ConditionBuilder. OFormSelect/OFormInput
    // bind {...$attrs} onto OSelect/OInput, so the consumer data-test lands on the
    // wrapper and the interactive child is `-trigger` (select) / `-field` (input).
    // Options carry data-test-value, so a rule is picked by VALUE, not by label.
    this.conditionBody = '[data-test="workflow-condition-body"]';
    this.conditionNote = '[data-test="workflow-condition-note"]';
    this.conditionNoteDismiss = '[data-test="workflow-condition-note-dismiss"]';
    this.conditionBuilder = '[data-test="condition-builder"]';
    this.condColumnTrigger = '[data-test="alert-conditions-select-column-trigger"]';
    this.condColumnSearch = '[data-test="alert-conditions-select-column-search"]';
    this.condColumnOption = '[data-test="alert-conditions-select-column-option"]';
    this.condOperatorTrigger = '[data-test="alert-conditions-operator-select-trigger"]';
    this.condOperatorOption = '[data-test="alert-conditions-operator-select-option"]';
    // v-if'd away entirely for unary operators (is_null/is_empty/...) — absence,
    // not an empty string, is what a unary operator looks like in the DOM.
    this.condValueField = '[data-test="alert-conditions-value-input-field"]';
    this.condAddBtn = '[data-test="alert-conditions-add-condition-btn"]';
    this.condDeleteBtn = '[data-test="alert-conditions-delete-condition-btn"]';
  }

  // Workflows is an Enterprise-only feature: on a build without it the API answers 404/403.
  async isAvailable() {
    const url = `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}/workflows`;
    try {
      const resp = await this.page.request.get(url);
      return resp.status() !== 404 && resp.status() !== 403;
    } catch (_e) {
      return false;
    }
  }

  /**
   * Fail loudly, up front, when the feature is not enabled on the build under test.
   *
   * These specs run ONLY in the ENT playwright matrix (ci_matrix.ent.json `Workflows`
   * shard), where playwright.yml pins O2_WORKFLOWS_ENABLED=true. A flipped default, a
   * dropped env line or a broken route would otherwise surface as an opaque selector
   * timeout deep inside a test — or, if anyone reintroduces a skip, as a silent green.
   * Probed once per worker; every test then fails with the same actionable message.
   */
  async assertEnabled() {
    if (workflowsEnabled === undefined) workflowsEnabled = await this.isAvailable();
    if (!workflowsEnabled) {
      throw new Error(
        `Workflows is NOT enabled on ${process.env.ZO_BASE_URL} (GET /api/${getOrgIdentifier()}/workflows returned 403/404). ` +
          'These specs are enterprise-only and must never be skipped: set O2_WORKFLOWS_ENABLED=true on the build under test.'
      );
    }
  }

  // ---------- navigation ----------
  async goToList() {
    const url = `${process.env.ZO_BASE_URL}/web/workflows?org_identifier=${getOrgIdentifier()}`;
    await this.page.goto(url, { timeout: 60000 });
    await this.waitForListReady();
  }

  /**
   * Open the create editor AND choose the Alert Trigger, so callers start from a
   * workflow that has its trigger — the state the editor used to seed itself.
   * (`?trigger=` is gone; the canvas starts empty and asks via the start node.)
   * Use `goToAddEmpty()` when a spec needs the untouched empty canvas.
   */
  async goToAdd(kind = 'alert_fired') {
    await this.goToAddEmpty();
    await this.chooseTrigger(kind);
  }

  async goToAddEmpty() {
    const url = `${process.env.ZO_BASE_URL}/web/workflows/add?org_identifier=${getOrgIdentifier()}`;
    await this.page.goto(url, { timeout: 60000 });
    await this.page.locator(this.nameTrigger).waitFor({ state: 'attached', timeout: DRAWER_TIMEOUT_MS });
  }

  /**
   * Empty canvas -> start node -> trigger picker -> pick a kind (default
   * alert_fired; pass 'incident_event' for the incident lifecycle). The trigger's
   * panel is a read-only payload reference, so it is dismissed, not saved.
   */
  async chooseTrigger(kind = 'alert_fired') {
    await this.page.locator(this.startNode).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.stepTriggerFor(kind)).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.triggerNode).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    await this.closeOpenDrawer();
  }

  async waitForListReady() {
    // K10: list GET is slow; wait for either rows or the empty-state, not "Loading data".
    await this.page.locator(this.listTable).first().waitFor({ state: 'visible', timeout: LIST_TIMEOUT_MS });
    await this.page.locator('text=Loading data')
      .waitFor({ state: 'detached', timeout: LIST_TIMEOUT_MS }).catch(() => {});
  }

  // ---------- editor helpers ----------
  async setName(name) {
    // Open the inline editor, fill it, and commit (Enter) so the name lands in
    // the read-only value span. The name has no owning <form>, so Enter only
    // commits — it does not submit/navigate.
    await this.page.locator(this.nameTrigger).click();
    const input = this.page.locator(this.nameInput);
    await input.waitFor({ state: 'visible' });
    await input.fill(name);
    await input.press('Enter');
  }

  // ---------- assertions (keep raw locators out of specs) ----------
  async expectNameValue(name) {
    // After commit the name renders as the read-only value span; textContent is
    // the full value even when CSS-truncated visually.
    await expect(this.page.locator(this.nameValue)).toHaveText(name);
  }

  async expectEditorVisible() {
    await expect(this.page.locator(this.editorPage)).toBeVisible();
  }

  async expectListVisible() {
    await expect(this.page.locator(this.listTable).first()).toBeVisible();
  }

  async setDescription(desc) {
    // Description is inline-edited too: open, fill, commit.
    await this.page.locator(this.descTrigger).click();
    const input = this.page.locator(this.descInput);
    await input.waitFor({ state: 'visible' });
    await input.fill(desc);
    await input.press('Enter');
  }

  // K9: bypass the tooltip that intercepts pointer events on Save.
  async clickSave() {
    await this.page.evaluate((sel) => {
      const b = document.querySelector(sel);
      if (!b) throw new Error('save button not found: ' + sel);
      b.click();
    }, this.saveBtn);
  }

  async clickPublish() {
    await this.page.evaluate((sel) => {
      const b = document.querySelector(sel);
      if (!b) throw new Error('publish button not found: ' + sel);
      b.click();
    }, this.publishBtn);
  }

  /**
   * K9 canary probe — attempts a PLAIN Playwright click on Save (no JS bypass) and returns
   * true if it was intercepted (the click never landed). This is NON-deterministic in headless
   * CI: Save has no tooltip of its own (WorkflowEditor.vue), so the overlay that intercepts it
   * is a transient/adjacent tooltip that often never appears on a programmatic hover.
   * Callers MUST treat the result as informational only, not a hard assertion — see the CT-19
   * K9 spec. A consistent `false` would be the signal that K9 is fixed and the clickSave()
   * JS-bypass workaround can be dropped.
   */
  async normalSaveClickIsIntercepted(timeoutMs = 4000) {
    await this.page.locator(this.saveBtn).hover().catch(() => {});
    try {
      await this.page.locator(this.saveBtn).click({ timeout: timeoutMs });
      return false;
    } catch (_e) {
      return true;
    }
  }

  async clickTest() {
    await this.page.evaluate((sel) => {
      const b = document.querySelector(sel);
      if (!b) throw new Error('test button not found: ' + sel);
      b.click();
    }, this.testBtn);
  }

  /** Close any open node dialog. Left in place as a defensive no-op — the new
   *  editor no longer auto-opens the trigger's config panel, but a stray dialog
   *  from a previous step would still block canvas/palette clicks via the
   *  o-dialog-overlay. */
  async closeOpenDrawer() {
    const close = this.page.locator(this.drawerClose);
    if (await close.count()) {
      await close.first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
      await this.page.locator(this.dialogOverlay)
        .waitFor({ state: 'detached', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    }
  }

  /**
   * Append a node from the docked palette (auto-wires after the end node) and wait for its
   * config drawer. The palette is the reliable add path — the on-node hover-`+` is hidden.
   */
  async ensureNodePaletteOpen() {
    const rail = this.page.locator(this.palette);
    if (await rail.isVisible().catch(() => false)) return;
    await this.page.locator(this.paletteCollapseBtn).click();
    await rail.waitFor({ state: 'visible' });
  }

  async addNodeFromPalette(type /* 'condition' | 'function' | 'destination' */) {
    await this.closeOpenDrawer();
    await this.ensureNodePaletteOpen();
    const paletteSel = { condition: this.paletteCondition, function: this.paletteFunction, destination: this.paletteDestination }[type];
    await this.page.locator(paletteSel).click({ timeout: DRAWER_TIMEOUT_MS });
    // "Insert-immediately" — the palette adds the node in Set-up-later mode and
    // does NOT auto-open the config panel. Click the freshly-added node to open
    // its drawer. Multiple nodes of the same type can coexist; last() picks the
    // newest for the caller's follow-up config.
    const nodeSel = this.nodeFor(type);
    const node = this.page.locator(nodeSel).last();
    await node.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    await node.click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.nodeDrawer).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
  }

  /**
   * Add one header row to the inline create-destination form. The row's data-test is
   * keyed by the header's CURRENT key, so the blank row is `...-header--key-input` and
   * the value input only answers to its final name once the key has been typed.
   * The backend forwards these on every send (batch_execution.rs applies
   * `endpoint.headers` to the outbound request), which is what lets a workflow post
   * into an authenticated endpoint.
   */
  async setDestinationHeader(key, value) {
    await this.page.locator(this.destHeaderKeyField()).fill(key, { timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.destHeaderValueField(key)).fill(value, { timeout: DRAWER_TIMEOUT_MS });
  }

  /** Pick an OSelect option by its VALUE (options stamp data-test-value). */
  async pickSelectOption(triggerSel, optionSel, value) {
    await this.page.locator(triggerSel).click({ timeout: DRAWER_TIMEOUT_MS });
    const option = this.page.locator(`${optionSel}[data-test-value="${value}"]`).first();
    await option.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    await option.click({ timeout: DRAWER_TIMEOUT_MS });
  }

  /** Values of every option an OSelect currently offers. */
  async selectOptionValues(triggerSel, optionSel) {
    await this.page.locator(triggerSel).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(optionSel).first().waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    const values = await this.page.locator(optionSel).evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-test-value'))
    );
    await this.page.keyboard.press('Escape');
    return values.filter(Boolean);
  }

  // ---------- trigger config panel ----------
  /** Open the trigger node's read-only payload reference. */
  async openTriggerConfig() {
    await this.page.locator(this.triggerNode).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.nodeDrawer).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
  }

  /** The event_type values the incident trigger offers as sample variants. */
  async triggerVariantValues() {
    return this.selectOptionValues(this.triggerVariantTrigger, this.triggerVariantOption);
  }

  async selectTriggerVariant(eventType) {
    await this.pickSelectOption(this.triggerVariantTrigger, this.triggerVariantOption, eventType);
  }

  /** Incident kinds split the payload into common + event-specific blocks. */
  async expectSplitPayloadView() {
    await expect(this.page.locator(this.triggerCommonStructure)).toBeVisible();
  }

  /**
   * The trigger's payload as TEXT, independent of how it is laid out: main renders
   * a common + event-specific pair, while an in-flight UX branch merges them into a
   * single block. Reading every editor under the trigger body keeps assertions about
   * WHAT the payload contains rather than which box it happens to sit in.
   *
   * Read through window.monaco rather than `.view-lines`: Monaco only renders the
   * lines currently in view, so a scrolled payload would silently lose fields.
   */
  async triggerPayloadText() {
    await this.page.locator(this.triggerBody).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    await this.page.waitForFunction(
      () => Boolean(window.monaco?.editor?.getEditors?.()?.length),
      null,
      { timeout: DRAWER_TIMEOUT_MS }
    );
    return this.page.evaluate(() => {
      const body = document.querySelector('[data-test="workflow-trigger-body"]');
      if (!body) return '';
      return (window.monaco?.editor?.getEditors?.() || [])
        .filter((ed) => body.contains(ed.getDomNode()))
        .map((ed) => ed.getValue())
        .join('\n');
    });
  }

  /** An event_type whose `extras` are {} shows the no-extras note instead. */
  async expectNoExtrasNote() {
    await expect(this.page.locator(this.triggerNoExtras)).toBeVisible();
  }

  async expectSpecificStructure() {
    await expect(this.page.locator(this.triggerSpecificStructure)).toBeVisible();
  }

  // ---------- condition node ----------
  /**
   * The guidelines box is a FIRST-RUN hint persisted to localStorage. On a fresh
   * CI profile it renders every time and can sit over the builder, so dismiss it
   * before driving the rows rather than letting it flake the click.
   */
  async dismissConditionGuidelinesIfPresent() {
    const dismiss = this.page.locator(this.conditionNoteDismiss);
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
      await this.page.locator(this.conditionNote)
        .waitFor({ state: 'detached', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    }
  }

  /** Column values the condition builder offers — trigger-kind specific. */
  async conditionColumnValues() {
    return this.selectOptionValues(this.condColumnTrigger, this.condColumnOption);
  }

  /**
   * Fill one condition rule. `value` is omitted for unary operators
   * (is_null/is_not_null/is_empty/is_not_empty) — the input is not rendered at all.
   */
  async setCondition({ column, operator, value }) {
    await this.page.locator(this.conditionBuilder).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    await this.dismissConditionGuidelinesIfPresent();
    await this.pickSelectOption(this.condColumnTrigger, this.condColumnOption, column);
    await this.pickSelectOption(this.condOperatorTrigger, this.condOperatorOption, operator);
    if (value !== undefined) {
      await this.page.locator(this.condValueField).fill(value);
    }
  }

  /**
   * Change only the operator (and value) of an existing rule. Re-picking the column
   * each time is needless work and an extra flake surface when a test sweeps a set of
   * operators against one column.
   */
  async setConditionOperator(operator, value) {
    await this.pickSelectOption(this.condOperatorTrigger, this.condOperatorOption, operator);
    if (value !== undefined) {
      await this.page.locator(this.condValueField).fill(value);
    }
  }

  /** Unary operators remove the value input from the DOM (v-if), not just clear it. */
  async expectConditionValueAbsent() {
    await expect(this.page.locator(this.condValueField)).toHaveCount(0);
  }

  async expectConditionValueVisible() {
    await expect(this.page.locator(this.condValueField)).toBeVisible();
  }

  async expectConditionBuilderVisible() {
    await expect(this.page.locator(this.conditionBuilder)).toBeVisible();
  }

  async expectConditionGuidelinesAbsent() {
    await expect(this.page.locator(this.conditionNote)).toHaveCount(0);
  }

  /**
   * In an open Destination node drawer, create a new remote destination inline and bind it to
   * the node.
   *
   * The workflow destination node passes `forced-type="custom"` (WorkflowDestination.vue) to the
   * shared DestinationPicker, so CreateDestinationForm opens DIRECTLY on the Connection step
   * (name/url) with `step === 2` and hides the type-selection step — there is no
   * `destination-type-card-*` / `step1-continue-btn` in this flow. We assert that expected UX
   * (name field present right after toggling create); we do NOT tolerate a type-selection step
   * here — if it reappears, the forced-type contract has changed and this should fail loudly.
   */
  async createDestinationInline({ name, url, headers }) {
    await this.page.locator(this.destPickerCreateToggle).click({ timeout: DRAWER_TIMEOUT_MS });

    const nameField = this.page.locator(this.destNameField);
    await nameField.waitFor({ state: 'attached', timeout: DRAWER_TIMEOUT_MS });
    await nameField.fill(name);
    await this.page.locator(this.destUrlField).fill(url);
    for (const [key, value] of Object.entries(headers || {})) {
      await this.setDestinationHeader(key, value);
    }
    await this.page.locator(this.destSubmitBtn).click({ timeout: DRAWER_TIMEOUT_MS });
    // onDestinationCreated only STAGES the name (pendingSelection); the select is
    // bound after the refetch resolves. The trigger renders before that value lands,
    // so waiting for it to be visible races — the drawer closes first, the node
    // commits with an empty destination_id, and Publish rejects it with "1 step needs
    // setup before publishing". Wait for the bound value itself (OSelect stamps the
    // option's value, which DestinationPicker.toOption sets to the destination name).
    await expect(this.page.locator(this.destPickerSelectTrigger))
      .toHaveAttribute('data-test-selected-value', name, { timeout: DRAWER_TIMEOUT_MS });
  }

  /**
   * Open the Test drawer from the editor and run the saved graph against the (pre-filled) sample
   * payload. Per-node results paint as ✓/✗ badges on the canvas nodes afterwards.
   */
  async testRunFromEditor() {
    await this.page.locator(this.testBtn).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.testDrawer).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    // The Test panel is still a real ODrawer (WorkflowTestDialog.vue) — only the NODE
    // config panel became an ODialog. Its buttons stay `o-drawer-*`.
    await this.page.locator(this.testDrawerPrimary).click({ timeout: DRAWER_TIMEOUT_MS });
  }

  /** Assert a node painted an error badge after a test run (node_type e.g. 'destination','function').
   *  Generous timeout — on slow CI runners the run + failing send can take a while to resolve. */
  async expectNodeTestError(nodeType, timeout = 60000) {
    await expect(this.page.locator(this.nodeTestErrorFor(nodeType)))
      .toBeVisible({ timeout });
  }

  /**
   * A node's test-run OUTPUT, as text. On a successful destination send the backend
   * sets the node's output to the sink's RESPONSE BODY (batch_execution.rs calls
   * send_output with `body`), so pointing a destination at OpenObserve's own ingest
   * endpoint makes this the ingest receipt — direct, synchronous proof of delivery
   * with no polling and no follow-up search.
   */
  async nodeTestOutputText(nodeType) {
    await this.page.locator(this.nodeFor(nodeType)).last()
      .click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.nodeDrawer).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    const panel = this.page.locator(this.ndvOutput);
    await panel.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    await this.page.waitForFunction(
      () => Boolean(window.monaco?.editor?.getEditors?.()?.length),
      null,
      { timeout: DRAWER_TIMEOUT_MS }
    );
    return this.page.evaluate(() => {
      const out = document.querySelector('[data-test="workflow-ndv-output"]');
      if (!out) return '';
      return (window.monaco?.editor?.getEditors?.() || [])
        .filter((ed) => out.contains(ed.getDomNode()))
        .map((ed) => ed.getValue())
        .join('\n');
    });
  }

  /**
   * The destination's response parsed into an object. The node output is an ARRAY of
   * response bodies (one per send), each itself a JSON string, so it needs two parses
   * — matching a regex against the escaped text is brittle and reads badly.
   * For a self-ingest sink this resolves to OpenObserve's receipt:
   *   { code: 200, status: [{ name, successful, failed }] }
   */
  async destinationIngestReceipt() {
    const raw = await this.nodeTestOutputText('destination');
    const outer = JSON.parse(raw);
    const first = Array.isArray(outer) ? outer[0] : outer;
    return typeof first === 'string' ? JSON.parse(first) : first;
  }

  /** Assert a node painted a success badge after a test run. */
  async expectNodeTestOk(nodeType, timeout = 60000) {
    await expect(this.page.locator(this.nodeTestOkFor(nodeType)))
      .toBeVisible({ timeout });
  }

  /** Commit the node config: the new ODialog-based drawer has no "Save" button —
   *  closing the dialog IS the save (applyNodeConfig runs on close). Use the
   *  built-in close X (`o-dialog-close-btn`) and wait for the drawer to detach. */
  async saveNodeDrawer() {
    await this.page.locator(this.drawerClose).first().click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.nodeDrawer).waitFor({ state: 'detached', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
  }

  /** If a node drawer is still open, close it (commits config); otherwise no-op. */
  async bindNodeDrawerIfOpen() {
    const drawer = this.page.locator(this.nodeDrawer);
    if (await drawer.isVisible().catch(() => false)) {
      await this.page.locator(this.drawerClose).first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
      await drawer.waitFor({ state: 'detached', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    }
  }

  /**
   * With the Function node drawer open, type code into the JS editor and route it
   * through the save flow (icon save -> saved-function dialog: name + primary).
   * The backend's create endpoint is what rejects invalid JS — the returned
   * message surfaces as a toast, which we return so callers can assert on it.
   */
  async attemptCreateFunction({ name, code }) {
    // The workflow single-screen has the AddFunction body always visible below the
    // select; no create toggle. Clicking the editor WRAPPER does not focus Monaco —
    // the keystrokes go nowhere and the untouched seed template is what gets saved,
    // so an invalid-code test silently asserts nothing. Drive the real textarea.
    const editor = this.page.locator(this.functionEditor);
    const monaco = new MonacoEditorHelper(this.page);
    await monaco.focus(editor);
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await this.page.keyboard.type(code);
    // Fail here, not on the toast, if the code never landed. Compared whitespace-free:
    // Monaco re-renders indentation and auto-closes brackets.
    const norm = (s) => (s || '').replace(/\s+/g, '');
    await expect
      .poll(async () => norm(await monaco.getContent(editor)), { timeout: DRAWER_TIMEOUT_MS })
      .toContain(norm(code));
    // Save reads AddFunction's MODEL (getCode -> formData.function), which QueryEditor
    // only updates after its 500ms `update:query` debounce. Clicking sooner submits the
    // previous value — the seed template — and the backend then rightly reports success.
    await this.page.waitForTimeout(800);
    // Route through the workflow save button (opens the Update|Create dialog).
    await this.page.locator(this.nodeFunctionSaveBtn).click({ timeout: DRAWER_TIMEOUT_MS });
    // With no function currently selected the dialog defaults to Create mode
    // and exposes the name input. Fill it and submit via the ODialog primary.
    const nameInput = this.page.locator(this.nodeFunctionNameInput);
    await nameInput.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    await nameInput.fill(name);
    await this.page.locator(this.drawerPrimary).click({ timeout: DRAWER_TIMEOUT_MS });
    const toast = this.page.locator(this.anyToast).first();
    await toast.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    return (await toast.textContent().catch(() => '') || '').trim();
  }

  /**
   * The link-alerts prompt is offered ONLY for trigger kinds whose registry entry
   * sets `linksAlerts` (alert_fired). Incident workflows must go straight back to
   * the list instead — asserting both halves is what proves the flag is honoured.
   */
  async expectLinkAlertsPrompt() {
    await expect(this.page.locator(this.linkAlertsDialog)).toBeVisible({ timeout: DRAWER_TIMEOUT_MS });
  }

  async expectNoLinkAlertsPrompt() {
    await expect(this.page.locator(this.linkAlertsDialog)).toHaveCount(0);
  }

  /** After a successful create, the "Link to alerts" dialog appears — Skip it (secondary btn). */
  async skipLinkAlerts() {
    const dlg = this.page.locator(this.linkAlertsDialog);
    if (await dlg.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS }).then(() => true).catch(() => false)) {
      await this.page.locator(this.dialogSecondary).first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    }
  }

  /**
   * Full happy path: build a Trigger -> Destination workflow with a freshly-created destination
   * and save it. Returns nothing; caller verifies via the list.
   */
  /**
   * Publish, and fail at the point of rejection. A blocked Publish never reaches the
   * network — validate() bails with a warning toast — so a caller that only waits for
   * the link-alerts dialog turns a real rejection into a silent timeout and surfaces
   * it much later as a bare "expected true".
   */
  async publishAndExpectAccepted() {
    await this.clickPublish();
    const warning = this.page.locator(this.warningToast).first();
    const linkDialog = this.page.locator(this.linkAlertsDialog);
    const editor = this.page.locator(this.editorPage);
    await expect
      .poll(
        async () => {
          if (await warning.isVisible().catch(() => false)) return 'rejected';
          if (await linkDialog.isVisible().catch(() => false)) return 'accepted';
          // Trigger kinds that don't associate with alerts get no link prompt — a
          // successful publish just navigates back to the list.
          if (!(await editor.isVisible().catch(() => false))) return 'accepted';
          return 'pending';
        },
        { timeout: DRAWER_TIMEOUT_MS, message: 'Publish produced neither a result nor a message' }
      )
      .not.toBe('pending');
    if (await warning.isVisible().catch(() => false)) {
      const msg = await warning.getAttribute('data-test-message');
      throw new Error(`Publish was rejected: ${(msg || '').trim()}`);
    }
  }

  /**
   * Publish expecting the app to REFUSE, and return the warning text. The mirror of
   * publishAndExpectAccepted(): a blocked Publish never reaches the network, so the
   * only evidence is the toast.
   */
  async publishAndCaptureRejection() {
    await this.clickPublish();
    const warning = this.page.locator(this.warningToast).first();
    await warning.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    return ((await warning.getAttribute('data-test-message')) || '').trim();
  }

  async buildTriggerToDestinationAndSave({ name, destName, url, headers, kind = 'alert_fired' }) {
    await this.goToAdd(kind);
    await this.setName(name);
    await this.addNodeFromPalette('destination');
    await this.createDestinationInline({ name: destName, url, headers });
    await this.saveNodeDrawer();
    await this.publishAndExpectAccepted();
    await this.skipLinkAlerts();
  }


  /**
   * Save the workflow. Returns the toast/validation text so callers can assert
   * (e.g. trigger-only save -> "Add At Least One Step After The Trigger").
   */
  async saveAndCaptureResult() {
    await this.clickPublish();
    const toast = this.page.locator(this.anyToast).first();
    await toast.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    return (await toast.textContent().catch(() => '') || '').trim();
  }

  // ---------- list operations ----------
  async search(text) {
    await this.page.locator(this.searchInput).fill(text);
  }

  // OTable renders rows as divs (not <tr>); each row exposes per-action data-tests keyed by the
  // workflow name: workflow-list-<name>-{view,edit,pause-start-action,more-options,delete}.
  // Match on that prefix so row lookup is independent of the table's DOM shape.
  rowByName(name) {
    return this.page.locator(this.listRowPrefixFor(name));
  }

  async openEdit(name) {
    // The list is slow (K10) and virtualized, so a row for an arbitrary name is not
    // necessarily rendered — filter to it first, exactly as isPresent() does.
    await this.waitForListReady();
    await this.search(name);
    await this.page.locator(this.listRowActionFor(name, 'edit')).first().click({ timeout: LIST_TIMEOUT_MS });
    await this.page.locator(this.editorPage).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
  }

  /** Delete via row action (in the more-options menu). Returns any error toast (delete-protected
   *  when linked to an alert). */
  async deleteByName(name) {
    await this.page.locator(this.listRowActionFor(name, 'more-options')).first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    await this.page.locator(this.listRowActionFor(name, 'delete')).first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    await this.page.locator(this.confirmButton).first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    const toast = this.page.locator(this.anyToast).first();
    await toast.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    return (await toast.textContent().catch(() => '') || '').trim();
  }

  async isPresent(name) {
    await this.waitForListReady();
    // The list is slow (K10) and virtualized — filter to the name, then wait for its row to
    // appear rather than scanning the full (possibly not-yet-rendered) table.
    await this.search(name);
    return await this.rowByName(name).first()
      .waitFor({ state: 'attached', timeout: LIST_TIMEOUT_MS })
      .then(() => true).catch(() => false);
  }

  // ---------- enable / disable ----------
  async toggleEnable(name) {
    await this.page.locator(this.listRowActionFor(name, 'pause-start-action')).first().click({ timeout: DRAWER_TIMEOUT_MS });
  }
}

module.exports = WorkflowsPage;

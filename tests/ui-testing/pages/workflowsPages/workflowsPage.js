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
      await this.page.locator('[data-test="o-dialog-overlay"]')
        .waitFor({ state: 'detached', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    }
  }

  /**
   * Append a node from the docked palette (auto-wires after the end node) and wait for its
   * config drawer. The palette is the reliable add path — the on-node hover-`+` is hidden.
   */
  async ensureNodePaletteOpen() {
    const rail = this.page.locator('[data-test="workflow-palette"]');
    if (await rail.isVisible().catch(() => false)) return;
    await this.page.locator('[data-test="workflow-palette-collapse-btn"]').click();
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
    const nodeSel = `[data-test="workflow-node-${type}"]`;
    const node = this.page.locator(nodeSel).last();
    await node.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    await node.click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.nodeDrawer).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
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
  async createDestinationInline({ name, url }) {
    await this.page.locator(this.destPickerCreateToggle).click({ timeout: DRAWER_TIMEOUT_MS });

    const nameField = this.page.locator(this.destNameField);
    await nameField.waitFor({ state: 'attached', timeout: DRAWER_TIMEOUT_MS });
    await nameField.fill(name);
    await this.page.locator(this.destUrlField).fill(url);
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
    await this.page.locator('[data-test="workflow-test-drawer"]').waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
    // The Test panel is still a real ODrawer (WorkflowTestDialog.vue) — only the NODE
    // config panel became an ODialog. Its buttons stay `o-drawer-*`.
    await this.page.locator('[data-test="workflow-test-drawer"] [data-test="o-drawer-primary-btn"]')
      .click({ timeout: DRAWER_TIMEOUT_MS });
  }

  /** Assert a node painted an error badge after a test run (node_type e.g. 'destination','function').
   *  Generous timeout — on slow CI runners the run + failing send can take a while to resolve. */
  async expectNodeTestError(nodeType, timeout = 60000) {
    await expect(this.page.locator(`[data-test="workflow-node-${nodeType}-test-error"]`))
      .toBeVisible({ timeout });
  }

  /** Assert a node painted a success badge after a test run. */
  async expectNodeTestOk(nodeType, timeout = 60000) {
    await expect(this.page.locator(`[data-test="workflow-node-${nodeType}-test-ok"]`))
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
    const editor = this.page.locator('[data-test="logs-vrl-function-editor"]');
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
    const toast = this.page.locator('[role="alert"], .q-notification__message').first();
    await toast.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    return (await toast.textContent().catch(() => '') || '').trim();
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
    const warning = this.page.locator('[data-test^="o-toast-"][data-test-variant="warning"]').first();
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

  async buildTriggerToDestinationAndSave({ name, destName, url }) {
    await this.goToAdd();
    await this.setName(name);
    await this.addNodeFromPalette('destination');
    await this.createDestinationInline({ name: destName, url });
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
    const toast = this.page.locator('[role="alert"], .q-notification__message').first();
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
    return this.page.locator(`[data-test^="workflow-list-${name}-"]`);
  }

  async openEdit(name) {
    // The list is slow (K10) and virtualized, so a row for an arbitrary name is not
    // necessarily rendered — filter to it first, exactly as isPresent() does.
    await this.waitForListReady();
    await this.search(name);
    await this.page.locator(`[data-test="workflow-list-${name}-edit"]`).first().click({ timeout: LIST_TIMEOUT_MS });
    await this.page.locator(this.editorPage).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
  }

  /** Delete via row action (in the more-options menu). Returns any error toast (delete-protected
   *  when linked to an alert). */
  async deleteByName(name) {
    await this.page.locator(`[data-test="workflow-list-${name}-more-options"]`).first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    await this.page.locator(`[data-test="workflow-list-${name}-delete"]`).first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    await this.page.locator('[data-test$="-confirm-button"], [data-test="dlg-primary"], button:has-text("OK"), button:has-text("Delete")')
      .first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    const toast = this.page.locator('[role="alert"], .q-notification__message').first();
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
    await this.page.locator(`[data-test="workflow-list-${name}-pause-start-action"]`).first().click({ timeout: DRAWER_TIMEOUT_MS });
  }
}

module.exports = WorkflowsPage;

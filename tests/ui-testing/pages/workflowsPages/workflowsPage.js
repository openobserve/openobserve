// Workflows (v1) page object — OpenObserve Enterprise "Workflows" feature.
// Feature: event(alert_fired) -> action(remote/pipeline destination), optional Condition/Function nodes.
// Selectors reconciled against merged main (web/src/components/workflows/*, 2026-07-21). See
// tests/ui-testing/MD_Files/features/workflows/ for the full test plan + findings (K9/K10 etc).
// IMPORTANT — O2 component data-test pattern: OInput/OSelect/OTable render the consumer's
// data-test on a NON-interactive wrapper (the <OInput data-test="x"> value lands on a <div>).
// The fillable <input>/<textarea> is exposed as `x-field`; OTable's container is `o2-table-root`.
// Always target the inner element for fill()/type(), never the wrapper.
// NOTE: the canvas node-interaction selectors (trigger add-out/delete, palette-*) are NOT yet
// present in merged markup — the nodes render on a vue-flow canvas. They feed only the parked
// test.fixme cases and must be discovered live on an ENT build before those tests are enabled.
//
// Known quirks baked in here:
//   K9 — the editor Save button has a tooltip overlay that intercepts pointer events; we click it
//        via evaluate() to bypass the interception.
//   K10 — the workflows list GET is slow (~16-20s); readiness/list helpers use generous timeouts.

const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

const LIST_TIMEOUT_MS = 45000;   // K10: list load is slow
const DRAWER_TIMEOUT_MS = 15000;

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
    this.nameField = '[data-test="workflow-editor-name-field"]';
    this.descField = '[data-test="workflow-editor-description-field"]';
    this.saveBtn = '[data-test="workflow-editor-save"]';
    this.testBtn = '[data-test="workflow-editor-test"]';
    this.cancelBtn = '[data-test="workflow-editor-cancel"]';
    this.backBtn = '[data-test="workflow-editor-back"]';
    // Docked palette (the reliable click-to-append add path; the hover-`+` add-out on a node
    // is display:none until hover so it can't be clicked directly). Verified live 2026-07-21.
    // Pattern: workflow-palette-<key>-<ioType>-btn (destination=output, condition/function=default).
    this.paletteCondition = '[data-test="workflow-palette-condition-default-btn"]';
    this.paletteFunction = '[data-test="workflow-palette-function-default-btn"]';
    this.paletteDestination = '[data-test="workflow-palette-destination-output-btn"]';
    // Trigger node (add-out/delete only visible on node hover)
    this.triggerNode = '[data-test="workflow-node-workflow_trigger"]';
    this.triggerAddOut = '[data-test="workflow-node-workflow_trigger-add-out"]';
    this.triggerDelete = '[data-test="workflow-node-workflow_trigger-delete-btn"]';
    // Step picker dialog (hover-`+` path); options keyed by node_type
    this.stepCondition = '[data-test="workflow-step-condition"]';
    this.stepFunction = '[data-test="workflow-step-function"]';
    this.stepDestination = '[data-test="workflow-step-destination"]';
    // Node config drawer (generic O2 drawer). An overlay (o-drawer-overlay) intercepts canvas
    // clicks while a drawer is open, and the trigger drawer auto-opens on /add — close it first.
    this.nodeDrawer = '[data-test="workflow-node-drawer"]';
    this.drawerClose = '[data-test="o-drawer-close-btn"]';
    this.drawerPrimary = '[data-test="o-drawer-primary-btn"]';
    this.drawerSecondary = '[data-test="o-drawer-secondary-btn"]';
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

  // Workflows is an Enterprise-only feature. On OSS builds the API returns 404/403 and the menu is
  // hidden, so specs must skip rather than fail. Probe the list endpoint to decide.
  async isAvailable() {
    const url = `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}/workflows`;
    try {
      const resp = await this.page.request.get(url);
      return resp.status() !== 404 && resp.status() !== 403;
    } catch (_e) {
      return false;
    }
  }

  // ---------- navigation ----------
  async goToList() {
    const url = `${process.env.ZO_BASE_URL}/web/workflows?org_identifier=${getOrgIdentifier()}`;
    await this.page.goto(url, { timeout: 60000 });
    await this.waitForListReady();
  }

  async goToAdd() {
    const url = `${process.env.ZO_BASE_URL}/web/workflows/add?org_identifier=${getOrgIdentifier()}&trigger=alert_fired`;
    await this.page.goto(url, { timeout: 60000 });
    await this.page.locator(this.nameField).waitFor({ state: 'attached', timeout: DRAWER_TIMEOUT_MS });
  }

  async waitForListReady() {
    // K10: list GET is slow; wait for either rows or the empty-state, not "Loading data".
    await this.page.locator(this.listTable).first().waitFor({ state: 'visible', timeout: LIST_TIMEOUT_MS });
    await this.page.locator('text=Loading data')
      .waitFor({ state: 'detached', timeout: LIST_TIMEOUT_MS }).catch(() => {});
  }

  // ---------- editor helpers ----------
  async setName(name) {
    await this.page.locator(this.nameField).fill(name);
  }

  // ---------- assertions (keep raw locators out of specs) ----------
  async expectNameValue(name) {
    await expect(this.page.locator(this.nameField)).toHaveValue(name);
  }

  async expectEditorVisible() {
    await expect(this.page.locator(this.editorPage)).toBeVisible();
  }

  async expectListVisible() {
    await expect(this.page.locator(this.listTable).first()).toBeVisible();
  }

  async setDescription(desc) {
    await this.page.locator(this.descField).fill(desc);
  }

  // K9: bypass the tooltip that intercepts pointer events on Save.
  async clickSave() {
    await this.page.evaluate((sel) => {
      const b = document.querySelector(sel);
      if (!b) throw new Error('save button not found: ' + sel);
      b.click();
    }, this.saveBtn);
  }

  /**
   * K9: attempt a PLAIN Playwright click on Save (no JS bypass). Returns true if it was
   * intercepted (Save is covered by the tooltip overlay so the click never lands). Documents the
   * K9 bug and acts as a regression marker — if K9 is fixed this returns false and the test fails.
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

  /** The trigger's config drawer auto-opens on /add; its overlay blocks canvas/palette clicks. */
  async closeOpenDrawer() {
    const close = this.page.locator(this.drawerClose);
    if (await close.count()) {
      await close.first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
      await this.page.locator('[data-test="o-drawer-overlay"]')
        .waitFor({ state: 'detached', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    }
  }

  /**
   * Append a node from the docked palette (auto-wires after the end node) and wait for its
   * config drawer. The palette is the reliable add path — the on-node hover-`+` is hidden.
   */
  async addNodeFromPalette(type /* 'condition' | 'function' | 'destination' */) {
    await this.closeOpenDrawer();
    const paletteSel = { condition: this.paletteCondition, function: this.paletteFunction, destination: this.paletteDestination }[type];
    await this.page.locator(paletteSel).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.nodeDrawer).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
  }

  /**
   * In an open Destination node drawer, create a new remote destination inline via the 2-step
   * wizard (Choose Type -> Connection) and bind it to the node.
   */
  async createDestinationInline({ name, url, type = 'custom' }) {
    await this.page.locator(this.destPickerCreateToggle).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.destTypeCard(type)).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.destStep1Continue).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.destNameField).waitFor({ state: 'attached', timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.destNameField).fill(name);
    await this.page.locator(this.destUrlField).fill(url);
    await this.page.locator(this.destSubmitBtn).click({ timeout: DRAWER_TIMEOUT_MS });
  }

  /**
   * Open the Test drawer from the editor and run the saved graph against the (pre-filled) sample
   * payload. Per-node results paint as ✓/✗ badges on the canvas nodes afterwards.
   */
  async testRunFromEditor() {
    await this.page.locator(this.testBtn).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator('[data-test="workflow-test-drawer"]').waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
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

  /** Commit the node config drawer (binds the node) and wait for it to close. */
  async saveNodeDrawer() {
    await this.page.locator(this.drawerPrimary).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.nodeDrawer).waitFor({ state: 'detached', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
  }

  /** If a node drawer is still open, commit it; otherwise no-op (some inline saves auto-close). */
  async bindNodeDrawerIfOpen() {
    const drawer = this.page.locator(this.nodeDrawer);
    if (await drawer.isVisible().catch(() => false)) {
      await this.page.locator(this.drawerPrimary).click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
      await drawer.waitFor({ state: 'detached', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    }
  }

  /**
   * In an open Function node drawer, open the inline "create function" form, type code into the
   * (QuickJS/JavaScript) editor, attempt to save, and return the resulting toast text. Used to
   * assert that INVALID function code is rejected gracefully (a compile-error message, no crash).
   */
  async attemptCreateFunction({ name, code }) {
    await this.page.locator('[data-test="create-function-toggle-btn"]').click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator('[data-test="add-function-name-input-field"]').waitFor({ state: 'attached', timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator('[data-test="add-function-name-input-field"]').fill(name);
    // Function code editor (workflow functions run on QuickJS — JavaScript, not VRL).
    const editor = this.page.locator('[data-test="logs-vrl-function-editor"]');
    await editor.click();
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await this.page.keyboard.type(code);
    await this.page.locator('[data-test="add-function-save-btn"]').click({ timeout: DRAWER_TIMEOUT_MS });
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
  async buildTriggerToDestinationAndSave({ name, destName, url }) {
    await this.goToAdd();
    await this.setName(name);
    await this.addNodeFromPalette('destination');
    await this.createDestinationInline({ name: destName, url });
    await this.saveNodeDrawer();
    await this.clickSave();
    await this.skipLinkAlerts();
  }


  /**
   * Save the workflow. Returns the toast/validation text so callers can assert
   * (e.g. trigger-only save -> "Add At Least One Step After The Trigger").
   */
  async saveAndCaptureResult() {
    await this.clickSave();
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
    await this.page.locator(`[data-test="workflow-list-${name}-edit"]`).first().click({ timeout: DRAWER_TIMEOUT_MS });
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

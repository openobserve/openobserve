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
    // OInput/OTable put the consumer data-test on a NON-interactive wrapper; the real <input>
    // is exposed as `<name>-field`, and OTable's container is `o2-table-root` (the consumer
    // `workflow-list-table` never renders). Target those, not the wrapper.
    this.searchInput = '[data-test="workflow-list-search-input-field"]';
    this.listTable = '[data-test="o2-table-root"]';
    // Editor
    this.editorPage = '[data-test="workflow-editor-page"]';
    this.nameField = '[data-test="workflow-editor-name-field"]';
    this.descField = '[data-test="workflow-editor-description-field"]';
    this.saveBtn = '[data-test="workflow-editor-save"]';
    this.testBtn = '[data-test="workflow-editor-test"]';
    this.cancelBtn = '[data-test="workflow-editor-cancel"]';
    this.backBtn = '[data-test="workflow-editor-back"]';
    // Palette + trigger node — UNVERIFIED against merged markup (canvas-rendered; fixme-only).
    // TODO(Healer): discover real values on a live ENT build before enabling the node-building tests.
    this.paletteCondition = '[data-test="workflow-palette-condition-default-btn"]';
    this.paletteFunction = '[data-test="workflow-palette-function-default-btn"]';
    this.paletteDestination = '[data-test="workflow-palette-destination-output-btn"]';
    // Trigger node
    this.triggerNode = '[data-test="workflow-node-workflow_trigger"]';
    this.triggerAddOut = '[data-test="workflow-node-workflow_trigger-add-out"]';
    this.triggerDelete = '[data-test="workflow-node-workflow_trigger-delete-btn"]';
    // Step picker dialog
    this.stepCondition = '[data-test="workflow-step-condition"]';
    this.stepFunction = '[data-test="workflow-step-function"]';
    this.stepDestination = '[data-test="workflow-step-destination"]';
    // Node drawer (generic O2 drawer)
    this.nodeDrawer = '[data-test="workflow-node-drawer"]';
    this.drawerClose = '[data-test="o-drawer-close-btn"]';
    this.drawerPrimary = '[data-test="o-drawer-primary-btn"]';
    this.drawerSecondary = '[data-test="o-drawer-secondary-btn"]';
    // Destination picker (inside node drawer)
    this.destPicker = '[data-test="destination-picker"]';
    this.destPickerCreateToggle = '[data-test="destination-picker-create-toggle"]';
    this.destPickerSelectTrigger = '[data-test="destination-picker-select"]';
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

  async clickTest() {
    await this.page.evaluate((sel) => {
      const b = document.querySelector(sel);
      if (!b) throw new Error('test button not found: ' + sel);
      b.click();
    }, this.testBtn);
  }

  /** Open the "Add a step" picker from the trigger's + and choose a node type. */
  async addStepFromTrigger(type /* 'condition' | 'function' | 'destination' */) {
    await this.page.evaluate((sel) => {
      const b = document.querySelector(sel);
      if (!b) throw new Error('add-out not found');
      b.click();
    }, this.triggerAddOut);
    const stepSel = { condition: this.stepCondition, function: this.stepFunction, destination: this.stepDestination }[type];
    await this.page.locator(stepSel).click({ timeout: DRAWER_TIMEOUT_MS });
    await this.page.locator(this.nodeDrawer).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
  }

  /** In the Destination node drawer, select an existing destination by name. */
  async selectExistingDestination(destName) {
    await this.page.locator(this.destPickerSelectTrigger).click();
    await this.page.locator(`[data-test$="-popover"] [data-test$="-option"]`, { hasText: destName })
      .first().click();
    await this.page.locator(this.drawerPrimary).click();
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

  rowByName(name) {
    return this.page.locator(`tr`, { hasText: name }).first();
  }

  async openEdit(name) {
    const row = await this.rowByName(name);
    await row.locator('[data-test*="edit"], button[title*="Edit" i]').first().click();
    await this.page.locator(this.editorPage).waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS });
  }

  /** Delete via row action. Returns any error toast (delete-protected when linked to an alert). */
  async deleteByName(name) {
    const row = await this.rowByName(name);
    await row.locator('[data-test*="delete"], button[title*="Delete" i]').first().click();
    // confirm dialog
    await this.page.locator('[data-test$="-confirm-button"], button:has-text("OK"), button:has-text("Delete")')
      .first().click({ timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    const toast = this.page.locator('[role="alert"], .q-notification__message').first();
    await toast.waitFor({ state: 'visible', timeout: DRAWER_TIMEOUT_MS }).catch(() => {});
    return (await toast.textContent().catch(() => '') || '').trim();
  }

  async isPresent(name) {
    await this.waitForListReady();
    return (await this.rowByName(name).count()) > 0;
  }

  // ---------- enable / disable ----------
  async toggleEnable(name) {
    const row = await this.rowByName(name);
    await row.locator('[role="switch"], input[type="checkbox"]').first().click();
  }
}

module.exports = WorkflowsPage;

// Dashboard add-panel Query Type Selector page object.
// Centralizes the SQL/PromQL + Builder/Custom toggle groups and the
// change-query-mode confirmation dialog. Selection is signaled by reka-ui
// `data-state="on"/"off"` (never a CSS class), and the PromQL item is `v-if`-ed
// on stream_type == "metrics", so its absence must be asserted via count.

const { expect } = require("@playwright/test");
const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class DashboardQueryTypeSelector {
  constructor(page) {
    this.page = page;

    // Query language toggle group (SQL <-> PromQL)
    this.sqlItem = page.locator('[data-test="dashboard-sql-query-type"]');
    this.promqlItem = page.locator('[data-test="dashboard-promql-query-type"]');

    // Editing-mode toggle group (Builder <-> Custom)
    this.builderItem = page.locator('[data-test="dashboard-builder-query-type"]');
    this.customItem = page.locator('[data-test="dashboard-custom-query-type"]');

    // Unified query editor (Monaco), visible/editable in Custom mode
    this.queryEditor = page.locator('[data-test="dashboard-panel-query-editor"]');

    // Change-query-mode confirmation dialog (ODialog, teleported to body)
    this.confirmDialog = page.locator('[data-test="confirm-dialog"]');
    this.confirmOkBtn = page.locator(
      '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
    );
    this.confirmCancelBtn = page.locator(
      '[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]',
    );
  }

  // ----- Selection-state assertions (reka-ui data-state) -------------------

  async expectSqlSelected() {
    await expect(this.sqlItem).toHaveAttribute("data-state", "on", { timeout: 10000 });
  }

  async expectSqlNotSelected() {
    await expect(this.sqlItem).toHaveAttribute("data-state", "off", { timeout: 10000 });
  }

  async expectPromqlSelected() {
    await expect(this.promqlItem).toHaveAttribute("data-state", "on", { timeout: 10000 });
  }

  async expectPromqlNotSelected() {
    await expect(this.promqlItem).toHaveAttribute("data-state", "off", { timeout: 10000 });
  }

  async expectBuilderSelected() {
    await expect(this.builderItem).toHaveAttribute("data-state", "on", { timeout: 10000 });
  }

  async expectBuilderNotSelected() {
    await expect(this.builderItem).toHaveAttribute("data-state", "off", { timeout: 10000 });
  }

  async expectCustomSelected() {
    await expect(this.customItem).toHaveAttribute("data-state", "on", { timeout: 10000 });
  }

  async expectCustomNotSelected() {
    await expect(this.customItem).toHaveAttribute("data-state", "off", { timeout: 10000 });
  }

  // Wait (not sample) for the PromQL item to mount on a metrics stream type.
  async expectPromqlVisible() {
    await expect(this.promqlItem).toBeVisible({ timeout: 15000 });
  }

  // PromQL never mounts on a logs stream — assert absence via count, not visibility.
  async expectPromqlAbsent() {
    await expect(this.promqlItem).toHaveCount(0);
  }

  async expectQueryEditorVisible() {
    await expect(this.queryEditor).toBeVisible({ timeout: 15000 });
  }

  // ----- Mode switching ----------------------------------------------------

  // Query-type switches (SQL <-> PromQL) never prompt; wait for the target on-state.
  async switchToSql() {
    await this.sqlItem.waitFor({ state: "visible", timeout: 10000 });
    await this.sqlItem.click();
    await expect(this.sqlItem).toHaveAttribute("data-state", "on", { timeout: 10000 });
  }

  // Builder -> Custom is always immediate (no dialog); wait for the on-state.
  async switchToCustom() {
    await this.customItem.waitFor({ state: "visible", timeout: 10000 });
    await this.customItem.click();
    await expect(this.customItem).toHaveAttribute("data-state", "on", { timeout: 10000 });
  }

  // Custom -> Builder opens the confirmation dialog when a query is written,
  // so this only clicks; the caller asserts dialog-vs-selection.
  async switchToBuilder() {
    await this.builderItem.waitFor({ state: "visible", timeout: 10000 });
    await this.builderItem.click();
  }

  // ----- Confirmation dialog ------------------------------------------------

  async expectConfirmDialogVisible() {
    await expect(this.confirmDialog).toBeVisible({ timeout: 10000 });
  }

  async expectConfirmDialogHidden() {
    await expect(this.confirmDialog).toBeHidden({ timeout: 10000 });
  }

  async confirmOk() {
    await this.confirmOkBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.confirmOkBtn.click();
  }

  async confirmCancel() {
    await this.confirmCancelBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.confirmCancelBtn.click();
  }

  // ----- Query editor read/write -------------------------------------------

  // Current value of the panel query editor's Monaco model.
  async getQueryEditorValue() {
    return this.page.evaluate(() => {
      const m = window.monaco;
      const editors = m?.editor?.getEditors?.() || [];
      const editor = editors[editors.length - 1];
      if (!editor) return "";
      const model = editor.getModel();
      return model ? model.getValue() : "";
    });
  }

  // Write a custom query into the Monaco model, then wait for it to propagate
  // to the panel state. The Monaco -> Vue query sync is debounced (~500ms), so
  // without the settle a Custom -> Builder switch could still see an empty query.
  async writeCustomQuery(query) {
    await this.queryEditor.waitFor({ state: "visible", timeout: 10000 });
    await this.page.evaluate((value) => {
      const m = window.monaco;
      if (!m?.editor) return;
      const editors = m.editor.getEditors();
      const editor = editors[editors.length - 1];
      if (!editor) return;
      editor.focus();
      editor.setValue(value);
    }, query);
    await expect
      .poll(async () => await this.getQueryEditorValue(), { timeout: 10000 })
      .toBe(query);
    await this.page.waitForTimeout(600);
  }
}

// Query Values variable editor (Auto | Custom, SQL | PromQL, filter groups) and its dashboard dropdown.
// Covers AddSettingVariable.vue + QueryVariableEditor.vue; filters reuse the shared FilterBuilderDriver.
import { expect } from "@playwright/test";
import MonacoEditorHelper from "../../playwright-tests/utils/MonacoEditorHelper.js";
import { FilterBuilderDriver } from "../generalPages/filterBuilderPage.js";
import DashboardSetting from "./dashboard-settings.js";
import { SELECTORS } from "./dashboard-selectors.js";
import {
  selectStreamType,
  selectStreamFromDropdown,
  selectFieldFromDropdown,
} from "./dashboard-stream-field-utils.js";

const tid = (id) => `[data-test="${id}"]`;
const isDashboardPut = (r) =>
  /\/api\/[^/]+\/dashboards\/[^/?]+/.test(r.url()) && r.request().method() === "PUT";

export default class DashboardQueryVariable {
  constructor(page) {
    this.page = page;
    this.settings = new DashboardSetting(page);
    this.monaco = new MonacoEditorHelper(page);
    this.filters = new FilterBuilderDriver(page, "dashboard-variable-filter-builder");

    this.drawer = page.locator(tid("dashboard-settings-drawer"));
    this.addVariableBtn = page.locator(tid("dashboard-add-variable-btn"));
    this.nameInput = page.locator(tid("dashboard-variable-name-field"));
    this.saveBtn = page.locator(tid("dashboard-variable-save-btn"));
    this.cancelBtn = page.locator(tid("dashboard-variable-cancel-btn"));

    this.modeAuto = page.locator(tid("dashboard-variable-query-mode-auto"));
    this.modeCustom = page.locator(tid("dashboard-variable-query-mode-custom"));
    this.languageRow = page.locator(tid("dashboard-variable-query-language-row"));
    this.languageSql = page.locator(tid("dashboard-variable-query-language-sql"));
    this.languagePromql = page.locator(tid("dashboard-variable-query-language-promql"));
    this.streamTypeTrigger = page.locator(tid("dashboard-variable-stream-type-select-trigger"));
    this.streamTrigger = page.locator(tid("dashboard-variable-stream-select-trigger"));
    this.fieldTrigger = page.locator(tid("dashboard-variable-field-select-trigger"));
    this.autoMaxRecordInput = page.locator(tid("dashboard-variable-max-record-size-field"));
    this.filterSection = page.locator(tid("dashboard-query-values-filter"));

    this.queryEditor = page.locator(tid("dashboard-variable-query-editor"));
    this.queryError = page.locator(tid("dashboard-variable-query-error"));
    this.functionsTrigger = page.locator(tid("dashboard-variable-query-functions-trigger"));
    this.functionsList = page.locator(tid("dashboard-variable-query-functions"));
    this.runPreviewBtn = page.locator(tid("dashboard-variable-query-run-preview"));
    this.previewIdle = page.locator(tid("dashboard-variable-query-preview-idle"));
    this.previewCount = page.locator(tid("dashboard-variable-query-preview-count"));
    this.previewCapped = page.locator(tid("dashboard-variable-query-preview-capped"));
    this.previewTable = page.locator(tid("dashboard-variable-query-preview-table"));
    this.previewValues = page.locator(tid("dashboard-variable-query-preview-values"));
    this.previewEmpty = page.locator(tid("dashboard-variable-query-preview-empty"));
    this.previewError = page.locator(tid("dashboard-variable-query-preview-error"));
    this.undefinedWarning = page.locator(tid("dashboard-variable-query-undefined-variables"));
    this.valueFieldTrigger = page.locator(tid("dashboard-variable-query-value-field-trigger"));
    this.labelFieldTrigger = page.locator(tid("dashboard-variable-query-label-field-trigger"));
    this.labelField = page.locator(tid("dashboard-variable-query-label-field"));
    this.customMaxRecordInput = page.locator(tid("dashboard-variable-query-max-record-size-field"));

    this.multiSelectToggle = page.locator(tid("dashboard-query_values-show_multiple_values-btn"));
    this.defaultFirst = page.locator(tid("dashboard-multi-select-default-value-toggle-first-value"));
    this.defaultAll = page.locator(tid("dashboard-multi-select-default-value-toggle-all-values"));
    this.defaultCustom = page.locator(tid("dashboard-multi-select-default-value-toggle-custom"));
    this.addCustomValueBtn = page.locator(tid("dashboard-add-custom-value-btn"));
    this.hideOnDashboardToggle = page.locator(tid("dashboard-variable-hide_on_dashboard-btn"));
  }

  // ---------- navigation ----------

  async openDashboard(url) {
    await this.page.goto(url);
    await this.page.locator(SELECTORS.MORE_OPTIONS_BTN).waitFor({ state: "visible", timeout: 30000 });
  }

  async openVariablesSettings() {
    const general = this.page.locator(tid("dashboard-settings-general-tab"));
    if (!(await general.isVisible().catch(() => false))) {
      // force: a variable bar whose chips keep re-fitting moves the toolbar, so it never counts as stable.
      await expect(async () => {
        await this.page.locator(SELECTORS.MORE_OPTIONS_BTN).click({ force: true });
        await this.page.locator(SELECTORS.SETTING_BTN).click({ force: true, timeout: 3000 });
        await expect(general).toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 30000, intervals: [500, 1000, 2000] });
    }
    await this.settings.openVariables();
    await this.addVariableBtn.waitFor({ state: "visible", timeout: 15000 });
  }

  async closeSettings() {
    await this.settings.closeSettingWindow();
    await this.drawer.waitFor({ state: "hidden", timeout: 10000 });
  }

  /** Opens a new variable form; Query Values is the default type. */
  async startNewVariable(name) {
    await this.addVariableBtn.click();
    await this.nameInput.waitFor({ state: "visible", timeout: 10000 });
    await this.nameInput.fill(name);
  }

  async setVariableType(type) {
    await this.page.locator(tid("dashboard-variable-type-select-trigger")).click();
    await this.page.locator(`${tid("dashboard-variable-type-select-option")}[data-test-value="${type}"]`).click();
    await expect(this.page.locator(tid("dashboard-variable-type-select-trigger"))).not.toContainText("Query Values");
  }

  async editVariable(name) {
    const edit = this.page.locator(tid(`dashboard-edit-variable-${name}`));
    await edit.waitFor({ state: "visible", timeout: 30000 });
    await edit.click();
    await this.saveBtn.waitFor({ state: "visible", timeout: 15000 });
  }

  // ---------- auto settings ----------

  async setAutoSource(streamType, stream, field) {
    await selectStreamType(this.page, streamType);
    if (stream) await selectStreamFromDropdown(this.page, stream);
    if (field) await selectFieldFromDropdown(this.page, field);
  }

  async setStreamType(streamType) {
    await selectStreamType(this.page, streamType);
  }

  async setStream(stream) {
    await selectStreamFromDropdown(this.page, stream);
  }

  async setField(field) {
    await selectFieldFromDropdown(this.page, field);
  }

  /** Field names the Auto field select offers for the chosen stream, `$variable` entries left out. */
  async fieldOptions() {
    await this.fieldTrigger.click();
    const options = this.page.locator(tid("dashboard-variable-field-select-option"));
    await options.first().waitFor({ state: "visible", timeout: 15000 });
    const values = await options.evaluateAll((els) => els.map((e) => e.getAttribute("data-test-value")));
    await this.page.keyboard.press("Escape");
    await this.page.locator(tid("dashboard-variable-field-select-popover")).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    return values.filter((v) => !v.startsWith("$"));
  }

  /**
   * Adds `field operator value` to the variable filters. A plain value is picked once the value list settles:
   * the "Use <typed>" row disappears when loaded values bring an exact match, so a single lookup can click a detached row.
   */
  async addFilter(field, operator, value, options = {}) {
    const plain = typeof value === "string" && value !== "" && !value.startsWith("$") && !/^(IN|NOT IN|in|not_in)$/.test(operator);
    if (!plain) return this.filters.addCondition(field, operator, value, options);
    await this.filters.openForNew(options.groupPath);
    await this.filters.pickField(field);
    await this.filters.pickOperator(operator);
    await this.filters.typeInPicker(value);
    const exact = this.filters.suggestion(value);
    const typed = this.page.locator('[data-test^="dashboard-variable-filter-builder-suggest-item-"][data-test$="custom"]').first();
    await expect(async () => {
      if (await exact.isVisible().catch(() => false)) await exact.click({ timeout: 2000 });
      else await typed.click({ timeout: 2000 });
    }).toPass({ timeout: 20000, intervals: [250, 500, 1000] });
    await this.filters.close();
  }

  /** `mode` is "auto" or "custom". */
  async setMode(mode) {
    const item = mode === "custom" ? this.modeCustom : this.modeAuto;
    await item.click();
    await expect(item).toHaveAttribute("data-state", "on");
    if (mode === "custom") await this.queryEditor.waitFor({ state: "visible", timeout: 10000 });
    else await this.filterSection.waitFor({ state: "visible", timeout: 10000 });
  }

  async expectMode(mode) {
    const item = mode === "custom" ? this.modeCustom : this.modeAuto;
    await expect(item).toHaveAttribute("data-state", "on", { timeout: 10000 });
  }

  /** `language` is "sql" or "promql". */
  async setLanguage(language) {
    const item = language === "promql" ? this.languagePromql : this.languageSql;
    await item.click();
    await expect(item).toHaveAttribute("data-state", "on");
  }

  async expectLanguage(language) {
    const item = language === "promql" ? this.languagePromql : this.languageSql;
    await expect(item).toHaveAttribute("data-state", "on", { timeout: 10000 });
  }

  /** Types into the visible max record size box (Auto or Custom); an empty string clears it. */
  async setMaxRecordSize(value) {
    const input = (await this.customMaxRecordInput.isVisible().catch(() => false))
      ? this.customMaxRecordInput
      : this.autoMaxRecordInput;
    await input.focus();
    await this.page.keyboard.press("ControlOrMeta+a");
    await this.page.keyboard.press("Backspace");
    if (value !== "" && value !== null && value !== undefined) await input.pressSequentially(String(value));
    await input.blur();
  }

  // ---------- custom query ----------

  /** Replaces the query as one user edit; the editor's own selection is used because a keyboard select-all can miss it. */
  async fillQuery(text) {
    await this.monaco.waitForReady(this.queryEditor);
    const input = this.monaco.getInputArea(this.queryEditor).first();
    await expect
      .poll(async () => {
        if ((await this.queryText()) === text) return true;
        await this.selectAllQuery();
        await input.fill(text, { force: true });
        return (await this.queryText()) === text;
      }, { timeout: 15000, intervals: [250, 500, 1000] })
      .toBe(true);
  }

  async clearQuery() {
    await this.monaco.waitForReady(this.queryEditor);
    await expect
      .poll(async () => {
        if ((await this.queryText()) === "") return true;
        await this.selectAllQuery();
        await this.page.keyboard.press("Backspace");
        return (await this.queryText()) === "";
      }, { timeout: 15000, intervals: [250, 500, 1000] })
      .toBe(true);
  }

  async selectAllQuery() {
    await this.queryEditor.evaluate((node) => {
      const editor = window.monaco?.editor?.getEditors?.().find((e) => node.contains(e.getDomNode()));
      editor?.focus();
      editor?.setSelection(editor.getModel().getFullModelRange());
    });
  }

  async queryText() {
    return this.queryEditor.evaluate((node) => {
      const editor = window.monaco?.editor?.getEditors?.().find((e) => node.contains(e.getDomNode()));
      return editor ? editor.getValue() : null;
    });
  }

  /** Runs the preview and waits until it leaves the loading state. */
  async runPreview() {
    await this.runPreviewBtn.click();
    await expect(
      this.previewCount.or(this.previewEmpty).or(this.previewError),
    ).toBeVisible({ timeout: 30000 });
  }

  /** The values a SQL preview table lists in its `column` column, or a PromQL preview's chips. */
  async previewTexts(column) {
    if (await this.previewValues.isVisible().catch(() => false)) {
      return (await this.previewValues.locator("> *").allInnerTexts()).map((t) => t.trim());
    }
    const headerCells = this.previewTable.locator('thead th[data-test^="o2-table-th-"]');
    await expect(headerCells.first()).toBeVisible({ timeout: 10000 });
    const headers = (await headerCells.allInnerTexts()).map((t) => t.trim());
    const index = column ? headers.indexOf(column) : 0;
    if (index < 0) throw new Error(`preview has no column ${column}; columns: ${headers.join(", ")}`);
    const cells = this.previewTable.locator(`tbody tr td:nth-child(${index + 1})`);
    return (await cells.allInnerTexts()).map((t) => t.trim());
  }

  async openFunctionsHelp() {
    await this.functionsTrigger.click();
    await this.functionsList.waitFor({ state: "visible", timeout: 10000 });
  }

  /** Function rows listed in the PromQL help popover, by their data-test id suffix. */
  functionRow(id) {
    return this.page.locator(tid(`dashboard-variable-query-function-${id}`));
  }

  async insertFunctionExample(id) {
    await this.page.locator(tid(`dashboard-variable-query-function-insert-${id}`)).click();
    await this.functionsList.waitFor({ state: "hidden", timeout: 5000 });
  }

  async selectValueColumn(column) {
    await this.pickColumn("dashboard-variable-query-value-field", column);
  }

  async selectLabelColumn(column) {
    await this.pickColumn("dashboard-variable-query-label-field", column);
  }

  async pickColumn(dataTest, column) {
    await this.page.locator(tid(`${dataTest}-trigger`)).click();
    const option = this.page.locator(`${tid(`${dataTest}-option`)}[data-test-value="${column}"]`);
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();
    await expect(this.page.locator(tid(`${dataTest}-trigger`))).toContainText(column);
  }

  async clearLabelColumn() {
    await this.labelField.getByRole("button", { name: "Clear selection" }).click();
    await expect(this.labelFieldTrigger).toHaveText("");
  }

  /** Column names offered by the Value column select. */
  async valueColumnOptions() {
    await this.valueFieldTrigger.click();
    const options = this.page.locator(tid("dashboard-variable-query-value-field-option"));
    await options.first().waitFor({ state: "visible", timeout: 10000 });
    const values = await options.evaluateAll((els) => els.map((e) => e.getAttribute("data-test-value")));
    await this.page.keyboard.press("Escape");
    return values;
  }

  // ---------- selection options ----------

  async setMultiSelect(on) {
    const checked = (await this.multiSelectToggle.getAttribute("aria-checked")) === "true";
    if (checked !== on) await this.multiSelectToggle.click();
    await expect(this.multiSelectToggle).toHaveAttribute("aria-checked", String(on));
  }

  async setHideOnDashboard(on) {
    const checked = (await this.hideOnDashboardToggle.getAttribute("aria-checked")) === "true";
    if (checked !== on) await this.hideOnDashboardToggle.click();
    await expect(this.hideOnDashboardToggle).toHaveAttribute("aria-checked", String(on));
  }

  /** `kind` is "first", "all" or "custom"; custom takes the default values to type. */
  async setDefaultSelection(kind, customValues = []) {
    const item = { first: this.defaultFirst, all: this.defaultAll, custom: this.defaultCustom }[kind];
    await item.click();
    for (let i = 0; i < customValues.length; i++) {
      const input = this.page.locator(tid(`dashboard-variable-custom-value-${i}-field`));
      if (!(await input.isVisible().catch(() => false))) await this.addCustomValueBtn.click();
      await input.fill(customValues[i]);
    }
  }

  // ---------- save ----------

  /** Saves and waits for the dashboard PUT; returns its response. */
  async save() {
    const put = this.page.waitForResponse(isDashboardPut, { timeout: 20000 });
    await this.saveBtn.click();
    const response = await put;
    expect(response.ok(), `dashboard save -> ${response.status()}`).toBe(true);
    await this.saveBtn.waitFor({ state: "hidden", timeout: 15000 });
    return response;
  }

  /** Clicks Save, waits for `reason` to show, and checks no dashboard PUT went out. */
  async expectSaveBlocked(reason) {
    const puts = [];
    const onRequest = (req) => {
      if (/\/api\/[^/]+\/dashboards\/[^/?]+/.test(req.url()) && req.method() === "PUT") puts.push(req.url());
    };
    this.page.on("request", onRequest);
    await this.saveBtn.click();
    await expect(reason).toBeVisible({ timeout: 10000 });
    await expect(this.saveBtn).toBeVisible();
    this.page.off("request", onRequest);
    expect(puts, "a blocked save must not send the dashboard").toEqual([]);
  }

  /** Any text shown inside the settings drawer. */
  drawerText(text) {
    return this.drawer.getByText(text, { exact: false }).first();
  }

  // ---------- dashboard dropdowns ----------

  selector(name) {
    return this.page.locator(tid(`variable-selector-${name}`));
  }

  trigger(name) {
    return this.page.locator(tid(`variable-selector-${name}-inner-trigger`));
  }

  popover(name) {
    return this.page.locator(tid(`variable-selector-${name}-inner-popover`));
  }

  shownValue(name) {
    return this.page.locator(tid(`variable-selector-${name}-inner-value`));
  }

  optionItems(name) {
    return this.page.locator(tid(`variable-selector-${name}-inner-option`));
  }

  async openDropdown(name) {
    const popover = this.popover(name);
    await expect(async () => {
      // force: a multi-select showing two chips can flip between its chip layouts and keep later selectors moving.
      if (!(await popover.isVisible().catch(() => false))) await this.trigger(name).click({ force: true });
      await expect(popover).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30000, intervals: [500, 1000, 2000] });
    await expect(popover.locator('[role="status"]')).toHaveCount(0, { timeout: 30000 });
  }

  async closeDropdown(name) {
    if (!(await this.popover(name).isVisible().catch(() => false))) return;
    await this.page.keyboard.press("Escape");
    await this.popover(name).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  /** The dropdown's options as { value, label }, read with the popover open then closed again. */
  async readOptions(name) {
    await this.openDropdown(name);
    const options = await this.optionItems(name).evaluateAll((els) =>
      els.map((e) => ({ value: e.getAttribute("data-test-value"), label: e.getAttribute("data-test-label") })),
    );
    await this.closeDropdown(name);
    return options;
  }

  /** Polls until the dropdown lists exactly `values` (any order). */
  async expectOptionValues(name, values, timeout = 45000) {
    const want = [...values].sort();
    await expect
      .poll(async () => (await this.readOptions(name)).map((o) => o.value).sort(), { timeout, intervals: [1000, 2000, 3000] })
      .toEqual(want);
  }

  async expectOptions(name, options, timeout = 45000) {
    const key = (list) => list.map((o) => `${o.value}=>${o.label}`).sort();
    await expect
      .poll(async () => key(await this.readOptions(name)), { timeout, intervals: [1000, 2000, 3000] })
      .toEqual(key(options));
  }

  async expectNoData(name, timeout = 45000) {
    await expect
      .poll(
        async () => {
          await this.openDropdown(name);
          const empty = await this.popover(name)
            .locator(tid("variable-query-value-selector-no-data"))
            .isVisible()
            .catch(() => false);
          const count = await this.optionItems(name).count();
          await this.closeDropdown(name);
          return empty && count === 0;
        },
        { timeout, intervals: [1000, 2000, 3000] },
      )
      .toBe(true);
  }

  /** Picks one value of a single-select dropdown. */
  async selectOption(name, value) {
    await this.openDropdown(name);
    const option = this.page.locator(`${tid(`variable-selector-${name}-inner-option`)}[data-test-value="${value}"]`);
    await option.waitFor({ state: "visible", timeout: 15000 });
    await option.click();
    await this.popover(name).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  /** Sets a multi-select dropdown to exactly `values`; the selection is emitted when the popover closes. */
  async selectOptions(name, values) {
    await this.openDropdown(name);
    const items = this.optionItems(name);
    await items.first().waitFor({ state: "visible", timeout: 15000 });
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const value = await item.getAttribute("data-test-value");
      const checked = (await item.locator("[data-select-checkbox] svg").count()) > 0;
      if (checked !== values.includes(value)) await item.click();
    }
    await this.closeDropdown(name);
  }

  /** The single-select "All" row. */
  async selectAll(name) {
    await this.openDropdown(name);
    await this.popover(name).getByText("All", { exact: true }).click();
    await this.closeDropdown(name);
  }

  /** The multi-select "Select All" row. */
  async selectAllMulti(name) {
    await this.openDropdown(name);
    await this.popover(name).getByText("Select All", { exact: true }).click();
    await this.closeDropdown(name);
  }

  async refreshDashboard() {
    await this.page.locator(SELECTORS.REFRESH_BTN).click();
  }
}

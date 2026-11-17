import { expect } from "@playwright/test";
import { FilterBuilderDriver, NO_VALUE_OPERATORS } from "../generalPages/filterBuilderPage.js";

// Panel filters are the shared FilterBuilder (horizontal chips) with this test-id prefix.
const DT = "dashboard-filter-builder";
const VALUE_PLACEHOLDERS = ["Search or type a value", "Search values"];

export default class DashboardFilter {
  constructor(page) {
    this.page = page;
    this.builder = new FilterBuilderDriver(page, DT);
    this.pendingConnector = null;
  }

  get chips() {
    return this.builder.chips;
  }

  async chipAt(index, fieldName) {
    if (fieldName) {
      const byField = this.builder.chip(fieldName);
      if ((await byField.count()) === 1) return byField;
    }
    return this.chips.nth(index);
  }

  async chipPart(chip, part) {
    const testId = await chip.getAttribute("data-test");
    return chip.locator(`[data-test="${testId}-${part}"]`);
  }

  async valueStepOpen() {
    const boxes = [this.page.locator(this.builder.sel("search")).last(), this.builder.barInput];
    for (const box of boxes) {
      if (!(await box.isVisible().catch(() => false))) continue;
      if (VALUE_PLACEHOLDERS.includes(await box.getAttribute("placeholder"))) return true;
    }
    return false;
  }

  // Opens the field list for a new condition (in the open group, if any).
  async clickAddConditionBtn() {
    await this.builder.openForNew();
  }

  // Typing "(" opens a group; the conditions added next land inside it.
  async clickAddGroupOption() {
    await this.builder.openForNew();
    await this.builder.typeInPicker("(");
  }

  // A group opened while another is open nests inside it.
  async clickAddGroupOptionLast() {
    await this.clickAddGroupOption();
  }

  // Typing ")" leaves the open group, so the next condition is added after it.
  async closeGroup() {
    await this.builder.openForNew();
    await this.builder.typeInPicker(")");
  }

  // Group 0 is the whole filter; 1.. are the groups in document order (outer before nested).
  getGroup(groupIndex) {
    if (groupIndex === 0) return this.builder.root;
    return this.page.locator(`[data-test^="${DT}-group-"]`).nth(groupIndex - 1);
  }

  /** Every group box of the filter, outer before nested. */
  get groups() {
    return this.page.locator(`[data-test^="${DT}-group-"]`);
  }

  async waitForGroupVisible(groupIndex) {
    await this.getGroup(groupIndex).waitFor({ state: "attached" });
  }

  async clickAddConditionInGroup(_groupIndex) {
    await this.builder.openForNew();
  }

  async clickRemoveCondition(index = 0) {
    await (await this.chipPart(this.chips.nth(index), "remove")).click();
  }

  getAddConditionLabel(_index, fieldName) {
    return this.builder.chip(fieldName).first();
  }

  // The AND/OR before item `index` of the root, or of a group by path ("2-1").
  getConnector(index) {
    return this.page.locator(this.builder.sel(`connector-${index}`));
  }

  // A connector is a toggle, so the choice is applied by selectOperatorOption.
  async clickLogicalOperator(index) {
    this.pendingConnector = this.getConnector(index);
  }

  async selectOperatorOption(name) {
    const connector = this.pendingConnector;
    this.pendingConnector = null;
    if (!connector) throw new Error("clickLogicalOperator must be called first");
    if ((await connector.innerText()).trim() !== name) await connector.click();
    await expect(connector).toHaveText(name);
  }

  /** Sets chip `index` to `newFieldName`/`operator`/`value`, or adds that condition when there is no chip `index` yet. */
  async addFilterCondition(index, initialFieldName, newFieldName, operator, value) {
    await this.builder.close();
    if ((await this.chips.count()) <= index) {
      await this.builder.addCondition({ field: newFieldName || initialFieldName, operator, value });
      await this.builder.close();
      return;
    }
    let chip = await this.chipAt(index, initialFieldName);
    if (newFieldName) {
      await (await this.chipPart(chip, "field")).click();
      await this.builder.pickField(newFieldName);
      await this.builder.close();
      chip = await this.chipAt(index, newFieldName);
    }
    if (!operator && !value) return;
    let id = "eq";
    if (operator) {
      await (await this.chipPart(chip, "operator")).click();
      await this.builder.waitForPicker();
      id = await this.builder.pickOperator(operator);
    }
    if (!value || NO_VALUE_OPERATORS.has(id)) return this.builder.close();
    // A value the chip already had is kept by an operator change; the value part replaces it.
    if (!(await this.valueStepOpen())) {
      await this.builder.close();
      await (await this.chipPart(chip, "value")).click();
      await this.builder.waitForPicker();
    }
    await this.builder.enterValues(id, value);
    await this.builder.close();
  }

  async openListValues(index, fieldName) {
    await this.builder.close();
    const chip = await this.chipAt(index, fieldName);
    const hasValue = (await (await this.chipPart(chip, "value")).count()) > 0;
    await (await this.chipPart(chip, hasValue ? "value" : "operator")).click();
    await this.builder.waitForPicker();
    if (!hasValue) await this.builder.pickOperator("IN");
  }

  // Ticks loaded values for an IN on the chip at `index`, e.g. ["ingress-nginx", "kube-system"].
  async selectListFilterItems(index, fieldName, values) {
    await this.openListValues(index, fieldName);
    for (const value of values) {
      const option = this.builder.suggestion(value);
      await option.waitFor({ state: "visible", timeout: 15000 });
      await option.click();
    }
    await this.page.locator(this.builder.sel("apply")).click();
    await this.builder.close();
  }

  // Searches the field's values and ticks one for an IN on the chip at `index`.
  async applyListConditionBySearch(index, fieldName, searchValue, optionValue) {
    await this.openListValues(index, fieldName);
    await this.builder.typeInPicker(searchValue);
    const option = this.builder.suggestion(optionValue);
    await option.waitFor({ state: "visible", timeout: 15000 });
    await option.click();
    await this.page.locator(this.builder.sel("apply")).click();
    await this.builder.close();
  }

  // Adds a condition to the group opened just before; the list stays open for the next one.
  async addGroupFilterCondition(_index, newFieldName, operator, value) {
    await this.builder.addCondition({ field: newFieldName, operator, value });
  }

  // Adds a condition to the open group and checks it landed in group `groupIndex`.
  async addNestedGroupFilterCondition(groupIndex, _conditionIndex, fieldName, operator, value) {
    await this.builder.addCondition({ field: fieldName, operator, value });
    await expect(this.getGroup(groupIndex).locator(`[data-test="${DT}-chip-${fieldName}"]`).first()).toBeVisible();
  }

  /** Leaf conditions in the current query's filter, nested ones included. */
  async conditionCount() {
    const layout = this.page.locator('[data-test="dashboard-filter-layout"][data-condition-count]').first();
    return Number(await layout.getAttribute("data-condition-count"));
  }
}

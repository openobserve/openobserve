// Drives the shared FilterBuilder (web/src/components/filterBar/FilterBuilder.vue) on every page, by its data-test prefix.
// Every test id is `${prefix}-<part>`; picker rows live in a popover rendered at the page root.
const { expect } = require("@playwright/test");

// Saved and wire spellings older specs pass, mapped onto the builder's operator ids; a tree id maps to itself.
const OPERATOR_IDS = {
  "=": "eq",
  "!=": "neq",
  "<>": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  IN: "in",
  "NOT IN": "not_in",
  Contains: "contains",
  str_match: "contains",
  str_match_ignore_case: "contains_ci",
  NotContains: "not_contains",
  "Not Contains": "not_contains",
  "Starts With": "starts_with",
  "Ends With": "ends_with",
  re_match: "regex",
  re_not_match: "not_regex",
  "=~": "regex",
  "!~": "not_regex",
  "Is Null": "is_null",
  "Is Not Null": "is_not_null",
  "Is Empty": "is_empty",
  "Is Not Empty": "is_not_empty",
};

const LIST_OPERATORS = new Set(["in", "not_in"]);
const NO_VALUE_OPERATORS = new Set(["is_null", "is_not_null", "is_empty", "is_not_empty"]);

// The chip's operator text for an id, as the builder labels it.
const OPERATOR_LABELS = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  contains: "Contains",
  contains_ci: "Contains (ignore case)",
  not_contains: "Not Contains",
  is_null: "Is Null",
  is_not_null: "Is Not Null",
  is_empty: "Is Empty",
  is_not_empty: "Is Not Empty",
  in: "IN",
  not_in: "NOT IN",
};

const operatorId = (operator) => {
  const id = OPERATOR_IDS[operator] ?? operator;
  if (!id) throw new Error(`Unknown filter operator "${operator}"`);
  return id;
};

const VARIABLE = /^\$(\w+)$/;

class FilterBuilderDriver {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} dataTest the builder's data-test prefix, e.g. "alert-conditions"
   * @param {import('@playwright/test').Locator} [scope] narrows chip lookups to one builder when a page has several
   */
  constructor(page, dataTest, scope) {
    this.page = page;
    this.dataTest = dataTest;
    this.prefix = dataTest;
    this.scope = scope ?? page;
  }

  id(part) {
    return `[data-test="${this.dataTest}-${part}"]`;
  }

  sel(part) {
    return this.id(part);
  }

  /** Test ids that live in the picker popover are rendered at the page root. */
  popover(part) {
    return this.page.locator(this.id(part));
  }

  get root() {
    return this.scope.locator(this.id("root")).first();
  }

  get barInput() {
    return this.scope.locator(this.id("input")).first();
  }

  get suggestions() {
    return this.page.locator(this.id("suggest")).last();
  }

  get suggestList() {
    return this.suggestions;
  }

  suggestion(key) {
    return this.page.locator(this.id(`suggest-item-${key}`)).first();
  }

  /** Every condition chip in document order, nested groups and locked parts included. */
  get chips() {
    return this.scope.locator(
      `[data-test^="${this.dataTest}-chip-"]:not([data-test$="-field"]):not([data-test$="-operator"]):not([data-test$="-value"]):not([data-test$="-remove"])`,
    );
  }

  /** Chips keyed by field (a locked part is `locked`); every match unless `nth` is given. */
  chip(field, nth) {
    const all = this.scope.locator(this.id(`chip-${field}`));
    return nth === undefined ? all : all.nth(nth);
  }

  chipAt(index) {
    return this.chips.nth(index);
  }

  /** The value parts of finished chips; unary chips have none. */
  get valueParts() {
    return this.scope.locator(`[data-test^="${this.dataTest}-chip-"][data-test$="-value"]`);
  }

  get connectors() {
    return this.scope.locator(`[data-test^="${this.dataTest}-connector-"]`);
  }

  get issues() {
    return this.scope.locator(this.id("issues"));
  }

  async waitReady(timeout = 15000) {
    await this.root.waitFor({ state: "visible", timeout });
  }

  async isPickerOpen() {
    return this.suggestions.isVisible().catch(() => false);
  }

  async pickerOpen() {
    return this.isPickerOpen();
  }

  async waitForPicker() {
    await this.suggestions.waitFor({ state: "visible", timeout: 10000 });
  }

  /** The box the picker reads: the in-list search while a chip or nested group opened it, else the bar input. */
  async typeInPicker(text) {
    const search = this.page.locator(this.id("search")).last();
    if (await search.isVisible().catch(() => false)) {
      await search.fill(text);
    } else if (await this.barInput.isVisible().catch(() => false)) {
      await this.barInput.fill(text);
    } else if (text === "") {
      await this.page.keyboard.press("ControlOrMeta+A");
      await this.page.keyboard.press("Backspace");
    } else {
      await this.page.keyboard.type(text, { delay: 20 });
    }
    await this.page.waitForTimeout(250);
  }

  async close() {
    if (!(await this.isPickerOpen())) return;
    await this.page.keyboard.press("Escape");
    await this.suggestions.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  async closePicker() {
    await this.close();
  }

  /** Opens the field list for a new condition: the empty line, a group's "Add condition", or the bar input. */
  async openForNew(groupPath) {
    if (await this.isPickerOpen()) return;
    const empty = this.root.locator(this.id("empty-row"));
    const suffix = groupPath ? `-${groupPath}` : "";
    const add = this.root.locator(this.id(`add-condition${suffix}`)).last();
    if (!groupPath && (await empty.isVisible().catch(() => false))) await empty.click();
    else if (await add.isVisible().catch(() => false)) await add.click();
    else await this.barInput.click();
    await this.waitForPicker();
  }

  async openNewCondition(groupPath) {
    await this.openForNew(groupPath);
  }

  async openPicker() {
    await this.openForNew();
  }

  async pickSuggestion(key) {
    const row = this.suggestion(key);
    await row.waitFor({ state: "visible", timeout: 10000 });
    await row.click();
    await this.page.waitForTimeout(250);
  }

  /** Picks a listed field, else the "Use field" row for a custom one, else the first listed field. */
  async pickField(field, search) {
    await this.waitForPicker();
    await this.typeInPicker(search ?? field);
    const listed = this.suggestion(field);
    const custom = this.page.locator(`[data-test^="${this.dataTest}-suggest-item-"][data-test$="custom-field"]`).first();
    if (await listed.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false)) {
      await listed.click();
    } else if (await custom.isVisible().catch(() => false)) {
      await custom.click();
    } else if (search) {
      await this.page.keyboard.press("Enter");
    } else {
      await this.typeInPicker("");
      await this.page.locator(`[data-test^="${this.dataTest}-suggest-item-"]:not([data-test$="group"])`).first().click();
    }
    await this.page.waitForTimeout(250);
  }

  async chooseField(field) {
    await this.pickField(field);
  }

  async pickOperator(operator) {
    const id = operatorId(operator);
    await this.pickSuggestion(id);
    return id;
  }

  /** Clicks the "Use <typed>" row when the typed text is not a listed value or field. */
  async pickTyped(text) {
    const exact = this.suggestion(text);
    const custom = this.page.locator(`[data-test^="${this.dataTest}-suggest-item-"][data-test$="custom"]`).first();
    if (await exact.isVisible().catch(() => false)) await exact.click();
    else if (await custom.isVisible().catch(() => false)) await custom.click();
    else await this.page.keyboard.press("Enter");
    await this.page.waitForTimeout(250);
  }

  // A multi-select `$name` is listed as `(${name})`, so a variable is searched by name and matched in every spelling.
  async pickValue(value) {
    const variable = VARIABLE.exec(value)?.[1];
    if (!variable) {
      await this.typeInPicker(value);
      return this.pickTyped(value);
    }
    await this.typeInPicker(variable);
    for (const candidate of [value, `(\${${variable}})`, `\${${variable}}`]) {
      const known = this.suggestion(candidate);
      if (await known.isVisible().catch(() => false)) {
        await known.click();
        await this.page.waitForTimeout(250);
        return;
      }
    }
    await this.typeInPicker(value);
    await this.pickTyped(value);
  }

  /** `value` is an array, or comma-separated text for `in` / `not_in` unless it holds a variable. */
  async enterValues(id, value) {
    if (NO_VALUE_OPERATORS.has(id)) return;
    const many = LIST_OPERATORS.has(id);
    let values = [String(value)];
    if (Array.isArray(value)) values = value.map(String);
    else if (many && !/\$|\{\{/.test(String(value)))
      values = String(value).split(",").map((v) => v.trim()).filter(Boolean);
    for (const v of values) await this.pickValue(v);
    if (many) await this.popover("apply").click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Adds a condition, either `addCondition(field, operator, value, { groupPath })` (closes the picker after) or
   * `addCondition({ field, operator, value | values, search, groupPath })` (leaves it open for the next condition).
   */
  async addCondition(fieldOrSpec, operator, value, options = {}) {
    const spec =
      typeof fieldOrSpec === "object"
        ? { close: false, ...fieldOrSpec, value: fieldOrSpec.values ?? fieldOrSpec.value }
        : { close: true, field: fieldOrSpec, operator, value, ...options };
    await this.openForNew(spec.groupPath);
    await this.pickField(spec.field, spec.search);
    const id = await this.pickOperator(spec.operator ?? "=");
    await this.enterValues(id, spec.value ?? "");
    if (spec.close) await this.close();
  }

  /** Builds a condition on the `position`-th listed field (0 is the first), for specs that take any column. */
  async addConditionOnListedField(position, operator, value) {
    await this.openForNew();
    const fields = this.page.locator(`[data-test^="${this.dataTest}-suggest-item-"]:not([data-test$="group"])`);
    await fields.first().waitFor({ state: "visible", timeout: 10000 });
    const count = await fields.count();
    const row = fields.nth(Math.min(position, count - 1));
    const field = (await row.getAttribute("data-test")).slice(`${this.dataTest}-suggest-item-`.length);
    await row.click();
    await this.page.waitForTimeout(250);
    const id = await this.pickOperator(operator);
    await this.enterValues(id, value);
    await this.close();
    return field;
  }

  /** Starts a nested group; the picker opens on its first condition. */
  async addGroup(groupPath) {
    const suffix = groupPath ? `-${groupPath}` : "";
    await this.root.locator(this.id(`add-group${suffix}`)).last().click();
    await this.page.waitForTimeout(400);
  }

  /** Switches the AND/OR in front of the row at `path` ("1", "2-1", ...). */
  async toggleConnector(path) {
    await this.close();
    await this.root.locator(this.id(`connector-${path}`)).click();
    await this.page.waitForTimeout(250);
  }

  async sameIdIndex(index, testId) {
    let n = 0;
    for (let i = 0; i < index; i++) {
      if ((await this.chipAt(i).getAttribute("data-test")) === testId) n++;
    }
    return n;
  }

  async partAt(index, part) {
    const testId = await this.chipAt(index).getAttribute("data-test");
    return this.scope.locator(`[data-test="${testId}-${part}"]`).nth(await this.sameIdIndex(index, testId));
  }

  async removeChipAt(index) {
    await this.close();
    await (await this.partAt(index, "remove")).click();
    await this.page.waitForTimeout(250);
  }

  async removeChip(field, nth = 0) {
    await this.scope.locator(this.id(`chip-${field}-remove`)).nth(nth).click();
  }

  /** From a unary operator the picker asks for a value and the chip changes only once one is given, so pass `value` then. */
  async changeOperator(index, operator, value) {
    await this.close();
    await (await this.partAt(index, "operator")).click();
    const id = await this.pickOperator(operator);
    if (value === undefined) return;
    if (await this.isPickerOpen()) await this.enterValues(id, value);
    else if (!NO_VALUE_OPERATORS.has(id)) await this.changeValue(index, value);
  }

  async changeValue(index, value) {
    await this.close();
    await (await this.partAt(index, "value")).click();
    await this.waitForPicker();
    await this.typeInPicker(String(value));
    await this.pickTyped(String(value));
  }

  async expectChip(field, text) {
    const chip = this.chip(field, 0);
    await expect(chip).toBeVisible({ timeout: 10000 });
    if (text) await expect(chip).toContainText(text);
  }

  async expectChipCount(count) {
    await expect(this.chips).toHaveCount(count, { timeout: 10000 });
  }

  async expectAddDisabled() {
    await expect(this.scope.locator(this.id("add-condition")).first()).toBeDisabled({ timeout: 5000 });
  }

  async expectChipInvalid(field) {
    await expect(this.chip(field, 0)).toHaveAttribute("data-invalid", "true", { timeout: 5000 });
  }

  async expectConnector(path, text) {
    await expect(this.root.locator(this.id(`connector-${path}`))).toHaveText(text);
  }

  async expectOperator(index, operator) {
    const id = operatorId(operator);
    await expect(await this.partAt(index, "operator")).toContainText(OPERATOR_LABELS[id] ?? operator);
  }

  async expectValue(index, value) {
    await expect(await this.partAt(index, "value")).toHaveText(value);
  }
}

module.exports = {
  FilterBuilderDriver,
  operatorId,
  OPERATOR_IDS,
  OPERATOR_LABELS,
  LIST_OPERATORS,
  NO_VALUE_OPERATORS,
};

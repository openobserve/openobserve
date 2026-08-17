/**
 * SloAlertsPage - the burn-rate alert panel, form, condition and preview
 * (components/slos/SloAlertsPanel|SloAlertForm|SloAlertCondition|SloAlertPreview)
 *
 * The alerts live on the SLO detail page's "alerts" tab, so every flow here
 * assumes SloDetailPage.openTab('alerts') has run.
 *
 * Preset cards report `aria-pressed`, added alongside the #13784 restyle. That
 * is the assertable signal for "this preset is in effect" — the selected state
 * is otherwise only a colour, which is not a contract.
 */

import { expect } from '@playwright/test';
import { openOSelectDropdown } from '../alertsPages/oselectHelpers.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SloAlertsPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      // Panel
      panel: '[data-test="slo-alerts-panel"]',
      list: '[data-test="slo-alerts-list"]',
      add: '[data-test="slo-alerts-add"]',
      empty: '[data-test="slo-alerts-empty"]',
      error: '[data-test="slo-alerts-error"]',

      // Form
      form: '[data-test="slo-alert-form"]',
      name: '[data-test="slo-alert-form-name"]',
      description: '[data-test="slo-alert-form-description"]',
      frequency: '[data-test="slo-alert-form-frequency"]',
      silence: '[data-test="slo-alert-form-silence"]',
      submit: '[data-test="slo-alert-form-submit"]',
      cancel: '[data-test="slo-alert-form-cancel"]',
      formError: '[data-test="slo-alert-form-error"]',

      // Condition
      conditionCritical: '[data-test="slos-sloalertcondition-critical"]',
      conditionLong: '[data-test="slos-sloalertcondition-long"]',
      conditionShort: '[data-test="slos-sloalertcondition-short"]',

      // Preview
      previewRoot: '[data-test="slos-sloalertpreview-root"]',
      previewLoading: '[data-test="slos-sloalertpreview-loading"]',
    };
  }

  alertRow(alertId) { return `[data-test="slo-alerts-row-${alertId}"]`; }
  alertEdit(alertId) { return `[data-test="slo-alerts-edit-${alertId}"]`; }
  presetCard(key) { return `[data-test="slos-sloalertcondition-preset-${key}"]`; }
  kindOption(value) { return `[data-test="slos-sloalertcondition-kind-${value}"]`; }

  // ------------------------------------------------------------------- actions

  async clickAdd() {
    await this.page.locator(this.locators.add).click();
    await expect(this.page.locator(this.locators.form)).toBeVisible({ timeout: 20000 });
  }

  async fillInput(rootSelector, value) {
    const field = this.page.locator(`${rootSelector} [data-test$="-field"]`).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(String(value));
  }

  async readInput(rootSelector) {
    return await this.page
      .locator(`${rootSelector} [data-test$="-field"]`)
      .first()
      .inputValue();
  }

  /**
   * Pick a notification destination.
   *
   * Required: the form rejects a submit with "Alert destination or workflows is
   * required". The picker lives inside `AlertDestinationsField` ->
   * `AlertTargetsSelect`, which carries its own `alert-destinations-select`
   * (the parent's `slo-alert-form-targets` falls through to the FIELD's root,
   * not to this control).
   *
   * Multi-select, so the popover stays open after a click; it is dismissed with
   * Escape and the choice confirmed from the trigger's rendered text.
   */
  async selectDestination(name) {
    const root = this.page.locator('[data-test="alert-destinations-select"]');
    await openOSelectDropdown(this.page, root);

    // FILTER FIRST. The popover is virtualized, so on an instance that has
    // accumulated destinations the wanted row may not be rendered at all — the
    // option locator then times out even though the destination exists. Typing
    // into the search box shortens the list to something that is.
    const search = this.page.locator('[data-test="alert-destinations-select-search"]');
    if (await search.count() > 0) {
      await search.fill(name);
      await this.page.waitForTimeout(400);
    }

    const option = this.page
      .locator('[data-test="alert-destinations-select-option"]')
      .filter({ hasText: name })
      .first();
    try {
      await option.waitFor({ state: 'visible', timeout: 15000 });
    } catch {
      const shown = await this.page
        .locator('[data-test="alert-destinations-select-option"]')
        .evaluateAll((nodes) => nodes.slice(0, 15).map((n) => (n.textContent || '').trim()))
        .catch(() => []);
      throw new Error(
        `Destination "${name}" was not offered by the picker.\n` +
        `  search box present: ${(await search.count()) > 0}\n` +
        `  options rendered  : ${JSON.stringify(shown)}\n` +
        `The list is virtualized; an unrendered option is invisible to Playwright.`,
      );
    }
    await option.click();

    await this.page.keyboard.press('Escape');
    await expect(root).toContainText(name, { timeout: 10000 });
    testLogger.info('Alert destination selected', { name });
  }

  async setName(name) { await this.fillInput(this.locators.name, name); }
  async setDescription(text) { await this.fillInput(this.locators.description, text); }
  async setFrequency(mins) { await this.fillInput(this.locators.frequency, mins); }
  async setSilence(mins) { await this.fillInput(this.locators.silence, mins); }

  async selectKind(kind) {
    const item = this.page.locator(this.kindOption(kind));
    await item.waitFor({ state: 'visible', timeout: 15000 });
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'on', { timeout: 10000 });
  }

  /** Apply a preset card (fast / mid / slow) and confirm it took effect. */
  async applyPreset(key) {
    const card = this.page.locator(this.presetCard(key));
    await card.waitFor({ state: 'visible', timeout: 15000 });
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
    testLogger.info('Burn-rate preset applied', { key });
  }

  /**
   * The burn-rate comparison operator.
   *
   * An OSelect: the value sits on the trigger where that branch renders
   * `data-test-selected-value`, and only in the rendered label otherwise — read
   * both, the same way sloFormPage does.
   */
  async readOperator() {
    const trigger = this.page.locator('[data-test="slos-sloalertcondition-operator-trigger"]');
    const attr = await trigger.getAttribute('data-test-selected-value').catch(() => null);
    if (attr) return attr.trim();
    return ((await trigger.textContent().catch(() => '')) ?? '').trim();
  }

  async readLongHours() { return Number(await this.readInput(this.locators.conditionLong)); }
  async readShortMinutes() { return Number(await this.readInput(this.locators.conditionShort)); }
  async readCritical() { return Number(await this.readInput(this.locators.conditionCritical)); }

  async submit() {
    await this.page.locator(this.locators.submit).click();
  }

  /**
   * Open the edit form for a listed alert, found by its name.
   *
   * The Edit control is keyed by `alert_id`, which the caller does not have —
   * the list row is the only place the name and the id appear together, so the
   * row is located by text and its own Edit button clicked.
   */
  async openEditForListedAlert(name) {
    const row = this.page
      .locator(`${this.locators.list} li`)
      .filter({ hasText: name })
      .first();
    await row.waitFor({ state: 'visible', timeout: 20000 });
    await row.locator('[data-test^="slo-alerts-edit-"]').first().click();
    await expect(this.page.locator(this.locators.form)).toBeVisible({ timeout: 20000 });
    await this.waitForFormHydration();
  }

  /**
   * Block until the alert form has been populated from the stored alert.
   *
   * The form renders before its fetch resolves, so for a moment it is mounted
   * and EMPTY. Reading a field in that window returns "" and looks exactly like
   * "the stored value was lost" — this was an intermittent failure that only
   * showed up under load, which is the worst way to learn it.
   */
  async waitForFormHydration(timeout = 20000) {
    const nameField = this.page
      .locator(`${this.locators.name} [data-test$="-field"]`)
      .first();
    await nameField.waitFor({ state: 'visible', timeout });
    await expect
      .poll(async () => (await nameField.inputValue()).length, {
        timeout,
        message: 'alert form never hydrated (name stayed empty)',
      })
      .toBeGreaterThan(0);
  }

  async cancel() {
    await this.page.locator(this.locators.cancel).click();
  }

  /**
   * Create a burn-rate alert end to end, and prove it was accepted.
   *
   * The form has two silent-failure modes worth converting into a real error:
   *   - `submit()` returns early when `nameError` is set, WITHOUT rendering a
   *     banner, so a rejected name looks exactly like nothing happening;
   *   - an API rejection sets `saveError` inside the form, which a caller
   *     looking only at the alert list would never see.
   * Waiting for the form to CLOSE is the success signal (`emit("saved")` is what
   * dismisses it); anything else is reported with its cause.
   */
  async createBurnRateAlert({
    name, preset = 'fast', destination, frequencyMins = null, silenceMins = null,
  }) {
    await this.clickAdd();
    await this.setName(name);
    await this.applyPreset(preset);
    if (destination) await this.selectDestination(destination);
    if (frequencyMins !== null) await this.setFrequency(frequencyMins);
    if (silenceMins !== null) await this.setSilence(silenceMins);
    await this.submit();

    const form = this.page.locator(this.locators.form);
    const error = this.page.locator(this.locators.formError);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if ((await form.count()) === 0 || !(await form.isVisible().catch(() => false))) {
        testLogger.info('Burn-rate alert created', { name, preset });
        return;
      }
      if ((await error.count()) > 0 && (await error.isVisible().catch(() => false))) {
        throw new Error(
          `Alert save was rejected: ${((await error.textContent()) ?? '').trim()}`,
        );
      }
      await this.page.waitForTimeout(500);
    }

    // Still open, no banner — the silent `nameError` path.
    const nameField = this.page.locator(`${this.locators.name} [data-test$="-field"]`).first();
    const nameErr = this.page.locator(`${this.locators.name} [data-test$="-error"]`);
    const inline = (await nameErr.count()) > 0
      ? ((await nameErr.textContent()) ?? '').trim()
      : '<none>';
    throw new Error(
      `Alert form neither closed nor showed an error after submit.\n` +
      `  name value  : ${JSON.stringify(await nameField.inputValue().catch(() => null))}\n` +
      `  inline name error: ${inline}\n` +
      `submit() returns early on a name-validation failure without rendering a banner.`,
    );
  }

  // ------------------------------------------------------------------ previews

  /** Wait for the alert preview to leave its loading state. */
  async waitForPreview(timeout = 60000) {
    await this.page.locator(this.locators.previewRoot).waitFor({ state: 'visible', timeout });
    await expect(this.page.locator(this.locators.previewLoading)).toHaveCount(0, { timeout });
  }

  // ---------------------------------------------------------------- assertions

  async expectPanelVisible() {
    await expect(this.page.locator(this.locators.panel)).toBeVisible({ timeout: 30000 });
  }

  async expectEmptyState() {
    await expect(this.page.locator(this.locators.empty)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.add)).toBeVisible();
  }

  async expectAlertListed(name) {
    await expect(
      this.page.locator(this.locators.list).getByText(name, { exact: false }),
    ).toBeVisible({ timeout: 30000 });
  }

  /**
   * The NAME field's inline error.
   *
   * A blank name never produces the `slo-alert-form-error` banner: `submit()`
   * does `if (nameError.value) return;` before any request, so the only signal
   * is the OInput's own `-error` node. Asserting the banner here would demand
   * behaviour the form does not have.
   */
  async expectNameError(pattern = null) {
    const err = this.page.locator(`${this.locators.name} [data-test$="-error"]`).first();
    await expect(err).toBeVisible({ timeout: 20000 });
    if (pattern) await expect(err).toContainText(pattern);
  }

  /** The banner shown for a SERVER rejection (saveError). */
  async expectFormError(pattern = null) {
    const err = this.page.locator(this.locators.formError);
    await expect(err).toBeVisible({ timeout: 20000 });
    if (pattern) await expect(err).toContainText(pattern);
  }

  async expectPresetActive(key) {
    await expect(this.page.locator(this.presetCard(key)))
      .toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
  }

  /** The form must still be open — a rejected submit must not close it. */
  async expectFormStillOpen() {
    await expect(this.page.locator(this.locators.form)).toBeVisible({ timeout: 10000 });
  }
}

export default SloAlertsPage;

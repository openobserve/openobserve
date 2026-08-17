/**
 * SloFormPage - the SLO create/edit form (views/slos/AddSlo.vue)
 *
 * Covers all three SLI shapes (count / time_slice / alert) plus the two query
 * languages, because they share one form and one flat `config` object.
 *
 * Selector conventions this file relies on, all verified in web/src/lib:
 *   OInput   -> [data-test="X"] [data-test="X-field"], error at "X-error"
 *   OSelect  -> trigger "X-trigger", popover "X-popover",
 *               options "X-option[data-test-value=…]", filter "X-search"
 *   OToggle  -> item carries its own data-test and reports data-state=on|off
 *   Monaco   -> SloExpressionField forwards "X" to the wrapper, "X-editor" inside
 */

import { expect } from '@playwright/test';
import { openOSelectDropdown } from '../alertsPages/oselectHelpers.js';
const MonacoEditorHelper = require('../../playwright-tests/utils/MonacoEditorHelper.js');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SloFormPage {
  constructor(page) {
    this.page = page;
    this.monaco = new MonacoEditorHelper(page);
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      title: '[data-test="slos-addslo-title"]',
      name: '[data-test="slos-addslo-name"]',
      description: '[data-test="slos-addslo-description"]',
      tags: '[data-test="slos-addslo-tags"]',
      sliTypeDescription: '[data-test="slos-addslo-sli-type-description"]',
      target: '[data-test="slos-addslo-target"]',
      sliceNote: '[data-test="slos-addslo-slice-note"]',
      groupBy: '[data-test="slos-addslo-group-by"]',
      save: '[data-test="slos-addslo-save"]',
      error: '[data-test="slos-addslo-error"]',
      regenWarning: '[data-test="slos-addslo-regen-warning"]',

      // Count SLI
      streamType: '[data-test="slos-addslo-stream-type"]',
      stream: '[data-test="slos-addslo-stream"]',
      goodExpr: '[data-test="slos-addslo-good-expr"]',
      promqlGood: '[data-test="slos-addslo-promql-good"]',
      promqlTotal: '[data-test="slos-addslo-promql-total"]',
      previewSection: '[data-test="slos-addslo-preview-section"]',

      // Time-slice SLI
      timesliceStreamType: '[data-test="slos-addslo-timeslice-stream-type"]',
      timesliceStream: '[data-test="slos-addslo-timeslice-stream"]',
      aggregate: '[data-test="slos-addslo-aggregate"]',
      comparator: '[data-test="slos-addslo-comparator"]',
      threshold: '[data-test="slos-addslo-threshold"]',
      timesliceScope: '[data-test="slos-addslo-timeslice-scope"]',
      promqlAbsentNote: '[data-test="slos-addslo-promql-absent-note"]',
      timeslicePreviewSection: '[data-test="slos-addslo-timeslice-preview-section"]',

      // Alert SLI
      alertSource: '[data-test="slos-addslo-alert-source"]',
      alertSourceEmpty: '[data-test="slos-addslo-alert-source-empty"]',
      alertSourceHint: '[data-test="slos-addslo-alert-source-hint"]',

      // Time-slice preview.
      //
      // NOTE: the component's own root `slos-slotimeslicepreview-root` does NOT
      // exist here. AddSlo mounts it with `data-test="slos-addslo-timeslice-preview-section"`,
      // and in Vue 3 a parent's fallthrough attribute OVERRIDES the child root's
      // own — so the section id is the only root selector that matches. The
      // child selectors below are on inner elements and are unaffected.
      tsPreviewRoot: '[data-test="slos-addslo-timeslice-preview-section"]',
      tsPreviewTally: '[data-test="slos-slotimeslicepreview-tally"]',
      tsPreviewGaps: '[data-test="slos-slotimeslicepreview-gaps"]',
      tsPreviewError: '[data-test="slos-slotimeslicepreview-error"]',
      tsPreviewLoading: '[data-test="slos-slotimeslicepreview-loading"]',
    };
  }

  // ---------------------------------------------------------------- navigation

  async gotoNew(orgId) {
    await this.page.goto(`/web/slos/add?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.title)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('SLO create form');
  }

  /**
   * Open the edit form AND wait for it to hydrate.
   *
   * The title renders immediately, but `load()` runs in an async `onMounted`, so
   * for a moment the form is mounted and completely EMPTY. Waiting on the title
   * alone reads pre-hydration values — an empty description reads as "the edit
   * did not persist" when in fact the fetch simply had not landed.
   *
   * The name is the readiness signal: every stored SLO has one, and it is
   * assigned by the same `Object.assign` that fills every other field, so a
   * non-empty name means the whole form is populated.
   */
  async gotoEdit(orgId, sloId) {
    await this.page.goto(`/web/slos/edit/${sloId}?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.title)).toBeVisible({ timeout: 30000 });
    await this.waitForHydration();
    testLogger.navigation('SLO edit form', { sloId });
  }

  /** Block until the form has been populated from the stored SLO. */
  async waitForHydration(timeout = 30000) {
    const nameField = this.page.locator(`${this.locators.name} [data-test$="-field"]`).first();
    await nameField.waitFor({ state: 'visible', timeout });
    await expect
      .poll(async () => (await nameField.inputValue()).length, {
        timeout,
        message: 'SLO edit form never hydrated (name stayed empty)',
      })
      .toBeGreaterThan(0);
  }

  // ------------------------------------------------------------- O2 primitives

  /**
   * OInput forwards data-test to an inner `-field`; the wrapper is not fillable.
   *
   * Blurs after filling so the value reaches the Vue model before anything else
   * reads or submits it. Saving in the same tick as the last keystroke can beat
   * the sync, and the symptom is silent: the old value is submitted and the
   * "change did not persist" failure points at the API rather than at timing.
   */
  async fillInput(rootSelector, value) {
    const field = this.page.locator(`${rootSelector} [data-test$="-field"]`).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(String(value));
    await field.blur().catch(() => {});
    await this.page.waitForTimeout(150);
  }

  async readInput(rootSelector) {
    return await this.page
      .locator(`${rootSelector} [data-test$="-field"]`)
      .first()
      .inputValue();
  }

  /**
   * Pick an OSelect option by its value.
   *
   * The popover is virtualized, so a long list may not render the wanted row.
   * When a search box is present we filter first, which both shortens the list
   * and makes the click deterministic.
   */
  async selectOption(rootSelector, value, { filterText = null } = {}) {
    const root = this.page.locator(rootSelector);
    await openOSelectDropdown(this.page, root);

    if (filterText) {
      const search = this.page.locator(`[data-test="${this._name(rootSelector)}-search"]`);
      if (await search.count() > 0) {
        await search.fill(filterText);
        await this.page.waitForTimeout(300);
      }
    }

    const name = this._name(rootSelector);
    const trigger = this.page.locator(`[data-test="${name}-trigger"]`);
    const option = this.page
      .locator(`[data-test="${name}-option"][data-test-value="${value}"]`)
      .first();

    // The option's own label, used to confirm the commit when the trigger does
    // not expose `data-test-selected-value` — see committed() below.
    const wantedLabel = await option
      .getAttribute('data-test-label')
      .catch(() => null);

    /**
     * Did the selection actually take?
     *
     * OSelect has TWO trigger branches. Only one of them renders
     * `data-test-selected-value` (OSelect.vue:1088); the `v-else` branch used by
     * non-searchable selects (OSelect.vue:1704) omits it entirely, so that
     * attribute reads `null` there no matter what is selected. Falling back to
     * the trigger's rendered label keeps this helper correct for both.
     */
    const committed = async () => {
      const attr = await trigger.getAttribute('data-test-selected-value').catch(() => null);
      if (attr !== null) return attr === String(value);
      if (!wantedLabel) return false;
      const text = (await trigger.textContent().catch(() => '')) ?? '';
      return text.trim().includes(wantedLabel.trim());
    };

    // reka commits asynchronously and a single click can open-then-close the
    // popover without selecting, so the click is RETRIED until the trigger
    // reports the value. A silently-uncommitted select is the most common false
    // pass in this component — the form simply keeps its previous value.
    const deadline = Date.now() + 20000;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      try {
        await option.waitFor({ state: 'visible', timeout: 5000 });
        await option.click();
      } catch {
        // Popover may have closed between attempts; reopen and try again.
        await openOSelectDropdown(this.page, this.page.locator(rootSelector));
        continue;
      }
      if (await committed()) return;
      await openOSelectDropdown(this.page, this.page.locator(rootSelector));
    }

    // Out of attempts — report what the control actually offered.
    const offered = await this.page
      .locator(`[data-test="${name}-option"]`)
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-test-value')))
      .catch(() => []);
    const attr = await trigger.getAttribute('data-test-selected-value').catch(() => null);
    const text = ((await trigger.textContent().catch(() => '')) ?? '').trim();
    throw new Error(
      `OSelect "${name}" never committed "${value}" after ${attempt} attempt(s).\n` +
      `  data-test-selected-value: ${JSON.stringify(attr)} (null = this trigger branch omits it)\n` +
      `  trigger text            : ${JSON.stringify(text)}\n` +
      `  wanted label            : ${JSON.stringify(wantedLabel)}\n` +
      `  options offered         : ${JSON.stringify(offered)}`,
    );
  }

  /** Strip `[data-test="…"]` down to the bare name so suffixes can be appended. */
  _name(selector) {
    const m = selector.match(/\[data-test="([^"]+)"\]/);
    if (!m) throw new Error(`Not a data-test selector: ${selector}`);
    return m[1];
  }

  /** Toggle-group items report their state; clicking blind can silently no-op. */
  async selectToggle(selector) {
    const item = this.page.locator(selector);
    await item.waitFor({ state: 'visible', timeout: 15000 });
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'on', { timeout: 10000 });
  }

  /**
   * SloExpressionField wraps Monaco; `.fill()` does not work on it.
   *
   * The editor is BLURRED afterwards on purpose. Monaco pushes its value to the
   * Vue model on change, and saving in the same tick as the last keystroke can
   * beat that sync — the field then reaches `wireConfig()` empty, `pruned()`
   * drops it, and the request fails deserialization with a bare
   * "Request failed with status code 422" instead of the validation message the
   * test is actually after. Tests that happen to touch another field next were
   * blurring it by accident; this makes the flush explicit.
   */
  async setExpression(rootSelector, text) {
    const container = this.page.locator(`${rootSelector} [data-test$="-editor"]`).first();
    await container.waitFor({ state: 'visible', timeout: 15000 });
    await this.monaco.setContent(container, text);
    await this.blurExpression();
  }

  /** Move focus out of Monaco so its model change reaches the Vue form. */
  async blurExpression() {
    await this.page.locator(this.locators.title).click({ position: { x: 5, y: 5 } })
      .catch(() => {});
    await this.page.waitForTimeout(300);
  }

  async getExpression(rootSelector) {
    const container = this.page.locator(`${rootSelector} [data-test$="-editor"]`).first();
    return await this.monaco.getContent(container);
  }

  // ------------------------------------------------------------- form actions

  async setName(name) { await this.fillInput(this.locators.name, name); }
  async setDescription(text) { await this.fillInput(this.locators.description, text); }
  async setTarget(value) { await this.fillInput(this.locators.target, value); }
  async setThreshold(value) { await this.fillInput(this.locators.threshold, value); }

  async getThreshold() { return await this.readInput(this.locators.threshold); }

  async selectSliType(type) {
    await this.selectToggle(`[data-test="slos-addslo-sli-type-${type}"]`);
  }

  async selectWindow(secs) {
    await this.selectToggle(`[data-test="slos-addslo-window-${secs}"]`);
  }

  async selectSlice(secs) {
    await this.selectToggle(`[data-test="slos-addslo-slice-${secs}"]`);
  }

  /**
   * Stream type — `logs` or `metrics`.
   *
   * More than a filter on the stream list: BOTH query-language toggles are
   * `v-if="isMetricsStream"`, so PromQL is unreachable until the stream type is
   * `metrics`. Selecting a language first simply times out on a control that
   * was never rendered.
   */
  async selectStreamType(type) {
    await this.selectOption(this.locators.streamType, type);
  }

  async selectTimeSliceStreamType(type) {
    await this.selectOption(this.locators.timesliceStreamType, type);
  }

  /** Requires stream type = metrics; see selectStreamType. */
  async selectCountLanguage(lang) {
    await this.selectToggle(`[data-test="slos-addslo-count-language-${lang}"]`);
  }

  /** Requires stream type = metrics; see selectTimeSliceStreamType. */
  async selectTimeSliceLanguage(lang) {
    await this.selectToggle(`[data-test="slos-addslo-timeslice-language-${lang}"]`);
  }

  async selectComparator(comparator) {
    await this.selectOption(this.locators.comparator, comparator);
  }

  async selectStream(streamName) {
    await this.selectOption(this.locators.stream, streamName, { filterText: streamName });
  }

  async selectTimeSliceStream(streamName) {
    await this.selectOption(this.locators.timesliceStream, streamName, { filterText: streamName });
  }

  /** Leave the form without saving. */
  async cancel() {
    // Cancel sits beside Save in the page header actions; it is the only
    // control there that is not the save button.
    await this.page.getByRole('button', { name: /cancel/i }).first().click();
    await this.page.waitForURL((url) => !/\/slos\/(add|edit)/.test(url.pathname), {
      timeout: 20000,
    });
  }

  /**
   * Click Save. Does NOT wait for an outcome — use when a rejection is expected.
   */
  async save() {
    await this.page.locator(this.locators.save).click();
  }

  /**
   * Save and wait for the write to actually land.
   *
   * `save()` in the app awaits the create/update and only then does
   * `router.push(backTarget)`, so leaving the form IS the confirmation that the
   * request completed. Without this, a test that saves and immediately re-reads
   * can beat the commit and see the previous values — which reads as "the edit
   * did not persist" when the payload was correct all along.
   */
  async saveExpectingSuccess(timeout = 30000) {
    await this.page.locator(this.locators.save).click();
    await this.page.waitForURL((url) => !/\/slos\/(add|edit)/.test(url.pathname), { timeout })
      .catch(async () => {
        // Still on the form: surface the reason rather than a bare timeout.
        const err = this.page.locator(this.locators.error);
        const msg = (await err.count()) > 0 ? await err.textContent() : '<no error banner>';
        throw new Error(`Save did not complete; the form stayed open. Error banner: ${msg}`);
      });
  }

  // ------------------------------------------------------------ composite flows

  /**
   * Fill a complete SQL count SLO. Returns nothing; caller saves.
   */
  async fillCountSlo({ name, stream, goodExpr, target = 99, windowSecs = 604800, sliceSecs = 300, description = null }) {
    await this.setName(name);
    if (description) await this.setDescription(description);
    await this.selectSliType('count');
    await this.selectStream(stream);
    await this.setExpression(this.locators.goodExpr, goodExpr);
    await this.setTarget(target);
    await this.selectWindow(windowSecs);
    await this.selectSlice(sliceSecs);
    testLogger.info('Count SLO form filled', { name, stream });
  }

  /**
   * Fill a complete SQL time-slice SLO.
   */
  async fillTimeSliceSlo({ name, stream, aggregate, comparator, threshold, target = 99, windowSecs = 604800, sliceSecs = 300 }) {
    await this.setName(name);
    await this.selectSliType('time_slice');
    await this.selectTimeSliceStream(stream);
    await this.setExpression(this.locators.aggregate, aggregate);
    await this.selectComparator(comparator);
    await this.setThreshold(threshold);
    await this.setTarget(target);
    await this.selectWindow(windowSecs);
    await this.selectSlice(sliceSecs);
    testLogger.info('Time-slice SLO form filled', { name, stream, comparator, threshold });
  }

  // ------------------------------------------------------------ preview reads

  /**
   * Wait for the time-slice preview to settle into a real state (not loading).
   *
   * The component is mounted by
   *   `v-else-if="sli_type === 'time_slice' && config.stream && config.query"`
   * so a missing root means the FORM is incomplete, not that the preview is
   * slow. Reporting which of the two inputs is unset turns a blank 60s timeout
   * into an actionable message — the aggregate in particular is a Monaco field
   * whose model may not have synced.
   */
  async waitForTimeSlicePreview(timeout = 60000) {
    const root = this.page.locator(this.locators.tsPreviewRoot);
    try {
      await root.waitFor({ state: 'visible', timeout });
    } catch (e) {
      const streamPicked = await this.page
        .locator(`[data-test="slos-addslo-timeslice-stream-trigger"]`)
        .getAttribute('data-test-selected-value')
        .catch(() => null);
      const aggregate = await this.getExpression(this.locators.aggregate).catch(() => '<unreadable>');
      const sectionCount = await this.page.locator(this.locators.timeslicePreviewSection).count();
      throw new Error(
        `Time-slice preview never mounted.\n` +
        `It requires sli_type=time_slice AND config.stream AND config.query.\n` +
        `  stream selected : ${JSON.stringify(streamPicked)}\n` +
        `  aggregate text  : ${JSON.stringify(String(aggregate).slice(0, 120))}\n` +
        `  preview section : ${sectionCount} node(s)\n` +
        `An empty aggregate here means the Monaco model did not sync.`,
      );
    }
    await expect(this.page.locator(this.locators.tsPreviewLoading)).toHaveCount(0, { timeout });
  }

  /**
   * Parse the preview tally into numbers.
   *
   * The copy is `slos.preview.sliceTally` = "{sli}% good ({good}/{total} slices)",
   * so the SLI comes FIRST and the counts follow inside the parentheses.
   *
   * Matched STRUCTURALLY rather than by position in a list of numbers: reading
   * the Nth number silently mis-assigns every field if the sentence is reworded
   * or localised, and "100% good (11/11 slices)" parses as good=100, total=11 —
   * a nonsense pair that only surfaces when an assertion happens to catch it.
   */
  async readTimeSliceTally() {
    const text = (await this.page.locator(this.locators.tsPreviewTally).textContent()) ?? '';
    const m = text.match(/([\d.]+)\s*%\s*good\s*\(\s*(\d+)\s*\/\s*(\d+)/i);
    if (!m) {
      throw new Error(
        `Could not parse the preview tally.\n` +
        `Expected the shape "{sli}% good ({good}/{total} slices)".\n` +
        `Got: ${JSON.stringify(text)}`,
      );
    }
    return { sli: Number(m[1]), good: Number(m[2]), total: Number(m[3]), raw: text };
  }

  // -------------------------------------------------------------- assertions

  async expectError(pattern) {
    const err = this.page.locator(this.locators.error);
    await expect(err).toBeVisible({ timeout: 15000 });
    if (pattern) await expect(err).toContainText(pattern);
  }

  async expectRegenWarningVisible() {
    await expect(this.page.locator(this.locators.regenWarning)).toBeVisible({ timeout: 15000 });
  }

  /**
   * No regeneration warning is due.
   *
   * Settle first: the banner is driven by a computed over the whole form, so
   * asserting absence immediately after an edit could pass before Vue has even
   * re-evaluated it.
   */
  async expectRegenWarningAbsent() {
    await this.page.waitForTimeout(1000);
    await expect(this.page.locator(this.locators.regenWarning)).toHaveCount(0);
  }

  async expectScopeHidden() {
    await expect(this.page.locator(this.locators.timesliceScope)).toHaveCount(0);
  }

  async expectPromqlAbsentNoteVisible() {
    await expect(this.page.locator(this.locators.promqlAbsentNote)).toBeVisible();
  }

  /** The 1-minute slice is pinned off for grouped SLOs (D30, form + API). */
  async expectSliceOptionDisabled(secs) {
    const item = this.page.locator(`[data-test="slos-addslo-slice-${secs}"]`);
    await expect(item).toBeDisabled({ timeout: 10000 });
  }

  async expectSliceOptionEnabled(secs) {
    const item = this.page.locator(`[data-test="slos-addslo-slice-${secs}"]`);
    await expect(item).toBeEnabled({ timeout: 10000 });
  }

  async readDescription() {
    return await this.readInput(this.locators.description);
  }

  async selectGroupBy(field) {
    await this.selectOption(this.locators.groupBy, field, { filterText: field });
  }

  async expectPreviewGapsVisible() {
    await expect(this.page.locator(this.locators.tsPreviewGaps)).toBeVisible({ timeout: 30000 });
  }

  // ---------------------------------------------------------- count preview

  /**
   * The COUNT preview (`SloPreviewChart`), which is a different component from
   * the time-slice one and mounts on a different condition.
   *
   * Panels are keyed `good` / `bad` (SQL) or `good` / `total` (PromQL). As
   * everywhere in this feature the component's own root is shadowed by the
   * parent's `data-test`, so the section id is the root.
   */
  async waitForCountPreview(timeout = 60000) {
    const root = this.page.locator(this.locators.previewSection);
    try {
      await root.waitFor({ state: 'visible', timeout });
    } catch {
      const goodExpr = await this.getExpression(this.locators.goodExpr).catch(() => '<none>');
      throw new Error(
        `Count preview never mounted. It needs a stream AND a good expression.\n` +
        `  good_expr: ${JSON.stringify(String(goodExpr).slice(0, 120))}`,
      );
    }
    await expect(
      this.page.locator('[data-test="slos-slopreviewchart-good-loading"]'),
    ).toHaveCount(0, { timeout });
  }

  /**
   * A named count-preview panel is rendering data rather than an empty state.
   *
   * The two languages render DIFFERENTLY, and the component says why: "PromQL
   * owns its own request lifecycle, where the SQL branch hands that to the
   * panel renderer". So:
   *   SQL     -> `PanelSchemaRenderer` tagged `-<key>-panel`; there is no
   *              `-chart`, `-loading` or `-error` node at all on this side.
   *   PromQL  -> `-<key>-loading` / `-error` / `-chart` / `-empty`.
   * Asserting the PromQL shape against a SQL preview waits forever on a node
   * that branch never renders.
   *
   * Panels are keyed `good` and `bad` for SQL, `good` and `total` for PromQL.
   */
  async expectCountPreviewPanelHasData(panel = 'good', { promql = false, timeout = 60000 } = {}) {
    await expect(
      this.page.locator(`[data-test="slos-slopreviewchart-${panel}-empty"]`),
      `the ${panel} panel must not be in its empty state`,
    ).toHaveCount(0, { timeout });

    if (promql) {
      await expect(
        this.page.locator(`[data-test="slos-slopreviewchart-${panel}-error"]`),
        `the ${panel} panel must not be in an error state`,
      ).toHaveCount(0, { timeout });
      await expect(
        this.page.locator(`[data-test="slos-slopreviewchart-${panel}-chart"]`),
      ).toBeVisible({ timeout });
      return;
    }

    await expect(
      this.page.locator(`[data-test="slos-slopreviewchart-${panel}-panel"]`),
      `the ${panel} panel must render its chart, not an empty state`,
    ).toBeVisible({ timeout });
  }

  // --------------------------------------------------------- tags / alert SLI

  /** OTagInput commits on Enter — one press per tag. */
  async addTags(tags) {
    const field = this.page
      .locator(`${this.locators.tags} input, ${this.locators.tags} [data-test$="-field"]`)
      .first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    for (const tag of tags) {
      await field.fill(tag);
      await field.press('Enter');
      await this.page.waitForTimeout(200);
    }
  }

  async expectTagVisible(tag) {
    await expect(this.page.locator(this.locators.tags)).toContainText(tag, { timeout: 10000 });
  }

  /**
   * Pick the source alert for an `alert` SLI.
   *
   * Options are `{value: alert_id, label: name}` and INELIGIBLE alerts are
   * listed too — disabled, with the server's rejection reason folded into the
   * label — so the id is what identifies the row, and the name is only good for
   * filtering the virtualized list.
   */
  async selectAlertSource(alertId, alertName) {
    await this.selectOption(this.locators.alertSource, alertId, { filterText: alertName });
  }

  /**
   * An ineligible alert is offered but disabled, with the reason in its label.
   *
   * The name is used to FILTER first: the picker is virtualized, so on an
   * instance carrying many alerts the wanted row is simply not rendered and the
   * locator times out even though the option exists.
   */
  async expectAlertSourceOptionDisabled(alertId, alertName = null) {
    await openOSelectDropdown(this.page, this.page.locator(this.locators.alertSource));
    if (alertName) {
      const search = this.page.locator('[data-test="slos-addslo-alert-source-search"]');
      if (await search.count() > 0) {
        await search.fill(alertName);
        await this.page.waitForTimeout(400);
      }
    }
    const option = this.page
      .locator(`[data-test="slos-addslo-alert-source-option"][data-test-value="${alertId}"]`)
      .first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    const disabled = await option.getAttribute('data-disabled');
    const ariaDisabled = await option.getAttribute('aria-disabled');
    expect(
      disabled !== null || ariaDisabled === 'true',
      'an ineligible source must be offered but not selectable',
    ).toBe(true);
    await this.page.keyboard.press('Escape');
  }

  async expectAlertSourceHintVisible() {
    await expect(this.page.locator(this.locators.alertSourceHint)).toBeVisible({ timeout: 15000 });
  }
}

export default SloFormPage;

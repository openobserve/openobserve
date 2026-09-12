// Copyright 2026 OpenObserve Inc.

/**
 * Composite alerts page object.
 *
 * SELECTOR CONTRACT
 * -----------------
 * O2 form components render the consumer's `data-test` on a WRAPPER and put the
 * interactive node on a suffixed child. Targeting the wrapper silently fails
 * (Playwright cannot fill a div), so every accessor here resolves to the real
 * node:
 *
 *   OInput / OTextarea -> `${dt}-field`     (the native input/textarea)
 *   OSelect            -> `${dt}-trigger`   (opens), `${dt}-option` (rows,
 *                                            each mirroring `data-test-value`)
 *   OSwitch            -> `${dt}-btn`
 *
 * The child picker is an "Add alert" button plus one lettered OSelect slot per
 * child — there is NO search-and-pick field. Slots are positional: index 0 is
 * always A, and the expression the user edits is lettered ("A && B") while the
 * stored form is `{alert_id}`.
 */

import { expect } from '@playwright/test';
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

export class CompositeAlertsPage {
  constructor(page) {
    this.page = page;
    this.locators = {
      // ---- alert list -------------------------------------------------
      listTab: (tab) => `[data-test="alert-list-tab-${tab}"]`,
      listBadge: (id) => `[data-test="alert-list-composite-badge-${id}"]`,
      listChildCount: (id) => `[data-test="alert-list-child-count-${id}"]`,
      listExpression: (id) => `[data-test="alert-list-composite-expression-${id}"]`,
      listReferenceCount: (id) => `[data-test="alert-list-reference-count-${id}"]`,
      listEnableToggle: (name) => `[data-test="alert-list-${name}-pause-start-alert"]`,

      // ---- references drawer ------------------------------------------
      referenceChip: '[data-test="alerts-composite-reference-chip"]',
      referenceDrawer: '[data-test="alerts-composite-reference-drawer"]',
      referenceConflict: '[data-test="alerts-composite-reference-conflict"]',
      referenceParent: (id) => `[data-test="alerts-composite-reference-parent-${id}"]`,
      referenceHiddenCount: '[data-test="alerts-composite-reference-hidden-count"]',
      referenceClose: '[data-test="alerts-composite-reference-close"]',

      // ---- create / edit form -----------------------------------------
      typeTab: '[data-test="add-alert-type-tab-composite"]',
      form: '[data-test="alerts-composite-form"]',
      save: '[data-test="add-alert-submit-btn"]',

      // ---- child selector ---------------------------------------------
      childSelector: '[data-test="alerts-composite-child-selector"]',
      childAdd: '[data-test="alerts-composite-child-add"]',
      childCap: '[data-test="alerts-composite-child-cap"]',
      childEmpty: '[data-test="alerts-composite-child-empty"]',
      selectedChild: (id) => `[data-test="alerts-composite-selected-child-${id}"]`,
      childSelectTrigger: (id) => `[data-test="alerts-composite-child-select-${id}-trigger"]`,
      childSelectOption: (id) => `[data-test="alerts-composite-child-select-${id}-option"]`,
      childType: (id) => `[data-test="alerts-composite-child-type-${id}"]`,
      childLevel: (id) => `[data-test="alerts-composite-child-level-${id}"]`,
      childOpen: (id) => `[data-test="alerts-composite-child-open-${id}"]`,
      childRemove: (id) => `[data-test="alerts-composite-child-remove-${id}"]`,

      // ---- expression builder ------------------------------------------
      expressionBuilder: '[data-test="alerts-composite-expression-builder"]',
      expressionLive: '[data-test="alerts-composite-expression-live"]',
      expressionInput: '[data-test="alerts-composite-expression-input-field"]',
      expressionInsert: (id) => `[data-test="alerts-composite-expression-insert-${id}"]`,
      expressionAnd: '[data-test="alerts-composite-expression-and"]',
      expressionOr: '[data-test="alerts-composite-expression-or"]',
      expressionNot: '[data-test="alerts-composite-expression-not"]',
      expressionOpenGroup: '[data-test="alerts-composite-expression-open-group"]',
      expressionCloseGroup: '[data-test="alerts-composite-expression-close-group"]',
      expressionUnused: '[data-test="alerts-composite-expression-unused"]',
      operandTray: (id) => `[data-test="alerts-composite-operand-tray-${id}"]`,
      expressionError: '[data-test="alerts-composite-expression-error"]',
      advancedToggle: '[data-test="alerts-composite-expression-advanced-toggle"]',
      advancedField: '[data-test="alerts-composite-expression-advanced-field"]',

      // ---- settings -----------------------------------------------------
      warningCountsAsFiring: '[data-test="alerts-composite-warning-counts-as-firing-btn"]',
      stalePolicyTrigger: '[data-test="alerts-composite-stale-policy-trigger"]',
      stalePolicyOption: '[data-test="alerts-composite-stale-policy-option"]',
      stalePolicyHelp: '[data-test="alerts-composite-stale-policy-help"]',

      // ---- live preview --------------------------------------------------
      preview: '[data-test="alerts-composite-preview"]',
      previewResult: '[data-test="alerts-composite-preview-result"]',
      previewSteps: '[data-test="alerts-composite-preview-steps"]',
      previewWarning: (code) => `[data-test="alerts-composite-preview-warning-${code}"]`,
      previewStale: (id) => `[data-test="alerts-composite-preview-stale-${id}"]`,
      previewError: (code) => `[data-test="alerts-composite-preview-error-${code}"]`,

      // ---- detail --------------------------------------------------------
      detail: '[data-test="alerts-composite-detail"]',
      detailResult: '[data-test="alerts-composite-detail-result"]',
      detailExpressionLive: '[data-test="alerts-composite-detail-expression-live"]',
      detailExpression: '[data-test="alerts-composite-detail-expression"]',
      detailConfig: '[data-test="alerts-composite-detail-config"]',
      detailStalePolicy: '[data-test="alerts-composite-detail-stale-policy"]',
      detailChild: (id) => `[data-test="alerts-composite-detail-child-${id}"]`,
      detailChildLink: (id) => `[data-test="alerts-composite-detail-child-link-${id}"]`,
      detailLevelAt: (id) => `[data-test="alerts-composite-detail-level-at-${id}"]`,
      detailStaleReason: (id) => `[data-test="alerts-composite-detail-stale-reason-${id}"]`,
      missingJob: '[data-test="alerts-composite-detail-missing-job"]',

      // ---- status timeline -------------------------------------------------
      timeline: '[data-test="alerts-composite-timeline"]',
      timelineWindow: (w) => `[data-test="alerts-composite-timeline-window-${w}"]`,
      timelineLevel: (id) => `[data-test="alerts-composite-timeline-level-${id}"]`,
      timelineEmpty: '[data-test="alerts-composite-timeline-empty"]',
    };
  }

  // ===================== navigation =====================

  async openList() {
    await this.page.goto(`/web/alerts?org_identifier=${getOrgIdentifier()}&folder=default`);
  }

  async openCreate() {
    await this.page.goto(`/web/alerts/add?org_identifier=${getOrgIdentifier()}&folder=default`);
  }

  async openEdit(id) {
    await this.page.goto(`/web/alerts/edit/${id}?org_identifier=${getOrgIdentifier()}&folder=default`);
  }

  async openDetail(id) {
    await this.page.goto(`/web/alerts/detail/${id}?org_identifier=${getOrgIdentifier()}&folder=default`);
  }

  // ===================== alert list =====================

  listTab(tab = 'composite') {
    return this.page.locator(this.locators.listTab(tab));
  }

  async openListTab(tab = 'composite') {
    await this.listTab(tab).click();
    await this.page.waitForTimeout(2000);
  }

  listBadge(id) {
    return this.page.locator(this.locators.listBadge(id));
  }

  listChildCount(id) {
    return this.page.locator(this.locators.listChildCount(id));
  }

  listExpression(id) {
    return this.page.locator(this.locators.listExpression(id));
  }

  listReferenceCount(id) {
    return this.page.locator(this.locators.listReferenceCount(id));
  }

  listEnableToggle(name) {
    return this.page.locator(this.locators.listEnableToggle(name));
  }

  /** The whole table row a composite occupies, reached via its badge. */
  listRow(id) {
    return this.page.locator(this.locators.listBadge(id)).locator('xpath=ancestor::tr[1]');
  }

  // ===================== references drawer =====================

  referenceChip() {
    return this.page.locator(this.locators.referenceChip);
  }

  referenceDrawer() {
    return this.page.locator(this.locators.referenceDrawer);
  }

  referenceConflict() {
    return this.page.locator(this.locators.referenceConflict);
  }

  referenceParent(id) {
    return this.page.locator(this.locators.referenceParent(id));
  }

  referenceHiddenCount() {
    return this.page.locator(this.locators.referenceHiddenCount);
  }

  referenceClose() {
    return this.page.locator(this.locators.referenceClose);
  }

  async openReferences() {
    await this.referenceChip().first().click();
    await expect(this.referenceDrawer()).toBeVisible();
  }

  /**
   * Delete a row from the list and return WITHOUT asserting the outcome.
   *
   * `alertManagement.searchAndDeleteAlert` waits for the "Alert deleted" toast,
   * which never arrives when the alert is a composite child — the delete is
   * refused with 409 and the references drawer opens instead. Blocked deletes
   * are exactly what these specs assert, so the caller decides what success
   * means here.
   */
  async attemptRowDelete(name) {
    const kebab = this.page.locator(`[data-test="alert-list-${name}-more-options"]`);
    await kebab.waitFor({ state: 'visible', timeout: 20000 });
    await kebab.click();
    const remove = this.page.locator(`[data-test="alert-list-${name}-delete-alert"]`);
    await remove.waitFor({ state: 'visible', timeout: 10000 });
    await remove.click();
    await this.page
      .locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]')
      .click();
  }

  // ===================== form shell =====================

  form() {
    return this.page.locator(this.locators.form);
  }

  typeTab() {
    return this.page.locator(this.locators.typeTab);
  }

  save() {
    return this.page.locator(this.locators.save);
  }

  /**
   * Switch the wizard to Composite mode and wait until it can actually accept a
   * child.
   *
   * Entering composite mode kicks off an async fetch of every candidate alert,
   * and "Add alert" is a no-op until it lands — it picks the first unselected
   * option and silently returns when there are none. Waiting only for the form
   * to render therefore races, and the race is the common case on a cold page.
   */
  async chooseCompositeType() {
    const optionsLoaded = this.waitForChildOptions();
    await this.typeTab().click();
    await expect(this.form()).toBeVisible();
    await optionsLoaded;
  }

  /** Resolve once the candidate-children fetch has returned. */
  waitForChildOptions(timeout = 30000) {
    return this.page
      .waitForResponse(
        (response) =>
          /\/api\/v2\/[^/]+\/alerts\?/.test(response.url())
          && response.url().includes('alert_type=all')
          && response.status() === 200,
        { timeout },
      )
      .catch(() => null);
  }

  // ===================== child selector =====================

  childAdd() {
    return this.page.locator(this.locators.childAdd);
  }

  childCap() {
    return this.page.locator(this.locators.childCap);
  }

  childEmpty() {
    return this.page.locator(this.locators.childEmpty);
  }

  selectedChild(id) {
    return this.page.locator(this.locators.selectedChild(id));
  }

  childType(id) {
    return this.page.locator(this.locators.childType(id));
  }

  childLevel(id) {
    return this.page.locator(this.locators.childLevel(id));
  }

  childOpen(id) {
    return this.page.locator(this.locators.childOpen(id));
  }

  childRemove(id) {
    return this.page.locator(this.locators.childRemove(id));
  }

  /** Slot rows in visual order; index 0 is slot A. */
  selectedChildRows() {
    return this.page.locator('[data-test^="alerts-composite-selected-child-"]');
  }

  /**
   * Append the next unselected alert. The button picks the first free option
   * itself, so the caller cannot choose — use `replaceChild` to pin an id.
   */
  async addChild() {
    await this.childAdd().click();
  }

  /**
   * Pick a value from an O2 OSelect by its `data-test-value`.
   *
   * Two things make the naive open-then-click flaky, and both bite only at
   * scale or in sequence:
   *
   *   - A searchable OSelect renders a windowed list, so an option can be
   *     absent from the DOM entirely until the search box narrows to it. The
   *     child picker hits this as soon as the org holds more than a screenful
   *     of alerts, which is any parallel run.
   *   - Reka keeps the popover mounted through its close animation, and while
   *     it is there it intercepts pointer events. A second selection opened
   *     before that unmount races it and the click lands on the dying overlay.
   *
   * @param {string} base  the consumer `data-test` on the OSelect
   * @param {string} value the option's `data-test-value`
   * @param {string} [searchText] typed into the search box when the select has one
   */
  async selectOption(base, value, searchText) {
    const popover = this.page.locator(`[data-test="${base}-popover"]`);
    const option = this.page.locator(`[data-test="${base}-option"][data-test-value="${value}"]`);

    await this.page.locator(`[data-test="${base}-trigger"]`).click();
    await expect(popover).toBeVisible();

    if (searchText) {
      const search = this.page.locator(`[data-test="${base}-search"]`);
      if (await search.count()) await search.fill(searchText);
    }
    await expect(option).toBeVisible();
    await option.click();

    await expect(popover).toBeHidden();
  }

  /**
   * Repoint an occupied slot at `next`, keeping the slot's position/letter.
   *
   * `next` is the whole {id, name} child, not an id: the name is what gets
   * typed into the select's search box. Passing a bare id used to surface as a
   * 15s locator timeout with no hint of the real cause, so it is rejected here.
   */
  async replaceChild(currentId, next) {
    if (typeof next !== 'object' || !next?.id || !next?.name) {
      throw new TypeError(
        `replaceChild expects a {id, name} child, received ${JSON.stringify(next)}`,
      );
    }
    await this.selectOption(
      `alerts-composite-child-select-${currentId}`,
      next.id,
      next.name,
    );
    await expect(this.selectedChild(next.id)).toBeVisible();
  }

  /**
   * Add a slot, then point it at `child`.
   *
   * Two steps because "Add alert" takes the first unselected option rather than
   * one the caller chooses — so pinning a specific child always means adding,
   * then replacing whatever landed there.
   *
   * @param {{id: string, name: string}} child
   */
  async addChildById(child) {
    if (typeof child !== 'object' || !child?.id || !child?.name) {
      throw new TypeError(
        `addChildById expects a {id, name} child, received ${JSON.stringify(child)}`,
      );
    }
    const before = await this.selectedChildRows().count();
    await this.addChild();
    await expect(this.selectedChildRows()).toHaveCount(before + 1);
    if (await this.selectedChild(child.id).count()) return;
    const landedOn = await this.selectedChildRows().nth(before).getAttribute('data-test');
    const currentId = landedOn.replace('alerts-composite-selected-child-', '');
    await this.replaceChild(currentId, child);
  }

  async removeChild(id) {
    await this.childRemove(id).click();
    await expect(this.selectedChild(id)).toHaveCount(0);
  }

  /**
   * The options a slot currently offers, as alert ids.
   *
   * Only what the select has RENDERED: a searchable OSelect windows its list,
   * so treat this as "does not offer" evidence for a small fixture set, never
   * as the complete option universe.
   */
  async optionIdsFor(id) {
    const base = `alerts-composite-child-select-${id}`;
    const popover = this.page.locator(`[data-test="${base}-popover"]`);
    await this.page.locator(`[data-test="${base}-trigger"]`).click();
    await expect(popover).toBeVisible();
    const ids = await this.page
      .locator(`[data-test="${base}-option"]`)
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-test-value')));
    await this.page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    return ids;
  }

  // ===================== expression builder =====================

  expressionLive() {
    return this.page.locator(this.locators.expressionLive);
  }

  expressionInput() {
    return this.page.locator(this.locators.expressionInput);
  }

  expressionInsert(id) {
    return this.page.locator(this.locators.expressionInsert(id));
  }

  expressionAnd() {
    return this.page.locator(this.locators.expressionAnd);
  }

  expressionOr() {
    return this.page.locator(this.locators.expressionOr);
  }

  expressionNot() {
    return this.page.locator(this.locators.expressionNot);
  }

  expressionOpenGroup() {
    return this.page.locator(this.locators.expressionOpenGroup);
  }

  expressionCloseGroup() {
    return this.page.locator(this.locators.expressionCloseGroup);
  }

  expressionUnused() {
    return this.page.locator(this.locators.expressionUnused);
  }

  operandTray(id) {
    return this.page.locator(this.locators.operandTray(id));
  }

  expressionError() {
    return this.page.locator(this.locators.expressionError);
  }

  advancedToggle() {
    return this.page.locator(this.locators.advancedToggle);
  }

  advancedField() {
    return this.page.locator(this.locators.advancedField);
  }

  /** Overwrite the lettered expression ("A && B"), not the stored `{id}` form. */
  async fillExpression(lettered) {
    await this.expressionInput().fill(lettered);
  }

  /** Reveal the raw `{id}` textarea. Idempotent. */
  async openAdvanced() {
    if (await this.advancedField().count()) return;
    await this.advancedToggle().click();
    await expect(this.advancedField()).toBeVisible();
  }

  async fillAdvancedExpression(raw) {
    await this.openAdvanced();
    await this.advancedField().fill(raw);
  }

  // ===================== settings =====================

  warningCountsAsFiring() {
    return this.page.locator(this.locators.warningCountsAsFiring);
  }

  stalePolicyHelp() {
    return this.page.locator(this.locators.stalePolicyHelp);
  }

  /** @param {'use_last_state'|'treat_as_false'|'treat_as_true'} value */
  async selectStalePolicy(value) {
    await this.selectOption('alerts-composite-stale-policy', value);
    await expect.poll(() => this.stalePolicyValue()).toBe(value);
  }

  async stalePolicyValue() {
    return this.page
      .locator('[data-test="alerts-composite-stale-policy"]')
      .getAttribute('data-value');
  }

  // ===================== live preview =====================

  preview() {
    return this.page.locator(this.locators.preview);
  }

  previewResult() {
    return this.page.locator(this.locators.previewResult);
  }

  previewSteps() {
    return this.page.locator(this.locators.previewSteps);
  }

  /** One row per operand, then the result row last. */
  previewStepRows() {
    return this.previewSteps().locator('li');
  }

  previewWarning(code) {
    return this.page.locator(this.locators.previewWarning(code));
  }

  previewStale(id) {
    return this.page.locator(this.locators.previewStale(id));
  }

  previewError(code) {
    return this.page.locator(this.locators.previewError(code));
  }

  // ===================== detail =====================

  detail() {
    return this.page.locator(this.locators.detail);
  }

  detailResult() {
    return this.page.locator(this.locators.detailResult);
  }

  detailExpression() {
    return this.page.locator(this.locators.detailExpression);
  }

  detailExpressionLive() {
    return this.page.locator(this.locators.detailExpressionLive);
  }

  detailConfig() {
    return this.page.locator(this.locators.detailConfig);
  }

  detailStalePolicy() {
    return this.page.locator(this.locators.detailStalePolicy);
  }

  detailChild(id) {
    return this.page.locator(this.locators.detailChild(id));
  }

  detailChildLink(id) {
    return this.page.locator(this.locators.detailChildLink(id));
  }

  detailLevelAt(id) {
    return this.page.locator(this.locators.detailLevelAt(id));
  }

  detailStaleReason(id) {
    return this.page.locator(this.locators.detailStaleReason(id));
  }

  missingJob() {
    return this.page.locator(this.locators.missingJob);
  }

  // ===================== status timeline =====================

  timeline() {
    return this.page.locator(this.locators.timeline);
  }

  timelineWindow(w) {
    return this.page.locator(this.locators.timelineWindow(w));
  }

  timelineLevel(id) {
    return this.page.locator(this.locators.timelineLevel(id));
  }

  timelineEmpty() {
    return this.page.locator(this.locators.timelineEmpty);
  }

  /** @param {'1h'|'4h'|'1d'} w */
  async selectTimelineWindow(w) {
    await this.timelineWindow(w).click();
  }

  // ===================== shared assertions =====================

  bodyHasNoHorizontalOverflow() {
    return this.page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth);
  }
}

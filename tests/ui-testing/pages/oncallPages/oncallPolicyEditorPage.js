/**
 * OnCallPolicyEditorPage — the escalation policy drawer and its three tabs.
 *
 * Component: components/oncall/OnCallPolicyEditor.vue (an ODrawer, not a page),
 * mounted on the team detail's escalation tab; the L0 panel inside it is
 * components/oncall/OnCallL0Editor.vue.
 *
 * VOCABULARY, AND THE TRAP IN IT. In the data model a "rung" IS a priority
 * (`PriorityRung`, one per P1..P5) and the things you add and remove inside one
 * are STEPS (`LadderStep`). The selectors disagree with the model:
 *
 *   oncall-policy-rung-<priority>-<stepIndex>          a STEP
 *   oncall-policy-remove-rung-<priority>-<stepIndex>   removes a STEP
 *   oncall-policy-add-step-<priority>                  adds a STEP
 *   oncall-policy-rung                                 the whole PRIORITY panel
 *
 * There is NO add/remove control for a priority — the five chips are fixed. So
 * "add a rung" in the plan means "add a step to this priority", and the index a
 * removal must respect is the STEP index.
 *
 * THE DRAWER ALWAYS OPENS ON THE DELIVERY TAB. `policyTab = "delivery"` runs on
 * every open, so a spec that wants the ladder or the triage settings must click
 * its tab first, every time. Forgetting this is a silent miss: the ladder
 * selectors simply are not in the DOM and the wait times out on nothing.
 *
 * TEAM CHANNEL vs POLICY DESTINATIONS are two different fields on two different
 * endpoints. The team channel's `source` ("team" | "policy") is the only thing
 * carrying the difference between `Some([])` — announce nowhere on purpose —
 * and `None` — never set, so the policy's list applies. Both render an empty
 * list; only `source` tells them apart, which is why `expectChannelSource()`
 * reads the tag rather than counting chips.
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

/** `[data-test="x"]` + `field` -> `[data-test="x-field"]`. See OnCallTeamsPage. */
function part(selector, suffix) {
  return selector.replace(/"\]$/, `-${suffix}"]`);
}

export class OnCallPolicyEditorPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      detailRoot: '[data-test="oncall-team-detail-page"]',
      ladder: '[data-test="oncall-escalation-ladder"]',
      openEditor: '[data-test="oncall-policy-edit"]',

      editor: '[data-test="oncall-policy-editor"]',
      priorityBar: '[data-test="oncall-policy-priority-bar"]',
      tabPolicy: '[data-test="oncall-policy-tab-policy"]',
      tabDelivery: '[data-test="oncall-policy-tab-delivery"]',
      tabTriage: '[data-test="oncall-policy-tab-triage"]',
      panelPolicy: '[data-test="oncall-policy-panel-policy"]',
      rungPanel: '[data-test="oncall-policy-rung"]',
      silent: '[data-test="oncall-policy-silent"]',
      sentence: '[data-test="oncall-policy-sentence"]',
      save: '[data-test="oncall-policy-save"]',

      // delivery tab
      destinations: '[data-test="oncall-policy-destinations"]',
      destinationsEmpty: '[data-test="oncall-policy-destinations-empty"]',
      teamChannel: '[data-test="oncall-team-channel"]',
      teamChannelSelect: '[data-test="oncall-team-channel-select"]',
      teamChannelSource: '[data-test="oncall-team-channel-source"]',
      teamChannelSave: '[data-test="oncall-team-channel-save"]',
      teamChannelClear: '[data-test="oncall-team-channel-clear"]',
      teamChannelSilent: '[data-test="oncall-team-channel-silent"]',

      // triage (L0) tab
      l0Editor: '[data-test="oncall-l0-editor"]',
      l0Budget: '[data-test="oncall-l0-budget"]',
      l0AllowPromotion: '[data-test="oncall-l0-allow-promotion"]',
      l0MaxSteps: '[data-test="oncall-l0-max-steps"]',
    };
  }

  // -------------------------------------------------------- dynamic selectors

  priorityChip(priority) { return `[data-test="oncall-policy-priority-${priority}"]`; }
  step(priority, stepIndex) { return `[data-test="oncall-policy-rung-${priority}-${stepIndex}"]`; }
  removeStep(priority, stepIndex) {
    return `[data-test="oncall-policy-remove-rung-${priority}-${stepIndex}"]`;
  }
  addStep(priority) { return `[data-test="oncall-policy-add-step-${priority}"]`; }
  target(priority, stepIndex, ti) {
    return `[data-test="oncall-policy-target-${priority}-${stepIndex}-${ti}"]`;
  }
  removeTarget(priority, stepIndex, ti) {
    return `[data-test="oncall-policy-target-remove-${priority}-${stepIndex}-${ti}"]`;
  }
  addTarget(priority, stepIndex) {
    return `[data-test="oncall-policy-add-target-${priority}-${stepIndex}"]`;
  }
  pickRotation(priority, stepIndex) {
    return `[data-test="oncall-policy-pick-rotation-${priority}-${stepIndex}"]`;
  }
  reachesNobody(priority, stepIndex) {
    return `[data-test="oncall-policy-preview-nobody-${priority}-${stepIndex}"]`;
  }
  missingRotation(priority, stepIndex) {
    return `[data-test="oncall-policy-missing-rotation-${priority}-${stepIndex}"]`;
  }
  channelToggle(priority, channel) {
    return `[data-test="oncall-policy-channel-${priority}-${channel}"]`;
  }
  l0Mode(severity) { return `[data-test="oncall-l0-mode-${severity.toLowerCase()}"]`; }

  // ------------------------------------------------------------- element getters

  getEditor() { return this.page.locator(this.locators.editor); }
  getTarget(priority, stepIndex, ti) {
    return this.page.locator(this.target(priority, stepIndex, ti)).first();
  }
  getRemoveTarget(priority, stepIndex, ti) {
    return this.page.locator(this.removeTarget(priority, stepIndex, ti)).first();
  }

  // ------------------------------------------------------------- navigation

  async gotoEscalationTab(orgId, teamId) {
    await this.page.goto(`/web/oncall/teams/${teamId}/escalation?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.detailRoot)).toBeVisible({ timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    testLogger.navigation('On-call escalation tab');
  }

  /** The drawer opens on the DELIVERY tab every time — see the class docblock. */
  async openEditor() {
    await this.page.locator(this.locators.openEditor).first().click();
    await expect(this.page.locator(this.locators.editor)).toBeVisible({ timeout: 30000 });
  }

  /** @param {'policy'|'delivery'|'triage'} name */
  async openTab(name) {
    const map = {
      policy: this.locators.tabPolicy,
      delivery: this.locators.tabDelivery,
      triage: this.locators.tabTriage,
    };
    await this.page.locator(map[name]).first().click();
  }

  async selectPriority(priority) {
    await this.page.locator(this.priorityChip(priority)).first().click();
  }

  async expectEditorVisible() {
    await expect(this.page.locator(this.locators.editor)).toBeVisible({ timeout: 30000 });
  }

  // ------------------------------------------------------------ the ladder

  /** How many STEPS the selected priority currently draws. */
  async countSteps(priority) {
    return await this.page
      .locator(`[data-test^="oncall-policy-rung-${priority}-"]`)
      .count();
  }

  /**
   * The rendered text of every step of a priority, in index order.
   *
   * The whole of TS-10.06 is that add and remove operate on the INTENDED index,
   * so the assertion has to be on the ordered list of what each step says —
   * not on a count, which a remove-the-wrong-one bug passes trivially.
   */
  async readStepTexts(priority) {
    const out = [];
    const count = await this.countSteps(priority);
    for (let i = 0; i < count; i++) {
      const el = this.page.locator(this.step(priority, i)).first();
      out.push(((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim());
    }
    return out;
  }

  async removeStepAt(priority, stepIndex) {
    await this.page.locator(this.removeStep(priority, stepIndex)).first().click();
  }

  async addStepTo(priority) {
    await this.page.locator(this.addStep(priority)).first().click();
  }

  async expectStepReachesNobody(priority, stepIndex) {
    await expect(
      this.page.locator(this.reachesNobody(priority, stepIndex)),
      `step ${stepIndex} of P${priority} reaches nobody and must say so at edit time`,
    ).toBeVisible({ timeout: 20000 });
  }

  async expectStepNamesMissingRotation(priority, stepIndex) {
    await expect(
      this.page.locator(this.missingRotation(priority, stepIndex)),
      `step ${stepIndex} of P${priority} names a rotation the team no longer has`,
    ).toBeVisible({ timeout: 20000 });
  }

  async savePolicy() {
    await this.page.locator(this.locators.save).first().click();
  }

  async expectSaveDisabled() {
    await expect(
      this.page.locator(this.locators.save).first(),
      'an invalid draft must not be savable',
    ).toBeDisabled({ timeout: 20000 });
  }

  // -------------------------------------------------------- the team channel

  async expectTeamChannelVisible() {
    await expect(this.page.locator(this.locators.teamChannel)).toBeVisible({ timeout: 30000 });
  }

  /**
   * The provenance tag's text — "set on this team" or "from the policy".
   *
   * This is the ONLY rendered difference between `Some([])` and `None`: both
   * draw an empty destination list.
   */
  async readChannelSourceText() {
    const tag = this.page.locator(this.locators.teamChannelSource).first();
    await tag.waitFor({ state: 'visible', timeout: 20000 });
    return ((await tag.innerText().catch(() => '')) || '').trim();
  }

  async expectChannelSilentWarning() {
    await expect(
      this.page.locator(this.locators.teamChannelSilent),
      'a team that announces nowhere on purpose must say so',
    ).toBeVisible({ timeout: 20000 });
  }

  /** "Use the policy's list" — sends `destinations: null`, i.e. None. */
  async clearTeamChannel() {
    await this.page.locator(this.locators.teamChannelClear).first().click();
  }

  async selectChannelDestination(value) {
    const trigger = this.page.locator(part(this.locators.teamChannelSelect, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
    await trigger.click();
    const option = this.page
      .locator(`${part(this.locators.teamChannelSelect, 'option')}[data-test-value="${value}"]`)
      .first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
    // A multi-select keeps its popover open; close it so the Save button is hit.
    await this.page.keyboard.press('Escape');
  }

  async saveTeamChannel() {
    await this.page.locator(this.locators.teamChannelSave).first().click();
  }

  // ------------------------------------------------------------------ L0

  async expectL0EditorVisible() {
    await expect(this.page.locator(this.locators.l0Editor)).toBeVisible({ timeout: 30000 });
  }

  /**
   * The triage-budget options the editor offers, as numbers.
   *
   * A SELECT, not a free text field — which is itself the finding for
   * TS-11.04's UI half: an out-of-bounds budget cannot be typed here at all,
   * so the bound is enforced by the shape of the control and the refusal can
   * only be provoked at the API.
   */
  async readBudgetOptions() {
    const trigger = this.page.locator(part(this.locators.l0Budget, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();
    const options = this.page.locator(part(this.locators.l0Budget, 'option'));
    await options.first().waitFor({ state: 'visible', timeout: 20000 });
    const count = await options.count();
    const values = [];
    for (let i = 0; i < count; i++) {
      const v = await options.nth(i).getAttribute('data-test-value');
      if (v !== null) values.push(Number(v));
    }
    await this.page.keyboard.press('Escape');
    return values;
  }

  async selectBudget(seconds) {
    const trigger = this.page.locator(part(this.locators.l0Budget, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();
    const option = this.page
      .locator(`${part(this.locators.l0Budget, 'option')}[data-test-value="${seconds}"]`)
      .first();
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();
  }
}

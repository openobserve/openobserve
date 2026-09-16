/**
 * OnCallTeamDetailPage - one team's screen (views/OnCall/OnCallTeamDetail.vue)
 *
 * The URL and the TAB do not use the same words, and getting this wrong lands
 * on the default tab with no error:
 *
 *   URL segment      tab data-test
 *   overview      →  oncall-team-tab-overview
 *   schedule      →  oncall-team-tab-schedule
 *   escalation    →  oncall-team-tab-policy      <- alias
 *   routing       →  oncall-team-tab-ownership   <- alias
 *   members       →  oncall-team-tab-members
 *
 * `openTab()` takes EITHER spelling so a spec can say what the plan says.
 * The view writes the URL back with `replace`, so Back leaves the team rather
 * than walking the five tabs.
 *
 * Lane selectors on the schedule timeline carry the ROTATION ID
 * (`oncall-lane-edit-<rotationId>`), which is the id a seeded rotation was
 * created with — never its name, since a rotation is renameable.
 *
 * Two editors, both drawers, both reached from the schedule tab:
 *   - the rotation editor  `oncall-schedule-editor` / `oncall-rotation-drawer`
 *   - Quick start          `oncall-presets-drawer`  (locale: "Quick start")
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

/** URL segment -> the tab's internal name, which is what the data-test carries. */
const URL_TAB_NAME = {
  escalation: 'policy',
  routing: 'ownership',
};

/** The reverse, for building a URL from a tab name. */
const TAB_URL_NAME = {
  policy: 'escalation',
  ownership: 'routing',
};

/**
 * `[data-test="x"]` + `field` -> `[data-test="x-field"]`.
 *
 * O2 form controls nest their parts INSIDE the attribute value, so a suffix
 * appended after the closing bracket parses as a type selector and matches
 * nothing at all — silently, which is the trap.
 */
function part(selector, suffix) {
  return selector.replace(/"\]$/, `-${suffix}"]`);
}

export class OnCallTeamDetailPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      root: '[data-test="oncall-team-detail-page"]',
      tabs: '[data-test="oncall-team-tabs"]',
      editButton: '[data-test="oncall-team-detail-edit-btn"]',
      overrideButton: '[data-test="oncall-team-override-btn"]',
      error: '[data-test="oncall-team-detail-error"]',
      notAvailable: '[data-test="oncall-team-detail-not-available"]',
      coverageTag: '[data-test="oncall-team-coverage"]',
      configRisks: '[data-test="oncall-team-config-risks"]',
      coverageCard: '[data-test="oncall-team-coverage-card"]',
      openSchedule: '[data-test="oncall-team-open-schedule"]',

      // Schedule tab — the read surface.
      timeline: '[data-test="oncall-schedule-timeline"]',
      timelineChart: '[data-test="oncall-timeline-chart"]',
      timelineEmpty: '[data-test="oncall-timeline-empty"]',
      timelineAdd: '[data-test="oncall-timeline-add"]',
      timelinePresets: '[data-test="oncall-timeline-presets"]',
      timelineGap: '[data-test="oncall-timeline-gap"]',
      timelineFillGap: '[data-test="oncall-timeline-fill-gap"]',
      timelineToday: '[data-test="oncall-timeline-today"]',
      timelinePrev: '[data-test="oncall-timeline-prev"]',
      timelineNext: '[data-test="oncall-timeline-next"]',
      timelineRange: '[data-test="oncall-timeline-range"]',
      timelineZone: '[data-test="oncall-timeline-zone"]',

      // Schedule tab — the rotation editor drawer.
      scheduleEditor: '[data-test="oncall-schedule-editor"]',
      rotationDrawer: '[data-test="oncall-rotation-drawer"]',
      rotationDone: '[data-test="oncall-rotation-done"]',
      rotationDelete: '[data-test="oncall-rotation-delete"]',
      rotationNeedsRules: '[data-test="oncall-rotation-needs-rules"]',
      rotationNoMembers: '[data-test="oncall-rotation-no-members"]',
      rotationOpenMembers: '[data-test="oncall-rotation-open-members"]',
      scheduleName: '[data-test="oncall-schedule-name"]',
      scheduleNameClash: '[data-test="oncall-schedule-name-clash"]',
      scheduleSave: '[data-test="oncall-schedule-save"]',
      scheduleAddRotation: '[data-test="oncall-schedule-add-rotation"]',
      scheduleRuleTabs: '[data-test="oncall-schedule-rule-tabs"]',
      scheduleRuleAdd: '[data-test="oncall-schedule-rule-add"]',
      scheduleNoMembers: '[data-test="oncall-schedule-no-members"]',
      scheduleEmpty: '[data-test="oncall-schedule-empty"]',
      rotationsTable: '[data-test="oncall-rotations-table"]',

      // Quick start drawer (OnCallSchedulePresets).
      presetsDrawer: '[data-test="oncall-presets-drawer"]',
      presetsTabs: '[data-test="oncall-presets-tabs"]',
      presetsApply: '[data-test="oncall-presets-apply"]',
      presetsError: '[data-test="oncall-presets-error"]',
      presetDefaults: '[data-test="oncall-preset-defaults"]',
      presetDefaultsToggle: '[data-test="oncall-preset-defaults-toggle"]',

      // Escalation tab.
      escalationLadder: '[data-test="oncall-escalation-ladder"]',
      ladderRungs: '[data-test="oncall-ladder-rungs"]',
      ladderAddRung: '[data-test="oncall-ladder-add-rung"]',
      ladderSilent: '[data-test="oncall-ladder-silent"]',
      ladderEnds: '[data-test="oncall-ladder-ends"]',
      policyEdit: '[data-test="oncall-policy-edit"]',
      policyEditor: '[data-test="oncall-policy-editor"]',
      policySave: '[data-test="oncall-policy-save"]',
      policyTabs: '[data-test="oncall-policy-tabs"]',
      policySilent: '[data-test="oncall-policy-silent"]',
      policyNoDefaultWarning: '[data-test="oncall-policy-no-default-warning"]',
      policyDestinations: '[data-test="oncall-policy-destinations"]',
      policyDestinationsWarning: '[data-test="oncall-policy-destinations-warning"]',
      policyLadderEnd: '[data-test="oncall-policy-ladder-end"]',

      // Routing tab (internally "ownership").
      ownership: '[data-test="oncall-ownership"]',
      ownershipTable: '[data-test="oncall-ownership-table"]',
      ownershipRules: '[data-test="oncall-ownership-rules"]',
      ownershipHeader: '[data-test="oncall-ownership-header"]',
      ownershipAddRule: '[data-test="oncall-ownership-add-rule"]',
      ownershipEmpty: '[data-test="oncall-ownership-empty"]',

      // Members tab.
      members: '[data-test="oncall-members"]',
      membersTable: '[data-test="oncall-members-table"]',
      membersAddButton: '[data-test="oncall-members-add-btn"]',
      membersEmailInput: '[data-test="oncall-members-email-input"]',
      membersUserSelect: '[data-test="oncall-members-user-select"]',
      membersEmpty: '[data-test="oncall-members-empty"]',
      membersCoverage: '[data-test="oncall-members-coverage"]',
      membersAwayDialog: '[data-test="oncall-members-away-dialog"]',
      membersAwaySave: '[data-test="oncall-members-away-save"]',

      // Setup checklist / Quick start banner.
      setupChecklist: '[data-test="oncall-setup-checklist"]',
      setupBanner: '[data-test="oncall-setup-banner"]',
      setupNext: '[data-test="oncall-setup-next"]',
      setupProgress: '[data-test="oncall-setup-progress"]',

      // Confirmations are ConfirmDialogs, which forward their data-test to the panel.
      confirmDialog: '[data-test="confirm-dialog"]',
      confirmOk: '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
    };
  }

  // Row/lane-scoped selectors carry ids, so they are built rather than stored.
  tabButton(name) { return `[data-test="oncall-team-tab-${URL_TAB_NAME[name] ?? name}"]`; }
  laneHeader(rotationId) { return `[data-test="oncall-lane-header-${rotationId}"]`; }
  laneEdit(rotationId) { return `[data-test="oncall-lane-edit-${rotationId}"]`; }
  laneMenu(rotationId) { return `[data-test="oncall-lane-menu-${rotationId}"]`; }
  laneDelete(rotationId) { return `[data-test="oncall-lane-delete-${rotationId}"]`; }
  laneDuplicate(rotationId) { return `[data-test="oncall-lane-duplicate-${rotationId}"]`; }
  laneOverride(rotationId) { return `[data-test="oncall-lane-override-${rotationId}"]`; }
  laneAssign(rotationId) { return `[data-test="oncall-lane-assign-${rotationId}"]`; }
  laneEmpty(rotationId) { return `[data-test="oncall-lane-empty-${rotationId}"]`; }
  laneNotPaging(rotationId) { return `[data-test="oncall-lane-not-paging-${rotationId}"]`; }
  laneCadence(rotationId) { return `[data-test="oncall-lane-cadence-${rotationId}"]`; }

  ruleTab(index) { return `[data-test="oncall-schedule-rule-tab-${index}"]`; }
  rulePanel(index) { return `[data-test="oncall-schedule-rule-panel-${index}"]`; }
  ruleName(index) { return `[data-test="oncall-schedule-rule-name-${index}"]`; }
  ruleRemove(index) { return `[data-test="oncall-schedule-rule-remove-${index}"]`; }
  ruleMembers(index) { return `[data-test="oncall-schedule-members-${index}"]`; }
  rulePriority(index) { return `[data-test="oncall-schedule-priority-${index}"]`; }
  ruleRestriction(ruleIndex, index) {
    return `[data-test="oncall-schedule-restriction-${ruleIndex}-${index}"]`;
  }
  ruleRestrictionAdd(ruleIndex) {
    return `[data-test="oncall-schedule-restriction-add-${ruleIndex}"]`;
  }
  ruleNeedsPeople(ruleIndex) {
    return `[data-test="oncall-rotation-needs-people-${ruleIndex}"]`;
  }

  presetTab(presetId) { return `[data-test="oncall-preset-${presetId}"]`; }
  presetRow(rowKey) { return `[data-test="oncall-preset-row-${rowKey}"]`; }
  presetRowName(rowKey) { return `[data-test="oncall-preset-field-${rowKey}-name"]`; }
  presetRowMembers(rowKey) { return `[data-test="oncall-preset-field-${rowKey}-members"]`; }

  ladderPriority(key) { return `[data-test="oncall-ladder-priority-${key}"]`; }
  ladderRung(firstMicros) { return `[data-test="oncall-ladder-rung-${firstMicros}"]`; }
  ladderRungProblem(firstMicros) {
    return `[data-test="oncall-ladder-rung-problem-${firstMicros}"]`;
  }

  ownershipEditRule(ruleId) { return `[data-test="oncall-ownership-edit-${ruleId}"]`; }
  ownershipDeleteRule(ruleId) { return `[data-test="oncall-ownership-delete-${ruleId}"]`; }
  ruleHealth(ruleId) { return `[data-test="oncall-rule-health-${ruleId}"]`; }
  ruleTeam(ruleId) { return `[data-test="oncall-rule-team-${ruleId}"]`; }

  memberRemove(memberId) { return `[data-test="oncall-members-remove-${memberId}"]`; }
  memberMarkAway(memberId) { return `[data-test="oncall-members-mark-away-${memberId}"]`; }
  memberShift(memberId) { return `[data-test="oncall-members-shift-${memberId}"]`; }

  /** The handover row's zone label and its time input, both indexed by row position. */
  handoverTimezone(index) { return `[data-test="oncall-schedule-handover-${index}-timezone"]`; }
  handoverTime(index) { return `[data-test="oncall-schedule-handover-${index}-time"]`; }

  /** An L0 hold band carries the agent id, so it is matched by prefix. */
  anyLadderL0() { return '[data-test^="oncall-ladder-l0-"]'; }
  /** Shift-rule tabs are indexed by POSITION, so a count is the only stable read. */
  anyRuleTab() { return '[data-test^="oncall-schedule-rule-tab-"]'; }

  // ------------------------------------------------------------- element getters

  getRoot() { return this.page.locator(this.locators.root); }
  getEditButton() { return this.page.locator(this.locators.editButton); }
  getTabButton(name) { return this.page.locator(this.tabButton(name)); }
  getConfirmDialog() { return this.page.locator(this.locators.confirmDialog); }
  getMembersTable() { return this.page.locator(this.locators.membersTable); }
  getRotationDrawer() { return this.page.locator(this.locators.rotationDrawer); }

  getLaneEdit(rotationId) { return this.page.locator(this.laneEdit(rotationId)); }
  getLaneCadence(rotationId) { return this.page.locator(this.laneCadence(rotationId)); }
  getRuleRestriction(ruleIndex, index) {
    return this.page.locator(this.ruleRestriction(ruleIndex, index));
  }

  /**
   * A notice rendered inside one restriction window, scoped to that window.
   *
   * The wording is passed in rather than pinned here — it is the product's own
   * copy and the assertion the spec is making, so holding it in the page object
   * would make every caller depend on the English.
   */
  getRestrictionNotice(ruleIndex, index, wording) {
    return this.getRuleRestriction(ruleIndex, index).getByText(wording, { exact: false });
  }

  /** The rotation name INPUT, not its wrapper — `toHaveValue` needs the control. */
  getScheduleNameField() {
    return this.page.locator(part(this.locators.scheduleName, 'field')).first();
  }

  getHandoverTimezone(index) { return this.page.locator(this.handoverTimezone(index)).first(); }
  /** The picker's `<input>`; the wrapper has no value to read. */
  getHandoverTimeInput(index) {
    return this.page.locator(`${this.handoverTime(index)} input`).first();
  }

  /** How many shift-rule tabs the drawer currently has — the next rule's index. */
  async countShiftRuleTabs() {
    return await this.page.locator(this.anyRuleTab()).count();
  }

  getPresetsTabs() { return this.page.locator(this.locators.presetsTabs); }
  /** The catalogue lands on a shape rather than an empty pane; this is that shape. */
  getActivePresetTab() {
    return this.page.locator(`${this.locators.presetsTabs} [data-state="active"]`);
  }
  getPresetTab(presetId) { return this.page.locator(this.presetTab(presetId)); }
  getPresetRow(rowKey) { return this.page.locator(this.presetRow(rowKey)); }

  /** Every L0 hold band on the ladder. Count, not visibility — there may be none. */
  getLadderL0Bands() { return this.page.locator(this.anyLadderL0()); }

  /**
   * A member row found by the address it renders.
   *
   * Member controls key off the ROW id and never the email, so the row is found
   * by its rendered address and the control taken from inside it.
   */
  getMemberRowByText(text) {
    return this.page.locator('[data-test^="o2-table-row-"]').filter({ hasText: text }).first();
  }

  getMemberRemoveIn(rowLocator) {
    return rowLocator.locator('[data-test^="oncall-members-remove-"]').first();
  }

  getConfirmOkIn(dialogLocator) {
    return dialogLocator.locator('[data-test="o-dialog-primary-btn"]').first();
  }

  // ---------------------------------------------------------------- navigation

  /**
   * @param {string} orgId the org **identifier** (ksuid), never the display name.
   * @param {string} teamId
   * @param {string|null} tab either spelling — `escalation`/`policy`,
   *   `routing`/`ownership` — since the URL and the tab disagree on purpose.
   */
  async goto(orgId, teamId, tab = null) {
    const segment = tab ? `/${TAB_URL_NAME[tab] ?? tab}` : '';
    await this.page.goto(`/web/oncall/teams/${teamId}${segment}?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('On-call team detail', { teamId, tab });
  }

  /**
   * Switch tabs and assert the switch actually took.
   *
   * OTab forwards `data-state`, so the active tab is assertable rather than
   * assumed — clicking mid-animation is otherwise a silent no-op.
   */
  async openTab(name) {
    const tab = this.page.locator(this.tabButton(name));
    await tab.waitFor({ state: 'visible', timeout: 20000 });
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'active', { timeout: 15000 });
    testLogger.info('On-call team tab opened', { tab: name });
  }

  /** The tab the URL landed on, in its INTERNAL spelling (policy / ownership). */
  async readActiveTab() {
    const active = this.page.locator(`${this.locators.tabs} [data-state="active"]`).first();
    const attr = await active.getAttribute('data-test');
    return (attr ?? '').replace('oncall-team-tab-', '');
  }

  // --------------------------------------------------------- edit-team drawer

  async openEditDrawer() {
    await this.page.locator(this.locators.editButton).click();
    await expect(
      this.page.locator('[data-test="oncall-team-form-drawer"]'),
    ).toBeVisible({ timeout: 20000 });
  }

  // ----------------------------------------------------------- schedule tab

  async openScheduleTab() {
    await this.openTab('schedule');
    await expect(this.page.locator(this.locators.timeline)).toBeVisible({ timeout: 30000 });
  }

  /**
   * "Add rotation" from the timeline — the editor opens as a DRAWER, not a page.
   *
   * WAIT ON THE DRAWER, NOT ON `oncall-schedule-editor`. The team detail mounts
   * OnCallScheduleEditor with `drawer-only`, which suppresses the rotations
   * table and the no-members line and leaves the component's root div rendered
   * but empty — so `oncall-schedule-editor` RESOLVES and stays `hidden` forever,
   * which reads as "the editor never opened" when the drawer is wide open on
   * screen. `oncall-rotation-drawer` is the surface that actually appears, and
   * it is the one `closeRotationEditor()` already waits to go away.
   */
  async openRotationEditor() {
    await this.page.locator(this.locators.timelineAdd).click();
    await expect(this.page.locator(this.locators.rotationDrawer)).toBeVisible({ timeout: 20000 });
  }

  /** Edit an existing lane. `rotationId` is the id the rotation was created with. */
  async openRotationEditorFor(rotationId) {
    const edit = this.page.locator(this.laneEdit(rotationId));
    await edit.waitFor({ state: 'visible', timeout: 20000 });
    await edit.click();
    await expect(this.page.locator(this.locators.rotationDrawer)).toBeVisible({ timeout: 20000 });
  }

  async fillRotationName(name) {
    const field = this.page.locator(part(this.locators.scheduleName, 'field')).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(name);
  }

  /** Shift rules are tabs inside the rotation drawer, indexed from 0. */
  async openShiftRule(index) {
    const tab = this.page.locator(this.ruleTab(index));
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'active', { timeout: 10000 });
  }

  async addShiftRule() {
    await this.page.locator(this.locators.scheduleRuleAdd).click();
  }

  async addRestriction(ruleIndex) {
    await this.page.locator(this.ruleRestrictionAdd(ruleIndex)).click();
  }

  async saveRotation() {
    await this.page.locator(this.locators.scheduleSave).click();
  }

  async closeRotationEditor() {
    await this.page.locator(this.locators.rotationDone).click();
    await expect(this.page.locator(this.locators.rotationDrawer)).toBeHidden({ timeout: 20000 });
  }

  /** §8.6: a shift rule with nobody on it is refused, and the drawer says so. */
  async expectRuleNeedsPeople(ruleIndex) {
    await expect(this.page.locator(this.ruleNeedsPeople(ruleIndex))).toBeVisible({ timeout: 20000 });
  }

  async expectRotationNeedsRules() {
    await expect(this.page.locator(this.locators.rotationNeedsRules)).toBeVisible({ timeout: 20000 });
  }

  // ------------------------------------------------------ quick start drawer

  /**
   * Open Quick start.
   *
   * The locale calls it "Quick start" (`oncall.presetsTitle`); the component is
   * OnCallSchedulePresets and everything inside it is keyed `oncall-preset*`.
   * Applying one is a FULL REPLACE of the team's rotations, so on a team that
   * already has a schedule a confirmation stands between Save and the request.
   */
  async openQuickStart() {
    await this.page.locator(this.locators.timelinePresets).click();
    await expect(this.page.locator(this.locators.presetsDrawer)).toBeVisible({ timeout: 20000 });
  }

  async chooseQuickStartTemplate(presetId) {
    const tab = this.page.locator(this.presetTab(presetId));
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'active', { timeout: 10000 });
  }

  /**
   * Name one Quick start region.
   *
   * An OInlineEdit, not an OInput: at rest it is a BUTTON (`-trigger`) and the
   * text field (`-input`) exists only once that button has been clicked, so
   * filling without opening it first types into nothing. Enter commits — the
   * component writes back on blur or Enter, never per keystroke.
   */
  async fillQuickStartRegionName(rowKey, name) {
    const base = this.presetRowName(rowKey);
    const trigger = this.page.locator(part(base, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
    await trigger.click();
    const field = this.page.locator(part(base, 'input')).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(name);
    await field.press('Enter');
  }

  /**
   * Staff one Quick start region.
   *
   * A multi-select OSelect, so the popover stays open across picks and each
   * option is matched on `data-test-value` — the member's email — rather than
   * the rendered display name, which the roster may not have.
   */
  async setQuickStartRegionMembers(rowKey, emails) {
    const field = this.presetRowMembers(rowKey);
    const trigger = this.page.locator(part(field, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
    await trigger.click();
    for (const email of emails) {
      const option = this.page.locator(`${part(field, 'option')}[data-test-value="${email}"]`).first();
      await option.waitFor({ state: 'visible', timeout: 15000 });
      await option.click();
    }
    await this.page.keyboard.press('Escape');
  }

  getQuickStartApply() { return this.page.locator(this.locators.presetsApply); }

  async applyQuickStart() {
    await this.getQuickStartApply().click();
  }

  /**
   * §11.2: Save with regions unnamed and unstaffed must not be a silent no-op.
   *
   * The contract is EITHER the button is disabled OR the screen names the
   * missing field — the plan accepts both, and a spec asserting only one of them
   * would be wrong the moment the fix lands the other way. This reads both and
   * hands them back so the spec can assert the disjunction.
   *
   * `requestSeen` is the part that catches a silent no-op: a Save that fires
   * nothing AND says nothing is the defect, and neither half alone proves it.
   *
   * @returns {Promise<{disabled: boolean, requestSeen: boolean, error: string|null, invalidFields: number}>}
   */
  async attemptQuickStartSave({ settleMs = 1500 } = {}) {
    const apply = this.getQuickStartApply();
    await apply.waitFor({ state: 'visible', timeout: 20000 });
    const disabled = await apply.isDisabled();

    let requestSeen = false;
    const watch = (request) => {
      if (/\/oncall\/teams\/[^/]+\/schedule/.test(request.url())) requestSeen = true;
    };
    this.page.on('request', watch);
    try {
      if (!disabled) await apply.click();
      await this.page.waitForTimeout(settleMs);
    } finally {
      this.page.off('request', watch);
    }

    const errorNode = this.page.locator(this.locators.presetsError);
    const error = (await errorNode.count()) > 0
      ? ((await errorNode.first().textContent()) ?? '').trim()
      : null;
    // Per-field messages are rendered by the inputs themselves, so they are
    // counted rather than read: the point is that SOMETHING named the gap.
    const invalidFields = await this.page
      .locator(`${this.locators.presetsDrawer} [data-test$="-error"]`)
      .count();

    return { disabled, requestSeen, error, invalidFields };
  }

  // --------------------------------------------------------- escalation tab

  async openEscalationTab() {
    await this.openTab('escalation');
    await expect(this.page.locator(this.locators.escalationLadder)).toBeVisible({ timeout: 30000 });
  }

  async openPolicyEditor() {
    await this.page.locator(this.locators.policyEdit).click();
    await expect(this.page.locator(this.locators.policyEditor)).toBeVisible({ timeout: 20000 });
  }

  async savePolicy() {
    await this.page.locator(this.locators.policySave).click();
  }

  /** A priority whose ladder wakes nobody — badged on the tab, not only inside it. */
  async expectSilentPriorityWarning() {
    await expect(this.page.locator(this.locators.ladderSilent)).toBeVisible({ timeout: 20000 });
  }

  // ------------------------------------------------------------ routing tab

  async openRoutingTab() {
    await this.openTab('routing');
    await expect(this.page.locator(this.locators.ownership)).toBeVisible({ timeout: 30000 });
  }

  /**
   * The server's health verdict for one rule — `healthy`, `shadowed`, `never_used`.
   *
   * Read, never recomputed: "shadowed" is a claim about rules this screen never
   * fetched, so only the server can make it.
   */
  async readRuleHealth(ruleId) {
    const tag = this.page.locator(this.ruleHealth(ruleId));
    await tag.waitFor({ state: 'visible', timeout: 20000 });
    return ((await tag.textContent()) ?? '').trim();
  }

  // ------------------------------------------------------------ members tab

  async openMembersTab() {
    await this.openTab('members');
    await expect(this.page.locator(this.locators.members)).toBeVisible({ timeout: 30000 });
  }

  async openAddMember() {
    await this.page.locator(this.locators.membersAddButton).click();
  }

  async removeMember(memberId) {
    await this.page.locator(this.memberRemove(memberId)).click();
    const confirm = this.page.locator(this.locators.confirmOk);
    if (await confirm.count()) await confirm.click();
  }

  /**
   * Stage one person for adding.
   *
   * The picker is a MULTI-select over org users, not a dialog: the Add button
   * is the submit and stays disabled until something is staged. When the user
   * lookup fails the component swaps the picker for a free-text email input,
   * so both shapes are handled — the fallback is the only path that can add a
   * NON-org address, which is the one the server must refuse.
   */
  async pickMemberToAdd(email) {
    const picker = this.page.locator(this.locators.membersUserSelect);
    if (await picker.count()) {
      const trigger = this.page.locator(part(this.locators.membersUserSelect, 'trigger')).first();
      await trigger.waitFor({ state: 'visible', timeout: 20000 });
      await trigger.click();
      const option = this.page
        .locator(`${part(this.locators.membersUserSelect, 'option')}[data-test-value="${email}"]`).first();
      await option.waitFor({ state: 'visible', timeout: 20000 });
      await option.click();
      await this.page.keyboard.press('Escape');
      return;
    }
    await this.page.locator(part(this.locators.membersEmailInput, 'field')).first().fill(email);
  }

  async submitAddMembers() {
    await this.page.locator(this.locators.membersAddButton).click();
  }

  /** "N of M org members" — the screen's own answer to who is on this team. */
  async readMembersCoverage() {
    const node = this.page.locator(this.locators.membersCoverage);
    if ((await node.count()) === 0) return null;
    return ((await node.first().innerText()) ?? '').replace(/\s+/g, ' ').trim();
  }



  /**
   * The config-risk count riding the title.
   *
   * It is a COUNT, not a list — the risk texts live on
   * `GET /teams/{id}/config-risks` and are derived on read, so a spec asserting
   * that a risk cleared reads the endpoint and asserts the tag disappeared.
   * Returns null when the tag is absent, which is what "no risks" looks like.
   */
  async readConfigRiskCount() {
    const tag = this.page.locator(this.locators.configRisks);
    if ((await tag.count()) === 0) return null;
    const text = ((await tag.first().innerText()) ?? '').trim();
    const m = /(\d+)/.exec(text);
    return m ? Number(m[1]) : text;
  }

  async expectConfigRiskTagVisible() {
    await expect(this.page.locator(this.locators.configRisks)).toBeVisible({ timeout: 30000 });
  }


  // ---------------------------------------------------------------- reading

  /**
   * The names the schedule timeline actually drew (§11.5).
   *
   * The bands render `nameOf(email)` — a DISPLAY name — so a raw address
   * appearing here is the defect, not a formatting preference. Returns the band
   * labels so a spec can assert on what is on screen rather than on a count.
   */
  async readTimelineLabels() {
    await this.page.locator(this.locators.timeline).waitFor({ state: 'visible', timeout: 30000 });
    const chart = this.page.locator(this.locators.timelineChart);
    if ((await chart.count()) === 0) return [];
    const text = (await chart.first().innerText()) ?? '';
    return text.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  /** The rotation ids the timeline drew a lane for. */
  async readLaneIds() {
    const headers = this.page.locator('[data-test^="oncall-lane-header-"]');
    const count = await headers.count();
    const ids = [];
    for (let i = 0; i < count; i++) {
      const attr = await headers.nth(i).getAttribute('data-test');
      if (attr) ids.push(attr.replace('oncall-lane-header-', ''));
    }
    return ids;
  }

  /** The coverage verdict tag riding the title: whether a page would reach anybody. */
  async readCoverageState() {
    const tag = this.page.locator(this.locators.coverageTag);
    await tag.waitFor({ state: 'visible', timeout: 30000 });
    return (await tag.getAttribute('value')) ?? ((await tag.textContent()) ?? '').trim();
  }

  // ---------------------------------------------------------------- assertions

  async expectDetailVisible() {
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.tabs)).toBeVisible({ timeout: 30000 });
  }

  async expectLaneVisible(rotationId) {
    await expect(this.page.locator(this.laneHeader(rotationId))).toBeVisible({ timeout: 30000 });
  }

  /** A lane nothing can page — the timeline's own alarm, per rotation. */
  async expectLaneNotPaging(rotationId) {
    await expect(this.page.locator(this.laneNotPaging(rotationId))).toBeVisible({ timeout: 30000 });
  }

  async expectScheduleGap() {
    await expect(this.page.locator(this.locators.timelineGap)).toBeVisible({ timeout: 30000 });
  }

  /** §10.5: what the API refuses must not be drawn. */
  async expectConfigurationControlsHidden() {
    await expect(this.page.locator(this.locators.editButton)).toHaveCount(0, { timeout: 20000 });
    await expect(this.page.locator(this.locators.overrideButton)).toHaveCount(0, { timeout: 20000 });
  }

  // ------------------------------------------------------- enterprise gating

  async isUnavailable() {
    return (await this.page.locator(this.locators.notAvailable).count()) > 0;
  }

  /**
   * On-call is served here.
   *
   * The absent "not available" marker is NOT enough on its own: a blank page, a
   * 500 and a crashed SPA all render zero of it, so a gate built only on that
   * absence certifies the deployment from a page that never loaded. The screen's
   * own root has to be present too.
   */
  async expectAvailable() {
    await expect(
      this.page.locator(this.locators.notAvailable),
      'on-call is not available on this deployment — the suite needs an enterprise build with O2_ONCALL_ENABLED',
    ).toHaveCount(0, { timeout: 30000 });
    await expect(
      this.page.locator(this.locators.root),
      'the on-call screen did not render, so its availability cannot be read from this page',
    ).toBeVisible({ timeout: 30000 });
  }
}

export default OnCallTeamDetailPage;

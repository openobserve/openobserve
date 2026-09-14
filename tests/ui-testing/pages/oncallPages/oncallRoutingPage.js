/**
 * OnCallRoutingPage - org-level ownership / routing (views/OnCall/OnCallRouting.vue)
 *
 * Route `/web/oncall/routing`. Two tabs over the same question:
 *   `rules`   — every team's claim over the identity space
 *   `signals` — what fired and matched nothing ("needs a rule")
 *
 * The same components host the team tab's routing view, so a spec may use this
 * page object against `/web/oncall/teams/{id}/routing` too — the rule rows carry
 * identical selectors there. The difference is the team tab scopes to one team
 * and this screen does not, which is why a rule row here names its team.
 *
 * SHADOWING IS THE SERVER'S VERDICT, NOT A CLIENT COMPUTATION.
 *
 * Deciding that rule A shadows rule B means comparing every rule against every
 * other — including rules a team-scoped screen never fetched — so `health` comes
 * from `ownership/stats` and is read here, never recomputed. §11.4 asks whether
 * a permanently-shadowed rule is surfaced ABOVE the table rather than only as a
 * per-row pill, so both readings are exposed separately: `readRuleHealth()` for
 * the pill and `readHeaderNotices()` for what sits above the rows.
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

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

export class OnCallRoutingPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      root: '[data-test="oncall-routing-page"]',
      content: '[data-test="oncall-routing-content"]',
      tabs: '[data-test="oncall-routing-tabs"]',
      tabRules: '[data-test="oncall-routing-tab-rules"]',
      tabSignals: '[data-test="oncall-routing-tab-signals"]',
      addRule: '[data-test="oncall-routing-add-rule"]',
      testSignal: '[data-test="oncall-routing-test-signal"]',
      testerDrawer: '[data-test="oncall-routing-tester-drawer"]',
      empty: '[data-test="oncall-routing-empty"]',
      error: '[data-test="oncall-routing-error"]',
      unavailable: '[data-test="oncall-routing-unavailable"]',

      // The rules list (OnCallRoutingList) — shared with the team's routing tab.
      list: '[data-test="oncall-routing-list"]',
      listAdd: '[data-test="oncall-routing-list-add"]',
      rulesScroll: '[data-test="oncall-routing-rules-scroll"]',
      emptyState: '[data-test="oncall-routing-empty-state"]',
      catchAll: '[data-test="oncall-routing-catch-all"]',
      catchAllTeam: '[data-test="oncall-routing-catch-all-team"]',
      catchAllSelect: '[data-test="oncall-routing-catch-all-select"]',
      catchAllSet: '[data-test="oncall-routing-catch-all-set"]',
      catchAllSave: '[data-test="oncall-routing-catch-all-save"]',
      catchAllVolume: '[data-test="oncall-routing-catch-all-volume"]',
      unclaimed: '[data-test="oncall-routing-unclaimed"]',
      unclaimedRows: '[data-test="oncall-routing-unclaimed-rows"]',
      claimAll: '[data-test="oncall-routing-claim-all"]',
      reviewClaim: '[data-test="oncall-routing-review-claim"]',

      // The stats table (OnCallOwnershipRules) — where `health` is rendered.
      ownershipTable: '[data-test="oncall-ownership-table"]',
      ownershipRules: '[data-test="oncall-ownership-rules"]',
      ownershipHeader: '[data-test="oncall-ownership-header"]',
      ownershipAddRule: '[data-test="oncall-ownership-add-rule"]',
      ownershipEmpty: '[data-test="oncall-ownership-empty"]',

      // The rule editor drawer.
      ruleEditor: '[data-test="oncall-rule-editor"]',
      ruleEditorTeam: '[data-test="oncall-rule-editor-team"]',
      ruleEditorScope: '[data-test="oncall-rule-editor-scope"]',
      ruleEditorSentence: '[data-test="oncall-rule-editor-sentence"]',
      ruleEditorConditions: '[data-test="oncall-rule-editor-conditions"]',
      ruleEditorAddCondition: '[data-test="oncall-rule-editor-add-condition"]',
      ruleEditorConfirmCondition: '[data-test="oncall-rule-editor-confirm-condition"]',
      ruleEditorCancelCondition: '[data-test="oncall-rule-editor-cancel-condition"]',
      ruleEditorDimensionName: '[data-test="oncall-rule-editor-dimension-name"]',
      ruleEditorDimensionValue: '[data-test="oncall-rule-editor-dimension-value"]',
      ruleEditorDimensionProblem: '[data-test="oncall-rule-editor-dimension-problem"]',
      ruleEditorConflict: '[data-test="oncall-rule-editor-conflict"]',
      ruleEditorConflictNow: '[data-test="oncall-rule-editor-conflict-now"]',
      ruleEditorConflictOutcome: '[data-test="oncall-rule-editor-conflict-outcome"]',
      ruleEditorPrecedence: '[data-test="oncall-rule-editor-precedence"]',
      ruleEditorSaveProblem: '[data-test="oncall-rule-editor-save-problem"]',
      ruleEditorCatch: '[data-test="oncall-rule-editor-catch"]',
      ruleEditorCatchCount: '[data-test="oncall-rule-editor-catch-count"]',
      ruleEditorCatchSummary: '[data-test="oncall-rule-editor-catch-summary"]',

      // Unrouted-signal filters, which are server-side.
      unroutedFilterBoth: '[data-test="oncall-unrouted-filter-both"]',
      unroutedFilterDefault: '[data-test="oncall-unrouted-filter-default"]',
      unroutedFilterNobody: '[data-test="oncall-unrouted-filter-nobody"]',
      unroutedShowDismissed: '[data-test="oncall-unrouted-show-dismissed"]',
      unroutedError: '[data-test="oncall-unrouted-error"]',

      confirmDialog: '[data-test="confirm-dialog"]',
      confirmOk: '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
    };
  }

  // Row-scoped selectors carry the rule id or the signal id, never a name.
  ruleRow(ruleId) { return `[data-test="oncall-routing-row-${ruleId}"]`; }
  ruleSays(ruleId) { return `[data-test="oncall-routing-says-${ruleId}"]`; }
  ruleNote(ruleId) { return `[data-test="oncall-routing-note-${ruleId}"]`; }
  ruleCaught(ruleId) { return `[data-test="oncall-routing-caught-${ruleId}"]`; }
  ruleElsewhere(ruleId) { return `[data-test="oncall-routing-elsewhere-${ruleId}"]`; }
  ruleEdit(ruleId) { return `[data-test="oncall-routing-edit-${ruleId}"]`; }

  ruleHealth(ruleId) { return `[data-test="oncall-rule-health-${ruleId}"]`; }
  ruleTeam(ruleId) { return `[data-test="oncall-rule-team-${ruleId}"]`; }
  ownershipEdit(ruleId) { return `[data-test="oncall-ownership-edit-${ruleId}"]`; }
  ownershipDelete(ruleId) { return `[data-test="oncall-ownership-delete-${ruleId}"]`; }

  signalRow(signalId) { return `[data-test="oncall-routing-signal-${signalId}"]`; }
  signalClaim(signalId) { return `[data-test="oncall-routing-claim-${signalId}"]`; }
  signalDismiss(signalId) { return `[data-test="oncall-routing-dismiss-${signalId}"]`; }
  signalAbsorbed(signalId) { return `[data-test="oncall-routing-signal-absorbed-${signalId}"]`; }

  // ---------------------------------------------------------------- navigation

  /** @param {string} orgId the org **identifier** (ksuid), never the display name. */
  async goto(orgId) {
    await this.page.goto(`/web/oncall/routing?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('On-call routing');
  }

  /**
   * The same rule rows, scoped to one team.
   *
   * The URL segment is `routing`; the tab it activates is internally named
   * `ownership`. Both spellings exist on purpose — see OnCallTeamDetailPage.
   */
  async gotoTeamRouting(orgId, teamId) {
    await this.page.goto(`/web/oncall/teams/${teamId}/routing?org_identifier=${orgId}`);
    await this.page.waitForLoadState('domcontentloaded');
    testLogger.navigation('On-call team routing tab', { teamId });
  }

  /**
   * @param {'rules'|'signals'} key
   *
   * OToggleGroup, so the switch is assertable via `data-state` rather than
   * assumed — and the tab decides which controls exist: "New rule" is rendered
   * only on `rules`, the landing filters only on `signals`.
   */
  async selectTab(key) {
    const tab = this.page.locator(key === 'rules' ? this.locators.tabRules : this.locators.tabSignals);
    await tab.waitFor({ state: 'visible', timeout: 20000 });
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'on', { timeout: 15000 });
    await this.page.waitForTimeout(400);
  }

  // ------------------------------------------------------------------- actions

  async openRuleEditor() {
    await this.page.locator(this.locators.addRule).click();
    await expect(this.page.locator(this.locators.ruleEditor)).toBeVisible({ timeout: 20000 });
  }

  async openRuleEditorFor(ruleId) {
    await this.page.locator(this.ruleEdit(ruleId)).click();
    await expect(this.page.locator(this.locators.ruleEditor)).toBeVisible({ timeout: 20000 });
  }

  /**
   * Pick a value in one of the editor's OSelects.
   *
   * By `data-test-value`, not by label: options are virtualized and the label is
   * translated, so a label match breaks on both counts.
   */
  async selectOption(fieldSelector, value) {
    const trigger = this.page.locator(part(fieldSelector, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();
    const option = this.page.locator(`${part(fieldSelector, 'option')}[data-test-value="${value}"]`).first();
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();
  }

  async chooseRuleTeam(teamId) {
    await this.selectOption(this.locators.ruleEditorTeam, teamId);
  }

  /**
   * Add one dimension pair to the rule under edit.
   *
   * Every pair must match for the rule to apply, which is also what makes one
   * rule more specific than another — and specificity is what decides which
   * team is woken when two rules match (§5.5).
   */
  async addCondition(name, value) {
    await this.page.locator(this.locators.ruleEditorAddCondition).click();
    await this.selectOption(this.locators.ruleEditorDimensionName, name);
    const valueField = this.page
      .locator(part(this.locators.ruleEditorDimensionValue, 'field')).first();
    if (await valueField.count()) {
      await valueField.fill(value);
    } else {
      await this.selectOption(this.locators.ruleEditorDimensionValue, value);
    }
    await this.page.locator(this.locators.ruleEditorConfirmCondition).click();
  }

  /**
   * The rule editor is an ODialog, not a drawer, so its Save is
   * `o-dialog-primary-btn` — scoped to the editor's own panel, which ODialog
   * stamps with the consumer's `data-test` precisely so this scoping works.
   */
  async saveRule() {
    await this.page
      .locator(`${this.locators.ruleEditor} [data-test="o-dialog-primary-btn"]`)
      .click();
  }

  /** "Remove rule" is the dialog's NEUTRAL button, and only exists when editing. */
  async removeRuleFromEditor() {
    await this.page
      .locator(`${this.locators.ruleEditor} [data-test="o-dialog-neutral-btn"]`)
      .click();
  }

  async openSignalTester() {
    await this.page.locator(this.locators.testSignal).click();
    await expect(this.page.locator(this.locators.testerDrawer)).toBeVisible({ timeout: 20000 });
  }

  async deleteRule(ruleId) {
    await this.page.locator(this.ownershipDelete(ruleId)).click();
    const confirm = this.page.locator(this.locators.confirmOk);
    if (await confirm.count()) await confirm.click();
  }

  async claimSignal(signalId) {
    await this.page.locator(this.signalClaim(signalId)).click();
  }

  async dismissSignal(signalId) {
    await this.page.locator(this.signalDismiss(signalId)).click();
  }

  /** The unrouted queue's server-side landing filter. */
  async filterUnrouted(kind) {
    const map = {
      both: this.locators.unroutedFilterBoth,
      default: this.locators.unroutedFilterDefault,
      nobody: this.locators.unroutedFilterNobody,
    };
    const item = this.page.locator(map[kind]);
    await item.waitFor({ state: 'visible', timeout: 20000 });
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'on', { timeout: 15000 });
    await this.page.waitForTimeout(400);
  }

  // ------------------------------------------------------------------ reading

  /** The rule ids drawn, in the order the engine consults them — most specific first. */
  async readRuleIds() {
    const rows = this.page.locator('[data-test^="oncall-routing-row-"]');
    const count = await rows.count();
    const ids = [];
    for (let i = 0; i < count; i++) {
      const attr = await rows.nth(i).getAttribute('data-test');
      if (attr) ids.push(attr.replace('oncall-routing-row-', ''));
    }
    return ids;
  }

  /** What the row says the rule does, as a finished sentence. Render-as-is copy. */
  async readRuleSentence(ruleId) {
    const node = this.page.locator(this.ruleSays(ruleId));
    await node.waitFor({ state: 'visible', timeout: 20000 });
    return ((await node.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * The server's health verdict for one rule: `healthy` / `shadowed` / `never_used`.
   *
   * Returns the rendered label plus its tooltip summary when there is one, since
   * a shadowed rule names the team taking its pages and "shadowed" alone is not
   * actionable.
   */
  async readRuleHealth(ruleId) {
    const tag = this.page.locator(this.ruleHealth(ruleId));
    if ((await tag.count()) === 0) return null;
    await tag.first().waitFor({ state: 'visible', timeout: 20000 });
    return ((await tag.first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  }

  /** The per-row note the server raises when a rule cannot bite. */
  async readRuleNote(ruleId) {
    const node = this.page.locator(this.ruleNote(ruleId));
    if ((await node.count()) === 0) return null;
    return ((await node.first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  }

  /**
   * §11.4: what is surfaced ABOVE the rows, not inside them.
   *
   * A rule that can never match is a finding about the configuration, so the
   * question is whether it reaches the reader without scanning every row. Reads
   * the header region of the stats table; an empty array is the finding.
   */
  async readHeaderNotices() {
    const header = this.page.locator(this.locators.ownershipHeader);
    if ((await header.count()) === 0) return [];
    const text = ((await header.first().innerText()) ?? '').trim();
    return text.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  /** The signal ids currently in the unrouted queue. */
  async readSignalIds() {
    const rows = this.page.locator('[data-test^="oncall-routing-signal-"]');
    const count = await rows.count();
    const ids = [];
    for (let i = 0; i < count; i++) {
      const attr = await rows.nth(i).getAttribute('data-test');
      // `-absorbed-` rows share the prefix; they are a tag on a row, not a row.
      if (attr && !attr.startsWith('oncall-routing-signal-absorbed-')) {
        ids.push(attr.replace('oncall-routing-signal-', ''));
      }
    }
    return ids;
  }

  /** Which team the org nominated as the catch-all, or null when none is set. */
  async readCatchAllTeam() {
    const node = this.page.locator(this.locators.catchAllTeam);
    if ((await node.count()) === 0) return null;
    return ((await node.first().textContent()) ?? '').trim();
  }

  // ---------------------------------------------------------------- assertions

  async expectPageVisible() {
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.content)).toBeVisible({ timeout: 30000 });
  }

  async expectRuleVisible(ruleId) {
    await expect(this.page.locator(this.ruleRow(ruleId))).toBeVisible({ timeout: 30000 });
  }

  async expectRuleAbsent(ruleId) {
    await expect(this.page.locator(this.ruleRow(ruleId))).toHaveCount(0, { timeout: 30000 });
  }

  /** A rule repointed at another team says so, rather than claiming it pages us. */
  async expectRulePagesElsewhere(ruleId) {
    await expect(this.page.locator(this.ruleElsewhere(ruleId))).toBeVisible({ timeout: 30000 });
  }

  /** Saving a rule whose path another team already owns is refused, and the editor says why. */
  async expectSaveProblem() {
    await expect(this.page.locator(this.locators.ruleEditorSaveProblem)).toBeVisible({ timeout: 20000 });
  }

  /** The org has no teams, so nothing can own or be paged — routing starts at Teams. */
  async expectNoTeamsState() {
    await expect(this.page.locator(this.locators.empty)).toBeVisible({ timeout: 30000 });
  }

  /** §10.5: what the API refuses must not be drawn. */
  async expectRuleControlsHidden() {
    await expect(this.page.locator(this.locators.addRule)).toHaveCount(0, { timeout: 20000 });
  }

  // ------------------------------------------------------- enterprise gating

  async isUnavailable() {
    return (await this.page.locator(this.locators.unavailable).count()) > 0;
  }

  async expectAvailable() {
    await expect(
      this.page.locator(this.locators.unavailable),
      'on-call is not available on this deployment — the suite needs an enterprise build with O2_ONCALL_ENABLED',
    ).toHaveCount(0, { timeout: 30000 });
  }
}

export default OnCallRoutingPage;

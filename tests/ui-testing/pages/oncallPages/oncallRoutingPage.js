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
const { settleRows } = require('../../playwright-tests/utils/oncall-settle.js');

/** Rules and signals are plain rows, not an OTable, so each tab has its own hook. */
const ROUTING_ROWS = {
  rules: '[data-test^="oncall-routing-says-"]',
  signals: '[data-test^="oncall-unrouted-path-"]',
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

      refresh: '[data-test="oncall-routing-refresh"]',
      search: '[data-test="oncall-routing-search"]',
      // The shared rules list (OnCallOwnershipRules) on both the org page and a team's tab.
      catchAll: '[data-test="oncall-routing-catch-all"]',
      catchAllTeam: '[data-test="oncall-routing-catch-all-team"]',
      catchAllSet: '[data-test="oncall-routing-catch-all-set"]',
      teamUnclaimed: '[data-test="oncall-ownership-unclaimed"]',

      ownershipRules: '[data-test="oncall-ownership-rules"]',
      ownershipHeader: '[data-test="oncall-ownership-header"]',
      ownershipAddRule: '[data-test="oncall-ownership-add-rule"]',
      ownershipEmpty: '[data-test="oncall-ownership-empty"]',

      // The rule editor drawer.
      ruleEditor: '[data-test="oncall-rule-editor"]',
      ruleEditorTeam: '[data-test="oncall-rule-editor-team"]',
      ruleEditorSentence: '[data-test="oncall-rule-editor-sentence"]',
      ruleEditorSignals: '[data-test="oncall-rule-editor-signals"]',
      ruleEditorConditions: '[data-test="oncall-rule-editor-conditions"]',
      ruleEditorAddCondition: '[data-test="oncall-rule-editor-add-condition"]',
      ruleEditorOutcome: '[data-test="oncall-rule-editor-outcome"]',
      ruleEditorSaveProblem: '[data-test="oncall-rule-editor-save-problem"]',

      // Server-side filters on the "Needs an owner" tab.
      unroutedFilterBoth: '[data-test="oncall-unrouted-filter-both"]',
      unroutedFilterDefault: '[data-test="oncall-unrouted-filter-default"]',
      unroutedFilterNobody: '[data-test="oncall-unrouted-filter-nobody"]',
      unroutedShowDismissed: '[data-test="oncall-unrouted-show-dismissed"]',
      unroutedError: '[data-test="oncall-unrouted-error"]',

      // The unrouted queue (OnCallUnroutedQueue) on the "Needs an owner" tab, keyed by SIGNAL id.
      unrouted: '[data-test="oncall-unrouted"]',
      unroutedTable: '[data-test="oncall-unrouted-table"]',
      unroutedHeader: '[data-test="oncall-unrouted-header"]',
      unroutedEmpty: '[data-test="oncall-unrouted-empty"]',
      unroutedClaimAll: '[data-test="oncall-unrouted-claim-all"]',
      // Org-level bulk claim: header button, then a team picker dialog stating the outcome.
      claimAll: '[data-test="oncall-routing-claim-all"]',
      claimAllDialog: '[data-test="oncall-routing-claim-all-dialog"]',
      claimAllTeam: '[data-test="oncall-routing-claim-all-team"]',
      claimAllOutcome: '[data-test="oncall-routing-claim-all-outcome"]',

      // Test routing (OnCallRoutingSimulator), in the tester drawer. Rows share OnCallConditionRows.
      simulator: '[data-test="oncall-routing-simulator"]',
      simulatorEmpty: '[data-test="oncall-simulator-empty"]',
      simulatorStart: '[data-test="oncall-simulator-start"]',
      simulatorAddCondition: '[data-test="oncall-simulator-add-condition"]',
      simulatorPriority: '[data-test="oncall-simulator-priority"]',
      simulatorResult: '[data-test="oncall-simulator-result"]',
      simulatorAnswer: '[data-test="oncall-simulator-answer"]',
      simulatorWon: '[data-test="oncall-simulator-won"]',
      simulatorAlsoCount: '[data-test="oncall-simulator-also"]',
      simulatorTeam: '[data-test="oncall-simulator-team"]',
      simulatorResponder: '[data-test="oncall-simulator-responder"]',
      simulatorNext: '[data-test="oncall-simulator-next"]',
      ruleEditorOnCall: '[data-test="oncall-rule-editor-on-call"]',
      simulatorSendTest: '[data-test="oncall-simulator-send-test"]',

      // The org's catch-all nomination dialog (OnCallDefaultTeamCard), opened from the pinned row.
      defaultTeamDialog: '[data-test="oncall-default-team-dialog"]',
      defaultTeamSelect: '[data-test="oncall-default-team-select"]',
      defaultTeamUnset: '[data-test="oncall-default-team-unset"]',

      confirmDialog: '[data-test="confirm-dialog"]',
      confirmDialogProvider: '[data-test="confirm-dialog-provider"]',
      confirmOk: '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
    };
  }

  // Row-scoped selectors carry the rule id or the signal id, never a name.
  ruleRow(ruleId) { return `[data-test="oncall-routing-says-${ruleId}"]`; }
  ruleSays(ruleId) { return `[data-test="oncall-routing-says-${ruleId}"]`; }
  ruleNote(ruleId) { return `[data-test="oncall-rule-health-${ruleId}"]`; }
  ruleCaught(ruleId) { return `[data-test="oncall-routing-caught-${ruleId}"]`; }
  ruleEdit(ruleId) { return `[data-test="oncall-routing-edit-${ruleId}"]`; }
  ruleMore(ruleId) { return `[data-test="oncall-routing-more-${ruleId}"]`; }
  ruleTest(ruleId) { return `[data-test="oncall-routing-test-${ruleId}"]`; }

  /** The Health cell; a shadowed verdict names the team taking its pages. */
  ruleHealth(ruleId) { return `[data-test="oncall-rule-health-${ruleId}"]`; }
  ruleTeam(ruleId) { return `[data-test="oncall-rule-team-${ruleId}"]`; }
  ownershipEdit(ruleId) { return this.ruleEdit(ruleId); }
  ownershipDelete(ruleId) { return `[data-test="oncall-ownership-delete-${ruleId}"]`; }

  // Rule editor condition rows are indexed by position.
  conditionField(index) { return `[data-test="oncall-rule-editor-field-${index}"]`; }
  conditionOp(index) { return `[data-test="oncall-rule-editor-op-${index}"]`; }
  conditionValue(index) { return `[data-test="oncall-rule-editor-value-${index}"]`; }
  conditionRemove(index) { return `[data-test="oncall-rule-editor-remove-${index}"]`; }
  conditionPickValue(index) { return `[data-test="oncall-rule-editor-pick-value-${index}"]`; }

  unroutedPath(signalId) { return `[data-test="oncall-unrouted-path-${signalId}"]`; }
  unroutedNobody(signalId) { return `[data-test="oncall-unrouted-nobody-${signalId}"]`; }
  unroutedDefaulted(signalId) { return `[data-test="oncall-unrouted-defaulted-${signalId}"]`; }
  unroutedClaim(signalId) { return `[data-test="oncall-unrouted-claim-${signalId}"]`; }
  unroutedDismiss(signalId) { return `[data-test="oncall-unrouted-dismiss-${signalId}"]`; }
  unroutedDismissed(signalId) { return `[data-test="oncall-unrouted-dismissed-${signalId}"]`; }
  simulatorRow(index) { return `[data-test="oncall-simulator-row-${index}"]`; }
  simulatorField(index) { return `[data-test="oncall-simulator-field-${index}"]`; }
  simulatorValue(index) { return `[data-test="oncall-simulator-value-${index}"]`; }
  simulatorRemove(index) { return `[data-test="oncall-simulator-remove-${index}"]`; }
  simulatorAlso(ruleId) { return `[data-test="oncall-simulator-also-${ruleId}"]`; }

  // Unclaimed signals live only on the org page's "Needs an owner" tab.
  signalRow(signalId) { return this.unroutedPath(signalId); }
  signalClaim(signalId) { return this.unroutedClaim(signalId); }
  signalDismiss(signalId) { return this.unroutedDismiss(signalId); }
  signalAbsorbed(signalId) { return this.unroutedDefaulted(signalId); }

  // ------------------------------------------------------------- element getters

  getTabRules() { return this.page.locator(this.locators.tabRules); }
  getTabSignals() { return this.page.locator(this.locators.tabSignals); }
  getRuleRow(ruleId) { return this.page.locator(this.ruleRow(ruleId)); }
  getRuleHealth(ruleId) { return this.page.locator(this.ruleHealth(ruleId)); }
  getRuleTeam(ruleId) { return this.page.locator(this.ruleTeam(ruleId)); }
  getUnroutedFilterDefault() { return this.page.locator(this.locators.unroutedFilterDefault); }

  /**
   * The IMPERATIVE confirm, not the declarative one.
   *
   * Nominating an empty team goes through the `confirm()` composable, which
   * renders via `ConfirmDialogProvider` — a different element from the
   * `ConfirmDialog` component the rest of the suite waits on. Waiting on the
   * wrong one times out against a dialog that is on screen.
   */
  getConfirmDialogProvider() { return this.page.locator(this.locators.confirmDialogProvider); }

  /** A dialog's confirm button. ODialog names it `o-dialog-primary-btn`; scope it to the panel, since several dialogs can be mounted at once. */
  getDialogPrimary(dialogSelector) {
    return this.page.locator(`${dialogSelector} [data-test="o-dialog-primary-btn"]`).first();
  }

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
   * An OToggleGroup, so the switch is assertable via `data-state="on"` — and the tab
   * decides which controls exist: "New rule" only on `rules`, the landing
   * filters only on `signals`.
   */
  async selectTab(key) {
    const tab = this.page.locator(key === 'rules' ? this.locators.tabRules : this.locators.tabSignals);
    await tab.waitFor({ state: 'visible', timeout: 20000 });
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'on', { timeout: 15000 });
    await settleRows(this.page, { rowSelector: ROUTING_ROWS[key] });
  }

  // ------------------------------------------------------------------- actions

  async openRuleEditor() {
    await this.page.locator(this.locators.addRule).click();
    await expect(this.page.locator(this.locators.ruleEditor)).toBeVisible({ timeout: 20000 });
    this._conditionsWritten = 0;
  }

  async openRuleEditorFor(ruleId) {
    await this.page.locator(this.ruleEdit(ruleId)).click();
    await expect(this.page.locator(this.locators.ruleEditor)).toBeVisible({ timeout: 20000 });
    this._conditionsWritten = await this.page.locator('[data-test^="oncall-rule-editor-row-"]').count();
  }

  /**
   * Pick a value in one of the editor's OSelects.
   *
   * By `data-test-value`, not by label: options are virtualized and the label is
   * translated, so a label match breaks on both counts.
   */
  async selectOption(fieldSelector, value, searchTerm = null) {
    const trigger = this.page.locator(part(fieldSelector, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();

    // OSelect virtualises past 50 options, so on an org carrying fixture teams
    // from earlier runs the wanted row is simply not in the DOM until the list
    // is narrowed. The popover's search box matches the LABEL, never the value.
    if (searchTerm) {
      const search = this.page.locator(part(fieldSelector, 'search')).first();
      await search.waitFor({ state: 'visible', timeout: 20000 });
      await search.fill(searchTerm);
    }

    const option = this.page.locator(`${part(fieldSelector, 'option')}[data-test-value="${value}"]`).first();
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();

    // The popover is rendered over the rest of the drawer, so the next control
    // is unclickable until it has actually gone — a single-select closes on
    // pick, but not synchronously.
    await expect(this.page.locator(part(fieldSelector, 'popover'))).toBeHidden({ timeout: 20000 });
  }

  /**
   * @param {string} teamId the option's VALUE.
   * @param {string} [teamName] the option's LABEL, used to narrow a long list.
   */
  async chooseRuleTeam(teamId, teamName = null) {
    await this.selectOption(this.locators.ruleEditorTeam, teamId, teamName);
  }

  /**
   * Fill one condition row: [field] [is | starts with] [value].
   *
   * A new rule opens on one empty row; every later condition clicks "+ and"
   * first. The value is a searchable OSelect that also accepts a typed value,
   * so a service the org has not emitted yet is typed and committed with Enter.
   *
   * @param {'is'|'prefix'} [op]
   */
  async addCondition(name, value, op = 'is') {
    const index = this._conditionsWritten ?? 0;
    if (index > 0) {
      await this.page.locator(this.locators.ruleEditorAddCondition).click();
    }
    await this.selectOption(this.conditionField(index), name);
    if (op !== 'is') await this.selectOption(this.conditionOp(index), op);

    const field = this.conditionValue(index);
    await this.page.locator(part(field, 'trigger')).first().click();
    const search = this.page.locator(part(field, 'search')).first();
    await search.waitFor({ state: 'visible', timeout: 20000 });
    await search.fill(value);
    const option = this.page.locator(`${part(field, 'option')}[data-test-value="${value}"]`).first();
    if (await option.count()) await option.click();
    else await search.press('Enter');
    await expect(this.page.locator(part(field, 'popover'))).toBeHidden({ timeout: 20000 });
    this._conditionsWritten = index + 1;
  }

  /** Repoint a row at another field, which empties its value; `label` narrows the picker, which only renders a window of the catalogue. */
  async changeConditionField(index, name, label = null) {
    await this.selectOption(this.conditionField(index), name, label);
  }

  async removeCondition(index) {
    await this.page.locator(this.conditionRemove(index)).click();
  }

  getSaveRuleButton() {
    return this.page.locator(`${this.locators.ruleEditor} [data-test="o-dialog-primary-btn"]`);
  }

  async cancelRule() {
    await this.page
      .locator(`${this.locators.ruleEditor} [data-test="o-dialog-secondary-btn"]`)
      .click();
    await expect(this.page.locator(this.locators.ruleEditor)).toBeHidden({ timeout: 20000 });
  }

  /** A row naming a field with no value blocks Save, on the row and in the footer. */
  async expectConditionNeedsValue(index) {
    await expect(this.page.locator(this.conditionPickValue(index))).toBeVisible({ timeout: 20000 });
    await expect(this.page.locator(this.locators.ruleEditorSaveProblem)).toBeVisible();
    await expect(this.getSaveRuleButton()).toBeDisabled();
  }

  /** The editor is an ODialog, so Save is its `o-dialog-primary-btn`, scoped to the editor's own panel. */
  async saveRule() {
    await this.page
      .locator(`${this.locators.ruleEditor} [data-test="o-dialog-primary-btn"]`)
      .click();
  }


  async openSignalTester() {
    await this.page.locator(this.locators.testSignal).click();
    await expect(this.page.locator(this.locators.testerDrawer)).toBeVisible({ timeout: 20000 });
  }

  /** Delete lives in the row's ⋯ menu. */
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
    await settleRows(this.page, { rowSelector: ROUTING_ROWS.signals });
  }

  // ------------------------------------------------------------------ reading

  /** The rule ids drawn, in the order the engine consults them — most specific first. */
  async readRuleIds() {
    const rows = this.page.locator('[data-test^="oncall-routing-says-"]');
    const count = await rows.count();
    const ids = [];
    for (let i = 0; i < count; i++) {
      const attr = await rows.nth(i).getAttribute('data-test');
      if (attr) ids.push(attr.replace('oncall-routing-says-', ''));
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

  /** The signal ids currently in the unrouted queue ("Needs an owner" tab). */
  async readSignalIds() {
    const rows = this.page.locator(ROUTING_ROWS.signals);
    const count = await rows.count();
    const ids = [];
    for (let i = 0; i < count; i++) {
      const attr = await rows.nth(i).getAttribute('data-test');
      if (attr) ids.push(attr.replace('oncall-unrouted-path-', ''));
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

  /** Org page and team tab draw the same list, so a row is found by its team cell on either. */
  async expectOrgRuleRowVisible(ruleId) {
    await expect(this.page.locator(this.ruleTeam(ruleId))).toBeVisible({ timeout: 30000 });
  }

  async expectOrgRuleRowAbsent(ruleId) {
    await expect(this.page.locator(this.ruleTeam(ruleId))).toHaveCount(0, { timeout: 30000 });
  }

  async expectOrgRuleNamesTeam(ruleId, teamName) {
    await expect(this.page.locator(this.ruleTeam(ruleId))).toContainText(teamName, { timeout: 30000 });
  }

  /** A rule repointed at another team leaves this team's tab, which lists only its own rules. */
  async expectRulePagesElsewhere(ruleId) {
    await expect(this.page.locator(this.ruleRow(ruleId))).toHaveCount(0, { timeout: 30000 });
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

  // ------------------------------------------------------------- the simulator

  /**
   * Replace the drawer's pre-filled conditions with one `name is value` row.
   *
   * The drawer opens on a real alert shape, so the seeded rows are cleared first;
   * removing the last row leaves one empty row, which is the one filled here.
   */
  async addSimulatorDimension(name, value) {
    const rows = this.page.locator('[data-test^="oncall-simulator-row-"]');
    await rows.first().waitFor({ state: 'visible', timeout: 20000 });
    while ((await rows.count()) > 1) {
      await this.page.locator(this.simulatorRemove(0)).click();
    }
    await this.page.locator(this.simulatorRemove(0)).click();
    await this.selectOption(this.simulatorField(0), name);
    this.pendingAnswer = this.page.waitForResponse((response) => {
      const request = response.request();
      if (request.method() !== 'POST' || !response.url().includes('/oncall/routing/preview')) return false;
      try {
        return JSON.parse(request.postData() ?? '{}')?.dimensions?.[name] === value;
      } catch {
        return false;
      }
    }, { timeout: 30000 });
    const field = this.simulatorValue(0);
    await this.page.locator(part(field, 'trigger')).first().click();
    const search = this.page.locator(part(field, 'search')).first();
    await search.waitFor({ state: 'visible', timeout: 20000 });
    await search.fill(value);
    const option = this.page.locator(`${part(field, 'option')}[data-test-value="${value}"]`).first();
    if (await option.count()) await option.click();
    else await search.press('Enter');
    await expect(this.page.locator(part(field, 'popover'))).toBeHidden({ timeout: 20000 });
  }

  /** The answer is live (debounced); this waits for the one asked by addSimulatorDimension, not the seed's. */
  async runSimulator() {
    if (this.pendingAnswer) {
      await this.pendingAnswer;
      this.pendingAnswer = null;
    }
    await expect(
      this.page.locator(`${this.locators.simulatorResult}:not([aria-busy="true"])`),
    ).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.simulatorAnswer)).toBeVisible({ timeout: 30000 });
  }

  /** Every field of the rendered verdict; the winning rule is an inline line under the answer. */
  async readSimulatorResult() {
    const textOf = async (selector) => {
      const node = this.page.locator(selector);
      if ((await node.count()) === 0) return null;
      return ((await node.first().innerText()) ?? '').replace(/\s+/g, ' ').trim();
    };
    return {
      matched: await textOf(this.locators.simulatorResult),
      won: await textOf(this.locators.simulatorWon),
      team: await textOf(this.locators.simulatorTeam),
      ladder: await textOf(this.locators.simulatorNext),
      responder: await textOf(this.locators.simulatorResponder),
    };
  }

  /** The emails of everyone the verdict says it wakes; each name carries its email only in a hover tooltip. */
  async readSimulatorResponderEmails() {
    const people = this.page.locator(`${this.locators.simulatorResponder} [data-test="oncall-simulator-responder-person"]`);
    const tooltip = this.page.locator('[data-test="oncall-person-name-tooltip"]');
    const emails = [];
    for (let i = 0; i < (await people.count()); i++) {
      await people.nth(i).hover();
      await expect(tooltip.first()).toBeVisible({ timeout: 10000 });
      const text = await tooltip.first().innerText();
      const email = text.match(/\S+@\S+/)?.[0] ?? text.trim();
      emails.push(email);
      await this.page.mouse.move(0, 0);
      await expect(tooltip).toHaveCount(0, { timeout: 10000 });
    }
    return emails;
  }

  /** The simulator names the team it would page, by NAME rather than by id. */
  async expectSimulatorTeamNames(teamName) {
    await expect(this.page.locator(this.locators.simulatorTeam)).toContainText(teamName, { timeout: 30000 });
  }




  // -------------------------------------------------------- the default team

  /**
   * The catch-all is the pinned last row of the rules list; its Change button
   * opens OnCallDefaultTeamCard's dialog (the card draws no trigger here). The
   * dialog's Save is its ODialog primary button, and `oncall-default-team-unset`
   * is the warning paragraph inside it, not a control.
   */
  async expectDefaultTeamControlVisible() {
    await expect(this.page.locator(this.locators.catchAllSet)).toBeVisible({ timeout: 30000 });
  }

  async openDefaultTeamDialog() {
    await this.page.locator(this.locators.catchAllSet).click();
    await expect(this.page.locator(this.locators.defaultTeamDialog)).toBeVisible({ timeout: 20000 });
  }

  /** The dialog's own primary button — the component renders no Save of its own here. */
  async saveDefaultTeamDialog() {
    await this.page
      .locator(`${this.locators.defaultTeamDialog} [data-test="o-dialog-primary-btn"]`)
      .click();
    await expect(this.page.locator(this.locators.defaultTeamDialog)).toBeHidden({ timeout: 20000 });
  }

  /**
   * @param {string} teamId the option's VALUE.
   * @param {string} [teamName] the option's LABEL, used to narrow a long list.
   */
  async nominateDefaultTeam(teamId, teamName = null) {
    await this.openDefaultTeamDialog();
    await this.selectOption(this.locators.defaultTeamSelect, teamId, teamName);
    await this.saveDefaultTeamDialog();
  }


  /** The dialog's standing warning that the org has nominated nobody. */
  async expectDefaultTeamUnsetWarning() {
    await this.openDefaultTeamDialog();
    await expect(this.page.locator(this.locators.defaultTeamUnset)).toBeVisible({ timeout: 20000 });
  }

  async expectDefaultTeamLabelNames(teamName) {
    await expect(this.page.locator(this.locators.catchAllTeam)).toContainText(teamName, { timeout: 30000 });
  }

  // ------------------------------------------------------ the unrouted queue



  /** The full identity path of one unrouted signal — WHY nothing matched. */
  async readUnroutedPath(signalId) {
    const node = this.page.locator(this.unroutedPath(signalId));
    await node.waitFor({ state: 'visible', timeout: 30000 });
    return ((await node.innerText()) ?? '').replace(/\s+/g, ' ').trim();
  }

  async expectUnroutedRowVisible(signalId) {
    await expect(this.page.locator(this.unroutedPath(signalId))).toBeVisible({ timeout: 30000 });
  }

  /** "Nobody was paged" — the queue's harsher of two landings. */
  async expectUnroutedReachedNobody(signalId) {
    await expect(this.page.locator(this.unroutedNobody(signalId))).toBeVisible({ timeout: 30000 });
  }



  // ------------------------------------------------------- enterprise gating

  async isUnavailable() {
    return (await this.page.locator(this.locators.unavailable).count()) > 0;
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
      this.page.locator(this.locators.unavailable),
      'on-call is not available on this deployment — the suite needs an enterprise build with O2_ONCALL_ENABLED',
    ).toHaveCount(0, { timeout: 30000 });
    await expect(
      this.page.locator(this.locators.root),
      'the on-call screen did not render, so its availability cannot be read from this page',
    ).toBeVisible({ timeout: 30000 });
  }
}

export default OnCallRoutingPage;

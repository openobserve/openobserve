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
      // The scope picker the editor opens on, and its way out to the
      // dimension-by-dimension builder.
      scopePicker: '[data-test="oncall-scope-picker"]',
      scopeModeAdvanced: '[data-test="oncall-scope-mode-advanced"]',
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

      // The unrouted queue (OnCallUnroutedQueue) — a DIFFERENT component from the
      // `oncall-routing-signal-*` rows above, rendered on the signals tab with
      // `show-header=false`. Its rows are keyed by the SIGNAL id.
      unrouted: '[data-test="oncall-unrouted"]',
      unroutedTable: '[data-test="oncall-unrouted-table"]',
      unroutedHeader: '[data-test="oncall-unrouted-header"]',
      unroutedEmpty: '[data-test="oncall-unrouted-empty"]',
      unroutedClaimAll: '[data-test="oncall-unrouted-claim-all"]',

      // The dry-run simulator, which lives in the tester drawer.
      simulator: '[data-test="oncall-routing-simulator"]',
      simulatorEmpty: '[data-test="oncall-simulator-empty"]',
      simulatorAddDimension: '[data-test="oncall-simulator-add-dimension"]',
      simulatorAdder: '[data-test="oncall-simulator-adder"]',
      simulatorDimensionName: '[data-test="oncall-simulator-dimension-name"]',
      simulatorDimensionValue: '[data-test="oncall-simulator-dimension-value"]',
      simulatorDimensionConfirm: '[data-test="oncall-simulator-dimension-confirm"]',
      simulatorPriority: '[data-test="oncall-simulator-priority"]',
      simulatorPriorityChip: '[data-test="oncall-simulator-chip-priority"]',
      simulatorRun: '[data-test="oncall-simulator-run"]',
      simulatorResult: '[data-test="oncall-simulator-result"]',
      simulatorSpecificity: '[data-test="oncall-simulator-specificity"]',
      simulatorTeam: '[data-test="oncall-simulator-team"]',
      simulatorLadder: '[data-test="oncall-simulator-ladder"]',
      simulatorResponder: '[data-test="oncall-simulator-responder"]',
      simulatorSendTest: '[data-test="oncall-simulator-send-test"]',

      // The org's catch-all nomination (OnCallDefaultTeamCard). NOTHING
      // auto-creates it: until a human nominates a team there is no default,
      // and an unmatched signal reaches the unrouted queue instead.
      defaultTeamCard: '[data-test="oncall-default-team-card"]',
      defaultTeamOpen: '[data-test="oncall-default-team-open"]',
      defaultTeamDialog: '[data-test="oncall-default-team-dialog"]',
      defaultTeamSelect: '[data-test="oncall-default-team-select"]',
      defaultTeamSave: '[data-test="oncall-default-team-save"]',
      defaultTeamUnset: '[data-test="oncall-default-team-unset"]',

      confirmDialog: '[data-test="confirm-dialog"]',
      confirmDialogProvider: '[data-test="confirm-dialog-provider"]',
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

  unroutedPath(signalId) { return `[data-test="oncall-unrouted-path-${signalId}"]`; }
  unroutedNobody(signalId) { return `[data-test="oncall-unrouted-nobody-${signalId}"]`; }
  unroutedDefaulted(signalId) { return `[data-test="oncall-unrouted-defaulted-${signalId}"]`; }
  unroutedClaim(signalId) { return `[data-test="oncall-unrouted-claim-${signalId}"]`; }
  unroutedDismiss(signalId) { return `[data-test="oncall-unrouted-dismiss-${signalId}"]`; }
  unroutedDismissed(signalId) { return `[data-test="oncall-unrouted-dismissed-${signalId}"]`; }
  simulatorChip(name) { return `[data-test="oncall-simulator-chip-${name}"]`; }
  simulatorAlso(ruleId) { return `[data-test="oncall-simulator-also-${ruleId}"]`; }

  signalRow(signalId) { return `[data-test="oncall-routing-signal-${signalId}"]`; }
  signalClaim(signalId) { return `[data-test="oncall-routing-claim-${signalId}"]`; }
  signalDismiss(signalId) { return `[data-test="oncall-routing-dismiss-${signalId}"]`; }
  signalAbsorbed(signalId) { return `[data-test="oncall-routing-signal-absorbed-${signalId}"]`; }

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
   * Leave the scope picker for the dimension-by-dimension builder.
   *
   * THE EDITOR DOES NOT OPEN ON THE BUILDER. It opens on `OnCallScopePicker`,
   * which offers the three claims almost every rule is — "this cluster", "this
   * namespace", "this service wherever it runs" — built from dimensions the org
   * has actually SEEN. A freshly-seeded service is not in that catalogue, so a
   * spec claiming one has to take the picker's own way out
   * (`oncall-scope-mode-advanced`) before `oncall-rule-editor-add-condition`
   * exists at all: it renders under `v-else-if="!scoped"`.
   */
  async useAdvancedRuleScope() {
    const advanced = this.page.locator(this.locators.scopeModeAdvanced);
    if (await advanced.count()) {
      await advanced.first().click();
    }
    // Leaving the picker opens the builder with its first pair already being
    // entered, so what proves the switch took is the dimension field itself —
    // `oncall-rule-editor-add-condition` is the button for the NEXT pair and
    // does not exist while one is in progress.
    await expect(this.page.locator(this.locators.ruleEditorDimensionName))
      .toBeVisible({ timeout: 20000 });
  }

  /**
   * Add one dimension pair to the rule under edit.
   *
   * Every pair must match for the rule to apply, which is also what makes one
   * rule more specific than another — and specificity is what decides which
   * team is woken when two rules match (§5.5).
   */
  async addCondition(name, value) {
    // Two states, one method: the editor shows the draft pair's fields as soon
    // as it enters the builder, and shows "Add condition" only once no pair is
    // in progress. Clicking the button when the fields are already open would
    // time out; skipping it when they are not would type into nothing.
    const adder = this.page.locator(this.locators.ruleEditorDimensionName);
    if ((await adder.count()) === 0) {
      await this.page.locator(this.locators.ruleEditorAddCondition).click();
    }
    await this.selectOption(this.locators.ruleEditorDimensionName, name);

    // The VALUE is an OCombobox, not an OSelect — deliberately: the dimension
    // name is a closed vocabulary, but the value is data and a rule may claim a
    // service the org has not emitted yet. Its editable part is `-input`, and it
    // has no `-trigger` and no `-field`.
    const valueInput = this.page
      .locator(part(this.locators.ruleEditorDimensionValue, 'input')).first();
    await valueInput.waitFor({ state: 'visible', timeout: 20000 });
    await valueInput.fill(value);

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

  /**
   * The ORG routing screen draws `OnCallOwnershipRules` — the stats table, keyed
   * `oncall-rule-team-{id}` / `oncall-rule-health-{id}`. `oncall-routing-row-{id}`
   * belongs to `OnCallRoutingList`, which is what the TEAM's routing tab renders.
   * The two are different components over the same rules, so a spec must ask the
   * one that is actually on screen.
   */
  async expectOrgRuleRowVisible(ruleId) {
    await expect(this.page.locator(this.ruleTeam(ruleId))).toBeVisible({ timeout: 30000 });
  }

  async expectOrgRuleRowAbsent(ruleId) {
    await expect(this.page.locator(this.ruleTeam(ruleId))).toHaveCount(0, { timeout: 30000 });
  }

  async expectOrgRuleNamesTeam(ruleId, teamName) {
    await expect(this.page.locator(this.ruleTeam(ruleId))).toContainText(teamName, { timeout: 30000 });
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

  // ------------------------------------------------------------- the simulator

  /**
   * Add one dimension pair to the hypothetical signal.
   *
   * The name is a SEMANTIC GROUP ID and the picker is closed vocabulary —
   * `service`, `k8s-namespace`, `environment` — while the rows a rule matches
   * against carry the underlying column (`service`, `namespace`). The group
   * definition is what joins the two, which is why a typo here would produce a
   * confident "nothing matches" for a dimension nothing ever emits.
   */
  async addSimulatorDimension(name, value) {
    await this.page.locator(this.locators.simulatorAddDimension).click();
    await expect(this.page.locator(this.locators.simulatorAdder)).toBeVisible({ timeout: 20000 });
    await this.selectOption(this.locators.simulatorDimensionName, name);
    await this.page.locator(part(this.locators.simulatorDimensionValue, 'field')).first().fill(value);
    await this.page.locator(this.locators.simulatorDimensionConfirm).click();
    await expect(this.page.locator(this.simulatorChip(name))).toBeVisible({ timeout: 20000 });
  }


  async runSimulator() {
    await this.page.locator(this.locators.simulatorRun).click();
    await expect(this.page.locator(this.locators.simulatorResult)).toBeVisible({ timeout: 30000 });
  }

  /** Every field of the rendered verdict, as one object a spec can compare. */
  async readSimulatorResult() {
    const textOf = async (selector) => {
      const node = this.page.locator(selector);
      if ((await node.count()) === 0) return null;
      return ((await node.first().innerText()) ?? '').replace(/\s+/g, ' ').trim();
    };
    return {
      matched: await textOf(this.locators.simulatorResult),
      specificity: await textOf(this.locators.simulatorSpecificity),
      team: await textOf(this.locators.simulatorTeam),
      ladder: await textOf(this.locators.simulatorLadder),
      responder: await textOf(this.locators.simulatorResponder),
    };
  }


  /** The simulator names the team it would page, by NAME rather than by id. */
  async expectSimulatorTeamNames(teamName) {
    await expect(this.page.locator(this.locators.simulatorTeam)).toContainText(teamName, { timeout: 30000 });
  }




  // -------------------------------------------------------- the default team

  /**
   * THE ORG ROUTING SCREEN RENDERS THIS COMPONENT IN `dialog` MODE, and the two
   * modes draw different DOM. In dialog mode there is NO
   * `oncall-default-team-card` and NO `oncall-default-team-save`: the trigger is
   * `oncall-default-team-open`, whose own LABEL names the current answer, and
   * the save is the ODialog's primary button. `oncall-default-team-card` and
   * `-save` only exist in the inline (card) mode used elsewhere.
   *
   * And `oncall-default-team-unset` is NOT a control. It is the warning
   * PARAGRAPH the dialog shows while no default is nominated — clicking it does
   * nothing. Nor is there another: the dialog's "none" entry carries an EMPTY
   * value, which OSelect does not stamp as `data-test-value=""`, so a nominated
   * default cannot be un-nominated from this screen at all.
   */
  async expectDefaultTeamControlVisible() {
    await expect(this.page.locator(this.locators.defaultTeamOpen)).toBeVisible({ timeout: 30000 });
  }


  async openDefaultTeamDialog() {
    await this.page.locator(this.locators.defaultTeamOpen).click();
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
    await expect(this.page.locator(this.locators.defaultTeamOpen)).toContainText(teamName, { timeout: 30000 });
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

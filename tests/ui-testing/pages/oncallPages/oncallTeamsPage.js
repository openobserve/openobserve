/**
 * OnCallTeamsPage - the on-call teams list (views/OnCall/OnCallTeams.vue)
 *
 * Row-level controls interpolate the team **id** (a ksuid), not its name:
 *   oncall-team-edit-<id> / oncall-team-delete-<id> / oncall-teams-primary-gap-<id>
 * so a spec holds the id its fixture returned rather than searching by text.
 * That is the opposite of the SLO list, whose selectors carry the name.
 *
 * The create/edit form is an **ODrawer**, so its Save is `o-drawer-primary-btn`
 * scoped inside `oncall-team-form-drawer` — not `o-dialog-primary-btn`. ODrawer
 * forwards the consumer's `data-test` onto the rendered panel precisely so that
 * scoping works; DialogRoot is renderless and would otherwise lose it.
 *
 * ENTERPRISE-GATED. `expectAvailable()` / `isUnavailable()` read the calm empty
 * state the product draws for a 404 or a 403 "Not Supported" — both mean
 * "on-call is not in this deployment", and neither is an error.
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier: orgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

function baseUrl() {
  return (process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/+$/, '');
}

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

export class OnCallTeamsPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      root: '[data-test="oncall-teams-page"]',
      table: '[data-test="oncall-teams-table"]',
      addButton: '[data-test="oncall-teams-add-btn"]',
      policiesButton: '[data-test="oncall-teams-policies-btn"]',
      refresh: '[data-test="oncall-teams-refresh"]',
      search: '[data-test="oncall-teams-search"]',
      empty: '[data-test="oncall-teams-empty"]',
      error: '[data-test="oncall-teams-error"]',
      notAvailable: '[data-test="oncall-teams-not-available"]',

      // Create / edit drawer.
      formDrawer: '[data-test="oncall-team-form-drawer"]',
      formName: '[data-test="oncall-team-form-name"]',
      formDescription: '[data-test="oncall-team-form-description"]',
      formTimezone: '[data-test="oncall-team-form-timezone"]',
      formMembers: '[data-test="oncall-team-form-members"]',
      formAddEveryone: '[data-test="oncall-team-form-add-everyone"]',
      formShift: '[data-test="oncall-team-form-shift"]',
      formHandover: '[data-test="oncall-team-form-handover"]',
      formSecondary: '[data-test="oncall-team-form-secondary"]',
      formManageLink: '[data-test="oncall-team-form-manage-link"]',

      // The delete confirmation is a ConfirmDialog, which forwards its own
      // data-test onto the panel so the button below can be scoped to it.
      confirmDialog: '[data-test="confirm-dialog"]',
      confirmOk: '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
      confirmCancel: '[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]',
    };
  }

  // Row-scoped selectors are built, not stored, because they carry the team id.
  editButton(teamId) { return `[data-test="oncall-team-edit-${teamId}"]`; }
  deleteButton(teamId) { return `[data-test="oncall-team-delete-${teamId}"]`; }
  primaryGapTag(teamId) { return `[data-test="oncall-teams-primary-gap-${teamId}"]`; }
  rotationChip(teamId, rotationId) {
    return `[data-test="oncall-teams-rotation-${teamId}-${rotationId}"]`;
  }

  // ------------------------------------------------------------- element getters

  getTable() { return this.page.locator(this.locators.table); }
  getRow(teamId) { return this.page.locator(this.editButton(teamId)); }
  getFormDrawer() { return this.page.locator(this.locators.formDrawer); }

  /** The drawer's own Save. Scoped to the drawer so a dialog behind it cannot win. */
  getDrawerSave() {
    return this.page.locator(`${this.locators.formDrawer} [data-test="o-drawer-primary-btn"]`);
  }

  getDrawerCancel() {
    return this.page.locator(`${this.locators.formDrawer} [data-test="o-drawer-secondary-btn"]`);
  }

  // ---------------------------------------------------------------- navigation

  /**
   * @param {string} orgId the org **identifier** (ksuid). A display name here
   *   returns "Organization not found" — indistinguishable from the feature
   *   being off, which is why nothing in these page objects accepts a name.
   */
  async goto(orgId) {
    this.orgId = orgId;
    await this.page.goto(`/web/oncall/teams?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('On-call teams');
  }

  async refresh() {
    await this.page.locator(this.locators.refresh).click();
  }

  async openPolicies() {
    await this.page.locator(this.locators.policiesButton).click();
  }

  // ------------------------------------------------------------------- actions

  /** Search is an OSearchInput, so the typable element is the `-field` inside it. */
  async search(text) {
    const field = this.page.locator(`${this.locators.search} [data-test$="-field"]`).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(text);
    // Client-side filter, debounced; let it settle rather than racing the assertion.
    await this.page.waitForTimeout(600);
  }

  async openCreateDrawer() {
    await this.page.locator(this.locators.addButton).click();
    await expect(this.getFormDrawer()).toBeVisible({ timeout: 20000 });
  }

  /**
   * Bring a team's row into view before acting on it.
   *
   * The list paginates, so a row is missing from the DOM whenever the org holds
   * more teams than one page shows — which reads as "the team was never created".
   * Search spans the whole list rather than the rendered page, so it reaches a
   * row on any page. A no-op when the row is already there.
   */
  async revealTeam(teamId, name) {
    if (await this.page.locator(this.editButton(teamId)).count()) return;
    if (!name) return;
    await this.search(name);
  }

  async openEditDrawer(teamId, { name } = {}) {
    await this.revealTeam(teamId, name);
    await this.page.locator(this.editButton(teamId)).click();
    await expect(this.getFormDrawer()).toBeVisible({ timeout: 20000 });
  }

  async fillTeamName(name) {
    const field = this.page.locator(part(this.locators.formName, 'field')).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(name);
  }

  async fillTeamDescription(text) {
    const field = this.page.locator(part(this.locators.formDescription, 'field')).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(text);
  }

  /**
   * Pick a value in one of the drawer's OSelects.
   *
   * Wrapper click to open, then the option by its `data-test-value` — an
   * OSelect's options are virtualized and carry the raw value as an attribute,
   * so matching on the rendered label would break on translation and on the
   * rows the virtualizer has not drawn.
   */
  async selectOption(fieldSelector, value) {
    const trigger = this.page.locator(part(fieldSelector, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
    await trigger.click();
    const option = this.page
      .locator(`${part(fieldSelector, 'option')}[data-test-value="${value}"]`)
      .first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
  }

  async selectTimezone(timezone) {
    await this.selectOption(this.locators.formTimezone, timezone);
  }

  /**
   * Stage people on the CREATE drawer.
   *
   * The picker only exists while creating (`v-if="!isEdit"`) — once the team
   * exists, membership has a screen of its own — and the order picked is the
   * order the default rotation puts people in, so it is load-bearing.
   */
  async pickFormMembers(emails) {
    const trigger = this.page.locator(part(this.locators.formMembers, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();
    for (const email of emails) {
      const option = this.page
        .locator(`${part(this.locators.formMembers, 'option')}[data-test-value="${email}"]`).first();
      await option.waitFor({ state: 'visible', timeout: 20000 });
      await option.click();
    }
    await this.page.keyboard.press('Escape');
  }

  /** Creation only — once the team exists, membership has a screen of its own. */
  async addEveryone() {
    await this.page.locator(this.locators.formAddEveryone).click();
  }

  async saveDrawer() {
    await this.getDrawerSave().click();
  }

  async cancelDrawer() {
    await this.getDrawerCancel().click();
    await expect(this.getFormDrawer()).toBeHidden({ timeout: 20000 });
  }

  /** Create through the UI and wait for the drawer to actually close. */
  async createTeam({ name, description = null, timezone = null } = {}) {
    await this.openCreateDrawer();
    await this.fillTeamName(name);
    if (description) await this.fillTeamDescription(description);
    if (timezone) await this.selectTimezone(timezone);
    await this.saveDrawer();
    await expect(this.getFormDrawer()).toBeHidden({ timeout: 30000 });
    testLogger.info('On-call team created via UI', { name });
  }

  /** §11.1: the edit drawer's way out to members / schedule / escalation. */
  async clickManageTeam() {
    const link = this.page.locator(this.locators.formManageLink);
    await link.waitFor({ state: 'visible', timeout: 15000 });
    await link.click();
  }

  /** Open the confirmation without confirming it — the message names the team. */
  async openDeleteDialog(teamId, { name } = {}) {
    await this.revealTeam(teamId, name);
    await this.page.locator(this.deleteButton(teamId)).click();
    await expect(this.page.locator(this.locators.confirmDialog)).toBeVisible({ timeout: 20000 });
  }

  /**
   * Delete through the UI, including the confirmation.
   *
   * The confirm is a ConfirmDialog — an ODialog, unlike the team form, which is
   * a drawer — so `o-dialog-primary-btn` is the right control, scoped to the
   * dialog's own panel so a second dialog on screen cannot win the match.
   */
  async deleteTeam(teamId, { name } = {}) {
    await this.openDeleteDialog(teamId, { name });
    await this.page.locator(this.locators.confirmOk).click();
    await expect(this.page.locator(this.locators.confirmDialog)).toHaveCount(0, { timeout: 20000 });
    testLogger.info('On-call team deleted via UI', { teamId });
  }

  /** Open a team by clicking its row — the name cell routes to the detail screen. */
  async openTeam(name) {
    await this.page.getByText(name, { exact: true }).first().click();
  }

  // ---------------------------------------------------------------- assertions

  async expectListVisible() {
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.table)).toBeVisible({ timeout: 30000 });
  }

  async expectRowVisible(teamId, { name } = {}) {
    await this.revealTeam(teamId, name);
    await expect(this.page.locator(this.editButton(teamId))).toBeVisible({ timeout: 30000 });
  }

  /** Not in the CURRENT view. Never reloads — a reload would clear the filter under test. */
  async expectRowAbsent(teamId) {
    await expect(this.page.locator(this.editButton(teamId))).toHaveCount(0, { timeout: 30000 });
  }

  /**
   * Gone from the SERVER, not merely from the rendered list.
   *
   * The server is asked directly. An absent row is NOT evidence of deletion: the
   * list paginates, so a team that still exists on page 2 renders zero rows here
   * and a DOM-only check passes while the delete silently did nothing.
   */
  async expectRowDeleted(teamId, { timeout = 30000 } = {}) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      const res = await this.page.request.get(
        `${baseUrl()}/api/${this.orgId ?? orgIdentifier()}/oncall/teams/${teamId}`,
        { headers: getAuthHeaders() },
      );
      last = res.status();
      if (last === 404) return;
      await this.page.waitForTimeout(1000);
    }
    throw new Error(
      `team ${teamId} still exists on the server after ${timeout}ms — GET returned ${last}, not 404`,
    );
  }

  /**
   * The team has nobody in its primary pool.
   *
   * This is the page's one alarm, and it has its own tag rather than sharing a
   * cell with the secondary — a staffed secondary used to fill the shared cell
   * and hide it entirely.
   */
  async expectPrimaryGap(teamId, { name } = {}) {
    await this.revealTeam(teamId, name);
    await expect(this.page.locator(this.primaryGapTag(teamId))).toBeVisible({ timeout: 30000 });
  }

  /**
   * Somebody covers the primary pool — read as the ABSENCE of the gap tag.
   *
   * Anchored on the row, because a team on another page also renders no gap tag
   * and would otherwise read as covered. Pass `name` wherever it is known.
   */
  async expectNoPrimaryGap(teamId, { name } = {}) {
    await this.revealTeam(teamId, name);
    if (name) {
      await expect(this.page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 20000 });
    }
    await expect(this.page.locator(this.primaryGapTag(teamId))).toHaveCount(0, { timeout: 30000 });
  }

  /**
   * The controls a role cannot use are not RENDERED (§10.5).
   *
   * Caveat worth knowing before writing an assertion on this: `canConfigure`
   * starts true and only flips after a configuration write has been refused, so
   * a control can legitimately be on screen until the first 403 lands.
   */
  async expectCreateControlHidden() {
    await expect(this.page.locator(this.locators.addButton)).toHaveCount(0, { timeout: 20000 });
  }

  async expectCreateControlVisible() {
    await expect(this.page.locator(this.locators.addButton)).toBeVisible({ timeout: 20000 });
  }

  /**
   * The row is on screen and its actions are not.
   *
   * Pass `name` wherever it is known: absent action buttons are also what a row
   * on another page looks like, so without anchoring on the row itself this
   * passes for a team that simply was not rendered.
   */
  async expectRowActionsHidden(teamId, { name } = {}) {
    if (name) {
      await expect(
        this.page.getByText(name, { exact: true }).first(),
        'the row must be on screen, or hidden actions prove nothing',
      ).toBeVisible({ timeout: 20000 });
    }
    await expect(this.page.locator(this.editButton(teamId))).toHaveCount(0, { timeout: 20000 });
    await expect(this.page.locator(this.deleteButton(teamId))).toHaveCount(0, { timeout: 20000 });
  }

  // ------------------------------------------------------- enterprise gating

  /** True when the deployment drew the calm "not available" state instead of a list. */
  async isUnavailable() {
    return (await this.page.locator(this.locators.notAvailable).count()) > 0;
  }

  /**
   * Fail with the reason rather than with a table timeout.
   *
   * On-call being absent is a fact about the DEPLOYMENT, so a spec should skip
   * on `isUnavailable()`; this exists for the specs that have already decided
   * the feature must be present.
   */
  async expectAvailable() {
    await expect(
      this.page.locator(this.locators.notAvailable),
      'on-call is not available on this deployment — the suite needs an enterprise build with O2_ONCALL_ENABLED',
    ).toHaveCount(0, { timeout: 30000 });
  }
}

export default OnCallTeamsPage;

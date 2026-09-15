/**
 * OnCallResponseDetailPage — one page record (views/OnCall/OnCallResponseDetail.vue)
 *
 * Route `/web/oncall/responses/{responseId}`. The screen a responder is on
 * while the pager is still going: the six verbs (acknowledge, snooze, escalate,
 * hand off, promote, resolve), the human timeline, the delivery ledger and the
 * prior causes for the same rule.
 *
 * TWO DISTINCTIONS THIS PAGE OBJECT KEEPS SEPARATE, BECAUSE THE PRODUCT DOES:
 *
 *   TIMELINE vs LEDGER   `oncall-response-activity` is the HUMAN timeline —
 *                        acks, notes, handoffs, recoveries. The ledger under
 *                        `oncall-response-deliveries` is one row per
 *                        (run, rung, recipient, channel) and includes attempts
 *                        that FAILED. A recorded failure is the feature, so a
 *                        spec must never read one for the other.
 *   SNOOZE vs ACK        Snooze quiets the ladder without claiming the record.
 *                        `readSnoozedBanner()` and the ack state are therefore
 *                        read through different methods; collapsing them would
 *                        hide the one bug this screen has repeatedly had.
 *
 * The snooze menu is an ODropdown and its items only exist once the trigger is
 * clicked, so `snoozeFor()` opens it first — and the offered durations are a
 * fixed 15/30/60/180 minutes, which is why the shortest real snooze a UI test
 * can take is a quarter of an hour.
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

export class OnCallResponseDetailPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      root: '[data-test="oncall-response-detail-page"]',
      empty: '[data-test="oncall-response-detail-empty"]',
      subtitle: '[data-test="oncall-response-subtitle"]',
      teamLink: '[data-test="oncall-response-team-link"]',
      originLink: '[data-test="oncall-response-origin-link"]',
      firing: '[data-test="oncall-response-firing"]',
      opened: '[data-test="oncall-response-opened"]',
      elapsed: '[data-test="oncall-response-elapsed"]',
      stats: '[data-test="oncall-response-stats"]',
      liaisonTag: '[data-test="oncall-response-liaison-tag"]',
      liaisonBanner: '[data-test="oncall-response-liaison-banner"]',
      snoozedBanner: '[data-test="oncall-response-snoozed-banner"]',

      // The six verbs.
      ackButton: '[data-test="oncall-response-ack-btn"]',
      snoozeButton: '[data-test="oncall-response-snooze-btn"]',
      escalateButton: '[data-test="oncall-response-escalate-btn"]',
      handoffButton: '[data-test="oncall-response-handoff-btn"]',
      promoteButton: '[data-test="oncall-response-promote-btn"]',
      resolveButton: '[data-test="oncall-response-resolve-btn"]',
      confirmRecoveryButton: '[data-test="oncall-response-confirm-recovery-btn"]',

      // Tabs over the record's evidence.
      tabs: '[data-test="oncall-response-tabs"]',
      tabsStrip: '[data-test="oncall-response-tabs-strip"]',
      tabActivity: '[data-test="oncall-response-tab-activity"]',
      tabDeliveries: '[data-test="oncall-response-tab-deliveries"]',
      tabCauses: '[data-test="oncall-response-tab-causes"]',
      activityPanel: '[data-test="oncall-response-activity"]',
      activityToggleAll: '[data-test="oncall-response-activity-toggle-all"]',
      deliveriesPanel: '[data-test="oncall-response-deliveries"]',
      causesPanel: '[data-test="oncall-response-causes"]',

      // The delivery ledger (OnCallDeliveryLedger), rendered inside the tab.
      ledger: '[data-test="oncall-delivery-ledger"]',
      ledgerEmpty: '[data-test="oncall-deliveries-empty"]',
      ledgerTruncated: '[data-test="oncall-deliveries-truncated"]',

      // Resolve.
      resolveDialog: '[data-test="oncall-resolve-dialog"]',
      resolveCause: '[data-test="oncall-resolve-cause"]',
      resolveCauseNote: '[data-test="oncall-resolve-cause-note"]',
      resolveConfirm: '[data-test="oncall-resolve-confirm"]',

      // Hand off.
      handoffDrawer: '[data-test="oncall-handoff-drawer"]',
      handoffModePerson: '[data-test="oncall-handoff-mode-person"]',
      handoffModeTeam: '[data-test="oncall-handoff-mode-team"]',
      handoffPersonSelect: '[data-test="oncall-handoff-person-select"]',
      handoffTeamSelect: '[data-test="oncall-handoff-team-select"]',
      handoffHint: '[data-test="oncall-handoff-hint"]',
      handoffNote: '[data-test="oncall-handoff-note"]',
      handoffSubmit: '[data-test="oncall-handoff-submit"]',

      // Promote, and the ordered-recovery confirmation.
      promoteDialog: '[data-test="oncall-promote-dialog"]',
      promoteTitle: '[data-test="oncall-promote-title"]',
      promoteSeverity: '[data-test="oncall-promote-severity"]',
      promoteConfirm: '[data-test="oncall-promote-confirm"]',
      recoveryDialog: '[data-test="oncall-confirm-recovery-dialog"]',
      recoveryNote: '[data-test="oncall-confirm-recovery-note"]',
      recoveryConfirm: '[data-test="oncall-confirm-recovery-confirm"]',
    };
  }

  // Built rather than stored — these carry a duration or a ledger run/index.
  snoozeOption(minutes) { return `[data-test="oncall-response-snooze-${minutes}"]`; }
  deliveryRow(run, index) { return `[data-test="oncall-delivery-row-${run}-${index}"]`; }

  // ---------------------------------------------------------------- navigation

  /** @param {string} orgId the org **identifier** (ksuid), never the display name. */
  async goto(orgId, responseId) {
    await this.page.goto(`/web/oncall/responses/${responseId}?org_identifier=${orgId}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async expectDetailVisible() {
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 45000 });
  }

  /** The record's own title line — what the responder reads first. */
  async expectSubtitleContains(text) {
    await expect(this.page.locator(this.locators.subtitle)).toContainText(text, { timeout: 30000 });
  }


  // -------------------------------------------------------------------- verbs

  async acknowledge() {
    const button = this.page.locator(this.locators.ackButton);
    await expect(button).toBeVisible({ timeout: 30000 });
    await button.click();
  }


  /**
   * Every verb control on screen at once.
   *
   * The permission case turns on "no control is hidden or disabled", so the
   * whole set is asserted in one place rather than test-by-test.
   */
  async expectAllVerbControlsEnabled() {
    for (const selector of [
      this.locators.ackButton,
      this.locators.snoozeButton,
      this.locators.handoffButton,
      this.locators.resolveButton,
    ]) {
      const control = this.page.locator(selector).first();
      await expect(control, `${selector} must be on screen for any responder`).toBeVisible({ timeout: 30000 });
      await expect(control, `${selector} must not be disabled for any responder`).toBeEnabled();
    }
  }

  /** Opens the ODropdown and picks a duration. The items do not exist until it opens. */
  async snoozeFor(minutes) {
    await this.page.locator(this.locators.snoozeButton).click();
    const option = this.page.locator(this.snoozeOption(minutes));
    await expect(option).toBeVisible({ timeout: 20000 });
    await option.click();
  }

  /** The offered durations, read off the open menu rather than assumed. */
  async readSnoozeOptions() {
    await this.page.locator(this.locators.snoozeButton).click();
    const items = this.page.locator('[data-test^="oncall-response-snooze-"]');
    await expect(items.first()).toBeVisible({ timeout: 20000 });
    const count = await items.count();
    const minutes = [];
    for (let i = 0; i < count; i++) {
      const attr = await items.nth(i).getAttribute('data-test');
      const m = /oncall-response-snooze-(\d+)$/.exec(attr ?? '');
      if (m) minutes.push(Number(m[1]));
    }
    await this.page.keyboard.press('Escape');
    return minutes;
  }

  async expectSnoozedBannerVisible() {
    await expect(this.page.locator(this.locators.snoozedBanner)).toBeVisible({ timeout: 30000 });
  }


  async openResolveDialog() {
    await this.page.locator(this.locators.resolveButton).click();
    await expect(this.page.locator(this.locators.resolveDialog)).toBeVisible({ timeout: 20000 });
  }

  /**
   * Pick a cause by its WIRE value.
   *
   * By `data-test-value`, not by label: the options are virtualized and the
   * label is translated, so a label match breaks on both counts.
   */
  async selectCause(cause) {
    const trigger = this.page.locator(part(this.locators.resolveCause, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();
    const option = this.page
      .locator(`${part(this.locators.resolveCause, 'option')}[data-test-value="${cause}"]`).first();
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();
  }

  /** Every cause the dialog offers, as wire values, read off the open list. */
  async readCauseOptions() {
    const trigger = this.page.locator(part(this.locators.resolveCause, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();
    const options = this.page.locator(part(this.locators.resolveCause, 'option'));
    await expect(options.first()).toBeVisible({ timeout: 20000 });
    const count = await options.count();
    const values = [];
    for (let i = 0; i < count; i++) {
      const value = await options.nth(i).getAttribute('data-test-value');
      if (value) values.push(value);
    }
    await this.page.keyboard.press('Escape');
    return values;
  }

  async fillCauseNote(text) {
    await this.page.locator(part(this.locators.resolveCauseNote, 'field')).first().fill(text);
  }

  async confirmResolve() {
    await this.page.locator(this.locators.resolveConfirm).click();
  }

  async openHandoffDrawer() {
    await this.page.locator(this.locators.handoffButton).click();
    await expect(this.page.locator(this.locators.handoffDrawer)).toBeVisible({ timeout: 20000 });
  }

  async chooseHandoffMode(mode) {
    const selector = mode === 'team' ? this.locators.handoffModeTeam : this.locators.handoffModePerson;
    await this.page.locator(selector).click();
  }

  async selectHandoffPerson(email) {
    await this._selectOption(this.locators.handoffPersonSelect, email);
  }

  /**
   * @param {string} teamId the option's VALUE.
   * @param {string} [teamName] the option's LABEL, used to narrow the list.
   *
   * The team picker is an OSelect over every team in the org, and OSelect
   * virtualises past 50 entries — on an org carrying fixture teams from earlier
   * runs the wanted row is simply not in the DOM. It is `searchable` by default,
   * so typing the NAME (the label; the id is not searched) is what brings the
   * row into existence.
   */
  async selectHandoffTeam(teamId, teamName = null) {
    await this._selectOption(this.locators.handoffTeamSelect, teamId, teamName);
  }

  /** The drawer's own words about what handing off will do — asserted, not assumed. */
  async readHandoffHint() {
    return (await this.page.locator(this.locators.handoffHint).first().innerText().catch(() => '')).trim();
  }

  async fillHandoffNote(text) {
    await this.page.locator(part(this.locators.handoffNote, 'field')).first().fill(text);
  }

  async submitHandoff() {
    await this.page.locator(this.locators.handoffSubmit).click();
  }

  /**
   * Open an OSelect and pick one option by its `data-test-value`.
   *
   * By value, not by label: the labels are translated and the rows are
   * virtualised. `searchTerm` is typed into the popover's search box first when
   * given — past 50 options OSelect only renders a window of rows, so on a long
   * list the wanted option does not exist in the DOM until the list is narrowed.
   */
  async _selectOption(fieldSelector, value, searchTerm = null) {
    const trigger = this.page.locator(part(fieldSelector, 'trigger')).first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();

    if (searchTerm) {
      const search = this.page.locator(part(fieldSelector, 'search')).first();
      await search.waitFor({ state: 'visible', timeout: 20000 });
      await search.fill(searchTerm);
    }

    const option = this.page
      .locator(`${part(fieldSelector, 'option')}[data-test-value="${value}"]`).first();
    await option.waitFor({ state: 'visible', timeout: 20000 });
    await option.click();
  }

  // ------------------------------------------------------- evidence surfaces

  async openTab(name) {
    const selector = {
      activity: this.locators.tabActivity,
      deliveries: this.locators.tabDeliveries,
      causes: this.locators.tabCauses,
    }[name];
    await this.page.locator(selector).click();
  }




  async expectLedgerVisible() {
    await expect(this.page.locator(this.locators.ledger)).toBeVisible({ timeout: 30000 });
  }

  /** Block until the ledger has actually drawn its rows, or report that it drew none. */
  async waitForDeliveryRows({ timeout = 60000 } = {}) {
    await expect
      .poll(async () => await this.page.locator('[data-test^="oncall-delivery-row-"]').count(), {
        timeout,
        intervals: [500],
        message: 'the delivery ledger never drew a row — its fetch may still be in flight',
      })
      .toBeGreaterThan(0);
  }

  /**
   * The ledger run ids on screen — a replay is a new run, not more rows on the
   * old one.
   *
   * Read off the ROWS, not off the run headers: the header
   * (`oncall-deliveries-run-{run}`) renders only when there is more than one
   * run, deliberately — "Run 1" over everything is a header with no question —
   * so a single-run ledger has rows and no header at all.
   */
  async readDeliveryRuns() {
    const rows = this.page.locator('[data-test^="oncall-delivery-row-"]');
    const count = await rows.count();
    const runs = new Set();
    for (let i = 0; i < count; i++) {
      const attr = await rows.nth(i).getAttribute('data-test');
      const m = /oncall-delivery-row-(.+)-\d+$/.exec(attr ?? '');
      if (m) runs.add(m[1]);
    }
    return [...runs];
  }

  async countDeliveryRows(run) {
    return await this.page.locator(`[data-test^="oncall-delivery-row-${run}-"]`).count();
  }




  async expectTeamLinkNames(teamName) {
    await expect(this.page.locator(this.locators.teamLink)).toContainText(teamName, { timeout: 30000 });
  }

}

export default OnCallResponseDetailPage;

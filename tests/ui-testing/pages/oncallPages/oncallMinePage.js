/**
 * OnCallMinePage — "my duty" and "my deliveries" (views/OnCall/OnCallMine.vue).
 *
 * Route `/web/oncall/me?org_identifier=<org>`. NOTE: nothing in the app links
 * here — navGroups registers only responses, teams and routing, and the Pages
 * list's "mine" control is a FILTER, not a link — so the URL has to be typed.
 * That is a product observation, not a test workaround; see the generation
 * report.
 *
 * THREE DUTY STATES, ONE SELECTOR. `oncall-mine-duty-{teamId}` is emitted by
 * all three branches, so the only machine-readable discriminator is the
 * rendered text:
 *
 *   on_call_now === true   "On call"
 *   on_call_now === false  "Not on call"
 *   on_call_now === null   "Could not resolve"    <- schedule unresolvable
 *
 * The third is the one that matters: the server answers `None` and
 * `schedule_resolved: false` rather than guessing, because "not on call" must
 * never be a guess. A test that accepted "Not on call" for a broken schedule
 * would be certifying exactly the failure the design avoids.
 *
 * THE INBOX IS KEYED ON THE CALLER. `GET /oncall/my/deliveries` takes no user
 * parameter at all — the recipient filter is the auth header, server-side — and
 * read state lives in its own per-user table with a unique index on
 * (org, user, event). So isolation is structural, not a filter the client asks
 * for politely.
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class OnCallMinePage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      root: '[data-test="oncall-mine-page"]',
      unavailable: '[data-test="oncall-mine-unavailable"]',
      teamsCard: '[data-test="oncall-mine-teams"]',
      onCallTag: '[data-test="oncall-mine-on-call"]',
      noTeams: '[data-test="oncall-mine-no-teams"]',
      shiftsTable: '[data-test="oncall-mine-shifts-table"]',
      // Below md the shifts render as stacked rows instead of the table.
      shiftsList: '[data-test="oncall-mine-shifts-list"]',
      // Inside the five-row frame: "N more" while rows wait below the fold.
      shiftsMore: '[data-test="oncall-mine-shifts-more"]',
      setupBanner: '[data-test="oncall-setup-banner-host"]',
      setupDismiss: '[data-test="oncall-setup-dismiss"]',
      away: '[data-test="oncall-mine-away"]',
      reach: '[data-test="oncall-mine-reach"]',
      // Icon-only row buttons; the name is the aria-label, there is no row menu.
      phoneChange: '[data-test="oncall-phone-change"]',
      phoneRemove: '[data-test="oncall-phone-remove"]',

      deliveries: '[data-test="oncall-my-deliveries"]',
      deliveriesTable: '[data-test="oncall-my-deliveries-table"]',
      deliveriesEmpty: '[data-test="oncall-my-deliveries-empty"]',
      unreadBadge: '[data-test="oncall-my-deliveries-unread"]',
      unreadToggle: '[data-test="oncall-my-deliveries-unread-toggle"]',
      readAll: '[data-test="oncall-my-deliveries-read-all"]',
    };
  }

  // -------------------------------------------------------- dynamic selectors

  teamRow(teamId) { return `[data-test="oncall-mine-team-${teamId}"]`; }
  dutyTag(teamId) { return `[data-test="oncall-mine-duty-${teamId}"]`; }
  shiftUntil(teamId) { return `[data-test="oncall-mine-shift-${teamId}"]`; }
  nextPerson(teamId) { return `[data-test="oncall-mine-next-${teamId}"]`; }
  coverButton(teamId) { return `[data-test="oncall-mine-cover-${teamId}"]`; }
  testPageButton(teamId) { return `[data-test="oncall-mine-test-page-${teamId}"]`; }
  shiftRow(teamId) { return `[data-test="oncall-mine-shift-row-${teamId}"]`; }
  rowMenu(teamId) { return `[data-test="oncall-mine-row-menu-${teamId}"]`; }
  deliveryUnreadTag(eventId) { return `[data-test="oncall-my-delivery-unread-${eventId}"]`; }
  deliveryToggle(eventId) { return `[data-test="oncall-my-delivery-toggle-${eventId}"]`; }

  // ------------------------------------------------------------- navigation

  async goto(orgId) {
    await this.page.goto(`/web/oncall/me?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.root)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('On-call mine');
  }

  async expectTeamsCardVisible() {
    await expect(
      this.page.locator(this.locators.teamsCard),
      'the duty card must render for somebody on at least one team',
    ).toBeVisible({ timeout: 30000 });
  }

  async expectTeamRowVisible(teamId) {
    await expect(
      this.page.locator(this.teamRow(teamId)),
      `team ${teamId} must appear on my duty list`,
    ).toBeVisible({ timeout: 30000 });
  }

  /** The duty tag's words — the only thing separating the three states. */
  async readDutyText(teamId) {
    const tag = this.page.locator(this.dutyTag(teamId)).first();
    await tag.waitFor({ state: 'visible', timeout: 30000 });
    return ((await tag.innerText().catch(() => '')) || '').trim();
  }

  // ---------------------------------------------------------- the inbox

  async expectDeliveriesVisible() {
    await expect(this.page.locator(this.locators.deliveries)).toBeVisible({ timeout: 30000 });
  }

  async expectDeliveryRowVisible(eventId) {
    await expect(
      this.page.locator(this.deliveryToggle(eventId)),
      `delivery ${eventId} must be listed in my inbox`,
    ).toBeVisible({ timeout: 30000 });
  }

  async expectDeliveryUnread(eventId) {
    await expect(
      this.page.locator(this.deliveryUnreadTag(eventId)),
      `delivery ${eventId} must be marked unread`,
    ).toBeVisible({ timeout: 30000 });
  }

  async expectDeliveryRead(eventId) {
    await expect(
      this.page.locator(this.deliveryUnreadTag(eventId)),
      `delivery ${eventId} must no longer be marked unread`,
    ).toHaveCount(0, { timeout: 30000 });
  }

  /** Mark one row read or unread again with the row's own button; there is no row menu. */
  async toggleDeliveryRead(eventId) {
    await this.expectDeliveryRowVisible(eventId);
    await this.page.locator(this.deliveryToggle(eventId)).first().click();
  }

  async readUnreadBadgeText() {
    const badge = this.page.locator(this.locators.unreadBadge).first();
    if (!(await badge.count())) return null;
    return ((await badge.innerText().catch(() => '')) || '').trim();
  }
}

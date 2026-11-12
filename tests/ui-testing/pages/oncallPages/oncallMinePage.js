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

const CHIP_RED = '[class*="bg-icon-chip-error-bg"]';
const CHIP_GREEN = /bg-icon-chip-success-bg/;
const CHIP_COVERED = /border-dashed/;

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

      phoneCard: '[data-test="oncall-phone-card"]',
      phoneState: '[data-test="oncall-phone-state"]',
      phoneNumber: '[data-test="oncall-phone-number"]',
      phoneInputField: '[data-test="oncall-phone-input-field"]',
      phoneInputError: '[data-test="oncall-phone-input-error"]',
      phoneSend: '[data-test="oncall-phone-send"]',
      phoneCodeField: '[data-test="oncall-phone-code-field"]',
      phoneConfirm: '[data-test="oncall-phone-confirm"]',
      phoneResend: '[data-test="oncall-phone-resend"]',
      phoneError: '[data-test="oncall-phone-error"]',
      phoneNoProvider: '[data-test="oncall-phone-no-provider"]',
      phoneTelephonyLink: '[data-test="oncall-phone-telephony-link"]',
      phoneCodeSentText: '[data-test="oncall-phone-code-sent-text"]',

      navReliability: '[data-test="nav-group-reliability"]',
      navMyOnCall: '[data-test="nav-group-item-onCallMine"]',
      tooltip: '[data-test="o-tooltip-content"]',
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
  channelChip(email, channel) { return `[data-test="oncall-channel-${email}-${channel}"]`; }
  channelChipLink(email, channel) { return `[data-test="oncall-channel-${email}-${channel}-link"]`; }
  channelRow(email) { return `[data-test="oncall-channels-${email}"]`; }

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

  async gotoHome(orgId) {
    await this.page.goto(`/web/?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.navReliability)).toBeVisible({ timeout: 30000 });
  }

  /** The flyout opens on hover, after a delay, and is teleported to the body. */
  async openFromOnCallMenu() {
    await this.page.locator(this.locators.navReliability).hover();
    const item = this.page.locator(this.locators.navMyOnCall);
    await item.waitFor({ state: 'visible', timeout: 15000 });
    await item.click();
    await this.page.waitForURL(/\/oncall\/me/, { timeout: 30000 });
  }

  async expectPhoneCardVisible() {
    await expect(this.page.locator(this.locators.phoneCard)).toBeVisible({ timeout: 30000 });
  }

  async typePhone(number) {
    await this.page.locator(this.locators.phoneInputField).fill(number);
  }

  recordContactWrites() {
    const writes = [];
    this.page.on('request', (request) => {
      if (request.method() === 'GET' || !/\/oncall\/contacts\//.test(request.url())) return;
      writes.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() });
    });
    return writes;
  }

  async clickSendCode() {
    await this.page.locator(this.locators.phoneSend).click();
  }

  async enterCode(code) {
    await this.page.locator(this.locators.phoneCodeField).fill(code);
  }

  async clickConfirm() {
    await this.page.locator(this.locators.phoneConfirm).click();
  }

  /** The reply to one try may read several ways, so the wait is on the answer and not on the words. */
  async clickConfirmAndWaitForAnswer() {
    const answered = this.page.waitForResponse(
      (res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/verify/confirm'),
      { timeout: 30000 },
    );
    await this.page.locator(this.locators.phoneConfirm).click();
    return (await answered).status();
  }

  async clickChange() {
    await this.page.locator(this.locators.phoneChange).click();
  }

  async clickResend() {
    await this.page.locator(this.locators.phoneResend).click();
  }

  async expectPhoneState(words) {
    await expect(this.page.locator(this.locators.phoneState)).toHaveText(words, { timeout: 30000 });
  }

  async expectPhoneNumberShown(phone) {
    await expect(this.page.locator(this.locators.phoneNumber)).toHaveText(phone, { timeout: 30000 });
  }

  async expectPhoneInputVisible() {
    await expect(this.page.locator(this.locators.phoneInputField)).toBeVisible({ timeout: 30000 });
  }

  async expectPhoneUsable() {
    await this.expectPhoneInputVisible();
    await expect(this.page.locator(this.locators.phoneInputField)).toBeEnabled();
  }

  async expectCodeBoxVisible() {
    await expect(this.page.locator(this.locators.phoneCodeField)).toBeVisible({ timeout: 30000 });
  }

  async expectCodeBoxHidden() {
    await expect(this.page.locator(this.locators.phoneCodeField)).toHaveCount(0, { timeout: 30000 });
  }

  async expectCodeSentCopy(sentence) {
    await expect(this.page.locator(this.locators.phoneCodeSentText)).toHaveText(sentence, { timeout: 30000 });
  }

  /** The sentence rides in the state tag's tooltip, which exists only while the tag is hovered. */
  async expectVerifiedCopy(sentence) {
    await this.page.locator(this.locators.phoneState).hover({ timeout: 30000 });
    await expect(this.page.locator(this.locators.tooltip).filter({ hasText: sentence })).toBeVisible({ timeout: 15000 });
    await this.page.mouse.move(0, 0);
  }

  async expectChangedHint(meaning) {
    await this.page.locator(this.locators.phoneState).hover({ timeout: 30000 });
    await expect(this.page.locator(this.locators.tooltip).filter({ hasText: meaning })).toBeVisible({ timeout: 15000 });
    await this.page.mouse.move(0, 0);
  }

  async expectPhoneError(sentence) {
    await expect(this.page.locator(this.locators.phoneError)).toHaveText(sentence, { timeout: 30000 });
  }

  async expectNoPhoneError() {
    await expect(this.page.locator(this.locators.phoneError)).toHaveCount(0, { timeout: 30000 });
  }

  /** The hint's words are unsourced beyond the country code, so only that part is read. */
  async expectFormatFlagged() {
    await expect(this.page.locator(this.locators.phoneInputError)).toContainText(/country code/i, { timeout: 30000 });
  }

  /** Guide 6.3 names a timer but not its words, and "Resend code" has no digit, so a number in the disabled button is the wait. */
  async expectResendCountingDown() {
    const resend = this.page.locator(this.locators.phoneResend);
    await expect(resend).toBeDisabled({ timeout: 30000 });
    await expect(resend).toContainText(/\d/);
  }

  /** The 60 s gap has its own signal, the button enabling, so nothing sleeps here. */
  async waitForResendReady({ timeout = 90000 } = {}) {
    const resend = this.page.locator(this.locators.phoneResend);
    await expect(resend).toBeEnabled({ timeout });
    await expect(resend).toHaveText('Resend code');
  }

  /** Absence means nothing until the card has read the contact, so the no-provider state is awaited first. */
  async expectNoProviderCard() {
    await expect(this.page.locator(this.locators.phoneNoProvider)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.phoneInputField)).toHaveCount(0);
    await expect(this.page.locator(this.locators.phoneSend)).toHaveCount(0);
  }

  async expectProviderAvailable() {
    await this.expectPhoneInputVisible();
    await expect(this.page.locator(this.locators.phoneNoProvider)).toHaveCount(0);
  }

  async openTelephonyFromCard() {
    await this.page.locator(this.locators.phoneTelephonyLink).click();
    await this.page.waitForURL(/\/settings\/telephony/, { timeout: 30000 });
  }

  async expectChipLinksToMine(email, channel, reason) {
    const link = this.page.locator(this.channelChipLink(email, channel));
    await expect(link, `${email}'s own ${channel} chip must link to My on-call`)
      .toHaveAttribute('aria-label', reason, { timeout: 30000 });
  }

  async expectChipDoesNotLink(email, channel, reason) {
    const chip = this.page.locator(this.channelChip(email, channel));
    await expect(chip, `${email}'s ${channel} chip must be drawn`).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.channelChipLink(email, channel)), 'only the person may add their phone')
      .toHaveCount(0);
    await chip.hover();
    await expect(this.page.locator(this.locators.tooltip).filter({ hasText: reason })).toBeVisible({ timeout: 15000 });
    await this.page.mouse.move(0, 0);
  }

  /** Red is kept for the person nothing reaches, so green email and no red chip must hold together. */
  async expectReachableByEmailAndNotRed(email) {
    const chip = this.page.locator(this.channelChip(email, 'email'));
    await expect(chip, `${email}'s email chip must be green`).toHaveClass(CHIP_GREEN, { timeout: 30000 });
    for (const channel of ['sms', 'voice']) {
      const phoneChip = this.page.locator(`${this.channelChip(email, channel)}, ${this.channelChipLink(email, channel)}`);
      await expect(phoneChip, `${email}'s ${channel} chip must read as covered by email`).toHaveClass(CHIP_COVERED);
    }
    const row = this.page.locator(this.channelRow(email));
    await expect(row.locator(CHIP_RED), `${email} must not read as unreachable`).toHaveCount(0);
  }

  async openOwnChip(email, channel) {
    await this.page.locator(this.channelChipLink(email, channel)).click();
    await this.page.waitForURL(/\/oncall\/me/, { timeout: 30000 });
    await this.expectPhoneCardVisible();
  }
}

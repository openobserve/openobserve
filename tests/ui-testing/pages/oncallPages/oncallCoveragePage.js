/**
 * OnCallCoveragePage — covers, swaps, absences and the schedule bar.
 *
 * Four surfaces, one page object, because they are four answers to one
 * question ("who actually holds the pager") and a spec comparing them has to
 * reach all four without three imports:
 *
 *   - the cover/swap dialog        components/oncall/OnCallCoverForm.vue
 *   - the cover list               components/oncall/OnCallCoverList.vue
 *   - the schedule bar             components/oncall/OnCallScheduleTimeline.vue
 *   - the "away" dialog            components/oncall/OnCallMembers.vue
 *
 * ONE DIALOG, TWO MODES. A swap is not an entity: `oncall-cover-mode-swap`
 * turns the same dialog into a form that writes TWO covers, one each way, in
 * sequence (OnCallTeamDetail.vue saveSwap). There is no swap record, no swap
 * endpoint and no swap id — afterwards the cover list shows two ordinary rows
 * and removing one leaves the other standing. Anything asserting on "the swap"
 * therefore asserts on the pair of covers, never on a single object.
 *
 * SHIFT KEYS, NOT EMAILS. The swap selects take `${rotationId}:${startMicros}`
 * as their option value (OnCallCoverForm.vue shiftKey), so a spec picking a
 * shift needs the rotation id and the shift's start instant — not a person.
 *
 * ROTATION, NOT SLOT. "Secondary" is a rotation NAME by convention only;
 * nothing in the product treats it as a slot. `oncall-cover-rotation` is
 * rendered only when the team has more than one rotation, so a one-rotation
 * team's cover form has no rotation control at all and the cover lands on the
 * primary — which is correct, not a missing field.
 *
 * TABS ARE PATH SEGMENTS. `/oncall/teams/<id>/schedule`, not `?tab=schedule`,
 * and `escalation`/`routing` are the canonical spellings the view rewrites
 * `policy`/`ownership` to.
 */

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

function baseUrl() {
  return (process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/+$/, '');
}

/** `[data-test="x"]` + `field` -> `[data-test="x-field"]`. See OnCallTeamsPage. */
function part(selector, suffix) {
  return selector.replace(/"\]$/, `-${suffix}"]`);
}

export class OnCallCoveragePage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      // team detail shell
      detailRoot: '[data-test="oncall-team-detail-page"]',
      overrideButton: '[data-test="oncall-team-override-btn"]',

      // the cover / swap dialog
      dialog: '[data-test="oncall-cover-dialog"]',
      modeCover: '[data-test="oncall-cover-mode-cover"]',
      modeSwap: '[data-test="oncall-cover-mode-swap"]',
      who: '[data-test="oncall-cover-who"]',
      rotation: '[data-test="oncall-cover-rotation"]',
      window: '[data-test="oncall-cover-window"]',
      summary: '[data-test="oncall-cover-summary"]',
      swapA: '[data-test="oncall-swap-a"]',
      swapB: '[data-test="oncall-swap-b"]',
      swapSummary: '[data-test="oncall-swap-summary"]',
      swapProblem: '[data-test="oncall-swap-problem"]',

      // the cover list
      coverList: '[data-test="oncall-cover-list"]',
      coverTable: '[data-test="oncall-cover-table"]',
      coverEmpty: '[data-test="oncall-cover-empty"]',
      coverRemoveDialog: '[data-test="oncall-cover-remove-dialog"]',

      // the schedule bar and its plain-words answer
      timeline: '[data-test="oncall-schedule-timeline"]',
      timelineChart: '[data-test="oncall-timeline-chart"]',
      timelineEmpty: '[data-test="oncall-timeline-empty"]',
      scheduleAnswer: '[data-test="oncall-schedule-answer"]',
      answerNobody: '[data-test="oncall-answer-nobody-hint"]',

      // absences, which live on the members tab
      membersTable: '[data-test="oncall-members-table"]',
      awayDialog: '[data-test="oncall-members-away-dialog"]',
      awayFromDate: '[data-test="oncall-members-away-from-date"]',
      awayToDate: '[data-test="oncall-members-away-to-date"]',
      awayReason: '[data-test="oncall-members-away-reason"]',
      awaySave: '[data-test="oncall-members-away-save"]',

      // dialog chrome
      dialogPrimary: '[data-test="o-dialog-primary-btn"]',
    };
  }

  // -------------------------------------------------------- dynamic selectors

  coverRemove(coverId) { return `[data-test="oncall-cover-remove-${coverId}"]`; }
  laneHeader(rotationId) { return `[data-test="oncall-lane-header-${rotationId}"]`; }
  markAway(memberRowId) { return `[data-test="oncall-members-mark-away-${memberRowId}"]`; }
  awayTag(memberRowId) { return `[data-test="oncall-members-away-${memberRowId}"]`; }

  /**
   * The attention row for a rotation handing a shift to somebody away.
   *
   * `oncall-attention-{kind}` (OnCallTeamAttention.vue); this is the ONLY
   * data-test the product gives an away clash. The plan's
   * `oncall-schedule-away-{email}` does not exist anywhere in web/src — see the
   * generation report.
   */
  attentionRow(kind) { return `[data-test="oncall-attention-${kind}"]`; }

  // -------------------------------------------------------------- navigation

  /** @param {'overview'|'members'|'schedule'|'escalation'|'routing'} tab */
  async gotoTeamTab(orgId, teamId, tab) {
    await this.page.goto(`/web/oncall/teams/${teamId}/${tab}?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.detailRoot)).toBeVisible({ timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    testLogger.navigation(`On-call team ${tab}`);
  }

  async expectTimelineVisible() {
    await expect(
      this.page.locator(this.locators.timeline),
      'the schedule tab must draw its timeline',
    ).toBeVisible({ timeout: 30000 });
  }

  async expectLaneVisible(rotationId) {
    await expect(
      this.page.locator(this.laneHeader(rotationId)),
      `the timeline must draw a lane for rotation ${rotationId}`,
    ).toBeVisible({ timeout: 30000 });
  }

  /**
   * Every band the schedule bar draws for one rotation, as
   * `{ label, aria }` in render order.
   *
   * THE BAR IS WHERE THE SCREEN NAMES THE HOLDER, and it is the only place.
   * `oncall-schedule-answer` — the strip above the chart — deliberately does
   * NOT restate who is on: OnCallTeamDetail.vue says so in as many words ("Who
   * is on, until when and who is next are on the lane the reader is already
   * looking at; restating them here gave the reader two renderings to
   * reconcile"). It speaks up only when NOBODY is on call. So a test comparing
   * the screen against the engine has to read the bands.
   *
   * Read from the ARIA label rather than the visible one, because the visible
   * label runs the address through `nameOf()` (a display name, which may not
   * contain the address at all) while the aria label carries `raw(who)` — the
   * address itself. Note the asymmetry in the markup: the TRACK is keyed on the
   * rotation's id (`o2-schedule-track-{id}`) while its BANDS are keyed on the
   * rotation's NAME (`o2-schedule-band-{name}-{segmentStart}`). Every fixture
   * in this suite names a rotation after its id, so one argument serves both;
   * a fixture that renamed a rotation would have to pass the id.
   */
  async readLaneBands(rotationName) {
    const track = this.page.locator(`[data-test="o2-schedule-track-${rotationName}"]`);
    await track.first().waitFor({ state: 'visible', timeout: 30000 });
    const bands = track.locator('[data-test^="o2-schedule-band-"]');
    const count = await bands.count();
    const out = [];
    for (let i = 0; i < count; i++) {
      const band = bands.nth(i);
      out.push({
        label: ((await band.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim(),
        aria: (await band.getAttribute('aria-label')) ?? '',
      });
    }
    return out;
  }

  /**
   * The bands claiming the present instant — the ones labelled "on now" or
   * marked as a cover.
   *
   * W-04 is that a zero-length segment renders full width over the real ones,
   * so the bar can present more than one claim on now, or the wrong one. Both
   * symptoms are visible here: the COUNT and the identity.
   */
  async readCurrentClaims(rotationName) {
    const bands = await this.readLaneBands(rotationName);
    return bands.filter((b) => /on now|cover/i.test(b.label) || /is covering/i.test(b.aria));
  }

  // ------------------------------------------------------ the cover dialog

  async openCoverDialog() {
    await this.page.locator(this.locators.overrideButton).first().click();
    await expect(this.page.locator(this.locators.dialog)).toBeVisible({ timeout: 20000 });
  }

  async chooseMode(mode) {
    const selector = mode === 'swap' ? this.locators.modeSwap : this.locators.modeCover;
    await this.page.locator(selector).first().click();
  }

  /**
   * Pick a value in one of the dialog's OSelects.
   *
   * Wrapper click to open, then the option by `data-test-value`: the options
   * are virtualized and carry the raw value as an attribute, so matching the
   * rendered label would break on translation and on undrawn rows.
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

  async chooseSwapShifts(keyA, keyB) {
    await this.selectOption(this.locators.swapA, keyA);
    await this.selectOption(this.locators.swapB, keyB);
  }

  async readSwapProblem() {
    const el = this.page.locator(this.locators.swapProblem).first();
    if (!(await el.count())) return null;
    return ((await el.innerText().catch(() => '')) || '').trim();
  }

  async expectSwapSummaryVisible() {
    await expect(
      this.page.locator(this.locators.swapSummary),
      'a legal pair must produce a summary of what the swap will do',
    ).toBeVisible({ timeout: 15000 });
  }

  async submitDialog() {
    await this.page
      .locator(`${this.locators.dialog} ${this.locators.dialogPrimary}`)
      .first()
      .click();
  }

  async expectDialogClosed() {
    await expect(this.page.locator(this.locators.dialog)).toBeHidden({ timeout: 30000 });
  }

  // -------------------------------------------------------- the cover list

  async expectCoverListVisible() {
    await expect(
      this.page.locator(this.locators.coverList),
      'the schedule tab must list the covers standing on this team',
    ).toBeVisible({ timeout: 30000 });
  }

  async expectCoverRowVisible(coverId) {
    await expect(
      this.page.locator(this.coverRemove(coverId)),
      `cover ${coverId} must be listed`,
    ).toBeVisible({ timeout: 30000 });
  }

  /**
   * Remove a cover through the UI, confirmation and all.
   *
   * Anchors on the row being VISIBLE first: "absent from the DOM" is what an
   * unrendered row and a deleted row look like alike, and only one of those is
   * the thing under test.
   */
  async removeCover(coverId) {
    await this.expectCoverRowVisible(coverId);
    await this.page.locator(this.coverRemove(coverId)).first().click();
    const dialog = this.page.locator(this.locators.coverRemoveDialog);
    await expect(dialog).toBeVisible({ timeout: 20000 });
    await dialog.locator(this.locators.dialogPrimary).first().click();
    await expect(dialog).toBeHidden({ timeout: 30000 });
  }

  // ------------------------------------------------------------- absences

  async expectMembersTableVisible() {
    await expect(this.page.locator(this.locators.membersTable)).toBeVisible({ timeout: 30000 });
  }

  /**
   * The member row ids on the members table, in render order.
   *
   * Away controls key off the team-member ROW id, never the email
   * (OnCallMembers.vue), so a spec holding an address has to map it here.
   */
  async readMemberRowIds() {
    const controls = this.page.locator('[data-test^="oncall-members-mark-away-"]');
    const count = await controls.count();
    const ids = [];
    for (let i = 0; i < count; i++) {
      const attr = await controls.nth(i).getAttribute('data-test');
      if (attr) ids.push(attr.replace('oncall-members-mark-away-', ''));
    }
    return ids;
  }

  async expectAwayTagVisible(memberRowId) {
    await expect(
      this.page.locator(this.awayTag(memberRowId)),
      `member row ${memberRowId} must show an away tag`,
    ).toBeVisible({ timeout: 30000 });
  }

  /**
   * Assert the team raises a given attention row, opening the drawer to see it.
   *
   * TWO TRAPS, both of which cost a red test:
   *
   *   THE ROWS ARE IN A DRAWER. The team page shows a COLLAPSED STRIP naming
   *   only the worst finding; the grouped list lives in
   *   `oncall-team-attention-drawer` behind `oncall-attention-expand`. So
   *   `oncall-attention-{kind}` is not visible — not even attached — until the
   *   drawer is opened, and a test that only navigated would wait out its
   *   timeout against a page that is displaying the finding perfectly well.
   *
   *   `.first()`, because `oncall-attention-{kind}` is emitted per ROW and one
   *   kind legitimately produces several — a rotation handing shifts to
   *   somebody away raises one row per affected handover. A bare `toBeVisible`
   *   is a strict-mode violation the moment there is more than one.
   */
  async expectAttentionRowVisible(kind) {
    const row = this.page.locator(this.attentionRow(kind)).first();
    if (!(await row.isVisible().catch(() => false))) {
      const expand = this.page.locator('[data-test="oncall-attention-expand"]').first();
      await expand.waitFor({ state: 'visible', timeout: 30000 });
      await expand.click();
      await expect(
        this.page.locator('[data-test="oncall-team-attention-drawer"]'),
        'the attention drawer must open to show the full finding list',
      ).toBeVisible({ timeout: 20000 });
    }
    await expect(
      row,
      `the team must raise the "${kind}" attention row`,
    ).toBeVisible({ timeout: 30000 });
  }
}

// communitySlackInvitePage.js - Page Object for the Cloud-only Community Slack Invite popup
// Covers CommunitySlackInvite (web/src/components/CommunitySlackInvite.vue), mounted once in
// MainLayout.vue:214 and gated on the build-time flag config.isCloud === "true". On the OSS build
// that flag is the literal string "false" (aws-exports.ts:30-32), so the component bails out in
// onMounted (CommunitySlackInvite.vue:73) and never renders any DOM. The OSS E2E assertion is
// therefore negative (dialog count 0); the dismiss/join/caption selectors are reachable only on a
// Cloud build and are exercised by the test.fixme placeholders in the spec.
import { expect } from '@playwright/test';

export class CommunitySlackInvitePage {
  constructor(page) {
    this.page = page;

    // ODialog forwards data-test onto the lazily mounted reka-ui DialogContent, so a
    // closed dialog has NO DOM node — on OSS this locator resolves to 0 elements.
    this.slackDialog = page.locator('[data-test="community-slack-invite-dialog"]');
    this.closeBtn = page.locator('[data-test="community-slack-invite-close-btn"]');
    this.joinBtn = page.locator('[data-test="community-slack-invite-join-btn"]');
    this.membersText = page.locator('[data-test="community-slack-invite-members-text"]');
  }

  /** Navigate to the Logs sub-route (full page reload) so absence/state can be re-verified after a re-mount. */
  async navigateToLogs(org) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    await this.page.goto(`/web/logs?org_identifier=${orgId}`, { timeout: 30000 });
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Asserts the invite dialog is structurally absent (count 0, not merely hidden). */
  async expectSlackInviteAbsent() {
    await expect(this.slackDialog).toHaveCount(0);
  }

  /** Asserts the invite dialog is open/visible (Cloud-only path). */
  async expectSlackInviteVisible() {
    await expect(this.slackDialog).toBeVisible();
  }

  /** Clicks the × close button (dismiss path). */
  async clickClose() {
    await this.closeBtn.click();
  }

  /** Clicks the Join Slack button (resolve path). */
  async clickJoin() {
    await this.joinBtn.click();
  }

  /** Asserts the member-count caption renders non-empty text (either the count or the qualitative note). */
  async expectMembersTextToRender() {
    await expect(this.membersText).toBeVisible();
    await expect(this.membersText).not.toBeEmpty();
  }

  /** Seeds a day-2 `pending_day2` record (>=24h old) so the Cloud dialog opens on mount. */
  async seedDay2SlackInvite(email) {
    const key = `slackCommunityInvite:${email || 'anonymous'}`;
    await this.page.evaluate((k) => {
      localStorage.setItem(
        k,
        JSON.stringify({
          status: 'pending_day2',
          shownAt: Date.now() - 24 * 60 * 60 * 1000,
          dismissCount: 0,
        }),
      );
    }, key);
  }

  /** Reads the parsed slack-invite record for the given email (or null if absent). */
  async getSlackInviteRecord(email) {
    const key = `slackCommunityInvite:${email || 'anonymous'}`;
    return await this.page.evaluate((k) => {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : null;
    }, key);
  }
}

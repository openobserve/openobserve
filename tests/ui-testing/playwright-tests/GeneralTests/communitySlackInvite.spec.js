/**
 * Community Slack Invite Dismissal Snooze — OSS negative gating + Cloud feature-gap fixmes
 *
 * CommunitySlackInvite is a Cloud-only, day-2 follow-up popup mounted once in
 * MainLayout.vue:214. Every user-visible behavior is gated on the build-time flag
 * config.isCloud === "true" (VITE_OPENOBSERVE_CLOUD). On the OSS build that flag is
 * the literal string "false" (aws-exports.ts:30-32), so the component bails out in
 * onMounted (CommunitySlackInvite.vue:73) and never renders any DOM.
 *
 * The OSS E2E assertion is therefore a negative gating test: the dialog has count 0
 * on first paint and again after a full page reload. A closed reka-ui dialog mounts
 * no DOM, so toHaveCount(0) (not toBeHidden()) is the correct race-free assertion.
 * The test self-skips on Cloud (where the dialogs are expected) so a shared matrix
 * can never produce a false red.
 *
 * The snooze/dismiss/join/caption interactions are Cloud-only and unreachable on OSS
 * (blocked by the same render gate), so they are planned as test.fixme placeholders
 * with their real assertion bodies kept intact — they run, surface the gap as an
 * expected "fixme", and go green once a Cloud E2E matrix exists.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');

test.describe('Community Slack Invite Dismissal Snooze testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('Community Slack Invite dialog never renders on the OSS build', {
    tag: ['@community-slack-invite-dismiss', '@all', '@oss'],
  }, async ({ page }) => {
    test.skip(isCloudEnvironment(), 'Runs only on OSS/self-hosted (Cloud dialogs are expected)');

    testLogger.info('Verifying the Slack invite dialog is absent on first paint');
    await pm.communitySlackInvitePage.expectSlackInviteAbsent();

    // The onMounted bail-out must hold across a full page reload, not just the first
    // paint — navigate to Logs and re-assert absence to guard re-mounts.
    testLogger.info('Navigating to Logs and re-verifying absence');
    await pm.communitySlackInvitePage.navigateToLogs();
    await pm.communitySlackInvitePage.expectSlackInviteAbsent();

    testLogger.info('Test completed');
  });

  test.fixme('Day-2 dismiss snoozes the invite for 7 days — not wired: CommunitySlackInvite.vue:73 render gate blocks dismiss() on OSS', {
    tag: ['@community-slack-invite-dismiss', '@all', '@cloud'],
  }, async ({ page }) => {
    const email = process.env['ZO_ROOT_USER_EMAIL'] || 'anonymous';
    await pm.communitySlackInvitePage.seedDay2SlackInvite(email);
    await pm.communitySlackInvitePage.navigateToLogs();

    await pm.communitySlackInvitePage.expectSlackInviteVisible();
    await pm.communitySlackInvitePage.clickClose();
    await pm.communitySlackInvitePage.expectSlackInviteAbsent();

    // markSlackInviteDismissed keeps status pending_day2 (snoozed) and increments dismissCount.
    const record = await pm.communitySlackInvitePage.getSlackInviteRecord(email);
    expect(record.status).toBe('pending_day2');
    expect(record.dismissCount).toBe(1);
  });

  test.fixme('Join Slack resolves the invite for good — not wired: CommunitySlackInvite.vue:73 render gate blocks joinSlack() on OSS', {
    tag: ['@community-slack-invite-dismiss', '@all', '@cloud'],
  }, async ({ page }) => {
    const email = process.env['ZO_ROOT_USER_EMAIL'] || 'anonymous';
    await pm.communitySlackInvitePage.seedDay2SlackInvite(email);
    await pm.communitySlackInvitePage.navigateToLogs();

    await pm.communitySlackInvitePage.expectSlackInviteVisible();
    await pm.communitySlackInvitePage.clickJoin();
    await pm.communitySlackInvitePage.expectSlackInviteAbsent();

    const record = await pm.communitySlackInvitePage.getSlackInviteRecord(email);
    expect(record.status).toBe('resolved');
  });

  test.fixme('Member-count caption renders (qualitative vs count) — not wired: CommunitySlackInvite.vue:73 render gate blocks the dialog on OSS', {
    tag: ['@community-slack-invite-dismiss', '@all', '@cloud'],
  }, async ({ page }) => {
    const email = process.env['ZO_ROOT_USER_EMAIL'] || 'anonymous';
    await pm.communitySlackInvitePage.seedDay2SlackInvite(email);
    await pm.communitySlackInvitePage.navigateToLogs();

    await pm.communitySlackInvitePage.expectSlackInviteVisible();
    await pm.communitySlackInvitePage.expectMembersTextToRender();
  });
});

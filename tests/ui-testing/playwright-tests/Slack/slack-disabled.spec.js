// Settings › Slack on a self-hosted enterprise server with O2_SLACK_ENABLED off (AC-1.4, AC-1.5).
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const { SlackPages, api } = require('../../pages/slackPages/index.js');

const ORG = process.env.ORGNAME || 'default';

test.describe.configure({ mode: 'serial' });

test.describe('Slack turned off on the server', { tag: ['@slack', '@enterprise'] }, () => {
  let reason = null;
  let buildType = null;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const config = await api.orgConfig(request, ORG);
    reason = config.slack_disabled_reason ?? null;
    buildType = config.build_type ?? null;
    await request.dispose();
  });

  test.beforeEach(() => {
    test.skip(reason !== 'flag', `needs a server with O2_SLACK_ENABLED off; this one reports slack_disabled_reason=${reason}`);
  });

  test('the Slack page names O2_SLACK_ENABLED and offers no set-up', async ({ page }) => {
    const slack = new SlackPages(page);
    await slack.settings.goto(ORG);
    await expect(slack.settings.disabled).toBeVisible();
    await expect(slack.settings.disabled).toContainText('O2_SLACK_ENABLED');
    await expect(slack.settings.setupApp).toHaveCount(0);
    await expect(slack.settings.wizard).toHaveCount(0);
    await expect(slack.settings.disabledStep0).toHaveCount(0);
  });

  test('a _meta admin also sees the Step 0 checks under the disabled notice', async ({ page }) => {
    const slack = new SlackPages(page);
    await slack.settings.goto('_meta');
    await expect(slack.settings.disabled).toContainText('O2_SLACK_ENABLED');
    await expect(slack.settings.disabledStep0).toBeVisible({ timeout: 30000 });
    await expect(slack.settings.disabledStep0.locator('tr', { hasText: 'O2_MASTER_ENCRYPTION_KEY' })).toHaveCount(1);
  });

  test('the user menu has no Linked accounts while Slack is off', async ({ page }) => {
    test.skip(buildType !== 'enterprise', `build_type is ${buildType}`);
    const slack = new SlackPages(page);
    await navigateToBase(page);
    await slack.linkedAccounts.profileMenu.click();
    await expect(page.locator('[data-test="menu-link-logout-item"]')).toBeVisible({ timeout: 10000 });
    await expect(slack.linkedAccounts.menuItem).toHaveCount(0);
  });
});

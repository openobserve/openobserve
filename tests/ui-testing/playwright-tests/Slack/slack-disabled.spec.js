// A self-hosted enterprise server with O2_SLACK_ENABLED off shows no Slack anywhere (AC-1.4, AC-1.5, decision 2026-10-19).
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const { SlackPages, api } = require('../../pages/slackPages/index.js');

const { BASE } = api;

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

  for (const org of [ORG, '_meta']) {
    test(`Settings in ${org} has no Slack entry and a Slack link lands on General`, async ({ page }) => {
      const slack = new SlackPages(page);
      await page.goto(`${BASE()}/web/settings/general?org_identifier=${org}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-test="section-rail"]')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('[data-test="general-settings-tab"]').first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator('[data-test^="slack-settings-tab"]')).toHaveCount(0);

      await page.goto(`${BASE()}/web/settings/slack?org_identifier=${org}`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/settings\/general/, { timeout: 30000 });
      await expect(slack.settings.root).toHaveCount(0);
      await expect(page.locator('[data-test="section-rail"]')).not.toContainText('Slack');
    });
  }

  test('the role editor is offered no Slack resource', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { status, body } = await api.call(request, 'get', `/api/${ORG}/resources`);
    await request.dispose();
    expect(status).toBe(200);
    const keys = body.map((r) => r.key);
    expect(keys).toContain('stream');
    expect(keys).not.toContain('slack_integration');
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

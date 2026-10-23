// N7 link pages: one-click linking (AC-9.5), the signed-out return (AC-9.6) and the page states (AC-12.3).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { SlackPages, api } = require('../../pages/slackPages/index.js');
const { linkRequestFromSlack, followLink, waitForDm } = require('../../pages/slackPages/slackLinkFlow.js');

const AUTH_FILE = path.join(__dirname, '../utils/auth/user.json');
const NEEDS_LINKS = 'needs commit 10 link endpoints';
const TEAM = { teamId: `T0PWLINK${api.uniq().toUpperCase()}`, teamName: 'Acme PW Link' };

test.describe.configure({ mode: 'serial' });

test.describe('Slack link pages', { tag: ['@slack', '@enterprise'] }, () => {
  let apiContext;
  let context;
  let page;
  let slack;
  let org;
  let orgName;
  let slackOn = false;
  let linkRoutes = false;
  let redeemed = '';

  test.beforeAll(async ({ browser, playwright }) => {
    apiContext = await playwright.request.newContext();
    const config = await api.orgConfig(apiContext, process.env.ORGNAME || 'default');
    slackOn = config.slack_enabled === true;
    if (!slackOn) return;
    ({ id: org, name: orgName } = await api.createOrg(apiContext, 'slack_pw_link'));
    linkRoutes = await api.linkRoutesExist(apiContext, org);
    context = await browser.newContext({ storageState: AUTH_FILE, viewport: { width: 1500, height: 1024 } });
    page = await context.newPage();
    slack = new SlackPages(page);
  });

  test.afterAll(async () => {
    await context?.close();
    await apiContext?.dispose();
  });

  test.beforeEach(() => {
    test.skip(!slackOn, 'the server runs with Slack off (O2_SLACK_ENABLED is not true)');
  });

  test('signed out, /slack/link goes to login and comes back to the same link after login (AC-9.6)', async ({ browser }) => {
    const fresh = await browser.newContext({ viewport: { width: 1500, height: 1024 } });
    const anon = await fresh.newPage();
    try {
      const r = 'Rpwsignedout.sig0';
      await anon.goto(`${api.BASE()}/web/slack/link?r=${r}`, { waitUntil: 'domcontentloaded' });
      await expect(anon).toHaveURL(/\/web\/login/, { timeout: 30000 });
      await anon.locator('[data-test="login-user-id-field"]').fill(process.env.ZO_ROOT_USER_EMAIL);
      await anon.locator('[data-test="login-password-field"]').fill(process.env.ZO_ROOT_USER_PASSWORD);
      await anon.locator('[data-test="login-sign-in"]').click();
      await expect(anon).toHaveURL(new RegExp(`/web/slack/link\\?r=${r.replace('.', '\\.')}`), { timeout: 30000 });
      await expect(anon.locator('[data-test="slack-link-page"]')).toBeVisible();
    } finally {
      await fresh.close();
    }
  });

  test('a malformed link shows "This link expired" without Send me a new link (AC-12.3)', async () => {
    await slack.link.openLink('not-a-request');
    await expect(slack.link.state('unknown')).toBeVisible({ timeout: 30000 });
    await expect(slack.link.resend).toHaveCount(0);
  });

  test('Cancel in Slack lands on "Linking was cancelled" (AC-12.3)', async () => {
    await page.goto(`${api.BASE()}/web/slack/link/callback?error=access_denied`, { waitUntil: 'domcontentloaded' });
    await expect(slack.link.callbackPage).toBeVisible({ timeout: 30000 });
    await expect(slack.link.cancelled).toBeVisible();
  });

  test('one click and Allow link the account with no OpenObserve confirm page (AC-9.5)', async () => {
    test.skip(!linkRoutes, NEEDS_LINKS);
    const { installation, r } = await linkRequestFromSlack(apiContext, org, TEAM);
    const second = await api.createOrg(apiContext, 'slack_pw_link_b');
    await api.connectOrg(apiContext, second.id, installation.id, TEAM.teamId);
    const visited = await followLink(context, page, slack, TEAM, r, org);
    const o2Pages = visited.filter((u) => u.startsWith(api.BASE())).map((u) => new URL(u).pathname);
    expect(o2Pages.every((p) => p === '/web/slack/link' || p === '/web/slack/link/callback')).toBe(true);
    await expect(slack.link.linked).toContainText(orgName);

    const { body } = await api.call(apiContext, 'get', `/api/${org}/slack/links/me`);
    expect(body.links.some((l) => l.team_name === TEAM.teamName && l.default_org_id === org)).toBe(true);
    const l2 = await waitForDm(apiContext, 'o2_change_org');
    expect(l2.text).toContain('Linked as');
    expect(l2.blocks).toContain(second.id);
    redeemed = r;
  });

  test('a redeemed link shows "This link expired" with Send me a new link (AC-12.3)', async () => {
    test.skip(!linkRoutes, NEEDS_LINKS);
    test.skip(!redeemed, 'the linking test did not redeem a link');
    await slack.link.openLink(redeemed, org);
    await expect(slack.link.state('expired')).toBeVisible({ timeout: 30000 });
    await slack.link.resend.click();
    await expect(slack.link.resent).toBeVisible({ timeout: 15000 });
  });
});

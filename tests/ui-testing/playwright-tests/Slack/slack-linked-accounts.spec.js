// L3 Linked accounts in the user menu: lists the caller's Slack links and Unlink removes one (AC-12.3).
const path = require('path');
const { test, expect } = require('@playwright/test');
const { SlackPages, api } = require('../../pages/slackPages/index.js');
const { linkRequestFromSlack, followLink } = require('../../pages/slackPages/slackLinkFlow.js');

const AUTH_FILE = path.join(__dirname, '../utils/auth/user.json');
const NEEDS_LINKS = 'needs commit 10 link endpoints';
const TEAM = { teamId: `T0PWL3${api.uniq().toUpperCase()}`, teamName: 'Acme PW Accounts' };

test.describe.configure({ mode: 'serial' });

test.describe('Slack linked accounts', { tag: ['@slack', '@enterprise'] }, () => {
  let apiContext;
  let context;
  let page;
  let slack;
  let org;
  let slackOn = false;
  let linkRoutes = false;
  let linkId = '';

  test.beforeAll(async ({ browser, playwright }) => {
    apiContext = await playwright.request.newContext();
    const config = await api.orgConfig(apiContext, process.env.ORGNAME || 'default');
    slackOn = config.slack_enabled === true;
    if (!slackOn) return;
    org = (await api.createOrg(apiContext, 'slack_pw_accounts')).id;
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

  test('the user menu offers Linked accounts and opens the dialog', async () => {
    await slack.settings.goto(org);
    await slack.linkedAccounts.open();
    await expect(slack.linkedAccounts.dialog).toBeVisible();
  });

  test('the dialog lists a link made from Slack with its workspace', async () => {
    test.skip(!linkRoutes, NEEDS_LINKS);
    const { r } = await linkRequestFromSlack(apiContext, org, TEAM);
    await followLink(context, page, slack, TEAM, r, org);
    const { body } = await api.call(apiContext, 'get', `/api/${org}/slack/links/me`);
    const link = body.links.find((l) => l.team_name === TEAM.teamName);
    expect(link).toBeTruthy();
    linkId = link.id;

    await slack.settings.goto(org);
    await slack.linkedAccounts.open();
    await expect(slack.linkedAccounts.item(linkId)).toContainText(TEAM.teamName);
    await expect(slack.linkedAccounts.note).toBeVisible();
  });

  test('Unlink removes the link and the list refetches', async () => {
    test.skip(!linkRoutes, NEEDS_LINKS);
    test.skip(!linkId, 'no link was made in the previous test');
    await slack.linkedAccounts.unlink(linkId).click();
    await expect(slack.linkedAccounts.item(linkId)).toHaveCount(0, { timeout: 15000 });
    const { body } = await api.call(apiContext, 'get', `/api/${org}/slack/links/me`);
    expect(body.links.some((l) => l.id === linkId)).toBe(false);
  });
});

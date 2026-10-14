// A3 workspace card after a stored install: Test, Update credentials, Disconnect this org, Uninstall (AC-12.2).
const path = require('path');
const { test, expect } = require('@playwright/test');
const testLogger = require('../utils/test-logger.js');
const { SlackPages, api } = require('../../pages/slackPages/index.js');

const AUTH_FILE = path.join(__dirname, '../utils/auth/user.json');
const TEAM = { teamId: `T0PWCARD${api.uniq().toUpperCase()}`, teamName: 'Acme PW Card' };

test.describe.configure({ mode: 'serial' });

test.describe('Slack workspace card', { tag: ['@slack', '@enterprise'] }, () => {
  let apiContext;
  let context;
  let page;
  let slack;
  let slackOn = false;
  let install;
  const orgs = {};
  const dest = { a: `slack_pw_card_a_${api.uniq()}`, b: `slack_pw_card_b_${api.uniq()}`, c: `slack_pw_card_c_${api.uniq()}` };

  test.beforeAll(async ({ browser, playwright }) => {
    apiContext = await playwright.request.newContext();
    const config = await api.orgConfig(apiContext, process.env.ORGNAME || 'default');
    slackOn = config.slack_enabled === true;
    if (!slackOn) return;
    orgs.main = (await api.createOrg(apiContext, 'slack_pw_card')).id;
    orgs.other = (await api.createOrg(apiContext, 'slack_pw_card_other')).id;
    orgs.leaving = (await api.createOrg(apiContext, 'slack_pw_card_leaving')).id;
    install = await api.storedInstall(apiContext, orgs.main, TEAM);
    await api.connectOrg(apiContext, orgs.other, install.id, TEAM.teamId);
    await api.connectOrg(apiContext, orgs.leaving, install.id, TEAM.teamId);
    await api.createSlackDestination(apiContext, orgs.main, { name: dest.a, ...TEAM });
    await api.createSlackDestination(apiContext, orgs.main, { name: dest.b, ...TEAM });
    await api.createSlackDestination(apiContext, orgs.leaving, { name: dest.c, ...TEAM });
    context = await browser.newContext({ storageState: AUTH_FILE, viewport: { width: 1500, height: 1024 } });
    page = await context.newPage();
    slack = new SlackPages(page);
    testLogger.info('Slack card spec orgs', { ...orgs, installation: install.id });
  });

  test.afterAll(async () => {
    await context?.close();
    await apiContext?.dispose();
  });

  test.beforeEach(() => {
    test.skip(!slackOn, 'the server runs with Slack off (O2_SLACK_ENABLED is not true)');
  });

  test('the card shows the workspace, this org with its destinations and the other orgs as a count', async () => {
    await slack.settings.goto(orgs.main);
    await slack.card.waitLoaded();
    await expect(slack.card.name).toHaveText(TEAM.teamName);
    await expect(slack.card.meta).toContainText('root@example.com');
    await expect(slack.card.status).toBeVisible();
    await expect(slack.card.refreshToken).toBeVisible();
    await expect(slack.card.sockets).toBeVisible();

    const thisOrgRow = slack.card.connectedOrgs.locator('tbody:not([data-test="o2-table-skeleton-body"]) tr');
    await expect(thisOrgRow).toHaveCount(1);
    await expect(thisOrgRow).toContainText(`${orgs.main} (this org)`);
    await expect(thisOrgRow).toContainText('2');
    await expect(slack.card.connectedOrgs).toContainText('2 other orgs');
    await expect(slack.card.connectedOrgs).not.toContainText(orgs.other);
  });

  test('Test connection runs the checks against Slack', async () => {
    await slack.card.test.click();
    await expect(slack.card.testResults).toBeVisible({ timeout: 30000 });
    const statuses = await slack.card.testResults
      .locator('[data-test^="slack-check-"]')
      .evaluateAll((items) => items.map((i) => i.getAttribute('data-status')));
    expect(statuses.length).toBeGreaterThan(0);
    await expect(slack.card.testCheck('auth_test')).toHaveAttribute('data-status', 'pass');
  });

  test('Update credentials offers the Socket Mode secrets and saves a new app token', async () => {
    await slack.card.updateCredentials.click();
    await expect(slack.credentials.panel).toBeVisible();
    await expect(slack.credentials.field('app_token')).toBeVisible();
    await expect(slack.credentials.field('client_id')).toBeVisible();
    await expect(slack.credentials.field('client_secret')).toBeVisible();
    await expect(slack.credentials.field('config_refresh_token')).toBeVisible();
    await expect(slack.credentials.field('signing_secret')).toHaveCount(0);

    await slack.credentials.field('app_token').fill(`xapp-1-pw-${api.uniq()}`);
    await slack.credentials.save.click();
    await expect(slack.credentials.panel).toHaveCount(0, { timeout: 15000 });
    const { installations } = await api.listInstallations(apiContext, orgs.main);
    expect(installations[0].app_token_state).toBe('ok');
  });

  test('Disconnect this org lists the destinations that stop and keeps the install for the other orgs', async () => {
    await slack.settings.goto(orgs.leaving);
    await slack.card.waitLoaded();
    await slack.card.disconnect.click();
    await expect(slack.orgDialog.confirmBody).toContainText('1 alert destination in this org stops posting.');
    await slack.orgDialog.primary.click();
    await expect(slack.orgDialog.resultBody).toBeVisible({ timeout: 15000 });
    await expect(slack.orgDialog.resultBody).toContainText(dest.c);
    await slack.orgDialog.primary.click();
    await expect(slack.settings.setupApp).toBeVisible({ timeout: 15000 });

    const { installations } = await api.listInstallations(apiContext, orgs.main);
    expect(installations[0].other_connected_orgs).toBe(1);
  });

  test('Uninstall lists this org\'s affected destinations and other orgs only as a count', async () => {
    await slack.settings.goto(orgs.main);
    await slack.card.waitLoaded();
    await slack.card.uninstall.click();
    await expect(slack.orgDialog.confirmBody).toContainText('1 other org is connected too.');
    await expect(slack.orgDialog.confirmBody).not.toContainText(orgs.other);
    const uninstallsBefore = (await api.mockRequests(apiContext, 'apps.uninstall')).length;
    await slack.orgDialog.primary.click();

    await expect(slack.orgDialog.resultBody).toBeVisible({ timeout: 30000 });
    await expect(slack.orgDialog.resultBody).toContainText('1 other org also lost Slack.');
    await expect(slack.orgDialog.resultBody).not.toContainText(orgs.other);
    await expect(slack.orgDialog.affectedRows()).toHaveCount(2);
    await expect(slack.orgDialog.affectedRow(dest.a)).toHaveCount(1);
    await expect(slack.orgDialog.affectedRow(dest.b)).toHaveCount(1);
    await expect(slack.orgDialog.resultBody).not.toContainText(dest.c);
    await expect(slack.orgDialog.deleteApp).toBeVisible();

    expect((await api.mockRequests(apiContext, 'apps.uninstall')).length).toBe(uninstallsBefore + 1);
    const other = await api.listInstallations(apiContext, orgs.other);
    expect(other.installations).toHaveLength(0);
  });

  test('bulk Remove deletes the selected destinations from the uninstall result', async () => {
    await slack.orgDialog.affectedRow(dest.a).locator('[data-test="o2-table-select-cell"]').click();
    await slack.orgDialog.removeDestinations.click({ timeout: 5000 });
    await expect(slack.orgDialog.affectedRows()).toHaveCount(1, { timeout: 15000 });
    await expect(slack.orgDialog.affectedRow(dest.b)).toHaveCount(1);
    const left = await api.call(apiContext, 'get', `/api/${orgs.main}/alerts/destinations/${dest.a}`);
    expect(left.status).toBe(404);
  });

  test('Done closes the result and the org is back on the empty state', async () => {
    await slack.orgDialog.primary.click();
    await expect(slack.settings.setupApp).toBeVisible({ timeout: 15000 });
  });
});

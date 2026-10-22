const path = require('path');
const { test, expect } = require('@playwright/test');
const testLogger = require('../utils/test-logger.js');
const { SlackPages, api } = require('../../pages/slackPages/index.js');
const { META_ORG } = require('../../pages/slackPages/slackOrgAccessPage.js');

const AUTH_FILE = path.join(__dirname, '../utils/auth/user.json');
const TEAM = { teamId: `T0PWIW${api.uniq().toUpperCase()}`, teamName: 'Acme PW Instance' };
const CHANNEL = { id: 'C0GENERAL', name: 'general' };

test.describe.configure({ mode: 'serial' });

test.describe('Slack instance workspace', { tag: ['@slack', '@enterprise'] }, () => {
  let apiContext;
  let context;
  let slack;
  let slackOn = false;
  let install;
  const orgs = {};

  test.beforeAll(async ({ browser, playwright }) => {
    apiContext = await playwright.request.newContext();
    const config = await api.orgConfig(apiContext, process.env.ORGNAME || 'default');
    slackOn = config.slack_enabled === true;
    if (!slackOn) return;
    orgs.served = await api.createOrg(apiContext, 'slack_pw_iw_served');
    orgs.third = await api.createOrg(apiContext, 'slack_pw_iw_third');
    // _meta holds one instance workspace per server, so a re-run on the same server starts from none.
    await uninstallAll(META_ORG);
    install = await api.storedInstall(apiContext, META_ORG, TEAM);
    context = await browser.newContext({ storageState: AUTH_FILE, viewport: { width: 1500, height: 1024 } });
    slack = new SlackPages(await context.newPage());
    testLogger.info('Slack instance workspace spec', { orgs, installation: install.id, scope: install.scope });
  });

  test.afterAll(async () => {
    // Later spec files expect their orgs to see no instance workspace.
    if (slackOn) await uninstallAll(META_ORG);
    await context?.close();
    await apiContext?.dispose();
  });

  test.beforeEach(() => {
    test.skip(!slackOn, 'the server runs with Slack off (O2_SLACK_ENABLED is not true)');
  });

  test('_meta Admin picks Selected organizations and adds an org', async () => {
    expect(install.scope, 'row 6 from _meta creates an instance workspace (AC-14.2)').toBe('instance');
    await slack.orgAccess.openOrgAccess();
    await expect(slack.orgAccess.onlyMeta).toContainText(`Only _meta can use ${TEAM.teamName} so far.`);
    await slack.orgAccess.chooseSelected();
    await slack.orgAccess.addOrg(orgs.served.name);
    await expect(slack.orgAccess.tableRow(orgs.third.name)).toHaveCount(0);

    const saved = await slack.orgAccess.save();
    expect(saved.all).toBe(false);
    expect(saved.orgs.map((o) => o.org_id).sort()).toEqual([META_ORG, orgs.served.id].sort());
    await expect(slack.orgAccess.confirm).toHaveCount(0);
    await expect(slack.orgAccess.tableRow(orgs.served.name)).not.toContainText('Not saved', { timeout: 15000 });
    await expect(slack.orgAccess.onlyMeta).toHaveCount(0);

    const view = await apiGet(`/api/${META_ORG}/slack/installations/${encodeURIComponent(install.id)}/org-access`);
    expect(view.orgs.map((o) => o.org_id)).toContain(orgs.served.id);
    expect(view.orgs.map((o) => o.org_id)).not.toContain(orgs.third.id);
  });

  test("that org's Admin sees the managed card and maps a channel", async () => {
    const { installations } = await api.listInstallations(apiContext, orgs.served.id);
    const served = installations.find((i) => i.id === install.id);
    expect(served, 'the served org lists the instance workspace (AC-14.5)').toBeTruthy();
    expect(served.managed).toBe(true);
    expect(served.org_access).toBeUndefined();

    await slack.settings.goto(orgs.served.id);
    await slack.card.waitLoaded();
    await expect(slack.card.name).toHaveText(TEAM.teamName);
    await slack.orgAccess.expectManagedCard(TEAM.teamName);

    const row = await slack.orgAccess.mapChannel(CHANNEL.name);
    expect(row.channel_id).toBe(CHANNEL.id);
    expect(row.set_by_this_org).toBe(true);
    const listed = slack.orgAccess.channelRow(CHANNEL.name);
    await expect(listed).toContainText('This org', { timeout: 15000 });
    await expect(listed.locator(`[data-test="slack-channel-edit-${CHANNEL.id}"]`)).toBeVisible();

    const { defaults } = await apiGet(
      `/api/${orgs.served.id}/slack/installations/${encodeURIComponent(install.id)}/channel-defaults`,
    );
    const stored = defaults.find((d) => d.channel_id === CHANNEL.id);
    expect(stored?.set_by_this_org).toBe(true);
  });

  test('a third org sees the not-included banner', async () => {
    const listing = await api.listInstallations(apiContext, orgs.third.id);
    expect(listing.installations).toHaveLength(0);
    expect(listing.instance?.team_name, 'an unserved org gets `instance` (AC-14.5)').toBe(TEAM.teamName);
    expect((listing.available ?? []).map((a) => a.installation_id)).not.toContain(install.id);

    await slack.settings.goto(orgs.third.id);
    await slack.orgAccess.expectNotIncluded(TEAM.teamName, orgs.third.id);
    await expect(slack.settings.setupApp).toBeVisible();
    await expect(slack.settings.availableInstallation(install.id)).toHaveCount(0);
  });

  async function apiGet(urlPath) {
    const r = await api.call(apiContext, 'get', urlPath);
    expect(r.status, r.text).toBe(200);
    return r.body;
  }

  async function uninstallAll(org) {
    const { installations } = await api.listInstallations(apiContext, org);
    for (const inst of installations) {
      const r = await api.call(apiContext, 'delete', `/api/${org}/slack/installations/${encodeURIComponent(inst.id)}`);
      testLogger.info('removed an earlier _meta installation', { id: inst.id, status: r.status });
    }
  }
});

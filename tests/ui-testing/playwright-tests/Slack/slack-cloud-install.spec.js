// Cloud destination form path (AC-6.1, P part). Local only: needs a --features cloud build, which no PR CI job makes.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { SlackPages, api } = require('../../pages/slackPages/index.js');

const AUTH_FILE = path.join(__dirname, '../utils/auth/user.json');
const TEAM = { teamId: `T0PWCLOUD${api.uniq().toUpperCase()}`, teamName: 'Acme PW Cloud' };

test.describe.configure({ mode: 'serial' });

test.describe('Slack Cloud install from the destination form', { tag: ['@slack', '@cloud'] }, () => {
  let apiContext;
  let context;
  let page;
  let slack;
  let org;
  let ready = false;
  let why = 'set SLACK_CLOUD_BUILD=true and run against a --features cloud build with Slack on';

  test.beforeAll(async ({ browser, playwright }) => {
    if (process.env.SLACK_CLOUD_BUILD !== 'true') return;
    apiContext = await playwright.request.newContext();
    org = process.env.ORGNAME || 'default';
    const config = await api.orgConfig(apiContext, org);
    if (config.build_type !== 'cloud' || config.slack_enabled !== true) {
      why = `server reports build_type=${config.build_type}, slack_enabled=${config.slack_enabled}`;
      return;
    }
    ready = true;
    context = await browser.newContext({ storageState: AUTH_FILE, viewport: { width: 1500, height: 1024 } });
    page = await context.newPage();
    slack = new SlackPages(page);
  });

  test.afterAll(async () => {
    await context?.close();
    await apiContext?.dispose();
  });

  test.beforeEach(() => {
    test.skip(!ready, why);
  });

  test('one popup and Allow fill the form, and Save creates exactly one destination with the channel default set (AC-6.1)', async () => {
    const name = `slack_pw_cloud_${api.uniq()}`;
    await slack.destinationForm.openNew(org);
    await expect(slack.destinationForm.methodOAuth).toBeVisible();

    const unroute = await api.routeSlackAuthorize(context, {
      team_id: TEAM.teamId,
      team_name: TEAM.teamName,
      channel_id: 'C0ALERTS',
      channel: '#alerts',
    });
    try {
      const popupPromise = page.waitForEvent('popup');
      await slack.destinationForm.connect.click();
      await popupPromise;
      await expect(slack.destinationForm.connected).toBeVisible({ timeout: 30000 });
    } finally {
      await unroute();
    }

    await slack.destinationForm.name.fill(name);
    await page.locator('[data-test="add-destination-submit-btn"]').click();
    await expect(page.locator('[data-test="add-destination-submit-btn"]')).toHaveCount(0, { timeout: 30000 });

    const { body } = await api.call(apiContext, 'get', `/api/${org}/alerts/destinations?page_num=0&page_size=1000`);
    const list = Array.isArray(body) ? body : body.list || body.data || [];
    const forTeam = list.filter((d) => JSON.stringify(d).includes(TEAM.teamId));
    expect(forTeam).toHaveLength(1);

    const { installations } = await api.listInstallations(apiContext, org);
    const installation = installations.find((i) => i.team_id === TEAM.teamId);
    expect(installation).toBeTruthy();
    const defaults = await api.call(
      apiContext,
      'get',
      `/api/${org}/slack/installations/${encodeURIComponent(installation.id)}/channel-defaults`,
    );
    expect(defaults.body.defaults.some((d) => d.channel_id === 'C0ALERTS')).toBe(true);
  });
});

// Settings › Slack › AutoObserve on a real enterprise server: an admin edits and saves, a Slack reader and a viewer read only.
const crypto = require('crypto');
const path = require('path');
const { test, expect } = require('@playwright/test');
const testLogger = require('../utils/test-logger.js');
const { SlackPages, api } = require('../../pages/slackPages/index.js');
const { LoginPage } = require('../../pages/generalPages/loginPage.js');

const AUTH_FILE = path.join(__dirname, '../utils/auth/user.json');
const TEAM = { teamId: `T0PWINS${api.uniq().toUpperCase()}`, teamName: 'Acme PW Insights' };
const ZONE = 'Europe/Berlin';
const PASSWORD = `Pw#${crypto.randomBytes(12).toString('base64url')}Aa1`;

const settingsPath = (org) => `/api/${org}/slack/insights-settings`;
const basic = (email, password) => ({
  Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`,
  'Content-Type': 'application/json',
});

test.describe.configure({ mode: 'serial' });

test.describe('Slack AutoObserve settings', { tag: ['@slack', '@enterprise'] }, () => {
  let apiContext;
  let skipReason = null;
  let rbac = false;
  let org;
  let install;
  const users = {
    reader: `insights-reader-${api.uniq()}@example.com`,
    viewer: `insights-viewer-${api.uniq()}@example.com`,
  };

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext();
    const config = await api.orgConfig(apiContext, process.env.ORGNAME || 'default');
    if (config.slack_enabled !== true) {
      skipReason = 'the server runs with Slack off (O2_SLACK_ENABLED is not true)';
      return;
    }
    rbac = config.rbac_enabled === true;
    org = await api.createOrg(apiContext, 'slack_pw_insights');
    ({ installation: install } = await api.storedHttpInstall(apiContext, org.id, TEAM));
    const probe = await api.call(apiContext, 'get', settingsPath(org.id));
    if (probe.status === 404) {
      skipReason = 'the server runs with AutoObserve insights off (O2_SLACK_INSIGHTS_ENABLED is not true)';
      return;
    }
    expect(probe.status, probe.text).toBe(200);
    expect(probe.body.channel).toBeNull();
    for (const [key, role] of [['reader', 'user'], ['viewer', 'viewer']]) {
      await api.ok(apiContext, 'post', `/api/${org.id}/users`, {
        email: users[key], password: PASSWORD, role, first_name: key, last_name: 'pw',
      });
    }
    if (rbac) {
      const role = `slack_reader_${api.uniq()}`;
      await api.ok(apiContext, 'post', `/api/${org.id}/roles`, { role });
      await api.ok(apiContext, 'put', `/api/${org.id}/roles/${role}`, {
        add: [{ object: `slack_integration:_all_${org.id}`, permission: 'AllowList' }],
        remove: [],
        add_users: [users.reader],
        remove_users: [],
      });
    }
    testLogger.info('Slack insights spec', { org: org.id, installation: install.id, rbac });
  });

  test.afterAll(async () => {
    if (org) {
      for (const email of Object.values(users)) {
        await api.call(apiContext, 'delete', `/api/${org.id}/users/${encodeURIComponent(email)}`);
      }
    }
    await apiContext?.dispose();
  });

  test.beforeEach(() => {
    test.skip(!!skipReason, skipReason ?? '');
  });

  test('an admin picks the channel, digest time and trial posts, saves, and the page reloads them', async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_FILE, timezoneId: ZONE, viewport: { width: 1500, height: 1024 } });
    const page = await context.newPage();
    const slack = new SlackPages(page);
    try {
      await slack.settings.goto(org.id);
      await slack.insights.waitLoaded();
      await expect(slack.insights.lock).toHaveCount(0);
      await expect(slack.insights.save).toBeDisabled();
      await expect(slack.insights.status).not.toContainText('Nothing is saved until you save.');

      await slack.insights.pickChannel('alerts');
      await expect(slack.insights.status).toContainText('Nothing is saved until you save.');
      await slack.insights.setTime('07:45');
      await expect(slack.insights.trial).toHaveAttribute('aria-checked', 'false');
      await slack.insights.trial.click();
      await expect(slack.insights.trial).toHaveAttribute('aria-checked', 'true');
      await expect(slack.insights.allow).toHaveAttribute('aria-checked', 'false');

      const put = await slack.insights.saveAndWait();
      expect(put.status(), await put.text()).toBe(200);
      await expect(page.getByText('AutoObserve settings saved').first()).toBeVisible({ timeout: 15000 });
      await expect(slack.insights.saveError).toHaveCount(0);

      const saved = await api.ok(apiContext, 'get', settingsPath(org.id));
      expect(saved).toMatchObject({
        channel: { installation_id: install.id, channel_id: 'C0ALERTS', channel_name: 'alerts' },
        digest_time: '07:45',
        digest_time_zone: ZONE,
        post_trial_findings: true,
        allow_changes_from_slack: false,
        can_edit: true,
      });
      expect(saved.revision).toBeGreaterThan(0);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await slack.insights.waitLoaded();
      await expect(slack.insights.channelTrigger).toContainText('#alerts');
      await expect(slack.insights.time).toHaveValue('07:45');
      await expect(slack.insights.trial).toHaveAttribute('aria-checked', 'true');
      await expect(slack.insights.save).toBeDisabled();
    } finally {
      await context.close();
    }
  });

  test('a stale save is refused with 409 and the saved settings stay', async () => {
    const before = await api.ok(apiContext, 'get', settingsPath(org.id));
    const stale = await api.call(apiContext, 'put', settingsPath(org.id), {
      channel: before.channel,
      digest_time: '10:00',
      digest_time_zone: before.digest_time_zone,
      post_trial_findings: false,
      allow_changes_from_slack: false,
      revision: before.revision - 1,
    });
    expect(stale.status, stale.text).toBe(409);
    const after = await api.ok(apiContext, 'get', settingsPath(org.id));
    expect(after).toMatchObject({ digest_time: '07:45', post_trial_findings: true, revision: before.revision });
  });

  test('a member who may read Slack but not manage it sees the saved settings locked', async ({ browser, playwright }) => {
    test.skip(!rbac, 'needs a server with OpenFGA on to grant read-only Slack access');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1500, height: 1024 } });
    const page = await context.newPage();
    const asReader = await playwright.request.newContext({
      extraHTTPHeaders: basic(users.reader, PASSWORD),
      storageState: { cookies: [], origins: [] },
    });
    try {
      const login = new LoginPage(page);
      await login.openInternalLoginForm();
      await login.fillLoginForm(users.reader, PASSWORD);
      const signedIn = page.waitForResponse((r) => r.url().includes('/auth/login') && r.status() === 200, { timeout: 60000 });
      await login.submitLoginForm();
      await signedIn;

      const slack = new SlackPages(page);
      await slack.settings.goto(org.id);
      await slack.insights.waitLoaded();
      await expect(slack.insights.lock).toContainText("You can't change these settings.");
      await expect(slack.insights.lock).toContainText('Ask an admin of this organization.');
      await expect(slack.insights.channelTrigger).toContainText('#alerts');
      await expect(slack.insights.channelTrigger).toBeDisabled();
      await expect(slack.insights.time).toHaveValue('07:45');
      await expect(slack.insights.time).toBeDisabled();
      await expect(slack.insights.trial).toBeDisabled();
      await expect(slack.insights.allow).toBeDisabled();
      await expect(slack.insights.save).toHaveCount(0);

      const read = await asReader.get(`${api.BASE()}${settingsPath(org.id)}`);
      expect(read.status()).toBe(200);
      const body = await read.json();
      expect(body.can_edit).toBe(false);
      const refused = await asReader.put(`${api.BASE()}${settingsPath(org.id)}`, {
        data: { ...body, post_trial_findings: false, can_edit: undefined },
      });
      expect(refused.status(), await refused.text()).toBe(403);
    } finally {
      await asReader.dispose();
      await context.close();
    }
  });

  test('a viewer without Slack access gets the no-access page and cannot save', async ({ browser, playwright }) => {
    test.skip(!rbac, 'needs a server with OpenFGA on, where a viewer holds no Slack grant');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1500, height: 1024 } });
    const page = await context.newPage();
    const asViewer = await playwright.request.newContext({
      extraHTTPHeaders: basic(users.viewer, PASSWORD),
      storageState: { cookies: [], origins: [] },
    });
    try {
      const login = new LoginPage(page);
      await login.openInternalLoginForm();
      await login.fillLoginForm(users.viewer, PASSWORD);
      const signedIn = page.waitForResponse((r) => r.url().includes('/auth/login') && r.status() === 200, { timeout: 60000 });
      await login.submitLoginForm();
      await signedIn;

      const slack = new SlackPages(page);
      await slack.settings.goto(org.id);
      await expect(slack.settings.noAccess).toBeVisible({ timeout: 30000 });
      await expect(slack.insights.root).toHaveCount(0);

      const current = await api.ok(apiContext, 'get', settingsPath(org.id));
      const refused = await asViewer.put(`${api.BASE()}${settingsPath(org.id)}`, {
        data: { ...current, post_trial_findings: false, can_edit: undefined },
      });
      expect(refused.status(), await refused.text()).toBe(403);
      const after = await api.ok(apiContext, 'get', settingsPath(org.id));
      expect(after.post_trial_findings).toBe(true);
    } finally {
      await asViewer.dispose();
      await context.close();
    }
  });
});

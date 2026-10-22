// Self-hosted Slack set-up wizard (A2) against the enterprise build and the commit-8 Slack mock: AC-7.1, AC-7.3, AC-7.9.
const path = require('path');
const { test, expect } = require('@playwright/test');
const testLogger = require('../utils/test-logger.js');
const { SlackPages, api } = require('../../pages/slackPages/index.js');

const AUTH_FILE = path.join(__dirname, '../utils/auth/user.json');
const TEAM = { teamId: `T0PWINST${api.uniq().toUpperCase()}`, teamName: 'Acme PW Install' };

test.describe.configure({ mode: 'serial' });

test.describe('Slack self-hosted install wizard', { tag: ['@slack', '@enterprise'] }, () => {
  let apiContext;
  let context;
  let page;
  let slack;
  let org;
  let slackOn = false;
  let step0Failures = [];
  let createdAppId = '';

  test.beforeAll(async ({ browser, playwright }) => {
    apiContext = await playwright.request.newContext();
    const config = await api.orgConfig(apiContext, process.env.ORGNAME || 'default');
    slackOn = config.slack_enabled === true;
    if (!slackOn) return;
    org = (await api.createOrg(apiContext, 'slack_pw_install')).id;
    const { checks } = await api.prerequisites(apiContext, org);
    step0Failures = checks.filter((c) => c.status === 'fail').map((c) => c.id);
    context = await browser.newContext({ storageState: AUTH_FILE, viewport: { width: 1500, height: 1024 } });
    page = await context.newPage();
    slack = new SlackPages(page);
    testLogger.info('Slack install spec org', { org, step0Failures });
  });

  test.afterAll(async () => {
    await context?.close();
    await apiContext?.dispose();
  });

  test.beforeEach(() => {
    test.skip(!slackOn, 'the server runs with Slack off (O2_SLACK_ENABLED is not true)');
  });

  test('A1 offers Set up the app, and Step 0 shows a localhost ZO_WEB_URL as a warning that does not block Next', async () => {
    await slack.settings.goto(org);
    await expect(slack.settings.setupApp).toBeVisible({ timeout: 30000 });
    await expect(slack.settings.consent).toBeVisible();
    await slack.settings.setupApp.click();
    await slack.wizard.expectStep(0);
    await slack.wizard.waitForPrerequisites();

    await expect(slack.wizard.prereqResult('ZO_WEB_URL')).toHaveAttribute('data-status', 'warn');
    const statuses = await slack.wizard.prereqStatuses();
    expect(statuses).toContain('warn');
    if (statuses.includes('fail')) {
      await expect(slack.wizard.next).toBeDisabled();
    } else {
      await expect(slack.wizard.next).toBeEnabled();
    }
  });

  test('Step 1 reaches Slack through the configured API base, then Step 2 opens on the main path', async () => {
    test.skip(
      step0Failures.length > 0,
      `Step 0 fails ${step0Failures.join(', ')} on this server (set O2_AGENT_URL and O2_AI_INTERNAL_SECRET for the agent check)`,
    );
    await slack.wizard.next.click();
    await slack.wizard.expectStep(1);
    await slack.wizard.waitForConnectivity();
    const checks = slack.wizard.connectivity.locator('[data-test^="slack-check-"]');
    const statuses = await checks.evaluateAll((items) => items.map((i) => i.getAttribute('data-status')));
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses).not.toContain('fail');
    await expect(slack.wizard.next).toBeEnabled();
    await slack.wizard.next.click();
    await slack.wizard.expectStep(2);
  });

  test('main path asks only for a configuration refresh token; Set up manually asks for client ID and secrets (AC-7.9)', async () => {
    if ((await slack.wizard.root.getAttribute('data-step').catch(() => null)) !== '2') {
      await reachCreateStepThroughStartOver();
    }
    await expect(slack.wizard.configToken).toBeVisible();
    await expect(slack.wizard.clientId).toHaveCount(0);
    await expect(slack.wizard.clientSecret).toHaveCount(0);
    await expect(slack.wizard.signingSecret).toHaveCount(0);
    await expect(slack.wizard.manualAppToken).toHaveCount(0);
    await expect(slack.wizard.page.locator('[data-test="slack-wizard"] input[name*="bot" i]')).toHaveCount(0);

    await slack.wizard.manualToggle.click();
    await expect(slack.wizard.configToken).toHaveCount(0);
    await expect(slack.wizard.clientId).toBeVisible();
    await expect(slack.wizard.clientSecret).toBeVisible();
    await expect(slack.wizard.manualAppToken).toBeVisible();
    await slack.wizard.modeHttp.click();
    await expect(slack.wizard.signingSecret).toBeVisible();
    await expect(slack.wizard.manualAppToken).toHaveCount(0);

    await slack.wizard.modeSocket.click();
    await slack.wizard.manualToggle.click();
    await expect(slack.wizard.configToken).toBeVisible();
    await expect(slack.wizard.clientId).toHaveCount(0);
  });

  test('Create the app redeems the configuration token through the mock and moves to Install (AC-7.3)', async () => {
    const before = (await api.mockRequests(apiContext, 'apps.manifest.create')).length;
    await slack.wizard.createWithConfigToken(`xoxe-1-pw-${api.uniq()}`);
    await slack.wizard.expectStep(3);
    await expect(slack.wizard.allow).toBeVisible();
    await expect(slack.wizard.pending).toHaveCount(0);

    expect((await api.mockRequests(apiContext, 'apps.manifest.create')).length).toBe(before + 1);
    const { installations } = await api.listInstallations(apiContext, org);
    expect(installations).toHaveLength(1);
    expect(installations[0].status).toBe('pending');
    expect(installations[0].has_config_refresh_token).toBe(true);
    createdAppId = installations[0].app_id;
    await expect(slack.wizard.root).toContainText(createdAppId);
  });

  test('a reload of a pending install offers Finish install and Start over', async () => {
    await slack.settings.goto(org);
    await slack.wizard.expectStep(3);
    await expect(slack.wizard.pending).toBeVisible();
    await expect(slack.wizard.pending).toContainText(createdAppId);
    await expect(slack.wizard.allow).toHaveText(/Finish install/);
    await expect(slack.wizard.startOver).toBeVisible();
  });

  test('Start over deletes the unfinished app and returns to Create', async () => {
    await slack.wizard.confirmStartOver();
    await slack.wizard.expectStep(2);
    await expect(slack.wizard.createForm).toBeVisible();
    const apps = await api.mockApps(apiContext);
    expect(apps.map((a) => a.app_id)).not.toContain(createdAppId);
    const { installations } = await api.listInstallations(apiContext, org);
    expect(installations).toHaveLength(0);
  });

  test('Allow in the popup installs the app, then the app token, checks and Finish land on the workspace card', async () => {
    await slack.wizard.createWithConfigToken(`xoxe-1-pw-${api.uniq()}`);
    await slack.wizard.expectStep(3);

    const unroute = await api.routeSlackAuthorize(context, { team_id: TEAM.teamId, team_name: TEAM.teamName });
    try {
      const popupPromise = page.waitForEvent('popup');
      await slack.wizard.allow.click();
      const popup = await popupPromise;
      await popup.waitForEvent('close', { timeout: 30000 }).catch(() => {});
      await expect(slack.wizard.installed).toContainText(TEAM.teamName, { timeout: 30000 });
    } finally {
      await unroute();
    }

    await expect(slack.wizard.next).toBeDisabled();
    const { installations: installed } = await api.listInstallations(apiContext, org);
    await slack.wizard.saveAppToken(api.appToken(installed[0].app_id));
    await expect(slack.wizard.next).toBeEnabled({ timeout: 15000 });
    await slack.wizard.next.click();
    await slack.wizard.expectStep(4);

    await slack.wizard.runChecks.click();
    await expect(slack.wizard.root.locator('[data-test^="slack-check-"]').first()).toBeVisible({ timeout: 30000 });
    await expect(slack.wizard.linkingForm).toBeVisible();
    await slack.wizard.finish.click();

    await slack.card.waitLoaded();
    await expect(slack.card.name).toHaveText(TEAM.teamName);
    const { installations } = await api.listInstallations(apiContext, org);
    expect(installations[0].team_id).toBe(TEAM.teamId);
    expect(installations[0].app_token_state).toBe('ok');
  });

  test('the destination form points self-hosted users at Settings › Slack', async () => {
    await slack.destinationForm.openNew(org);
    await expect(slack.destinationForm.appBanner).toBeVisible();
    await expect(slack.destinationForm.methodOAuth).toHaveCount(0);
    await expect(slack.destinationForm.methodWebhook).toBeVisible();
  });

  async function reachCreateStepThroughStartOver() {
    const created = await api.createPendingInstall(apiContext, org);
    testLogger.info('Step 2 reached through a pending install', { app: created.installation.app_id });
    await slack.settings.goto(org);
    await slack.wizard.expectStep(3);
    await slack.wizard.confirmStartOver();
    await slack.wizard.expectStep(2);
  }
});

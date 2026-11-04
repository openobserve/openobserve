// Copyright 2026 OpenObserve Inc.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { SlackPages, api } = require('../../pages/slackPages/index.js');
const { shoot } = require('../utils/alert-ack-mute-helpers.js');

const AUTH_FILE = path.join(__dirname, '../utils/auth/user.json');
const ROOT = process.env.ZO_ROOT_USER_EMAIL || 'root@example.com';
const TEAM = { teamId: `T0PWAPP${api.uniq().toUpperCase()}`, teamName: 'Acme PW App' };
const CH = {
  alerts: { id: 'C0ALERTS', name: 'alerts' },
  sre: { id: 'C0SREPROD', name: 'sre-prod' },
  oncall: { id: 'C0PAYONCALL', name: 'payments-oncall' },
  shared: { id: 'C0PARTNERS', name: 'partners-alerts' },
};

const channel = ({ id, name }, extra = {}) => ({
  id,
  name,
  is_private: false,
  is_member: true,
  is_shared: false,
  ...extra,
});

const member = (id, name, email) => ({
  id,
  team_id: TEAM.teamId,
  name,
  deleted: false,
  is_bot: false,
  is_app_user: false,
  is_restricted: false,
  is_ultra_restricted: false,
  is_email_confirmed: true,
  profile: { real_name: name, display_name: name, email },
});

test.describe.configure({ mode: 'serial' });

test.describe('Slack app destinations (C4)', { tag: ['@slack', '@alerts'] }, () => {
  let apiContext;
  let context;
  let page;
  let slack;
  let org;
  let install;
  let teamId;
  let ready = false;
  let buildType;
  let emptyOrg;
  let why = 'needs an enterprise build with Slack on and the Slack mock';
  const u = api.uniq();
  const names = {
    created: `slack_pw_app_${u}`,
    w1: `slack_pw_hook_a_${u}`,
    w2: `slack_pw_hook_b_${u}`,
    room: `slack_pw_room_${u}`,
    shared: `slack_pw_shared_${u}`,
    oncall: `slack_pw_oncall_${u}`,
  };

  const webhook = (name, ch) =>
    api.ok(apiContext, 'post', `/api/${org}/alerts/destinations`, {
      name,
      url: `${api.MOCK()}/services/${TEAM.teamId}/B0PW${api.uniq().toUpperCase()}`,
      method: 'post',
      type: 'http',
      headers: {},
      metadata: {
        prebuilt_type: 'slack',
        setup_method: 'oauth',
        slack_team_id: TEAM.teamId,
        slack_team_name: TEAM.teamName,
        slack_channel_id: ch.id,
        credential_channel: `#${ch.name}`,
      },
    });

  const destination = async (name) => {
    const r = await api.call(apiContext, 'get', `/api/${org}/alerts/destinations/${encodeURIComponent(name)}`);
    return r.body;
  };

  const appBody = (name, ch, over = {}) => ({
    name,
    type: 'slack_app',
    installation_id: install.id,
    channel_id: ch.id,
    channel_name: ch.name,
    buttons: true,
    mention: 'default',
    refire_reuse_minutes: 30,
    auto_investigate: 'off',
    shared_channel_confirmed: false,
    oncall_room_confirmed: false,
    template: 'prebuilt_slack',
    ...over,
  });

  const byTest = (id) => page.locator(`[data-test="${id}"]`);
  // Toasts stack, so the newest one is the answer to the last click.
  const toast = (variant) => page.locator(`[data-test-variant="${variant}"] [data-test="o-toast-message"]`).last();

  const openNewForm = async () => {
    await page.goto(`${api.BASE()}/web/alert-destinations?org_identifier=${encodeURIComponent(org)}`, {
      waitUntil: 'domcontentloaded',
    });
    await byTest('alert-destination-list-add-alert-btn').click();
    await page.locator('[data-test="destination-type-card"][data-type="slack_app"]').click();
    await expect(byTest('slack-app-destination-form')).toBeVisible();
    await expect(byTest('slack-app-dest-channel')).toBeVisible({ timeout: 20000 });
  };

  const openEdit = async (name) => {
    await page.goto(`${api.BASE()}/web/alert-destinations?org_identifier=${encodeURIComponent(org)}`, {
      waitUntil: 'domcontentloaded',
    });
    await byTest(`alert-destination-list-${name}-update-destination`).click();
    await expect(byTest('slack-app-dest-channel')).toBeVisible({ timeout: 20000 });
  };

  const pickChannel = async (ch) => {
    await byTest('slack-app-dest-channel-trigger').click();
    const option = page.locator('[data-test="slack-app-dest-channel-option"]', { hasText: `#${ch.name}` }).first();
    await expect(option).toBeVisible({ timeout: 15000 });
    await option.click();
    await expect(byTest('slack-app-dest-channel-trigger')).toContainText(`#${ch.name}`);
  };

  const setName = async (name) => {
    const field = byTest('slack-app-dest-name-field');
    await field.fill('');
    await field.fill(name);
  };

  const tickBox = async (id) => {
    const box = byTest(id);
    const input = box.locator('input[type="checkbox"]');
    if (await input.count()) await input.first().check({ force: true });
    else await box.click();
  };

  const save = () => byTest('slack-app-dest-save').click();

  const listRow = async () => {
    await page.goto(`${api.BASE()}/web/alert-destinations?org_identifier=${encodeURIComponent(org)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(byTest('alert-destinations-list-table')).toBeVisible({ timeout: 30000 });
  };

  test.beforeAll(async ({ browser, playwright }) => {
    test.setTimeout(5 * 60 * 1000);
    apiContext = await playwright.request.newContext();
    const config = await api.orgConfig(apiContext, process.env.ORGNAME || 'default');
    buildType = config.build_type;
    if (config.build_type === 'opensource' || config.slack_enabled !== true) {
      why = `server reports build_type=${config.build_type}, slack_enabled=${config.slack_enabled}`;
      return;
    }
    const health = await apiContext.get(`${api.MOCK()}/_mock/health`).catch(() => null);
    if (!health || !health.ok()) {
      why = `Slack mock not reachable at ${api.MOCK()}`;
      return;
    }
    org = (await api.createOrg(apiContext, 'slack_pw_app')).id;
    await apiContext.post(`${api.MOCK()}/_mock/teams`, {
      data: {
        team_id: TEAM.teamId,
        team_name: TEAM.teamName,
        channels: [
          channel(CH.alerts),
          channel(CH.sre),
          channel(CH.oncall),
          channel(CH.shared, { is_shared: true, is_ext_shared: true }),
        ],
        members: [
          member('U0PWROOT', 'root', ROOT),
          member('U0PWDANA', 'dana', 'dana@acme.test'),
          { ...member('U0BOT', 'o2bot', null), is_bot: true },
        ],
      },
    });
    install = await api.storedInstall(apiContext, org, TEAM);
    await webhook(names.w1, CH.alerts);
    await webhook(names.w2, CH.sre);
    await webhook(names.room, CH.oncall);
    const team = await api.ok(apiContext, 'post', `/api/${org}/oncall/teams`, { name: `pw-payments-${u}`, timezone: 'UTC' });
    teamId = team.id;
    await api.ok(apiContext, 'post', `/api/${org}/oncall/teams/${teamId}/members`, { user_email: ROOT });
    await api.ok(apiContext, 'put', `/api/${org}/oncall/teams/${teamId}/channel`, { destinations: [names.room] });
    ready = true;
    context = await browser.newContext({ storageState: AUTH_FILE, viewport: { width: 1500, height: 1024 } });
    page = await context.newPage();
    slack = new SlackPages(page);
  });

  // The team goes first: while its channel names the room destination, deleting that is refused.
  test.afterAll(async () => {
    await context?.close();
    if (!apiContext) return;
    const left = [];
    const remove = async (path, { missingOk = false } = {}) => {
      const r = await api.call(apiContext, 'delete', path);
      if (r.status >= 300 && !(missingOk && r.status === 404)) left.push(`${path} -> ${r.status}: ${r.text}`);
    };
    if (org) {
      if (teamId) await remove(`/api/${org}/oncall/teams/${teamId}`);
      for (const name of Object.values(names)) {
        // Not every test creates every name, so an absent one is fine.
        await remove(`/api/${org}/alerts/destinations/${encodeURIComponent(name)}`, { missingOk: true });
      }
    }
    // The org delete route is Cloud-only (src/api/http/src/handler/http/router/mod.rs:2126); self-hosted cannot remove an org.
    if (buildType === 'cloud') {
      for (const id of [org, emptyOrg].filter(Boolean)) await remove(`/api/organizations/${id}`);
    }
    await apiContext.dispose();
    expect(left, 'cleanup left resources behind').toEqual([]);
  });

  test.beforeEach(() => {
    test.skip(!ready, why);
  });

  test('create: the Slack app tile, the form defaults, Send test through the mock, and the list row (MK-7, MK-6a)', async () => {
    await openNewForm();
    await expect(byTest('slack-app-dest-workspace-trigger')).toContainText(TEAM.teamName);
    await pickChannel(CH.sre);
    await expect(byTest('slack-app-dest-name-field')).toHaveValue(`slack-${CH.sre.name}`);
    await expect(byTest('slack-app-dest-default-hint')).toContainText(`Sets #${CH.sre.name}'s default org to slack_pw_app`);
    await expect(byTest('slack-app-dest-default-hint')).not.toContainText(org);
    await setName(names.created);
    await shoot(page, 'c4-mk7-form');

    const before = (await api.mockRequests(apiContext, 'chat.postMessage')).length;
    await byTest('slack-app-dest-test').click();
    await expect(byTest('test-result-success')).toBeVisible({ timeout: 30000 });
    expect((await api.mockRequests(apiContext, 'chat.postMessage')).length).toBeGreaterThan(before);
    await shoot(page, 'c4-mk7-form-test-sent');

    await save();
    await expect(toast('success')).toBeVisible({ timeout: 15000 });
    const saved = await destination(names.created);
    expect(saved).toMatchObject({ type: 'slack_app', installation_id: install.id, channel_id: CH.sre.id, buttons: true });
    expect(saved.refire_reuse_minutes).toBe(30);

    await listRow();
    await expect(byTest(`destination-type-badge-slack-app-${names.created}`)).toBeVisible();
    await expect(byTest(`destination-type-two-way-${names.created}`)).toContainText('Two-way');
    await expect(byTest(`destination-type-badge-slack-webhook-${names.w1}`)).toContainText('Slack webhook');
    await expect(page.locator(`[data-test="alert-destinations-list-table"]`)).toContainText(`#${CH.sre.name} · ${TEAM.teamName}`);
    await expect(page.locator('[data-test="alert-destinations-list-table"] th', { hasText: 'Last send' })).toHaveCount(0);
    await shoot(page, 'c4-mk6a-list');
  });

  test('switch a webhook to the Slack app and back: same name, previous_webhook kept, on-call rooms are not switchable', async () => {
    const original = await destination(names.w1);
    await listRow();
    await expect(byTest(`destination-switch-to-app-${names.room}`)).toHaveCount(0);
    await byTest(`destination-switch-to-app-${names.w1}`).click();
    await expect(toast('success')).toContainText(`${names.w1} now posts through the Slack app`, { timeout: 15000, ignoreCase: true });
    await expect(byTest(`destination-switch-back-${names.w1}`)).toBeVisible();
    const switched = await destination(names.w1);
    expect(switched).toMatchObject({ name: names.w1, type: 'slack_app', installation_id: install.id, channel_id: CH.alerts.id });
    expect(switched.previous_webhook.url).toBe(original.url);
    await shoot(page, 'c4-mk6a-list-switched');

    await byTest(`destination-switch-back-${names.w1}`).click();
    await expect(toast('success')).toContainText(`${names.w1} posts through its webhook again`, { timeout: 15000, ignoreCase: true });
    await expect(byTest(`destination-switch-to-app-${names.w1}`)).toBeVisible();
    const back = await destination(names.w1);
    expect(back).toMatchObject({ name: names.w1, type: 'http', url: original.url, method: 'post' });

    const refused = await api.call(apiContext, 'put', `/api/${org}/alerts/destinations/${names.room}`, appBody(names.room, CH.oncall));
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('used_by_oncall');
    expect(refused.body.message).toContain('Slack app destinations cannot receive on-call pages');
  });

  test('refusals: shared channel (MK-7), on-call room (MK-20) with Save left enabled, and the mixed-version copy', async () => {
    await openNewForm();
    await pickChannel(CH.shared);
    await setName(names.shared);
    await expect(byTest('slack-app-dest-channel-tag')).toContainText('Shared');
    await expect(byTest('slack-app-dest-shared')).toContainText(`#${CH.shared.name} is shared with people outside ${TEAM.teamName}.`);
    await expect(byTest('slack-app-dest-save')).toBeEnabled();
    await save();
    await expect(byTest('slack-app-dest-shared')).toHaveAttribute('data-error', 'true');
    expect((await destination(names.shared)).name).toBeUndefined();
    await shoot(page, 'c4-mk7-shared-asked');
    const sharedApi = await api.call(apiContext, 'post', `/api/${org}/alerts/destinations`, appBody(names.shared, CH.shared));
    expect(sharedApi.status).toBe(400);
    expect(sharedApi.body.code).toBe('shared_channel_unconfirmed');
    await tickBox('slack-app-dest-shared-confirm');
    await save();
    await expect(toast('success')).toBeVisible({ timeout: 15000 });
    expect(await destination(names.shared)).toMatchObject({ type: 'slack_app', shared_channel_confirmed: true });

    await openNewForm();
    await pickChannel(CH.oncall);
    await setName(names.oncall);
    await expect(byTest('slack-app-dest-channel-tag')).toContainText('On-call room');
    await expect(byTest('slack-app-dest-oncall-room')).toContainText(
      `On-call pages for team pw-payments-${u} also post to #${CH.oncall.name} through ${names.room}.`,
    );
    await expect(byTest('slack-app-dest-oncall-room')).toContainText('Alerts here post separately.');
    await expect(byTest('slack-app-dest-save')).toBeEnabled();
    await save();
    await expect(byTest('slack-app-dest-oncall-room')).toHaveAttribute('data-error', 'true');
    await shoot(page, 'c4-mk20-asked');
    const oncallApi = await api.call(apiContext, 'post', `/api/${org}/alerts/destinations`, appBody(names.oncall, CH.oncall));
    expect(oncallApi.status).toBe(400);
    expect(oncallApi.body).toMatchObject({ code: 'oncall_room_unconfirmed', team: `pw-payments-${u}`, destination: names.room });
    await tickBox('slack-app-dest-oncall-confirm');
    await expect(byTest('slack-app-dest-oncall-room')).toHaveAttribute('data-error', 'false');
    await shoot(page, 'c4-mk20-ticked');

    const unroute = async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'version_mismatch', message: 'Upgrade every node first: node-b (v0.0.0) not on this release' }),
      });
    };
    await page.route(`**/api/${org}/alerts/destinations`, unroute);
    await save();
    await expect(byTest('slack-app-dest-refusal')).toContainText('Nodes run different versions. Upgrade every node first.');
    await shoot(page, 'c4-version-mismatch');
    await page.unroute(`**/api/${org}/alerts/destinations`, unroute);

    await save();
    await expect(toast('success')).toBeVisible({ timeout: 15000 });
    expect(await destination(names.oncall)).toMatchObject({ type: 'slack_app', oncall_room_confirmed: true });
  });

  test('edit re-checks the on-call room only when the channel changes', async () => {
    await openEdit(names.oncall);
    await expect(byTest('slack-app-dest-name-field')).toHaveValue(names.oncall);
    await expect(byTest('slack-app-dest-oncall-room')).toHaveCount(0);
    await byTest('slack-app-dest-cancel').click();
    await openEdit(names.created);
    await expect(byTest('slack-app-dest-oncall-room')).toHaveCount(0);
    await pickChannel(CH.oncall);
    await expect(byTest('slack-app-dest-oncall-room')).toBeVisible();
    await expect(byTest('slack-app-dest-channel-tag')).toContainText('On-call room');
    await shoot(page, 'c4-mk20-edit-channel-changed');
    await byTest('slack-app-dest-cancel').click();
  });

  test('connect from the form on self-hosted points to Settings; the Cloud popup path is a live check (Z)', async () => {
    test.skip(buildType === 'cloud', 'Cloud connects from the form; the Settings hint is self-hosted only');
    const other = (await api.createOrg(apiContext, 'slack_pw_app_empty')).id;
    emptyOrg = other;
    await page.goto(`${api.BASE()}/web/alert-destinations?org_identifier=${encodeURIComponent(other)}`, {
      waitUntil: 'domcontentloaded',
    });
    await byTest('alert-destination-list-add-alert-btn').click();
    await page.locator('[data-test="destination-type-card"][data-type="slack_app"]').click();
    await expect(byTest('slack-app-dest-self-hosted')).toBeVisible({ timeout: 20000 });
    await expect(byTest('slack-app-dest-connect')).toHaveCount(0);
    await shoot(page, 'c4-form-no-workspace-self-hosted');
    const start = await api.call(apiContext, 'post', `/api/${other}/slack/install/start`, { source: 'destination_form', create_destination: true });
    expect(start.status).toBe(404);
  });

  test('Settings › Slack: switch all, the unlinked on-call list with Remind, and the outbound queue line (MK-6b)', async () => {
    // The leader writes the queue depth every 10 s and the page reads it once, so wait for the first write.
    const depthNow = async () =>
      (await api.listInstallations(apiContext, org)).installations.find((i) => i.id === install.id)?.health?.outbound_depth;
    await expect.poll(depthNow, { timeout: 40000 }).toEqual(expect.any(Number));
    await slack.settings.goto(org);
    const outbound = byTest('slack-workspace-outbound');
    await expect(outbound).toBeVisible({ timeout: 20000 });
    // The line must show the depth the installation reports, not either wording.
    const depth = await depthNow();
    await expect(outbound).toContainText(
      depth === 0 ? 'No alert messages queued' : `Alert messages: ${depth} queued, oldest`,
    );

    const switchAll = byTest('slack-switch-all');
    await expect(switchAll).toBeVisible();
    await expect(byTest('slack-switch-all-names')).toContainText(names.w1);
    await expect(byTest('slack-switch-all-names')).toContainText(names.w2);
    await expect(byTest('slack-switch-all-names')).not.toContainText(names.room);

    const unlinkedApi = await api.ok(apiContext, 'get', `/api/${org}/slack/installations/${install.id}/oncall-unlinked`);
    const me = unlinkedApi.members.find((m) => m.email === ROOT && m.team_id === teamId);
    expect(me).toMatchObject({ team_name: `pw-payments-${u}`, reminded_at: null });
    expect(me).toHaveProperty('next_shift_at');
    const card = byTest('slack-oncall-unlinked');
    await expect(card).toBeVisible();
    await expect(card).toContainText(ROOT);
    await expect(byTest(`slack-oncall-unlinked-reminder-${ROOT}`)).toContainText('Not sent');
    await shoot(page, 'c4-mk6b-settings');

    const dmsBefore = (await api.mockRequests(apiContext, 'chat.postMessage')).length;
    await byTest('slack-oncall-unlinked-remind').click();
    await expect(toast('success')).toBeVisible({ timeout: 20000 });
    await expect(byTest(`slack-oncall-unlinked-reminder-${ROOT}`)).toContainText('DM sent', { timeout: 20000 });
    expect((await api.mockRequests(apiContext, 'chat.postMessage')).length).toBeGreaterThan(dmsBefore);
    const again = await api.ok(apiContext, 'post', `/api/${org}/slack/installations/${install.id}/oncall-unlinked/remind`);
    expect(again).toHaveProperty('sent');
    await shoot(page, 'c4-mk6b-settings-reminded');

    await byTest('slack-switch-all-action').click();
    await expect(toast('success')).toContainText('2 destinations switched', { timeout: 30000 });
    await expect(switchAll).toHaveCount(0);
    for (const name of [names.w1, names.w2]) {
      expect(await destination(name)).toMatchObject({ name, type: 'slack_app', installation_id: install.id });
    }
    expect((await destination(names.room)).type).toBe('http');
    await shoot(page, 'c4-mk6b-settings-switched');
  });
});

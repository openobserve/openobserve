// Starter Packs: what each real role can see and do, and what one user leaves for the next.
// Enterprise only: the catalog route answers 403 on OSS.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const sp = require('../utils/starter-packs-api.js');

test.describe('Starter Packs · permissions', { tag: ['@enterprise', '@starterPacks'] }, () => {
  // Users and the hosts org are shared, and each test leaves no hosts record behind.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(8 * 60_000);

  const tracker = sp.makeTracker();
  const tag = sp.runTag();
  let org;
  let r2Org;
  const users = {};

  const session = async (browser, who) => {
    const s = await sp.newSession(browser, who);
    return { ...s, packs: new PageManager(s.page).starterPacksPage };
  };

  const member = async (request, inOrg, key, role) => {
    users[key] = await sp.createUser(request, inOrg, tracker.users(inOrg, `sp_e2e_pm_${key}_${tag}@example.com`), role);
    return users[key];
  };

  test.beforeAll(async ({ request }) => {
    const probe = await sp.call(request, 'GET', `/api/${process.env.ORGNAME}/starter_packs/catalog`);
    test.skip(probe.status !== 200, 'Starter Packs catalog unavailable (OSS build)');

    org = tracker.org(await sp.createOrg(request, `sp_e2e_pm_${tag}`));
    const hosts = sp.hostRows();
    await sp.ingestMetrics(request, org, hosts);
    for (const name of new Set(hosts.map((r) => r.__name__))) tracker.streams(org, { name, type: 'metrics' });
    await sp.waitForStreams(request, org, 'metrics', ['system_cpu_time', 'system_memory_usage']);

    for (const [key, role] of [['admin', 'admin'], ['editor', 'editor'], ['viewer', 'viewer'], ['user', 'user'], ['alertonly', 'user']]) {
      await member(request, org, key, role);
    }
    const ro = ['AllowList', 'AllowGet'];
    await sp.createRole(request, org, tracker.roles(org, `sp_e2e_pm_alertonly_${tag}`), [
      ['kv', 'AllowAll'], ['stream', ro], ['summary', 'AllowList'], ['savedviews', 'AllowAll'],
      ['destination', ro], ['template', 'AllowList'], ['metadata', 'AllowList'],
      ['alert', 'AllowAll'], ['afolder', 'AllowAll'], ['dashboard', ro], ['dfolder', ro],
    ], [users.alertonly.email]);

    r2Org = tracker.org(await sp.createOrg(request, `sp_e2e_pr_${tag}`));
    await sp.ingestLogs(request, r2Org, 'default', sp.plainLogs());
    tracker.streams(r2Org, { name: 'default', type: 'logs' });
    await sp.ingestMetrics(request, r2Org, [sp.metric('k8s_pod_cpu_usage', 'gauge', { k8s_cluster: 'c1', k8s_pod_name: 'x' }, 1, Date.now() * 1000)]);
    tracker.streams(r2Org, { name: 'k8s_pod_cpu_usage', type: 'metrics' });
    await sp.waitForStreams(request, r2Org, 'metrics', ['k8s_pod_cpu_usage']);
    await member(request, r2Org, 'r2user', 'user');
  });

  test.afterAll(async ({ request }) => {
    for (const o of [org, r2Org].filter(Boolean)) await sp.trackPackObjects(request, tracker, o);
    if (org) {
      for (const d of await sp.listDashboards(request, org)) {
        if (d.title === 'Host Metrics') tracker.dashboards(org, { id: d.id, folder: 'default' });
      }
    }
    await tracker.cleanup(request);
  });

  test('A setup an alerts-only role could not finish stops with its dashboard not made, and an admin can finish it', async ({ browser, request }) => {
    const starter = await session(browser, users.alertonly);
    await starter.packs.openReview(org, 'hosts');
    await starter.packs.submitBtn.click();
    const stopped = await sp.waitForRecord(request, org, 'hosts', 'incomplete', 180_000);
    tracker.fromRecord(org, stopped);
    await starter.context.close();
    const created = stopped.items.filter((i) => i.status === 'created');
    // A gateway error can abort the run before the alerts; the claim still holds for what was made.
    if (!created.some((i) => i.kind === 'alert')) test.info().annotations.push({ type: 'setup-stopped-early', description: JSON.stringify(stopped.items.map((i) => [i.kind, i.status])) });
    expect(created.length).toBeGreaterThan(0);
    const stoppedDash = stopped.items.find((i) => i.kind === 'dashboard');
    expect(stoppedDash, 'dashboard item in the stopped record').toBeTruthy();
    expect(['failed', 'pending']).toContain(stoppedDash.status);

    const admin = await session(browser, users.admin);
    try {
      await admin.packs.openPack(org, 'hosts');
      await expect(admin.packs.retryBtn.or(admin.packs.finishBtn).first()).toBeVisible({ timeout: 60_000 });
      expect(await admin.packs.retry()).toBe('ready');
    } finally {
      await admin.context.close();
    }
    const done = await sp.waitForRecord(request, org, 'hosts');
    tracker.fromRecord(org, done);
    expect(done.installId).toBe(stopped.installId);
    const dash = done.items.find((i) => i.kind === 'dashboard');
    expect(dash?.status).toBe('created');
    expect((await sp.getDashboard(request, org, dash.id, dash.folderId)).status).toBe(200);
    await sp.disposePack(request, org, 'hosts');
  });

  test('Two users setting up at once: the second is told, and one dashboard is made', async ({ browser, request }) => {
    const before = (await sp.listDashboards(request, org)).filter((d) => d.title === 'Host Metrics').length;
    const admin = await session(browser, users.admin);
    const editor = await session(browser, users.editor);
    await admin.packs.openReview(org, 'hosts');
    await editor.packs.openReview(org, 'hosts');

    const editorCreates = [];
    editor.page.on('request', (r) => { if (r.method() === 'POST' && /\/(dashboards|alerts)\b/.test(r.url())) editorCreates.push(r.url()); });
    await admin.packs.submitBtn.click();
    await expect(admin.packs.runningBtn).toBeVisible({ timeout: 30_000 });
    await editor.packs.submitBtn.click();
    await editor.packs.expectDrawerShows('is setting this pack up');
    await admin.packs.waitForOutcome();
    expect(editorCreates).toEqual([]);
    await admin.context.close();
    await editor.context.close();

    const made = (await sp.listDashboards(request, org)).filter((d) => d.title === 'Host Metrics');
    made.forEach((d) => tracker.dashboards(org, { id: d.id, folder: 'default' }));
    expect(made.length - before).toBe(1);
    await expect.poll(async () => (await sp.packRecords(request, org, 'hosts')).length, { timeout: 30_000 }).toBe(1);
    for (const r of await sp.disposePack(request, org, 'hosts')) tracker.fromRecord(org, r);
  });

  test('An install record with a future updatedAt does not lock the pack for an admin', async ({ browser, request }) => {
    const installId = sp.randomUUID();
    const key = tracker.kv(org, sp.recordKey('hosts', installId));
    const now = Date.now() * 1000;
    const record = {
      packId: 'hosts', installId, runId: sp.randomUUID(), status: 'installing', installedBy: users.editor.email, version: '1.1.0',
      installedAt: now, updatedAt: now + 24 * 3600 * 1_000_000,
      items: [{ kind: 'folder', itemId: 'alerts', status: 'pending', attempted: false }],
    };
    expect((await sp.kvPut(request, org, key, record, users.editor)).status).toBe(200);

    const admin = await session(browser, users.admin);
    try {
      await admin.packs.openPack(org, 'hosts');
      await expect(admin.packs.finishBtn).toBeVisible({ timeout: 30_000 });
      expect(await admin.packs.drawerText()).not.toMatch(/setting this pack up/);
    } finally {
      await admin.context.close();
      await sp.kvDelete(request, org, key);
    }
  });

  test('After an admin signs out, the next user in the same browser sees none of their packs or streams', async ({ browser }) => {
    const { context, page, packs } = await session(browser, users.admin);
    await packs.gotoHome(org);
    await packs.openPopup();
    await expect(packs.listStreamChips.first()).toBeVisible({ timeout: 30_000 });
    const adminStreams = (await packs.listStreamChips.allInnerTexts()).map((t) => t.trim().split(/\s+/)[0]).filter(Boolean);
    expect(adminStreams.length).toBeGreaterThan(0);
    const adminKeys = await page.evaluate((email) => Object.keys(localStorage).filter((k) => k.startsWith('o2.starterPacks.') && k.includes(email)), users.admin.email);
    expect(adminKeys.length).toBeGreaterThan(0);

    await packs.closePopup();
    await packs.signOut();
    const left = await page.evaluate((keys) => keys.filter((k) => localStorage.getItem(k) && localStorage.getItem(k) !== '[]'), adminKeys);
    expect(left).toEqual([]);

    await sp.signIn(page, users.user);
    await packs.gotoHome(org);
    // The banner shows only once Home has answered for this user, so the text check never reads a skeleton.
    await expect(packs.homeAskAdminBanner).toBeVisible({ timeout: 60_000 });
    await expect(packs.chip).toBeVisible();
    await packs.openPopup();
    await expect(packs.railRows.first()).toBeVisible({ timeout: 30_000 });
    const visible = await packs.pageText();
    for (const stream of adminStreams) expect(visible, `admin stream ${stream} shown to the next user`).not.toContain(stream);
    await context.close();
  });

  test('A Viewer pressing Set up gets the access notice at once, and nothing is created', async ({ browser, request }) => {
    const viewer = await session(browser, users.viewer);
    const writes = [];
    try {
      await viewer.packs.openReview(org, 'hosts');
      viewer.page.on('response', (r) => {
        if (r.request().method() !== 'GET' && /\/(kv|dashboards|alerts|folders|savedviews)\b/.test(r.url())) writes.push({ method: r.request().method(), url: r.url(), status: r.status() });
      });
      await viewer.packs.submitBtn.click();
      // The claim is the first write, so the refusal does not wait for the planning reads.
      await expect(viewer.packs.accessNotice).toBeVisible({ timeout: 10_000 });
      await expect(viewer.packs.submitBtn).toBeVisible();
      await expect(viewer.packs.runningBtn).toHaveCount(0);
      expect(writes[0]).toMatchObject({ method: 'POST', status: 403 });
      expect(writes[0].url).toMatch(/\/kv\/starter_pack\.hosts\./);
      expect(writes.filter((w) => !/\/kv\//.test(w.url))).toEqual([]);
    } finally {
      await viewer.context.close();
    }
    expect(await sp.packRecords(request, org, 'hosts')).toEqual([]);
  });

  test('A member with no permissions is told on Home that they have no access', async ({ browser }) => {
    const user = await session(browser, users.r2user);
    try {
      await user.packs.gotoHome(r2Org);
      await expect(user.packs.homeAskAdminBanner).toHaveText("You don't have access to starter packs in this org. Ask an admin.", { timeout: 60_000 });
    } finally {
      await user.context.close();
    }
  });

  test('A member with no permissions is not offered packs whose match was refused', async ({ browser }) => {
    const root = await session(browser);
    await root.packs.gotoHome(r2Org);
    await root.packs.waitForChip();
    await expect.poll(() => root.packs.chipNumber(), { timeout: 30_000 }).toBe(1);
    await root.context.close();

    const user = await session(browser, users.r2user);
    try {
      await user.packs.gotoHome(r2Org);
      await user.packs.waitForChip();
      const userCount = await user.packs.chipNumber();
      await user.packs.openPopup();
      const hostsRows = await user.packs.row('hosts').count();
      // useHomePacks.ts saves a 'forbidden' pack among the offered sources the chip counts.
      test.fail(true, 'o2-enterprise#3718 item 2');
      expect({ userCount, hostsRows }).toEqual({ userCount: 1, hostsRows: 0 });
    } finally {
      await user.context.close();
    }
  });
});

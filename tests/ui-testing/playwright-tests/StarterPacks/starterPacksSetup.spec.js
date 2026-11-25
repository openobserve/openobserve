// Starter Packs: setup creates real objects on the server, and the pack's page links to them.
// Enterprise only: the catalog route answers 403 on OSS.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const sp = require('../utils/starter-packs-api.js');

test.describe('Starter Packs · setup', { tag: ['@enterprise', '@starterPacks'] }, () => {
  // One org whose data grows test by test: default-only, then one k8s series, then full data.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(8 * 60_000);

  const tracker = sp.makeTracker();
  let org;

  const ingestTracked = async (request, rows) => {
    await sp.ingestMetrics(request, org, rows);
    for (const name of new Set(rows.map((r) => r.__name__))) tracker.streams(org, { name, type: 'metrics' });
  };

  const setUpAndRecord = async (pm, request, packId) => {
    await pm.starterPacksPage.openReview(org, packId);
    expect(await pm.starterPacksPage.setUpExpectReady(test.info())).toBe('ready');
    await expect(pm.starterPacksPage.undoOrRemove).toHaveCount(0);
    const record = await sp.waitForRecord(request, org, packId);
    tracker.fromRecord(org, record);
    return record;
  };

  test.beforeAll(async ({ request }) => {
    const probe = await sp.call(request, 'GET', `/api/${process.env.ORGNAME}/starter_packs/catalog`);
    test.skip(probe.status !== 200, 'Starter Packs catalog unavailable (OSS build)');
    org = tracker.org(await sp.createOrg(request, `sp_e2e_su_${sp.runTag()}`));
    await sp.ingestLogs(request, org, 'default', sp.plainLogs());
    tracker.streams(org, { name: 'default', type: 'logs' });
    await sp.waitForStreams(request, org, 'logs', ['default']);
  });

  test.afterAll(async ({ request }) => {
    if (!org) return;
    await sp.trackPackObjects(request, tracker, org);
    await tracker.cleanup(request);
  });

  test('Kubernetes is offered only once a k8s stream exists', async ({ browser, request }) => {
    const before = await sp.newSession(browser);
    const pmBefore = new PageManager(before.page);
    await pmBefore.starterPacksPage.gotoHome(org);
    await pmBefore.starterPacksPage.openPopup();
    await expect(pmBefore.starterPacksPage.popup).toContainText(/No packs match|0 packs/i);
    await expect(pmBefore.starterPacksPage.row('kubernetes')).toHaveCount(0);
    await before.context.close();

    await ingestTracked(request, [sp.metric('k8s_pod_cpu_usage', 'gauge', { k8s_cluster: 'c1', k8s_pod_name: 'x' }, 1, Date.now() * 1000)]);
    await sp.waitForStreams(request, org, 'metrics', ['k8s_pod_cpu_usage']);

    // A fresh context, so the five-minute saved check from above is not reused.
    const after = await sp.newSession(browser);
    const pmAfter = new PageManager(after.page);
    await pmAfter.starterPacksPage.gotoHome(org);
    await pmAfter.starterPacksPage.openPopup();
    await expect(pmAfter.starterPacksPage.row('kubernetes')).toBeVisible();
    await after.context.close();
  });

  test('Hosts: setup creates the folder, dashboard and alerts, and the pack page opens each one', async ({ page, request }) => {
    await ingestTracked(request, sp.hostRows());
    await ingestTracked(request, sp.k8sRows());
    await sp.ingestLogs(request, org, 'k8s_events', sp.k8sEvents('k8s_events'));
    tracker.streams(org, { name: 'k8s_events', type: 'logs' });
    await sp.waitForStreams(request, org, 'metrics', ['system_cpu_time', 'kube_pod_status_phase']);
    await sp.waitForStreams(request, org, 'logs', ['k8s_events']);

    const pm = new PageManager(page);
    const packs = pm.starterPacksPage;
    const record = await setUpAndRecord(pm, request, 'hosts');
    const live = await sp.itemStatuses(request, org, record);
    expect(live.map((s) => s.kind)).toEqual(expect.arrayContaining(['folder', 'dashboard', 'alert']));
    expect(live.filter((s) => s.status !== 200)).toEqual([]);

    const dash = record.items.find((i) => i.kind === 'dashboard' && i.status === 'created');
    const alertIds = record.items.filter((i) => i.kind === 'alert' && i.status === 'created').map((i) => i.id);

    await packs.openPack(org, 'hosts');
    await expect(packs.viewDashboardOpen).toBeVisible({ timeout: 60_000 });
    await expect(packs.viewGroupAlert).toBeVisible();
    await expect(packs.viewAlertRows).toHaveCount(Math.min(alertIds.length, 5));
    await expect(packs.undoOrRemove).toHaveCount(0);
    await packs.viewDashboardOpen.click();
    await expect(page).toHaveURL(new RegExp(`/dashboards/view\\?.*dashboard=${dash.id}`), { timeout: 30_000 });
    const { body } = await sp.getDashboard(request, org, dash.id, dash.folderId);
    const title = (body[`v${body.version}`] ?? body).title;
    await packs.expectDashboardTitle(title);

    await packs.openPack(org, 'hosts');
    await packs.viewAlertRows.first().click();
    await expect(page).toHaveURL(/\/alerts\/detail\/[^/?]+/, { timeout: 30_000 });
    const openedAlert = new URL(page.url()).pathname.split('/').pop();
    expect(alertIds).toContain(openedAlert);
  });

  test('Kubernetes: setup creates folders, dashboard, alerts and the saved view, and the pack page opens', async ({ page, request }) => {
    const pm = new PageManager(page);
    const packs = pm.starterPacksPage;
    const record = await setUpAndRecord(pm, request, 'kubernetes');
    const live = await sp.itemStatuses(request, org, record);
    expect(live.map((s) => s.kind)).toEqual(expect.arrayContaining(['folder', 'dashboard', 'alert', 'savedView']));
    expect(live.filter((s) => s.status !== 200)).toEqual([]);

    await expect(packs.readyTitle).toBeVisible();

    await packs.openPack(org, 'kubernetes');
    await expect(packs.viewOrdinaryNote).toBeVisible({ timeout: 60_000 });
    await expect(packs.openDashboardBtn).toBeVisible();
    await expect(packs.undoOrRemove).toHaveCount(0);
  });
});

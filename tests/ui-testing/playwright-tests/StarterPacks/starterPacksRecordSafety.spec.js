// Starter Packs: concurrent setups make one record and one copy of each object, and View Pack trusts the server over the record.
// Enterprise only: the catalog route answers 403 on OSS.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const sp = require('../utils/starter-packs-api.js');

test.describe('Starter Packs · install records', { tag: ['@enterprise', '@starterPacks'] }, () => {
  // One org; each test leaves no pack record behind for the next.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(8 * 60_000);

  const tracker = sp.makeTracker();
  const tag = sp.runTag();
  let org;

  const setUpReady = async (pm, packId) => {
    await pm.starterPacksPage.openReview(org, packId);
    expect(await pm.starterPacksPage.setUpExpectReady(test.info())).toBe('ready');
  };

  const recordOf = async (request, packId) => {
    const record = await sp.waitForRecord(request, org, packId);
    tracker.fromRecord(org, record);
    return record;
  };

  test.beforeAll(async ({ request }) => {
    const probe = await sp.call(request, 'GET', `/api/${process.env.ORGNAME}/starter_packs/catalog`);
    test.skip(probe.status !== 200, 'Starter Packs catalog unavailable (OSS build)');
    org = tracker.org(await sp.createOrg(request, `sp_e2e_us_${tag}`));
    const rows = sp.hostRows();
    await sp.ingestMetrics(request, org, rows);
    for (const name of new Set(rows.map((r) => r.__name__))) tracker.streams(org, { name, type: 'metrics' });
    await sp.waitForStreams(request, org, 'metrics', ['system_cpu_time']);
  });

  test.afterAll(async ({ request }) => {
    if (!org) return;
    await sp.trackPackObjects(request, tracker, org);
    await tracker.cleanup(request);
  });

  test('The same user in two tabs: the second sees "in another tab" and nothing is made twice', async ({ context, page, request }) => {
    const dashBefore = (await sp.listDashboards(request, org)).filter((d) => d.title === 'Host Metrics').length;
    const tabA = new PageManager(page).starterPacksPage;
    const pageB = await context.newPage();
    const tabB = new PageManager(pageB).starterPacksPage;
    await tabA.openReview(org, 'hosts');
    await tabB.openReview(org, 'hosts');

    await tabA.submitBtn.click();
    await expect(tabA.runningBtn).toBeVisible({ timeout: 30_000 });
    await tabB.submitBtn.click();
    await tabB.expectDrawerShows('in another tab');
    await tabA.waitForOutcome();

    const records = await sp.packRecords(request, org, 'hosts');
    records.forEach((r) => tracker.fromRecord(org, r));
    expect(records).toHaveLength(1);
    const made = (await sp.listDashboards(request, org)).filter((d) => d.title === 'Host Metrics');
    made.forEach((d) => tracker.dashboards(org, { id: d.id, folder: 'default' }));
    expect(made.length - dashBefore).toBe(1);
    const tagged = (await sp.listAlerts(request, org)).filter((a) => (a.tags ?? []).includes('pack:hosts'));
    expect(tagged).toHaveLength(records[0].items.filter((i) => i.kind === 'alert' && i.id).length);
    await pageB.close();
    await sp.disposePack(request, org, 'hosts');
  });

  test('View Pack does not list a dashboard that was deleted by hand', async ({ page, request }) => {
    const pm = new PageManager(page);
    const packs = pm.starterPacksPage;
    await setUpReady(pm, 'hosts');
    const record = await recordOf(request, 'hosts');
    const dash = record.items.find((i) => i.kind === 'dashboard');
    expect((await sp.call(request, 'DELETE', `/api/${org}/dashboards/${dash.id}?folder=${dash.folderId}`)).status).toBe(200);
    expect((await sp.getDashboard(request, org, dash.id, dash.folderId)).status).toBe(404);

    await packs.openPack(org, 'hosts');
    await expect(packs.viewGroupTitle.first()).toBeVisible({ timeout: 60_000 });
    await expect(packs.drawer).toContainText('Alerts');
    await expect(packs.viewDashboardGroup).toHaveCount(0);
    await expect(packs.drawer).not.toContainText('Host Metrics');
    await sp.disposePack(request, org, 'hosts');
  });
});

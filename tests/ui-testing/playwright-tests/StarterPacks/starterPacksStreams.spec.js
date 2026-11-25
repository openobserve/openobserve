// Starter Packs: setup adapts to the streams an org really has.
// Enterprise only: the catalog route answers 403 on OSS.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const sp = require('../utils/starter-packs-api.js');

const LIBRARY = 'https://openobserve-datasources-bucket.s3.amazonaws.com/alerts/';
// The Hosts alerts offered in an org with no memory streams.
const HOSTS_ALERTS = [
  'opentelemetry/host_high_cpu_load_otel', 'opentelemetry/host_out_of_disk_space_otel',
  'opentelemetry/host_stopped_reporting', 'opentelemetry/host_disk_may_fill_in_24_hours_otel',
];

test.describe('Starter Packs · streams', { tag: ['@enterprise', '@starterPacks'] }, () => {
  // The hosts-only org is reused, and each test disposes its pack before the next starts.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(8 * 60_000);

  const tracker = sp.makeTracker();
  let colonOrg;
  let hostsOrg;

  const trackIngest = (org, rows) => {
    for (const name of new Set(rows.map((r) => r.__name__))) tracker.streams(org, { name, type: 'metrics' });
  };

  const dispose = async (request, org, packId) => {
    for (const r of await sp.disposePack(request, org, packId)) tracker.fromRecord(org, r);
  };

  test.beforeAll(async ({ request }) => {
    const probe = await sp.call(request, 'GET', `/api/${process.env.ORGNAME}/starter_packs/catalog`);
    test.skip(probe.status !== 200, 'Starter Packs catalog unavailable (OSS build)');
    const tag = sp.runTag();

    colonOrg = tracker.org(await sp.createOrg(request, `sp_e2e_stc_${tag}`));
    const k8s = sp.k8sRows();
    await sp.ingestMetrics(request, colonOrg, k8s);
    trackIngest(colonOrg, k8s);
    for (const stream of ['prod:events', 'stage_events']) {
      await sp.ingestLogs(request, colonOrg, stream, sp.k8sEvents(stream));
      tracker.streams(colonOrg, { name: stream, type: 'logs' });
    }
    await sp.waitForStreams(request, colonOrg, 'logs', ['prod:events', 'stage_events']);
    await sp.waitForStreams(request, colonOrg, 'metrics', ['kube_pod_status_phase']);

    hostsOrg = tracker.org(await sp.createOrg(request, `sp_e2e_sth_${tag}`));
    const hosts = sp.hostRows({ withMemory: false });
    await sp.ingestMetrics(request, hostsOrg, hosts);
    trackIngest(hostsOrg, hosts);
    await sp.waitForStreams(request, hostsOrg, 'metrics', ['system_cpu_time', 'system_filesystem_usage']);
  });

  test.afterAll(async ({ request }) => {
    for (const org of [colonOrg, hostsOrg].filter(Boolean)) await sp.trackPackObjects(request, tracker, org);
    await tracker.cleanup(request);
  });

  test('"Use all" onto a logs stream named with ":" saves an alert copy on that stream', async ({ page, request }) => {
    const pm = new PageManager(page);
    const packs = pm.starterPacksPage;
    await packs.openReview(colonOrg, 'kubernetes');
    await packs.chooseAdapted(/event/i);
    await packs.useAllBtn.click();
    await expect(packs.submitBtn).toBeEnabled({ timeout: 60_000 });
    expect(await packs.setUpExpectReady(test.info())).toBe('ready');

    const record = await sp.waitForRecord(request, colonOrg, 'kubernetes');
    tracker.fromRecord(colonOrg, record);
    const streams = [];
    for (const it of record.items.filter((i) => i.kind === 'alert' && i.id)) {
      const { status, body } = await sp.getAlert(request, colonOrg, it.id);
      expect(status).toBe(200);
      streams.push(body?.stream_name);
    }
    expect(streams).toEqual(expect.arrayContaining(['prod:events', 'stage_events']));
    await dispose(request, colonOrg, 'kubernetes');
  });

  test('Hosts with no memory streams still installs a dashboard with CPU, disk and network panels', async ({ page, request }) => {
    const pm = new PageManager(page);
    await pm.starterPacksPage.openReview(hostsOrg, 'hosts');
    expect(await pm.starterPacksPage.setUpExpectReady(test.info())).toBe('ready');

    const record = await sp.waitForRecord(request, hostsOrg, 'hosts');
    tracker.fromRecord(hostsOrg, record);
    const dash = record.items.find((i) => i.kind === 'dashboard');
    expect(dash?.status).toBe('created');
    const { status, body } = await sp.getDashboard(request, hostsOrg, dash.id, dash.folderId);
    expect(status).toBe(200);
    const doc = body[`v${body.version}`] ?? body;
    const titles = (doc.tabs ?? []).flatMap((t) => t.panels ?? []).map((p) => String(p.title));
    for (const want of [/cpu/i, /disk/i, /network/i]) expect(titles.some((t) => want.test(t)), `${want} panel in ${titles}`).toBe(true);
    await dispose(request, hostsOrg, 'hosts');
  });

  test('A failed folder create shows the error and Retry, and Retry completes', async ({ page, request }) => {
    const pm = new PageManager(page);
    const packs = pm.starterPacksPage;
    let block = true;
    await page.route(/\/api\/v2\/[^/]+\/folders\/alerts/, (route) => (
      block && route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 500, message: 'injected folder failure' }) })
        : route.continue()
    ));
    await packs.openReview(hostsOrg, 'hosts');
    expect(await packs.setUp()).toBe('failed');
    await expect(packs.drawer).toContainText(/not created/);

    block = false;
    expect(await packs.retry()).toBe('ready');
    tracker.fromRecord(hostsOrg, (await sp.packRecords(request, hostsOrg, 'hosts'))[0]);
    const record = await sp.waitForRecord(request, hostsOrg, 'hosts');
    const folder = record.items.find((i) => i.kind === 'folder' && i.itemId === 'alerts');
    expect((await sp.call(request, 'GET', `/api/v2/${hostsOrg}/folders/alerts/${folder.id}`)).status).toBe(200);
    await dispose(request, hostsOrg, 'hosts');
  });

  test('No empty alerts folder is created when every pack alert already exists', async ({ page, request }) => {
    const manifest = await (await request.get(`${LIBRARY}manifest.json`)).json();
    const paths = Object.fromEntries(manifest.alerts.map((e) => [e.id, e.path]));
    for (const libId of HOSTS_ALERTS) {
      const doc = await (await request.get(`${LIBRARY}${paths[libId]}`)).json();
      for (const k of ['id', 'last_triggered_at', 'last_satisfied_at', 'last_edited_by', 'updated_at', 'owner']) delete doc[k];
      Object.assign(doc, { org_id: hostsOrg, enabled: false, destinations: [], tags: ['pack:hosts', `library:${libId}`] });
      const r = await sp.call(request, 'POST', `/api/v2/${hostsOrg}/alerts?folder=default`, doc);
      expect(r.status, `pre-create ${libId}`).toBe(200);
      tracker.alerts(hostsOrg, r.body.id);
    }
    const foldersBefore = (await sp.call(request, 'GET', `/api/v2/${hostsOrg}/folders/alerts`)).body.list.map((f) => f.folderId);

    const pm = new PageManager(page);
    await pm.starterPacksPage.openReview(hostsOrg, 'hosts');
    await expect(pm.starterPacksPage.drawer).toContainText(`${HOSTS_ALERTS.length} items skipped`);
    expect(await pm.starterPacksPage.setUpExpectReady(test.info())).toBe('ready');
    tracker.fromRecord(hostsOrg, await sp.waitForRecord(request, hostsOrg, 'hosts'));
    const foldersAfter = (await sp.call(request, 'GET', `/api/v2/${hostsOrg}/folders/alerts`)).body.list;
    expect(foldersAfter.filter((f) => !foldersBefore.includes(f.folderId))).toEqual([]);
  });
});

// Continuous Profiling time-series card: units, single points, drag-to-range, Breakdown and its legend.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  seedReferenceStream,
  seedProfilesStream,
  manyVersionsResources,
  deleteProfilesStream,
  MINUTE_MS,
} = require('../utils/profiles-ingestion.js');

test.describe('Profiles chart and breakdown', () => {
  test.describe.configure({ mode: 'parallel' });
  let api;
  let ref;
  let many;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    ref = await seedReferenceStream(api, 'chart');
    many = await seedProfilesStream(api, 'chartmany', manyVersionsResources, { service: 'checkout', total: 7_800_000_000 });
  });

  test.afterAll(async () => {
    await deleteProfilesStream(api, ref.stream);
    await deleteProfilesStream(api, many.stream);
    await api.dispose();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await pm.profilesPage.mockServerConfig();
    await pm.profilesPage.hideFlameZoomHint();
    await navigateToBase(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await pm.profilesPage.teardown();
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('CPU chart is drawn in cores', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    const tips = await pm.profilesPage.collectSeriesTooltips();
    testLogger.info('Series tooltips', { tips });
    expect(tips.some((tip) => tip.endsWith('cpu 0.4 cores'))).toBe(true);
    expect(tips.some((tip) => tip.endsWith('cpu 0.785 cores'))).toBe(true);
    expect(tips.some((tip) => tip.endsWith('cpu 0.015 cores'))).toBe(true);
  });

  test('Memory chart uses binary byte units', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { service: 'payments', type: 'inuse_space', unit: 'bytes' });
    const tips = await pm.profilesPage.collectSeriesTooltips();
    testLogger.info('Series tooltips', { tips });
    expect(tips.some((tip) => tip.endsWith('inuse_space 2 MiB'))).toBe(true);
    expect(tips.some((tip) => tip.endsWith('inuse_space 4 MiB'))).toBe(true);
    expect(tips.filter((tip) => / MB$| KB$/.test(tip))).toEqual([]);
  });

  test('A single point is drawn where it sits in the run window', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { service: 'catalog' });
    const tips = await pm.profilesPage.collectSeriesTooltips(40);
    expect(tips.some((tip) => tip.endsWith('cpu 0.5515 cores'))).toBe(true);
    const drawn = await pm.profilesPage.seriesBlueCentre();
    expect(drawn.count).toBeGreaterThan(0);
    expect(drawn.centre).toBeGreaterThan(0.7);
    expect(drawn.centre).toBeLessThan(0.95);
  });

  test('Dragging across the chart picks a minute-rounded range and runs', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.dragAcrossChart(0.3, 0.7);
    await expect.poll(() => calls.merge.length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(calls.series.length).toBeGreaterThan(0);
    await pm.profilesPage.waitForRunIdle();
    await expect.poll(() => pm.profilesPage.currentQuery().from).not.toBe(String(ref.window.from));
    const query = pm.profilesPage.currentQuery();
    const from = Number(query.from);
    const to = Number(query.to);
    expect(query.period).toBeUndefined();
    expect(from % (MINUTE_MS * 1000)).toBe(0);
    expect(to % (MINUTE_MS * 1000)).toBe(0);
    expect(from).toBeGreaterThan(ref.window.from);
    expect(to).toBeLessThan(ref.window.to);
    expect(to).toBeGreaterThan(from);
    expect(calls.merge.at(-1).body.start_time).toBe(from);
    await pm.profilesPage.expectRunPending(false);
  });

  test('Breakdown lists labels but not per-request ids', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    expect(await pm.profilesPage.breakdownOptionLabels()).toEqual([
      'None',
      'deployment_environment',
      'host_name',
      'service_instance_id',
      'service_version',
    ]);
  });

  test('Breakdown draws one line per value and re-fetches only the series', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.pickBreakdown('service_version');
    await pm.profilesPage.expectBreakdownChips(['v1.4.0', 'v1.5.0']);
    expect(calls.series).toHaveLength(1);
    expect(calls.series[0].body.group_by).toBe('service_version');
    expect(calls.series[0].body.group_limit).toBe(10);
    expect(calls.merge).toHaveLength(0);
    await pm.profilesPage.expectUrlParam('breakdown', 'service_version');
  });

  test('A legend chip filters the page to that value', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { extra: { breakdown: 'service_version' } });
    await pm.profilesPage.expectBreakdownChips(['v1.4.0', 'v1.5.0']);
    await pm.profilesPage.clickBreakdownChip('1');
    await pm.profilesPage.expectFilterChip('service_version', 'v1.5.0');
    await pm.profilesPage.expectRunPending(true);
    await pm.profilesPage.clickRun();
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '4 s', selfPercent: '50.00%' });
    await pm.profilesPage.expectUrlParam('filters', 'service_version=v1.5.0');
  });

  test('More than ten values fold into a disabled Others chip', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(many, { extra: { breakdown: 'service_version' } });
    await pm.profilesPage.expectBreakdownChips([
      'v1.3.0',
      'v1.4.0',
      'v1.5.0',
      'v1.6.0',
      'v1.7.0',
      'v1.8.0',
      'v1.9.0',
      'v1.10.0',
      'v1.11.0',
      'v1.12.0',
      'Others',
    ]);
    await pm.profilesPage.expectOthersChipDisabled();
  });

  test('Breakdown is disabled until the first run answers', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    const release = await pm.profilesPage.holdApi('merge');
    await pm.profilesPage.openSeededNoWait({ stream: ref.stream, ...ref.window, service: 'checkout' });
    await pm.profilesPage.expectState('seriesSkeleton');
    await pm.profilesPage.expectBreakdownDisabled();
    release();
    await pm.profilesPage.waitForRunIdle();
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
  });

  test('Breakdown re-charts the last run, not unrun selector changes', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.selectService('payments');
    await pm.profilesPage.expectRunPending(true);
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.pickBreakdown('service_version');
    await pm.profilesPage.expectBreakdownChips(['v1.4.0', 'v1.5.0']);
    expect(calls.series).toHaveLength(1);
    expect(calls.series[0].body.service_name).toBe('checkout');
    expect(calls.series[0].body.group_by).toBe('service_version');
  });

  test('Expand hides the chart and collapse brings it back', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectSeriesCardVisible(true);
    await pm.profilesPage.toggleResultsExpand();
    await pm.profilesPage.expectSeriesCardVisible(false);
    await pm.profilesPage.expectTopRow(0, { name: 'db_query' });
    await pm.profilesPage.toggleResultsExpand();
    await pm.profilesPage.expectSeriesCardVisible(true);
  });

  test('An empty series shows No data while the tables keep their rows', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    await pm.profilesPage.mockApi('series', {
      json: { unit: 'nanoseconds', profile_type: 'cpu', step_secs: 10, series: [], took: 1 },
    });
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectState('noSeries', { title: 'No data' });
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
  });
});

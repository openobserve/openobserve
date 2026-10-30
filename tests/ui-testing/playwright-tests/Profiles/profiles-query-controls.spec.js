// Continuous Profiling header and query controls: run rules, Auto Run, cancel, label filters, date, URL and Share.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { CHECKOUT_FRAMES: F } = require('../../pages/profilesPages/profilesPage.js');
const {
  seedReferenceStream,
  seedProfilesStream,
  noLabelResources,
  deleteProfilesStream,
  MINUTE_MS,
} = require('../utils/profiles-ingestion.js');

test.describe('Profiles query controls', () => {
  test.describe.configure({ mode: 'parallel' });
  let api;
  let ref;
  let bare;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    ref = await seedReferenceStream(api, 'query');
    bare = await seedProfilesStream(api, 'querybare', noLabelResources, { service: 'bare-svc', total: 1_000_000_000 });
  });

  test.afterAll(async () => {
    await deleteProfilesStream(api, ref.stream);
    await deleteProfilesStream(api, bare.stream);
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

  test('A seeded page load runs the query exactly once', { tag: ['@all', '@profiles', '@P0'] }, async () => {
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
    expect(calls.series).toHaveLength(1);
    expect(calls.merge).toHaveLength(1);
    expect(calls.merge[0].body).toMatchObject({
      start_time: ref.window.from,
      end_time: ref.window.to,
      service_name: 'checkout',
      profile_type: 'cpu',
      profile_unit: 'nanoseconds',
      filters: [],
      max_nodes: 4096,
    });
  });

  test('Selectors show the seeded stream, service and type', { tag: ['@all', '@profiles', '@P0'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectSelected(pm.profilesPage.streamSelect, ref.stream);
    await pm.profilesPage.expectSelected(pm.profilesPage.serviceSelect, 'checkout');
    await pm.profilesPage.expectSelected(pm.profilesPage.typeSelect, 'cpu (cores)');
  });

  test('An unseeded open picks the first stream, CPU and Past 15 minutes and writes the URL', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.mockStreamList([ref.stream, bare.stream].sort());
    await pm.profilesPage.gotoProfiles();
    const first = [ref.stream, bare.stream].sort()[0];
    await pm.profilesPage.expectUrlParam('stream', first);
    await pm.profilesPage.expectUrlParam('period', '15m');
    await pm.profilesPage.expectUrlParam('profile_type', 'cpu');
    await pm.profilesPage.expectUrlParam('view', 'top');
    await pm.profilesPage.expectSelected(pm.profilesPage.streamSelect, first);
  });

  test('The type list is scoped to the chosen service', { tag: ['@all', '@profiles', '@P0'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    expect(await pm.profilesPage.selectOptionLabels(pm.profilesPage.typeSelect)).toEqual(['cpu (cores)']);
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.selectService('payments');
    await expect.poll(() => calls.meta.filter((call) => call.url.includes('service_name=payments')).length).toBeGreaterThan(0);
    await expect
      .poll(() => pm.profilesPage.selectOptionLabels(pm.profilesPage.typeSelect), { timeout: 15000 })
      .toEqual(['alloc_space (bytes)', 'cpu (cores)', 'inuse_space (bytes)']);
  });

  test('With Auto Run off a change marks Run as pending without querying', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.selectService('payments');
    await pm.profilesPage.expectRunPending(true);
    expect(calls.series).toHaveLength(0);
    expect(calls.merge).toHaveLength(0);
    expect(pm.profilesPage.currentQuery().service_name).toBe('checkout');
  });

  test('Run clears the pending state and writes the new inputs to the URL', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.selectService('payments');
    await pm.profilesPage.expectRunPending(true);
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.clickRun();
    await pm.profilesPage.expectRunPending(false);
    expect(calls.series).toHaveLength(1);
    expect(calls.merge).toHaveLength(1);
    await pm.profilesPage.expectUrlParam('service_name', 'payments');
    await pm.profilesPage.expectTopRow(0, { name: 'charge_card', self: '2.7 s' });
  });

  test('Run is disabled when the window has no profile type', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.mockApi('meta', {
      json: { data_sources: [], services: ['checkout'], profile_types: [], label_names: [], took: 1 },
    });
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectRunDisabled();
    await pm.profilesPage.hoverRunAndExpectTooltip('Pick a stream and a profile type with data in this time range');
  });

  test('With Auto Run on a change runs at once, and the switch turns it off', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.mockServerConfig({ autoQuery: true });
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.openRunOptions();
    await pm.profilesPage.expectAutoRunToggleText('Turn off Auto Run');
    await pm.profilesPage.pressEscape();
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.selectService('payments');
    await expect.poll(() => calls.merge.filter((call) => call.body.service_name === 'payments').length).toBe(1);
    await pm.profilesPage.waitForRunIdle();
    expect(calls.series.filter((call) => call.body.service_name === 'payments')).toHaveLength(1);
    await pm.profilesPage.expectRunPending(false);
    await pm.profilesPage.expectUrlParam('service_name', 'payments');
    await pm.profilesPage.openRunOptions();
    await pm.profilesPage.clickAutoRunToggle();
    expect(await pm.profilesPage.autoRunStorageValue()).toBe('false');
    await pm.profilesPage.openRunOptions();
    await pm.profilesPage.expectAutoRunToggleText('Turn on Auto Run');
    await pm.profilesPage.pressEscape();
    const offCalls = pm.profilesPage.trackRequests();
    await pm.profilesPage.selectService('checkout');
    await pm.profilesPage.expectRunPending(true);
    expect(offCalls.merge).toHaveLength(0);
  });

  test('Run options are hidden when the server has Auto Run off', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectRunOptionsHidden();
  });

  test('Cancelling the first query shows Search cancelled and its Run query recovers', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    const release = await pm.profilesPage.holdApi('merge');
    await pm.profilesPage.openSeededNoWait({ stream: ref.stream, ...ref.window, service: 'checkout' });
    await pm.profilesPage.clickCancel();
    await pm.profilesPage.expectState('cancelled', { title: 'Search cancelled' });
    await pm.profilesPage.expectRunPending(true);
    release();
    await pm.profilesPage.clickStateAction('cancelled');
    await pm.profilesPage.waitForRunIdle();
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
    await pm.profilesPage.expectStateHidden('cancelled');
  });

  test('Cancelling a re-run keeps the results on screen', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.selectService('payments');
    const release = await pm.profilesPage.holdApi('merge');
    await pm.profilesPage.clickRunNoWait();
    await pm.profilesPage.clickCancel();
    release();
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
    await pm.profilesPage.expectRunPending(true);
    expect(pm.profilesPage.currentQuery().service_name).toBe('checkout');
  });

  test('Picking a filter value applies it and Run narrows the result', { tag: ['@all', '@profiles', '@P0'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.addFilter('service_version', 'v1.5.0');
    await pm.profilesPage.expectFilterChip('service_version', 'v1.5.0');
    await pm.profilesPage.expectRunPending(true);
    await pm.profilesPage.clickRun();
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '4 s', selfPercent: '50.00%' });
    await pm.profilesPage.expectUrlParam('filters', 'service_version=v1.5.0');
  });

  test('A second value of the same label replaces the first', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { filters: 'service_version=v1.5.0' });
    await pm.profilesPage.addFilter('service_version', 'v1.4.0');
    await pm.profilesPage.expectFilterChipCount(1);
    await pm.profilesPage.expectFilterChip('service_version', 'v1.4.0');
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.clickRun();
    expect(calls.merge[0].body.filters).toEqual([{ key: 'service_version', op: '=', value: 'v1.4.0' }]);
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '2 s', selfPercent: '50.00%' });
  });

  test('A second label ANDs and its value list is narrowed by the first', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { filters: 'service_version=v1.4.0' });
    expect(await pm.profilesPage.filterValueOptionLabels('deployment_environment')).toEqual(['prod']);
    await pm.profilesPage.addFilter('deployment_environment', 'prod');
    await pm.profilesPage.expectFilterChipCount(2);
    await pm.profilesPage.clickRun();
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '2 s', selfPercent: '50.00%' });
  });

  test('Editing a chip changes its value', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { filters: 'service_version=v1.4.0,deployment_environment=prod' });
    await pm.profilesPage.editFilter('service_version', 'v1.5.0');
    await pm.profilesPage.expectFilterChip('service_version', 'v1.5.0');
    await pm.profilesPage.clickRun();
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '4 s', selfPercent: '50.96%' });
  });

  test('Removing every chip restores the unfiltered result', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { filters: 'service_version=v1.4.0,deployment_environment=prod' });
    await pm.profilesPage.removeFilter('service_version');
    await pm.profilesPage.removeFilter('deployment_environment');
    await pm.profilesPage.expectFilterChipCount(0);
    await pm.profilesPage.clickRun();
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s', selfPercent: '50.00%' });
    await pm.profilesPage.expectUrlParamAbsent('filters');
  });

  test('The value select stays disabled until a label is picked', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectValueSelectDisabled();
  });

  test('Changing stream clears the filters and the service', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.mockStreamList([ref.stream, bare.stream].sort());
    await pm.profilesPage.gotoRef(ref, { filters: 'service_version=v1.4.0' });
    await pm.profilesPage.expectFilterChipCount(1);
    await pm.profilesPage.selectStream(bare.stream);
    await pm.profilesPage.expectFilterChipCount(0);
    await pm.profilesPage.expectSelected(pm.profilesPage.serviceSelect, 'bare-svc');
    await pm.profilesPage.expectRunPending(true);
  });

  test('Shifting the date reloads meta and marks Run as pending', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.clickDatePrev();
    await expect.poll(() => calls.meta.length).toBeGreaterThan(0);
    await pm.profilesPage.expectRunPending(true);
    expect(calls.merge).toHaveLength(0);
    expect(pm.profilesPage.currentQuery().from).toBe(String(ref.window.from));
  });

  test('An empty window keeps the chosen service', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    const span = ref.window.to - ref.window.from;
    await pm.profilesPage.gotoSeeded({ stream: ref.stream, from: ref.window.from - span, to: ref.window.to - span, service: 'checkout' });
    await pm.profilesPage.expectState('noResults', { title: 'No profiles found' });
    await pm.profilesPage.expectSelected(pm.profilesPage.serviceSelect, 'checkout');
    await pm.profilesPage.clickDateNext();
    await pm.profilesPage.expectRunPending(true);
    await pm.profilesPage.clickRun();
    await pm.profilesPage.expectSelected(pm.profilesPage.serviceSelect, 'checkout');
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
    await pm.profilesPage.expectUrlParam('from', String(ref.window.from));
  });

  test('The URL restores the view, search and filters on reload with one run', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.addFilter('service_version', 'v1.5.0');
    await pm.profilesPage.clickRun();
    await pm.profilesPage.switchView('tree');
    await pm.profilesPage.search('json');
    await pm.profilesPage.expectUrlParam('search', 'json');
    await pm.profilesPage.expectUrlParam('view', 'tree');
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.reload();
    await pm.profilesPage.expectViewActive('tree');
    await pm.profilesPage.expectSearchValue('json');
    await pm.profilesPage.expectFilterChip('service_version', 'v1.5.0');
    await pm.profilesPage.expectSelected(pm.profilesPage.serviceSelect, 'checkout');
    await pm.profilesPage.expectSelected(pm.profilesPage.typeSelect, 'cpu (cores)');
    expect(calls.merge).toHaveLength(1);
    expect(calls.series).toHaveLength(1);
  });

  test('View, search and focus changes replace the URL without adding history', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    const before = await pm.profilesPage.historyLength();
    await pm.profilesPage.switchView('flame');
    await pm.profilesPage.search('json');
    await pm.profilesPage.expectUrlParam('search', 'json');
    await pm.profilesPage.search('');
    await pm.profilesPage.clickFrame(F.db_query, 'db_query');
    await pm.profilesPage.expectUrlParam('focus', F.db_query.path);
    expect(await pm.profilesPage.historyLength()).toBe(before);
  });

  test('Garbage URL seeds fall back without breaking the page', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'bogus' });
    await pm.profilesPage.expectViewActive('top');
    await pm.profilesPage.expectUrlParam('view', 'top');
    await pm.profilesPage.gotoSeeded({ stream: ref.stream, from: ref.window.to, to: ref.window.from, service: 'checkout' });
    await pm.profilesPage.expectUrlParam('period', '15m');
    await pm.profilesPage.expectDateButtonText('Past 15 Minutes');
    await pm.profilesPage.mockStreamList([ref.stream]);
    await pm.profilesPage.gotoSeeded({ stream: 'e2e_prof_nope', ...ref.window, service: 'checkout' });
    await pm.profilesPage.expectSelected(pm.profilesPage.streamSelect, ref.stream);
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
  });

  test('Share is disabled when there is no data', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoSeeded({
      stream: ref.stream,
      from: ref.window.from - 180 * MINUTE_MS * 1000,
      to: ref.window.from - 120 * MINUTE_MS * 1000,
      service: 'checkout',
    });
    await pm.profilesPage.expectState('noResults');
    await pm.profilesPage.expectShareDisabled(true);
  });

  test('Share copies a short link that restores the run with an absolute window', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoSeeded({
      stream: ref.stream,
      period: '15m',
      service: 'checkout',
      view: 'tree',
      filters: 'service_version=v1.5.0',
    });
    await pm.profilesPage.expectShareDisabled(false);
    const link = await pm.profilesPage.clickShareAndReadClipboard();
    expect(link).toMatch(/\/web\/short\/[0-9a-f]+\?org_identifier=/);
    await pm.profilesPage.gotoUrl(link);
    await pm.profilesPage.expectUrlParam('stream', ref.stream);
    await pm.profilesPage.expectUrlParam('service_name', 'checkout');
    await pm.profilesPage.expectUrlParam('filters', 'service_version=v1.5.0');
    await pm.profilesPage.expectUrlParam('view', 'tree');
    const query = pm.profilesPage.currentQuery();
    expect(query.period).toBeUndefined();
    expect(Number(query.to) - Number(query.from)).toBe(15 * MINUTE_MS * 1000);
    await pm.profilesPage.expectFilterChip('service_version', 'v1.5.0');
    await pm.profilesPage.expectViewActive('tree');
  });
});

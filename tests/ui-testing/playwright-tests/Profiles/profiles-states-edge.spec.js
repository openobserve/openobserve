// Continuous Profiling page states (no results, errors, partial, loading), deep stacks, theme, mobile and edge data.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { CHECKOUT_FRAMES: F, CATALOG_FRAMES: C } = require('../../pages/profilesPages/profilesPage.js');
const {
  seedReferenceStream,
  seedProfilesStream,
  zeroValueResources,
  unknownServiceResources,
  deleteProfilesStream,
  MINUTE_MS,
} = require('../utils/profiles-ingestion.js');

test.describe('Profiles states and edges', () => {
  test.describe.configure({ mode: 'parallel' });
  let api;
  let ref;
  let zero;
  let unknown;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    ref = await seedReferenceStream(api, 'states');
    zero = await seedProfilesStream(api, 'stzero', zeroValueResources, { service: 'zero-svc' });
    unknown = await seedProfilesStream(api, 'stunknown', unknownServiceResources, {
      service: 'unknown_service:mybin',
      total: 1_000_000_000,
    });
  });

  test.afterAll(async () => {
    await deleteProfilesStream(api, ref.stream);
    await deleteProfilesStream(api, zero.stream);
    await deleteProfilesStream(api, unknown.stream);
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

  test('An empty window shows No profiles found and disables Share', { tag: ['@all', '@profiles', '@P0'] }, async () => {
    await pm.profilesPage.gotoSeeded({
      stream: ref.stream,
      from: ref.window.from - 180 * MINUTE_MS * 1000,
      to: ref.window.from - 120 * MINUTE_MS * 1000,
      service: 'checkout',
    });
    await pm.profilesPage.expectState('noResults', {
      title: 'No profiles found',
      description: "Your time window doesn't contain any profile data from this stream.",
    });
    await pm.profilesPage.expectShareDisabled(true);
  });

  test('A load error shows Retry and recovers once the bad filter is removed', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.gotoRef(ref, { filters: 'a%3Bb=x' });
    await pm.profilesPage.expectState('error', { description: 'invalid filter key: a;b' });
    const before = calls.merge.length;
    await pm.profilesPage.clickStateAction('error');
    await expect.poll(() => calls.merge.length).toBeGreaterThan(before);
    await pm.profilesPage.waitForRunIdle();
    await pm.profilesPage.expectState('error', { description: 'invalid filter key: a;b' });
    await pm.profilesPage.removeFilter('a;b');
    await pm.profilesPage.clickRun();
    await pm.profilesPage.expectStateHidden('error');
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
  });

  test('A failed re-run keeps the data and shows an error banner with Retry', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.mockApi('merge', { status: 500, json: { code: 500, message: 'x' } });
    await pm.profilesPage.clickRun();
    await pm.profilesPage.expectErrorBannerText('x');
    await pm.profilesPage.expectTopTableVisible();
    await pm.profilesPage.unrouteApi('merge');
    await pm.profilesPage.clickErrorBannerRetry();
    await pm.profilesPage.waitForRunIdle();
    await pm.profilesPage.expectStateHidden('errorBanner');
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
  });

  test('A truncated merge says what share of samples is shown', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.patchApiResponse('merge', () => ({ truncated: true, total: 200, merged_total: 150 }));
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectState('partial', {
      title: 'Showing 75.00% of samples. Less common call stacks are left out of this view.',
    });
  });

  test('Loading shows skeletons in every view', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    const release = await pm.profilesPage.holdApi('merge');
    await pm.profilesPage.openSeededNoWait({ stream: ref.stream, ...ref.window, service: 'checkout', view: 'flame' });
    await pm.profilesPage.expectSkeleton('series');
    await pm.profilesPage.expectSkeleton('flame');
    await pm.profilesPage.switchViewWhileLoading('sandwich');
    await pm.profilesPage.expectSkeleton('sandwich');
    await pm.profilesPage.switchViewWhileLoading('top');
    await pm.profilesPage.expectTopTableLoading();
    release();
    await pm.profilesPage.waitForRunIdle();
    await pm.profilesPage.expectTopRow(0, { name: 'db_query', self: '6 s' });
  });

  test('A 1100-frame stack renders with its truncated root', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    const started = Date.now();
    await pm.profilesPage.gotoRef(ref, { service: 'catalog', view: 'flame' });
    await pm.profilesPage.hoverFrame(C.truncated, '[truncated]');
    expect(Date.now() - started).toBeLessThan(10_000);
    await pm.profilesPage.expectFlameTooltipContains('[truncated]', ['1 s', '18.13%']);
    await pm.profilesPage.switchView('top');
    await pm.profilesPage.expectTopRow(0, { name: 'deep_0000', self: '1 s' });
  });

  test('Rows whose values are all zero show no results', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    await pm.profilesPage.gotoRef(zero, { service: 'zero-svc' });
    await pm.profilesPage.expectState('noResults', { title: 'No profiles found' });
  });

  test('Switching theme recolours a live flame graph', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'flame' });
    await pm.profilesPage.hoverFrame(F.db_query, 'db_query');
    const before = await pm.profilesPage.framePixel(F.db_query);
    await pm.themePage.toggleThemeMode();
    await expect.poll(async () => JSON.stringify(await pm.profilesPage.framePixel(F.db_query))).not.toBe(JSON.stringify(before));
    await pm.profilesPage.expectViewActive('flame');
  });

  test('In dark mode the chart has no background of its own', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.themePage.toggleThemeMode();
    await pm.themePage.waitForDarkModeApplied();
    await expect
      .poll(async () => {
        const { chart, card } = await pm.profilesPage.chartAndCardBackground();
        return Math.max(Math.abs(chart.r - card.r), Math.abs(chart.g - card.g), Math.abs(chart.b - card.b));
      })
      .toBeLessThan(4);
  });

  test('At phone width the views move into a menu and the page does not scroll sideways', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    await pm.profilesPage.setViewport(390, 844);
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.openMobileViewMenu();
    expect(await pm.profilesPage.mobileViewMenuItems()).toEqual([
      'profiles-view-top-item',
      'profiles-view-flame-item',
      'profiles-view-tree-item',
      'profiles-view-sandwich-item',
      'profiles-view-compare-item',
    ]);
    await pm.profilesPage.pressEscape();
    expect(await pm.profilesPage.hasHorizontalPageScroll()).toBe(false);
    await pm.profilesPage.rowMenuAction('top', 0, 'details');
    await pm.profilesPage.expectDetails({ name: 'db_query', self: '6 s · 50.00%' });
    expect(await pm.profilesPage.detailsSitsBelowTable()).toBe(true);
    await pm.profilesPage.pickMobileView('tree');
    await pm.profilesPage.expectUrlParam('view', 'tree');
  });

  test('A profile without service.name is listed as unknown_service', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(unknown, { service: 'unknown_service:mybin' });
    expect(await pm.profilesPage.selectOptionLabels(pm.profilesPage.serviceSelect)).toEqual(['unknown_service:mybin']);
    await pm.profilesPage.expectTopRow(0, { name: 'bin_work', self: '1 s', selfPercent: '100.00%' });
  });
});

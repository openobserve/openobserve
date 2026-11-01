// Continuous Profiling Compare view: diff table, diff flame, side by side, sides and messages.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { CHECKOUT_FRAMES: F, fullWidthFrame } = require('../../pages/profilesPages/profilesPage.js');
const {
  seedReferenceStream,
  seedProfilesStream,
  noLabelResources,
  deleteProfilesStream,
} = require('../utils/profiles-ingestion.js');

test.describe('Profiles compare', () => {
  test.describe.configure({ mode: 'parallel' });
  let api;
  let ref;
  let bare;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    ref = await seedReferenceStream(api, 'compare');
    bare = await seedProfilesStream(api, 'cmpbare', noLabelResources, { service: 'bare-svc', total: 1_000_000_000 });
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

  test('Compare defaults to service_version with the latest two values', { tag: ['@all', '@profiles', '@P0'] }, async () => {
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.gotoRef(ref, { view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.expectCompareSides('service_version', 'v1.4.0', 'v1.5.0');
    expect(calls.diff).toHaveLength(1);
    const body = calls.diff[0].body;
    expect(body.max_nodes).toBe(4096);
    expect(body.baseline.filters).toEqual([{ key: 'service_version', op: '=', value: 'v1.4.0' }]);
    expect(body.comparison.filters).toEqual([{ key: 'service_version', op: '=', value: 'v1.5.0' }]);
    expect(body.baseline.service_name).toBe('checkout');
    expect(body.comparison.profile_type).toBe('cpu');
  });

  test('Diff Table shows each side and the share change in points', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare', extra: { compare_display: 'table' } });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.expectCompareTableRow('json_encode', {
      before: '1 s',
      after: '3 s',
      beforePercent: '25.00%',
      afterPercent: '37.50%',
      change: '+12.50 pt',
    });
    await pm.profilesPage.expectCompareTableRow('process_payment', { before: '0 ns', after: '250 ms', change: '+3.13 pt' });
    await pm.profilesPage.expectCompareTableRow('db_query', { before: '2 s', after: '4 s', change: '0.00 pt' });
    await pm.profilesPage.expectCompareTableRow('handle_order', { before: '4 s', after: '7.85 s', change: '−1.88 pt' });
    await pm.profilesPage.expectCompareTableRow('gc_sweep', { before: '0 ns', after: '150 ms', change: '+1.88 pt' });
  });

  test('Diff Flame Graph tooltip shows both sides and the change', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    const scope = pm.profilesPage.compareFlame;
    await pm.profilesPage.hoverFrame(fullWidthFrame(0), 'v1.5.0: 8 s', { scope });
    await pm.profilesPage.hoverFrame(F.db_query, 'db_query', { scope });
    await pm.profilesPage.expectFlameTooltipContains('db_query', ['v1.4.0', '2 s', 'v1.5.0', '4 s', '50.00%', 'Change', '0.00 pt']);
    await pm.profilesPage.hoverFrame({ depth: 3, left: 50, width: 37.5 }, 'json_encode', { scope });
    await pm.profilesPage.expectFlameTooltipContains('json_encode', ['1 s', '25.00%', '3 s', '37.50%', '+12.50 pt']);
  });

  test('Side by side names each graph by its value and total', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.pickCompareDisplay('sides');
    await pm.profilesPage.hoverFrame(fullWidthFrame(0), 'v1.4.0: 4 s', { scope: pm.profilesPage.compareSideBaseline });
    await pm.profilesPage.hoverFrame(fullWidthFrame(0), 'v1.5.0: 8 s', { scope: pm.profilesPage.compareSideComparison });
    await pm.profilesPage.expectUrlParam('compare_display', 'sides');
  });

  test('Swap exchanges the sides and re-runs the diff', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    const calls = pm.profilesPage.trackRequests();
    await pm.profilesPage.clickCompareSwap();
    await pm.profilesPage.expectCompareSides('service_version', 'v1.5.0', 'v1.4.0');
    expect(calls.diff).toHaveLength(1);
    expect(calls.diff[0].body.baseline.filters).toEqual([{ key: 'service_version', op: '=', value: 'v1.5.0' }]);
    expect(calls.diff[0].body.comparison.filters).toEqual([{ key: 'service_version', op: '=', value: 'v1.4.0' }]);
    await pm.profilesPage.expectUrlParam('compare_a', 'v1.5.0');
    await pm.profilesPage.expectUrlParam('compare_b', 'v1.4.0');
  });

  test('Compare state survives a reload', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.pickCompareDisplay('sides');
    await pm.profilesPage.clickCompareSwap();
    await pm.profilesPage.expectUrlParam('compare_a', 'v1.5.0');
    await pm.profilesPage.reload();
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.expectViewActive('compare');
    await pm.profilesPage.expectCompareSides('service_version', 'v1.5.0', 'v1.4.0');
    await pm.profilesPage.hoverFrame(fullWidthFrame(0), 'v1.5.0: 8 s', { scope: pm.profilesPage.compareSideBaseline });
  });

  test("Each side's list leaves out the other side's value", { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    await expect.poll(() => pm.profilesPage.compareBaselineOptions(), { timeout: 15000 }).toEqual(['v1.4.0']);
  });

  test('Changing the label picks that label\'s defaults', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.pickCompareLabel('deployment_environment');
    await pm.profilesPage.expectCompareSides('deployment_environment', 'prod', 'stage');
  });

  test('A label with one value in range explains why there is no diff', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare', filters: 'service_version=v1.4.0' });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.pickCompareLabel('host_name');
    await pm.profilesPage.expectCompareMessage('This label has fewer than two values in the time range.');
  });

  test('One side with no data says so', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.patchApiResponse('diff', () => ({ comparison_total: 0 }));
    await pm.profilesPage.gotoRef(ref, { view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.expectCompareMessage('One side has no data. Pick other values or a wider time range.');
  });

  test('A filter on the compare label pre-selects that value as B', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare', filters: 'service_version=v1.4.0' });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.expectCompareSides('service_version', 'v1.5.0', 'v1.4.0');
  });

  test('Search filters the Diff Table', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'compare', extra: { compare_display: 'table' } });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.search('json');
    await pm.profilesPage.expectCompareTableRowNames(['json_encode']);
  });

  test('A diff error is shown in place of the graph', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    await pm.profilesPage.mockApi('diff', { status: 400, json: { code: 400, message: 'boom' } });
    await pm.profilesPage.gotoRef(ref, { view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.expectCompareMessage('boom');
  });

  test('A stream with no labels has nothing to compare by', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    await pm.profilesPage.gotoRef(bare, { service: 'bare-svc', view: 'compare' });
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.expectCompareMessage('No label to compare by.');
  });
});

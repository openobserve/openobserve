// Continuous Profiling result views: Top Table, Call Tree, Sandwich, Function details.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { CHECKOUT_FRAMES } = require('../../pages/profilesPages/profilesPage.js');
const { seedReferenceStream, deleteProfilesStream, XSS_FUNCTION } = require('../utils/profiles-ingestion.js');

test.describe('Profiles views', () => {
  test.describe.configure({ mode: 'parallel' });
  let api;
  let ref;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    ref = await seedReferenceStream(api, 'views');
  });

  test.afterAll(async () => {
    await deleteProfilesStream(api, ref.stream);
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

  test('Top Table shows exact self and total per function', { tag: ['@all', '@profiles', '@P0'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectTopRowNames([
      'db_query',
      'json_encode',
      'handle_order',
      'process_payment',
      'gc_sweep',
      XSS_FUNCTION,
      'main',
      'runtime_main',
    ]);
    await pm.profilesPage.expectTopRow(0, { self: '6 s', selfPercent: '50.00%', total: '6 s', totalPercent: '50.00%' });
    await pm.profilesPage.expectTopRow(1, { self: '4 s', selfPercent: '33.33%', total: '4 s' });
    await pm.profilesPage.expectTopRow(2, { self: '1.5 s', selfPercent: '12.50%', total: '11.85 s', totalPercent: '98.75%' });
    await pm.profilesPage.expectTopRow(3, { self: '250 ms', selfPercent: '2.08%' });
    await pm.profilesPage.expectTopRow(4, { self: '150 ms', selfPercent: '1.25%' });
    await pm.profilesPage.expectTopRow(5, { self: '100 ms', selfPercent: '0.83%' });
    await pm.profilesPage.expectTopRow(6, { self: '0 ns', selfPercent: '0.00%', total: '11.85 s', totalPercent: '98.75%' });
    await pm.profilesPage.expectTopRow(7, { self: '0 ns', total: '150 ms', totalPercent: '1.25%' });
  });

  test('Sorting by Total reorders the Top Table both ways', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.sortTopBy('total');
    await pm.profilesPage.expectTopSort('total', 'descending');
    await pm.profilesPage.expectTopRow(2, { name: 'db_query', total: '6 s' });
    await pm.profilesPage.expectTopRow(7, { name: XSS_FUNCTION, total: '100 ms' });
    await pm.profilesPage.expectTopRow(0, { total: '11.85 s' });
    await pm.profilesPage.expectTopRow(1, { total: '11.85 s' });
    await pm.profilesPage.sortTopBy('total');
    await pm.profilesPage.expectTopSort('total', 'ascending');
    await pm.profilesPage.expectTopRow(0, { name: XSS_FUNCTION, total: '100 ms' });
    await pm.profilesPage.expectTopRow(5, { name: 'db_query', total: '6 s' });
  });

  test('Search filters the Top Table, highlights the match and summarises the share', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.search('json');
    await pm.profilesPage.expectTopRowNames(['json_encode']);
    await pm.profilesPage.expectSearchSummary('1 function · 33.33% of samples');
    await pm.profilesPage.expectMarkedText('json');
    await pm.profilesPage.expectUrlParam('search', 'json');
  });

  test('Search with no match says so and empties the table', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.search('zzz');
    await pm.profilesPage.expectSearchSummary('No matches');
    await pm.profilesPage.expectTopRowCount(0);
  });

  test('Row menu Copy puts the function name on the clipboard', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.rowMenuAction('top', 0, 'copy');
    await pm.profilesPage.expectCopiedToast();
    expect(await pm.profilesPage.readClipboard()).toBe('db_query');
  });

  test('Row menu Search fills the search box with the function', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.rowMenuAction('top', 1, 'search');
    await pm.profilesPage.expectSearchValue('json_encode');
    await pm.profilesPage.expectTopRowNames(['json_encode']);
  });

  test('Row menu Show in Flame Graph switches view and highlights the function', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.rowMenuAction('top', 2, 'show');
    await pm.profilesPage.expectViewActive('flame');
    await pm.profilesPage.expectSearchValue('handle_order');
    await pm.profilesPage.expectUrlParam('view', 'flame');
    await pm.profilesPage.expectUrlParam('search', 'handle_order');
  });

  test('Function details shows exact self, total, callers and callees', { tag: ['@all', '@profiles', '@P0'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.rowMenuAction('top', 2, 'details');
    await pm.profilesPage.expectDetails({
      name: 'handle_order',
      self: '1.5 s · 12.50%',
      total: '11.85 s · 98.75%',
      calledBy: ['main'],
      calls: ['db_query', 'json_encode', 'process_payment', XSS_FUNCTION],
      hasPackage: false,
    });
    expect(await pm.profilesPage.detailsListRowCount('calls')).toBe(4);
    expect(await pm.profilesPage.detailsListRowCount('calledBy')).toBe(1);
    await pm.profilesPage.expectUrlParam('details', 'handle_order');
  });

  test('Function details actions copy, open sandwich, show in flame and close', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { extra: { details: 'handle_order' } });
    await pm.profilesPage.expectDetails({ name: 'handle_order', self: '1.5 s · 12.50%' });
    await pm.profilesPage.clickDetails('copy');
    await pm.profilesPage.expectCopiedToast();
    expect(await pm.profilesPage.readClipboard()).toBe('handle_order');
    await pm.profilesPage.clickDetails('sandwich');
    await pm.profilesPage.expectViewActive('sandwich');
    await pm.profilesPage.expectSandwichFunction('handle_order');
    await pm.profilesPage.clickDetails('show');
    await pm.profilesPage.expectViewActive('flame');
    await pm.profilesPage.expectSearchValue('handle_order');
    await pm.profilesPage.clickDetails('close');
    await pm.profilesPage.expectDetailsHidden();
    await pm.profilesPage.expectUrlParamAbsent('details');
  });

  test('Function details is hidden in Compare', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { extra: { details: 'db_query' } });
    await pm.profilesPage.expectDetails({ name: 'db_query', self: '6 s · 50.00%' });
    await pm.profilesPage.switchView('compare');
    await pm.profilesPage.waitForCompareIdle();
    await pm.profilesPage.expectDetailsHidden();
  });

  test('Call Tree shows child and node counts and expands and collapses', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'tree' });
    await pm.profilesPage.expectTreeRow(0, { name: 'total', counts: '2 children · 8 nodes', total: '12 s' });
    await pm.profilesPage.expectTreeRow(1, { name: 'main', counts: '1 child · 5 nodes', total: '11.85 s' });
    await pm.profilesPage.expectTreeRow(2, { name: 'runtime_main', counts: '1 child · 1 node', total: '150 ms' });
    await pm.profilesPage.expectTreeRowCount(3);
    await pm.profilesPage.toggleTreeRow(1);
    await pm.profilesPage.expectTreeRow(2, { name: 'handle_order', counts: '4 children · 4 nodes', self: '1.5 s' });
    await pm.profilesPage.toggleTreeRow(2);
    await pm.profilesPage.expectTreeRow(3, { name: 'db_query', counts: null, self: '6 s' });
    await pm.profilesPage.expectTreeRowCount(8);
    await pm.profilesPage.toggleTreeRow(1);
    await pm.profilesPage.expectTreeRowExpanded(1, false);
    await pm.profilesPage.expectTreeRowCount(3);
  });

  test('Call Tree Focus in Flame Graph focuses that exact frame', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'tree' });
    await pm.profilesPage.toggleTreeRow(1);
    await pm.profilesPage.toggleTreeRow(2);
    await pm.profilesPage.expectTreeRow(3, { name: 'db_query' });
    await pm.profilesPage.rowMenuAction('tree', 3, 'show');
    await pm.profilesPage.expectViewActive('flame');
    await pm.profilesPage.expectUrlParam('focus', CHECKOUT_FRAMES.db_query.path);
  });

  test('Sandwich defaults to the top self function and follows the picked one', { tag: ['@all', '@profiles', '@P1'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { view: 'sandwich' });
    await pm.profilesPage.expectSandwichFunction('db_query');
    await pm.profilesPage.expectRootAtBottom(true);
    await pm.profilesPage.pickSandwichFunction('handle_order');
    await pm.profilesPage.expectUrlParam('fn', 'handle_order');
    await pm.profilesPage.expectSandwichCoverage(false);
  });

  test('Sandwich notes partial coverage when the call tree is cut', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    await pm.profilesPage.forceMergeMaxNodes(50);
    await pm.profilesPage.gotoRef(ref, { service: 'catalog', view: 'sandwich' });
    await pm.profilesPage.expectSandwichFunction('deep_0000');
    await pm.profilesPage.expectSandwichCoverageText("The call tree holds 0.00% of this function's samples");
  });

  test('A script-like function name renders as text everywhere', { tag: ['@all', '@profiles', '@P0'] }, async () => {
    await pm.profilesPage.gotoRef(ref);
    await pm.profilesPage.expectTopRow(5, { name: XSS_FUNCTION });
    await pm.profilesPage.search('onerror');
    await pm.profilesPage.expectTopRowNames([XSS_FUNCTION]);
    await pm.profilesPage.expectMarkedText('onerror');
    await pm.profilesPage.rowMenuAction('top', 0, 'details');
    await pm.profilesPage.expectDetails({ name: XSS_FUNCTION, calledBy: ['handle_order'] });
    await pm.profilesPage.search('');
    await pm.profilesPage.switchView('flame');
    await pm.profilesPage.hoverFrame({ depth: 3, left: 85.417, width: 0.833 }, XSS_FUNCTION);
    await pm.profilesPage.switchView('tree');
    await pm.profilesPage.toggleTreeRow(1);
    await pm.profilesPage.toggleTreeRow(2);
    await pm.profilesPage.expectTreeRow(6, { name: XSS_FUNCTION });
    expect(await pm.profilesPage.isXssExecuted()).toBe(false);
  });

  test('Stale details and sandwich function seeds fall back safely', { tag: ['@all', '@profiles', '@P3'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { extra: { details: 'no_such_fn' } });
    await pm.profilesPage.expectTopRow(0, { name: 'db_query' });
    await pm.profilesPage.expectDetailsHidden();
    await pm.profilesPage.gotoRef(ref, { view: 'sandwich', extra: { fn: 'no_such_fn' } });
    await pm.profilesPage.expectSandwichFunction('db_query');
  });

  test('Memory profiles use binary byte units', { tag: ['@all', '@profiles', '@P2'] }, async () => {
    await pm.profilesPage.gotoRef(ref, { service: 'payments', type: 'alloc_space', unit: 'bytes' });
    await pm.profilesPage.expectTopRow(0, { name: 'alloc_buffer', self: '1 MiB', selfPercent: '66.67%' });
    await pm.profilesPage.expectTopRow(1, { name: 'alloc_json', self: '512 KiB', selfPercent: '33.33%' });
    await pm.profilesPage.switchView('flame');
    await pm.profilesPage.expectFlameRootSummary('Total: 1.5 MiB (bytes)');
  });
});

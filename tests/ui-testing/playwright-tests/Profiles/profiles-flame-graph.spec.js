// Continuous Profiling flame graph: zoom, frame menu, hint, layout options, grouped frames.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { CHECKOUT_FRAMES: F, CATALOG_FRAMES: C, fullWidthFrame: FULL_WIDTH } = require('../../pages/profilesPages/profilesPage.js');
const { seedReferenceStream, deleteProfilesStream } = require('../utils/profiles-ingestion.js');

test.describe('Profiles flame graph', () => {
  test.describe.configure({ mode: 'parallel' });
  let api;
  let ref;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    api = await playwright.request.newContext();
    ref = await seedReferenceStream(api, 'flame');
  });

  test.afterAll(async () => {
    await deleteProfilesStream(api, ref.stream);
    await api.dispose();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await pm.profilesPage.mockServerConfig();
    await navigateToBase(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await pm.profilesPage.teardown();
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test.describe('frames', () => {
    test.beforeEach(async () => {
      await pm.profilesPage.hideFlameZoomHint();
    });

    test('Flame graph renders with the root total', { tag: ['@all', '@profiles', '@P0'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.expectFlameViewOptions();
      await pm.profilesPage.expectFlameRootSummary('Total: 12 s (CPU duration)');
      await pm.profilesPage.hoverFrame(F.db_query, 'db_query');
      await pm.profilesPage.expectFlameTooltipContains('db_query', ['6 s', '50.00%', 'Share of caller', '50.63%']);
    });

    test('Left-click zooms into a frame and writes focus to the URL without history', { tag: ['@all', '@profiles', '@P1'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      const before = await pm.profilesPage.historyLength();
      await pm.profilesPage.clickFrame(F.db_query, 'db_query');
      await pm.profilesPage.expectUrlParam('focus', F.db_query.path);
      expect(await pm.profilesPage.historyLength()).toBe(before);
      await pm.profilesPage.hoverFrame(FULL_WIDTH(3), 'db_query');
    });

    test('Clicking a dimmed caller zooms out to it and the root resets', { tag: ['@all', '@profiles', '@P1'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.clickFrame(F.db_query, 'db_query');
      await pm.profilesPage.expectUrlParam('focus', F.db_query.path);
      await pm.profilesPage.clickFrame(FULL_WIDTH(2), 'handle_order');
      await pm.profilesPage.expectUrlParam('focus', F.handle_order.path);
      await pm.profilesPage.clickFrame(FULL_WIDTH(0), 'Click to zoom out');
      await pm.profilesPage.expectUrlParamAbsent('focus');
      await pm.profilesPage.hoverFrame(F.json_encode, 'json_encode');
    });

    test('A re-run clears a stale flame focus', { tag: ['@all', '@profiles', '@P0'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.clickFrame(F.handle_order, 'handle_order');
      await pm.profilesPage.expectUrlParam('focus', F.handle_order.path);
      await pm.profilesPage.addFilter('deployment_environment', 'stage');
      await pm.profilesPage.clickRun();
      await pm.profilesPage.expectUrlParam('filters', 'deployment_environment=stage');
      await pm.profilesPage.expectUrlParamAbsent('focus');
      await pm.profilesPage.expectFlameRootSummary('Total: 150 ms (CPU duration)');
      await pm.profilesPage.hoverFrame({ depth: 1, left: 0, width: 100 }, 'runtime_main');
      await pm.profilesPage.hoverFrame({ depth: 2, left: 0, width: 100 }, 'gc_sweep');
      await pm.profilesPage.hoverFrame(FULL_WIDTH(0), 'Total: 150 ms');
      await pm.profilesPage.expectFlameTooltipLacks('Total: 150 ms', 'Click to zoom out');
    });

    test('A focus seeded in the URL survives the first run', { tag: ['@all', '@profiles', '@P1'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame', extra: { focus: F.handle_order.path } });
      await pm.profilesPage.expectUrlParam('focus', F.handle_order.path);
      await pm.profilesPage.hoverFrame(FULL_WIDTH(2), 'handle_order');
      await pm.profilesPage.hoverFrame(FULL_WIDTH(0), 'Click to zoom out');
      await pm.profilesPage.hoverFrame({ depth: 3, left: 0, width: 50.633 }, 'db_query');
    });

    test('Right-click opens the frame menu with the frame actions', { tag: ['@all', '@profiles', '@P1'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.rightClickFrame(F.json_encode, 'json_encode');
      await pm.profilesPage.expectFlameMenu(
        ['copy-name', 'zoom-in', 'search-function', 'sandwich', 'details'],
        ['zoom-reset', 'zoom-out', 'zoom-out-here'],
      );
    });

    test('Frame menu on the zoomed frame and on a caller offers zoom out', { tag: ['@all', '@profiles', '@P2'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.clickFrame(F.db_query, 'db_query');
      await pm.profilesPage.expectUrlParam('focus', F.db_query.path);
      await pm.profilesPage.rightClickFrame(FULL_WIDTH(3), 'db_query');
      await pm.profilesPage.expectFlameMenu(['zoom-out', 'zoom-reset'], ['zoom-in', 'zoom-out-here']);
      await pm.profilesPage.pressEscape();
      await pm.profilesPage.expectFlameMenuHidden();
      await pm.profilesPage.rightClickFrame(FULL_WIDTH(2), 'handle_order');
      await pm.profilesPage.expectFlameMenu(['zoom-out-here', 'zoom-reset'], ['zoom-in', 'zoom-out']);
      await pm.profilesPage.clickFlameMenuItem('zoom-out-here');
      await pm.profilesPage.expectUrlParam('focus', F.handle_order.path);
      await pm.profilesPage.rightClickFrame(FULL_WIDTH(2), 'handle_order');
      await pm.profilesPage.clickFlameMenuItem('zoom-reset');
      await pm.profilesPage.expectUrlParamAbsent('focus');
    });

    test('Frame menu actions copy, highlight, open details and open sandwich', { tag: ['@all', '@profiles', '@P1'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.rightClickFrame(F.json_encode, 'json_encode');
      await pm.profilesPage.clickFlameMenuItem('copy-name');
      await pm.profilesPage.expectCopiedToast();
      expect(await pm.profilesPage.readClipboard()).toBe('json_encode');
      await pm.profilesPage.rightClickFrame(F.json_encode, 'json_encode');
      await pm.profilesPage.clickFlameMenuItem('search-function');
      await pm.profilesPage.expectSearchValue('json_encode');
      await pm.profilesPage.expectUrlParam('search', 'json_encode');
      await pm.profilesPage.rightClickFrame(F.json_encode, 'json_encode');
      await pm.profilesPage.clickFlameMenuItem('details');
      await pm.profilesPage.expectDetails({ name: 'json_encode', self: '4 s · 33.33%', total: '4 s · 33.33%' });
      await pm.profilesPage.rightClickFrame(F.db_query, 'db_query');
      await pm.profilesPage.clickFlameMenuItem('sandwich');
      await pm.profilesPage.expectViewActive('sandwich');
      await pm.profilesPage.expectSandwichFunction('db_query');
      await pm.profilesPage.expectUrlParam('fn', 'db_query');
    });

    test('The ⋮ button on a hovered frame opens its menu and Escape closes it', { tag: ['@all', '@profiles', '@P2'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.hoverFrame(F.db_query, 'db_query');
      await pm.profilesPage.expectFrameMoreVisible();
      await pm.profilesPage.clickFrameMore();
      await pm.profilesPage.expectFlameMenu(['copy-name', 'zoom-in']);
      await pm.profilesPage.pressEscape();
      await pm.profilesPage.expectFlameMenuHidden();
    });

    test('Ctrl + wheel zooms the view and a drag pans it', { tag: ['@all', '@profiles', '@P2'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.expectFlameGrabCursor(false);
      const initial = await pm.profilesPage.flameCanvasPng();
      const point = await pm.profilesPage.ctrlWheelOnFrame(F.db_query, 'db_query', -600);
      await pm.profilesPage.expectFlameGrabCursor(true);
      const zoomed = await pm.profilesPage.flameCanvasPng();
      expect(zoomed.equals(initial)).toBe(false);
      await pm.profilesPage.dragOnFlame(point, 200);
      const panned = await pm.profilesPage.flameCanvasPng();
      expect(panned.equals(zoomed)).toBe(false);
      await pm.profilesPage.expectNotZoomedVia(FULL_WIDTH(0), 'Total: 12 s');
      await pm.profilesPage.expectUrlParamAbsent('focus');
    });

    test('Root at bottom flips the drawing and label alignment switches', { tag: ['@all', '@profiles', '@P2'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.expectRootAtBottom(false);
      await pm.profilesPage.expectAlignActive('left');
      await pm.profilesPage.toggleRootAtBottom();
      await pm.profilesPage.expectRootAtBottom(true);
      await pm.profilesPage.hoverFrame(FULL_WIDTH(0), 'Total: 12 s', { rootAtBottom: true, maxDepth: 3 });
      await pm.profilesPage.hoverFrame(F.db_query, 'db_query', { rootAtBottom: true, maxDepth: 3 });
      await pm.profilesPage.clickAlign('right');
      await pm.profilesPage.expectAlignActive('right');
    });

    test('Grouped frames ignore clicks and have no menu', { tag: ['@all', '@profiles', '@P2'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { service: 'catalog', view: 'flame' });
      await pm.profilesPage.expectFlameRootSummary('Total: 5.52 s (CPU duration)');
      await pm.profilesPage.hoverFrame(C.truncated, '[truncated]');
      await pm.profilesPage.expectFlameTooltipContains('[truncated]', ['Callers beyond 1000 frames, cut from this stack.']);
      await pm.profilesPage.clickFrame(C.truncated, '[truncated]');
      await pm.profilesPage.expectNotZoomedVia(C.catalog_main, 'catalog_main');
      await pm.profilesPage.rightClickFrame(C.truncated, '[truncated]');
      await pm.profilesPage.expectNoFrameMenuVia(C.catalog_main, 'catalog_main');
      await pm.profilesPage.hoverFrame(C.smallFrames, '55 small frames');
      await pm.profilesPage.expectFlameTooltipContains('55 small frames', ['Too thin to draw one by one.']);
      await pm.profilesPage.clickFrame(C.smallFrames, '55 small frames');
      await pm.profilesPage.expectNotZoomedVia(C.catalog_main, 'catalog_main');
      await pm.profilesPage.expectUrlParamAbsent('focus');
      await pm.profilesPage.hoverFrame(FULL_WIDTH(0), 'Total: 5.52 s');
      await pm.profilesPage.expectFlameTooltipLacks('Total: 5.52 s', 'Click to zoom out');
    });

    test('Flame graph resizes with the Function details panel', { tag: ['@all', '@profiles', '@P2'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      const wide = await pm.profilesPage.flamePlotWidth();
      await expect.poll(() => pm.profilesPage.flameCanvasWidth()).toBeGreaterThan(wide - 4);
      await pm.profilesPage.rightClickFrame(F.db_query, 'db_query');
      await pm.profilesPage.clickFlameMenuItem('details');
      await pm.profilesPage.expectDetails({ name: 'db_query' });
      await expect.poll(() => pm.profilesPage.flamePlotWidth()).toBeLessThan(wide - 200);
      const narrow = await pm.profilesPage.flamePlotWidth();
      await expect.poll(() => pm.profilesPage.flameCanvasWidth()).toBeLessThan(narrow + 4);
      await pm.profilesPage.clickDetails('close');
      await expect.poll(() => pm.profilesPage.flamePlotWidth()).toBeGreaterThan(wide - 4);
      await expect.poll(() => pm.profilesPage.flameCanvasWidth()).toBeGreaterThan(wide - 4);
      await pm.profilesPage.hoverFrame(F.json_encode, 'json_encode');
    });

    test('Search highlights only the matching frame', { tag: ['@all', '@profiles', '@P2'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.hoverFrame(F.runtime_main, 'runtime_main');
      const jsonPlain = await pm.profilesPage.frameLabelPng(F.json_encode);
      const dbPlain = await pm.profilesPage.frameLabelPng(F.db_query);
      await pm.profilesPage.search('json');
      await pm.profilesPage.expectSearchSummary('1 function · 33.33% of samples');
      await expect.poll(async () => (await pm.profilesPage.frameLabelPng(F.json_encode)).equals(jsonPlain)).toBe(false);
      expect((await pm.profilesPage.frameLabelPng(F.db_query)).equals(dbPlain)).toBe(true);
    });
  });

  test.describe('zoom hint', () => {
    test("Don't show again hides the hint for good", { tag: ['@all', '@profiles', '@P2'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.expectZoomHint(true);
      await pm.profilesPage.expectZoomHintText(/Use (⌘|Ctrl) \+ scroll to zoom/);
      await pm.profilesPage.clickZoomHint('never');
      await pm.profilesPage.expectZoomHint(false);
      expect(await pm.profilesPage.zoomHintStorageValue()).toBe('1');
      await pm.profilesPage.reload();
      await pm.profilesPage.hoverFrame(F.db_query, 'db_query');
      await pm.profilesPage.expectZoomHint(false);
    });

    test('Closing the hint hides it for this graph only', { tag: ['@all', '@profiles', '@P3'] }, async () => {
      await pm.profilesPage.gotoRef(ref, { view: 'flame' });
      await pm.profilesPage.expectZoomHint(true);
      await pm.profilesPage.clickZoomHint('close');
      await pm.profilesPage.expectZoomHint(false);
      expect(await pm.profilesPage.zoomHintStorageValue()).toBeNull();
      await pm.profilesPage.reload();
      await pm.profilesPage.expectZoomHint(true);
    });
  });
});

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const USER_STREAM = 'e2e_internal_user';
// The server flags these names as internal; it refuses user writes to the `_o2_` ones, so a fixed name is used.
const INTERNAL_STREAMS = ['_rumdata', '_rumlog'];
const HIDE_LABEL = 'Hide internal streams';
const SHOW_LABEL = 'Show internal streams';

test.describe("Logs stream picker internal streams", () => {
  // Serial: the seeded streams are shared, and a parallel worker's afterAll would delete them mid-run.
  test.describe.configure({ mode: 'serial' });
  let pm;
  let createdStreams = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const setupPm = new PageManager(page);
    const existing = new Set((await setupPm.logsPage.getLogStreams()).map((s) => s.name));

    // An internal stream that already exists holds someone else's data, so it is neither written to nor deleted.
    const toCreate = [USER_STREAM, ...INTERNAL_STREAMS.filter((name) => !existing.has(name))];
    for (const name of toCreate) {
      // A retry's beforeAll follows the last afterAll's delete, and the server refuses writes while that delete runs.
      await expect(async () => {
        await setupPm.logsPage.ingestData(name, [
          { level: 'info', job: 'internal_streams_seed', message: `internal streams seed for ${name}` },
        ]);
      }).toPass({ timeout: 60000, intervals: [3000] });
      createdStreams.push(name);
    }
    for (const name of [USER_STREAM, ...INTERNAL_STREAMS]) {
      await setupPm.logsPage.waitForStreamAvailable(name, 90000, 3000);
    }
    testLogger.info('Internal streams spec seeded', { created: createdStreams });
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.logsPage.navigateToLogs();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cleanupPm = new PageManager(page);
    for (const name of createdStreams) {
      await cleanupPm.logsPage.deleteStream(name).catch((e) =>
        testLogger.warn(`Failed to delete stream ${name}: ${e.message}`)
      );
    }
    createdStreams = [];
    await context.close();
  });

  test("internal streams are listed after user streams under the Internal streams header", {
    tag: ['@P2', '@regression', '@logsRegression', '@logsRegressionInternalStreams'],
  }, async () => {
    const flags = new Map((await pm.logsPage.getLogStreams()).map((s) => [s.name, s.internal]));
    await pm.logsPage.pickStreamByTypedFilter(USER_STREAM, USER_STREAM);
    await pm.logsPage.expectSelectedStreamLabel(USER_STREAM);
    await pm.logsPage.openStreamPicker();

    const { headerIndex, header, above, below } = await pm.logsPage.getStreamPickerSplit();

    expect(headerIndex, 'the picker must render an Internal streams header').toBeGreaterThan(0);
    expect(header.text).toBe(`Internal streams · ${below.length} Hide`);
    await expect(pm.logsPage.getStreamPickerHeaderAction()).toHaveAttribute('aria-label', HIDE_LABEL);
    expect(above).toContain(USER_STREAM);
    expect(below).toEqual(expect.arrayContaining(INTERNAL_STREAMS));
    // A stream created after the page loaded is missing from the map and is not judged.
    expect(above.filter((name) => flags.get(name) === true), 'internal streams above the header').toEqual([]);
    expect(below.filter((name) => flags.get(name) === false), 'user streams below the header').toEqual([]);
  });

  test("Hide collapses the internal group, survives a reload, and Show restores it", {
    tag: ['@P2', '@regression', '@logsRegression', '@logsRegressionInternalStreams'],
  }, async ({ page }) => {
    await pm.logsPage.pickStreamByTypedFilter(USER_STREAM, USER_STREAM);
    await pm.logsPage.expectSelectedStreamLabel(USER_STREAM);
    await pm.logsPage.openStreamPicker();
    const internalCount = (await pm.logsPage.getStreamPickerSplit()).below.length;

    await pm.logsPage.getStreamPickerHeaderAction().click();
    await expect(pm.logsPage.getStreamPickerHeaderAction()).toHaveAttribute('aria-label', SHOW_LABEL);
    const hiddenText = `Internal streams · ${internalCount} hidden Show`;
    const collapsed = await pm.logsPage.getStreamPickerSplit();
    expect(collapsed.header.text).toBe(hiddenText);
    expect(collapsed.below).toEqual([]);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.openStreamPicker();
    await expect(pm.logsPage.getStreamPickerHeaderAction()).toHaveAttribute('aria-label', SHOW_LABEL);
    const afterReload = await pm.logsPage.getStreamPickerSplit();
    expect(afterReload.header.text).toBe(hiddenText);
    expect(afterReload.below).toEqual([]);

    await pm.logsPage.getStreamPickerHeaderAction().click();
    await expect(pm.logsPage.getStreamPickerHeaderAction()).toHaveAttribute('aria-label', HIDE_LABEL);
    const shown = await pm.logsPage.getStreamPickerSplit();
    expect(shown.header.text).toBe(`Internal streams · ${internalCount} Hide`);
    expect(shown.below).toEqual(expect.arrayContaining(INTERNAL_STREAMS));
  });

  test("a selected internal stream stays listed after Hide", {
    tag: ['@P2', '@regression', '@logsRegression', '@logsRegressionInternalStreams'],
  }, async () => {
    const [selected, other] = INTERNAL_STREAMS;
    await pm.logsPage.pickStreamByTypedFilter(selected, selected);
    await pm.logsPage.expectSelectedStreamLabel(selected);
    await pm.logsPage.openStreamPicker();

    await pm.logsPage.getStreamPickerHeaderAction().click();
    await expect(pm.logsPage.getStreamPickerHeaderAction()).toHaveAttribute('aria-label', SHOW_LABEL);
    const { header, below } = await pm.logsPage.getStreamPickerSplit();
    expect(header.text).toMatch(/^Internal streams · \d+ hidden Show$/);
    expect(below).toEqual([selected]);
    expect(below).not.toContain(other);
  });

  test("the Hide/Show action is reached from the search box with Tab and toggles with Enter and Space", {
    tag: ['@P2', '@regression', '@logsRegression', '@logsRegressionInternalStreams'],
  }, async ({ page }) => {
    await pm.logsPage.pickStreamByTypedFilter(USER_STREAM, USER_STREAM);
    await pm.logsPage.expectSelectedStreamLabel(USER_STREAM);
    await pm.logsPage.openStreamPicker();
    // Narrowed so the header is in the first rendered rows whatever else the org holds.
    await pm.logsPage.filterStreamPicker('_rum');
    const action = pm.logsPage.getStreamPickerHeaderAction();
    await expect(action).toHaveAttribute('aria-label', HIDE_LABEL);

    await pm.logsPage.tabFromStreamPickerSearch();
    await expect(action).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(action).toHaveAttribute('aria-label', SHOW_LABEL);
    await expect(action).toBeFocused();
    expect((await pm.logsPage.getStreamPickerSplit()).header.text).toMatch(
      /^Internal streams · \d+ hidden match(es)? Show$/
    );

    await page.keyboard.press('Enter');
    await expect(action).toHaveAttribute('aria-label', HIDE_LABEL);
    expect((await pm.logsPage.getStreamPickerSplit()).below).toEqual(
      expect.arrayContaining(INTERNAL_STREAMS)
    );

    await action.focus();
    await page.keyboard.press('Space');
    await expect(action).toHaveAttribute('aria-label', SHOW_LABEL);
    await expect(action).toBeFocused();

    await page.keyboard.press('Space');
    await expect(action).toHaveAttribute('aria-label', HIDE_LABEL);
    await expect(action).toBeFocused();
  });

  test("the arrow keys reach the Hide/Show header in an org too large to render it up front", {
    tag: ['@P2', '@regression', '@logsRegression', '@logsRegressionInternalStreams'],
  }, async ({ page }) => {
    const MOCK_COUNT = 45;
    await pm.logsPage.mockExtraUserStreams(MOCK_COUNT, 'e2e_bulk_user_');
    await pm.logsPage.navigateToLogs();
    await pm.logsPage.openStreamPicker();
    await expect(pm.logsPage.getStreamPickerOption('e2e_bulk_user_00')).toBeVisible();
    const header = pm.logsPage.getStreamPickerHeader();
    const action = pm.logsPage.getStreamPickerHeaderAction();
    // The list renders only the rows near its top, so neither Tab nor a click can reach the header yet.
    await expect(header).toHaveCount(0);

    // Starts the walk on a user stream, so it cannot lean on where the opening highlight sits.
    for (let i = 0; i < 3; i++) {
      await pm.logsPage.pressInStreamPickerSearch('ArrowDown');
    }
    // Bounded by every row in the list, so the header is reached from any starting highlight.
    const realStreams = (await pm.logsPage.getLogStreams()).length;
    await pm.logsPage.arrowToStreamPickerHeader('ArrowUp', MOCK_COUNT + realStreams + 2);
    await expect(header).toHaveAttribute('data-highlighted', '');
    await expect(header).toBeInViewport();
    await expect(action).toHaveAttribute('aria-label', HIDE_LABEL);

    await pm.logsPage.pressInStreamPickerSearch('Enter');
    await expect(action).toHaveAttribute('aria-label', SHOW_LABEL);
    await expect(header).toHaveAttribute('data-highlighted', '');
    await expect(header).toBeInViewport();
    // The header is now the last row and in view, so a hidden row would be rendered right under it.
    for (const name of INTERNAL_STREAMS) {
      await expect(pm.logsPage.getStreamPickerOption(name)).toHaveCount(0);
    }

    await pm.logsPage.pressInStreamPickerSearch('Space');
    await expect(action).toHaveAttribute('aria-label', HIDE_LABEL);
    await expect(header).toHaveAttribute('data-highlighted', '');
    await pm.logsPage.expectStreamPickerSearchValue('');
  });
});

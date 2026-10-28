const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const USER_STREAM = 'e2e_internal_user';
// The server flags these names as internal; it refuses user writes to the `_o2_` ones, so a fixed name is used.
const INTERNAL_STREAMS = ['_rumdata', '_rumlog'];
const HIDE_LABEL = 'Hide internal streams';
const SHOW_LABEL = 'Show internal streams';

/** Splits the picker rows at the "Internal streams" header into the stream names above and below it. */
function splitAtHeader(rows) {
  const headerIndex = rows.findIndex((r) => r.kind === 'header');
  const names = (part) => part.filter((r) => r.kind === 'option').map((r) => r.value);
  return {
    headerIndex,
    header: rows[headerIndex],
    above: names(rows.slice(0, headerIndex)),
    below: names(rows.slice(headerIndex + 1)),
  };
}

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

    const { headerIndex, header, above, below } = splitAtHeader(await pm.logsPage.getStreamPickerRows());

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
    const internalCount = splitAtHeader(await pm.logsPage.getStreamPickerRows()).below.length;

    await pm.logsPage.getStreamPickerHeaderAction().click();
    await expect(pm.logsPage.getStreamPickerHeaderAction()).toHaveAttribute('aria-label', SHOW_LABEL);
    const hiddenText = `Internal streams · ${internalCount} hidden Show`;
    const collapsed = splitAtHeader(await pm.logsPage.getStreamPickerRows());
    expect(collapsed.header.text).toBe(hiddenText);
    expect(collapsed.below).toEqual([]);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.openStreamPicker();
    await expect(pm.logsPage.getStreamPickerHeaderAction()).toHaveAttribute('aria-label', SHOW_LABEL);
    const afterReload = splitAtHeader(await pm.logsPage.getStreamPickerRows());
    expect(afterReload.header.text).toBe(hiddenText);
    expect(afterReload.below).toEqual([]);

    await pm.logsPage.getStreamPickerHeaderAction().click();
    await expect(pm.logsPage.getStreamPickerHeaderAction()).toHaveAttribute('aria-label', HIDE_LABEL);
    const shown = splitAtHeader(await pm.logsPage.getStreamPickerRows());
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
    const { header, below } = splitAtHeader(await pm.logsPage.getStreamPickerRows());
    expect(header.text).toMatch(/^Internal streams · \d+ hidden Show$/);
    expect(below).toEqual([selected]);
    expect(below).not.toContain(other);
  });

  test("the Hide/Show action is reached from the search box with Tab and toggles with Enter", {
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
    expect(splitAtHeader(await pm.logsPage.getStreamPickerRows()).header.text).toMatch(
      /^Internal streams · \d+ hidden match(es)? Show$/
    );

    await page.keyboard.press('Enter');
    await expect(action).toHaveAttribute('aria-label', HIDE_LABEL);
    expect(splitAtHeader(await pm.logsPage.getStreamPickerRows()).below).toEqual(
      expect.arrayContaining(INTERNAL_STREAMS)
    );
  });
});

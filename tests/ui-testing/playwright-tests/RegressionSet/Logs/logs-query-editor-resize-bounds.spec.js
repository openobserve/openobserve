const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

test.describe("Logs Query Editor Resize Bounds", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    try {
      await ingestTestData(page);
    } catch (error) {
      testLogger.warn(`Data ingestion skipped: ${error.message}`);
    }
    await pm.logsPage.selectStream('e2e_automate');
    await pm.logsPage.clickRefreshButton();
    await pm.logsPage.expectResultsGridSettledWithRows();
  });

  test("query editor splitter is bounded within the viewport @bug-12452 @P2 @regression @logsRegression", async () => {
    const bounds = await pm.logsPage.getQueryEditorSplitterBounds();
    const viewportHeight = await pm.logsPage.getViewportHeight();

    expect(bounds.max).toBeGreaterThan(bounds.min);
    // The issue asks for a maximum the viewport can actually hold, not merely any maximum.
    expect(bounds.max, 'splitter maximum must fit inside the viewport').toBeLessThan(viewportHeight);
    testLogger.info(`Splitter bounds: min=${bounds.min} max=${bounds.max} viewport=${viewportHeight}`);
  });

  test("keyboard resize stops at the upper bound @bug-12452 @P2 @regression @logsRegression", async () => {
    const before = await pm.logsPage.getQueryEditorSplitterBounds();

    // End requests the maximum outright; the arrows then push well past it.
    await pm.logsPage.pressQueryEditorSplitterKey('End');
    await pm.logsPage.pressQueryEditorSplitterKey('ArrowDown', 20);

    const after = await pm.logsPage.getQueryEditorSplitterBounds();
    // Without this the clamp assertion would also hold for keys that did nothing at all.
    expect(after.now, 'keyboard must actually resize the splitter').toBeGreaterThan(before.now);
    expect(after.now, 'splitter must clamp at its maximum').toBeLessThanOrEqual(before.max);
    testLogger.info(`Splitter settled at ${after.now} against max ${before.max}`);
  });

  test("dragging past the bound leaves the editor on screen @bug-12452 @P2 @regression @logsRegression", async () => {
    const before = await pm.logsPage.getQueryEditorSplitterBounds();

    // The reported gesture: drag the handle far beyond anything the viewport can hold.
    await pm.logsPage.dragQueryEditorSplitterBy(1500);

    const after = await pm.logsPage.getQueryEditorSplitterBounds();
    expect(after.now, 'drag must actually resize the splitter').toBeGreaterThan(before.now);
    expect(after.now, 'drag must clamp at the splitter maximum').toBeLessThanOrEqual(before.max);

    const gap = await pm.logsPage.getQueryEditorSplitterViewportGap();
    expect(gap, 'editor must not be pushed past the bottom of the viewport').toBeGreaterThan(0);
    testLogger.info(`After drag: value=${after.now}, viewport gap=${gap}px`);
  });
});

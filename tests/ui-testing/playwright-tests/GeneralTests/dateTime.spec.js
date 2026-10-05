const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * E2E coverage for the Date-Time picker Forward Shift Cap (PR #14683).
 *
 * The shared picker (web/src/components/DateTime.vue) renders Previous / Next
 * shift buttons on either side of its trigger. The fix caps the forward shift
 * so it can never land past "now": Next is disabled in Relative mode and
 * whenever the absolute window's end is within one second of the present, and
 * shiftTimeRange('next') clamps its delta with Math.min(duration, now - end).
 *
 * Assertion strategy — copy-back round-trip (same as the copy/paste spec):
 * after a shift the picker closes, so the test reopens it, clicks Copy, and
 * compares the {"start_date","end_date"} epoch-microsecond payload. This is
 * exact for second-aligned input and independent of the runner's timezone.
 */

// Fixed past anchor: 2026-07-23T10:00:00Z .. 2026-07-23T11:00:00Z.
// Second-aligned and far from now, so no calendar max-date / cap can interfere.
const ANCHOR_START_MICROS = 1784800800000000;
const ANCHOR_END_MICROS = 1784804400000000;
const ONE_HOUR_MICROS = 3_600_000_000;
const MICROS_PER_SECOND = 1_000_000;

test.describe("Date-Time Picker Forward Shift Cap testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);

    // The Logs search bar hosts the picker with auto-apply on and does NOT pass
    // hide-range-shift, so both shift buttons render and a shift commits the
    // moment it is applied (no Apply button to manage).
    await page.goto(`${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.dateTimePickerPage.openPicker();

    testLogger.info('Logs date-time picker opened');
  });

  // TC-01
  test("next shift button is disabled while the picker is in relative mode", {
    tag: ['@date-time-next-shift-cap', '@all', '@P0']
  }, async () => {
    testLogger.info('Verifying Next is disabled in the default Relative mode');

    // A relative window has no concrete boundary to shift forward from, so the
    // forward shift is gated off; backward shift stays permitted.
    await pm.dateTimePickerPage.expectNextDisabled();
    await pm.dateTimePickerPage.expectPrevEnabled();

    testLogger.info('Next disabled and Prev enabled in Relative mode');
  });

  // TC-02
  test("forward shift moves both boundaries forward by the window duration and stays absolute", {
    tag: ['@date-time-next-shift-cap', '@all', '@P0']
  }, async () => {
    testLogger.info('Shifting a fixed past 1-hour window forward');

    await pm.dateTimePickerPage.seedClipboard(`${ANCHOR_START_MICROS} - ${ANCHOR_END_MICROS}`);
    await pm.dateTimePickerPage.clickPaste();
    await pm.dateTimePickerPage.expectPasteSuccessToast();
    await pm.dateTimePickerPage.expectAbsolutePanelActive();
    await pm.dateTimePickerPage.expectNextEnabled();

    await pm.dateTimePickerPage.clickNext();

    // The shift closes the picker; reopen it and copy the shifted window back.
    await pm.dateTimePickerPage.openPicker();
    await pm.dateTimePickerPage.expectAbsolutePanelActive();
    await pm.dateTimePickerPage.clickCopy();
    const range = await pm.dateTimePickerPage.readCopiedRange();

    expect(range.start_date).toBe(ANCHOR_START_MICROS + ONE_HOUR_MICROS);
    expect(range.end_date).toBe(ANCHOR_END_MICROS + ONE_HOUR_MICROS);

    testLogger.info('Window advanced forward by exactly one hour and stayed absolute');
  });

  // TC-03
  test("forward shift clamps the window so its end never passes the present", {
    tag: ['@date-time-next-shift-cap', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Shifting a window ending just before now and checking the cap');

    // Compute the anchor from the page's own clock so the test shares the
    // component's notion of "now" (Date.now() * 1000 is epoch microseconds).
    const { startMicros, endMicros } = await page.evaluate(() => {
      const now = Date.now() * 1_000;
      return { startMicros: now - 90_000_000, endMicros: now - 30_000_000 };
    });

    const before = await pm.dateTimePickerPage.pasteAndReadBackRange(`${startMicros} - ${endMicros}`);
    await pm.dateTimePickerPage.expectNextEnabled();

    await pm.dateTimePickerPage.clickNext();

    await pm.dateTimePickerPage.openPicker();
    await pm.dateTimePickerPage.clickCopy();
    const after = await pm.dateTimePickerPage.readCopiedRange();

    const nowMicros = await page.evaluate(() => Date.now() * 1_000);

    // Headline assertion: the clamped end never lands in the future. The shift
    // clamps its delta to now - end, so after.end_date is at most "now" at the
    // moment of the click; the +2s slack absorbs normal execution drift.
    expect(after.end_date).toBeLessThanOrEqual(nowMicros + 2 * MICROS_PER_SECOND);
    // The window stays valid and has still moved forward.
    expect(after.end_date).toBeGreaterThan(after.start_date);
    expect(after.start_date).toBeGreaterThan(before.start_date);

    testLogger.info('Forward shift clamped at now', { before, after });
  });

  // TC-04
  test("previous shift moves both boundaries backward by the window duration", {
    tag: ['@date-time-next-shift-cap', '@all', '@P1']
  }, async () => {
    testLogger.info('Shifting a fixed past 1-hour window backward');

    await pm.dateTimePickerPage.seedClipboard(`${ANCHOR_START_MICROS} - ${ANCHOR_END_MICROS}`);
    await pm.dateTimePickerPage.clickPaste();
    await pm.dateTimePickerPage.expectPasteSuccessToast();
    await pm.dateTimePickerPage.expectAbsolutePanelActive();

    await pm.dateTimePickerPage.clickPrev();

    await pm.dateTimePickerPage.openPicker();
    await pm.dateTimePickerPage.clickCopy();
    const range = await pm.dateTimePickerPage.readCopiedRange();

    expect(range.start_date).toBe(ANCHOR_START_MICROS - ONE_HOUR_MICROS);
    expect(range.end_date).toBe(ANCHOR_END_MICROS - ONE_HOUR_MICROS);

    testLogger.info('Window shifted backward by exactly one hour');
  });

  // TC-05
  test("forward shift is disabled when the window end is at or past the present", {
    tag: ['@date-time-next-shift-cap', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Verifying Next is disabled for a window already ending at now');

    // A window whose end is at the present must not offer a forward shift, since
    // there is nothing left to shift into. This is the second gating branch of
    // isNextShiftDisabled() (endUTC + 1s > now). Time-sensitive by nature: the
    // end is derived from the page clock at paste time.
    const { startMicros, endMicros } = await page.evaluate(() => {
      const now = Date.now() * 1_000;
      return { startMicros: now - 30_000_000, endMicros: now };
    });

    await pm.dateTimePickerPage.seedClipboard(`${startMicros} - ${endMicros}`);
    await pm.dateTimePickerPage.clickPaste();
    await pm.dateTimePickerPage.expectPasteSuccessToast();
    await pm.dateTimePickerPage.expectAbsolutePanelActive();

    await pm.dateTimePickerPage.expectNextDisabled();

    testLogger.info('Next disabled for a window ending at the present');
  });

  // TC-06
  test("both previous and next shift buttons render with accessible labels", {
    tag: ['@date-time-next-shift-cap', '@all', '@P2']
  }, async () => {
    testLogger.info('Verifying shift buttons render with accessible labels');

    await pm.dateTimePickerPage.expectShiftButtonsVisible();
    await pm.dateTimePickerPage.expectShiftAriaLabels();

    testLogger.info('Shift buttons visible with correct aria-labels');
  });
});

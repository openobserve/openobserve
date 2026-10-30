const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * E2E coverage for the DateTime picker Copy / Paste feature (PR #13374).
 *
 * The grammar of the paste parser is already exhaustively unit-tested in
 * web/src/utils/dateTimeRangeParse.spec.ts. These tests cover the UI wiring the
 * unit tests cannot reach: the buttons, the toasts, the forced switch to the
 * Absolute tab, the clipboard payload shape, and the difference between the
 * auto-apply (Logs) and manual-apply (Metrics) hosts of the component.
 *
 * Assertion strategy — copy-back round-trip:
 * `getConsumableDateTime()` resolves the selection through `store.state.timezone`,
 * so a displayed HH:mm:ss depends on whichever timezone the picker is sitting in.
 * Pasting an epoch value, then clicking Copy and comparing the JSON payload, is
 * exact and independent of the runner's timezone. Wall-clock assertions are used
 * only for timezone-naive input formats, where the picker echoes back the literal
 * time it was given.
 */

// Fixed past anchor: 2026-07-23T10:00:00Z .. 2026-07-23T11:00:00Z.
// Second-aligned so it survives the picker's second-resolution round-trip, and in
// the past so no calendar max-date restriction can clamp it.
const ANCHOR_START_MICROS = 1784800800000000;
const ANCHOR_END_MICROS = 1784804400000000;
// 10:10:00Z — 10 min from the start, 50 min from the end, so the proximity rule
// in applySingleDateTime() must replace the START.
const NEAR_START_MICROS = 1784801400000000;
// 10:50:00Z — the mirror case, which must replace the END.
const NEAR_END_MICROS = 1784803800000000;

const MICROS_PER_SECOND = 1_000_000;

test.describe("DateTime Picker Copy Paste testcases", () => {
  let pm;

  test.describe("Logs picker - auto apply mode", () => {
    test.describe.configure({ mode: 'parallel' });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);

      await navigateToBase(page);
      pm = new PageManager(page);

      // The Logs search bar hosts the picker with auto-apply on, so a pasted
      // range commits the moment it parses — no Apply button is rendered.
      await page.goto(`${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`);
      await page.waitForLoadState('domcontentloaded');
      await pm.dateTimePickerPage.openPicker();

      testLogger.info('Logs date-time picker opened');
    });

    // TC-01
    test("should render copy and paste controls in the date time picker", {
      tag: ['@datetime-picker', '@all', '@smoke', '@P0']
    }, async () => {
      testLogger.info('Verifying copy/paste controls render with accessible labels');

      await pm.dateTimePickerPage.expectCopyPasteControlsVisible();
      await pm.dateTimePickerPage.expectCopyPasteAriaLabels();

      testLogger.info('Copy/paste controls verified');
    });

    // TC-02
    test("should copy a relative range as an absolute epoch payload", {
      tag: ['@datetime-picker', '@all', '@smoke', '@P0']
    }, async () => {
      testLogger.info('Copying the default relative range');

      await pm.dateTimePickerPage.selectRelativePeriod('15-m');
      await pm.dateTimePickerPage.clickCopy();
      await pm.dateTimePickerPage.expectCopySuccessToast();

      // Copy resolves a relative selection to a concrete absolute window, so the
      // payload must be a pair of epoch-microsecond numbers spanning ~15 minutes.
      const payload = await pm.dateTimePickerPage.readCopiedRange();
      expect(payload.end_date).toBeGreaterThan(payload.start_date);

      const spanSeconds = (payload.end_date - payload.start_date) / MICROS_PER_SECOND;
      // Tolerance absorbs the sub-second drift between the two Date() calls in
      // getConsumableDateTime(); the window itself is exactly 15 minutes.
      expect(spanSeconds).toBeGreaterThan(895);
      expect(spanSeconds).toBeLessThan(905);

      testLogger.info('Relative range copied as absolute epoch payload', { spanSeconds });
    });

    // TC-03
    test("should restore the original window when a copied range is pasted back", {
      tag: ['@datetime-picker', '@all', '@P0']
    }, async () => {
      testLogger.info('Copying a 1 hour range, changing it, then pasting it back');

      await pm.dateTimePickerPage.selectRelativePeriod('1-h');
      await pm.dateTimePickerPage.clickCopy();
      const copied = await pm.dateTimePickerPage.readCopiedRange();

      // Move the selection somewhere else so the paste has something to undo.
      await pm.dateTimePickerPage.selectRelativePeriod('6-h');
      await pm.dateTimePickerPage.clickPaste();

      await pm.dateTimePickerPage.expectPasteSuccessToast();
      // Paste always forces the picker onto the Absolute tab.
      await pm.dateTimePickerPage.expectAbsolutePanelActive();

      // Read the restored window back through Copy — timezone independent.
      await pm.dateTimePickerPage.clickCopy();
      const restored = await pm.dateTimePickerPage.readCopiedRange();

      // The copied payload carries sub-second precision but the picker stores the
      // selection at second resolution, so compare on whole seconds.
      expect(Math.floor(restored.start_date / MICROS_PER_SECOND))
        .toBe(Math.floor(copied.start_date / MICROS_PER_SECOND));
      expect(Math.floor(restored.end_date / MICROS_PER_SECOND))
        .toBe(Math.floor(copied.end_date / MICROS_PER_SECOND));

      testLogger.info('Copied range restored exactly');
    });

    // TC-04
    test("should paste an epoch microsecond range", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting an epoch microsecond range');

      const range = await pm.dateTimePickerPage.pasteAndReadBackRange(
        `${ANCHOR_START_MICROS} - ${ANCHOR_END_MICROS}`
      );

      expect(range.start_date).toBe(ANCHOR_START_MICROS);
      expect(range.end_date).toBe(ANCHOR_END_MICROS);

      testLogger.info('Epoch microsecond range applied exactly');
    });

    // TC-05
    test("should paste an epoch second range and auto detect the unit", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting a 10 digit epoch second range');

      // toMicros() buckets by digit length: <=10 digits is seconds. The same
      // instant expressed in seconds must land on the same window as TC-04.
      const startSeconds = ANCHOR_START_MICROS / MICROS_PER_SECOND;
      const endSeconds = ANCHOR_END_MICROS / MICROS_PER_SECOND;

      const range = await pm.dateTimePickerPage.pasteAndReadBackRange(
        `${startSeconds} - ${endSeconds}`
      );

      expect(range.start_date).toBe(ANCHOR_START_MICROS);
      expect(range.end_date).toBe(ANCHOR_END_MICROS);

      testLogger.info('Epoch seconds auto detected as the correct unit');
    });

    // TC-06
    test("should paste an ISO 8601 range with a UTC offset", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting an ISO 8601 range carrying an explicit Z offset');

      // An explicit offset already IS the instant, so the picker's own timezone
      // must not shift it — the result has to equal the TC-04 window.
      const range = await pm.dateTimePickerPage.pasteAndReadBackRange(
        '2026-07-23T10:00:00Z - 2026-07-23T11:00:00Z'
      );

      expect(range.start_date).toBe(ANCHOR_START_MICROS);
      expect(range.end_date).toBe(ANCHOR_END_MICROS);

      testLogger.info('ISO range resolved to the same instant regardless of picker timezone');
    });

    // TC-07
    test("should paste a slash formatted absolute range", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting a slash formatted absolute range');

      await pm.dateTimePickerPage.seedClipboard('2026/07/23 10:00:00 - 2026/07/23 11:00:00');
      await pm.dateTimePickerPage.clickPaste();

      await pm.dateTimePickerPage.expectPasteSuccessToast();
      await pm.dateTimePickerPage.expectAbsolutePanelActive();

      // This format carries no offset, so it is wall-clock time in the picker's
      // own timezone — the fields echo back the literal values that were pasted.
      await pm.dateTimePickerPage.expectAbsoluteTimeFields('10:00:00', '11:00:00');

      testLogger.info('Slash formatted range applied as wall clock time');
    });

    // TC-08
    test("should paste a human readable log format range", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting the app log/trace timestamp display format');

      // The format formatTimestamp() emits for log and trace rows, so a user can
      // copy a timestamp straight out of the results table.
      await pm.dateTimePickerPage.seedClipboard('Jul 23, 2026 10:00:00 - Jul 23, 2026 11:00:00');
      await pm.dateTimePickerPage.clickPaste();

      await pm.dateTimePickerPage.expectPasteSuccessToast();
      await pm.dateTimePickerPage.expectAbsolutePanelActive();
      await pm.dateTimePickerPage.expectAbsoluteTimeFields('10:00:00', '11:00:00');

      testLogger.info('Human log format range applied as wall clock time');
    });

    // TC-09
    test("should apply a single pasted value to the start when it is closer to the start", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting a single value nearer the start of the current range');

      // Establish a known 10:00-11:00 window first.
      await pm.dateTimePickerPage.pasteAndReadBackRange(
        `${ANCHOR_START_MICROS} - ${ANCHOR_END_MICROS}`
      );

      // 10:10 is 10 min from the start and 50 min from the end, so the proximity
      // rule must move the START and leave the END alone.
      const range = await pm.dateTimePickerPage.pasteAndReadBackRange(`${NEAR_START_MICROS}`);

      expect(range.start_date).toBe(NEAR_START_MICROS);
      expect(range.end_date).toBe(ANCHOR_END_MICROS);

      testLogger.info('Single value replaced the start boundary');
    });

    // TC-10
    test("should apply a single pasted value to the end when it is closer to the end", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting a single value nearer the end of the current range');

      await pm.dateTimePickerPage.pasteAndReadBackRange(
        `${ANCHOR_START_MICROS} - ${ANCHOR_END_MICROS}`
      );

      // 10:50 is 50 min from the start and 10 min from the end — mirror of TC-09.
      const range = await pm.dateTimePickerPage.pasteAndReadBackRange(`${NEAR_END_MICROS}`);

      expect(range.start_date).toBe(ANCHOR_START_MICROS);
      expect(range.end_date).toBe(NEAR_END_MICROS);

      testLogger.info('Single value replaced the end boundary');
    });

    // TC-11
    test("should reject unparseable text and leave the current range untouched", {
      tag: ['@datetime-picker', '@all', '@P2']
    }, async () => {
      testLogger.info('Pasting text that matches no supported format');

      await pm.dateTimePickerPage.selectRelativePeriod('15-m');
      const labelBeforePaste = await pm.dateTimePickerPage.getTriggerLabel();

      await pm.dateTimePickerPage.seedClipboard('not a date range at all');
      await pm.dateTimePickerPage.clickPaste();

      await pm.dateTimePickerPage.expectPasteErrorToast();
      // A failed paste must not force the switch to Absolute...
      await pm.dateTimePickerPage.expectRelativePanelActive();
      // ...nor disturb the selection that was already in force.
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(labelBeforePaste);

      testLogger.info('Unparseable paste rejected without side effects', { labelBeforePaste });
    });

    // TC-12
    test("should show the parse error toast when the clipboard is empty", {
      tag: ['@datetime-picker', '@all', '@P2']
    }, async () => {
      testLogger.info('Pasting with an empty clipboard');

      await pm.dateTimePickerPage.selectRelativePeriod('15-m');
      await pm.dateTimePickerPage.seedClipboard('');
      await pm.dateTimePickerPage.clickPaste();

      await pm.dateTimePickerPage.expectPasteErrorToast();
      await pm.dateTimePickerPage.expectRelativePanelActive();

      testLogger.info('Empty clipboard rejected with the parse error toast');
    });
  });

  test.describe("Metrics picker - manual apply mode", () => {
    test.describe.configure({ mode: 'parallel' });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);

      await navigateToBase(page);
      pm = new PageManager(page);

      // Metrics Explorer hosts the picker through DateTimePickerDashboard, whose
      // autoApplyDashboard prop defaults to false — so an Apply button is rendered
      // and a pasted range stays pending until it is pressed.
      await page.goto(`${process.env["ZO_BASE_URL"]}/web/metrics?org_identifier=${process.env["ORGNAME"]}`);
      await page.waitForLoadState('domcontentloaded');
      await pm.dateTimePickerPage.openPicker();

      testLogger.info('Metrics date-time picker opened');
    });

    // TC-13
    test("should stage a pasted range until Apply commits it", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Verifying paste stages and Apply commits on a manual apply picker');

      // The Apply button is the marker that this host runs in manual-apply mode.
      await pm.dateTimePickerPage.expectApplyButtonVisible();

      await pm.dateTimePickerPage.seedClipboard('2026/07/23 10:00:00 - 2026/07/23 11:00:00');
      await pm.dateTimePickerPage.clickPaste();

      await pm.dateTimePickerPage.expectPasteSuccessToast();
      await pm.dateTimePickerPage.expectAbsolutePanelActive();
      await pm.dateTimePickerPage.expectAbsoluteTimeFields('10:00:00', '11:00:00');

      // PR #13374 also made the trigger show the LIVE selection while the panel is
      // open, so the pasted window is visible on the button before Apply.
      const stagedLabel = await pm.dateTimePickerPage.getTriggerLabel();
      expect(stagedLabel).toContain('2026/07/23 10:00:00');
      expect(stagedLabel).toContain('2026/07/23 11:00:00');

      // Apply commits the pending selection and closes the panel.
      await pm.dateTimePickerPage.clickApply();
      await pm.dateTimePickerPage.expectPickerClosed();

      // Once closed the trigger falls back to the APPLIED range, which is now the
      // pasted one — so the label must survive the close.
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(stagedLabel);

      testLogger.info('Pasted range staged and committed via Apply', { stagedLabel });
    });

    // TC-14
    test("should revert the trigger label when the picker is closed without Apply", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Verifying a pasted but unapplied range is discarded on close');

      const appliedLabel = await pm.dateTimePickerPage.getTriggerLabel();

      await pm.dateTimePickerPage.seedClipboard('2026/07/23 10:00:00 - 2026/07/23 11:00:00');
      await pm.dateTimePickerPage.clickPaste();
      await pm.dateTimePickerPage.expectPasteSuccessToast();

      // While the panel is open the trigger tracks the pending selection.
      const stagedLabel = await pm.dateTimePickerPage.getTriggerLabel();
      expect(stagedLabel).toContain('2026/07/23 10:00:00');
      expect(stagedLabel).not.toBe(appliedLabel);

      // Closing without Apply must snap the label back to what is actually in force.
      await pm.dateTimePickerPage.closePickerWithEscape();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(appliedLabel);

      testLogger.info('Unapplied paste discarded on close', { appliedLabel, stagedLabel });
    });
  });
});

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * E2E coverage for the DateTime picker Copy / Paste feature (PR #13374).
 *
 * The grammar of the paste parser is unit-tested in
 * web/src/utils/timeRangeInput/__tests__. These tests cover the UI wiring the
 * unit tests cannot reach: the buttons, the toasts, the clipboard text, the
 * typed bar a non-range paste lands in, and the difference between the
 * auto-apply (Logs) and manual-apply (Metrics) hosts of the component.
 *
 * Assertion strategy — copy-back round-trip:
 * Copy on the Absolute tab writes an ISO pair with offsets, so pasting an epoch
 * value, then copying it back, is exact and independent of the runner's
 * timezone. Wall-clock assertions are used only for timezone-naive input
 * formats, where the picker echoes back the literal time it was given.
 */

// Fixed past anchor: 2026-07-23T10:00:00Z .. 2026-07-23T11:00:00Z.
// Second-aligned so it survives the picker's second-resolution round-trip, and in
// the past so no calendar max-date restriction can clamp it.
const ANCHOR_START_MICROS = 1784800800000000;
const ANCHOR_END_MICROS = 1784804400000000;
// 10:10:00Z — a lone stamp, which the bar previews as a window around it.
const NEAR_START_MICROS = 1784801400000000;

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

    test("should close the picker when a relative time is picked", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      await pm.dateTimePickerPage.relativePeriodBtn('15-m').click();
      await pm.dateTimePickerPage.expectPickerClosed();
    });

    // TC-02
    test("should copy a relative range as rolling now-<n><unit> text", {
      tag: ['@datetime-picker', '@all', '@smoke', '@P0']
    }, async () => {
      testLogger.info('Copying the default relative range');

      await pm.dateTimePickerPage.selectRelativePeriod('15-m');
      await pm.dateTimePickerPage.clickCopy();
      await pm.dateTimePickerPage.expectCopySuccessToast('Copied now-15m');

      expect(await pm.dateTimePickerPage.readClipboard()).toBe('now-15m');

      testLogger.info('Relative range copied as rolling text');
    });

    // TC-03
    test("should restore the rolling range when a copied range is pasted back", {
      tag: ['@datetime-picker', '@all', '@P0']
    }, async () => {
      testLogger.info('Copying a 1 hour range, changing it, then pasting it back');

      await pm.dateTimePickerPage.selectRelativePeriod('1-h');
      await pm.dateTimePickerPage.clickCopy();
      expect(await pm.dateTimePickerPage.readClipboard()).toBe('now-1h');

      // Move the selection somewhere else so the paste has something to undo.
      await pm.dateTimePickerPage.selectRelativePeriod('6-h');
      await pm.dateTimePickerPage.clickPaste();

      await pm.dateTimePickerPage.expectPasteSuccessToast();
      // An auto-apply host applies a full range at once and closes; it stays rolling.
      await pm.dateTimePickerPage.expectPickerClosed();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 1 Hour');

      testLogger.info('Copied range restored as the same rolling range');
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
      await pm.dateTimePickerPage.ensurePickerOpen();
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
      await pm.dateTimePickerPage.ensurePickerOpen();
      await pm.dateTimePickerPage.expectAbsolutePanelActive();
      await pm.dateTimePickerPage.expectAbsoluteTimeFields('10:00:00', '11:00:00');

      testLogger.info('Human log format range applied as wall clock time');
    });

    // TC-09
    test("should put a single pasted timestamp in the bar for review", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting a single value, which needs a second look before it applies');

      const labelBeforePaste = await pm.dateTimePickerPage.getTriggerLabel();
      await pm.dateTimePickerPage.seedClipboard(`${NEAR_START_MICROS}`);
      await pm.dateTimePickerPage.clickPaste();

      // A lone stamp reads as a window around it, so it waits in the bar for Enter.
      await pm.dateTimePickerPage.expectRangeBarText(`${NEAR_START_MICROS}`, 'valid');
      await expect(pm.dateTimePickerPage.toastByMessage(pm.dateTimePickerPage.pastedToastMessage)).toHaveCount(0);
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(labelBeforePaste);

      await pm.dateTimePickerPage.rangeBarInput.press('Enter');
      await pm.dateTimePickerPage.expectPickerClosed();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).not.toBe(labelBeforePaste);

      testLogger.info('Single value previewed in the bar, then applied');
    });

    // TC-11
    test("should put unreadable text in the bar and leave the current range untouched", {
      tag: ['@datetime-picker', '@all', '@P2']
    }, async () => {
      testLogger.info('Pasting text that matches no supported format');

      await pm.dateTimePickerPage.selectRelativePeriod('15-m');
      const labelBeforePaste = await pm.dateTimePickerPage.getTriggerLabel();

      await pm.dateTimePickerPage.seedClipboard('not a date range at all');
      await pm.dateTimePickerPage.clickPaste();

      // The bar says why it cannot read the text; no error toast.
      await pm.dateTimePickerPage.expectRangeBarText('not a date range at all', 'invalid');
      await expect(pm.dateTimePickerPage.toastByMessage(pm.dateTimePickerPage.pasteErrorToastMessage)).toHaveCount(0);
      await pm.dateTimePickerPage.expectRelativePanelActive();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(labelBeforePaste);

      testLogger.info('Unparseable paste shown in the bar without side effects', { labelBeforePaste });
    });

    // TC-12
    test("should say the clipboard is empty when pasting an empty clipboard", {
      tag: ['@datetime-picker', '@all', '@P2']
    }, async () => {
      testLogger.info('Pasting with an empty clipboard');

      await pm.dateTimePickerPage.selectRelativePeriod('15-m');
      const labelBeforePaste = await pm.dateTimePickerPage.getTriggerLabel();
      await pm.dateTimePickerPage.seedClipboard('');
      await pm.dateTimePickerPage.clickPaste();

      await pm.dateTimePickerPage.expectPasteEmptyToast();
      await pm.dateTimePickerPage.expectRelativePanelActive();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(labelBeforePaste);

      testLogger.info('Empty clipboard rejected with the empty-clipboard toast');
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

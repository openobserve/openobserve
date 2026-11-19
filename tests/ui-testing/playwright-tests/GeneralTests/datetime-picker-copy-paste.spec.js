const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * E2E coverage for the DateTime picker Copy / Paste feature (PR #13374).
 *
 * The paste grammar is unit-tested in web/src/utils/dateTimeRangeParse*.spec.ts. These
 * tests cover the UI wiring: Copy writes readable text naming its zone offset, and Paste
 * fills the bar with a preview that applies only on Enter (no toasts, except an empty
 * clipboard). Ranges are read back through Copy, whose stamps carry their own offset,
 * so every assertion is exact in any runner timezone.
 */

// Fixed past anchor: 2026-07-23T10:00:00Z .. 2026-07-23T11:00:00Z.
// Second-aligned so it survives the picker's second-resolution round-trip, and in
// the past so no calendar max-date restriction can clamp it.
const ANCHOR_START_MICROS = 1784800800000000;
const ANCHOR_END_MICROS = 1784804400000000;
// 10:10:00Z and 10:50:00Z: single instants inside the anchor window.
const NEAR_START_MICROS = 1784801400000000;
const NEAR_END_MICROS = 1784803800000000;

const MICROS_PER_SECOND = 1_000_000;
// A single pasted instant opens a window this wide on each side, as typing it does.
const SINGLE_WINDOW_MICROS = 5 * 60 * MICROS_PER_SECOND;

test.describe("DateTime Picker Copy Paste testcases", () => {
  let pm;

  test.describe("Logs picker", () => {
    test.describe.configure({ mode: 'parallel' });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);

      await navigateToBase(page);
      pm = new PageManager(page);

      // Logs runs a range the moment it is applied; a paste still waits for Enter.
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
    test("should copy a relative range as readable text naming the period and its stamps", {
      tag: ['@datetime-picker', '@all', '@smoke', '@P0']
    }, async () => {
      testLogger.info('Copying the default relative range');

      await pm.dateTimePickerPage.selectRelativePeriod('15-m');
      await pm.dateTimePickerPage.clickCopy();
      await pm.dateTimePickerPage.expectCopyConfirmed();

      // A live range copies as "Last 15 minutes (YYYY-MM-DD HH:MM – HH:MM UTC±hh:mm)", not JSON.
      const copied = await pm.dateTimePickerPage.readCopiedRange();
      expect(copied.name).toBe('Last 15 minutes');
      expect(() => JSON.parse(copied.text)).toThrow();

      const spanSeconds = (copied.end_date - copied.start_date) / MICROS_PER_SECOND;
      expect(spanSeconds).toBe(900);

      testLogger.info('Relative range copied as readable text', { text: copied.text });
    });

    // TC-03
    test("should restore the copied rolling period when its copy is pasted back", {
      tag: ['@datetime-picker', '@all', '@P0']
    }, async () => {
      testLogger.info('Copying a 1 hour range, changing it, then pasting it back');

      await pm.dateTimePickerPage.selectRelativePeriod('1-h');
      await pm.dateTimePickerPage.clickCopy();
      const copied = await pm.dateTimePickerPage.readCopiedRange();

      await pm.dateTimePickerPage.selectRelativePeriod('6-h');
      await pm.dateTimePickerPage.clickPaste();
      await pm.dateTimePickerPage.applyPaste();

      // The copy names its period, so it reads back as that rolling period, not fixed dates.
      await pm.dateTimePickerPage.expectRelativePanelActive();
      await pm.dateTimePickerPage.clickCopy();
      const restored = await pm.dateTimePickerPage.readCopiedRange();
      expect(restored.name).toBe(copied.name);
      expect(restored.end_date - restored.start_date).toBe(copied.end_date - copied.start_date);

      testLogger.info('Copied rolling period restored', { text: restored.text });
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

      // No offset in the text, so it is wall-clock time in the picker's zone; Copy writes that zone.
      const range = await pm.dateTimePickerPage.pasteAndReadBackRange('2026/07/23 10:00:00 - 2026/07/23 11:00:00');
      expect(range.text).toMatch(/^2026-07-23 10:00 – 11:00 UTC/);

      testLogger.info('Slash formatted range applied as wall clock time');
    });

    // TC-08
    test("should paste a human readable log format range", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting the app log/trace timestamp display format');

      // The format formatTimestamp() emits for log and trace rows, so a user can
      // copy a timestamp straight out of the results table.
      // No offset in the text, so it is wall-clock time in the picker's zone; Copy writes that zone.
      const range = await pm.dateTimePickerPage.pasteAndReadBackRange('Jul 23, 2026 10:00:00 - Jul 23, 2026 11:00:00');
      expect(range.text).toMatch(/^2026-07-23 10:00 – 11:00 UTC/);

      testLogger.info('Human log format range applied as wall clock time');
    });

    // TC-09
    test("should open a five minute window either side of a single pasted value", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting a single value reads it as typed text does');

      // Establish a known 10:00-11:00 window first.
      await pm.dateTimePickerPage.pasteAndReadBackRange(
        `${ANCHOR_START_MICROS} - ${ANCHOR_END_MICROS}`
      );

      // The single value replaces the whole range, not the nearer end of the old one.
      const range = await pm.dateTimePickerPage.pasteAndReadBackRange(`${NEAR_START_MICROS}`);

      expect(range.start_date).toBe(NEAR_START_MICROS - SINGLE_WINDOW_MICROS);
      expect(range.end_date).toBe(NEAR_START_MICROS + SINGLE_WINDOW_MICROS);

      testLogger.info('Single value opened a +-5 minute window');
    });

    // TC-10
    test("should centre the window on a single pasted value near the old end too", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Pasting a single value near the end of the current range');

      await pm.dateTimePickerPage.pasteAndReadBackRange(
        `${ANCHOR_START_MICROS} - ${ANCHOR_END_MICROS}`
      );

      // The window centres on the pasted value, wherever the previous range ended.
      const range = await pm.dateTimePickerPage.pasteAndReadBackRange(`${NEAR_END_MICROS}`);

      expect(range.start_date).toBe(NEAR_END_MICROS - SINGLE_WINDOW_MICROS);
      expect(range.end_date).toBe(NEAR_END_MICROS + SINGLE_WINDOW_MICROS);

      testLogger.info('Single value opened a +-5 minute window');
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

      await pm.dateTimePickerPage.expectPasteUnreadable();
      // A failed paste must not switch to a fixed range...
      await pm.dateTimePickerPage.expectRelativePanelActive();
      // ...nor disturb the selection that was already in force.
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(labelBeforePaste);

      testLogger.info('Unparseable paste rejected without side effects', { labelBeforePaste });
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

  test.describe("Metrics picker", () => {
    test.describe.configure({ mode: 'parallel' });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);

      await navigateToBase(page);
      pm = new PageManager(page);

      // Metrics hosts the picker through DateTimePickerDashboard; a paste waits for Enter here too.
      await page.goto(`${process.env["ZO_BASE_URL"]}/web/metrics?org_identifier=${process.env["ORGNAME"]}`);
      await page.waitForLoadState('domcontentloaded');
      await pm.dateTimePickerPage.openPicker();

      testLogger.info('Metrics date-time picker opened');
    });

    // TC-13
    test("should not apply a pasted range until Enter applies it", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Verifying a paste only previews until it is applied');

      const appliedLabel = await pm.dateTimePickerPage.getTriggerLabel();
      await pm.dateTimePickerPage.seedClipboard('2026/07/23 10:00:00 - 2026/07/23 11:00:00');
      await pm.dateTimePickerPage.clickPaste();

      await expect(pm.dateTimePickerPage.textInput).toHaveValue('2026/07/23 10:00:00 - 2026/07/23 11:00:00');
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(appliedLabel);

      await pm.dateTimePickerPage.applyPaste();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).not.toBe(appliedLabel);
      await pm.dateTimePickerPage.clickCopy();
      const range = await pm.dateTimePickerPage.readCopiedRange();
      expect(range.text).toMatch(/^2026-07-23 10:00 – 11:00 UTC/);

      testLogger.info('Pasted range applied on Enter', { text: range.text });
    });

    // TC-14
    test("should keep the applied range when the picker is closed without applying a paste", {
      tag: ['@datetime-picker', '@all', '@P1']
    }, async () => {
      testLogger.info('Verifying a pasted but unapplied range is discarded on close');

      const appliedLabel = await pm.dateTimePickerPage.getTriggerLabel();

      await pm.dateTimePickerPage.seedClipboard('2026/07/23 10:00:00 - 2026/07/23 11:00:00');
      await pm.dateTimePickerPage.clickPaste();
      await expect(pm.dateTimePickerPage.resolvedLine).toHaveAttribute('data-preview', 'true');

      await pm.dateTimePickerPage.closePickerDiscardingInput();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(appliedLabel);

      testLogger.info('Unapplied paste discarded on close', { appliedLabel });
    });
  });
});

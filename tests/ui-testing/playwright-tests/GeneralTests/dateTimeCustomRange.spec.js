const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * E2E coverage for how the DateTime picker (web/src/components/DateTime.vue)
 * respects a stream's max_query_range: over-limit chips and list rows are
 * disabled with the reason, a typed over-limit period is refused (not clamped),
 * an unreadable typed value is flagged, and an in-limit chip still applies.
 *
 * Parallel-safety: the unreadable-input case uses the read-only `e2e_automate`
 * stream (restriction reset in beforeEach); the restriction cases own the
 * dedicated stream `e2e_datetime_restriction`, so no two tests mutate the same
 * restriction state.
 */

const NO_RESTRICTION_STREAM = 'e2e_automate';
const RESTRICTION_STREAM = 'e2e_datetime_restriction';
const ORG_ID = process.env.ORGNAME || 'default';
// search.queryRangeRestrictionMsg, with common.timeRangeOverLimit as the fallback copy.
const RESTRICTION_REASON = /query range is restricted to|longer than the \d+-hour limit/i;

test.describe('DateTime range limit and typed input testcases', () => {
  let pm;

  test.describe('Typed input (no restriction)', () => {
    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);

      // Clear any max_query_range a prior run may have leaked onto the shared stream.
      await pm.dashboardMaxQueryRange.resetMaxQueryRange(NO_RESTRICTION_STREAM);
      await pm.logsPage.selectStream(NO_RESTRICTION_STREAM);
      await pm.dateTimePickerPage.openPicker();
      testLogger.info('Logs picker opened on the unrestricted stream');
    });

    // TC-01
    test('should flag unreadable typed text and keep the applied range', {
      tag: ['@date-time-custom-range', '@all', '@P0']
    }, async () => {
      const labelBefore = await pm.dateTimePickerPage.getTriggerLabel();

      await pm.dateTimePickerPage.typeAndEnter('zzqq');
      await pm.dateTimePickerPage.expectInputError();

      await pm.dateTimePickerPage.clearInputAndClose();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(labelBefore);
      testLogger.info('Unreadable input flagged, applied range unchanged');
    });
  });

  test.describe('Range limits under a max query range restriction', () => {
    test.describe.configure({ mode: 'parallel' });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);

      // Dedicated stream so no parallel test can wipe the restriction mid-assertion.
      await pm.ingestionPage.ingestionMultiOrgStream(ORG_ID, RESTRICTION_STREAM);
      await pm.dashboardMaxQueryRange.waitForStreamReady(RESTRICTION_STREAM);
      await pm.dashboardMaxQueryRange.setMaxQueryRange(2, RESTRICTION_STREAM);
      await pm.logsPage.selectStream(RESTRICTION_STREAM);
      await pm.dateTimePickerPage.openPicker();
      // The restriction settles asynchronously; a disabled over-limit chip is the gate.
      await pm.dateTimePickerPage.expectPresetDisabled('4-h');
      testLogger.info('Logs picker opened on the restricted stream');
    });

    // TC-02
    test('should disable over-limit chips and list rows with the reason', {
      tag: ['@date-time-custom-range', '@all', '@P1']
    }, async () => {
      for (const suffix of ['4-h', '24-h', '7-d', '30-d']) {
        await pm.dateTimePickerPage.expectPresetDisabled(suffix);
      }
      await pm.dateTimePickerPage.expectPresetEnabled('15-m');
      await pm.dateTimePickerPage.expectPresetEnabled('1-h');

      await pm.dateTimePickerPage.expectCalendarRowDisabledWithReason('yesterday', RESTRICTION_REASON);
      await pm.dateTimePickerPage.expectPresetReason('24-h', RESTRICTION_REASON);
      testLogger.info('Over-limit chips and rows disabled with the reason');
    });

    // TC-03
    test('should refuse a typed period over the limit and keep the applied range', {
      tag: ['@date-time-custom-range', '@all', '@P1']
    }, async () => {
      const labelBefore = await pm.dateTimePickerPage.getTriggerLabel();

      // DateTime.vue plans an over-limit period as "restricted": the note explains, Enter does nothing.
      await pm.dateTimePickerPage.typeText('6h');
      await pm.dateTimePickerPage.expectPreviewNote(RESTRICTION_REASON);
      await pm.dateTimePickerPage.textInput.press('Enter');
      await expect(pm.dateTimePickerPage.panel).toBeVisible();

      await pm.dateTimePickerPage.clearInputAndClose();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(labelBefore);
      testLogger.info('Over-limit typed period refused');
    });

    // TC-04
    test('should apply a chip within the limit', {
      tag: ['@date-time-custom-range', '@all', '@P1']
    }, async () => {
      await pm.dateTimePickerPage.relativePeriodBtn('1-h').click();
      await pm.dateTimePickerPage.expectPickerClosed();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Last 1 hour');
      testLogger.info('In-limit chip applied');
    });
  });
});

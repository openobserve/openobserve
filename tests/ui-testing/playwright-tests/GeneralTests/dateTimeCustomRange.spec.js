const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * E2E coverage for typed relative ranges in the DateTime picker's range field
 * (web/src/components/DateTime.vue, grammar in web/src/utils/dateTimeRangeParse.ts):
 * zero is refused, a huge amount is capped at about ten years per unit, Esc puts
 * back edited text, `m` is minutes and `M` months, weeks read as weeks, and a
 * stream's max_query_range clamps typed text by duration.
 *
 * Parallel-safety: the no-restriction cases share the read-only `e2e_automate`
 * stream (restriction reset in beforeEach); the restriction case owns its own
 * dedicated stream `e2e_datetime_restriction`, so no two tests mutate the same
 * restriction state.
 */

const NO_RESTRICTION_STREAM = 'e2e_automate';
const RESTRICTION_STREAM = 'e2e_datetime_restriction';
const ORG_ID = process.env.ORGNAME || 'default';

test.describe('DateTime Custom Relative Range Validation testcases', () => {
  let pm;

  test.describe('Custom relative value validation (no restriction)', () => {
    test.describe.configure({ mode: 'parallel' });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);

      // Clear any max_query_range a prior run may have leaked onto the shared
      // stream, then select it so useStreamFields resolves the restriction to -1.
      await pm.dashboardMaxQueryRange.resetMaxQueryRange(NO_RESTRICTION_STREAM);
      await pm.logsPage.selectStream(NO_RESTRICTION_STREAM);
      await pm.dateTimePickerPage.openPicker();
      // The pre-load seed (queryRangeRestrictionInHour=100000) stamps a max onto
      // the input until stream fields settle; wait for that to clear.
      await pm.dateTimePickerPage.waitForNoRestriction();
      testLogger.info('Logs picker opened on the unrestricted stream');
    });

    // TC-01
    test('should refuse a zero amount and apply a typed amount on Enter', {
      tag: ['@date-time-custom-range', '@all', '@P0']
    }, async () => {
      testLogger.info('Verifying a zero amount is refused and a valid one applies');

      await pm.dateTimePickerPage.typeRange('0m');
      await pm.dateTimePickerPage.expectPasteErrorNote('invalid-part');
      await pm.dateTimePickerPage.typeRange('2m');
      await pm.dateTimePickerPage.submitRange();
      await pm.dateTimePickerPage.expectPickerClosed();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 2 Minutes');

      testLogger.info('Zero refused, typed amount applied');
    });

    // TC-02
    test('should cap a typed amount at the per-unit ten-year maximum', {
      tag: ['@date-time-custom-range', '@all', '@P0']
    }, async () => {
      testLogger.info('Verifying the per-unit upper cap');

      await pm.dateTimePickerPage.typeRange('5000M');
      await pm.dateTimePickerPage.submitRange();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 120 Months');

      await pm.dateTimePickerPage.openPicker();
      await pm.dateTimePickerPage.typeRange('40000000000000000000m');
      await pm.dateTimePickerPage.submitRange();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 5256000 Minutes');

      testLogger.info('Per-unit upper cap verified');
    });

    // TC-03
    test('should put back the edited text on Esc and keep the applied range', {
      tag: ['@date-time-custom-range', '@all', '@P0']
    }, async () => {
      testLogger.info('Verifying Esc restores edited text before closing');
      const applied = await pm.dateTimePickerPage.getTriggerLabel();

      await pm.dateTimePickerPage.typeRange('45m');
      await pm.dateTimePickerPage.page.keyboard.press('Escape');
      await expect(pm.dateTimePickerPage.panel).toBeVisible();
      await pm.dateTimePickerPage.expectRangeInputValue(applied);

      await pm.dateTimePickerPage.closePickerWithEscape();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toBe(applied);

      testLogger.info('Edited text restored, applied range kept');
    });

    // TC-04
    test('should read m as minutes and M as months', {
      tag: ['@date-time-custom-range', '@all', '@P1']
    }, async () => {
      testLogger.info('Verifying the unit letter keeps its case');

      await pm.dateTimePickerPage.typeRange('15M');
      await pm.dateTimePickerPage.submitRange();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 15 Months');

      await pm.dateTimePickerPage.openPicker();
      await pm.dateTimePickerPage.typeRange('15m');
      await pm.dateTimePickerPage.submitRange();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 15 Minutes');

      testLogger.info('Unit case verified');
    });

    // TC-06
    test('should display weeks as weeks in the trigger label', {
      tag: ['@date-time-custom-range', '@all', '@P2']
    }, async () => {
      testLogger.info('Verifying the week label reads weeks, not a multiplied day count');

      await pm.dateTimePickerPage.typeRange('1w');
      await pm.dateTimePickerPage.submitRange();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 1 Week');

      testLogger.info('Week label verified');
    });
  });

  test.describe('Custom relative value under a max query range restriction', () => {
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
      testLogger.info('Logs picker opened on the restricted stream');
    });

    // TC-05
    test('should clamp typed text by duration and disable chips over a max query range restriction', {
      tag: ['@date-time-custom-range', '@all', '@P1']
    }, async () => {
      testLogger.info('Verifying the duration clamp and disabled chips');

      // The restriction settles asynchronously; the disabled 4h chip is the gate.
      await pm.dateTimePickerPage.expectPresetDisabled('4-h');
      await pm.dateTimePickerPage.expectPresetDisabled('6-h');

      // 90m is within the 2-hour limit, so it is kept as typed.
      await pm.dateTimePickerPage.typeRange('90m');
      await pm.dateTimePickerPage.expectLineMode('read-as');

      // 10h is over it: the line runs the largest whole period the page allows.
      await pm.dateTimePickerPage.typeRange('10h');
      await pm.dateTimePickerPage.expectLineMode('runs');
      await pm.dateTimePickerPage.expectNoteContains("is over this page's limit");
      await pm.dateTimePickerPage.submitRange();
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 2 Hours');

      testLogger.info('Duration clamp and disabled chips verified');
    });
  });
});

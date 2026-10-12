const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * E2E coverage for the DateTime picker's Custom relative range validation
 * (web/src/components/DateTime.vue): the hard minimum of 1 + whole-number
 * truncation, the per-unit ~10-year upper cap, empty-value restore on blur,
 * re-capping when the unit changes, and the max_query_range restriction clamp.
 *
 * The custom value input/unit select had no data-test; these were added in
 * DateTime.vue (testability-only) so OInput/OSelect can derive the `-field` /
 * `-trigger` / `-option` selectors used below.
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
    test('should clamp the custom value to a minimum of 1 and truncate decimals', {
      tag: ['@date-time-custom-range', '@all', '@P0']
    }, async () => {
      testLogger.info('Verifying minimum-of-1 clamp and decimal truncation');

      await pm.dateTimePickerPage.setCustomValue('0');
      await pm.dateTimePickerPage.expectCustomValue('1');
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 1 Minute');

      await pm.dateTimePickerPage.setCustomValue('-5');
      await pm.dateTimePickerPage.expectCustomValue('1');

      await pm.dateTimePickerPage.setCustomValue('2.7');
      await pm.dateTimePickerPage.expectCustomValue('2');
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 2 Minutes');

      testLogger.info('Minimum clamp and truncation verified');
    });

    // TC-02
    test('should cap the custom value at the per-unit ten-year maximum', {
      tag: ['@date-time-custom-range', '@all', '@P0']
    }, async () => {
      testLogger.info('Verifying the per-unit upper cap');

      // Months cap at 120.
      await pm.dateTimePickerPage.selectCustomPeriod('M');
      await pm.dateTimePickerPage.setCustomValue('5000');
      await pm.dateTimePickerPage.expectCustomValue('120');
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 120 Months');

      // Minutes cap at 5,256,000.
      await pm.dateTimePickerPage.selectCustomPeriod('m');
      await pm.dateTimePickerPage.setCustomValue('40000000000000000000');
      await pm.dateTimePickerPage.expectCustomValue('5256000');
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 5256000 Minutes');

      testLogger.info('Per-unit upper cap verified');
    });

    // TC-03
    test('should restore the last valid custom value when the field is emptied on blur', {
      tag: ['@date-time-custom-range', '@all', '@P0']
    }, async () => {
      testLogger.info('Verifying empty value is dropped and restored on blur');

      await pm.dateTimePickerPage.setCustomValue('45');
      await pm.dateTimePickerPage.expectCustomValue('45');

      // Focus snapshots lastValidCustomValue, empty is never applied, blur restores it.
      await pm.dateTimePickerPage.clearCustomValue();
      await pm.dateTimePickerPage.expectCustomValue('45');

      testLogger.info('Empty intermediate state restored to the last valid value');
    });

    // TC-04
    test('should re-cap the custom value when the unit changes', {
      tag: ['@date-time-custom-range', '@all', '@P1']
    }, async () => {
      testLogger.info('Verifying the value re-caps when the unit changes');

      // Minutes cap at 5,256,000.
      await pm.dateTimePickerPage.selectCustomPeriod('m');
      await pm.dateTimePickerPage.setCustomValue('40000000000000000000');
      await pm.dateTimePickerPage.expectCustomValue('5256000');

      // Switching to months (cap 120) re-caps the value without re-typing.
      await pm.dateTimePickerPage.selectCustomPeriod('M');
      await pm.dateTimePickerPage.expectCustomValue('120');
      expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 120 Months');

      testLogger.info('Unit change re-cap verified');
    });

    // TC-06
    test('should display weeks as weeks in the trigger label', {
      tag: ['@date-time-custom-range', '@all', '@P2']
    }, async () => {
      testLogger.info('Verifying the week label reads weeks, not a multiplied day count');

      await pm.dateTimePickerPage.selectCustomPeriod('w');
      await pm.dateTimePickerPage.setCustomValue('1');
      await pm.dateTimePickerPage.expectCustomValue('1');
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
    test('should clamp the custom value and narrow the unit list under a max query range restriction', {
      tag: ['@date-time-custom-range', '@all', '@P1']
    }, async () => {
      testLogger.info('Verifying restriction clamp and narrowed unit list');

      // The restriction settles asynchronously; the narrowed unit list is the gate.
      await pm.dateTimePickerPage.selectCustomPeriodExpectingUnits(
        'h',
        ['s', 'm', 'h'],
        ['d', 'w', 'M']
      );

      // With hours selected, an over-limit value clamps to the 2-hour restriction.
      await pm.dateTimePickerPage.setCustomValue('10');
      await pm.dateTimePickerPage.expectCustomValue('2');

      // Preset cells beyond the 2-hour limit render disabled.
      await pm.dateTimePickerPage.expectPresetDisabled('3-h');
      await pm.dateTimePickerPage.expectPresetDisabled('6-h');

      testLogger.info('Restriction clamp and narrowed unit list verified');
    });
  });
});

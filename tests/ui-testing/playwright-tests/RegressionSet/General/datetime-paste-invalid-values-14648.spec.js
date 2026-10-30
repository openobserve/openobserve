const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

// Each value matches a supported paste format but names a calendar or clock value that does not exist.
const INVALID_PASTES = [
  { label: 'hour 25', text: '2026-01-01T25:00' },
  { label: 'minute 60', text: '2026-01-01T12:60:00' },
  { label: 'month 13', text: '2026/13/01 12:00:00' },
  { label: 'day 32', text: 'Jan 32, 2026 12:00:00' },
  { label: 'Feb 29 in a common year', text: 'Feb 29, 2026 12:00:00' },
  { label: 'Feb 30 with an offset', text: '2026-02-30T10:00:00Z' },
  { label: 'range with an invalid end', text: '2026-01-01T12:00:00 - 2026-01-01T25:00:00' },
];

test.describe("DateTime paste rejects invalid calendar and clock values (#14648)", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.dateTimePickerPage.openPicker();
    await pm.dateTimePickerPage.selectRelativePeriod('15-m');
  });

  for (const { label, text } of INVALID_PASTES) {
    test(`rejects ${label}: "${text}"`, {
      tag: ['@bug-14648', '@P2', '@regression', '@datetime-picker']
    }, async () => {
      const before = await pm.dateTimePickerPage.getTriggerLabel();

      await pm.dateTimePickerPage.seedClipboard(text);
      await pm.dateTimePickerPage.clickPaste();

      await pm.dateTimePickerPage.expectPasteErrorToast();
      expect(await pm.dateTimePickerPage.getTriggerLabel(),
        `Bug #14648: an invalid paste must leave the selected range as it was`
      ).toBe(before);
    });
  }

  test("still accepts a real leap day", {
    tag: ['@bug-14648', '@P2', '@regression', '@datetime-picker']
  }, async () => {
    await pm.dateTimePickerPage.seedClipboard('2028-02-29T10:00:00 - 2028-02-29T11:00:00');
    await pm.dateTimePickerPage.clickPaste();

    await pm.dateTimePickerPage.expectPasteSuccessToast();
    expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('2028/02/29 10:00:00');
  });
});

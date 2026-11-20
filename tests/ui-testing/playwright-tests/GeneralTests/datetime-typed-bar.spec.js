const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * E2E coverage for the typed range bar, the `t` shortcut and zoom out on the logs
 * page. The URL is the contract: logs read `period` before `from`/`to`, so a fixed
 * range must drop `period` and a rolling one must carry it.
 *
 * The clock is never frozen here: a fixed clock makes Vue drop nested listeners.
 */

const LOG_STAMP = '2026-07-23T10:10:00Z';

test.describe("DateTime typed range bar testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${process.env["ZO_BASE_URL"]}/web/logs?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('domcontentloaded');
  });

  test("applies a typed rolling range and writes it to the URL as period", {
    tag: ['@datetime-picker', '@all', '@P0']
  }, async ({ page }) => {
    await pm.dateTimePickerPage.openPicker();
    await expect(pm.dateTimePickerPage.rangeBarInput).toBeFocused();

    await pm.dateTimePickerPage.typeInRangeBar('last 2h');
    await expect(pm.dateTimePickerPage.rangeBarStatus).toHaveAttribute('data-state', 'valid');
    await pm.dateTimePickerPage.rangeBarInput.press('Enter');

    await pm.dateTimePickerPage.expectPickerClosed();
    await expect(page).toHaveURL(/[?&]period=2h(&|$)/);
    expect(await pm.dateTimePickerPage.getTriggerLabel()).toContain('Past 2 Hours');
  });

  test("applies a pasted log stamp as a fixed range without a period", {
    tag: ['@datetime-picker', '@all', '@P1']
  }, async ({ page }) => {
    await pm.dateTimePickerPage.openPicker();
    await pm.dateTimePickerPage.seedClipboard(LOG_STAMP);
    await pm.dateTimePickerPage.clickPaste();

    await pm.dateTimePickerPage.expectRangeBarText(LOG_STAMP, 'valid');
    await pm.dateTimePickerPage.rangeBarInput.press('Enter');

    await pm.dateTimePickerPage.expectPickerClosed();
    await expect(page).toHaveURL(/[?&]from=\d+/);
    await expect(page).toHaveURL(/[?&]to=\d+/);
    await expect(page).not.toHaveURL(/[?&]period=/);
  });

  test("opens the picker with t, but types t inside the query editor", {
    tag: ['@datetime-picker', '@all', '@P1']
  }, async ({ page }) => {
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('t');
    await expect(pm.dateTimePickerPage.panel).toBeVisible();
    await expect(pm.dateTimePickerPage.rangeBarInput).toBeFocused();
    await expect(pm.dateTimePickerPage.rangeBarInput).toHaveValue('');
    await pm.dateTimePickerPage.closePickerWithEscape();

    const editor = page.locator(pm.logsPage.queryEditor);
    await editor.click();
    await page.keyboard.press('t');
    await expect(pm.dateTimePickerPage.panel).toBeHidden();
    await expect(page.locator(pm.logsPage.queryEditorViewLines)).toContainText('t');
  });

  test("zooms a fixed range out and drops period from the URL", {
    tag: ['@datetime-picker', '@all', '@P1']
  }, async ({ page }) => {
    await pm.dateTimePickerPage.prevShiftBtn.click();
    await expect(page).not.toHaveURL(/[?&]period=/);
    const fromBefore = new URL(page.url()).searchParams.get('from');

    await pm.dateTimePickerPage.zoomOutBtn.click();

    await expect(page).not.toHaveURL(/[?&]period=/);
    await expect.poll(() => new URL(page.url()).searchParams.get('from')).not.toBe(fromBefore);
  });
});

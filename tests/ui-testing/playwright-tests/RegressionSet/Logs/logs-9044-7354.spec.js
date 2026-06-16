const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const logData = require('../../../fixtures/log.json');
test.describe('Regression: Scroll Retention on Logs page (#9044)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.goto(`${logData.logsUrl}?org_identifier=${process.env['ORGNAME']}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await pm.logsPage.selectIndexStream('e2e_automate');
    await page.waitForTimeout(1000);

    await pm.logsPage.typeQuery('SELECT * FROM "e2e_automate"');
    await page.waitForTimeout(500);
    await pm.logsPage.selectRunQuery();
    await pm.logsPage.waitForResultsLoaded();

    testLogger.info('Scroll retention test setup completed');
  });

  test('Scroll resets to top when navigating from page 1 to page 2 via page number button', {
    tag: ['@regression', '@scroll', '@pagination', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Testing scroll reset on page 1 -> page 2 via page number click');

    await pm.logsPage.scrollToResultsBottom();
    const scrollAfterScroll = await pm.logsPage.getScrollContainerPosition();
    testLogger.info(`Scrolled to: ${scrollAfterScroll}`);
    expect(scrollAfterScroll).toBeGreaterThan(10);

    await pm.logsPage.clickPageNumber('2');
    const currentPage = await pm.logsPage.getCurrentPageNumber();
    expect(currentPage).toBe('2');

    const scrollTop = await pm.logsPage.getScrollContainerPosition();
    expect(scrollTop).toBeLessThanOrEqual(1);
    testLogger.info('Scroll correctly reset to top on page 2');
  });

  test('Scroll resets to top when navigating from page 2 back to page 1', {
    tag: ['@regression', '@scroll', '@pagination', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Testing scroll reset on page 2 -> page 1');

    await pm.logsPage.clickPageNumber('2');
    const page2Check = await pm.logsPage.getCurrentPageNumber();
    testLogger.info(`Current page: ${page2Check}`);

    await pm.logsPage.scrollToResultsBottom();
    const scrollOnPage2 = await pm.logsPage.getScrollContainerPosition();
    testLogger.info(`Scrolled to on page 2: ${scrollOnPage2}`);
    expect(scrollOnPage2).toBeGreaterThan(10);

    await pm.logsPage.clickPageNumber('1');
    const currentPage = await pm.logsPage.getCurrentPageNumber();
    expect(currentPage).toBe('1');

    const scrollTop = await pm.logsPage.getScrollContainerPosition();
    expect(scrollTop).toBeLessThanOrEqual(1);
    testLogger.info('Scroll correctly reset to top on page 1');
  });

  test('Scroll resets to top when navigating via Next Page (>) button', {
    tag: ['@regression', '@scroll', '@pagination', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Testing scroll reset via Next Page (>) button');

    await pm.logsPage.scrollToResultsBottom();
    const scrollBefore = await pm.logsPage.getScrollContainerPosition();
    testLogger.info(`Scrolled to: ${scrollBefore}`);
    expect(scrollBefore).toBeGreaterThan(10);

    await pm.logsPage.clickNextPage();
    const currentPage = await pm.logsPage.getCurrentPageNumber();
    expect(currentPage).toBe('2');

    const scrollTop = await pm.logsPage.getScrollContainerPosition();
    expect(scrollTop).toBeLessThanOrEqual(1);
    testLogger.info('Scroll correctly reset to top after Next Page button');
  });
});


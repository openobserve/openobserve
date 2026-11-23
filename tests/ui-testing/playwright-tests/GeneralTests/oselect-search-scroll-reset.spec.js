// ENT#2997: typing a search into a long, scrolled dropdown shows the list from its top, so the best matches are visible.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('OSelect search resets the list scroll (ENT#2997)', { tag: ['@generalTests', '@regression', '@P2'] }, () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test('a search typed into the scrolled timezone list starts at the top match', async ({ page }) => {
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${process.env.ORGNAME}`);
    const picker = new PageManager(page).dateTimePickerPage;
    await picker.openTimezoneList();

    await expect(picker.timezoneScrollList).toBeVisible();
    const scrolled = await picker.scrollTimezoneListToBottom();
    expect(scrolled, 'the full timezone list must be long enough to scroll').toBeGreaterThan(500);

    // a term that still matches a list taller than the box, so the browser alone would not clamp to 0
    await picker.searchTimezones('America');
    const options = picker.timezoneOptions;
    await expect(options.first()).toBeAttached({ timeout: 10000 });
    const geometry = await picker.timezoneListGeometry();
    expect(geometry.max, 'the filtered list is still scrollable').toBeGreaterThan(0);
    await expect.poll(() => picker.timezoneListScrollTop(), { timeout: 5000 }).toBe(0);

    const firstValue = await options.first().getAttribute('data-test-value');
    expect(firstValue).toMatch(/^America\//);
    await expect(options.first()).toBeInViewport();
    await page.keyboard.press('Escape');
  });
});

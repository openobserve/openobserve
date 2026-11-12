const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");

// o2-enterprise#3429: the Applies to filter took the whole toolbar row, so the
// search box had zero width. The filter now uses the sm field width (12.5rem).
const FILTER_WIDTH_PX = 200;
const WIDTHS = [
  { width: 390, height: 844, minSearch: 150 },
  { width: 1280, height: 800, minSearch: 200 },
  { width: 1920, height: 1080, minSearch: 200 },
];

const overlaps = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe("Alert Templates toolbar layout", () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  for (const vp of WIDTHS) {
    test(
      `shows a usable search box next to a fixed-width filter at ${vp.width}px`,
      { tag: ["@templates-toolbar", "@all"] },
      async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await pm.alertTemplatesPage.navigateToTemplates();
        await pm.alertTemplatesPage.waitForTemplateListReady();

        const { filter, search, refresh } = await pm.alertTemplatesPage.getToolbarBoxes();
        testLogger.info("Toolbar boxes", { width: vp.width, filter, search, refresh });

        expect(filter).not.toBeNull();
        expect(search).not.toBeNull();
        expect(Math.abs(filter.width - FILTER_WIDTH_PX)).toBeLessThanOrEqual(1);
        expect(search.width).toBeGreaterThanOrEqual(vp.minSearch);
        expect(search.x).toBeGreaterThanOrEqual(0);
        expect(search.x + search.width).toBeLessThanOrEqual(vp.width);
        expect(overlaps(search, filter)).toBe(false);
        if (refresh) expect(overlaps(search, refresh)).toBe(false);
      },
    );
  }
});

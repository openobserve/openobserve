const { test, expect } = require('@playwright/test');
const testLogger = require('../../utils/test-logger.js');

const HEAVY_CHUNKS = ['monaco-editor', 'highlight.js', 'gridstack', 'echarts'];

test.describe("Login page entry payload", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("does not download the editor, dashboard or markdown stacks @P1 @regression @loginPerf", async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const requested = [];
    page.on('request', (request) => requested.push(request.url()));

    await page.goto(`${process.env["ZO_BASE_URL"]}/web/login`);
    await page.waitForLoadState('networkidle');

    const heavy = requested.filter((url) => HEAVY_CHUNKS.some((name) => url.includes(name)));
    expect(heavy, `The login page pulled in heavy chunks: ${heavy.join(', ')}`).toEqual([]);
  });
});

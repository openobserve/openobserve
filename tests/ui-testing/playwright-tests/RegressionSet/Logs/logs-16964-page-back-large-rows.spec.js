const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const {
  ingestRows,
  waitForSearchable,
} = require("../../utils/auto-run-helpers.js");
const { deleteStream } = require("../../utils/traces-api.js");
const { getOrgIdentifier } = require("../../utils/cloud-auth.js");

const ORG = getOrgIdentifier() || "default";
const RID = Math.random().toString(36).slice(2, 8);
const STREAM = `e2e_16964_${RID}`;
const PAGE_SIZE = 100;
const TOTAL = 3 * PAGE_SIZE;
// 100 rows of ~20 KB make a page over the 1 MB streaming chunk, so one page arrives in several chunks.
const PAD = "p".repeat(20000);

test.describe("Paging back over large rows keeps the whole page (#16964)", () => {
  test.describe.configure({ mode: "serial" });
  let pm;

  test.beforeAll(async ({ request }) => {
    const now = Date.now();
    for (let batch = 0; batch < TOTAL / 50; batch++) {
      const rows = Array.from({ length: 50 }, (_, i) => {
        const seq = batch * 50 + i;
        return { _timestamp: (now - (seq + 1) * 1000) * 1000, seq, pad: PAD };
      });
      await ingestRows(request, ORG, STREAM, rows);
    }
    await waitForSearchable(request, ORG, STREAM, TOTAL);
  });

  test.afterAll(async ({ request }) => {
    await deleteStream(request, STREAM, { type: "logs" });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test(
    "page 2 then back to page 1 holds all the rows of page 1",
    { tag: ["@bug-16964", "@P1", "@regression", "@logsRegression"] },
    async () => {
      // Only seq is shown, so the browser does not lay out 2 MB of padding per page.
      await pm.logsPage.openLogsWithParams(STREAM, {
        period: "1h",
        sql_mode: "false",
        quick_mode: "false",
        rows: String(PAGE_SIZE),
        columns: Buffer.from(JSON.stringify(["seq"])).toString("base64"),
      });
      await pm.logsPage.runQueryAndWaitForResults();
      expect(
        await pm.logsPage.getResultHitsCount(),
        "Setup: the first run holds a full page",
      ).toBe(PAGE_SIZE);

      await pm.logsPage.clickPageNumber(2);
      await expect
        .poll(() => pm.logsPage.getVisibleResultTitleText(), { timeout: 30000 })
        .toMatch(/^101 to 200 out of 300 events/);
      expect(await pm.logsPage.getResultHitsCount()).toBe(PAGE_SIZE);

      await pm.logsPage.clickPageNumber(1);
      await expect
        .poll(() => pm.logsPage.getVisibleResultTitleText(), { timeout: 30000 })
        .toMatch(/^1 to 100 out of 300 events/);
      expect(await pm.logsPage.getResultHitsCount()).toBe(PAGE_SIZE);
    },
  );
});

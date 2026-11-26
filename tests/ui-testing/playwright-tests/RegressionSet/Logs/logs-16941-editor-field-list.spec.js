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
const STREAM = `e2e_16941_${RID}`;
const CODE_FIELD = `code_${RID}`;
const SERVICES = ["alpha", "beta", "gamma"];
const ORDERS = ["o1", "o2"];
const ROWS_PER_PAIR = 2;

test.describe("Logs editor and field list keep the user's query (#16941)", () => {
  test.describe.configure({ mode: "serial" });
  let pm;

  test.beforeAll(async ({ request }) => {
    const now = Date.now();
    const rows = [];
    for (const svc of SERVICES)
      for (const order of ORDERS)
        for (let i = 0; i < ROWS_PER_PAIR; i++)
          rows.push({
            _timestamp: (now - (rows.length + 1) * 1000) * 1000,
            level: "info",
            svc_name: svc,
            order,
            [CODE_FIELD]: 200,
            message: `${RID} ${svc} ${order} ${i}`,
          });
    await ingestRows(request, ORG, STREAM, rows);
    await waitForSearchable(request, ORG, STREAM, rows.length);
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
    "removing the WHERE of a SQL query that matched nothing keeps the no-match message until Run",
    { tag: ["@bug-16941", "@P2", "@regression", "@logsRegression"] },
    async ({ page }) => {
      await pm.logsPage.openLogsWithSqlQuery(
        STREAM,
        `SELECT * FROM "${STREAM}" WHERE level = 'nomatch'`,
        "1h",
      );
      await pm.logsPage.runQueryAndWaitForResults();
      await expect(pm.logsPage.noEventsCopy("withFilters")).toBeVisible({
        timeout: 30000,
      });

      const unfiltered = `SELECT * FROM "${STREAM}"`;
      await pm.logsPage.setQueryEditorContent(unfiltered);
      await expect
        .poll(async () => pm.logsPage.getQueryEditorTextCollapsed())
        .toBe(unfiltered);
      // An armed Run button means the debounced edit has reached the search state the copy used to read.
      await pm.logsPage.expectRunPending();
      await expect(pm.logsPage.noEventsCopy("withFilters")).toBeVisible();
      await expect(pm.logsPage.noEventsCopy("noFilters")).toHaveCount(0);
      await expect(pm.logsPage.noEventsCopy("outOfRange")).toHaveCount(0);
    },
  );

  test(
    "ticking a second field-list value next to an order filter ORs it with the first",
    { tag: ["@bug-16941", "@P2", "@regression", "@logsRegression"] },
    async ({ page }) => {
      await pm.logsPage.openLogsWithQueryText(STREAM, "order = 'o1'");
      await pm.logsPage.runQueryAndWaitForResults();
      expect(await pm.logsPage.getResultHitsCount()).toBe(
        SERVICES.length * ROWS_PER_PAIR,
      );

      await pm.logsPage.clickFieldExpandButton("svc_name");
      await pm.logsPage.fieldValueCheckbox("svc_name", "alpha").click();
      await expect
        .poll(async () => pm.logsPage.getQueryEditorTextCollapsed())
        .toMatch(/svc_name = 'alpha'/);
      await pm.logsPage.fieldValueCheckbox("svc_name", "beta").click();
      await expect
        .poll(async () => pm.logsPage.getQueryEditorTextCollapsed(), {
          timeout: 15000,
        })
        .toMatch(
          /^\(? ?order = 'o1' ?\)? AND \(svc_name = 'alpha' OR svc_name = 'beta'\)$/,
        );

      await pm.logsPage.runQueryAndWaitForResults();
      expect(await pm.logsPage.getResultHitsCount()).toBe(2 * ROWS_PER_PAIR);
    },
  );
});

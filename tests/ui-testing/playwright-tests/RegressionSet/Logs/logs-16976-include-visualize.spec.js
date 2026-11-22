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
const STREAM = `e2e_16976_${RID}`;
const LEVELS = { error: 500, warn: 404, info: 200 };
const SERVICES = ["alpha", "beta"];
const ROWS_PER_PAIR = 3;

test.describe("Logs Include and Visualize keep the filter's meaning (#16976)", () => {
  test.describe.configure({ mode: "serial" });
  let pm;

  test.beforeAll(async ({ request }) => {
    const now = Date.now();
    const rows = [];
    for (const [level, status] of Object.entries(LEVELS))
      for (const svc of SERVICES)
        for (let i = 0; i < ROWS_PER_PAIR; i++)
          rows.push({
            _timestamp: (now - (rows.length + 1) * 1000) * 1000,
            level,
            status,
            svc_name: svc,
            message: `${RID} ${level} ${svc} ${i}`,
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
    "Include on a SQL query with OR brackets the OR before adding the AND",
    { tag: ["@bug-16976", "@P2", "@regression", "@logsRegression"] },
    async () => {
      await pm.logsPage.openLogsWithSqlQuery(
        STREAM,
        `SELECT * FROM "${STREAM}" WHERE level = 'error' OR level = 'warn'`,
        "1h",
      );
      await pm.logsPage.runQueryAndWaitForResults();
      expect(await pm.logsPage.getResultHitsCount()).toBe(
        2 * SERVICES.length * ROWS_PER_PAIR,
      );

      await pm.logsPage.openLogDetailForRowContaining(`${RID} error alpha`);
      await pm.logsPage.includeLogDetailJsonFieldValue("svc_name");
      await pm.logsPage.closeLogDetailIfOpen();
      await expect
        .poll(async () => pm.logsPage.getQueryEditorTextCollapsed(), {
          timeout: 15000,
        })
        .toBe(
          `SELECT * FROM "${STREAM}" WHERE (level = 'error' OR level = 'warn') AND svc_name = 'alpha'`,
        );

      await pm.logsPage.runQueryAndWaitForResults();
      expect(await pm.logsPage.getResultHitsCount()).toBe(2 * ROWS_PER_PAIR);
    },
  );

  for (const [label, filter, matching] of [
    ["NOT", "NOT (level = 'info')", /NOT/i],
    ["BETWEEN", "status BETWEEN 400 AND 450", /BETWEEN 400 AND 450/i],
  ]) {
    test(
      `Visualize on a ${label} filter warns and charts the filtered rows, not every row`,
      { tag: ["@bug-16976", "@P2", "@regression", "@logsRegression"] },
      async ({ page }) => {
        await pm.logsPage.openLogsWithQueryText(STREAM, filter);
        await pm.logsPage.ensureQueryEditorMode();
        await pm.logsPage.runQueryAndWaitForResults();
        await pm.logsPage.expectNoQueryInFlight(60000);

        const sent = pm.logsPage.trackSearchRequests({ stream: STREAM });
        const notice = pm.logsPage.buildIncompleteFilterNotice();
        await pm.logsPage.clickBuildToggle();
        await expect
          .poll(async () => sent.length > 0 || (await notice.isVisible()), {
            timeout: 30000,
            message: "Visualize must chart or explain why it cannot",
          })
          .toBe(true);
        await pm.logsPage.expectNoQueryInFlight(60000);
        await pm.logsPage.expectTrackedSearchesSettled(sent);
        expect(
          sent.map((r) => r.sql).filter((sql) => !matching.test(sql)),
          "the builder must not chart the stream without the filter",
        ).toEqual([]);
        await expect(notice).toBeVisible();

        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectTrackedSearchesSettled(sent);
        const start = sent.length;
        await pm.logsPage.clickVisualizeRefresh();
        await expect
          .poll(() => sent.length, {
            timeout: 30000,
            message: "Run in Custom must send a chart query",
          })
          .toBeGreaterThan(start);
        await pm.logsPage.expectTrackedSearchesSettled(sent);
        const custom = sent.slice(start).map((r) => r.sql);
        expect(
          custom.every((sql) => matching.test(sql)),
          `chart queries sent: ${custom.join(" | ")}`,
        ).toBe(true);

        await pm.logsPage.clickLogsToggle();
        await expect
          .poll(async () => pm.logsPage.getQueryEditorTextCollapsed())
          .toBe(filter);
      },
    );
  }
});

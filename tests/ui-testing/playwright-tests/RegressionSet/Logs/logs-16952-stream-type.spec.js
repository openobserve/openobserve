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
const {
  ingestOtlpTraces,
  waitForStreamRows,
  deleteStream,
} = require("../../utils/traces-api.js");
const {
  simpleTracesPayload,
} = require("../../../pages/tracesPages/tracesFixtures.js");
const { getOrgIdentifier } = require("../../utils/cloud-auth.js");
const { selectLogsViewMode } = require("../../../pages/commonActions.js");

const ORG = getOrgIdentifier() || "default";
const RID = Math.random().toString(36).slice(2, 8);
// One name shared by a logs stream and a traces stream, so a wrong stream type reads the other stream.
const STREAM = `e2e_16952_type_${RID}`;
const LOG_MARKER = `logs-16952-${RID}`;
const LOG_ROWS = 3;
const SPANS = 4;

const LINK_PARAMS = {
  period: "15m",
  refresh: "0",
  sql_mode: "false",
  quick_mode: "false",
  show_histogram: "false",
};

test.describe("Logs uses the stream type of the stream it shows (#16952)", () => {
  test.describe.configure({ mode: "serial" });
  let pm;

  test.beforeAll(async ({ request }) => {
    await ingestRows(
      request,
      ORG,
      STREAM,
      Array.from({ length: LOG_ROWS }, (_, i) => ({
        _timestamp: (Date.now() - (i + 1) * 1000) * 1000,
        level: "info",
        message: `${LOG_MARKER} ${i}`,
      })),
    );
    await ingestOtlpTraces(
      request,
      STREAM,
      simpleTracesPayload(RID, `svc-16952-${RID}`, SPANS),
    );
    await waitForSearchable(request, ORG, STREAM, LOG_ROWS);
    await waitForStreamRows(request, STREAM, SPANS);
  });

  test.afterAll(async ({ request }) => {
    await deleteStream(request, STREAM, { type: "logs" });
    await deleteStream(request, STREAM, { type: "traces" });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test(
    "Drill down on a traces stream searches the traces stream",
    {
      tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await page.goto(
        pm.logsPage.logsLink(STREAM, { streamType: "traces", ...LINK_PARAMS }),
      );
      await pm.logsPage.waitForSearchResultRows(60000);
      await pm.logsPage.expectNoQueryInFlight(60000);

      const sent = pm.logsPage.trackSearchRequests();
      await selectLogsViewMode(page, "drilldown");
      await expect
        .poll(() => sent.filter((r) => r.searchType === "insights").length, {
          timeout: 60000,
          message: "Drill down must send its insight searches",
        })
        .toBeGreaterThan(0);
      await expect
        .poll(
          () =>
            sent.filter((r) => r.searchType === "insights" && !r.done).length,
          { timeout: 60000, message: "insight searches must finish" },
        )
        .toBe(0);

      const insights = sent.filter((r) => r.searchType === "insights");
      expect(
        insights.map((r) => r.type),
        "every insight search must carry the traces type",
      ).toEqual(insights.map(() => "traces"));
      await expect(pm.logsPage.searchStreamNotFoundMessage()).toHaveCount(0);
    },
  );

  test(
    "Build on a traces stream keeps the traces stream",
    {
      tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await page.goto(
        pm.logsPage.logsLink(STREAM, { streamType: "traces", ...LINK_PARAMS }),
      );
      await pm.logsPage.waitForSearchResultRows(60000);
      await pm.logsPage.expectNoQueryInFlight(60000);

      await selectLogsViewMode(page, "build");
      await pm.logsPage.expectBuildTabSelected(30000);
      await pm.logsPage.expectBuildStreamType("traces", 30000);
      await pm.logsPage.expectBuildStreamSelected(STREAM);
    },
  );

  test(
    "a logs link opens the logs stream, not the same-name traces stream",
    {
      tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await page.goto(
        pm.logsPage.logsLink(STREAM, { streamType: "traces", ...LINK_PARAMS }),
      );
      await pm.logsPage.waitForSearchResultRows(60000);
      await pm.logsPage.expectNoQueryInFlight(60000);

      await pm.logsPage.navigateToHome();
      await page.waitForURL((u) => !u.pathname.includes("/logs"), {
        timeout: 15000,
      });
      const sent = pm.logsPage.trackSearchRequests();
      await pm.commonActions.routerPush(
        pm.logsPage.logsLink(STREAM, LINK_PARAMS),
      );

      await pm.logsPage.expectResultRowWithText(LOG_MARKER);
      const hits = sent.filter(
        (r) => r.searchType === "ui" && r.sql.includes(STREAM),
      );
      expect(hits.length, "the link must run a search").toBeGreaterThan(0);
      expect(
        hits.map((r) => r.type),
        "the link must search the logs stream",
      ).toEqual(hits.map(() => "logs"));
    },
  );
});

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
const { getOrgIdentifier } = require("../../utils/cloud-auth.js");
const { encodeUrlSafeBase64 } = require("../../../pages/logsPages/logsPage.js");
const {
  oneSpanPerServicePayload,
} = require("../../../pages/tracesPages/tracesFixtures.js");

const ORG = getOrgIdentifier() || "default";
const RID = Math.random().toString(36).slice(2, 8);
const LOGS_STREAM = `e2e_16952_nav_${RID}`;
const TRACES_STREAM = `e2e_16952_nav_tr_${RID}`;
const INFO_ROWS = 3;
const ERROR_ROWS = 2;
const FILTER_A = "level='info'";
const FILTER_B = "level='error'";
// The sent SQL is re-printed with spaces around '='.
const SQL_A = /level\s*=\s*'info'/;
const SQL_B = /level\s*=\s*'error'/;

const LINK_PARAMS = {
  refresh: "0",
  sql_mode: "false",
  quick_mode: "false",
  show_histogram: "false",
};
test.describe("Logs and Traces follow in-app links and history (#16952)", () => {
  test.describe.configure({ mode: "serial" });
  let pm;

  test.beforeAll(async ({ request }) => {
    const now = Date.now();
    const rows = [
      ...Array.from({ length: INFO_ROWS }, (_, i) => ({
        _timestamp: (now - (i + 1) * 1000) * 1000,
        level: "info",
        message: `lvl-info ${RID} ${i}`,
      })),
      ...Array.from({ length: ERROR_ROWS }, (_, i) => ({
        _timestamp: (now - (i + 10) * 1000) * 1000,
        level: "error",
        message: `lvl-error ${RID} ${i}`,
      })),
    ];
    await ingestRows(request, ORG, LOGS_STREAM, rows);
    await waitForSearchable(request, ORG, LOGS_STREAM, INFO_ROWS + ERROR_ROWS);

    await ingestOtlpTraces(
      request,
      TRACES_STREAM,
      oneSpanPerServicePayload(["svc-a", "svc-b"]),
    );
    await waitForStreamRows(request, TRACES_STREAM, 2);
  });

  test.afterAll(async ({ request }) => {
    await deleteStream(request, LOGS_STREAM, { type: "logs" });
    await deleteStream(request, TRACES_STREAM, { type: "traces" });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test(
    "an in-app link into Logs opens the search it asks for, not the previous one",
    {
      tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await page.goto(
        pm.logsPage.logsLink(LOGS_STREAM, {
          period: "15m",
          ...LINK_PARAMS,
          query: FILTER_A,
        }),
      );
      await pm.logsPage.expectResultRowsAllContain("lvl-info", INFO_ROWS);
      await pm.logsPage.expectNoQueryInFlight(60000);
      await pm.commonActions.markDocument();

      await pm.logsPage.navigateToHome();
      await page.waitForURL((u) => !u.pathname.includes("/logs"), {
        timeout: 15000,
      });
      const tracked = pm.logsPage.trackSearchRequests({ stream: LOGS_STREAM });
      await pm.commonActions.routerPush(
        pm.logsPage.logsLink(LOGS_STREAM, {
          period: "2h",
          ...LINK_PARAMS,
          query: FILTER_B,
        }),
      );

      await pm.logsPage.expectResultRowsAllContain("lvl-error", ERROR_ROWS);
      expect((await pm.logsPage.getQueryEditorText()).trim()).toBe(FILTER_B);
      await pm.logsPage.expectDateTimeButtonText("2 Hours");
      const sent = pm.logsPage.hitSearchSql(tracked);
      expect(sent.length, "the link must run a search").toBeGreaterThan(0);
      expect(
        sent.every((sql) => SQL_B.test(sql)),
        `searches sent: ${sent.join(" | ")}`,
      ).toBe(true);
      await pm.commonActions.expectSameDocument();
    },
  );

  test(
    "Back and Forward restore the results of each search",
    {
      tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await page.goto(
        pm.logsPage.logsLink(LOGS_STREAM, {
          period: "15m",
          ...LINK_PARAMS,
          query: FILTER_A,
        }),
      );
      await pm.logsPage.expectResultRowsAllContain("lvl-info", INFO_ROWS);
      await pm.logsPage.expectNoQueryInFlight(60000);
      await pm.commonActions.markDocument();

      await pm.logsPage.fillQueryEditor(FILTER_B);
      await pm.logsPage.runPendingQuery();
      await pm.logsPage.expectResultRowsAllContain("lvl-error", ERROR_ROWS);
      await pm.logsPage.expectNoQueryInFlight(60000);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("query"))
        .toBe(encodeUrlSafeBase64(FILTER_B));

      let tracked = pm.logsPage.trackSearchRequests({ stream: LOGS_STREAM });
      await page.goBack();
      await pm.logsPage.expectResultRowsAllContain("lvl-info", INFO_ROWS);
      expect((await pm.logsPage.getQueryEditorText()).trim()).toBe(FILTER_A);
      let sent = pm.logsPage.hitSearchSql(tracked);
      expect(sent.length, "Back must run the earlier search").toBeGreaterThan(
        0,
      );
      expect(
        sent.every((sql) => SQL_A.test(sql)),
        `searches sent: ${sent.join(" | ")}`,
      ).toBe(true);
      await pm.logsPage.expectNoQueryInFlight(60000);

      tracked = pm.logsPage.trackSearchRequests({ stream: LOGS_STREAM });
      await page.goForward();
      await pm.logsPage.expectResultRowsAllContain("lvl-error", ERROR_ROWS);
      expect((await pm.logsPage.getQueryEditorText()).trim()).toBe(FILTER_B);
      sent = pm.logsPage.hitSearchSql(tracked);
      expect(sent.length, "Forward must run the later search").toBeGreaterThan(
        0,
      );
      expect(
        sent.every((sql) => SQL_B.test(sql)),
        `searches sent: ${sent.join(" | ")}`,
      ).toBe(true);
      await pm.commonActions.expectSameDocument();
    },
  );

  test(
    "a Traces link with only stream and time clears the previous filter",
    {
      tag: ["@bug-16952", "@P1", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      const tracesLink = `/web/traces?org_identifier=${ORG}&stream=${TRACES_STREAM}&period=15m`;
      const first = pm.tracesPage.trackTraceSearchFilters(TRACES_STREAM);
      await page.goto(
        `${tracesLink}&query=${encodeUrlSafeBase64("service_name='svc-a'")}`,
      );
      await expect
        .poll(() => first.some((filter) => filter.includes("svc-a")), {
          timeout: 60000,
          message: "Precondition: the svc-a filter must be searched",
        })
        .toBe(true);
      await pm.tracesPage.expectTraceResultWithOperationName("op-svc-a");
      await pm.commonActions.markDocument();

      await pm.logsPage.navigateToHome();
      await page.waitForURL((u) => !u.pathname.includes("/traces"), {
        timeout: 15000,
      });
      const sent = pm.tracesPage.trackTraceSearchFilters(TRACES_STREAM);
      await pm.commonActions.routerPush(tracesLink);

      await expect
        .poll(
          async () => (await pm.tracesPage.getQueryEditorContent()).trim(),
          { timeout: 30000 },
        )
        .toBe("");
      expect(new URL(page.url()).searchParams.get("query")).toBeNull();
      await pm.tracesPage.runSearch();
      await expect
        .poll(() => sent.length, {
          timeout: 60000,
          message: "Run must send a traces search",
        })
        .toBeGreaterThan(0);
      expect(
        sent.some((filter) => filter.includes("svc-a")),
        `filters sent: ${sent.join(" | ")}`,
      ).toBe(false);
      await pm.tracesPage.expectTraceResultWithOperationName("op-svc-b");
      await pm.commonActions.expectSameDocument();
    },
  );
});

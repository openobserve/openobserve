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
  stringAttr,
} = require("../../utils/traces-api.js");
const { getOrgIdentifier } = require("../../utils/cloud-auth.js");
const { selectLogsViewMode } = require("../../../pages/commonActions.js");

const ORG = getOrgIdentifier() || "default";
const RID = Math.random().toString(36).slice(2, 8);
// One name shared by a logs stream and a traces stream, so a wrong stream type reads the other stream.
const STREAM = `e2e_16952_type_${RID}`;
const LOG_MARKER = `logs-16952-${RID}`;
const LOG_ROWS = 3;
const SPANS = 4;

const logsUrl = (type) =>
  `/web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=${type}&period=15m` +
  "&refresh=0&sql_mode=false&quick_mode=false&show_histogram=false";

function tracesPayload() {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const traceId = `${RID}`
    .padEnd(32, "0")
    .replace(/[^0-9a-f]/g, "a")
    .slice(0, 32);
  const spans = Array.from({ length: SPANS }, (_, i) => ({
    traceId,
    spanId: `${i + 1}`.padStart(16, "0"),
    name: `op-${i}`,
    kind: 2,
    startTimeUnixNano: String(nowNs - BigInt((i + 2) * 1_000_000_000)),
    endTimeUnixNano: String(nowNs - BigInt((i + 1) * 1_000_000_000)),
    attributes: [],
    status: {},
  }));
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [stringAttr("service.name", `svc-16952-${RID}`)],
        },
        scopeSpans: [{ scope: { name: "e2e" }, spans }],
      },
    ],
  };
}

function searchRequests(page) {
  const sent = [];
  const settle = (req) => {
    const entry = sent.find((r) => r.req === req);
    if (entry) entry.done = true;
  };
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (req.method() !== "POST" || !/\/_search(_stream)?$/.test(url.pathname))
      return;
    let sql = "";
    try {
      const body = JSON.parse(req.postData() || "{}");
      const raw = String((body.query && body.query.sql) ?? body.sql ?? "");
      sql =
        body.encoding === "base64"
          ? Buffer.from(
              raw.replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "="),
              "base64",
            ).toString("utf8")
          : raw;
    } catch {
      /* non-JSON body */
    }
    sent.push({
      req,
      done: false,
      type: url.searchParams.get("type"),
      searchType: url.searchParams.get("search_type"),
      sql,
    });
  });
  return sent;
}

// Kept-alive in-app navigation: the same router.push a link inside the app makes, with no page load.
async function routerPush(page, path) {
  await page.evaluate(
    (to) =>
      document
        .querySelector("#app")
        .__vue_app__.config.globalProperties.$router.push(to),
    path.replace(/^\/web/, ""),
  );
}

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
    await ingestOtlpTraces(request, STREAM, tracesPayload());
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
      await page.goto(logsUrl("traces"));
      await pm.logsPage.waitForSearchResultRows(60000);
      await pm.logsPage.expectNoQueryInFlight(60000);

      const sent = searchRequests(page);
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
      await page.goto(logsUrl("traces"));
      await pm.logsPage.waitForSearchResultRows(60000);
      await pm.logsPage.expectNoQueryInFlight(60000);

      await selectLogsViewMode(page, "build");
      await pm.logsPage.expectBuildTabSelected(30000);
      await pm.logsPage.expectBuildStreamType(/traces/i, 30000);
      await pm.logsPage.expectBuildStream(STREAM);
    },
  );

  test(
    "a logs link opens the logs stream, not the same-name traces stream",
    {
      tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await page.goto(logsUrl("traces"));
      await pm.logsPage.waitForSearchResultRows(60000);
      await pm.logsPage.expectNoQueryInFlight(60000);

      await pm.logsPage.navigateToHome();
      await page.waitForURL((u) => !u.pathname.includes("/logs"), {
        timeout: 15000,
      });
      const sent = searchRequests(page);
      await routerPush(page, logsUrl("logs"));

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

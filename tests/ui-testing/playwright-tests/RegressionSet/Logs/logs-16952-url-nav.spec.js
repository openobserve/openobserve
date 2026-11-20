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

const unb64 = (s) =>
  Buffer.from(
    s.replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "="),
    "base64",
  ).toString("utf8");
const b64 = (s) =>
  Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, ".");
const logsLink = (filter, period = "15m") =>
  `/web/logs?org_identifier=${ORG}&stream=${LOGS_STREAM}&stream_type=logs&period=${period}` +
  `&refresh=0&sql_mode=false&quick_mode=false&show_histogram=false&query=${b64(filter)}`;

function hitSearches(page, stream) {
  const sent = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (req.method() !== "POST" || !/\/_search(_stream)?$/.test(url.pathname))
      return;
    if (
      url.searchParams.get("search_type") !== "ui" ||
      url.searchParams.get("is_ui_histogram") === "true"
    )
      return;
    let sql = "";
    try {
      const body = JSON.parse(req.postData() || "{}");
      const q =
        body.query && typeof body.query === "object" ? body.query : body;
      if (q.size === 0) return;
      sql =
        body.encoding === "base64"
          ? unb64(String(q.sql ?? ""))
          : String(q.sql ?? "");
    } catch {
      /* non-JSON body */
    }
    if (sql.includes(stream)) sent.push(sql);
  });
  return sent;
}

// Traces searches are a span-list SQL POST or a traces/latest GET whose `filter` param carries the editor text.
function traceSearches(page, stream) {
  const sent = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (
      url.pathname.endsWith(`/${stream}/traces/latest_stream`) ||
      url.pathname.endsWith(`/${stream}/traces/latest`)
    ) {
      sent.push(url.searchParams.get("filter") ?? "");
      return;
    }
    if (
      req.method() !== "POST" ||
      !/\/_search(_stream)?$/.test(url.pathname) ||
      url.searchParams.get("type") !== "traces"
    )
      return;
    if (url.searchParams.get("is_ui_histogram") === "true") return;
    let sql = "";
    try {
      const body = JSON.parse(req.postData() || "{}");
      const q =
        body.query && typeof body.query === "object" ? body.query : body;
      sql =
        body.encoding === "base64"
          ? unb64(String(q.sql ?? ""))
          : String(q.sql ?? "");
    } catch {
      /* non-JSON body */
    }
    if (
      url.searchParams.get("search_type") === "ui" &&
      sql.includes(stream) &&
      !/count\s*\(/i.test(sql)
    )
      sent.push(sql);
  });
  return sent;
}

// The same router.push an in-app link makes: the kept-alive page is re-activated, not reloaded.
async function routerPush(page, path) {
  await page.evaluate(
    (to) =>
      document
        .querySelector("#app")
        .__vue_app__.config.globalProperties.$router.push(to),
    path.replace(/^\/web/, ""),
  );
}

async function markDocument(page) {
  await page.evaluate(() => {
    window.__e2e16952 = "same-document";
  });
}

async function expectSameDocument(page) {
  expect(
    await page.evaluate(() => window.__e2e16952),
    "navigation must not reload the page",
  ).toBe("same-document");
}

async function expectRowsAre(pm, level, count) {
  await expect
    .poll(
      async () => {
        const rows = await pm.logsPage.getResultRowTexts();
        return {
          count: rows.length,
          allMatch: rows.every((r) => r.includes(`lvl-${level}`)),
        };
      },
      {
        timeout: 60000,
        message: `the grid must show the ${count} ${level} rows`,
      },
    )
    .toEqual({ count, allMatch: true });
}

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

    const nowNs = BigInt(now) * 1_000_000n;
    const traceId = (i) => `${i}`.padStart(32, "c");
    const resource = (svc, i) => ({
      resource: { attributes: [stringAttr("service.name", svc)] },
      scopeSpans: [
        {
          scope: { name: "e2e" },
          spans: [
            {
              traceId: traceId(i),
              spanId: `${i}`.padStart(16, "0"),
              name: `op-${svc}`,
              kind: 2,
              startTimeUnixNano: String(nowNs - 3_000_000_000n),
              endTimeUnixNano: String(nowNs - 2_000_000_000n),
              attributes: [],
              status: {},
            },
          ],
        },
      ],
    });
    await ingestOtlpTraces(request, TRACES_STREAM, {
      resourceSpans: [resource("svc-a", 1), resource("svc-b", 2)],
    });
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
      await page.goto(logsLink(FILTER_A));
      await expectRowsAre(pm, "info", INFO_ROWS);
      await pm.logsPage.expectNoQueryInFlight(60000);
      await markDocument(page);

      await pm.logsPage.navigateToHome();
      await page.waitForURL((u) => !u.pathname.includes("/logs"), {
        timeout: 15000,
      });
      const sent = hitSearches(page, LOGS_STREAM);
      await routerPush(page, logsLink(FILTER_B, "2h"));

      await expectRowsAre(pm, "error", ERROR_ROWS);
      expect((await pm.logsPage.getQueryEditorText()).trim()).toBe(FILTER_B);
      await pm.logsPage.expectDateTimeButtonText("2 Hours");
      expect(sent.length, "the link must run a search").toBeGreaterThan(0);
      expect(
        sent.every((sql) => SQL_B.test(sql)),
        `searches sent: ${sent.join(" | ")}`,
      ).toBe(true);
      await expectSameDocument(page);
    },
  );

  test(
    "Back and Forward restore the results of each search",
    {
      tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"],
    },
    async ({ page }) => {
      await page.goto(logsLink(FILTER_A));
      await expectRowsAre(pm, "info", INFO_ROWS);
      await pm.logsPage.expectNoQueryInFlight(60000);
      await markDocument(page);

      await pm.logsPage.fillQueryEditor(FILTER_B);
      await pm.logsPage.runPendingQuery();
      await expectRowsAre(pm, "error", ERROR_ROWS);
      await pm.logsPage.expectNoQueryInFlight(60000);
      await expect
        .poll(() => new URL(page.url()).searchParams.get("query"))
        .toBe(b64(FILTER_B));

      let sent = hitSearches(page, LOGS_STREAM);
      await page.goBack();
      await expectRowsAre(pm, "info", INFO_ROWS);
      expect((await pm.logsPage.getQueryEditorText()).trim()).toBe(FILTER_A);
      expect(sent.length, "Back must run the earlier search").toBeGreaterThan(
        0,
      );
      expect(
        sent.every((sql) => SQL_A.test(sql)),
        `searches sent: ${sent.join(" | ")}`,
      ).toBe(true);
      await pm.logsPage.expectNoQueryInFlight(60000);

      sent = hitSearches(page, LOGS_STREAM);
      await page.goForward();
      await expectRowsAre(pm, "error", ERROR_ROWS);
      expect((await pm.logsPage.getQueryEditorText()).trim()).toBe(FILTER_B);
      expect(sent.length, "Forward must run the later search").toBeGreaterThan(
        0,
      );
      expect(
        sent.every((sql) => SQL_B.test(sql)),
        `searches sent: ${sent.join(" | ")}`,
      ).toBe(true);
      await expectSameDocument(page);
    },
  );

  test(
    "a Traces link with only stream and time clears the previous filter",
    {
      tag: ["@bug-16952", "@P1", "@regression", "@tracesRegression"],
    },
    async ({ page }) => {
      const tracesLink = `/web/traces?org_identifier=${ORG}&stream=${TRACES_STREAM}&period=15m`;
      const first = traceSearches(page, TRACES_STREAM);
      await page.goto(`${tracesLink}&query=${b64("service_name='svc-a'")}`);
      await expect
        .poll(() => first.some((filter) => filter.includes("svc-a")), {
          timeout: 60000,
          message: "Precondition: the svc-a filter must be searched",
        })
        .toBe(true);
      await pm.tracesPage.expectTraceResultWithOperationName("op-svc-a");
      await markDocument(page);

      await pm.logsPage.navigateToHome();
      await page.waitForURL((u) => !u.pathname.includes("/traces"), {
        timeout: 15000,
      });
      const sent = traceSearches(page, TRACES_STREAM);
      await routerPush(page, tracesLink);

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
      await expectSameDocument(page);
    },
  );
});

// Patterns is enterprise-only: the extract route 404s on OSS, so this spec runs only from the ENT overlay.
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
// A logs and a traces stream share this name, so Patterns reading the wrong type mines the logs stream.
const STREAM = `e2e_16952_pat_${RID}`;
const LOG_ROWS = 20;
const SPANS = 4;

const logsUrl = (type, extra = "") =>
  `/web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=${type}&period=15m` +
  `&refresh=0&sql_mode=false&quick_mode=false&show_histogram=false${extra}`;

function tracesPayload() {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const traceId = RID.padEnd(32, "0").replace(/[^0-9a-f]/g, "a");
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
        resource: { attributes: [stringAttr("service.name", `svc-${RID}`)] },
        scopeSpans: [{ scope: { name: "e2e" }, spans }],
      },
    ],
  };
}

const isExtract = (req) => /\/patterns\/extract/.test(req.url());

function patternRequests(page) {
  const sent = [];
  page.on("request", (req) => {
    if (isExtract(req)) sent.push(req.url());
  });
  return sent;
}

// An extract call follows the toggle within a second when it is made, so 10 s without one means none.
const firstExtractWithin = (page, timeout = 10000) =>
  page
    .waitForRequest(isExtract, { timeout })
    .then((req) => req.url())
    .catch(() => null);

const tryPatternsToggle = (page) =>
  selectLogsViewMode(page, "patterns", 20000, { force: true });

test.describe(
  "Patterns reads only the logs stream it is opened on (#16952)",
  { tag: "@enterprise" },
  () => {
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
          message: `user ${i} logged in from host-${i % 3}`,
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
      "Patterns on a logs stream extracts from that stream",
      { tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"] },
      async ({ page }) => {
        await page.goto(logsUrl("logs"));
        await pm.logsPage.waitForSearchResultRows(60000);
        await pm.logsPage.expectNoQueryInFlight(60000);

        const sent = patternRequests(page);
        await tryPatternsToggle(page);
        await expect
          .poll(() => sent.length, {
            timeout: 30000,
            message:
              "control: Patterns on a logs stream must call the extract API",
          })
          .toBeGreaterThan(0);
        expect(sent[0]).toContain(`/streams/${STREAM}/patterns/extract`);
      },
    );

    test(
      "Patterns on a traces stream does not mine the same-name logs stream",
      { tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"] },
      async ({ page }) => {
        await page.goto(logsUrl("traces"));
        await pm.logsPage.waitForSearchResultRows(60000);
        await pm.logsPage.expectNoQueryInFlight(60000);

        const extract = firstExtractWithin(page);
        await tryPatternsToggle(page);
        // The extract API carries no stream type and reads logs, so any call here mines the wrong stream.
        expect(
          await extract,
          "no Patterns extract call may be made for a traces stream",
        ).toBeNull();
        await pm.logsPage.expectPatternsToggleOff();
      },
    );

    test(
      "a Patterns link to a traces stream opens the logs view without mining",
      { tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"] },
      async ({ page }) => {
        const extract = firstExtractWithin(page, 30000);
        await page.goto(logsUrl("traces", "&logs_visualize_toggle=patterns"));
        expect(
          await extract,
          "a traces-stream link must not call the logs-only extract API",
        ).toBeNull();
        await pm.logsPage.waitForSearchResultRows(60000);
        await pm.logsPage.expectPatternsToggleOff();
      },
    );
  },
);

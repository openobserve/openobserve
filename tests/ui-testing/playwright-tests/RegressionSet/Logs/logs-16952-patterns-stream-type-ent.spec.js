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
} = require("../../utils/traces-api.js");
const {
  simpleTracesPayload,
} = require("../../../pages/tracesPages/tracesFixtures.js");
const { getOrgIdentifier } = require("../../utils/cloud-auth.js");

const ORG = getOrgIdentifier() || "default";
const RID = Math.random().toString(36).slice(2, 8);
// A logs and a traces stream share this name, so Patterns reading the wrong type mines the logs stream.
const STREAM = `e2e_16952_pat_${RID}`;
const LOG_ROWS = 20;
const SPANS = 4;

const LINK_PARAMS = {
  period: "15m",
  refresh: "0",
  sql_mode: "false",
  quick_mode: "false",
  show_histogram: "false",
};

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
      await ingestOtlpTraces(
        request,
        STREAM,
        simpleTracesPayload(RID, `svc-${RID}`, SPANS),
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
      "Patterns on a logs stream extracts from that stream",
      { tag: ["@bug-16952", "@P1", "@regression", "@logsRegression"] },
      async ({ page }) => {
        await page.goto(pm.logsPage.logsLink(STREAM, LINK_PARAMS));
        await pm.logsPage.waitForSearchResultRows(60000);
        await pm.logsPage.expectNoQueryInFlight(60000);

        const sent = pm.logsPage.trackPatternsExtractRequests();
        await pm.logsPage.tryPatternsToggle();
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
        await page.goto(
          pm.logsPage.logsLink(STREAM, {
            streamType: "traces",
            ...LINK_PARAMS,
          }),
        );
        await pm.logsPage.waitForSearchResultRows(60000);
        await pm.logsPage.expectNoQueryInFlight(60000);

        const extract = pm.logsPage.waitForPatternsExtract();
        await pm.logsPage.tryPatternsToggle();
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
        const extract = pm.logsPage.waitForPatternsExtract(30000);
        await page.goto(
          pm.logsPage.logsLink(STREAM, {
            streamType: "traces",
            ...LINK_PARAMS,
            logs_visualize_toggle: "patterns",
          }),
        );
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

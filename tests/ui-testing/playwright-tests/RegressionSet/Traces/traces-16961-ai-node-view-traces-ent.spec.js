// Service Graph is enterprise-only, so this spec runs only from the ENT overlay.
const {
  test,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const PageManager = require("../../../pages/page-manager.js");
const {
  ingestOtlpTraces,
  waitForStreamRows,
  deleteStream,
} = require("../../utils/traces-api.js");
const {
  aiAgentTracesPayload,
  aiAgentTopology,
} = require("../../../pages/tracesPages/tracesFixtures.js");

const RID = Math.random().toString(36).slice(2, 8);
const STREAM = `e2e_16961_ai_${RID}`;
const APP = `app-${RID}`;
const AGENT = `agent-${RID}`;
const TOOL = `tool-${RID}`;
const MODEL = `model-${RID}`;
const TRACES = 3;
const SPANS_PER_TRACE = 3;

const AI_TRACES = {
  rid: RID,
  app: APP,
  agent: AGENT,
  tool: TOOL,
  model: MODEL,
  traces: TRACES,
};
// The rollup daemon takes minutes to draw GenAI nodes; the bug is in the panel-to-Traces hand-off, which reads the real spans.
const TOPOLOGY = aiAgentTopology({ ...AI_TRACES, stream: STREAM });

test.describe(
  "Service Graph View traces from AI nodes (#16961)",
  { tag: "@enterprise" },
  () => {
    test.describe.configure({ mode: "serial" });
    let pm;

    test.beforeAll(async ({ request }) => {
      await ingestOtlpTraces(request, STREAM, aiAgentTracesPayload(AI_TRACES));
      await waitForStreamRows(request, STREAM, TRACES * SPANS_PER_TRACE);
    });

    test.afterAll(async ({ request }) => {
      await deleteStream(request, STREAM, { type: "traces" });
    });

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      pm = new PageManager(page);
      await pm.serviceGraphPage.stubTopology(TOPOLOGY);
      await navigateToBase(page);
      await pm.serviceGraphPage.navigateToServiceGraphTab(STREAM);
    });

    test.afterEach(async ({}, testInfo) => {
      testLogger.testEnd(testInfo.title, testInfo.status);
    });

    test(
      "a service node's operation opens its spans",
      { tag: ["@bug-16961", "@P1", "@regression", "@tracesRegression"] },
      async () => {
        await pm.serviceGraphPage.viewTracesFromFirstOperation(APP, TRACES);
        await pm.tracesPage.expectSpansFoundCount(TRACES);
      },
    );

    for (const [kind, name] of [
      ["tool", TOOL],
      ["model", MODEL],
    ]) {
      test(
        `View traces from an AI ${kind} node opens the spans its operation row counts`,
        { tag: ["@bug-16961", "@P1", "@regression", "@tracesRegression"] },
        async () => {
          await pm.serviceGraphPage.viewTracesFromFirstOperation(name, TRACES);
          testLogger.info("Traces filter", {
            filter: await pm.serviceGraphPage.getTracesUrlQuery(),
          });
          await pm.tracesPage.expectSpansFoundCount(TRACES);
        },
      );
    }
  },
);

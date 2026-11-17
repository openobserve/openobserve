// Clock skew made the trace end precede the event date, so the duration clamped to 0us; fall back to the span length.

const {
  test,
  expect,
  navigateToBase,
} = require("../../utils/enhanced-baseFixtures.js");
const testLogger = require("../../utils/test-logger.js");
const {
  getAuthHeaders,
  getOrgIdentifier,
} = require("../../utils/cloud-auth.js");
const crypto = require("crypto");
const { ingestBase } = require("../../utils/ingest-url.js");

const TRACE_ID_FIELD = "_o2_trace_id";
const SKEW_MS = 5000;
const SPAN_MS = 150;

const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");

function buildFixture() {
  return {
    sessionId: `e2e${hex(6)}`,
    viewId: hex(8),
    traceId: hex(16),
    now: Date.now(),
    op: "GET /api/skewed",
    url: "https://shop.example.com/api/skewed",
  };
}

function rumRows({ sessionId, viewId, traceId, now, url }) {
  const base = {
    session_id: sessionId,
    view_id: viewId,
    view_url: "https://shop.example.com/checkout",
    view_loading_type: "initial_load",
    service: "shop-frontend",
    application_id: "e2e-rum-app",
    source: "browser",
  };
  const traceEnd = now - 60000 + SPAN_MS;
  return [
    {
      ...base,
      _timestamp: (now - 60000) * 1000,
      date: now - 60000,
      type: "view",
      usr_id: "e2e-user",
    },
    {
      ...base,
      _timestamp: (now - 60000 + 500) * 1000,
      date: traceEnd + SKEW_MS,
      type: "resource",
      resource_url: url,
      resource_type: "fetch",
      resource_method: "GET",
      resource_status_code: 200,
      resource_duration: SPAN_MS * 1000000,
      [TRACE_ID_FIELD]: traceId,
    },
  ];
}

function tracePayload({ now, traceId, op, url }) {
  const attr = (key, value) => ({ key, value: { stringValue: String(value) } });
  const startNs = BigInt(now - 60000) * 1000000n;
  return {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", "shop-api")] },
        scopeSpans: [
          {
            scope: { name: "rum-skew" },
            spans: [
              {
                traceId,
                spanId: hex(8),
                name: op,
                kind: 2,
                startTimeUnixNano: String(startNs),
                endTimeUnixNano: String(startNs + BigInt(SPAN_MS) * 1000000n),
                attributes: [attr("http.url", url)],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

test.describe("RUM session trace duration under clock skew", () => {
  test.describe.configure({ mode: "serial" });

  let fixture;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      storageState: "playwright-tests/utils/auth/user.json",
    });
    const page = await context.newPage();
    try {
      fixture = buildFixture();
      const org = getOrgIdentifier() || "default";
      const headers = getAuthHeaders();
      const base = (
        process.env["INGESTION_URL"] ||
        process.env["ZO_BASE_URL"] ||
        ""
      ).replace(/\/+$/, "");

      const rum = await page.request.post(
        `${ingestBase(base)}/api/${org}/_rumdata/_json`,
        {
          headers,
          data: rumRows(fixture),
        },
      );
      expect(rum.status(), "RUM events must ingest").toBe(200);

      const traces = await page.request.post(
        `${ingestBase(base)}/api/${org}/v1/traces`,
        {
          headers,
          data: tracePayload(fixture),
        },
      );
      expect(traces.status(), "skewed trace must ingest").toBe(200);

      await expect
        .poll(
          async () => {
            const res = await page.request.post(
              `${base}/api/${org}/_search?type=logs`,
              {
                headers,
                data: {
                  query: {
                    sql: `SELECT COUNT(*) AS n FROM "_rumdata" WHERE session_id = '${fixture.sessionId}'`,
                    start_time: (fixture.now - 3600000) * 1000,
                    end_time: (fixture.now + 3600000) * 1000,
                    from: 0,
                    size: 1,
                  },
                },
              },
            );
            if (!res.ok()) return 0;
            return Number(((await res.json()).hits || [])[0]?.n || 0);
          },
          { message: "RUM events must be searchable", timeout: 90000 },
        )
        .toBeGreaterThanOrEqual(2);

      testLogger.info("Ingested RUM skew fixture", {
        sessionId: fixture.sessionId,
      });
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const baseUrl = (process.env["ZO_BASE_URL"] || "").replace(/\/+$/, "");
    const org = getOrgIdentifier() || "default";
    await page.goto(
      `${baseUrl}/web/rum/sessions/view/${fixture.sessionId}?org_identifier=${org}`,
    );
    await page
      .waitForLoadState("networkidle", { timeout: 30000 })
      .catch(() => {});
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test(
    "P3: a trace that ends before its RUM request shows the span duration, not 0us",
    {
      tag: [
        "@rum",
        "@sessionReplay",
        "@bug-3268",
        "@regression",
        "@P3",
        "@all",
      ],
    },
    async ({ page }) => {
      const row = page
        .locator('[data-test^="o2-table-row-"]')
        .filter({ hasText: fixture.op });
      // The trace lands in search after the RUM rows, so reload until it shows up.
      await expect(async () => {
        await page.reload();
        await page.locator('[data-test="tab-traces"]').click();
        await expect(
          page.locator('[data-test="rum-player-traces-tab-table"]'),
        ).toBeVisible({ timeout: 15000 });
        await expect(row).toHaveCount(1, { timeout: 5000 });
      }).toPass({ timeout: 90000, intervals: [3000] });
      // The duration is rendered from microsecond timestamps, so it may land a millisecond under the seeded span.
      await expect(row).toContainText(
        new RegExp(`(${SPAN_MS - 1}|${SPAN_MS})(\\.\\d+)?ms`),
      );
      await expect(row).not.toContainText("0us");
    },
  );
});

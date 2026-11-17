// Copyright 2026 OpenObserve Inc.

const { test, expect } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");

const ORG = process.env.ORGNAME || "demo-org";
const BASE = `${(process.env.ZO_BASE_URL || "").replace(/\/+$/, "")}/`;
const SIGNALS = ["requests", "errors", "latency"];
const CHART_WAIT = 30000;

const decodeSql = (sql) =>
  Buffer.from(
    sql.replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "="),
    "base64",
  ).toString("utf8");

const watchSearches = (page) => {
  const sent = [];
  page.on("request", (req) => {
    if (!req.url().includes("/_search_stream") || req.method() !== "POST")
      return;
    const body = JSON.parse(req.postData() || "{}");
    sent.push({
      req,
      sql: decodeSql(body.query?.sql || ""),
      start: Date.now(),
      state: "open",
    });
  });
  page.on("requestfinished", (req) => {
    const hit = sent.find((s) => s.req === req);
    if (hit)
      Object.assign(hit, { state: "finished", ms: Date.now() - hit.start });
  });
  page.on("requestfailed", (req) => {
    const hit = sent.find((s) => s.req === req);
    if (hit)
      Object.assign(hit, { state: "failed", ms: Date.now() - hit.start });
  });
  return sent;
};

const report = (label, sent) =>
  testLogger.info(`${label} chart queries`, {
    queries: sent.map(({ sql, state, ms }) => ({ sql, state, ms })),
  });

const openDrawer = async (page, service) => {
  await page.goto(
    `${BASE}autoobserve?org_identifier=${ORG}&live=1&page=coverage`,
  );
  const hex = page.locator(`[data-test="autoobserve-coverage-hex-${service}"]`);
  await expect(hex).toBeVisible({ timeout: CHART_WAIT });
  await hex.click();
  await expect(
    page.locator('[data-test="autoobserve-coverage-drawer"]'),
  ).toBeVisible();
};

const chart = (page, part, signal) =>
  page.locator(`[data-test="autoobserve-coverage-chart-${part}-${signal}"]`);

test.describe(
  "AutoObserve live service charts",
  { tag: ["@autoobserve", "@P1"] },
  () => {
    test.describe.configure({ mode: "serial" });

    test("a traces service charts requests, errors and latency from its own spans", async ({
      page,
    }) => {
      const sent = watchSearches(page);
      await openDrawer(page, "svc-b (—/—)");
      for (const signal of SIGNALS)
        await expect(chart(page, "value", signal)).toBeVisible({
          timeout: CHART_WAIT,
        });
      await expect(
        page.locator('[data-test^="autoobserve-coverage-chart-nodata-"]'),
      ).toHaveCount(0);
      expect(sent).toHaveLength(1);
      expect(sent[0].sql).toContain(`WHERE "service_name" = 'svc-b'`);
      expect(sent[0].sql).toContain("histogram(_timestamp, '15 minute')");
      expect(sent[0].sql).toContain("span_status = 'ERROR'");
      expect(sent[0].sql).toContain("approx_percentile_cont(duration, 0.95)");

      await page
        .locator('[data-test="autoobserve-coverage-drawer-range-7d"]')
        .click();
      await page
        .locator('[data-test="autoobserve-coverage-drawer-range-1h"]')
        .click();
      await expect(chart(page, "value", "requests")).toBeVisible({
        timeout: CHART_WAIT,
      });
      await expect
        .poll(() => sent.filter((s) => s.state !== "open").length)
        .toBe(sent.length);
      const finished = (bucket) =>
        sent.filter(
          (s) => s.state === "finished" && s.sql.includes(`'${bucket}'`),
        ).length;
      expect(finished("1 minute")).toBe(1);
      expect(finished("1 hour")).toBeLessThanOrEqual(1);
      expect(sent.at(-1).sql).toContain("histogram(_timestamp, '1 minute')");
      report("svc-b", sent);
    });

    test("a logs service charts errors from stderr and says latency needs traces", async ({
      page,
    }) => {
      const sent = watchSearches(page);
      await openDrawer(page, "svc-c");
      await expect(chart(page, "value", "errors")).toBeVisible({
        timeout: CHART_WAIT,
      });
      await expect(chart(page, "nodata", "latency")).toHaveText(
        "Latency is charted from traces. svc-c sends none.",
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].sql).toContain(`"log_iostream" = 'stderr'`);
      expect(sent[0].sql).toContain(`"service_name" = 'svc-c'`);
      expect(sent[0].sql).not.toContain("duration");
      report("svc-c", sent);
    });

    test("a logs stream with no level field names it on the errors chart", async ({
      page,
    }) => {
      const sent = watchSearches(page);
      await openDrawer(page, "svc-y (cluster-c)");
      await expect(chart(page, "value", "requests")).toBeVisible({
        timeout: CHART_WAIT,
      });
      await expect(chart(page, "nodata", "errors")).toHaveText(
        "No log level in ingress_access",
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].sql).not.toContain("FILTER");
      report("svc-y", sent);
    });

    test("a denied chart query is a red denial naming the stream and the missing permission", async ({
      page,
    }) => {
      await page.route("**/_search_stream**", (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: 403, message: "Unauthorized Access" }),
        }),
      );
      await openDrawer(page, "svc-b (—/—)");
      for (const signal of SIGNALS) {
        const denied = chart(page, "denied", signal);
        await expect(denied).toContainText("You can't view app_traces", {
          timeout: CHART_WAIT,
        });
        await expect(denied).toContainText(
          "Your role is missing the Get permission on app_traces.",
        );
      }
      await expect(
        page.locator('[data-test^="autoobserve-coverage-chart-retry-"]'),
      ).toHaveCount(0);
    });

    test("a denied schema read names the stream, not service streams", async ({
      page,
    }) => {
      const sent = watchSearches(page);
      await page.route("**/streams/app_traces/schema**", (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: 403, message: "Unauthorized Access" }),
        }),
      );
      await openDrawer(page, "svc-b (—/—)");
      for (const signal of SIGNALS) {
        const denied = chart(page, "denied", signal);
        await expect(denied).toContainText("You can't view app_traces", {
          timeout: CHART_WAIT,
        });
        await expect(denied).toContainText(
          "Your role is missing the Get permission on app_traces.",
        );
        await expect(denied).not.toContainText("Service streams");
      }
      expect(sent).toHaveLength(0);
    });

    test("a failed chart query is red, names the stream and the cause, and Retry asks again", async ({
      page,
    }) => {
      let failures = 1;
      await page.route("**/_search_stream**", (route) =>
        failures-- > 0
          ? route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({
                code: 500,
                message: "The search timed out",
              }),
            })
          : route.continue(),
      );
      await openDrawer(page, "svc-b (—/—)");
      const failed = chart(page, "failed", "requests");
      await expect(failed).toContainText(
        "Couldn't load this chart from app_traces",
        {
          timeout: CHART_WAIT,
        },
      );
      await expect(failed).toContainText("The search timed out");
      await chart(page, "retry", "requests").click();
      for (const signal of SIGNALS)
        await expect(chart(page, "value", signal)).toBeVisible({
          timeout: CHART_WAIT,
        });
    });
  },
);

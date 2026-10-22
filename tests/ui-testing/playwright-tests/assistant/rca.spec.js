// Copyright 2026 OpenObserve Inc.
// The incident analysis tab with the flag on: a streamed report with Stop, and asking about the report.

import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

const INCIDENT_ID = "inc-e2e-checkout";

test.describe("assistant incident analysis", () => {
  // Every scenario drives the removed analysis tab and its stream; they return once it is ported to the incident run model.
  test.fixme(true, "ported with the incident run model");

  let assistant;
  let harness;
  let state;
  let cancels;
  let server;

  const url = (path) =>
    `${harness.ENV.appUrl}${path}${path.includes("?") ? "&" : "?"}org_identifier=${harness.ENV.org}`;

  const incident = () => {
    const nowUs = Date.now() * 1000;
    return {
      id: INCIDENT_ID,
      org_id: harness.ENV.org,
      status: "open",
      severity: "P2",
      title: "Checkout latency",
      group_values: { service_name: "checkout" },
      first_alert_at: nowUs - 3_600_000_000,
      last_alert_at: nowUs,
      alert_count: 3,
      created_at: nowUs - 3_600_000_000,
      updated_at: nowUs,
      alerts: [],
      triggers: [],
      ...(server.report && {
        topology_context: { suggested_root_cause: server.report },
      }),
    };
  };

  // Only the incident's own routes are faked; the analysis stream itself comes from the stream shim.
  async function mockIncident(page) {
    const json = (route, body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    await page.route(/\/api\/v2\/[^/]+\/alerts\/incidents\/.*/, (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith(`/incidents/${INCIDENT_ID}`))
        return json(route, incident());
      if (path.endsWith("/rca/history"))
        return json(route, { current: server.report, previous: [] });
      if (path.endsWith("/events")) {
        server.eventReads += 1;
        if (
          server.finishAfter !== null &&
          server.eventReads >= server.finishAfter
        ) {
          server.events.push({
            type: "ai_analysis_complete",
            timestamp: Date.now() * 1000,
          });
          server.finishAfter = null;
        }
        return json(route, { events: server.events });
      }
      if (path.endsWith("/rca") && request.method() === "DELETE") {
        cancels.push(request.url());
        server.events.push({
          type: "ai_analysis_cancelled",
          timestamp: Date.now() * 1000,
        });
        return json(route, { message: "cancelled", aborted_local_task: true });
      }
      return json(route, {});
    });
  }

  async function openAnalysis(page) {
    await page.goto(url(`/incidents/${INCIDENT_ID}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(assistant.headerButton).toHaveAttribute(
      "data-state",
      /idle|open/,
      { timeout: 30_000 },
    );
    await expect(
      page.locator('[data-test="incident-detail-title"]'),
    ).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-test="incident-analysis-tab"]').click();
    const panel = page.locator('[data-test="rca-panel"]');
    await expect(panel).toBeVisible();
    return panel;
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
    cancels = [];
    server = { events: [], report: null, eventReads: 0, finishAfter: null };
    await mockIncident(page);
  });

  test("RCA-01 the analysis streams with a status card; Stop cancels it and the incident stays actionable", { tag: ["@mock", "@stack-ee"] }, async ({
    page,
  }) => {
    const panel = await openAnalysis(page);
    const acknowledge = page
      .getByRole("button", { name: /acknowledge/i })
      .first();
    await expect(acknowledge).toBeEnabled();
    await panel.locator('[data-test="trigger-rca-btn"]').click();
    const status = panel.locator('[data-test="rca-turn-status"]');
    await expect(status).toBeVisible({ timeout: 15_000 });
    await expect(panel.locator('[data-test="rca-report"]')).toContainText(
      "Root cause",
      { timeout: 15_000 },
    );
    await expect(acknowledge).toBeEnabled();
    const requests = await page.evaluate(
      () => window.__o2mock.rcaRequests || [],
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("stream=true");
    await status.getByRole("button", { name: /stop/i }).click();
    await expect(panel.locator('[data-test="rca-end-line"]')).toContainText(
      "Stopped after",
      { timeout: 15_000 },
    );
    await expect.poll(() => cancels.length).toBe(1);
    await expect(panel.locator('[data-test="rca-report"]')).toContainText(
      "Root cause",
    );
    await expect(
      panel.locator('[data-test="rca-reanalyze-btn"]'),
    ).toBeFocused();
    await expect(acknowledge).toBeEnabled();
  });

  test("RCA-02 Ask about this report opens the assistant with the incident and report chips", { tag: ["@mock"] }, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const panel = await openAnalysis(page);
    await page.evaluate(() => (window.__o2mock.speed = 10));
    await panel.locator('[data-test="trigger-rca-btn"]').click();
    await expect(panel.locator('[data-test="rca-end-line"]')).toContainText(
      "Analysed in",
      { timeout: 30_000 },
    );
    await panel.locator('[data-test="ai-entry-incident-report-ask"]').click();
    await expect(assistant.composer()).toBeVisible({ timeout: 15_000 });
    await expect(assistant.chips()).toContainText([
      /^Time ·/,
      /Checkout latency/,
      /^Report 1 · /,
    ]);
    await expect(
      assistant.chips().filter({ hasText: "Checkout latency" }),
    ).toHaveCount(1);
    await expect(assistant.composer()).toHaveValue(
      "Explain this incident analysis report",
    );
  });

  test("RCA-03 a re-analysis answers 202 and is followed to its end through the event log", { tag: ["@mock"] }, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const panel = await openAnalysis(page);
    await page.evaluate(() => (window.__o2mock.speed = 10));
    await panel.locator('[data-test="trigger-rca-btn"]').click();
    await expect(panel.locator('[data-test="rca-end-line"]')).toContainText(
      "Analysed in",
      { timeout: 30_000 },
    );
    server.report =
      "## Root cause\n\nThe database pool, confirmed on the re-run.";
    server.events = [
      { type: "ai_analysis_begin", timestamp: Date.now() * 1000 },
    ];
    server.finishAfter = server.eventReads + 2;
    await panel.locator('[data-test="rca-reanalyze-btn"]').click();
    await expect(panel.locator('[data-test="rca-turn-status"]')).toContainText(
      /Starting analysis|Analysing/,
      {
        timeout: 15_000,
      },
    );
    const requests = await page.evaluate(
      () => window.__o2mock.rcaRequests || [],
    );
    expect(requests.at(-1).url).toContain("reanalysis=true");
    await expect(panel.locator('[data-test="rca-report"]')).toContainText(
      "confirmed on the re-run",
      {
        timeout: 45_000,
      },
    );
    await expect(panel.locator('[data-test="rca-end-line"]')).toContainText(
      "Analysed in",
    );
    await expect(panel.locator('[data-test="rca-error-card"]')).toHaveCount(0);
  });

  test("RCA-04 a run already in progress is its own running state with Stop, not analysis off", { tag: ["@mock"] }, async ({
    page,
  }) => {
    const panel = await openAnalysis(page);
    await page.evaluate(
      () => (window.__o2mock.rcaScenario = "rca_in_progress"),
    );
    server.events = [
      { type: "ai_analysis_begin", timestamp: (Date.now() - 90_000) * 1000 },
    ];
    await panel.locator('[data-test="trigger-rca-btn"]').click();
    const elsewhere = panel.locator('[data-test="rca-running-elsewhere"]');
    await expect(elsewhere).toBeVisible({ timeout: 15_000 });
    await expect(elsewhere).toContainText("Analysing ·");
    await expect(panel.locator('[data-test="rca-gate-state"]')).toHaveCount(0);
    await elsewhere.locator('[data-test="rca-stop-btn"]').click();
    await expect.poll(() => cancels.length).toBe(1);
    await expect(panel.locator('[data-test="rca-end-line"]')).toContainText(
      "Stopped by you after",
      {
        timeout: 15_000,
      },
    );
  });

  test("RCA-05 analysis turned off for the priority and for the org are told apart", { tag: ["@mock"] }, async ({
    page,
  }) => {
    const panel = await openAnalysis(page);
    await page.evaluate(
      () => (window.__o2mock.rcaScenario = "rca_priority_off"),
    );
    await panel.locator('[data-test="trigger-rca-btn"]').click();
    await expect(panel.locator('[data-test="rca-priority-off"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel.locator('[data-test="rca-gate-state"]')).toHaveCount(0);
    await page.evaluate(
      () => (window.__o2mock.rcaScenario = "rca_not_enabled"),
    );
    await panel.locator('[data-test="trigger-rca-btn"]').click();
    await expect(panel.locator('[data-test="rca-gate-state"]')).toContainText(
      "Incident analysis is off for this organization.",
      { timeout: 15_000 },
    );
  });

  test("RCA-06 a dropped stream reconnects through the event log and catches up", { tag: ["@mock"] }, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const panel = await openAnalysis(page);
    await page.evaluate(() => (window.__o2mock.rcaScenario = "rca_dropped"));
    server.report =
      "## Root cause\n\nThe **checkout** service started timing out at 10:02 after its database pool hit the limit.";
    server.events = [
      { type: "ai_analysis_begin", timestamp: Date.now() * 1000 },
    ];
    server.finishAfter = server.eventReads + 2;
    await panel.locator('[data-test="trigger-rca-btn"]').click();
    await expect(panel.locator('[data-test="rca-turn-status"]')).toContainText(
      /Reconnecting|Caught up/,
      {
        timeout: 20_000,
      },
    );
    await expect(panel.locator('[data-test="rca-report"]')).toContainText(
      "hit the limit",
      { timeout: 30_000 },
    );
    await expect(panel.locator('[data-test="rca-end-line"]')).toContainText(
      "Analysed in",
    );
  });

  test("RCA-07 Jump to is a full-width select on a phone and a side list on a desktop", { tag: ["@mock"] }, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    server.report =
      "## Root cause\n\nPool.\n\n## Evidence\n\n- latency\n\n## Next steps\n\n1. Raise the pool";
    server.events = [
      { type: "ai_analysis_begin", timestamp: (Date.now() - 120_000) * 1000 },
      { type: "ai_analysis_complete", timestamp: (Date.now() - 60_000) * 1000 },
    ];
    await page.setViewportSize({ width: 375, height: 812 });
    let panel = await openAnalysis(page);
    await expect(panel.locator('[data-test="rca-jump-to"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel.locator('[data-test="rca-jump-list"]')).toBeHidden();
    await panel.getByRole("combobox", { name: "Jump to" }).click();
    await page.getByRole("option", { name: "Evidence" }).click();
    await expect(page.locator(":focus")).toHaveText("Evidence");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    panel = page.locator('[data-test="rca-panel"]');
    const list = panel.locator('[data-test="rca-jump-list"]');
    await expect(list).toBeVisible();
    await list.getByRole("button", { name: "Next steps" }).click();
    await expect(panel.locator("#rca-section-2")).toBeFocused();
  });

  test("RCA-08 with rca_enabled in /config the gate shows before any click", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    state.configPatch.rca_enabled = false;
    const panel = await openAnalysis(page);
    await expect(panel.locator('[data-test="rca-gate-state"]')).toBeVisible();
    await expect(panel.locator('[data-test="trigger-rca-btn"]')).toHaveCount(0);
  });

  test("RCA-09 with re-analysis streaming on the server, the re-run streams like the first run", { tag: ["@mock"] }, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const panel = await openAnalysis(page);
    await page.evaluate(() => {
      window.__o2mock.speed = 10;
      window.__o2mock.knobs.rcaReanalysisStreams = true;
    });
    await panel.locator('[data-test="trigger-rca-btn"]').click();
    await expect(panel.locator('[data-test="rca-end-line"]')).toContainText(
      "Analysed in",
      { timeout: 30_000 },
    );
    const reads = server.eventReads;
    await panel.locator('[data-test="rca-reanalyze-btn"]').click();
    await expect(panel.locator('[data-test="rca-end-line"]')).toContainText(
      "Analysed in",
      { timeout: 30_000 },
    );
    await expect(panel.locator('[data-test="rca-report"]')).toContainText(
      "Next steps",
    );
    const requests = await page.evaluate(
      () => window.__o2mock.rcaRequests || [],
    );
    expect(requests.at(-1).url).toContain("reanalysis=true");
    expect(server.eventReads - reads).toBeLessThan(3);
  });
});

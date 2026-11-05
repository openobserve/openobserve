// Copyright 2026 OpenObserve Inc.
// An incident in an assistant chat: its analysis report attached by run, chat mode on the wire, and Run analysis handing off to the incident's own tab.

import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

const INCIDENT_ID = "inc-e2e-checkout";
const RUN_ID = "run-e2e-2";
const REPORT =
  "## Root cause\n\nThe 14:02 checkout deploy exhausted the connection pool.";

test.describe("assistant incident chat", () => {
  let assistant;
  let harness;
  let reads;

  const url = (path) =>
    `${harness.ENV.appUrl}${path}${path.includes("?") ? "&" : "?"}org_identifier=${harness.ENV.org}`;

  const runItem = (run_id, started_at) => ({
    run_id,
    subject_type: "incident",
    trigger: "auto_new_incident",
    mode: "fresh",
    started_by: "system",
    state: "completed",
    started_at,
    ended_at: started_at + 60_000_000,
    outcome: null,
    confidence: null,
    cancelled_by: null,
    error_reason: null,
    report_format: "v1",
    has_record: false,
  });

  const incident = () => {
    const nowUs = Date.now() * 1000;
    const latest = runItem(RUN_ID, nowUs - 600_000_000);
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
      rca_off_reason: null,
      rca: {
        run_id: RUN_ID,
        state: "completed",
        stale: false,
        started_at: latest.started_at,
        updated_at: latest.ended_at,
        outcome: null,
        confidence: null,
        report_format: "v1",
        summary: {
          stage: null,
          stage_index: null,
          stage_count: 7,
          steps: 4,
          tool_calls: 9,
          steered_by: [],
          unblocked_by: null,
          detail: null,
          deadline_at: null,
          cancelled_by: null,
          previous: null,
        },
        report_run: latest,
        history: [latest, runItem("run-e2e-1", nowUs - 3_000_000_000)],
        current_run: null,
        resume_run_id: null,
      },
    };
  };

  // The incident routes the assistant reads, plus the ones the incident page loads; never a POST to start a run.
  async function mockIncident(page) {
    await page
      .context()
      .route(/\/api\/v2\/[^/]+\/alerts\/incidents\/.*/, (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        reads.push(
          `${request.method()} ${path.replace(/^\/api\/v2\/[^/]+/, "")}`,
        );
        const reply = (body, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            headers: {
              "access-control-allow-origin": request.headers()["origin"] || "*",
              "access-control-allow-credentials": "true",
            },
            body: JSON.stringify(body),
          });
        if (path.endsWith(`/incidents/${INCIDENT_ID}`))
          return reply(incident());
        if (path.endsWith(`/rca/runs/${RUN_ID}`))
          return reply({
            ...runItem(RUN_ID, Date.now() * 1000),
            report: REPORT,
            error: null,
          });
        if (path.endsWith("/rca/live_stream"))
          return reply({ code: 404, message: "Not Found" }, 404);
        if (/\/rca(\/|$)/.test(path))
          return reply({ code: 404, message: "Not Found" }, 404);
        return reply({});
      });
  }

  async function axeSerious(page, selector) {
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    return page.evaluate(async (include) => {
      const { violations } = await window.axe.run(
        { include: [[include]] },
        {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
        },
      );
      return violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target.join(" ")),
        }));
    }, selector);
  }

  // The deep link names the incident; the assistant reads incident.rca's report run, then that run.
  async function openIncidentChat(page) {
    await page.goto(
      url(`/logs?assistant=explain&object=incident&ref=${INCIDENT_ID}`),
      {
        waitUntil: "domcontentloaded",
      },
    );
    await expect(assistant.composer()).toHaveValue(
      "Explain this incident analysis report",
      {
        timeout: 30_000,
      },
    );
  }

  const chatBodies = (page) =>
    page.evaluate(() =>
      window.__o2mock.requests.map((r) => JSON.parse(r.body || "{}")),
    );

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    reads = [];
  });

  async function start(page, context, capabilities) {
    const state = harness.createMockState(
      capabilities ? { capabilitiesEnabled: true, capabilities } : {},
    );
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
    await mockIncident(page);
  }

  test("RCA-10 an incident link attaches Time, Incident and the report run's Report, and sends nothing", async ({
    context,
    page,
  }) => {
    await start(page, context);
    await openIncidentChat(page);
    const chips = assistant.chips();
    await expect(chips).toHaveCount(3);
    await expect(chips.filter({ hasText: "Checkout latency" })).toHaveCount(1);
    await expect(
      chips.filter({ hasText: /Run 2 · .* UTC · \d+ B/ }),
    ).toHaveCount(1);
    expect(reads).toContain(`GET /alerts/incidents/${INCIDENT_ID}`);
    expect(reads).toContain(
      `GET /alerts/incidents/${INCIDENT_ID}/rca/runs/${RUN_ID}`,
    );
    expect(
      reads.some((r) => r.startsWith("POST") || r.includes("rca/history")),
    ).toBe(false);
    expect(await page.evaluate(() => window.__o2mock.requests.length)).toBe(0);
    expect(await axeSerious(page, "[data-assistant-root]")).toEqual([]);
  });

  test("RCA-11 with rca_chat_mode every incident chat turn sends mode chat, never rca", async ({
    context,
    page,
  }) => {
    await start(page, context, { rca_chat_mode: true });
    await openIncidentChat(page);
    await assistant.composer().press("Enter");
    await expect
      .poll(async () => (await chatBodies(page)).length, { timeout: 30_000 })
      .toBe(1);
    await expect(assistant.composerState()).toHaveAttribute("data-state", "empty", { timeout: 60_000 });
    await assistant.send("And what should I roll back?");
    await expect
      .poll(async () => (await chatBodies(page)).length, { timeout: 30_000 })
      .toBe(2);
    const bodies = await chatBodies(page);
    expect(bodies.map((b) => b.mode)).toEqual(["chat", "chat"]);
    expect(bodies.some((b) => "incident" in b)).toBe(false);
    expect(reads.some((r) => r.startsWith("POST"))).toBe(false);
    expect(await axeSerious(page, "[data-assistant-root]")).toEqual([]);
  });

  test("RCA-13 a server without rca_chat_mode gets no mode on an incident chat turn", async ({
    context,
    page,
  }) => {
    await start(page, context);
    await openIncidentChat(page);
    await assistant.composer().press("Enter");
    await expect
      .poll(async () => (await chatBodies(page)).length, { timeout: 30_000 })
      .toBe(1);
    expect((await chatBodies(page))[0]).not.toHaveProperty("mode");
  });

  test("RCA-12 Run analysis on the incident chip opens the incident on its Incident Analysis tab", async ({
    context,
    page,
  }) => {
    await start(page, context);
    await openIncidentChat(page);
    await assistant
      .tray()
      .locator(
        '[data-test="assistant-context-chip-incident"] [data-test="assistant-context-chip-button"]',
      )
      .click();
    const action = page.locator('[data-test="assistant-chip-open-source"]');
    await expect(action).toHaveText(/Run analysis/);
    expect(
      await axeSerious(page, '[data-test="assistant-chip-popover"]'),
    ).toEqual([]);
    await action.click();
    await expect(page).toHaveURL(new RegExp(`/incidents/${INCIDENT_ID}`), {
      timeout: 30_000,
    });
    await expect(
      page.locator('[data-test="rca-analysis-container"]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.url()).not.toContain("tab=incidentAnalysis");
    expect(reads.some((r) => r.startsWith("POST"))).toBe(false);
  });
});

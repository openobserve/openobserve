// Copyright 2026 OpenObserve Inc.
// Evidence and actions with the flag on: query blocks, the trail, claim chips, the footer, findings and link cards.

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

// The URL-safe base64 the explorers read their `query` param in.
const decode = (value) =>
  Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "="), "base64").toString("utf8");

test.describe("assistant evidence", () => {
  let assistant;
  let harness;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  async function openOnLogs(page) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
  }

  async function ask(page, scenario, text = "why 5xx?") {
    await harness.nextScenario(page, scenario);
    await assistant.send(text);
    await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true", { timeout: 20_000 });
  }

  // Search requests sent after a mark, so "never executed" is checked on the wire.
  function watchSearches(page) {
    const sent = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/_search(_multi)?\b/.test(request.url())) sent.push(request.postData() ?? "");
    });
    return sent;
  }

  async function settledScroll(page) {
    let last = -1;
    await expect
      .poll(async () => {
        const top = await assistant.transcript().evaluate((el) => el.scrollTop);
        const same = top === last;
        last = top;
        return same;
      }, { intervals: [250] })
      .toBe(true);
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    await harness.installMocks(context, harness.createMockState());
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("EVID-01 Open in Logs carries the exact SQL, stream and absolute range and never runs it", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "complete");
    const block = assistant.answer().locator('[data-test="assistant-query-block"]').first();
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute("aria-label", /^SQL query on default, .+–.+/);
    await expect(block.locator('[data-test="assistant-query-run"]')).toBeVisible();
    await expect(block.locator('[data-test="assistant-query-copy"]')).toBeVisible();
    const searches = watchSearches(page);
    await block.locator('[data-test="assistant-query-open"]').click();
    await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("ai_chat_query");
    const params = new URL(page.url()).searchParams;
    expect(params.get("stream")).toBe("default");
    expect(decode(params.get("query"))).toContain('FROM "default"');
    expect(Number(params.get("to")) - Number(params.get("from"))).toBe(15 * 60_000 * 1000);
    expect(params.has("run")).toBe(false);
    await page.waitForTimeout(1_500);
    expect(searches.filter((body) => body.includes("approx_percentile_cont"))).toEqual([]);
  });

  test("EVID-01 Run shows the rows inline through the reader's own search and sends no assistant turn", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "complete");
    const block = assistant.answer().locator('[data-test="assistant-query-block"]').first();
    await expect(block).toBeVisible();
    const searched = [];
    // Only the block's query is answered here; the Logs page's own searches go to the server.
    await page.route(/\/_search\b/, (route) => {
      const body = route.request().postData() ?? "";
      if (!body.includes("approx_percentile_cont")) return route.fallback();
      searched.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ took: 12, total: 2, hits: [{ service: "checkout", p95: 812 }, { service: "cart", p95: 140 }] }),
      });
    });
    const turns = await page.evaluate(() => window.__o2mock.requests.length);
    const before = page.url();
    await block.locator('[data-test="assistant-query-run"]').click();
    const results = block.locator('[data-test="assistant-query-results"]');
    await expect(results).toHaveAttribute("data-state", "done", { timeout: 15_000 });
    await expect(block.locator('[data-test="assistant-query-summary"]')).toContainText("2");
    await expect(block.locator('[data-test="assistant-query-table"]')).toContainText("checkout");
    await expect(block.locator('[data-test="assistant-query-table"]')).toContainText("812");
    expect(searched).toHaveLength(1);
    expect(page.url()).toBe(before);
    expect(await page.evaluate(() => window.__o2mock.requests.length)).toBe(turns);
  });

  test("EVID-03 a claim chip opens the step it cites, expanded by call_id", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "cite");
    const answer = assistant.answer();
    await expect(answer).not.toContainText("[^");
    const chip = answer.locator('[data-test="assistant-claim-1"]').first();
    await expect(chip).toHaveAttribute("aria-label", /^Evidence 1, Queried default/);
    await chip.click();
    await expect(answer.locator('[data-test="assistant-step-body-call_3"]')).toBeVisible();
    await expect(answer.locator('[data-test="assistant-step-call_3"]')).toBeFocused();
    await expect(answer.locator('[data-test="assistant-claim-2"]').first()).toHaveAttribute("data-call-id", "call_1");
  });

  test("EVID-04 Re-run for now sends the same prompt over a window ending now, the draft untouched", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "complete", "why are checkout requests failing?");
    await expect(assistant.answer().locator('[data-test="assistant-turn-footer"]')).toContainText(/^Evaluated /);
    await assistant.composer().fill("half typed");
    await harness.nextScenario(page, "complete");
    await assistant.answer().locator('[data-test="assistant-rerun"]').click();
    const rerun = assistant.transcript().locator('[data-test="assistant-message-rerun"]');
    await expect(rerun).toHaveText(/^Re-run for \d\d:\d\d–\d\d:\d\d /);
    await expect(assistant.transcript().locator('[data-test="assistant-message-user"]').last()).toContainText(
      "why are checkout requests failing?",
    );
    await expect(assistant.composer()).toHaveValue("half typed");
  });

  test("EVID-05 an inconclusive findings card says so and asserts no cause", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "findings_inconclusive");
    const card = assistant.answer().locator('[data-test="assistant-findings"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-test="assistant-findings-inconclusive"]')).toHaveText(
      "Inconclusive: the assistant couldn't confirm a cause",
    );
    await expect(card.locator('[data-test="assistant-findings-cause"]')).toHaveCount(0);
    await expect(card.locator('[data-test="assistant-findings-unknown"]')).toContainText("payments pool metrics");
  });

  test("EVID-06 the trail is one collapsed line, honest per step, and keyed by call_id", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "complete");
    const toggle = assistant.answer().locator('[data-test="assistant-trail-toggle"]');
    await expect(toggle).toHaveText(/^Worked through 3 steps/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(assistant.answer().locator('[data-test="assistant-step-call_1"]')).toHaveText(
      "Listed streams · 3 streams",
    );
    await expect(assistant.answer().locator('[data-test="assistant-step-call_3"]')).toHaveText(
      /^Queried default · .+ · 4 rows$/,
    );
  });

  test("EVID-07 a failed step stays visible under the collapsed trail and is never green", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "error");
    await expect(assistant.answer().locator('[data-test="assistant-trail-toggle"]')).toHaveText(
      "Worked through 1 step · 1 failed",
    );
    const state = assistant.answer().locator('[data-test="assistant-step-state-call_e1"]');
    await expect(state).toHaveAttribute("data-state", "failed");
    await expect(assistant.answer().locator('[data-test="assistant-step-call_e1"]')).toHaveText(
      "Query failed · Search field not found: latency",
    );
    await expect(assistant.answer().locator('[data-test="assistant-feedback"]')).toHaveCount(0);
  });

  test("EVID-08 a navigation frame becomes a link card that opens only on its click", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await expect.poll(() => page.url(), { timeout: 15_000 }).not.toContain("from=NaN");
    const before = page.url();
    await ask(page, "navigation_card");
    const card = assistant.answer().locator('[data-test="assistant-link-card"]');
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-test="assistant-link-card-title"]')).toHaveText("Open in Logs");
    expect(page.url()).toBe(before);
    await card.locator('[data-test="assistant-link-card-open"]').click();
    await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("ai_chat_query");
    expect(new URL(page.url()).searchParams.get("stream")).toBe("default");
    await expect(card.locator('[data-test="assistant-link-card-outcome"]')).toHaveText(/^Opened · /);
  });

  test("EVID-09 feedback renders only on a done answer and carries that turn's trace id", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    const feedback = [];
    await page.route(/\/ai\/feedback$/, async (route) => {
      feedback.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await ask(page, "complete");
    const down = assistant.answer().locator('[data-test="assistant-feedback-down"]');
    // The popover closes on any scroll of its trigger's container, so the smooth scroll that brings the thumb into view must end first.
    await down.scrollIntoViewIfNeeded();
    await settledScroll(page);
    await down.click();
    const panel = page.locator('[data-test="assistant-feedback-reason"]');
    await expect(panel).toBeVisible();
    await panel.locator('[data-test="assistant-feedback-reason-wrong_query"]').click();
    await panel.locator('[data-test="assistant-feedback-send"]').click();
    await expect(assistant.answer().locator('[data-test="assistant-feedback-thanks"]')).toHaveText("Thanks for the feedback");
    expect(feedback).toEqual([
      expect.objectContaining({ feedback_type: "thumbs_down", trace_id: "4bf92f3577b34da6a3ce929d0e0e4736", query_index: 0, comment: "wrong_query" }),
    ]);
    await expect(down).toHaveAttribute("aria-pressed", "true");
  });

  test("SEC-10 link targets are typed: the route of resource_type, the session's org, chatId only", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "nav_path_override");
    const card = assistant.answer().locator('[data-test="assistant-link-card"]');
    await expect(card.locator('[data-test="assistant-link-card-title"]')).toHaveText("Open dashboard “Checkout”");
    await expect(card).not.toContainText("Sign out now");
    const href = await card.locator('[data-test="assistant-link-card-open"]').getAttribute("href");
    expect(href).toContain("/dashboards/view");
    expect(href).toContain("dashboard=d_checkout");
    expect(href).not.toContain("logout");

    await ask(page, "nav_org_override");
    const alert = assistant.answer().locator('[data-test="assistant-link-card"]');
    const alertHref = await alert.locator('[data-test="assistant-link-card-open"]').getAttribute("href");
    expect(alertHref).toContain(`org_identifier=${harness.ENV.org}`);
    expect(alertHref).not.toContain("evil_org");

    await ask(page, "assistant_stage_link");
    const chat = assistant.answer().locator('[data-test="assistant-link-card"]');
    await expect(chat).toHaveAttribute("data-source", "markdown");
    const chatHref = await chat.locator('[data-test="assistant-link-card-open"]').getAttribute("href");
    expect(chatHref).toContain("/assistant/0190f3a0-0000-7000-8000-000000000abc");
    for (const key of ["assistant=", "object=", "ref="]) expect(chatHref).not.toContain(key);
  });
});

// Copyright 2026 OpenObserve Inc.
// WP-06 honest turns with the flag on: status rows, Stop, drops, reconnects and every failure block (`99` §6.3).

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

// The twenty deleted filler phrases of the legacy chat (HT-01 AC 2); none may reach the DOM.
const FILLER = ["Analyzing your request", "Gathering insights", "Crunching the numbers", "Connecting the dots"];

test.describe("assistant honest turns", () => {
  let assistant;
  let harness;
  let state;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  async function openOnLogs(page) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
  }

  async function ask(page, scenario, text = "why 5xx?", opts = {}) {
    await harness.nextScenario(page, scenario, opts);
    await assistant.send(text);
  }

  const cancels = (page) => page.evaluate(() => window.__o2mock.cancels ?? []);

  // Each step of the slow scenario lasts 450 ms, shorter than the expect retry back-off, so the wait polls per frame.
  async function waitForSteps(page, count) {
    await page.waitForFunction(
      (n) => {
        window.__o2steps = window.__o2steps ?? new Set();
        const row = document.querySelector('[data-test="assistant-turn-status"][data-state="running_tool"]');
        if (row) window.__o2steps.add(row.textContent.trim().split(" · ")[0]);
        return window.__o2steps.size >= n;
      },
      count,
      { polling: "raf", timeout: 20_000 },
    );
  }
  const events = (page) => harness.captureTelemetry(page);

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("SMOKE-02 v2 happy path from the header to done", { tag: ["@mock", "@stack-ee", "@responsive"] }, async ({ page }) => {
    await openOnLogs(page);
    await expect(assistant.sidebar).toBeVisible();
    await ask(page, "complete");
    await expect(assistant.status()).toBeVisible();
    await expect(assistant.answer().locator("h2")).toHaveText("Checkout 5xx spike — what happened");
    await expect(assistant.status()).toHaveCount(0);
    await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true");
    // The evaluated-window footer closes a done answer.
    await expect(assistant.answer().locator('[data-test="assistant-turn-footer"]')).toContainText(/^Evaluated .+·\s*1 query/);
    const ended = (await events(page)).filter((e) => e.name === "ai_turn_ended");
    expect(ended.at(-1)?.properties.outcome).toBe("done");
  });

  test("TEL-01 the funnel fires in order with joinable ids", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "complete");
    await expect(assistant.answer().locator("h2")).toBeVisible();
    await expect.poll(async () => (await events(page)).some((e) => e.name === "ai_turn_ended")).toBe(true);
    const names = (await events(page)).map((e) => e.name);
    const order = ["ai_turn_sent", "ai_turn_first_byte", "ai_turn_ended"].map((n) => names.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const turnEvents = (await events(page)).filter((e) => e.name.startsWith("ai_turn_"));
    expect(new Set(turnEvents.map((e) => e.properties.turn_id)).size).toBe(1);
  });

  test("TEL-03 the legacy names fire for one release and never call an empty turn an answer", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "complete");
    await expect(assistant.answer().locator("h2")).toBeVisible();
    await expect.poll(async () => (await events(page)).map((e) => e.name)).toContain("ai_assistant_answer_completed");
    expect((await events(page)).map((e) => e.name)).toContain("ai_assistant_message_sent");
    await ask(page, "empty_turn", "again");
    await expect(assistant.outcome()).toContainText("The assistant didn't answer.");
    await expect.poll(async () => (await events(page)).filter((e) => e.name === "ai_assistant_answer_failed").length).toBe(1);
    expect((await events(page)).filter((e) => e.name === "ai_assistant_answer_completed")).toHaveLength(1);
  });

  test("TURN-01 real steps, no filler phrases, elapsed after 5 s", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "slow");
    const seen = new Set();
    const watch = async () => {
      for (let i = 0; i < 40; i++) {
        const text = await assistant.status().first().textContent().catch(() => null);
        if (text) seen.add(text.trim());
        if (text?.includes("Querying")) return;
        await page.waitForTimeout(120);
      }
    };
    await watch();
    const all = [...seen].join(" | ");
    expect(all).toContain("Listing streams");
    expect(all).toContain("Reading schema for default");
    expect(all).toContain("Querying default");
    await expect(assistant.status()).toContainText(/· \d+ s/, { timeout: 15_000 });
    for (const phrase of FILLER) await expect(page.getByText(phrase)).toHaveCount(0);
  });

  test("TURN-02 a stall is named in the warning tone and Stop is emphasised", { tag: ["@mock"] }, async ({ page }) => {
    test.setTimeout(90_000);
    await openOnLogs(page);
    await ask(page, "keepalive_stall");
    await expect(assistant.status().locator('[data-test="assistant-turn-status-stall"]')).toContainText(
      /No response for 3\d s/,
      { timeout: 45_000 },
    );
    await expect(assistant.status()).toHaveAttribute("data-tone", "warning");
    await expect(assistant.container().locator('[data-test="assistant-stop"]')).toHaveClass(/secondary/);
  });

  test("TURN-03 Stop keeps findings and cancels on the server", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "slow");
    await waitForSteps(page, 2);
    await assistant.stop();
    await expect(assistant.composer()).toBeFocused();
    await expect(assistant.outcome()).toHaveAttribute("data-kind", "stopped");
    const [cancel] = await cancels(page);
    expect(cancel.keepalive).toBe(true);
    expect(cancel.contentType).toContain("application/json");
    expect(JSON.parse(cancel.body).turn_id).toBeTruthy();
    // Steps render from WP-08, so with no answer text yet the block claims no findings.
    await expect(assistant.outcome().locator('[data-test="assistant-turn-outcome-title"]')).toHaveText("Stopped");
    await expect(assistant.outcomeAction()).toHaveText("Continue");
    const stop = (await events(page)).find((e) => e.name === "ai_stop");
    expect(typeof stop?.properties.server_cancel_ms).toBe("number");
    await assistant.outcomeAction().click();
    await expect(assistant.composer()).toHaveValue("Continue");
  });

  test("TURN-04 an unconfirmed cancel says the server may still be finishing", { tag: ["@mock"] }, async ({ page }) => {
    await page.addInitScript(() => (window.__O2MOCK_KNOBS__ = { ...(window.__O2MOCK_KNOBS__ || {}), cancelStatus: 500 }));
    await openOnLogs(page);
    await harness.setKnobs(page, { cancelStatus: 500 });
    await ask(page, "slow");
    await waitForSteps(page, 1);
    await assistant.stop();
    await expect(assistant.outcome()).toContainText("The server may still be finishing this answer.");
    const stop = (await events(page)).find((e) => e.name === "ai_stop");
    expect(stop?.properties.server_cancel_ms).toBeNull();
  });

  test("TURN-05 a drop mid-stream fails by name and keeps the partial text", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "drop_mid_stream");
    await expect(assistant.outcome()).toHaveAttribute("data-code", "stream_dropped");
    await expect(assistant.outcome()).toContainText(/Connection lost after \d+ s\. Nothing was changed\./);
    await expect(assistant.outcomeAction()).toHaveText("Retry");
    await expect(assistant.answer().locator('[data-test="assistant-block-text"]')).not.toHaveCount(0);
    await expect(page.locator('[data-test^="assistant-feedback"]')).toHaveCount(0);
  });

  // The engine resumes from the turn tail only when the runtime passes `tailEnabled` to turnEngine.ts, which it does not yet.
  test.fixme("TURN-06 a drop with the tail reconnects, catches up and finishes (blocked: the client does not resume a dropped stream from the server's turn tail yet)", { tag: ["@mock", "@stack-ee"] }, async () => {});

  test("TURN-14 a stream whose ids repeat by design shows the whole answer and ends done (D2, WP-18)", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "server_ids", "Reply with exactly: alpha beta gamma. Then a second sentence: delta epsilon.");
    await expect(assistant.answer()).toContainText("alpha beta gamma. Then a second sentence: delta epsilon.");
    await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
    await expect(assistant.outcome()).toHaveCount(0);
    await expect(assistant.answer()).not.toContainText(/Connection lost|No response for/);
    await expect.poll(async () => (await events(page)).find((e) => e.name === "ai_turn_ended")?.properties.outcome).toBe("done");
  });

  test("TURN-07 an empty turn is not an answer", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "empty_turn");
    await expect(assistant.outcome()).toContainText("The assistant didn't answer.");
    await expect.poll(async () => (await events(page)).find((e) => e.name === "ai_turn_ended")?.properties.error_code).toBe(
      "empty_response",
    );
  });

  test("TURN-08 answered but not saved keeps the answer and offers Retry save", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "persistence_failed");
    await expect(assistant.outcome()).toHaveAttribute("data-kind", "doneNotSaved");
    await expect(assistant.outcome()).toContainText("Answered, but not saved to history.");
    await expect(assistant.outcomeAction()).toHaveText("Retry save");
    await assistant.outcomeAction().click();
    await expect(assistant.composer()).toBeFocused();
  });

  test("TURN-09 an oversized frame fails by name and the tab stays responsive", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "oversized_frame");
    await expect(assistant.outcome()).toHaveAttribute("data-code", "stream_oversized");
    await assistant.composer().fill("still typing");
    await expect(assistant.composer()).toHaveValue("still typing");
  });

  test("TURN-10 an owner race restores once with the same turn id", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "owner_race_no_code");
    await expect(assistant.transcript()).toContainText("This chat moved to another server and continued.", {
      timeout: 20_000,
    });
    const requests = await page.evaluate(() => window.__o2mock.requests.map((r) => r.headers?.["x-o2-assistant-turn-id"]));
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
  });

  test("TURN-11 a provider error is a tinted block with Retry and Details holding code and trace", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "error");
    const outcome = assistant.outcome();
    await expect(outcome).toHaveAttribute("data-code", "provider_error");
    await expect(outcome).toHaveClass(/bg-banner-error-soft-bg/);
    await expect(outcome.locator('[data-test="assistant-turn-outcome-title"]')).toHaveText(/The AI provider failed/);
    await expect(assistant.outcomeAction()).toHaveText("Retry");
    await outcome.locator('[data-test="assistant-error-details"] button').first().click();
    await expect(outcome.locator('[data-test="assistant-error-details-code"]')).toHaveText("provider_error");
    await expect(page.getByText(/^Error:/)).toHaveCount(0);
    // The non-AI path opens Logs with the failed step's SQL and the prompt's absolute window.
    const manual = outcome.locator('[data-test="assistant-turn-outcome-manual"]');
    await expect(manual).toHaveText("Open in Logs instead");
    await manual.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("type")).toBe("ai_chat_query");
    const params = new URL(page.url()).searchParams;
    const sql = Buffer.from(params.get("query").replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "="), "base64").toString("utf8");
    expect(sql).toContain("GROUP BY service_name, http_status");
    expect(Number(params.get("to"))).toBeGreaterThan(Number(params.get("from")));
  });

  test("TURN-12 an unknown frame is counted and ignored", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "garbage_body");
    await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true", { timeout: 20_000 });
    expect((await events(page)).some((e) => e.name === "ai_frame_unknown")).toBe(true);
  });

  test("TURN-13 a cancel from elsewhere ends with no action", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "cancelled_frame");
    await expect(assistant.outcome()).toContainText("This answer was stopped from another tab.");
    await expect(assistant.outcomeAction()).toHaveCount(0);
  });

  test("B-02 lifecycle frames read honestly: provider retry, compaction and a policy refusal", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "retrying_frame");
    await expect(assistant.status()).toContainText(/Retrying the AI provider in \d+ s · attempt 2/);
    await assistant.stop();
    await expect(assistant.outcome()).toHaveAttribute("data-kind", "stopped");
    await ask(page, "compacting_frame", "again");
    await expect(assistant.status()).toContainText("Condensing earlier messages");
    await assistant.stop();
    await expect(assistant.outcome()).toHaveAttribute("data-kind", "stopped");
    await ask(page, "permission_denied_frame", "change it");
    await expect(assistant.answer().locator('[data-test="assistant-permission-denied"]')).toHaveText(
      "Blocked by policy: o2_UpdateAlert.",
    );
    await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true");
  });

  test("SHELL-04 a turn survives a closed container and reads unread", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "slow");
    await expect(assistant.status()).toBeVisible();
    await assistant.close();
    await expect(assistant.headerButton).toHaveAttribute("data-state", "working");
    await expect(assistant.headerButton).toHaveAttribute("data-state", "unread", { timeout: 60_000 });
    await assistant.open("header");
    await expect(assistant.answer().locator("h2")).toBeVisible();
    expect(await cancels(page)).toEqual([]);
  });

  test("Go to answer focuses the latest answer from the strip and from Ctrl+↑", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "complete");
    await expect(assistant.answer().locator("h2")).toBeVisible();
    await assistant.strip().locator('[data-test="assistant-strip-go-to-answer"]').click();
    await expect(assistant.answer()).toBeFocused();
    await assistant.composer().click();
    await assistant.composer().press("Control+ArrowUp");
    await expect(assistant.answer()).toBeFocused();
  });
  test("HT-08 a wheel up during a fast stream is never pulled back, and Jump to latest follows again", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "long_answer", "why 5xx?", { speed: 0.5 });
    const log = assistant.transcript();
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 20_000 }).toBeGreaterThan(600);
    await log.hover();
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(300);
    // Scroll anchoring moves scrollTop when rows above the reader change at the turn's end, so the reader's view is the line under the viewport's middle.
    const line = () =>
      log.evaluate((el) => {
        const box = el.getBoundingClientRect();
        // The log itself never moves relative to itself, so only an element inside it can show the reader's line moving.
        window.__ht08Line ??= document
          .elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
          .find((node) => node !== el && el.contains(node));
        return window.__ht08Line ? window.__ht08Line.getBoundingClientRect().top - box.top : null;
      });
    const read = await line();
    expect(read).not.toBeNull();
    await expect(log).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__ht08Line.isConnected)).toBe(true);
    expect(Math.abs((await line()) - read)).toBeLessThan(5);
    expect(await log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(100);
    const jump = assistant.container().locator('[data-test="assistant-scroll-latest"]');
    await expect(jump).toBeVisible();
    await jump.click();
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(3);
    await expect(assistant.outcome().or(assistant.answer())).toBeVisible();
    await expect(jump).toHaveCount(0);
  });

  test("HT-08 Jump to latest during a stream that grows in steps keeps following through its smooth scroll", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "long_answer", "why 5xx?", { speed: 0.1 });
    const log = assistant.transcript();
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 30_000 }).toBeGreaterThan(400);
    await log.hover();
    await page.mouse.wheel(0, -300);
    const jump = assistant.container().locator('[data-test="assistant-scroll-latest"]');
    await expect(jump).toBeVisible();
    await jump.click();
    await page.waitForTimeout(1_500);
    await expect(jump).toHaveCount(0);
    // A read between a mid-stream DOM change and the frame that re-pins can see a few px; a reader left behind never reaches the bottom.
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(3);
  });

  test("HT-08 a turn that ends while following leaves the view at the bottom", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "long_answer", "why 5xx?", { speed: 0.5 });
    const log = assistant.transcript();
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 20_000 }).toBeGreaterThan(600);
    await expect(log).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
    await expect(assistant.outcome().or(assistant.answer())).toBeVisible();
    await page.waitForTimeout(500);
    expect(await log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(3);
    await expect(assistant.container().locator('[data-test="assistant-scroll-latest"]')).toHaveCount(0);
  });

  test("EB-09 Regenerate shows the new attempt as version 2 and gives focus to the composer", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await ask(page, "complete");
    await expect(assistant.answer().locator("h2")).toBeVisible();
    await harness.nextScenario(page, "complete");
    await assistant.answer().hover();
    await assistant.container().locator('[data-test="assistant-msg-regenerate"]').click();
    await expect(assistant.composer()).toBeFocused();
    await expect(assistant.container().locator('[data-test="assistant-version-count"]')).toHaveText("2 of 2");
    await expect(assistant.transcript().locator("article[data-turn-id]")).toHaveCount(1);
  });

  test("EB-09 AC 6 Copy as Markdown sources the SQL fence and ends with the stamp", { tag: ["@mock"] }, async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openOnLogs(page);
    await ask(page, "complete");
    await expect(assistant.answer().locator("h2")).toBeVisible();
    await assistant.answer().hover();
    await assistant.container().locator('[data-test="assistant-msg-copy-md"]').click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("## Checkout 5xx spike — what happened");
    expect(text).toMatch(/```sql\n-- stream default · \d\d:\d\d–\d\d:\d\d \S+/);
    expect(text).toMatch(/Evaluated \d\d:\d\d–\d\d:\d\d \S+ · 1 query$/);
  });

  test("SHELL-08 at 375 the sheet keeps the composer and the last message above an emulated keyboard", { tag: ["@mock", "@responsive"] }, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openOnLogs(page);
    await expect(assistant.sheet).toHaveAttribute("aria-modal", "false");
    await ask(page, "complete");
    await expect(assistant.answer().locator("h2")).toBeVisible();
    await assistant.composer().click();
    // No browser API raises a virtual keyboard, so the visual viewport shrinks the way iOS reports one.
    const keyboard = 320;
    await page.evaluate((kb) => {
      const height = window.innerHeight - kb;
      Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => height });
      window.visualViewport.dispatchEvent(new Event("resize"));
    }, keyboard);
    const sheet = assistant.sheet;
    await expect.poll(async () => Number(await sheet.evaluate((el) => el.style.getPropertyValue("--o-sheet-kb")))).toBeGreaterThan(0);
    const limit = 812 - keyboard;
    const composerBox = await assistant.composer().boundingBox();
    expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(limit + 1);
    await assistant.transcript().evaluate((el) => (el.scrollTop = el.scrollHeight));
    const last = await assistant.answer().boundingBox();
    const transcriptBox = await assistant.transcript().boundingBox();
    expect(transcriptBox.y + transcriptBox.height).toBeLessThanOrEqual(limit + 1);
    expect(last.y).toBeLessThan(limit);
  });
});

// Copyright 2026 OpenObserve Inc.
// WP-06 performance budgets of the transcript (`99` §2.1, PERF-02, PERF-07; PERF-03 opens its chat from history in history.spec.js).

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

// `99` §2.1 budgets the production bundle (CI adds a 4× CPU throttle); the Vite dev build only reports its numbers.
const LONG_TASK_MS = 50;
const INPUT_P95_MS = 100;

// A hostile answer gets the same budget as any answer: no main-thread task past 50 ms (round 5 goal; round 3 had one 22 s lex).
const BOMB_LONG_TASK_MS = LONG_TASK_MS;

const CODE_BLOCK = '[data-test="assistant-code-block"]';

const CODE_HIGHLIGHTED = '[data-test="assistant-code-block"]:has(code span)';

const QUERY_BLOCK = '[data-test="assistant-query-block"]';

const QUERY_HIGHLIGHTED = '[data-test="assistant-query-text"]:has(code span)';

const PLAIN_FENCE =
  '[data-test="assistant-block-text"] pre:not([data-test="assistant-code-block"] pre):not([data-test="assistant-query-block"] pre)';

test.describe("assistant transcript performance", () => {
  let assistant;
  let harness;

  async function openOnLogs(page) {
    await page.goto(`${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`, {
      waitUntil: "domcontentloaded",
    });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
  }

  async function observeLongTasks(page) {
    await page.evaluate(() => {
      window.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: false });
    });
  }

  // Top to bottom one screen at a time, as a reader would.
  async function scrollThrough(page) {
    await assistant.transcript().evaluate(async (log) => {
      log.scrollTop = 0;
      for (let step = 0; step < 2_000 && log.scrollTop + log.clientHeight < log.scrollHeight - 2; step++) {
        log.scrollTop += log.clientHeight;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });
  }

  // Types while the answer streams and measures keydown → next frame, the latency the reader feels.
  async function typeDuringStream(page) {
    return page.evaluate(async () => {
      const box = document.querySelector('[data-assistant-root] [data-test="assistant-composer-field"]');
      const latencies = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        box.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        box.value += "a";
        box.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        latencies.push(performance.now() - start);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      latencies.sort((a, b) => a - b);
      return latencies[Math.floor(latencies.length * 0.95) - 1];
    });
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    await harness.installMocks(context, harness.createMockState());
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("PERF-02 a long answer streams without long tasks or input lag, parsing only the open block", { tag: ["@mock"] }, async ({ page }, info) => {
    await openOnLogs(page);
    // The budget is the stream's; the container's own opening work settles first.
    await page.waitForTimeout(1_500);
    await observeLongTasks(page);
    const parsesBefore = harness.ENV.viteDev
      ? await page.evaluate(async () => (await import("/web/src/components/ai-assistant/transcript/markdown.ts")).markdownParseCount())
      : 0;
    await harness.nextScenario(page, "long_answer");
    await assistant.send("long");
    const p95 = await typeDuringStream(page);
    await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
    const longTasks = await page.evaluate(() => window.__longTasks);
    const measured = `input p95 ${p95.toFixed(1)} ms; long tasks ${JSON.stringify(longTasks.map(Math.round))}`;
    info.annotations.push({ type: "perf", description: measured });
    console.log(`PERF-02 ${measured}`);
    if (harness.ENV.viteDev) {
      const parses = await page.evaluate(async () => (await import("/web/src/components/ai-assistant/transcript/markdown.ts")).markdownParseCount());
      // One parse per committed batch of the one open block, plus the closed parse: never a re-parse of earlier blocks.
      expect(parses - parsesBefore).toBeLessThanOrEqual(402 + 2);
      return;
    }
    expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(LONG_TASK_MS);
    expect(p95).toBeLessThanOrEqual(INPUT_P95_MS);
  });

  test("PERF-02 fenced: an open fence renders as plain text and highlights once it closes", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await harness.nextScenario(page, "long_answer_fenced");
    await assistant.send("fences");
    // A closed SQL fence becomes the runnable query block; the unlabelled one stays a code block.
    const sql = assistant.answer().locator('[data-test="assistant-query-block"]');
    const open = assistant.answer().locator('[data-test="assistant-code-block"]').last();
    await expect(open).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => open.locator("code span").count(), { timeout: 2_000 }).toBe(0);
    await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
    await expect(sql).toHaveCount(1);
    await expect(sql.locator('[data-test="assistant-query-language"]')).toHaveText("SQL");
  });

  // Each case: the text the reader must see, and how many of each element the answer must hold (">0" for some).
  for (const [scenario, shown, shape] of [
    ["markdown_bomb", "*a *a *a"],
    ["markdown_bomb_table", "|a|a|a|"],
    ["markdown_bomb_links", "[a] [a] [a]"],
    ["markdown_bomb_quote_table", "|a|a|a|"],
    ["markdown_bomb_small_blocks", "a:"],
    ["markdown_bomb_code", "$$$$"],
    ["markdown_bomb_table_rows", "| val | val |", { table: 0 }],
    ["markdown_dense_answer", "Section 3: error rate analysis", { h2: ">0", table: ">0" }],
    ["markdown_dense_list", "a", { '[data-test="assistant-block-text"] li': 4_990 }],
    ["markdown_dense_lines", "a\na\na", { '[data-test="assistant-block-plain"]': ">0" }],
    ["markdown_table_cap", "| val | val |", { tr: 200 }],
    ["markdown_bomb_long_link", "Done.", { strong: ">0", 'a[href^="https://e.com"]': 0 }],
    ["markdown_bomb_alt", "After.", { strong: ">0", "img[alt$='…']": 1 }],
    // The first 40 SQL fences are query blocks, highlighted; the rest are plain `<pre>` by design.
    ["markdown_query_examples", "Here are queries you can run", { [QUERY_BLOCK]: 40, [QUERY_HIGHLIGHTED]: 40, [PLAIN_FENCE]: 110 }],
    ["markdown_bomb_fences", "a", { [CODE_BLOCK]: 40, [PLAIN_FENCE]: 1_960 }],
  ]) {
    test(`Rounds 4-8 ${scenario}: the main thread never takes the parse, a long mount or the fill of a scroll through the answer`, { tag: ["@mock"] }, async ({ page }, info) => {
      await openOnLogs(page);
      await page.waitForTimeout(1_500);
      await observeLongTasks(page);
      await harness.nextScenario(page, scenario);
      await assistant.send("bomb");
      const p95 = await typeDuringStream(page);
      await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
      await expect(assistant.answer()).toContainText(shown, { timeout: 15_000 });
      // Every part fills once, in priority order; the reader then scrolls the whole answer while the long tasks are still counted (Q8).
      await expect(assistant.answer().locator("[data-pending]")).toHaveCount(0, { timeout: 60_000 });
      await scrollThrough(page);
      for (const [selector, count] of Object.entries(shape ?? {})) {
        const found = assistant.answer().locator(selector);
        if (count === ">0") await expect(found.first()).toBeAttached({ timeout: 15_000 });
        else await expect(found).toHaveCount(count, { timeout: 15_000 });
      }
      const longTasks = await page.evaluate(() => window.__longTasks);
      const measured = `input p95 ${p95.toFixed(1)} ms; long tasks ${JSON.stringify(longTasks.map(Math.round))}`;
      info.annotations.push({ type: "perf", description: measured });
      console.log(`BOMB ${scenario} ${measured}`);
      if (harness.ENV.viteDev) return;
      expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(BOMB_LONG_TASK_MS);
      expect(p95).toBeLessThanOrEqual(INPUT_P95_MS);
    });
  }

  test("PERF-07 an open container at rest runs no interval or animation loop", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await harness.nextScenario(page, "complete");
    await assistant.send("why 5xx?");
    await expect(assistant.transcript()).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
    await page.waitForTimeout(1_000);
    const calls = await page.evaluate(async () => {
      const counts = { interval: 0, raf: 0 };
      const setInterval = window.setInterval;
      const raf = window.requestAnimationFrame;
      window.setInterval = (...args) => {
        counts.interval += 1;
        return setInterval(...args);
      };
      window.requestAnimationFrame = (cb) => {
        counts.raf += 1;
        return raf(cb);
      };
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      window.setInterval = setInterval;
      window.requestAnimationFrame = raf;
      return counts;
    });
    expect(calls).toEqual({ interval: 0, raf: 0 });
  });
});

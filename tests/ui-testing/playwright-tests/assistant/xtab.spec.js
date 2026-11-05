// Copyright 2026 OpenObserve Inc.
// One chat open in two tabs of one browser: the second tab follows a running answer, can stop it, and browser-only chats lose no turn.

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant chats in two tabs", () => {
  let harness;
  let state;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;
  const chatUrl = (sid) => `${harness.ENV.appUrl}/assistant/${sid}?org_identifier=${harness.ENV.org}`;

  async function start(context, page, overrides = {}) {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    state = harness.createMockState(overrides);
    await harness.installMocks(context, state);
    await harness.login(page);
  }

  async function openOnLogs(page) {
    const assistant = new AssistantPage(page);
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", /idle|open/, { timeout: 30_000 });
    if ((await assistant.headerButton.getAttribute("data-state")) === "idle") await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
    return assistant;
  }

  const sessionOf = (page) =>
    page.evaluate(() => window.__o2mock.requests.at(-1)?.headers["x-o2-assistant-session-id"]);

  // The browser record of one chat, read through the app's own store.
  const storedTurns = (page, sid) =>
    page.evaluate(async (chat) => {
      const index = await import("/web/src/composables/assistant/index.ts");
      const { createIndexedDbHistory } = await import("/web/src/composables/assistant/historyDb.ts");
      const rows = await createIndexedDbHistory().list(index.assistantStore.state.userOrgKey);
      const row = rows.find((r) => r.sessionId === chat);
      return { rev: row?.rev ?? 0, prompts: (row?.turns ?? []).map((t) => t.user?.text) };
    }, sid);

  const elsewhere = (assistant) => assistant.container().locator('[data-test="assistant-shell-elsewhere"]');

  test("XTAB-01 a second tab opening a running chat follows it with Send locked and Stop offered", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    const a = await openOnLogs(page);
    await harness.nextScenario(page, "slow");
    await a.send("why did checkout throw 5xx?");
    await expect(a.status()).toBeVisible({ timeout: 15_000 });
    const sid = await sessionOf(page);
    const tabB = await context.newPage();
    const b = new AssistantPage(tabB);
    await tabB.goto(chatUrl(sid), { waitUntil: "domcontentloaded" });
    await expect(elsewhere(b).locator('[data-test="assistant-shell-elsewhere-status"]')).toHaveText(
      /answering in another tab/i,
      { timeout: 30_000 },
    );
    await expect(elsewhere(b).locator('[data-test="assistant-shell-elsewhere-stop"]')).toBeVisible();
    await expect(b.container().locator('[data-test="assistant-stop"]')).toBeVisible();
    await expect(b.container().locator('[data-test="assistant-send"]')).toHaveCount(0);
    await b.composer().fill("and the payments service?");
    await b.composer().press("Enter");
    expect(await tabB.evaluate(() => window.__o2mock.requests.length)).toBe(0);
    await expect(b.composer()).toHaveValue("and the payments service?");
  });

  test("XTAB-04 Stop in the second tab ends the answer in the first and says where it was stopped", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    const a = await openOnLogs(page);
    await harness.nextScenario(page, "slow");
    await a.send("why did checkout throw 5xx?");
    await expect(a.status()).toBeVisible({ timeout: 15_000 });
    const sid = await sessionOf(page);
    const tabB = await context.newPage();
    const b = new AssistantPage(tabB);
    await tabB.goto(chatUrl(sid), { waitUntil: "domcontentloaded" });
    const stop = elsewhere(b).locator('[data-test="assistant-shell-elsewhere-stop"]');
    await expect(stop).toBeVisible({ timeout: 30_000 });
    await stop.click();
    await expect.poll(() => tabB.evaluate(() => (window.__o2mock.cancels ?? []).length), { timeout: 15_000 }).toBe(1);
    await expect(a.transcript()).toContainText("This answer was stopped from another tab.", { timeout: 15_000 });
    await expect(elsewhere(b)).toHaveCount(0, { timeout: 30_000 });
  });

  test("XTAB-06 a second tab polls a running chat every 4 s, then every 15 s, and stops at ten minutes with Refresh", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(150_000);
    await start(context, page);
    const a = await openOnLogs(page);
    await harness.nextScenario(page, "hang_tool");
    await a.send("why did checkout throw 5xx?");
    await expect(a.status()).toBeVisible({ timeout: 15_000 });
    const sid = await sessionOf(page);
    const tabB = await context.newPage();
    await tabB.clock.install();
    // The page's own clock stamps each chat read, so the cadence is checked in its time, not the runner's.
    await tabB.addInitScript(() => {
      window.__chatReads = [];
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (method === "GET" && /\/ai\/chats\/[^/?]+(\?|$)/.test(String(url))) window.__chatReads.push(Date.now());
        return open.call(this, method, url, ...rest);
      };
    });
    const b = new AssistantPage(tabB);
    await tabB.goto(chatUrl(sid), { waitUntil: "domcontentloaded" });
    const status = elsewhere(b).locator('[data-test="assistant-shell-elsewhere-status"]');
    await expect(status).toHaveText(/answering in another tab/i, { timeout: 30_000 });
    const read = new RegExp(`^GET /api/[^/]+/ai/chats/${sid}(\\?|$)`);
    const reads = () => state.log.filter((line) => read.test(line)).length;
    await tabB.clock.runFor(2 * 60_000);
    const stamps = await tabB.evaluate(() => window.__chatReads);
    const polls = stamps.slice(1);
    const gaps = polls.slice(1).map((at, i) => [at - stamps[1], at - polls[i]]);
    expect(polls.length).toBeGreaterThanOrEqual(17);
    for (const [since, gap] of gaps) {
      expect(gap).toBeGreaterThanOrEqual(3_900);
      if (since > 65_000) expect(gap).toBeGreaterThanOrEqual(14_500);
      else if (since < 55_000) expect(gap).toBeLessThanOrEqual(4_500);
    }
    // Jumping skips the timers in between, so only the ten-minute limit is checked here.
    await tabB.clock.fastForward(9 * 60_000);
    await tabB.clock.runFor(30_000);
    await expect(status).toHaveText("Still running. Refresh to check again.", { timeout: 10_000 });
    const stopped = reads();
    await tabB.clock.runFor(2 * 60_000);
    expect(reads()).toBe(stopped);
    await elsewhere(b).locator('[data-test="assistant-shell-elsewhere-refresh"]').click();
    await expect.poll(() => reads(), { timeout: 10_000 }).toBe(stopped + 1);
    await page.evaluate(() => window.__o2mock.release?.());
  });

  test("XTAB-09 a browser-only chat written from two tabs keeps every turn in order", { tag: ["@mock"] }, async ({ context, page }) => {
    test.setTimeout(150_000);
    await start(context, page, { persistence: false });
    const a = await openOnLogs(page);
    await harness.nextScenario(page, "slow");
    await a.send("turn one");
    await expect(a.status()).toBeVisible({ timeout: 15_000 });
    const sid = await sessionOf(page);
    const tabB = await context.newPage();
    const b = new AssistantPage(tabB);
    await expect.poll(() => storedTurns(page, sid).then((row) => row.prompts.length), { timeout: 15_000 }).toBe(1);
    await tabB.goto(chatUrl(sid), { waitUntil: "domcontentloaded" });
    await expect(b.container().locator('[data-test="assistant-stop"]')).toBeVisible({ timeout: 30_000 });
    await expect(a.composerState()).toHaveAttribute("data-state", "empty", { timeout: 60_000 });
    await expect(b.transcript()).toContainText("turn one", { timeout: 30_000 });
    await expect(b.container().locator('[data-test="assistant-stop"]')).toHaveCount(0, { timeout: 30_000 });
    await b.send("turn two", "complete");
    await expect(b.composerState()).toHaveAttribute("data-state", "empty", { timeout: 60_000 });
    await expect(a.transcript()).toContainText("turn two", { timeout: 30_000 });
    await a.send("turn three", "complete");
    await expect(a.composerState()).toHaveAttribute("data-state", "empty", { timeout: 60_000 });
    const stored = await storedTurns(page, sid);
    expect(stored.prompts).toEqual(["turn one", "turn two", "turn three"]);
    expect(stored.rev).toBeGreaterThanOrEqual(3);
  });

  test("XTAB-01 the other tab's header lights working within 500 ms of the send", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await start(context, page);
    const a = await openOnLogs(page);
    const tabB = await context.newPage();
    const b = new AssistantPage(tabB);
    await tabB.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(b.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await tabB.evaluate(() => {
      window.__lit = null;
      const mark = () => {
        const button = document.querySelector('[data-test="menu-link-ai-item"]');
        if (!window.__lit && button?.getAttribute("data-state") === "working") window.__lit = Date.now();
      };
      new MutationObserver(mark).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-state"] });
    });
    await harness.nextScenario(page, "slow");
    await a.send("why did checkout throw 5xx?");
    await expect.poll(() => tabB.evaluate(() => window.__lit), { timeout: 15_000 }).not.toBeNull();
    const sentAt = await page.evaluate(() => window.__o2mock.requests.at(-1).at);
    const litAt = await tabB.evaluate(() => window.__lit);
    expect(litAt - sentAt).toBeLessThanOrEqual(500);
  });

  test("XTAB-02 a Send racing another device's turn is refused turn_busy, the prompt comes back and nothing is stored", { tag: ["@mock", "@stack-ee"] }, async ({
    browser,
    context,
    page,
  }) => {
    await start(context, page);
    const a = await openOnLogs(page);
    await harness.nextScenario(page, "complete");
    await a.send("turn one");
    await expect(a.composerState()).toHaveAttribute("data-state", "empty", { timeout: 60_000 });
    const sid = await sessionOf(page);
    const device = await browser.newContext();
    await harness.setFlag(device, true);
    await harness.installMocks(device, state);
    const tabB = await device.newPage();
    await harness.login(tabB);
    const b = new AssistantPage(tabB);
    await tabB.goto(chatUrl(sid), { waitUntil: "domcontentloaded" });
    await expect(b.transcript()).toContainText("turn one", { timeout: 30_000 });
    await harness.nextScenario(page, "slow");
    await a.send("turn two");
    await expect(a.status()).toBeVisible({ timeout: 15_000 });
    await harness.setKnobs(tabB, { envelopeEnabled: true });
    await harness.nextScenario(tabB, "lease_409");
    await b.send("racing prompt");
    await expect(b.outcome()).toHaveAttribute("data-kind", "refused", { timeout: 15_000 });
    await expect(b.outcome()).toContainText("Another answer is still running in this chat. Your message wasn't sent.");
    await expect(b.composer()).toHaveValue("racing prompt");
    await expect(a.status()).toBeVisible();
    const chat = state.chats.find((c) => c.session_id === sid);
    expect(JSON.stringify(chat)).not.toContain("racing prompt");
    expect((await storedTurns(tabB, sid)).prompts).not.toContain("racing prompt");
    await device.close();
  });

  test("XTAB-06 a hidden second tab stops polling and reads once it is visible again", { tag: ["@mock"] }, async ({ context, page }) => {
    test.setTimeout(120_000);
    await start(context, page);
    const a = await openOnLogs(page);
    await harness.nextScenario(page, "hang_tool");
    await a.send("why did checkout throw 5xx?");
    await expect(a.status()).toBeVisible({ timeout: 15_000 });
    const sid = await sessionOf(page);
    const tabB = await context.newPage();
    await tabB.clock.install();
    await tabB.addInitScript(() => {
      window.__hidden = false;
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window.__hidden ? "hidden" : "visible") });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__hidden });
    });
    const b = new AssistantPage(tabB);
    await tabB.goto(chatUrl(sid), { waitUntil: "domcontentloaded" });
    await expect(elsewhere(b).locator('[data-test="assistant-shell-elsewhere-status"]')).toHaveText(
      /answering in another tab/i,
      { timeout: 30_000 },
    );
    const read = new RegExp(`^GET /api/[^/]+/ai/chats/${sid}(\\?|$)`);
    const reads = () => state.log.filter((line) => read.test(line)).length;
    await tabB.clock.runFor(10_000);
    const flip = (hidden) =>
      tabB.evaluate((value) => {
        window.__hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);
    await flip(true);
    await tabB.clock.runFor(1_000);
    const hiddenAt = reads();
    await tabB.clock.runFor(2 * 60_000);
    expect(reads()).toBe(hiddenAt);
    await flip(false);
    await tabB.clock.runFor(1_000);
    await expect.poll(() => reads(), { timeout: 10_000 }).toBeGreaterThan(hiddenAt);
    await page.evaluate(() => window.__o2mock.release?.());
  });

  test("XTAB-09 legacyTab: a flag-off tab writing the same browser chat keeps the database at version 2 and loses no turn", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(150_000);
    await start(context, page, { persistence: false });
    const a = await openOnLogs(page);
    await harness.nextScenario(page, "complete");
    await a.send("turn one");
    await expect(a.composerState()).toHaveAttribute("data-state", "empty", { timeout: 60_000 });
    const sid = await sessionOf(page);
    await expect.poll(() => storedTurns(page, sid).then((row) => row.prompts.length), { timeout: 15_000 }).toBe(1);
    const tabB = await context.newPage();
    const errors = [];
    tabB.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    await tabB.addInitScript(() => {
      window.__O2_ASSISTANT_V2__ = false;
    });
    await tabB.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(new AssistantPage(tabB).legacy.headerButton).toBeVisible({ timeout: 30_000 });
    const legacy = await tabB.evaluate(
      async ([chat, email, org]) => {
        const { useChatHistory } = await import("/web/src/composables/useChatHistory.ts");
        const history = useChatHistory(() => email, () => org, (key) => key);
        const row = (await history.loadHistory()).find((entry) => entry.sessionId === chat);
        await history.saveToHistory(
          [...row.messages, { role: "user", content: "turn two" }, { role: "assistant", content: "answer two" }],
          chat,
          row.title,
          row.id,
        );
        const dbs = await indexedDB.databases();
        return { version: dbs.find((db) => db.name === "o2ChatDB")?.version, found: !!row };
      },
      [sid, harness.ENV.user, harness.ENV.org],
    );
    expect(legacy).toEqual({ version: 2, found: true });
    await page.goto(chatUrl(sid), { waitUntil: "domcontentloaded" });
    await expect(a.transcript()).toContainText("turn two", { timeout: 30_000 });
    await a.send("turn three", "complete");
    await expect(a.composerState()).toHaveAttribute("data-state", "empty", { timeout: 60_000 });
    const prompts = await page.evaluate(async (chat) => {
      const index = await import("/web/src/composables/assistant/index.ts");
      const { createIndexedDbHistory } = await import("/web/src/composables/assistant/historyDb.ts");
      const rows = await createIndexedDbHistory().list(index.assistantStore.state.userOrgKey);
      const row = rows.find((r) => r.sessionId === chat);
      return row.messages.filter((m) => m.role === "user").map((m) => String(m.content));
    }, sid);
    expect(prompts).toEqual(["turn one", "turn two", "turn three"]);
    const back = await tabB.evaluate(
      async ([chat, email, org]) => {
        const { useChatHistory } = await import("/web/src/composables/useChatHistory.ts");
        const history = useChatHistory(() => email, () => org, (key) => key);
        const row = (await history.loadHistory()).find((entry) => entry.sessionId === chat);
        return row.messages.filter((m) => m.role === "user").map((m) => String(m.content));
      },
      [sid, harness.ENV.user, harness.ENV.org],
    );
    expect(back).toEqual(["turn one", "turn two", "turn three"]);
    expect(errors.filter((text) => /VersionError/.test(text))).toEqual([]);
  });
});

// Copyright 2026 OpenObserve Inc.
// Chat history with the flag on: browser-only mode, the cap, failures that stay visible, chats deleted elsewhere and moving browser chats to the account.

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant history", () => {
  let assistant;
  let harness;
  let state;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  async function start(context, page, overrides = {}) {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    state = harness.createMockState(overrides);
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  }

  async function openOnLogs(page) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", /idle|open/, { timeout: 30_000 });
    // The container's open state survives a reload.
    if ((await assistant.headerButton.getAttribute("data-state")) === "idle") await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
  }

  async function answered(page, text, scenario = "complete") {
    await assistant.send(text, scenario);
    await expect(assistant.answer()).toBeVisible({ timeout: 15_000 });
    await expect(assistant.composerState()).toHaveAttribute("data-state", "empty", { timeout: 30_000 });
  }

  // Writes browser chats through the app's own store; the oldest gets index 0.
  async function seedLocal(page, count, from = 0) {
    await page.evaluate(
      async ([n, first]) => {
        const index = await import("/web/src/composables/assistant/index.ts");
        const { createIndexedDbHistory } = await import("/web/src/composables/assistant/historyDb.ts");
        const key = index.assistantStore.state.userOrgKey;
        if (!key) throw new Error("no userOrgKey yet");
        const db = createIndexedDbHistory();
        const base = Date.now() - 30 * 86_400_000;
        for (let i = first; i < first + n; i += 1) {
          const at = base + i * 600_000;
          await db.merge(
            {
              id: 900_000 + i,
              timestamp: new Date(at).toISOString(),
              title: `Seeded chat ${i}`,
              messages: [
                { role: "user", content: `Seeded question ${i}`, sentAt: at },
                { role: "assistant", content: `Seeded answer ${i}` },
              ],
              sessionId: crypto.randomUUID(),
              userOrgKey: key,
            },
            "seed",
          );
        }
      },
      [count, from],
    );
  }

  const localTitles = (page) =>
    page.evaluate(async () => {
      const index = await import("/web/src/composables/assistant/index.ts");
      const { createIndexedDbHistory } = await import("/web/src/composables/assistant/historyDb.ts");
      const rows = await createIndexedDbHistory().list(index.assistantStore.state.userOrgKey);
      return rows.filter((row) => !row.serverBacked).map((row) => row.title).sort();
    });

  const item = (title) =>
    assistant.history().locator('[data-test="assistant-history-item"]').filter({ hasText: title });

  async function signOut(page) {
    await page.mouse.move(0, 0);
    await page.locator('[data-test="header-my-account-profile-icon"]').click();
    await page.locator('[data-test="menu-link-logout-item"]').click();
    await page.waitForURL(/\/login/);
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  // Every row of the shared browser database and every recall key, whoever wrote them.
  const atRest = (page) =>
    page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("o2ChatDB");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = db.objectStoreNames.contains("chatHistory")
        ? await new Promise((resolve) => {
            const request = db.transaction("chatHistory").objectStore("chatHistory").getAll();
            request.onsuccess = () => resolve(request.result.map((row) => row.title));
          })
        : [];
      db.close();
      const recall = Object.keys(localStorage).filter((key) => key.startsWith("ai-chat-query-history:"));
      return { rows, recall };
    });

  for (const [label, overrides, clear, kept] of [
    ["(a) server history always purges the browser copy", {}, false, false],
    ["(b) browser-only with Delete on sign-out purges", { persistence: false }, true, false],
    ["(c) browser-only without it keeps the chats and says so", { persistence: false }, false, true],
  ]) {
    test(`LIFE-03 sign-out with nothing running ${label}`, { tag: ["@mock"] }, async ({ context, page }) => {
      await start(context, page, overrides);
      await openOnLogs(page);
      await answered(page, "why did checkout throw 5xx?");
      if (clear) {
        await assistant.openHistory();
        await assistant.history().locator('[data-test="assistant-local-info"]').click();
        const box = page.locator('[data-test="assistant-local-clear-on-signout"] [role="checkbox"]');
        await box.click();
        await expect(box).toHaveAttribute("aria-checked", "true");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
      await expect.poll(async () => (await atRest(page)).rows.length).toBeGreaterThan(0);
      await signOut(page);
      await expect(page.locator('[data-test="assistant-shell-sign-out-stop"]')).toHaveCount(0);
      const after = await atRest(page);
      expect(after.recall).toEqual([]);
      if (!kept) {
        expect(after.rows).toEqual([]);
        return;
      }
      expect(after.rows).toContain("Checkout 5xx spike in prod");
      await harness.login(page);
      await openOnLogs(page);
      await assistant.openHistory();
      await expect(assistant.history().locator('[data-test="assistant-history-kept"]')).toHaveText(
        "Your browser chats were kept when you signed out.",
      );
    });
  }

  test("SEC-08 a second user signing in on the same browser sees none of the first user's chats, drafts or recall", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(150_000);
    await start(context, page, { persistence: false });
    await openOnLogs(page);
    await answered(page, "why did checkout throw 5xx?");
    await assistant.composer().fill("a draft only the first user wrote");
    await signOut(page);
    expect((await atRest(page)).rows).toContain("Checkout 5xx spike in prod");
    await harness.login(page, await harness.createUser());
    await openOnLogs(page);
    await expect(assistant.composer()).toHaveValue("");
    await assistant.composer().press("ArrowUp");
    await expect(assistant.composer()).toHaveValue("");
    await assistant.openHistory();
    await expect(assistant.history().locator('[data-test="assistant-history-empty"]')).toBeVisible();
    await expect(assistant.history().locator('[data-test="assistant-local-only-line"]')).toHaveText(
      "Saved in this browser only · 0 of 100",
    );
    await expect(assistant.history().locator('[data-test="assistant-history-kept"]')).toHaveCount(0);
  });

  test("GATE-09 without server history the list says it is saved in this browser only and never asks the server", { tag: ["@mock", "@stack-ee", "@responsive"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, { persistence: false });
    await openOnLogs(page);
    await answered(page, "why did checkout throw 5xx?");
    await assistant.openHistory();
    await expect(assistant.history().locator('[data-test="assistant-local-only-line"]')).toHaveText(
      "Saved in this browser only · 1 of 100",
    );
    await expect(assistant.history().locator('[data-test="assistant-history-account"]')).toHaveCount(0);
    await expect(item("Checkout 5xx spike in prod")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(assistant.thread().locator('[data-test="assistant-thread-download"]')).toBeVisible();
    await expect(assistant.container().locator('[data-test^="assistant-share"]')).toHaveCount(0);
    expect(state.log.filter((line) => /^GET \/api\/[^/]+\/ai\/chats/.test(line))).toEqual([]);
  });

  test("HIST-01 the list warns near the cap and the 101st chat removes the oldest with a notice", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    await start(context, page, { persistence: false });
    await openOnLogs(page);
    await seedLocal(page, 95);
    await openOnLogs(page);
    await assistant.openHistory();
    const line = assistant.history().locator('[data-test="assistant-local-only-line"]');
    await expect(line).toHaveText(
      "95 of 100 · the oldest unpinned chat is removed when you reach 100",
    );
    await expect(line).toHaveAttribute("data-near", "");
    await seedLocal(page, 5, 95);
    await openOnLogs(page);
    await answered(page, "why did checkout throw 5xx?");
    await expect(
      page.locator('[data-test="o-toast-message"]').filter({ hasText: "Removed the oldest chat to make room: “Seeded chat 0”" }),
    ).toBeVisible({ timeout: 15_000 });
    const titles = await localTitles(page);
    expect(titles).toHaveLength(100);
    expect(titles).not.toContain("Seeded chat 0");
    expect(titles).toContain("Checkout 5xx spike in prod");
  });

  test("HIST-02 a delete the server refuses puts the row back and says so", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page, { deleteStatus: 500 });
    await openOnLogs(page);
    await assistant.openHistory();
    const row = item("PromQL for p95 latency by service");
    await expect(row).toHaveCount(1);
    await row.locator('[data-test="assistant-history-row-menu"]').click();
    await page.locator('[data-test="assistant-history-row-delete"]').click();
    const dialog = page.locator('[data-test="assistant-history-delete-dialog"]');
    await expect(dialog).toContainText("Delete “PromQL for p95 latency by service”?");
    await dialog.locator('[data-test="o-dialog-primary-btn"]').click();
    await expect(page.getByText("Couldn't delete the chat").first()).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-test="assistant-history-row-pending"]')).toHaveCount(0);
    expect(state.log.some((line) => /^DELETE \/api\/[^/]+\/ai\/chats\//.test(line))).toBe(true);
  });

  test("HIST-03 opening a chat deleted on another device says so and offers a new chat", { tag: ["@mock", "@stack-ee"] }, async ({
    context,
    page,
  }) => {
    await start(context, page);
    await openOnLogs(page);
    await assistant.openHistory();
    await expect(item("VRL to parse nginx logs")).toHaveCount(1);
    state.chats = state.chats.filter((chat) => chat.title !== "VRL to parse nginx logs");
    await assistant.historyRow("VRL to parse nginx logs").click();
    const deleted = assistant.container().locator('[data-test="assistant-shell-deleted"]');
    await expect(deleted).toContainText("This chat was deleted elsewhere", { timeout: 15_000 });
    await deleted.getByRole("button", { name: "New chat" }).click();
    await expect(deleted).toHaveCount(0);
    await expect(assistant.composer()).toBeVisible();
  });

  test("HIST-04 browser chats move to the account, failures stay in the browser and only moved ones leave it", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, {
      capabilitiesEnabled: true,
      capabilities: { history_import: true },
      importEnabled: true,
      importFailTitles: ["Seeded chat 2"],
    });
    await openOnLogs(page);
    await seedLocal(page, 3);
    await openOnLogs(page);
    await assistant.openHistory();
    const banner = assistant.history().locator('[data-test="assistant-local-import-banner"]');
    await expect(banner).toContainText(
      "You have 3 chats saved in this browser. Move them to your account so they appear on every device?",
    );
    await banner.locator('[data-test="assistant-local-import-move"]').click();
    await expect(banner).toContainText("1 chat couldn't be moved", { timeout: 15_000 });
    await expect(banner.locator('[data-test="assistant-local-import-failed"]')).toContainText("Seeded chat 2");
    await expect.poll(() => localTitles(page)).toEqual(["Seeded chat 2"]);
    expect(state.chats.map((chat) => chat.title)).toEqual(
      expect.arrayContaining(["Seeded chat 0", "Seeded chat 1"]),
    );
    expect(state.chats.map((chat) => chat.title)).not.toContain("Seeded chat 2");
  });

  const search = () => assistant.history().locator('[data-test="assistant-history-search"] input');

  test("DOD-03 with server search the list asks the server with q and shows only its answer", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, { capabilitiesEnabled: true, historySearchEnabled: true });
    await openOnLogs(page);
    await assistant.openHistory();
    await expect(item("VRL to parse nginx logs")).toHaveCount(1);
    await search().fill("nginx");
    await expect.poll(() => state.log.some((line) => /^GET \/api\/[^/]+\/ai\/chats\?.*\bq=nginx\b/.test(line)), {
      timeout: 15_000,
    }).toBe(true);
    await expect(assistant.history().locator('[data-test="assistant-history-row"]')).toHaveCount(1);
    await expect(item("VRL to parse nginx logs")).toHaveCount(1);
    await expect(assistant.history().locator('[data-test="assistant-history-search-line"]')).not.toContainText(
      "loaded",
    );
  });

  test("DOD-03 without server search the list filters what it loaded and never sends q", { tag: ["@mock"] }, async ({ context, page }) => {
    await start(context, page);
    await openOnLogs(page);
    await assistant.openHistory();
    await search().fill("nginx");
    await expect(assistant.history().locator('[data-test="assistant-history-row"]')).toHaveCount(1);
    expect(state.log.some((line) => /^GET \/api\/[^/]+\/ai\/chats\?.*\bq=/.test(line))).toBe(false);
  });

  test("DOD-03 with server pins a pin is stored on the server and lists under Pinned on another device", { tag: ["@mock"] }, async ({
    browser,
    context,
    page,
  }) => {
    await start(context, page, { capabilitiesEnabled: true, historyPinsEnabled: true });
    await openOnLogs(page);
    await assistant.openHistory();
    const row = item("VRL to parse nginx logs");
    await row.locator('[data-test="assistant-history-row-menu"]').click();
    await page.locator('[data-test="assistant-history-row-pin"]').click();
    await expect.poll(() => state.chats.find((chat) => chat.title === "VRL to parse nginx logs")?.pinned).toBe(true);
    expect(state.log.some((line) => /^PATCH \/api\/[^/]+\/ai\/chats\//.test(line))).toBe(true);
    const device = await browser.newContext();
    await harness.setFlag(device, true);
    await harness.installMocks(device, state);
    const other = await device.newPage();
    await harness.login(other);
    assistant = new AssistantPage(other);
    await openOnLogs(other);
    await assistant.openHistory();
    const pinned = assistant.history().locator('[data-test="assistant-history-group"][data-group="pinned"]');
    await expect(pinned).toContainText("VRL to parse nginx logs", { timeout: 15_000 });
    await device.close();
  });

  test("DOD-03 with list markers another device's running and waiting chats light their rows and the header", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, { listMarkersEnabled: true });
    state.chats[1].running = true;
    state.chats[1].turn_id = "0199e7b2-7000-7a3e-a1b2-c3d4e5f60801";
    state.chats[2].pending_approval = true;
    await openOnLogs(page);
    await assistant.openHistory();
    await expect(item(state.chats[1].title).locator('[data-test="assistant-history-row-state"]')).toHaveText(
      "Answering…",
    );
    await expect(item(state.chats[2].title).locator('[data-test="assistant-history-row-state"]')).toHaveText(
      "Waiting for your approval",
    );
    await page.keyboard.press("Escape");
    await assistant.close();
    await expect(assistant.headerButton).toHaveAttribute("data-state", "needs_you", { timeout: 15_000 });
  });

  test("PERF-04 a chat saves at most once per 3 s plus once as each turn ends, and never sends the transcript back", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(180_000);
    await start(context, page);
    await openOnLogs(page);
    await page.evaluate(async () => {
      const { useAssistantHistory } = await import("/web/src/composables/assistant/index.ts");
      const history = useAssistantHistory();
      const save = history.save.bind(history);
      window.__saves = [];
      history.save = (sid) => {
        window.__saves.push({ sid, at: Date.now() });
        return save(sid);
      };
    });
    for (const text of ["turn one", "turn two", "turn three"]) await answered(page, text, "slow");
    const saves = await page.evaluate(() => window.__saves);
    const sids = new Set(saves.map((entry) => entry.sid));
    expect(sids.size).toBe(1);
    const close = saves.slice(1).filter((entry, i) => entry.at - saves[i].at < 2_900);
    expect(saves.length).toBeGreaterThanOrEqual(3);
    expect(close.length).toBeLessThanOrEqual(3);
    expect(state.log.filter((line) => /^(PUT|POST|PATCH) \/api\/[^/]+\/ai\/chats(\/[^/]+)?$/.test(line))).toEqual([]);
  });

  test("PERF-06 opening and closing 50 times and opening 30 long chats keeps the heap within 10 %", { tag: ["@mock"] }, async ({
    context,
    page,
  }) => {
    test.setTimeout(600_000);
    await start(context, page, { persistence: false });
    await openOnLogs(page);
    await page.evaluate(async () => {
      const index = await import("/web/src/composables/assistant/index.ts");
      const { createIndexedDbHistory } = await import("/web/src/composables/assistant/historyDb.ts");
      const key = index.assistantStore.state.userOrgKey;
      const db = createIndexedDbHistory();
      const base = Date.now() - 86_400_000;
      const answer = "The checkout service returned 5xx after the payments pool reset its connections. ".repeat(5);
      for (let i = 0; i < 30; i += 1) {
        const messages = [];
        const name = `Long chat ${String(i).padStart(2, "0")}`;
        for (let n = 0; n < 150; n += 1) {
          messages.push({ role: "user", content: `${name} question ${n}`, sentAt: base + i * 60_000 + n });
          messages.push({ role: "assistant", content: answer });
        }
        await db.merge(
          {
            id: 800_000 + i,
            timestamp: new Date(base + i * 60_000).toISOString(),
            title: name,
            messages,
            sessionId: crypto.randomUUID(),
            userOrgKey: key,
          },
          "seed",
        );
      }
    });
    await openOnLogs(page);
    const cdp = await context.newCDPSession(page);
    const heap = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
      return (await cdp.send("Runtime.getHeapUsage")).usedSize;
    };
    const openChat = async (i) => {
      const name = `Long chat ${String(i).padStart(2, "0")}`;
      await assistant.openHistory();
      await search().fill(name);
      // The search settles after a short debounce; a click before it lands where the row was.
      const rows = assistant.history().locator('[data-test="assistant-history-row"]');
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText(name);
      await rows.click();
      await expect(assistant.transcript()).toContainText(`${name} question 149`, { timeout: 30_000 });
    };
    await openChat(0);
    const before = await heap();
    for (let n = 0; n < 50; n += 1) {
      await assistant.close();
      await expect(assistant.container()).toHaveCount(0);
      await assistant.open("header");
    }
    for (let i = 1; i < 30; i += 1) await openChat(i);
    const after = await heap();
    const kept = await page.evaluate(async () => {
      const index = await import("/web/src/composables/assistant/index.ts");
      const state = index.assistantStore.state;
      return Object.values(state.sessions).filter((s) => s.sid !== state.shell.activeSid && s.messages.length).length;
    });
    console.log(`PERF-06 heap ${before} -> ${after} (${(((after - before) / before) * 100).toFixed(1)} %), idle with messages ${kept}`);
    expect(kept).toBeLessThanOrEqual(10);
    expect(after).toBeLessThanOrEqual(before * 1.1);
  });

  test("PERF-03 a 300-message chat from history paints in 300 ms and scrolls at ~60 fps (55 or more measured)", async ({ context, page }, info) => {
    await start(context, page, { persistence: false });
    await openOnLogs(page);
    await page.evaluate(async () => {
      const index = await import("/web/src/composables/assistant/index.ts");
      const { createIndexedDbHistory } = await import("/web/src/composables/assistant/historyDb.ts");
      const base = Date.now() - 86_400_000;
      const answer = "The checkout service returned 5xx after the payments pool reset its connections. ".repeat(5);
      const messages = [];
      for (let n = 0; n < 150; n += 1) {
        messages.push({ role: "user", content: `Chat 300 question ${n}`, sentAt: base + n });
        messages.push({ role: "assistant", content: answer });
      }
      await createIndexedDbHistory().merge(
        {
          id: 700_000,
          timestamp: new Date(base).toISOString(),
          title: "Chat 300",
          messages,
          sessionId: crypto.randomUUID(),
          userOrgKey: index.assistantStore.state.userOrgKey,
        },
        "seed",
      );
    });
    await openOnLogs(page);
    await assistant.openHistory();
    await search().fill("Chat 300");
    const rows = assistant.history().locator('[data-test="assistant-history-row"]');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Chat 300");
    // Click to the first frame that shows the last message, measured in the page so no round trip counts.
    const paintMs = await rows.evaluate(
      (row) =>
        new Promise((resolve, reject) => {
          const start = performance.now();
          const shown = () =>
            document.querySelector('[data-test="assistant-transcript"]')?.textContent?.includes("Chat 300 question 149");
          const observer = new MutationObserver(() => {
            if (!shown()) return;
            observer.disconnect();
            requestAnimationFrame(() => resolve(performance.now() - start));
          });
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
          setTimeout(() => reject(new Error("the chat never painted its last message")), 30_000);
          row.click();
        }),
    );
    const { fps, worstFrameMs } = await assistant.transcript().evaluate(async (log) => {
      log.scrollTop = 0;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      let frames = 0;
      let worst = 0;
      let last = performance.now();
      let counting = true;
      const tick = (at) => {
        frames += 1;
        worst = Math.max(worst, at - last);
        last = at;
        if (counting) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const start = performance.now();
      while (log.scrollTop + log.clientHeight < log.scrollHeight - 2 && performance.now() - start < 20_000) {
        log.scrollTop += 120;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      counting = false;
      return { fps: frames / ((performance.now() - start) / 1000), worstFrameMs: worst };
    });
    await expect(assistant.transcript()).toContainText("Chat 300 question 149");
    const measured = `paint ${paintMs.toFixed(0)} ms; scroll ${fps.toFixed(1)} fps, worst frame ${worstFrameMs.toFixed(1)} ms`;
    info.annotations.push({ type: "perf", description: measured });
    console.log(`PERF-03 ${measured}`);
    // The budgets are for the production bundle; the Vite dev build only reports its numbers.
    if (harness.ENV.viteDev) return;
    expect(paintMs).toBeLessThanOrEqual(300);
    expect(fps).toBeGreaterThanOrEqual(55);
    expect(worstFrameMs).toBeLessThanOrEqual(34);
  });
});

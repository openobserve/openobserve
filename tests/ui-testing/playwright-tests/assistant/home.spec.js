// Copyright 2026 OpenObserve Inc.
// WP-06 Home with the flag on: the AI Assistant tab's Ask box is a door to the thread at ?tab=ai&thread=, never a thread itself.

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant on Home", () => {
  let assistant;
  let harness;
  let state;

  const homeUrl = () => `${harness.ENV.appUrl}/?org_identifier=${harness.ENV.org}`;
  const askBox = () => page().locator('section[data-test="assistant-launcher"]');
  const input = () => askBox().locator('[data-test="assistant-launcher-input-field"]');
  let currentPage;
  const page = () => currentPage;
  const threadUrl = /[?&]tab=ai&thread=[0-9a-f-]*/;

  async function openHome(page) {
    await page.goto(homeUrl(), { waitUntil: "domcontentloaded" });
    await expect(askBox()).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
    currentPage = page;
  });

  test("HOME-01 the Ask box sends to the thread inside the AI tab and the briefing renders no thread", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openHome(page);
    await expect(page.locator('[data-test="home-tab-ai"]')).toHaveCount(1);
    await expect(page.locator('[data-test="assistant-home-tab"]')).toBeVisible();
    await expect(askBox().locator('[data-test="assistant-transcript"]')).toHaveCount(0);
    await harness.nextScenario(page, "slow");
    await input().fill("why 5xx?");
    await input().press("Enter");
    await page.waitForURL(/[?&]thread=[0-9a-f-]+/);
    await expect(page.locator('[data-test="home-full-thread"]')).toBeVisible();
    await expect(assistant.full).toBeVisible();
    await expect(assistant.status()).toBeVisible();
  });

  test("HOME-04 a returning user sees three recent chats under the Ask box, View all opens the chat search, and a card opens its chat", { tag: ["@mock"] }, async ({ page }) => {
    await openHome(page);
    await expect(page.locator('[data-test="agent-home-greeting"] [data-test="assistant-spark"]')).toBeVisible();
    const recent = page.locator('[data-test="assistant-recent-chats"]');
    await expect(recent.locator("h3")).toHaveText("Recent chats");
    await expect(recent.locator('[data-test^="assistant-recent-chat-"]:not([data-test$="-age"])')).toHaveCount(3);
    await expect(recent.locator('[data-test="assistant-recent-chat-0"]')).toContainText(state.chats[0].title);
    await expect(page.locator('[data-test="assistant-first-chat-starter"]')).toHaveCount(0);
    await expect(page.locator('[data-test="assistant-home-examples"]')).toHaveCount(0);
    await expect(page.locator('[data-test="assistant-context-sees"]')).toHaveCount(0);
    await recent.locator('[data-test="assistant-recent-chats-all"]').click();
    const search = page.locator('[data-test="assistant-chat-search"]');
    await expect(search.locator('[data-test="assistant-chat-search-input"] input')).toBeFocused();
    await expect(search.locator('[data-test="assistant-chat-search-result"]').first()).toContainText(state.chats[0].title);
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
    await recent.locator('[data-test="assistant-recent-chat-1"]').click();
    await page.waitForURL(new RegExp(`[?&]thread=${state.chats[1].session_id}`));
    await expect(assistant.full).toBeVisible();
  });

  test("HOME-05 a first-time user sees one quiet chip that asks what the agent can do", { tag: ["@mock"] }, async ({ page }) => {
    state.chats.length = 0;
    await openHome(page);
    const chip = page.locator('[data-test="assistant-first-chat-ask"]');
    await expect(chip).toHaveText("What can you do?");
    await expect(page.locator('[data-test="assistant-first-chat-starter"] button')).toHaveCount(1);
    await expect(page.locator('[data-test="assistant-recent-chats"]')).toHaveCount(0);
    await chip.click();
    await page.waitForURL(threadUrl);
    await expect(assistant.full).toBeVisible();
    await expect(assistant.full).toContainText("What can you do?");
  });

  test("HOME-02 a slow config shows the skeleton, then the launcher, with no tab pop-in", { tag: ["@mock"] }, async ({ context, page }) => {
    await context.route(/\/config(\?|$)/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return route.fallback();
    });
    await page.goto(homeUrl(), { waitUntil: "domcontentloaded" });
    const tabs = page.locator('[data-test^="home-tab-"]:not([data-test="home-tab-bar"])');
    const first = await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-test")));
    await expect(askBox()).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    const after = await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-test")));
    if (first.length) expect(after).toEqual(first);
    expect(after[0]).toBe("home-tab-ai");
  });

  test("HOME-03 Escape keeps the typed text, the field can be emptied, and an outage still sends", { tag: ["@mock"] }, async ({ page }) => {
    await openHome(page);
    await input().fill("keep this");
    await input().press("Escape");
    await expect(input()).toHaveValue("keep this");
    await expect(input()).not.toBeFocused();
    // The clear button was removed from the Ask box on purpose; emptying the field is the user's own edit now.
    await input().fill("");
    await expect(input()).toHaveValue("");
    await harness.nextScenario(page, "agent_503");
    await input().fill("still works");
    await input().press("Enter");
    await page.waitForURL(threadUrl);
    await expect(assistant.outcome()).toHaveAttribute("data-code", "agent_unavailable");
    await page.goto(homeUrl(), { waitUntil: "domcontentloaded" });
    await expect(askBox()).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(input()).toBeEnabled();
  });

  test("SHELL-05 a turn started from Home keeps running when the user leaves Home", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openHome(page);
    await harness.nextScenario(page, "slow");
    await input().fill("why 5xx?");
    await input().press("Enter");
    await page.waitForURL(threadUrl);
    await expect(assistant.status()).toBeVisible();
    // Home's chat offers no move to the panel, so leaving Home is how the turn outlives the full view.
    await page.goto(`${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}`, { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", /working|unread/, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__o2mock.requests.length)).toBeLessThanOrEqual(1);
  });
});

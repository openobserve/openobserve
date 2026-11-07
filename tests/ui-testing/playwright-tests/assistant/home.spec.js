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
  const askBox = () => page().locator('[data-test="assistant-launcher"][data-layout="overview"]');
  const input = () => askBox().locator("input");
  let currentPage;
  const page = () => currentPage;
  const threadUrl = /[?&]tab=ai&thread=[0-9a-f-]*/;

  async function openHome(page) {
    await page.goto(homeUrl(), { waitUntil: "domcontentloaded" });
    await expect(askBox()).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
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

  test("HOME-03 Escape keeps the typed text, the clear button clears it, and an outage still sends", { tag: ["@mock"] }, async ({ page }) => {
    await openHome(page);
    await input().fill("keep this");
    await input().press("Escape");
    await expect(input()).toHaveValue("keep this");
    await expect(input()).not.toBeFocused();
    await askBox().locator('[data-test="assistant-launcher-clear"]').click();
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

  test("SHELL-05 a turn started from Home keeps running when Full moves to Panel", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openHome(page);
    await harness.nextScenario(page, "slow");
    await input().fill("why 5xx?");
    await input().press("Enter");
    await page.waitForURL(threadUrl);
    await expect(assistant.status()).toBeVisible();
    await assistant.container().locator('[data-test="assistant-density-panel"]').click();
    await expect(assistant.sidebar).toBeVisible();
    await page.goto(`${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}`, { waitUntil: "domcontentloaded" });
    await expect(assistant.sidebar).toBeVisible({ timeout: 30_000 });
    await expect(assistant.headerButton).toHaveAttribute("data-state", /working|open|unread/, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__o2mock.requests.length)).toBeLessThanOrEqual(1);
  });
});

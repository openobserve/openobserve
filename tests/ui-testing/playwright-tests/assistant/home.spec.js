// Copyright 2026 OpenObserve Inc.
// WP-06 Home with the flag on: the launcher on Overview is a door to /assistant, never a thread (`99` §6.8).

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant on Home", () => {
  let assistant;
  let harness;
  let state;

  const homeUrl = () => `${harness.ENV.appUrl}/?org_identifier=${harness.ENV.org}`;
  const input = () => assistant.launcher().locator("input");

  async function openHome(page) {
    await page.goto(homeUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.launcher()).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("HOME-01 the launcher sends to /assistant/{id} and Home renders no thread", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openHome(page);
    await expect(page.locator('[data-test="home-tab-ai"]')).toHaveCount(0);
    await expect(assistant.launcher().locator('[data-test="assistant-transcript"]')).toHaveCount(0);
    await harness.nextScenario(page, "slow");
    await input().fill("why 5xx?");
    await input().press("Enter");
    await page.waitForURL(/\/web\/assistant\/[0-9a-f-]+/);
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
    await expect(assistant.launcher()).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    const after = await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-test")));
    if (first.length) expect(after).toEqual(first);
    expect(after).not.toContain("home-tab-ai");
  });

  test("HOME-03 Escape keeps the typed text, the clear button clears it, and an outage still sends", { tag: ["@mock"] }, async ({ page }) => {
    await openHome(page);
    await input().fill("keep this");
    await input().press("Escape");
    await expect(input()).toHaveValue("keep this");
    await expect(input()).not.toBeFocused();
    await assistant.launcher().locator('[data-test="assistant-launcher-clear"]').click();
    await expect(input()).toHaveValue("");
    await harness.nextScenario(page, "agent_503");
    await input().fill("still works");
    await input().press("Enter");
    await page.waitForURL(/\/web\/assistant\//);
    await expect(assistant.outcome()).toHaveAttribute("data-code", "agent_unavailable");
    await page.goto(homeUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.launcher()).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(input()).toBeEnabled();
  });

  test("SHELL-05 a turn started from Home keeps running when the full view moves to the sidebar", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openHome(page);
    await harness.nextScenario(page, "slow");
    await input().fill("why 5xx?");
    await input().press("Enter");
    await page.waitForURL(/\/web\/assistant\//);
    await expect(assistant.status()).toBeVisible();
    await assistant.container().locator('[data-test="assistant-thread-menu"]').click();
    await page.locator('[data-test="assistant-shell-open-in-sidebar"]').click();
    await expect(assistant.sidebar).toBeVisible();
    await page.goto(`${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}`, { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", /working|open|unread/, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__o2mock.requests.length)).toBeLessThanOrEqual(1);
  });
});

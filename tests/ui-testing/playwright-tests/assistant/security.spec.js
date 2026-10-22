// Copyright 2026 OpenObserve Inc.
// WP-06 security flows: the strict renderer keeps planted payloads inert, Details never leak content (`99` §6.11).

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant security", () => {
  let assistant;
  let harness;
  const beacons = [];

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  async function openOnLogs(page) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await assistant.open("header");
    await expect(assistant.composer()).toBeVisible();
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    await harness.installMocks(context, harness.createMockState());
    beacons.length = 0;
    await context.route(/evil\.example/, (route) => {
      beacons.push(route.request().url());
      return route.abort();
    });
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  async function payloadAnswer(page) {
    await openOnLogs(page);
    await harness.nextScenario(page, "payloads_markdown");
    await assistant.send("show me");
    await expect(assistant.answer()).toContainText("Read the docs");
    return assistant.answer();
  }

  test("SEC-01 a planted image beacon is dropped and nothing leaves for evil.example", { tag: ["@mock"] }, async ({ page }) => {
    const answer = await payloadAnswer(page);
    await expect(answer).toContainText("Image from an external site removed");
    await expect(answer.locator("img")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(beacons).toEqual([]);
  });

  test("SEC-02 unsafe links render as text and external links open in a new tab", { tag: ["@mock"] }, async ({ page }) => {
    const answer = await payloadAnswer(page);
    // Link cards are typed routes of their own; the rendered Markdown is what may hold only external links.
    const hrefs = await answer.locator('[data-test="assistant-block-text"] a').evaluateAll((links) =>
      links.map((a) => ({ href: a.getAttribute("href"), target: a.target, rel: a.rel })),
    );
    expect(hrefs).toEqual([
      { href: "https://openobserve.ai/docs/", target: "_blank", rel: "noopener noreferrer nofollow" },
    ]);
    await expect(answer).toContainText("Open dashboard");
    await expect(answer.locator('a[href*="logout"], a[href*="shared"], a[href^="javascript"], a[href^="data"]')).toHaveCount(0);
  });

  test("SEC-03 a navigation frame from the agent never navigates; it is offered as one link card", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    // The logs page writes its own time range into the URL once it loads; only a change after that is the agent's.
    await expect.poll(() => page.url(), { timeout: 15_000 }).not.toContain("from=NaN");
    const before = page.url();
    await harness.nextScenario(page, "navigation");
    await assistant.send("open logs");
    await page.waitForTimeout(2_000);
    expect(page.url()).toBe(before);
    // The frame renders a link card (no "Allow" prompt), which opens only on its own click.
    await expect(assistant.transcript().locator('[data-test="assistant-link-card"]')).toHaveCount(1);
    await expect(assistant.transcript().getByText("Always allow")).toHaveCount(0);
  });

  test("SEC-04 raw HTML in an answer is stripped to its text and its handler never runs", { tag: ["@mock"] }, async ({ page }) => {
    const answer = await payloadAnswer(page);
    await expect(answer).toContainText("same tab");
    await expect(answer).not.toContainText("onerror");
    await expect(answer).not.toContainText("<a href");
    await expect(answer.locator('img[src="x"], a[target="_self"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test("SEC-06 Details copy holds ids and codes, never the prompt or context", { tag: ["@mock"] }, async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openOnLogs(page);
    await harness.nextScenario(page, "error");
    await assistant.send("secret prompt about checkout");
    await assistant.outcome().locator('[data-test="assistant-error-details"] button').first().click();
    await assistant.outcome().locator('[data-test="assistant-error-details-copy"]').click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("Code: provider_error");
    expect(text).not.toContain("secret prompt");
    expect(text).not.toContain("e2e_automate");
  });

  test("SEC-07 every assistant surface is masked for session replay and the title never names a chat", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await harness.nextScenario(page, "complete");
    await assistant.send("why 5xx?");
    await expect(assistant.answer().locator("h2")).toBeVisible();
    await expect(assistant.container()).toHaveAttribute("data-dd-privacy", "mask");
    await expect(assistant.transcript()).toHaveAttribute("data-dd-privacy", "mask");
    expect(await page.title()).not.toContain("Checkout 5xx spike");
    await page.goto(`${harness.ENV.appUrl}/?org_identifier=${harness.ENV.org}`, { waitUntil: "domcontentloaded" });
    await expect(assistant.launcher()).toHaveAttribute("data-dd-privacy", "mask", { timeout: 30_000 });
    // A popover is portalled to body, outside the masked launcher, so it carries the mask itself.
    await page.locator('[data-test="assistant-launcher-sees"]').click();
    const popover = page.locator("[data-o-popover-content]").filter({
      has: page.locator('[data-test="assistant-context-sees-popover"]'),
    });
    await expect(popover).toHaveAttribute("data-dd-privacy", "mask");
  });
});

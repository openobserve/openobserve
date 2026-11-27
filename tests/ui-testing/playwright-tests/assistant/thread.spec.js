// Copyright 2026 OpenObserve Inc.
// The thread itself: the sent message's actions, the answer link and the title rename.

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant thread", () => {
  let assistant;
  let harness;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;
  const opacity = (locator) => locator.evaluate((el) => getComputedStyle(el).opacity);

  async function answered(page) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(assistant.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await assistant.open("header");
    await assistant.send("list my streams");
    await expect(assistant.answerDone()).toBeVisible({ timeout: 20_000 });
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.installMocks(context, harness.createMockState());
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("THREAD-01 a sent message shows small Copy and Edit on hover or focus only, and no time", { tag: ["@mock"] }, async ({ page }) => {
    await answered(page);
    const message = assistant.transcript().locator('[data-test="assistant-message-user"]').first();
    const actions = message.locator('[data-test="assistant-msg-actions"]');
    await page.mouse.move(0, 0);
    expect(await opacity(actions)).toBe("0");
    await expect(message.locator('[data-test="assistant-message-user-time"]')).toHaveCount(0);
    await message.hover();
    await expect.poll(() => opacity(actions)).toBe("1");
    const copy = message.locator('[data-test="assistant-msg-copy-prompt"]');
    const box = await copy.boundingBox();
    expect(box.height).toBeLessThanOrEqual(28);
    await page.mouse.move(0, 0);
    await copy.focus();
    await expect.poll(() => opacity(actions)).toBe("1");
  });

  test("THREAD-02 the answer link names what it copies and says who can open it", { tag: ["@mock"] }, async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await answered(page);
    const link = assistant.answer().locator('[data-test="assistant-msg-share-link"]');
    await expect(link).toHaveAttribute("aria-label", "Copy link to this answer");
    await link.click();
    // The confirmation sits beside the button, clear of the composer; the toast is only its fallback.
    await expect(
      page.locator('[data-test="copy-confirm"], [data-test="o-toast-message"]', { hasText: "Link copied · only you can open it" }),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/[?&]thread=.+#answer-/);
  });

  test("THREAD-03 the full page title is plain text that renames in place: Enter saves, Escape cancels", { tag: ["@mock"] }, async ({ page: start }) => {
    await answered(start);
    const { page } = await assistant.placeFullInNewTab();
    const trigger = page.locator('[data-test="assistant-thread-heading-edit-trigger"]').filter({ visible: true });
    const input = page.locator('[data-test="assistant-thread-heading-edit-input"]');
    await expect(trigger).toBeVisible();
    await expect(trigger.locator("svg")).toHaveCount(0);
    await trigger.hover();
    await expect(page.getByText("Click to rename this chat")).toHaveCount(0);
    await trigger.click();
    await input.fill("Dropped name");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(trigger).not.toHaveText("Dropped name");
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await input.fill("Stream inventory");
    await input.press("Enter");
    await expect(trigger).toHaveText("Stream inventory");
  });
});

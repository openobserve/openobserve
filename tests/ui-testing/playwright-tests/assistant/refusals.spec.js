// Copyright 2026 OpenObserve Inc.
// WP-06 refusals and recovery with the flag on: every refusal restores the prompt and stores nothing (`99` §6.4).

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.describe("assistant refusals and recovery", () => {
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

  async function refuse(page, scenario, text = "why 5xx?") {
    await harness.nextScenario(page, scenario);
    await assistant.send(text);
    await expect(assistant.outcome()).toHaveAttribute("data-kind", "refused");
  }

  async function pasteImage(page) {
    await page.evaluate((base64) => {
      const box = document.querySelector('[data-assistant-root] [data-test="assistant-composer-field"]');
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "image.png", { type: "image/png" }));
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, PNG_BASE64);
  }

  const lower = () => assistant.container().locator('[data-test="assistant-shell-lower"]');
  const region = () => assistant.container().locator('[data-test="assistant-status-region"]');

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("ERR-01 an offline refusal gives everything back and waits for the network", { tag: ["@mock", "@responsive"] }, async ({ page }) => {
    await openOnLogs(page);
    await assistant.composer().fill("why 5xx offline?");
    await pasteImage(page);
    await expect(assistant.container().locator('[data-test="assistant-image-strip"] li')).toHaveCount(1);
    await harness.setOnline(page, false);
    await refuse(page, "offline", "why 5xx offline?");
    await expect(lower().locator('[data-test="assistant-turn-outcome"]')).toContainText(
      "You're offline. Your message wasn't sent.",
    );
    await expect(assistant.transcript()).toHaveCount(0);
    await expect(assistant.composer()).toHaveValue("why 5xx offline?");
    await expect(assistant.composer()).toBeFocused();
    await expect(assistant.container().locator('[data-test="assistant-image-strip"] li')).toHaveCount(1);
    await expect(assistant.outcomeAction()).toHaveAttribute("aria-disabled", "true");
    await harness.setOnline(page, true);
    await expect(assistant.outcomeAction()).not.toHaveAttribute("aria-disabled", "true");
    await expect(region()).toHaveText("You're back online.");
    await harness.nextScenario(page, "complete");
    await assistant.outcomeAction().click();
    await expect(assistant.composer()).toBeFocused();
  });

  test("ERR-02 an expired session signs in in a new tab and keeps this page and its draft", { tag: ["@mock", "@stack-ee"] }, async ({ context, page }) => {
    await openOnLogs(page);
    await page.evaluate(() => (window.__notReloaded = true));
    await refuse(page, "unauthorized_401", "keep my draft");
    await expect(assistant.outcome()).toContainText("Your session expired. Your draft is kept.");
    const [signIn] = await Promise.all([context.waitForEvent("page"), assistant.outcomeAction().click()]);
    await signIn.waitForLoadState("domcontentloaded");
    expect(new URL(signIn.url()).pathname).toMatch(/\/web\/(login|close-tab)/);
    await expect(assistant.container().locator('[data-test="assistant-turn-outcome-popup-blocked"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
    await expect(assistant.composer()).toHaveValue("keep my draft");
  });

  test("ERR-03 a 403 that slipped past the gate refuses and swaps to the locked state", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await harness.nextScenario(page, "forbidden_403");
    await assistant.send("why?");
    await expect(assistant.gate()).toBeVisible();
  });

  test("ERR-04 an org with the assistant off says so with the admin action", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await refuse(page, "not_enabled_400");
    await expect(assistant.outcome()).toContainText("O2 Assistant is off for this organization.");
    // Settings › Assistant does not exist yet, so the admin action is the setup guide, labelled as a new tab.
    await expect(assistant.outcomeAction()).toHaveText("Read the setup guide (opens in a new tab)");
    await expect(assistant.outcomeAction()).toHaveAttribute("target", "_blank");
  });

  test("ERR-05 a busy chat restores the prompt and Stop it cancels the running turn", { tag: ["@mock", "@stack-ee"] }, async ({ page }) => {
    await openOnLogs(page);
    await harness.setKnobs(page, { envelopeEnabled: true });
    await refuse(page, "lease_409", "busy prompt");
    await expect(assistant.outcome()).toContainText(
      "Another answer is still running in this chat. Your message wasn't sent.",
    );
    await expect(assistant.composer()).toHaveValue("busy prompt");
    await assistant.outcomeAction().click();
    await expect.poll(() => page.evaluate(() => (window.__o2mock.cancels ?? []).length)).toBe(1);
    const [cancel] = await page.evaluate(() => window.__o2mock.cancels);
    expect(JSON.parse(cancel.body).turn_id).toBe("0199e7b2-7000-7a3e-a1b2-c3d4e5f60799");
    await expect(assistant.composer()).toBeFocused();
  });

  test("ERR-06 an already-submitted turn offers Reload chat", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await refuse(page, "already_submitted_409");
    await expect(assistant.outcomeAction()).toHaveText("Reload chat");
  });

  test("ERR-07 the turn limit refuses with Retry, in at most two lines at the sidebar width", { tag: ["@mock", "@responsive"] }, async ({ page }) => {
    await openOnLogs(page);
    await refuse(page, "turn_limit");
    await expect(assistant.outcome()).toContainText("Too many answers are running. Wait for one to finish.");
    const title = assistant.outcome().locator('[data-test="assistant-turn-outcome-title"]');
    const lines = await title.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines).toBeLessThanOrEqual(2);
    await expect(assistant.outcomeAction()).toHaveText("Retry");
  });

  test("ERR-08 a rate limit counts down without announcing each tick and never sends by itself", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await harness.setKnobs(page, { envelopeEnabled: true });
    await refuse(page, "upstream_429");
    await expect(assistant.outcomeAction()).toHaveText(/Retry in (30|29|28) s/);
    await expect(assistant.outcome().locator('[data-test="assistant-turn-outcome-title"]')).toHaveText(
      "The AI provider is rate-limiting requests.",
    );
    await expect(assistant.container().locator('[data-test="assistant-send"]')).toHaveAttribute("aria-disabled", "true");
    const before = await region().textContent();
    await page.waitForTimeout(2_200);
    await expect(assistant.outcomeAction()).toHaveText(/Retry in 2\d s/);
    expect(await region().textContent()).toBe(before);
    expect(await page.evaluate(() => window.__o2mock.requests.length)).toBe(1);
  });

  test("ERR-09 credits authorization unavailable refuses with Retry on the same turn id", { tag: ["@mock"] }, async ({ page }) => {
    await openOnLogs(page);
    await refuse(page, "authz_503");
    await expect(assistant.outcome()).toContainText("Couldn't check AI credits. Your message wasn't sent.");
    await harness.nextScenario(page, "complete");
    await assistant.outcomeAction().click();
    await expect(assistant.answer().locator("h2")).toBeVisible();
    const ids = await page.evaluate(() => window.__o2mock.requests.map((r) => r.headers?.["x-o2-assistant-turn-id"]));
    expect(ids[0]).toBe(ids[1]);
  });

  test("ERR-10 an agent outage fails the turn and keeps the composer live", { tag: ["@mock", "@stack-ee-noagent"] }, async ({ page }) => {
    await openOnLogs(page);
    await harness.nextScenario(page, "agent_503");
    await assistant.send("why?");
    await expect(assistant.outcome()).toHaveAttribute("data-code", "agent_unavailable");
    await expect(assistant.outcome()).toContainText("The assistant service didn't respond.");
    await expect(assistant.composer()).toBeEditable();
  });

  test("ERR-13 a denied clipboard leaves the details selectable with the manual-copy line", { tag: ["@mock"] }, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("denied")) },
      });
      document.execCommand = () => false;
    });
    await openOnLogs(page);
    await harness.nextScenario(page, "error");
    await assistant.send("why?");
    await assistant.outcome().locator('[data-test="assistant-error-details"] button').first().click();
    await assistant.outcome().locator('[data-test="assistant-error-details-copy"]').click();
    await expect(assistant.outcome()).toContainText("Couldn't copy. Select the text and copy it.");
    await expect(assistant.outcome().locator('[data-test="assistant-error-details-manual"] textarea')).toHaveValue(
      /Code: provider_error/,
    );
  });

  test("ERR-15 a 401 on Cloud keeps the page and never reaches the logout path @edition", { tag: ["@mock"] }, async ({ context, page }) => {
    await harness.forceCloudBuild(context);
    await page.reload();
    await openOnLogs(page);
    await page.evaluate(() => (window.__notReloaded = true));
    await refuse(page, "unauthorized_401", "cloud draft");
    await expect(assistant.outcome()).toHaveAttribute("data-code", "session_expired");
    expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
    await expect(assistant.composer()).toHaveValue("cloud draft");
  });
});

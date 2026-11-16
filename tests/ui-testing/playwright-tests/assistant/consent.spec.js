// Copyright 2026 OpenObserve Inc.
// Paid-usage consent with the flag on: the shared org-wide prompt inline in the chat, the same turn id once, honest cancels.

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");

test.describe("assistant consent card", () => {
  let assistant;
  let harness;
  let state;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  async function openOn(page, target = assistant) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(target.headerButton).toHaveAttribute("data-state", "idle", { timeout: 30_000 });
    await target.open("header");
    await expect(target.composer()).toBeVisible();
  }

  async function ask(page, scenario = "consent", target = assistant) {
    await openOn(page, target);
    await target.send("why did checkout 5xx spike?", scenario);
    await expect(target.consentCard()).toBeVisible({ timeout: 15_000 });
  }

  const card = (target = assistant) => target.consentCard();
  const button = (id, target = assistant) => card(target).locator(`[data-test="o2-ai-paid-usage-consent-${id}"]`);
  const po = (id, target = assistant) => card(target).locator(`[data-test="paid-overage-${id}"]`);
  const dialog = (page) => page.locator('[data-test="paid-overage-consent-dialog"]');
  const requests = (page) =>
    page.evaluate(() => window.__o2mock.requests.map((r) => ({ headers: r.headers, scenario: r.scenario })));
  const puts = () => state.log.filter((line) => line.startsWith("PUT paid_overage"));

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("CONS-01 an admin turns it on once the box is ticked, and the same turn id is resent once", { tag: ["@mock", "@stack-cloud"] }, async ({ page }) => {
    await ask(page);
    await expect(card()).toContainText("Turn on paid AI usage?");
    await expect(po("billing-cycle-copy")).toContainText("AI usage is billed at your plan's rate");
    await expect(assistant.composerState()).toHaveAttribute("data-state", "inert");
    await expect(dialog(page)).toHaveCount(0);
    await expect(button("enable")).toBeDisabled();
    await po("authorization-checkbox").click();
    await expect(button("enable")).toBeEnabled();
    await button("enable").click();
    await expect(card()).toHaveCount(0, { timeout: 15_000 });
    expect(puts()).toHaveLength(1);
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    const sent = await requests(page);
    expect(sent[1].headers["x-o2-assistant-turn-id"]).toBe(sent[0].headers["x-o2-assistant-turn-id"]);
  });

  test("CONS-02 Cancel writes nothing and gives the prompt back, the note clearing on the next keystroke", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page);
    await button("cancel").click();
    await expect(card()).toHaveCount(0);
    expect(puts()).toHaveLength(0);
    await expect(assistant.composer()).toHaveValue("why did checkout 5xx spike?");
    await expect(assistant.composer()).toBeFocused();
    await expect(assistant.outcome()).toContainText("Paid usage wasn't enabled. Your message wasn't sent.");
    await expect(assistant.container().locator('[data-test="assistant-message-user"]')).toHaveCount(0);
    await assistant.composer().press("End");
    await assistant.composer().pressSequentially("!");
    await expect(assistant.outcome()).toHaveCount(0);
  });

  test("CONS-03 View billing declines, writes nothing and opens Billing", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page);
    await po("view-billing").click();
    await expect(page).toHaveURL(/\/billings\/plans/);
    expect(puts()).toHaveLength(0);
  });

  test("CONS-04 a member is told to ask an admin and gets no Turn on", { tag: ["@mock", "@stack-cloud"] }, async ({ page }) => {
    await ask(page, "consent_member");
    await expect(po("authorization-checkbox")).toHaveCount(0);
    await expect(button("enable")).toHaveCount(0);
    await expect(po("contact-admin")).toContainText("Ask an organization admin to turn on paid AI usage.");
  });

  test("CONS-05 a failed PUT says so inline and keeps the card", { tag: ["@mock"] }, async ({ page }) => {
    state.consentPutStatus = 500;
    await ask(page);
    await po("authorization-checkbox").click();
    await button("enable").click();
    await expect(card().locator('[role="alert"]')).toHaveText("Couldn't update paid AI usage. Try again.");
    await expect(button("enable")).toBeEnabled();
    await expect(card()).toBeVisible();
  });

  test("CONS-06 a second 412 on the resend is a refusal with the prompt back, never a second card", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page, "consent_twice");
    await po("authorization-checkbox").click();
    await button("enable").click();
    await expect(assistant.outcome()).toContainText(
      "Paid usage isn't enabled for every organization this needs.",
      { timeout: 15_000 },
    );
    await expect(card()).toHaveCount(0);
    await expect(assistant.composer()).toHaveValue("why did checkout 5xx spike?");
  });

  test("CONS-07 closing the chat moves the prompt to the global dialog; its Cancel writes nothing and keeps the draft", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page);
    await assistant.close();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(puts()).toHaveLength(0);
    await assistant.open("header");
    await expect(card()).toHaveCount(0);
    await expect(assistant.composer()).toHaveValue("why did checkout 5xx spike?");
  });
});

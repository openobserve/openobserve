// Copyright 2026 OpenObserve Inc.
// Paid-usage consent with the flag on: a card in the requesting container, the same turn id once, honest cancels and other tabs.

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
  const field = (id, target = assistant) => card(target).locator(`[data-test="assistant-consent-card-${id}"]`);
  const requests = (page) =>
    page.evaluate(() => window.__o2mock.requests.map((r) => ({ headers: r.headers, scenario: r.scenario })));
  const puts = () => state.log.filter((line) => line.startsWith("PUT paid_overage"));
  const region = () => assistant.container().locator('[data-test="assistant-status-region"]');

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    await harness.setFlag(context, true);
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test("CONS-01 an admin enables once the box is ticked, and the same turn id is resent once", { tag: ["@mock", "@stack-cloud"] }, async ({ page }) => {
    await ask(page);
    await expect(field("org")).toHaveText("Enable paid AI usage for default?");
    await expect(field("consequence")).toContainText("every AI request from anyone in default is billed");
    await expect(region()).toContainText("Waiting for your decision on paid usage for default.");
    await expect(assistant.composerState()).toHaveAttribute("data-state", "inert");
    await expect(field("enable")).toBeDisabled();
    await field("checkbox").click();
    await expect(field("enable")).toBeEnabled();
    await field("enable").click();
    await expect(assistant.container().locator('[data-test="assistant-consent-note"]')).toContainText(
      /Paid AI usage enabled for default by you · /,
      { timeout: 15_000 },
    );
    expect(puts()).toHaveLength(1);
    const sent = await requests(page);
    expect(sent).toHaveLength(2);
    expect(sent[1].headers["x-o2-assistant-turn-id"]).toBe(sent[0].headers["x-o2-assistant-turn-id"]);
    await expect(card()).toHaveCount(0);
    const telemetry = await harness.captureTelemetry(page);
    const steps = telemetry.filter((e) => e.name === "ai_consent").map((e) => e.properties.step);
    expect(steps).toEqual(expect.arrayContaining(["shown", "enabled"]));
  });

  test("CONS-02 Cancel writes nothing and gives the prompt back, the note clearing on the next keystroke", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page);
    await field("cancel").click();
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

  test("CONS-03 Manage in Billing opens a new tab and is never a decline", { tag: ["@mock"] }, async ({ context, page }) => {
    await ask(page);
    const opened = context.waitForEvent("page");
    await field("view-billing").click();
    const tab = await opened;
    await tab.close();
    await expect(card()).toBeVisible();
    expect(puts()).toHaveLength(0);
  });

  test("CONS-04 a member gets Ask an admin instead of Enable", { tag: ["@mock", "@stack-cloud"] }, async ({ page }) => {
    await ask(page, "consent_member");
    await expect(field("checkbox")).toHaveCount(0);
    await expect(field("enable")).toHaveCount(0);
    await expect(field("member")).toContainText("An admin of default can enable paid usage.");
    await field("ask-admin").click();
    await expect(assistant.askAdmin().locator("textarea")).toHaveValue(
      /^Could you enable paid AI usage for default\? Billing › Paid usage: /,
    );
  });

  test("CONS-05 a failed PUT says so inline and keeps the card", { tag: ["@mock"] }, async ({ page }) => {
    state.consentPutStatus = 500;
    await ask(page);
    await field("checkbox").click();
    await field("enable").click();
    await expect(field("error")).toHaveText("Paid usage couldn't be updated. Try again.");
    await expect(field("enable")).toBeEnabled();
    await expect(card()).toBeVisible();
  });

  test("CONS-06 a second 412 on the resend is a refusal with the prompt back, never a second card", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page, "consent_twice");
    await field("checkbox").click();
    await field("enable").click();
    await expect(assistant.outcome()).toContainText(
      "Paid usage isn't enabled for every organization this needs.",
      { timeout: 15_000 },
    );
    await expect(card()).toHaveCount(0);
    await expect(assistant.composer()).toHaveValue("why did checkout 5xx spike?");
  });

  test("CONS-07 closing the container cancels the card: nothing written, no dialog, the draft kept", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page);
    await assistant.close();
    await expect(page.locator('[data-test="paid-overage-consent-dialog"]')).toHaveCount(0);
    expect(puts()).toHaveLength(0);
    await assistant.open("header");
    await expect(card()).toHaveCount(0);
    await expect(assistant.composer()).toHaveValue("why did checkout 5xx spike?");
  });

  async function switchOrg(page, identifier) {
    await page.locator('[data-test="navbar-organizations-select-trigger"]').click();
    await page
      .locator(`[data-test="organization-menu-item-label-item-label"][data-test-org-identifier="${identifier}"]`)
      .click();
    const keep = page.locator('[data-test="assistant-shell-org-switch-keep"]');
    await keep.click({ timeout: 5_000 }).catch(() => {});
    await expect(page).toHaveURL(new RegExp(`org_identifier=${identifier}`));
  }

  async function backToDefault(page) {
    await switchOrg(page, harness.ENV.org);
    await expect(assistant.headerButton).toHaveAttribute("data-state", /idle|unread|working/, { timeout: 30_000 });
    await assistant.open("header");
  }

  test("CONS-08 an org switch cancels the card before the switch, and no PUT reaches the old org", { tag: ["@mock"] }, async ({ page }) => {
    const second = await harness.ensureOrg("e2e_assistant_lifecycle");
    await ask(page);
    await assistant.close();
    await switchOrg(page, second);
    expect(puts()).toHaveLength(0);
    await backToDefault(page);
    await expect(card()).toHaveCount(0);
    await expect(assistant.composer()).toHaveValue("why did checkout 5xx spike?");
    expect(puts()).toHaveLength(0);
  });

  test("CONS-08 an org switch while Enable is on its way waits for its answer: paid usage stays on, nothing is sent, the prompt comes back", { tag: ["@mock"] }, async ({ page }) => {
    const second = await harness.ensureOrg("e2e_assistant_lifecycle");
    state.consentPutDelayMs = 2_500;
    await ask(page);
    await field("checkbox").click();
    await field("enable").click();
    await expect(card()).toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Escape");
    await expect(card()).toBeVisible();
    await assistant.close();
    await switchOrg(page, second);
    await expect.poll(() => puts(), { timeout: 10_000 }).toEqual([`PUT paid_overage ${harness.ENV.org}`]);
    await backToDefault(page);
    await expect(assistant.container().locator('[data-test="assistant-consent-note"]')).toContainText(
      /Paid AI usage enabled for default by you · /,
      { timeout: 15_000 },
    );
    await expect(assistant.container()).not.toContainText("Paid usage wasn't enabled");
    await expect(assistant.composer()).toHaveValue("why did checkout 5xx spike?");
    expect(await requests(page)).toHaveLength(1);
  });

  test("CONS-09 a grant in another tab resolves this card and resends its own turn", { tag: ["@mock"] }, async ({ context, page }) => {
    await ask(page);
    const other = await context.newPage();
    const second = new AssistantPage(other);
    await ask(other, "consent", second);
    await field("checkbox", second).click();
    await field("enable", second).click();
    await expect(other.locator('[data-test="assistant-consent-note"]')).toBeVisible({ timeout: 15_000 });
    await expect(assistant.container().locator('[data-test="assistant-consent-note"]')).toBeVisible({
      timeout: 15_000,
    });
    const sent = await requests(page);
    expect(sent).toHaveLength(2);
    expect(sent[1].headers["x-o2-assistant-turn-id"]).toBe(sent[0].headers["x-o2-assistant-turn-id"]);
    expect(puts()).toHaveLength(1);
    await other.close();
  });

  test("CONS-10 Escape inside the card cancels it and the panel stays open", { tag: ["@mock"] }, async ({ page }) => {
    await ask(page);
    await field("checkbox").focus();
    await page.keyboard.press("Escape");
    await expect(card()).toHaveCount(0);
    await expect(assistant.container()).toBeVisible();
    expect(puts()).toHaveLength(0);
    await expect(assistant.composer()).toHaveValue("why did checkout 5xx spike?");
  });
});

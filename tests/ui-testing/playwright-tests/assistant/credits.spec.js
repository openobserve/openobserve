// Copyright 2026 OpenObserve Inc.
// Credits and inline org-wide paid-usage consent with the flag on (per-turn credits, role-aware 402, no panel meter or usage notice, one same-turn retry, draft restored on cancel).

import { test, expect } from "@playwright/test";

import { AssistantPage } from "../../pages/assistantPage.js";

const loadHarness = () => import("./harness/setup.mjs");
const loadMocks = () => import("./harness/mocks.mjs");

test.describe("assistant credits", () => {
  let assistant;
  let harness;
  let mocks;
  let state;

  const logsUrl = () =>
    `${harness.ENV.appUrl}/logs?org_identifier=${harness.ENV.org}&stream=e2e_automate&stream_type=logs`;

  const usage = (mode, used, limit = 1000, extra = {}) => ({
    mode,
    credits_used: used,
    credits_limit: limit,
    credits_remaining: Math.max(0, limit - used),
    requires_additional_credits: false,
    payer_org_id: null,
    costs: { chat: 1, incident: 1, incident_reanalysis: 1 },
    used_by_feature: null,
    ...extra,
  });

  // The panel's open state survives a reload, so a second visit finds it open already.
  async function openOn(page, target = assistant) {
    await page.goto(logsUrl(), { waitUntil: "domcontentloaded" });
    await expect(target.headerButton).toHaveAttribute(
      "data-state",
      /idle|open/,
      { timeout: 30_000 },
    );
    if ((await target.headerButton.getAttribute("data-state")) !== "open")
      await target.open("header");
    await expect(target.composer()).toBeVisible();
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    mocks = await loadMocks();
    state = harness.createMockState();
    await harness.installMocks(context, state);
    await harness.login(page);
    assistant = new AssistantPage(page);
  });

  test.describe("on Cloud", () => {
    test.beforeEach(async ({ context, page }) => {
      await harness.forceCloudBuild(context);
      await page.reload();
    });

    test("the panel shows no meter, usage notice or credits-used number in any mode", { tag: ["@mock"] }, async ({ page }) => {
      const modes = [
        usage("free", 412),
        usage("free", 712),
        usage("free", 905),
        usage("consent_required", 1000),
        usage("pay_as_you_go", 1200),
      ];
      for (const row of modes) {
        state.usage = row;
        await openOn(page);
        await expect(assistant.meter()).toHaveCount(0);
        await expect(assistant.container().locator('[data-test="assistant-status-strip"]')).toHaveCount(0);
        await expect(assistant.container().locator('[data-test="assistant-credit-notice"]')).toHaveCount(0);
        await expect(assistant.container()).not.toContainText(/of 1,000|credits used/);
      }
    });

    test("a 402 offers the one action the role and billing state allow, and gives the prompt back", { tag: ["@mock"] }, async ({
      context,
      page,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const cases = [
        {
          overage: mocks.overageStatus(),
          title: "AI credits are used up for default.",
          action: "Manage paid usage",
          link: true,
        },
        {
          overage: mocks.overageStatus({
            billing_status: "subscription_required",
          }),
          title: "Included AI credits are used up for default.",
          action: "View plans",
          link: true,
        },
        {
          overage: mocks.overageStatus({
            billing_status: "additional_credits_required",
          }),
          title: "AI credits are used up for default.",
          action: "Copy request",
          link: false,
          copies: true,
        },
        {
          overage: mocks.overageStatus({ can_manage: false }),
          title: "AI credits are used up for default.",
          action: "Ask an admin",
          link: false,
          body: "An admin of default can allow paid usage in Billing › Paid usage.",
        },
        {
          overage: {
            ...mocks.overageStatus({ can_manage: false }),
            payer: {
              org_id: "acme-billing",
              enabled: false,
              can_manage: false,
            },
          },
          title: "AI credits are used up for default, billed to acme-billing.",
          action: "Ask an admin",
          link: false,
          body: "An admin of acme-billing can allow paid usage.",
        },
      ];
      state.usage = usage("exhausted", 1000);
      for (const row of cases) {
        state.overage = row.overage;
        await openOn(page);
        await expect(assistant.composerState()).toBeVisible();
        await assistant.send(
          "why did checkout 5xx spike?",
          "credits_exhausted",
        );
        await expect(assistant.outcome()).toHaveAttribute(
          "data-code",
          "credits_exhausted",
        );
        await expect(
          assistant
            .outcome()
            .locator('[data-test="assistant-turn-outcome-title"]'),
        ).toHaveText(row.title);
        if (row.body) await expect(assistant.outcome()).toContainText(row.body);
        await expect(assistant.outcomeAction()).toContainText(row.action);
        if (row.link)
          await expect(assistant.outcomeAction()).toHaveAttribute(
            "target",
            "_blank",
          );
        await expect(assistant.outcome()).not.toContainText(/Enable|Retry/);
        await expect(
          assistant
            .container()
            .locator('[data-test="assistant-composer-helper"]')
            .filter({ hasText: "AI credits are used up" }),
        ).toHaveCount(0);
        if (row.copies) {
          await assistant.outcomeAction().click();
          const today = await page.evaluate(() =>
            new Intl.DateTimeFormat("en-CA", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date()),
          );
          await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toBe(
              `Please add AI credits for default: 1,000 of 1,000 included credits used as of ${today}.`,
            );
        }
        await expect(assistant.composer()).toHaveValue(
          "why did checkout 5xx spike?",
        );
        await expect(
          assistant.container().locator('[data-test="assistant-message-user"]'),
        ).toHaveCount(0);
      }
      expect(
        state.log.filter((line) => line.startsWith("PUT paid_overage")),
      ).toHaveLength(0);
    });

    test("a known exhausted meter says so in the composer strip and keeps the draft with Send held", { tag: ["@mock"] }, async ({
      page,
    }) => {
      // K7: out of credits holds Send and keeps the draft; the strip replaces the old helper line.
      state.usage = usage("exhausted", 1000);
      await openOn(page);
      await expect(
        assistant
          .container()
          .locator('[data-test="assistant-composer-notice"][data-notice="credits"]'),
      ).toContainText("AI credits are used up for default.");
    });

    test("a failed turn on Cloud is never called free", { tag: ["@mock"] }, async ({ page }) => {
      state.usage = usage("free", 412);
      await openOn(page);
      await assistant.send("why did checkout 5xx spike?", "error");
      const credits = assistant
        .container()
        .locator('[data-test="assistant-turn-footer-credits"]')
        .last();
      await expect(credits).toHaveText("1 included credit", {
        timeout: 15_000,
      });
      await expect(assistant.container()).not.toContainText(
        /refunded|\bfree\b/i,
      );
    });
  });

  test("no meter and no usage request off Cloud", { tag: ["@mock"] }, async ({ page }) => {
    state.usage = usage("free", 412);
    await openOn(page);
    await expect(assistant.composer()).toBeVisible();
    await expect(assistant.meter()).toHaveCount(0);
    expect(state.log).not.toContain("GET ai/usage");
  });
});

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

  test("CONS-07 closing the chat moves the prompt to the global dialog; its Cancel writes nothing and keeps the draft @edition", { tag: ["@mock", "@stack-cloud"] }, async ({ context, page }) => {
    // The global paid-usage dialog is mounted on Cloud builds only.
    await harness.forceCloudBuild(context);
    await page.reload();
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

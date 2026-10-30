// Copyright 2026 OpenObserve Inc.
// Credits with the flag on: the strip meter in every mode, the 70 % notice once, per-turn credits and the role-aware 402.

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

  const meterPart = (id) =>
    assistant.meter().locator(`[data-test="assistant-credit-meter-${id}"]`);

  // Clipping hides inside the panel, so page scroll proves nothing: every visible part must sit inside the meter and the meter inside the strip.
  async function expectMeterUnclipped() {
    const boxes = await assistant.meter().evaluate((meter) => {
      const strip = meter.closest('[data-test="assistant-status-strip"]').getBoundingClientRect();
      const own = meter.getBoundingClientRect();
      const parts = [...meter.querySelectorAll("*")]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      return { strip, own, parts };
    });
    expect(boxes.own.left).toBeGreaterThanOrEqual(boxes.strip.left - 0.5);
    expect(boxes.own.right).toBeLessThanOrEqual(boxes.strip.right + 0.5);
    for (const r of boxes.parts) {
      expect(r.left).toBeGreaterThanOrEqual(boxes.own.left - 0.5);
      expect(r.right).toBeLessThanOrEqual(boxes.own.right + 0.5);
    }
  }

  test.beforeEach(async ({ context, page }) => {
    harness = await loadHarness();
    mocks = await loadMocks();
    await harness.setFlag(context, true);
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

    test("the strip meter reads every mode honestly", { tag: ["@mock"] }, async ({ page }) => {
      const rows = [
        {
          usage: usage("free", 412),
          text: "412 of 1,000",
          label: "412 of 1,000 included credits · they don't renew",
          tag: null,
        },
        {
          usage: usage("free", 712),
          text: "712 of 1,000",
          label: "712 of 1,000 included credits · they don't renew",
          tag: null,
        },
        {
          usage: usage("consent_required", 1000),
          text: "1,000 of 1,000",
          label: "Included credits used · paid usage needs consent",
          tag: "Consent required",
        },
        {
          usage: usage("pay_as_you_go", 1200),
          text: null,
          label: "1,000 included credits used · 200 billed · paid usage on",
          tag: "Paid usage on",
        },
        {
          usage: usage("exhausted", 1000),
          text: "Used up",
          label: "AI credits are used up for default",
          tag: "Exhausted",
        },
        {
          usage: usage("pay_as_you_go", 0, 0),
          text: "No included credits",
          label: "No included credits",
          tag: "Paid usage on",
        },
      ];
      for (const row of rows) {
        state.usage = row.usage;
        await openOn(page);
        if (row.text) await expect(meterPart("text")).toHaveText(row.text);
        else await expect(meterPart("text")).toHaveCount(0);
        await expect(assistant.meter()).toHaveAttribute(
          "aria-label",
          row.label,
        );
        if (row.tag) await expect(meterPart("mode")).toHaveText(row.tag);
        else await expect(meterPart("mode")).toHaveCount(0);
        await expect(assistant.meter()).not.toContainText(
          /Free|1200 \/ 1000|0 of 0/,
        );
      }
      state.usage = usage("consent_required", 1000);
      await openOn(page);
      await expect(meterPart("bar")).toHaveAttribute(
        "aria-valuetext",
        "1,000 of 1,000 credits",
      );
      await expect(meterPart("manage")).toHaveAttribute("target", "_blank");
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await openOn(page);
        await expect(meterPart("manage")).toBeHidden();
        await expect(meterPart("more")).toBeVisible();
        await expectMeterUnclipped();
      }
      await meterPart("more").click();
      await expect(
        page.locator('[data-test="assistant-credit-meter-more-manage"]'),
      ).toBeVisible();
    });

    test("the meter never vanishes when its reads fail", { tag: ["@mock"] }, async ({ page }) => {
      state.usageStatus = 500;
      state.overage = mocks.overageStatus({ effective: true, enabled: true });
      await openOn(page);
      await expect(meterPart("text")).toHaveText("Credits unavailable");
      await expect(meterPart("mode")).toHaveText("Paid usage on");
      state.usageStatus = 200;
      state.usage = usage("free", 412);
      await meterPart("retry").click();
      await expect(meterPart("text")).toHaveText("412 of 1,000");
      state.usageStatus = 500;
      state.overageStatus = 500;
      await openOn(page);
      await expect(meterPart("text")).toHaveText("Credits unavailable");
      await expect(meterPart("mode")).toHaveCount(0);
      await expect(meterPart("retry")).toBeVisible();
    });

    test("the meter re-reads when a turn completes", { tag: ["@mock"] }, async ({ page }) => {
      state.usage = usage("free", 412);
      await openOn(page);
      await expect(meterPart("text")).toHaveText("412 of 1,000");
      state.usage = usage("free", 413);
      await assistant.send("why did checkout 5xx spike?", "complete");
      await expect(meterPart("text")).toHaveText("413 of 1,000", {
        timeout: 15_000,
      });
    });

    test("the 70 % notice shows once and its dismiss holds across reloads and tabs", { tag: ["@mock"] }, async ({
      context,
      page,
    }) => {
      state.usage = usage("free", 712);
      await openOn(page);
      await expect(assistant.creditNotice()).toHaveText(
        /70% of included AI credits used · they don't renew/,
      );
      await expect(assistant.creditNotice()).toHaveAttribute("role", "status");
      const second = await context.newPage();
      const other = new AssistantPage(second);
      await openOn(second, other);
      await expect(other.creditNotice()).toBeVisible();
      await assistant
        .creditNotice()
        .locator('[data-test="assistant-credit-notice-dismiss"]')
        .click();
      await expect(assistant.creditNotice()).toHaveCount(0);
      await expect(assistant.composer()).toBeFocused();
      await expect(other.creditNotice()).toHaveCount(0);
      await openOn(page);
      await expect(assistant.meter()).toBeVisible();
      await expect(assistant.creditNotice()).toHaveCount(0);
      state.usage = usage("free", 905);
      await openOn(page);
      await expect(assistant.creditNotice()).toHaveText(
        /90% of included AI credits used/,
      );
      await expect(assistant.creditNotice()).toHaveAttribute("role", "alert");
      const events = (await harness.captureTelemetry(page)).filter(
        (e) => e.name === "ai_credit_notice",
      );
      expect(events.map((e) => e.properties.action)).toContain("shown");
      await second.close();
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

    test("a known exhausted meter predicts the refusal without blocking Send", { tag: ["@mock"] }, async ({
      page,
    }) => {
      state.usage = usage("exhausted", 1000);
      await openOn(page);
      await expect(
        assistant
          .container()
          .locator('[data-test="assistant-composer-helper"]'),
      ).toHaveText("AI credits are used up for default.");
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

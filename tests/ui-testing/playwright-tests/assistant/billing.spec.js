// Copyright 2026 OpenObserve Inc.
// Billing › Plans and Usage with the flag on, on a Cloud build: the AI credits card, the paid usage switch and the Usage tile.
import { test, expect } from "@playwright/test";
import { AssistantPage } from "../../pages/assistantPage.js";

// Playwright compiles a static import to require(), which would load the .mjs harness as CommonJS; import() keeps it ESM.
const loadHarness = () => import("./harness/setup.mjs");

const PAYG = {
  credits_used: 1200,
  credits_limit: 1000,
  credits_remaining: 0,
  mode: "pay_as_you_go",
  requires_additional_credits: false,
  costs: { chat: 1, incident: 5, incident_reanalysis: 2 },
};

test.describe("assistant billing @edition", () => {
  let assistant;
  let harness;
  let state;
  const url = (path) => `${harness.ENV.appUrl}${path}?org_identifier=${harness.ENV.org}`;
  const control = (page, id) => page.locator(`[data-test="${id}"]`);

  // The local backend has no Cloud billing API, so the subscription and usage reads are answered here.
  async function mockBilling(context) {
    await context.route(/\/api\/[^/]+\/(billings|billing_group)\//, (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const body = /list_subscription/.test(path)
        ? { subscription_type: "", provider: "" }
        : /data_usage/.test(path)
          ? { data: [], message: "ok" }
          : {};
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": request.headers()["origin"] || "*", "access-control-allow-credentials": "true" },
        body: JSON.stringify(body),
      });
    });
  }

  async function start(context, page, overrides) {
    test.skip(!process.env.O2_VITE_DEV, "edition rewrite needs the Vite dev server");
    harness = await loadHarness();
    state = harness.createMockState(overrides());
    await harness.setFlag(context, true);
    await harness.installMocks(context, state);
    await mockBilling(context);
    await harness.login(page);
    await harness.forceCloudBuild(context);
    assistant = new AssistantPage(page);
  }

  test("CRED-08 Plans and Usage show the same credits and mode, with paid usage status unavailable", { tag: ["@mock", "@stack-cloud"] }, async ({
    context,
    page,
  }) => {
    await start(context, page, () => ({ usage: PAYG, overageStatus: 503 }));
    await page.goto(url("/billings/plans"), { waitUntil: "domcontentloaded" });
    const card = control(page, "billing-ai-credits-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    const summary = control(page, "billing-ai-credits-summary");
    await expect(summary.locator('[data-test="assistant-credit-meter-text"]')).toHaveText(
      "1,000 included credits used · 200 billed · paid usage on",
    );
    await expect(summary.locator('[data-test="assistant-credit-meter-mode"]')).toHaveText("Paid usage on");
    await expect(card.locator('[data-test="paid-usage-unavailable"]')).toContainText("Paid usage status unavailable");
    await expect(card.getByText("Paid usage status unavailable")).toHaveCount(1);
    await expect(card.locator('[data-test="paid-usage-retry"]')).toBeVisible();

    await page.goto(url("/billings/usage"), { waitUntil: "domcontentloaded" });
    const usageSummary = control(page, "billings-usage-ai-summary");
    await expect(usageSummary.locator('[data-test="assistant-credit-meter-text"]')).toHaveText(
      "1,000 included credits used · 200 billed · paid usage on",
      { timeout: 30_000 },
    );
    await expect(usageSummary.locator('[data-test="assistant-credit-meter-mode"]')).toHaveText("Paid usage on");
  });

  test("CONS-12 the paid usage switch follows the org's own flag and waits for the payer", { tag: ["@mock", "@stack-cloud"] }, async ({ context, page }) => {
    const overage = () => ({
      ...harness.createMockState().overage,
      organization: { org_id: harness.ENV.org, enabled: true, can_manage: true },
      payer: { org_id: "acme-billing", enabled: false, can_manage: false },
      effective: false,
    });
    await start(context, page, () => ({ usage: { ...PAYG, mode: "consent_required", credits_used: 1000 }, overage: overage() }));
    await page.goto(url("/billings/plans"), { waitUntil: "domcontentloaded" });
    const own = control(page, "paid-usage-own-switch").locator('[role="switch"]');
    await expect(own).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await expect(control(page, "paid-usage-effective")).toContainText("Waiting for acme-billing");

    await own.click();
    const dialog = assistant.confirmDialog();
    await expect(dialog.locator('[data-test="o-dialog-secondary-btn"]')).toBeFocused();
    state.consentPutStatus = 500;
    await dialog.locator('[data-test="o-dialog-primary-btn"]').click();
    await expect(control(page, "paid-usage-error")).toBeVisible();
    await expect(own).toHaveAttribute("aria-checked", "true");

    state.consentPutStatus = 200;
    await own.click();
    await dialog.locator('[data-test="o-dialog-primary-btn"]').click();
    await expect(own).toHaveAttribute("aria-checked", "false");
    expect(state.log.filter((line) => line.startsWith("PUT paid_overage"))).toHaveLength(1);
  });

  test("CONS-12 an admin of the payer turns its paid usage off from this org, after a confirm", { tag: ["@mock", "@stack-cloud"] }, async ({ context, page }) => {
    const overage = () => ({
      ...harness.createMockState().overage,
      organization: { org_id: harness.ENV.org, enabled: true, can_manage: true },
      payer: { org_id: "acme-billing", enabled: true, can_manage: true },
      effective: true,
    });
    await start(context, page, () => ({ usage: PAYG, overage: overage() }));
    await page.goto(url("/billings/plans"), { waitUntil: "domcontentloaded" });
    const payer = control(page, "paid-usage-payer-switch").locator('[role="switch"]');
    await expect(payer).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await expect(control(page, "paid-usage-payer-switch")).toContainText("Allow paid usage for acme-billing");
    await payer.click();
    const dialog = assistant.confirmDialog();
    await expect(dialog).toContainText("acme-billing");
    await expect(dialog.locator('[data-test="o-dialog-secondary-btn"]')).toBeFocused();
    await dialog.locator('[data-test="o-dialog-primary-btn"]').click();
    await expect(payer).toHaveAttribute("aria-checked", "false");
    expect(state.log).toContain("PUT paid_overage acme-billing");
  });
});

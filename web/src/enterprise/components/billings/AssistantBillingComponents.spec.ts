// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "vuex";

import i18n from "@/locales";
import assistant, { parseAiUsage } from "@/services/assistant";
import paidOverage, { type PaidOverageStatus } from "@/services/paidOverage";
import { trackAssistant } from "@/services/assistantAnalytics";
import { createTestQueryClient, withQueryClient } from "@/test/unit/helpers/queryClient";

import AssistantCreditsCard from "./AssistantCreditsCard.vue";
import AssistantPaidUsageSettings from "./AssistantPaidUsageSettings.vue";

const { confirm, promptForConsent, capabilityAdmin } = vi.hoisted(() => ({
  confirm: vi.fn(),
  promptForConsent: vi.fn(),
  capabilityAdmin: { value: true },
}));

vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));
vi.mock("@/composables/usePaidOverageConsent", () => ({
  usePaidOverageConsent: () => ({ promptForConsent }),
}));
vi.mock("@/services/paidOverage", () => ({ default: { get: vi.fn(), update: vi.fn() } }));
vi.mock("@/services/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistant")>()),
  default: { usage: vi.fn() },
}));
vi.mock("@/composables/assistant", async (importOriginal) => {
  const { computed } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@/composables/assistant")>()),
    useAssistantCapability: () => computed(() => ({ isAdmin: capabilityAdmin.value })),
  };
});
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: vi.fn(),
}));
vi.mock("@/components/ai-assistant/gate/AssistantAskAdminPopover.vue", () => ({
  default: { template: '<div data-test="ask-admin"><slot name="trigger" /></div>' },
}));

const STATUS: PaidOverageStatus = {
  feature: "ai_credits",
  organization: { org_id: "acme", enabled: true, can_manage: true },
  payer: { org_id: "payer1", enabled: false, can_manage: false },
  effective: false,
  billing_status: "eligible",
};

async function settle() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

async function mountWith(component: unknown, status: PaidOverageStatus | Error, props = {}) {
  if (status instanceof Error) vi.mocked(paidOverage.get).mockRejectedValue(status);
  else vi.mocked(paidOverage.get).mockResolvedValue({ data: status } as never);
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "acme", label: "acme" },
      organizations: [
        { identifier: "acme", name: "Acme prod" },
        { identifier: "payer1", name: "Payer Inc" },
      ],
    },
  });
  const w = mount(component as never, {
    props,
    global: { plugins: [i18n, store, withQueryClient(createTestQueryClient())] },
  });
  await settle();
  return w;
}

afterEach(() => vi.clearAllMocks());

describe("AssistantPaidUsageSettings", () => {
  it("binds the switch to this org's own flag and names the payer it waits for", async () => {
    const w = await mountWith(AssistantPaidUsageSettings, STATUS);
    expect(w.find('[data-test="paid-usage-own-switch-btn"]').attributes("aria-checked")).toBe(
      "true",
    );
    expect(w.text()).toContain("This organization (Acme prod)");
    expect(w.find('[data-test="paid-usage-payer-state"]').text()).toContain(
      "Payer organization (Payer Inc)",
    );
    expect(w.find('[data-test="paid-usage-effective"]').text()).toBe(
      "In effect: paid usage off. Waiting for Payer Inc",
    );
    expect(w.text()).not.toContain("payer1");
  });

  it("gives an admin of the payer its own switch, on through consent", async () => {
    const managed = { ...STATUS, payer: { org_id: "payer1", enabled: false, can_manage: true } };
    const payerStatus = { ...STATUS, organization: { ...managed.payer }, payer: null };
    vi.mocked(paidOverage.get).mockImplementation(
      async (org) => ({ data: org === "payer1" ? payerStatus : managed }) as never,
    );
    promptForConsent.mockResolvedValue(true);
    const w = await mountWith(AssistantPaidUsageSettings, managed);
    vi.mocked(paidOverage.get).mockImplementation(
      async (org) => ({ data: org === "payer1" ? payerStatus : managed }) as never,
    );
    expect(w.find('[data-test="paid-usage-payer-switch"]').text()).toContain(
      "Allow paid usage for Payer Inc",
    );
    expect(w.find('[data-test="paid-usage-payer-state"]').text()).not.toContain("Managed by");
    await w.find('[data-test="paid-usage-payer-switch-btn"]').trigger("click");
    await settle();
    expect(promptForConsent).toHaveBeenCalledWith("payer1", "ai_credits", payerStatus);
    expect(paidOverage.update).not.toHaveBeenCalled();
  });

  it("turns the payer off only after a confirm", async () => {
    const managed = { ...STATUS, payer: { org_id: "payer1", enabled: true, can_manage: true } };
    confirm.mockResolvedValue(true);
    vi.mocked(paidOverage.update).mockResolvedValue({ data: managed } as never);
    const w = await mountWith(AssistantPaidUsageSettings, managed);
    await w.find('[data-test="paid-usage-payer-switch-btn"]').trigger("click");
    await settle();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Turn off paid AI usage for Payer Inc?",
        focusCancel: true,
      }),
    );
    expect(paidOverage.update).toHaveBeenCalledWith("payer1", "ai_credits", false);
  });

  it("confirms before turning off and records the outcome once", async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(paidOverage.update).mockResolvedValue({ data: STATUS } as never);
    const w = await mountWith(AssistantPaidUsageSettings, STATUS);
    await w.find('[data-test="paid-usage-own-switch-btn"]').trigger("click");
    await settle();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Turn off paid AI usage for Acme prod?",
        focusCancel: true,
      }),
    );
    expect(paidOverage.update).toHaveBeenCalledWith("acme", "ai_credits", false);
    expect(trackAssistant).toHaveBeenCalledTimes(1);
    expect(trackAssistant).toHaveBeenCalledWith("ai_admin", {
      section: "paid_usage",
      action: "disable",
      result: "ok",
    });
  });

  it("reverts and shows the inline error when the write fails", async () => {
    confirm.mockResolvedValue(true);
    vi.mocked(paidOverage.update).mockRejectedValue(new Error("boom"));
    const w = await mountWith(AssistantPaidUsageSettings, STATUS);
    await w.find('[data-test="paid-usage-own-switch-btn"]').trigger("click");
    await settle();
    expect(w.find('[data-test="paid-usage-error"]').exists()).toBe(true);
    expect(w.find('[data-test="paid-usage-own-switch-btn"]').attributes("aria-checked")).toBe(
      "true",
    );
  });

  it("always allows a revoke, even when turning on is blocked", async () => {
    const w = await mountWith(AssistantPaidUsageSettings, {
      ...STATUS,
      payer: null,
      billing_status: "subscription_required",
    });
    expect(
      w.find('[data-test="paid-usage-own-switch-btn"]').attributes("disabled"),
    ).toBeUndefined();
    expect(w.find('[data-test="paid-usage-own-helper"]').text()).toBe(
      "Subscribe to allow paid usage",
    );
  });

  it("opens the consent dialog to turn on and reverts on decline", async () => {
    promptForConsent.mockResolvedValue(false);
    const off = {
      ...STATUS,
      payer: null,
      organization: { ...STATUS.organization, enabled: false },
    };
    const w = await mountWith(AssistantPaidUsageSettings, off);
    await w.find('[data-test="paid-usage-own-switch-btn"]').trigger("click");
    await settle();
    expect(promptForConsent).toHaveBeenCalledWith("acme", "ai_credits", off);
    expect(w.find('[data-test="paid-usage-own-switch-btn"]').attributes("aria-checked")).toBe(
      "false",
    );
  });

  it("names who turned paid usage on", async () => {
    const on = {
      ...STATUS,
      payer: null,
      effective: true,
      organization: {
        ...STATUS.organization,
        enabled_by: { email: "ada@example.com", at: "2026-10-01T00:00:00Z" },
      },
    };
    const w2 = await mountWith(AssistantPaidUsageSettings, on);
    await vi.waitFor(() =>
      expect(w2.find('[data-test="paid-usage-enabled-by"]').text()).toContain(
        "Enabled by ada@example.com on",
      ),
    );
  });

  it("shows a read-only chip and Ask an admin to a member", async () => {
    const w = await mountWith(AssistantPaidUsageSettings, {
      ...STATUS,
      organization: { ...STATUS.organization, can_manage: false },
    });
    expect(w.find('[data-test="paid-usage-own-switch"]').exists()).toBe(false);
    expect(w.find('[data-test="paid-usage-own-readonly"]').text()).toContain(
      "Only an organization administrator can change this setting.",
    );
    expect(w.find('[data-test="ask-admin"]').exists()).toBe(true);
  });
});

describe("AssistantCreditsCard", () => {
  const usage = { credits_used: 1200, credits_limit: 1000, mode: "pay_as_you_go" };

  const mountCard = (status: PaidOverageStatus | Error, body: unknown) => {
    if (body instanceof Error) vi.mocked(assistant.usage).mockRejectedValue(body);
    else vi.mocked(assistant.usage).mockResolvedValue(parseAiUsage(body));
    return mountWith(AssistantCreditsCard, status);
  };

  it("reads pay-as-you-go past the pool as included plus billed", async () => {
    const w = await mountCard({ ...STATUS, payer: null, effective: true }, usage);
    expect(assistant.usage).toHaveBeenCalledWith("acme");
    expect(w.find('[data-test="assistant-credit-meter-text"]').text()).toBe(
      "1,000 included credits used · 200 billed · paid usage on",
    );
    expect(w.find('[data-test="assistant-credit-meter-bar"]').exists()).toBe(true);
    expect(w.find('[data-test="assistant-credit-meter-mode"]').text()).toBe("Paid usage on");
    expect(w.text()).not.toContain("1200 / 1000");
    expect(w.find('[data-test="billing-ai-mode-line"]').text()).toContain(
      "this organization's invoice",
    );
  });

  it("keeps the numbers when paid usage status fails", async () => {
    const w = await mountCard(new Error("503"), usage);
    expect(w.find('[data-test="assistant-credit-meter"]').attributes("data-state")).toBe("ready");
    expect(w.find('[data-test="assistant-credit-meter-text"]').text()).toBe(
      "1,000 included credits used · 200 billed · paid usage on",
    );
    expect(w.find('[data-test="paid-usage-unavailable"]').text()).toContain(
      "Paid usage status unavailable",
    );
    expect(w.findAll('[data-test="paid-usage-retry"]')).toHaveLength(1);
    expect(w.text().match(/Paid usage status unavailable/g)).toHaveLength(1);
  });

  it("says credit usage is unavailable and Retry reads it again", async () => {
    const w = await mountCard(STATUS, new Error("500"));
    expect(w.find('[data-test="assistant-credit-meter-text"]').text()).toBe(
      i18n.global.t("assistant.credits.meter.unavailable"),
    );
    vi.mocked(assistant.usage).mockResolvedValue(parseAiUsage(usage));
    await w.find('[data-test="assistant-credit-meter-retry"]').trigger("click");
    await settle();
    expect(assistant.usage).toHaveBeenCalledTimes(2);
    expect(w.find('[data-test="assistant-credit-meter"]').attributes("data-state")).toBe("ready");
    expect(w.find('[data-test="assistant-credit-meter-retry"]').exists()).toBe(false);
  });

  it("words an exhausted contract for who is reading", async () => {
    const exhausted = { ...usage, mode: "exhausted", credits_used: 1000 };
    const contract = { ...STATUS, billing_status: "additional_credits_required" as const };
    const admin = await mountCard(contract, exhausted);
    const adminLine = admin.find('[data-test="billing-ai-mode-line"]').text();
    capabilityAdmin.value = false;
    const member = await mountCard(contract, exhausted);
    capabilityAdmin.value = true;
    expect(member.find('[data-test="billing-ai-mode-line"]').text()).not.toBe(adminLine);
    expect(member.find('[data-test="billing-ai-mode-line"]').text()).toBe(
      i18n.global.t("assistant.billing.mode.exhaustedContractMember"),
    );
  });

  it("renders nothing where the server has no AI usage", async () => {
    // The usage read maps a 404 to null.
    const w = await mountCard(STATUS, null);
    expect(w.find('[data-test="billing-ai-credits-card"]').exists()).toBe(false);
  });
});

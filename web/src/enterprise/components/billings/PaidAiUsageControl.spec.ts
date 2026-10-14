// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import type { PaidOverageStatus } from "@/services/paidOverage";

const services = vi.hoisted(() => ({
  getConsent: vi.fn(),
  updateConsent: vi.fn(),
  promptForConsent: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: services.toast }));

vi.mock("@/services/paidOverage", () => ({
  default: { get: services.getConsent, update: services.updateConsent },
}));

vi.mock("@/composables/usePaidOverageConsent", () => ({
  usePaidOverageConsent: () => ({ promptForConsent: services.promptForConsent }),
}));

import PaidAiUsageControl from "./PaidAiUsageControl.vue";

function consentStatus(overrides: Partial<PaidOverageStatus> = {}): PaidOverageStatus {
  return {
    feature: "ai_credits",
    organization: { org_id: "default", enabled: false, can_manage: true },
    payer: null,
    effective: false,
    billing_status: "eligible",
    ...overrides,
  };
}

async function mountControl(mode = "consent_required") {
  const wrapper = mount(PaidAiUsageControl, {
    props: { mode },
    global: {
      plugins: [store, i18n],
      stubs: {
        OSwitch: {
          name: "OSwitch",
          props: ["modelValue", "disabled", "label"],
          emits: ["update:modelValue"],
          template:
            '<button data-test="billing-paid-ai-usage-toggle" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</button>',
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

const toggle = (w: Awaited<ReturnType<typeof mountControl>>) =>
  w.get('[data-test="billing-paid-ai-usage-toggle"]');

describe("PaidAiUsageControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization.identifier = "default";
    services.updateConsent.mockResolvedValue({ data: consentStatus() });
    services.promptForConsent.mockResolvedValue(true);
  });

  it("flags an off switch once free credits are gone, and explains it otherwise", async () => {
    services.getConsent.mockResolvedValue({ data: consentStatus() });
    const blocked = await mountControl("consent_required");
    expect(toggle(blocked).text()).toBe("Paid AI usage");
    expect(blocked.get('[data-test="billing-paid-ai-usage-hint"]').classes()).toContain(
      "text-status-warning-text",
    );
    expect(blocked.text()).toContain("Free credits are used up. Turn this on to keep using AI.");

    const early = await mountControl("free");
    expect(early.text()).toContain("Keep using AI after free credits run out");
  });

  it("names the invoice once paid usage is on, and reports the change", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "default", enabled: true, can_manage: true },
        effective: true,
      }),
    });
    const w = await mountControl("pay_as_you_go");
    expect(w.text()).toContain("Paid AI usage is billed on this organization's invoice.");
    await toggle(w).trigger("click");
    await flushPromises();
    expect(w.emitted("change")).toHaveLength(1);
  });

  it("asks for consent through the checked dialog before turning on", async () => {
    services.getConsent.mockResolvedValue({ data: consentStatus() });
    const w = await mountControl();
    await toggle(w).trigger("click");
    await flushPromises();
    expect(services.promptForConsent).toHaveBeenCalledWith(
      "default",
      "ai_credits",
      expect.objectContaining({ feature: "ai_credits" }),
    );
    expect(services.updateConsent).not.toHaveBeenCalled();
  });

  it("restores the switch when consent is declined", async () => {
    services.getConsent.mockResolvedValue({ data: consentStatus() });
    services.promptForConsent.mockResolvedValue(false);
    const w = await mountControl();
    await toggle(w).trigger("click");
    await flushPromises();
    expect(w.getComponent({ name: "OSwitch" }).props("modelValue")).toBe(false);
  });

  it("turns off directly, without a dialog", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "default", enabled: true, can_manage: true },
        effective: true,
      }),
    });
    const w = await mountControl();
    await toggle(w).trigger("click");
    await flushPromises();
    expect(services.updateConsent).toHaveBeenCalledWith("default", "ai_credits", false);
    expect(services.promptForConsent).not.toHaveBeenCalled();
  });

  it("shows why the server refused a change, and keeps the switch as it was", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "default", enabled: true, can_manage: true },
        effective: true,
      }),
    });
    services.updateConsent.mockRejectedValue({
      response: { status: 409, data: { message: "This organization cannot use paid AI usage." } },
    });
    const w = await mountControl();
    await toggle(w).trigger("click");
    await flushPromises();

    expect(services.toast).toHaveBeenCalledWith({
      variant: "error",
      message: "This organization cannot use paid AI usage.",
    });
    expect(w.getComponent({ name: "OSwitch" }).props("modelValue")).toBe(true);
  });

  it("falls back to the generic message when the server gives no reason", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "default", enabled: true, can_manage: true },
        effective: true,
      }),
    });
    services.updateConsent.mockRejectedValue(new Error("Network Error"));
    const w = await mountControl();
    await toggle(w).trigger("click");
    await flushPromises();

    expect(services.toast).toHaveBeenCalledWith({
      variant: "error",
      message: "Couldn't update paid AI usage. Try again.",
    });
  });

  it("keeps the switch read-only for non-admins", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "default", enabled: false, can_manage: false },
      }),
    });
    const w = await mountControl();
    expect(toggle(w).attributes("disabled")).toBeDefined();
    expect(w.text()).toContain("Only admins can change this");
  });

  it("renders nothing where billing does not allow paid usage", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({ billing_status: "subscription_required" }),
    });
    const w = await mountControl();
    expect(w.find('[data-test="billing-paid-ai-usage"]').exists()).toBe(false);
  });

  it("names the payer a billing-group member is waiting on", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "member", enabled: true, can_manage: true },
        payer: { org_id: "acme", enabled: false, can_manage: false },
        effective: false,
      }),
    });
    const w = await mountControl();
    expect(w.text()).toContain("Waiting for acme to turn it on");
  });

  it("names the payer by its name when the server sends one", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "member", enabled: true, can_manage: true },
        payer: { org_id: "3Kg0acme", name: "Acme Payer", enabled: false, can_manage: false },
        effective: false,
      }),
    });
    const w = await mountControl();
    expect(w.text()).toContain("Waiting for Acme Payer to turn it on");
  });

  it("shows a member's own consent while it waits, so the member can turn it off", async () => {
    services.getConsent.mockResolvedValue({
      data: consentStatus({
        organization: { org_id: "member", enabled: true, can_manage: true },
        payer: { org_id: "acme", enabled: false, can_manage: false },
        effective: false,
      }),
    });
    const w = await mountControl();
    expect(w.getComponent({ name: "OSwitch" }).props("modelValue")).toBe(true);

    await toggle(w).trigger("click");
    await flushPromises();
    expect(services.updateConsent).toHaveBeenCalledWith("default", "ai_credits", false);
    expect(services.promptForConsent).not.toHaveBeenCalled();
  });
});
